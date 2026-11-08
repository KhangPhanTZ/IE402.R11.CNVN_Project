# Tài liệu thiết kế – HTTT 3D mạng cống thoát nước khu chợ Thủ Đức

Phần báo cáo chi tiết của đồ án IE402 (README chỉ giữ hướng dẫn nhanh).

## 1. Năm tính chất của HTTT → chức năng

| Tính chất | Chức năng cụ thể trong hệ thống |
|---|---|
| **Lưu trữ** | PostGIS 3D: `PointZ` (hố ga), `LineStringZ` (cống, công trình ngầm), `PolygonZ` (TIN, bề mặt B-Rep); hệ EPSG:32648; index GIST mọi cột `geom` (+ index N chiều cho va chạm 3D); bảng lưỡng thời gian (`valid_from/valid_to`, `tx_from/tx_to`); chuỗi thời gian `water_obs` (PK B-tree `(station_id, ts)`); bảng sự kiện `asset_events`; danh mục `pipe_materials` chuẩn hóa 3NF. |
| **Truyền tải** | Mọi phân tích là hàm RPC (`supabase.rpc`) trả GeoJSON EPSG:4326; Realtime phát INSERT/UPDATE `incident_reports` → toast cho kỹ thuật viên; xuất GeoJSON/CSV (trang Admin và bảng kết quả phân tích); ảnh sự cố qua Supabase Storage + signed URL. |
| **Chỉnh sửa / cập nhật** | Thêm hố ga bằng click (cao độ nắp nội suy TIN, tự sinh cây CSG); thêm cống bằng chọn 2 hố ga; sửa/xóa thuộc tính. Trigger `pipe_topology` (≤ 0,5 m, cao độ trong lòng hố ga, tự tính invert/length/slope), `manhole_topology` (không làm "hở" cống), `versioning` (đóng bản cũ, chèn bản mới), ghi `asset_events`. Quy trình sự cố: báo → nhận → đến → xong. |
| **Trực quan** | Cesium 3D: nhìn xuyên đất (`globe.translucency` + thanh trượt, tắt collision camera), terrain tùy biến dựng từ TIN, ống `PolylineVolume` đường kính thật, khối hố ga từ CSG, nhà extrude LOD1 + B-Rep LOD2 theo yêu cầu, LOD switching bằng `distanceDisplayCondition`, mặt nước dâng theo thanh trượt, tô màu theo kết quả phân tích, biểu đồ mặt cắt dọc, popup 3 tab NN/KG/TG. |
| **An ninh / bảo mật** | Supabase Auth (email/mật khẩu); `profiles.role`; RLS theo vai trò **và theo khu phụ trách** (`ST_Within(geom, zone)` qua `user_zones`); citizen chỉ thấy báo cáo của mình; anon chỉ đọc view `public_pipes`/`public_manholes` (không cao độ đáy, không độ dốc) và điểm ngập; trigger chặn tự nâng quyền; policy Storage theo thư mục `<uid>/`; `audit_log` (actor = `auth.uid()`) chỉ admin đọc. |

---

## 2. Đối tượng → Ngữ nghĩa / Không gian / Thời gian

Popup trên bản đồ chia đúng 3 tab **NN / KG / TG**.

