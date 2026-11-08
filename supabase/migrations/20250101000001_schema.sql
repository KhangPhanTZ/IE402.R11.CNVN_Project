-- =====================================================================
-- IE402 – HTTT địa lý 3D: mạng cống thoát nước & điểm ngập khu chợ Thủ Đức
-- Migration 1: extension, kiểu dữ liệu, bảng, index không gian
-- Hệ tọa độ lưu trữ: EPSG:32648 (UTM 48N, mét; Z = cao độ tuyệt đối, mét)
-- =====================================================================
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Kiểu liệt kê
-- ---------------------------------------------------------------------
create type public.user_role      as enum ('citizen', 'technician', 'admin');
create type public.manhole_kind   as enum ('manhole', 'inlet', 'outfall');
create type public.asset_status   as enum ('active', 'maintenance', 'damaged', 'blocked', 'retired');
create type public.utility_kind   as enum ('water', 'power', 'telecom');
create type public.defect_type    as enum ('crack', 'root', 'deposit', 'collapse');
create type public.incident_kind  as enum ('blocked', 'overflow', 'broken_cover', 'odor', 'subsidence', 'other');
create type public.incident_status as enum ('new', 'accepted', 'in_progress', 'resolved', 'rejected');
create type public.event_type     as enum ('inspect', 'clean', 'incident', 'repair', 'replace');
create type public.csg_op         as enum ('union', 'difference', 'primitive');
create type public.csg_primitive  as enum ('cylinder');
create type public.surface_type   as enum ('Ground', 'Wall', 'Roof');

-- ---------------------------------------------------------------------
-- Người dùng, khu phụ trách
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       public.user_role not null default 'citizen',
  full_name  text,
  created_at timestamptz not null default now()
);

create table public.zones (
  id   serial primary key,
  name text not null unique,
  geom geometry(Polygon, 32648) not null
);

create table public.user_zones (
  user_id uuid not null references public.profiles (id) on delete cascade,
  zone_id int  not null references public.zones (id) on delete cascade,
  primary key (user_id, zone_id)
);

-- ---------------------------------------------------------------------
-- Lớp ĐỊA HÌNH (TIN)
-- ---------------------------------------------------------------------
create table public.terrain_points (
  id     serial primary key,
  source text not null default 'mock',
  geom   geometry(PointZ, 32648) not null
);

-- Mỗi dòng là một tam giác Delaunay (PolygonZ 4 đỉnh, đỉnh đầu = đỉnh cuối)
create table public.terrain_tin (
  id   serial primary key,
  geom geometry(PolygonZ, 32648) not null
);

-- ---------------------------------------------------------------------
-- Lớp CÔNG TRÌNH (SUDM – B-Rep LOD1/LOD2)
-- ---------------------------------------------------------------------
create table public.buildings (
  id           serial primary key,
  name         text,
  floors       smallint not null default 1 check (floors between 1 and 60),
  height_m     numeric(6,2) not null check (height_m > 0),
  base_elev_m  numeric(7,3) not null,              -- cao độ nền tầng trệt
  has_basement boolean not null default false,
  year_built   smallint,
  source       text not null default 'mock',
  geom         geometry(Polygon, 32648) not null,  -- dấu chân công trình (2D)
  valid_from   timestamptz not null default now(),
  valid_to     timestamptz,
  tx_from      timestamptz not null default now(),
  tx_to        timestamptz,
  created_by   uuid default auth.uid()
);

-- Bề mặt biên (Ground/Wall/Roof) – mô hình SUDM
create table public.building_surface (
  id          serial primary key,
  building_id int not null references public.buildings (id) on delete cascade,
  type        public.surface_type not null,
  lod         smallint not null default 1 check (lod in (1, 2)),
  geom        geometry(PolygonZ, 32648) not null
);

-- ---------------------------------------------------------------------
-- Lớp HẠ TẦNG MẠNG (Node–Arc 3D)
-- ---------------------------------------------------------------------
-- Danh mục vật liệu (chuẩn hóa 3NF: hệ số nhám Manning phụ thuộc vật liệu)
create table public.pipe_materials (
  code      text primary key,
  name      text not null,
  manning_n numeric(6,4) not null check (manning_n > 0)
);

