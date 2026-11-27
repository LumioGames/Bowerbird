/**
 * Compare rules for two images (builtin-plugins.md「对比视图」, design/docs/pages.md「对比页」, ADR-036).
 * Pure; the viewer and compare components and `compareModes` share them.
 */
import type { AssetDetail, CompareModeSupport } from '@bowerbird/schema'
import { t } from '../i18n.js'

export const MODES = ['side', 'wipe', 'overlay', 'diff'] as const
/** copy.md「四视图」. */
export const REASON_ASPECT = '两张图的比例不一样，差异看不出东西'
/** ADR-036: a slice whose provenance has no `rect` can only sit next to its source. */
export const REASON_SLICE_NO_RECT = '这张切图没有记下它在原图上的区域，只能并排'
/** Aspect ratios further apart than this make the pixel difference meaningless (5 %). */
export const ASPECT_TOLERANCE = 0.05

export interface Size { w: number; h: number }
/** `[x, y, w, h]` in pixels of the image it applies to. */
export type PxRect = [number, number, number, number]

/** Relative difference of two aspect ratios (0 = same). */
export function aspectDifference(a: Size, b: Size): number {
  if (!a.w || !a.h || !b.w || !b.h) return 0
  return Math.abs((a.w / a.h) / (b.w / b.h) - 1)
}
export function aspectsDiffer(a: Size, b: Size): boolean { return aspectDifference(a, b) > ASPECT_TOLERANCE }

type AssetLike = Pick<AssetDetail, 'id' | 'format' | 'tech' | 'provenance' | 'relations'>

export function sizeOf(a: Pick<AssetDetail, 'tech'>): Size | null {
  const w = Number(a.tech?.width), h = Number(a.tech?.height)
  return w > 0 && h > 0 ? { w, h } : null
}

function isRect(v: unknown): v is PxRect {
  return Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && Number.isFinite(n)) && (v[2] as number) > 0 && (v[3] as number) > 0
}

/**
 * The slice's region from its own provenance, `params.rect` (ADR-036, ADR-070): `[x, y, w, h]`. Every output of a
 * run has its own provenance, so there is only this one form.
 */
export function rectFor(rect: unknown): PxRect | null {
  return isRect(rect) ? [...rect] as PxRect : null
}

/** Whether `slice` was cut out of `source`: its provenance is a slice and its source relation names it. */
function slicedFrom(slice: AssetLike, source: AssetLike): boolean {
  const p = slice.provenance
  if (!p || !(p.method === 'slice' || p.method.endsWith('/slice'))) return false
  return slice.relations?.outgoing?.some(r => r.type === 'source' && r.to === source.id) ?? false
}

export type SliceCrop =
  | { crop: 'left' | 'right'; rect: PxRect }
  | { crop: null; missingRect: true }

/**
 * A slice compared with the picture it was cut from (ADR-036): the picture side is cropped to the slice's
 * `params.rect`; without one, only side by side. Null when the pair is not a slice and its source.
 */
export function sliceCrop(left: AssetLike, right: AssetLike): SliceCrop | null {
  for (const [slice, source, crop] of [[left, right, 'right'], [right, left, 'left']] as const) {
    if (!slicedFrom(slice, source)) continue
    const rect = rectFor(slice.provenance?.params?.rect)
    return rect ? { crop, rect } : { crop: null, missingRect: true }
  }
  return null
}

/** Size each side shows (after the slice crop). */
export function shownSizes(left: AssetLike, right: AssetLike): { a: Size | null; b: Size | null; crop: SliceCrop | null } {
  const crop = sliceCrop(left, right)
  let a = sizeOf(left), b = sizeOf(right)
  if (crop && crop.crop === 'left') a = { w: crop.rect[2], h: crop.rect[3] }
  if (crop && crop.crop === 'right') b = { w: crop.rect[2], h: crop.rect[3] }
  return { a, b, crop }
}

/** Which modes two images support, with reasons for the ones they do not (shown as a toast by the shell). */
export function imageCompareModes(left: AssetLike, right: AssetLike): CompareModeSupport[] | null {
  if (left.format !== 'image' || right.format !== 'image') return null
  const { a, b, crop } = shownSizes(left, right)
  if (crop && crop.crop === null) {
    return MODES.map(mode => (mode === 'side'
      ? { mode, available: true, default: true }
      : { mode, available: false, reason: t('reasonSliceNoRect') }))
  }
  const apart = a && b ? aspectsDiffer(a, b) : false
  return MODES.map(mode => {
    if (mode === 'diff' && apart) return { mode, available: false, reason: t('reasonAspect') }
    return mode === 'side' ? { mode, available: true, default: true } : { mode, available: true }
  })
}

export type Align = 'fit' | 'px'

/**
 * Where each image sits in a pane of `W × H`: by proportion (both fill the same box) or by original pixels
 * (a smaller file looks smaller). A margin of 28 px is kept on every side (prototype compare.js `dims`).
 */
export function alignBoxes(W: number, H: number, a: Size, b: Size, align: Align, margin = 28): [Size, Size] {
  const mw = Math.max(40, W - 2 * margin), mh = Math.max(40, H - 2 * margin)
  if (align === 'px') {
    const k = Math.min(mw / Math.max(a.w, b.w), mh / Math.max(a.h, b.h))
    return [{ w: a.w * k, h: a.h * k }, { w: b.w * k, h: b.h * k }]
  }
  const fit = (s: Size): Size => { const ar = s.w / s.h, w = Math.min(mw, mh * ar); return { w, h: w / ar } }
  return [fit(a), fit(b)]
}

export function sameSize(a: Size | null, b: Size | null): boolean { return !!a && !!b && a.w === b.w && a.h === b.h }
