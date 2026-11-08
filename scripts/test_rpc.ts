/**
 * Gọi thử TẤT CẢ hàm RPC Q1–Q12 + kiểm thử bảo mật (RLS, quyền anon).
 *
 *  Cách 1 – qua Supabase (local `supabase start` hoặc Cloud), dùng supabase-js:
 *      SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... npm run test:rpc
 *  Cách 2 – chỉ có Postgres (không Docker): mô phỏng PostgREST bằng `SET ROLE` + request.jwt.claims
 *      DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ie402 npm run test:rpc
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'

type Result<T = any> = { data: T | null; error: { message: string; code?: string } | null }
interface Session {
  label: string
  rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<Result<T>>
  select<T = any>(table: string, columns?: string, match?: Record<string, unknown>): Promise<Result<T[]>>
  update<T = any>(table: string, values: Record<string, unknown>, match: Record<string, unknown>): Promise<Result<T[]>>
}

const PASSWORD = 'Demo@123'
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const DATABASE_URL = process.env.DATABASE_URL

// ---------------------------------------------------------------------------
// Chế độ 1: supabase-js
// ---------------------------------------------------------------------------
async function supabaseSession(email: string | null): Promise<Session> {
  const sb: SupabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  if (email) {
    const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw new Error(`Đăng nhập ${email} thất bại: ${error.message}`)
  }
  return {
    label: email ?? 'anon',
    rpc: async (fn, args) => (await sb.rpc(fn, args ?? {})) as any,
    select: async (table, columns = '*', match = {}) => (await sb.from(table).select(columns).match(match as any)) as any,
    update: async (table, values, match) => (await sb.from(table).update(values).match(match as any).select()) as any,
  }
}

// ---------------------------------------------------------------------------
// Chế độ 2: pg – mô phỏng PostgREST
// ---------------------------------------------------------------------------
let pool: pg.Pool | null = null
async function pgSession(email: string | null): Promise<Session> {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL })
  let claims: Record<string, unknown> = { role: 'anon' }
  if (email) {
    const r = await pool.query(
      `select id from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`,
      [email, PASSWORD],
    )
    if (!r.rowCount) throw new Error(`Đăng nhập ${email} thất bại`)
    claims = { sub: r.rows[0].id, role: 'authenticated', email }
  }
  const role = email ? 'authenticated' : 'anon'
  async function run<T>(sql: string, params: unknown[]): Promise<Result<T>> {
    const c = await pool!.connect()
    try {
      await c.query('begin')
      await c.query(`set local role ${role}`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      const r = await c.query(sql, params)
      await c.query('commit')
      return { data: r.rows as any, error: null }
    } catch (e: any) {
      await c.query('rollback').catch(() => {})
      return { data: null, error: { message: e.message, code: e.code } }
    } finally {
      c.release()
    }
  }
  const where = (m: Record<string, unknown>, offset = 0) => {
    const ks = Object.keys(m)
    return { sql: ks.length ? ' where ' + ks.map((k, i) => `${k} = $${i + 1 + offset}`).join(' and ') : '', vals: Object.values(m) }
  }
  return {
    label: email ?? 'anon',
    async rpc(fn, args = {}) {
      const ks = Object.keys(args)
      const vals = Object.values(args).map((v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v))
      const r = await run<any[]>(`select public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, vals)
      return { data: r.data ? r.data[0].r : null, error: r.error }
    },
    async select(table, columns = '*', match = {}) {
      const w = where(match)
      return run(`select ${columns} from public.${table}${w.sql}`, w.vals)
    },
    async update(table, values, match) {
      const ks = Object.keys(values)
      const w = where(match, ks.length)
      return run(`update public.${table} set ${ks.map((k, i) => `${k} = $${i + 1}`).join(', ')}${w.sql} returning *`, [
        ...Object.values(values),
        ...w.vals,
      ])
    },
  }
}

const login = SUPABASE_URL && SUPABASE_ANON_KEY ? supabaseSession : DATABASE_URL ? pgSession : null

// ---------------------------------------------------------------------------
// Tiện ích in kết quả
// ---------------------------------------------------------------------------
let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`)
}
function fcSummary(fc: any, props: string[] = [], n = 3) {
  const feats = fc?.features ?? []
  const rows = feats.slice(0, n).map((f: any) => props.map((p) => `${p}=${JSON.stringify(f.properties?.[p])}`).join(' '))
  return `${feats.length} feature(s)` + (fc?.meta ? ` meta=${JSON.stringify(omit(fc.meta, ['events', 'route', 'manholes']))}` : '') +
    (rows.length ? '\n      ' + rows.join('\n      ') : '')
}
function omit(o: any, keys: string[]) {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
}
async function q(s: Session, title: string, fn: string, args: Record<string, unknown>, props: string[], expect?: (d: any) => boolean) {
  const t0 = Date.now()
  const { data, error } = await s.rpc(fn, args)
  const ms = Date.now() - t0
  if (error) {
    check(`${title} ${fn}`, false, error.message)
    return null
  }
  check(`${title} ${fn}(${JSON.stringify(args)}) [${ms} ms]`, expect ? expect(data) : true, fcSummary(data, props))
  return data
}

// ---------------------------------------------------------------------------
async function main() {
  if (!login) {
    console.error('Cần SUPABASE_URL + SUPABASE_ANON_KEY hoặc DATABASE_URL')
    process.exit(2)
  }
  console.log(`Chế độ: ${login === supabaseSession ? 'supabase-js → ' + SUPABASE_URL : 'pg (mô phỏng PostgREST) → ' + DATABASE_URL}`)
  const admin = await login('admin@demo.vn')
  const tech1 = await login('tech1@demo.vn')
  const tech2 = await login('tech2@demo.vn')
  const dan = await login('dan@demo.vn')
  const anon = await login(null)

  // ---- dữ liệu tham chiếu ----
  const mh = (await admin.rpc('layer_manholes')).data
  const pipes = (await admin.rpc('layer_pipes')).data
  const mhA = mh.features.find((f: any) => f.properties.code.startsWith('HG-A'))
  const mhB = mh.features.find((f: any) => f.properties.code.startsWith('HG-B'))
  console.log(`\nLớp dữ liệu: ${mh.features.length} hố ga, ${pipes.features.length} cống`)

  console.log('\n== Q1–Q12 (admin) ==')
  const q1 = await q(admin, 'Q1', 'q1_reverse_slope', {}, ['code', 'slope'], (d) => d.features.length === 3)
  await q(admin, 'Q2', 'q2_shallow_cover', {}, ['code', 'min_cover_m'], (d) => d.features.length >= 2 && d.features.length <= 4)
  await q(admin, 'Q3', 'q3_clash_3d', {}, ['pipe_code', 'utility_kind', 'clearance_m'], (d) => d.features.length >= 2 && d.features.length <= 3)
  const blocked = q1?.features?.[0]?.properties?.id ?? pipes.features[0].properties.id
  await q(admin, 'Q4', 'trace_upstream', { p_pipe_id: blocked }, ['code', 'level'], (d) => d.features.length >= 1)
  await q(admin, 'Q4', 'trace_downstream', { p_pipe_id: blocked }, ['code', 'level'], (d) => d.features.length >= 1)
  await q(admin, 'Q5', 'q5_overflow', { p_scenario_id: 2 }, ['code', 'rim_elev_m', 'flood_depth_m'], (d) => d.features.length > 0)
  await q(admin, 'Q5', 'q5_overflow', { p_at: new Date().toISOString() }, ['code', 'water_level_m'])
  await q(admin, 'Q6', 'q6_basement_risk', { p_scenario_id: 3 }, ['name', 'has_basement', 'reasons'], (d) => d.features.length > 0)
  await q(admin, 'Q7', 'q7_nearest_manhole', { p_source: 'flood' }, ['label', 'manhole_code', 'distance_m'], (d) => d.features.length === 6)
  await q(admin, 'Q8', 'q8_overload', { p_scenario_id: 1 }, ['code', 'q_in_m3s', 'q_cap_m3s', 'ratio'], (d) => d.meta.pipes > 0)
  const q9old = await q(admin, 'Q9', 'q9_as_of_date', { p_date: '2015-01-01T00:00:00Z' }, ['code', 'diameter_mm'])
  const q9now = await q(admin, 'Q9', 'q9_as_of_date', { p_date: new Date().toISOString() }, ['code', 'diameter_mm'])
  check('Q9 năm 2015 có ít cống hơn hiện tại', (q9old?.meta?.pipes ?? 0) < (q9now?.meta?.pipes ?? 0),
    `${q9old?.meta?.pipes} < ${q9now?.meta?.pipes}`)
  // cống được nâng cấp D800 → D1200
  const ev = (await admin.select('asset_events', 'asset_id, detail, valid_time', { asset_type: 'pipe', event_type: 'replace' })).data ?? []
  const up = ev.find((e: any) => e.detail?.changes?.diameter_mm === 1200)
  if (up) {
    const before = await admin.rpc('q9_as_of_date', { p_date: '2025-01-01T00:00:00Z' })
    const d2025 = before.data.features.find((f: any) => f.properties.layer === 'pipe' && f.properties.id === Number(up.asset_id))?.properties.diameter_mm
    const dNow = q9now.features.find((f: any) => f.properties.layer === 'pipe' && f.properties.id === Number(up.asset_id))?.properties.diameter_mm
    check(`Q9 cống id=${up.asset_id}: 2025-01-01 → D${d2025}, hiện tại → D${dNow}`, d2025 === 800 && dNow === 1200)
    const hist = await admin.rpc('asset_history', { p_asset_type: 'pipe', p_id: Number(up.asset_id) })
    check('asset_history có ≥ 3 phiên bản bitemporal', (hist.data?.versions?.length ?? 0) >= 3, `${hist.data?.versions?.length} phiên bản`)
  } else check('Tìm thấy cống nâng cấp D800→D1200', false)
  await q(admin, 'Q10', 'q10_incident_sla', {}, ['name', 'total', 'avg_response_min', 'avg_resolution_h'], (d) => d.features.length === 2)
  const leaf = pipes.features.find((f: any) => f.properties.code.startsWith('C-A'))
  await q(admin, 'Q11', 'q11_pipe_profile', { p_from_mh: leaf.properties.from_mh }, ['dist_m', 'ground_m', 'invert_m', 'crown_m'], (d) => d.features.length > 2)
  await q(admin, 'Q12', 'q12_defect_points', {}, ['pipe_code', 'type', 'severity', 'chainage_m'], (d) => d.features.length === 300)

  console.log('\n== Bảo mật / RLS ==')
  // anon
  const anonPipes = await anon.select('pipes', 'id', {})
  check('anon KHÔNG đọc được bảng pipes gốc', !!anonPipes.error || (anonPipes.data?.length ?? 0) === 0,
    anonPipes.error?.message ?? `${anonPipes.data?.length} dòng`)
  const anonView = await anon.select('public_pipes', '*', {})
  check('anon đọc được view public_pipes (không có cột cao độ đáy/độ dốc)',
    !anonView.error && (anonView.data?.length ?? 0) > 0 && !('slope' in (anonView.data?.[0] ?? {})) && !('up_invert_m' in (anonView.data?.[0] ?? {})),
    anonView.error?.message ?? `${anonView.data?.length} dòng, cột: ${Object.keys(anonView.data?.[0] ?? {}).join(',')}`)
  const anonQ = await anon.rpc('q1_reverse_slope')
  check('anon không chạy được phân tích Q1', !!anonQ.error, anonQ.error?.message)
  const anonFlood = await anon.rpc('layer_flood_points')
  check('anon xem được điểm ngập', !anonFlood.error && anonFlood.data.features.length === 6)

  // technician theo khu
  const t1B = await tech1.update('manholes', { status: 'maintenance' }, { id: mhB.properties.id })
  const after = (await admin.rpc('layer_manholes')).data.features.find((f: any) => f.properties.id === mhB.properties.id)
  check(`tech1 (zone A) sửa hố ga ${mhB.properties.code} (zone B) bị RLS từ chối`,
    (t1B.data?.length ?? 0) === 0 && after.properties.status === mhB.properties.status,
    t1B.error?.message ?? `${t1B.data?.length ?? 0} dòng bị ảnh hưởng, status vẫn = ${after.properties.status}`)
  const t1Brpc = await tech1.rpc('update_manhole', { p_id: mhB.properties.id, p_changes: { status: 'maintenance' } })
  check('tech1 gọi update_manhole cho zone B → lỗi RLS rõ ràng', !!t1Brpc.error, t1Brpc.error?.message)
  const t1A = await tech1.rpc('update_manhole', { p_id: mhA.properties.id, p_changes: { status: mhA.properties.status } })
  check(`tech1 sửa hố ga ${mhA.properties.code} (zone A) được phép`, !t1A.error, t1A.error?.message)
  const t2A = await tech2.rpc('delete_asset', { p_asset_type: 'manhole', p_id: mhA.properties.id })
  check('tech2 (zone B) xóa hố ga zone A bị từ chối', !!t2A.error, t2A.error?.message)
  const pBad = await tech1.rpc('create_pipe', { p_from_mh: mhA.properties.id, p_to_mh: mhA.properties.id, p_diameter_mm: 600 })
  check('Tạo cống from = to bị chặn', !!pBad.error, pBad.error?.message)

  // citizen
  const inc = await dan.rpc('create_incident', {
    p_kind: 'blocked', p_lon: mhA.geometry.coordinates[0], p_lat: mhA.geometry.coordinates[1], p_note: 'test_rpc.ts',
  })
  check('citizen tạo báo cáo sự cố, tự gán hố ga gần nhất (KNN)', !inc.error && !!inc.data?.manhole_id,
    inc.error?.message ?? `id=${inc.data?.id} manhole_id=${inc.data?.manhole_id}`)
  const danInc = await dan.select('incident_reports', 'id, user_id', {})
  const danIds = new Set((danInc.data ?? []).map((r: any) => r.user_id))
  check('citizen chỉ thấy báo cáo của chính mình', danIds.size === 1, `${danInc.data?.length} báo cáo, ${danIds.size} user`)
  const danQ = await dan.rpc('q1_reverse_slope')
  check('citizen không chạy được phân tích', !!danQ.error, danQ.error?.message)
  const danPipes = await dan.select('pipes', 'id', {})
  check('citizen không đọc được bảng pipes gốc (RLS → 0 dòng)', (danPipes.data?.length ?? 0) === 0)

  // quy trình xử lý sự cố
  if (inc.data?.id) {
    const a = await tech1.rpc('incident_accept', { p_id: inc.data.id })
    const b = await tech2.rpc('incident_arrive', { p_id: inc.data.id })
    const c = await tech1.rpc('incident_arrive', { p_id: inc.data.id })
    const d = await tech1.rpc('incident_resolve', { p_id: inc.data.id, p_note: 'Đã nạo vét' })
    check('tech1 nhận việc', !a.error && !!a.data?.accepted_at, a.error?.message)
    check('tech2 không cập nhật được sự cố tech1 đã nhận', !!b.error, b.error?.message)
    check('tech1 cập nhật arrived_at → resolved_at', !c.error && !d.error && !!d.data?.resolved_at, (c.error ?? d.error)?.message)
  }

  // audit
  const auditAdmin = await admin.select('audit_log', 'id, tbl, action, actor', {})
  const auditTech = await tech1.select('audit_log', 'id', {})
  check('admin đọc được audit_log', (auditAdmin.data?.length ?? 0) > 0, `${auditAdmin.data?.length} bản ghi`)
  check('technician KHÔNG đọc được audit_log', (auditTech.data?.length ?? 0) === 0)

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`)
  await pool?.end()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await pool?.end()
  process.exit(1)
})
