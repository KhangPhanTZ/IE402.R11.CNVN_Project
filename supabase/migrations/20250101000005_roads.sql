-- =====================================================================
-- Migration 5: Mạng đường thật (OSM) + tuyến cống theo phía đường + hố thu mép đường
--   roads (ĐƯỜNG) 1–n road_segments (ĐOẠN ĐƯỜNG, thực thể yếu: bề rộng, số làn, hình học)
--   sewer_lines (TUYẾN CỐNG): một tuyến chạy dọc một đường, ở phía trái / phải / tim đường
--   pipes.line_id → tuyến cống; pipes.pipe_type: dọc đường / băng ngang / nhánh hố thu
--   manholes (kind = 'inlet' = HỐ THU): kiểu thu, phía, mức bồi lấp, đoạn đường nằm cạnh
--   flood_points.cause: nguyên nhân ngập
-- =====================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Bảng mới
-- ---------------------------------------------------------------------
create table public.roads (
  id         serial primary key,
  name       text not null,
  road_class text not null check (road_class in
               ('primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service')),
  source     text not null default 'osm'
);
create index roads_name_idx on public.roads (lower(name));

create table public.road_segments (
  id           serial primary key,
  road_id      int not null references public.roads (id) on delete cascade,
  osm_id       bigint,
  width_m      numeric(5,2) not null check (width_m between 2 and 60),   -- bề rộng lòng đường (mép bó vỉa ↔ mép bó vỉa)
  lanes        smallint check (lanes between 1 and 12),
  oneway       boolean not null default false,
  width_source text not null default 'class' check (width_source in ('osm_width', 'osm_lanes', 'class')),
  geom         geometry(LineString, 32648) not null                      -- tim đường
);
create index road_segments_geom_gix on public.road_segments using gist (geom);
create index road_segments_road_idx on public.road_segments (road_id);

create table public.sewer_lines (
  id      serial primary key,
  code    text not null unique,
  name    text not null,
  road_id int references public.roads (id) on delete set null,
  side    text not null check (side in ('left', 'right', 'center')),   -- phía đặt tuyến so với chiều số hoá của đường
  level   text not null check (level in ('main', 'branch'))           -- cống chính (đường lớn) / cống nhánh (hẻm)
);
create index sewer_lines_road_idx on public.sewer_lines (road_id);

-- ---------------------------------------------------------------------
-- Cột mới trên bảng có sẵn (versioning sao chép cả dòng nên không cần sửa trigger)
-- ---------------------------------------------------------------------
alter table public.pipes
  add column line_id   int references public.sewer_lines (id) on delete set null,
  add column pipe_type text not null default 'along' check (pipe_type in ('along', 'cross', 'lateral'));
create index pipes_line_idx on public.pipes (line_id);

alter table public.manholes
  add column side         text check (side in ('left', 'right', 'center')),
  add column inlet_type   text check (inlet_type in ('curb', 'grate', 'combined')),   -- miệng thu bó vỉa / song chắn / kết hợp
  add column blockage_pct smallint check (blockage_pct between 0 and 100),           -- mức bồi lấp miệng thu
  add column segment_id   int references public.road_segments (id) on delete set null,
  add constraint manholes_inlet_attrs check (kind = 'inlet' or (inlet_type is null and blockage_pct is null));
create index manholes_segment_idx on public.manholes (segment_id);

alter table public.flood_points
  add column cause text check (cause in ('low_terrain', 'blocked_inlet', 'undersized_pipe', 'tide', 'mixed'));

-- ---------------------------------------------------------------------
-- RLS: đường là dữ liệu nền công khai; tuyến cống chỉ cho nhân viên
-- ---------------------------------------------------------------------
alter table public.roads enable row level security;
alter table public.road_segments enable row level security;
alter table public.sewer_lines enable row level security;

create policy roads_select on public.roads for select to anon, authenticated using (true);
create policy roads_admin on public.roads for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));
create policy road_segments_select on public.road_segments for select to anon, authenticated using (true);
create policy road_segments_admin on public.road_segments for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));
create policy sewer_lines_select on public.sewer_lines for select to authenticated using (public.is_staff());
create policy sewer_lines_admin on public.sewer_lines for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

