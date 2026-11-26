/**
 * Geometry of the three layouts, for virtual scrolling (web-shell.md: only cells in view are rendered; 100,000
 * assets at 60 fps). Pure: the grid component measures its width and scroll position and asks which cells to draw.
 * Cell anatomy follows the design-system AssetCell: 6 px padding, square (or aspect) thumbnail, 4 px gap, 18 px name.
 */
export const GAP = 4
export const CELL_PAD = 6
export const NAME_H = 18
export const HIT_H = 17
export const LIST_ROW_H = 36
export const LIST_HEAD_H = 28

export interface GridGeom { cols: number; cellW: number; cellH: number; rows: number; height: number }

export function cellChrome(withHit: boolean): number { return CELL_PAD * 2 + GAP + NAME_H + (withHit ? HIT_H : 0) }

/** Uniform grid: `repeat(auto-fill, minmax(size, 1fr))`. */
export function gridGeom(width: number, size: number, count: number, withHit = false): GridGeom {
  const cols = Math.max(1, Math.floor((width + GAP) / (size + GAP)))
  const cellW = cols > 0 ? (width - GAP * (cols - 1)) / cols : width
  const cellH = cellW - CELL_PAD * 2 + cellChrome(withHit)
  const rows = Math.ceil(count / cols)
  const height = rows > 0 ? rows * cellH + (rows - 1) * GAP : 0
  return { cols, cellW, cellH, rows, height }
}

/** Index range [start, end) of cells to render for a scroll window (top-relative to the grid). */
export function gridRange(g: GridGeom, count: number, viewTop: number, viewHeight: number, overscanRows = 2): { start: number; end: number } {
  if (!count) return { start: 0, end: 0 }
  const stride = g.cellH + GAP
  const r0 = Math.max(0, Math.floor(viewTop / stride) - overscanRows)
  const r1 = Math.min(g.rows, Math.ceil((viewTop + viewHeight) / stride) + overscanRows)
  return { start: r0 * g.cols, end: Math.min(count, r1 * g.cols) }
}

export function gridCellPos(g: GridGeom, index: number): { left: number; top: number; width: number; height: number } {
  const r = Math.floor(index / g.cols), c = index % g.cols
  return { left: c * (g.cellW + GAP), top: r * (g.cellH + GAP), width: g.cellW, height: g.cellH }
}

export interface MasonryGeom { cols: number; colW: number; pos: Float64Array; height: number }

/**
 * Masonry: column width from the size slider; each next cell goes to the shortest column, so pages appended while
 * scrolling never move cells already placed. `aspects[i]` is w / h of the thumbnail (null → square).
 */
export function masonryGeom(width: number, size: number, aspects: ReadonlyArray<number | null | undefined>, withHit = false): MasonryGeom {
  const cols = Math.max(1, Math.floor((width + GAP) / (size + GAP)))
  const colW = (width - GAP * (cols - 1)) / cols
  const thumbW = colW - CELL_PAD * 2
  const chrome = cellChrome(withHit)
  const heights = new Float64Array(cols)
  const pos = new Float64Array(aspects.length * 4) // left, top, width, height
  for (let i = 0; i < aspects.length; i++) {
    let c = 0
    for (let k = 1; k < cols; k++) if (heights[k]! < heights[c]!) c = k
    const ar = clampAspect(aspects[i])
    const h = thumbW / ar + chrome
    pos[i * 4] = c * (colW + GAP)
    pos[i * 4 + 1] = heights[c]!
    pos[i * 4 + 2] = colW
    pos[i * 4 + 3] = h
    heights[c] = heights[c]! + h + GAP
  }
  let height = 0
  for (let k = 0; k < cols; k++) height = Math.max(height, heights[k]! - GAP)
  return { cols, colW, pos, height: Math.max(0, height) }
}

export function clampAspect(ar: number | null | undefined): number {
  if (!ar || !Number.isFinite(ar) || ar <= 0) return 1
  return Math.min(3, Math.max(1 / 3, ar))
}

/** Indices of masonry cells that intersect the window (cells are sorted by top within a column, not globally). */
export function masonryVisible(m: MasonryGeom, viewTop: number, viewHeight: number, overscan = 400): number[] {
  const out: number[] = []
  const lo = viewTop - overscan, hi = viewTop + viewHeight + overscan
  const n = m.pos.length / 4
  for (let i = 0; i < n; i++) {
    const top = m.pos[i * 4 + 1]!, h = m.pos[i * 4 + 3]!
    if (top < hi && top + h > lo) out.push(i)
  }
  return out
}

export function listRange(count: number, viewTop: number, viewHeight: number, overscan = 8): { start: number; end: number } {
  const start = Math.max(0, Math.floor(viewTop / LIST_ROW_H) - overscan)
  const end = Math.min(count, Math.ceil((viewTop + viewHeight) / LIST_ROW_H) + overscan)
  return { start, end: Math.max(start, end) }
}

/**
 * List columns that fit `width` (the list's own width): a narrow list (a small window, the inspector open) leaves out
 * the least needed of the chosen columns — technical info, format (the name says it), modified, size, tags, review,
 * stage — rather than run past the edge where they are cut off; the name always stays. `min` gives each column's
 * least width in px; a percentage column is measured against `width`. The chosen set itself is not changed.
 */
export const LIST_DROP_ORDER = ['tech', 'format', 'modified', 'size', 'tags', 'review', 'stage'] as const
export function fitListColumns(chosen: readonly string[], width: number, min: (id: string, width: number) => number, extra = 0): string[] {
  const cols = [...chosen]
  const need = () => cols.reduce((s, c) => s + min(c, width), extra)
  if (!(width > 0)) return cols
  for (const d of LIST_DROP_ORDER) {
    if (need() <= width) break
    const i = cols.indexOf(d)
    if (i >= 0) cols.splice(i, 1)
  }
  return cols
}
