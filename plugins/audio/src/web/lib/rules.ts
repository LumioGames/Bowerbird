/**
 * Small rules for the audio viewer and compare view. Pure.
 */
import type { AssetDetail, CompareModeSupport } from '@bowerbird/schema'
import { t } from '../i18n.js'

/** prototype compare.js `WHY.audio`. */
export const REASON_AUDIO = '音频按上下两条波形对齐'

export function audioCompareModes(left: Pick<AssetDetail, 'format'>, right: Pick<AssetDetail, 'format'>): CompareModeSupport[] | null {
  if (left.format !== 'audio' || right.format !== 'audio') return null
  return [
    { mode: 'side', available: true, default: true },
    { mode: 'wipe', available: false, reason: t('reasonAudio') },
    { mode: 'overlay', available: false, reason: t('reasonAudio') },
    { mode: 'diff', available: false, reason: t('reasonAudio') }
  ]
}

/** Pixels a press must travel before it becomes a selection instead of a click (prototype: 6 px). */
export const DRAG_PX = 6

/** Selection between two times, or null when the pointer moved less than DRAG_PX over a track `width` px wide. */
export function selectionFrom(t0: number, t1: number, duration: number, width: number): { a: number; b: number } | null {
  if (!duration || Math.abs(t1 - t0) / duration * width <= DRAG_PX) return null
  return { a: Math.min(t0, t1), b: Math.max(t0, t1) }
}
