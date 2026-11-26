import * as React from 'react'
import { cn } from '@bowerbird/plugin-sdk/web'
import { Icon } from './Icon'
import { t } from '../lib/i18n'
import { keyboardContextMenu } from '../lib/shortcuts'

/**
 * Small shared pieces from the design system: InspectorSection, the key/value list, ListRow, Tag, the copyable
 * mono value, the section label, filter chips. Pages of both web lines use them.
 */

const collapsedMemory = new Map<string, boolean>()

/** Inspector section: collapsible (remembered per title for this page), optional count and source plugin id. */
export function Section({ title, count, by, defaultCollapsed, children, id, className }: {
  title: React.ReactNode; count?: number | null; by?: string; defaultCollapsed?: boolean; children?: React.ReactNode; id?: string; className?: string
}) {
  const key = id ?? (typeof title === 'string' ? title : '')
  const [collapsed, setCollapsed] = React.useState(() => (key && collapsedMemory.has(key) ? collapsedMemory.get(key)! : !!defaultCollapsed))
  const toggle = () => setCollapsed(c => { if (key) collapsedMemory.set(key, !c); return !c })
  return (
    <section data-collapsed={collapsed || undefined} className={cn('px-4 pt-2 pb-3 [&+&]:shadow-[inset_0_1px_0_var(--line-hairline)]', className)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={toggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
        className="-mx-1 flex h-7 cursor-default select-none items-center gap-1.5 rounded-xs px-1 text-[11px] leading-[14px] font-semibold tracking-[0.04em] text-ink-3 outline-none hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-accent-ring"
      >
        <Icon name="chevron-right" size={12} className={cn('transition-transform duration-snappy ease-settle', !collapsed && 'rotate-90')} />
        <span>{title}{count != null ? ` · ${count}` : ''}</span>
        {by && <span className="ml-auto font-mono font-normal tracking-normal text-ink-3">{by}</span>}
      </div>
      {!collapsed && <div className="grid gap-2">{children}</div>}
    </section>
  )
}

/** Key / value rows (design-system .bb-kv): 76 px labels in ink-3. */
export function Kv({ rows, labelWidth = 76, className }: { rows: Array<[React.ReactNode, React.ReactNode] | null | false | undefined>; labelWidth?: number; className?: string }) {
  return (
    <dl className={cn('m-0 grid items-baseline gap-x-3 gap-y-1.5', className)} style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}>
      {(rows.filter(Boolean) as Array<[React.ReactNode, React.ReactNode]>).map((r, i) => (
        <React.Fragment key={i}>
          <dt className="text-[12px] leading-[18px] text-ink-3">{r[0]}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{r[1]}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

/** A mono value that copies itself on click (path, GUID). */
export function CopyText({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => { if (!copied) return; const tm = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(tm) }, [copied])
  return (
    <button
      type="button"
      title={t('common.clickToCopy')}
      onClick={e => { e.stopPropagation(); try { void navigator.clipboard?.writeText(text) } catch { /* no clipboard */ } setCopied(true) }}
      className={cn('group/copy inline-flex max-w-full cursor-default items-center gap-1.5 border-0 bg-transparent p-0 text-left font-mono text-[11px] leading-[18px] text-ink-2 hover:text-ink-1', className)}
    >
      <span className="truncate">{text}</span>
      {copied
        ? <span className="shrink-0 font-sans text-accent-ink">{t('common.copied')}</span>
        : <Icon name="copy" size={12} className="shrink-0 text-ink-3 group-hover/copy:text-ink-1" />}
    </button>
  )
}

/** Section label in the side bar (「智能文件夹」「文件夹」) with an optional trailing button. */
export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-2 flex h-7 items-center justify-between pr-1 pl-2 text-[11px] leading-[14px] font-semibold tracking-[0.04em] text-ink-3">
      <span>{children}</span>
      {action}
    </div>
  )
}

/**
 * What a Row is to assistive technology. Inside a tree (the side bar) it is a `treeitem` with roving focus (see
 * `useTreeKeys`); elsewhere it is a plain row — a list, a dialog's file list — and anything clickable in it is its own
 * button.
 */
export const RowRoleContext = React.createContext<'treeitem' | null>(null)

/** List row (design-system ListRow): folder rows, asset rows, rows with actions. */
export const Row = React.forwardRef<HTMLDivElement, {
  icon?: string; iconNode?: React.ReactNode; thumb?: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; subBlock?: boolean
  count?: React.ReactNode; depth?: number; selected?: boolean; toggle?: boolean; expanded?: boolean; onToggle?: () => void
  trailing?: React.ReactNode; className?: string; drop?: boolean; pulse?: boolean
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>>(function Row(p, ref) {
  const { icon, iconNode, thumb, label, sub, subBlock, count, depth, selected, toggle, expanded, onToggle, trailing, className, drop, pulse, ...rest } = p
  const role = React.useContext(RowRoleContext)
  const tree = role === 'treeitem'
  return (
    <div
      ref={ref}
      {...(tree ? { role: 'treeitem', tabIndex: -1, 'aria-selected': !!selected, 'aria-expanded': toggle ? !!expanded : undefined, 'aria-level': (depth ?? 0) + 1 } : {})}
      data-drop={drop || undefined}
      className={cn(
        'group/row flex cursor-default select-none items-center gap-2 rounded-sm pr-2 text-ink-1 outline-none hover:bg-fill-rest active:bg-fill-hover focus-visible:outline-2 focus-visible:outline-accent-ring',
        thumb ? 'min-h-10' : 'min-h-7',
        selected && 'bg-accent-soft hover:bg-accent-soft',
        drop && 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent-ring)]',
        pulse && 'bb-pulse',
        className
      )}
      style={{ paddingLeft: 8 + (depth ?? 0) * 16 }}
      {...rest}
    >
      {toggle
        ? <span role="presentation" data-tree-toggle onClick={e => { e.stopPropagation(); onToggle?.() }} className="-mr-1 grid size-3 shrink-0 place-items-center text-ink-3"><Icon name="chevron-right" size={12} className={cn('transition-transform duration-snappy ease-settle', expanded && 'rotate-90')} /></span>
        : depth != null && <i className="-mr-1 size-3 shrink-0" />}
      {thumb
        ? <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-xs bg-surface-well text-ink-3">{thumb}</span>
        : iconNode ?? (icon && <Icon name={icon} className={cn('shrink-0', selected ? 'text-accent-ink' : 'text-ink-2')} />)}
      <span className="min-w-0 flex-1 truncate">
        {label}
        {sub != null && <small className={cn('text-ink-3', subBlock || thumb ? 'block text-[11px] leading-[14px]' : 'ml-1.5 text-[12px]')}>{sub}</small>}
      </span>
      {trailing}
      {count != null && <span className="shrink-0 text-[11px] leading-[14px] tracking-[0.01em] tabular-nums text-ink-3">{count}</span>}
    </div>
  )
})

/**
 * Keyboard for a `role="tree"` of Rows (WAI-ARIA tree pattern): one row is in the Tab order (roving tabindex — the
 * selected one, else the first); ↑ ↓ Home End move; → opens a closed row or steps into it, ← closes it or steps out to
 * its parent; ↵ / Space activate; Shift+F10 and the context-menu key open the row's right-click menu.
 */
export function useTreeKeys<T extends HTMLElement>(): { ref: React.RefCallback<T>; onKeyDown: React.KeyboardEventHandler<T>; onFocus: React.FocusEventHandler<T> } {
  const el = React.useRef<T | null>(null)
  const items = () => [...(el.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])]
  const rove = (to: HTMLElement | null) => { for (const it of items()) it.tabIndex = it === to ? 0 : -1 }
  React.useLayoutEffect(() => {
    const list = items()
    if (!list.length) return
    const active = list.find(it => it === document.activeElement)
    if (active) { rove(active); return }
    if (list.some(it => it.tabIndex === 0)) return
    rove(list.find(it => it.getAttribute('aria-selected') === 'true') ?? list[0]!)
  })
  const ref = React.useCallback((node: T | null) => { el.current = node }, [])
  const onFocus: React.FocusEventHandler<T> = e => { const it = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]'); if (it) rove(it) }
  const onKeyDown: React.KeyboardEventHandler<T> = e => {
    const cur = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
    if (!cur || e.target !== cur) return
    const list = items()
    const i = list.indexOf(cur)
    const level = Number(cur.getAttribute('aria-level') ?? 1)
    const go = (to: HTMLElement | undefined) => { if (to) { rove(to); to.focus() } }
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    switch (e.key) {
      case 'ArrowDown': handled(); go(list[i + 1]); break
      case 'ArrowUp': handled(); go(list[i - 1]); break
      case 'Home': handled(); go(list[0]); break
      case 'End': handled(); go(list[list.length - 1]); break
      case 'ArrowRight':
        handled()
        if (cur.getAttribute('aria-expanded') === 'false') cur.querySelector<HTMLElement>('[data-tree-toggle]')?.click()
        else if (cur.getAttribute('aria-expanded') === 'true') { const next = list[i + 1]; if (next && Number(next.getAttribute('aria-level') ?? 1) > level) go(next) }
        break
      case 'ArrowLeft':
        handled()
        if (cur.getAttribute('aria-expanded') === 'true') cur.querySelector<HTMLElement>('[data-tree-toggle]')?.click()
        else go(list.slice(0, i).reverse().find(it => Number(it.getAttribute('aria-level') ?? 1) < level))
        break
      case 'Enter': case ' ': handled(); cur.click(); break
      case 'ContextMenu': case 'F10':
        keyboardContextMenu({ key: e.key, shiftKey: e.shiftKey, currentTarget: cur, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() })
        break
    }
  }
  return { ref, onKeyDown, onFocus }
}

/** Tag (design-system Tag): plain, removable, AI (dashed, adopt ✓ / remove ×), partial (n / m in a batch). */
export function TagChip({ text, ai, onRemove, onAdopt, count, partial, onClick, color }: {
  text: string; ai?: boolean; onRemove?: () => void; onAdopt?: () => void; count?: string; partial?: boolean; onClick?: () => void; color?: string
}) {
  return (
    <span
      onClick={onClick}
      title={ai ? t('insp.aiTag') : partial ? t('insp.addToAll') : undefined}
      className={cn(
        'inline-flex h-[22px] max-w-full shrink-0 items-center gap-1 rounded-full px-2 text-[12px] leading-4 whitespace-nowrap',
        ai ? 'border border-dashed border-line-control bg-transparent pl-1.5 text-ink-2' : partial ? 'bg-transparent text-ink-2 shadow-[inset_0_0_0_1px_var(--line-hairline)]' : 'bg-fill-rest text-ink-1',
        onClick && 'cursor-default'
      )}
    >
      {color && <i className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />}
      {ai && <Icon name="sparkles" size={12} className="text-ink-2" />}
      <span className="truncate">{text}</span>
      {count && <small className="text-[11px] tabular-nums text-ink-3">{count}</small>}
      {onAdopt && (
        <button type="button" aria-label={t('insp.adoptTag', { tag: text })} onClick={e => { e.stopPropagation(); onAdopt() }}
          className="grid size-4 shrink-0 cursor-default place-items-center rounded-full border-0 bg-transparent p-0 text-ink-2 hover:bg-accent-fill hover:text-accent-on active:scale-90">
          <Icon name="check" size={12} />
        </button>
      )}
      {onRemove && (
        <button type="button" aria-label={t('insp.removeTag', { tag: text })} onClick={e => { e.stopPropagation(); onRemove() }}
          className="-mr-1 grid size-4 shrink-0 cursor-default place-items-center rounded-full border-0 bg-transparent p-0 text-ink-2 hover:bg-fill-hover hover:text-ink-1 active:scale-90">
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  )
}

/** Inline tag input (prototype .taginput): Enter adds, Esc leaves. */
export function TagInput({ placeholder, onAdd, label, autoFocus }: { placeholder: string; onAdd: (tag: string) => void; label?: string; autoFocus?: boolean }) {
  const [v, setV] = React.useState('')
  return (
    <input
      value={v}
      autoFocus={autoFocus}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV('') }
        if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
      }}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      className="h-[22px] w-[72px] border-0 bg-transparent px-1 text-[12px] text-ink-1 outline-none placeholder:text-ink-3"
    />
  )
}

/** Filter chip (prototype .fchip): toggles a condition; optional facet count. */
export function FilterChip({ pressed, onClick, children, count }: { pressed: boolean; onClick: () => void; children: React.ReactNode; count?: number | null }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-[22px] shrink-0 cursor-default items-center gap-1 whitespace-nowrap rounded-xs border-0 px-2 text-[12px] leading-4 outline-none transition-[background-color,transform] duration-fade ease-out-bb active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring',
        pressed ? 'bg-accent-soft text-ink-1 shadow-[inset_0_0_0_1px_var(--accent-ring)]' : 'bg-fill-rest text-ink-2 hover:bg-fill-hover hover:text-ink-1'
      )}
    >
      {children}
      {count != null && <span className={cn('ml-1 text-[11px] tabular-nums', pressed ? 'opacity-70' : 'text-ink-3')}>{count.toLocaleString('en-US')}</span>}
    </button>
  )
}

