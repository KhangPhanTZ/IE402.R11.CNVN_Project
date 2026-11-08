-- =====================================================================
-- Migration 4: hàm RPC (SECURITY INVOKER – RLS của người gọi luôn được áp dụng)
-- Tất cả trả về GeoJSON FeatureCollection đã ST_Transform sang EPSG:4326
-- Quy ước "hiện hành": valid_to IS NULL AND tx_to IS NULL
-- =====================================================================
set search_path = public, extensions;

create or replace function public.assert_staff()
returns void language plpgsql stable
set search_path = public, extensions as $$
begin
  if not public.is_staff() then
    raise exception 'RLS: chức năng phân tích chỉ dành cho technician/admin' using errcode = '42501';
  end if;
end $$;

-- =====================================================================
-- A. LỚP DỮ LIỆU CHO BẢN ĐỒ
-- =====================================================================
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

create or replace function public.layer_buildings()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(b.geom, jsonb_build_object(
           'layer', 'building', 'id', b.id, 'name', b.name, 'floors', b.floors, 'height_m', b.height_m,
           'base_elev_m', b.base_elev_m, 'has_basement', b.has_basement, 'year_built', b.year_built,
           'source', b.source, 'area_m2', round(ST_Area(b.geom)::numeric, 1),
           'surfaces', (select jsonb_object_agg(s.t, s.n) from (
               select type::text t, count(*) n from public.building_surface bs
                where bs.building_id = b.id group by type) s),
           'lod', (select max(lod) from public.building_surface bs where bs.building_id = b.id),
           'valid_from', b.valid_from, 'valid_to', b.valid_to, 'tx_from', b.tx_from, 'tx_to', b.tx_to),
           'building:' || b.id) order by b.id))
  from public.buildings b
  where b.valid_to is null and b.tx_to is null;
$$;

-- Bề mặt B-Rep (Ground/Wall/Roof) của một công trình – để hiển thị LOD2
create or replace function public.building_surfaces(p_building_id int)
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(s.geom, jsonb_build_object(
           'layer', 'surface', 'id', s.id, 'building_id', s.building_id, 'type', s.type, 'lod', s.lod,
           'footprint_m2', round(ST_Area(s.geom)::numeric, 2), 'zmin', ST_ZMin(s.geom), 'zmax', ST_ZMax(s.geom)), 'surface:' || s.id) order by s.id))
  from public.building_surface s where s.building_id = p_building_id;
$$;

create or replace function public.layer_tin()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(t.geom, jsonb_build_object('id', t.id), null) order by t.id),
                      jsonb_build_object('triangles', count(*),
                                         'zmin', min(ST_ZMin(t.geom)), 'zmax', max(ST_ZMax(t.geom))))
  from public.terrain_tin t;
$$;

create or replace function public.layer_utilities()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(u.geom, jsonb_build_object(
           'layer', 'utility', 'id', u.id, 'kind', u.kind, 'diameter_mm', u.diameter_mm, 'owner', u.owner,
           'length_m', round(ST_3DLength(u.geom)::numeric, 1),
           'valid_from', u.valid_from, 'valid_to', u.valid_to, 'tx_from', u.tx_from, 'tx_to', u.tx_to),
           'utility:' || u.id) order by u.id))
  from public.utilities u where u.valid_to is null and u.tx_to is null;
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

create or replace function public.layer_zones()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(z.geom, jsonb_build_object(
           'layer', 'zone', 'id', z.id, 'name', z.name, 'area_km2', round((ST_Area(z.geom) / 1e6)::numeric, 3)),
           'zone:' || z.id) order by z.id))
  from public.zones z;
$$;

create or replace function public.layer_stations()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(s.geom, jsonb_build_object(
           'layer', 'station', 'id', s.id, 'name', s.name,
           'last', (select jsonb_build_object('ts', o.ts, 'water_level_m', o.water_level_m, 'rain_mm', o.rain_mm)
                      from public.water_obs o where o.station_id = s.id order by o.ts desc limit 1)),
           'station:' || s.id)))
  from public.obs_stations s;
$$;

-- Sự cố (RLS: citizen chỉ thấy của mình)
create or replace function public.layer_incidents()
returns jsonb language sql stable
set search_path = public, extensions as $$
  select public.gj_fc(jsonb_agg(public.gj_feature(i.geom, jsonb_build_object(
           'layer', 'incident', 'id', i.id, 'kind', i.kind, 'note', i.note, 'status', i.status,
           'image_path', i.image_path, 'manhole_id', i.manhole_id, 'user_id', i.user_id,
           'technician_id', i.technician_id, 'created_at', i.created_at, 'accepted_at', i.accepted_at,
           'arrived_at', i.arrived_at, 'resolved_at', i.resolved_at,
           'zone', (select z.name from public.zones z where ST_Within(i.geom, z.geom) limit 1)),
           'incident:' || i.id) order by i.created_at desc))
  from public.incident_reports i;
$$;

-- Lớp công khai cho khách: chỉ đọc từ view rút gọn
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

-- Lịch sử (THỜI GIAN) của một tài sản: các phiên bản bitemporal + sự kiện
create or replace function public.asset_history(p_asset_type text, p_id bigint)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare
  v_versions jsonb; v_events jsonb; v_insp jsonb;
