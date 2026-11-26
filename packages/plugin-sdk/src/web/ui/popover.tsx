import * as React from "react"
import { cn } from "../lib/utils"
import { Popover as PopoverPrimitive } from "radix-ui"

/** Popover (prototype .pop): background jobs, a plugin toolbar button's panel, small pickers. */
function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[248px] origin-(--radix-popover-content-transform-origin) rounded-lg p-3 text-ink-1 bg-material-popover backdrop-popover shadow-[var(--shadow-popover),inset_0_1px_0_var(--material-edge)] outline-none data-[state=open]:animate-[bb-materialize_var(--duration-snappy)_var(--spring-settle)_both] data-[state=closed]:animate-[bb-fade-out_var(--duration-fade)_var(--ease-out)_both]",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("mb-2 flex flex-col gap-0.5", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="popover-title"
      className={cn("m-0 text-[13px] leading-[18px] font-semibold", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("m-0 text-[12px] leading-4 text-ink-2", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