| Đối tượng | Ngữ nghĩa (NN) | Không gian (KG) | Thời gian (TG) |
|---|---|---|---|
| Hố ga `manholes` | mã, loại (manhole/inlet/outfall), vật liệu, trạng thái, đường kính | `PointZ` (Z = cao độ nắp), `rim_elev_m`, `invert_elev_m`; khối 3D từ cây `csg_node` | `valid_from/to`, `tx_from/to` (bitemporal, versioning), `asset_events` |
| Cống `pipes` | mã, D, vật liệu (FK → Manning n), năm lắp, trạng thái, sức chứa | `LineStringZ` (Z = invert), `from_mh → to_mh` (Node–Arc, hướng dòng), `length_m` = ST_3DLength, `slope` | bitemporal + lịch sử phiên bản (ví dụ nâng cấp D800 → D1200) + sự kiện, kiểm tra CCTV |
| Lỗi lòng cống `defects` | loại, mức độ, cấp kiểm tra | `chainage_m` → điểm 3D bằng `ST_LineInterpolatePoint` | `inspected_at` |
| Công trình `buildings` + `building_surface` | tên, số tầng, tầng hầm, năm xây | `Polygon` + B-Rep `PolygonZ` Ground/Wall/Roof (SUDM, LOD1–2), `base_elev_m`, `height_m` | `valid_from/to`, `tx_from/to`, `year_built` |
| Địa hình `terrain_points` / `terrain_tin` | nguồn dữ liệu | `PointZ` / tam giác `PolygonZ` (ST_DelaunayTriangles) | (trạng thái tĩnh) |
| Công trình ngầm `utilities` | loại (nước/điện/viễn thông), D, chủ quản | `LineStringZ` (tim ống) | bitemporal |
| Điểm ngập `flood_points` | tên, độ sâu, nguồn | `Point` | `occurred_at` |
| Quan trắc `water_obs` | mưa, mực nước | trạm `obs_stations` (`Point`), chọn trạm gần nhất bằng KNN | chuỗi thời gian 15 phút |
| Sự cố `incident_reports` | loại, ghi chú, ảnh, trạng thái, KTV | `Point`, hố ga gần nhất (KNN), khu (ST_Within) | `created_at → accepted_at → arrived_at → resolved_at` |
| Sự kiện `asset_events` | loại sự kiện, chi tiết jsonb, actor | gắn tài sản (asset_type, asset_id) | `valid_time` + `tx_time` |

---

## 3. Lựa chọn mô hình V3D (lai) – theo quy trình 4 bước (Chương 6)

**Bước 1 – Xác định yêu cầu nghiệp vụ và đối tượng.** Bài toán cần: (i) biết cao độ mặt đất để tính độ sâu chôn ống, mặt cắt dọc, mực nước tràn; (ii) truy vết dòng chảy theo hướng trên mạng; (iii) biết nhà nào có tầng hầm / nền thấp để đánh giá rủi ro ngập; (iv) hình dạng hố ga để hiển thị và kiểm tra trực quan; (v) trạng thái mạng theo thời gian (nâng cấp, sự cố). Vì vậy 3D là bắt buộc: các truy vấn Q2 (lớp phủ), Q3 (va chạm 3D), Q5/Q6 (so cao độ với mực nước), Q11 (mặt cắt dọc), Q12 (định vị lỗi trên ống 3D) đều dùng Z.

**Bước 2 – Chọn mô hình hình học cho từng lớp:**

| Lớp | Mô hình | Lý do chọn |
|---|---|---|
| Địa hình | **TIN** (`ST_DelaunayTriangles` → `PolygonZ`) | Nội suy tuyến tính chính xác tại mọi điểm (`tin_elev()` dùng tọa độ barycentric) cho cao độ nắp, mặt cắt dọc; ít dữ liệu hơn Grid với địa hình "lòng chảo" thoải. |
| Hạ tầng mạng | **Node–Arc 3D** (hố ga `PointZ`, cống `LineStringZ`, `from_mh/to_mh`) | Topology tường minh cho truy vết `WITH RECURSIVE` (Q4), định tuyến lưu lượng (Q8); hướng dòng = hướng arc. |
| Công trình | **B-Rep theo SUDM** (Ground/Wall/Roof, LOD1–2) | Mô hình bề mặt đơn giản, đủ cho đánh giá ngập (cao độ nền, tầng hầm) và hiển thị; LOD1 extrude cho toàn khu, LOD2 mái dốc cho một phần nhà thấp tầng. |
| Hố ga | **CSG** (`union(difference(trụ ngoài, trụ trong), nắp)`, tham số trong `csg_node.params`) | Hố ga là vật thể chuẩn hóa, mô tả gọn bằng vài tham số; frontend làm **boundary evaluation** (phân loại điểm trên lưới (r, z) rồi quay quanh trục) để sinh lưới tam giác hiển thị. |
| Thời gian | **Event-based + bitemporal** | `asset_events` ghi mọi thay đổi trạng thái; `valid_*` (thời gian thực tế) và `tx_*` (thời gian ghi CSDL) cho phép Q9 trả lời "mạng như thế nào tại ngày T, theo hiểu biết của CSDL tại ngày T′". |

