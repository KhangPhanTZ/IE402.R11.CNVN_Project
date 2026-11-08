import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Viewer as CViewer } from 'cesium'
import { Layers, Loader2, PencilRuler, Sigma } from 'lucide-react'
import { MapView, flyTo, type PickInfo, type TerrainMode } from '@/map/MapView'
import { BRepLayer, BuildingsLayer, FloodLayer, IncidentsLayer, ManholesLayer, OverlayLayer, PipesLayer, TinLayer, UtilitiesLayer, WaterSurface, ZonesLayer } from '@/map/layers'
import { FeaturePopup } from '@/map/FeaturePopup'
import { AnalysisPanel, type AnalysisResult } from '@/map/AnalysisPanel'
import { EditPanel, type EditMode } from '@/map/EditPanel'
import { ProfileChart } from '@/map/ProfileChart'
import { ResultTable } from '@/map/ResultTable'
import { bbox, LOD_DISTANCE } from '@/map/cesiumUtil'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Label, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { useMapLayers } from '@/lib/queries'
import { rpc } from '@/lib/supabase'
import type { Feature, FeatureCollection, LayerKey } from '@/lib/types'

const LAYER_LABEL: Record<LayerKey, string> = {
  tin: 'Địa hình TIN', buildings: 'Công trình (LOD1)', pipes: 'Cống', manholes: 'Hố ga (CSG)', utilities: 'Công trình ngầm khác',
  flood: 'Điểm ngập', defects: 'Lỗi lòng cống', zones: 'Khu phụ trách', incidents: 'Sự cố',
}

