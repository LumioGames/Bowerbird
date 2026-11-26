import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import { assetFileFor, createTestContext, fileRefFor } from '@bowerbird/plugin-sdk/testing'
import type { AssetFile, FormatHandler, Validator } from '@bowerbird/plugin-sdk'
import plugin, { checkSize } from '../server.js'
import { GltfBuilder, asciiFbx, png, pngHeader, sampleBinaryFbx } from './builders.js'
import { readGltfContainer, gltfInfo, boundsSize } from '../shared/gltf.js'
import { compareSize, sizeMessage, sizeMatches } from '../shared/size.js'
import { embeddedImageSlot, slotCandidates, uriSlot, fbxSlot } from '../shared/slots.js'
import { imageSize } from '../shared/image-size.js'
import { fbxInfo, parseFbx, parseAsciiFbx } from '../shared/fbx.js'
import { inflateSync } from 'node:zlib'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-model-test-'))
const write = (name: string, data: Uint8Array | string) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p }

let model: FormatHandler, buffer: FormatHandler, validator: Validator

beforeAll(async () => {
  const ctx = createTestContext({ pluginId: 'bowerbird.model' })
  await plugin.activate(ctx)
  model = ctx.registered.formats.find(f => f.id === 'model')!
  buffer = ctx.registered.formats.find(f => f.id === 'gltf-buffer')!
  validator = ctx.registered.validators[0]!
})

/** The chest: a 1.26 × 0.95 × 0.87 m body, a lid child node, an embedded base colour, external normal and ORM maps. */
function chest(opts: { width?: number } = {}): GltfBuilder {
  const b = new GltfBuilder()
  const base = b.image({ name: 'chest_basecolor', mimeType: 'image/png' }, pngHeader(1024, 1024))
  const normal = b.image({ uri: 'chest_normal.png' })
  const orm = b.image({ uri: 'textures/chest%20orm.png' })
  const mat = b.material({
    name: 'M_Chest',
    pbrMetallicRoughness: { baseColorTexture: { index: b.texture(base) }, metallicRoughnessTexture: { index: b.texture(orm) } },
    normalTexture: { index: b.texture(normal) },
    occlusionTexture: { index: b.texture(orm) }
  })
  const body = b.box(1, 0.75, 0.87, { material: mat, colors: 1 })
  const lid = b.box(1, 0.2, 0.87, { material: mat })
  const lidNode = b.node({ name: 'lid', mesh: lid, translation: [0, 0.75, 0] }, false)
  b.node({ name: 'body', mesh: body, scale: [(opts.width ?? 1.26), 1, 1], children: [lidNode] })
  b.json.animations = [{ name: 'open', channels: [], samplers: [] }]
  return b
}

function asset(p: string, extra: Partial<AssetFile> & { slots?: Record<string, string> } = {}): AssetFile {
  return assetFileFor(p, extra)
}

describe('slots (ADR-018)', () => {
  it('names packed images by their name plus the MIME extension', () => {
    expect(embeddedImageSlot({ name: 'chest_basecolor', mimeType: 'image/png' })).toBe('chest_basecolor.png')
    expect(embeddedImageSlot({ name: 'a.jpg', mimeType: 'image/png' })).toBe('a.jpg')
    expect(embeddedImageSlot({ mimeType: 'image/png' })).toBeNull()
  })
  it('decodes URIs, ignores data URIs, and tries the base name too', () => {
    expect(uriSlot('textures/chest%20orm.png')).toBe('textures/chest orm.png')
    expect(uriSlot('./a.bin')).toBe('a.bin')
    expect(uriSlot('data:application/octet-stream;base64,AAAA')).toBeNull()
    expect(slotCandidates('textures/chest%20orm.png')).toEqual(['textures/chest orm.png', 'chest orm.png'])
    expect(fbxSlot('C:\\art\\hero_basecolor.png')).toBe('hero_basecolor.png')
  })
})

describe('image headers', () => {
  it('reads PNG and JPEG sizes', () => {
    expect(imageSize(png(3, 5))).toMatchObject({ width: 3, height: 5, mime: 'image/png' })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x04, 0x00, 0x03])
    expect(imageSize(jpeg)).toMatchObject({ width: 1024, height: 512 })
  })
})

