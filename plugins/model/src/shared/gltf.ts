/**
 * glTF 2.0 / GLB reading without three.js: the JSON (and BIN chunk) give counts, bounds (accessor min/max with
 * node transforms, skinned meshes in their bind pose), texture sizes from image headers, and every slot name
 * written in the file (ADR-018). Used by the server probe, the validator and the summary. Pure.
 */
import { embeddedImageSlot, uriSlot } from './slots.js'
import { imageSize } from './image-size.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

/** Random-access bytes: a whole file in memory, or ranges read from disk (big GLBs are not read whole). */
export interface ByteSource { size: number; read(offset: number, length: number): Promise<Uint8Array> }

export function bytesSource(b: Uint8Array): ByteSource {
  return { size: b.length, read: async (o, n) => b.subarray(o, Math.min(b.length, o + n)) }
}

function sliceSource(src: ByteSource, start: number, size: number): ByteSource {
  return { size, read: (o, n) => src.read(start + o, Math.max(0, Math.min(n, size - o))) }
}

export interface GltfContainer { json: Json; bin: ByteSource | null; binary: boolean }

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

export function isGlb(b: Uint8Array): boolean {
  return b.length >= 12 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46
}

/** Looks like a glTF JSON document (has an `asset` with a version near the start). */
export function looksLikeGltfJson(b: Uint8Array): boolean {
  const head = new TextDecoder('utf-8').decode(b.subarray(0, Math.min(b.length, 65536)))
  return /^\s*\{/.test(head) && /"asset"\s*:/.test(head)
}

/** Largest JSON (a .gltf file, or a GLB's JSON chunk) read; real files are far smaller, geometry lives in buffers. */
export const MAX_GLTF_JSON_BYTES = 64 * 1024 * 1024

function parseJson(bytes: Uint8Array): Json {
  const json = JSON.parse(new TextDecoder('utf-8').decode(bytes))
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('not a glTF document')
  return json
}

/** Open a GLB or a glTF JSON document; for a GLB only the header and the JSON chunk are read. */
export async function openGltf(src: ByteSource, opts: { maxJsonBytes?: number } = {}): Promise<GltfContainer> {
  const maxJson = opts.maxJsonBytes ?? MAX_GLTF_JSON_BYTES
  const head = await src.read(0, Math.min(src.size, 20))
  if (isGlb(head)) {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
    if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file')
    const version = dv.getUint32(4, true)
    if (version !== 2) throw new Error(`GLB version ${version} is not supported`)
    const length = Math.min(dv.getUint32(8, true), src.size)
    let o = 12
    let json: Json = null
    let bin: ByteSource | null = null
    while (o + 8 <= length) {
      const ch = await src.read(o, 8)
      const cdv = new DataView(ch.buffer, ch.byteOffset, ch.byteLength)
      const clen = cdv.getUint32(0, true)
      const ctype = cdv.getUint32(4, true)
      if (o + 8 + clen > length) throw new Error('GLB chunk runs past the end of the file')
      if (ctype === CHUNK_JSON && json === null) {
        if (clen > maxJson) throw new Error(`GLB JSON chunk too large (${clen} bytes)`)
        json = parseJson(await src.read(o + 8, clen))
      } else if (ctype === CHUNK_BIN && bin === null) bin = sliceSource(src, o + 8, clen)
      o += 8 + clen + ((4 - (clen % 4)) % 4)
    }
    if (!json) throw new Error('GLB has no JSON chunk')
    return { json, bin, binary: true }
  }
  if (src.size > maxJson) throw new Error(`glTF JSON too large (${src.size} bytes)`)
  const json = parseJson(await src.read(0, src.size))
  if (!json.asset) throw new Error('not a glTF document')
  return { json, bin: null, binary: false }
}

export function readGltfContainer(bytes: Uint8Array, opts: { maxJsonBytes?: number } = {}): Promise<GltfContainer> { return openGltf(bytesSource(bytes), opts) }

/* ───────────── small matrix helpers (column-major 4×4) ───────────── */

export type Mat4 = number[]
export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

export function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!
    out[c * 4 + r] = s
  }
  return out
}

