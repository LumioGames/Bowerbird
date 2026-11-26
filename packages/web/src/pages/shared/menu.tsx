import * as React from 'react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger
} from '@bowerbird/plugin-sdk/web'
import { Icon } from '../../components/Icon'

/**
 * Dropdown menu in the design-system look (components.md ContextMenu): items with icon, check, shortcut text,
 * section labels, separators and one level of sub menus. Built on plugin-sdk's DropdownMenu (Radix).
 */
export type MenuEntry =
  | { kind?: 'item'; label: React.ReactNode; icon?: string; check?: boolean; kbd?: React.ReactNode; disabled?: boolean; danger?: boolean; onSelect(): void; sub?: undefined }
  | { kind?: 'item'; label: React.ReactNode; icon?: string; check?: boolean; sub: MenuEntry[]; kbd?: undefined; disabled?: boolean; danger?: undefined; onSelect?: undefined }
  | { kind: 'label'; label: React.ReactNode }
  | { kind: 'sep' }

function Entries({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === 'sep') return <DropdownMenuSeparator key={i} className="w2-menu__sep" />
        if (it.kind === 'label') return <DropdownMenuLabel key={i} className="w2-menu__label">{it.label}</DropdownMenuLabel>
        const lead = it.check !== undefined
          ? <span className="w2-menu__check">{it.check ? <Icon name="check" /> : null}</span>
          : it.icon ? <Icon name={it.icon} /> : null
        if (it.sub) {
          return (
            <DropdownMenuSub key={i}>
              <DropdownMenuSubTrigger className="w2-menu__item" disabled={it.disabled}>{lead}<span>{it.label}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w2-menu"><Entries items={it.sub} /></DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }
        return (
          <DropdownMenuItem key={i} className={it.danger ? 'w2-menu__item w2-menu__item--danger' : 'w2-menu__item'} disabled={it.disabled} onSelect={() => it.onSelect()}>
            {lead}<span>{it.label}</span>{it.kbd != null && <span className="w2-menu__kbd">{it.kbd}</span>}
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

/** A trigger element plus its menu. `items` may be a function so the list is built when opened. */
export function Menu({ trigger, items, align = 'start', open, onOpenChange }: {
  trigger: React.ReactElement
  items: MenuEntry[] | (() => MenuEntry[])
  align?: 'start' | 'center' | 'end'
  open?: boolean
  onOpenChange?(open: boolean): void
}) {
  const [inner, setInner] = React.useState(false)
  const isOpen = open ?? inner
  const set = (o: boolean) => { setInner(o); onOpenChange?.(o) }
  return (
    <DropdownMenu open={isOpen} onOpenChange={set} modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      {isOpen && (
        <DropdownMenuContent className="w2-menu" align={align} sideOffset={4}>
          <Entries items={typeof items === 'function' ? items() : items} />
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}

/**
 * A menu opened at a point (e.g. after dragging a link in the graph). Renders an invisible anchor at (x, y)
 * inside a positioned container.
 */
export function PointMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuEntry[]; onClose(): void }) {
  return (
    <DropdownMenu open onOpenChange={o => { if (!o) onClose() }} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden style={{ position: 'absolute', left: at.x, top: at.y, width: 1, height: 1, pointerEvents: 'none' }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w2-menu" align="start" sideOffset={2}>
        <Entries items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
