import * as React from 'react'
import { Button, cn, Input, Textarea, ToggleGroup, ToggleGroupItem, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@bowerbird/plugin-sdk/web'
import { Icon } from '../../components/Icon'
import './web2.css'

/**
 * Small controls used by line web-2's pages. Button, segmented control and text fields wrap plugin-sdk's shadcn
 * components (ADR-021) and keep web-2's call signatures; menus, dialogs, tooltips and switches come from there too.
 */

export type BtnVariant = 'default' | 'primary' | 'danger' | 'ghost'
export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  /** Icon-only button; `aria-label` is required then. */
  iconOnly?: boolean
}
const BTN_SIZE = { sm: ['sm', 'icon-sm'], md: ['default', 'icon'], lg: ['lg', 'icon-lg'] } as const
/** Button: the design-system Button from plugin-sdk (ADR-021), with web-2's call signature. */
export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(function Btn(
  { variant = 'default', size = 'md', icon, iconOnly, children, type = 'button', ...rest }, ref
) {
  return (
    <Button ref={ref} type={type} variant={variant} size={BTN_SIZE[size][iconOnly ? 1 : 0]} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 16} />}
      {children}
    </Button>
  )
})

export interface SegItem<T extends string> {
  value: T
  label: React.ReactNode
  icon?: string
  /** Set when this choice cannot be used here: it stays clickable (not greyed) and the reason is shown on click. */
  unavailable?: string
  title?: string
}
/**
 * Segmented control: plugin-sdk's ToggleGroup (design-system SegmentedControl, ADR-021) as a radiogroup. ← / →
 * choose the neighbour (skipping unavailable ones); unavailable items keep their look and clicking one calls
 * `onUnavailable(reason)` instead of choosing it.
 */
export function Seg<T extends string>(p: {
  items: SegItem<T>[]
  value: T
  onChange(v: T): void
  onUnavailable?(reason: string, value: T): void
  label: string
  className?: string
  /** Mark for onboarding hints that point at this control (`data-onboard`, ADR-064). */
  anchor?: string
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const pick = (it: SegItem<T>) => {
    if (it.unavailable) { p.onUnavailable?.(it.unavailable, it.value); return }
    if (it.value !== p.value) p.onChange(it.value)
  }
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    const n = p.items.length
    for (let k = 1; k <= n; k++) {
      const j = (i + d * k + n) % n
      if (!p.items[j]!.unavailable) { refs.current[j]?.focus(); pick(p.items[j]!); return }
    }
  }
  const group = (
    <ToggleGroup type="single" role="radiogroup" aria-label={p.label} data-onboard={p.anchor} value={p.value} className={cn('w2-seg2 shrink-0', p.className)}
      onValueChange={v => { const it = p.items.find(x => x.value === v); if (it) pick(it) }}>
      {p.items.map((it, i) => {
        const btn = (
          <ToggleGroupItem
            key={it.value}
            ref={el => { refs.current[i] = el }}
            value={it.value}
            className="w2-seg__item gap-1 px-2.5 text-[12px]"
            aria-disabled={it.unavailable ? true : undefined}
            data-unavailable={it.unavailable ? '' : undefined}
            title={it.unavailable ? undefined : it.title}
            data-value={it.value}
            onClick={e => { if (it.unavailable) { e.preventDefault(); pick(it) } }}
            onKeyDown={e => onKey(e, i)}
          >
            {it.icon && <Icon name={it.icon} size={12} />}
            {it.label}
          </ToggleGroupItem>
        )
        if (!it.unavailable) return btn
        return (
          <Tooltip key={it.value}>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent className="w2-ctip w2-floating" sideOffset={6}>{it.unavailable}</TooltipContent>
          </Tooltip>
        )
      })}
    </ToggleGroup>
  )
  return p.items.some(it => it.unavailable) ? <TooltipProvider delayDuration={150}>{group}</TooltipProvider> : group
}

/** Text field: plugin-sdk's Input (design-system TextField), with an optional leading icon. */
export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: string; invalid?: boolean; wrapClassName?: string }>(
  function TextInput({ icon, invalid, wrapClassName, className, ...rest }, ref) {
    return (
      <div className={cn('w2-field2 relative flex min-w-0 items-center', wrapClassName)} data-invalid={invalid ? '' : undefined}>
        {icon && <span className="pointer-events-none absolute left-2 inline-flex text-ink-3"><Icon name={icon} size={12} /></span>}
        <Input ref={ref} className={cn(icon && 'pl-6', className)} aria-invalid={invalid || undefined} data-invalid={invalid ? '' : undefined} autoComplete="off" spellCheck={false} {...rest} />
      </div>
    )
  }
)

/** Multi-line text field: plugin-sdk's Textarea. */
export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; wrapClassName?: string }>(
  function TextArea({ invalid, wrapClassName, className, ...rest }, ref) {
    return (
      <div className={cn('w2-field2 min-w-0', wrapClassName)} data-invalid={invalid ? '' : undefined}>
        <Textarea ref={ref} className={cn('min-h-[54px]', className)} aria-invalid={invalid || undefined} data-invalid={invalid ? '' : undefined} {...rest} />
      </div>
    )
  }
)

export function Kbd({ children }: { children: React.ReactNode }) { return <kbd className="w2-kbd">{children}</kbd> }

export function Tag({ children, ai, small, className }: { children: React.ReactNode; ai?: boolean; small?: boolean; className?: string }) {
  return <span className={cn('w2-tag', ai && 'w2-tag--ai', small && 'w2-tag--sm', className)}>{children}</span>
}

export function KV({ rows, className }: { rows: Array<[React.ReactNode, React.ReactNode] | null | false | undefined>; className?: string }) {
  return (
    <dl className={cn('w2-kv', className)}>
      {rows.filter(Boolean).map((r, i) => (
        <React.Fragment key={i}><dt>{(r as [React.ReactNode, React.ReactNode])[0]}</dt><dd>{(r as [React.ReactNode, React.ReactNode])[1]}</dd></React.Fragment>
      ))}
    </dl>
  )
}

export function Mono({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <span className={cn('w2-mono', className)} title={title}>{children}</span>
}

export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('w2-num', className)}>{children}</span>
}

export function Grow() { return <span className="w2-grow" /> }

/** A row of skeleton lines for page loading states. */
export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="w2-skel" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="w2-skel__r"><i /><span /><span /></div>)}
    </div>
  )
}

/** Radio-style option card (version plugin picker, relocate candidates). */
export function Option(p: { checked: boolean; onSelect(): void; icon?: string; title: React.ReactNode; sub?: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={p.checked} className="w2-opt" onClick={p.onSelect} disabled={p.disabled}>
      {p.icon && <Icon name={p.icon} />}
      <span><b>{p.title}</b>{p.sub && <small>{p.sub}</small>}</span>
      <i className="w2-opt__r" />
    </button>
  )
}

/** Thin progress bar (0..1). */
export function Progress({ value, className, style }: { value: number; className?: string; style?: React.CSSProperties }) {
  return <span className={cn('w2-progress', className)} style={style} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></span>
}