**Bước 3 – Tích hợp thành mô hình lai V3D.** Các lớp liên kết với nhau qua không gian và thuộc tính: cao độ nắp hố ga = nội suy TIN; hố ga ↔ cây CSG (`csg_node.manhole_id`); cống ↔ hố ga (Node–Arc + trigger topology); nhà ↔ hố ga tràn (ST_DWithin 30 m); sự cố ↔ hố ga gần nhất (KNN) ↔ khu (ST_Within); mọi tài sản ↔ sự kiện. Ràng buộc toàn vẹn được đặt trong CSDL (trigger), không chỉ ở giao diện.

**Bước 4 – Cài đặt và kiểm chứng trên DBMS.** PostGIS (EPSG:32648, index GIST/ND), trigger topology/versioning/audit, RLS; 12 hàm phân tích SECURITY INVOKER; kiểm chứng bằng `scripts/test_topology.sql`, `scripts/test_rpc.ts` và dữ liệu demo có cài sẵn lỗi.

> Ghi chú: phần trình bày 4 bước ở trên là cách diễn giải của nhóm theo nội dung Chương 6 (yêu cầu → mô hình từng lớp → tích hợp → cài đặt), cần đối chiếu lại thuật ngữ đúng theo slide bài giảng.

---

## 4. Truy vấn không gian (mỗi truy vấn = 1 hàm RPC + 1 nút trên UI)

| # | Hàm RPC | Kỹ thuật PostGIS |
|---|---|---|
| Q1 | `q1_reverse_slope(p_threshold)` | `slope ≤ 0,0005` (slope tự tính từ Z) |
| Q2 | `q2_shallow_cover(p_min_cover)` | cover = nắp − đáy − D tại 2 đầu cống |
| Q3 | `q3_clash_3d(p_min_clearance)` | `ST_3DDWithin` (index ND) + `ST_3DDistance` − bán kính, `ST_3DClosestPoint` |
| Q4 | `trace_upstream` / `trace_downstream` (`q4_trace`) | `WITH RECURSIVE` trên Node–Arc |
| Q5 | `q5_overflow(p_scenario_id, p_water_level, p_at)` | `rim < mực nước`; với `p_at` lấy trạm gần nhất (KNN) và bản ghi ≤ T |
| Q6 | `q6_basement_risk(...)` | `ST_DWithin(nhà, hố ga tràn, 30)` hoặc `base_elev < mực nước` |
| Q7 | `q7_nearest_manhole(p_source, p_lon, p_lat, p_k)` | KNN `ORDER BY geom <-> …` (index GIST) |
| Q8 | `q8_overload(p_intensity_mm_h, p_scenario_id, p_c)` | `ST_VoronoiPolygons` ∩ phạm vi → A; Q = C·i·A/3,6e6; định tuyến đệ quy; so `manning_capacity()` |
| Q9 | `q9_as_of_date(p_date, p_tx)` | lọc bitemporal + lịch sử sự kiện |
| Q10 | `q10_incident_sla(p_from, p_to)` | `ST_Within(sự cố, zone)`, trung bình/P90 |
| Q11 | `q11_pipe_profile(p_from_mh, p_to_mh, p_step_m)` | đi theo hạ lưu, `ST_LineInterpolatePoint` + `tin_elev()` |
| Q12 | `q12_defect_points(p_pipe_id, p_min_severity)` | `ST_LineInterpolatePoint(geom, chainage/length)` |

Ngoài ra: các hàm lớp dữ liệu (`layer_*`), `asset_history`, CRUD (`create_manhole`, `update_manhole`, `create_pipe`, `update_pipe`, `delete_asset`), sự cố (`create_incident`, `incident_accept/arrive/resolve`), quản trị (`admin_*`), `manning_capacity(d_mm, slope, n)`, `tin_elev(geom)`.

---

## 5. Dữ liệu: thật hay mock?