begin
  if p_asset_type = 'pipe' then
    select jsonb_agg(jsonb_build_object('vid', vid, 'diameter_mm', diameter_mm, 'material_code', material_code,
             'status', status, 'slope', slope, 'valid_from', valid_from, 'valid_to', valid_to,
             'tx_from', tx_from, 'tx_to', tx_to,
             'current', valid_to is null and tx_to is null) order by tx_from, valid_from)
      into v_versions from public.pipes where id = p_id;
    select jsonb_agg(jsonb_build_object('id', i.id, 'inspected_at', i.inspected_at, 'grade', i.grade,
             'defects', (select count(*) from public.defects d where d.inspection_id = i.id))
             order by i.inspected_at desc)
      into v_insp from public.inspections i where i.pipe_id = p_id;
  elsif p_asset_type = 'manhole' then
    select jsonb_agg(jsonb_build_object('vid', vid, 'rim_elev_m', rim_elev_m, 'invert_elev_m', invert_elev_m,
             'status', status, 'diameter_m', diameter_m, 'valid_from', valid_from, 'valid_to', valid_to,
             'tx_from', tx_from, 'tx_to', tx_to,
             'current', valid_to is null and tx_to is null) order by tx_from, valid_from)
      into v_versions from public.manholes where id = p_id;
  elsif p_asset_type = 'building' then
    select jsonb_agg(jsonb_build_object('id', id, 'valid_from', valid_from, 'valid_to', valid_to,
             'tx_from', tx_from, 'tx_to', tx_to, 'year_built', year_built, 'current', valid_to is null))
      into v_versions from public.buildings where id = p_id;
  elsif p_asset_type = 'utility' then
    select jsonb_agg(jsonb_build_object('id', id, 'valid_from', valid_from, 'valid_to', valid_to,
             'tx_from', tx_from, 'tx_to', tx_to, 'current', valid_to is null))
      into v_versions from public.utilities where id = p_id;
  end if;
  select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'detail', e.detail,
           'valid_time', e.valid_time, 'tx_time', e.tx_time, 'actor', e.actor) order by e.valid_time desc)
    into v_events from public.asset_events e where e.asset_type = p_asset_type and e.asset_id = p_id;
  return jsonb_build_object('asset_type', p_asset_type, 'id', p_id,
                            'versions', coalesce(v_versions, '[]'), 'events', coalesce(v_events, '[]'),
                            'inspections', coalesce(v_insp, '[]'));
end $$;

-- =====================================================================
-- B. TRUY VẤN KHÔNG GIAN Q1–Q12
-- =====================================================================

-- Q1. Cống dốc ngược / dốc quá nhỏ: slope ≤ ngưỡng (mặc định 0,0005)
create or replace function public.q1_reverse_slope(p_threshold numeric default 0.0005)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  select public.gj_fc(jsonb_agg(public.gj_feature(p.geom, jsonb_build_object(
           'layer', 'pipe', 'id', p.id, 'code', p.code, 'slope', p.slope, 'diameter_mm', p.diameter_mm,
           'up_invert_m', p.up_invert_m, 'down_invert_m', p.down_invert_m, 'length_m', p.length_m,
           'problem', case when p.slope < 0 then 'Dốc ngược' else 'Dốc quá nhỏ' end),
           'pipe:' || p.id) order by p.slope),
           jsonb_build_object('query', 'Q1', 'threshold', p_threshold, 'count', count(*)))
    into r
    from public.pipes p
   where p.valid_to is null and p.tx_to is null
     and p.slope <= p_threshold;
  return r;
end $$;

-- Q2. Lớp đất phủ trên đỉnh ống < 0,7 m.
--     cover = cao độ nắp hố ga − cao độ đáy ống − D (xét tại cả 2 đầu cống)
create or replace function public.q2_shallow_cover(p_min_cover numeric default 0.7)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with c as (
    select p.*, mf.code as from_code, mt.code as to_code,
           mf.rim_elev_m - p.up_invert_m   - p.diameter_mm / 1000.0 as cover_up,
           mt.rim_elev_m - p.down_invert_m - p.diameter_mm / 1000.0 as cover_dn
      from public.pipes p
      join public.manholes mf on mf.id = p.from_mh and mf.valid_to is null and mf.tx_to is null
      join public.manholes mt on mt.id = p.to_mh   and mt.valid_to is null and mt.tx_to is null
     where p.valid_to is null and p.tx_to is null
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(c.geom, jsonb_build_object(
           'layer', 'pipe', 'id', c.id, 'code', c.code, 'diameter_mm', c.diameter_mm,
           'cover_up_m', round(c.cover_up, 3), 'cover_down_m', round(c.cover_dn, 3),
           'min_cover_m', round(least(c.cover_up, c.cover_dn), 3), 'from', c.from_code, 'to', c.to_code),
           'pipe:' || c.id) order by least(c.cover_up, c.cover_dn)),
           jsonb_build_object('query', 'Q2', 'min_cover', p_min_cover, 'count', count(*)))
    into r
    from c where least(c.cover_up, c.cover_dn) < p_min_cover;
  return r;
end $$;

-- Q3. Va chạm 3D giữa cống và công trình ngầm khác.
--     Khoảng hở giữa 2 MẶT ống = khoảng cách 3D giữa 2 tim − R_cống − R_tiện ích < 0,3 m
create or replace function public.q3_clash_3d(p_min_clearance numeric default 0.3)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with pairs as (
    select p.id as pipe_id, p.code as pipe_code, p.diameter_mm as pipe_d, p.geom as pgeom,
           u.id as utility_id, u.kind, u.owner, u.diameter_mm as util_d, u.geom as ugeom,
           -- ống cống nằm dưới tim: tim cống = đáy + D/2
           ST_Translate(p.geom, 0, 0, p.diameter_mm / 2000.0) as paxis
      from public.pipes p
      join public.utilities u
        -- ST_3DDWithin dùng index N chiều để lọc nhanh các cặp đủ gần trong không gian 3D
        on ST_3DDWithin(p.geom, u.geom, p.diameter_mm / 1000.0 + u.diameter_mm / 2000.0 + p_min_clearance + 0.1)
     where p.valid_to is null and p.tx_to is null and u.valid_to is null and u.tx_to is null
  ), m as (
    select *, ST_3DDistance(paxis, ugeom) - pipe_d / 2000.0 - util_d / 2000.0 as clearance,
              ST_3DClosestPoint(paxis, ugeom) as cpt
      from pairs
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(m.cpt, jsonb_build_object(
           'layer', 'clash', 'pipe_id', m.pipe_id, 'pipe_code', m.pipe_code, 'pipe_d_mm', m.pipe_d,
           'utility_id', m.utility_id, 'utility_kind', m.kind, 'utility_owner', m.owner, 'utility_d_mm', m.util_d,
           'clearance_m', round(m.clearance::numeric, 3)),
           'clash:' || m.pipe_id || '-' || m.utility_id) order by m.clearance),
           jsonb_build_object('query', 'Q3', 'min_clearance', p_min_clearance, 'count', count(*)))
    into r
    from m where m.clearance < p_min_clearance;
  return r;
