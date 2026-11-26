/**
 * Small controls in the design system's look (prototype app.css: bb-seg, bb-sec, rowctl, prow, mv-chip),
 * built on the shell's shared components where they exist.
 */
import * as React from 'react'
import { cn, Switch, Slider } from '@bowerbird/plugin-sdk/web'
import { Icon, type IconName } from '../icons'

export function Seg<T extends string>({ value, items, onChange, label, className, size = 'md' }: {
  value: T
  items: Array<{ value: T; label?: React.ReactNode; icon?: IconName; title?: string }>
  onChange(v: T): void
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex shrink-0 items-center gap-px rounded-md bg-fill-rest p-0.5', size === 'sm' ? 'h-6' : 'h-7', className)}>
      {items.map(it => {
        const on = it.value === value
        return (
          <button key={it.value} type="button" role="radio" aria-checked={on} title={it.title} aria-label={it.title}
            onClick={() => onChange(it.value)}
            className={cn('inline-flex h-full items-center justify-center gap-1 rounded-[5px] text-xs whitespace-nowrap transition-colors duration-fade', size === 'sm' ? 'px-1.5' : 'px-2',
              on ? 'bg-fill-thumb text-ink-1 shadow-raise' : 'text-ink-2 hover:text-ink-1')}>
            {it.icon && <Icon name={it.icon} size={14} />}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function IconButton({ icon, label, pressed, onClick, className, size = 28, disabled }: {
  icon: IconName; label: string; pressed?: boolean; onClick?(e: React.MouseEvent<HTMLButtonElement>): void; className?: string; size?: number; disabled?: boolean
}) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
      style={{ width: size, height: size }}
      className={cn('inline-grid shrink-0 place-items-center rounded-md text-ink-2 transition-colors duration-fade hover:bg-fill-hover hover:text-ink-1 active:scale-[0.97] disabled:opacity-40',
        pressed && 'bg-fill-press text-ink-1', className)}>
      <Icon name={icon} size={16} />
    </button>
  )
}

export function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle(): void; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-hairline px-3 pt-1 pb-2 last:border-b-0">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex h-7 w-full items-center gap-1 text-left text-xs font-medium text-ink-2 hover:text-ink-1">
        <Icon name="chevron-down" size={12} className={cn('transition-transform duration-fade', !open && '-rotate-90')} />
        {title}
      </button>
      {/* one column that never grows past the panel: a wide row cannot push the others out of view */}
      {open && <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 pb-1">{children}</div>}
    </section>
  )
}

/**
 * A panel row (prototype `.rowctl`): a 48 px label, then the control. A longer label (「Background」) takes the room
 * it needs, and a control that no longer fits beside it moves to the next line instead of running out of the panel.
 */
export function Row({ label, children, className }: { label?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2', className)}>
      {label !== undefined && <span className="min-w-12 shrink-0">{label}</span>}
      {children}
    </div>
  )
}

/** A labelled slider; `name` is its accessible name when the short row label is not enough (「旋转」→「旋转环境」). */
export function SliderRow({ label, name, value, min, max, step = 1, format, onChange, disabled }: {
  label: string; name?: string; value: number; min: number; max: number; step?: number; format(v: number): string; onChange(v: number): void; disabled?: boolean
}) {
  return (
    <Row label={label}>
      <Slider className="min-w-0 flex-1" min={min} max={max} step={step} value={[value]} disabled={disabled} aria-label={name ?? label}
        onValueChange={v => onChange(v[0] ?? value)} />
      <span className="w-14 text-right font-mono text-[11px] tabular-nums text-ink-2">{format(value)}</span>
    </Row>
  )
}

/**
 * A switch with an accessible name: `name` is always its label for assistive technology; `label` is shown next
 * to it only when the row does not already say what it is (a row titled「主光」holds a switch named「主光」).
 */
export function SwitchField({ name, label, checked, onChange }: { name: string; label?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <>
      {label && <span aria-hidden>{label}</span>}
      <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label={name} />
    </>
  )
}

/** Floating pill on the viewport (channel chips, notes, timeline). */
export const floatPill = 'rounded-full bg-material-popover text-ink-1 shadow-popover backdrop-popover'
