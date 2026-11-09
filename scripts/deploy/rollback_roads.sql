-- =====================================================================
-- ROLLBACK migration 5 (roads): đưa CSDL về đúng cấu trúc migration 1–4.
--   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... python3 scripts/deploy/supabase_sql.py scripts/deploy/rollback_roads.sql
-- Sau đó nạp lại dữ liệu cũ: git checkout <commit trước>, chạy seed.py ở CSDL local,
-- export_seed_sql.sh rồi supabase_sql.py (xem README – mục Deploy).
-- =====================================================================
set search_path = public, extensions;

drop function if exists public.layer_roads();
drop function if exists public.road_drainage_summary(int);

-- view công khai: bỏ cột mới (phải drop rồi tạo lại vì CREATE OR REPLACE không xoá được cột)
drop view if exists public.public_manholes;
drop view if exists public.public_pipes;
create view public.public_manholes with (security_invoker = false) as
  select id, code, kind, status, diameter_m, ST_Force2D(geom)::geometry(Point, 32648) as geom
  from public.manholes
  where valid_to is null and tx_to is null;

create view public.public_pipes with (security_invoker = false) as
  select id, code, from_mh, to_mh, diameter_mm, material_code, status,
         ST_Force2D(geom)::geometry(LineString, 32648) as geom
  from public.pipes
  where valid_to is null and tx_to is null;

revoke all on public.public_manholes, public.public_pipes from anon;
grant select on public.public_manholes, public.public_pipes to anon, authenticated;

-- hàm lớp bản đồ: bản gốc của migration 4
create or replace function public.layer_manholes()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(m.geom, jsonb_build_object(
           'layer', 'manhole', 'id', m.id, 'vid', m.vid, 'code', m.code, 'kind', m.kind,
           'rim_elev_m', m.rim_elev_m, 'invert_elev_m', m.invert_elev_m,
           'depth_m', m.rim_elev_m - m.invert_elev_m, 'diameter_m', m.diameter_m,
           'material', m.material, 'status', m.status,
           'valid_from', m.valid_from, 'valid_to', m.valid_to, 'tx_from', m.tx_from, 'tx_to', m.tx_to,
           'csg', (select jsonb_agg(to_jsonb(c) - 'manhole_id' order by c.id)
                     from public.csg_node c where c.manhole_id = m.id)),
           'manhole:' || m.id) order by m.id))
  from public.manholes m
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
           'valid_from', p.valid_from, 'valid_to', p.valid_to, 'tx_from', p.tx_from, 'tx_to', p.tx_to),
           'pipe:' || p.id) order by p.id))
  from public.pipes p
  join public.pipe_materials pm on pm.code = p.material_code
  where p.valid_to is null and p.tx_to is null;
$$;

create or replace function public.layer_flood_points()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(f.geom, jsonb_build_object(
           'layer', 'flood', 'id', f.id, 'name', f.name, 'max_depth_cm', f.max_depth_cm,
           'source_url', f.source_url, 'occurred_at', f.occurred_at, 'note', f.note),
           'flood:' || f.id) order by f.id))
  from public.flood_points f;
$$;

create or replace function public.layer_public()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(
    coalesce((select jsonb_agg(public.gj_feature(p.geom, jsonb_build_object(
                'layer', 'pipe', 'public', true, 'id', p.id, 'code', p.code, 'from_mh', p.from_mh, 'to_mh', p.to_mh,
                'diameter_mm', p.diameter_mm, 'material_code', p.material_code, 'status', p.status),
                'pipe:' || p.id)) from public.public_pipes p), '[]'::jsonb)
    ||
    coalesce((select jsonb_agg(public.gj_feature(m.geom, jsonb_build_object(
                'layer', 'manhole', 'public', true, 'id', m.id, 'code', m.code, 'kind', m.kind,
                'status', m.status, 'diameter_m', m.diameter_m),
                'manhole:' || m.id)) from public.public_manholes m), '[]'::jsonb));
$$;

alter table public.pipes drop column if exists line_id, drop column if exists pipe_type;
alter table public.manholes drop constraint if exists manholes_inlet_attrs,
  drop column if exists side, drop column if exists inlet_type, drop column if exists blockage_pct,
  drop column if exists segment_id;
alter table public.flood_points drop column if exists cause;
drop table if exists public.sewer_lines, public.road_segments, public.roads cascade;

do $$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20250101000005';
  end if;
end $$;
