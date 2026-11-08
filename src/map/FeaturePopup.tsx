/** Popup 3 tab: NGỮ NGHĨA (thuộc tính) / KHÔNG GIAN (hình học 3D) / THỜI GIAN (bitemporal + sự kiện) */
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { rpc } from '@/lib/supabase'
import type { Feature } from '@/lib/types'
import { buildCsgTree, describeCsg } from '@/lib/csg'
import { fmtDate, fmtNum } from '@/lib/utils'

const LABELS: Record<string, string> = {
  code: 'Mã', kind: 'Loại', status: 'Trạng thái', diameter_mm: 'Đường kính (mm)', diameter_m: 'Đường kính hố (m)',
  material: 'Vật liệu', material_code: 'Mã vật liệu', manning_n: 'Hệ số Manning n', install_year: 'Năm lắp đặt',
  capacity_m3s: 'Sức chứa chảy đầy (m³/s)', name: 'Tên', floors: 'Số tầng', has_basement: 'Tầng hầm',
  year_built: 'Năm xây', owner: 'Đơn vị quản lý', max_depth_cm: 'Độ sâu ngập (cm)', source_url: 'Nguồn', note: 'Ghi chú',
  from_mh: 'Hố ga thượng lưu', to_mh: 'Hố ga hạ lưu', source: 'Nguồn dữ liệu', area_m2: 'Diện tích (m²)', type: 'Loại lỗi',
  severity: 'Mức độ', pipe_code: 'Cống', image_path: 'Ảnh',
}
const SPATIAL = new Set(['rim_elev_m', 'invert_elev_m', 'depth_m', 'up_invert_m', 'down_invert_m', 'length_m', 'slope', 'height_m', 'base_elev_m', 'chainage_m'])
const TEMPORAL = new Set(['valid_from', 'valid_to', 'tx_from', 'tx_to', 'occurred_at', 'created_at', 'accepted_at', 'arrived_at', 'resolved_at', 'inspected_at'])
const HIDDEN = new Set(['layer', 'csg', 'id', 'vid', 'surfaces', 'lod', 'public', 'user_id', 'technician_id'])

function Row({ k, v }: { k: string; v: unknown }) {
  let val: React.ReactNode = typeof v === 'boolean' ? (v ? 'Có' : 'Không') : fmtNum(v as any, 4)
  if (k === 'source_url' && typeof v === 'string') val = <a className="text-primary underline" href={v} target="_blank" rel="noreferrer">mở liên kết</a>
  if (TEMPORAL.has(k)) val = fmtDate(v as string)
  return (
    <div className="grid grid-cols-[45%_55%] gap-1 border-b py-1 text-xs">
      <span className="text-muted-foreground">{LABELS[k] ?? k}</span>
      <span className="break-words font-medium">{val}</span>
    </div>
  )
}

