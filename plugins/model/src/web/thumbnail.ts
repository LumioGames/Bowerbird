/**
 * Renders made by the page's render worker (ADR-025) and the grid's hover turntable (ADR-022), with the
 * viewer's own scene code (ADR-008): a three-quarter view, framed automatically, neutral studio light.
 * `thumb` is WebP with a 512 px long edge; the summary picture is a 2 × 2 sheet of the front, side, back
 * and top views (the same views a turnaround sheet uses).
 */
import * as THREE from 'three'
import type { AssetDetail } from '@bowerbird/schema'
import type { FileSource, RenderedSet } from '@bowerbird/plugin-sdk/web'
import { getHub, canvasToBlob, type RenderHub } from './three/hub'
import { loadModel } from './three/load'
import { analyze, type ModelAnalysis } from './three/analyze'
import { ModelStage } from './three/stage'
import { builtinEnvTexture } from './three/env'
import { HOME } from './three/orbit'
import { VIEW_DIR, VIEW_ORDER, viewExtent } from './lib/turnaround'
import { NoWebGLError, toRenderFailure } from './failure'
import { t } from './i18n'

export interface Prepared { stage: ModelStage; info: ModelAnalysis }

export async function prepare(source: FileSource, name: string, signal?: AbortSignal): Promise<Prepared> {
  const hub = requireHub()
  const model = await loadModel(source, name, { signal })
  const info = analyze(model)
  const stage = new ModelStage(model, info)
  stage.setEnvironment(builtinEnvTexture(hub, 'studio'), 0, null)
  stage.setDisplay({ light: true, shadow: false, ground: false, grid: false, box: false, skeleton: false })
  if (model.animations.length) stage.pose(-1, 0)
  return { stage, info }
}

function requireHub(): RenderHub {
  const hub = getHub()
  if (!hub) throw new NoWebGLError()
  return hub
}

/** Render-worker entry points fail with the shell's convention: a sentence and `retryable` (see failure.ts). */
async function forWorker<R>(work: () => Promise<R>): Promise<R> {
  try { return await work() } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw toRenderFailure(e, t)
  }
}

export interface Framing { camera: THREE.PerspectiveCamera; aspect: number; distance: number }

function corners(b: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (let k = 0; k < 8; k++) out.push(new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z))
  return out
}

/**
 * A camera at azimuth `th`, polar `ph` that frames the bounding box: the picture's aspect follows the model
 * (clamped to 1:2 … 2:1, or fixed when `aspect` is given), the box fills 88 % and sits in the middle.
 */
export function frame(info: ModelAnalysis, th = HOME.th, ph = HOME.ph, aspect?: number, fill = 0.88): Framing {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
  const d = info.radius / Math.sin((30 * Math.PI) / 360) * 1.1
  const c = info.center
  cam.position.set(c.x + d * Math.sin(ph) * Math.sin(th), c.y + d * Math.cos(ph), c.z + d * Math.sin(ph) * Math.cos(th))
  cam.lookAt(c)
  cam.near = d * 0.01; cam.far = d * 10
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true)
  const ext = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of corners(info.bounds)) { const q = p.clone().project(cam); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y) }
    return { x0, x1, y0, y1 }
  }
  const e = ext()
  const dx = Math.max(1e-3, e.x1 - e.x0), dy = Math.max(1e-3, e.y1 - e.y0)
  const A = aspect ?? THREE.MathUtils.clamp(dx / dy, 0.5, 2)
  cam.aspect = A
  cam.zoom = fill * Math.min((2 * A) / dx, 2 / dy)
  cam.updateProjectionMatrix()
  const e2 = ext()
  const W = 1000 * A, H = 1000
  cam.setViewOffset(W, H, ((e2.x0 + e2.x1) / 2) * (W / 2), (-(e2.y0 + e2.y1) / 2) * (H / 2), W, H)
  cam.updateProjectionMatrix()
  return { camera: cam, aspect: A, distance: d }
}

function sizeFor(aspect: number, long = 512): { w: number; h: number } {
  return aspect >= 1 ? { w: long, h: Math.round(long / aspect) } : { w: Math.round(long * aspect), h: long }
}

export function renderStill(p: Prepared, w: number, h: number, cam: THREE.Camera, target: HTMLCanvasElement | null): void {
  const hub = requireHub()
  hub.draw(target, w, h, r => {
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1
    p.stage.render(r, cam, ['full'], { kind: 'none' }, w, h)
  })
}

/** `renderThumbnail`: thumb + aspect, and the complete technical information read in the browser. */
export function renderThumbnail(asset: AssetDetail, source: FileSource): Promise<RenderedSet> {
  return forWorker(() => thumbnailOf(asset, source))
}

async function thumbnailOf(asset: AssetDetail, source: FileSource): Promise<RenderedSet> {
  const p = await prepare(source, asset.name)
  try {
    const hub = requireHub()
    const f = frame(p.info)
    const { w, h } = sizeFor(f.aspect)
    renderStill(p, w, h, f.camera, null)
    const thumb = await canvasToBlob(hub.snapshot(w, h), 'image/webp', 0.9)
    const set: RenderedSet = { thumb, aspect: w / h }
    // GLB / glTF tech comes from the server; FBX is only lightly read there, so the browser completes it
    if (/\.fbx$/i.test(asset.name)) set.tech = p.info.tech
    return set
  } finally {
    p.stage.dispose()
  }
}

/** `renderSummary`: front, side, back, top in a 2 × 2 sheet at one scale (1024 × 1024 WebP). */
export function renderSummary(asset: AssetDetail, source: FileSource): Promise<Blob> {
  return forWorker(() => summaryOf(asset, source))
}

async function summaryOf(asset: AssetDetail, source: FileSource): Promise<Blob> {
  const p = await prepare(source, asset.name)
  try {
    const hub = requireHub()
    const cell = 512
    const out = document.createElement('canvas')
    out.width = out.height = cell * 2
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#2a2c31'
    ctx.fillRect(0, 0, out.width, out.height)
    const min: [number, number, number] = [p.info.bounds.min.x, p.info.bounds.min.y, p.info.bounds.min.z]
    const max: [number, number, number] = [p.info.bounds.max.x, p.info.bounds.max.y, p.info.bounds.max.z]
    const half = Math.max(...VIEW_ORDER.map(k => { const e = viewExtent(min, max, k); return Math.max(e.xx - e.nx, e.xy - e.ny) })) / 2 / 0.88
    const c = p.info.center
    VIEW_ORDER.forEach((k, i) => {
      const { dir, up } = VIEW_DIR[k]
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.001, p.info.radius * 20)
      cam.position.set(c.x + dir[0] * p.info.radius * 4, c.y + dir[1] * p.info.radius * 4, c.z + dir[2] * p.info.radius * 4)
      cam.up.set(...up)
      cam.lookAt(c)
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true)
      renderStill(p, cell, cell, cam, null)
      ctx.drawImage(hub.snapshot(cell, cell), (i % 2) * cell, Math.floor(i / 2) * cell)
    })
    return await canvasToBlob(out, 'image/webp', 0.9)
  } finally {
    p.stage.dispose()
  }
}