-- Hố ga (Node). Bảng LƯỠNG THỜI GIAN (bitemporal):
--   vid = khóa phiên bản; id = định danh logic của tài sản (giữ nguyên qua các phiên bản).
--   geom: PointZ tại tâm nắp, Z = cao độ nắp (rim).
create sequence public.manholes_id_seq;
create table public.manholes (
  vid           bigserial primary key,
  id            bigint not null default nextval('public.manholes_id_seq'),
  code          text not null,
  kind          public.manhole_kind not null default 'manhole',
  rim_elev_m    numeric(7,3) not null,
  invert_elev_m numeric(7,3) not null,
  diameter_m    numeric(5,2) not null default 1.0 check (diameter_m between 0.3 and 5),
  material      text not null default 'BTCT',
  status        public.asset_status not null default 'active',
  geom          geometry(PointZ, 32648) not null,
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  tx_from       timestamptz not null default now(),
  tx_to         timestamptz,
  created_by    uuid default auth.uid(),
  constraint manholes_invert_below_rim check (invert_elev_m < rim_elev_m),
  constraint manholes_valid_period check (valid_to is null or valid_to > valid_from)
);
alter sequence public.manholes_id_seq owned by public.manholes.id;
-- chỉ một phiên bản HIỆN HÀNH cho mỗi id / code
create unique index manholes_current_id   on public.manholes (id)   where valid_to is null and tx_to is null;
create unique index manholes_current_code on public.manholes (code) where valid_to is null and tx_to is null;
create index manholes_id_idx on public.manholes (id);

-- Mô hình CSG cho hố ga: cây (op, primitive, params). Lá = khối nguyên thủy.
create table public.csg_node (
  id         serial primary key,
  manhole_id bigint not null,                       -- id logic hố ga
  parent_id  int references public.csg_node (id) on delete cascade,
  ord        smallint not null default 0,           -- thứ tự toán hạng (A − B: A có ord nhỏ hơn)
  op         public.csg_op not null,
  primitive  public.csg_primitive,
  params     jsonb not null default '{}'::jsonb,    -- {radius, z0, height, dx, dy}
  constraint csg_primitive_leaf check ((op = 'primitive') = (primitive is not null))
);
create index csg_node_manhole_idx on public.csg_node (manhole_id);

-- Cống (Arc), LineStringZ: Z = cao độ đáy trong lòng cống (invert).
create sequence public.pipes_id_seq;
create table public.pipes (
  vid           bigserial primary key,
  id            bigint not null default nextval('public.pipes_id_seq'),
  code          text not null,
  from_mh       bigint not null,                    -- hố ga thượng lưu (id logic)
  to_mh         bigint not null,                    -- hố ga hạ lưu (id logic) – hướng dòng chảy
  diameter_mm   int not null check (diameter_mm between 100 and 3000),
  material_code text not null references public.pipe_materials (code),
  up_invert_m   numeric(7,3),                       -- tự tính từ Z điểm đầu
  down_invert_m numeric(7,3),                       -- tự tính từ Z điểm cuối
  length_m      numeric(9,3),                       -- ST_3DLength
  slope         numeric(10,6),                      -- (up − down) / chiều dài mặt bằng
  install_year  smallint,
  status        public.asset_status not null default 'active',
  geom          geometry(LineStringZ, 32648) not null,
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  tx_from       timestamptz not null default now(),
  tx_to         timestamptz,
  created_by    uuid default auth.uid(),
  constraint pipes_not_loop check (from_mh <> to_mh),
  constraint pipes_valid_period check (valid_to is null or valid_to > valid_from)
);
alter sequence public.pipes_id_seq owned by public.pipes.id;
create unique index pipes_current_id   on public.pipes (id)   where valid_to is null and tx_to is null;
create unique index pipes_current_code on public.pipes (code) where valid_to is null and tx_to is null;
create index pipes_id_idx on public.pipes (id);
create index pipes_from_idx on public.pipes (from_mh) where valid_to is null and tx_to is null;
create index pipes_to_idx   on public.pipes (to_mh)   where valid_to is null and tx_to is null;

-- Công trình ngầm khác (cấp nước, điện, viễn thông)
create table public.utilities (
  id          serial primary key,
  kind        public.utility_kind not null,
  diameter_mm int not null check (diameter_mm > 0),
  owner       text,
  geom        geometry(LineStringZ, 32648) not null, -- Z = cao độ tim ống
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  tx_from     timestamptz not null default now(),
  tx_to       timestamptz,
  created_by  uuid default auth.uid()
);

-- ---------------------------------------------------------------------
-- Kiểm tra lòng cống (CCTV) và lỗi
-- ---------------------------------------------------------------------
create table public.inspections (
  id           serial primary key,
  pipe_id      bigint not null,                     -- id logic cống
  inspected_at timestamptz not null,
  grade        smallint not null check (grade between 1 and 5),
  inspector    text,
  note         text
);
create index inspections_pipe_idx on public.inspections (pipe_id);

