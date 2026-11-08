/**
 * Panel phân tích: 12 truy vấn PostGIS (Q1–Q12) gom theo NHIỆM VỤ người dùng thay vì thứ tự đề bài.
 * Mỗi truy vấn = 1 hàm RPC; kết quả tô màu bản đồ (bảng màu ANALYSIS) + bảng kết quả.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, ChevronDown, CloudRain, History, MousePointerClick, Play, Route, ShieldCheck, Waves } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, Select } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Alert } from '@/components/ui/feedback'
import { rpc } from '@/lib/supabase'
import { ANALYSIS, SEVERITY, ratioColor } from '@/lib/theme'
import type { Feature, FeatureCollection, Highlight } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface AnalysisResult {
  key: string
  title: string
  fc?: FeatureCollection
  highlight?: Highlight
  overlay?: FeatureCollection | null
  summary?: string
  emptyText?: string
}

interface Props {
  selected: Feature | null
  lastClick: { lon: number; lat: number } | null
  scenarios: { id: number; name: string; intensity_mm_h: number; water_level_m: number }[]
  onResult: (r: AnalysisResult | null) => void
  activeKey?: string | null
  waterLevel: number | null
  setWaterLevel: (v: number | null) => void
  setOverride: (fc: FeatureCollection | null, label?: string) => void
  setProfile: (p: FeatureCollection | null) => void
}

const byId = (fc: FeatureCollection, color: string | ((f: Feature) => string), key = 'id') =>
  Object.fromEntries(fc.features.map((f) => [f.properties[key], typeof color === 'string' ? color : color(f)]))
const fcOf = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })

// ---------------------------------------------------------------------------
function Group({ icon, title, hint, defaultOpen, children }: { icon: ReactNode; title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <section className="rounded-lg border bg-surface">
      <button
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-primary-soft text-primary [&_svg]:size-4">{icon}</span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block text-xs text-subtle">{hint}</span>}
        </span>
        <ChevronDown className={cn('size-4 text-subtle transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="space-y-1 border-t p-1.5 animate-fade-in">{children}</div>}
    </section>
  )
}

function Item({ code, title, desc, busy, active, count, onRun, children, needs }: {
  code: string; title: string; desc: string; busy: boolean; active: boolean; count?: number | null; onRun: () => void; children?: ReactNode; needs?: string | null
}) {
  return (
    <div className={cn('rounded-md px-2.5 py-2 transition-colors', active ? 'bg-primary-soft ring-1 ring-primary/30' : 'hover:bg-muted/50')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{title}</span>
            <span className="rounded bg-muted px-1 text-xs font-medium text-subtle">{code}</span>
          </div>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        <Button size="xs" variant={active ? 'default' : 'outline'} loading={busy} onClick={onRun} disabled={!!needs} aria-label={`Chạy ${code}: ${title}`}>
          {!busy && <Play />} Chạy
        </Button>
      </div>
      {needs && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning"><MousePointerClick className="size-3.5" aria-hidden />{needs}</p>
      )}
      {active && count !== undefined && count !== null && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary"><CheckCircle2 className="size-3.5" aria-hidden />{count} kết quả – xem bảng bên dưới bản đồ</p>
      )}
      {children && <div className="mt-2 grid grid-cols-2 gap-2">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
export function AnalysisPanel({ selected, lastClick, scenarios, onResult, activeKey, waterLevel, setWaterLevel, setOverride, setProfile }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [scenario, setScenario] = useState<number>(2)
  const [atTime, setAtTime] = useState('')
  const [q7src, setQ7src] = useState('flood')
  const [k, setK] = useState(1)
  const [q9date, setQ9date] = useState('2025-01-01')
  const [q9tx, setQ9tx] = useState('')
  const [minSev, setMinSev] = useState(1)
  const [waterOn, setWaterOn] = useState(false)
  const [waterInfo, setWaterInfo] = useState<{ mh: number; b: number } | null>(null)
  const timer = useRef<number>()

  const sel = selected?.properties
  const selPipe = sel?.layer === 'pipe' && !sel.public ? sel : null
  const selMh = sel?.layer === 'manhole' && !sel.public ? sel : null
  const level = (s = scenario) => scenarios.find((x) => x.id === s)
  const params = () => (atTime ? { p_at: new Date(atTime).toISOString() } : { p_scenario_id: scenario })

  async function run(key: string, fn: () => Promise<AnalysisResult | null>) {
    setBusy(key)
    setError(null)
    try {
      const r = await fn()
      setCount(r?.fc?.features.length ?? null)
      onResult(r)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }
  const itemProps = (key: string) => ({ busy: busy === key, active: activeKey === key, count: activeKey === key ? count : null })

  // Thanh trượt mực nước: mặt nước dâng, hố ga tràn → đỏ, công trình bị ảnh hưởng → cam
  useEffect(() => {
    if (!waterOn || waterLevel === null) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      try {
        const [o, b] = await Promise.all([
          rpc<FeatureCollection>('q5_overflow', { p_water_level: waterLevel }),
          rpc<FeatureCollection>('q6_basement_risk', { p_water_level: waterLevel }),
        ])
        setWaterInfo({ mh: o.features.length, b: b.features.length })
        onResult({
          key: 'water',
          title: `Mực nước ${waterLevel.toFixed(2)} m`,
          fc: fcOf([...o.features, ...b.features]),
          highlight: {
            manholes: byId(o, ANALYSIS.critical),
            buildings: byId(b, ANALYSIS.warning),
            legend: [{ color: ANALYSIS.critical, label: 'Hố ga tràn (nắp thấp hơn mực nước)' }, { color: ANALYSIS.warning, label: 'Công trình bị ảnh hưởng' }],
          },
        })
      } catch (e: any) {
        setError(e.message)
      }
    }, 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterLevel, waterOn])

  return (
    <div className="space-y-2.5">
      {/* --- Mô phỏng ngập: chức năng "trình diễn" nổi bật nhất --- */}
      <div className={cn('rounded-lg border p-3 transition-colors', waterOn ? 'border-sky-300 bg-sky-50' : 'bg-surface')}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-sky-100 text-sky-700"><Waves className="size-4" aria-hidden /></span>
          <label htmlFor="water-switch" className="flex-1 cursor-pointer">
            <span className="block text-sm font-semibold">Mô phỏng mực nước ngập</span>
            <span className="block text-xs text-subtle">Mặt nước dâng · hố ga tràn · nhà bị ảnh hưởng</span>
          </label>
          <Switch
            id="water-switch"
            checked={waterOn}
            onCheckedChange={(v) => {
              setWaterOn(v)
              setWaterLevel(v ? waterLevel ?? 1.2 : null)
              if (!v) { onResult(null); setWaterInfo(null) }
            }}
          />
        </div>
        {waterOn && (
          <div className="mt-3 space-y-2 animate-fade-in">
            <div className="flex items-center gap-3">
              <Slider aria-label="Cao độ mặt nước" min={0.5} max={3} step={0.05} value={[waterLevel ?? 1.2]} onValueChange={([v]) => setWaterLevel(v)} />
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular text-sky-800">{(waterLevel ?? 0).toFixed(2)} m</span>
            </div>
            <div className="flex gap-2" aria-live="polite">
              <Badge variant="destructive" dot>{waterInfo?.mh ?? '…'} hố ga tràn</Badge>
              <Badge variant="warning" dot>{waterInfo?.b ?? '…'} công trình</Badge>
            </div>
          </div>
        )}
      </div>

      {error && <Alert error={error} onClose={() => setError(null)} />}

      <Group icon={<ShieldCheck />} title="Kiểm tra chất lượng mạng cống" hint="Phát hiện cống sai thiết kế, va chạm, hư hỏng" defaultOpen>
        <Item code="Q1" title="Cống dốc ngược / quá bằng" desc="Độ dốc ≤ 0,05% – nước không tự chảy" {...itemProps('Q1')}
          onRun={() => run('Q1', async () => {
            const fc = await rpc<FeatureCollection>('q1_reverse_slope')
            return { key: 'Q1', title: 'Cống dốc ngược / quá bằng', fc, emptyText: 'Không có cống nào dốc ngược – mạng đạt yêu cầu.', highlight: { pipes: byId(fc, ANALYSIS.critical), dimOthers: true, legend: [{ color: ANALYSIS.critical, label: 'Độ dốc ≤ 0,05%' }] } }
          })} />
        <Item code="Q2" title="Cống chôn quá nông" desc="Lớp đất phủ trên đỉnh ống < 0,7 m" {...itemProps('Q2')}
          onRun={() => run('Q2', async () => {
            const fc = await rpc<FeatureCollection>('q2_shallow_cover')
            return { key: 'Q2', title: 'Cống chôn quá nông', fc, emptyText: 'Mọi cống đều đủ lớp phủ ≥ 0,7 m.', highlight: { pipes: byId(fc, ANALYSIS.warning), dimOthers: true, legend: [{ color: ANALYSIS.warning, label: 'Lớp phủ < 0,7 m' }] } }
          })} />
        <Item code="Q3" title="Va chạm với công trình ngầm" desc="Khoảng hở 3D giữa hai mặt ống < 0,3 m" {...itemProps('Q3')}
          onRun={() => run('Q3', async () => {
            const fc = await rpc<FeatureCollection>('q3_clash_3d')
            return {
              key: 'Q3', title: 'Va chạm 3D với công trình ngầm', fc, emptyText: 'Không phát hiện va chạm nào.',
              highlight: { pipes: byId(fc, ANALYSIS.critical, 'pipe_id'), utilities: byId(fc, '#d946ef', 'utility_id'), dimOthers: true,
                legend: [{ color: ANALYSIS.critical, label: 'Cống' }, { color: '#d946ef', label: 'Công trình ngầm' }, { color: ANALYSIS.marker, label: 'Điểm gần nhất' }] },
              overlay: fcOf(fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: ANALYSIS.marker, __size: 13, __label: `hở ${f.properties.clearance_m} m` } }))),
            }
          })} />
        <Item code="Q12" title="Lỗi lòng cống (CCTV)" desc="Đặt từng lỗi lên ống 3D theo lý trình" {...itemProps('Q12')}
          onRun={() => run('Q12', async () => {
            const fc = await rpc<FeatureCollection>('q12_defect_points', { p_min_severity: minSev })
            return {
              key: 'Q12', title: `Lỗi lòng cống mức ≥ ${minSev}`, fc, emptyText: 'Không có lỗi ở mức này.',
              highlight: { pipes: byId(fc, '#64748b', 'pipe_id'), legend: SEVERITY.map((c, i) => ({ color: c, label: `Mức ${i + 1}` })) },
              overlay: fcOf(fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: SEVERITY[f.properties.severity - 1], __size: 6 + f.properties.severity * 1.5 } }))),
            }
          })}>
          <div className="col-span-2">
            <Label htmlFor="q12-sev">Mức độ tối thiểu</Label>
            <Select id="q12-sev" className="mt-1" value={minSev} onChange={(e) => setMinSev(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Mức {s} trở lên</option>)}
            </Select>
          </div>
        </Item>
      </Group>

      <Group icon={<CloudRain />} title="Ngập lụt & mưa" hint="Theo kịch bản mưa hoặc số liệu quan trắc" defaultOpen>
        <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/60 p-2.5">
          <div>
            <Label htmlFor="rain-scn">Kịch bản mưa</Label>
            <Select id="rain-scn" className="mt-1" value={scenario} disabled={!!atTime} onChange={(e) => setScenario(Number(e.target.value))}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.intensity_mm_h} mm/h</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="rain-at">Hoặc thời điểm quan trắc</Label>
            <Input id="rain-at" className="mt-1" type="datetime-local" value={atTime} onChange={(e) => setAtTime(e.target.value)} />
          </div>
          <p className="col-span-2 text-xs text-subtle">{atTime ? 'Đang dùng mực nước đo tại trạm gần nhất (KNN) ở thời điểm đã chọn.' : `Mực nước theo kịch bản: ${level()?.water_level_m ?? '…'} m.`}</p>
        </div>
        <Item code="Q5" title="Hố ga bị tràn" desc="Cao độ nắp thấp hơn mực nước" {...itemProps('Q5')}
          onRun={() => run('Q5', async () => {
            const fc = await rpc<FeatureCollection>('q5_overflow', params())
            const lv = atTime ? fc.meta?.max_level : level()?.water_level_m
            if (lv) setWaterLevel(Number(lv))
            return { key: 'Q5', title: `Hố ga tràn ở mực nước ${lv ?? '?'} m`, fc, emptyText: 'Không hố ga nào bị tràn ở mực nước này.', highlight: { manholes: byId(fc, ANALYSIS.critical), legend: [{ color: ANALYSIS.critical, label: 'Hố ga tràn' }] } }
          })} />
        <Item code="Q6" title="Công trình có nguy cơ ngập" desc="Tầng hầm trong 30 m quanh hố ga tràn, hoặc nền thấp" {...itemProps('Q6')}
          onRun={() => run('Q6', async () => {
            const [b, o] = await Promise.all([rpc<FeatureCollection>('q6_basement_risk', params()), rpc<FeatureCollection>('q5_overflow', params())])
            const lv = atTime ? o.meta?.max_level : level()?.water_level_m
            if (lv) setWaterLevel(Number(lv))
            return {
              key: 'Q6', title: 'Công trình có nguy cơ ngập', fc: b, emptyText: 'Không công trình nào bị ảnh hưởng.',
              highlight: { buildings: byId(b, (f) => (f.properties.has_basement ? ANALYSIS.critical : ANALYSIS.warning)), manholes: byId(o, ANALYSIS.critical),
                legend: [{ color: ANALYSIS.critical, label: 'Có tầng hầm' }, { color: ANALYSIS.warning, label: 'Nền thấp hơn mực nước' }] },
            }
          })} />
        <Item code="Q8" title="Cống quá tải" desc="Lưu vực Voronoi · Q = C·i·A so với sức chứa Manning" {...itemProps('Q8')}
          onRun={() => run('Q8', async () => {
            const fc = await rpc<FeatureCollection>('q8_overload', { p_scenario_id: scenario })
            const pipesF = fc.features.filter((f) => f.properties.layer === 'pipe').sort((a, b) => (b.properties.ratio ?? 99) - (a.properties.ratio ?? 99))
            const catch_ = fc.features.filter((f) => f.properties.layer === 'catchment')
            const qmax = Math.max(...catch_.map((f) => f.properties.q_in_m3s))
            return {
              key: 'Q8', title: `Tải cống ở mưa ${fc.meta?.intensity_mm_h} mm/h`, fc: fcOf(pipesF),
              summary: `${fc.meta?.overloaded}/${fc.meta?.pipes} cống quá tải`,
              highlight: { pipes: Object.fromEntries(pipesF.map((f) => [f.properties.id, ratioColor(f.properties.ratio ?? 99)])),
                legend: [{ color: ANALYSIS.ok, label: '< 50%' }, { color: ANALYSIS.caution, label: '50–80%' }, { color: ANALYSIS.warning, label: '80–100%' }, { color: ANALYSIS.critical, label: '> 100%' }] },
              overlay: fcOf(catch_.map((f) => ({ ...f, properties: { ...f.properties, __color: f.properties.q_in_m3s / qmax > 0.66 ? '#1d4ed8' : f.properties.q_in_m3s / qmax > 0.33 ? '#60a5fa' : '#bfdbfe', __alpha: 0.28 } }))),
            }
          })} />
      </Group>

      <Group icon={<Route />} title="Truy vết & mặt cắt" hint="Bắt đầu từ cống / hố ga đang chọn trên bản đồ">
        <Item code="Q4" title="Truy vết thượng & hạ lưu" desc={selPipe ? `Từ cống ${selPipe.code}` : 'Từ một cống bị tắc'} {...itemProps('Q4')}
          needs={selPipe ? null : 'Click chọn một cống trên bản đồ'}
          onRun={() => run('Q4', async () => {
            const [up, down] = await Promise.all([rpc<FeatureCollection>('trace_upstream', { p_pipe_id: selPipe!.id }), rpc<FeatureCollection>('trace_downstream', { p_pipe_id: selPipe!.id })])
            const pipes: Record<number, string> = { ...byId(up, ANALYSIS.upstream), ...byId(down, ANALYSIS.downstream) }
            pipes[selPipe!.id] = ANALYSIS.focus
            return {
              key: 'Q4', title: `Truy vết từ cống ${selPipe!.code}`, fc: fcOf([...up.features, ...down.features]),
              highlight: { pipes, dimOthers: true, legend: [{ color: ANALYSIS.focus, label: 'Cống bị tắc' }, { color: ANALYSIS.upstream, label: `Thượng lưu (${up.features.length - 1})` }, { color: ANALYSIS.downstream, label: `Hạ lưu (${down.features.length - 1})` }] },
            }
          })} />
        <Item code="Q7" title="Hố ga gần nhất" desc="Tìm k láng giềng gần nhất (KNN, index GIST)" {...itemProps('Q7')}
          needs={q7src === 'point' && !lastClick ? 'Click một điểm bất kỳ trên bản đồ' : null}
          onRun={() => run('Q7', async () => {
            const fc = await rpc<FeatureCollection>('q7_nearest_manhole', { p_source: q7src, p_k: k, ...(q7src === 'point' ? { p_lon: lastClick!.lon, p_lat: lastClick!.lat } : {}) })
            return {
              key: 'Q7', title: 'Hố ga gần nhất', fc,
              highlight: { manholes: byId(fc, ANALYSIS.ok, 'manhole_id'), legend: [{ color: ANALYSIS.ok, label: 'Hố ga gần nhất' }, { color: ANALYSIS.marker, label: 'Đường nối' }] },
              overlay: fcOf(fc.features.map((f) => ({ ...f, properties: { ...f.properties, __color: ANALYSIS.marker } }))),
            }
          })}>
          <div>
            <Label htmlFor="q7-src">Điểm xuất phát</Label>
            <Select id="q7-src" className="mt-1" value={q7src} onChange={(e) => setQ7src(e.target.value)}>
              <option value="flood">Các điểm ngập</option>
              <option value="incident">Sự cố chưa xử lý</option>
              <option value="point">Điểm vừa click</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="q7-k">Số hố ga (k)</Label>
            <Input id="q7-k" className="mt-1" type="number" min={1} max={5} value={k} onChange={(e) => setK(Number(e.target.value))} />
          </div>
        </Item>
        <Item code="Q11" title="Mặt cắt dọc tuyến cống" desc={selMh ? `Từ hố ga ${selMh.code} về hạ lưu` : 'Mặt đất (TIN) và đáy ống theo lý trình'} {...itemProps('Q11')}
          needs={selMh ? null : 'Click chọn hố ga đầu tuyến trên bản đồ'}
          onRun={() => run('Q11', async () => {
            const fc = await rpc<FeatureCollection>('q11_pipe_profile', { p_from_mh: selMh!.id })
            setProfile(fc)
            const route = (fc.meta?.route ?? []) as any[]
            return {
              key: 'Q11', title: `Mặt cắt dọc từ hố ga ${selMh!.code}`, summary: `${route.length} cống`,
              highlight: { pipes: Object.fromEntries(route.map((r) => [r.pipe_id, ANALYSIS.route])), dimOthers: true, legend: [{ color: ANALYSIS.route, label: 'Tuyến mặt cắt' }] },
              fc: fcOf(route.map((r) => ({ type: 'Feature', id: `pipe:${r.pipe_id}`, geometry: { type: 'Point', coordinates: [] }, properties: r }))),
            }
          })} />
      </Group>

      <Group icon={<History />} title="Thời gian & vận hành" hint="Lịch sử phiên bản, hiệu quả xử lý sự cố">
        <Item code="Q9" title="Mạng cống tại một ngày" desc="Trạng thái theo valid time (và transaction time)" {...itemProps('Q9')}
          onRun={() => run('Q9', async () => {
            const fc = await rpc<FeatureCollection>('q9_as_of_date', { p_date: new Date(q9date).toISOString(), ...(q9tx ? { p_tx: new Date(q9tx).toISOString() } : {}) })
            setOverride(fc, `${new Date(q9date).toLocaleDateString('vi-VN')}${q9tx ? ` (theo CSDL ngày ${new Date(q9tx).toLocaleDateString('vi-VN')})` : ''} · ${fc.meta?.pipes} cống, ${fc.meta?.manholes} hố ga`)
            return {
              key: 'Q9', title: `Lịch sử sự kiện đến ${new Date(q9date).toLocaleDateString('vi-VN')}`,
              fc: fcOf((fc.meta?.events ?? []).map((e: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { valid_time: e.valid_time, asset_type: e.asset_type, asset_id: e.asset_id, event_type: e.event_type, tx_time: e.tx_time } }))),
              summary: `${fc.meta?.pipes} cống, ${fc.meta?.manholes} hố ga còn hiệu lực`,
            }
          })}>
          <div>
            <Label htmlFor="q9-date">Ngày cần xem</Label>
            <Input id="q9-date" className="mt-1" type="date" value={q9date} onChange={(e) => setQ9date(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="q9-tx">Theo dữ liệu CSDL ngày</Label>
            <Input id="q9-tx" className="mt-1" type="date" value={q9tx} onChange={(e) => setQ9tx(e.target.value)} />
          </div>
        </Item>
        <Item code="Q10" title="Hiệu quả xử lý sự cố" desc="Thời gian phản hồi & xử lý trung bình theo khu" {...itemProps('Q10')}
          onRun={() => run('Q10', async () => {
            const fc = await rpc<FeatureCollection>('q10_incident_sla')
            return { key: 'Q10', title: 'Hiệu quả xử lý sự cố theo khu', fc, overlay: fcOf(fc.features.map((f, i) => ({ ...f, properties: { ...f.properties, __color: ['#0ea5e9', '#f97316'][i % 2], __alpha: 0.15 } }))) }
          })} />
      </Group>
    </div>
  )
}