end $$;

-- Q4. Truy vết thượng lưu / hạ lưu từ một cống bị tắc bằng WITH RECURSIVE
create or replace function public.q4_trace(p_pipe_id bigint, p_direction text default 'upstream')
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  if p_direction not in ('upstream', 'downstream') then
    raise exception 'p_direction phải là upstream hoặc downstream';
  end if;
  with recursive cur as (
    select * from public.pipes where valid_to is null and tx_to is null
  ), t(pipe_id, lvl) as (
    select c.id, 0 from cur c where c.id = p_pipe_id
    union   -- UNION (khử trùng) + giới hạn cấp để luôn dừng kể cả khi mạng có chu trình
    select n.id, t.lvl + 1
      from t
      join cur c on c.id = t.pipe_id
      join cur n on case when p_direction = 'upstream' then n.to_mh = c.from_mh   -- cống đổ vào đầu cống hiện tại
                         else n.from_mh = c.to_mh end                             -- cống nhận nước từ cuối cống hiện tại
     where t.lvl < 300
  ), a as (
    select pipe_id, min(lvl) lvl from t group by pipe_id
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(c.geom, jsonb_build_object(
           'layer', 'pipe', 'id', c.id, 'code', c.code, 'level', a.lvl, 'from_mh', c.from_mh, 'to_mh', c.to_mh,
           'diameter_mm', c.diameter_mm), 'pipe:' || c.id) order by a.lvl),
           jsonb_build_object('query', 'Q4', 'direction', p_direction, 'start_pipe', p_pipe_id,
                              'count', count(*), 'max_level', max(a.lvl),
                              'manholes', (select jsonb_agg(distinct x) from (
                                   select case when p_direction = 'upstream' then c2.from_mh else c2.to_mh end x
                                     from a a2 join cur c2 on c2.id = a2.pipe_id) s)))
    into r
    from a join cur c on c.id = a.pipe_id;
  return r;
end $$;

create or replace function public.trace_upstream(p_pipe_id bigint)
returns jsonb language sql stable set search_path = public, extensions as $$
  select public.q4_trace(p_pipe_id, 'upstream');
$$;
create or replace function public.trace_downstream(p_pipe_id bigint)
returns jsonb language sql stable set search_path = public, extensions as $$
  select public.q4_trace(p_pipe_id, 'downstream');
$$;

-- Mực nước tại vị trí g: ưu tiên p_level > kịch bản mưa > quan trắc water_obs tại thời điểm T
-- (với water_obs: lấy trạm GẦN NHẤT bằng KNN và bản ghi mới nhất ≤ T)
create or replace function public.water_level_at(g geometry, p_scenario_id int default null,
                                                  p_level numeric default null, p_at timestamptz default null)
returns numeric language plpgsql stable
set search_path = public, extensions as $$
declare v numeric;
begin
  if p_level is not null then return p_level; end if;
  if p_scenario_id is not null then
    select water_level_m into v from public.rain_scenarios where id = p_scenario_id;
    if v is null then raise exception 'Không có kịch bản mưa id=%', p_scenario_id; end if;
    return v;
  end if;
  if p_at is not null then
    select o.water_level_m into v
      from public.obs_stations s
      cross join lateral (select w.water_level_m from public.water_obs w
                           where w.station_id = s.id and w.ts <= p_at
                           order by w.ts desc limit 1) o
     order by s.geom <-> ST_Force2D(g)
     limit 1;
    return v;
  end if;
  raise exception 'Cần p_level, p_scenario_id hoặc p_at';
end $$;

-- Q5. Hố ga tràn: cao độ nắp < mực nước (kịch bản / mực nước nhập tay / water_obs tại T)
create or replace function public.q5_overflow(p_scenario_id int default null, p_water_level numeric default null,
                                              p_at timestamptz default null)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with m as (
    select mh.*, public.water_level_at(mh.geom, p_scenario_id, p_water_level, p_at) as lvl
      from public.manholes mh where mh.valid_to is null and mh.tx_to is null
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(m.geom, jsonb_build_object(
           'layer', 'manhole', 'id', m.id, 'code', m.code, 'kind', m.kind, 'rim_elev_m', m.rim_elev_m,
           'water_level_m', m.lvl, 'flood_depth_m', round(m.lvl - m.rim_elev_m, 3)),
           'manhole:' || m.id) order by m.lvl - m.rim_elev_m desc),
           jsonb_build_object('query', 'Q5', 'scenario_id', p_scenario_id, 'water_level', p_water_level,
                              'at', p_at, 'count', count(*), 'max_level', max(m.lvl)))
    into r
    from m where m.lvl is not null and m.rim_elev_m < m.lvl;
  return r;
end $$;