export function FeaturePopup({ feature, onClose, onShowBRep, extra }: { feature: Feature; onClose: () => void; onShowBRep?: (id: number) => void; extra?: React.ReactNode }) {
  const p = feature.properties
  const layer = p.layer as string
  const assetType = ['pipe', 'manhole', 'building', 'utility'].includes(layer) ? layer : null
  const history = useQuery({
    queryKey: ['asset_history', layer, p.id, p.vid],
    queryFn: () => rpc<any>('asset_history', { p_asset_type: layer, p_id: p.id }),
    enabled: !!assetType && !p.public,
  })
  const g = feature.geometry
  const coords: number[][] = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0] : []
  const zs = coords.map((c) => c[2]).filter((z) => z !== undefined)
  const semantic = Object.entries(p).filter(([k]) => !HIDDEN.has(k) && !SPATIAL.has(k) && !TEMPORAL.has(k) && (typeof p[k] !== 'object' || p[k] === null))
  const tree = layer === 'manhole' ? buildCsgTree(p.csg) : null
  const title = { pipe: 'Cống', manhole: 'Hố ga', building: 'Công trình', utility: 'Công trình ngầm', flood: 'Điểm ngập', defect: 'Lỗi lòng cống', incident: 'Sự cố', zone: 'Khu phụ trách' }[layer] ?? layer

  return (
    <div className="pointer-events-auto w-[360px] rounded-lg border bg-background/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <div className="text-[11px] uppercase text-muted-foreground">{title}{p.public && ' (công khai, rút gọn)'}</div>
          <div className="font-semibold">{p.code ?? p.name ?? `#${p.id}`}</div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <Tabs defaultValue="nn" className="px-3 pb-3">
        <TabsList className="mt-2 grid w-full grid-cols-3 [&>button]:px-1 [&>button]:text-[11px]">
          <TabsTrigger value="nn" title="Ngữ nghĩa">NN · Ngữ nghĩa</TabsTrigger>
          <TabsTrigger value="kg" title="Không gian">KG · Không gian</TabsTrigger>
          <TabsTrigger value="tg" title="Thời gian">TG · Thời gian</TabsTrigger>
        </TabsList>
        <TabsContent value="nn" className="max-h-[50vh] overflow-auto">
          {semantic.map(([k, v]) => <Row key={k} k={k} v={v} />)}
          {extra}
        </TabsContent>
        <TabsContent value="kg" className="max-h-[50vh] overflow-auto">
          <Row k="Kiểu hình học" v={`${g.type}${zs.length ? ' Z' : ''}`} />
          <Row k="CRS lưu trữ / hiển thị" v="EPSG:32648 (UTM 48N) → EPSG:4326" />
          {coords.length > 0 && <Row k="Số đỉnh" v={coords.length} />}
          {zs.length > 0 && <Row k="Z min / max (m)" v={`${Math.min(...zs).toFixed(3)} / ${Math.max(...zs).toFixed(3)}`} />}
          {Object.entries(p).filter(([k]) => SPATIAL.has(k)).map(([k, v]) => <Row key={k} k={k} v={v} />)}
          {g.type === 'Point' && <Row k="Toạ độ" v={`${coords[0][0].toFixed(6)}, ${coords[0][1].toFixed(6)}`} />}
          {g.type === 'LineString' && (
            <Row k="Đầu → cuối" v={`(${coords[0].map((c) => c.toFixed(5)).join(', ')}) → (${coords[coords.length - 1].map((c) => c.toFixed(5)).join(', ')})`} />
          )}
          {tree && (
            <div className="mt-2">
              <div className="text-xs font-medium">Cây CSG (frontend boundary evaluation → khối trụ)</div>
              <pre className="mt-1 rounded bg-muted p-2 text-[10px] leading-4">{describeCsg(tree)}</pre>
            </div>
          )}
          {layer === 'building' && (
            <div className="mt-2 space-y-1 text-xs">
              <div>B-Rep SUDM: {p.surfaces ? Object.entries(p.surfaces).map(([t, n]) => `${t}×${n}`).join(', ') : '—'} (LOD{p.lod ?? 1})</div>
              {onShowBRep && <Button size="xs" variant="outline" onClick={() => onShowBRep(p.id)}>Hiển thị bề mặt B-Rep</Button>}
            </div>
          )}
        </TabsContent>
        <TabsContent value="tg" className="max-h-[50vh] overflow-auto">
          {Object.entries(p).filter(([k]) => TEMPORAL.has(k)).map(([k, v]) => <Row key={k} k={k} v={v} />)}
          {assetType && !p.public && (
            <>
              <div className="mt-2 text-xs font-medium">Phiên bản (valid time × transaction time)</div>
              {history.isLoading && <div className="text-xs text-muted-foreground">Đang tải…</div>}
              {history.error && <div className="text-xs text-destructive">{(history.error as Error).message}</div>}
              <div className="mt-1 space-y-1">
                {history.data?.versions?.map((v: any) => (
                  <div key={v.vid ?? v.id} className="rounded border p-1.5 text-[11px]">
                    <div className="flex items-center gap-1">
                      {v.current ? <Badge variant="success">hiện hành</Badge> : v.tx_to ? <Badge variant="outline">đã thay thế (tx)</Badge> : <Badge variant="secondary">lịch sử (valid)</Badge>}
                      {v.diameter_mm && <span>D{v.diameter_mm}</span>}
                      {v.status && <span>· {v.status}</span>}
                    </div>
                    <div>Hiệu lực: {fmtDate(v.valid_from)} → {v.valid_to ? fmtDate(v.valid_to) : '∞'}</div>
                    <div className="text-muted-foreground">Ghi nhận: {fmtDate(v.tx_from)} → {v.tx_to ? fmtDate(v.tx_to) : '∞'}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs font-medium">Sự kiện (event-based) – {history.data?.events?.length ?? 0}</div>
              <div className="mt-1 space-y-1">
                {history.data?.events?.slice(0, 30).map((e: any) => (
                  <div key={e.id} className="border-l-2 border-primary pl-2 text-[11px]">
                    <span className="font-semibold">{e.event_type}</span> · {fmtDate(e.valid_time)}
                    <div className="truncate text-muted-foreground">{JSON.stringify(e.detail)}</div>
                  </div>
                ))}
              </div>
              {history.data?.inspections?.length > 0 && (
                <div className="mt-2 text-xs">Kiểm tra CCTV: {history.data.inspections.map((i: any) => `${new Date(i.inspected_at).toLocaleDateString('vi-VN')} (cấp ${i.grade}, ${i.defects} lỗi)`).join('; ')}</div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
