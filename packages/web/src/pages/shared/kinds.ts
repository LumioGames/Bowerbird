import type { AssetSummary } from '@bowerbird/schema'

/**
 * Coarse kind of an asset, from the format id of the built-in plugins. The shell never decides how a format is
 * shown (plugins do); this is only for grouping (design-object overview), icons, and finding "an image or a model"
 * upstream for「与上游对比」(web-shell.md 校验页签).
 */
export type Kind = 'image' | 'model' | 'video' | 'audio' | 'doc' | 'unknown' | 'other'
const KNOWN = new Set(['image', 'model', 'video', 'audio', 'doc'])
export function kindOf(a: Pick<AssetSummary, 'format'>): Kind {
  if (a.format === 'unknown') return 'unknown'
  return KNOWN.has(a.format) ? (a.format as Kind) : 'other'
}
export const KIND_ICON: Record<Kind, string> = { image: 'image', model: 'box', video: 'film', audio: 'audio-lines', doc: 'file-text', unknown: 'file', other: 'file' }

/** Assets that cannot be looked at right now (no usable viewer content). */
export function isViewable(a: Pick<AssetSummary, 'format' | 'flags' | 'missingPlugin'>): boolean {
  return a.format !== 'unknown' && !a.missingPlugin && !a.flags.includes('missing') && !a.flags.includes('failed')
}