describe('GLB probe', () => {
  it('claims GLB by its header and reads counts, bounds, slots and texture sizes', async () => {
    const p = write('props/chest/chest.glb', chest().glb())
    write('props/chest/chest_normal.png', pngHeader(2048, 2048))
    write('props/chest/textures/chest orm.png', pngHeader(512, 512))
    expect(await model.match(fileRefFor(p))).toEqual({ format: 'model', confidence: 1 })
    const r = await model.probe!(asset(p))
    expect(r.tech).toMatchObject({
      triangles: 24, vertices: 48, meshes: 2, materials: 1, textures: 3, maxTextureSize: 2048,
      bones: 0, animations: 1, hasUV: true, hasNormals: true, hasVertexColors: true, vertexColorSets: 1
    })
    expect(r.tech.boundsX).toBeCloseTo(1.26, 4)
    expect(r.tech.boundsY).toBeCloseTo(0.95, 4)
    expect(r.tech.boundsZ).toBeCloseTo(0.87, 4)
    expect(r.badge).toBe('24 面')
    expect(r.references).toEqual(['chest_basecolor.png', 'chest_normal.png', 'textures/chest orm.png'])
    expect(r.embedded).toEqual(['chest_basecolor.png'])
    expect(r.auxiliary).toBeUndefined()
  })

  it('reads external textures through the slot relations, not the name in the file', async () => {
    const p = write('slots/chest.glb', chest().glb())
    write('slots/elsewhere/dark.png', pngHeader(4096, 2048))
    const r = await model.probe!(asset(p, { slots: { 'chest_normal.png': path.join(dir, 'slots/elsewhere/dark.png') } }))
    expect(r.tech.maxTextureSize).toBe(4096)
  })

  it('rejects files that only have the extension', async () => {
    const p = write('fake.glb', 'hello world, not a model')
    expect(await model.match(fileRefFor(p))).toBeNull()
  })

  it('takes skinned meshes in their bind pose from the inverse bind matrices', async () => {
    const b = new GltfBuilder()
    const mesh = b.box(1, 2, 1, { joints: true })
    const joint = b.node({ name: 'hip', translation: [5, 0, 0] }, true)
    // IBM = inverse(translate(5,0,0)) → bind pose puts the mesh at the origin; the mesh node's own transform is ignored
    const ibm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -5, 0, 0, 1])
    b.json.skins = [{ joints: [joint], inverseBindMatrices: b.accessor(ibm, 'MAT4') }]
    b.node({ name: 'body', mesh, skin: 0, translation: [100, 100, 100] })
    const c = await readGltfContainer(b.glb())
    const info = await gltfInfo(c, async () => null)
    expect(info.bones).toBe(1)
    expect(info.bounds!.min[0]).toBeCloseTo(-0.5)
    expect(info.bounds!.min[1]).toBeCloseTo(0)
    expect(boundsSize(info.bounds)).toEqual({ x: 1, y: 2, z: 1 })
  })

  it('reads a GLB written by three.js GLTFExporter', async () => {
    const g = globalThis as unknown as { FileReader?: unknown }
    g.FileReader ??= class {
      result: unknown = null
      onloadend: (() => void) | null = null
      readAsArrayBuffer(b: Blob) { void b.arrayBuffer().then(r => { this.result = r; this.onloadend?.() }) }
      readAsDataURL(b: Blob) { void b.arrayBuffer().then(r => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(r).toString('base64'); this.onloadend?.() }) }
    }
    const THREE = await import('three')
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
    const scene = new THREE.Scene()
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.3), new THREE.MeshStandardMaterial({ name: 'M_Sword', roughness: 0.3 }))
    m.position.set(0, 0.6, 0)
    scene.add(m)
    const glb = await new Promise<ArrayBuffer>((res, rej) => new GLTFExporter().parse(scene, r => res(r as ArrayBuffer), rej, { binary: true }))
    const p = write('exported/sword.glb', new Uint8Array(glb))
    const r = await model.probe!(asset(p))
    expect(r.tech).toMatchObject({ triangles: 12, meshes: 1, materials: 1, hasNormals: true, hasUV: true })
    expect(r.tech.boundsY).toBeCloseTo(1.2, 4)
    const s = await model.summarize!(asset(p))
    expect(s.text).toContain('12 面')
    expect(s.text).toContain('M_Sword')
  })
})

