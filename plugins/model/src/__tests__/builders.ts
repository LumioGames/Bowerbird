/**
 * Test data made on the spot (no third-party model files): a GLB / glTF writer, a PNG encoder, and ASCII and
 * binary FBX writers that produce the structures three's FBXLoader reads.
 */
import { deflateSync } from 'node:zlib'

/* ───────────── PNG ───────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** A real RGBA PNG; `pixel(x, y)` returns [r, g, b, a]. */
export function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number] = () => [200, 120, 60, 255]): Uint8Array {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) { const p = pixel(x, y); raw.set(p, y * (w * 4 + 1) + 1 + x * 4) }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]))
}
/** Only a PNG header claiming a size (enough for header readers; not decodable). */
export function pngHeader(w: number, h: number): Uint8Array {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)]))
}

/* ───────────── glTF ───────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
export class GltfBuilder {
  json: any = { asset: { version: '2.0', generator: 'bowerbird-test' }, buffers: [], bufferViews: [], accessors: [], meshes: [], nodes: [], scenes: [{ nodes: [] }], scene: 0, materials: [], textures: [], images: [], samplers: [] }
  private parts: Uint8Array[] = []
  private length = 0

  private push(bytes: Uint8Array): { byteOffset: number; byteLength: number } {
    const pad = (4 - (this.length % 4)) % 4
    if (pad) { this.parts.push(new Uint8Array(pad)); this.length += pad }
    const byteOffset = this.length
    this.parts.push(bytes); this.length += bytes.length
    return { byteOffset, byteLength: bytes.length }
  }
  view(bytes: Uint8Array, extra: Record<string, unknown> = {}): number {
    const { byteOffset, byteLength } = this.push(bytes)
    this.json.bufferViews.push({ buffer: 0, byteOffset, byteLength, ...extra })
    return this.json.bufferViews.length - 1
  }
  accessor(data: Float32Array | Uint16Array | Uint8Array, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', opts: { minmax?: boolean; normalized?: boolean } = {}): number {
    const componentType = data instanceof Float32Array ? 5126 : data instanceof Uint16Array ? 5123 : 5121
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]
    const view = this.view(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    const acc: any = { bufferView: view, componentType, count: data.length / size, type }
    if (opts.normalized) acc.normalized = true
    if (opts.minmax) {
      const min = new Array(size).fill(Infinity), max = new Array(size).fill(-Infinity)
      for (let i = 0; i < data.length; i++) { const k = i % size; min[k] = Math.min(min[k], data[i]!); max[k] = Math.max(max[k], data[i]!) }
      acc.min = min; acc.max = max
    }
    this.json.accessors.push(acc)
    return this.json.accessors.length - 1
  }
  /** An axis-aligned box mesh (12 triangles, 24 vertices) of size w×h×d with its base at y = 0. */
  box(w: number, h: number, d: number, opts: { uv?: boolean; normals?: boolean; colors?: number; material?: number; joints?: boolean } = {}): number {
    const x0 = -w / 2, x1 = w / 2, y0 = 0, y1 = h, z0 = -d / 2, z1 = d / 2
    const faces = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]]
    ] as number[][][]
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
    faces.forEach((f, i) => {
      for (let k = 0; k < 4; k++) { pos.push(...f[k]!); nor.push(...f[4]!) }
      uv.push(0, 1, 1, 1, 1, 0, 0, 0)
      const b = i * 4
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
    })
    const attributes: any = { POSITION: this.accessor(new Float32Array(pos), 'VEC3', { minmax: true }) }
    if (opts.normals !== false) attributes.NORMAL = this.accessor(new Float32Array(nor), 'VEC3')
    if (opts.uv !== false) attributes.TEXCOORD_0 = this.accessor(new Float32Array(uv), 'VEC2')
    for (let s = 0; s < (opts.colors ?? 0); s++) {
      const c = new Float32Array(24 * 4)
      for (let i = 0; i < 24; i++) c.set([pos[i * 3 + 1]! / h, s * 0.5, 1 - pos[i * 3 + 1]! / h, 1], i * 4)
      attributes[`COLOR_${s}`] = this.accessor(c, 'VEC4')
    }
    if (opts.joints) {
      attributes.JOINTS_0 = this.accessor(new Uint8Array(24 * 4), 'VEC4')
      const wts = new Float32Array(24 * 4); for (let i = 0; i < 24; i++) wts[i * 4] = 1
      attributes.WEIGHTS_0 = this.accessor(wts, 'VEC4')
    }
    const prim: any = { attributes, indices: this.accessor(new Uint16Array(idx), 'SCALAR') }
    if (opts.material !== undefined) prim.material = opts.material
    this.json.meshes.push({ primitives: [prim] })
    return this.json.meshes.length - 1
  }
  node(n: Record<string, unknown>, root = true): number {
    this.json.nodes.push(n)
    const i = this.json.nodes.length - 1
    if (root) this.json.scenes[0].nodes.push(i)
    return i
  }
  image(img: Record<string, unknown>, bytes?: Uint8Array): number {
    const def: any = { ...img }
    if (bytes) def.bufferView = this.view(bytes)
    this.json.images.push(def)
    return this.json.images.length - 1
  }
  texture(source: number): number { this.json.textures.push({ source }); return this.json.textures.length - 1 }
  material(m: Record<string, unknown>): number { this.json.materials.push(m); return this.json.materials.length - 1 }

  binBytes(): Uint8Array {
    const out = new Uint8Array(this.length)
    let o = 0
    for (const p of this.parts) { out.set(p, o); o += p.length }
    return out
  }
  /** A GLB with one BIN chunk. */
  glb(): Uint8Array {
    const bin = this.binBytes()
    const json = structuredClone(this.json)
    json.buffers = [{ byteLength: bin.length }]
    return packGlb(json, bin)
  }
  /** A .gltf document with its buffer in an external file named `binName`. */
  gltf(binName: string): { json: Uint8Array; bin: Uint8Array } {
    const bin = this.binBytes()
    const json = structuredClone(this.json)
    json.buffers = [{ byteLength: bin.length, uri: binName }]
    return { json: new TextEncoder().encode(JSON.stringify(json, null, 2)), bin }
  }
}

