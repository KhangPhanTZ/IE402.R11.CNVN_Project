-- So sánh truy vấn KNN (Q7) có / không có index GIST
--   psql "$DATABASE_URL" -f scripts/explain_knn.sql
\pset pager off
set search_path = public, extensions;
analyze manholes;
\echo '=== (1) CÓ index GIST manholes_geom_gix ==='
explain (analyze, buffers, costs off, timing on)
select id, code, geom <-> ST_SetSRID(ST_MakePoint(692070, 1199950), 32648) as d
from manholes
where valid_to is null and tx_to is null
order by geom <-> ST_SetSRID(ST_MakePoint(692070, 1199950), 32648)
limit 3;

begin;
drop index manholes_geom_gix;
\echo '=== (2) KHÔNG có index (drop trong transaction rồi rollback) ==='
explain (analyze, buffers, costs off, timing on)
select id, code, geom <-> ST_SetSRID(ST_MakePoint(692070, 1199950), 32648) as d
from manholes
where valid_to is null and tx_to is null
order by geom <-> ST_SetSRID(ST_MakePoint(692070, 1199950), 32648)
limit 3;
rollback;

-- Thử ở quy mô lớn: 200.000 điểm ngẫu nhiên trong phạm vi nghiên cứu
create temp table knn_bench as
  select g as id, ST_SetSRID(ST_MakePoint(691256 + random() * 1400, 1199297 + random() * 1300), 32648) as geom
  from generate_series(1, 200000) g;
analyze knn_bench;
\echo '=== (3) 200k điểm – KHÔNG index ==='
explain (analyze, costs off)
select id from knn_bench order by geom <-> ST_SetSRID(ST_MakePoint(692070, 1199950), 32648) limit 3;
create index on knn_bench using gist (geom);
analyze knn_bench;
\echo '=== (4) 200k điểm – CÓ index GIST ==='
explain (analyze, costs off)
select id from knn_bench order by geom <-> ST_SetSRID(ST_MakePoint(692070, 1199950), 32648) limit 3;