revoke all on public.roads, public.road_segments, public.sewer_lines from anon;
grant select on public.roads, public.road_segments to anon;
grant select on public.roads, public.road_segments, public.sewer_lines to authenticated;
grant insert, update, delete on public.roads, public.road_segments, public.sewer_lines to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------
-- View công khai: thêm thông tin phía đường / tên đường (cột mới nối vào cuối)
-- ---------------------------------------------------------------------
create or replace view public.public_manholes with (security_invoker = false) as
  select m.id, m.code, m.kind, m.status, m.diameter_m, ST_Force2D(m.geom)::geometry(Point, 32648) as geom,
         m.side, m.inlet_type, r.name as road_name
  from public.manholes m
  left join public.road_segments s on s.id = m.segment_id
  left join public.roads r on r.id = s.road_id
  where m.valid_to is null and m.tx_to is null;

create or replace view public.public_pipes with (security_invoker = false) as
  select p.id, p.code, p.from_mh, p.to_mh, p.diameter_mm, p.material_code, p.status,
         ST_Force2D(p.geom)::geometry(LineString, 32648) as geom,
         p.pipe_type, l.code as line_code, l.side, r.name as road_name
  from public.pipes p
  left join public.sewer_lines l on l.id = p.line_id
  left join public.roads r on r.id = l.road_id
  where p.valid_to is null and p.tx_to is null;

-- ---------------------------------------------------------------------
-- RPC lớp bản đồ
-- ---------------------------------------------------------------------
create or replace function public.layer_roads()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(s.geom, jsonb_build_object(
           'layer', 'road', 'id', s.id, 'road_id', r.id, 'name', r.name, 'road_class', r.road_class,
           'width_m', s.width_m, 'lanes', s.lanes, 'oneway', s.oneway, 'width_source', s.width_source,
           'osm_id', s.osm_id, 'length_m', round(ST_Length(s.geom)::numeric, 1)),
           'road:' || s.id) order by s.id))
  from public.road_segments s join public.roads r on r.id = s.road_id;
$$;

create or replace function public.layer_manholes()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(m.geom, jsonb_build_object(
           'layer', 'manhole', 'id', m.id, 'vid', m.vid, 'code', m.code, 'kind', m.kind,
           'rim_elev_m', m.rim_elev_m, 'invert_elev_m', m.invert_elev_m,
           'depth_m', m.rim_elev_m - m.invert_elev_m, 'diameter_m', m.diameter_m,
           'material', m.material, 'status', m.status,
           'side', m.side, 'inlet_type', m.inlet_type, 'blockage_pct', m.blockage_pct,
           'segment_id', m.segment_id, 'road', r.name, 'road_width_m', s.width_m,
           'valid_from', m.valid_from, 'valid_to', m.valid_to, 'tx_from', m.tx_from, 'tx_to', m.tx_to,
           'csg', (select jsonb_agg(to_jsonb(c) - 'manhole_id' order by c.id)
                     from public.csg_node c where c.manhole_id = m.id)),
           'manhole:' || m.id) order by m.id))
  from public.manholes m
  left join public.road_segments s on s.id = m.segment_id
  left join public.roads r on r.id = s.road_id
  where m.valid_to is null and m.tx_to is null;
$$;

create or replace function public.layer_pipes()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(p.geom, jsonb_build_object(
           'layer', 'pipe', 'id', p.id, 'vid', p.vid, 'code', p.code,
           'from_mh', p.from_mh, 'to_mh', p.to_mh, 'diameter_mm', p.diameter_mm,
           'material_code', p.material_code, 'material', pm.name, 'manning_n', pm.manning_n,
           'up_invert_m', p.up_invert_m, 'down_invert_m', p.down_invert_m,
           'length_m', p.length_m, 'slope', p.slope, 'install_year', p.install_year, 'status', p.status,
           'capacity_m3s', round(public.manning_capacity(p.diameter_mm, p.slope, pm.manning_n)::numeric, 4),
           'pipe_type', p.pipe_type, 'line_id', p.line_id, 'line_code', l.code, 'line_name', l.name,
           'side', l.side, 'line_level', l.level, 'road', r.name,
           'valid_from', p.valid_from, 'valid_to', p.valid_to, 'tx_from', p.tx_from, 'tx_to', p.tx_to),
           'pipe:' || p.id) order by p.id))
  from public.pipes p
  join public.pipe_materials pm on pm.code = p.material_code
  left join public.sewer_lines l on l.id = p.line_id
  left join public.roads r on r.id = l.road_id
  where p.valid_to is null and p.tx_to is null;
