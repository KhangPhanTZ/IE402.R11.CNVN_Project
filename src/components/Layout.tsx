import { useEffect, useMemo, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClipboardList, Droplets, Home, LogIn, LogOut, Map, Megaphone, Search, Settings2, User } from 'lucide-react'
import { Tooltip, TooltipProvider } from './ui/tooltip'
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from './ui/dropdown'
import { Badge } from './ui/badge'
import { CommandProvider, useCommandPalette, type CmdGroup } from './CommandPalette'
import { useAuth } from '@/lib/auth'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const KIND_VI: Record<string, string> = { blocked: 'Tắc nghẽn', overflow: 'Trào nước', broken_cover: 'Vỡ nắp', odor: 'Mùi hôi', subsidence: 'Lún sụt', other: 'Khác' }
const ROLE_VI: Record<string, string> = { admin: 'Quản trị', technician: 'Kỹ thuật viên', citizen: 'Người dân', anon: 'Khách' }

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
        toast.warning(`Sự cố mới #${r.id}: ${KIND_VI[r.kind] ?? r.kind}`, { description: r.note ?? undefined, action: { label: 'Xem', onClick: () => nav('/incidents') } })
        qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incident_reports' }, (payload) => {
        const r = payload.new as any
        toast.info(`Sự cố #${r.id} → ${r.status}`)
        qc.invalidateQueries({ queryKey: ['layer', 'layer_incidents'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [enabled, qc, nav])
}

const initials = (s?: string | null) => (s ?? '?').split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase()

function SearchButton() {
  const { setOpen } = useCommandPalette()
  return (
    <Tooltip content={<span>Tìm & lệnh nhanh <kbd className="ml-1 opacity-70">⌘K</kbd></span>} side="right">
      <button onClick={() => setOpen(true)} aria-label="Mở bảng lệnh (Ctrl K)"
        className="flex size-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
        <Search className="size-5" />
      </button>
    </Tooltip>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { role, profile, session, isStaff, signOut } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  useIncidentRealtime(isStaff)
  const links = [
    { to: '/map', label: 'Bản đồ 3D', icon: Map, show: true },
    { to: '/report', label: 'Báo sự cố', icon: Megaphone, show: role !== 'anon' },
    { to: '/incidents', label: 'Xử lý sự cố', icon: ClipboardList, show: isStaff },
    { to: '/admin', label: 'Quản trị', icon: Settings2, show: role === 'admin' },
  ].filter((l) => l.show)
  const name = profile?.full_name ?? session?.user.email

  const base: CmdGroup[] = useMemo(() => [{
    heading: 'Điều hướng',
    items: [
      { id: 'nav:/', label: 'Mở Trang chủ', icon: <Droplets />, run: () => nav('/') },
      ...links.map((l) => ({ id: `nav:${l.to}`, label: `Mở ${l.label}`, icon: <l.icon />, run: () => nav(l.to) })),
      session ? { id: 'auth:logout', label: 'Đăng xuất', icon: <LogOut />, run: () => signOut().then(() => nav('/map')) }
              : { id: 'auth:login', label: 'Đăng nhập', icon: <LogIn />, run: () => nav('/login') },
    ],
  }], [links.length, session]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loc.pathname === '/login' || loc.pathname === '/') return <TooltipProvider><CommandProvider base={base}>{children}</CommandProvider></TooltipProvider>

  return (
    <TooltipProvider>
      <CommandProvider base={base}>
        <div className="flex h-full">
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm">Bỏ qua tới nội dung</a>
          {/* Rail điều hướng (desktop) */}
          <aside className="z-20 hidden w-16 shrink-0 flex-col items-center gap-1 bg-slate-950 py-3 sm:flex" aria-label="Điều hướng chính">
            <NavLink to="/" aria-label="Trang chủ" className="mb-3 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-sky-600 text-white shadow-lg shadow-cyan-500/20">
              <Droplets className="size-5" />
            </NavLink>
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <Tooltip key={l.to} content={l.label} side="right">
                  <NavLink to={l.to} aria-label={l.label}
                    className={({ isActive }) => cn('relative flex size-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
                      isActive && 'bg-white/10 text-white before:absolute before:-left-3 before:h-5 before:w-1 before:rounded-r-full before:bg-cyan-400')}>
                    <l.icon className="size-5" />
                  </NavLink>
                </Tooltip>
              ))}
            </nav>
            <div className="mt-auto flex flex-col items-center gap-2">
              <SearchButton />
              {!supabaseConfigured && <Tooltip content="Thiếu VITE_SUPABASE_URL / ANON_KEY" side="right"><span className="size-2.5 rounded-full bg-red-500" /></Tooltip>}
              <DropdownMenu>
                <DropdownTrigger asChild>
                  <button aria-label="Tài khoản" className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-sm font-semibold text-white ring-2 ring-white/10 focus-visible:outline-none focus-visible:ring-cyan-400">
                    {session ? initials(name) : <User className="size-5" />}
                  </button>
                </DropdownTrigger>
                <DropdownContent side="right" align="end">
                  {session ? (
                    <>
                      <DropdownLabel>
                        <span className="block text-sm font-semibold text-foreground">{name}</span>
                        <span className="block">{session.user.email}</span>
                      </DropdownLabel>
                      <div className="px-2.5 pb-1.5"><Badge variant="default">{ROLE_VI[role]}</Badge></div>
                      <DropdownSeparator />
                      <DropdownItem onSelect={() => signOut().then(() => nav('/map'))}><LogOut />Đăng xuất</DropdownItem>
                    </>
                  ) : (
                    <DropdownItem onSelect={() => nav('/login')}><LogIn />Đăng nhập</DropdownItem>
                  )}
                </DropdownContent>
              </DropdownMenu>
            </div>
          </aside>

          <main id="main" className="relative min-h-0 min-w-0 flex-1 pb-16 sm:pb-0">{children}</main>

          {/* Thanh tab đáy (mobile) */}
          <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t bg-white/95 backdrop-blur sm:hidden" aria-label="Điều hướng chính">
            {[{ to: '/', label: 'Trang chủ', icon: Home }, ...links, session ? null : { to: '/login', label: 'Đăng nhập', icon: LogIn }].filter(Boolean).map((l) => (
              <NavLink key={l!.to} to={l!.to} end className={({ isActive }) => cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap text-[11px] font-medium text-slate-500', isActive && 'text-primary')}>
                {(() => { const I = l!.icon; return <I className="size-5" /> })()}
                {l!.label}
              </NavLink>
            ))}
            {session && (
              <button onClick={() => signOut().then(() => nav('/map'))} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-slate-500">
                <LogOut className="size-5" />Thoát
              </button>
            )}
          </nav>
        </div>
      </CommandProvider>
    </TooltipProvider>
  )
}
