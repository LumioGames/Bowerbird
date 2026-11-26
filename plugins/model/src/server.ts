/**
 * bowerbird.model — server part: GLB, glTF and FBX identification, technical information, slot names
 * (ADR-018), the agent summary text, and the one built-in check — model size against the design object (ADR-020).
 * Thumbnails are rendered in the browser (ADR-025), so there is no `thumbnail()` here.
 * Uses only @bowerbird/plugin-sdk and @bowerbird/schema (engineering.md hard rule 2).
 */
import { defineServerPlugin, type AssetFile, type CheckResult, type FormatHandler, type Validator } from '@bowerbird/plugin-sdk'
import { matchBuffer, matchModel } from './server/match.js'
import { kindOf, probeResult, readModel, summaryText } from './server/probe.js'
import { compareSize, sizeFromTech, sizeMessage, SIZE_CHECK, SIZE_TOLERANCE, type Size3 } from './shared/size.js'

export const SIZE_RULE = SIZE_CHECK

const model: FormatHandler = {
  id: 'model',
  async match(file) { return matchModel(file) },
  async probe(asset) { return probeResult(await readModel(asset)) },
  async summarize(asset) { return { text: summaryText(await readModel(asset), asset.name) } }
}

const buffer: FormatHandler = {
  id: 'gltf-buffer',
  match: matchBuffer,
  async probe(asset) { return { tech: { bytes: asset.size }, auxiliary: true } }
}

/** Bounds of the model: read from GLB / glTF; for FBX the ones the browser reported (`RenderedSet.tech`). */
async function modelSize(asset: AssetFile): Promise<Size3 | null> {
  const kind = kindOf(asset.ext)
  if (kind === 'glb' || kind === 'gltf') {
    try { return (await readModel(asset)).size } catch { return null }
  }
  return sizeFromTech(asset.tech)
}

export async function checkSize(asset: AssetFile): Promise<CheckResult[]> {
  const target = asset.designObject?.targetSize
  if (!target) return []
  const size = await modelSize(asset)
  if (!size) return []
  const c = compareSize(size, target)
  return [{
    rule: SIZE_RULE,
    verdict: c.ok ? 'pass' : 'fail',
    message: sizeMessage(c),
    values: {
      model: [size.x, size.y, size.z],
      target: [target.w, target.h, target.d],
      axes: c.axes.map(a => ({ axis: a.axis, model: a.model, target: a.target, ok: a.ok })),
      tolerance: { ...SIZE_TOLERANCE },
      designObject: asset.designObject?.id
    }
  }]
}

const sizeCheck: Validator = {
  id: SIZE_RULE,
  appliesTo: asset => asset.format === 'model',
  check: checkSize
}

export default defineServerPlugin({
  activate(ctx) {
    ctx.register.format(model)
    ctx.register.format(buffer)
    ctx.register.validator(sizeCheck)
  }
})
