import * as React from "react"
import { cn } from "../lib/utils"

/** Shortcut hint (design-system Kbd). */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs bg-fill-rest px-1 font-mono text-[11px] leading-[14px] not-italic text-ink-2 shadow-[inset_0_0_0_1px_var(--line-hairline)] select-none",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
