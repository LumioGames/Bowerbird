/**
 * Channel output (builtin-plugins.md「通道查看的实现方式」, review A-23): the model's own materials get a debug
 * branch that writes one material input straight to the pixel — base colour, roughness, metalness, occlusion,
 * emissive, alpha, vertex colour — skipping lighting and tone mapping (data channels raw, colour channels only
 * encoded to sRGB). A uniform selects the channel and the component, so switching never recompiles.
 * Normal and the inspection views use override materials.
 *
 * Splits (wipe, slanted strips) are drawn in passes that discard fragments outside their region of the screen
 * (「分屏通过在片元阶段按屏幕位置选择输出实现，各路共享同一相机」); every material on screen carries that test.
 */
import * as THREE from 'three'
import { CHANNEL_CODE, COMP_INDEX, parseChannel, type ChannelBase } from '../lib/channels'

/** Shared uniforms: one set for all patched materials, changed per pass. */
export const U = {
  bbCh: { value: 0 },
  bbComp: { value: -1 },
  bbRegMode: { value: 0 },
  bbRegIdx: { value: 0 },
  bbRes: { value: new THREE.Vector2(1, 1) },
  bbWipeP: { value: new THREE.Vector2(0, 0) },
  bbWipeN: { value: new THREE.Vector2(1, 0) },
  bbStripN: { value: 3 },
  bbSlope: { value: Math.tan((22 * Math.PI) / 180) }
}

export const STRIP_SLOPE = U.bbSlope.value

const REGION_GLSL = /* glsl */ `
uniform int bbRegMode;
uniform int bbRegIdx;
uniform vec2 bbRes;
uniform vec2 bbWipeP;
uniform vec2 bbWipeN;
uniform float bbStripN;
uniform float bbSlope;
uniform int bbCh;
uniform int bbComp;
bool bbOutside() {
  if (bbRegMode == 0) return false;
  vec2 px = vec2(gl_FragCoord.x, bbRes.y - gl_FragCoord.y);
  int idx = 0;
  if (bbRegMode == 1) {
    idx = dot(px - bbWipeP, bbWipeN) < 0.0 ? 0 : 1;
  } else {
    float x = (px.x + (px.y - bbRes.y * 0.5) * bbSlope) / bbRes.x * bbStripN;
    idx = int(clamp(floor(x), 0.0, bbStripN - 1.0));
  }
  return idx != bbRegIdx;
}
vec4 bbGray(vec4 c) {
  if (bbComp < 0) return c;
  float g = bbComp == 0 ? c.r : bbComp == 1 ? c.g : bbComp == 2 ? c.b : c.a;
  return vec4(vec3(g), 1.0);
}
`

const VCOL_VERTEX_DECL = 'attribute vec4 bbVcol;\nvarying vec4 vBbVcol;\n'

function debugBranch(kind: 'standard' | 'basic'): string {
  const std = kind === 'standard'
  return /* glsl */ `
  if (bbCh > 0) {
    vec4 bbC = vec4(0.0, 0.0, 0.0, 1.0);
    bool bbColor = false;
    // an opaque material ignores alpha (glTF OPAQUE); alpha test and blending keep it
    float bbA = diffuseColor.a;
    #ifdef OPAQUE
      bbA = 1.0;
    #endif
    if (bbCh == 1) { bbC = diffuseColor; bbColor = true; }
    ${std ? 'else if (bbCh == 3) { bbC = vec4(vec3(roughnessFactor), 1.0); }' : ''}
    ${std ? 'else if (bbCh == 4) { bbC = vec4(vec3(metalnessFactor), 1.0); }' : ''}
    else if (bbCh == 5) {
      float bbAo = 1.0;
      #ifdef USE_AOMAP
        bbAo = texture2D(aoMap, vAoMapUv).r;
      #endif
      bbC = vec4(vec3(bbAo), 1.0);
    }
    ${std ? 'else if (bbCh == 6) { bbC = vec4(totalEmissiveRadiance, 1.0); bbColor = true; }' : ''}
    else if (bbCh == 7) { bbC = vec4(vec3(bbA), 1.0); }
    else if (bbCh == 8) { bbC = vBbVcol; }
    if (bbColor) bbC = vec4(sRGBTransferOETF(vec4(clamp(bbC.rgb, 0.0, 1.0), 1.0)).rgb, bbC.a);
    bool bbKeepAlpha = bbCh == 1 && bbComp < 0;
    bbC = bbGray(bbC);
    gl_FragColor = vec4(bbC.rgb, bbKeepAlpha ? bbA : 1.0);
    return;
  }
`
}