-- Q6. Nhà rủi ro: có tầng hầm và nằm trong 30 m quanh hố ga tràn, HOẶC cao độ nền < mực nước
create or replace function public.q6_basement_risk(p_water_level numeric default null, p_scenario_id int default null,
                                                   p_at timestamptz default null, p_radius_m numeric default 30)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with ovf as (
    select mh.id, mh.code, mh.geom
      from public.manholes mh
     where mh.valid_to is null and mh.tx_to is null
       and mh.rim_elev_m < public.water_level_at(mh.geom, p_scenario_id, p_water_level, p_at)
  ), b as (
    select bd.*, public.water_level_at(ST_Centroid(bd.geom), p_scenario_id, p_water_level, p_at) as lvl,
           -- các hố ga tràn trong bán kính p_radius_m (ST_DWithin dùng index GIST)
           (select jsonb_agg(o.code) from ovf o where ST_DWithin(bd.geom, o.geom, p_radius_m)) as near_ovf
      from public.buildings bd where bd.valid_to is null and bd.tx_to is null
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(b.geom, jsonb_build_object(
           'layer', 'building', 'id', b.id, 'name', b.name, 'has_basement', b.has_basement,
           'base_elev_m', b.base_elev_m, 'water_level_m', b.lvl, 'near_overflow_manholes', b.near_ovf,
           'reasons', to_jsonb(array_remove(array[
               case when b.has_basement and b.near_ovf is not null then 'Tầng hầm gần hố ga tràn' end,
               case when b.base_elev_m < b.lvl then 'Nền thấp hơn mực nước' end], null))),
           'building:' || b.id) order by b.id),
           jsonb_build_object('query', 'Q6', 'count', count(*), 'radius_m', p_radius_m,
                              'overflow_manholes', (select count(*) from ovf)))
    into r
    from b where (b.has_basement and b.near_ovf is not null) or b.base_elev_m < b.lvl;
  return r;
end $$;

-- Q7. Hố ga gần nhất (KNN, toán tử <-> dùng index GIST) từ điểm ngập / điểm báo cáo / điểm tùy ý
create or replace function public.q7_nearest_manhole(p_source text default 'flood', p_lon double precision default null,
                                                     p_lat double precision default null, p_k int default 1)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with src as (
    select 'flood:' || f.id as sid, f.name as label, f.geom from public.flood_points f where p_source = 'flood'
    union all
    select 'incident:' || i.id, i.kind::text || ' #' || i.id, i.geom from public.incident_reports i
     where p_source = 'incident' and i.status <> 'resolved'
    union all
    select 'point', 'Điểm chọn', ST_Transform(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), 32648)
     where p_source = 'point' and p_lon is not null
  ), nn as (
    select s.sid, s.label, s.geom as sgeom, m.id, m.code, m.geom as mgeom, m.dist,
           row_number() over (partition by s.sid order by m.dist) as rk
      from src s
      cross join lateral (
        select mh.id, mh.code, mh.geom,
               ST_Distance(ST_Force2D(mh.geom), s.geom) as dist
          from public.manholes mh
         where mh.valid_to is null and mh.tx_to is null
         order by mh.geom <-> s.geom    -- KNN
         limit greatest(p_k, 1)) m
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(ST_MakeLine(nn.sgeom, ST_Force2D(nn.mgeom)), jsonb_build_object(
           'layer', 'knn', 'source', nn.sid, 'label', nn.label, 'manhole_id', nn.id, 'manhole_code', nn.code,
           'rank', nn.rk, 'distance_m', round(nn.dist::numeric, 2)), nn.sid || '>' || nn.id) order by nn.sid, nn.rk),
           jsonb_build_object('query', 'Q7', 'source', p_source, 'k', p_k, 'count', count(*)))
    into r from nn;
  return r;
end $$;

-- Q8. Quá tải: lưu vực mỗi hố ga = đa giác Voronoi cắt theo phạm vi;
--     Q_in = C·i·A/3,6e6 (m³/s); lưu lượng cống = tổng Q_in của mọi hố ga thượng lưu;
--     so sánh với sức chứa Manning.
create or replace function public.q8_overload(p_intensity_mm_h numeric default null, p_scenario_id int default null,
                                              p_c numeric default 0.8)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare
  v_i numeric := p_intensity_mm_h;
  r jsonb;
begin
  perform public.assert_staff();
  if v_i is null and p_scenario_id is not null then
    select intensity_mm_h into v_i from public.rain_scenarios where id = p_scenario_id;
  end if;
  if v_i is null then raise exception 'Cần p_intensity_mm_h hoặc p_scenario_id'; end if;

  with recursive mh as (
    select id, code, ST_Force2D(geom) as g from public.manholes where valid_to is null and tx_to is null
  ), area as (
    select ST_Union(geom) as g from public.zones          -- phạm vi nghiên cứu
  ), vor as (
    -- Đa giác Voronoi của tập hố ga, mở rộng tới bao phạm vi
    select (ST_Dump(ST_VoronoiPolygons(ST_Collect(mh.g), 0.0, (select g from area)))).geom as cell
      from mh
  ), catch as (
    -- gán ô Voronoi cho hố ga nằm trong nó, cắt theo phạm vi nghiên cứu
    select m.id as mh_id, m.code, ST_Intersection(v.cell, a.g) as g
      from vor v
      join mh m on ST_Intersects(v.cell, m.g)
      cross join area a
  ), qin as (
    select mh_id, code, g, ST_Area(g) as area_m2,
           p_c * v_i * ST_Area(g) / 3.6e6 as q_in      -- Q = C·i·A / 3,6·10^6
      from catch
  ), cur as (
    select p.*, pm.manning_n from public.pipes p join public.pipe_materials pm on pm.code = p.material_code
     where p.valid_to is null and p.tx_to is null
  ), nout as (
    select from_mh, count(*)::double precision as n from cur group by from_mh
  ), up(pipe_id, mh_id, frac, lvl) as (
    -- Định tuyến dòng chảy trên đồ thị có hướng: cống nhận phần lưu lượng của hố ga đầu cống
    -- (chia đều cho các cống ra) và, đệ quy, của mọi hố ga thượng lưu (nhân dồn tỉ lệ chia)
    select c.id, c.from_mh, 1.0 / n.n, 0
      from cur c join nout n on n.from_mh = c.from_mh
    union all
    select u.pipe_id, c.from_mh, u.frac / n.n, u.lvl + 1
      from up u
      join cur c on c.to_mh = u.mh_id
      join nout n on n.from_mh = c.from_mh
     where u.lvl < 300
  ), flow as (
    select u.pipe_id, sum(u.frac * q.q_in) as q_in, count(distinct u.mh_id) as n_mh,
           sum(u.frac * q.area_m2) as area_m2
      from up u join qin q on q.mh_id = u.mh_id group by u.pipe_id
  ), res as (
    select c.*, f.q_in, f.n_mh, f.area_m2,
           public.manning_capacity(c.diameter_mm, c.slope, c.manning_n) as q_cap
      from cur c left join flow f on f.pipe_id = c.id
  )
  select public.gj_fc(
           coalesce((select jsonb_agg(public.gj_feature(res.geom, jsonb_build_object(
               'layer', 'pipe', 'id', res.id, 'code', res.code, 'diameter_mm', res.diameter_mm, 'slope', res.slope,
               'q_in_m3s', round(coalesce(res.q_in, 0)::numeric, 4), 'q_cap_m3s', round(res.q_cap::numeric, 4),
               'ratio', case when res.q_cap > 0 then round((coalesce(res.q_in, 0) / res.q_cap)::numeric, 3) end,
               'overloaded', coalesce(res.q_in, 0) > res.q_cap, 'upstream_manholes', res.n_mh,
               'catchment_m2', round(coalesce(res.area_m2, 0)::numeric, 0)), 'pipe:' || res.id)) from res), '[]')
           ||
           coalesce((select jsonb_agg(public.gj_feature(q.g, jsonb_build_object(
               'layer', 'catchment', 'manhole_id', q.mh_id, 'code', q.code,
               'area_m2', round(q.area_m2::numeric, 1), 'q_in_m3s', round(q.q_in::numeric, 5)),
               'catchment:' || q.mh_id)) from qin q), '[]'),
           jsonb_build_object('query', 'Q8', 'intensity_mm_h', v_i, 'C', p_c,
                              'overloaded', (select count(*) from res where coalesce(q_in, 0) > q_cap),
                              'pipes', (select count(*) from res),
                              'total_area_m2', (select round(sum(area_m2)::numeric) from qin)))
    into r;
  return r;
