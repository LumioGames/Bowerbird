import { t } from '../i18n.js'

/**
 * Time, frame and sprite maths for the video viewer, grid cell and browser-rendered thumbnails. Pure.
 */

/** `00:01.23` (prototype viewers.js `tc`). */
export function timecode(t: number): string {
  const v = Math.max(0, t)
  const s = Math.floor(v), m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((v - s) * 100)).padStart(2, '0')}`
}

/** Index of the frame shown at `t` (0-based). */
export function frameAt(t: number, fps: number): number { return Math.max(0, Math.floor(t * fps + 1e-6)) }
/** Total frames of a clip. */
export function frameCount(duration: number, fps: number): number { return Math.max(1, Math.round(duration * fps)) }
/** A time inside frame `f` (its middle), safe to seek to. */
export function timeOfFrame(f: number, fps: number): number { return (f + 0.5) / fps }
/** One frame forward or back from `t`, clamped to the clip. */
export function stepFrame(t: number, fps: number, duration: number, d: number): number {
  const last = frameCount(duration, fps) - 1
  const f = Math.min(last, Math.max(0, frameAt(t, fps) + d))
  return Math.min(duration, timeOfFrame(f, fps))
}

/** The `scrub` sprite: 25 frames sampled evenly, 5 × 5 (pipeline-and-cache.md「规格」). */
export const SCRUB_COLS = 5
export const SCRUB_ROWS = 5
export const SCRUB_FRAMES = SCRUB_COLS * SCRUB_ROWS
/** Tile width of a scrub frame in px. */
export const SCRUB_TILE = 160

/** Times of `n` evenly spaced samples (each in the middle of its slice). */
export function sampleTimes(duration: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i + 0.5) / n * duration)
}
/** Poster time: a tenth of the way in, past a black lead-in (builtin-plugins.md「缩略图」). */
export function posterTime(duration: number): number { return duration / 10 }

/** Sprite tile for a horizontal pointer position 0..1. */
export function spriteIndex(x: number, frames = SCRUB_FRAMES): number {
  return Math.min(frames - 1, Math.max(0, Math.floor(x * frames)))
}
/** Pixel rectangle of tile `i` in a sprite of `cols` columns with tiles of `tw × th`. */
export function spriteTile(i: number, tw: number, th: number, cols = SCRUB_COLS): { x: number; y: number; w: number; h: number } {
  return { x: (i % cols) * tw, y: Math.floor(i / cols) * th, w: tw, h: th }
}

/** Scale `w × h` so its long edge is `edge` (never up). */
export function fitEdge(w: number, h: number, edge: number): { w: number; h: number } {
  const k = Math.min(1, edge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** In / out loop: where playback continues after `t` (null = stop at `b`). */
export function loopNext(t: number, a: number, b: number, loop: boolean): { t: number; stop: boolean } {
  if (t < b) return { t, stop: false }
  return loop ? { t: a, stop: false } : { t: b, stop: true }
}

/** File name of a saved frame: `clip_f037.png`. */
export function frameFileName(assetName: string, frame: number): string {
  const stem = assetName.replace(/\.[^.]+$/, '')
  return `${stem}_f${String(frame).padStart(3, '0')}.png`
}

/** Error text when the browser cannot decode a codec (copy.md「失败任务」), in the page language. */
export function undecodableMessage(codec: string | null | undefined): string {
  return codec ? t('cannotPlayCodec', { codec }) : t('cannotPlay')
}
