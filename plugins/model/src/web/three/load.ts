/**
 * Loading a model for display (review A-22). GLB and glTF through GLTFLoader, FBX through FBXLoader — read in
 * the browser, never converted at registration (ADR-008). Every file a model names (textures, `.bin`) is
 * looked up by its slot through `FileSource.slotUrl` (ADR-018): the name in the file is only a place, the
 * .bmeta says which asset fills it, so a replaced relation shows the new texture and the file is untouched.
 * Images packed in a GLB are swapped the same way when a relation fills their name.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { inflateBounded } from './inflate'
import type { FileSource } from '@bowerbird/plugin-sdk/web'
import { embeddedImageSlot, isImageName, slotCandidates, uriSlot } from '../../shared/slots'
import { imageRoles, MAX_GLTF_JSON_BYTES, readGltfContainer, type ImageRole } from '../../shared/gltf'
import { fbxArraysSound, fbxInfo, parseFbx, type FbxInfo } from '../../shared/fbx'
import { missingTextureUrl } from './materials'

export type ModelKind = 'gltf' | 'fbx'

/** What a texture is used for (shown as 基础色, 法线, 遮蔽 · 粗糙 · 金属 … in the shell's language). */
export type TextureRole = ImageRole | 'bump' | 'rough' | 'metal' | 'alpha' | 'spec'

export interface TextureEntry {
  /** Slot name (null for an unnamed packed image). */
  slot: string | null
  /** Label for the list: the slot, or the texture's own name; null when it has none (「图像 n」). */
  label: string | null
  /** Position in the file's image list (for「图像 n」). */
  index: number
  roles: TextureRole[]
  width?: number
  height?: number
  embedded: boolean
  /** A small picture for the list, when the image is in memory. */
  texture?: THREE.Texture
  /** The slot is not filled: the model shows a checker in its place. */
  missing?: boolean
}

export interface LoadedModel {
  kind: ModelKind
  root: THREE.Object3D
  animations: THREE.AnimationClip[]
  /** Slot names the file asked for that no relation fills (「缺少 …」). */
  missing: string[]
  textures: TextureEntry[]
  /** Materials were Phong/Lambert in the file (FBX): roughness, metalness and occlusion are not in it. */
  fromPhong: boolean
  fbx?: FbxInfo
  /** The texture each three Texture came from (slot name), for「ORM · G」labels. */
  textureSlot: Map<THREE.Texture, string>
  dispose(): void
}

/**
 * Why a model cannot be shown. `kind`: `load` (the file or a file it names could not be fetched — trying again
 * may help), `decode` (the bytes are not a model three can read), `unsupported` (a valid model using something
 * this version does not decode: Draco meshes, KTX2 textures). `reason` picks the sentence the viewer shows;
 * `message` keeps the technical detail. Render failures carry `retryable` for the shell's render worker.
 */
export type LoadReason = 'missing' | 'draco' | 'ktx2' | 'fbxArrays' | 'notModel' | 'network' | 'parse'
export class ModelLoadError extends Error {
  constructor(readonly kind: 'load' | 'decode' | 'unsupported', message: string, readonly reason: LoadReason = kind === 'load' ? 'network' : 'parse', readonly names: string[] = []) {
    super(message)
    this.name = 'ModelLoadError'
  }
  /** Only a failed fetch can come out differently next time. */
  get retryable(): boolean { return this.kind === 'load' }
}

/** Extensions a glTF requires that this version cannot decode (it ships the Meshopt decoder only). */
export function unsupportedRequirement(json: { extensionsRequired?: unknown }): 'draco' | 'ktx2' | null {
  const req = Array.isArray(json?.extensionsRequired) ? json.extensionsRequired : []
  if (req.includes('KHR_draco_mesh_compression')) return 'draco'
  if (req.includes('KHR_texture_basisu')) return 'ktx2'
  return null
}

export interface LoadOptions {
  signal?: AbortSignal
  /** Download progress (bytes) then parsing (`total` null). */
  onProgress?(loaded: number, total: number | null, phase: 'download' | 'parse'): void
  /** Expected size (from the asset) when the server sends no Content-Length. */
  sizeHint?: number
}

