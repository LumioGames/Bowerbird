/**
 * A model against a turnaround sheet (builtin-plugins.md「模型对照四视图」, ADR-019): the sheet's views come from
 * the grid declared in its .bmeta, never from what the picture looks like. Inside a cell the plain margin is
 * trimmed so the drawn object can be framed. The model is rendered orthographically for the same view, bottom
 * and centre aligned, scaled to the same height (or width); what is left over is the proportion error. Pure.
 */
import type { ViewGrid } from '@bowerbird/schema'
import type { Axis, Size3, TargetSize } from '../../shared/size.js'
import { sizeMatches } from '../../shared/size.js'
import { zh, type T } from '../i18n'

export type ViewKey = 'front' | 'side' | 'back' | 'top'
export const VIEW_ORDER: ViewKey[] = ['front', 'side', 'back', 'top']
/** 正 / 侧 / 背 / 顶 in the given language. */
export function viewLabel(k: ViewKey, tr: T = zh): string { return tr(`view.${k}`) }

/** x, y (top-left), w, h — normalised to the image, or in pixels where noted. */
export interface Rect { x: number; y: number; w: number; h: number }

/** Grid cells by view, normalised to the image; null when the image declares no grid or no view cell. */
export function cellsOf(grid: ViewGrid | null | undefined): Partial<Record<ViewKey, Rect>> | null {
  if (!grid) return null
  const out: Partial<Record<ViewKey, Rect>> = {}
  grid.cells.forEach((k, i) => {
    if (!k || out[k]) return
    const r = Math.floor(i / grid.cols), c = i % grid.cols
    out[k] = { x: c / grid.cols, y: r / grid.rows, w: 1 / grid.cols, h: 1 / grid.rows }
  })
  return Object.keys(out).length ? out : null
}

/**
 * The drawn extent inside a cell, by the same rule as the image viewer's turnaround grid (plugins/image
 * `drawnExtent`), so both measure the same figure: the background is the colour most of the cell's four corners
 * agree on (each corner inset up to 2 px to step over grid lines); the figure is the bounding box of pixels that
 * differ from it by more than `tolerance` in any channel. `data` is RGBA of a `w × h` raster of the whole image.
 * Null when the cell is blank (callers fall back to the cell inset by 10 %).
 */
export function trimCell(data: ArrayLike<number>, w: number, h: number, cell: Rect, tolerance = 28): Rect | null {
  const box = cellBox(w, h, cell)
  if (!box) return null
  const { x0, y0, x1, y1 } = box
  const bg = backgroundAt(data, w, box, tolerance)
  const diff = (p: number, q: number) => Math.max(Math.abs(data[p]! - data[q]!), Math.abs(data[p + 1]! - data[q + 1]!), Math.abs(data[p + 2]! - data[q + 2]!), Math.abs(data[p + 3]! - data[q + 3]!))
  let nx = x1, ny = y1, mx = x0, my = y0, hit = false
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (diff((y * w + x) * 4, bg) > tolerance) { hit = true; if (x < nx) nx = x; if (x > mx) mx = x; if (y < ny) ny = y; if (y > my) my = y }
  }
  return hit ? { x: nx / w, y: ny / h, w: (mx - nx + 1) / w, h: (my - ny + 1) / h } : null
}

/** A cell in raster pixels (inclusive), or null when it has none. */
function cellBox(w: number, h: number, cell: Rect): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(0, Math.round(cell.x * w)), y0 = Math.max(0, Math.round(cell.y * h))
  const x1 = Math.min(w - 1, Math.round((cell.x + cell.w) * w) - 1), y1 = Math.min(h - 1, Math.round((cell.y + cell.h) * h) - 1)
  return x1 < x0 || y1 < y0 ? null : { x0, y0, x1, y1 }
}

