import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Viewer as CViewer } from 'cesium'
import { ChevronsLeft, ChevronsRight, Info, Layers, Lock, PencilRuler, Search, Sigma, X } from 'lucide-react'
import { MapView, flyTo, type PickInfo, type TerrainMode } from '@/map/MapView'
import { BRepLayer, BuildingsLayer, FloodLayer, IncidentsLayer, ManholesLayer, OverlayLayer, PipesLayer, TinLayer, UtilitiesLayer, WaterSurface, ZonesLayer } from '@/map/layers'
import { FeaturePopup } from '@/map/FeaturePopup'
import { AnalysisPanel, type AnalysisResult } from '@/map/AnalysisPanel'
import { EditPanel, type EditMode } from '@/map/EditPanel'
import { ProfileChart } from '@/map/ProfileChart'
import { ResultTable } from '@/map/ResultTable'
import { MapLegend } from '@/map/MapLegend'
import { bbox, LOD_DISTANCE, tinSampler } from '@/map/cesiumUtil'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input, Label, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton, Spinner } from '@/components/ui/feedback'
import { useAuth } from '@/lib/auth'
import { useMapLayers } from '@/lib/queries'
import { rpc } from '@/lib/supabase'
import { ANALYSIS, SEVERITY, STATUS } from '@/lib/theme'
import type { Feature, FeatureCollection, LayerKey } from '@/lib/types'
import { cn } from '@/lib/utils'

const LAYERS: { key: LayerKey; label: string; swatch: string; staff?: boolean }[] = [
  { key: 'pipes', label: 'Cống', swatch: STATUS.active.color },
  { key: 'manholes', label: 'Hố ga (khối CSG)', swatch: '#334155' },
  { key: 'flood', label: 'Điểm ngập', swatch: '#0284c7' },
  { key: 'incidents', label: 'Sự cố', swatch: '#dc2626' },
  { key: 'utilities', label: 'Công trình ngầm khác', swatch: '#10b981', staff: true },
  { key: 'buildings', label: 'Công trình (LOD1)', swatch: '#cbd5e1', staff: true },
  { key: 'tin', label: 'Địa hình TIN', swatch: '#86c4a0', staff: true },
  { key: 'defects', label: 'Lỗi lòng cống', swatch: SEVERITY[4], staff: true },
  { key: 'zones', label: 'Khu phụ trách', swatch: '#0ea5e9', staff: true },
]

