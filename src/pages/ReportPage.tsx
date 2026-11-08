/** /report – người dân (chủ yếu trên điện thoại): chọn vị trí, loại sự cố, ảnh → gửi; theo dõi tiến độ */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Camera, CircleAlert, Crosshair, Droplets, HelpCircle, ImageOff, LocateFixed, MapPin, Send, Waves, Wind, X } from 'lucide-react'
import { MapView, flyTo } from '@/map/MapView'
import { FloodLayer, IncidentsLayer, ManholesLayer, OverlayLayer, PipesLayer } from '@/map/layers'
import type { Viewer as CViewer } from 'cesium'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Textarea } from '@/components/ui/input'
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback'
import { IncidentImage } from '@/components/IncidentImage'
import { useAuth } from '@/lib/auth'
import { useMapLayers } from '@/lib/queries'
import { rpc } from '@/lib/supabase'
import { uploadIncidentImage } from '@/lib/storage'
import { STATUS_VARIANT, STATUS_VI } from '@/lib/incidents'
import type { FeatureCollection } from '@/lib/types'
import { cn, fmtDate } from '@/lib/utils'

const KINDS = [
  { v: 'blocked', label: 'Tắc nghẽn', icon: Ban },
  { v: 'overflow', label: 'Trào nước', icon: Waves },
  { v: 'broken_cover', label: 'Vỡ / mất nắp', icon: CircleAlert },
  { v: 'odor', label: 'Mùi hôi', icon: Wind },
  { v: 'subsidence', label: 'Lún sụt', icon: Droplets },
  { v: 'other', label: 'Khác', icon: HelpCircle },
]
const STEPS = ['new', 'accepted', 'in_progress', 'resolved']

function Progress({ status }: { status: string }) {
  const idx = STEPS.indexOf(status)
  return (
    <ol className="flex gap-1" aria-label={`Tiến độ: ${STATUS_VI[status]}`}>
      {STEPS.map((s, i) => <li key={s} className={cn('h-1 flex-1 rounded-full', i <= idx ? (status === 'resolved' ? 'bg-success' : 'bg-primary') : 'bg-muted')} title={STATUS_VI[s]} />)}
    </ol>
  )
}

