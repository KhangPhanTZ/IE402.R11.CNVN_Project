-- Kiểm thử GIAI ĐOẠN 1: trigger topology + versioning (chạy trong transaction rồi ROLLBACK)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test_topology.sql
begin;
set local search_path = public, extensions;
insert into pipe_materials values ('TST', 'Vật liệu test', 0.013) on conflict do nothing;
insert into manholes (id, code, rim_elev_m, invert_elev_m, geom)
values (900001, 'T-A', 3.0, 1.0, ST_SetSRID(ST_MakePoint(700000, 1200000, 3.0), 32648)),
       (900002, 'T-B', 2.8, 0.9, ST_SetSRID(ST_MakePoint(700040, 1200000, 2.8), 32648));

-- 1) Cống đúng topology: được chấp nhận, thuộc tính dẫn xuất tự tính
insert into pipes (id, code, from_mh, to_mh, diameter_mm, material_code, geom)
values (900001, 'T-OK', 900001, 900002, 800, 'TST',
        ST_SetSRID(ST_MakeLine(ST_MakePoint(700000, 1200000, 1.0), ST_MakePoint(700040, 1200000, 0.92)), 32648));
do $$
declare p pipes;
begin
  select * into p from pipes where id = 900001 and tx_to is null and valid_to is null;
  assert p.length_m between 40 and 40.01, 'length_m sai: ' || p.length_m;
  assert p.slope = 0.002, 'slope sai: ' || p.slope;
  assert p.up_invert_m = 1.0 and p.down_invert_m = 0.92, 'invert sai';
  raise notice 'PASS: cống đúng topology, length=% slope=%', p.length_m, p.slope;
end $$;

-- 2) Cống sai topology (điểm cuối lệch 3 m khỏi hố ga T-B): phải bị RAISE EXCEPTION
do $$
begin
  insert into pipes (code, from_mh, to_mh, diameter_mm, material_code, geom)
  values ('T-BAD', 900001, 900002, 600, 'TST',
          ST_SetSRID(ST_MakeLine(ST_MakePoint(700000, 1200000, 1.0), ST_MakePoint(700043, 1200000, 0.95)), 32648));
  raise exception 'FAIL: cống sai topology KHÔNG bị chặn';
exception when sqlstate '23514' then
  raise notice 'PASS: bị chặn đúng – %', sqlerrm;
end $$;

-- 3) Hố ga không tồn tại
do $$
begin
  insert into pipes (code, from_mh, to_mh, diameter_mm, material_code, geom)
  values ('T-BAD2', 900001, 999999, 600, 'TST',
          ST_SetSRID(ST_MakeLine(ST_MakePoint(700000, 1200000, 1.0), ST_MakePoint(700040, 1200000, 0.95)), 32648));
  raise exception 'FAIL: to_mh không tồn tại mà không bị chặn';
exception when sqlstate '23503' then
  raise notice 'PASS: bị chặn đúng – %', sqlerrm;
end $$;

-- 4) Versioning: nâng cấp D800 -> D1200 tạo phiên bản, không ghi đè
update pipes set diameter_mm = 1200, valid_from = now() + interval '1 second' where id = 900001;
do $$
declare n int; cur pipes;
begin
  select count(*) into n from pipes where id = 900001;
  select * into cur from pipes where id = 900001 and valid_to is null and tx_to is null;
  assert n = 3, 'phải có 3 dòng (hiện hành + 2 bản lịch sử), có ' || n;
  assert cur.diameter_mm = 1200, 'bản hiện hành phải là D1200';
  assert exists (select 1 from pipes where id = 900001 and diameter_mm = 800 and valid_to is not null and tx_to is null),
         'thiếu bản lịch sử đóng valid time';
  assert exists (select 1 from asset_events where asset_type = 'pipe' and asset_id = 900001 and event_type = 'replace'),
         'thiếu sự kiện replace';
  raise notice 'PASS: versioning – % phiên bản, sự kiện replace đã ghi', n;
end $$;

-- 5) Bản lịch sử là bất biến
do $$
begin
  update pipes set status = 'damaged' where id = 900001 and valid_to is not null;
  raise exception 'FAIL: sửa được bản lịch sử';
exception when sqlstate '55000' then
  raise notice 'PASS: bản lịch sử bất biến – %', sqlerrm;
end $$;

-- 6) Không xóa được hố ga còn cống nối vào
do $$
begin
  delete from manholes where id = 900002;
  raise exception 'FAIL: xóa được hố ga còn cống';
exception when sqlstate '23503' then
  raise notice 'PASS: %', sqlerrm;
end $$;
rollback;
