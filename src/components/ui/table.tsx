import * as React from 'react'
import { cn } from '@/lib/utils'

export const Table = ({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="relative w-full overflow-auto">
    <table className={cn('w-full caption-bottom text-sm tabular', className)} {...p} />
  </div>
)
export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn('sticky top-0 z-10 bg-muted/95 backdrop-blur [&_tr]:border-b', className)} {...p} />
)
export const TBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b transition-colors hover:bg-primary-soft/60', className)} {...p} />
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-9 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold text-muted-foreground', className)} {...p} />
)
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-3 py-2 align-middle', className)} {...p} />
