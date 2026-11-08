import * as React from 'react'
import * as D from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = D.Root
export const DropdownTrigger = D.Trigger
export function DropdownContent({ className, ...p }: React.ComponentPropsWithoutRef<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content sideOffset={8} className={cn('z-50 min-w-48 rounded-xl border bg-white p-1.5 shadow-e3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)} {...p} />
    </D.Portal>
  )
}
export function DropdownItem({ className, ...p }: React.ComponentPropsWithoutRef<typeof D.Item>) {
  return <D.Item className={cn('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-slate-100 [&_svg]:size-4 [&_svg]:text-slate-500', className)} {...p} />
}
export const DropdownLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof D.Label>) => <D.Label className={cn('px-2.5 py-1.5 text-xs text-subtle', className)} {...p} />
export const DropdownSeparator = () => <D.Separator className="my-1 h-px bg-border" />
