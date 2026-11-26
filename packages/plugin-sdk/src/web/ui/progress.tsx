import * as React from "react"
import { cn } from "../lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

/**
 * Linear progress (design-system Progress): a 3 px track with an ink bar that settles with a spring.
 * `tone="danger"` for a failed transfer, `tone="accent"` for emphasis. Width comes from the caller (64 px in a cell).
 */
function Progress({
  className,
  value,
  tone = "ink",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { tone?: "ink" | "accent" | "danger" }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-tone={tone}
      className={cn(
        "relative block h-[3px] w-full overflow-hidden rounded-full bg-fill-press",
        className
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="block h-full rounded-[inherit] bg-ink-2 transition-[width] duration-settle ease-settle data-[tone=accent]:bg-accent-fill in-data-[tone=accent]:bg-accent-fill in-data-[tone=danger]:bg-danger-fill"
        style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