/** Offset of the background pixel: the corner colour most of the four corners agree on (inset up to 2 px). */
function backgroundAt(data: ArrayLike<number>, w: number, { x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }, tolerance: number): number {
  const ix = Math.min(2, Math.floor((x1 - x0) / 4)), iy = Math.min(2, Math.floor((y1 - y0) / 4))
  const corners = [[x0 + ix, y0 + iy], [x1 - ix, y0 + iy], [x0 + ix, y1 - iy], [x1 - ix, y1 - iy]].map(([x, y]) => (y! * w + x!) * 4)
  const diff = (p: number, q: number) => Math.max(Math.abs(data[p]! - data[q]!), Math.abs(data[p + 1]! - data[q + 1]!), Math.abs(data[p + 2]! - data[q + 2]!), Math.abs(data[p + 3]! - data[q + 3]!))
  let bg = corners[0]!, best = -1
  for (const c of corners) {
    const n = corners.filter(o => diff(c, o) <= tolerance).length
    if (n > best) { best = n; bg = c }
  }
  return bg
}

/**
 * The sheet's paper colour in a cell (the background `trimCell` measures against), as CSS: the compare stage
 * continues it around the cell, so the view reads as one picture while its neighbours stay hidden.
 */
export function cellPaper(data: ArrayLike<number>, w: number, h: number, cell: Rect, tolerance = 28): string | null {
  const box = cellBox(w, h, cell)
  if (!box) return null
  const p = backgroundAt(data, w, box, tolerance)
  return `rgb(${data[p]} ${data[p + 1]} ${data[p + 2]} / ${Math.round((data[p + 3]! / 255) * 100) / 100})`
}