export function packGlb(json: unknown, bin: Uint8Array | null): Uint8Array {
  let jb = new TextEncoder().encode(JSON.stringify(json))
  const jpad = (4 - (jb.length % 4)) % 4
  if (jpad) { const t = new Uint8Array(jb.length + jpad).fill(0x20); t.set(jb); jb = t }
  let bb = bin ?? new Uint8Array()
  const bpad = (4 - (bb.length % 4)) % 4
  if (bpad) { const t = new Uint8Array(bb.length + bpad); t.set(bb); bb = t }
  const total = 12 + 8 + jb.length + (bin ? 8 + bb.length : 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true)
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20)
  if (bin) { const o = 20 + jb.length; dv.setUint32(o, bb.length, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bb, o + 8) }
  return out
}

/* ───────────── FBX ───────────── */

export interface FbxBox { name: string; size: [number, number, number]; texture?: string; embed?: Uint8Array }

/** Vertices / polygon indices of a box (6 quads; last index of each polygon is bitwise-negated). */
function boxGeometry(w: number, h: number, d: number) {
  const x = w / 2, z = d / 2
  const v = [-x, 0, z, x, 0, z, x, h, z, -x, h, z, -x, 0, -z, x, 0, -z, x, h, -z, -x, h, -z]
  const quads = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]
  const idx: number[] = []
  for (const q of quads) idx.push(q[0]!, q[1]!, q[2]!, ~q[3]!)
  const uv: number[] = []
  const uvIndex: number[] = []
  for (let i = 0; i < 24; i++) { uv.push((i % 2), (Math.floor(i / 2) % 2)); uvIndex.push(i) }
  return { v, idx, uv, uvIndex }
}

/**
 * An ASCII FBX 7.4 file: boxes with a Phong material each, optional texture (external or packed), and one
 * animation stack — the shape FBXLoader expects (Objects, Connections, GlobalSettings).
 */
