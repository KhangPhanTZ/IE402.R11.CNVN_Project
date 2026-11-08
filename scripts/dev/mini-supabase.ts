/**
 * MINI SUPABASE (chỉ dùng cho phát triển khi KHÔNG chạy được `supabase start` / Docker).
 * Mô phỏng tối thiểu các API mà frontend dùng, trên Postgres cục bộ (đã chạy scripts/dev/local_db.sh):
 *   - Auth:    POST /auth/v1/token?grant_type=password|refresh_token, GET /auth/v1/user, POST /auth/v1/logout
 *   - REST:    /rest/v1/rpc/<fn> và GET/POST/PATCH/DELETE /rest/v1/<bảng> (lọc eq/neq/gt/lt/is/in, order, limit)
 *   - Storage: upload / createSignedUrl / tải file (bucket lưu ở thư mục .dev-storage)
 * Mọi truy vấn chạy với `SET LOCAL ROLE anon|authenticated` + request.jwt.claims ⇒ RLS giống PostgREST.
 * KHÔNG có Realtime (toast realtime chỉ hoạt động trên Supabase thật).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ie402 npm run dev:mock-api
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const PORT = Number(process.env.PORT ?? 54321)
const SECRET = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
const STORE = path.resolve(process.env.STORAGE_DIR ?? '.dev-storage')
pg.types.setTypeParser(20, (v) => Number(v)) // int8 → number (giống PostgREST)
pg.types.setTypeParser(1700, (v) => Number(v)) // numeric → number
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ie402' })

// ---------------- JWT HS256 ----------------
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
function sign(payload: Record<string, unknown>) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = b64u(JSON.stringify(payload))
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())}`
}
function verify(token?: string): Record<string, any> | null {
  if (!token) return null
  const [h, p, s] = token.split('.')
  if (!s) return null
  const exp = b64u(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp))) return null
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  if (claims.exp && claims.exp * 1000 < Date.now()) return null
  return claims
}
const ANON_KEY = sign({ iss: 'mini-supabase', role: 'anon', exp: 4102444800 })

// ---------------- tiện ích ----------------
const IDENT = /^[a-z_][a-z0-9_]*$/
function ident(s: string) {
  if (!IDENT.test(s)) throw Object.assign(new Error(`Tên không hợp lệ: ${s}`), { status: 400 })
  return `"${s}"`
}
async function body(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
function send(res: http.ServerResponse, status: number, data?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(data === undefined ? '' : JSON.stringify(data))
}
function claimsOf(req: http.IncomingMessage) {
  const tok = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || (req.headers.apikey as string)
  const c = verify(tok)
  if (!c) throw Object.assign(new Error('JWT không hợp lệ'), { status: 401 })
  return c
}
async function asRole<T>(claims: Record<string, any>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : claims.role === 'service_role' ? 'service_role' : 'anon'}`)
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

// ---------------- Auth ----------------
async function issue(userId: string) {
  const u = (await pool.query(`select id, email, raw_user_meta_data, created_at from auth.users where id = $1`, [userId])).rows[0]
  const exp = Math.floor(Date.now() / 1000) + 3600
  const access_token = sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp })
  const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data, app_metadata: { provider: 'email' }, created_at: u.created_at }
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: b64u(sign({ sub: u.id, kind: 'refresh', exp: exp + 86400 * 30 })), user }
}

async function auth(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const b = JSON.parse((await body(req)).toString() || '{}')
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const c = verify(Buffer.from(b.refresh_token ?? '', 'base64url').toString())
      if (!c) return send(res, 400, { error: 'invalid_grant', error_description: 'Refresh token không hợp lệ' })
      return send(res, 200, await issue(c.sub))
    }
    const r = await pool.query(`select id from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`, [b.email, b.password])
    if (!r.rowCount) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })
    return send(res, 200, await issue(r.rows[0].id))
  }
  if (url.pathname === '/auth/v1/user') {
    const c = claimsOf(req)
    if (!c.sub) return send(res, 401, { msg: 'no user' })
    return send(res, 200, (await issue(c.sub)).user)
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204)
  return send(res, 404, { msg: 'not implemented' })
}

// ---------------- REST (PostgREST tối thiểu) ----------------
const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }
function filters(url: URL, params: unknown[]) {
  const where: string[] = []
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue
    const m = v.match(/^(\w+)\.(.*)$/s)
    if (!m) continue
    const [, op, val] = m
    if (op === 'is') where.push(`${ident(k)} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`)
    else if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))
      params.push(items)
      where.push(`${ident(k)}::text = any($${params.length})`)
    } else if (OPS[op]) {
      params.push(val)
      where.push(`${ident(k)} ${OPS[op]} $${params.length}`)
    }
  }
  return where.length ? ` where ${where.join(' and ')}` : ''
}
function selectList(s: string | null) {
  if (!s || s === '*') return '*'
  return s.split(',').map((c) => c.trim()).filter(Boolean).map((c) => (c === '*' ? '*' : ident(c))).join(', ')
}

async function rest(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const claims = claimsOf(req)
  const parts = url.pathname.replace(/^\/rest\/v1\//, '').split('/')
  const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const prefer = String(req.headers.prefer ?? '')
  if (parts[0] === 'rpc') {
    const fn = parts[1]
    const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : JSON.parse((await body(req)).toString() || '{}')
    const out = await asRole(claims, async (c) => {
      const meta = await c.query(`select proretset, prorettype::regtype::text rt from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1`, [fn])
      if (!meta.rowCount) throw Object.assign(new Error(`Không tìm thấy hàm public.${fn}`), { status: 404, code: 'PGRST202' })
      const ks = Object.keys(args)
      const vals = Object.values(args).map((v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v))
      const call = `public.${ident(fn)}(${ks.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`
      if (meta.rows[0].proretset || meta.rows[0].rt === 'record') return (await c.query(`select * from ${call}`, vals)).rows
      const r = await c.query(`select ${call} as r`, vals)
      return r.rows[0].r
    })
    return send(res, 200, out ?? null)
  }
  const table = `public.${ident(parts[0])}`
  const params: unknown[] = []
  if (req.method === 'GET' || req.method === 'HEAD') {
    let sql = `select ${selectList(url.searchParams.get('select'))} from ${table}${filters(url, params)}`
    const order = url.searchParams.get('order')
    if (order) sql += ' order by ' + order.split(',').map((o) => { const [c, d] = o.split('.'); return `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}` }).join(', ')
    const limit = Number(url.searchParams.get('limit'))
    if (limit) sql += ` limit ${Math.min(limit, 10000)}`
    const rows = await asRole(claims, async (c) => (await c.query(sql, params)).rows)
    if (single) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { message: `JSON object requested, multiple (or no) rows returned (${rows.length})`, code: 'PGRST116' })
    return send(res, 200, rows)
  }
  const ret = prefer.includes('return=representation')
  if (req.method === 'POST') {
    const b = JSON.parse((await body(req)).toString() || '[]')
    const items: Record<string, unknown>[] = Array.isArray(b) ? b : [b]
    const cols = Object.keys(items[0] ?? {})
    const values = items.map((it) => `(${cols.map((k) => { params.push(it[k]); return `$${params.length}` }).join(', ')})`).join(', ')
    const rows = await asRole(claims, async (c) => (await c.query(`insert into ${table} (${cols.map(ident).join(', ')}) values ${values} returning *`, params)).rows)
    return ret ? send(res, 201, single ? rows[0] : rows) : send(res, 201)
  }
  if (req.method === 'PATCH') {
    const b = JSON.parse((await body(req)).toString() || '{}')
    const set = Object.keys(b).map((k) => { params.push(b[k]); return `${ident(k)} = $${params.length}` }).join(', ')
    const rows = await asRole(claims, async (c) => (await c.query(`update ${table} set ${set}${filters(url, params)} returning *`, params)).rows)
    return ret ? send(res, 200, single ? rows[0] : rows) : send(res, 204)
  }
  if (req.method === 'DELETE') {
    const rows = await asRole(claims, async (c) => (await c.query(`delete from ${table}${filters(url, params)} returning *`, params)).rows)
    return ret ? send(res, 200, rows) : send(res, 204)
  }
  return send(res, 405, { message: 'method not allowed' })
}

// ---------------- Storage ----------------
function parseMultipart(buf: Buffer, contentType: string): { data: Buffer; type: string } | null {
  const m = contentType.match(/boundary=(.+)$/)
  if (!m) return { data: buf, type: contentType }
  const boundary = Buffer.from('--' + m[1].replace(/"/g, ''))
  let start = buf.indexOf(boundary)
  while (start >= 0) {
    const next = buf.indexOf(boundary, start + boundary.length)
    if (next < 0) break
    const part = buf.subarray(start + boundary.length + 2, next - 2)
    const sep = part.indexOf('\r\n\r\n')
    const head = part.subarray(0, sep).toString()
    if (/filename=/.test(head) || /name=""/.test(head)) {
      return { data: part.subarray(sep + 4), type: head.match(/Content-Type:\s*(.+)/i)?.[1]?.trim() ?? 'application/octet-stream' }
    }
    start = next
  }
  return null
}

async function storage(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ''))
  let m = p.match(/^object\/sign\/([^/]+)\/(.+)$/)
  if (m && req.method === 'POST') {
    const claims = claimsOf(req)
    const [, bucket, name] = m
    // kiểm tra quyền đọc qua RLS của storage.objects
    const ok = await asRole(claims, async (c) => (await c.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rowCount)
    if (!ok) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
    const token = sign({ url: `${bucket}/${name}`, exp: Math.floor(Date.now() / 1000) + 3600 })
    return send(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURIComponent(name).replace(/%2F/g, '/')}?token=${token}` })
  }
  if (m && req.method === 'GET') {
    const c = verify(url.searchParams.get('token') ?? '')
    if (!c || c.url !== `${m[1]}/${m[2]}`) return send(res, 400, { message: 'invalid token' })
    const file = path.join(STORE, m[1], m[2])
    if (!file.startsWith(STORE) || !fs.existsSync(file)) return send(res, 404, { message: 'not found' })
    const meta = JSON.parse(fs.readFileSync(file + '.meta.json', 'utf8'))
    res.writeHead(200, { 'content-type': meta.type })
    return fs.createReadStream(file).pipe(res)
  }
  m = p.match(/^object\/([^/]+)\/(.+)$/)
  if (m && (req.method === 'POST' || req.method === 'PUT')) {
    const claims = claimsOf(req)
    const [, bucket, name] = m
    const part = parseMultipart(await body(req), String(req.headers['content-type'] ?? ''))
    if (!part) return send(res, 400, { message: 'Không đọc được file' })
    await asRole(claims, (c) => c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)`, [bucket, name, claims.sub ?? null, { mimetype: part.type, size: part.data.length }]))
    const file = path.join(STORE, bucket, name)
    if (!file.startsWith(STORE)) return send(res, 400, { message: 'bad path' })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, part.data)
    fs.writeFileSync(file + '.meta.json', JSON.stringify({ type: part.type }))
    return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() })
  }
  return send(res, 404, { message: 'not implemented' })
}

// ---------------- server ----------------
http
  .createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', req.headers.origin ?? '*')
    res.setHeader('access-control-allow-headers', 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-upsert, range, cache-control, x-supabase-api-version')
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
    res.setHeader('access-control-expose-headers', 'content-range')
    if (req.method === 'OPTIONS') return send(res, 204)
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    try {
      if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url)
      if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url)
      if (url.pathname.startsWith('/storage/v1/')) return await storage(req, res, url)
      return send(res, 404, { message: 'not found (realtime không hỗ trợ trong mini-supabase)' })
    } catch (e: any) {
      return send(res, e.status ?? (e.code === '42501' ? 403 : 400), { message: e.message, code: e.code, details: e.detail ?? null, hint: e.hint ?? null })
    }
  })
  .listen(PORT, () => {
    console.log(`mini-supabase chạy tại http://localhost:${PORT}`)
    console.log(`VITE_SUPABASE_URL=http://localhost:${PORT}`)
    console.log(`VITE_SUPABASE_ANON_KEY=${ANON_KEY}`)
  })