end $$;

-- Q9. Trạng thái mạng cống tại ngày T (valid time) theo hiểu biết của CSDL tại p_tx (transaction time)
--     + lịch sử sự kiện tính đến T
create or replace function public.q9_as_of_date(p_date timestamptz, p_tx timestamptz default now())
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with p as (
    select * from public.pipes
     where valid_from <= p_date and (valid_to is null or valid_to > p_date)
       and tx_from   <= p_tx   and (tx_to    is null or tx_to    > p_tx)
  ), m as (
    select * from public.manholes
     where valid_from <= p_date and (valid_to is null or valid_to > p_date)
       and tx_from   <= p_tx   and (tx_to    is null or tx_to    > p_tx)
  )
  select public.gj_fc(
    coalesce((select jsonb_agg(public.gj_feature(p.geom, jsonb_build_object(
        'layer', 'pipe', 'id', p.id, 'vid', p.vid, 'code', p.code, 'diameter_mm', p.diameter_mm,
        'status', p.status, 'valid_from', p.valid_from, 'valid_to', p.valid_to,
        'tx_from', p.tx_from, 'tx_to', p.tx_to), 'pipe:' || p.id)) from p), '[]')
    ||
    coalesce((select jsonb_agg(public.gj_feature(m.geom, jsonb_build_object(
        'layer', 'manhole', 'id', m.id, 'vid', m.vid, 'code', m.code, 'status', m.status,
        'valid_from', m.valid_from, 'valid_to', m.valid_to), 'manhole:' || m.id)) from m), '[]'),
    jsonb_build_object('query', 'Q9', 'date', p_date, 'tx', p_tx,
      'pipes', (select count(*) from p), 'manholes', (select count(*) from m),
      'events', coalesce((select jsonb_agg(e order by e.valid_time desc) from (
          select ae.id, ae.asset_type, ae.asset_id, ae.event_type, ae.detail, ae.valid_time, ae.tx_time
            from public.asset_events ae
           where ae.valid_time <= p_date and ae.tx_time <= p_tx
           order by ae.valid_time desc limit 100) e), '[]')))
    into r;
  return r;
end $$;

-- Q10. SLA sự cố theo khu: thời gian phản hồi (tạo → nhận) và xử lý (tạo → xong), ST_Within
create or replace function public.q10_incident_sla(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with s as (
    select z.id, z.name, z.geom,
           count(i.id) as total,
           count(i.resolved_at) as resolved,
           count(*) filter (where i.id is not null and i.status not in ('resolved', 'rejected')) as open,
           avg(extract(epoch from i.accepted_at - i.created_at)) / 60   as avg_response_min,
           avg(extract(epoch from i.resolved_at - i.created_at)) / 3600 as avg_resolution_h,
           percentile_cont(0.9) within group (order by extract(epoch from i.resolved_at - i.created_at) / 3600)
             as p90_resolution_h
      from public.zones z
      left join public.incident_reports i
        on ST_Within(i.geom, z.geom)
       and (p_from is null or i.created_at >= p_from)
       and (p_to   is null or i.created_at <  p_to)
     group by z.id, z.name, z.geom
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(s.geom, jsonb_build_object(
           'layer', 'zone', 'id', s.id, 'name', s.name, 'total', s.total, 'resolved', s.resolved, 'open', s.open,
           'avg_response_min', round(s.avg_response_min::numeric, 1),
           'avg_resolution_h', round(s.avg_resolution_h::numeric, 2),
           'p90_resolution_h', round(s.p90_resolution_h::numeric, 2)), 'zone:' || s.id) order by s.id),
           jsonb_build_object('query', 'Q10', 'from', p_from, 'to', p_to))
    into r from s;
  return r;
end $$;