export function asciiFbx(boxes: FbxBox[], opts: { unitScale?: number; animation?: string; limbs?: number } = {}): string {
  let id = 1000
  const objs: string[] = []
  const conns: string[] = []
  boxes.forEach((b, i) => {
    const g = boxGeometry(...b.size)
    const gid = ++id, mid = ++id, matid = ++id
    objs.push(`\tGeometry: ${gid}, "Geometry::${b.name}", "Mesh" {
\t\tVertices: *${g.v.length} {
\t\t\ta: ${g.v.join(',')}
\t\t}
\t\tPolygonVertexIndex: *${g.idx.length} {
\t\t\ta: ${g.idx.join(',')}
\t\t}
\t\tGeometryVersion: 124
\t\tLayerElementNormal: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
\t\t\tNormals: *72 {
\t\t\t\ta: ${new Array(24).fill('0,1,0').join(',')}
\t\t\t}
\t\t}
\t\tLayerElementUV: 0 {
\t\t\tVersion: 101
\t\t\tName: "UVMap"
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tUV: *${g.uv.length} {
\t\t\t\ta: ${g.uv.join(',')}
\t\t\t}
\t\t\tUVIndex: *${g.uvIndex.length} {
\t\t\t\ta: ${g.uvIndex.join(',')}
\t\t\t}
\t\t}
\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "AllSame"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *1 {
\t\t\t\ta: 0
\t\t\t}
\t\t}
\t\tLayer: 0 {
\t\t\tVersion: 100
\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementNormal"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementUV"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementMaterial"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t}
\t}
\tModel: ${mid}, "Model::${b.name}", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${i * 150},0,0
\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}
\tMaterial: ${matid}, "Material::M_${b.name}", "" {
\t\tVersion: 102
\t\tShadingModel: "phong"
\t\tMultiLayer: 0
\t\tProperties70:  {
\t\t\tP: "DiffuseColor", "Color", "", "A",0.8,0.5,0.3
\t\t\tP: "Shininess", "double", "Number", "",20
\t\t}
\t}`)
    conns.push(`\tC: "OO",${mid},0`, `\tC: "OO",${gid},${mid}`, `\tC: "OO",${matid},${mid}`)
    if (b.texture) {
      const tid = ++id, vid = ++id
      objs.push(`\tTexture: ${tid}, "Texture::${b.name}_tex", "" {
\t\tType: "TextureVideoClip"
\t\tVersion: 202
\t\tTextureName: "Texture::${b.name}_tex"
\t\tMedia: "Video::${b.name}_tex"
\t\tFileName: "C:\\\\art\\\\${b.texture}"
\t\tRelativeFilename: "${b.texture}"
\t}
\tVideo: ${vid}, "Video::${b.name}_tex", "Clip" {
\t\tType: "Clip"
\t\tFilename: "C:\\\\art\\\\${b.texture}"
\t\tRelativeFilename: "${b.texture}"${b.embed ? `\n\t\tContent: , "${Buffer.from(b.embed).toString('base64')}"` : ''}
\t}`)
      conns.push(`\tC: "OP",${tid},${matid}, "DiffuseColor"`, `\tC: "OO",${vid},${tid}`)
    }
  })
  for (let k = 0; k < (opts.limbs ?? 0); k++) {
    const lid = ++id
    objs.push(`\tModel: ${lid}, "Model::Bone${k}", "LimbNode" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,${k * 10},0
\t\t}
\t}`)
    conns.push(`\tC: "OO",${lid},0`)
  }
  if (opts.animation) {
    const sid = ++id, lid = ++id
    objs.push(`\tAnimationStack: ${sid}, "AnimStack::${opts.animation}", "" {
\t\tProperties70:  {
\t\t\tP: "LocalStop", "KTime", "Time", "",46186158000
\t\t}
\t}
\tAnimationLayer: ${lid}, "AnimLayer::BaseLayer", "" {
\t}`)
    conns.push(`\tC: "OO",${lid},${sid}`)
  }
  return `; FBX 7.4.0 project file
; Made by the bowerbird.model tests
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreator: "bowerbird-test"
}
GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",${opts.unitScale ?? 1}
\t}
}
Objects:  {
${objs.join('\n')}
}
Connections:  {
${conns.join('\n')}
}
`
}

/* binary FBX writer (FBX 7.4, 32-bit offsets) */

type BProp = { t: 'I'; v: number } | { t: 'L'; v: number } | { t: 'D'; v: number } | { t: 'S'; v: string } | { t: 'R'; v: Uint8Array } | { t: 'd' | 'i'; v: number[]; z?: boolean }
export interface BNode { name: string; props?: BProp[]; children?: BNode[] }

function encodeProp(p: BProp): Buffer {
  switch (p.t) {
    case 'I': { const b = Buffer.alloc(5); b.write('I', 0, 'latin1'); b.writeInt32LE(p.v, 1); return b }
    case 'L': { const b = Buffer.alloc(9); b.write('L', 0, 'latin1'); b.writeBigInt64LE(BigInt(p.v), 1); return b }
    case 'D': { const b = Buffer.alloc(9); b.write('D', 0, 'latin1'); b.writeDoubleLE(p.v, 1); return b }
    case 'S': { const s = Buffer.from(p.v, 'utf8'); const b = Buffer.alloc(5); b.write('S', 0, 'latin1'); b.writeUInt32LE(s.length, 1); return Buffer.concat([b, s]) }
    case 'R': { const b = Buffer.alloc(5); b.write('R', 0, 'latin1'); b.writeUInt32LE(p.v.length, 1); return Buffer.concat([b, Buffer.from(p.v)]) }
    default: {
      const raw = p.t === 'd' ? Buffer.from(new Float64Array(p.v).buffer) : Buffer.from(new Int32Array(p.v).buffer)
      const data = p.z ? deflateSync(raw) : raw
      const b = Buffer.alloc(13); b.write(p.t, 0, 'latin1'); b.writeUInt32LE(p.v.length, 1); b.writeUInt32LE(p.z ? 1 : 0, 5); b.writeUInt32LE(data.length, 9)
      return Buffer.concat([b, data])
    }
  }
}