| Dữ liệu | Nguồn | Ghi chú |
|---|---|---|
| Tâm khu vực | **Thật** – Nominatim (chợ Thủ Đức, OSM way 499426667) | Lưu trong `scripts/data/osm_thuduc.json`. |
| Đường | **Thật** – OSM/Overpass (tải ngày 08/11/2026, lưu cache `scripts/data/osm_thuduc.json`) | Mạng cống đặt dọc tim các đường OSM: Võ Văn Ngân, Kha Vạn Cân, Tô Ngọc Vân, Đặng Văn Bi, Dương Văn Cam, Hồ Văn Tư, Chương Dương, Lê Văn Ninh, các đường số và hẻm… (≈ 9,4 km). |
| Nhà | **Hình dạng thật** – 500 footprint OSM gần chợ nhất + đa giác chợ Thủ Đức | Số tầng lấy từ `building:levels` nếu có, nếu không thì **giả định**; tầng hầm, năm xây là **mock**. |
| Địa hình | **MOCK** | ~800 điểm dạng lòng chảo (+0,8 m tại chợ → +3…+5 m ra ngoài); không phải DEM thật. |
| Mạng cống, hố ga, CSG, công trình ngầm, kiểm tra, lỗi, sự cố, sự kiện, quan trắc | **MOCK** (sinh có quy luật thủy lực trên đường thật) | Hướng dòng theo khoảng cách mạng tới cửa xả; D chọn theo lưu vực Voronoi; dốc 0,1–0,3%; chôn sâu ≥ 1,5 m (+ D + 0,9 m); nơi mặt đất dốc ngược hướng dòng thì hạ sâu về hạ lưu. **Không phải bản vẽ hoàn công thật** của mạng thoát nước Thủ Đức. |
| Điểm ngập (6) | Tên đường/khu vực **được báo chí nhắc tới là điểm ngập**; vị trí đặt lên đúng tuyến đường OSM theo tên (giao lộ nếu có 2 tên); **độ sâu, ngày là xấp xỉ** | `source_url` hiện là **liên kết tìm kiếm**, không phải bài báo cụ thể – cần thay bằng URL bài báo đã kiểm chứng trước khi nộp. |
| Kịch bản mưa | Giả định (50/80/120 mm/h → mực nước 1,2/1,6/2,1 m) | |

Dữ liệu OSM © OpenStreetMap contributors, giấy phép ODbL 1.0. Seed đọc cache `scripts/data/osm_thuduc.json` (chạy được không cần mạng); tải lại từ Overpass bằng `OSM_REFRESH=1`, ép sinh dữ liệu mock bằng `SEED_OFFLINE=1` và xoá/đổi tên file cache.

Số bản ghi sau khi seed (bản hiện tại): terrain_points 800 · terrain_tin 1 566 · buildings 500 (100 có tầng hầm) · building_surface 3 607 · pipe_materials 3 · **manholes 221 hiện hành (3 cửa xả, 15 hố thu)** · csg_node 1 105 · **pipes 226 hiện hành** (+2 bản lịch sử) · utilities 20 · inspections 120 · defects 300 · flood_points 6 · rain_scenarios 3 · water_obs 17 664 (92 ngày × 96 × 2 trạm) · incident_reports 150 · asset_events 500.

**Lỗi cài sẵn để demo** (đã kiểm chứng bằng `test_rpc.ts`): 3 cống dốc ngược/bằng (Q1), 3 cống chôn nông (Q2), 3 điểm va chạm với công trình ngầm (Q3), 1 cống nâng cấp D800 → D1200 từ 15/06/2025 (Q9, tab TG có 3 phiên bản).

---

## 6. ERD

