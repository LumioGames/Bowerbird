/**
 * Loading and reading models with three.js outside a browser: GLB through GLTFLoader, ASCII FBX through
 * FBXLoader (units to metres, Phong to standard, roughness / metalness / occlusion not readable), slots,
 * and a missing .bin as a load failure. No WebGL is needed for these.
 */
import { describe, expect, it } from 'vitest'
import type { FileSource } from '@bowerbird/plugin-sdk/web'
import { GltfBuilder, asciiFbx } from '../../__tests__/builders'
import { loadModel, ModelLoadError } from '../three/load'
import { analyze } from '../three/analyze'
import { unreadable } from '../lib/channels'

function dataUrl(bytes: Uint8Array | string): string {
  return 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64')
}
function source(main: Uint8Array | string, slots: Record<string, Uint8Array> = {}): FileSource & { asked: string[] } {
  const asked: string[] = []
  const url = dataUrl(main)
  return {
    asked, url, version: null,
    fetch: async () => { const r = await fetch(url); return r.arrayBuffer() },
    slotUrl: s => { asked.push(s); return slots[s] ? dataUrl(slots[s]!) : null },
    fetchSlot: async s => (slots[s] ? slots[s]!.buffer as ArrayBuffer : null),
    bundleUrl: i => i
  }
}

describe('loading models for display', () => {
  it('GLB: counts, vertex colour sets, metal-roughness readable, bounds in metres', async () => {
    const b = new GltfBuilder()
    const m = b.material({ name: 'M_Box', pbrMetallicRoughness: { roughnessFactor: 0.4 } })
    b.node({ name: 'box', mesh: b.box(1.2, 0.8, 0.5, { material: m, colors: 2 }), translation: [0, 0, 0] })
    b.json.animations = []
    const model = await loadModel(source(b.glb()), 'box.glb')
    expect(model.kind).toBe('gltf')
    expect(model.missing).toEqual([])
    const a = analyze(model)
    expect(a.tech).toMatchObject({ triangles: 12, meshes: 1, materials: 1, hasUV: true, hasNormals: true, vertexColorSets: 2 })
    expect(a.size.x).toBeCloseTo(1.2); expect(a.size.y).toBeCloseTo(0.8); expect(a.size.z).toBeCloseTo(0.5)
    expect(a.caps).toMatchObject({ pbr: true, ao: false, vcolSets: 2 })
    expect(unreadable('rough', a.caps)).toBe(false)
    expect(unreadable('ao', a.caps)).toBe(true)
    model.dispose()
  })

  // a request that fails goes through three's FileLoader, which needs the browser's ProgressEvent (jsdom has it)
  it.skipIf(typeof ProgressEvent === 'undefined')('glTF with its .bin through the slot; a missing .bin is a load failure, not a decode failure', async () => {
    const b = new GltfBuilder()
    b.node({ mesh: b.box(1, 1, 1) })
    const { json, bin } = b.gltf('scene.bin')
    const ok = source(json, { 'scene.bin': bin })
    const model = await loadModel(ok, 'scene.gltf')
    expect(ok.asked).toContain('scene.bin')
    expect(analyze(model).tech.triangles).toBe(12)
    await expect(loadModel(source(json), 'scene.gltf')).rejects.toMatchObject({ kind: 'load' })
  })

  it('ASCII FBX: centimetres to metres, Phong becomes standard, roughness / metalness / occlusion not readable', async () => {
    const text = asciiFbx([{ name: 'Body', size: [60, 140, 30] }, { name: 'Hat', size: [30, 10, 30] }], { animation: 'walk' })
    const model = await loadModel(source(text), 'hero_walk.fbx')
    expect(model.kind).toBe('fbx')
    expect(model.fromPhong).toBe(true)
    const a = analyze(model)
    expect(a.size.y).toBeCloseTo(1.4, 2)
    expect(a.tech).toMatchObject({ triangles: 24, vertices: 16, meshes: 2, materials: 2, animations: 1 })
    expect(['rough', 'metal', 'ao'].map(c => unreadable(c, a.caps))).toEqual([true, true, true])
    expect(unreadable('base', a.caps)).toBe(false)
  })

  it('the sample library\'s hero_walk.fbx passes the bounded reader and loads', async () => {
    const fs = await import('node:fs')
    const p = new URL('../../../../../fixtures/xingluo/characters/hero/hero_walk.fbx', import.meta.url)
    if (!fs.existsSync(p)) return
    const model = await loadModel(source(new Uint8Array(fs.readFileSync(p))), 'hero_walk.fbx')
    const a = analyze(model)
    expect(a.tech).toMatchObject({ triangles: 8912 })
    expect(a.size.y).toBeCloseTo(1.41, 1)
  })

  it('rejects bytes that are not a model as a decode failure', async () => {
    const err = await loadModel(source('not a model at all'), 'broken.glb').catch(e => e)
    expect(err).toBeInstanceOf(ModelLoadError)
    expect(err.kind).toBe('decode')
  })
})
