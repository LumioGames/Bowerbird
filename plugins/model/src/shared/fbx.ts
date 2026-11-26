/**
 * A light FBX reader (binary and ASCII, FBX 7.x): enough to count geometry, materials, textures, bones and
 * animation stacks, and to find the texture file names (slots) and packed images. Full information comes from
 * the browser after the FBXLoader has parsed the file (builtin-plugins.md「FBX 在服务端只做轻量解析」).
 *
 * The file is untrusted: every offset, length and count in it is checked before use, nesting and record counts are
 * limited, and compressed arrays are decompressed to at most the size they declare (review P1-1, P1-2).
 * Pure: zlib is injected (node:zlib on the server, fflate in the browser).
 */
import { fbxSlot } from './slots.js'
import { imageSize } from './image-size.js'

/**
 * Decompress zlib `data` into at most `maxOutput` bytes; throw (or return fewer bytes) when it would be more.
 * The caller always knows the size: element count × element size. Node: `inflateSync(d, { maxOutputLength })`.
 */
export type Inflate = (data: Uint8Array, maxOutput: number) => Uint8Array

export interface FbxArray {
  kind: 'array'
  type: string
  /** Element count as the file states it (0 when that statement cannot be true). */
  length: number
  /** The count fits the bytes that carry it (raw: fits; zlib: within deflate's maximum ratio). */
  plausible: boolean
  values(): ArrayLike<number> | null
}
export type FbxProp = number | string | boolean | Uint8Array | FbxArray
export interface FbxNode { name: string; props: FbxProp[]; children: FbxNode[] }
export interface FbxDocument {
  binary: boolean
  version: number
  nodes: FbxNode[]
  /** Only the head of the file was read (size limit): records past it are missing. */
  truncated?: boolean
}

/** A file that cannot be the FBX it claims to be (offsets out of range, nested too deep, too many records). */
export class FbxParseError extends Error {
  constructor(message: string) { super(`FBX: ${message}`); this.name = 'FbxParseError' }
}

/** Limits no real file reaches. */
export const FBX_LIMITS = {
  maxNodes: 5_000_000,
  maxDepth: 64,
  /** Decompressed bytes of one array, and of all the arrays read from one file. */
  maxArrayBytes: 256 * 1024 * 1024,
  maxTotalArrayBytes: 512 * 1024 * 1024
}

/** Deflate cannot shrink data by more than about 1032:1, so a larger claim is false. */
const MAX_DEFLATE_RATIO = 1100
const ELEMENT_SIZE: Record<string, number> = { f: 4, d: 8, i: 4, l: 8, b: 1 }

const BINARY_MAGIC = 'Kaydara FBX Binary  '

export function isBinaryFbx(b: Uint8Array): boolean {
  if (b.length < 27) return false
  for (let i = 0; i < BINARY_MAGIC.length; i++) if (b[i] !== BINARY_MAGIC.charCodeAt(i)) return false
  return true
}

export function isAsciiFbx(b: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 4096)))
  return /;\s*FBX\s+\d/.test(head) || /\bFBXHeaderExtension\s*:/.test(head)
}

export interface ParseOptions {
  /** `bytes` is only the head of a larger file: stop at the first top-level record that runs past it. */
  partial?: boolean
}

/* ───────────── binary ───────────── */

/**
 * A record must end after its own header and inside its parent (and the file); properties must fit in their
 * declared list; arrays in their record. Anything else is an `FbxParseError` — never a loop or a wild read.
 */