create table public.defects (
  id            serial primary key,
  inspection_id int not null references public.inspections (id) on delete cascade,
  chainage_m    numeric(8,2) not null check (chainage_m >= 0), -- vị trí lỗi tính theo mét dọc ống
  type          public.defect_type not null,
  severity      smallint not null check (severity between 1 and 5),
  note          text
);

-- ---------------------------------------------------------------------
-- Ngập, mưa, quan trắc
-- ---------------------------------------------------------------------
create table public.flood_points (
  id           serial primary key,
  name         text not null,
  max_depth_cm int not null,
  source_url   text,
  occurred_at  timestamptz not null,
  note         text,
  geom         geometry(Point, 32648) not null
);

create table public.rain_scenarios (
  id             serial primary key,
  name           text not null,
  intensity_mm_h numeric(6,1) not null,
  water_level_m  numeric(6,3) not null,             -- cao độ mặt nước ngập (m)
  duration_min   int not null default 60
);

-- Trạm quan trắc (bổ sung để chọn trạm gần nhất cho mỗi hố ga bằng KNN)
create table public.obs_stations (
  id   text primary key,
  name text not null,
  geom geometry(Point, 32648) not null
);

-- Chuỗi thời gian 15 phút/lần
create table public.water_obs (
  station_id    text not null references public.obs_stations (id) on delete cascade,
  ts            timestamptz not null,
  rain_mm       numeric(6,2) not null default 0,
  water_level_m numeric(6,3) not null,
  primary key (station_id, ts)                      -- B-tree (station_id, ts)
);

-- ---------------------------------------------------------------------
-- Sự cố, sự kiện, nhật ký
-- ---------------------------------------------------------------------
create table public.incident_reports (
  id            bigserial primary key,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind          public.incident_kind not null,
  note          text,
  image_path    text,
  status        public.incident_status not null default 'new',
  manhole_id    bigint,                              -- gán tự động = hố ga gần nhất (KNN)
  technician_id uuid references public.profiles (id) on delete set null,
  geom          geometry(Point, 32648) not null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  arrived_at    timestamptz,
  resolved_at   timestamptz,
  constraint incident_time_order check (
    (accepted_at is null or accepted_at >= created_at) and
    (arrived_at  is null or (accepted_at is not null and arrived_at >= accepted_at)) and
    (resolved_at is null or resolved_at >= created_at))
);
create index incident_reports_user_idx on public.incident_reports (user_id);
create index incident_reports_status_idx on public.incident_reports (status);

-- Mô hình thời gian EVENT-BASED: mọi thay đổi trạng thái tài sản là một sự kiện
create table public.asset_events (
  id         bigserial primary key,
  asset_type text not null check (asset_type in ('manhole', 'pipe', 'building', 'utility')),
  asset_id   bigint not null,
  event_type public.event_type not null,
  detail     jsonb not null default '{}'::jsonb,
  valid_time timestamptz not null,                  -- thời điểm sự kiện xảy ra ngoài thực tế
  tx_time    timestamptz not null default now(),    -- thời điểm ghi vào CSDL
  actor      uuid default auth.uid()
);
create index asset_events_asset_idx on public.asset_events (asset_type, asset_id, valid_time);

create table public.audit_log (
  id       bigserial primary key,
  tbl      text not null,
  row_id   text,
  action   text not null,
  old_data jsonb,
  new_data jsonb,
  actor    uuid,
  at       timestamptz not null default now()
);
create index audit_log_at_idx on public.audit_log (at desc);

-- ---------------------------------------------------------------------
-- Index không gian GIST cho MỌI cột geom
-- ---------------------------------------------------------------------
create index zones_geom_gix            on public.zones            using gist (geom);
create index terrain_points_geom_gix   on public.terrain_points   using gist (geom);
create index terrain_tin_geom_gix      on public.terrain_tin      using gist (geom);
create index buildings_geom_gix        on public.buildings        using gist (geom);
create index building_surface_geom_gix on public.building_surface using gist (geom);
create index manholes_geom_gix         on public.manholes         using gist (geom);
create index pipes_geom_gix            on public.pipes            using gist (geom);
create index utilities_geom_gix        on public.utilities        using gist (geom);
create index flood_points_geom_gix     on public.flood_points     using gist (geom);
create index obs_stations_geom_gix     on public.obs_stations     using gist (geom);
create index incident_reports_geom_gix on public.incident_reports using gist (geom);
-- Index N chiều (x,y,z) để ST_3DDWithin dùng được index khi kiểm tra va chạm 3D
create index pipes_geom_nd_gix     on public.pipes     using gist (geom gist_geometry_ops_nd);
create index utilities_geom_nd_gix on public.utilities using gist (geom gist_geometry_ops_nd);
