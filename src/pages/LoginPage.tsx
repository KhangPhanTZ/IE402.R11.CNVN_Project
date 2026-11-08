import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useAuth } from '@/lib/auth'

const DEMO = [
  { email: 'admin@demo.vn', label: 'Admin' },
  { email: 'tech1@demo.vn', label: 'Kỹ thuật – Zone A' },
  { email: 'tech2@demo.vn', label: 'Kỹ thuật – Zone B' },
  { email: 'dan@demo.vn', label: 'Người dân' },
]

export default function LoginPage() {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e?: React.FormEvent, em = email, pw = password) {
    e?.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await signIn(em, pw)
      nav(em.startsWith('dan') ? '/report' : '/map')
    } catch (x: any) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 to-cyan-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Đăng nhập</CardTitle>
          <CardDescription>Supabase Auth (email / mật khẩu)</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1"><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
            <div className="space-y-1"><Label>Mật khẩu</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
            {err && <div className="text-xs text-destructive">{err}</div>}
            <Button className="w-full" disabled={busy}>Đăng nhập</Button>
          </form>
          <div className="mt-4 text-xs text-muted-foreground">Tài khoản demo (mật khẩu <code>Demo@123</code>):</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <Button key={d.email} size="sm" variant="outline" disabled={busy} onClick={() => submit(undefined, d.email, 'Demo@123')}>{d.label}</Button>
            ))}
          </div>
          <Button variant="link" size="sm" className="mt-2 w-full" onClick={() => nav('/map')}>Tiếp tục với tư cách khách →</Button>
        </CardContent>
      </Card>
    </div>
  )
}
