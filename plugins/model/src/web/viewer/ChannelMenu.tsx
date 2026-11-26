/**
 * The channel menu (prototype channelMenu, builtin-plugins.md「通道菜单」): 材质通道 then 检查视图. Colour channels
 * open a component submenu (the row itself picks 全部); vertex colours pick the set first when there are
 * several; 粗糙度 / 金属度 / 遮蔽 show the packed texture and component (「ORM · G」). A channel the file cannot
 * show stays clickable and says「这个格式不支持」(ADR-022).
 */
import * as React from 'react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, useUnsupportedToast
} from '@bowerbird/plugin-sdk/web'
import {
  CHECK_VIEWS, COMPONENTS, MATERIAL_CHANNELS, channelKey, channelLabel, compLabel, parseChannel, unreadable, type ChannelBase, type ModelCaps
} from '../lib/channels'
import { Icon } from '../icons'
import { useT } from '../i18n'

function Check({ on }: { on: boolean }) {
  return <span className="inline-grid w-4 shrink-0 place-items-center">{on && <Icon name="check" size={14} />}</span>
}

export function ChannelMenu({ value, caps, onPick, children, align = 'start' }: {
  value: string
  caps: ModelCaps
  onPick(key: string): void
  children: React.ReactElement
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = React.useState(false)
  const unsupported = useUnsupportedToast()
  const tr = useT()
  const cur = parseChannel(value)
  const choose = (key: string) => {
    setOpen(false)
    if (unreadable(key, caps)) { unsupported(); return }
    onPick(key)
  }

  const comps = (base: ChannelBase, set: number) => (COMPONENTS[base] ?? []).map(([comp]) => {
    const key = channelKey({ base, comp, set })
    return (
      <DropdownMenuItem key={key} onSelect={() => choose(key)}>
        <Check on={value === key} />{compLabel(base, comp, tr)}
      </DropdownMenuItem>
    )
  })

  const item = (base: ChannelBase) => {
    const name = channelLabel(base, tr)
    const on = cur.base === base
    if (base === 'vcol') {
      if (caps.vcolSets === 0) {
        return (
          <DropdownMenuItem key={base} onSelect={() => choose('vcol')}>
            <Check on={on} />{name}<DropdownMenuShortcut>{tr('none')}</DropdownMenuShortcut>
          </DropdownMenuItem>
        )
      }
      return (
        <DropdownMenuSub key={base}>
          <DropdownMenuSubTrigger onClick={() => choose(channelKey({ base, comp: '', set: on ? cur.set : 0 }))}>
            <Check on={on} />{name}
            {on && (cur.comp || caps.vcolSets > 1) && <span className="ml-auto pl-3 text-xs text-ink-3">{[caps.vcolSets > 1 ? `COLOR_${cur.set}` : '', cur.comp ? compLabel('vcol', cur.comp, tr) : ''].filter(Boolean).join(' · ')}</span>}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {caps.vcolSets > 1
              ? Array.from({ length: caps.vcolSets }, (_, set) => (
                <DropdownMenuSub key={set}>
                  <DropdownMenuSubTrigger onClick={() => choose(channelKey({ base, comp: '', set }))}>
                    <Check on={on && cur.set === set} />COLOR_{set}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>{comps('vcol', set)}</DropdownMenuSubContent>
                </DropdownMenuSub>
              ))
              : comps('vcol', 0)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    if (COMPONENTS[base]) {
      return (
        <DropdownMenuSub key={base}>
          <DropdownMenuSubTrigger onClick={() => choose(base)}>
            <Check on={on} />{name}
            {on && cur.comp && <span className="ml-auto pl-3 text-xs text-ink-3">{compLabel(base, cur.comp, tr)}</span>}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>{comps(base, 0)}</DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    const packed = (base === 'rough' || base === 'metal' || base === 'ao') && !unreadable(base, caps) ? caps.packed[base] : undefined
    return (
      <DropdownMenuItem key={base} onSelect={() => choose(base)}>
        <Check on={on} />{name}{packed && <DropdownMenuShortcut>{packed}</DropdownMenuShortcut>}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44">
        <DropdownMenuLabel className="text-xs text-ink-3">{tr('menuMaterial')}</DropdownMenuLabel>
        {MATERIAL_CHANNELS.map(item)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-ink-3">{tr('menuChecks')}</DropdownMenuLabel>
        {CHECK_VIEWS.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