-- Q11. Mặt cắt dọc tuyến cống: đi theo hạ lưu từ hố ga p_from_mh tới p_to_mh (hoặc cửa xả),
--      lấy mẫu mỗi p_step_m mét: cao độ mặt đất (nội suy TIN), cao độ đáy & đỉnh ống
create or replace function public.q11_pipe_profile(p_from_mh bigint, p_to_mh bigint default null,
                                                   p_step_m numeric default 5)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with recursive cur as (
    select * from public.pipes where valid_to is null and tx_to is null
  ), route(step, pipe_id, to_mh, path) as (
    select 1, f.id, f.to_mh, array[f.id]
      from (select c.* from cur c where c.from_mh = p_from_mh order by c.down_invert_m limit 1) f
    union all
    select r.step + 1, n.id, n.to_mh, r.path || n.id
      from route r
      cross join lateral (select c.* from cur c
                           where c.from_mh = r.to_mh and not c.id = any(r.path)
                           order by c.down_invert_m limit 1) n
     where r.to_mh is distinct from p_to_mh and r.step < 200
  ), seg as (
    select r.step, c.*, ST_Length(c.geom) as len2d,
           coalesce(sum(ST_Length(c.geom)) over (order by r.step rows between unbounded preceding and 1 preceding), 0) as offset_m
      from route r join cur c on c.id = r.pipe_id
  ), samples as (
    select s.step, s.id as pipe_id, s.code, s.diameter_mm, s.offset_m, s.len2d,
           least(d, s.len2d) as d_local,
           ST_LineInterpolatePoint(s.geom, least(d, s.len2d) / nullif(s.len2d, 0)) as pt
      from seg s
      cross join lateral (select generate_series(0, ceil(s.len2d / p_step_m)::int) * p_step_m::double precision as d) g
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(ST_Force2D(sm.pt), jsonb_build_object(
           'dist_m', round((sm.offset_m + sm.d_local)::numeric, 2),
           'ground_m', round(public.tin_elev(sm.pt)::numeric, 3),
           'invert_m', round(ST_Z(sm.pt)::numeric, 3),
           'crown_m', round((ST_Z(sm.pt) + sm.diameter_mm / 1000.0)::numeric, 3),
           'pipe_id', sm.pipe_id, 'pipe_code', sm.code, 'step', sm.step)) order by sm.offset_m + sm.d_local),
           jsonb_build_object('query', 'Q11', 'from_mh', p_from_mh, 'to_mh', p_to_mh,
             'route', (select jsonb_agg(jsonb_build_object('step', s.step, 'pipe_id', s.id, 'code', s.code,
                         'from_mh', s.from_mh, 'to_mh', s.to_mh, 'diameter_mm', s.diameter_mm, 'slope', s.slope,
                         'offset_m', round(s.offset_m::numeric, 2), 'length_m', round(s.len2d::numeric, 2),
                         'rim_from', (select rim_elev_m from public.manholes m where m.id = s.from_mh and m.valid_to is null and m.tx_to is null),
                         'rim_to',   (select rim_elev_m from public.manholes m where m.id = s.to_mh   and m.valid_to is null and m.tx_to is null))
                         order by s.step) from seg s)))
    into r from samples sm;
  return r;
end $$;

-- Q12. Đặt lỗi lòng cống lên ống 3D: ST_LineInterpolatePoint(geom, chainage_m / length_m),
--      nâng lên tim ống (+D/2) để marker nằm trong lòng ống
create or replace function public.q12_defect_points(p_pipe_id bigint default null, p_min_severity int default 1)
returns jsonb language plpgsql stable
set search_path = public, extensions as $$
declare r jsonb;
begin
  perform public.assert_staff();
  with d as (
    select df.*, i.inspected_at, i.grade, p.id as pipe_id, p.code as pipe_code, p.diameter_mm, p.length_m,
           ST_Translate(
             ST_LineInterpolatePoint(p.geom, least(greatest(df.chainage_m / nullif(p.length_m, 0), 0), 1)),
             0, 0, p.diameter_mm / 2000.0) as pt
      from public.defects df
      join public.inspections i on i.id = df.inspection_id
      join public.pipes p on p.id = i.pipe_id and p.valid_to is null and p.tx_to is null
     where (p_pipe_id is null or p.id = p_pipe_id) and df.severity >= p_min_severity
  )
  select public.gj_fc(jsonb_agg(public.gj_feature(d.pt, jsonb_build_object(
           'layer', 'defect', 'id', d.id, 'type', d.type, 'severity', d.severity, 'chainage_m', d.chainage_m,
           'pipe_id', d.pipe_id, 'pipe_code', d.pipe_code, 'length_m', d.length_m, 'diameter_mm', d.diameter_mm,
           'inspected_at', d.inspected_at, 'grade', d.grade), 'defect:' || d.id) order by d.severity desc),
           jsonb_build_object('query', 'Q12', 'count', count(*), 'pipe_id', p_pipe_id))
    into r from d;
  return r;
end $$;

-- =====================================================================
-- C. CHỈNH SỬA (CRUD) – RLS + trigger topology vẫn áp dụng; lỗi trả về nguyên văn
-- =====================================================================
-- Sinh cây CSG cho hố ga: union( difference(trụ ngoài, trụ trong), nắp )
create or replace function public.build_manhole_csg(p_manhole_id bigint)
returns void language plpgsql
set search_path = public, extensions as $$
declare
  m public.manholes; v_root int; v_diff int;
  r_in numeric; r_out numeric;
begin
  select * into m from public.manholes where id = p_manhole_id and valid_to is null and tx_to is null;
  if not found then raise exception 'Không có hố ga %', p_manhole_id; end if;
  delete from public.csg_node where manhole_id = p_manhole_id;
  r_in := m.diameter_m / 2; r_out := r_in + 0.15;  -- thành BTCT dày 15 cm
  insert into public.csg_node (manhole_id, parent_id, ord, op) values (m.id, null, 0, 'union') returning id into v_root;
  insert into public.csg_node (manhole_id, parent_id, ord, op) values (m.id, v_root, 0, 'difference') returning id into v_diff;
  insert into public.csg_node (manhole_id, parent_id, ord, op, primitive, params) values
    -- trụ ngoài: từ đáy móng (invert − 0,2 m) tới mặt nắp
    (m.id, v_diff, 0, 'primitive', 'cylinder', jsonb_build_object('radius', r_out,
        'z0', m.invert_elev_m - 0.2, 'height', m.rim_elev_m - m.invert_elev_m + 0.2, 'role', 'outer')),
    -- trụ trong (lòng hố): từ cao độ đáy, xuyên qua mặt trên
    (m.id, v_diff, 1, 'primitive', 'cylinder', jsonb_build_object('radius', r_in,
        'z0', m.invert_elev_m, 'height', m.rim_elev_m - m.invert_elev_m + 0.1, 'role', 'inner'));
  -- nắp gang Ø700, dày 5 cm
  insert into public.csg_node (manhole_id, parent_id, ord, op, primitive, params) values
    (m.id, v_root, 1, 'primitive', 'cylinder', jsonb_build_object('radius', least(0.35, r_in - 0.02),
        'z0', m.rim_elev_m - 0.05, 'height', 0.05, 'role', 'cover'));