export default function MapPage() {
  const { isStaff, role } = useAuth()
  const L = useMapLayers()
  const [params] = useSearchParams()
  const [viewer, setViewer] = useState<CViewer | null>(null)
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

  useEffect(() => {
    if (vis.defects && !defects && isStaff) {
      const sev = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#dc2626']
      rpc<FeatureCollection>('q12_defect_points').then((fc) =>
        setDefects({ ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: sev[f.properties.severity - 1], __size: 5 + f.properties.severity } })) }),
      )
    }
  }, [vis.defects, defects, isStaff])

  // ?focus=incident:12 → bay tới đối tượng
  useEffect(() => {
    const focus = params.get('focus')
    const f = focus ? index.get(focus) : null
    if (f && viewer) {
      setSelected(f)
      const c = firstCoord(f)
      flyTo(viewer, c[0], c[1], c[2] ?? 0, 220)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, viewer, index.size])

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

  const showTabs = isStaff
  const draftOverlay: FeatureCollection | null = draft && mode === 'add-manhole'
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [draft.lon, draft.lat] }, properties: { __color: '#facc15', __size: 14, __label: 'Hố ga mới' } }] }
    : null

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView alpha={alpha} terrain={isStaff ? terrain : 'ellipsoid'} tin={L.tin} onReady={setViewer} onPick={onPick}>
        <TinLayer fc={L.tin} show={vis.tin && alpha > 0.02} alpha={alpha} />
        <BuildingsLayer fc={L.buildings} highlight={result?.highlight} show={vis.buildings} />
        <PipesLayer fc={pipes} highlight={result?.highlight} show={vis.pipes} />
        <ManholesLayer fc={manholes} highlight={result?.highlight} show={vis.manholes} pickedIds={pipeEnds.map((f) => f.properties.id)} />
        <UtilitiesLayer fc={L.utilities} highlight={result?.highlight} show={vis.utilities} />
        <FloodLayer fc={L.flood} show={vis.flood} />
        <IncidentsLayer fc={L.incidents} show={vis.incidents} />
        <ZonesLayer fc={L.zones} show={vis.zones} />
        {vis.defects && <OverlayLayer fc={defects} />}
        <OverlayLayer fc={result?.overlay ?? draftOverlay} />
        <BRepLayer fc={brep} />
        <WaterSurface level={waterLevel} bounds={bounds} />
      </MapView>

      {/* Panel trái */}
      <div className="pointer-events-none absolute left-2 top-2 bottom-2 flex w-[340px] flex-col">
        <div className="pointer-events-auto flex max-h-full flex-col rounded-lg border bg-background/95 shadow-xl backdrop-blur">
          <Tabs defaultValue="layers" className="flex min-h-0 flex-col">
            <TabsList className="m-2 grid grid-cols-3">
              <TabsTrigger value="layers"><Layers className="mr-1 h-3.5 w-3.5" />Lớp</TabsTrigger>
              <TabsTrigger value="analysis" disabled={!showTabs}><Sigma className="mr-1 h-3.5 w-3.5" />Phân tích</TabsTrigger>
              <TabsTrigger value="edit" disabled={!showTabs}><PencilRuler className="mr-1 h-3.5 w-3.5" />Sửa</TabsTrigger>
            </TabsList>
            <TabsContent value="layers" className="min-h-0 overflow-auto px-3 pb-3">
              {!isStaff && (
                <div className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Chế độ {role === 'anon' ? 'khách' : 'người dân'}: chỉ xem mạng cống rút gọn (view <code>public_pipes</code>/<code>public_manholes</code> – không có cao độ đáy, độ dốc) và điểm ngập.
                </div>
              )}
              <div className="space-y-1.5">
                {(Object.keys(LAYER_LABEL) as LayerKey[])
                  .filter((k) => isStaff || ['pipes', 'manholes', 'flood', 'incidents'].includes(k))
                  .map((k) => (
                    <label key={k} className="flex items-center justify-between text-sm">
                      {LAYER_LABEL[k]}
                      <Switch checked={vis[k]} onCheckedChange={(v) => setVis({ ...vis, [k]: v })} />
                    </label>
                  ))}
              </div>
              <div className="mt-4">
                <Label>Độ đục mặt đất (globe translucency): {Math.round(alpha * 100)}%</Label>
                <Slider className="mt-2" min={0} max={1} step={0.05} value={[alpha]} onValueChange={([v]) => setAlpha(v)} />
                <div className="mt-1 text-[11px] text-muted-foreground">Kéo về 0 để nhìn xuyên đất thấy cống, hố ga, công trình ngầm.</div>
              </div>
              {isStaff && (
                <div className="mt-3">
                  <Label>Địa hình</Label>
                  <Select className="mt-1" value={terrain} onChange={(e) => setTerrain(e.target.value as TerrainMode)}>
                    <option value="tin">TIN (terrain tuỳ biến từ terrain_tin)</option>
                    <option value="ellipsoid">EllipsoidTerrainProvider</option>
                    <option value="world" disabled={!import.meta.env.VITE_CESIUM_TOKEN}>Cesium World Terrain (cần token)</option>
                  </Select>
                </div>
              )}
              <div className="mt-3 rounded bg-muted p-2 text-[11px] text-muted-foreground">
                LOD: camera xa hơn {LOD_DISTANCE} m → cống là đường, hố ga là điểm; lại gần → ống 3D đường kính thật (PolylineVolume) và khối hố ga CSG (distanceDisplayCondition).
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {L.isLoading ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Đang tải dữ liệu…</span> : (
                  <>Hố ga: {manholes?.features.length ?? 0} · Cống: {pipes?.features.length ?? 0} · Nhà: {L.buildings?.features.length ?? 0} · Tam giác TIN: {L.tin?.features.length ?? 0}</>
                )}
              </div>
              {L.errors.map((e, i) => <div key={i} className="mt-1 text-[11px] text-destructive">{e.message}</div>)}
            </TabsContent>
            <TabsContent value="analysis" className="min-h-0 overflow-auto px-3 pb-3">
              <AnalysisPanel
                selected={selected}
                lastClick={lastClick}
                scenarios={L.scenarios}
                onResult={setResult}
                waterLevel={waterLevel}
                setWaterLevel={setWaterLevel}
                setOverride={(fc, label) => setOverride(fc ? { fc, label: label ?? '' } : null)}
                setProfile={setProfile}
              />
            </TabsContent>
            <TabsContent value="edit" className="min-h-0 overflow-auto px-3 pb-3">
              <EditPanel mode={mode} setMode={(m) => { setMode(m); setDraft(null) }} draftPoint={draft} pipeEnds={pipeEnds} clearPipeEnds={() => setPipeEnds([])} selected={selected} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Banner Q9 / mực nước */}
      <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center gap-1">
        {override && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-indigo-700 px-4 py-1.5 text-sm text-white shadow">
            Q9 – {override.label}
            <Button size="xs" variant="secondary" onClick={() => setOverride(null)}>Về hiện tại</Button>
          </div>
        )}
        {waterLevel !== null && <div className="rounded-full bg-sky-700 px-3 py-1 text-xs text-white shadow">Mặt nước: {waterLevel.toFixed(2)} m</div>}
      </div>

      {/* Popup NN/KG/TG */}
      {selected && (
        <div className="pointer-events-none absolute right-2 top-2">
          <FeaturePopup
            feature={selected}
            onClose={() => { setSelected(null); setBrep(null) }}
            onShowBRep={async (id) => setBrep(await rpc<FeatureCollection>('building_surfaces', { p_building_id: id }))}
          />
        </div>
      )}

      {/* Bảng kết quả / mặt cắt */}
      <div className="pointer-events-none absolute bottom-2 left-[352px] right-2 space-y-2">
        {profile && <ProfileChart fc={profile} onClose={() => setProfile(null)} />}
        {result?.fc && result.key !== 'water' && (
          <ResultTable
            result={result}
            onClose={() => setResult(null)}
            onRow={(f) => {
              const id = f.id ?? (f.properties.pipe_id ? `pipe:${f.properties.pipe_id}` : null)
              const target = (id && index.get(id)) || f
              setSelected(target.properties.layer ? target : null)
              const c = firstCoord(target)
              if (c.length) flyTo(viewer, c[0], c[1], c[2] ?? 0)
            }}
          />
        )}
      </div>
    </div>
  )
}

function firstCoord(f: Feature): number[] {
  const walk = (c: any): number[] => (typeof c?.[0] === 'number' ? c : c?.length ? walk(c[0]) : [])
  return walk(f.geometry?.coordinates)
}
