import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MenuEntry } from '../pages/shared/menu'
import { gid, summary } from '../pages/shared/test/fake'
import { linkMenu, type LinkMenuDeps } from './link-menu'

const concept = summary({ id: gid(1), name: 'chest_concept.png' })
const icon = summary({ id: gid(2), name: 'chest_icon.png' })
const text = (e: MenuEntry) => ('label' in e ? renderToStaticMarkup(<>{e.label}</>).replace(/<[^>]+>/g, '') : '')
const deps = (over: Partial<LinkMenuDeps> = {}): LinkMenuDeps => ({ wouldCycle: () => false, existing: [], onSource: vi.fn(), onAdd: vi.fn(), open: vi.fn(), ...over })
type Item = Extract<MenuEntry, { onSelect(): void }>

describe('link menu after dragging a link (graph.js)', () => {
  it('names the three relations as sentences; a source that would loop is disabled with the reason', () => {
    const m = linkMenu(concept, icon, { x: 10, y: 20 }, deps({ wouldCycle: (a, b) => a === concept.id && b === icon.id }))
    expect(m.map(text)).toEqual(['chest_concept.png 由 chest_icon.png 产出会形成循环', 'chest_concept.png 引用 chest_icon.png', 'chest_concept.png 属于 chest_icon.png', '', '对调方向'])
    expect(m.map(e => ('disabled' in e ? !!e.disabled : null))).toEqual([true, false, true, null, null])
  })

  it('对调方向 reopens the menu at the same place with the ends swapped (choosing an item closes the menu first)', () => {
    vi.useFakeTimers()
    try {
      const d = deps()
      const m = linkMenu(concept, icon, { x: 10, y: 20 }, d)
      ;(m[4] as Item).onSelect()
      expect(d.open).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(d.open).toHaveBeenCalledTimes(1)
      const shown = vi.mocked(d.open).mock.calls[0]![0]
      expect({ x: shown.x, y: shown.y }).toEqual({ x: 10, y: 20 })
      expect(text(shown.items[0]!)).toBe('chest_icon.png 由 chest_concept.png 产出')
      // and back again
      ;(shown.items[4] as Item).onSelect()
      vi.runAllTimers()
      expect(text(vi.mocked(d.open).mock.calls[1]![0].items[0]!)).toBe('chest_concept.png 由 chest_icon.png 产出')
    } finally { vi.useRealTimers() }
  })

  it('an existing relation is「已经有了」; choosing source / uses goes to the callbacks', () => {
    const d = deps({ existing: [{ type: 'uses', from: concept.id, to: icon.id }] })
    const m = linkMenu(concept, icon, { x: 0, y: 0 }, d)
    expect(text(m[1]!)).toBe('chest_concept.png 引用 chest_icon.png已经有了')
    ;(m[0] as Item).onSelect()
    expect(d.onSource).toHaveBeenCalledWith(concept, icon)
    ;(m[1] as Item).onSelect()
    expect(d.onAdd).toHaveBeenCalledWith('uses', concept, icon)
  })
})
