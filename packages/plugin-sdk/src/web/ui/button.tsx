import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"
import { Slot } from "radix-ui"

/**
 * Button (design-system Button, components.md): default (fill), primary, danger, ghost; sizes sm / default / lg;
 * icon-only; pressed state through aria-pressed. Feedback is on the press and instant (scale 0.97).
 * shadcn's names stay as aliases so existing code keeps working: destructive = danger, secondary = default,
 * xs = sm, icon-xs = icon-sm.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-default select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium no-underline outline-none transition-[background-color,color,filter,transform] duration-fade ease-out-bb active:scale-[0.97] active:duration-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:pointer-events-none disabled:bg-fill-rest disabled:text-ink-disabled disabled:brightness-100 aria-disabled:pointer-events-none aria-disabled:text-ink-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-fill-rest text-ink-1 hover:bg-fill-hover active:bg-fill-press aria-pressed:bg-fill-press data-[state=open]:bg-fill-press",
        secondary: "bg-fill-rest text-ink-1 hover:bg-fill-hover active:bg-fill-press aria-pressed:bg-fill-press data-[state=open]:bg-fill-press",
        primary: "bg-accent-fill font-semibold text-accent-on hover:brightness-110 active:brightness-[0.92]",
        danger: "bg-danger-fill font-semibold text-danger-on hover:brightness-110 active:brightness-[0.92]",
        destructive: "bg-danger-fill font-semibold text-danger-on hover:brightness-110 active:brightness-[0.92]",
        ghost: "bg-transparent text-ink-2 hover:bg-fill-rest hover:text-ink-1 active:bg-fill-hover aria-pressed:bg-fill-hover aria-pressed:text-ink-1 data-[state=open]:bg-fill-hover data-[state=open]:text-ink-1 disabled:bg-transparent",
        outline: "bg-transparent text-ink-1 shadow-[inset_0_0_0_1px_var(--line-hairline)] hover:bg-fill-rest active:bg-fill-hover",
        link: "h-auto bg-transparent px-0 text-accent-ink hover:underline active:scale-100",
      },
      size: {
        default: "h-7 px-3",
        sm: "h-[22px] rounded-xs px-2 text-[12px] leading-4 [&_svg:not([class*='size-'])]:size-3",
        xs: "h-[22px] rounded-xs px-2 text-[12px] leading-4 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 rounded-md px-4",
        icon: "size-7 p-0",
        "icon-sm": "size-[22px] rounded-xs p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-xs": "size-[22px] rounded-xs p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-9 rounded-md p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
