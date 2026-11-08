/**
 * Chỉnh sửa mạng cống (technician/admin). Mọi thao tác gọi RPC SECURITY INVOKER ⇒
 * trigger topology + RLS theo khu phụ trách chạy trong CSDL; lỗi được hiển thị nguyên văn.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CircleDot, GitCommitHorizontal, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { rpc } from '@/lib/supabase'
import type { Feature } from '@/lib/types'

export type EditMode = 'none' | 'add-manhole' | 'add-pipe'

interface Props {
  mode: EditMode
  setMode: (m: EditMode) => void
  draftPoint: { lon: number; lat: number; height: number | null } | null
  pipeEnds: Feature[]
  clearPipeEnds: () => void
  selected: Feature | null
}

function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null
  const kind = msg.startsWith('TOPOLOGY') ? 'Lỗi topology (trigger)' : /RLS|row-level|permission/i.test(msg) ? 'Bị RLS từ chối' : 'Lỗi CSDL'
  return (
    <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
      <div className="font-semibold">{kind}</div>
      <div className="break-words">{msg}</div>
    </div>
  )
}

export function EditPanel({ mode, setMode, draftPoint, pipeEnds, clearPipeEnds, selected }: Props) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mh, setMh] = useState({ code: '', kind: 'manhole', depth: 2.0, diameter: 1.0 })
  const [pp, setPp] = useState({ code: '', d: 600, mat: 'BTCT' })
  const [form, setForm] = useState<Record<string, any>>({})

  useEffect(() => {
    setErr(null)
    const p = selected?.properties
    if (p?.layer === 'manhole') setForm({ code: p.code, kind: p.kind, status: p.status, rim_elev_m: p.rim_elev_m, invert_elev_m: p.invert_elev_m, diameter_m: p.diameter_m })
    else if (p?.layer === 'pipe') setForm({ code: p.code, status: p.status, diameter_mm: p.diameter_mm, material_code: p.material_code, install_year: p.install_year, valid_from: '' })
    else setForm({})
  }, [selected])

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
      toast.error(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const sp = selected?.properties
  const editable = sp && (sp.layer === 'manhole' || sp.layer === 'pipe') && !sp.public

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant={mode === 'add-manhole' ? 'default' : 'outline'} onClick={() => setMode(mode === 'add-manhole' ? 'none' : 'add-manhole')}>
          <CircleDot className="h-4 w-4" /> Thêm hố ga
        </Button>
        <Button size="sm" variant={mode === 'add-pipe' ? 'default' : 'outline'} onClick={() => { clearPipeEnds(); setMode(mode === 'add-pipe' ? 'none' : 'add-pipe') }}>
          <GitCommitHorizontal className="h-4 w-4" /> Thêm cống
        </Button>
      </div>

      {mode === 'add-manhole' && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="text-xs">{draftPoint ? `Vị trí: ${draftPoint.lon.toFixed(6)}, ${draftPoint.lat.toFixed(6)} (cao độ nắp sẽ nội suy từ TIN)` : 'Click lên bản đồ để đặt hố ga…'}</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Mã (tuỳ chọn)</Label><Input value={mh.code} onChange={(e) => setMh({ ...mh, code: e.target.value })} /></div>
            <div><Label>Loại</Label>
              <Select value={mh.kind} onChange={(e) => setMh({ ...mh, kind: e.target.value })}>
                <option value="manhole">Hố ga</option><option value="inlet">Hố thu</option><option value="outfall">Cửa xả</option>
              </Select></div>
            <div><Label>Chiều sâu (m)</Label><Input type="number" step={0.1} value={mh.depth} onChange={(e) => setMh({ ...mh, depth: Number(e.target.value) })} /></div>
            <div><Label>Đường kính hố (m)</Label><Input type="number" step={0.1} value={mh.diameter} onChange={(e) => setMh({ ...mh, diameter: Number(e.target.value) })} /></div>
          </div>
          <Button size="sm" className="w-full" disabled={!draftPoint || busy}
            onClick={() => act(() => rpc('create_manhole', { p_lon: draftPoint!.lon, p_lat: draftPoint!.lat, p_code: mh.code || null, p_kind: mh.kind, p_depth_m: mh.depth, p_diameter_m: mh.diameter }), 'Đã thêm hố ga (kèm cây CSG)')}>
            <Save className="h-4 w-4" /> Lưu hố ga
          </Button>
        </div>
      )}

      {mode === 'add-pipe' && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="text-xs">Chọn lần lượt hố ga <b>thượng lưu</b> rồi <b>hạ lưu</b> trên bản đồ:</div>
          <div className="text-xs font-mono">{pipeEnds.map((f) => f.properties.code).join(' → ') || '—'}</div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Mã</Label><Input value={pp.code} onChange={(e) => setPp({ ...pp, code: e.target.value })} /></div>
            <div><Label>D (mm)</Label>
              <Select value={pp.d} onChange={(e) => setPp({ ...pp, d: Number(e.target.value) })}>{[600, 800, 1000, 1200, 1500].map((d) => <option key={d}>{d}</option>)}</Select></div>
            <div><Label>Vật liệu</Label>
              <Select value={pp.mat} onChange={(e) => setPp({ ...pp, mat: e.target.value })}><option>BTCT</option><option>HDPE</option><option>GACH</option></Select></div>
          </div>
          <Button size="sm" className="w-full" disabled={pipeEnds.length < 2 || busy}
            onClick={async () => { if (await act(() => rpc('create_pipe', { p_from_mh: pipeEnds[0].properties.id, p_to_mh: pipeEnds[1].properties.id, p_diameter_mm: pp.d, p_material_code: pp.mat, p_code: pp.code || null }), 'Đã thêm cống – topology hợp lệ')) clearPipeEnds() }}>
            <Save className="h-4 w-4" /> Lưu cống
          </Button>
          <Button size="xs" variant="ghost" onClick={clearPipeEnds}>Chọn lại</Button>
        </div>
      )}

      <div className="rounded-md border p-2">
        <div className="mb-2 text-xs font-semibold">Thuộc tính đối tượng đang chọn</div>
        {!editable && <div className="text-xs text-muted-foreground">Chọn một hố ga hoặc cống trên bản đồ.</div>}
        {editable && (
          <div className="space-y-2">
            <div className="text-xs">{sp.layer === 'pipe' ? 'Cống' : 'Hố ga'} <b>{sp.code}</b> (id {sp.id})</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(form).map((k) => (
                <div key={k}>
                  <Label>{k}{k === 'valid_from' && ' (hiệu lực mới)'}</Label>
                  {k === 'status' ? (
                    <Select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                      {['active', 'maintenance', 'damaged', 'blocked', 'retired'].map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  ) : (
                    <Input type={k === 'valid_from' ? 'date' : 'text'} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground">Mỗi lần lưu: bản cũ được đóng (valid_to/tx_to) và chèn bản mới – không ghi đè.</div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={busy}
                onClick={() => {
                  const changes: Record<string, any> = {}
                  for (const [k, v] of Object.entries(form)) {
                    if (v === '' || v === null) continue
                    if (k === 'valid_from') changes[k] = new Date(v).toISOString()
                    else if (String(v) !== String(sp[k])) changes[k] = v
                  }
                  act(() => rpc(sp.layer === 'pipe' ? 'update_pipe' : 'update_manhole', { p_id: sp.id, p_changes: changes }), 'Đã lưu phiên bản mới')
                }}>
                <Save className="h-4 w-4" /> Lưu
              </Button>
              <Button size="sm" variant="destructive" disabled={busy}
                onClick={() => confirm(`Xóa ${sp.code}? (bản ghi được đóng thời gian, vẫn còn trong lịch sử)`) && act(() => rpc('delete_asset', { p_asset_type: sp.layer, p_id: sp.id }), 'Đã xóa (đóng hiệu lực)')}>
                <Trash2 className="h-4 w-4" /> Xóa
              </Button>
            </div>
          </div>
        )}
      </div>
      <ErrorBox msg={err} />
    </div>
  )
}
