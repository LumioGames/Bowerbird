/**
 * Which pairs this plugin compares and how (pages.md「对比页」, ADR-019): model · model side by side or wiped;
 * model · turnaround sheet with a grid side by side, wiped (default) or overlaid; model · image without a grid
 * side by side only. Other pairs are not ours (the shell shows two viewers). Unavailable modes carry the
 * sentence the shell shows in a toast when clicked. Pure.
 */
import type { CompareModeSupport, ViewGrid } from '@bowerbird/schema'
import { t as pageT, type T } from '../i18n'

export const MODEL_FORMAT = 'model'
export const IMAGE_FORMAT = 'image'


interface Side { format: string; views?: ViewGrid | null }

export function hasViewCells(views: ViewGrid | null | undefined): boolean {
  return !!views && views.cells.some(c => c !== null)
}

export type Pairing = 'models' | 'sheet' | 'picture' | null

export function pairing(left: Side, right: Side): Pairing {
  const lm = left.format === MODEL_FORMAT, rm = right.format === MODEL_FORMAT
  if (lm && rm) return 'models'
  if (lm && right.format === IMAGE_FORMAT) return hasViewCells(right.views) ? 'sheet' : 'picture'
  if (rm && left.format === IMAGE_FORMAT) return hasViewCells(left.views) ? 'sheet' : 'picture'
  return null
}

/** Reasons are in the page language (the shell calls this outside React); `tr` overrides it in tests. */
export function compareModes(left: Side, right: Side, tr: T = pageT): CompareModeSupport[] | null {
  const WHY_MODEL = tr('whyModel'), WHY_NO_GRID = tr('whyNoGrid'), WHY_NO_DIFF = tr('whyNoDiff')
  switch (pairing(left, right)) {
    case 'models':
      return [
        { mode: 'side', available: true, default: true },
        { mode: 'wipe', available: true },
        { mode: 'overlay', available: false, reason: WHY_MODEL },
        { mode: 'diff', available: false, reason: WHY_MODEL }
      ]
    case 'sheet':
      return [
        { mode: 'side', available: true },
        { mode: 'wipe', available: true, default: true },
        { mode: 'overlay', available: true },
        { mode: 'diff', available: false, reason: WHY_NO_DIFF }
      ]
    case 'picture':
      return [
        { mode: 'side', available: true, default: true },
        { mode: 'wipe', available: false, reason: WHY_NO_GRID },
        { mode: 'overlay', available: false, reason: WHY_NO_GRID },
        { mode: 'diff', available: false, reason: WHY_NO_GRID }
      ]
    default:
      return null
  }
}
