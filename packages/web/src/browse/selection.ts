/**
 * Selection in the grid (web-shell.md「选择与操作」): click selects one, ⌘/Ctrl toggles, ⇧ selects a range from the
 * anchor, dragging on empty space draws a marquee (⌘/⇧ adds to what was selected), arrows move.
 * Pure functions over the ordered list of ids currently shown.
 */
export interface Selection {
  ids: string[]
  /** Where a ⇧-range starts. */
  anchor: string | null
  /** The keyboard focus (Space / Enter / arrows act on it). */
  focus: string | null
}

export const NO_SELECTION: Selection = { ids: [], anchor: null, focus: null }

export type ClickMode = 'one' | 'toggle' | 'range'

export function clickMode(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, mac: boolean): ClickMode {
  if (e.shiftKey) return 'range'
  return (mac ? e.metaKey : e.ctrlKey) ? 'toggle' : 'one'
}

export function select(sel: Selection, order: readonly string[], id: string, mode: ClickMode): Selection {
  if (mode === 'toggle') {
    const has = sel.ids.includes(id)
    return { ids: has ? sel.ids.filter(x => x !== id) : [...sel.ids, id], anchor: id, focus: id }
  }
  if (mode === 'range' && sel.anchor) {
    const a = order.indexOf(sel.anchor), b = order.indexOf(id)
    if (a >= 0 && b >= 0) return { ids: order.slice(Math.min(a, b), Math.max(a, b) + 1), anchor: sel.anchor, focus: id }
  }
  return { ids: [id], anchor: id, focus: id }
}

export function selectAll(order: readonly string[], sel: Selection): Selection {
  return { ids: [...order], anchor: sel.anchor ?? order[0] ?? null, focus: sel.focus ?? order[0] ?? null }
}

export interface Rect { left: number; top: number; right: number; bottom: number }
export function intersects(a: Rect, b: Rect): boolean { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top }

/** Marquee: the cells under the box, added to `base` (what was selected when the drag began with ⌘ / ⇧). */
export function marquee(base: readonly string[], box: Rect, cells: ReadonlyArray<{ id: string; rect: Rect }>): string[] {
  const out = [...base]
  for (const c of cells) if (intersects(box, c.rect) && !out.includes(c.id)) out.push(c.id)
  return out
}

export type Dir = 'left' | 'right' | 'up' | 'down'

/**
 * Arrow keys. With positions (masonry, any layout) up/down pick the nearest cell straight above / below;
 * without them a fixed column count is used (grid), and a list moves by one either way.
 */
export function moveFocus(order: readonly string[], focus: string | null, dir: Dir, layout: { cols: number } | { rects: Map<string, Rect> }): string | null {
  if (!order.length) return null
  const i = focus ? order.indexOf(focus) : -1
  if (i < 0) return order[0]!
  if (dir === 'left') return order[Math.max(0, i - 1)]!
  if (dir === 'right') return order[Math.min(order.length - 1, i + 1)]!
  if ('cols' in layout) {
    const j = dir === 'down' ? i + layout.cols : i - layout.cols
    if (j < 0) return order[i]!
    return order[Math.min(order.length - 1, j)]!
  }
  const cur = layout.rects.get(focus!)
  if (!cur) return order[i]!
  const cx = (cur.left + cur.right) / 2
  let best: string | null = null, score = Infinity
  for (const id of order) {
    if (id === focus) continue
    const r = layout.rects.get(id)
    if (!r) continue
    const dy = dir === 'down' ? r.top - cur.bottom : cur.top - r.bottom
    if (dy < -4) continue
    const s = Math.abs((r.left + r.right) / 2 - cx) * 2 + dy
    if (s < score) { score = s; best = id }
  }
  return best ?? order[i]!
}

/** Keep only ids still shown, e.g. after a filter change; the anchor / focus follow. */
export function prune(sel: Selection, order: readonly string[]): Selection {
  const set = new Set(order)
  const ids = sel.ids.filter(x => set.has(x))
  if (ids.length === sel.ids.length) return sel
  return { ids, anchor: sel.anchor && set.has(sel.anchor) ? sel.anchor : ids[0] ?? null, focus: sel.focus && set.has(sel.focus) ? sel.focus : ids[0] ?? null }
}
