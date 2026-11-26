import * as React from "react"
import { cn } from "../lib/utils"

/** Text field (design-system TextField): 28 px, filled, accent ring on focus, `aria-invalid` / `data-invalid` for errors. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-7 w-full min-w-0 rounded-sm bg-fill-rest px-2 text-ink-1 outline-none transition-colors duration-fade ease-out-bb placeholder:text-ink-3 hover:bg-fill-hover focus-visible:bg-fill-rest focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-ring disabled:pointer-events-none disabled:text-ink-disabled aria-invalid:shadow-[inset_0_0_0_1px_var(--danger-ink)] data-[invalid]:shadow-[inset_0_0_0_1px_var(--danger-ink)] file:border-0 file:bg-transparent file:text-ink-1",
        className
      )}
      {...props}
    />
  )
}

export { Input }
