/** Panel phân tích Q1–Q12: mỗi truy vấn = 1 hàm RPC PostGIS + 1 nút; kết quả tô màu bản đồ + bảng */
import { useEffect, useRef, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { rpc } from '@/lib/supabase'
import type { Feature, FeatureCollection, Highlight } from '@/lib/types'
import { ratioColor } from './cesiumUtil'

export interface AnalysisResult {
  key: string
  title: string
  fc?: FeatureCollection
  highlight?: Highlight
  overlay?: FeatureCollection | null
  summary?: string
}

interface Props {
  selected: Feature | null
  lastClick: { lon: number; lat: number } | null
  scenarios: { id: number; name: string; intensity_mm_h: number; water_level_m: number }[]
  onResult: (r: AnalysisResult | null) => void
  waterLevel: number | null
  setWaterLevel: (v: number | null) => void
  setOverride: (fc: FeatureCollection | null, label?: string) => void
  setProfile: (p: FeatureCollection | null) => void
}

const byId = (fc: FeatureCollection, color: string | ((f: Feature) => string), key = 'id') =>
  Object.fromEntries(fc.features.map((f) => [f.properties[key], typeof color === 'string' ? color : color(f)]))

function Q({ code, title, desc, busy, onRun, children }: { code: string; title: string; desc: string; busy: boolean; onRun: () => void; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <div className="flex items-start gap-2">
        <Button size="xs" onClick={onRun} disabled={busy} className="w-12 shrink-0">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {code}
        </Button>
        <div className="min-w-0">
          <div className="text-xs font-semibold leading-tight">{title}</div>
          <div className="text-[11px] leading-tight text-muted-foreground">{desc}</div>
        </div>
      </div>
      {children && <div className="mt-1.5 grid grid-cols-2 gap-1.5">{children}</div>}
    </div>
  )
}

export function AnalysisPanel({ selected, lastClick, scenarios, onResult, waterLevel, setWaterLevel, setOverride, setProfile }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scenario, setScenario] = useState<number>(2)
  const [atTime, setAtTime] = useState('')
  const [q7src, setQ7src] = useState('flood')
  const [k, setK] = useState(1)
  const [q9date, setQ9date] = useState('2025-01-01')
  const [q9tx, setQ9tx] = useState('')
  const [minSev, setMinSev] = useState(1)
  const [pipeId, setPipeId] = useState('')
  const [mhId, setMhId] = useState('')
  const [waterOn, setWaterOn] = useState(false)
  const [waterInfo, setWaterInfo] = useState('')
  const timer = useRef<number>()

  useEffect(() => {
    if (selected?.properties.layer === 'pipe') setPipeId(String(selected.properties.id))
    if (selected?.properties.layer === 'manhole') setMhId(String(selected.properties.id))
  }, [selected])

  const level = (s = scenario) => scenarios.find((x) => x.id === s)

  async function run(key: string, fn: () => Promise<AnalysisResult | null>) {
    setBusy(key)
    setError(null)
    try {
      const r = await fn()
      onResult(r)
    } catch (e: any) {
      setError(`${key}: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }
  const params = () => (atTime ? { p_at: new Date(atTime).toISOString() } : { p_scenario_id: scenario })

  // ---- Thanh trượt mực nước: mặt nước dâng, hố ga tràn → đỏ, nhà bị ảnh hưởng → cam
  useEffect(() => {
    if (!waterOn || waterLevel === null) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      try {
        const [o, b] = await Promise.all([
          rpc<FeatureCollection>('q5_overflow', { p_water_level: waterLevel }),
          rpc<FeatureCollection>('q6_basement_risk', { p_water_level: waterLevel }),
        ])
        setWaterInfo(`${o.features.length} hố ga tràn · ${b.features.length} công trình bị ảnh hưởng`)
        onResult({
          key: 'water',
          title: `Mực nước ${waterLevel.toFixed(2)} m`,
          fc: { type: 'FeatureCollection', features: [...o.features, ...b.features] },
          highlight: {
            manholes: byId(o, '#dc2626'),
            buildings: byId(b, '#f97316'),
            legend: [{ color: '#dc2626', label: 'Hố ga tràn (cao độ nắp < mực nước)' }, { color: '#f97316', label: 'Nhà bị ảnh hưởng (Q6)' }],
          },
        })
      } catch (e: any) {
        setError(e.message)
      }
    }, 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterLevel, waterOn])

  return (
    <div className="space-y-2">
      {/* --- Mực nước --- */}
      <div className="rounded-md border bg-sky-50 p-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold">Mô phỏng mực nước ngập</div>
          <Switch
            checked={waterOn}
            onCheckedChange={(v) => {
              setWaterOn(v)
              setWaterLevel(v ? waterLevel ?? 1.2 : null)
              if (!v) onResult(null)
            }}
          />
        </div>
        {waterOn && (
          <>
            <div className="mt-2 flex items-center gap-2">
              <Slider min={0.5} max={3} step={0.05} value={[waterLevel ?? 1.2]} onValueChange={([v]) => setWaterLevel(v)} />
              <span className="w-14 text-right text-xs font-mono">{(waterLevel ?? 0).toFixed(2)} m</span>
            </div>
            <div className="mt-1 text-[11px] text-sky-800">{waterInfo || 'Kéo thanh trượt để dâng mặt nước'}</div>
          </>
        )}
      </div>

      {error && <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}

      <Q code="Q1" title="Cống dốc ngược" desc="slope ≤ 0,0005" busy={busy === 'Q1'}
        onRun={() => run('Q1', async () => {
          const fc = await rpc<FeatureCollection>('q1_reverse_slope')
          return { key: 'Q1', title: 'Q1 – Cống dốc ngược/dốc nhỏ', fc, highlight: { pipes: byId(fc, '#dc2626'), dimOthers: true, legend: [{ color: '#dc2626', label: 'slope ≤ 0,0005' }] } }
        })} />

      <Q code="Q2" title="Chôn nông" desc="Lớp phủ trên đỉnh ống < 0,7 m (nắp − đáy − D)" busy={busy === 'Q2'}
        onRun={() => run('Q2', async () => {
          const fc = await rpc<FeatureCollection>('q2_shallow_cover')
          return { key: 'Q2', title: 'Q2 – Cống chôn nông', fc, highlight: { pipes: byId(fc, '#f97316'), dimOthers: true, legend: [{ color: '#f97316', label: 'cover < 0,7 m' }] } }
        })} />

      <Q code="Q3" title="Va chạm 3D" desc="ST_3DDWithin cống ↔ công trình ngầm, khoảng hở < 0,3 m" busy={busy === 'Q3'}
        onRun={() => run('Q3', async () => {
          const fc = await rpc<FeatureCollection>('q3_clash_3d')
          return {
            key: 'Q3', title: 'Q3 – Va chạm 3D', fc,
            highlight: { pipes: byId(fc, '#dc2626', 'pipe_id'), utilities: byId(fc, '#d946ef', 'utility_id'), dimOthers: true,
              legend: [{ color: '#dc2626', label: 'Cống va chạm' }, { color: '#d946ef', label: 'Công trình ngầm' }, { color: '#facc15', label: 'Điểm gần nhất' }] },
            overlay: { type: 'FeatureCollection', features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: '#facc15', __size: 13, __label: `hở ${f.properties.clearance_m} m` } })) },
          }
        })} />

      <Q code="Q4" title="Truy vết thượng/hạ lưu" desc="WITH RECURSIVE từ cống bị tắc (chọn cống trên bản đồ)" busy={busy === 'Q4'}
        onRun={() => run('Q4', async () => {
          if (!pipeId) throw new Error('Chọn một cống trên bản đồ hoặc nhập id')
          const [up, down] = await Promise.all([
            rpc<FeatureCollection>('trace_upstream', { p_pipe_id: Number(pipeId) }),
            rpc<FeatureCollection>('trace_downstream', { p_pipe_id: Number(pipeId) }),
          ])
          const pipes: Record<number, string> = { ...byId(up, '#7c3aed'), ...byId(down, '#0891b2') }
          pipes[Number(pipeId)] = '#111827'
          return {
            key: 'Q4', title: `Q4 – Truy vết từ cống #${pipeId}`, fc: { type: 'FeatureCollection', features: [...up.features, ...down.features] },
            highlight: { pipes, dimOthers: true, legend: [{ color: '#111827', label: 'Cống bị tắc' }, { color: '#7c3aed', label: `Thượng lưu (${up.features.length - 1})` }, { color: '#0891b2', label: `Hạ lưu (${down.features.length - 1})` }] },
          }
        })}>
        <Input placeholder="id cống" value={pipeId} onChange={(e) => setPipeId(e.target.value)} />
      </Q>

      <div className="rounded-md border p-2">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">Tham số mưa cho Q5 / Q6 / Q8</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Select value={scenario} onChange={(e) => setScenario(Number(e.target.value))}>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.water_level_m} m)</option>)}
          </Select>
          <Input type="datetime-local" title="Hoặc thời điểm T theo water_obs" value={atTime} onChange={(e) => setAtTime(e.target.value)} />
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">Nhập thời điểm T → dùng mực nước quan trắc (trạm gần nhất – KNN); để trống → dùng kịch bản.</div>
      </div>

      <Q code="Q5" title="Hố ga tràn" desc="rim_elev_m < mực nước (kịch bản hoặc water_obs tại T)" busy={busy === 'Q5'}
        onRun={() => run('Q5', async () => {
          const fc = await rpc<FeatureCollection>('q5_overflow', params())
          const lv = atTime ? fc.meta?.max_level : level()?.water_level_m
          if (lv) setWaterLevel(Number(lv))
          return { key: 'Q5', title: `Q5 – Hố ga tràn (${fc.features.length})`, fc, highlight: { manholes: byId(fc, '#dc2626'), legend: [{ color: '#dc2626', label: `Tràn ở mực nước ${lv ?? '?'} m` }] } }
        })} />

      <Q code="Q6" title="Nhà có tầng hầm bị đe doạ" desc="Tầng hầm trong 30 m quanh hố ga tràn, hoặc nền < mực nước" busy={busy === 'Q6'}
        onRun={() => run('Q6', async () => {
          const [b, o] = await Promise.all([rpc<FeatureCollection>('q6_basement_risk', params()), rpc<FeatureCollection>('q5_overflow', params())])
          const lv = atTime ? o.meta?.max_level : level()?.water_level_m
          if (lv) setWaterLevel(Number(lv))
          return {
            key: 'Q6', title: `Q6 – Công trình rủi ro (${b.features.length})`, fc: b,
            highlight: { buildings: byId(b, (f) => (f.properties.has_basement ? '#ea580c' : '#fdba74')), manholes: byId(o, '#dc2626'),
              legend: [{ color: '#ea580c', label: 'Có tầng hầm' }, { color: '#fdba74', label: 'Nền thấp hơn mực nước' }, { color: '#dc2626', label: 'Hố ga tràn' }] },
          }
        })} />

      <Q code="Q7" title="Hố ga gần nhất (KNN)" desc="Toán tử <-> dùng index GIST" busy={busy === 'Q7'}
        onRun={() => run('Q7', async () => {
          if (q7src === 'point' && !lastClick) throw new Error('Click lên bản đồ để chọn điểm')
          const fc = await rpc<FeatureCollection>('q7_nearest_manhole', { p_source: q7src, p_k: k, ...(q7src === 'point' ? { p_lon: lastClick!.lon, p_lat: lastClick!.lat } : {}) })
          return {
            key: 'Q7', title: 'Q7 – Hố ga gần nhất', fc,
            highlight: { manholes: byId(fc, '#16a34a', 'manhole_id'), legend: [{ color: '#16a34a', label: 'Hố ga gần nhất' }, { color: '#facc15', label: 'Đường nối KNN' }] },
            overlay: { type: 'FeatureCollection', features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: '#facc15' } })) },
          }
        })}>
        <Select value={q7src} onChange={(e) => setQ7src(e.target.value)}>
          <option value="flood">Từ điểm ngập</option>
          <option value="incident">Từ sự cố chưa xử lý</option>
          <option value="point">Từ điểm vừa click</option>
        </Select>
        <Input type="number" min={1} max={5} value={k} onChange={(e) => setK(Number(e.target.value))} title="k" />
      </Q>

      <Q code="Q8" title="Quá tải cống" desc="Lưu vực Voronoi, Q = C·i·A/3,6e6 so với Manning" busy={busy === 'Q8'}
        onRun={() => run('Q8', async () => {
          const fc = await rpc<FeatureCollection>('q8_overload', { p_scenario_id: scenario })
          const pipesF = fc.features.filter((f) => f.properties.layer === 'pipe')
          const catch_ = fc.features.filter((f) => f.properties.layer === 'catchment')
          const qmax = Math.max(...catch_.map((f) => f.properties.q_in_m3s))
          return {
            key: 'Q8', title: `Q8 – Quá tải @ ${fc.meta?.intensity_mm_h} mm/h: ${fc.meta?.overloaded}/${fc.meta?.pipes} cống`,
            fc: { ...fc, features: pipesF },
            highlight: { pipes: Object.fromEntries(pipesF.map((f) => [f.properties.id, ratioColor(f.properties.ratio ?? 99)])),
              legend: [{ color: '#16a34a', label: 'Q/Qcap < 0,5' }, { color: '#eab308', label: '0,5–0,8' }, { color: '#f97316', label: '0,8–1' }, { color: '#dc2626', label: '> 1 (quá tải)' }] },
            overlay: { type: 'FeatureCollection', features: catch_.map((f) => ({ ...f, properties: { ...f.properties, __color: f.properties.q_in_m3s / qmax > 0.66 ? '#1d4ed8' : f.properties.q_in_m3s / qmax > 0.33 ? '#60a5fa' : '#bfdbfe', __alpha: 0.28 } })) },
          }
        })} />

      <Q code="Q9" title="Trạng thái mạng tại ngày T" desc="Lọc valid_from/valid_to (và tx time) + lịch sử sự kiện" busy={busy === 'Q9'}
        onRun={() => run('Q9', async () => {
          const fc = await rpc<FeatureCollection>('q9_as_of_date', { p_date: new Date(q9date).toISOString(), ...(q9tx ? { p_tx: new Date(q9tx).toISOString() } : {}) })
          setOverride(fc, `Ngày ${new Date(q9date).toLocaleDateString('vi-VN')}${q9tx ? ` (theo CSDL ngày ${new Date(q9tx).toLocaleDateString('vi-VN')})` : ''}: ${fc.meta?.pipes} cống, ${fc.meta?.manholes} hố ga`)
          return {
            key: 'Q9', title: `Q9 – Mạng tại ${new Date(q9date).toLocaleDateString('vi-VN')}`,
            fc: { type: 'FeatureCollection', features: (fc.meta?.events ?? []).map((e: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { ...e, detail: JSON.stringify(e.detail) } })) },
            summary: `${fc.meta?.pipes} cống, ${fc.meta?.manholes} hố ga hiệu lực; bảng dưới: 100 sự kiện gần nhất trước ngày T`,
          }
        })}>
        <div><Label>Valid time T</Label><Input type="date" value={q9date} onChange={(e) => setQ9date(e.target.value)} /></div>
        <div><Label>Transaction time (tuỳ chọn)</Label><Input type="date" value={q9tx} onChange={(e) => setQ9tx(e.target.value)} /></div>
      </Q>

      <Q code="Q10" title="SLA sự cố theo khu" desc="Thời gian phản hồi / xử lý trung bình, ST_Within zone" busy={busy === 'Q10'}
        onRun={() => run('Q10', async () => {
          const fc = await rpc<FeatureCollection>('q10_incident_sla')
          return { key: 'Q10', title: 'Q10 – SLA sự cố theo khu', fc, overlay: { type: 'FeatureCollection', features: fc.features.map((f, i) => ({ ...f, properties: { ...f.properties, __color: ['#0ea5e9', '#f97316'][i % 2], __alpha: 0.18 } })) } }
        })} />

      <Q code="Q11" title="Mặt cắt dọc tuyến cống" desc="Từ hố ga chọn → hạ lưu; cao độ mặt đất (TIN) & đáy ống" busy={busy === 'Q11'}
        onRun={() => run('Q11', async () => {
          if (!mhId) throw new Error('Chọn một hố ga trên bản đồ hoặc nhập id')
          const fc = await rpc<FeatureCollection>('q11_pipe_profile', { p_from_mh: Number(mhId) })
          setProfile(fc)
          const route = (fc.meta?.route ?? []) as any[]
          return { key: 'Q11', title: `Q11 – Mặt cắt dọc từ hố ga #${mhId} (${route.length} cống)`, highlight: { pipes: Object.fromEntries(route.map((r) => [r.pipe_id, '#db2777'])), dimOthers: true, legend: [{ color: '#db2777', label: 'Tuyến mặt cắt' }] },
            fc: { type: 'FeatureCollection', features: route.map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: r })) } }
        })}>
        <Input placeholder="id hố ga đầu tuyến" value={mhId} onChange={(e) => setMhId(e.target.value)} />
      </Q>

      <Q code="Q12" title="Lỗi lòng cống trên ống 3D" desc="ST_LineInterpolatePoint(geom, chainage/length)" busy={busy === 'Q12'}
        onRun={() => run('Q12', async () => {
          const fc = await rpc<FeatureCollection>('q12_defect_points', { p_min_severity: minSev })
          const sevColor = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#dc2626']
          return {
            key: 'Q12', title: `Q12 – ${fc.features.length} lỗi lòng cống`, fc,
            highlight: { pipes: byId(fc, '#64748b', 'pipe_id'), legend: sevColor.map((c, i) => ({ color: c, label: `Mức ${i + 1}` })) },
            overlay: { type: 'FeatureCollection', features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: sevColor[f.properties.severity - 1], __size: 6 + f.properties.severity * 1.5 } })) },
          }
        })}>
        <Select value={minSev} onChange={(e) => setMinSev(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Mức ≥ {s}</option>)}
        </Select>
      </Q>
    </div>
  )
}
