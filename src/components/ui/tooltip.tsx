import * as React from 'react'
import * as T from '@radix-ui/react-tooltip'

export const TooltipProvider = T.Provider

/** Tooltip gọn: <Tooltip content="…"><button/></Tooltip> */
export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactElement; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={8}
          className="z-50 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-e2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
