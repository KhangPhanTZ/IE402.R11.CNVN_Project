import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** Badge nền nhạt + chữ đậm màu: đọc được và đạt tương phản AA */
const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', {
  variants: {
    variant: {
      default: 'bg-primary-soft text-primary ring-primary/20',
      secondary: 'bg-muted text-muted-foreground ring-border',
      outline: 'bg-surface text-muted-foreground ring-border',
      success: 'bg-success-soft text-success ring-success/20',
      warning: 'bg-warning-soft text-warning ring-warning/25',
      destructive: 'bg-danger-soft text-danger ring-danger/20',
      info: 'bg-info-soft text-info ring-info/20',
      violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export function Badge({ className, variant, dot, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {props.children}
    </span>
  )
}
