/**
 * Turnaround sheets (ADR-019): one image laid out on a fixed grid; `views` in the .bmeta says which cell is which
 * view. Everything here works from that grid only — the plugin never guesses views from the picture.
 * Pure and shared by the server (summary) and the viewer (view switch, dimension lines).
 */
export type ViewName = 'front' | 'side' | 'back' | 'top'
export interface ViewGridLike { rows: number; cols: number; cells: Array<ViewName | null> }

export const VIEW_ORDER: readonly ViewName[] = ['front', 'side', 'back', 'top']
/** Short labels for the view switch (copy.md「四视图」: 整图 · 正 · 侧 · 背 · 顶). */
export const VIEW_SHORT: Readonly<Record<ViewName, string>> = { front: '正', side: '侧', back: '背', top: '顶' }
export const VIEW_LONG: Readonly<Record<ViewName, string>> = { front: '正面', side: '侧面', back: '背面', top: '顶面' }

/** Which target-size axes a view shows: front w×h, side d×h, top w×d (builtin-plugins.md「尺寸线」); back as front. */
export const VIEW_AXES: Readonly<Record<ViewName, readonly ['w' | 'd', 'h' | 'd']>> = {
  front: ['w', 'h'], side: ['d', 'h'], back: ['w', 'h'], top: ['w', 'd']
}
export const AXIS_NAME: Readonly<Record<'w' | 'h' | 'd', string>> = { w: '宽', h: '高', d: '深' }

/** Normalised rectangle `[x, y, w, h]` in 0..1 of the whole sheet. */
export type NRect = [number, number, number, number]

/** The cell of `view`, or null when the grid does not have it. */
export function cellRect(grid: ViewGridLike, view: ViewName): NRect | null {
  const i = grid.cells.indexOf(view)
  if (i < 0 || grid.rows < 1 || grid.cols < 1) return null
  const r = Math.floor(i / grid.cols), c = i % grid.cols
  return [c / grid.cols, r / grid.rows, 1 / grid.cols, 1 / grid.rows]
}

/** Views present in the grid, in the fixed order 正 · 侧 · 背 · 顶. */
export function viewsOf(grid: ViewGridLike | null | undefined): ViewName[] {
  if (!grid) return []
  return VIEW_ORDER.filter(v => grid.cells.includes(v))
}

/** Pixel rectangle of a cell in an image of `w × h` (rounded to whole pixels, never empty). */
export function cellPixels(grid: ViewGridLike, view: ViewName, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const r = cellRect(grid, view)
  if (!r) return null
  const x0 = Math.round(r[0] * w), y0 = Math.round(r[1] * h)
  const x1 = Math.round((r[0] + r[2]) * w), y1 = Math.round((r[1] + r[3]) * h)
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/** `2 行 2 列 · 正面 侧面 / 背面 顶面` (copy.md「检查器的格子」). Empty cells read as「空」. */
export function describeGrid(grid: ViewGridLike): string {
  const rows: string[] = []
  for (let r = 0; r < grid.rows; r++) {
    const cells = grid.cells.slice(r * grid.cols, (r + 1) * grid.cols).map(v => (v ? VIEW_LONG[v] : '空'))
    rows.push(cells.join(' '))
  }
  return `${grid.rows} 行 ${grid.cols} 列 · ${rows.join(' / ')}`
}

/**
 * Where the drawing sits inside a cell: the bounding box of pixels that differ from the cell's corner colour
 * (the sheet background). Returns a normalised rect of the whole sheet; null when the cell is empty.
 * `rgba` is the whole sheet at `w × h`.
 */
export function drawnExtent(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, cell: NRect, tolerance = 28): NRect | null {
  const x0 = Math.max(0, Math.round(cell[0] * w)), y0 = Math.max(0, Math.round(cell[1] * h))
  const x1 = Math.min(w - 1, Math.round((cell[0] + cell[2]) * w) - 1), y1 = Math.min(h - 1, Math.round((cell[1] + cell[3]) * h) - 1)
  if (x1 < x0 || y1 < y0) return null
  // The background is the colour most corners agree on (inset a little to step over grid lines).
  const ix = Math.min(2, Math.floor((x1 - x0) / 4)), iy = Math.min(2, Math.floor((y1 - y0) / 4))
  const corners = [[x0 + ix, y0 + iy], [x1 - ix, y0 + iy], [x0 + ix, y1 - iy], [x1 - ix, y1 - iy]].map(([x, y]) => (y! * w + x!) * 4)
  const near = (p: number, q: number) => Math.max(Math.abs(rgba[p]! - rgba[q]!), Math.abs(rgba[p + 1]! - rgba[q + 1]!), Math.abs(rgba[p + 2]! - rgba[q + 2]!), Math.abs(rgba[p + 3]! - rgba[q + 3]!)) <= tolerance
  let bg = corners[0]!, best = -1
  for (const c of corners) { const n = corners.filter(o => near(c, o)).length; if (n > best) { best = n; bg = c } }
  let nx = x1, ny = y1, mx = x0, my = y0, hit = false
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * w + x) * 4
      const d = Math.max(Math.abs(rgba[p]! - rgba[bg]!), Math.abs(rgba[p + 1]! - rgba[bg + 1]!), Math.abs(rgba[p + 2]! - rgba[bg + 2]!), Math.abs(rgba[p + 3]! - rgba[bg + 3]!))
      if (d > tolerance) { hit = true; if (x < nx) nx = x; if (x > mx) mx = x; if (y < ny) ny = y; if (y > my) my = y }
    }
  }
  return hit ? [nx / w, ny / h, (mx - nx + 1) / w, (my - ny + 1) / h] : null
}

/** A cell shrunk by `pad` on each side: the fallback extent when the drawing cannot be measured. */
export function padded(cell: NRect, pad = 0.1): NRect {
  return [cell[0] + cell[2] * pad, cell[1] + cell[3] * pad, cell[2] * (1 - 2 * pad), cell[3] * (1 - 2 * pad)]
}

export interface DimensionLine {
  axis: 'w' | 'h' | 'd'
  /** Metres from the design object's target size. */
  metres: number
  /** `宽 1.26 m`. */
  label: string
  /** Horizontal line under the drawing, or vertical line on its right. */
  orientation: 'horizontal' | 'vertical'
}

/** The two dimension lines of a view (horizontal axis first), labelled from the target size. */
export function dimensionLines(view: ViewName, size: { w: number; h: number; d: number }): [DimensionLine, DimensionLine] {
  const [ha, va] = VIEW_AXES[view]
  const mk = (axis: 'w' | 'h' | 'd', orientation: DimensionLine['orientation']): DimensionLine => ({
    axis, metres: size[axis], orientation, label: `${AXIS_NAME[axis]} ${formatMetres(size[axis])} m`
  })
  return [mk(ha, 'horizontal'), mk(va, 'vertical')]
}

export function formatMetres(m: number): string { return (Math.round(m * 100) / 100).toFixed(2) }