function Kpi({ label, value, tone }: { label: string; value: number | string | undefined; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-md border bg-surface px-2.5 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === undefined ? <Skeleton className="mt-1 h-6 w-10" /> : (
        <p className={cn('text-2xl font-semibold tabular', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning')}>{value}</p>
      )}
    </div>
  )
}

export default function MapPage() {
  const { isStaff, role } = useAuth()
  const L = useMapLayers()
  const [params] = useSearchParams()
  const [viewer, setViewer] = useState<CViewer | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [tab, setTab] = useState('layers')
  const [vis, setVis] = useState<Record<LayerKey, boolean>>({ tin: true, buildings: true, pipes: true, manholes: true, utilities: true, flood: true, defects: false, zones: false, incidents: false })
  const [alpha, setAlpha] = useState(0.45)
  const [terrain, setTerrain] = useState<TerrainMode>('tin')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [override, setOverride] = useState<{ fc: FeatureCollection; label: string } | null>(null)
  const [profile, setProfile] = useState<FeatureCollection | null>(null)
  const [waterLevel, setWaterLevel] = useState<number | null>(null)
  const [selected, setSelected] = useState<Feature | null>(null)
  const [lastClick, setLastClick] = useState<{ lon: number; lat: number } | null>(null)
  const [mode, setMode] = useState<EditMode>('none')
  const [draft, setDraft] = useState<{ lon: number; lat: number; height: number | null } | null>(null)
  const [pipeEnds, setPipeEnds] = useState<Feature[]>([])
  const [brep, setBrep] = useState<FeatureCollection | null>(null)
  const [defects, setDefects] = useState<FeatureCollection | null>(null)
  const [query, setQuery] = useState('')

  const pipes = override ? { ...override.fc, features: override.fc.features.filter((f) => f.properties.layer === 'pipe') } : L.pipes
  const manholes = override ? { ...override.fc, features: override.fc.features.filter((f) => f.properties.layer === 'manhole') } : L.manholes

  // Chỉ mục id → feature để tra cứu khi click
  const index = useMemo(() => {
    const m = new Map<string, Feature>()
    for (const fc of [pipes, manholes, L.buildings, L.utilities, L.flood, L.incidents, L.zones, result?.overlay, defects]) {
      for (const f of fc?.features ?? []) if (f.id) m.set(f.id, f)
    }
    return m
  }, [pipes, manholes, L.buildings, L.utilities, L.flood, L.incidents, L.zones, result, defects])

  const bounds = useMemo(() => bbox(L.zones ?? L.tin ?? null), [L.zones, L.tin])
  const groundZ = useMemo(() => tinSampler(L.tin), [L.tin])
  const codes = useMemo(() => [...(manholes?.features ?? []), ...(pipes?.features ?? [])].map((f) => f.properties.code as string).filter(Boolean).sort(), [manholes, pipes])

  useEffect(() => {
    if (vis.defects && !defects && isStaff) {
      rpc<FeatureCollection>('q12_defect_points').then((fc) =>
        setDefects({ ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: SEVERITY[f.properties.severity - 1], __size: 5 + f.properties.severity } })) }),
      )
    }
  }, [vis.defects, defects, isStaff])

  const focusOn = (f: Feature, range = 160) => {
    setSelected(f.properties.layer ? f : null)
    const c = firstCoord(f)
    if (c.length) flyTo(viewer, c[0], c[1], c[2] ?? 0, range)
  }

  // ?focus=incident:12 → bay tới đối tượng
  useEffect(() => {
    const focus = params.get('focus')
    const f = focus ? index.get(focus) : null
    if (f && viewer) focusOn(f, 220)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, viewer, index.size])

  // Esc: thoát chế độ thêm / bỏ chọn
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest('[role="dialog"]')) return
      if (mode !== 'none') { setMode('none'); setDraft(null); setPipeEnds([]) } else setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  function onPick(p: PickInfo) {
    if (p.lon !== null && p.lat !== null) setLastClick({ lon: p.lon, lat: p.lat })
    if (mode === 'add-manhole' && p.lon !== null) {
      setDraft({ lon: p.lon, lat: p.lat!, height: p.height })
      return
    }
    const f = p.id ? index.get(p.id) : undefined
    if (mode === 'add-pipe' && f?.properties.layer === 'manhole') {
      setPipeEnds((e) => (e.length >= 2 ? [f] : [...e, f]))
      return
    }
    setSelected(f ?? null)
    if (f?.properties.layer !== 'building') setBrep(null)
  }

  function search(code: string) {
    const f = [...(manholes?.features ?? []), ...(pipes?.features ?? [])].find((x) => String(x.properties.code).toLowerCase() === code.trim().toLowerCase())
    if (f) { focusOn(f); setQuery('') }
  }

  const draftOverlay: FeatureCollection | null = draft && mode === 'add-manhole'
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [draft.lon, draft.lat] }, properties: { __color: ANALYSIS.marker, __size: 14, __label: 'Hố ga mới' } }] }
    : null
  const openIncidents = L.incidents?.features.filter((f) => !['resolved', 'rejected'].includes(f.properties.status)).length
  const modeText = mode === 'add-manhole' ? 'Click lên bản đồ để đặt hố ga mới' : mode === 'add-pipe' ? `Click chọn hố ga ${pipeEnds.length === 0 ? 'thượng lưu' : pipeEnds.length === 1 ? 'hạ lưu' : '— đã đủ 2 hố ga'}` : null

  return (
    <div className={cn('relative h-full w-full overflow-hidden', mode !== 'none' && 'map-picking')}>
      <MapView alpha={alpha} terrain={isStaff ? terrain : 'ellipsoid'} tin={L.tin} onReady={setViewer} onPick={onPick}>
        <TinLayer fc={L.tin} show={vis.tin && alpha > 0.02} alpha={alpha} />
        <BuildingsLayer fc={L.buildings} highlight={result?.highlight} show={vis.buildings} />
        <PipesLayer fc={pipes} highlight={result?.highlight} show={vis.pipes} />
        <ManholesLayer fc={manholes} highlight={result?.highlight} show={vis.manholes} pickedIds={pipeEnds.map((f) => f.properties.id)} />
        <UtilitiesLayer fc={L.utilities} highlight={result?.highlight} show={vis.utilities} />
        <FloodLayer fc={L.flood} show={vis.flood} groundZ={groundZ} />
        <IncidentsLayer fc={L.incidents} show={vis.incidents} groundZ={groundZ} />
        <ZonesLayer fc={L.zones} show={vis.zones} />
        {vis.defects && <OverlayLayer fc={defects} groundZ={groundZ} />}
        <OverlayLayer fc={result?.overlay ?? draftOverlay} groundZ={groundZ} />
        <BRepLayer fc={brep} />
        <WaterSurface level={waterLevel} bounds={bounds} />
      </MapView>

      {/* Đang tải dữ liệu 3D */}
      {L.isLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="map-panel px-4 py-3"><Spinner label="Đang tải dữ liệu 3D…" /></div>
        </div>
      )}

      {/* ---------------- Panel trái ---------------- */}
      {!panelOpen && (
        <Button variant="outline" className="absolute left-3 top-3 shadow-e2" onClick={() => setPanelOpen(true)} aria-label="Mở bảng điều khiển">
          <ChevronsRight /> Bảng điều khiển
        </Button>
      )}
      <aside
        className={cn('map-panel absolute bottom-3 left-3 top-3 flex w-[min(360px,calc(100%-1.5rem))] flex-col transition-transform duration-200', !panelOpen && '-translate-x-[110%]')}
        aria-label="Bảng điều khiển bản đồ"
        aria-hidden={!panelOpen}
      >
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b p-2">
            <TabsList className="grid flex-1 grid-cols-3">
              <TabsTrigger value="layers"><Layers />Lớp</TabsTrigger>
              <TabsTrigger value="analysis" disabled={!isStaff}>{isStaff ? <Sigma /> : <Lock />}Phân tích</TabsTrigger>
              <TabsTrigger value="edit" disabled={!isStaff}>{isStaff ? <PencilRuler /> : <Lock />}Sửa</TabsTrigger>
            </TabsList>
            <Button size="icon" variant="ghost" onClick={() => setPanelOpen(false)} aria-label="Thu gọn bảng điều khiển"><ChevronsLeft /></Button>
          </div>

          <TabsContent value="layers" className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
            {!isStaff && (
              <Alert tone="info" title={role === 'anon' ? 'Bạn đang xem với tư cách khách' : 'Chế độ người dân'}>
                Chỉ hiển thị mạng cống rút gọn (không có cao độ đáy, độ dốc) và điểm ngập. Phân tích và chỉnh sửa dành cho kỹ thuật viên.
              </Alert>
            )}
            {/* Tổng quan nhanh */}
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Hố ga" value={manholes?.features.length} />
              <Kpi label="Cống" value={pipes?.features.length} />
              <Kpi label="Điểm ngập" value={L.flood?.features.length} tone="warning" />
              <Kpi label={isStaff ? 'Sự cố đang mở' : 'Sự cố của tôi'} value={role === 'anon' ? '—' : openIncidents} tone="danger" />
            </div>

            {/* Tìm theo mã – thay thế bàn phím cho thao tác click bản đồ */}
            <form className="relative" role="search" onSubmit={(e) => { e.preventDefault(); search(query) }}>
              <Label htmlFor="code-search" className="sr-only">Tìm hố ga hoặc cống theo mã</Label>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input id="code-search" list="code-list" className="pl-8" placeholder="Tìm mã hố ga / cống, vd. HG-A001" value={query}
                onChange={(e) => { setQuery(e.target.value); if (codes.includes(e.target.value)) search(e.target.value) }} />
              <datalist id="code-list">{codes.map((c) => <option key={c} value={c} />)}</datalist>
            </form>

            <fieldset className="space-y-1">
              <legend className="section-title mb-1.5">Lớp dữ liệu</legend>
              {LAYERS.filter((l) => isStaff || !l.staff).map((l) => (
                <label key={l.key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted">
                  <span className="size-3 rounded-sm ring-1 ring-black/10" style={{ background: l.swatch }} aria-hidden />
                  <span className="flex-1">{l.label}</span>
                  <Switch checked={vis[l.key]} onCheckedChange={(v) => setVis({ ...vis, [l.key]: v })} aria-label={`Hiện lớp ${l.label}`} />
                </label>
              ))}
            </fieldset>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="alpha">Độ đục mặt đất</Label>
                <span className="text-sm font-semibold tabular">{Math.round(alpha * 100)}%</span>
              </div>
              <Slider id="alpha" aria-label="Độ đục mặt đất" min={0} max={1} step={0.05} value={[alpha]} onValueChange={([v]) => setAlpha(v)} />
              <div className="flex gap-1.5">
                {[{ v: 0, t: 'Nhìn xuyên đất' }, { v: 0.45, t: 'Bán trong suốt' }, { v: 1, t: 'Đặc' }].map((p) => (
                  <Button key={p.v} size="xs" variant={alpha === p.v ? 'secondary' : 'ghost'} onClick={() => setAlpha(p.v)}>{p.t}</Button>
                ))}
              </div>
            </div>

            {isStaff && (
              <div className="space-y-1.5">
                <Label htmlFor="terrain">Địa hình</Label>
                <Select id="terrain" value={terrain} onChange={(e) => setTerrain(e.target.value as TerrainMode)}>
                  <option value="tin">TIN của dự án (terrain_tin)</option>
                  <option value="ellipsoid">Mặt ellipsoid phẳng</option>
                  <option value="world" disabled={!import.meta.env.VITE_CESIUM_TOKEN}>Cesium World Terrain (cần token)</option>
                </Select>
              </div>
            )}

            <p className="flex gap-2 rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
              <Info className="mt-px size-4 shrink-0" aria-hidden />
              Zoom gần hơn {LOD_DISTANCE} m để thấy ống 3D đúng đường kính và khối hố ga CSG; xa hơn hiển thị dạng đường/điểm.
            </p>
            {L.errors.map((e, i) => <Alert key={i} error={e.message} />)}
          </TabsContent>

          <TabsContent value="analysis" className="min-h-0 flex-1 overflow-auto p-3">
            <AnalysisPanel
              selected={selected}
              lastClick={lastClick}
              scenarios={L.scenarios}
              onResult={setResult}
              activeKey={result?.key}
              waterLevel={waterLevel}
              setWaterLevel={setWaterLevel}
              setOverride={(fc, label) => setOverride(fc ? { fc, label: label ?? '' } : null)}
              setProfile={setProfile}
            />
          </TabsContent>
          <TabsContent value="edit" className="min-h-0 flex-1 overflow-auto p-3">
            <EditPanel mode={mode} setMode={(m) => { setMode(m); setDraft(null) }} draftPoint={draft} pipeEnds={pipeEnds} clearPipeEnds={() => setPipeEnds([])} selected={selected} />
          </TabsContent>
        </Tabs>
      </aside>

      {/* ---------------- Thanh trạng thái phía trên ---------------- */}
      <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {modeText && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-900 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-e3 animate-fade-in">
            <span className="size-2 animate-pulse rounded-full bg-yellow-400" aria-hidden />
            {modeText}
            <kbd className="rounded bg-white/15 px-1.5 text-xs">Esc</kbd>
            <Button size="xs" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={() => { setMode('none'); setDraft(null); setPipeEnds([]) }}>Huỷ</Button>
          </div>
        )}
        {override && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-indigo-700 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-e3">
            Đang xem mạng cống ngày {override.label}
            <Button size="xs" variant="secondary" onClick={() => setOverride(null)}>Về hiện tại</Button>
          </div>
        )}
        {waterLevel !== null && <div className="rounded-full bg-sky-700 px-3 py-1 text-sm font-medium text-white shadow-e2">Mặt nước {waterLevel.toFixed(2)} m</div>}
      </div>

      {/* ---------------- Popup NN/KG/TG ---------------- */}
      {selected && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3">
          <FeaturePopup feature={selected} onClose={() => { setSelected(null); setBrep(null) }}
            onShowBRep={async (id) => setBrep(await rpc<FeatureCollection>('building_surfaces', { p_building_id: id }))} />
        </div>
      )}

      {/* ---------------- Chú giải ---------------- */}
      {!result && !selected && <MapLegend className="absolute bottom-3 right-3 hidden md:block" staff={isStaff} />}

      {/* ---------------- Kết quả / mặt cắt ---------------- */}
      <div className={cn('pointer-events-none absolute bottom-3 right-3 space-y-2', panelOpen ? 'left-3 lg:left-[384px]' : 'left-3', selected && 'sm:right-[396px]')}>
        {profile && <ProfileChart fc={profile} onClose={() => setProfile(null)} />}
        {result && result.key !== 'water' && (
          <ResultTable result={result} onClose={() => { setResult(null); setProfile(null) }}
            onRow={(f) => {
              const id = f.id ?? (f.properties.pipe_id ? `pipe:${f.properties.pipe_id}` : f.properties.manhole_id ? `manhole:${f.properties.manhole_id}` : null)
              focusOn((id && index.get(id)) || f)
            }} />
        )}
        {result?.key === 'water' && (
          <div className="pointer-events-auto ml-auto w-fit"><Button variant="outline" className="shadow-e2" onClick={() => setResult(null)}><X />Bỏ tô màu ngập</Button></div>
        )}
      </div>
    </div>
  )
}

function firstCoord(f: Feature): number[] {
  const walk = (c: any): number[] => (typeof c?.[0] === 'number' ? c : c?.length ? walk(c[0]) : [])
  return walk(f.geometry?.coordinates)
}
