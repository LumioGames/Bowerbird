/**
 * Draco-compressed meshes and machines without WebGL get a specific sentence, and render failures that cannot
 * change on a retry say so (`retryable: false`), so the pipeline does not retry them forever.
 */
import { describe, expect, it } from 'vitest'
import type { FileSource } from '@bowerbird/plugin-sdk/web'
import { packGlb } from '../../__tests__/builders'
import { loadModel, ModelLoadError } from '../three/load'
import { describeFailure, NoWebGLError, toRenderFailure } from '../failure'
import { renderSummary, renderThumbnail } from '../thumbnail'
import { en, zh } from '../i18n'

function source(main: Uint8Array): FileSource {
  const url = 'data:application/octet-stream;base64,' + Buffer.from(main).toString('base64')
  return { url, version: null, fetch: async () => (await fetch(url)).arrayBuffer(), slotUrl: () => null, fetchSlot: async () => null, bundleUrl: i => i }
}

/** A GLB whose mesh is Draco-compressed (the extension is required, so there is no uncompressed fallback). */
function dracoGlb(): Uint8Array {
  return packGlb({
    asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'],
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } } }] }],
    buffers: [{ byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4 }],
    accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }]
  }, new Uint8Array(4))
}

const asset = (name: string) => ({ name, id: '00000000-0000-7000-8000-000000000001' }) as never

describe('Draco and WebGL failures', () => {
  it('a Draco-compressed GLB is「unsupported」with a reason, not a generic decode failure', async () => {
    const err = await loadModel(source(dracoGlb()), 'crate.glb').catch(e => e)
    expect(err).toBeInstanceOf(ModelLoadError)
    expect(err).toMatchObject({ kind: 'unsupported', reason: 'draco', retryable: false })
    expect(describeFailure(err, zh).title).toBe('这个模型的网格用 Draco 压缩过，当前版本还显示不了')
    expect(describeFailure(err, en).title).toBe("This model's meshes are Draco-compressed, which this version cannot display yet")
  })

  it('no WebGL has its own sentence and hint', () => {
    const d = describeFailure(new NoWebGLError(), zh)
    expect(d.title).toBe('这台电脑的浏览器没有可用的 WebGL，显示不了 3D 模型')
    expect(d.detail).toBeTruthy()
  })

  it('render failures carry retryable: false unless a fetch failed', () => {
    expect(toRenderFailure(new NoWebGLError(), zh)).toMatchObject({ retryable: false, message: expect.stringContaining('WebGL') })
    expect(toRenderFailure(new ModelLoadError('unsupported', 'x', 'draco'), zh)).toMatchObject({ retryable: false, message: expect.stringContaining('Draco') })
    expect(toRenderFailure(new ModelLoadError('decode', 'bad bytes'), zh)).toMatchObject({ retryable: false })
    expect(toRenderFailure(new ModelLoadError('load', 'HTTP 503'), zh)).toMatchObject({ retryable: true })
    expect(toRenderFailure(new Error('boom'), zh)).toMatchObject({ retryable: true, message: expect.stringContaining('boom') })
  })

  it.skipIf(typeof document !== 'undefined')('the render worker hears「no WebGL」as a final failure (no canvas here)', async () => {
    const s = source(dracoGlb())
    await expect(renderThumbnail(asset('crate.glb'), s)).rejects.toMatchObject({ retryable: false })
    await expect(renderSummary(asset('crate.glb'), s)).rejects.toMatchObject({ retryable: false })
  })
})
