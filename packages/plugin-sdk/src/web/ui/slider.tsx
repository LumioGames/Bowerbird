import * as React from "react"
import { cn } from "../lib/utils"
import { Slider as SliderPrimitive } from "radix-ui"

/**
 * Slider (design-system Slider): 4 px track, accent range, 14 px knob that grows on press; 1:1 tracking.
 * `startLabel` / `endLabel` put words at both ends (overlay opacity in compare).
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  startLabel,
  endLabel,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  startLabel?: React.ReactNode
  endLabel?: React.ReactNode
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  const root = (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex h-4 w-full cursor-default touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-4 data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-fill-press data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-accent-fill data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          // the focusable thumb is what assistive technology calls the slider: it carries the name
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className="block size-3.5 shrink-0 rounded-full bg-fill-knob shadow-[0_0_0_1px_var(--line-control),var(--shadow-raise)] outline-none transition-transform duration-press ease-out-bb active:scale-[1.18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
        />
      ))}
    </SliderPrimitive.Root>
  )
  if (startLabel == null && endLabel == null) return root
  return (
    <div data-slot="slider-labelled" className="flex w-full items-center gap-2 text-[12px] leading-4 text-ink-2">
      {startLabel != null && <span className="shrink-0">{startLabel}</span>}
      {root}
      {endLabel != null && <span className="shrink-0">{endLabel}</span>}
    </div>
  )
}

export { Slider }
