import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Viewer as CViewer } from 'cesium'
import { AnimatePresence, animate, motion } from 'motion/react'
import { ChevronsLeft, ChevronsRight, CircleDot, Eye, EyeOff, GitCommitHorizontal, Info, Layers, Lock, Map as MapIcon, PencilRuler, Route, Search, Sigma, X } from 'lucide-react'
import { MapView, flyTo, type PickInfo, type TerrainMode } from '@/map/MapView'
import { BRepLayer, BuildingsLayer, FloodLayer, IncidentsLayer, ManholesLayer, OverlayLayer, PipesLayer, RoadsLayer, TinLayer, UtilitiesLayer, WaterSurface, ZonesLayer } from '@/map/layers'
import { FeaturePopup } from '@/map/FeaturePopup'
import { AnalysisPanel, type AnalysisResult } from '@/map/AnalysisPanel'
import { EditPanel, type EditMode } from '@/map/EditPanel'
import { ProfileChart } from '@/map/ProfileChart'
import { ResultTable } from '@/map/ResultTable'
import { MapLegend } from '@/map/MapLegend'
import { MapControls } from '@/map/MapControls'
import { BasemapSwitcher } from '@/map/BasemapSwitcher'
import { IonTokenField, useIonToken } from '@/map/IonTokenField'
import { useCommandPalette, useRegisterCommands, type CmdGroup } from '@/components/CommandPalette'
import { BASEMAPS, bbox, LOD_DISTANCE, tinSampler, type BasemapKey } from '@/map/cesiumUtil'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Label, Select } from '@/components/ui/input'
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
  { key: 'roads', label: 'Đường (bề rộng thật)', swatch: '#94a3b8' },
  { key: 'flood', label: 'Điểm ngập', swatch: '#0284c7' },
  { key: 'incidents', label: 'Sự cố', swatch: '#dc2626' },
  { key: 'utilities', label: 'Công trình ngầm khác', swatch: '#10b981', staff: true },
  { key: 'buildings', label: 'Công trình (LOD1)', swatch: '#cbd5e1', staff: true },
  { key: 'tin', label: 'Tô màu cao độ TIN', swatch: '#86c4a0', staff: true },
  { key: 'defects', label: 'Lỗi lòng cống', swatch: SEVERITY[4], staff: true },
  { key: 'zones', label: 'Khu phụ trách', swatch: '#0ea5e9', staff: true },
]

function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const c = animate(0, to, { duration: 0.8, ease: 'easeOut', onUpdate: (x) => setV(Math.round(x)) })
    return () => c.stop()
  }, [to])
  return <>{v}</>
}

