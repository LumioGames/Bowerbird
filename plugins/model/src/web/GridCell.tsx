/**
 * The grid cell of a model (ADR-022, web-shell.md「网格」): its thumbnail; resting the pointer on it for about
 * half a second loads the model and turns it live; leaving stops it at once. One turntable at a time, drawn with
 * the page's single WebGL context and copied into the cell. Touch screens do not turn (ADR-032).
 */
import * as React from 'react'
import * as THREE from 'three'
import { useShell, type GridCellProps } from '@bowerbird/plugin-sdk/web'
import { frame, prepare, renderStill, type Prepared } from './thumbnail'
import { pixelRatio } from './three/hub'
import { HOME } from './three/orbit'
import type { ModelAnalysis } from './three/analyze'
import { modelSettings } from './settings'
import { ensureStyles } from './viewer/styles'
import { Icon } from './icons'
import { useT } from './i18n'

export const HOVER_DELAY_MS = 500

/** Recently turned models stay loaded, so going back to a cell starts at once. */
const CACHE_SIZE = 3
const cache = new Map<string, Promise<Prepared>>()

function cached(key: string, load: () => Promise<Prepared>): Promise<Prepared> {
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return hit }
  const p = load()
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  while (cache.size > CACHE_SIZE) {
    const [oldKey, old] = cache.entries().next().value as [string, Promise<Prepared>]
    cache.delete(oldKey)
    void old.then(x => x.stage.dispose()).catch(() => {})
  }
  return p
}

let stopCurrent: (() => void) | null = null

function isTouch(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * One fixed camera for the whole turn, as in the prototype's turntable: at the thumbnail's angle, zoomed and centred
 * so the bounding box fits at every rotation about the vertical axis through its centre (no zoom breathing).
 */
export function spinCamera(info: ModelAnalysis, steps = 24, fill = 0.88): THREE.PerspectiveCamera {
  const cam = frame(info, HOME.th, HOME.ph, 1, fill).camera
  cam.clearViewOffset(); cam.zoom = 1; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true)
  const b = info.bounds, c = info.center, q = new THREE.Quaternion(), v = new THREE.Vector3()
  const ext = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < steps; i++) {
      q.setFromAxisAngle(UP, (i / steps) * Math.PI * 2)
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).sub(c).applyQuaternion(q).add(c).project(cam)
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y)
      }
    }
    return { x0, x1, y0, y1 }
  }
  const e = ext()
  cam.zoom = fill * Math.min(2 / Math.max(1e-3, e.x1 - e.x0), 2 / Math.max(1e-3, e.y1 - e.y0))
  cam.updateProjectionMatrix()
  const e2 = ext()
  cam.setViewOffset(1000, 1000, ((e2.x0 + e2.x1) / 2) * 500, (-(e2.y0 + e2.y1) / 2) * 500, 1000, 1000)
  cam.updateProjectionMatrix()
  return cam
}

/** Rotate `root` by `angle` about the vertical axis through `center`, from its original pose `p0`/`q0`. */
export function turnAbout(root: THREE.Object3D, center: THREE.Vector3, p0: THREE.Vector3, q0: THREE.Quaternion, angle: number): void {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, angle)
  root.quaternion.copy(q).multiply(q0)
  root.position.copy(p0).sub(center).applyQuaternion(q).add(center)
  root.updateMatrixWorld(true)
}

/**
 * Turn a prepared model in `canvas` until the returned stop is called. The model turns on its own vertical axis;
 * camera, lights and environment stay still, so highlights stay put and the model visibly spins (prototype model.js `spin`).
 */
function spin(p: Prepared, canvas: HTMLCanvasElement, edge: number): () => void {
  stopCurrent?.()
  const px = Math.max(16, Math.round(edge * pixelRatio(modelSettings().maxPixelRatio)))
  const t0 = performance.now()
  const cam = spinCamera(p.info)
  const root = p.stage.root, p0 = root.position.clone(), q0 = root.quaternion.clone(), c = p.info.center.clone()
  let raf = 0
  const tick = (now: number) => {
    turnAbout(root, c, p0, q0, ((now - t0) / 1000) * 1.1)
    renderStill(p, px, px, cam, canvas)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  const stop = () => {
    cancelAnimationFrame(raf)
    root.position.copy(p0); root.quaternion.copy(q0); root.updateMatrixWorld(true)
    if (stopCurrent === stop) stopCurrent = null
  }
  stopCurrent = stop
  return stop
}

export function ModelGridCell({ asset, size, hover, thumbnail }: GridCellProps) {
  ensureStyles()
  const shell = useShell()
  const tr = useT()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [spinning, setSpinning] = React.useState(false)

  React.useEffect(() => {
    if (!hover.active || !thumbnail || isTouch()) return
    const ac = new AbortController()
    let stop: (() => void) | null = null
    const timer = setTimeout(async () => {
      try {
        const detail = await shell.api.assets.get(shell.library.id, asset.id)
        if (ac.signal.aborted) return
        const source = shell.fileSource(detail)
        const p = await cached(`${asset.id}:${detail.hash}`, () => prepare(source, asset.name))
        if (ac.signal.aborted || !canvasRef.current) return
        stop = spin(p, canvasRef.current, size)
        setSpinning(true)
      } catch { /* the thumbnail stays */ }
    }, HOVER_DELAY_MS)
    return () => { ac.abort(); clearTimeout(timer); stop?.(); setSpinning(false) }
  }, [hover.active, thumbnail, asset.id, asset.name, size, shell])

  return (
    <div className="relative size-full overflow-hidden">
      {thumbnail
        ? <img src={thumbnail} alt="" draggable={false} className={'absolute inset-0 size-full object-contain' + (spinning ? ' invisible' : '')} />
        : (
          <div className="absolute inset-0 grid place-items-center text-ink-3">
            <div className="grid justify-items-center gap-1.5">
              <Icon name="box" size={24} />
              {(asset.thumbState === 'render' || asset.thumbState === 'pending') && <span className="text-[11px]">{tr('generatingThumb')}</span>}
            </div>
          </div>
        )}
      <canvas ref={canvasRef} className={spinning ? 'bbm-cell3d pointer-events-none absolute inset-0 size-full' : 'hidden'} />
    </div>
  )
}