export function parseBinaryFbx(bytes: Uint8Array, inflate?: Inflate, opts: ParseOptions = {}): FbxDocument {
  if (bytes.length < 27) throw new FbxParseError('file too short')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = dv.getUint32(23, true)
  const wide = version >= 7500
  const headerLen = wide ? 25 : 13
  const latin1 = new TextDecoder('latin1')
  const utf8 = new TextDecoder('utf-8')
  const budget = { used: 0 }
  let o = 27
  let count = 0

  const u64 = (at: number) => { const v = dv.getBigUint64(at, true); return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v) }

  function readArray(type: string, limit: number): FbxArray {
    if (o + 12 > limit) throw new FbxParseError(`array header past its record at ${o}`)
    const stated = dv.getUint32(o, true)
    const encoding = dv.getUint32(o + 4, true)
    const clen = dv.getUint32(o + 8, true)
    const start = o + 12
    if (start + clen > limit) throw new FbxParseError(`array data past its record at ${o}`)
    o = start + clen
    const raw = bytes.subarray(start, start + clen)
    const size = ELEMENT_SIZE[type]!
    const bytesNeeded = stated * size
    const plausible = encoding === 0 ? clen >= bytesNeeded : encoding === 1 ? bytesNeeded <= clen * MAX_DEFLATE_RATIO : false
    let cache: ArrayLike<number> | null | undefined
    return {
      kind: 'array', type, length: plausible ? stated : 0, plausible,
      values() {
        if (cache !== undefined) return cache
        cache = null
        if (!plausible || bytesNeeded > FBX_LIMITS.maxArrayBytes || budget.used + bytesNeeded > FBX_LIMITS.maxTotalArrayBytes) return null
        let data: Uint8Array
        if (encoding === 0) data = raw.subarray(0, bytesNeeded)
        else if (!inflate) return null
        else if (bytesNeeded === 0) data = new Uint8Array(0)
        else {
          try { data = inflate(raw, bytesNeeded) } catch { return null }
          if (data.length < bytesNeeded) return null
        }
        budget.used += bytesNeeded
        // a view when the bytes are aligned; one copy otherwise (never a second one)
        const aligned = data.byteOffset % size === 0 ? data : data.slice(0, bytesNeeded)
        const buf = aligned.buffer, off = aligned.byteOffset
        switch (type) {
          case 'f': return (cache = new Float32Array(buf, off, stated))
          case 'd': return (cache = new Float64Array(buf, off, stated))
          case 'i': return (cache = new Int32Array(buf, off, stated))
          case 'l': { const v = new BigInt64Array(buf, off, stated); const out = new Float64Array(stated); for (let i = 0; i < stated; i++) out[i] = Number(v[i]); return (cache = out) }
          case 'b': return (cache = aligned.subarray(0, stated))
          default: return null
        }
      }
    }
  }

  function need(n: number, limit: number): void {
    if (o + n > limit) throw new FbxParseError(`property past its record at ${o}`)
  }

  function readProp(limit: number): FbxProp {
    need(1, limit)
    const t = String.fromCharCode(bytes[o]!)
    o += 1
    switch (t) {
      case 'Y': { need(2, limit); const v = dv.getInt16(o, true); o += 2; return v }
      case 'C': { need(1, limit); const v = bytes[o] !== 0; o += 1; return v }
      case 'I': { need(4, limit); const v = dv.getInt32(o, true); o += 4; return v }
      case 'F': { need(4, limit); const v = dv.getFloat32(o, true); o += 4; return v }
      case 'D': { need(8, limit); const v = dv.getFloat64(o, true); o += 8; return v }
      case 'L': { need(8, limit); const v = Number(dv.getBigInt64(o, true)); o += 8; return v }
      case 'S': { need(4, limit); const n = dv.getUint32(o, true); need(4 + n, limit); const s = utf8.decode(bytes.subarray(o + 4, o + 4 + n)); o += 4 + n; return s }
      case 'R': { need(4, limit); const n = dv.getUint32(o, true); need(4 + n, limit); const r = bytes.subarray(o + 4, o + 4 + n); o += 4 + n; return r }
      case 'f': case 'd': case 'l': case 'i': case 'b': return readArray(t, limit)
      default: throw new FbxParseError(`unknown property type ${JSON.stringify(t)} at ${o - 1}`)
    }
  }

  /** One record inside `limit` (its parent's end, or the file's). Null: the empty record that closes a list. */
  function readNode(depth: number, limit: number): FbxNode | null | 'past' {
    const start = o
    if (o + headerLen > Math.min(limit, bytes.length)) throw new FbxParseError(`record header past its parent at ${o}`)
    const end = wide ? u64(o) : dv.getUint32(o, true)
    const nprops = wide ? u64(o + 8) : dv.getUint32(o + 4, true)
    const plen = wide ? u64(o + 16) : dv.getUint32(o + 8, true)
    const nameLen = bytes[o + headerLen - 1]!
    if (end === 0) { o += headerLen; return null }
    if (end <= start + headerLen) throw new FbxParseError(`record at ${start} ends at ${end}, inside its own header`)
    if (end > limit || end > bytes.length) {
      if (opts.partial && depth === 0 && end > bytes.length) return 'past'
      throw new FbxParseError(`record at ${start} ends at ${end}, past its parent`)
    }
    if (++count > FBX_LIMITS.maxNodes) throw new FbxParseError('too many records')
    if (depth > FBX_LIMITS.maxDepth) throw new FbxParseError('records nested too deep')
    o = start + headerLen
    if (o + nameLen > end) throw new FbxParseError(`record name past its end at ${start}`)
    const name = latin1.decode(bytes.subarray(o, o + nameLen))
    o += nameLen
    const propsEnd = o + plen
    if (propsEnd > end) throw new FbxParseError(`properties of ${name} past its end`)
    if (nprops > plen) throw new FbxParseError(`${name} claims more properties than bytes`)
    const props: FbxProp[] = []
    for (let i = 0; i < nprops; i++) props.push(readProp(propsEnd))
    o = propsEnd
    const children: FbxNode[] = []
    while (o < end) {
      const c = readNode(depth + 1, end)
      if (c === null || c === 'past') break
      children.push(c)
    }
    o = end
    return { name, props, children }
  }

  const nodes: FbxNode[] = []
  let truncated = false
  while (o + headerLen <= bytes.length) {
    const n = readNode(0, opts.partial ? Number.MAX_SAFE_INTEGER : bytes.length)
    if (n === 'past') { truncated = true; break }
    if (!n) break
    nodes.push(n)
  }
  return { binary: true, version, nodes, ...(truncated || opts.partial ? { truncated: true } : {}) }
}