end $$;

create or replace function public.create_manhole(
  p_lon double precision, p_lat double precision, p_code text default null,
  p_kind public.manhole_kind default 'manhole', p_depth_m numeric default 2.0,
  p_diameter_m numeric default 1.0, p_rim_elev_m numeric default null,
  p_material text default 'BTCT', p_status public.asset_status default 'active')
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare
  g geometry := ST_Transform(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), 32648);
  v_rim numeric; m public.manholes; v_id bigint := nextval('public.manholes_id_seq');
begin
  -- cao độ nắp: nội suy từ TIN nếu không nhập
  v_rim := coalesce(p_rim_elev_m, round(public.tin_elev(g)::numeric, 3));
  if v_rim is null then raise exception 'Không nội suy được cao độ nắp (chưa có TIN)'; end if;
  insert into public.manholes (id, code, kind, rim_elev_m, invert_elev_m, diameter_m, material, status, geom, created_by)
  values (v_id, coalesce(p_code, 'MH-N' || v_id), p_kind, v_rim, v_rim - p_depth_m,
          p_diameter_m, p_material, p_status, ST_Force3D(g, v_rim::double precision), auth.uid())
  returning * into m;
  perform public.build_manhole_csg(m.id);
  return to_jsonb(m) - 'geom';
end $$;

create or replace function public.update_manhole(p_id bigint, p_changes jsonb)
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare m public.manholes; c jsonb := coalesce(p_changes, '{}');
begin
  update public.manholes set
    code          = coalesce(c ->> 'code', code),
    kind          = coalesce((c ->> 'kind')::public.manhole_kind, kind),
    rim_elev_m    = coalesce((c ->> 'rim_elev_m')::numeric, rim_elev_m),
    invert_elev_m = coalesce((c ->> 'invert_elev_m')::numeric, invert_elev_m),
    diameter_m    = coalesce((c ->> 'diameter_m')::numeric, diameter_m),
    material      = coalesce(c ->> 'material', material),
    status        = coalesce((c ->> 'status')::public.asset_status, status),
    valid_from    = coalesce((c ->> 'valid_from')::timestamptz, valid_from),
    geom          = case when c ? 'lon' and c ? 'lat'
                      then ST_Force3D(ST_Transform(ST_SetSRID(ST_MakePoint((c ->> 'lon')::float8, (c ->> 'lat')::float8), 4326), 32648))
                      else geom end
  where id = p_id and valid_to is null and tx_to is null
  returning * into m;
  if not found then
    raise exception 'RLS: không có quyền sửa hố ga id=% (ngoài khu phụ trách) hoặc không tồn tại', p_id
      using errcode = '42501';
  end if;
  if c ?| array['rim_elev_m', 'invert_elev_m', 'diameter_m'] then
    perform public.build_manhole_csg(m.id);
  end if;
  return to_jsonb(m) - 'geom';
end $$;

create or replace function public.create_pipe(
  p_from_mh bigint, p_to_mh bigint, p_diameter_mm int, p_material_code text default 'BTCT',
  p_code text default null, p_up_invert_m numeric default null, p_down_invert_m numeric default null,
  p_install_year int default extract(year from now())::int)
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare
  mf public.manholes; mt public.manholes; p public.pipes; v_id bigint := nextval('public.pipes_id_seq');
begin
  select * into mf from public.manholes where id = p_from_mh and valid_to is null and tx_to is null;
  select * into mt from public.manholes where id = p_to_mh   and valid_to is null and tx_to is null;
  if mf.id is null or mt.id is null then
    raise exception 'TOPOLOGY: không tìm thấy hố ga đầu/cuối (hoặc không có quyền xem)' using errcode = '23503';
  end if;
  insert into public.pipes (id, code, from_mh, to_mh, diameter_mm, material_code, install_year, geom, created_by)
  values (v_id, coalesce(p_code, 'P-N' || v_id), p_from_mh, p_to_mh, p_diameter_mm,
          p_material_code, p_install_year,
          ST_SetSRID(ST_MakeLine(
            ST_MakePoint(ST_X(mf.geom), ST_Y(mf.geom), coalesce(p_up_invert_m, mf.invert_elev_m)::float8),
            ST_MakePoint(ST_X(mt.geom), ST_Y(mt.geom), coalesce(p_down_invert_m, mt.invert_elev_m)::float8)), 32648),
          auth.uid())
  returning * into p;
  return to_jsonb(p) - 'geom';
end $$;

create or replace function public.update_pipe(p_id bigint, p_changes jsonb)
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare p public.pipes; c jsonb := coalesce(p_changes, '{}');
begin
  update public.pipes set
    code          = coalesce(c ->> 'code', code),
    diameter_mm   = coalesce((c ->> 'diameter_mm')::int, diameter_mm),
    material_code = coalesce(c ->> 'material_code', material_code),
    status        = coalesce((c ->> 'status')::public.asset_status, status),
    install_year  = coalesce((c ->> 'install_year')::int, install_year),
    valid_from    = coalesce((c ->> 'valid_from')::timestamptz, valid_from),
    geom          = case when c ? 'up_invert_m' or c ? 'down_invert_m' then
                      ST_SetSRID(ST_MakeLine(
                        ST_MakePoint(ST_X(ST_StartPoint(geom)), ST_Y(ST_StartPoint(geom)),
                                     coalesce((c ->> 'up_invert_m')::float8, ST_Z(ST_StartPoint(geom)))),
                        ST_MakePoint(ST_X(ST_EndPoint(geom)), ST_Y(ST_EndPoint(geom)),
                                     coalesce((c ->> 'down_invert_m')::float8, ST_Z(ST_EndPoint(geom))))), 32648)
                    else geom end
  where id = p_id and valid_to is null and tx_to is null
  returning * into p;
  if not found then
    raise exception 'RLS: không có quyền sửa cống id=% (ngoài khu phụ trách) hoặc không tồn tại', p_id
      using errcode = '42501';
  end if;
  return to_jsonb(p) - 'geom';
