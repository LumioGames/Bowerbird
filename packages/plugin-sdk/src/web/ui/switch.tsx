import * as React from "react"
import { cn } from "../lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

/** Switch (prototype .bb-switch): 28 × 16 track, 12 px knob that springs across; accent when on. */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex h-4 w-7 shrink-0 cursor-default items-center rounded-full bg-fill-press p-0.5 outline-none transition-colors duration-fade ease-out-bb focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-50 data-[state=checked]:bg-accent-fill data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3 rounded-full bg-fill-knob shadow-raise transition-transform duration-snappy ease-settle data-[state=checked]:translate-x-3 group-data-[size=sm]/switch:size-2.5 group-data-[size=sm]/switch:data-[state=checked]:translate-x-2.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
