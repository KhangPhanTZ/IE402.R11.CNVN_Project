/** /incidents – technician nhận việc, cập nhật arrived_at → resolved_at; toast realtime ở Layout */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Footprints, Hand, MapPinned } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { IncidentImage } from '@/components/IncidentImage'
import { useAuth } from '@/lib/auth'
import { rpc } from '@/lib/supabase'
import { KIND_VI, STATUS_VARIANT, STATUS_VI } from '@/lib/incidents'
import type { FeatureCollection } from '@/lib/types'
import { fmtDate } from '@/lib/utils'

const mins = (a?: string, b?: string) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) : null)

export default function IncidentsPage() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState('open')
  const [zone, setZone] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['layer', 'layer_incidents', 'staff'], queryFn: () => rpc<FeatureCollection>('layer_incidents'), refetchInterval: 60_000 })

  const rows = useMemo(() => {
    const all = q.data?.features.map((f) => f.properties) ?? []
    return all.filter((p) => (status === 'open' ? !['resolved', 'rejected'].includes(p.status) : status === 'mine' ? p.technician_id === session?.user.id : status ? p.status === status : true) && (!zone || p.zone === zone))
  }, [q.data, status, zone, session])
  const zones = useMemo(() => Array.from(new Set((q.data?.features ?? []).map((f) => f.properties.zone).filter(Boolean))), [q.data])

  async function act(id: number, fn: string, args: Record<string, unknown> = {}) {
    setBusy(id)
    try {
      await rpc(fn, { p_id: id, ...args })
      toast.success(`Đã cập nhật sự cố #${id}`)
      qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-4 text-lg font-semibold">Xử lý sự cố</h2>
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Đang mở</option>
          <option value="mine">Việc của tôi</option>
          <option value="">Tất cả</option>
          {Object.entries(STATUS_VI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select className="w-48" value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">Mọi khu</option>
          {zones.map((z) => <option key={z}>{z}</option>)}
        </Select>
        <span className="text-sm text-muted-foreground">{rows.length} sự cố · cập nhật realtime</span>
      </div>
      {q.error && <div className="text-sm text-destructive">{(q.error as Error).message}</div>}
      <Table>
        <THead>
          <TR>
            <TH>#</TH><TH>Loại</TH><TH>Trạng thái</TH><TH>Khu</TH><TH>Hố ga</TH><TH>Ghi chú</TH><TH>Ảnh</TH>
            <TH>Tạo</TH><TH>Nhận (phút)</TH><TH>Đến (phút)</TH><TH>Xong</TH><TH className="text-right">Thao tác</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((p) => (
            <TR key={p.id}>
              <TD className="font-mono">{p.id}</TD>
              <TD>{KIND_VI[p.kind] ?? p.kind}</TD>
              <TD><Badge variant={STATUS_VARIANT[p.status]}>{STATUS_VI[p.status]}</Badge></TD>
              <TD>{p.zone ?? '—'}</TD>
              <TD>{p.manhole_id ?? '—'}</TD>
              <TD className="max-w-[220px] whitespace-pre-line">{p.note}</TD>
              <TD><IncidentImage path={p.image_path} className="h-10 w-14 rounded object-cover" /></TD>
              <TD className="whitespace-nowrap">{fmtDate(p.created_at)}</TD>
              <TD>{mins(p.created_at, p.accepted_at) ?? '—'}</TD>
              <TD>{mins(p.accepted_at, p.arrived_at) ?? '—'}</TD>
              <TD className="whitespace-nowrap">{fmtDate(p.resolved_at)}</TD>
              <TD className="space-x-1 whitespace-nowrap text-right">
                <Button asChild size="xs" variant="ghost"><Link to={`/map?focus=incident:${p.id}`}><MapPinned className="h-3 w-3" /></Link></Button>
                {p.status === 'new' && <Button size="xs" disabled={busy === p.id} onClick={() => act(p.id, 'incident_accept')}><Hand className="h-3 w-3" /> Nhận việc</Button>}
                {p.status === 'accepted' && <Button size="xs" variant="secondary" disabled={busy === p.id} onClick={() => act(p.id, 'incident_arrive')}><Footprints className="h-3 w-3" /> Đã đến</Button>}
                {p.status === 'in_progress' && (
                  <Button size="xs" variant="outline" disabled={busy === p.id} onClick={() => { const n = prompt('Ghi chú xử lý', 'Đã nạo vét, thông tắc'); if (n !== null) act(p.id, 'incident_resolve', { p_note: n }) }}>
                    <CheckCircle2 className="h-3 w-3" /> Hoàn thành
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}
