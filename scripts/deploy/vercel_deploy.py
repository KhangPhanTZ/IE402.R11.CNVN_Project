#!/usr/bin/env python3
"""
Deploy thư mục dist (đã build) lên Vercel qua REST API.
    VERCEL_TOKEN=... python3 scripts/deploy/vercel_deploy.py dist ie402-thuduc-drainage
Token: vercel.com → Account Settings → Tokens.
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = 'https://api.vercel.com'
TOKEN = os.environ.get('VERCEL_TOKEN') or sys.exit('Thiếu VERCEL_TOKEN')
SPA = {'rewrites': [{'source': '/((?!cesium/|assets/|favicon).*)', 'destination': '/index.html'}]}


def call(method, path, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Authorization': f'Bearer {TOKEN}', **({'Content-Type': 'application/json'} if body is not None else {}), **(headers or {})}
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(f'{API}{path}', data=data, headers=h, method=method), timeout=120) as r:
                return json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt < 3:
                time.sleep(2 ** attempt); continue
            sys.exit(f'{method} {path} -> HTTP {e.code}: {e.read().decode()[:800]}')


def main(dist, name):
    with open(os.path.join(dist, 'vercel.json'), 'w') as f:  # rewrite cho SPA
        json.dump(SPA, f)
    files = [(os.path.relpath(os.path.join(r, n), dist).replace(os.sep, '/'), os.path.join(r, n)) for r, _, ns in os.walk(dist) for n in ns]

    def upload(item):
        rel, p = item
        data = open(p, 'rb').read()
        sha = hashlib.sha1(data).hexdigest()
        call('POST', '/v2/files', raw=data, headers={'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha})
        return {'file': rel, 'sha': sha, 'size': len(data)}

    with ThreadPoolExecutor(8) as ex:
        manifest = list(ex.map(upload, files))
    print(f'Đã tải {len(manifest)} file')
    dep = call('POST', '/v13/deployments?skipAutoDetectionConfirmation=1', {
        'name': name, 'target': 'production', 'files': manifest,
        'projectSettings': {'framework': None, 'buildCommand': None, 'installCommand': None, 'outputDirectory': None}})
    for _ in range(60):
        d = call('GET', f"/v13/deployments/{dep['id']}")
        if d.get('readyState') in ('READY', 'ERROR', 'CANCELED'):
            print(d['readyState'], ' '.join(f'https://{a}' for a in d.get('alias', [])))
            return
        time.sleep(5)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
