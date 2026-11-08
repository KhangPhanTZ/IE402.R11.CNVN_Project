import * as React from 'react'
import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from './button'
import { Textarea } from './input'
import { cn } from '@/lib/utils'

export function Dialog({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children?: React.ReactNode; footer?: React.ReactNode; className?: string
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-900/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-5 shadow-e3 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description && <D.Description className="text-sm text-muted-foreground">{description}</D.Description>}
            </div>
            <D.Close asChild><Button variant="ghost" size="icon" aria-label="Đóng"><X /></Button></D.Close>
          </div>
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Thay cho window.confirm / window.prompt: có tiêu đề, mô tả, (tuỳ chọn) ô ghi chú */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Xác nhận', destructive, withNote, defaultNote = '', onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; confirmLabel?: string; destructive?: boolean
  withNote?: string; defaultNote?: string; onConfirm: (note: string) => void | Promise<void>
}) {
  const [note, setNote] = React.useState(defaultNote)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) setNote(defaultNote) }, [open, defaultNote])
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
        <Button variant={destructive ? 'destructive' : 'default'} loading={busy}
          onClick={async () => { setBusy(true); try { await onConfirm(note); onOpenChange(false) } finally { setBusy(false) } }}>
          {confirmLabel}
        </Button>
      </>}>
      {withNote && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{withNote}</span>
          <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
    </Dialog>
  )
}
