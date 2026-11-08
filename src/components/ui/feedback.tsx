import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { humanizeError } from '@/lib/errors'

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? <span className="sr-only">Đang tải</span>}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden />
}

/** Trạng thái rỗng: nói rõ chuyện gì xảy ra + bước tiếp theo */
export function EmptyState({ icon, title, description, action, tone = 'neutral', className }: {
  icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; tone?: 'neutral' | 'success'; className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-6 text-center', className)}>
      <div className={cn('flex size-10 items-center justify-center rounded-full', tone === 'success' ? 'bg-success-soft text-success' : 'bg-muted text-subtle')}>
        {icon ?? (tone === 'success' ? <CheckCircle2 className="size-5" /> : <Info className="size-5" />)}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}

/** Hộp thông báo; với lỗi CSDL tự diễn giải (topology / RLS / …) và giữ nguyên văn ở phần chi tiết */
export function Alert({ tone = 'info', title, children, error, className, onClose }: {
  tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children?: React.ReactNode; error?: string | null; className?: string; onClose?: () => void
}) {
  const h = error ? humanizeError(error) : null
  const t = h ? h.tone : tone
  const Icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: h?.kind === 'rls' ? ShieldAlert : XCircle }[t]
  const styles = {
    info: 'border-info/25 bg-info-soft text-info',
    success: 'border-success/25 bg-success-soft text-success',
    warning: 'border-warning/30 bg-warning-soft text-warning',
    danger: 'border-danger/25 bg-danger-soft text-danger',
  }[t]
  return (
    <div role={t === 'danger' ? 'alert' : 'status'} className={cn('flex gap-2.5 rounded-md border p-3 text-sm', styles, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">{h?.title ?? title}</p>
        {h ? <p className="text-foreground/80">{h.message}</p> : children && <div className="text-foreground/80">{children}</div>}
        {h?.raw && (
          <details className="text-xs text-foreground/60">
            <summary className="cursor-pointer select-none">Chi tiết kỹ thuật</summary>
            <code className="mt-1 block whitespace-pre-wrap break-words">{h.raw}</code>
          </details>
        )}
      </div>
      {onClose && <button onClick={onClose} className="self-start text-xs underline-offset-2 hover:underline" aria-label="Đóng thông báo">Đóng</button>}
    </div>
  )
}
