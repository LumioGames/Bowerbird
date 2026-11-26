/**
 * bowerbird.model — web part: the 3D viewer, the grid cell with its hover turntable, the browser-rendered
 * thumbnail and summary picture (ADR-025), and the compare views for model · model and model · image.
 */
import { defineWebPlugin, type FormatView } from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { ModelViewer } from './viewer/Viewer'
import { ModelGridCell } from './GridCell'
import { ModelCompareView } from './compare/CompareView'
import { compareModes } from './lib/compare-modes'
import { renderSummary, renderThumbnail } from './thumbnail'
import { inLocale, t, type T } from './i18n'
import { modelBadge, sizeCheckView } from './lib/check'
import { SIZE_CHECK } from '../shared/size'

/**
 * Every tech key the plugin writes (builtin-plugins.md「提取的技术信息」), labelled, in the prototype's order
 * (compare.js `rows`: 三角面, 顶点, 材质, 贴图, 包围盒, 动画), so the inspector and the compare table never show a raw key.
 */
const TECH_KEYS = [
  'triangles', 'vertices', 'meshes', 'materials', 'textures', 'maxTextureSize', 'bones',
  'boundsX', 'boundsY', 'boundsZ', 'animations', 'hasUV', 'hasNormals', 'hasVertexColors', 'vertexColorSets'
] as const

/** The compare table's labels in the page language (the shell reads them when it draws the table). */
export function techLabels(tr: T = t): Record<string, string> {
  return Object.fromEntries(TECH_KEYS.map(k => [k, tr(`tech.${k}`)]))
}

/**
 * The inspector's「技术信息」as the prototype writes it (flows.js `techRows`): 三角面, 材质, 贴图「3 张 · 最大 1024」,
 * 动画「1 段 · open」. Clip names come from the extraction's analysis; without them the count alone.
 */
export function modelTechRows(asset: AssetDetail, tr: T): Array<[string, string]> | null {
  const tech = asset.tech
  if (typeof tech.triangles !== 'number') return null
  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : '—')
  const textures = typeof tech.textures === 'number' ? tech.textures : 0
  const clips = typeof tech.animations === 'number' ? tech.animations : 0
  const names = (asset.analysis?.['bowerbird.model']?.clipNames as unknown)
  const clipNames = Array.isArray(names) ? names.filter((x): x is string => typeof x === 'string' && !!x) : []
  return [
    [tr('tech.triangles'), n(tech.triangles)],
    [tr('tech.materials'), n(tech.materials)],
    [tr('tech.textures'), textures > 0 ? tr('tech.row.textures', { n: textures, size: typeof tech.maxTextureSize === 'number' ? String(tech.maxTextureSize) : '—' }) : tr('tech.row.none')],
    [tr('tech.animations'), clips > 0 ? (clipNames.length ? tr('tech.row.anim', { n: clips, names: clipNames.join(tr('tech.row.sep')) }) : tr('tech.row.animN', { n: clips })) : tr('tech.row.none')]
  ]
}

export const modelFormat: FormatView = {
  Viewer: ModelViewer,
  Compare: ModelCompareView,
  compareModes: (left, right) => compareModes(left, right),
  GridCell: ModelGridCell,
  renderThumbnail,
  renderSummary,
  get techLabels() { return techLabels() },
  formatBadge: (badge, locale) => modelBadge(badge, inLocale(locale)),
  techRows: (asset, locale) => modelTechRows(asset, inLocale(locale)),
  intro: locale => inLocale(locale)('intro')
}

export default defineWebPlugin({
  formats: { model: modelFormat },
  validators: { [SIZE_CHECK]: sizeCheckView }
})
