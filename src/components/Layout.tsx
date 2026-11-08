import { useEffect, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Droplets, LogIn, LogOut } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { useAuth } from '@/lib/auth'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const KIND_VI: Record<string, string> = { blocked: 'Tắc nghẽn', overflow: 'Trào nước', broken_cover: 'Vỡ nắp', odor: 'Mùi hôi', subsidence: 'Lún sụt', other: 'Khác' }

/** Realtime: technician/admin nhận toast khi có INSERT/UPDATE trên incident_reports */
function useIncidentRealtime(enabled: boolean) {
  const qc = useQueryClient()
  const nav = useNavigate()
  useEffect(() => {
    if (!enabled) return
    const ch = supabase
      .channel('incident-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incident_reports' }, (payload) => {
        const r = payload.new as any
        toast.warning(`Sự cố mới #${r.id}: ${KIND_VI[r.kind] ?? r.kind}`, {
          description: r.note ?? undefined,
          action: { label: 'Xem', onClick: () => nav('/incidents') },
        })
        qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incident_reports' }, (payload) => {
        const r = payload.new as any
        toast.info(`Sự cố #${r.id} → ${r.status}`)
        qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [enabled, qc, nav])
}

const ROLE_VI: Record<string, string> = { admin: 'Quản trị', technician: 'Kỹ thuật viên', citizen: 'Người dân', anon: 'Khách' }

export function Layout({ children }: { children: ReactNode }) {
  const { role, profile, session, isStaff, signOut } = useAuth()
  const nav = useNavigate()
  useIncidentRealtime(isStaff)
  const links = [
    { to: '/map', label: 'Bản đồ 3D', show: true },
    { to: '/report', label: 'Báo sự cố', show: role !== 'anon' },
    { to: '/incidents', label: 'Xử lý sự cố', show: isStaff },
    { to: '/admin', label: 'Quản trị', show: role === 'admin' },
  ]
  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm">Bỏ qua tới nội dung</a>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 text-white sm:gap-6 sm:px-5">
        <NavLink to="/map" className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          <span className="flex size-8 items-center justify-center rounded-md bg-cyan-500/15 text-cyan-300"><Droplets className="size-5" aria-hidden /></span>
          <span className="hidden leading-tight lg:block">
            <span className="block text-sm font-semibold">HTTT 3D Thoát nước</span>
            <span className="block text-xs text-slate-400">Khu vực chợ Thủ Đức</span>
          </span>
        </NavLink>
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Điều hướng chính">
          {links.filter((l) => l.show).map((l) => (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) => cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400', isActive && 'bg-white/10 text-white')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 text-sm">
          {!supabaseConfigured && <Badge variant="destructive">Thiếu cấu hình Supabase</Badge>}
          {session ? (
            <>
              <span className="hidden text-right leading-tight md:block">
                <span className="block font-medium">{profile?.full_name ?? session.user.email}</span>
                <span className="block text-xs text-slate-400">{ROLE_VI[role]}</span>
              </span>
              <Button size="icon" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => signOut().then(() => nav('/map'))} aria-label="Đăng xuất" title="Đăng xuất">
                <LogOut />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" className="bg-white text-slate-900 hover:bg-slate-100" onClick={() => nav('/login')}><LogIn /> Đăng nhập</Button>
          )}
        </div>
      </header>
      <main id="main" className="relative min-h-0 flex-1">{children}</main>
    </div>
  )
}