describe('glTF with an external .bin', () => {
  it('lists the .bin as a slot and claims the .bin as an auxiliary file', async () => {
    const b = chest()
    const { json, bin } = b.gltf('chest.bin')
    const gp = write('gltf/chest.gltf', json)
    const bp = write('gltf/chest.bin', bin)
    write('gltf/other.bin', new Uint8Array([1, 2, 3]))
    expect(await model.match(fileRefFor(gp))).toEqual({ format: 'model', confidence: 1 })
    expect(await buffer.match(fileRefFor(bp))).toEqual({ format: 'gltf-buffer', confidence: 1 })
    expect(await buffer.match(fileRefFor(path.join(dir, 'gltf/other.bin')))).toBeNull()
    const pb = await buffer.probe!(asset(bp))
    expect(pb.auxiliary).toBe(true)
    const r = await model.probe!(asset(gp))
    expect(r.references).toContain('chest.bin')
    expect(r.embedded).toEqual(['chest_basecolor.png'])
    expect(r.tech.triangles).toBe(24)
    expect(r.tech.maxTextureSize).toBe(1024)
  })

  it('still knows the bounds when the .bin is missing (accessor min/max live in the JSON)', async () => {
    const { json } = chest().gltf('gone.bin')
    const gp = write('gltf2/chest.gltf', json)
    const r = await model.probe!(asset(gp))
    expect(r.tech.boundsX).toBeCloseTo(1.26, 4)
    expect(r.references).toContain('gone.bin')
  })

  it('claims a .bin named from a glTF one folder up', async () => {
    const { json, bin } = chest().gltf('buffers/data.bin')
    write('nested/chest.gltf', json)
    const bp = write('nested/buffers/data.bin', bin)
    // the library root is `dir`, so the glTF one folder up is inside it
    expect(await buffer.match(fileRefFor(bp, 'nested/buffers/data.bin'))).toEqual({ format: 'gltf-buffer', confidence: 1 })
  })
})

describe('FBX (light parse)', () => {
  it('reads an ASCII FBX: counts, texture slots, packed images, stacks', async () => {
    const text = asciiFbx([
      { name: 'Body', size: [100, 180, 40], texture: 'hero_basecolor.png' },
      { name: 'Hat', size: [30, 20, 30], texture: 'hat.png', embed: png(8, 4) }
    ], { animation: 'walk', limbs: 3 })
    const p = write('characters/hero_walk.fbx', text)
    write('characters/hero_basecolor.png', pngHeader(2048, 1024))
    expect(await model.match(fileRefFor(p))).toEqual({ format: 'model', confidence: 1 })
    const r = await model.probe!(asset(p))
    expect(r.tech).toMatchObject({ triangles: 24, vertices: 16, meshes: 2, materials: 2, textures: 2, maxTextureSize: 2048, bones: 3, animations: 1, hasUV: true, hasNormals: true, hasVertexColors: false })
    expect(r.tech.boundsX).toBeUndefined()
    expect(r.references).toEqual(['hero_basecolor.png', 'hat.png'])
    expect(r.embedded).toEqual(['hat.png'])
    expect(r.badge).toBe('24 面')
    const s = await model.summarize!(asset(p))
    expect(s.text).toContain('walk')
    expect(s.text).toContain('hat.png 8×4（打包在文件内）')
  })

  it('reads a binary FBX with a zlib-compressed index array', async () => {
    const p = write('characters/hero_bin.fbx', sampleBinaryFbx(png(16, 32)))
    expect(await model.match(fileRefFor(p))).toEqual({ format: 'model', confidence: 1 })
    const r = await model.probe!(asset(p))
    expect(r.tech).toMatchObject({ triangles: 12, vertices: 8, meshes: 1, materials: 2, textures: 2, maxTextureSize: 32, bones: 2, animations: 1, hasVertexColors: true, vertexColorSets: 2, hasUV: false })
    expect(r.references).toEqual(['hero_skin.png', 'hero_cloth.png'])
    expect(r.embedded).toEqual(['hero_skin.png'])
    const info = fbxInfo(parseFbx(fs.readFileSync(p), d => new Uint8Array(inflateSync(d))))
    expect(info.unitScale).toBe(100)
    expect(info.clipNames).toEqual(['walk'])
    expect(info.materialNames).toEqual(['M_Skin', 'M_Cloth'])
  })

  it('without an inflater, counts degrade instead of failing', () => {
    const info = fbxInfo(parseFbx(sampleBinaryFbx(png(2, 2))))
    expect(info.complete).toBe(false)
    expect(info.vertices).toBe(8)
  })

  it('parses ASCII values that continue over several lines', () => {
    const doc = parseAsciiFbx('; FBX 7.4.0 project file\nObjects:  {\n\tGeometry: 1, "Geometry::A", "Mesh" {\n\t\tPolygonVertexIndex: *6 {\n\t\t\ta: 0,1,\n-3,2,3,-5\n\t\t}\n\t}\n}\n')
    expect(fbxInfo(doc).triangles).toBe(2)
  })
})

