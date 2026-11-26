/**
 * Waveform drawing helpers shared by the server thumbnail and the viewer. Pure.
 */
import type { PeaksJson } from './analysis.js'

/** `n` bar heights (0..1, the larger of |min| and |max| over each bar's span). */
export function barHeights(p: Pick<PeaksJson, 'min' | 'max'>, n: number): number[] {
  const len = Math.min(p.min.length, p.max.length)
  if (!len || n <= 0) return []
  const out: number[] = []
  for (let k = 0; k < n; k++) {
    const a = Math.floor(k * len / n), b = Math.max(a + 1, Math.floor((k + 1) * len / n))
    let h = 0
    for (let i = a; i < b && i < len; i++) h = Math.max(h, Math.abs(p.min[i]!), Math.abs(p.max[i]!))
    out.push(Math.min(1, h))
  }
  return out
}

/** Bars scaled so the loudest one is full height (quiet sounds stay readable); floor keeps silence visible. */
export function normalise(h: number[], floor = 0.03): number[] {
  const m = Math.max(...h, 1e-9)
  return h.map(v => Math.max(floor, v / m))
}

/**
 * SVG of the waveform thumbnail: rounded bars centred on the middle, on a transparent square
 * (prototype art `wave`: bars across ~82 % of the width, up to 60 % of the height).
 */
export function waveformSvg(p: Pick<PeaksJson, 'min' | 'max'>, size = 512, bars = 56, color = '#8E8E93'): string {
  const h = normalise(barHeights(p, bars))
  const left = size * 0.0875, span = size * 0.825, step = span / bars, w = Math.max(1, step - size * 0.009), mid = size / 2
  const rects = h.map((v, i) => {
    const bh = Math.max(size * 0.019, v * size * 0.6)
    return `<rect x="${(left + i * step).toFixed(1)}" y="${(mid - bh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(w / 2, size * 0.006).toFixed(1)}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="${color}">${rects}</g></svg>`
}

/** `0.8 秒` under ten seconds, then `2:14` / `1:02:03` (builtin-plugins.md「角标」). */
export function audioBadge(seconds: number): string {
  if (seconds < 9.95) return `${(Math.round(seconds * 10) / 10).toFixed(1)} 秒`
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The seconds of a badge `audioBadge` wrote under ten seconds (`0.8`), or null (the `2:14` form needs no words). */
export function secondsOfBadge(badge: string): string | null {
  const m = /^(\d+(?:\.\d+)?) 秒$/.exec(badge)
  return m ? m[1]! : null
}

/** `00:00.80` (prototype `tc`). */
export function timecode(t: number): string {
  const v = Math.max(0, t), s = Math.floor(v), m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((v - s) * 100)).padStart(2, '0')}`
}

/** `48 kHz`, `44.1 kHz`, `22.05 kHz`. */
export function rateText(hz: number): string { return `${+(hz / 1000).toFixed(3)} kHz` }
/** 单声道 / 立体声 / n 声道. */
export function channelsText(n: number): string { return n === 1 ? '单声道' : n === 2 ? '立体声' : `${n} 声道` }
/** `−16.2` with a real minus sign for display. */
export function signed(v: number): string { return v < 0 ? `−${Math.abs(v).toFixed(1)}` : v.toFixed(1) }
