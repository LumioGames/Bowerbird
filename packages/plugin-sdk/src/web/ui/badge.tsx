import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"
import { Slot } from "radix-ui"

/**
 * Tag (design-system Tag) as a badge: plain, AI (an unadopted suggestion — dashed outline, never filled),
 * add (dashed, for「添加标签」), plus the shadcn variant names as aliases.
 */
const badgeVariants = cva(
  "inline-flex h-[22px] max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-full px-2 text-[12px] leading-4 whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-fill-rest text-ink-1",
        secondary: "bg-fill-rest text-ink-2",
        outline: "bg-transparent text-ink-2 shadow-[inset_0_0_0_1px_var(--line-hairline)]",
        ai: "border border-dashed border-line-control bg-transparent pl-1.5 text-ink-2 [&>svg]:text-ink-2",
        add: "border border-dashed border-transparent bg-transparent text-ink-3 hover:bg-fill-rest hover:text-ink-2",
        accent: "bg-accent-soft text-ink-1",
        warning: "bg-warning-soft text-ink-1",
        destructive: "bg-danger-soft text-danger-ink",
        danger: "bg-danger-soft text-danger-ink",
        ghost: "bg-transparent text-ink-2",
        link: "bg-transparent text-accent-ink underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
