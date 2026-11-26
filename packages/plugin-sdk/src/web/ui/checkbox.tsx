import * as React from "react"
import { cn } from "../lib/utils"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

/** Checkbox (prototype .chk): 14 px, control outline; accent fill with a check when on. */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer grid size-3.5 shrink-0 cursor-default place-items-center rounded-xs text-accent-on shadow-[inset_0_0_0_1.5px_var(--line-control)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_1.5px_var(--danger-ink)] data-[state=checked]:bg-accent-fill data-[state=checked]:shadow-none data-[state=indeterminate]:bg-accent-fill data-[state=indeterminate]:shadow-none",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3" strokeWidth={2.25} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