/* ───────────── ASCII ───────────── */

type Tok = { t: 'word' | 'str' | 'num' | 'star' | ',' | ':' | '{' | '}'; v: string }

function tokenize(text: string): Tok[] {
  const out: Tok[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]!
    if (c === ';') { while (i < n && text[i] !== '\n') i++; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue }
    if (c === ',' || c === ':' || c === '{' || c === '}') { out.push({ t: c, v: c }); i++; continue }
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j++
      out.push({ t: 'str', v: text.slice(i + 1, j) })
      i = j + 1
      continue
    }
    if (c === '*') {
      let j = i + 1
      while (j < n && /[0-9]/.test(text[j]!)) j++
      out.push({ t: 'star', v: text.slice(i + 1, j) })
      i = j
      continue
    }
    if (/[-+0-9.]/.test(c)) {
      let j = i + 1
      while (j < n && /[-+0-9.eE]/.test(text[j]!)) j++
      out.push({ t: 'num', v: text.slice(i, j) })
      i = j
      continue
    }
    let j = i + 1
    while (j < n && !/[\s,:{};"]/.test(text[j]!)) j++
    out.push({ t: 'word', v: text.slice(i, j) })
    i = j
  }
  return out
}

function numArray(values: number[]): FbxArray {
  return { kind: 'array', type: 'd', length: values.length, plausible: true, values: () => values }
}