export function compose(t: number[] = [0, 0, 0], q: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q as [number, number, number, number]
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2
  const [sx, sy, sz] = s as [number, number, number]
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0]!, t[1]!, t[2]!, 1
  ]
}

export function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w
  ]
}

function vec(v: unknown, n: number): number[] | undefined {
  return Array.isArray(v) && v.length === n ? v.map(Number) : undefined
}

function localMatrix(node: Json): Mat4 {
  const m = vec(node.matrix, 16)
  if (m) return m
  return compose(vec(node.translation, 3), vec(node.rotation, 4), vec(node.scale, 3))
}

/* ───────────── info ───────────── */

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

export interface GltfImageInfo {
  index: number
  /** Slot name (external URI or packed image name); null for unnamed packed images and data URIs. */
  slot: string | null
  embedded: boolean
  width?: number
  height?: number
  /** What the materials use it for, e.g. 基础色, 法线, 遮蔽 · 粗糙 · 金属. */
  use: string
}

export interface GltfInfo {
  binary: boolean
  triangles: number
  vertices: number
  meshes: number
  materials: number
  textures: number
  maxTextureSize: number
  bones: number
  animations: number
  hasUV: boolean
  hasNormals: boolean
  hasVertexColors: boolean
  vertexColorSets: number
  bounds: Bounds | null
  materialNames: string[]
  clipNames: string[]
  images: GltfImageInfo[]
  /** Every slot name in the file: external buffers and images, named packed images (ADR-018). */
  references: string[]
  /** The subset of `references` that are packed inside the file. */
  embedded: string[]
  /** External buffers that could not be read (bounds of skinned meshes then fall back to node transforms). */
  missingBuffers: string[]
}

const COMPONENT_MAX: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }

/** A byte offset, length or stride from the file: a non-negative whole number. */
function isCount(v: unknown): v is number { return Number.isSafeInteger(v) && (v as number) >= 0 }

