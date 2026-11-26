/**
 * bowerbird.image — web part: viewer, compare view (side, wipe, overlay, diff), grid cell (animated hover)
 * and the compare-mode rules.
 */
import { inLocale, t, type Key, type T } from './i18n.js'
import { defineWebPlugin } from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { ImageViewer } from './Viewer.js'
import { ImageCompare } from './Compare.js'
import { ImageGridCell } from './GridCell.js'
import { imageCompareModes } from './lib/rules.js'

const TECH_KEYS = ['width', 'height', 'channels', 'hasAlpha', 'colorSpace', 'frames', 'dpi'] as const

/** Compare-table labels of the tech keys, in the page language. */
export function techLabels(): Record<string, string> {
  return Object.fromEntries(TECH_KEYS.map(k => [k, t(`tech.${k}` as Key)]))
}

/** sharp's colour-space ids as people write them (server.ts `spaceName`); the ones that need words are in the dictionary. */
const SPACE_NAMES: Record<string, string> = { srgb: 'sRGB', rgb: 'RGB', cmyk: 'CMYK', lab: 'Lab', scrgb: 'scRGB' }
const SPACE_WORDS: Record<string, Key> = { rgb16: 'space.rgb16', 'b-w': 'space.b-w', grey16: 'space.grey16' }
export function spaceText(space: string, tr: T): string {
  const words = SPACE_WORDS[space]
  return SPACE_NAMES[space] ?? (words ? tr(words) : space)
}

/**
 * The inspector's「技术信息」as the prototype writes it (flows.js `techRows`): 尺寸「2048 × 2048」, 透明通道 有 / 无,
 * 色彩空间「sRGB」. The turnaround grid row is the shell's. Without a size there is nothing to summarise.
 */
export function imageTechRows(asset: AssetDetail, tr: T): Array<[string, string]> | null {
  const { width, height, hasAlpha, colorSpace } = asset.tech
  if (typeof width !== 'number' || typeof height !== 'number') return null
  return [
    [tr('tech.row.size'), `${width} × ${height}`],
    [tr('tech.hasAlpha'), typeof hasAlpha === 'boolean' ? tr(hasAlpha ? 'tech.row.yes' : 'tech.row.no') : '—'],
    [tr('tech.colorSpace'), typeof colorSpace === 'string' && colorSpace ? spaceText(colorSpace, tr) : '—']
  ]
}

export default defineWebPlugin({
  formats: {
    image: {
      Viewer: ImageViewer,
      Compare: ImageCompare,
      compareModes: imageCompareModes,
      GridCell: ImageGridCell,
      get techLabels() { return techLabels() },
      techRows: (asset, locale) => imageTechRows(asset, inLocale(locale))
    }
  }
})
