#!/usr/bin/env python3
"""
Chạy file SQL (hoặc câu SQL) trên Supabase Cloud qua Management API – không cần kết nối Postgres trực tiếp.
    SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... python3 scripts/deploy/supabase_sql.py file1.sql [file2.sql ...]
Token: supabase.com → Account → Access Tokens.
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = os.environ.get('SUPABASE_PROJECT_REF') or sys.exit('Thiếu SUPABASE_PROJECT_REF')
TOKEN = os.environ.get('SUPABASE_ACCESS_TOKEN') or sys.exit('Thiếu SUPABASE_ACCESS_TOKEN')


def run(sql: str):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        sys.exit(f'HTTP {e.code}: {e.read().decode()[:1500]}')


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        sql = open(arg, encoding='utf-8').read() if arg.endswith('.sql') else arg
        print(f'>> {arg[:60]}', json.dumps(run(sql), ensure_ascii=False)[:300])
