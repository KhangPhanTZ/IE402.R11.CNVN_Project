/** /incidents – technician: nhận việc → có mặt → hoàn thành; toast realtime ở Layout */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Footprints, Hand, Inbox, MapPinned } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/input'
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { IncidentImage } from '@/components/IncidentImage'
import { useAuth } from '@/lib/auth'
import { rpc } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { KIND_VI, STATUS_VARIANT, STATUS_VI } from '@/lib/incidents'
import type { FeatureCollection } from '@/lib/types'
import { cn } from '@/lib/utils'

const dur = (a?: string, b?: string) => {
  if (!a || !b) return null
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m < 60 ? `${m} phút` : m < 1440 ? `${(m / 60).toFixed(1)} giờ` : `${(m / 1440).toFixed(1)} ngày`
}
const ago = (v: string) => {
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000)
  return m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`
}

/** Dòng thời gian 4 mốc: tạo → nhận → có mặt → xong, kèm thời lượng mỗi chặng */
function Timeline({ p }: { p: any }) {
  const steps = [
    { t: p.created_at, label: 'Tạo' },
    { t: p.accepted_at, label: 'Nhận', d: dur(p.created_at, p.accepted_at) },
    { t: p.arrived_at, label: 'Có mặt', d: dur(p.accepted_at, p.arrived_at) },
    { t: p.resolved_at, label: 'Xong', d: dur(p.arrived_at ?? p.accepted_at, p.resolved_at) },
  ]
  return (
    <ol className="flex items-center gap-1" aria-label="Tiến độ xử lý">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1" title={s.t ? `${s.label}: ${new Date(s.t).toLocaleString('vi-VN')}` : `${s.label}: chưa`}>
          {i > 0 && <span className={cn('h-px w-4', s.t ? 'bg-primary' : 'bg-border')} aria-hidden />}
          <span className="flex flex-col items-center">
            <span className={cn('size-2.5 rounded-full ring-2', s.t ? 'bg-primary ring-primary/20' : 'bg-surface ring-border')} aria-hidden />
            <span className={cn('mt-0.5 text-xs', s.t ? 'text-foreground' : 'text-subtle')}>{s.d ?? s.label}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

const FILTERS = [
  { v: 'open', label: 'Đang mở' },
  { v: 'mine', label: 'Việc của tôi' },
  { v: 'new', label: 'Chưa nhận' },
  { v: 'resolved', label: 'Đã xử lý' },
  { v: '', label: 'Tất cả' },
]

export default function IncidentsPage() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState('open')
  const [zone, setZone] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [resolving, setResolving] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['layer', 'layer_incidents', 'staff'], queryFn: () => rpc<FeatureCollection>('layer_incidents'), refetchInterval: 60_000 })

  const all = useMemo(() => q.data?.features.map((f) => f.properties) ?? [], [q.data])
  const match = (p: any, s: string) => (s === 'open' ? !['resolved', 'rejected'].includes(p.status) : s === 'mine' ? p.technician_id === session?.user.id && p.status !== 'resolved' : s ? p.status === s : true)
  const rows = useMemo(() => all.filter((p) => match(p, status) && (!zone || p.zone === zone)), [all, status, zone]) // eslint-disable-line react-hooks/exhaustive-deps
  const zones = useMemo(() => Array.from(new Set(all.map((p) => p.zone).filter(Boolean))) as string[], [all])

  async function act(id: number, fn: string, args: Record<string, unknown> = {}, ok = 'Đã cập nhật') {
    setBusy(id)
    try {
      await rpc(fn, { p_id: id, ...args })
      toast.success(`${ok} sự cố #${id}`)
      qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
    } catch (e: any) {
      const h = humanizeError(e.message)
      toast.error(h.title, { description: h.message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Xử lý sự cố</h1>
            <p className="text-sm text-muted-foreground">Danh sách tự cập nhật khi có sự cố mới (Realtime).</p>
          </div>
          <Select className="w-48" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Lọc theo khu">
            <option value="">Mọi khu</option>
            {zones.map((z) => <option key={z}>{z}</option>)}
          </Select>
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc trạng thái">
          {FILTERS.map((f) => {
            const n = all.filter((p) => match(p, f.v) && (!zone || p.zone === zone)).length
            return (
              <button key={f.v} role="tab" aria-selected={status === f.v} onClick={() => setStatus(f.v)}
                className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', status === f.v ? 'border-primary bg-primary text-primary-foreground' : 'bg-surface hover:bg-muted')}>
                {f.label}<span className={cn('rounded-full px-1.5 text-xs tabular', status === f.v ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>{n}</span>
              </button>
            )
          })}
        </div>

        {q.error && <Alert error={(q.error as Error).message} />}
        <div className="overflow-hidden rounded-lg border bg-surface shadow-e1">
          {q.isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={<Inbox className="size-5" />} title="Không có sự cố nào trong bộ lọc này" description="Thử chọn bộ lọc khác hoặc khu khác." />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent"><TH>Sự cố</TH><TH>Vị trí</TH><TH>Trạng thái</TH><TH>Tiến độ</TH><TH>Ảnh</TH><TH className="text-right">Thao tác</TH></TR>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id}>
                    <TD className="max-w-[280px]">
                      <p className="font-medium">#{p.id} · {KIND_VI[p.kind] ?? p.kind}</p>
                      <p className="truncate text-xs text-muted-foreground" title={p.note}>{p.note || '—'}</p>
                      <p className="text-xs text-subtle">{ago(p.created_at)}</p>
                    </TD>
                    <TD>
                      <p>{p.zone ?? '—'}</p>
                      <p className="text-xs text-subtle">Hố ga #{p.manhole_id ?? '—'}</p>
                    </TD>
                    <TD><Badge variant={STATUS_VARIANT[p.status]} dot>{STATUS_VI[p.status]}</Badge></TD>
                    <TD><Timeline p={p} /></TD>
                    <TD><IncidentImage path={p.image_path} className="h-10 w-14 rounded object-cover" /></TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button asChild size="icon" variant="ghost"><Link to={`/map?focus=incident:${p.id}`} aria-label={`Xem sự cố #${p.id} trên bản đồ`} title="Xem trên bản đồ"><MapPinned /></Link></Button>
                        {p.status === 'new' && <Button size="sm" loading={busy === p.id} onClick={() => act(p.id, 'incident_accept', {}, 'Đã nhận')}><Hand />Nhận việc</Button>}
                        {p.status === 'accepted' && <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => act(p.id, 'incident_arrive', {}, 'Đã có mặt tại')}><Footprints />Đã có mặt</Button>}
                        {p.status === 'in_progress' && <Button size="sm" variant="outline" loading={busy === p.id} onClick={() => setResolving(p.id)}><CheckCircle2 />Hoàn thành</Button>}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>
      <ConfirmDialog open={resolving !== null} onOpenChange={(v) => !v && setResolving(null)}
        title={`Hoàn thành sự cố #${resolving}`} description="Ghi chú xử lý sẽ được lưu vào sự cố và sự kiện của hố ga." confirmLabel="Hoàn thành"
        withNote="Ghi chú xử lý" defaultNote="Đã nạo vét, thông tắc"
        onConfirm={(note) => act(resolving!, 'incident_resolve', { p_note: note }, 'Đã hoàn thành')} />
    </div>
  )
}