$$;

create or replace function public.layer_flood_points()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(f.geom, jsonb_build_object(
           'layer', 'flood', 'id', f.id, 'name', f.name, 'max_depth_cm', f.max_depth_cm,
           'source_url', f.source_url, 'occurred_at', f.occurred_at, 'note', f.note, 'cause', f.cause),
           'flood:' || f.id) order by f.id))
  from public.flood_points f;
$$;

create or replace function public.layer_public()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(
    coalesce((select jsonb_agg(public.gj_feature(p.geom, jsonb_build_object(
                'layer', 'pipe', 'public', true, 'id', p.id, 'code', p.code, 'from_mh', p.from_mh, 'to_mh', p.to_mh,
                'diameter_mm', p.diameter_mm, 'material_code', p.material_code, 'status', p.status,
                'pipe_type', p.pipe_type, 'line_code', p.line_code, 'side', p.side, 'road', p.road_name),
                'pipe:' || p.id)) from public.public_pipes p), '[]'::jsonb)
    ||
    coalesce((select jsonb_agg(public.gj_feature(m.geom, jsonb_build_object(
                'layer', 'manhole', 'public', true, 'id', m.id, 'code', m.code, 'kind', m.kind,
                'status', m.status, 'diameter_m', m.diameter_m,
                'side', m.side, 'inlet_type', m.inlet_type, 'road', m.road_name),
                'manhole:' || m.id)) from public.public_manholes m), '[]'::jsonb));
$$;

-- Thống kê theo tuyến đường: số hố ga/hố thu, chiều dài cống mỗi phía, hố thu bồi lấp ≥ 50 %
create or replace function public.road_drainage_summary(p_road_id int default null)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with pl as (
    select l.road_id, l.side, count(*) as n_pipes, round(sum(p.length_m)::numeric, 1) as len_m
      from public.pipes p join public.sewer_lines l on l.id = p.line_id
     where p.valid_to is null and p.tx_to is null and p.pipe_type <> 'lateral'
     group by l.road_id, l.side
  ), mh as (
    select s.road_id, count(*) filter (where m.kind = 'inlet') as n_inlets,
           count(*) filter (where m.kind <> 'inlet') as n_manholes,
           count(*) filter (where m.kind = 'inlet' and m.blockage_pct >= 50) as n_blocked_inlets
      from public.manholes m join public.road_segments s on s.id = m.segment_id
     where m.valid_to is null and m.tx_to is null
     group by s.road_id
  )
  select jsonb_build_object('roads', coalesce(jsonb_agg(jsonb_build_object(
           'road_id', rd.id, 'name', rd.name, 'road_class', rd.road_class,
           'sides', (select jsonb_object_agg(pl.side, jsonb_build_object('pipes', pl.n_pipes, 'length_m', pl.len_m))
                       from pl where pl.road_id = rd.id),
           'manholes', coalesce(mh.n_manholes, 0), 'inlets', coalesce(mh.n_inlets, 0),
           'blocked_inlets', coalesce(mh.n_blocked_inlets, 0)) order by rd.name), '[]'::jsonb))
    into r
    from public.roads rd left join mh on mh.road_id = rd.id
   where (p_road_id is null or rd.id = p_road_id)
     and (exists (select 1 from pl where pl.road_id = rd.id) or mh.road_id is not null);
  return r;
end $$;

revoke execute on function public.layer_roads(), public.road_drainage_summary(int) from public, anon;
grant execute on function public.layer_roads(), public.road_drainage_summary(int) to authenticated, service_role;
grant execute on function public.layer_roads() to anon;
grant execute on function public.layer_manholes(), public.layer_pipes(), public.layer_flood_points(),
  public.layer_public() to authenticated, service_role;
grant execute on function public.layer_public(), public.layer_flood_points() to anon;
