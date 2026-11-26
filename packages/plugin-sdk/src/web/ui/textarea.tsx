import * as React from "react"
import { cn } from "../lib/utils"

/** Multi-line text field (design-system TextField, multi-line). */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "block min-h-[66px] w-full resize-none rounded-sm bg-fill-rest px-2 py-1.5 leading-[18px] text-ink-1 outline-none transition-colors duration-fade ease-out-bb placeholder:text-ink-3 hover:bg-fill-hover focus-visible:bg-fill-rest focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-ring disabled:pointer-events-none disabled:text-ink-disabled aria-invalid:shadow-[inset_0_0_0_1px_var(--danger-ink)] data-[invalid]:shadow-[inset_0_0_0_1px_var(--danger-ink)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