export function kindOf(name: string): ModelKind | null {
  const n = name.toLowerCase()
  if (n.endsWith('.glb') || n.endsWith('.gltf')) return 'gltf'
  if (n.endsWith('.fbx')) return 'fbx'
  return null
}

function abortError(): Error { const e = new Error('aborted'); e.name = 'AbortError'; return e }

async function download(source: FileSource, opts: LoadOptions): Promise<ArrayBuffer> {
  if (opts.signal?.aborted) throw abortError()
  let res: Response
  try {
    res = await fetch(source.url, { signal: opts.signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    try { return await source.fetch(opts.signal) } catch (e2) { throw new ModelLoadError('load', (e2 as Error).message) }
  }
  if (!res.ok) throw new ModelLoadError('load', `HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || opts.sizeHint || null
  if (!res.body || !opts.onProgress) return res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    opts.onProgress(loaded, total, 'download')
  }
  const out = new Uint8Array(loaded)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out.buffer
}

/** What an unfilled non-image slot (a `.bin`) loads instead: nothing, without a request. */
export const BLOCKED_URL = 'data:application/octet-stream;base64,'

/**
 * Where a URL a loader asks for may go (review P2): only to what a slot relation fills (`FileSource.slotUrl`, an
 * address inside the library), or to data the file carries (`data:`, `blob:`). Anything else — a relative name
 * with no relation, an absolute `http://…` written in the file — is「缺少」: an image becomes the checker, other
 * files load empty and the model fails as「加载失败」. Nothing outside the library is ever requested.
 */
export function resolveRequest(url: string, source: Pick<FileSource, 'slotUrl'>, missing: Set<string>, resolved: Map<string, string>): string {
  if (/^(blob|data):/i.test(url)) return url
  if (resolved.has(url)) return url
  const candidates = slotCandidates(url)
  for (const c of candidates) {
    const u = source.slotUrl(c)
    if (u) { resolved.set(u, c); return u }
  }
  const name = candidates[0] ?? url
  missing.add(name)
  if (isImageName(name)) { const u = missingTextureUrl(); resolved.set(u, name); return u }
  return BLOCKED_URL
}

function slotManager(source: FileSource, missing: Set<string>, resolved: Map<string, string>): THREE.LoadingManager {
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(url => resolveRequest(url, source, missing, resolved))
  return manager
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** GLTFLoader plugin: a packed image whose name a relation fills is loaded from that asset instead. */
function packedImageOverride(source: FileSource, swapped: Set<number>, resolved: Map<string, string>) {
  return (parser: GLTFParser) => ({
    name: 'BOWERBIRD_slot_override',
    beforeRoot(): null {
      const images: any[] = (parser.json as any).images ?? []
      images.forEach((img, i) => {
        if (img.bufferView === undefined) return
        const slot = embeddedImageSlot(img)
        const url = slot ? source.slotUrl(slot) : null
        if (!url) return
        resolved.set(url, slot!)
        img.uri = url
        delete img.bufferView
        swapped.add(i)
      })
      return null
    }
  })
}

const TEXTURE_ROLE: Record<string, TextureRole> = {
  map: 'base', normalMap: 'normal', bumpMap: 'bump', emissiveMap: 'emit', aoMap: 'ao', roughnessMap: 'rough',
  metalnessMap: 'metal', alphaMap: 'alpha', specularMap: 'spec'
}

const TEXTURE_KEYS = ['map', 'normalMap', 'bumpMap', 'emissiveMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'specularMap']

function imageDims(t: THREE.Texture | undefined): { width?: number; height?: number } {
  const img = t?.image as { width?: number; height?: number } | undefined
  return img?.width ? { width: img.width, height: img.height ?? img.width } : {}
}

/** Phong / Lambert (FBX) → standard material so the environment lights it like everything else. */
function toStandard(m: THREE.Material): THREE.Material {
  const p = m as THREE.MeshPhongMaterial
  if (!(p.isMeshPhongMaterial || (m as THREE.MeshLambertMaterial).isMeshLambertMaterial)) return m
  const s = new THREE.MeshStandardMaterial({
    name: p.name, color: p.color, map: p.map, normalMap: p.normalMap ?? null, bumpMap: p.bumpMap ?? null,
    emissive: p.emissive, emissiveMap: p.emissiveMap, emissiveIntensity: p.emissiveIntensity,
    alphaMap: p.alphaMap, transparent: p.transparent, opacity: p.opacity, side: p.side, vertexColors: p.vertexColors,
    flatShading: !!p.flatShading, aoMap: p.aoMap, metalness: 0,
    roughness: p.isMeshPhongMaterial ? Math.sqrt(2 / ((p.shininess ?? 30) + 2)) : 1
  })
  if (p.normalMap) s.normalScale.copy(p.normalScale)
  if (p.bumpMap) s.bumpScale = p.bumpScale
  s.userData = { ...p.userData, bbFromPhong: true }
  p.dispose()
  return s
}

function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>()
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry?.dispose()
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const k of TEXTURE_KEYS) { const t = (mat as any)[k] as THREE.Texture | undefined; if (t) textures.add(t) }
      mat.dispose()
    }
  })
  for (const t of textures) t.dispose()
}

export async function loadModel(source: FileSource, name: string, opts: LoadOptions = {}): Promise<LoadedModel> {
  const kind = kindOf(name)
  if (!kind) throw new ModelLoadError('decode', `not a model file: ${name}`, 'notModel', [name])
  const buffer = await download(source, opts)
  if (opts.signal?.aborted) throw abortError()
  opts.onProgress?.(buffer.byteLength, null, 'parse')
  const missing = new Set<string>()
  const resolved = new Map<string, string>()
  const manager = slotManager(source, missing, resolved)
  const textureSlot = new Map<THREE.Texture, string>()

  if (kind === 'gltf') {
    // A valid file that needs a decoder this version does not ship (Draco meshes, KTX2 textures) says so plainly,
    // instead of GLTFLoader's「No DRACOLoader instance provided」.
    let needs: 'draco' | 'ktx2' | null = null
    try { needs = unsupportedRequirement((await readGltfContainer(new Uint8Array(buffer), { maxJsonBytes: MAX_GLTF_JSON_BYTES })).json) } catch { /* GLTFLoader reports it */ }
    if (needs) throw new ModelLoadError('unsupported', needs === 'draco' ? 'KHR_draco_mesh_compression is required' : 'KHR_texture_basisu is required', needs)
    const swapped = new Set<number>()
    const loader = new GLTFLoader(manager)
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.register(packedImageOverride(source, swapped, resolved))
    let gltf: GLTF
    try {
      gltf = await loader.parseAsync(buffer, '')
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      // a missing .bin is a missing file, not a broken one
      const files = [...missing].filter(m => !isImageName(m))
      if (files.length) throw new ModelLoadError('load', `missing ${files.join(', ')}`, 'missing', files)
      if (/DRACOLoader|draco/i.test(msg)) throw new ModelLoadError('unsupported', msg, 'draco')
      if (/KTX2Loader|basisu/i.test(msg)) throw new ModelLoadError('unsupported', msg, 'ktx2')
      throw new ModelLoadError('decode', msg)
    }
    if (opts.signal?.aborted) { disposeObject(gltf.scene); throw abortError() }
    const json: any = gltf.parser.json
    const uses = imageRoles(json)
    const texOfImage = new Map<number, THREE.Texture>()
    for (const [obj, assoc] of gltf.parser.associations as Map<any, any>) {
      if (obj?.isTexture && typeof assoc?.textures === 'number') {
        const td = json.textures?.[assoc.textures]
        const ext = td?.extensions ?? {}
        const src = [ext.KHR_texture_basisu?.source, ext.EXT_texture_webp?.source, ext.EXT_texture_avif?.source, td?.source].find(v => typeof v === 'number')
        if (typeof src === 'number') {
          if (!texOfImage.has(src)) texOfImage.set(src, obj)
          const img = json.images?.[src]
          const slot = img ? (img.bufferView !== undefined || swapped.has(src) ? embeddedImageSlot(img) : uriSlot(img.uri)) : null
          if (slot) textureSlot.set(obj, slot)
        }
      }
    }
    // a material clones its textures when a sampler or transform differs; map clones through their source
    gltf.scene.traverse(o => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const k of TEXTURE_KEYS) {
        const t = (mat as any)[k] as THREE.Texture | undefined
        if (!t || textureSlot.has(t)) continue
        for (const [known, slot] of textureSlot) if (known.source === t.source) { textureSlot.set(t, slot); break }
      }
    })
    const textures: TextureEntry[] = ((json.images ?? []) as any[]).map((img, i) => {
      const embedded = img.bufferView !== undefined || swapped.has(i) || /^data:/i.test(img.uri ?? '')
      const slot = img.bufferView !== undefined || swapped.has(i) ? embeddedImageSlot(img) : uriSlot(img.uri)
      const t = texOfImage.get(i)
      return {
        slot, label: slot ?? (typeof img.name === 'string' && img.name ? img.name : null), index: i, roles: uses.get(i) ?? [],
        embedded: embedded && !swapped.has(i), texture: t, ...imageDims(t), missing: !!slot && missing.has(slot)
      }
    })
    const root = gltf.scene
    return {
      kind, root, animations: gltf.animations, missing: [...missing].filter(isImageName), textures, fromPhong: false, textureSlot,
      dispose: () => disposeObject(root)
    }
  }

  // FBX
  let root: THREE.Group
  let info: FbxInfo | undefined
  // The bounded reader goes first: a file whose offsets or arrays are not what they say (a loop, a decompression
  // bomb) is refused here, before FBXLoader — which trusts them — ever sees it (review P1-1, P1-2).
  let doc
  try {
    doc = parseFbx(new Uint8Array(buffer), inflateBounded)
  } catch (e) {
    throw new ModelLoadError('decode', (e as Error)?.message ?? String(e))
  }
  if (!fbxArraysSound(doc)) throw new ModelLoadError('decode', 'an FBX array does not match its declared size', 'fbxArrays')
  info = fbxInfo(doc)
  try {
    root = new FBXLoader(manager).parse(buffer, '')
  } catch (e) {
    throw new ModelLoadError('decode', (e as Error)?.message ?? String(e))
  }
  // FBX units are centimetres unless the file says otherwise; the viewer measures in metres
  const unit = Number(root.userData.unitScaleFactor) || info?.unitScale || 1
  root.scale.multiplyScalar(unit / 100)
  let fromPhong = false
  const roles = new Map<THREE.Texture, Set<TextureRole>>()
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const conv = (mat: THREE.Material) => { const s = toStandard(mat); if (s !== mat) fromPhong = true; return s }
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material)
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const k of TEXTURE_KEYS) {
      const t = (mat as any)[k] as THREE.Texture | undefined
      if (!t) continue
      if (!roles.has(t)) roles.set(t, new Set())
      const role = TEXTURE_ROLE[k]
      if (role) roles.get(t)!.add(role)
    }
  })
  const textures: TextureEntry[] = []
  const seen = new Set<string>()
  for (const [t, set] of roles) {
    const src = (t.image as HTMLImageElement | undefined)?.src
    const slot = src ? resolved.get(src) ?? null : null
    if (slot) textureSlot.set(t, slot)
    const label = slot ?? (t.name || null)
    const key = label ?? t.uuid
    if (seen.has(key)) continue
    seen.add(key)
    const packed = !!src && src.startsWith('blob:')
    const fromInfo = info?.textureList.find(x => x.slot === slot)
    textures.push({ slot, label, index: textures.length, roles: [...set], embedded: packed || !!fromInfo?.embedded, texture: t, ...imageDims(t), missing: !!slot && missing.has(slot) })
  }
  // textures the FBX names but no material ended up using (or whose image never loaded)
  for (const t of info?.textureList ?? []) {
    if (seen.has(t.slot)) continue
    seen.add(t.slot)
    textures.push({ slot: t.slot, label: t.slot, index: textures.length, roles: [], embedded: t.embedded, ...(t.width ? { width: t.width, height: t.height } : {}), missing: missing.has(t.slot) })
  }
  return {
    kind, root, animations: root.animations ?? [], missing: [...missing].filter(isImageName), textures, fromPhong, fbx: info, textureSlot,
    dispose: () => disposeObject(root)
  }
}
