import { cn } from "../lib/utils"

/** Loading placeholder: a quiet fill that breathes (prototype .pg-skel). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-sm bg-fill-rest", className)}
      {...props}
    />
  )
}

export { Skeleton }
