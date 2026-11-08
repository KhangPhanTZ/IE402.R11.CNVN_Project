/** /admin – quản lý user & khu phụ trách, audit log, dashboard Q10, xuất GeoJSON/CSV */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { rpc, supabase } from '@/lib/supabase'
import { exportCSV, exportGeoJSON } from '@/lib/export'
import type { FeatureCollection } from '@/lib/types'
import { fmtDate } from '@/lib/utils'

function Users() {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin_users'], queryFn: () => rpc<any[]>('admin_list_users') })
  const zones = useQuery({ queryKey: ['layer', 'layer_zones', 'admin'], queryFn: () => rpc<FeatureCollection>('layer_zones') })
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p
      toast.success(ok)
      qc.invalidateQueries({ queryKey: ['admin_users'] })
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Người dùng & vai trò</CardTitle>
        <CardDescription>Tài khoản tạo qua Supabase Auth (đăng ký / Dashboard); hồ sơ mặc định là citizen. Đổi vai trò được trigger chặn nếu không phải admin.</CardDescription>
      </CardHeader>
      <CardContent>
        {users.error && <div className="text-sm text-destructive">{(users.error as Error).message}</div>}
        <Table>
          <THead><TR><TH>Email</TH><TH>Họ tên</TH><TH>Vai trò</TH><TH>Khu phụ trách</TH><TH>Tạo lúc</TH></TR></THead>
          <TBody>
            {users.data?.map((u) => (
              <TR key={u.id}>
                <TD>{u.email}</TD>
                <TD>{u.full_name}</TD>
                <TD>
                  <Select className="w-36" value={u.role} onChange={(e) => run(rpc('admin_set_role', { p_user: u.id, p_role: e.target.value }), 'Đã đổi vai trò')}>
                    <option value="citizen">citizen</option><option value="technician">technician</option><option value="admin">admin</option>
                  </Select>
                </TD>
                <TD className="space-x-2">
                  {zones.data?.features.map((z) => {
                    const on = u.zone_ids.includes(z.properties.id)
                    return (
                      <label key={z.properties.id} className="inline-flex items-center gap-1">
                        <input type="checkbox" checked={on}
                          onChange={() => run(rpc('admin_set_user_zones', { p_user: u.id, p_zone_ids: on ? u.zone_ids.filter((x: number) => x !== z.properties.id) : [...u.zone_ids, z.properties.id] }), 'Đã cập nhật khu phụ trách')} />
                        {z.properties.name}
                      </label>
                    )
                  })}
                </TD>
                <TD>{fmtDate(u.created_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function Zones() {
  const qc = useQueryClient()
  const zones = useQuery({ queryKey: ['layer', 'layer_zones', 'admin'], queryFn: () => rpc<FeatureCollection>('layer_zones') })
  const [edit, setEdit] = useState<{ id: number | null; name: string; geojson: string } | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Khu phụ trách</CardTitle>
        <CardDescription>Đa giác (GeoJSON EPSG:4326) → lưu EPSG:32648. RLS technician dùng ST_Within(geom tài sản, zone).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <THead><TR><TH>#</TH><TH>Tên</TH><TH>Diện tích (km²)</TH><TH /></TR></THead>
          <TBody>
            {zones.data?.features.map((z) => (
              <TR key={z.properties.id}>
                <TD>{z.properties.id}</TD><TD>{z.properties.name}</TD><TD>{z.properties.area_km2}</TD>
                <TD><Button size="xs" variant="outline" onClick={() => setEdit({ id: z.properties.id, name: z.properties.name, geojson: JSON.stringify(z.geometry) })}>Sửa</Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Button size="sm" variant="secondary" onClick={() => setEdit({ id: null, name: 'Zone mới', geojson: '{"type":"Polygon","coordinates":[[[106.752,10.846],[106.756,10.846],[106.756,10.85],[106.752,10.85],[106.752,10.846]]]}' })}>+ Thêm khu</Button>
        {edit && (
          <div className="space-y-2 rounded border p-3">
            <div><Label>Tên</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div><Label>GeoJSON Polygon</Label><Textarea rows={5} className="font-mono text-[11px]" value={edit.geojson} onChange={(e) => setEdit({ ...edit, geojson: e.target.value })} /></div>
            <div className="flex gap-2">
              <Button size="sm" onClick={async () => {
                try {
                  await rpc('admin_upsert_zone', { p_id: edit.id, p_name: edit.name, p_geojson: JSON.parse(edit.geojson) })
                  toast.success('Đã lưu khu')
                  setEdit(null)
                  qc.invalidateQueries({ queryKey: ['layer'] })
                } catch (e: any) { toast.error(e.message) }
              }}>Lưu</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Huỷ</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Audit() {
  const [tbl, setTbl] = useState('')
  const q = useQuery({
    queryKey: ['audit', tbl],
    queryFn: async () => {
      let s = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(300)
      if (tbl) s = s.eq('tbl', tbl)
      const { data, error } = await s
      if (error) throw error
      return data
    },
  })
  const diff = (o: any, n: any) => {
    if (!o || !n) return ''
    return Object.keys(n).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]) && !['tx_from', 'valid_from', 'vid'].includes(k)).map((k) => `${k}: ${JSON.stringify(o[k])} → ${JSON.stringify(n[k])}`).join('; ')
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>Audit log</CardTitle><CardDescription>Trigger audit() chung, actor = auth.uid(). Chỉ admin đọc được (RLS).</CardDescription></div>
        <Select className="w-48" value={tbl} onChange={(e) => setTbl(e.target.value)}>
          <option value="">Mọi bảng</option>{['manholes', 'pipes', 'incident_reports', 'profiles'].map((t) => <option key={t}>{t}</option>)}
        </Select>
      </CardHeader>
      <CardContent>
        {q.error && <div className="text-sm text-destructive">{(q.error as Error).message}</div>}
        <Table>
          <THead><TR><TH>Thời điểm</TH><TH>Bảng</TH><TH>Dòng</TH><TH>Hành động</TH><TH>Actor</TH><TH>Thay đổi</TH></TR></THead>
          <TBody>
            {q.data?.map((r: any) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap">{fmtDate(r.at)}</TD><TD>{r.tbl}</TD><TD>{r.row_id}</TD>
                <TD><Badge variant={r.action === 'DELETE' ? 'destructive' : r.action === 'INSERT' ? 'success' : 'secondary'}>{r.action}</Badge></TD>
                <TD className="font-mono text-[10px]">{r.actor?.slice(0, 8) ?? 'system'}</TD>
                <TD className="max-w-[480px] truncate" title={diff(r.old_data, r.new_data)}>{diff(r.old_data, r.new_data) || (r.new_data ? JSON.stringify(r.new_data).slice(0, 120) : '')}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function Dashboard() {
  const [from, setFrom] = useState('')
  const q = useQuery({ queryKey: ['q10', from], queryFn: () => rpc<FeatureCollection>('q10_incident_sla', from ? { p_from: new Date(from).toISOString() } : {}) })
  const data = q.data?.features.map((f) => f.properties) ?? []
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>Q10 – SLA sự cố theo khu</CardTitle><CardDescription>Phản hồi = nhận việc − tạo; xử lý = hoàn thành − tạo; gom theo ST_Within(sự cố, zone).</CardDescription></div>
        <div className="flex items-center gap-2"><Label>Từ ngày</Label><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="m" orientation="left" tick={{ fontSize: 11 }} label={{ value: 'phút', angle: -90, position: 'insideLeft', fontSize: 11 }} />
              <YAxis yAxisId="h" orientation="right" tick={{ fontSize: 11 }} label={{ value: 'giờ', angle: 90, position: 'insideRight', fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="m" dataKey="avg_response_min" name="Phản hồi TB (phút)" fill="#0891b2" />
              <Bar yAxisId="h" dataKey="avg_resolution_h" name="Xử lý TB (giờ)" fill="#f97316" />
              <Bar yAxisId="h" dataKey="p90_resolution_h" name="Xử lý P90 (giờ)" fill="#fdba74" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Table>
          <THead><TR><TH>Khu</TH><TH>Tổng</TH><TH>Đã xử lý</TH><TH>Đang mở</TH><TH>Phản hồi TB</TH><TH>Xử lý TB</TH></TR></THead>
          <TBody>
            {data.map((d) => (
              <TR key={d.id}><TD>{d.name}</TD><TD>{d.total}</TD><TD>{d.resolved}</TD><TD>{d.open}</TD><TD>{d.avg_response_min} phút</TD><TD>{d.avg_resolution_h} giờ</TD></TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

const EXPORTS = [
  ['layer_manholes', 'Hố ga'], ['layer_pipes', 'Cống'], ['layer_buildings', 'Công trình'], ['layer_utilities', 'Công trình ngầm'],
  ['layer_flood_points', 'Điểm ngập'], ['layer_incidents', 'Sự cố'], ['layer_zones', 'Khu phụ trách'], ['q12_defect_points', 'Lỗi lòng cống'],
] as const

function Exports() {
  const [busy, setBusy] = useState<string | null>(null)
  const go = async (fn: string, kind: 'geojson' | 'csv') => {
    setBusy(fn + kind)
    try {
      const fc = await rpc<FeatureCollection>(fn)
      const name = fn.replace(/^layer_/, '')
      if (kind === 'geojson') exportGeoJSON(name, fc)
      else exportCSV(name, fc)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Xuất dữ liệu</CardTitle><CardDescription>Dữ liệu lấy qua RPC (GeoJSON EPSG:4326, giữ Z) → tải về GeoJSON hoặc CSV.</CardDescription></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {EXPORTS.map(([fn, label]) => (
          <div key={fn} className="flex items-center justify-between rounded border p-2 text-sm">
            {label}
            <div className="flex gap-1">
              <Button size="xs" variant="outline" disabled={!!busy} onClick={() => go(fn, 'geojson')}><Download className="h-3 w-3" />GeoJSON</Button>
              <Button size="xs" variant="outline" disabled={!!busy} onClick={() => go(fn, 'csv')}><Download className="h-3 w-3" />CSV</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function AdminPage() {
  const [tab, setTab] = useState(() => localStorage.getItem('admin-tab') ?? 'users')
  useEffect(() => localStorage.setItem('admin-tab', tab), [tab])
  return (
    <div className="h-full overflow-auto p-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="users">Người dùng</TabsTrigger>
          <TabsTrigger value="zones">Khu phụ trách</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="sla">Dashboard Q10</TabsTrigger>
          <TabsTrigger value="export">Xuất dữ liệu</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><Users /></TabsContent>
        <TabsContent value="zones"><Zones /></TabsContent>
        <TabsContent value="audit"><Audit /></TabsContent>
        <TabsContent value="sla"><Dashboard /></TabsContent>
        <TabsContent value="export"><Exports /></TabsContent>
      </Tabs>
    </div>
  )
}
