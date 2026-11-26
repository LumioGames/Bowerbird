import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * The general toast host (ADR-021, prototype .tstack/.bb-toast): bottom-right, stacked (at most 4 on screen),
 * the newest at the bottom without pushing the others away, stays while hovered. A toast is a single line on the
 * popover material with an optional small button (「撤销」「查看」「挑选…」「切回」).
 * Theme follows the shell's resolved theme, passed in by the shell; `offset` lifts the stack above viewer controls.
 */
const toastClass =
  "group/toast pointer-events-auto flex w-max max-w-[min(520px,calc(100vw-32px))] items-center gap-3 rounded-lg py-1.5 pr-1.5 pl-3 text-[13px] leading-[18px] text-ink-1 bg-material-popover backdrop-popover shadow-[var(--shadow-popover),inset_0_1px_0_var(--material-edge)] data-[type=error]:[&_[data-title]]:text-ink-1"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="bottom-right"
      visibleToasts={4}
      expand
      gap={8}
      offset={16}
      icons={{ success: null, info: null, warning: null, error: null }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: toastClass,
          content: "min-w-0",
          title: "truncate whitespace-nowrap font-normal",
          description: "text-[12px] leading-4 text-ink-2",
          actionButton:
            "inline-flex h-[22px] shrink-0 cursor-default items-center rounded-xs bg-fill-rest px-2 text-[12px] leading-4 font-medium text-ink-1 outline-none transition-colors hover:bg-fill-hover active:bg-fill-press focus-visible:outline-2 focus-visible:outline-accent-ring",
          cancelButton:
            "inline-flex h-[22px] shrink-0 cursor-default items-center rounded-xs bg-transparent px-2 text-[12px] leading-4 text-ink-2 hover:bg-fill-rest",
          closeButton: "hidden",
        },
      }}
      style={
        {
          "--width": "520px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
