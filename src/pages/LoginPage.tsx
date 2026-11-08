import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Droplets, HardHat, ShieldCheck, User, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { useAuth } from '@/lib/auth'

const DEMO = [
  { email: 'admin@demo.vn', label: 'Quản trị viên', desc: 'Toàn quyền, audit log', icon: ShieldCheck },
  { email: 'tech1@demo.vn', label: 'Kỹ thuật – Zone A', desc: 'Phân tích, sửa khu Tây', icon: Wrench },
  { email: 'tech2@demo.vn', label: 'Kỹ thuật – Zone B', desc: 'Phân tích, sửa khu Đông', icon: HardHat },
  { email: 'dan@demo.vn', label: 'Người dân', desc: 'Báo sự cố kèm ảnh', icon: User },
]

export default function LoginPage() {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function submit(e?: React.FormEvent, em = email, pw = password) {
    e?.preventDefault()
    setBusy(em || 'form')
    setErr(null)
    try {
      await signIn(em, pw)
      nav(em.startsWith('dan') ? '/report' : '/map')
    } catch (x: any) {
      setErr(x.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-white to-cyan-50 p-4 sm:p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border bg-surface shadow-e3 md:grid-cols-[1.1fr_1fr]">
        {/* Giới thiệu */}
        <div className="hidden flex-col justify-between bg-slate-900 p-8 text-white md:flex">
          <div className="space-y-4">
            <span className="flex size-10 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300"><Droplets className="size-6" aria-hidden /></span>
            <h1 className="text-2xl font-semibold leading-snug">Hệ thống thông tin địa lý 3D<br />mạng cống thoát nước</h1>
            <p className="text-sm text-slate-300">Quản lý mạng cống ngầm, phân tích điểm ngập và xử lý sự cố khu vực chợ Thủ Đức, TP.HCM.</p>
          </div>
          <ul className="space-y-2 text-sm text-slate-300">
            <li>• Mô hình 3D: TIN · mạng Node–Arc · B-Rep · CSG</li>
            <li>• 12 phân tích không gian PostGIS</li>
            <li>• Dữ liệu lưỡng thời gian & phân quyền theo khu</li>
          </ul>
        </div>
        {/* Form */}
        <div className="space-y-6 p-6 sm:p-8">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Đăng nhập</h2>
            <p className="text-sm text-muted-foreground">Dùng tài khoản được cấp, hoặc chọn nhanh một vai trò demo.</p>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Email"><Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required className="h-10" /></Field>
            <Field label="Mật khẩu"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="h-10" /></Field>
            {err && <Alert error={err} />}
            <Button className="w-full" size="lg" loading={busy === email && !!email}>Đăng nhập</Button>
          </form>
          <div className="space-y-2">
            <p className="section-title">Tài khoản demo · mật khẩu Demo@123</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEMO.map((d) => (
                <button key={d.email} disabled={!!busy} onClick={() => submit(undefined, d.email, 'Demo@123')}
                  className="flex items-center gap-3 rounded-md border bg-surface p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-primary"><d.icon className="size-4" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.label}</span>
                    <span className="block truncate text-xs text-subtle">{d.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Button variant="ghost" className="w-full" onClick={() => nav('/map')}>Xem bản đồ với tư cách khách <ArrowRight /></Button>
        </div>
      </div>
    </div>
  )
}
