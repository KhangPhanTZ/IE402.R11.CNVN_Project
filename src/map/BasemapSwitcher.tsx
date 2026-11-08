/** Chọn bản đồ nền kiểu "tile" thu nhỏ (giống Google Maps) */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Layers } from 'lucide-react'
import { BASEMAPS, type BasemapKey } from './cesiumUtil'
import { cn } from '@/lib/utils'

export function BasemapSwitcher({ value, onChange }: { value: BasemapKey; onChange: (v: BasemapKey) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pointer-events-auto relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Đổi bản đồ nền"
        className="glass-panel group flex size-9 items-center justify-center overflow-hidden p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="absolute inset-1 rounded-lg opacity-90" style={{ background: BASEMAPS[value].thumb }} aria-hidden />
        <Layers className="relative size-4 text-white drop-shadow" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: 0.15 }}
            className="glass-panel absolute bottom-0 right-11 flex gap-2 p-2" role="radiogroup" aria-label="Bản đồ nền">
            {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
              <button key={k} role="radio" aria-checked={value === k} onClick={() => { onChange(k); setOpen(false) }}
                className="group flex w-16 flex-col items-center gap-1 focus-visible:outline-none">
                <span className={cn('relative block h-12 w-16 rounded-lg ring-2 transition-all group-hover:ring-primary/40 group-focus-visible:ring-ring', value === k ? 'ring-primary' : 'ring-transparent')} style={{ background: BASEMAPS[k].thumb }}>
                  {value === k && <Check className="absolute right-1 top-1 size-3.5 rounded-full bg-primary p-0.5 text-white" />}
                </span>
                <span className={cn('text-xs', value === k ? 'font-semibold text-primary' : 'text-muted-foreground')}>{BASEMAPS[k].label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
