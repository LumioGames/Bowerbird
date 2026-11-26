/**
 * What the loaded model contains, read from the three.js scene: the technical information (the complete set
 * for FBX, returned with the thumbnail as `RenderedSet.tech`), the structure lists, and which channels the
 * file can show. The bounding box is the rest pose (review A-26).
 */
import * as THREE from 'three'
import { packedLabels, type ModelCaps } from '../lib/channels'
import type { LoadedModel } from './load'

/** `name` null: the file gives none (the panel shows「网格 n」/「材质 n」, n = `index` + 1, in the shell's language). */
export interface MeshEntry { id: string; name: string | null; index: number; triangles: number; materials: string[] }
export interface MaterialEntry { id: string; name: string | null; index: number }

export interface ModelAnalysis {
  tech: Record<string, number | boolean>
  caps: ModelCaps
  meshes: MeshEntry[]
  materials: MaterialEntry[]
  bones: number
  bounds: THREE.Box3
  size: THREE.Vector3
  center: THREE.Vector3
  /** Radius of the bounding sphere around the box. */
  radius: number
}

function trianglesOf(g: THREE.BufferGeometry): number {
  const idx = g.getIndex()
  const n = idx ? idx.count : g.getAttribute('position')?.count ?? 0
  return Math.floor(n / 3)
}

function vcolSets(g: THREE.BufferGeometry): number {
  let n = g.getAttribute('color') ? 1 : 0
  if (!n) return 0
  while (g.getAttribute(`color_${n}`)) n++
  return n
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4

export function analyze(model: LoadedModel): ModelAnalysis {
  const root = model.root
  root.updateMatrixWorld(true)
  const meshes: MeshEntry[] = []
  const mats = new Map<string, THREE.Material>()
  let triangles = 0, vertices = 0, hasUV = false, hasNormals = false, sets = 0
  let pbr = false, ao = false, anyTexture = false
  const maps: { rough: THREE.Texture | null; metal: THREE.Texture | null; ao: THREE.Texture | null } = { rough: null, metal: null, ao: null }
  const bones = new Set<string>()
  const images = new Set<unknown>()
  let maxTex = 0
  let n = 0
  root.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.add(o.uuid)
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    n++
    const g = m.geometry
    const t = trianglesOf(g)
    triangles += t
    vertices += g.getAttribute('position')?.count ?? 0
    if (g.getAttribute('uv')) hasUV = true
    if (g.getAttribute('normal')) hasNormals = true
    sets = Math.max(sets, vcolSets(g))
    const list = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of list) {
      mats.set(mat.uuid, mat)
      const s = mat as THREE.MeshStandardMaterial
      if (s.isMeshStandardMaterial && !s.userData?.bbFromPhong) pbr = true
      if (s.aoMap) { ao = true; maps.ao ??= s.aoMap }
      if (s.roughnessMap) maps.rough ??= s.roughnessMap
      if (s.metalnessMap) maps.metal ??= s.metalnessMap
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const) {
        const tex = (s as unknown as Record<string, THREE.Texture | null | undefined>)[k]
        if (!tex) continue
        anyTexture = true
        const img = tex.image as { width?: number; height?: number } | undefined
        if (img && !images.has(img)) { images.add(img); maxTex = Math.max(maxTex, img.width ?? 0, img.height ?? 0) }
      }
    }
    const parentName = m.parent && !(m.parent as THREE.Scene).isScene && m.parent !== root ? m.parent.name : ''
    meshes.push({ id: m.uuid, name: m.name || parentName || null, index: n - 1, triangles: t, materials: list.map(x => x.uuid) })
  })
  const bounds = new THREE.Box3().setFromObject(root)
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const radius = Math.max(1e-3, size.length() / 2)
  const slotOf = (t: THREE.Texture | null) => (t ? model.textureSlot.get(t) ?? t.name ?? '' : null)
  const caps: ModelCaps = {
    pbr, ao, uv: hasUV, textures: anyTexture, vcolSets: sets,
    packed: pbr ? packedLabels({ rough: slotOf(maps.rough), metal: slotOf(maps.metal), ao: slotOf(maps.ao), mrIsAo: !!maps.rough && !!maps.ao && maps.rough.source === maps.ao.source }) : {}
  }
  const textureCount = model.textures.length || images.size
  const maxTextureSize = Math.max(maxTex, ...model.textures.map(t => Math.max(t.width ?? 0, t.height ?? 0)))
  const tech: Record<string, number | boolean> = {
    triangles, vertices, meshes: meshes.length, materials: mats.size, textures: textureCount, maxTextureSize,
    bones: bones.size, animations: model.animations.length,
    boundsX: r4(size.x), boundsY: r4(size.y), boundsZ: r4(size.z),
    hasUV, hasNormals, hasVertexColors: sets > 0, vertexColorSets: sets
  }
  // FBXLoader unrolls indexed polygons and gives every mesh its own material; the file's own counts are the
  // ones to report (they match the server's light parse), the scene adds what only it knows (bounds, bones)
  const f = model.fbx
  if (f && f.complete) {
    Object.assign(tech, {
      triangles: f.triangles, vertices: f.vertices, meshes: f.meshes || meshes.length, materials: f.materials,
      textures: Math.max(f.textures, textureCount), bones: Math.max(f.bones, bones.size), animations: Math.max(f.animations, model.animations.length),
      maxTextureSize: Math.max(maxTextureSize, f.maxTextureSize)
    })
    if (f.hasUV) tech.hasUV = true
    if (f.hasNormals) tech.hasNormals = true
  }
  return {
    tech, caps, meshes,
    materials: [...mats.values()].map((m, i) => ({ id: m.uuid, name: m.name || null, index: i })),
    bones: bones.size, bounds, size, center, radius
  }
}
