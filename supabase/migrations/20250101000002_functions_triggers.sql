-- =====================================================================
-- Migration 2: hàm tiện ích, phân quyền, trigger topology / versioning / audit
-- =====================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Hàm vai trò / khu phụ trách (SECURITY DEFINER để tránh đệ quy RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_role(p_role text)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role::text = p_role);
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('technician', 'admin'));
$$;

-- Hình học g có NẰM TRONG (ST_Within) một khu phụ trách của user hiện tại không
create or replace function public.in_my_zone(g geometry)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (
    select 1
    from public.user_zones uz
    join public.zones z on z.id = uz.zone_id
    where uz.user_id = auth.uid()
      and ST_Within(ST_Force2D(g), z.geom)   -- so sánh trên mặt bằng 2D
  );
$$;

-- ---------------------------------------------------------------------
-- Hàm GIS dùng chung
-- ---------------------------------------------------------------------
-- Cao độ mặt đất tại điểm p, nội suy tuyến tính trên tam giác TIN chứa p
-- (tọa độ barycentric). Ngoài bao lồi TIN thì lấy điểm cao độ gần nhất (KNN).
create or replace function public.tin_elev(p geometry)
returns double precision language plpgsql stable
set search_path = public, extensions as $$
declare
  t geometry; a geometry; b geometry; c geometry;
  x double precision := ST_X(p); y double precision := ST_Y(p);
  det double precision; l1 double precision; l2 double precision;
begin
  if ST_SRID(p) <> 32648 then
    p := ST_Transform(p, 32648); x := ST_X(p); y := ST_Y(p);
  end if;
  -- tìm tam giác chứa điểm (index GIST trên terrain_tin)
  select geom into t from public.terrain_tin
   where ST_Intersects(geom, ST_Force2D(p)) limit 1;
  if t is null then
    return (select ST_Z(geom) from public.terrain_points
            order by geom <-> ST_Force2D(p) limit 1);
  end if;
  a := ST_PointN(ST_ExteriorRing(t), 1);
  b := ST_PointN(ST_ExteriorRing(t), 2);
  c := ST_PointN(ST_ExteriorRing(t), 3);
  det := (ST_Y(b) - ST_Y(c)) * (ST_X(a) - ST_X(c)) + (ST_X(c) - ST_X(b)) * (ST_Y(a) - ST_Y(c));
  if abs(det) < 1e-9 then return ST_Z(a); end if;
  l1 := ((ST_Y(b) - ST_Y(c)) * (x - ST_X(c)) + (ST_X(c) - ST_X(b)) * (y - ST_Y(c))) / det;
  l2 := ((ST_Y(c) - ST_Y(a)) * (x - ST_X(c)) + (ST_X(a) - ST_X(c)) * (y - ST_Y(c))) / det;
  return l1 * ST_Z(a) + l2 * ST_Z(b) + (1 - l1 - l2) * ST_Z(c);
end $$;

-- Sức chứa ống tròn chảy đầy theo Manning (m³/s):
--   Q = (1/n) · (πD²/4) · (D/4)^(2/3) · √S       (D tính bằng m)
create or replace function public.manning_capacity(d_mm numeric, slope numeric, n numeric)
returns double precision language sql immutable as $$
  select case
    when d_mm is null or n is null or n <= 0 or slope is null or slope <= 0 then 0::double precision
    else (1.0 / n::double precision)
         * (pi() * power(d_mm::double precision / 1000, 2) / 4)
         * power((d_mm::double precision / 1000) / 4, 2.0 / 3)
         * sqrt(slope::double precision)
  end;
$$;

-- Tạo Feature GeoJSON (tọa độ chuyển về EPSG:4326, giữ Z)
create or replace function public.gj_feature(g geometry, props jsonb, fid text default null)
returns jsonb language sql stable
set search_path = public, extensions as $$
  select jsonb_build_object(
    'type', 'Feature',
    'id', fid,
    'geometry', ST_AsGeoJSON(ST_Transform(g, 4326), 8)::jsonb,
    'properties', coalesce(props, '{}'::jsonb));
$$;

create or replace function public.gj_fc(features jsonb, meta jsonb default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'FeatureCollection',
                            'features', coalesce(features, '[]'::jsonb))
         || coalesce(jsonb_build_object('meta', meta), '{}'::jsonb);
$$;

