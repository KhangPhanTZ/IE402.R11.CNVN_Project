/** Trang chủ công khai – giới thiệu hệ thống, số liệu trực tiếp, lối vào bản đồ 3D (không tải Cesium) */
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, ArrowRight, Box, CircleDot, Clock3, CloudRain, Droplets, GitBranch, Github, History, Layers3, LogIn,
  MapPin, Megaphone, Menu, Route, ScanSearch, ShieldCheck, Siren, Waves, Wrench, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { rpc } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { FeatureCollection } from '@/lib/types'
import { cn } from '@/lib/utils'

const REPO = 'https://github.com/KhangPhanTZ/IE402.R11.CNVN_Project'

/** Số liệu trực tiếp từ CSDL qua các RPC công khai (khách gọi được) */
function useLiveStats() {
  const pub = useQuery({ queryKey: ['home', 'public'], queryFn: () => rpc<FeatureCollection>('layer_public'), staleTime: 5 * 60_000 })
  const flood = useQuery({ queryKey: ['home', 'flood'], queryFn: () => rpc<FeatureCollection>('layer_flood_points'), staleTime: 5 * 60_000 })
  const roads = useQuery({ queryKey: ['home', 'roads'], queryFn: () => rpc<FeatureCollection>('layer_roads'), staleTime: 5 * 60_000 })
  const f = pub.data?.features ?? []
  const mh = f.filter((x) => x.properties.layer === 'manhole')
  return {
    manholes: pub.data ? mh.filter((x) => x.properties.kind !== 'inlet').length : undefined,
    inlets: pub.data ? mh.filter((x) => x.properties.kind === 'inlet').length : undefined,
    pipes: pub.data ? f.filter((x) => x.properties.layer === 'pipe').length : undefined,
    roads: roads.data ? new Set(roads.data.features.map((x) => x.properties.name)).size : undefined,
    floods: flood.data?.features.length,
  }
}

function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900)
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <>{v.toLocaleString('vi-VN')}</>
}

