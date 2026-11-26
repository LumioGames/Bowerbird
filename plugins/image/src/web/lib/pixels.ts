/**
 * Pixel helpers for the image viewer and compare: the difference image, the browser size limit, zoom maths.
 * Pure (typed arrays in, typed arrays out) so they are unit-tested without a browser.
 */

/** Channel difference above which a pixel counts as different (0..255). */
export const DIFF_THRESHOLD = 22
/** Colour of differing pixels in the difference image. */
export const DIFF_MARK: readonly [number, number, number] = [255, 56, 150]

export interface DiffResult {
  /** RGBA difference image: differing pixels marked, the rest a dimmed grey copy of A. */
  image: Uint8ClampedArray
  /** Differing pixels. */
  differing: number
  /** Pixels where at least one side is visible (alpha ≥ 8); the base of the percentage. */
  area: number
  /** differing / area, 0..1. */
  ratio: number
}

/** Compare two RGBA buffers of the same size pixel by pixel (max channel difference, alpha included). */
export function diffPixels(a: ArrayLike<number>, b: ArrayLike<number>, threshold = DIFF_THRESHOLD): DiffResult {
  if (a.length !== b.length) throw new Error('diffPixels: buffers differ in size')
  const out = new Uint8ClampedArray(a.length)
  let differing = 0, area = 0
  for (let i = 0; i + 3 < a.length; i += 4) {
    const aa = a[i + 3]!, ab = b[i + 3]!
    if (aa < 8 && ab < 8) continue
    area++
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(aa - ab))
    if (d > threshold) {
      differing++
      out[i] = DIFF_MARK[0]; out[i + 1] = DIFF_MARK[1]; out[i + 2] = DIFF_MARK[2]; out[i + 3] = 255
    } else {
      const g = Math.round((a[i]! * 0.3 + a[i + 1]! * 0.59 + a[i + 2]! * 0.11) * 0.32 + 18)
      out[i] = out[i + 1] = out[i + 2] = g
      out[i + 3] = Math.max(aa, ab)
    }
  }
  return { image: out, differing, area, ratio: area ? differing / area : 0 }
}

/** Share of differing pixels as `12.3`, or null when nothing differs (the label is「不同 12.3%」/「没有差异」). */
export function diffPercent(r: Pick<DiffResult, 'differing' | 'area'>): string | null {
  return r.differing ? (r.differing / Math.max(1, r.area) * 100).toFixed(1) : null
}

/**
 * The largest image the viewer shows (builtin-plugins.md「图片大于浏览器能显示的尺寸时说明原因」). The viewer draws
 * the original file in an `<img>`, which the browser decodes into one RGBA bitmap, 4 bytes a pixel:
 * - no browser makes an image surface or canvas over 32 767 px on a side;
 * - Firefox refuses a decoded surface over 500 000 000 bytes (`gfx.max-alloc-size`), about 125 million pixels, and
 *   the image stays blank; Safari on phones gives up earlier, Chrome decodes it but the page stalls.
 * The 16 384² canvas area other browsers allow does not matter here: the viewer never draws the whole image
 * into a canvas (the palette and the drawing extents use a copy at most 480 px long). So a 16384×9216 map
 * (604 MB decoded) is over the limit and gets the viewer error; 10000×10000 (400 MB) is not.
 */
export const BROWSER_MAX_SIDE = 32767
export const BROWSER_MAX_DECODED_BYTES = 500_000_000
export function exceedsBrowserLimit(w: number, h: number): boolean {
  return w > BROWSER_MAX_SIDE || h > BROWSER_MAX_SIDE || w * h * 4 > BROWSER_MAX_DECODED_BYTES
}

/** Fit `natural` inside `W × H` minus a margin; returns the base (zoom 1) size. */
export function fitSize(W: number, H: number, natural: { w: number; h: number }, margin = 24): { w: number; h: number } {
  const mw = Math.max(1, W - 2 * margin), mh = Math.max(1, H - 2 * margin)
  const ar = natural.w / natural.h
  const w = Math.min(mw, mh * ar)
  return { w, h: w / ar }
}

export interface View { z: number; x: number; y: number }

/** Zoom to `z2` keeping the point `(px, py)` (relative to the stage centre) still. */
export function zoomAt(v: View, z2: number, px: number, py: number, min: number, max: number): View {
  const z = Math.min(max, Math.max(min, z2))
  return { z, x: px - (px - v.x) * (z / v.z), y: py - (py - v.y) * (z / v.z) }
}

/** Pan and zoom so a normalised rect of the image fills the stage (view switch of a turnaround sheet). */
export function viewForRect(rect: [number, number, number, number], base: { w: number; h: number }, fill = 0.94): View {
  const z = Math.min(1 / rect[2], 1 / rect[3]) * fill
  return { z, x: -((rect[0] + rect[2] / 2) - 0.5) * base.w * z, y: -((rect[1] + rect[3] / 2) - 0.5) * base.h * z }
}

/** Image pixel under a stage point, or null outside the image. Tiled previews repeat 3 × 3. */
export function pixelAt(px: number, py: number, rect: { left: number; top: number; width: number; height: number }, natural: { w: number; h: number }, tiled = false): { x: number; y: number } | null {
  let u = (px - rect.left) / rect.width, v = (py - rect.top) / rect.height
  if (tiled) { u = (u * 3) % 1; v = (v * 3) % 1 }
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null
  return { x: Math.floor(u * natural.w), y: Math.floor(v * natural.h) }
}
