import * as React from 'react'
import { createPortal } from 'react-dom'
import { Button, cn, Kbd } from '@bowerbird/plugin-sdk/web'
import { Icon } from './Icon'
import { t } from '../lib/i18n'
import { useShellHosts } from './hosts'

/**
 * Tool bar pieces (design-system Shell tool bar). A page puts its controls into the shell's bar with <Toolbar>;
 * the bar spans the content and the inspector, is translucent, and the content scrolls under it.
 */
export const Toolbar = React.forwardRef<HTMLDivElement, { children: React.ReactNode; label?: string; className?: string }>(function Toolbar({ children, label, className }, ref) {
  const { toolbar } = useShellHosts()
  const bar = (
    <div ref={ref} role="toolbar" aria-label={label} className={cn('flex h-full min-w-0 items-center gap-2 px-3 [&>*]:shrink-0', className)}>
      {children}
    </div>
  )
  return toolbar ? createPortal(bar, toolbar) : bar
})

/** A ghost icon button with its name as tooltip (and the shortcut, when it has one). */
export const ToolbarButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & { icon: string; label: string; shortcut?: string; pressed?: boolean }>(
  function ToolbarButton({ icon, label, shortcut, pressed, className, children, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size={children ? 'default' : 'icon'}
        aria-label={label}
        title={shortcut ? `${label} ${shortcut}` : label}
        aria-pressed={pressed}
        className={className}
        {...rest}
      >
        <Icon name={icon} />
        {children}
      </Button>
    )
  }
)

export function ToolbarSep() { return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line-hairline" /> }
export function ToolbarGrow() { return <span aria-hidden className="min-w-0 flex-[1_1_0] !shrink" /> }

/**
 * Path in the tool bar (E-25): the middle levels give way first; the current level keeps its full name.
 * `onPick(i)` jumps to a level. `fixed`: the path keeps its full width (the bar folds other controls first).
 */
export function Crumbs({ parts, onPick, fixed }: { parts: string[]; onPick?: (i: number) => void; fixed?: boolean }) {
  return (
    <nav aria-label={t('bar.path')} className={cn('flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-ink-2', fixed ? 'shrink-0' : '!shrink')}>
      {parts.map((p, i) => {
        const last = i === parts.length - 1
        if (last) return <b key={i} className="max-w-[40ch] shrink-0 overflow-hidden text-ellipsis font-semibold text-ink-1">{p}</b>
        return (
          <React.Fragment key={i}>
            {onPick
              ? <button type="button" onClick={() => onPick(i)} title={p}
                  className="min-w-[2ch] shrink cursor-default overflow-hidden text-ellipsis rounded-xs border-0 bg-transparent p-0 text-inherit outline-none hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-accent-ring">{p}</button>
              : <span className="min-w-[2ch] shrink overflow-hidden text-ellipsis" title={p}>{p}</span>}
            <Icon name="chevron-right" size={12} className="shrink-0 text-ink-2" />
          </React.Fragment>
        )
      })}
    </nav>
  )
}

/** A shortcut hint inside a field: `⌘ F` as two keys. */
export function KbdHint({ keys }: { keys: string }) {
  return <span className="flex shrink-0 gap-0.5">{keys.split(' ').map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>
}
