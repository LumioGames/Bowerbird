/**
 * Dominant colours of an image (builtin-plugins.md「主色板」): pixels are quantised to 4 bits per channel,
 * counted, and the most frequent buckets that differ enough from each other are kept.
 * Pure: takes raw RGBA pixels. The same rule runs on the server (analysis, summary) and in the viewer.
 */
export interface Swatch {
  /** `#RRGGBB`, upper case. */
  hex: string
  /** Share of the counted (opaque enough) pixels, 0..1. */
  share: number
}

export interface PaletteOptions {
  /** Maximum colours returned (default 5). */
  max?: number
  /** Pixels with alpha below this are ignored (default 200). */
  minAlpha?: number
  /** Minimum L1 distance between kept buckets, in 4-bit steps (default 5). */
  minDistance?: number
  /** Read every n-th pixel (default 1). */
  stride?: number
}

export function hex2(n: number): string { return n.toString(16).padStart(2, '0').toUpperCase() }
export function rgbHex(r: number, g: number, b: number): string { return '#' + hex2(r) + hex2(g) + hex2(b) }

export function dominantColors(rgba: Uint8Array | Uint8ClampedArray, opts: PaletteOptions = {}): Swatch[] {
  const max = opts.max ?? 5, minAlpha = opts.minAlpha ?? 200, minDistance = opts.minDistance ?? 5, stride = Math.max(1, opts.stride ?? 1)
  const counts = new Map<number, number>()
  let total = 0
  for (let i = 0; i + 3 < rgba.length; i += 4 * stride) {
    if (rgba[i + 3]! < minAlpha) continue
    const k = (rgba[i]! >> 4) << 8 | (rgba[i + 1]! >> 4) << 4 | (rgba[i + 2]! >> 4)
    counts.set(k, (counts.get(k) ?? 0) + 1)
    total++
  }
  // An image that is translucent everywhere still has colours: count whatever is not fully transparent.
  if (!total) return minAlpha > 1 ? dominantColors(rgba, { ...opts, minAlpha: 1 }) : []
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const kept: Array<[number, number, number, number]> = []
  for (const [k, n] of sorted) {
    if (kept.length >= max) break
    const r = k >> 8, g = (k >> 4) & 15, b = k & 15
    if (kept.every(o => Math.abs(o[0] - r) + Math.abs(o[1] - g) + Math.abs(o[2] - b) > minDistance)) kept.push([r, g, b, n])
  }
  return kept.map(([r, g, b, n]) => ({ hex: rgbHex(r * 17, g * 17, b * 17), share: Math.round(n / total * 1000) / 1000 }))
}
