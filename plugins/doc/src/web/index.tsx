/**
 * bowerbird.doc — web part: viewer (Markdown, HTML in a sandboxed frame, JSON tree, TXT), compare view
 * (line diff side by side or merged; HTML side by side) and the text grid cell.
 */
import { inLocale, t, type Key, type T } from './i18n.js'
import { defineWebPlugin } from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { DocViewer } from './Viewer.js'
import { DocCompare } from './Compare.js'
import { DocGridCell } from './GridCell.js'
import { docCompareModes } from './lib/rules.js'

const TECH_KEYS = ['title', 'lines', 'words', 'targetWidth', 'targetHeight', 'targetDepth'] as const

/** Compare-table labels of the tech keys, in the page language. */
export function techLabels(): Record<string, string> {
  return Object.fromEntries(TECH_KEYS.map(k => [k, t(`tech.${k}` as Key)]))
}

/**
 * The inspector's「技术信息」as the prototype writes it (flows.js `techRows`): 字数, 行数. No title (the grid cell and the
 * viewer show it) and no 目标宽 / 高 / 深 (the shell shows「目标尺寸」once). Null without either count.
 */
export function docTechRows(asset: AssetDetail, tr: T): Array<[string, string]> | null {
  const { words, lines } = asset.tech
  if (typeof words !== 'number' && typeof lines !== 'number') return null
  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : '—')
  return [[tr('tech.words'), n(words)], [tr('tech.lines'), n(lines)]]
}

export default defineWebPlugin({
  formats: {
    doc: {
      Viewer: DocViewer,
      Compare: DocCompare,
      compareModes: docCompareModes,
      GridCell: DocGridCell,
      get techLabels() { return techLabels() },
      techRows: (asset, locale) => docTechRows(asset, inLocale(locale))
    }
  }
})
