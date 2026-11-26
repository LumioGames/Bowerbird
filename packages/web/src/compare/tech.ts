import { fmtInt, fmtSize } from '../lib/format'

/**
 * The technical information table under the compare stage (components.md 技术信息对照表): both sides' values per
 * row, different values highlighted with the change, e.g.「+168 · +7%」. Two versions of one asset always read
 * new minus old; two different assets read B relative to A (said in the header's top-left cell, E-12).
 */
export type TechValue = number | string | boolean | null | undefined
export interface TechSide { tech: Record<string, TechValue>; size: number; /** version number (1-based) when one asset is compared with itself */ n?: number }
export interface TechRow { key: string; label: string; a: string; b: string; differs: boolean; /** where the change shows: the newer side, or B */ deltaOn: 'a' | 'b' | null; delta: string }
export type DeltaMode = 'new-minus-old' | 'b-vs-a' | null

export function deltaText(key: string, from: number, to: number): string {
  const d = to - from
  if (d === 0) return ''
  const s = d > 0 ? '+' : '−'
  if (key === 'size') return s + fmtSize(Math.abs(d))
  const abs = Math.abs(Math.round(d * 100) / 100)
  return s + fmtInt(abs) + (from ? ` · ${s}${Math.abs(Math.round((d / from) * 100))}%` : '')
}

export function display(v: TechValue): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? fmtInt(v) : String(Math.round(v * 100) / 100)
  if (typeof v === 'boolean') return v ? '✓' : '—'
  return v
}

/**
 * Rows in the plugin's label order (`techLabels`), then the remaining keys; the file size always last.
 * `mode` decides whether and how the change is computed.
 */
export function techRows(a: TechSide, b: TechSide, labels: Record<string, string>, mode: DeltaMode, sizeLabel: string): TechRow[] {
  const keys: string[] = []
  for (const k of Object.keys(labels)) if (k in a.tech || k in b.tech) keys.push(k)
  for (const k of [...Object.keys(a.tech), ...Object.keys(b.tech)].sort()) if (!keys.includes(k)) keys.push(k)
  const flip = mode === 'new-minus-old' && (a.n ?? 0) > (b.n ?? 0)
  const row = (key: string, label: string, x: TechValue, y: TechValue, sizeKey = false): TechRow => {
    const ax = display(x), by = display(y)
    const differs = mode !== null && ax !== by && x != null && y != null
    let delta = ''
    if (differs && typeof x === 'number' && typeof y === 'number') delta = flip ? deltaText(sizeKey ? 'size' : key, y, x) : deltaText(sizeKey ? 'size' : key, x, y)
    return { key, label, a: sizeKey ? fmtSize(x as number) : ax, b: sizeKey ? fmtSize(y as number) : by, differs, deltaOn: delta ? (flip ? 'a' : 'b') : null, delta }
  }
  const out = keys.map(k => row(k, labels[k] ?? k, a.tech[k], b.tech[k]))
  out.push(row('size', sizeLabel, a.size, b.size, true))
  return out
}

/** Same asset → new minus old; same kind of file → B relative to A; different kinds → no change shown. */
export function deltaMode(aId: string, bId: string, aFormat: string, bFormat: string): DeltaMode {
  if (aId === bId) return 'new-minus-old'
  return aFormat === bFormat ? 'b-vs-a' : null
}
