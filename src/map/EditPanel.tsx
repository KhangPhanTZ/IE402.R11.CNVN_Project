/**
 * Chỉnh sửa mạng cống (technician/admin). Mọi thao tác gọi RPC SECURITY INVOKER ⇒
 * trigger topology + RLS theo khu phụ trách chạy trong CSDL; lỗi được diễn giải nhưng vẫn giữ nguyên văn.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CircleDot, GitCommitHorizontal, MousePointerClick, Save, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/dialog'
import { rpc } from '@/lib/supabase'
import { fieldLabel, fieldUnit, VALUE_VI } from '@/lib/fields'
import { humanizeError } from '@/lib/errors'
import type { Feature } from '@/lib/types'
import { cn } from '@/lib/utils'

export type EditMode = 'none' | 'add-manhole' | 'add-pipe'

interface Props {
  mode: EditMode
  setMode: (m: EditMode) => void
  draftPoint: { lon: number; lat: number; height: number | null } | null
  pipeEnds: Feature[]
  clearPipeEnds: () => void
  selected: Feature | null
}

const STATUSES = ['active', 'maintenance', 'damaged', 'blocked', 'retired']

function Step({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold', done ? 'bg-success text-white' : 'bg-muted text-subtle')}>{n}</span>
      <span className={cn(done && 'text-muted-foreground')}>{children}</span>
    </li>
  )
}

export function EditPanel({ mode, setMode, draftPoint, pipeEnds, clearPipeEnds, selected }: Props) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mh, setMh] = useState({ code: '', kind: 'manhole', depth: 2.0, diameter: 1.0 })
  const [pp, setPp] = useState({ code: '', d: 600, mat: 'BTCT' })
  const [form, setForm] = useState<Record<string, any>>({})
  const [confirmDel, setConfirmDel] = useState(false)

  const sp = selected?.properties
  const initial = (): Record<string, any> =>
    sp?.layer === 'manhole'
      ? { code: sp.code, kind: sp.kind, status: sp.status, rim_elev_m: sp.rim_elev_m, invert_elev_m: sp.invert_elev_m, diameter_m: sp.diameter_m }
      : sp?.layer === 'pipe'
        ? { code: sp.code, status: sp.status, diameter_mm: sp.diameter_mm, material_code: sp.material_code, install_year: sp.install_year, valid_from: '' }
        : {}
  useEffect(() => { setErr(null); setForm(initial()) }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['layer'] })
    qc.invalidateQueries({ queryKey: ['asset_history'] })
  }
  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      toast.success(ok)
      refresh()
      return true
    } catch (e: any) {
      setErr(e.message)
      toast.error(humanizeError(e.message).title)
      return false
    } finally {
      setBusy(false)
    }
  }

  const editable = sp && (sp.layer === 'manhole' || sp.layer === 'pipe') && !sp.public
  const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== '' && v !== null && (k === 'valid_from' || String(v) !== String(sp?.[k]))))
  const dirty = Object.keys(changes).length > 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Thêm đối tượng">
        <Button variant={mode === 'add-manhole' ? 'default' : 'outline'} aria-pressed={mode === 'add-manhole'} onClick={() => setMode(mode === 'add-manhole' ? 'none' : 'add-manhole')}>
          <CircleDot /> Thêm hố ga
        </Button>
        <Button variant={mode === 'add-pipe' ? 'default' : 'outline'} aria-pressed={mode === 'add-pipe'} onClick={() => { clearPipeEnds(); setMode(mode === 'add-pipe' ? 'none' : 'add-pipe') }}>
          <GitCommitHorizontal /> Thêm cống
        </Button>
      </div>

      {mode === 'add-manhole' && (
        <div className="space-y-3 rounded-lg border bg-surface p-3 animate-fade-in">
          <ol className="space-y-1.5">
            <Step n={1} done={!!draftPoint}>{draftPoint ? `Vị trí ${draftPoint.lat.toFixed(5)}, ${draftPoint.lon.toFixed(5)}` : 'Click lên bản đồ để đặt vị trí'}</Step>
            <Step n={2} done={false}>Nhập thông số, bấm Lưu</Step>
          </ol>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mã" hint="Để trống: tự sinh"><Input value={mh.code} onChange={(e) => setMh({ ...mh, code: e.target.value })} /></Field>
            <Field label="Loại">
              <Select value={mh.kind} onChange={(e) => setMh({ ...mh, kind: e.target.value })}>
                {['manhole', 'inlet', 'outfall'].map((k) => <option key={k} value={k}>{VALUE_VI[k]}</option>)}
              </Select>
            </Field>
            <Field label="Chiều sâu" unit="m"><Input type="number" step={0.1} min={0.5} value={mh.depth} onChange={(e) => setMh({ ...mh, depth: Number(e.target.value) })} /></Field>
            <Field label="Đường kính hố" unit="m"><Input type="number" step={0.1} min={0.3} value={mh.diameter} onChange={(e) => setMh({ ...mh, diameter: Number(e.target.value) })} /></Field>
          </div>
          <p className="text-xs text-subtle">Cao độ nắp tự nội suy từ TIN; cây CSG (trụ ngoài − trụ trong + nắp) được sinh kèm.</p>
          <Button className="w-full" disabled={!draftPoint} loading={busy}
            onClick={() => act(() => rpc('create_manhole', { p_lon: draftPoint!.lon, p_lat: draftPoint!.lat, p_code: mh.code || null, p_kind: mh.kind, p_depth_m: mh.depth, p_diameter_m: mh.diameter }), 'Đã thêm hố ga')}>
            <Save /> Lưu hố ga
          </Button>
        </div>
      )}

      {mode === 'add-pipe' && (
        <div className="space-y-3 rounded-lg border bg-surface p-3 animate-fade-in">
          <ol className="space-y-1.5">
            <Step n={1} done={pipeEnds.length >= 1}>Hố ga thượng lưu: <b>{pipeEnds[0]?.properties.code ?? 'click chọn trên bản đồ'}</b></Step>
            <Step n={2} done={pipeEnds.length >= 2}>Hố ga hạ lưu: <b>{pipeEnds[1]?.properties.code ?? (pipeEnds.length ? 'click chọn tiếp' : '—')}</b></Step>
          </ol>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Mã"><Input value={pp.code} placeholder="tự sinh" onChange={(e) => setPp({ ...pp, code: e.target.value })} /></Field>
            <Field label="D" unit="mm">
              <Select value={pp.d} onChange={(e) => setPp({ ...pp, d: Number(e.target.value) })}>{[600, 800, 1000, 1200, 1500].map((d) => <option key={d}>{d}</option>)}</Select>
            </Field>
            <Field label="Vật liệu">
              <Select value={pp.mat} onChange={(e) => setPp({ ...pp, mat: e.target.value })}><option value="BTCT">BTCT</option><option value="HDPE">HDPE</option><option value="GACH">Gạch</option></Select>
            </Field>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={clearPipeEnds} disabled={!pipeEnds.length}><Undo2 />Chọn lại</Button>
            <Button className="flex-1" disabled={pipeEnds.length < 2} loading={busy}
              onClick={async () => { if (await act(() => rpc('create_pipe', { p_from_mh: pipeEnds[0].properties.id, p_to_mh: pipeEnds[1].properties.id, p_diameter_mm: pp.d, p_material_code: pp.mat, p_code: pp.code || null }), 'Đã thêm cống – topology hợp lệ')) clearPipeEnds() }}>
              <Save /> Lưu cống
            </Button>
          </div>
        </div>
      )}

      {err && <Alert error={err} onClose={() => setErr(null)} />}

      <div className="rounded-lg border bg-surface">
        <p className="section-title border-b px-3 py-2">Đối tượng đang chọn</p>
        {!editable ? (
          <EmptyState icon={<MousePointerClick className="size-5" />} title="Chưa chọn hố ga hoặc cống" description="Click vào một hố ga/cống trên bản đồ, hoặc tìm theo mã ở tab Lớp." />
        ) : (
          <div className="space-y-3 p-3">
            <p className="text-sm">{sp.layer === 'pipe' ? 'Cống' : 'Hố ga'} <b>{sp.code}</b></p>
            <div className="grid grid-cols-2 gap-3">
              {Object.keys(form).map((k) => (
                <Field key={k} label={k === 'valid_from' ? 'Hiệu lực mới từ' : fieldLabel(k)} unit={fieldUnit(k)} hint={k === 'valid_from' ? 'Để trống: hôm nay' : undefined}>
                  {k === 'status' ? (
                    <Select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                      {STATUSES.map((s) => <option key={s} value={s}>{VALUE_VI[s]}</option>)}
                    </Select>
                  ) : k === 'kind' ? (
                    <Select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                      {['manhole', 'inlet', 'outfall'].map((s) => <option key={s} value={s}>{VALUE_VI[s]}</option>)}
                    </Select>
                  ) : k === 'diameter_mm' ? (
                    <Select value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}>
                      {[600, 800, 1000, 1200, 1500].map((d) => <option key={d}>{d}</option>)}
                    </Select>
                  ) : (
                    <Input type={k === 'valid_from' ? 'date' : /_m$|_year$/.test(k) ? 'number' : 'text'} step="any" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  )}
                </Field>
              ))}
            </div>
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              Lưu sẽ đóng phiên bản cũ (valid_to / tx_to) và tạo phiên bản mới – không ghi đè. Xem lịch sử ở tab <b>Thời gian</b> của popup.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!dirty} loading={busy}
                onClick={() => {
                  const c = { ...changes }
                  if (c.valid_from) c.valid_from = new Date(c.valid_from).toISOString()
                  act(() => rpc(sp.layer === 'pipe' ? 'update_pipe' : 'update_manhole', { p_id: sp.id, p_changes: c }), 'Đã lưu phiên bản mới')
                }}>
                <Save /> {dirty ? `Lưu ${Object.keys(changes).length} thay đổi` : 'Chưa có thay đổi'}
              </Button>
              <Button variant="destructive-ghost" onClick={() => setConfirmDel(true)} aria-label={`Xoá ${sp.code}`}><Trash2 />Xoá</Button>
            </div>
          </div>
        )}
      </div>

      {editable && (
        <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} destructive confirmLabel="Xoá"
          title={`Xoá ${sp.layer === 'pipe' ? 'cống' : 'hố ga'} ${sp.code}?`}
          description="Bản ghi được đóng thời gian hiệu lực và vẫn còn trong lịch sử (có thể xem lại bằng Q9)."
          onConfirm={async () => { await act(() => rpc('delete_asset', { p_asset_type: sp.layer, p_id: sp.id }), `Đã xoá ${sp.code}`) }} />
      )}
    </div>
  )
}