end $$;

create or replace function public.delete_asset(p_asset_type text, p_id bigint)
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare n int;
begin
  if p_asset_type = 'pipe' then
    delete from public.pipes where id = p_id and valid_to is null and tx_to is null;
    get diagnostics n = row_count;
  elsif p_asset_type = 'manhole' then
    delete from public.manholes where id = p_id and valid_to is null and tx_to is null;
    get diagnostics n = row_count;
    if n > 0 then delete from public.csg_node where manhole_id = p_id; end if;
  else
    raise exception 'asset_type phải là pipe hoặc manhole';
  end if;
  if n = 0 then
    raise exception 'RLS: không có quyền xóa % id=% (ngoài khu phụ trách) hoặc không tồn tại', p_asset_type, p_id
      using errcode = '42501';
  end if;
  return jsonb_build_object('deleted', n, 'asset_type', p_asset_type, 'id', p_id);
end $$;

-- =====================================================================
-- D. QUY TRÌNH SỰ CỐ
-- =====================================================================
create or replace function public.create_incident(p_kind public.incident_kind, p_lon double precision,
                                                  p_lat double precision, p_note text default null,
                                                  p_image_path text default null)
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare i public.incident_reports;
begin
  if auth.uid() is null then raise exception 'Cần đăng nhập để báo sự cố' using errcode = '42501'; end if;
  insert into public.incident_reports (user_id, kind, note, image_path, geom)
  values (auth.uid(), p_kind, p_note, p_image_path,
          ST_Transform(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), 32648))
  returning * into i;
  return to_jsonb(i) - 'geom';
end $$;

create or replace function public.incident_set_status(p_id bigint, p_status public.incident_status,
                                                      p_note text default null)
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare i public.incident_reports;
begin
  if not public.is_staff() then
    raise exception 'RLS: chỉ technician/admin xử lý sự cố' using errcode = '42501';
  end if;
  update public.incident_reports set
    status = p_status,
    technician_id = coalesce(technician_id, auth.uid()),
    note = case when p_note is not null then coalesce(note || E'\n', '') || '[KT] ' || p_note else note end
  where id = p_id
  returning * into i;
  if not found then
    raise exception 'RLS: không cập nhật được sự cố % (đã có người khác nhận hoặc không tồn tại)', p_id
      using errcode = '42501';
  end if;
  return to_jsonb(i) - 'geom';
end $$;

create or replace function public.incident_accept(p_id bigint) returns jsonb language sql
set search_path = public, extensions as $$ select public.incident_set_status(p_id, 'accepted'); $$;
create or replace function public.incident_arrive(p_id bigint) returns jsonb language sql
set search_path = public, extensions as $$ select public.incident_set_status(p_id, 'in_progress'); $$;
create or replace function public.incident_resolve(p_id bigint, p_note text default null) returns jsonb language sql
set search_path = public, extensions as $$ select public.incident_set_status(p_id, 'resolved', p_note); $$;

-- =====================================================================
-- E. QUẢN TRỊ
-- =====================================================================
create or replace function public.admin_list_users()
returns table (id uuid, email text, role public.user_role, full_name text, zone_ids int[], created_at timestamptz)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not public.is_role('admin') then
    raise exception 'RLS: chỉ admin' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.role, p.full_name,
           coalesce((select array_agg(uz.zone_id order by uz.zone_id) from public.user_zones uz where uz.user_id = p.id), '{}'),
           p.created_at
      from public.profiles p join auth.users u on u.id = p.id
     order by p.role desc, u.email;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void language plpgsql
set search_path = public, extensions as $$
begin
  update public.profiles set role = p_role where id = p_user;
  if not found then raise exception 'RLS: chỉ admin được đổi vai trò' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_set_user_zones(p_user uuid, p_zone_ids int[])
returns void language plpgsql
set search_path = public, extensions as $$
begin
  if not public.is_role('admin') then raise exception 'RLS: chỉ admin' using errcode = '42501'; end if;
  delete from public.user_zones where user_id = p_user;
  insert into public.user_zones (user_id, zone_id) select p_user, unnest(p_zone_ids);
end $$;

-- p_geojson: Polygon GeoJSON ở EPSG:4326
create or replace function public.admin_upsert_zone(p_id int, p_name text, p_geojson jsonb)
returns jsonb language plpgsql
set search_path = public, extensions as $$
declare z public.zones;
  g geometry := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326), 32648);
begin
  if not public.is_role('admin') then raise exception 'RLS: chỉ admin' using errcode = '42501'; end if;
  if not ST_IsValid(g) then raise exception 'Đa giác khu không hợp lệ: %', ST_IsValidReason(g); end if;
  if p_id is null then
    insert into public.zones (name, geom) values (p_name, g) returning * into z;
  else
    update public.zones set name = coalesce(p_name, name), geom = g where id = p_id returning * into z;
  end if;
  return to_jsonb(z) - 'geom';
end $$;

-- =====================================================================
-- F. QUYỀN THỰC THI
-- =====================================================================
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- khách chỉ dùng được lớp công khai và điểm ngập (+ hàm GeoJSON phụ trợ)
grant execute on function public.layer_public(), public.layer_flood_points(),
  public.gj_feature(geometry, jsonb, text), public.gj_fc(jsonb, jsonb) to anon;
