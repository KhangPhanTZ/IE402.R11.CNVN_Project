/** Chú giải mặc định: giải thích mã màu trạng thái khi chưa chạy phân tích */
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { KIND, STATUS, UTILITY } from '@/lib/theme'
import { cn } from '@/lib/utils'

function Row({ color, label, shape = 'line' }: { color: string; label: string; shape?: 'line' | 'dot' | 'box' }) {
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden className={cn('shrink-0', shape === 'line' && 'h-1 w-4 rounded-full', shape === 'dot' && 'size-2.5 rounded-full', shape === 'box' && 'size-3 rounded-sm')} style={{ background: color }} />
      {label}
    </li>
  )
}

export function MapLegend({ className, staff }: { className?: string; staff: boolean }) {
  const [open, setOpen] = useState(() => window.innerHeight > 900)
  return (
    <section className={cn('map-panel w-52 p-0', className)} aria-label="Chú giải bản đồ">
      <button className="flex w-full items-center justify-between px-3 py-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="section-title">Chú giải</span>
        <ChevronDown className={cn('size-4 text-subtle transition-transform', !open && '-rotate-90')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2.5 border-t px-3 pb-3 pt-2">
          <div>
            <p className="mb-1 text-xs font-semibold">Cống theo trạng thái</p>
            <ul className="space-y-1">{Object.values(STATUS).slice(0, 4).map((s) => <Row key={s.label} color={s.color} label={s.label} />)}</ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold">Hố ga</p>
            <ul className="space-y-1">{Object.values(KIND).map((s) => <Row key={s.label} color={s.color} label={s.label} shape="dot" />)}</ul>
          </div>
          {staff && (
            <div>
              <p className="mb-1 text-xs font-semibold">Công trình ngầm</p>
              <ul className="space-y-1">{Object.values(UTILITY).map((s) => <Row key={s.label} color={s.color} label={s.label} />)}</ul>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold">Đường</p>
            <ul className="space-y-1">
              <Row color="#64748b" label="Đường chính (2 tuyến cống 2 bên)" shape="box" />
              <Row color="#cbd5e1" label="Hẻm / nội bộ (1 tuyến ở tim)" shape="box" />
            </ul>
          </div>
          <ul className="space-y-1">
            <Row color="#0284c7" label="Điểm ngập (cm)" shape="dot" />
            {staff && <Row color="#c7d2fe" label="Nhà có tầng hầm" shape="box" />}
          </ul>
          <p className="text-xs text-subtle">Khi chạy phân tích, chỉ kết quả được tô màu nóng; phần còn lại làm mờ.</p>
        </div>
      )}
    </section>
  )
}
