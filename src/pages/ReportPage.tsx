/** /report – người dân chọn vị trí trên bản đồ, loại sự cố, ảnh (Supabase Storage) */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MapPin, Send } from 'lucide-react'
import { MapView } from '@/map/MapView'
import { FloodLayer, IncidentsLayer, ManholesLayer, OverlayLayer, PipesLayer } from '@/map/layers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { IncidentImage } from '@/components/IncidentImage'
import { useAuth } from '@/lib/auth'
import { useMapLayers } from '@/lib/queries'
import { rpc } from '@/lib/supabase'
import { uploadIncidentImage } from '@/lib/storage'
import { KIND_VI, STATUS_VARIANT, STATUS_VI } from '@/lib/incidents'
import type { FeatureCollection } from '@/lib/types'
import { fmtDate } from '@/lib/utils'

export default function ReportPage() {
  const { session } = useAuth()
  const L = useMapLayers()
  const qc = useQueryClient()
  const [pt, setPt] = useState<{ lon: number; lat: number } | null>(null)
  const [kind, setKind] = useState('blocked')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const mine = useQuery({ queryKey: ['layer', 'layer_incidents', 'mine'], queryFn: () => rpc<FeatureCollection>('layer_incidents') })

  async function submit() {
    if (!pt || !session) return
    setBusy(true)
    setErr(null)
    try {
      const path = file ? await uploadIncidentImage(session.user.id, file) : null
      const r = await rpc<any>('create_incident', { p_kind: kind, p_lon: pt.lon, p_lat: pt.lat, p_note: note || null, p_image_path: path })
      toast.success(`Đã gửi báo cáo #${r.id}${r.manhole_id ? ` (hố ga gần nhất #${r.manhole_id})` : ''}`)
      setNote('')
      setFile(null)
      setPt(null)
      qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const marker: FeatureCollection | null = pt
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] }, properties: { __color: '#dc2626', __size: 16, __label: 'Vị trí sự cố' } }] }
    : null

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[380px_1fr]">
      <div className="flex min-h-0 flex-col gap-3 overflow-auto border-r p-4">
        <h2 className="text-lg font-semibold">Báo cáo sự cố thoát nước</h2>
        <div className="flex items-center gap-2 rounded border p-2 text-sm">
          <MapPin className="h-4 w-4 text-destructive" />
          {pt ? `${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}` : 'Click lên bản đồ để chọn vị trí'}
        </div>
        <div className="space-y-1"><Label>Loại sự cố</Label>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_VI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select></div>
        <div className="space-y-1"><Label>Mô tả</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: nước trào lên từ hố ga trước số nhà…" /></div>
        <div className="space-y-1"><Label>Ảnh (JPG/PNG/WebP ≤ 5 MB)</Label><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        {err && <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{err}</div>}
        <Button disabled={!pt || busy} onClick={submit}><Send className="h-4 w-4" /> Gửi báo cáo</Button>

        <h3 className="mt-4 font-semibold">Báo cáo của tôi ({mine.data?.features.length ?? 0})</h3>
        <div className="space-y-2">
          {mine.data?.features.map((f) => {
            const p = f.properties
            return (
              <div key={p.id} className="flex gap-2 rounded border p-2 text-xs">
                <IncidentImage path={p.image_path} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1"><b>#{p.id}</b> {KIND_VI[p.kind]} <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_VI[p.status]}</Badge></div>
                  <div className="truncate text-muted-foreground">{p.note}</div>
                  <div className="text-muted-foreground">Gửi: {fmtDate(p.created_at)}{p.resolved_at && ` · Xong: ${fmtDate(p.resolved_at)}`}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="relative min-h-[300px]">
        <MapView alpha={1} terrain="ellipsoid" onPick={(p) => p.lon !== null && setPt({ lon: p.lon, lat: p.lat! })}>
          <PipesLayer fc={L.pipes} show />
          <ManholesLayer fc={L.manholes} show />
          <FloodLayer fc={L.flood} show />
          <IncidentsLayer fc={mine.data} show />
          <OverlayLayer fc={marker} />
        </MapView>
      </div>
    </div>
  )
}
