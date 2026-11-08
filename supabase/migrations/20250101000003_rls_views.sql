-- =====================================================================
-- Migration 3: An ninh – RLS theo vai trò & khu phụ trách, view rút gọn cho khách,
-- quyền truy cập bảng, Storage, Realtime
-- =====================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Bật RLS cho mọi bảng
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','zones','user_zones','terrain_points','terrain_tin','buildings',
    'building_surface','pipe_materials','manholes','csg_node','pipes','utilities','inspections','defects',
    'flood_points','rain_scenarios','obs_stations','water_obs','incident_reports','asset_events','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());  -- đổi role bị trigger chặn
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

-- ---------------------------------------------------------------------
-- Khu phụ trách
-- ---------------------------------------------------------------------
create policy zones_select on public.zones for select to authenticated using (true);
create policy zones_admin  on public.zones for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));
create policy user_zones_select on public.user_zones for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy user_zones_admin on public.user_zones for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

-- ---------------------------------------------------------------------
-- Dữ liệu tham chiếu: technician/admin xem, admin sửa
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['terrain_points','terrain_tin','buildings','building_surface','pipe_materials',
                           'utilities','obs_stations','water_obs']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_role(''admin'')) with check (public.is_role(''admin''))', t || '_admin', t);
  end loop;
end $$;

create policy rain_scenarios_select on public.rain_scenarios for select to authenticated using (true);
create policy rain_scenarios_admin on public.rain_scenarios for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

-- Điểm ngập: công khai cho cả khách
create policy flood_points_select on public.flood_points for select to anon, authenticated using (true);
create policy flood_points_admin on public.flood_points for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

-- ---------------------------------------------------------------------
-- Hố ga & cống: technician chỉ sửa/xóa tài sản NẰM TRONG khu phụ trách
-- ---------------------------------------------------------------------
create policy manholes_select on public.manholes for select to authenticated using (public.is_staff());
create policy manholes_insert on public.manholes for insert to authenticated
  with check (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)));
create policy manholes_update on public.manholes for update to authenticated
  using      (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)))
  with check (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)));
create policy manholes_delete on public.manholes for delete to authenticated
  using (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)));

create policy pipes_select on public.pipes for select to authenticated using (public.is_staff());
create policy pipes_insert on public.pipes for insert to authenticated
  with check (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)));
create policy pipes_update on public.pipes for update to authenticated
  using      (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)))
  with check (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)));
create policy pipes_delete on public.pipes for delete to authenticated
  using (public.is_role('admin') or (public.is_role('technician') and public.in_my_zone(geom)));

-- CSG đi kèm hố ga: sửa được khi hố ga tương ứng sửa được
create policy csg_select on public.csg_node for select to authenticated using (public.is_staff());
create policy csg_write on public.csg_node for all to authenticated
  using (public.is_role('admin') or (public.is_role('technician') and exists (
           select 1 from public.manholes m where m.id = csg_node.manhole_id
              and m.valid_to is null and m.tx_to is null and public.in_my_zone(m.geom))))
  with check (public.is_role('admin') or (public.is_role('technician') and exists (
           select 1 from public.manholes m where m.id = csg_node.manhole_id
              and m.valid_to is null and m.tx_to is null and public.in_my_zone(m.geom))));

-- ---------------------------------------------------------------------
-- Kiểm tra, lỗi, sự kiện: technician xem & ghi, admin toàn quyền
-- ---------------------------------------------------------------------
create policy inspections_select on public.inspections for select to authenticated using (public.is_staff());
create policy inspections_insert on public.inspections for insert to authenticated with check (public.is_staff());
create policy inspections_admin on public.inspections for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));
create policy defects_select on public.defects for select to authenticated using (public.is_staff());
create policy defects_insert on public.defects for insert to authenticated with check (public.is_staff());
create policy defects_admin on public.defects for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));
create policy asset_events_select on public.asset_events for select to authenticated using (public.is_staff());
create policy asset_events_insert on public.asset_events for insert to authenticated
  with check (public.is_staff() and actor = auth.uid());
create policy asset_events_admin on public.asset_events for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

-- ---------------------------------------------------------------------
-- Báo cáo sự cố
--   citizen: chỉ SELECT/INSERT báo cáo của chính mình
--   technician: xem tất cả, cập nhật sự cố chưa ai nhận hoặc do mình nhận
--   admin: toàn quyền
-- ---------------------------------------------------------------------
create policy incidents_select on public.incident_reports for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy incidents_insert on public.incident_reports for insert to authenticated
  with check (user_id = auth.uid());
create policy incidents_update_tech on public.incident_reports for update to authenticated
  using (public.is_role('technician') and (technician_id is null or technician_id = auth.uid()))
  with check (public.is_role('technician') and technician_id = auth.uid());
create policy incidents_admin on public.incident_reports for all to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

-- Audit log: chỉ admin đọc; ghi qua trigger SECURITY DEFINER
create policy audit_select on public.audit_log for select to authenticated using (public.is_role('admin'));

-- ---------------------------------------------------------------------
-- View rút gọn cho khách: KHÔNG có cao độ đáy, độ dốc; hình học 2D
-- (view chạy với quyền owner nên khách đọc được mà không cần quyền bảng gốc)
-- ---------------------------------------------------------------------
create view public.public_manholes with (security_invoker = false) as
  select id, code, kind, status, diameter_m, ST_Force2D(geom)::geometry(Point, 32648) as geom
  from public.manholes
  where valid_to is null and tx_to is null;

create view public.public_pipes with (security_invoker = false) as
  select id, code, from_mh, to_mh, diameter_mm, material_code, status,
         ST_Force2D(geom)::geometry(LineString, 32648) as geom
  from public.pipes
  where valid_to is null and tx_to is null;

-- ---------------------------------------------------------------------
-- Quyền mức bảng: khách (anon) KHÔNG có quyền trên bảng gốc
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.public_manholes, public.public_pipes, public.flood_points to anon;
grant select on public.public_manholes, public.public_pipes to authenticated;
-- audit_log: không ai ghi trực tiếp
revoke insert, update, delete, truncate on public.audit_log from authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket ảnh sự cố. Đường dẫn: <user_id>/<tên file>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-images', 'incident-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy incident_images_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'incident-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy incident_images_select on storage.objects for select to authenticated
  using (bucket_id = 'incident-images'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
create policy incident_images_update_own on storage.objects for update to authenticated
  using (bucket_id = 'incident-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy incident_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'incident-images'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_role('admin')));

-- ---------------------------------------------------------------------
-- Realtime: phát INSERT/UPDATE của incident_reports (RLS vẫn áp dụng)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.incident_reports;