function encodeNode(n: BNode, offset: number): Buffer {
  const props = Buffer.concat((n.props ?? []).map(encodeProp))
  const name = Buffer.from(n.name, 'latin1')
  const headLen = 13 + name.length
  let pos = offset + headLen + props.length
  const kids: Buffer[] = []
  for (const c of n.children ?? []) { const e = encodeNode(c, pos); kids.push(e); pos += e.length }
  if (n.children?.length) { kids.push(Buffer.alloc(13)); pos += 13 }
  const head = Buffer.alloc(13)
  head.writeUInt32LE(pos, 0); head.writeUInt32LE((n.props ?? []).length, 4); head.writeUInt32LE(props.length, 8); head[12] = name.length
  return Buffer.concat([head, name, props, ...kids])
}

export function binaryFbx(nodes: BNode[], version = 7400): Uint8Array {
  const header = Buffer.alloc(27)
  header.write('Kaydara FBX Binary  ', 0, 'latin1'); header[20] = 0; header[21] = 0x1a; header[22] = 0; header.writeUInt32LE(version, 23)
  const parts: Buffer[] = [header]
  let pos = 27
  for (const n of nodes) { const e = encodeNode(n, pos); parts.push(e); pos += e.length }
  parts.push(Buffer.alloc(13))
  return new Uint8Array(Buffer.concat(parts))
}

/** A binary FBX with one box mesh (compressed index array), two materials, one packed texture, two bones, one stack. */
export function sampleBinaryFbx(embedded: Uint8Array): Uint8Array {
  const g = boxGeometry(1, 2, 0.5)
  return binaryFbx([
    { name: 'FBXHeaderExtension', children: [{ name: 'FBXVersion', props: [{ t: 'I', v: 7400 }] }] },
    { name: 'GlobalSettings', children: [{ name: 'Properties70', children: [{ name: 'P', props: [{ t: 'S', v: 'UnitScaleFactor' }, { t: 'S', v: 'double' }, { t: 'S', v: 'Number' }, { t: 'S', v: '' }, { t: 'D', v: 100 }] }] }] },
    {
      name: 'Objects', children: [
        { name: 'Geometry', props: [{ t: 'L', v: 11 }, { t: 'S', v: 'Box\u0000\u0001Geometry' }, { t: 'S', v: 'Mesh' }], children: [
          { name: 'Vertices', props: [{ t: 'd', v: g.v }] },
          { name: 'PolygonVertexIndex', props: [{ t: 'i', v: g.idx, z: true }] },
          { name: 'LayerElementNormal', props: [{ t: 'I', v: 0 }] },
          { name: 'LayerElementColor', props: [{ t: 'I', v: 0 }] },
          { name: 'LayerElementColor', props: [{ t: 'I', v: 1 }] }
        ] },
        { name: 'Model', props: [{ t: 'L', v: 12 }, { t: 'S', v: 'Box\u0000\u0001Model' }, { t: 'S', v: 'Mesh' }] },
        { name: 'Model', props: [{ t: 'L', v: 13 }, { t: 'S', v: 'Hips\u0000\u0001Model' }, { t: 'S', v: 'LimbNode' }] },
        { name: 'Model', props: [{ t: 'L', v: 14 }, { t: 'S', v: 'Spine\u0000\u0001Model' }, { t: 'S', v: 'LimbNode' }] },
        { name: 'Material', props: [{ t: 'L', v: 15 }, { t: 'S', v: 'M_Skin\u0000\u0001Material' }, { t: 'S', v: '' }] },
        { name: 'Material', props: [{ t: 'L', v: 16 }, { t: 'S', v: 'M_Cloth\u0000\u0001Material' }, { t: 'S', v: '' }] },
        { name: 'Texture', props: [{ t: 'L', v: 17 }, { t: 'S', v: 'skin\u0000\u0001Texture' }, { t: 'S', v: '' }], children: [
          { name: 'FileName', props: [{ t: 'S', v: 'D:\\work\\hero_skin.png' }] },
          { name: 'RelativeFilename', props: [{ t: 'S', v: 'textures\\hero_skin.png' }] }
        ] },
        { name: 'Video', props: [{ t: 'L', v: 18 }, { t: 'S', v: 'skin\u0000\u0001Video' }, { t: 'S', v: 'Clip' }], children: [
          { name: 'RelativeFilename', props: [{ t: 'S', v: 'textures\\hero_skin.png' }] },
          { name: 'Content', props: [{ t: 'R', v: embedded }] }
        ] },
        { name: 'Texture', props: [{ t: 'L', v: 19 }, { t: 'S', v: 'cloth\u0000\u0001Texture' }, { t: 'S', v: '' }], children: [
          { name: 'FileName', props: [{ t: 'S', v: 'D:\\work\\hero_cloth.png' }] }
        ] },
        { name: 'AnimationStack', props: [{ t: 'L', v: 20 }, { t: 'S', v: 'walk\u0000\u0001AnimStack' }, { t: 'S', v: '' }] }
      ]
    }
  ])
}
