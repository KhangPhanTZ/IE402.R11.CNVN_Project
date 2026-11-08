/**
 * Command palette (⌘K / Ctrl K): điều hướng, tìm tài sản theo mã, bật/tắt lớp, đổi bản đồ nền.
 * Trang bản đồ "đăng ký" thêm lệnh qua useRegisterCommands().
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Search } from 'lucide-react'

export interface Cmd { id: string; label: string; hint?: string; icon?: ReactNode; keywords?: string; run: () => void }
export interface CmdGroup { heading: string; items: Cmd[] }

interface Ctx { open: boolean; setOpen: (v: boolean) => void; register: (key: string, groups: CmdGroup[]) => () => void }
const C = createContext<Ctx>(null!)

export function CommandProvider({ base, children }: { base: CmdGroup[]; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [extra, setExtra] = useState<Record<string, CmdGroup[]>>({})
  const register = useCallback((key: string, groups: CmdGroup[]) => {
    setExtra((e) => ({ ...e, [key]: groups }))
    return () => setExtra((e) => { const n = { ...e }; delete n[key]; return n })
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const groups = useMemo(() => [...Object.values(extra).flat(), ...base], [extra, base])
  return (
    <C.Provider value={{ open, setOpen, register }}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-[12vh] backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.15 }}
              className="w-full max-w-xl overflow-hidden rounded-2xl border bg-white shadow-e3">
              <Command label="Bảng lệnh" loop onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
                <div className="flex items-center gap-3 border-b px-4">
                  <Search className="size-4 text-subtle" aria-hidden />
                  <Command.Input autoFocus placeholder="Tìm mã hố ga, cống, trang, lớp bản đồ…" className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-subtle" />
                  <kbd className="rounded border bg-muted px-1.5 text-xs text-subtle">Esc</kbd>
                </div>
                <Command.List className="max-h-[52vh] overflow-auto p-2">
                  <Command.Empty className="py-10 text-center text-sm text-muted-foreground">Không tìm thấy kết quả phù hợp.</Command.Empty>
                  {groups.map((g) => (
                    <Command.Group key={g.heading} heading={g.heading}
                      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle">
                      {g.items.map((it) => (
                        <Command.Item key={it.id} value={`${it.label} ${it.keywords ?? ''} ${it.id}`}
                          onSelect={() => { setOpen(false); it.run() }}
                          className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-primary-soft aria-selected:text-primary">
                          <span className="flex size-7 items-center justify-center rounded-md bg-muted text-slate-500 group-aria-selected:bg-white group-aria-selected:text-primary [&_svg]:size-4">{it.icon}</span>
                          <span className="flex-1 truncate">{it.label}</span>
                          {it.hint && <span className="text-xs text-subtle">{it.hint}</span>}
                          <CornerDownLeft className="size-3.5 opacity-0 group-aria-selected:opacity-60" aria-hidden />
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))}
                </Command.List>
                <div className="flex items-center gap-4 border-t bg-muted/50 px-4 py-2 text-xs text-subtle">
                  <span><kbd className="font-sans">↑↓</kbd> di chuyển</span><span><kbd className="font-sans">↵</kbd> chọn</span><span className="ml-auto">⌘K / Ctrl K để mở</span>
                </div>
              </Command>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </C.Provider>
  )
}

export const useCommandPalette = () => useContext(C)

/** Đăng ký lệnh khi component đang hiển thị */
export function useRegisterCommands(key: string, groups: CmdGroup[]) {
  const { register } = useContext(C)
  useEffect(() => register(key, groups), [key, groups, register])
}