/** The raster `trimCell` measures on: the image viewer's (long edge at most 480 px, never enlarged). */
export function measureRaster(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, 480 / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

export interface SheetView { key: ViewKey; label: string; cell: Rect; drawn: Rect }

/** Each view of the sheet: its cell and its drawn extent (trimmed, or the cell inset by 10 % until trimmed). */
export function sheetViews(grid: ViewGrid | null | undefined, trims: Partial<Record<ViewKey, Rect | null>> = {}, tr: T = zh): Partial<Record<ViewKey, SheetView>> | null {
  const cells = cellsOf(grid)
  if (!cells) return null
  const out: Partial<Record<ViewKey, SheetView>> = {}
  for (const key of VIEW_ORDER) {
    const c = cells[key]
    if (!c) continue
    const pad = 0.1
    const drawn = trims[key] ?? { x: c.x + c.w * pad, y: c.y + c.h * pad, w: c.w * (1 - 2 * pad), h: c.h * (1 - 2 * pad) }
    out[key] = { key, label: viewLabel(key, tr), cell: c, drawn }
  }
  return out
}

/** Camera direction (where the camera sits, from the model) and up vector for each orthographic view. */
export const VIEW_DIR: Record<ViewKey, { dir: [number, number, number]; up: [number, number, number] }> = {
  front: { dir: [0, 0, 1], up: [0, 1, 0] },
  side: { dir: [1, 0, 0], up: [0, 1, 0] },
  back: { dir: [0, 0, -1], up: [0, 1, 0] },
  top: { dir: [0, 1, 0], up: [0, 0, -1] }
}

/** Screen right and up of a view's camera, in model axes. */
export function viewBasis(view: ViewKey): { right: [number, number, number]; up: [number, number, number] } {
  const { dir, up } = VIEW_DIR[view]
  const f: [number, number, number] = [-dir[0], -dir[1], -dir[2]]
  const z = (v: number) => v + 0 // no signed zeros
  const right: [number, number, number] = [z(f[1] * up[2] - f[2] * up[1]), z(f[2] * up[0] - f[0] * up[2]), z(f[0] * up[1] - f[1] * up[0])]
  return { right, up }
}

/** The bounding box's extent on screen for a view: horizontal and vertical min/max in metres. */
export function viewExtent(min: [number, number, number], max: [number, number, number], view: ViewKey): { nx: number; xx: number; ny: number; xy: number } {
  const { right, up } = viewBasis(view)
  let nx = Infinity, xx = -Infinity, ny = Infinity, xy = -Infinity
  for (let k = 0; k < 8; k++) {
    const p = [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]
    const sx = p[0]! * right[0] + p[1]! * right[1] + p[2]! * right[2]
    const sy = p[0]! * up[0] + p[1]! * up[1] + p[2]! * up[2]
    nx = Math.min(nx, sx); xx = Math.max(xx, sx); ny = Math.min(ny, sy); xy = Math.max(xy, sy)
  }
  return { nx, xx, ny, xy }
}

export type FitBy = 'h' | 'w'

/**
 * Orthographic frustum that puts the model on the drawn rect `R` (pane pixels) of a `W × H` pane: bottom edges and
 * centres aligned, scaled so heights (or widths) match. Returns the frustum in camera space and the model's rect.
 */
export function orthoFit(R: Rect, ext: { nx: number; xx: number; ny: number; xy: number }, W: number, H: number, fitBy: FitBy = 'h') {
  const mw = Math.max(1e-6, ext.xx - ext.nx), mh = Math.max(1e-6, ext.xy - ext.ny)
  const ppm = fitBy === 'w' ? R.w / mw : R.h / mh
  const left = (ext.nx + ext.xx) / 2 - (R.x + R.w / 2) / ppm
  const top = ext.ny + (R.y + R.h) / ppm
  return {
    left, right: left + W / ppm, top, bottom: top - H / ppm, ppm,
    modelRect: { x: R.x + R.w / 2 - (mw * ppm) / 2, y: R.y + R.h - mh * ppm, w: mw * ppm, h: mh * ppm },
    model: { w: mw, h: mh }
  }
}

/** Width-to-height of the model against the drawing: deviation, whether over 5 % (marked), and the label. */
export function aspectDeviation(modelAspect: number, drawnAspect: number, tr: T = zh): { dev: number; bad: boolean; label: string } {
  const dev = modelAspect / drawnAspect - 1
  const bad = Math.abs(dev) > 0.05
  const label = Math.abs(dev) < 0.005 ? tr('same') : (dev > 0 ? '+' : '−') + Math.abs(dev * 100).toFixed(1) + '%'
  return { dev, bad, label }
}

/** Target axes each view shows: horizontal, vertical. */
export const VIEW_AXES: Record<ViewKey, [Axis, Axis]> = { front: ['w', 'h'], side: ['d', 'h'], back: ['w', 'h'], top: ['w', 'd'] }
export function axisName(a: Axis, tr: T = zh): string { return tr(`axis.${a}`) }

/** The model's own horizontal × vertical for a view (from its box size). */
export function modelViewSize(size: Size3, view: ViewKey): [number, number] {
  switch (view) {
    case 'side': return [size.z, size.y]
    case 'top': return [size.x, size.z]
    default: return [size.x, size.y]
  }
}

export interface Implied { axis: Axis; measured: number; target: number; ok: boolean }

/**
 * What each drawn view measures, with the sheet's scale taken from the front view's width = target width
 * (the dimension lines drawn on the sheet; an overlay, never written into the image).
 */
export function impliedSizes(views: Partial<Record<ViewKey, SheetView>> | null, imgW: number, imgH: number, target: TargetSize | null): Partial<Record<ViewKey, [Implied, Implied]>> | null {
  const front = views?.front
  if (!views || !front || !target || front.drawn.w <= 0) return null
  const mpp = target.w / (front.drawn.w * imgW)
  const out: Partial<Record<ViewKey, [Implied, Implied]>> = {}
  for (const key of VIEW_ORDER) {
    const v = views[key]
    if (!v) continue
    const [ah, av] = VIEW_AXES[key]
    const mh = v.drawn.w * imgW * mpp, mv = v.drawn.h * imgH * mpp
    out[key] = [
      { axis: ah, measured: mh, target: target[ah], ok: sizeMatches(mh, target[ah]) },
      { axis: av, measured: mv, target: target[av], ok: sizeMatches(mv, target[av]) }
    ]
  }
  return out
}
