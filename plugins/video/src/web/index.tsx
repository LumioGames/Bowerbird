/**
 * bowerbird.video — web part: viewer, compare view (side, wipe), grid cell (scrub on hover) and the
 * browser-rendered thumbnails and summary strip (ADR-025).
 */
import { inLocale, t, type Key, type T } from './i18n.js'
import { defineWebPlugin } from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { VideoViewer } from './Viewer.js'
import { VideoCompare, videoCompareModes } from './Compare.js'
import { VideoGridCell } from './GridCell.js'
import { renderSummary, renderThumbnail } from './render.js'
import { formatDuration } from '../shared/duration.js'

export { RenderError } from './render.js'

const TECH_KEYS = ['duration', 'width', 'height', 'frameRate', 'codec', 'hasAudio'] as const

/** Compare-table labels of the tech keys, in the page language. */
export function techLabels(): Record<string, string> {
  return Object.fromEntries(TECH_KEYS.map(k => [k, t(`tech.${k}` as Key)]))
}

/**
 * The inspector's「技术信息」as the prototype writes it (flows.js `techRows`): 时长 as the grid badge says it (「0:03」),
 * 分辨率「1280 × 720」, 帧率「30」(no trailing zeros). Null when the container told none of them.
 */
export function videoTechRows(asset: AssetDetail, tr: T): Array<[string, string]> | null {
  const num = (k: string) => { const v = asset.tech[k]; return typeof v === 'number' ? v : null }
  const duration = num('duration'), width = num('width'), height = num('height'), fps = num('frameRate')
  if (duration === null && (width === null || height === null) && fps === null) return null
  return [
    [tr('tech.duration'), duration === null ? '—' : formatDuration(duration)],
    [tr('tech.row.resolution'), width === null || height === null ? '—' : `${width} × ${height}`],
    [tr('tech.frameRate'), fps === null ? '—' : String(+fps.toFixed(3))]
  ]
}

export default defineWebPlugin({
  formats: {
    video: {
      Viewer: VideoViewer,
      Compare: VideoCompare,
      compareModes: videoCompareModes,
      GridCell: VideoGridCell,
      renderThumbnail,
      renderSummary,
      get techLabels() { return techLabels() },
      techRows: (asset, locale) => videoTechRows(asset, inLocale(locale)),
      intro: locale => inLocale(locale)('intro')
    }
  }
})
