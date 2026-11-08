#!/usr/bin/env python3
"""
Seed dữ liệu cho đồ án IE402 – mạng cống thoát nước & điểm ngập khu chợ Thủ Đức.

    pip install -r scripts/requirements.txt
    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres python scripts/seed.py

- Tâm khu vực: thử Nominatim; nếu không truy cập được dùng xấp xỉ (10.850, 106.756).
- Đường & nhà: thử Overpass (OSM); nếu không có mạng thì sinh lưới đường/nhà MOCK
  (bảng buildings.source = 'mock' | 'osm').
- Địa hình: ~800 điểm dạng "lòng chảo" thấp nhất (+0,8 m) ở chợ, cao dần ra ngoài (+3..+5 m);
  TIN sinh trong PostGIS bằng ST_DelaunayTriangles.
- Cố ý cài lỗi để demo: 3 cống dốc ngược, 3 cống chôn nông, 3 va chạm 3D, 1 cống nâng cấp D800→D1200.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg
from scipy.interpolate import LinearNDInterpolator
from shapely import voronoi_polygons
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

RNG = random.Random(402)
NP_RNG = np.random.default_rng(402)
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
DEMO_PASSWORD = "Demo@123"
NOW = datetime.now(timezone.utc).replace(microsecond=0)

# Phạm vi nghiên cứu (mét, hệ tọa độ cục bộ quanh tâm): 1400 m × 1300 m ≈ 1,82 km²
HALF_W, HALF_H = 700.0, 650.0
BOWL_CENTER = (115.0, 75.0)   # chợ Thủ Đức – điểm thấp nhất của "lòng chảo"
ZONE_SPLIT_X = 80.0          # Zone A: phía tây, Zone B: phía đông

SIZES = [600, 800, 1000, 1200, 1500]
MATERIALS = [("BTCT", "Bê tông cốt thép", 0.013), ("HDPE", "Nhựa HDPE", 0.010), ("GACH", "Gạch xây", 0.015)]

INFO: dict[str, str] = {}


def log(msg: str) -> None:
    print(f"[seed] {msg}", flush=True)


# ---------------------------------------------------------------------------
# 1. Tâm khu vực & dữ liệu OSM (nếu có mạng)
# ---------------------------------------------------------------------------
def http_get(url: str, data: bytes | None = None, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "IE402-student-project/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_center() -> tuple[float, float]:
    try:
        q = urllib.parse.quote("Chợ Thủ Đức, Thành phố Thủ Đức, Hồ Chí Minh")
        res = json.loads(http_get(f"https://nominatim.openstreetmap.org/search?q={q}&format=json&limit=1"))
        lat, lon = float(res[0]["lat"]), float(res[0]["lon"])
        INFO["center"] = f"Nominatim ({lat:.6f}, {lon:.6f})"
        return lat, lon
    except Exception as e:  # noqa: BLE001
        INFO["center"] = "xấp xỉ (10.850, 106.756) – không truy cập được Nominatim"
        log(f"Nominatim lỗi ({type(e).__name__}) → dùng tâm xấp xỉ")
        return 10.850, 106.756


def fetch_osm(bbox_ll: tuple[float, float, float, float]) -> dict | None:
    s, w, n, e = bbox_ll
    q = f"""[out:json][timeout:25];
    (way["highway"~"primary|secondary|tertiary|residential|unclassified"]({s},{w},{n},{e});
     way["building"]({s},{w},{n},{e}););
    out geom;"""
    try:
        raw = http_get("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(), timeout=40)
        return json.loads(raw)
    except Exception as e:  # noqa: BLE001
        log(f"Overpass lỗi ({type(e).__name__}) → sinh dữ liệu MOCK")
        return None


# ---------------------------------------------------------------------------
# 2. Địa hình "lòng chảo"
# ---------------------------------------------------------------------------
def bowl_z(x: float, y: float) -> float:
    r = math.hypot(x - BOWL_CENTER[0], y - BOWL_CENTER[1])
    return 0.8 + 3.8 * (min(r, 1000.0) / 950.0) ** 1.3


def gen_terrain_points(n: int = 800) -> list[tuple[float, float, float]]:
    pad = 60.0
    xs, ys = HALF_W + pad, HALF_H + pad
    pts: list[tuple[float, float]] = []
    # biên + góc để TIN phủ kín phạm vi
    for i in range(9):
        t = -1 + 2 * i / 8
        pts += [(t * xs, -ys), (t * xs, ys), (-xs, t * ys), (xs, t * ys)]
    pts.append(BOWL_CENTER)
    pts = list(dict.fromkeys(pts))
    while len(pts) < n:
        pts.append((RNG.uniform(-xs, xs), RNG.uniform(-ys, ys)))
    out = []
    for x, y in pts:
        z = bowl_z(x, y) + (0 if (x, y) == BOWL_CENTER else RNG.gauss(0, 0.06))
        out.append((x, y, round(max(z, 0.8), 3)))
    return out


# ---------------------------------------------------------------------------
# 3. Mạng đường (OSM hoặc mock) → đồ thị hố ga / cống
# ---------------------------------------------------------------------------
MOCK_STREETS = [
    # (tên, toạ độ cục bộ) – BỐ CỤC MOCK (lưới ô phố ~150–230 m quanh chợ), chỉ mượn tên đường thật
    ("Đặng Văn Bi", [(-440, -390), (380, -390)]),
    ("Đường số 2 (mock)", [(-440, -230), (380, -230)]),
    ("Võ Văn Ngân", [(-440, 0), (380, 0)]),
    ("Hẻm chợ Thủ Đức (mock)", [(-440, 150), (380, 150)]),
    ("Đường số 5 (mock)", [(-440, 300), (380, 300)]),
    ("Dương Văn Cam", [(-440, 440), (380, 440)]),
    ("Đường số 7 (mock)", [(-440, -390), (-440, 440)]),
    ("Đường số 8 (mock)", [(-270, -390), (-270, 440)]),
    ("Kha Vạn Cân", [(-100, -390), (-100, 440)]),
    ("Đường số 10 (mock)", [(30, -390), (30, 440)]),
    ("Đường số 11 (mock)", [(200, -390), (200, 440)]),
    ("Tô Ngọc Vân", [(380, -390), (380, 440)]),
]


def osm_streets(osm: dict, to_local) -> list[tuple[str, list[tuple[float, float]]]]:
    rank = {"primary": 0, "secondary": 1, "tertiary": 2, "residential": 3, "unclassified": 4}
    ways = []
    for el in osm.get("elements", []):
        hw = el.get("tags", {}).get("highway")
        if el.get("type") == "way" and hw in rank and "geometry" in el:
            coords = [to_local(g["lon"], g["lat"]) for g in el["geometry"]]
            line = LineString(coords).intersection(box(-HALF_W + 20, -HALF_H + 20, HALF_W - 20, HALF_H - 20))
            if line.is_empty or line.length < 40:
                continue
            for part in getattr(line, "geoms", [line]):
                ways.append((rank[hw], el["tags"].get("name", hw), list(part.coords)))
    ways.sort(key=lambda w: (w[0], -LineString(w[2]).length))
    out, total = [], 0.0
    for _, name, coords in ways:              # giữ đường chính trước tới khi đủ ~200 hố ga
        if total > 8600:
            break
        out.append((name, coords))
        total += LineString(coords).length
    return out


class Network:
    def __init__(self) -> None:
        self.nodes: dict[tuple, dict] = {}       # key → {x,y,street}
        self.edges: list[dict] = []              # {a,b,street}

    def key(self, x: float, y: float) -> tuple:
        return (round(x, 2), round(y, 2))

    def add_node(self, x, y, **kw) -> tuple:
        k = self.key(x, y)
        if k not in self.nodes:
            self.nodes[k] = {"x": float(x), "y": float(y), **kw}
        return k


def build_network(streets) -> Network:
    net = Network()
    lines = [LineString(c) for _, c in streets]
    names = {i: n for i, (n, _) in enumerate(streets)}
    noded = unary_union(lines)               # tách đường tại các giao lộ
    for seg in getattr(noded, "geoms", [noded]):
        # tìm tên đường chứa đoạn
        mid = seg.interpolate(0.5, normalized=True)
        sid = min(range(len(lines)), key=lambda i: lines[i].distance(mid))
        n = max(1, round(seg.length / 46.0))
        if seg.length / n < 30 and n > 1:
            n -= 1
        prev = None
        for i in range(n + 1):
            p = seg.interpolate(i / n, normalized=True)
            k = net.add_node(p.x, p.y, street=names[sid])
            if prev is not None and prev != k:
                net.edges.append({"a": prev, "b": k, "street": names[sid]})
            prev = k
    return net


# ---------------------------------------------------------------------------
# 4. Thiết kế thủy lực: hướng dòng, đường kính, cao độ đáy
# ---------------------------------------------------------------------------
def manning(d_mm: float, s: float, n: float) -> float:
    if s <= 0:
        return 0.0
    d = d_mm / 1000
    return (1 / n) * (math.pi * d * d / 4) * (d / 4) ** (2 / 3) * math.sqrt(s)


def design_network(net: Network, rim: dict) -> dict:
    import heapq

    adj = defaultdict(list)
    for e in net.edges:
        L = math.dist((net.nodes[e["a"]]["x"], net.nodes[e["a"]]["y"]), (net.nodes[e["b"]]["x"], net.nodes[e["b"]]["y"]))
        e["L"] = L
        adj[e["a"]].append((e["b"], L))
        adj[e["b"]].append((e["a"], L))

    # 3 cửa xả: các nút thấp nhất, cách nhau ≥ 250 m
    outfalls: list[tuple] = []
    for k in sorted(net.nodes, key=lambda k: rim[k]):
        if all(math.dist(k, o) >= 250 for o in outfalls):
            outfalls.append(k)
        if len(outfalls) == 3:
            break

    # Dijkstra đa nguồn: khoảng cách theo mạng tới cửa xả gần nhất
    dist = {k: math.inf for k in net.nodes}
    pq = []
    for o in outfalls:
        dist[o] = 0.0
        heapq.heappush(pq, (0.0, o))
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, L in adj[u]:
            if d + L < dist[v]:
                dist[v] = d + L
                heapq.heappush(pq, (d + L, v))

    # Hướng dòng chảy: từ nút xa cửa xả về nút gần cửa xả
    pipes = []
    for e in net.edges:
        a, b = e["a"], e["b"]
        if (dist[a], a) < (dist[b], b):
            a, b = b, a
        pipes.append({"from": a, "to": b, "L": e["L"], "street": e["street"]})

    # Diện tích lưu vực mỗi nút (Voronoi) – để chọn đường kính
    keys = list(net.nodes)
    vor = voronoi_polygons(MultiPoint([Point(k) for k in keys]), extend_to=box(-HALF_W, -HALF_H, HALF_W, HALF_H))
    area_box = box(-HALF_W, -HALF_H, HALF_W, HALF_H)
    tree = STRtree([Point(k) for k in keys])
    area = {k: 0.0 for k in keys}
    for cell in vor.geoms:
        for idx in tree.query(cell):
            if cell.contains(Point(keys[idx])):
                area[keys[idx]] = cell.intersection(area_box).area

    out_edges = defaultdict(list)
    for p in pipes:
        out_edges[p["from"]].append(p)
    order = sorted(keys, key=lambda k: -dist[k])          # thượng lưu → hạ lưu
    acc = dict(area)
    for k in order:
        outs = out_edges[k]
        for p in outs:
            p["A"] = acc[k] / len(outs)
            acc[p["to"]] += p["A"]

    i_design = 55.0                                       # mm/h thiết kế
    for p in pipes:
        q = 0.8 * i_design * p["A"] / 3.6e6
        p["D"] = next((d for d in SIZES if manning(d, 0.0015, 0.013) >= q), 1500)

    # Cao độ đáy: duyệt từ cửa xả ngược lên, dốc 0,1–0,3%, chiều sâu 1,5–3 m
    dmax = defaultdict(int)
    for p in pipes:
        dmax[p["from"]] = max(dmax[p["from"]], p["D"])
        dmax[p["to"]] = max(dmax[p["to"]], p["D"])
    inv = {}
    for k in sorted(keys, key=lambda k: dist[k]):
        dmin = max(1.5, dmax[k] / 1000 + 0.9)
        target = RNG.uniform(dmin, min(3.0, dmin + 0.7))
        outs = out_edges[k]
        if not outs:                                      # cửa xả
            inv[k] = rim[k] - target
            continue
        lo = max(inv[p["to"]] + 0.001 * p["L"] for p in outs)
        hi = min(inv[p["to"]] + 0.003 * p["L"] for p in outs)
        want = rim[k] - target
        inv[k] = max(lo, min(hi, want)) if lo <= hi else lo
    for p in pipes:
        p["z_up"], p["z_dn"] = inv[p["from"]], inv[p["to"]]
    return {"pipes": pipes, "inv": inv, "outfalls": outfalls, "dist": dist, "dmax": dmax}


# ---------------------------------------------------------------------------
# 5. Nhà (mock) + bề mặt SUDM
# ---------------------------------------------------------------------------
def gen_buildings_mock(street_lines: list[LineString], n: int = 500) -> list[dict]:
    roads = unary_union([l.buffer(13) for l in street_lines])
    placed: list[Polygon] = []
    out = []
    # chợ Thủ Đức (công trình lớn ở tâm)
    market = box(BOWL_CENTER[0] - 35, BOWL_CENTER[1] - 18, BOWL_CENTER[0] + 35, BOWL_CENTER[1] + 30)
    market = market.difference(roads).buffer(0)
    if market.geom_type == "MultiPolygon":
        market = max(market.geoms, key=lambda g: g.area)
    placed.append(market)
    out.append({"name": "Chợ Thủ Đức (mock footprint)", "poly": market, "floors": 2, "basement": False, "year": 1998})
    tries = 0
    while len(out) < n and tries < 60000:
        tries += 1
        cx, cy = RNG.uniform(-HALF_W + 15, HALF_W - 15), RNG.uniform(-HALF_H + 15, HALF_H - 15)
        w, h = RNG.uniform(5, 16), RNG.uniform(8, 24)
        ang = RNG.uniform(-6, 6)
        poly = box(-w / 2, -h / 2, w / 2, h / 2)
        from shapely import affinity
        poly = affinity.translate(affinity.rotate(poly, ang), cx, cy)
        if poly.intersects(roads):
            continue
        if any(poly.distance(p) < 2.0 for p in placed if p.bounds[0] - 30 < cx < p.bounds[2] + 30 and p.bounds[1] - 30 < cy < p.bounds[3] + 30):
            continue
        placed.append(poly)
        r = RNG.random()
        floors = RNG.randint(1, 3) if r < 0.6 else RNG.randint(4, 6) if r < 0.9 else RNG.randint(7, 12)
        out.append({"name": None, "poly": poly, "floors": floors, "basement": None, "year": RNG.randint(1985, 2023)})
    # 20% có tầng hầm (ưu tiên nhà cao tầng)
    cand = [b for b in out if b["basement"] is None]
    cand.sort(key=lambda b: -(b["floors"] + RNG.random() * 4))
    nb = round(0.2 * len(out))
    for i, b in enumerate(cand):
        b["basement"] = i < nb
    for i, b in enumerate(out):
        if b["name"] is None:
            b["name"] = f"Nhà {i:03d}" if b["floors"] < 7 else f"Tòa nhà {i:03d}"
    return out


def osm_buildings(osm: dict, to_local, street_lines) -> list[dict]:
    out = []
    for el in osm.get("elements", []):
        if el.get("type") == "way" and "building" in el.get("tags", {}) and "geometry" in el:
            coords = [to_local(g["lon"], g["lat"]) for g in el["geometry"]]
            if len(coords) < 4:
                continue
            poly = Polygon(coords).buffer(0)
            if poly.is_empty or poly.geom_type != "Polygon" or not box(-HALF_W, -HALF_H, HALF_W, HALF_H).contains(poly):
                continue
            lv = el["tags"].get("building:levels")
            floors = int(float(lv)) if lv and lv.replace(".", "").isdigit() else RNG.randint(1, 4)
            out.append({"name": el["tags"].get("name"), "poly": poly, "floors": max(1, min(floors, 40)),
                        "basement": None, "year": RNG.randint(1985, 2023)})
        if len(out) >= 500:
            break
    nb = round(0.2 * len(out))
    for i, b in enumerate(sorted(out, key=lambda b: -b["floors"])):
        b["basement"] = i < nb
        b["name"] = b["name"] or f"Nhà OSM {i:03d}"
    return out


def surfaces(poly: Polygon, base: float, height: float, lod2: bool) -> list[tuple[str, int, list]]:
    """Sinh bề mặt biên SUDM: Ground, Wall×n, Roof (LOD1 phẳng, LOD2 mái dốc 2 mái)."""
    ring = list(poly.exterior.coords)[:-1]
    if poly.exterior.is_ccw is False:
        ring = ring[::-1]
    top = base + height
    res = [("Ground", 1 if not lod2 else 2, [(x, y, base) for x, y in ring[::-1]])]
    if not lod2 or len(ring) != 4:
        for i in range(len(ring)):
            (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % len(ring)]
            res.append(("Wall", 1, [(x1, y1, base), (x2, y2, base), (x2, y2, top), (x1, y1, top)]))
        res.append(("Roof", 1, [(x, y, top) for x, y in ring]))
        return res
    # LOD2: mái 2 dốc, nóc chạy dọc cạnh dài
    a, b, c, d = ring
    if math.dist(a, b) < math.dist(b, c):
        a, b, c, d = b, c, d, a
    ridge_h = top + 2.0
    m1 = ((a[0] + d[0]) / 2, (a[1] + d[1]) / 2)
    m2 = ((b[0] + c[0]) / 2, (b[1] + c[1]) / 2)
    res += [
        ("Wall", 2, [(a[0], a[1], base), (b[0], b[1], base), (b[0], b[1], top), (a[0], a[1], top)]),
        ("Wall", 2, [(c[0], c[1], base), (d[0], d[1], base), (d[0], d[1], top), (c[0], c[1], top)]),
        ("Wall", 2, [(b[0], b[1], base), (c[0], c[1], base), (c[0], c[1], top), (m2[0], m2[1], ridge_h), (b[0], b[1], top)]),
        ("Wall", 2, [(d[0], d[1], base), (a[0], a[1], base), (a[0], a[1], top), (m1[0], m1[1], ridge_h), (d[0], d[1], top)]),
        ("Roof", 2, [(a[0], a[1], top), (b[0], b[1], top), (m2[0], m2[1], ridge_h), (m1[0], m1[1], ridge_h)]),
        ("Roof", 2, [(c[0], c[1], top), (d[0], d[1], top), (m1[0], m1[1], ridge_h), (m2[0], m2[1], ridge_h)]),
    ]
    return res


# ---------------------------------------------------------------------------
# Tiện ích WKT
# ---------------------------------------------------------------------------
class Geo:
    def __init__(self, ox: float, oy: float):
        self.ox, self.oy = ox, oy

    def pz(self, x, y, z):
        return f"SRID=32648;POINT Z ({self.ox + x:.3f} {self.oy + y:.3f} {z:.3f})"

    def p(self, x, y):
        return f"SRID=32648;POINT ({self.ox + x:.3f} {self.oy + y:.3f})"

    def lz(self, pts):
        return "SRID=32648;LINESTRING Z (" + ", ".join(f"{self.ox + x:.3f} {self.oy + y:.3f} {z:.3f}" for x, y, z in pts) + ")"

    def poly(self, poly: Polygon):
        return "SRID=32648;POLYGON ((" + ", ".join(f"{self.ox + x:.3f} {self.oy + y:.3f}" for x, y in poly.exterior.coords) + "))"

    def polyz(self, pts):
        pts = list(pts) + [pts[0]]
        return "SRID=32648;POLYGON Z ((" + ", ".join(f"{self.ox + x:.3f} {self.oy + y:.3f} {z:.3f}" for x, y, z in pts) + "))"


def rand_dt(start: datetime, end: datetime) -> datetime:
    return start + timedelta(seconds=RNG.uniform(0, (end - start).total_seconds()))


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def main() -> None:
    lat0, lon0 = get_center()
    conn = psycopg.connect(DATABASE_URL, autocommit=False)
    cur = conn.cursor()
    cur.execute("set search_path = public, extensions")
    cur.execute("select set_config('app.seeding', 'on', false)")
    cur.execute("select ST_X(g), ST_Y(g) from (select ST_Transform(ST_SetSRID(ST_MakePoint(%s,%s),4326),32648) g) s", (lon0, lat0))
    ox, oy = cur.fetchone()
    G = Geo(ox, oy)
    log(f"Tâm: {INFO['center']} → UTM48N ({ox:.1f}, {oy:.1f})")

    # bbox lat/lon cho Overpass
    cur.execute("""select ST_YMin(e), ST_XMin(e), ST_YMax(e), ST_XMax(e) from
                   (select ST_Transform(ST_MakeEnvelope(%s,%s,%s,%s,32648),4326) e) s""",
                (ox - HALF_W, oy - HALF_H, ox + HALF_W, oy + HALF_H))
    bbox_ll = cur.fetchone()
    osm = fetch_osm(bbox_ll)

    def to_local(lon, lat):
        cur.execute("select ST_X(g)-%s, ST_Y(g)-%s from (select ST_Transform(ST_SetSRID(ST_MakePoint(%s,%s),4326),32648) g) s",
                    (ox, oy, lon, lat))
        return cur.fetchone()

    # ---------------- xóa dữ liệu cũ ----------------
    log("Xóa dữ liệu cũ …")
    cur.execute("""truncate audit_log, asset_events, incident_reports, water_obs, obs_stations, rain_scenarios,
                   flood_points, defects, inspections, utilities, pipes, csg_node, manholes, pipe_materials,
                   building_surface, buildings, terrain_tin, terrain_points, user_zones, zones restart identity cascade""")
    cur.execute("alter sequence manholes_id_seq restart; alter sequence pipes_id_seq restart")
    cur.execute("delete from auth.users where email like '%%@demo.vn'")

    # ---------------- zones ----------------
    cur.execute("insert into zones (name, geom) values (%s, ST_GeomFromEWKT(%s)), (%s, ST_GeomFromEWKT(%s))",
                ("Zone A – Tây", G.poly(box(-HALF_W, -HALF_H, ZONE_SPLIT_X, HALF_H)),
                 "Zone B – Đông", G.poly(box(ZONE_SPLIT_X, -HALF_H, HALF_W, HALF_H))))

    # ---------------- terrain + TIN ----------------
    tpts = gen_terrain_points(800)
    cur.executemany("insert into terrain_points (source, geom) values ('mock', ST_GeomFromEWKT(%s))", [(G.pz(*p),) for p in tpts])
    # TIN: tam giác Delaunay từ tập điểm cao độ
    cur.execute("""insert into terrain_tin (geom)
                   select (ST_Dump(ST_DelaunayTriangles(ST_Collect(geom), 0.0, 0))).geom from terrain_points""")
    interp = LinearNDInterpolator(np.array([(x, y) for x, y, _ in tpts]), np.array([z for *_, z in tpts]))

    def ground(x, y) -> float:
        return float(interp(x, y))

    # ---------------- network ----------------
    streets = osm_streets(osm, to_local) if osm else []
    INFO["roads"] = "OSM (Overpass)" if len(streets) >= 5 else "MOCK (lưới đường giả, mượn tên đường thật)"
    if len(streets) < 5:
        streets = MOCK_STREETS
    street_lines = [LineString(c) for _, c in streets]
    net = build_network(streets)

    # Rim nội suy từ TIN bằng hàm tin_elev() trong PostGIS
    keys = list(net.nodes)
    cur.execute("""select public.tin_elev(ST_SetSRID(ST_MakePoint(x + %s, y + %s), 32648))
                   from unnest(%s::float8[], %s::float8[]) with ordinality as t(x, y, i) order by i""",
                (ox, oy, [net.nodes[k]["x"] for k in keys], [net.nodes[k]["y"] for k in keys]))
    rim = {k: round(r[0], 3) for k, r in zip(keys, cur.fetchall())}
    design = design_network(net, rim)
    pipes, inv = design["pipes"], design["inv"]

    # Hố thu (inlet) phía phải đường, nối vào hố ga bằng nhánh ngắn D600
    seg_dir = {}
    for p in pipes:
        a, b = net.nodes[p["from"]], net.nodes[p["to"]]
        seg_dir.setdefault(p["to"], (b["x"] - a["x"], b["y"] - a["y"]))
    inlet_hosts = RNG.sample([k for k in keys if k not in design["outfalls"] and k in seg_dir], 15)
    inlets = []
    for h in inlet_hosts:
        dx, dy = seg_dir[h]
        L = math.hypot(dx, dy)
        nx_, ny_ = dy / L, -dx / L                # pháp tuyến phải
        x, y = net.nodes[h]["x"] + 9 * nx_, net.nodes[h]["y"] + 9 * ny_
        k = net.add_node(x, y, street=net.nodes[h]["street"], inlet=True)
        rim[k] = None
        inlets.append((k, h))
    if inlets:
        cur.execute("""select public.tin_elev(ST_SetSRID(ST_MakePoint(x + %s, y + %s), 32648))
                       from unnest(%s::float8[], %s::float8[]) with ordinality as t(x, y, i) order by i""",
                    (ox, oy, [net.nodes[k]["x"] for k, _ in inlets], [net.nodes[k]["y"] for k, _ in inlets]))
        for (k, h), r in zip(inlets, cur.fetchall()):
            rim[k] = round(r[0], 3)
            L = math.dist((net.nodes[k]["x"], net.nodes[k]["y"]), (net.nodes[h]["x"], net.nodes[h]["y"]))
            z_up = max(rim[k] - 1.6, inv[h] + 0.002 * L)
            inv[k] = z_up
            pipes.append({"from": k, "to": h, "L": L, "street": net.nodes[h]["street"], "D": 600,
                          "z_up": z_up, "z_dn": z_up - 0.002 * L, "A": 0, "inlet": True})

    # ---------------- cài lỗi demo ----------------
    incoming = defaultdict(list)
    for p in pipes:
        incoming[p["to"]].append(p)
    used: set[int] = set()

    def cover(p):
        return min(rim[p["from"]] - p["z_up"], rim[p["to"]] - p["z_dn"]) - p["D"] / 1000

    def in_zone_strict(p):  # cả 2 đầu cùng 1 zone
        xa, xb = net.nodes[p["from"]]["x"], net.nodes[p["to"]]["x"]
        return (xa < ZONE_SPLIT_X - 5 and xb < ZONE_SPLIT_X - 5) or (xa > ZONE_SPLIT_X + 5 and xb > ZONE_SPLIT_X + 5)

    main_pipes = [i for i, p in enumerate(pipes) if not p.get("inlet") and in_zone_strict(p)]
    # (a) 3 cống dốc ngược / bằng
    cands = [i for i in main_pipes if pipes[i]["D"] <= 800 and cover(pipes[i]) >= 1.0]
    for i, s in zip(RNG.sample(cands, 3), [-0.0015, 0.0, 0.0003]):
        p = pipes[i]
        p["z_dn"] = p["z_up"] - s * p["L"]
        p["planted"] = "reverse_slope"
        used.add(i)
    # (b) 3 cống chôn nông: nâng cao độ đáy tại hố ga đầu nhánh (không có cống đổ vào)
    outs_of = defaultdict(list)
    for i, p in enumerate(pipes):
        outs_of[p["from"]].append(i)
    leaves = [k for k in outs_of if not incoming[k] and k not in design["outfalls"]
              and all(i in main_pipes and i not in used and pipes[i]["D"] <= 800 for i in outs_of[k])]
    leaves.sort(key=lambda k: (len(outs_of[k]), RNG.random()))
    chosen, total = [], 0
    for k in leaves:
        if total + len(outs_of[k]) <= 3:
            chosen.append(k)
            total += len(outs_of[k])
        if total == 3:
            break
    covers = iter([0.45, 0.55, 0.62])
    for k in chosen:
        for i in outs_of[k]:
            p = pipes[i]
            p["z_up"] = rim[k] - p["D"] / 1000 - next(covers)
            p["planted"] = "shallow_cover"
            used.add(i)
        inv[k] = min(pipes[i]["z_up"] for i in outs_of[k])
    log(f"Cài {total} cống chôn nông tại {len(chosen)} hố ga đầu nhánh")
    # (c) cống nâng cấp D800 → D1200
    cands = [i for i in main_pipes if i not in used and pipes[i]["D"] == 800
             and rim[pipes[i]["from"]] - pipes[i]["z_up"] >= 2.1 and rim[pipes[i]["to"]] - pipes[i]["z_dn"] >= 2.1]
    upgrade_idx = RNG.choice(cands)
    used.add(upgrade_idx)
    pipes[upgrade_idx]["planted"] = "upgrade"
    # (d) 3 cống bị công trình ngầm cắt ngang (va chạm 3D)
    cands = [i for i in main_pipes if i not in used and pipes[i]["L"] > 35
             and 0.9 <= (ground(*((np.array([net.nodes[pipes[i]["from"]]["x"], net.nodes[pipes[i]["from"]]["y"]]) +
                                   np.array([net.nodes[pipes[i]["to"]]["x"], net.nodes[pipes[i]["to"]]["y"]])) / 2))
                         - ((pipes[i]["z_up"] + pipes[i]["z_dn"]) / 2 + pipes[i]["D"] / 1000 + 0.25)) <= 1.8]
    clash_idx = RNG.sample(cands, 3)
    for i in clash_idx:
        pipes[i]["planted"] = "clash"
        used.add(i)

    # Nối bậc (drop) ở hố ga hạ lưu để độ dốc cống không vượt 0,3%
    for p in pipes:
        if p.get("planted") == "reverse_slope" or p.get("inlet"):
            continue
        p["z_dn"] = max(p["z_dn"], p["z_up"] - 0.003 * p["L"])

    # ---------------- materials ----------------
    cur.executemany("insert into pipe_materials (code, name, manning_n) values (%s,%s,%s)", MATERIALS)

    # ---------------- thời gian lắp đặt ----------------
    def install_date(year: int) -> datetime:
        return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=RNG.randint(0, 360))

    for i, p in enumerate(pipes):
        if p.get("planted") == "upgrade":
            p["year"] = 2008
        else:
            dd = design["dist"].get(p["to"], 0)
            p["year"] = max(1996, min(2024, int(1996 + dd / 900 * 24 + RNG.randint(-3, 4))))
        p["vf"] = install_date(p["year"])
        p["tx"] = min(p["vf"] + timedelta(days=RNG.randint(20, 300)), NOW - timedelta(days=30))
        p["mat"] = "BTCT" if p["D"] >= 1000 else ("GACH" if p["year"] < 2002 and RNG.random() < 0.5 else RNG.choice(["BTCT", "HDPE"]))
    node_vf = {}
    for p in pipes:
        for k in (p["from"], p["to"]):
            node_vf[k] = min(node_vf.get(k, p["vf"]), p["vf"])

    # ---------------- manholes ----------------
    log(f"Hố ga: {len(net.nodes)}, cống: {len(pipes)}")
    node_id = {}
    counters = defaultdict(int)
    rows = []
    for idx, k in enumerate(net.nodes, start=1):
        nd = net.nodes[k]
        kind = "outfall" if k in design["outfalls"] else "inlet" if nd.get("inlet") else "manhole"
        zone = "A" if nd["x"] < ZONE_SPLIT_X else "B"
        counters[(kind, zone)] += 1
        code = {"outfall": f"CX-{zone}{counters[(kind, zone)]}", "inlet": f"HT-{zone}{counters[(kind, zone)]:02d}",
                "manhole": f"HG-{zone}{counters[(kind, zone)]:03d}"}[kind]
        dm = design["dmax"].get(k, 600)
        diam = 0.6 if kind == "inlet" else 1.0 if dm <= 800 else 1.2 if dm <= 1200 else 1.5
        status = RNG.choices(["active", "maintenance", "damaged", "blocked"], [90, 5, 3, 2])[0]
        node_id[k] = idx
        vf = node_vf.get(k, datetime(2005, 1, 1, tzinfo=timezone.utc))
        rows.append((idx, code, kind, rim[k], round(inv[k], 3), diam, "BTCT", status, G.pz(nd["x"], nd["y"], rim[k]),
                     vf, vf + timedelta(days=RNG.randint(20, 200))))
    cur.executemany("""insert into manholes (id, code, kind, rim_elev_m, invert_elev_m, diameter_m, material, status, geom,
                                            valid_from, tx_from)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s),%s,%s)""", rows)
    cur.execute("select setval('manholes_id_seq', (select max(id) from manholes))")
    cur.execute("select public.build_manhole_csg(id) from manholes")

    # ---------------- pipes ----------------
    rows = []
    counters.clear()
    for i, p in enumerate(pipes, start=1):
        a, b = net.nodes[p["from"]], net.nodes[p["to"]]
        zone = "A" if (a["x"] + b["x"]) / 2 < ZONE_SPLIT_X else "B"
        counters[zone] += 1
        p["id"] = i
        p["code"] = f"C-{zone}{counters[zone]:03d}"
        D = 800 if p.get("planted") == "upgrade" else p["D"]
        status = RNG.choices(["active", "maintenance", "damaged", "blocked"], [88, 6, 4, 2])[0]
        rows.append((i, p["code"], node_id[p["from"]], node_id[p["to"]], D, p["mat"], p["year"], status,
                     G.lz([(a["x"], a["y"], p["z_up"]), (b["x"], b["y"], p["z_dn"])]), p["vf"], p["tx"]))
    cur.executemany("""insert into pipes (id, code, from_mh, to_mh, diameter_mm, material_code, install_year, status, geom,
                                         valid_from, tx_from)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s),%s,%s)""", rows)
    cur.execute("select setval('pipes_id_seq', (select max(id) from pipes))")
    conn.commit()

    # Nâng cấp D800 → D1200 (giao dịch riêng → versioning tạo lịch sử bitemporal)
    up = pipes[upgrade_idx]
    cur.execute("select set_config('app.seeding', 'on', false)")
    cur.execute("update pipes set diameter_mm = 1200, material_code = 'BTCT', valid_from = %s where id = %s and valid_to is null and tx_to is null",
                (datetime(2025, 6, 15, tzinfo=timezone.utc), up["id"]))
    conn.commit()
    log(f"Cống nâng cấp D800→D1200: {up['code']} (id={up['id']})")

    # ---------------- utilities ----------------
    util_rows = []
    owners = {"water": ["SAWACO"], "power": ["EVNHCMC"], "telecom": ["VNPT", "Viettel"]}
    # 3 tuyến cắt ngang cống đã chọn, khoảng hở 0,05–0,2 m
    for i, clr in zip(clash_idx, [0.05, 0.12, 0.2]):
        p = pipes[i]
        a, b = net.nodes[p["from"]], net.nodes[p["to"]]
        mx, my = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        L = math.hypot(dx, dy)
        nx_, ny_ = -dy / L, dx / L
        kind = RNG.choice(["water", "telecom", "power"])
        du = {"water": 300, "telecom": 150, "power": 200}[kind]
        zc = (p["z_up"] + p["z_dn"]) / 2 + p["D"] / 1000 + clr + du / 2000
        pts = [(mx + t * nx_, my + t * ny_, zc) for t in (-30, -10, 10, 30)]
        util_rows.append((kind, du, RNG.choice(owners[kind]), G.lz(pts)))
    # 17 tuyến dọc đường, lệch tim 5 m về bên trái, cách giao lộ ≥ 15 m
    segs = []
    noded = unary_union(street_lines)
    for seg in getattr(noded, "geoms", [noded]):
        if seg.length > 120:
            segs.append(seg)
    laterals = [LineString([(net.nodes[k]["x"], net.nodes[k]["y"]), (net.nodes[h]["x"], net.nodes[h]["y"])]) for k, h in inlets]
    n_util = 0
    for seg in RNG.sample(segs, len(segs)):
        if n_util >= 17:
            break
        sub = LineString([seg.interpolate(d) for d in np.linspace(15, seg.length - 15, max(3, int(seg.length / 20)))])
        off = sub.offset_curve(5.0)
        if any(off.distance(l) < 3.0 for l in laterals):   # tránh cắt nhánh hố thu
            continue
        n_util += 1
        kind = RNG.choice(["water", "power", "telecom"])
        du = {"water": RNG.choice([150, 200, 300]), "power": RNG.choice([100, 160]), "telecom": RNG.choice([100, 110])}[kind]
        depth = RNG.uniform(0.8, 1.3)
        pts = [(x, y, ground(x, y) - depth) for x, y in off.coords]
        util_rows.append((kind, du, RNG.choice(owners[kind]), G.lz(pts)))
    cur.executemany("""insert into utilities (kind, diameter_mm, owner, geom, valid_from, tx_from)
                       values (%s,%s,%s,ST_GeomFromEWKT(%s), now() - interval '6 years', now() - interval '5 years')""", util_rows)

    # ---------------- buildings ----------------
    blds = osm_buildings(osm, to_local, street_lines) if osm else []
    INFO["buildings"] = "OSM" if len(blds) >= 100 else "MOCK"
    if len(blds) < 100:
        blds = gen_buildings_mock(street_lines, 500)
    src = "osm" if INFO["buildings"] == "OSM" else "mock"
    for b in blds:
        c = b["poly"].centroid
        b["base"] = round(ground(c.x, c.y) + RNG.uniform(0.1, 0.5), 3)
        b["height"] = round(b["floors"] * 3.4 + 0.5, 2)
        vf = datetime(b["year"], 6, 1, tzinfo=timezone.utc)
        cur.execute("""insert into buildings (name, floors, height_m, base_elev_m, has_basement, year_built, source, geom,
                                             valid_from, tx_from)
                       values (%s,%s,%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s),%s,%s) returning id""",
                    (b["name"], b["floors"], b["height"], b["base"], b["basement"], b["year"], src, G.poly(b["poly"]),
                     vf, max(vf, datetime(2019, 1, 1, tzinfo=timezone.utc))))
        bid = cur.fetchone()[0]
        lod2 = b["floors"] <= 3 and RNG.random() < 0.4
        cur.executemany("insert into building_surface (building_id, type, lod, geom) values (%s,%s,%s,ST_GeomFromEWKT(%s))",
                        [(bid, t, lod, G.polyz(pts)) for t, lod, pts in surfaces(b["poly"], b["base"], b["height"], lod2)])

    # ---------------- inspections & defects ----------------
    two_years = NOW - timedelta(days=730)
    insp_pipes = RNG.sample([p for p in pipes if not p.get("inlet")], 120)
    n_def_target = 300
    insp_rows = []
    for p in insp_pipes:
        insp_rows.append((p["id"], rand_dt(two_years, NOW - timedelta(days=3)), RNG.choices([1, 2, 3, 4, 5], [25, 30, 25, 13, 7])[0],
                          RNG.choice(["Tổ CCTV 1", "Tổ CCTV 2"]), p))
    insp_ids = []
    for pid, at, grade, who, p in insp_rows:
        cur.execute("insert into inspections (pipe_id, inspected_at, grade, inspector) values (%s,%s,%s,%s) returning id",
                    (pid, at, grade, who))
        insp_ids.append((cur.fetchone()[0], grade, p))
    weights = [g for _, g, _ in insp_ids]
    def_rows = []
    for _ in range(n_def_target):
        iid, grade, p = RNG.choices(insp_ids, weights)[0]
        typ = RNG.choices(["crack", "root", "deposit", "collapse"], [40, 20, 32, 8])[0]
        sev = max(1, min(5, grade + RNG.choice([-1, 0, 0, 1]) + (1 if typ == "collapse" else 0)))
        def_rows.append((iid, round(RNG.uniform(0.5, p["L"] - 0.5), 2), typ, sev))
    cur.executemany("insert into defects (inspection_id, chainage_m, type, severity) values (%s,%s,%s,%s)", def_rows)

    # ---------------- flood points (vị trí theo mô tả báo chí, tọa độ xấp xỉ) ----------------
    def gsearch(q):
        return "https://www.google.com/search?q=" + urllib.parse.quote(q)
    floods = [
        ("Võ Văn Ngân – trước chợ Thủ Đức", 45, (115, -5), datetime(2025, 9, 23, 17, 30, tzinfo=timezone.utc)),
        ("Kha Vạn Cân – giao Võ Văn Ngân", 40, (-96, 6), datetime(2025, 8, 12, 16, 0, tzinfo=timezone.utc)),
        ("Đặng Văn Bi", 35, (150, -386), datetime(2024, 10, 2, 18, 15, tzinfo=timezone.utc)),
        ("Tô Ngọc Vân – đoạn gần Võ Văn Ngân", 30, (376, 40), datetime(2024, 9, 18, 17, 0, tzinfo=timezone.utc)),
        ("Dương Văn Cam", 25, (-30, 436), datetime(2023, 10, 5, 16, 45, tzinfo=timezone.utc)),
        ("Hẻm quanh chợ Thủ Đức", 50, (115, 146), datetime(2025, 10, 20, 15, 30, tzinfo=timezone.utc)),
    ]
    cur.executemany("""insert into flood_points (name, max_depth_cm, source_url, occurred_at, note, geom)
                       values (%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s))""",
                    [(n, d, gsearch(f"ngập {n.split(' – ')[0]} Thủ Đức"), t,
                      "Điểm ngập được báo chí nhắc tới; tọa độ & độ sâu xấp xỉ (cần đối chiếu bài báo gốc)", G.p(*xy))
                     for n, d, xy, t in floods])

    # ---------------- rain scenarios ----------------
    cur.executemany("insert into rain_scenarios (name, intensity_mm_h, water_level_m, duration_min) values (%s,%s,%s,%s)",
                    [("Mưa vừa – 50 mm/h", 50, 1.20, 60), ("Mưa lớn – 80 mm/h", 80, 1.60, 90),
                     ("Mưa cực đoan – 120 mm/h", 120, 2.10, 120)])

    # ---------------- obs stations + water_obs (3 tháng, 15 phút/lần) ----------------
    cur.executemany("insert into obs_stations (id, name, geom) values (%s,%s,ST_GeomFromEWKT(%s))",
                    [("TD01", "Trạm chợ Thủ Đức (mock)", G.p(110, 6)), ("TD02", "Trạm Tô Ngọc Vân (mock)", G.p(375, -300))])
    start = (NOW - timedelta(days=92)).replace(hour=0, minute=0, second=0)
    steps = 92 * 96
    storms = []
    t_days = 0.0
    while t_days < 92:
        t_days += RNG.expovariate(1 / 2.2)
        hour = RNG.gauss(16.5, 1.5)
        storms.append((math.floor(t_days) * 96 + int(hour * 4), RNG.choice([20, 35, 50, 70, 90, 120]) * RNG.uniform(0.6, 1.0),
                       RNG.randint(3, 10)))
    obs_rows = []
    for sid, scale, lag in (("TD01", 1.0, 0), ("TD02", 0.8, 2)):
        rain = np.zeros(steps)
        for st, inten, dur in storms:
            for j in range(dur):
                if 0 <= st + j < steps:
                    rain[st + j] += inten / 4 * math.sin(math.pi * (j + 0.5) / dur) * scale
        store = 0.0
        for j in range(steps):
            t = start + timedelta(minutes=15 * j)
            tide = 0.25 * math.sin(2 * math.pi * (j / 4) / 12.42) + 0.08 * math.sin(2 * math.pi * (j / 4) / 24)
            store = store * 0.93 + rain[max(0, j - lag)] * 0.022
            lvl = 0.55 + tide + store
            obs_rows.append((sid, t, round(float(rain[j]), 2), round(lvl, 3)))
    with cur.copy("copy water_obs (station_id, ts, rain_mm, water_level_m) from stdin") as cp:
        for r in obs_rows:
            cp.write_row(r)

    # ---------------- users ----------------
    users = [("admin@demo.vn", "Quản trị viên", "admin", []), ("tech1@demo.vn", "Kỹ thuật viên 1", "technician", ["Zone A – Tây"]),
             ("tech2@demo.vn", "Kỹ thuật viên 2", "technician", ["Zone B – Đông"]), ("dan@demo.vn", "Người dân", "citizen", [])]
    uid = {}
    for email, name, role, zones in users:
        cur.execute("""insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                         confirmation_token, email_change, email_change_token_new, recovery_token)
                       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
                         %s, crypt(%s, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', %s, now(), now(),
                         '', '', '', '') returning id""", (email, DEMO_PASSWORD, json.dumps({"full_name": name})))
        u = cur.fetchone()[0]
        uid[email] = u
        cur.execute("""insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
                       values (gen_random_uuid(), %s, %s, %s, 'email', now(), now(), now())""",
                    (u, str(u), json.dumps({"sub": str(u), "email": email, "email_verified": True})))
        cur.execute("update profiles set role = %s, full_name = %s where id = %s", (role, name, u))
        for z in zones:
            cur.execute("insert into user_zones (user_id, zone_id) select %s, id from zones where name = %s", (u, z))

    # ---------------- incident reports ----------------
    inc_rows = []
    kinds = ["blocked", "overflow", "broken_cover", "odor", "subsidence", "other"]
    notes = {"blocked": "Hố ga bị rác chặn", "overflow": "Nước trào lên từ hố ga", "broken_cover": "Nắp hố ga bị vỡ",
             "odor": "Mùi hôi nặng", "subsidence": "Lún mặt đường gần hố ga", "other": "Sự cố khác"}
    main_nodes = [k for k in net.nodes if not net.nodes[k].get("inlet")]
    for j in range(150):
        k = RNG.choice(main_nodes)
        x, y = net.nodes[k]["x"] + RNG.uniform(-12, 12), net.nodes[k]["y"] + RNG.uniform(-12, 12)
        if abs(x - ZONE_SPLIT_X) < 1:
            x += 3
        kind = RNG.choices(kinds, [30, 25, 15, 12, 8, 10])[0]
        created = rand_dt(NOW - timedelta(days=540), NOW - timedelta(hours=2))
        tech = uid["tech1@demo.vn"] if x < ZONE_SPLIT_X else uid["tech2@demo.vn"]
        slow = 1.6 if x >= ZONE_SPLIT_X else 1.0                      # zone B phản hồi chậm hơn (để Q10 có khác biệt)
        r = RNG.random() if created < NOW - timedelta(days=3) else RNG.random() * 0.3
        status = "resolved" if r > 0.3 else "in_progress" if r > 0.2 else "accepted" if r > 0.1 else "new"
        acc = arr = res = None
        if status != "new":
            acc = created + timedelta(minutes=RNG.uniform(8, 180) * slow)
        if status in ("in_progress", "resolved"):
            arr = acc + timedelta(minutes=RNG.uniform(15, 90) * slow)
        if status == "resolved":
            res = arr + timedelta(hours=RNG.uniform(0.5, 30) * slow)
        inc_rows.append((uid["dan@demo.vn"], kind, notes[kind], status, tech if status != "new" else None,
                         G.p(x, y), created, acc, arr, res))
    cur.executemany("""insert into incident_reports (user_id, kind, note, status, technician_id, geom, created_at,
                                                    accepted_at, arrived_at, resolved_at)
                       values (%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s),%s,%s,%s,%s)""", inc_rows)

    # ---------------- asset events (~500, 2 năm) ----------------
    ev = []
    cur.execute("select pipe_id, inspected_at, grade, id from inspections")
    for pid, at, grade, iid in cur.fetchall():
        ev.append(("pipe", pid, "inspect", json.dumps({"inspection_id": iid, "grade": grade}), at))
    cur.execute("""select manhole_id, resolved_at, id, kind from incident_reports
                   where status = 'resolved' and manhole_id is not null""")
    for mid, at, iid, kind in cur.fetchall():
        ev.append(("manhole", mid, "incident", json.dumps({"incident_id": iid, "kind": kind}), at))
    mh_ids = list(node_id.values())
    for _ in range(500 - len(ev) - 70):
        ev.append(("manhole", RNG.choice(mh_ids), "clean", json.dumps({"crew": RNG.choice(["Đội nạo vét 1", "Đội nạo vét 2"]),
                   "volume_m3": round(RNG.uniform(0.2, 3), 2)}), rand_dt(two_years, NOW)))
    for _ in range(60):
        typ = RNG.choice(["pipe", "manhole"])
        ev.append((typ, RNG.choice([p["id"] for p in pipes]) if typ == "pipe" else RNG.choice(mh_ids), "repair",
                   json.dumps({"work": RNG.choice(["Thay nắp", "Trám vết nứt", "Gia cố thành hố", "Sửa cổ ống"])}),
                   rand_dt(two_years, NOW)))
    for _ in range(9):
        ev.append(("pipe", RNG.choice([p["id"] for p in pipes]), "replace", json.dumps({"work": "Thay đoạn ống hư hỏng"}),
                   rand_dt(two_years, NOW)))
    cur.executemany("""insert into asset_events (asset_type, asset_id, event_type, detail, valid_time, tx_time)
                       values (%s,%s,%s,%s,%s, %s + interval '1 day' * (random() * 3))""",
                    [(a, b, c, d, e, e) for a, b, c, d, e in ev])
    conn.commit()

    # ---------------- kiểm tra nhanh ----------------
    cur.execute("select set_config('app.seeding', 'off', false)")
    summary = {}
    for t in ["terrain_points", "terrain_tin", "buildings", "building_surface", "pipe_materials", "manholes", "csg_node",
              "pipes", "utilities", "inspections", "defects", "flood_points", "rain_scenarios", "water_obs",
              "incident_reports", "asset_events", "profiles", "zones"]:
        cur.execute(f"select count(*) from {t}")
        summary[t] = cur.fetchone()[0]
    cur.execute("select count(*) from manholes where valid_to is null and tx_to is null")
    summary["manholes (hiện hành)"] = cur.fetchone()[0]
    cur.execute("select count(*) from pipes where valid_to is null and tx_to is null")
    summary["pipes (hiện hành)"] = cur.fetchone()[0]
    cur.execute("select count(*) from manholes where kind='outfall'")
    summary["cửa xả"] = cur.fetchone()[0]
    for k, v in summary.items():
        log(f"  {k:24s} {v}")
    log("Nguồn dữ liệu: " + "; ".join(f"{k}: {v}" for k, v in INFO.items()))
    conn.close()


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as e:
        print(f"[seed] LỖI CSDL: {e}", file=sys.stderr)
        sys.exit(1)