export default function ReportPage() {
  const { session } = useAuth()
  const L = useMapLayers()
  const qc = useQueryClient()
  const [viewer, setViewer] = useState<CViewer | null>(null)
  const [pt, setPt] = useState<{ lon: number; lat: number } | null>(null)
  const [kind, setKind] = useState('blocked')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const mine = useQuery({ queryKey: ['layer', 'layer_incidents', 'mine'], queryFn: () => rpc<FeatureCollection>('layer_incidents') })

  useEffect(() => {
    if (!file) return setPreview(null)
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  function locate() {
    if (!navigator.geolocation) return setErr('Trình duyệt không hỗ trợ định vị')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { setPt({ lon: p.coords.longitude, lat: p.coords.latitude }); flyTo(viewer, p.coords.longitude, p.coords.latitude, 0, 250); setLocating(false) },
      () => { setErr('Không lấy được vị trí – hãy chạm lên bản đồ để chọn.'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  async function submit() {
    if (!pt || !session) return
    setBusy(true)
    setErr(null)
    try {
      const path = file ? await uploadIncidentImage(session.user.id, file) : null
      const r = await rpc<any>('create_incident', { p_kind: kind, p_lon: pt.lon, p_lat: pt.lat, p_note: note || null, p_image_path: path })
      toast.success(`Đã gửi báo cáo #${r.id}`, { description: r.manhole_id ? `Gắn với hố ga gần nhất #${r.manhole_id}. Bạn có thể theo dõi tiến độ bên dưới.` : undefined })
      setNote(''); setFile(null); setPt(null)
      qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const marker: FeatureCollection | null = pt
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] }, properties: { __color: '#dc2626', __size: 18, __label: 'Vị trí sự cố' } }] }
    : null

  return (
    <div className="flex h-full flex-col overflow-auto md:grid md:grid-cols-[420px_1fr] md:overflow-hidden">
      {/* Bản đồ: trên cùng ở mobile, bên phải ở desktop */}
      <div className="relative h-[42vh] shrink-0 md:order-2 md:h-full">
        <MapView alpha={1} terrain="ellipsoid" onReady={setViewer} onPick={(p) => p.lon !== null && setPt({ lon: p.lon, lat: p.lat! })}>
          <PipesLayer fc={L.pipes} show />
          <ManholesLayer fc={L.manholes} show />
          <FloodLayer fc={L.flood} show />
          <IncidentsLayer fc={mine.data && { ...mine.data, features: mine.data.features.filter((f) => f.properties.status !== 'resolved') }} show />
          <OverlayLayer fc={marker} />
        </MapView>
        <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-between gap-2">
          <span className="map-panel flex min-w-0 items-center gap-2 truncate px-3 py-2 text-sm">
            <Crosshair className="size-4 text-primary" aria-hidden />{pt ? 'Đã chọn · chạm để đổi' : 'Chạm bản đồ để chọn vị trí'}
          </span>
          <Button variant="outline" className="pointer-events-auto shadow-e2" loading={locating} onClick={locate}><LocateFixed />Vị trí của tôi</Button>
        </div>
      </div>

      {/* Form */}
      <div className="flex min-h-0 flex-col md:order-1 md:border-r">
        <div className="flex-1 space-y-5 p-4 md:overflow-auto md:p-6">
          <div>
            <h1 className="text-xl font-semibold">Báo cáo sự cố thoát nước</h1>
            <p className="text-sm text-muted-foreground">Mất khoảng 1 phút. Kỹ thuật viên phụ trách khu vực sẽ nhận được ngay.</p>
          </div>

          <div className={cn('flex items-center gap-2 rounded-md border p-3 text-sm', pt ? 'border-success/30 bg-success-soft' : 'border-dashed')}>
            <MapPin className={cn('size-4', pt ? 'text-success' : 'text-subtle')} aria-hidden />
            {pt ? <span className="tabular">Vị trí: {pt.lat.toFixed(5)}, {pt.lon.toFixed(5)}</span> : <span className="text-muted-foreground">Bước 1 – chọn vị trí trên bản đồ</span>}
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted-foreground">Bước 2 – Loại sự cố</legend>
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map((k) => (
                <label key={k.v} className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-md border p-3 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', kind === k.v ? 'border-primary bg-primary-soft font-medium text-primary' : 'hover:bg-muted')}>
                  <input type="radio" name="kind" value={k.v} checked={kind === k.v} onChange={() => setKind(k.v)} className="sr-only" />
                  <k.icon className="size-5" aria-hidden />{k.label}
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Bước 3 – Mô tả (không bắt buộc)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: nước trào lên từ hố ga trước số nhà 12…" maxLength={500} />
          </Field>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Ảnh hiện trường (JPG/PNG/WebP ≤ 5 MB)</span>
            {preview ? (
              <div className="relative overflow-hidden rounded-md border">
                <img src={preview} alt="Ảnh sự cố đã chọn" className="h-40 w-full object-cover" />
                <Button size="icon" variant="outline" className="absolute right-2 top-2" onClick={() => setFile(null)} aria-label="Bỏ ảnh"><X /></Button>
              </div>
            ) : (
              <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                <Camera className="size-5" aria-hidden /> Chụp hoặc chọn ảnh
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f && f.size > 5 * 1024 * 1024) setErr('Ảnh lớn hơn 5 MB'); else setFile(f) }} />
              </label>
            )}
          </div>

          {err && <Alert error={err} onClose={() => setErr(null)} />}

          <section className="space-y-2 pt-2">
            <h2 className="section-title">Báo cáo của tôi ({mine.data?.features.length ?? 0})</h2>
            {mine.isLoading && <><Skeleton className="h-16" /><Skeleton className="h-16" /></>}
            {mine.data?.features.length === 0 && <EmptyState icon={<ImageOff className="size-5" />} title="Bạn chưa gửi báo cáo nào" description="Báo cáo đã gửi sẽ hiển thị ở đây cùng tiến độ xử lý." />}
            {mine.data?.features.map((f) => {
              const p = f.properties
              return (
                <article key={p.id} className="flex gap-3 rounded-md border bg-surface p-3">
                  {p.image_path ? <IncidentImage path={p.image_path} className="size-14 shrink-0 rounded object-cover" /> : <span className="flex size-14 shrink-0 items-center justify-center rounded bg-muted text-subtle"><ImageOff className="size-5" aria-hidden /></span>}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">#{p.id} · {KINDS.find((k) => k.v === p.kind)?.label ?? p.kind}</span>
                      <Badge variant={STATUS_VARIANT[p.status]} dot>{STATUS_VI[p.status]}</Badge>
                    </div>
                    <Progress status={p.status} />
                    <p className="truncate text-xs text-subtle">Gửi {fmtDate(p.created_at)}{p.resolved_at && ` · Xong ${fmtDate(p.resolved_at)}`}</p>
                  </div>
                </article>
              )
            })}
          </section>
        </div>
        {/* Nút gửi luôn trong tầm tay */}
        <div className="sticky bottom-0 border-t bg-surface/95 p-3 backdrop-blur md:static">
          <Button size="lg" className="w-full" disabled={!pt} loading={busy} onClick={submit}><Send />{pt ? 'Gửi báo cáo' : 'Chọn vị trí trước khi gửi'}</Button>
        </div>
      </div>
    </div>
  )
}
