#!/usr/bin/env bash
# Tạo CSDL cục bộ KHÔNG cần Docker: Postgres + PostGIS thuần + shim mô phỏng Supabase.
# Dùng khi không chạy được `supabase start`. Cách chính thức vẫn là `supabase start`.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres ./scripts/dev/local_db.sh [tên_db]
set -euo pipefail
DB="${1:-ie402}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
psql -v ON_ERROR_STOP=1 -d postgres -qc "drop database if exists $DB with (force);"
psql -v ON_ERROR_STOP=1 -d postgres -qc "create database $DB;"
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f "$ROOT/scripts/dev/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo ">> $f"
  psql -v ON_ERROR_STOP=1 -d "$DB" -q -f "$f"
done
echo "OK: database $DB đã sẵn sàng"