function Stat({ value, label, hint }: { value?: number; label: string; hint: string }) {
  return (
    <div className="px-6 py-5">
      <dt className="text-sm font-medium text-slate-400">{label}</dt>
      <dd className="mt-1 text-4xl font-semibold tracking-tight text-white tabular">
        {value === undefined ? <span className="inline-block h-9 w-20 animate-pulse rounded bg-white/10" /> : <CountUp to={value} />}
      </dd>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function SectionHead({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {desc && <p className="mt-4 text-lg leading-relaxed text-slate-600">{desc}</p>}
    </div>
  )
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-e1 transition-all hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-e2">
      <span className="flex size-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100 transition-colors group-hover:bg-cyan-600 group-hover:text-white [&_svg]:size-5">
        {icon}
      </span>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-base leading-relaxed text-slate-600">{children}</p>
    </div>
  )
}

const ANALYSES: { group: string; icon: ReactNode; items: [string, string][] }[] = [
  { group: 'Phát hiện bất thường', icon: <ScanSearch />, items: [['Q1', 'Cống dốc ngược / quá bằng'], ['Q2', 'Cống chôn quá nông'], ['Q3', 'Va chạm 3D với công trình ngầm'], ['Q12', 'Lỗi lòng cống trên ống 3D']] },
  { group: 'Ngập & mưa', icon: <CloudRain />, items: [['Q5', 'Hố ga tràn theo mực nước'], ['Q6', 'Nhà có nguy cơ ngập tầng hầm'], ['Q8', 'Cống quá tải theo cường độ mưa']] },
  { group: 'Mạng lưới', icon: <GitBranch />, items: [['Q4', 'Truy vết thượng / hạ lưu'], ['Q7', 'Hố ga gần nhất (KNN)'], ['Q11', 'Mặt cắt dọc tuyến cống']] },
  { group: 'Thời gian & vận hành', icon: <History />, items: [['Q9', 'Mạng cống tại một ngày bất kỳ'], ['Q10', 'Thời gian xử lý sự cố theo khu']] },
]

const STEPS: { icon: ReactNode; title: string; desc: string }[] = [
  { icon: <Megaphone />, title: 'Người dân báo sự cố', desc: 'Chọn vị trí trên bản đồ, chụp ảnh, mô tả ngắn.' },
  { icon: <MapPin />, title: 'Tự gán hố ga gần nhất', desc: 'CSDL tìm hố ga gần nhất (KNN) và khu phụ trách.' },
  { icon: <Wrench />, title: 'Kỹ thuật viên xử lý', desc: 'Nhận thông báo tức thời, nhận việc, có mặt, hoàn tất.' },
  { icon: <Activity />, title: 'Đo hiệu quả', desc: 'Thời gian phản hồi, xử lý trung bình và P90 theo khu.' },
]

const ROLES: { icon: ReactNode; title: string; desc: string; tone: string }[] = [
  { icon: <Layers3 />, title: 'Khách', desc: 'Xem mạng cống rút gọn, đường và điểm ngập – không cần tài khoản.', tone: 'bg-slate-100 text-slate-700' },
  { icon: <Megaphone />, title: 'Người dân', desc: 'Báo sự cố kèm ảnh, vị trí và theo dõi tiến độ xử lý.', tone: 'bg-amber-50 text-amber-700' },
  { icon: <Wrench />, title: 'Kỹ thuật viên', desc: 'Chạy 12 phân tích, xử lý sự cố, sửa tài sản trong khu phụ trách.', tone: 'bg-cyan-50 text-cyan-700' },
  { icon: <ShieldCheck />, title: 'Quản trị viên', desc: 'Quản lý người dùng, khu, xem nhật ký thay đổi và thống kê.', tone: 'bg-violet-50 text-violet-700' },
]

const NAV = [['#tinh-nang', 'Tính năng'], ['#phan-tich', 'Phân tích'], ['#quy-trinh', 'Quy trình'], ['#vai-tro', 'Vai trò']]

export default function HomePage() {
  const { session } = useAuth()
  const s = useLiveStats()
  const [menu, setMenu] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const root = document.getElementById('home-scroll')
    const on = () => setScrolled((root?.scrollTop ?? 0) > 8)
    root?.addEventListener('scroll', on, { passive: true })
    return () => root?.removeEventListener('scroll', on)
  }, [])

  return (
    <div id="home-scroll" className="h-full overflow-y-auto scroll-smooth bg-white text-slate-900">
      {/* ---------------- Thanh điều hướng ---------------- */}
      <header className={cn('sticky top-0 z-40 transition-colors duration-200', scrolled ? 'border-b border-white/10 bg-slate-950/85 backdrop-blur-xl' : 'bg-transparent')}>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5 text-white">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-sky-600 shadow-lg shadow-cyan-500/25">
              <Droplets className="size-5" aria-hidden />
            </span>
            <span className="text-base font-semibold leading-tight">Thoát nước <span className="text-cyan-300">Thủ Đức 3D</span></span>
          </Link>
          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Mục trang chủ">
            {NAV.map(([href, t]) => (
              <a key={href} href={href} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white">{t}</a>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            {!session && (
              <Button asChild variant="ghost" className="text-slate-200 hover:bg-white/10 hover:text-white"><Link to="/login"><LogIn />Đăng nhập</Link></Button>
            )}
            <Button asChild className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"><Link to="/map">Mở bản đồ 3D <ArrowRight /></Link></Button>
          </div>
          <button className="ml-auto rounded-lg p-2 text-slate-200 hover:bg-white/10 sm:hidden" onClick={() => setMenu(!menu)} aria-label="Mở menu" aria-expanded={menu}>
            {menu ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {menu && (
          <div className="border-t border-white/10 bg-slate-950/95 px-5 pb-4 backdrop-blur-xl sm:hidden">
            {NAV.map(([href, t]) => (
              <a key={href} href={href} onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2.5 text-base text-slate-200 hover:bg-white/10">{t}</a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button asChild variant="outline" size="lg"><Link to={session ? '/report' : '/login'}>{session ? 'Báo sự cố' : 'Đăng nhập'}</Link></Button>
              <Button asChild size="lg" className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"><Link to="/map">Bản đồ 3D</Link></Button>
            </div>
          </div>
        )}
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="relative -mt-16 overflow-hidden bg-slate-950 pt-16 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 size-[640px] rounded-full bg-cyan-500/20 blur-3xl" />
          <div className="absolute -right-32 top-40 size-[520px] rounded-full bg-sky-600/20 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
        </div>
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1fr_1.15fr] lg:pb-28 lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-sm font-medium text-cyan-200">
              <span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_2px] shadow-cyan-400/60" /> Hệ thống thông tin địa lý 3D
            </span>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.12] tracking-tight sm:text-5xl xl:text-[3.4rem]">
              Nhìn xuyên lòng đất <span className="bg-gradient-to-r from-cyan-300 to-sky-400 bg-clip-text text-transparent">mạng cống thoát nước</span> chợ Thủ Đức
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
              Quản lý hố ga, cống và hố thu trên đường thật ở dạng 3D, phát hiện cống dốc ngược hay va chạm, đánh giá nguy cơ ngập theo kịch bản mưa và xử lý sự cố người dân báo về.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"><Link to="/map">Khám phá bản đồ 3D <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                <Link to={session ? '/report' : '/login'}><Siren />Báo sự cố</Link>
              </Button>
            </div>
            <p className="mt-6 text-sm text-slate-400">Dùng thử ngay với tài khoản demo – mật khẩu <code className="rounded bg-white/10 px-1.5 py-0.5 text-slate-200">Demo@123</code></p>
          </div>

          {/* Ảnh sản phẩm trong khung trình duyệt */}
          <div className="relative">
            <div className="rounded-2xl bg-gradient-to-b from-white/15 to-white/5 p-1.5 shadow-2xl shadow-cyan-950/50 ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 px-3 py-2">
                <span className="size-2.5 rounded-full bg-red-400/80" /><span className="size-2.5 rounded-full bg-amber-400/80" /><span className="size-2.5 rounded-full bg-emerald-400/80" />
                <span className="ml-3 truncate rounded-md bg-white/10 px-3 py-0.5 text-xs text-slate-300">ie402-thuduc-drainage.vercel.app/map</span>
              </div>
              <img src="/home/xray.webp" alt="Nhìn xuyên mặt đất: hai tuyến cống dưới đường lớn và thông tin một hố thu" width={1600} height={956}
                className="w-full rounded-xl" {...{ fetchpriority: "high" }} />
            </div>
            <div className="absolute -bottom-6 -left-4 hidden rounded-xl border border-white/10 bg-slate-900/90 p-4 shadow-xl backdrop-blur sm:block">
              <p className="text-xs text-slate-400">Hố thu bồi lấp</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-amber-400" />HT-A006 · 62 %</p>
            </div>
            <div className="absolute -right-3 -top-5 hidden rounded-xl border border-white/10 bg-slate-900/90 p-4 shadow-xl backdrop-blur sm:block">
              <p className="text-xs text-slate-400">Kịch bản mưa 80 mm/h</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-red-400" />Cống quá tải được tô đỏ</p>
            </div>
          </div>
        </div>

        {/* Số liệu trực tiếp */}
        <div className="relative border-t border-white/10 bg-white/[0.03]">
          <dl className="mx-auto grid max-w-7xl grid-cols-2 divide-white/10 px-2 sm:px-6 lg:grid-cols-5 lg:divide-x">
            <Stat value={s.manholes} label="Hố ga & cửa xả" hint="nút của mạng Node–Arc 3D" />
            <Stat value={s.inlets} label="Hố thu mép đường" hint="kèm kiểu thu, mức bồi lấp" />
            <Stat value={s.pipes} label="Đoạn cống" hint="đúng đường kính, cao độ đáy" />
            <Stat value={s.roads} label="Tuyến đường thật" hint="OpenStreetMap, có bề rộng" />
            <Stat value={s.floods} label="Điểm ngập" hint="theo thông tin báo chí" />
          </dl>
        </div>
      </section>

      {/* ---------------- Tính năng ---------------- */}
      <section id="tinh-nang" className="scroll-mt-16 bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead eyebrow="Tính năng" title="Mọi thứ dưới lòng đường, trên một bản đồ 3D"
            desc="Mỗi đối tượng có đủ ngữ nghĩa, hình học 3D và lịch sử thời gian – ràng buộc toàn vẹn và phân quyền đặt ngay trong cơ sở dữ liệu." />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Feature icon={<Layers3 />} title="Nhìn xuyên mặt đất">Địa hình TIN trong suốt theo thanh trượt; cống vẽ đúng đường kính, hố ga dựng khối CSG ở đúng cao độ.</Feature>
            <Feature icon={<Route />} title="Đường thật, cống theo phía đường">Đường lấy từ OpenStreetMap kèm bề rộng; đường lớn có hai tuyến cống hai bên, hố thu nằm sát mép bó vỉa.</Feature>
            <Feature icon={<ScanSearch />} title="Phát hiện bất thường">Cống dốc ngược, chôn nông, va chạm 3D với ống nước – cáp điện được tô đỏ ngay trên bản đồ.</Feature>
            <Feature icon={<Waves />} title="Kịch bản ngập">Mặt nước dâng theo kịch bản mưa: hố ga tràn, nhà có tầng hầm gần hố tràn, cống quá tải.</Feature>
            <Feature icon={<Clock3 />} title="Lịch sử hai chiều thời gian">Sửa không ghi đè: xem lại mạng cống tại một ngày bất kỳ, biết ai sửa gì và khi nào.</Feature>
            <Feature icon={<ShieldCheck />} title="Phân quyền theo khu">Kỹ thuật viên chỉ sửa tài sản trong khu phụ trách; khách chỉ thấy dữ liệu rút gọn; mọi thay đổi có nhật ký.</Feature>
          </div>
        </div>
      </section>

      {/* ---------------- Phân tích ---------------- */}
      <section id="phan-tich" className="scroll-mt-16 py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">12 phân tích không gian</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Trả lời những câu hỏi bản vẽ 2D không trả lời được</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">Mỗi phân tích là một hàm chạy trong PostGIS, trả kết quả GeoJSON để tô màu trên bản đồ và xuất CSV.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {ANALYSES.map((g) => (
                <div key={g.group} className="rounded-2xl border border-slate-200 p-5">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 [&_svg]:size-4 [&_svg]:text-cyan-600">{g.icon}{g.group}</p>
                  <ul className="mt-3 space-y-2">
                    {g.items.map(([code, t]) => (
                      <li key={code} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="mt-px rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular">{code}</span>{t}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-e3">
            <img src="/home/q8.webp" alt="Kết quả Q8 – tỉ lệ tải của cống khi mưa 80 mm/h" width={1600} height={956} loading="lazy" className="w-full" />
            <figcaption className="border-t border-slate-200 px-5 py-3 text-sm text-slate-600">Q8 – tỉ lệ tải của từng cống khi mưa 80 mm/h, xanh → đỏ theo mức quá tải.</figcaption>
          </figure>
        </div>
      </section>

      {/* ---------------- Quy trình sự cố ---------------- */}
      <section id="quy-trinh" className="scroll-mt-16 bg-slate-950 py-24 text-white">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-cyan-300">Quy trình sự cố</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Từ một tấm ảnh của người dân đến hố ga được nạo vét</h2>
          </div>
          <ol className="mt-14 grid gap-5 md:grid-cols-4">
            {STEPS.map((st, i) => (
              <li key={st.title} className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <span className="text-sm font-semibold text-cyan-300 tabular">Bước {String(i + 1).padStart(2, '0')}</span>
                <span className="mt-4 flex size-11 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20 [&_svg]:size-5">{st.icon}</span>
                <h3 className="mt-4 text-lg font-semibold">{st.title}</h3>
                <p className="mt-2 text-base text-slate-400">{st.desc}</p>
                {i < STEPS.length - 1 && <ArrowRight aria-hidden className="absolute -right-4 top-1/2 hidden size-5 -translate-y-1/2 text-slate-600 md:block" />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------- Vai trò ---------------- */}
      <section id="vai-tro" className="scroll-mt-16 py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead eyebrow="Vai trò" title="Mỗi người thấy đúng phần việc của mình" desc="Bốn vai trò với quyền truy cập khác nhau, kiểm soát bằng Row Level Security của PostgreSQL." />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <div key={r.title} className="rounded-2xl border border-slate-200 p-6">
                <span className={cn('flex size-11 items-center justify-center rounded-xl [&_svg]:size-5', r.tone)}>{r.icon}</span>
                <h3 className="mt-4 text-lg font-semibold">{r.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-slate-600">{r.desc}</p>
              </div>
            ))}
          </div>

          {/* Kêu gọi hành động */}
          <div className="relative mt-20 overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-600 to-sky-700 px-6 py-14 text-center text-white sm:px-12">
            <div aria-hidden className="absolute -right-20 -top-20 size-72 rounded-full bg-white/10 blur-2xl" />
            <Box className="mx-auto size-10 text-cyan-100" aria-hidden />
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Sẵn sàng nhìn xuống dưới lòng đường?</h2>
            <p className="mx-auto mt-3 max-w-xl text-lg text-cyan-50">Mở bản đồ với tư cách khách, hoặc đăng nhập bằng tài khoản demo để chạy phân tích và xử lý sự cố.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="bg-white text-cyan-800 hover:bg-cyan-50"><Link to="/map">Mở bản đồ 3D <ArrowRight /></Link></Button>
              {!session && <Button asChild size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10"><Link to="/login"><LogIn />Đăng nhập demo</Link></Button>}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Chân trang ---------------- */}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-slate-600 sm:px-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <p className="flex items-center gap-2 font-semibold text-slate-900"><Droplets className="size-4 text-cyan-600" aria-hidden />Thoát nước Thủ Đức 3D</p>
            <p className="mt-2">Đồ án môn Hệ thống thông tin địa lý 3D (IE402) – Trường Đại học Công nghệ Thông tin, ĐHQG-HCM.</p>
            <p className="mt-1">Phan Trần Văn Khang · Lê Thái Khang</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-slate-900">Công nghệ</p>
            <p>PostgreSQL + PostGIS · Supabase · CesiumJS · React</p>
            <p className="flex items-center gap-1.5"><CircleDot className="size-3.5" aria-hidden />Dữ liệu đường, nhà © OpenStreetMap contributors (ODbL)</p>
          </div>
          <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 hover:bg-slate-100">
            <Github className="size-4" aria-hidden />Mã nguồn
          </a>
        </div>
      </footer>
    </div>
  )
}