export type PatchKind = 'debug' | 'region' | 'normal' | 'face'
const patched = new WeakMap<THREE.Material, PatchKind>()

function injectMain(src: string, decls: string, atStart: string): string {
  return src.replace('void main() {', `${decls}\nvoid main() {\n${atStart}`)
}

/**
 * Add the region test (and, by kind, the debug branch, world-space normal output or face colours) to a material.
 * Materials are patched once; the program cache key keeps differently patched programs apart.
 */
export function patchMaterial(m: THREE.Material, kind: PatchKind = 'region'): THREE.Material {
  if (patched.has(m)) return m
  patched.set(m, kind)
  const std = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
  const basic = (m as THREE.MeshBasicMaterial).isMeshBasicMaterial === true
  const debugKind: 'standard' | 'basic' | null = kind === 'debug' ? (std ? 'standard' : basic ? 'basic' : null) : null
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer)
    Object.assign(shader.uniforms, U)
    let fs = injectMain(shader.fragmentShader, REGION_GLSL + (debugKind ? 'varying vec4 vBbVcol;\n' : ''), '  if (bbOutside()) discard;')
    if (debugKind) {
      shader.vertexShader = injectMain(shader.vertexShader, VCOL_VERTEX_DECL, '  vBbVcol = bbVcol;')
      const anchor = debugKind === 'standard' ? '#include <emissivemap_fragment>' : '#include <specularmap_fragment>'
      fs = fs.replace(anchor, anchor + '\n' + debugBranch(debugKind))
    }
    if (kind === 'normal') {
      fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  vec3 bbN = normalize((vec4(normal, 0.0) * viewMatrix).xyz) * 0.5 + 0.5;
  gl_FragColor = bbGray(vec4(bbN, 1.0));
  return;`)
    }
    if (kind === 'face') {
      fs = fs.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  gl_FragColor = gl_FrontFacing ? vec4(0.24, 0.47, 0.92, 1.0) : vec4(0.9, 0.27, 0.22, 1.0);`)
    }
    shader.fragmentShader = fs
  }
  const prevKey = m.customProgramCacheKey.bind(m)
  m.customProgramCacheKey = () => prevKey() + '|bb:' + kind + (debugKind ? ':' + debugKind : '')
  m.needsUpdate = true
  return m
}

/* ───────────── generated textures ───────────── */

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, n: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

let checkerTex: THREE.Texture | null = null
/** UV checker: coloured cells with labels, to spot stretching and seams. */
export function uvCheckerTexture(): THREE.Texture {
  return (checkerTex ??= canvasTexture(512, (g, n) => {
    const c = n / 8
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#2f3136' : `hsl(${y * 42},62%,${62 + x * 2}%)`
      g.fillRect(x * c, y * c, c, c)
    }
    g.fillStyle = '#ffffff'
    g.font = `bold ${Math.round(c / 4)}px sans-serif`
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillText(String.fromCharCode(65 + x) + (8 - y), x * c + c * 0.14, y * c + c * 0.36)
  }))
}

let densityTex: THREE.Texture | null = null
export function densityTexture(): THREE.Texture {
  return (densityTex ??= canvasTexture(256, (g, n) => {
    const c = n / 16
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#7a7a7a' : '#e4e4e4'; g.fillRect(x * c, y * c, c, c) }
  }))
}

let matcapTex: THREE.Texture | null = null
export function matcapTexture(): THREE.Texture {
  return (matcapTex ??= canvasTexture(256, (g, n) => {
    g.fillStyle = '#1a1b1e'; g.fillRect(0, 0, n, n)
    const gr = g.createRadialGradient(n * 0.36, n * 0.32, n * 0.02, n / 2, n / 2, n / 2)
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#b9bec8'); gr.addColorStop(0.8, '#4a4e57'); gr.addColorStop(1, '#202226')
    g.fillStyle = gr; g.beginPath(); g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); g.fill()
  }))
}

let missingUrl: string | null = null
/** Magenta and black checker for a texture whose slot is not filled (「缺少 …」). */
export function missingTextureUrl(): string {
  if (missingUrl) return missingUrl
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const g = c?.getContext('2d')
  if (!c || !g) return (missingUrl = MISSING_PNG_2X2)
  c.width = c.height = 64
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#000000' : '#ff00ff'; g.fillRect(x * 8, y * 8, 8, 8) }
  return (missingUrl = c.toDataURL('image/png'))
}
/** The same checker as a 2 × 2 PNG, where no canvas is available. */
const MISSING_PNG_2X2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z/D/PwMDAwiDWP//AwBDzgf5h41NbQAAAABJRU5ErkJggg=='