-- ---------------------------------------------------------------------
-- profiles: tự tạo khi đăng ký, chặn tự nâng quyền
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
begin
  insert into public.profiles (id, role, full_name)
  values (new.id, 'citizen', coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.trg_protect_profile_role()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
begin
  -- auth.uid() null = chạy bằng service/migration/seed
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_role('admin') then
    raise exception 'RLS: chỉ admin được đổi vai trò người dùng' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger t10_protect_role before update on public.profiles
  for each row execute function public.trg_protect_profile_role();

-- ---------------------------------------------------------------------
-- TOPOLOGY cống: đầu/cuối cống phải trùng hố ga from/to (≤ 0,5 m mặt bằng)
-- và cao độ đầu cống phải nằm trong lòng hố ga. Tự tính các thuộc tính dẫn xuất.
-- ---------------------------------------------------------------------
create or replace function public.trg_pipe_topology()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  mf public.manholes; mt public.manholes;
  p_start geometry; p_end geometry;
  d_up double precision; d_dn double precision; len2d double precision;
begin
  -- bản ghi lịch sử do versioning sinh ra: không kiểm tra lại
  if new.valid_to is not null or new.tx_to is not null then return new; end if;

  select * into mf from public.manholes
   where id = new.from_mh and valid_to is null and tx_to is null;
  if not found then
    raise exception 'TOPOLOGY: hố ga thượng lưu from_mh=% không tồn tại', new.from_mh using errcode = '23503';
  end if;
  select * into mt from public.manholes
   where id = new.to_mh and valid_to is null and tx_to is null;
  if not found then
    raise exception 'TOPOLOGY: hố ga hạ lưu to_mh=% không tồn tại', new.to_mh using errcode = '23503';
  end if;

  if ST_NPoints(new.geom) < 2 or not ST_IsValid(new.geom) then
    raise exception 'TOPOLOGY: hình học cống không hợp lệ' using errcode = '22023';
  end if;

  p_start := ST_StartPoint(new.geom);
  p_end   := ST_EndPoint(new.geom);

  -- Khoảng cách MẶT BẰNG từ đầu cống tới tâm hố ga (Z của hố ga là cao độ nắp,
  -- Z của cống là cao độ đáy nên không dùng khoảng cách 3D ở đây)
  d_up := ST_Distance(ST_Force2D(p_start), ST_Force2D(mf.geom));
  d_dn := ST_Distance(ST_Force2D(p_end),   ST_Force2D(mt.geom));
  if d_up > 0.5 then
    raise exception 'TOPOLOGY: điểm đầu cống % cách hố ga % là % m (> 0,5 m)',
      new.code, mf.code, round(d_up::numeric, 2) using errcode = '23514';
  end if;
  if d_dn > 0.5 then
    raise exception 'TOPOLOGY: điểm cuối cống % cách hố ga % là % m (> 0,5 m)',
      new.code, mt.code, round(d_dn::numeric, 2) using errcode = '23514';
  end if;

  -- Cao độ đáy đầu cống phải nằm giữa đáy và nắp hố ga (dung sai 5 cm)
  if ST_Z(p_start) < mf.invert_elev_m - 0.05 or ST_Z(p_start) > mf.rim_elev_m then
    raise exception 'TOPOLOGY: cao độ đầu cống (% m) nằm ngoài lòng hố ga % [% ; %]',
      round(ST_Z(p_start)::numeric, 3), mf.code, mf.invert_elev_m, mf.rim_elev_m using errcode = '23514';
  end if;
  if ST_Z(p_end) < mt.invert_elev_m - 0.05 or ST_Z(p_end) > mt.rim_elev_m then
    raise exception 'TOPOLOGY: cao độ cuối cống (% m) nằm ngoài lòng hố ga % [% ; %]',
      round(ST_Z(p_end)::numeric, 3), mt.code, mt.invert_elev_m, mt.rim_elev_m using errcode = '23514';
  end if;

  -- Thuộc tính dẫn xuất từ hình học 3D
  new.up_invert_m   := round(ST_Z(p_start)::numeric, 3);
  new.down_invert_m := round(ST_Z(p_end)::numeric, 3);
  new.length_m      := round(ST_3DLength(new.geom)::numeric, 3);
  len2d             := ST_Length(new.geom);
  new.slope         := round(((ST_Z(p_start) - ST_Z(p_end)) / nullif(len2d, 0))::numeric, 6);
  return new;
end $$;

create trigger t10_pipe_topology
  before insert or update of geom, from_mh, to_mh on public.pipes
  for each row execute function public.trg_pipe_topology();

-- Hố ga: không được di chuyển/xóa làm "hở" các cống đang nối vào
create or replace function public.trg_manhole_topology()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_bad text;
begin
  if tg_op = 'DELETE' then
    if old.valid_to is null and old.tx_to is null and exists (
      select 1 from public.pipes p
       where p.valid_to is null and p.tx_to is null
         and (p.from_mh = old.id or p.to_mh = old.id)) then
      raise exception 'TOPOLOGY: hố ga % còn cống nối vào, hãy xóa cống trước', old.code using errcode = '23503';
    end if;
    return old;
  end if;

  if new.valid_to is not null or new.tx_to is not null then return new; end if;

  if tg_op = 'UPDATE' and (new.geom is distinct from old.geom or new.invert_elev_m is distinct from old.invert_elev_m
                           or new.rim_elev_m is distinct from old.rim_elev_m) then
    select string_agg(p.code, ', ') into v_bad
      from public.pipes p
     where p.valid_to is null and p.tx_to is null
       and ((p.from_mh = new.id and (ST_Distance(ST_Force2D(ST_StartPoint(p.geom)), ST_Force2D(new.geom)) > 0.5
                                     or p.up_invert_m < new.invert_elev_m - 0.05 or p.up_invert_m > new.rim_elev_m))
         or (p.to_mh = new.id and (ST_Distance(ST_Force2D(ST_EndPoint(p.geom)), ST_Force2D(new.geom)) > 0.5
                                   or p.down_invert_m < new.invert_elev_m - 0.05 or p.down_invert_m > new.rim_elev_m)));
    if v_bad is not null then
      raise exception 'TOPOLOGY: thay đổi hố ga % làm hở/sai cao độ các cống: %', new.code, v_bad using errcode = '23514';
    end if;
  end if;
  -- Z của điểm hố ga luôn bằng cao độ nắp
  new.geom := ST_MakePoint(ST_X(new.geom), ST_Y(new.geom), new.rim_elev_m::double precision);
  new.geom := ST_SetSRID(new.geom, 32648);
  return new;
end $$;

create trigger t10_manhole_topology
  before insert or update or delete on public.manholes
  for each row execute function public.trg_manhole_topology();

-- ---------------------------------------------------------------------
-- VERSIONING lưỡng thời gian cho manholes/pipes
--   Khi UPDATE (thời điểm giao dịch T_tx, hiệu lực mới từ T_v):
--     (A) chèn bản cũ với valid_to = T_v           (hiểu biết hiện tại về quá khứ)
--     (B) chèn bản cũ với tx_to   = T_tx           (hiểu biết trước đây – đã bị thay thế)
--     dòng hiện hành nhận giá trị mới, valid_from = T_v, tx_from = T_tx
--   Khi DELETE: tạo (A) với valid_to = T_tx và (B), rồi xóa dòng hiện hành.
--   Không bao giờ ghi đè dữ liệu cũ; bản lịch sử là bất biến.
--   T_v mặc định = now(); có thể chỉ định bằng cách gán valid_from mới khi UPDATE.
-- ---------------------------------------------------------------------
create or replace function public.trg_versioning()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_now  timestamptz := now();
  v_vf   timestamptz;
  v_old  jsonb := to_jsonb(old);
  v_diff jsonb;
  v_seq  text := pg_get_serial_sequence(format('%I.%I', tg_table_schema, tg_table_name), 'vid');
  -- jsonb_populate_record(old, patch): giữ nguyên mọi cột của bản cũ (kể cả geom), chỉ thay các cột trong patch
  v_sql  text := format('insert into %I.%I select * from jsonb_populate_record($1, $2)',
                        tg_table_schema, tg_table_name);
  v_type text := case tg_table_name when 'pipes' then 'pipe' else 'manhole' end;
  v_evt  public.event_type;
begin
  if old.valid_to is not null or old.tx_to is not null then
    raise exception 'VERSIONING: bản ghi lịch sử (vid=%) là bất biến', old.vid using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'VERSIONING: không được đổi id logic' using errcode = '55000';
    end if;
    -- chỉ thay đổi các cột "kỹ thuật" thì không tạo phiên bản
    v_diff := (select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
                 from jsonb_each(to_jsonb(new)) n
                where n.key not in ('vid', 'valid_from', 'valid_to', 'tx_from', 'tx_to', 'created_by')
                  and n.value is distinct from v_old -> n.key);
    if v_diff = '{}'::jsonb then return new; end if;

    v_vf := case when new.valid_from is distinct from old.valid_from then new.valid_from else v_now end;
    if v_vf <= old.valid_from then
      raise exception 'VERSIONING: valid_from mới (%) phải sau valid_from cũ (%)', v_vf, old.valid_from
        using errcode = '22023';
    end if;
  else
    v_vf := v_now;
    v_diff := jsonb_build_object('retired', true);
  end if;

  -- (A) bản cũ, đóng VALID TIME
  execute v_sql using old, jsonb_build_object('vid', nextval(v_seq), 'valid_to', v_vf, 'tx_from', v_now);
  -- (B) bản cũ, đóng TRANSACTION TIME
  execute v_sql using old, jsonb_build_object('vid', nextval(v_seq), 'tx_to', v_now);

  -- Ghi sự kiện (event-based)
  v_evt := case
    when tg_op = 'DELETE' then 'replace'
    when tg_table_name = 'pipes' and v_diff ?| array['diameter_mm', 'material_code'] then 'replace'
    else 'repair' end;
  insert into public.asset_events (asset_type, asset_id, event_type, detail, valid_time, actor)
  values (v_type, old.id, v_evt,
          jsonb_build_object('op', lower(tg_op),
                             'changes', v_diff - 'geom',
                             'before', (select coalesce(jsonb_object_agg(k, v_old -> k), '{}'::jsonb)
                                          from jsonb_object_keys(v_diff - 'geom') k)),
          v_vf, auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  new.valid_from := v_vf;
  new.valid_to   := null;
  new.tx_from    := v_now;
  new.tx_to      := null;
  new.created_by := coalesce(auth.uid(), old.created_by);
  return new;
end $$;

create trigger t20_versioning before update or delete on public.manholes
  for each row execute function public.trg_versioning();
create trigger t20_versioning before update or delete on public.pipes
  for each row execute function public.trg_versioning();

-- ---------------------------------------------------------------------
-- AUDIT chung: actor = auth.uid()
-- ---------------------------------------------------------------------
create or replace function public.audit()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
begin
  if coalesce(current_setting('app.seeding', true), '') = 'on' then return null; end if;
  -- bản lịch sử do trigger versioning chèn vào: đã được audit qua UPDATE/DELETE gốc
  if tg_op = 'INSERT' and (v_new ->> 'tx_to' is not null or v_new ->> 'valid_to' is not null) then
    return null;
  end if;
  insert into public.audit_log (tbl, row_id, action, old_data, new_data, actor)
  values (tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id'), tg_op,
          v_old - 'geom', v_new - 'geom', auth.uid());
  return null;
end $$;

create trigger t90_audit after insert or update or delete on public.manholes
  for each row execute function public.audit();
create trigger t90_audit after insert or update or delete on public.pipes
  for each row execute function public.audit();
create trigger t90_audit after insert or update or delete on public.incident_reports
  for each row execute function public.audit();
create trigger t90_audit after insert or update or delete on public.profiles
  for each row execute function public.audit();

-- ---------------------------------------------------------------------
-- Sự cố: gán hố ga gần nhất (KNN), tự đóng dấu thời gian theo trạng thái,
-- khi xử lý xong thì ghi sự kiện cho tài sản
-- ---------------------------------------------------------------------
create or replace function public.trg_incident_before()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(new.user_id, auth.uid());
    -- người dân chỉ tạo được sự cố ở trạng thái mới
    if auth.uid() is not null and not public.is_staff() then
      new.status := 'new'; new.technician_id := null;
      new.accepted_at := null; new.arrived_at := null; new.resolved_at := null;
      new.created_at := now();
    end if;
    if new.manhole_id is null then
      -- KNN: hố ga hiện hành gần nhất trong bán kính 80 m
      select m.id into new.manhole_id
        from public.manholes m
       where m.valid_to is null and m.tx_to is null
         and ST_DWithin(m.geom, new.geom, 80)
       order by m.geom <-> new.geom
       limit 1;
    end if;
  else
    if new.status is distinct from old.status then
      if new.status = 'accepted'    and new.accepted_at is null then new.accepted_at := now(); end if;
      if new.status = 'in_progress' and new.arrived_at  is null then new.arrived_at  := now(); end if;
      if new.status = 'resolved'    and new.resolved_at is null then new.resolved_at := now(); end if;
    end if;
  end if;
  if new.status in ('accepted', 'in_progress', 'resolved') and new.technician_id is null then
    new.technician_id := auth.uid();
  end if;
  return new;
end $$;

create trigger t10_incident_before before insert or update on public.incident_reports
  for each row execute function public.trg_incident_before();

create or replace function public.trg_incident_after()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
begin
  if coalesce(current_setting('app.seeding', true), '') = 'on' then return null; end if;
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status is distinct from 'resolved')
     and new.manhole_id is not null then
    insert into public.asset_events (asset_type, asset_id, event_type, detail, valid_time, actor)
    values ('manhole', new.manhole_id, 'incident',
            jsonb_build_object('incident_id', new.id, 'kind', new.kind, 'note', new.note),
            coalesce(new.resolved_at, now()), auth.uid());
  end if;
  return null;
end $$;

create trigger t80_incident_after after insert or update on public.incident_reports
  for each row execute function public.trg_incident_after();