describe('size against the design object (ADR-020)', () => {
  it('passes within 1 cm or 2 %, and says which axis is off', async () => {
    expect(sizeMatches(1.265, 1.26)).toBe(true)
    expect(sizeMatches(1.30, 1.26)).toBe(false)
    expect(sizeMatches(0.104, 0.1)).toBe(true) // 4 mm on a 10 cm prop: inside 1 cm
    const c = compareSize({ x: 1.3, y: 0.95, z: 0.87 }, { w: 1.26, h: 0.95, d: 0.87 })
    expect(c.ok).toBe(false)
    expect(sizeMessage(c)).toBe('尺寸与设计对象：模型 1.30 × 0.95 × 0.87 m · 目标 1.26 × 0.95 × 0.87 m · 宽 1.30 m，应为 1.26')
  })

  it('checks a GLB against the target size, pass and fail', async () => {
    const ok = write('check/chest_ok.glb', chest().glb())
    const wide = write('check/chest_wide.glb', chest({ width: 1.3 }).glb())
    const designObject = { id: '00000000-0000-7000-8000-00000000000d', targetSize: { w: 1.26, h: 0.95, d: 0.87 } }
    expect(validator.appliesTo({ format: 'model' } as never)).toBe(true)
    expect(validator.appliesTo({ format: 'image' } as never)).toBe(false)
    const [pass] = await validator.check(asset(ok, { designObject }))
    expect(pass).toMatchObject({ rule: 'size-vs-design', verdict: 'pass', message: '尺寸与设计对象：模型 1.26 × 0.95 × 0.87 m · 目标 1.26 × 0.95 × 0.87 m' })
    const [fail] = await validator.check(asset(wide, { designObject }))
    expect(fail).toMatchObject({ verdict: 'fail' })
    expect(fail!.message).toContain('宽 1.30 m，应为 1.26')
    expect((fail!.values as { axes: Array<{ ok: boolean }> }).axes.map(a => a.ok)).toEqual([false, true, true])
  })

  it('gives no result without a target size, or for an FBX the browser has not measured yet', async () => {
    const p = write('check/hero.fbx', asciiFbx([{ name: 'Body', size: [1, 1.8, 0.4] }]))
    expect(await checkSize(asset(path.join(dir, 'check/chest_ok.glb')))).toEqual([])
    const designObject = { id: '00000000-0000-7000-8000-00000000000d', targetSize: { w: 1, h: 1.8, d: 0.4 } }
    expect(await checkSize(asset(p, { designObject }))).toEqual([])
    const measured = await checkSize(asset(p, { designObject, tech: { boundsX: 1, boundsY: 1.8, boundsZ: 0.4 } }))
    expect(measured[0]).toMatchObject({ verdict: 'pass' })
  })
})