```mermaid
erDiagram
  auth_users ||--|| profiles : "id"
  profiles ||--o{ user_zones : ""
  zones ||--o{ user_zones : ""
  profiles ||--o{ incident_reports : "user_id"
  profiles ||--o{ incident_reports : "technician_id"
  manholes ||--o{ csg_node : "manhole_id (id logic)"
  csg_node ||--o{ csg_node : "parent_id"
  manholes ||--o{ pipes : "from_mh"
  manholes ||--o{ pipes : "to_mh"
  pipe_materials ||--o{ pipes : "material_code"
  pipes ||--o{ inspections : "pipe_id (id logic)"
  inspections ||--o{ defects : ""
  buildings ||--o{ building_surface : ""
  obs_stations ||--o{ water_obs : "station_id"
  manholes ||--o{ incident_reports : "manhole_id (KNN)"
  manholes ||--o{ asset_events : "asset_type=manhole"
  pipes ||--o{ asset_events : "asset_type=pipe"

  profiles { uuid id PK; user_role role; text full_name }
  zones { int id PK; text name; Polygon geom }
  user_zones { uuid user_id PK; int zone_id PK }
  terrain_points { int id PK; PointZ geom }
  terrain_tin { int id PK; PolygonZ geom }
  buildings { int id PK; text name; int floors; numeric height_m; numeric base_elev_m; bool has_basement; int year_built; Polygon geom; timestamptz valid_from; timestamptz valid_to; timestamptz tx_from; timestamptz tx_to }
  building_surface { int id PK; int building_id FK; surface_type type; int lod; PolygonZ geom }
  pipe_materials { text code PK; text name; numeric manning_n }
  manholes { bigint vid PK; bigint id; text code; manhole_kind kind; numeric rim_elev_m; numeric invert_elev_m; numeric diameter_m; asset_status status; PointZ geom; timestamptz valid_from; timestamptz valid_to; timestamptz tx_from; timestamptz tx_to; uuid created_by }
  csg_node { int id PK; bigint manhole_id; int parent_id FK; int ord; csg_op op; csg_primitive primitive; jsonb params }
  pipes { bigint vid PK; bigint id; text code; bigint from_mh; bigint to_mh; int diameter_mm; text material_code FK; numeric up_invert_m; numeric down_invert_m; numeric length_m; numeric slope; int install_year; LineStringZ geom; timestamptz valid_from; timestamptz valid_to; timestamptz tx_from; timestamptz tx_to }
  utilities { int id PK; utility_kind kind; int diameter_mm; text owner; LineStringZ geom }
  inspections { int id PK; bigint pipe_id; timestamptz inspected_at; int grade }
  defects { int id PK; int inspection_id FK; numeric chainage_m; defect_type type; int severity }
  flood_points { int id PK; text name; int max_depth_cm; text source_url; timestamptz occurred_at; Point geom }
  rain_scenarios { int id PK; text name; numeric intensity_mm_h; numeric water_level_m }
  obs_stations { text id PK; text name; Point geom }
  water_obs { text station_id PK; timestamptz ts PK; numeric rain_mm; numeric water_level_m }
  incident_reports { bigint id PK; uuid user_id FK; incident_kind kind; text image_path; incident_status status; bigint manhole_id; uuid technician_id FK; Point geom; timestamptz created_at; timestamptz accepted_at; timestamptz arrived_at; timestamptz resolved_at }
  asset_events { bigint id PK; text asset_type; bigint asset_id; event_type event_type; jsonb detail; timestamptz valid_time; timestamptz tx_time; uuid actor }
  audit_log { bigint id PK; text tbl; text row_id; text action; jsonb old_data; jsonb new_data; uuid actor; timestamptz at }
```

Ghi chú thiết kế: `manholes`/`pipes` có khóa phiên bản `vid` và định danh logic `id`; unique index một phần `WHERE valid_to IS NULL AND tx_to IS NULL` đảm bảo mỗi `id`/`code` chỉ có một bản hiện hành. Vì `id` không duy nhất trên toàn bảng nên liên kết `from_mh/to_mh` được kiểm tra bằng trigger `pipe_topology` thay cho FK.

---

## 7. Bảo mật – tóm tắt RLS

- `is_role(text)`, `is_staff()`, `in_my_zone(geom)` (SECURITY DEFINER để tránh đệ quy RLS).
- `manholes`/`pipes`: SELECT cho technician/admin; INSERT/UPDATE/DELETE cho admin, hoặc technician khi `ST_Within(geom, zone phụ trách)`.
  Kiểm thử: tech1 (Zone A) cập nhật hố ga Zone B → **0 dòng bị ảnh hưởng**, RPC `update_manhole` trả lỗi `RLS: không có quyền…` (SQLSTATE 42501).
- `incident_reports`: citizen chỉ SELECT/INSERT dòng có `user_id = auth.uid()`; technician cập nhật sự cố chưa ai nhận hoặc do mình nhận; admin toàn quyền.
- anon: `REVOKE ALL` trên mọi bảng gốc → đọc `pipes` báo `permission denied for table pipes`; chỉ `SELECT` được `public_pipes`, `public_manholes`, `flood_points` và gọi `layer_public()`, `layer_flood_points()`.
- Storage `incident-images` (private): ghi vào thư mục `<auth.uid()>/…`; đọc được ảnh của mình hoặc nếu là technician/admin.
- `audit_log`: chỉ admin SELECT; ghi bằng trigger `audit()` (manholes, pipes, incident_reports, profiles).