export function parseAsciiFbx(text: string, opts: ParseOptions = {}): FbxDocument {
  const toks = tokenize(text)
  let p = 0
  let count = 0
  const versionMatch = /;\s*FBX\s+(\d+)\.(\d+)\.(\d+)/.exec(text.slice(0, 200))
  const version = versionMatch ? Number(versionMatch[1]) * 1000 + Number(versionMatch[2]) * 100 + Number(versionMatch[3]) : 0

  function isNodeStart(at: number): boolean {
    const a = toks[at], b = toks[at + 1]
    return !!a && !!b && a.t === 'word' && b.t === ':'
  }

  function readProp(): FbxProp {
    const tk = toks[p++]!
    if (tk.t === 'num') return Number(tk.v)
    if (tk.t === 'str') return tk.v
    if (tk.t === 'star') return Number(tk.v)
    return tk.v
  }

  function readNodes(depth: number): FbxNode[] {
    if (depth > FBX_LIMITS.maxDepth) throw new FbxParseError('records nested too deep')
    const nodes: FbxNode[] = []
    while (p < toks.length) {
      const tk = toks[p]!
      if (tk.t === '}') { p++; break }
      if (!isNodeStart(p)) { p++; continue }
      if (++count > FBX_LIMITS.maxNodes) throw new FbxParseError('too many records')
      const name = tk.v
      p += 2
      const props: FbxProp[] = []
      let star = false
      const propStart = (at: number) => !!toks[at] && toks[at]!.t !== '{' && toks[at]!.t !== '}' && toks[at]!.t !== ',' && !isNodeStart(at)
      if (propStart(p)) {
        if (toks[p]!.t === 'star') star = true
        props.push(readProp())
      }
      // `Content: , "…base64…"` starts with a comma
      while (toks[p]?.t === ',') { p++; if (propStart(p)) props.push(readProp()) }
      let children: FbxNode[] = []
      if (toks[p]?.t === '{') { p++; children = readNodes(depth + 1) }
      if (star) {
        const a = children.find(c => c.name === 'a')
        const vals = a ? (a.props.filter(x => typeof x === 'number') as number[]) : []
        nodes.push({ name, props: [numArray(vals)], children: [] })
      } else {
        nodes.push({ name, props, children })
      }
    }
    return nodes
  }

  return { binary: false, version, nodes: readNodes(0), ...(opts.partial ? { truncated: true } : {}) }
}

/**
 * Every array is what it declares: a plausible size, and (zlib) data that decompresses to it within the limits.
 * The browser checks this before handing a file to FBXLoader, whose own decompression has no cap.
 */
export function fbxArraysSound(doc: FbxDocument): boolean {
  const stack = [...doc.nodes]
  while (stack.length) {
    const n = stack.pop()!
    for (const p of n.props) {
      if (!p || typeof p !== 'object' || p instanceof Uint8Array || (p as FbxArray).kind !== 'array') continue
      const a = p as FbxArray
      if (!a.plausible) return false
      if (a.length > 0 && a.values() === null) return false
    }
    stack.push(...n.children)
  }
  return true
}

export function parseFbx(bytes: Uint8Array, inflate?: Inflate, opts: ParseOptions = {}): FbxDocument {
  if (isBinaryFbx(bytes)) return parseBinaryFbx(bytes, inflate, opts)
  return parseAsciiFbx(new TextDecoder('utf-8').decode(bytes), opts)
}

/* ───────────── what we read from it ───────────── */

export interface FbxTexture { slot: string; embedded: boolean; width?: number; height?: number }

export interface FbxInfo {
  binary: boolean
  version: number
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
  /** Centimetres per file unit (GlobalSettings UnitScaleFactor; 1 = cm). */
  unitScale: number
  /** False when an array could not be read, or only the head of the file was (counts are then lower bounds). */
  complete: boolean
  materialNames: string[]
  clipNames: string[]
  textureList: FbxTexture[]
}

function child(n: FbxNode | undefined, name: string): FbxNode | undefined { return n?.children.find(c => c.name === name) }
function childrenNamed(n: FbxNode | undefined, name: string): FbxNode[] { return n ? n.children.filter(c => c.name === name) : [] }

/** `Cube\0\x01Model` (binary) or `Model::Cube` (ASCII) → `Cube`. */
export function fbxObjectName(s: FbxProp | undefined): string {
  if (typeof s !== 'string') return ''
  const z = s.indexOf('\u0000')
  if (z >= 0) return s.slice(0, z)
  const c = s.indexOf('::')
  return c >= 0 ? s.slice(c + 2) : s
}

function strProp(n: FbxNode | undefined): string | undefined {
  const v = n?.props[0]
  return typeof v === 'string' ? v : undefined
}

function arrayProp(n: FbxNode | undefined): FbxArray | undefined {
  const v = n?.props[0]
  return v && typeof v === 'object' && !(v instanceof Uint8Array) && (v as FbxArray).kind === 'array' ? (v as FbxArray) : undefined
}