function decodeDataUri(uri: string): Uint8Array | null {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(uri)
  if (!m) return null
  try {
    if (m[1]) {
      const bin = atob(m[2]!)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
    return new TextEncoder().encode(decodeURIComponent(m[2]!))
  } catch { return null }
}

/** The texture's image index, including the common image-format extensions. */
function textureSource(tex: Json): number | undefined {
  if (!tex) return undefined
  const ext = tex.extensions ?? {}
  for (const k of ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']) if (typeof ext[k]?.source === 'number') return ext[k].source
  return typeof tex.source === 'number' ? tex.source : undefined
}

/** Which images each material slot uses (by image index): 基础色 / 法线 / 遮蔽 / 粗糙 · 金属 / 自发光. */
const COLLECTIONS = ['accessors', 'bufferViews', 'buffers', 'meshes', 'nodes', 'images', 'materials', 'textures', 'skins', 'animations', 'scenes', 'samplers']
function objects(v: unknown): Json[] {
  return Array.isArray(v) ? v.map(x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {})) : []
}

/** Top-level collections as arrays of objects, primitives with attributes, skins with integer joints — whatever the file holds. */
export function sanitizeGltf(json: Json): Json {
  const out: Json = { ...json }
  for (const k of COLLECTIONS) out[k] = objects(json[k])
  out.meshes = out.meshes.map((m: Json) => ({ ...m, primitives: objects(m.primitives).map((p: Json) => ({ ...p, attributes: p.attributes && typeof p.attributes === 'object' ? p.attributes : {} })) }))
  out.skins = out.skins.map((s: Json) => ({ ...s, joints: Array.isArray(s.joints) ? s.joints.filter((j: unknown) => Number.isInteger(j)) : [] }))
  return out
}

/** What a texture is used for: base colour, normal, occlusion + metal-roughness packed (ORM), and so on. */
export type ImageRole = 'base' | 'normal' | 'orm' | 'ao' | 'mr' | 'emit'

/** The roles of each image (by image index), from what the materials bind; a packed ORM image reads `orm`. */
export function imageRoles(source: Json): Map<number, ImageRole[]> {
  const json = sanitizeGltf(source)
  const roles = new Map<number, Set<string>>()
  const add = (texInfo: Json, role: string) => {
    if (!texInfo || typeof texInfo.index !== 'number') return
    const src = textureSource(json.textures?.[texInfo.index])
    if (src === undefined) return
    if (!roles.has(src)) roles.set(src, new Set())
    roles.get(src)!.add(role)
  }
  for (const m of json.materials ?? []) {
    add(m.pbrMetallicRoughness?.baseColorTexture, 'base')
    add(m.pbrMetallicRoughness?.metallicRoughnessTexture, 'mr')
    add(m.normalTexture, 'normal')
    add(m.occlusionTexture, 'ao')
    add(m.emissiveTexture, 'emit')
  }
  const out = new Map<number, ImageRole[]>()
  for (const [i, set] of roles) {
    const parts: ImageRole[] = []
    if (set.has('base')) parts.push('base')
    if (set.has('normal')) parts.push('normal')
    if (set.has('ao') && set.has('mr')) parts.push('orm')
    else { if (set.has('ao')) parts.push('ao'); if (set.has('mr')) parts.push('mr') }
    if (set.has('emit')) parts.push('emit')
    out.set(i, parts)
  }
  return out
}

const ROLE_ZH: Record<ImageRole, string> = { base: '基础色', normal: '法线', orm: '遮蔽 · 粗糙 · 金属', ao: '遮蔽', mr: '粗糙 · 金属', emit: '自发光' }

/** The same in words, for the agent summary: 基础色, 法线, 遮蔽 · 粗糙 · 金属 … */
export function imageUses(source: Json): Map<number, string> {
  const out = new Map<number, string>()
  for (const [i, roles] of imageRoles(source)) out.set(i, roles.map(r => ROLE_ZH[r]).join(' · '))
  return out
}

export async function gltfInfo(c: GltfContainer, readSlot: (slot: string) => Promise<Uint8Array | null>): Promise<GltfInfo> {
  const json = sanitizeGltf(c.json)
  const accessors: Json[] = json.accessors ?? []
  const bufferViews: Json[] = json.bufferViews ?? []
  const meshes: Json[] = json.meshes ?? []
  const nodes: Json[] = json.nodes ?? []
  const references: string[] = []
  const embedded: string[] = []
  const missingBuffers: string[] = []
  const addRef = (s: string | null, packed = false) => {
    if (!s) return
    if (!references.includes(s)) references.push(s)
    if (packed && !embedded.includes(s)) embedded.push(s)
  }

  /* buffers */
  const bufferData = new Map<number, Promise<ByteSource | null>>()
  const buffers: Json[] = json.buffers ?? []
  for (const b of buffers) if (typeof b.uri === 'string') addRef(uriSlot(b.uri))
  function buffer(i: number): Promise<ByteSource | null> {
    if (!bufferData.has(i)) {
      const b = buffers[i]
      bufferData.set(i, (async () => {
        if (!b) return null
        if (b.uri === undefined) return i === 0 ? c.bin : null
        if (typeof b.uri !== 'string') return null
        if (/^data:/i.test(b.uri)) { const d = decodeDataUri(b.uri); return d ? bytesSource(d) : null }
        const slot = uriSlot(b.uri)
        const data = slot ? await readSlot(slot).catch(() => null) : null
        if (!data && slot) missingBuffers.push(slot)
        return data ? bytesSource(data) : null
      })())
    }
    return bufferData.get(i)!
  }
  /**
   * Bytes of a buffer view (or of its first `limit` bytes — image headers need only the start). Offsets and
   * lengths come from the file: they must be whole numbers, and the view must lie inside its buffer.
   */
  async function viewBytes(v: number, limit = Infinity): Promise<Uint8Array | null> {
    const bv = Number.isInteger(v) ? bufferViews[v] : undefined
    if (!bv || !Number.isInteger(bv.buffer)) return null
    const off = bv.byteOffset ?? 0, len = bv.byteLength
    if (!isCount(off) || !isCount(len)) return null
    const data = await buffer(bv.buffer)
    if (!data || off + len > data.size) return null
    return data.read(off, Math.min(len, limit))
  }
  /**
   * The first inverse bind matrix of a skin — the only one the bind pose needs. The accessor's offset and the
   * view's stride are checked against the view; its count only has to be at least one.
   */
  async function firstMat4(accessorIndex: number): Promise<Mat4 | null> {
    const a = Number.isInteger(accessorIndex) ? accessors[accessorIndex] : undefined
    if (!a || a.type !== 'MAT4' || a.componentType !== 5126 || !Number.isInteger(a.bufferView) || !(a.count >= 1)) return null
    const bv = bufferViews[a.bufferView]
    if (!bv) return null
    const stride = bv.byteStride
    if (stride !== undefined && stride !== 0 && (!isCount(stride) || stride < 64)) return null
    const base = a.byteOffset ?? 0
    if (!isCount(base) || base + 64 > (bv.byteLength ?? 0)) return null
    const bytes = await viewBytes(a.bufferView, base + 64)
    if (!bytes || bytes.length < base + 64) return null
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const m: number[] = []
    for (let k = 0; k < 16; k++) m.push(dv.getFloat32(base + k * 4, true))
    return m.every(Number.isFinite) ? m : null
  }

  /* images */
  const uses = imageUses(json)
  const images: GltfImageInfo[] = []
  let maxTextureSize = 0
  for (const [index, img] of ((json.images ?? []) as Json[]).entries()) {
    let slot: string | null = null
    let packed = false
    let bytes: Uint8Array | null = null
    if (img.bufferView !== undefined) {
      packed = true
      slot = embeddedImageSlot(img)
      addRef(slot, true)
      bytes = await viewBytes(img.bufferView, 256 * 1024)
    } else if (typeof img.uri === 'string') {
      if (/^data:/i.test(img.uri)) { packed = true; bytes = decodeDataUri(img.uri) }
      else { slot = uriSlot(img.uri); addRef(slot); bytes = slot ? await readSlot(slot).catch(() => null) : null }
    }
    const size = bytes ? imageSize(bytes) : null
    if (size) maxTextureSize = Math.max(maxTextureSize, size.width, size.height)
    images.push({ index, slot, embedded: packed, ...(size ? { width: size.width, height: size.height } : {}), use: uses.get(index) ?? '' })
  }

  /* scene graph: instances, counts, bounds */
  let triangles = 0, vertices = 0, meshInstances = 0
  let hasUV = false, hasNormals = false, hasVertexColors = false, vertexColorSets = 0
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const worlds = new Map<number, Mat4>()

  const childrenOf = (n: Json): number[] => (Array.isArray(n?.children) ? n.children.filter((c: unknown) => Number.isInteger(c) && (c as number) >= 0 && (c as number) < nodes.length) : [])
  const childSet = new Set<number>()
  nodes.forEach(n => childrenOf(n).forEach(ch => childSet.add(ch)))
  let roots: number[]
  const scene = json.scenes?.[json.scene ?? 0]
  if (scene && Array.isArray(scene.nodes)) roots = scene.nodes.filter((r: unknown) => Number.isInteger(r) && (r as number) >= 0 && (r as number) < nodes.length)
  else roots = nodes.map((_, i) => i).filter(i => !childSet.has(i))

  // The hierarchy is a forest (glTF 2.0 §3.5.1): each node is placed once. A node listed again — a cycle, or a
  // second parent — is skipped, so the walk is linear in the node count whatever the file says.
  const stack: Array<[number, Mat4]> = roots.slice().reverse().map(r => [r, IDENTITY])
  while (stack.length) {
    const [i, parent] = stack.pop()!
    if (worlds.has(i)) continue
    const n = nodes[i]
    if (!n || typeof n !== 'object') continue
    const w = mul(parent, localMatrix(n))
    worlds.set(i, w)
    const kids = childrenOf(n)
    for (let k = kids.length - 1; k >= 0; k--) if (!worlds.has(kids[k]!)) stack.push([kids[k]!, w])
  }

  const primitiveCounts = (p: Json) => {
    const pos = accessors[p.attributes?.POSITION]
    const count = p.indices !== undefined ? accessors[p.indices]?.count ?? 0 : pos?.count ?? 0
    const mode = p.mode ?? 4
    const tris = mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0
    return { tris, verts: pos?.count ?? 0 }
  }
  const expand = (m: Mat4, p: Json) => {
    const pos = accessors[p.attributes?.POSITION]
    if (!pos || !Array.isArray(pos.min) || !Array.isArray(pos.max)) return
    let lo = pos.min.map(Number), hi = pos.max.map(Number)
    if (pos.normalized && COMPONENT_MAX[pos.componentType]) {
      const k = COMPONENT_MAX[pos.componentType]!
      lo = lo.map((v: number) => Math.max(v / k, -1)); hi = hi.map((v: number) => Math.max(v / k, -1))
    }
    for (let k = 0; k < 8; k++) {
      const q = transformPoint(m, [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]])
      for (let a = 0; a < 3; a++) { if (q[a]! < min[a]!) min[a] = q[a]!; if (q[a]! > max[a]!) max[a] = q[a]! }
    }
  }
  const flags = (p: Json) => {
    const at = p.attributes ?? {}
    if (at.TEXCOORD_0 !== undefined) hasUV = true
    if (at.NORMAL !== undefined) hasNormals = true
    let sets = 0
    while (at[`COLOR_${sets}`] !== undefined) sets++
    if (sets) { hasVertexColors = true; vertexColorSets = Math.max(vertexColorSets, sets) }
  }

  const skinMatrix = new Map<number, Promise<Mat4 | null>>()
  const bindMatrix = (skinIndex: number): Promise<Mat4 | null> => {
    if (!skinMatrix.has(skinIndex)) {
      skinMatrix.set(skinIndex, (async () => {
        const skin = json.skins?.[skinIndex]
        if (!skin || !Array.isArray(skin.joints) || !skin.joints.length) return null
        const j0 = skin.joints[0]
        const jw = worlds.get(j0)
        if (!jw) return null
        if (skin.inverseBindMatrices === undefined) return jw
        const ibm = await firstMat4(skin.inverseBindMatrices)
        return ibm ? mul(jw, ibm) : null
      })())
    }
    return skinMatrix.get(skinIndex)!
  }

  const instanced = [...worlds.entries()].filter(([i]) => nodes[i]?.mesh !== undefined)
  if (instanced.length) {
    for (const [i, w] of instanced) {
      const n = nodes[i]
      const mesh = meshes[n.mesh]
      if (!mesh) continue
      meshInstances++
      let m = w
      if (n.skin !== undefined) m = (await bindMatrix(n.skin)) ?? w
      for (const p of mesh.primitives ?? []) {
        const pc = primitiveCounts(p)
        triangles += pc.tris; vertices += pc.verts
        expand(m, p); flags(p)
      }
    }
  } else {
    for (const mesh of meshes) {
      meshInstances++
      for (const p of mesh.primitives ?? []) { const pc = primitiveCounts(p); triangles += pc.tris; vertices += pc.verts; expand(IDENTITY, p); flags(p) }
    }
  }

  const joints = new Set<number>()
  for (const s of json.skins ?? []) for (const j of s.joints ?? []) joints.add(j)

  const bounds = Number.isFinite(min[0]) ? { min, max } : null
  return {
    binary: c.binary,
    triangles, vertices, meshes: meshInstances,
    materials: (json.materials ?? []).length,
    textures: images.length,
    maxTextureSize,
    bones: joints.size,
    animations: (json.animations ?? []).length,
    hasUV, hasNormals, hasVertexColors, vertexColorSets,
    bounds,
    materialNames: ((json.materials ?? []) as Json[]).map((m, i) => (typeof m.name === 'string' && m.name) || `材质 ${i + 1}`),
    clipNames: ((json.animations ?? []) as Json[]).map((a, i) => (typeof a.name === 'string' && a.name) || `动画 ${i + 1}`),
    images, references, embedded, missingBuffers
  }
}

/** Size of the bounds in metres, rounded to 0.1 mm. */
export function boundsSize(b: Bounds | null): { x: number; y: number; z: number } | null {
  if (!b) return null
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  return { x: r(b.max[0] - b.min[0]), y: r(b.max[1] - b.min[1]), z: r(b.max[2] - b.min[2]) }
}

