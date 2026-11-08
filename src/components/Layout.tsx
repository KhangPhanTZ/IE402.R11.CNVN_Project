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
      <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-slate-900 px-4 text-white">
        <div className="flex items-center gap-2 font-semibold">
          <Droplets className="h-5 w-5 text-cyan-400" />
          <span className="hidden md:inline">HTTT 3D Thoát nước – Chợ Thủ Đức</span>
        </div>
        <nav className="flex gap-1">
          {links.filter((l) => l.show).map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => cn('rounded px-3 py-1 text-sm hover:bg-white/10', isActive && 'bg-white/15')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {!supabaseConfigured && <Badge variant="destructive">Thiếu VITE_SUPABASE_URL / ANON_KEY</Badge>}
          {session ? (
            <>
              <span className="hidden sm:inline">{profile?.full_name ?? session.user.email}</span>
              <Badge variant="secondary">{role}</Badge>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => signOut().then(() => nav('/map'))}>
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => nav('/login')}><LogIn className="h-4 w-4" /> Đăng nhập</Button>
          )}
        </div>
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
    </div>
  )
}
