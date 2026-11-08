#!/usr/bin/env bash
# Xuất dữ liệu đã seed ở CSDL local thành các file SQL nhỏ (≤ ~400 KB) để nạp lên Supabase Cloud bằng supabase_sql.py.
#   PGPASSWORD=postgres bash scripts/deploy/export_seed_sql.sh ie402 out_dir
set -euo pipefail
DB="${1:-ie402}"; OUT="${2:-deploy_sql}"; mkdir -p "$OUT"
PSQL="psql -h ${PGHOST:-localhost} -U ${PGUSER:-postgres} -d $DB -X -At"
{
  echo "select set_config('app.seeding','on',false);"
  $PSQL -c "select format('insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token) values (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L);', instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,'','','','') from auth.users order by email"
  $PSQL -c "select format('insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (%L,%L,%L,%L,%L,%L,%L,%L);', id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) from auth.identities"
  $PSQL -c "select format('update public.profiles set role=%L, full_name=%L where id=%L;', role, full_name, id) from public.profiles"
} > "$OUT/01_auth.sql"
pg_dump -h "${PGHOST:-localhost}" -U "${PGUSER:-postgres}" -d "$DB" --data-only --inserts --rows-per-insert=200 \
  --no-owner --no-privileges -n public -T public.profiles -T public.audit_log -T public.spatial_ref_sys > "$OUT/public_raw.sql"
python3 - "$OUT" <<'PY'
import sys, os
out = sys.argv[1]
stmts, cur = [], []
for line in open(f'{out}/public_raw.sql', encoding='utf-8'):
    # bỏ chú thích, lệnh SET và lệnh riêng của psql (\restrict …) mà API không hiểu
    if line.startswith(('--', 'SET ', 'SELECT pg_catalog.set_config', '\\')) or not line.strip():
        continue
    cur.append(line)
    if line.rstrip().endswith(';'):
        stmts.append(''.join(cur)); cur = []
stmts = [s for s in stmts if "audit_log_id_seq" not in s]
parts, buf = [], ''
for s in stmts:
    if len(buf) + len(s) > 400_000 and buf:
        parts.append(buf); buf = ''
    buf += s
parts.append(buf)
for i, p in enumerate(parts):
    open(f'{out}/02_public_{i:02d}.sql', 'w', encoding='utf-8').write("select set_config('app.seeding','on',false);\n" + p)
os.remove(f'{out}/public_raw.sql')
print(f'{len(stmts)} câu lệnh → {len(parts)} file trong {out}/')
PY
