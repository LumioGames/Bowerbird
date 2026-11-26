import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

/**
 * Toggle: a ghost button that stays pressed (filter, side bar / inspector switches), and the item style the
 * segmented control uses. `variant="segment"` is the SegmentedControl item.
 */
const toggleVariants = cva(
  "inline-flex cursor-default select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium outline-none transition-[background-color,color,transform] duration-fade ease-out-bb active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:pointer-events-none disabled:text-ink-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent text-ink-2 hover:bg-fill-rest hover:text-ink-1 data-[state=on]:bg-fill-hover data-[state=on]:text-ink-1",
        outline: "bg-transparent text-ink-2 shadow-[inset_0_0_0_1px_var(--line-hairline)] hover:bg-fill-rest hover:text-ink-1 data-[state=on]:bg-fill-hover data-[state=on]:text-ink-1",
        segment: "relative z-[1] h-full bg-transparent px-2 text-ink-2 hover:text-ink-1 data-[state=on]:text-ink-1 data-[unavailable]:text-ink-disabled",
        chip: "h-[22px] rounded-xs bg-fill-rest px-2 text-[12px] leading-4 font-normal text-ink-2 hover:bg-fill-hover hover:text-ink-1 data-[state=on]:bg-accent-soft data-[state=on]:text-ink-1 data-[state=on]:shadow-[inset_0_0_0_1px_var(--accent-ring)] [&_svg:not([class*='size-'])]:size-3",
      },
      size: {
        default: "h-7 min-w-7 px-2",
        sm: "h-[22px] min-w-[22px] px-1.5 text-[12px]",
        lg: "h-9 min-w-9 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
