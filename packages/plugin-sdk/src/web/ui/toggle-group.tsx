import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "./toggle"

/**
 * Segmented control (design-system SegmentedControl) — the default look of a ToggleGroup: a filled track with a
 * raised thumb that springs to the chosen item. Items can be text, icon, or icon + text. An item marked
 * `data-unavailable` looks disabled but stays clickable so the caller can say why (compare modes).
 * `variant="outline"` / `"chip"` give separate toggles instead (filter chips use "chip").
 */
type GroupVariant = VariantProps<typeof toggleVariants>["variant"]

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }
>({
  size: "default",
  variant: "segment",
  spacing: 0,
})

function useThumb(root: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const thumb = React.useRef<HTMLSpanElement | null>(null)
  React.useLayoutEffect(() => {
    const el = root.current
    if (!enabled || !el) return
    let first = true
    const place = () => {
      const on = el.querySelector<HTMLElement>(':scope > [data-slot="toggle-group-item"][data-state="on"]')
      const t = thumb.current
      if (!t) return
      if (!on) { t.style.opacity = "0"; return }
      t.style.opacity = "1"
      t.style.transition = first ? "none" : ""
      t.style.width = on.offsetWidth + "px"
      t.style.transform = `translateX(${on.offsetLeft}px)`
      first = false
    }
    place()
    const mo = new MutationObserver(place)
    mo.observe(el, { attributes: true, subtree: true, attributeFilter: ["data-state"] })
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null
    ro?.observe(el)
    return () => { mo.disconnect(); ro?.disconnect() }
  }, [root, enabled])
  return thumb
}

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }) {
  const v: GroupVariant = !variant || variant === "default" ? "segment" : variant
  const segmented = v === "segment"
  const ref = React.useRef<HTMLDivElement | null>(null)
  const thumb = useThumb(ref, segmented && props.type === "single")
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      data-slot="toggle-group"
      data-variant={v}
      data-size={size}
      data-spacing={spacing}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        segmented
          ? "group/toggle-group relative inline-flex h-7 w-fit items-stretch rounded-md bg-fill-rest p-0.5 data-[size=sm]:h-[22px] data-[size=lg]:h-9"
          : "group/toggle-group inline-flex w-fit flex-wrap items-center gap-1",
        className
      )}
      {...props}
    >
      {segmented && props.type === "single" && (
        <span
          ref={thumb}
          aria-hidden
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-sm bg-fill-thumb opacity-0 shadow-raise transition-[transform,width] duration-snappy ease-settle"
        />
      )}
      <ToggleGroupContext.Provider value={{ variant: v, size, spacing }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  const v = context.variant || variant
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={v}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({ variant: v, size: v === "segment" ? undefined : context.size || size }),
        v === "segment" && "h-full min-w-0 active:scale-[0.96] data-[state=on]:bg-transparent",
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