function Kpi({ label, value, tone }: { label: string; value: number | string | undefined; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-slate-900/[0.06]">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {value === undefined ? <Skeleton className="mt-1 h-7 w-12" /> : (
        <p className={cn('mt-0.5 text-2xl font-semibold tracking-tight tabular', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning')}>
          {typeof value === 'number' ? <CountUp to={value} /> : value}
        </p>
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
  const [vis, setVis] = useState<Record<LayerKey, boolean>>({ tin: false, buildings: true, roads: true, pipes: true, manholes: true, utilities: true, flood: true, defects: false, zones: false, incidents: false })
  const [alpha, setAlpha] = useState(1)
  const [terrain, setTerrain] = useState<TerrainMode>('tin')
  const [terrainError, setTerrainError] = useState<string | null>(null)
  const ionToken = useIonToken()
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
  const [basemap, setBasemap] = useState<BasemapKey>('light')
  const { setOpen: openPalette } = useCommandPalette()

  const pipes = useMemo(() => (override ? { ...override.fc, features: override.fc.features.filter((f) => f.properties.layer === 'pipe') } : L.pipes), [override, L.pipes])
  const manholes = useMemo(() => (override ? { ...override.fc, features: override.fc.features.filter((f) => f.properties.layer === 'manhole') } : L.manholes), [override, L.manholes])

  // Chỉ mục id → feature để tra cứu khi click
  const index = useMemo(() => {
    const m = new Map<string, Feature>()
    for (const fc of [L.roads, pipes, manholes, L.buildings, L.utilities, L.flood, L.incidents, L.zones, result?.overlay, defects]) {
      for (const f of fc?.features ?? []) if (f.id) m.set(f.id, f)
    }
    return m
  }, [L.roads, pipes, manholes, L.buildings, L.utilities, L.flood, L.incidents, L.zones, result, defects])

  // Tuyến đường (gộp các đoạn cùng tên) để tìm theo tên đường; chỉ lấy đường có hố ga/cống
  const roadItems = useMemo(() => {
    const used = new Set<string>()
    for (const f of [...(manholes?.features ?? []), ...(pipes?.features ?? [])]) if (f.properties.road) used.add(f.properties.road)
    const byName = new Map<string, Feature[]>()
    for (const f of L.roads?.features ?? []) {
      const n = f.properties.name as string
      if (!used.has(n) && f.properties.road_class === 'residential' && n.startsWith('Hẻm không tên')) continue
      byName.set(n, [...(byName.get(n) ?? []), f])
    }
    return [...byName.entries()].map(([name, segs]) => ({
      name, segs, used: used.has(name),
      inlets: (manholes?.features ?? []).filter((f) => f.properties.road === name && f.properties.kind === 'inlet').length,
    }))
  }, [L.roads, manholes, pipes])

  const bounds = useMemo(() => bbox(L.zones ?? L.tin ?? null), [L.zones, L.tin])
  const groundZ = useMemo(() => tinSampler(L.tin), [L.tin])
  // Dải mặt đường: đặt theo cao độ TIN khi hiển thị địa hình TIN; với Cesium World Terrain (cao độ khác TIN
  // vài mét) thì để corridor bám mặt đất thật. Điểm/nhãn vẫn dùng TIN + bỏ kiểm tra độ sâu nên luôn hiện.
  const surfaceZ = isStaff && terrain === 'tin' ? groundZ : null

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



  // Lệnh cho bảng ⌘K: tìm tài sản theo mã, bật/tắt lớp, đổi bản đồ nền
  const commands: CmdGroup[] = useMemo(() => [
    { heading: 'Hố ga & cống', items: [...(manholes?.features ?? []), ...(pipes?.features ?? [])].filter((f) => f.properties.code).map((f) => ({
      id: f.id ?? f.properties.code, label: f.properties.code, keywords: f.properties.layer,
      hint: (f.properties.layer === 'pipe' ? `Cống${f.properties.diameter_mm ? ` D${f.properties.diameter_mm}` : ''}` : f.properties.kind === 'outfall' ? 'Cửa xả' : f.properties.kind === 'inlet' ? 'Hố thu' : 'Hố ga')
        + (f.properties.road ? ` · ${f.properties.road}` : ''),
      icon: f.properties.layer === 'pipe' ? <GitCommitHorizontal /> : <CircleDot />, run: () => focusOn(f) })) },
    { heading: 'Tuyến đường', items: roadItems.map((r) => ({
      id: `roadname:${r.name}`, label: r.name, keywords: 'đường duong road',
      hint: r.used ? `Có cống${r.inlets ? ` · ${r.inlets} hố thu` : ''}` : 'Chưa có cống',
      icon: <Route />, run: () => focusOn(r.segs[Math.floor(r.segs.length / 2)], 320) })) },
    { heading: 'Lớp bản đồ', items: LAYERS.filter((l) => isStaff || !l.staff).map((l) => ({
      id: `layer:${l.key}`, label: `${vis[l.key] ? 'Ẩn' : 'Hiện'} lớp ${l.label}`, icon: vis[l.key] ? <EyeOff /> : <Eye />, run: () => setVis((v) => ({ ...v, [l.key]: !v[l.key] })) })) },
    { heading: 'Bản đồ nền', items: (Object.keys(BASEMAPS) as BasemapKey[]).map((k) => ({ id: `basemap:${k}`, label: `Bản đồ nền: ${BASEMAPS[k].label}`, icon: <MapIcon />, run: () => setBasemap(k) })) },
  ], [manholes, pipes, vis, isStaff, roadItems]) // eslint-disable-line react-hooks/exhaustive-deps
  useRegisterCommands('map', commands)

  const draftOverlay: FeatureCollection | null = draft && mode === 'add-manhole'
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [draft.lon, draft.lat] }, properties: { __color: ANALYSIS.marker, __size: 14, __label: 'Hố ga mới' } }] }
    : null
  const openIncidents = L.incidents?.features.filter((f) => !['resolved', 'rejected'].includes(f.properties.status)).length
  const modeText = mode === 'add-manhole' ? 'Click lên bản đồ để đặt hố ga mới' : mode === 'add-pipe' ? `Click chọn hố ga ${pipeEnds.length === 0 ? 'thượng lưu' : pipeEnds.length === 1 ? 'hạ lưu' : '— đã đủ 2 hố ga'}` : null

  return (
    <div className={cn('relative h-full w-full overflow-hidden', mode !== 'none' && 'map-picking')}>
      <MapView alpha={alpha} basemap={basemap} terrain={isStaff ? terrain : 'ellipsoid'} tin={L.tin} onReady={setViewer} onPick={onPick}
        onTerrainError={(m) => { setTerrainError(m); setTerrain('tin') }}>
        <TinLayer fc={L.tin} show={vis.tin && alpha > 0.02} alpha={alpha} />
        <BuildingsLayer fc={L.buildings} highlight={result?.highlight} show={vis.buildings} />
        <RoadsLayer fc={L.roads} show={vis.roads} groundZ={surfaceZ} />
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

            <Button variant="outline" className="w-full justify-start text-subtle lg:hidden" onClick={() => openPalette(true)}>
              <Search /> Tìm hố ga, cống theo mã…
            </Button>

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
                {[{ v: 0, t: 'Nhìn xuyên đất' }, { v: 0.5, t: 'Bán trong suốt' }, { v: 1, t: 'Đặc' }].map((p) => (
                  <Button key={p.v} size="xs" variant={alpha === p.v ? 'secondary' : 'ghost'} onClick={() => setAlpha(p.v)}>{p.t}</Button>
                ))}
              </div>
            </div>

            {isStaff && (
              <div className="space-y-1.5">
                <Label htmlFor="terrain">Địa hình</Label>
                <Select id="terrain" value={terrain} onChange={(e) => { setTerrainError(null); setTerrain(e.target.value as TerrainMode) }}>
                  <option value="tin">TIN của dự án (terrain_tin)</option>
                  <option value="ellipsoid">Mặt ellipsoid phẳng</option>
                  <option value="world" disabled={!ionToken}>Cesium World Terrain{ionToken ? '' : ' (nhập token bên dưới)'}</option>
                </Select>
                <IonTokenField onSaved={() => { setTerrainError(null); setTerrain('world') }} onCleared={() => terrain === 'world' && setTerrain('tin')} />
                {terrainError && <p className="text-xs text-danger">{terrainError}</p>}
                {terrain === 'world' && (
                  <p className="text-xs text-subtle">World Terrain chỉ làm nền tham khảo: cao độ cống, hố ga, nhà tính theo TIN của dự án nên có thể lệch vài mét so với mặt đất này. Phân tích (Q2, Q5, Q6, Q11) luôn dùng TIN.</p>
                )}
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
      <div className="pointer-events-none absolute left-1/2 top-3 flex w-[min(440px,calc(100%-2rem))] -translate-x-1/2 flex-col items-center gap-2 max-lg:hidden" aria-live="polite">
        <button onClick={() => openPalette(true)} aria-label="Tìm kiếm (Ctrl K)"
          className="glass-panel pointer-events-auto flex h-11 w-full items-center gap-3 rounded-full px-4 text-left text-sm text-subtle transition-shadow hover:shadow-e3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Search className="size-4 text-slate-500" aria-hidden />
          <span className="flex-1 truncate">Tìm hố ga, cống, lớp bản đồ…</span>
          <kbd className="rounded-md border bg-white px-1.5 py-0.5 text-xs font-medium text-slate-500">Ctrl K</kbd>
        </button>
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
      <AnimatePresence>
        {selected && (
          <motion.div key={selected.id ?? 'sel'} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-x-3 bottom-3 z-10 sm:inset-x-auto sm:bottom-auto sm:right-16 sm:top-3">
            <FeaturePopup feature={selected} onClose={() => { setSelected(null); setBrep(null) }}
              onShowBRep={async (id) => setBrep(await rpc<FeatureCollection>('building_surfaces', { p_building_id: id }))} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Điều khiển bản đồ ---------------- */}
      <div className="pointer-events-none absolute bottom-8 right-3 z-10 flex flex-col items-end gap-2">
        <BasemapSwitcher value={basemap} onChange={setBasemap} />
        <MapControls viewer={viewer} />
      </div>

      {/* ---------------- Chú giải ---------------- */}
      {!result && !selected && <MapLegend className="absolute bottom-8 right-16 hidden md:block" staff={isStaff} />}

      {/* ---------------- Kết quả / mặt cắt ---------------- */}
      <div className={cn('pointer-events-none absolute bottom-8 right-16 space-y-2', panelOpen ? 'left-3 lg:left-[384px]' : 'left-3', selected && 'sm:right-[452px]')}>
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