/** Text field with a leading icon and trailing content (design-system TextField with icon / shortcut hint). */
export const Field = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: string; trailing?: React.ReactNode; leading?: React.ReactNode; invalid?: boolean; wrapClassName?: string }>(
  function Field({ icon, trailing, leading, invalid, wrapClassName, className, ...rest }, ref) {
    return (
      <div
        data-invalid={invalid || undefined}
        className={cn(
          'flex h-7 min-w-0 cursor-text items-center gap-1.5 rounded-sm bg-fill-rest px-2 text-ink-1 transition-colors duration-fade ease-out-bb hover:bg-fill-hover focus-within:bg-fill-rest focus-within:outline-2 focus-within:outline-accent-ring data-[invalid]:shadow-[inset_0_0_0_1px_var(--danger-ink)]',
          wrapClassName
        )}
      >
        {icon && <Icon name={icon} className="shrink-0 text-ink-2" />}
        {leading}
        <input ref={ref} className={cn('h-full min-w-12 flex-1 border-0 bg-transparent p-0 text-ink-1 outline-none placeholder:text-ink-3', className)} {...rest} />
        {trailing}
      </div>
    )
  }
)

/** A label above a form control (prototype .st__lab). */
export function FormLabel({ children, htmlFor, first }: { children: React.ReactNode; htmlFor?: string; first?: boolean }) {
  return <label htmlFor={htmlFor} className={cn('mb-1 block text-[12px] font-semibold text-ink-2', first ? 'mt-0' : 'mt-3')}>{children}</label>
}

/** Muted helper text under a control. */
export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('m-0 mt-1.5 text-[12px] leading-4 text-ink-3', className)}>{children}</p>
}
