import * as React from 'react'
import {
  ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger
} from '@bowerbird/plugin-sdk/web'
import { Icon } from '../components/Icon'

/**
 * Menus built from a list (design-system ContextMenu): group labels, checks, shortcuts, sub menus.
 * A sub menu opens 60 ms after the pointer rests on its row and closes 180 ms after it leaves (web-shell.md);
 * a row can have both a sub menu and its own action: click runs the action, hovering opens the sub menu.
 */
export type MenuEntry =
  | 'sep'
  | { header: React.ReactNode }
  | {
      id: string
      label: React.ReactNode
      icon?: string
      /** Shortcut shown at the right. */
      kbd?: string
      /** Text at the right of a sub-menu row (the current value, e.g. the stage). */
      hint?: React.ReactNode
      /** null: no check column; true/false: a check column. */
      check?: boolean | null
      danger?: boolean
      disabled?: boolean
      title?: string
      onSelect?: () => void
      sub?: MenuEntry[]
    }

export const SUB_OPEN_MS = 60
export const SUB_CLOSE_MS = 180

type Kind = 'context' | 'dropdown'
const C = {
  context: { Item: ContextMenuItem, Label: ContextMenuLabel, Sep: ContextMenuSeparator, Shortcut: ContextMenuShortcut, Sub: ContextMenuSub, SubContent: ContextMenuSubContent, SubTrigger: ContextMenuSubTrigger },
  dropdown: { Item: DropdownMenuItem, Label: DropdownMenuLabel, Sep: DropdownMenuSeparator, Shortcut: DropdownMenuShortcut, Sub: DropdownMenuSub, SubContent: DropdownMenuSubContent, SubTrigger: DropdownMenuSubTrigger }
} as const

/** Drop separators at the ends and doubled ones (entries that were filtered out leave holes). */
export function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of entries) {
    if (e === 'sep' && (!out.length || out[out.length - 1] === 'sep')) continue
    out.push(e)
  }
  while (out[out.length - 1] === 'sep') out.pop()
  return out
}

function Check({ on }: { on: boolean }) { return <span className="inline-flex w-4 shrink-0 text-ink-1">{on && <Icon name="check" />}</span> }

function HoverSub({ kind, entry, close }: { kind: Kind; entry: Extract<MenuEntry, { id: string }>; close: () => void }) {
  const K = C[kind]
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const inContent = React.useRef(false)
  const schedule = (v: boolean, ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (!v && inContent.current) return; setOpen(v) }, ms)
  }
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <K.Sub open={open} onOpenChange={v => schedule(v, v ? SUB_OPEN_MS : SUB_CLOSE_MS)}>
      <K.SubTrigger
        disabled={entry.disabled}
        onPointerEnter={() => schedule(true, SUB_OPEN_MS)}
        onPointerLeave={() => schedule(false, SUB_CLOSE_MS)}
        onClick={entry.onSelect ? e => { e.preventDefault(); entry.onSelect!(); close() } : undefined}
      >
        {entry.check != null && <Check on={entry.check} />}
        {entry.icon && <Icon name={entry.icon} />}
        <span className="min-w-0 truncate">{entry.label}</span>
        {entry.hint != null && <K.Shortcut className="font-sans text-[12px]">{entry.hint}</K.Shortcut>}
      </K.SubTrigger>
      <K.SubContent
        sideOffset={2}
        onPointerEnter={() => { inContent.current = true; if (timer.current) clearTimeout(timer.current) }}
        onPointerLeave={() => { inContent.current = false; schedule(false, SUB_CLOSE_MS) }}
      >
        <MenuEntries kind={kind} entries={entry.sub!} close={close} />
      </K.SubContent>
    </K.Sub>
  )
}

export function MenuEntries({ kind, entries, close }: { kind: Kind; entries: MenuEntry[]; close: () => void }) {
  const K = C[kind]
  return (
    <>
      {tidy(entries).map((e, i) => {
        if (e === 'sep') return <K.Sep key={`s${i}`} />
        if ('header' in e) return <K.Label key={`h${i}`}>{e.header}</K.Label>
        if (e.sub) return <HoverSub key={e.id} kind={kind} entry={e} close={close} />
        return (
          <K.Item key={e.id} disabled={e.disabled} variant={e.danger ? 'danger' : 'default'} title={e.title} onSelect={() => e.onSelect?.()} data-entry={e.id}>
            {e.check != null && <Check on={e.check} />}
            {e.icon && <Icon name={e.icon} />}
            <span className="min-w-0 truncate">{e.label}</span>
            {e.kbd && <K.Shortcut>{e.kbd}</K.Shortcut>}
            {e.hint != null && !e.kbd && <K.Shortcut className="font-sans text-[12px]">{e.hint}</K.Shortcut>}
          </K.Item>
        )
      })}
    </>
  )
}