---

## 8. EXPLAIN ANALYZE – KNN có và không có index GIST

Script: `scripts/explain_knn.sql` (kết quả thật trên Postgres 16 + PostGIS 3, máy phát triển).

**Bảng `manholes` (221 dòng hiện hành)** – có index:

```
Limit (actual time=0.087..0.090 rows=3 loops=1)
  ->  Index Scan using manholes_geom_gix on manholes (actual time=0.086..0.089 rows=3 loops=1)
        Order By: (geom <-> '...'::geometry)
        Filter: ((valid_to IS NULL) AND (tx_to IS NULL))
Execution Time: 0.107 ms
```

Không có index (DROP trong transaction rồi ROLLBACK):

```
Limit (actual time=0.091..0.092 rows=3 loops=1)
  ->  Sort  Sort Method: top-N heapsort  Memory: 25kB
        ->  Seq Scan on manholes (actual time=0.009..0.063 rows=207 loops=1)
Execution Time: 0.106 ms
```

Với 221 hố ga, hai cách tương đương, vì cả bảng nằm gọn trong 4 trang bộ nhớ.

**Bảng thử 200 000 điểm** (cùng phạm vi):

| | Kế hoạch | Thời gian thực thi |
|---|---|---|
| Không index | `Seq Scan` 200 000 dòng → `Sort (top-N heapsort)` | **73,8 ms** |
| Có index GIST | `Index Scan using knn_bench_geom_idx`, `Order By: geom <-> …` | **0,10 ms** |

Nhận xét: toán tử `<->` kết hợp `ORDER BY … LIMIT k` cho phép GIST duyệt cây theo khoảng cách (index-assisted KNN), không cần tính khoảng cách cho mọi dòng. Lợi ích thể hiện rõ khi dữ liệu lớn (≈ 700 lần ở 200k điểm).

---

## 9. Giao diện & design system

Phong cách "technical minimal" (nền sáng, dữ liệu là trung tâm), không dùng dark mode.

| Thành phần | Vị trí | Ghi chú |
|---|---|---|
| Token màu, bóng, bo góc | `src/index.css`, `tailwind.config.js` | Primary cyan 700 `#0e7490`; neutral slate; semantic success/warning/danger/info (nền nhạt + chữ đậm, đạt WCAG AA) |
| Thang chữ | `tailwind.config.js` | Inter; 12 / 13 / 14 / 16 / 18 / 22 px – tối thiểu 12 px |
| Màu bản đồ | `src/lib/theme.ts` | Một nguồn duy nhất: màu **trạng thái** (tông lạnh) ở chế độ thường, màu **phân tích** (tông nóng) khi có kết quả – phần còn lại bị làm mờ, nên hai hệ màu không lẫn nhau |
| Nhãn & đơn vị trường dữ liệu | `src/lib/fields.ts` | Bảng kết quả, popup, form không còn hiển thị tên cột CSDL |
| Diễn giải lỗi CSDL | `src/lib/errors.ts` | Lỗi topology / RLS / versioning có tiêu đề dễ hiểu, nguyên văn nằm trong "Chi tiết kỹ thuật" |
| Component | `src/components/ui/` | Button (có trạng thái loading), Badge, Field, Dialog/ConfirmDialog, Alert, EmptyState, Skeleton, Spinner, Tooltip, Dropdown |
| Khung ứng dụng | `src/components/Layout.tsx` | Rail điều hướng dọc (desktop), thanh tab đáy (mobile), menu tài khoản |
| Bảng lệnh ⌘K / Ctrl K | `src/components/CommandPalette.tsx` (cmdk) | Tìm hố ga/cống theo mã, bật/tắt lớp, đổi bản đồ nền, điều hướng |
| Bản đồ nền | `src/map/cesiumUtil.ts` (`BASEMAPS`) | Esri Light/Dark Gray Canvas (+ nhãn), Street Map, World Imagery, OSM – miễn phí kèm ghi nguồn |
| Điều khiển bản đồ | `src/map/MapControls.tsx`, `BasemapSwitcher.tsx` | Zoom, la bàn về hướng Bắc, chuyển 2D/3D, về toàn cảnh, toàn màn hình |
| Chuyển động | `motion` | Popup, bảng lệnh, bộ chọn nền, KPI đếm số |