/* ───────────── per-model channel materials ───────────── */

export interface Visibility {
  hiddenMeshes: ReadonlySet<string>
  hiddenMaterials: ReadonlySet<string>
  solo: { kind: 'mesh' | 'material'; id: string } | null
}
export const ALL_VISIBLE: Visibility = { hiddenMeshes: new Set(), hiddenMaterials: new Set(), solo: null }

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false })

type MeshLike = THREE.Mesh & { isSkinnedMesh?: boolean }

function asArray<T>(m: T | T[]): T[] { return Array.isArray(m) ? m : [m] }

function isDebuggable(m: THREE.Material): boolean {
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true || (m as THREE.MeshBasicMaterial).isMeshBasicMaterial === true
}

/**
 * Swaps materials per channel for one loaded model and restores the originals. Keeps the originals' side,
 * alpha cut-outs (debug branch runs after alpha test) and skinning/morphs (overrides are plain materials,
 * three adds skinning per object).
 */
export class ChannelMaterials {
  readonly meshes: MeshLike[] = []
  private originals = new Map<MeshLike, THREE.Material | THREE.Material[]>()
  private normals = new Map<THREE.Material, THREE.Material>()
  private overrides = new Map<string, THREE.Material>()
  private density = new Map<MeshLike, THREE.Material>()
  private vcolFill = new Map<THREE.BufferGeometry, THREE.BufferAttribute>()
  private densityRatio: Map<MeshLike, number> | null = null

  constructor(root: THREE.Object3D) {
    root.traverse(o => {
      const m = o as MeshLike
      if (!m.isMesh) return
      this.meshes.push(m)
      this.originals.set(m, m.material)
      for (const mat of asArray(m.material)) patchMaterial(mat, isDebuggable(mat) ? 'debug' : 'region')
    })
  }

  originalsOf(m: MeshLike): THREE.Material[] { return asArray(this.originals.get(m) ?? m.material) }

  private override(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.overrides.get(key)
    if (!m) { m = patchMaterial(make(), key === 'face' ? 'face' : 'region'); this.overrides.set(key, m) }
    return m
  }

  private normalFor(orig: THREE.Material): THREE.Material {
    let n = this.normals.get(orig)
    if (!n) {
      const o = orig as THREE.MeshStandardMaterial
      const mat = new THREE.MeshNormalMaterial({ side: o.side, flatShading: !!o.flatShading })
      if (o.normalMap) { mat.normalMap = o.normalMap; mat.normalMapType = o.normalMapType; mat.normalScale.copy(o.normalScale) }
      if (o.bumpMap) { mat.bumpMap = o.bumpMap; mat.bumpScale = o.bumpScale }
      n = patchMaterial(mat, 'normal')
      this.normals.set(orig, n)
    }
    return n
  }

  /** Texel density per mesh against the model's median (red: much denser, blue: much sparser, green: about the same). */
  private densityFor(mesh: MeshLike): THREE.Material {
    let m = this.density.get(mesh)
    if (m) return m
    if (!this.densityRatio) this.densityRatio = densityRatios(this.meshes, x => this.originalsOf(x))
    const ratio = this.densityRatio.get(mesh) ?? 1
    const map = densityTexture().clone()
    map.needsUpdate = true
    const size = textureSizeOf(this.originalsOf(mesh)) ?? 1024
    map.repeat.set(size / 512, size / 512)
    const color = ratio > 1.5 ? 0xff8a7a : ratio < 0.67 ? 0x7aa7ff : 0x9be28a
    m = patchMaterial(new THREE.MeshBasicMaterial({ map, color, toneMapped: false }), 'region')
    this.density.set(mesh, m)
    return m
  }

