/**
 * Image-based lighting (builtin-plugins.md「环境」). Four environments are generated in code — the studio is
 * three's RoomEnvironment, the others a sky gradient with a few emissive panels (as in the prototype) — so no
 * third-party HDRI ships with the plugin. HDR files from the library can be used too. Rotation goes through
 * `scene.environmentRotation`, so turning an environment does not rebuild it.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import type { RenderHub } from './hub'
import { zh, type T } from '../i18n'

export interface EnvDef {
  id: 'studio' | 'sunset' | 'overcast' | 'night'
  /** Background gradient (top, bottom) used when the background shows the environment. */
  sky: [string, string]
  /** Emissive panels: colour, strength, direction. */
  lights?: Array<[string, number, [number, number, number]]>
}

export const BUILTIN_ENVS: EnvDef[] = [
  { id: 'studio', sky: ['#7b818a', '#1d1f23'] },
  { id: 'sunset', sky: ['#ffb27a', '#3a2340'], lights: [['#ffbf80', 18, [3, 0.8, 1]], ['#ffd0a0', 5, [-1, 2.5, 2]], ['#7a6cff', 3, [-2, 2, -2]]] },
  { id: 'overcast', sky: ['#d5dbe2', '#6b7380'], lights: [['#ffffff', 7, [0, 4, 0.5]], ['#eef2f6', 3, [2, 1, 2]]] },
  { id: 'night', sky: ['#22345a', '#05070d'], lights: [['#8fb4ff', 10, [-2, 2, -2]], ['#ffd59a', 6, [2, 0.6, 2]]] }
]

export function builtinEnv(id: string): EnvDef | null { return BUILTIN_ENVS.find(e => e.id === id) ?? null }

/** 工作室 / 日落 / 阴天 / 夜晚 in the given language. */
export function envName(e: EnvDef, tr: T = zh): string { return tr(`env.${e.id}`) }

export function envGradient(e: EnvDef): string { return `linear-gradient(${e.sky[0]}, ${e.sky[1]})` }

const cache = new WeakMap<RenderHub, Map<string, THREE.Texture>>()
function store(hub: RenderHub): Map<string, THREE.Texture> {
  let m = cache.get(hub)
  if (!m) { m = new Map(); cache.set(hub, m) }
  return m
}

function gradientScene(e: EnvDef): THREE.Scene {
  const scene = new THREE.Scene()
  const geo = new THREE.SphereGeometry(20, 32, 16)
  const pos = geo.attributes.position!
  const top = new THREE.Color(e.sky[0]), bottom = new THREE.Color(e.sky[1])
  const cols: number[] = []
  for (let i = 0; i < pos.count; i++) {
    const k = THREE.MathUtils.clamp(pos.getY(i) / 40 + 0.5, 0, 1)
    const c = bottom.clone().lerp(top, k)
    cols.push(c.r, c.g, c.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })))
  for (const [color, strength, dir] of e.lights ?? []) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }))
    p.position.set(dir[0] * 3, dir[1] * 3, dir[2] * 3)
    p.lookAt(0, 0, 0)
    scene.add(p)
  }
  return scene
}

function disposeScene(s: THREE.Object3D): void {
  s.traverse(o => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material
    if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose()
  })
}

/** Prefiltered environment map of a built-in environment (cached per renderer). */
export function builtinEnvTexture(hub: RenderHub, id: string): THREE.Texture {
  const key = 'builtin:' + id
  const m = store(hub)
  const hit = m.get(key)
  if (hit) return hit
  const def = builtinEnv(id) ?? BUILTIN_ENVS[0]!
  const pmrem = new THREE.PMREMGenerator(hub.renderer)
  const scene = def.id === 'studio' ? new RoomEnvironment() : gradientScene(def)
  const rt = pmrem.fromScene(scene, def.id === 'studio' ? 0.04 : 0.03)
  disposeScene(scene)
  pmrem.dispose()
  m.set(key, rt.texture)
  return rt.texture
}

export interface HdrEnvironment { env: THREE.Texture; background: THREE.Texture }
const hdrPending = new Map<string, Promise<HdrEnvironment>>()

/** An HDR asset (equirectangular .hdr) as environment and background. */
export function hdrEnvironment(hub: RenderHub, url: string): Promise<HdrEnvironment> {
  let p = hdrPending.get(url)
  if (!p) {
    p = new Promise<HdrEnvironment>((resolve, reject) => {
      new HDRLoader().load(url, tex => {
        tex.mapping = THREE.EquirectangularReflectionMapping
        const pmrem = new THREE.PMREMGenerator(hub.renderer)
        const env = pmrem.fromEquirectangular(tex).texture
        pmrem.dispose()
        resolve({ env, background: tex })
      }, undefined, err => reject(err instanceof Error ? err : new Error(String(err))))
    })
    p.catch(() => hdrPending.delete(url))
    hdrPending.set(url, p)
  }
  return p
}
