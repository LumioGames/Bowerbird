/**
 * Shared look of every floating list (dropdown, context menu, select): the design-system Menu.
 * A material arrives by blurring and scaling in from the point that summoned it (keyframes `bb-materialize`,
 * defined once by the shell stylesheet).
 */
export const menuContent =
  "z-50 min-w-[208px] overflow-x-hidden overflow-y-auto rounded-lg p-1 text-ink-1 bg-material-popover backdrop-popover shadow-[var(--shadow-popover),inset_0_1px_0_var(--material-edge)] outline-none data-[state=open]:animate-[bb-materialize_var(--duration-snappy)_var(--spring-settle)_both] data-[state=closed]:animate-[bb-fade-out_var(--duration-fade)_var(--ease-out)_both]"

export const menuItem =
  "group/menu-item relative flex h-7 w-full cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 text-left text-ink-1 outline-none data-[highlighted]:bg-fill-hover data-[state=open]:bg-fill-hover active:bg-fill-press data-[disabled]:pointer-events-none data-[disabled]:text-ink-disabled data-[disabled]:[&_svg]:text-ink-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>svg:first-child]:text-ink-2 data-[highlighted]:[&>svg:first-child]:text-ink-1 data-[variant=destructive]:text-danger-ink data-[variant=destructive]:[&>svg:first-child]:text-danger-ink data-[variant=danger]:text-danger-ink data-[variant=danger]:[&>svg:first-child]:text-danger-ink"

export const menuShortcut = "ml-auto pl-6 font-mono text-[11px] leading-[14px] tracking-normal text-ink-2"
export const menuSeparator = "mx-2 my-1 h-px bg-line-hairline"
export const menuLabel = "px-2 pt-1.5 pb-1 text-[11px] font-semibold leading-[14px] tracking-[0.04em] text-ink-2"
export const menuCheck = "inline-flex w-4 shrink-0 items-center text-ink-1 [&_svg]:size-4"
