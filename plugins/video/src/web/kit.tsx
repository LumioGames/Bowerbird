/**
 * Small building blocks shared by this plugin's viewer and compare view: the viewer frame (tool bar, stage,
 * foot), a segmented control, tool-bar buttons, floating chips and the empty / error state.
 * Styled with the shell's theme (design-system variables through Tailwind), like the prototype's `.vw`.
 */
import * as React from 'react'
import { Button, cn } from '@bowerbird/plugin-sdk/web'
import type { ViewerMode } from '@bowerbird/plugin-sdk/web'

export function ViewerFrame(props: {
  mode?: ViewerMode
  bar?: React.ReactNode
  foot?: React.ReactNode
  stageRef?: React.Ref<HTMLDivElement>
  stageClassName?: string
  stageStyle?: React.CSSProperties
  stageProps?: React.HTMLAttributes<HTMLDivElement>
  rootProps?: React.HTMLAttributes<HTMLDivElement>
  plugin: string
  children: React.ReactNode
}) {
  const compact = props.mode === 'quicklook' || props.mode === 'compare'
  return (
    <div
      data-plugin={props.plugin}
      className={cn('flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden outline-none', compact ? 'bg-transparent' : 'rounded-lg bg-surface-panel')}
      {...props.rootProps}
    >
      {!compact && props.bar ? (
        <div className="flex h-10 flex-none items-center gap-1.5 overflow-hidden px-2 [&>*]:shrink-0" role="toolbar">{props.bar}</div>
      ) : null}
      <div
        ref={props.stageRef}
        className={cn('relative min-h-0 flex-1 touch-none overflow-hidden bg-surface-well select-none', props.stageClassName)}
        style={props.stageStyle}
        {...props.stageProps}
      >
        {props.children}
      </div>
      {props.foot ? <div className="flex-none p-2">{props.foot}</div> : null}
    </div>
  )
}

export function Sep() { return <i aria-hidden className="mx-0.5 h-4 w-px flex-none bg-line-hairline" /> }
export function Grow() { return <span className="min-w-2 flex-1" /> }
export function Num(props: { children: React.ReactNode; className?: string; title?: string }) {
  return <span title={props.title} className={cn('flex-none whitespace-nowrap text-xs tabular-nums text-ink-2', props.className)}>{props.children}</span>
}

export interface SegItem<T extends string> { value: T; label: React.ReactNode; title?: string }

/** Segmented control (design-system `.bb-seg`): a radio group with arrow-key movement. */
export function Seg<T extends string>(props: { label: string; items: Array<SegItem<T>>; value: T; onChange(v: T): void; className?: string }) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const idx = Math.max(0, props.items.findIndex(i => i.value === props.value))
  const move = (d: number) => {
    const n = props.items.length
    const next = (idx + d + n) % n
    props.onChange(props.items[next]!.value)
    refs.current[next]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className={cn('inline-flex h-6 flex-none items-center rounded-md bg-fill-rest p-0.5', props.className)}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1) }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1) }
      }}
    >
      {props.items.map((it, i) => (
        <button
          key={it.value}
          ref={el => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={it.value === props.value}
          tabIndex={it.value === props.value ? 0 : -1}
          title={it.title}
          onClick={() => props.onChange(it.value)}
          className="inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-xs text-ink-2 transition-colors duration-fade outline-none hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-accent-ring aria-checked:bg-surface-raised aria-checked:text-ink-1 aria-checked:shadow-raise"
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

/** Tool-bar icon button. */
export function IconBtn(props: { label: string; title?: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode; pressed?: boolean; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={props.title ?? props.label}
      onClick={props.onClick}
      className={cn('size-7 text-ink-1 [&_svg]:size-4 aria-pressed:bg-accent-soft aria-pressed:text-accent-ink', props.className)}
    >
      {props.children}
    </Button>
  )
}

/** Tool-bar text button; `pressed` makes it a toggle. */
export function TextBtn(props: { children: React.ReactNode; title?: string; onClick?: () => void; pressed?: boolean; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-pressed={props.pressed}
      title={props.title}
      onClick={props.onClick}
      className={cn('h-6 px-2 text-xs font-normal text-ink-1 [&_svg]:size-3 aria-pressed:bg-accent-soft aria-pressed:text-accent-ink', props.className)}
    >
      {props.children}
    </Button>
  )
}

/** Floating chip on a stage (prototype `.cfloat`). */
export function Float(props: { className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={props.style} className={cn('absolute z-[3] flex h-8 items-center gap-2 whitespace-nowrap rounded-full bg-material-popover px-2 text-xs text-ink-1 shadow-popover backdrop-popover', props.className)}>
      {props.children}
    </div>
  )
}

/** The A / B key (prototype `.cpk__k`). */
export function Key(props: { children: React.ReactNode }) {
  return <i className="inline-grid size-[18px] flex-none place-items-center rounded-[5px] bg-fill-rest font-mono text-[11px] font-semibold not-italic text-ink-1">{props.children}</i>
}

/** Side label in a compare pane (prototype `.clab`). */
export function SideLabel(props: { k: 'A' | 'B'; text: string; right?: boolean }) {
  return (
    <span className={cn('pointer-events-none absolute top-2 z-[3] inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full bg-material-popover pl-1 pr-2 text-xs tabular-nums text-ink-1 shadow-popover backdrop-popover', props.right ? 'right-2' : 'left-2')}>
      <Key>{props.k}</Key>{props.text}
    </span>
  )
}

/** Empty / error state inside a stage (design-system `.bb-empty`). */
export function EmptyState(props: { icon: React.ReactNode; title: string; text?: string; actions?: Array<{ label: string; icon?: React.ReactNode; primary?: boolean; onClick(): void }> }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <div className="mb-1 grid size-12 place-items-center rounded-full bg-fill-rest text-ink-2 [&_svg]:size-6">{props.icon}</div>
        <h3 className="text-[15px] font-semibold text-ink-1">{props.title}</h3>
        {props.text ? <p className="font-mono text-xs text-ink-2">{props.text}</p> : null}
        {props.actions?.length ? (
          <div className="mt-2 flex gap-2">
            {props.actions.map(a => (
              <Button key={a.label} type="button" size="sm" variant={a.primary ? 'default' : 'secondary'} onClick={a.onClick}>{a.icon}{a.label}</Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Observe an element's size; pass `deps` that change when the ref moves to another element. */
export function useSize(ref: React.RefObject<HTMLElement | null>, ...deps: unknown[]): { w: number; h: number } {
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize(s => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
  return size
}

/** Download the original file (used by error states). */
export function downloadUrl(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url + (url.includes('?') ? '&' : '?') + 'download=1'
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