  private vcolAttribute(geo: THREE.BufferGeometry, set: number): THREE.BufferAttribute {
    const name = set === 0 ? 'color' : `color_${set}`
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined
    if (a) return a
    let fill = this.vcolFill.get(geo)
    if (!fill) {
      const n = geo.getAttribute('position')?.count ?? 0
      fill = new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4)
      this.vcolFill.set(geo, fill)
    }
    return fill
  }

  /** Put the materials of one pass in place and set the debug uniforms. */
  apply(key: string, vis: Visibility = ALL_VISIBLE): void {
    const ch = parseChannel(key)
    const base: ChannelBase = ch.base === 'wireover' ? 'full' : ch.base
    const code = CHANNEL_CODE[base]
    U.bbCh.value = code ?? 0
    U.bbComp.value = COMP_INDEX[ch.comp]
    for (const mesh of this.meshes) {
      const origs = this.originalsOf(mesh)
      const meshHidden = vis.hiddenMeshes.has(mesh.uuid) || (vis.solo?.kind === 'mesh' && vis.solo.id !== mesh.uuid)
      const matHidden = (o: THREE.Material) => vis.hiddenMaterials.has(o.uuid) || (vis.solo?.kind === 'material' && vis.solo.id !== o.uuid)
      mesh.visible = !meshHidden && origs.some(o => !matHidden(o))
      if (base === 'vcol') mesh.geometry.setAttribute('bbVcol', this.vcolAttribute(mesh.geometry, ch.set))
      const pick = (o: THREE.Material): THREE.Material => {
        if (matHidden(o)) return HIDDEN
        if (code !== undefined && base !== 'normal') return o
        switch (base) {
          case 'normal': return this.normalFor(o)
          case 'wire': return this.override('wire', () => new THREE.MeshBasicMaterial({ color: 0xc9d1dc, wireframe: true, toneMapped: false }))
          case 'uv': return this.override('uv', () => new THREE.MeshBasicMaterial({ map: uvCheckerTexture(), toneMapped: false }))
          case 'matcap': return this.override('matcap:' + o.side, () => new THREE.MeshMatcapMaterial({ matcap: matcapTexture(), side: o.side }))
          case 'face': return this.override('face', () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }))
          case 'density': return this.densityFor(mesh)
          default: return o
        }
      }
      const orig = this.originals.get(mesh)!
      mesh.material = Array.isArray(orig) ? orig.map(pick) : pick(orig)
    }
  }

  /** The dark wireframe drawn over the full render (「线框叠加」). */
  applyWireOverlay(vis: Visibility = ALL_VISIBLE): void {
    const wire = this.override('wireov', () => new THREE.MeshBasicMaterial({ color: 0x0b0c0e, wireframe: true, transparent: true, opacity: 0.8, toneMapped: false }))
    for (const mesh of this.meshes) {
      const orig = this.originals.get(mesh)!
      const pick = (o: THREE.Material) => (vis.hiddenMaterials.has(o.uuid) || (vis.solo?.kind === 'material' && vis.solo.id !== o.uuid) ? HIDDEN : wire)
      mesh.material = Array.isArray(orig) ? orig.map(pick) : pick(orig)
    }
  }

  restore(): void {
    for (const [mesh, m] of this.originals) { mesh.material = m; mesh.visible = true }
    U.bbCh.value = 0
    U.bbComp.value = -1
  }

  dispose(): void {
    this.restore()
    for (const m of this.normals.values()) m.dispose()
    for (const m of this.overrides.values()) m.dispose()
    for (const m of this.density.values()) { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose() }
    for (const [geo] of this.vcolFill) geo.deleteAttribute('bbVcol')
  }
}

function textureSizeOf(mats: THREE.Material[]): number | null {
  for (const m of mats) {
    const s = m as THREE.MeshStandardMaterial
    for (const t of [s.map, s.normalMap, s.roughnessMap, s.emissiveMap, s.aoMap]) {
      const img = t?.image as { width?: number; height?: number } | undefined
      if (img?.width) return Math.max(img.width, img.height ?? 0)
    }
  }
  return null
}

/** Texels per metre of each mesh (UV area × texture size against world area), relative to the median. */
function densityRatios(meshes: MeshLike[], mats: (m: MeshLike) => THREE.Material[]): Map<MeshLike, number> {
  const out = new Map<MeshLike, number>()
  const dens: Array<[MeshLike, number]> = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (const mesh of meshes) {
    const geo = mesh.geometry
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv')
    const size = textureSizeOf(mats(mesh))
    if (!pos || !uv || !size) continue
    mesh.updateWorldMatrix(true, false)
    const idx = geo.getIndex()
    const n = idx ? idx.count : pos.count
    let world = 0, tex = 0
    for (let i = 0; i + 2 < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld)
      world += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
      const u0 = uv.getX(i0), v0 = uv.getY(i0), u1 = uv.getX(i1), v1 = uv.getY(i1), u2 = uv.getX(i2), v2 = uv.getY(i2)
      tex += Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2 * size * size
    }
    if (world > 0 && tex > 0) dens.push([mesh, Math.sqrt(tex / world)])
  }
  const sorted = dens.map(d => d[1]).sort((x, y) => x - y)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 1
  for (const [m, d] of dens) out.set(m, d / median)
  return out
}