function base64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/\s+/g, ''))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}

/** Embedded image bytes of a Video node, if any. */
function videoContent(v: FbxNode): Uint8Array | null {
  const c = child(v, 'Content')
  const p = c?.props[0]
  if (p instanceof Uint8Array) return p.length ? p : null
  const text = (c?.props ?? []).filter(x => typeof x === 'string').join('')
  if (text.length) return base64ToBytes(text)
  return null
}

export function fbxInfo(doc: FbxDocument): FbxInfo {
  const objects = doc.nodes.find(n => n.name === 'Objects')
  let triangles = 0, vertices = 0, complete = !doc.truncated
  let hasUV = false, hasNormals = false, hasVertexColors = false, vertexColorSets = 0
  for (const g of childrenNamed(objects, 'Geometry')) {
    if (g.props[2] !== 'Mesh' && g.props.length >= 3) continue
    const v = arrayProp(child(g, 'Vertices'))
    if (v) { vertices += Math.floor(v.length / 3); if (!v.plausible) complete = false }
    const idx = arrayProp(child(g, 'PolygonVertexIndex'))
    if (idx) {
      const vals = idx.values()
      if (!vals) { complete = false; triangles += Math.floor(idx.length / 3) }
      else {
        let size = 0
        for (let i = 0; i < vals.length; i++) { size++; if (vals[i]! < 0) { if (size >= 3) triangles += size - 2; size = 0 } }
      }
    }
    if (child(g, 'LayerElementUV')) hasUV = true
    if (child(g, 'LayerElementNormal')) hasNormals = true
    const cols = childrenNamed(g, 'LayerElementColor').length
    if (cols) { hasVertexColors = true; vertexColorSets = Math.max(vertexColorSets, cols) }
  }
  const models = childrenNamed(objects, 'Model')
  const meshes = models.filter(m => m.props[2] === 'Mesh').length
  const bones = models.filter(m => m.props[2] === 'LimbNode' || m.props[2] === 'Limb').length
  const mats = childrenNamed(objects, 'Material')
  const stacks = childrenNamed(objects, 'AnimationStack')

  // packed images by file name
  const packed = new Map<string, Uint8Array>()
  for (const v of childrenNamed(objects, 'Video')) {
    const content = videoContent(v)
    const slot = fbxSlot(strProp(child(v, 'RelativeFilename')) || strProp(child(v, 'Filename')) || strProp(child(v, 'FileName')))
    if (content && slot) packed.set(slot, content)
  }
  const seen = new Set<string>()
  const textureList: FbxTexture[] = []
  for (const t of childrenNamed(objects, 'Texture')) {
    const slot = fbxSlot(strProp(child(t, 'RelativeFilename')) || strProp(child(t, 'FileName')) || strProp(child(t, 'Filename')))
    if (!slot || seen.has(slot)) continue
    seen.add(slot)
    const bytes = packed.get(slot)
    const size = bytes ? imageSize(bytes) : null
    textureList.push({ slot, embedded: !!bytes, ...(size ? { width: size.width, height: size.height } : {}) })
  }
  let unitScale = 1
  const gs = doc.nodes.find(n => n.name === 'GlobalSettings')
  for (const p of childrenNamed(child(gs, 'Properties70'), 'P')) {
    if (p.props[0] === 'UnitScaleFactor' && typeof p.props[4] === 'number' && Number.isFinite(p.props[4]) && p.props[4] > 0) unitScale = p.props[4]
  }
  const maxTextureSize = textureList.reduce((m, t) => Math.max(m, t.width ?? 0, t.height ?? 0), 0)
  return {
    binary: doc.binary, version: doc.version,
    triangles, vertices, meshes, materials: mats.length, textures: textureList.length, maxTextureSize,
    bones, animations: stacks.length, hasUV, hasNormals, hasVertexColors, vertexColorSets, unitScale, complete,
    materialNames: mats.map(m => fbxObjectName(m.props[1])).filter(Boolean),
    clipNames: stacks.map(s => fbxObjectName(s.props[1])).filter(Boolean),
    textureList
  }
}
