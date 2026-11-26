import * as React from "react"
import { cn } from "../lib/utils"
import { Tooltip as TooltipPrimitive } from "radix-ui"

/** Tooltip: a small raised label (e.g. why a compare mode is unavailable). */
function TooltipProvider({
  delayDuration = 500,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit max-w-80 origin-(--radix-tooltip-content-transform-origin) rounded-sm bg-surface-raised px-2 py-1 text-[12px] leading-4 text-ink-1 shadow-popover data-[state=delayed-open]:animate-[bb-fade_var(--duration-fade)_var(--ease-out)_both] data-[state=instant-open]:animate-[bb-fade_var(--duration-fade)_var(--ease-out)_both]",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
