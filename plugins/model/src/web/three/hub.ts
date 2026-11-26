/**
 * One WebGL context for the whole page (review B-09, components.md「网格转台」): the viewer, the compare views,
 * the grid's hover turntable and the thumbnail renders all draw with this renderer into the bottom-left corner
 * of its (grow-only) canvas, and copy the result into their own 2D canvas right away — the drawing buffer is
 * still intact within the same task, so no `preserveDrawingBuffer` is needed.
 */
import * as THREE from 'three'

export class RenderHub {
  readonly renderer: THREE.WebGLRenderer
  readonly canvas: HTMLCanvasElement
  private cw = 0
  private ch = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    r.setPixelRatio(1)
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap
    r.setClearColor(0x000000, 0)
    this.renderer = r
    this.ensure(256, 256)
  }

  /** Grow the canvas (never shrink: reallocating the drawing buffer every frame is slow). */
  ensure(w: number, h: number): void {
    if (w <= this.cw && h <= this.ch) return
    const step = (v: number) => Math.ceil(v / 256) * 256
    this.cw = Math.max(this.cw, step(w))
    this.ch = Math.max(this.ch, step(h))
    this.renderer.setSize(this.cw, this.ch, false)
  }

  /**
   * Render `w × h` device pixels with `draw`, then copy them into `target` (resized to match) when given.
   * The viewport and scissor are set to the corner; `draw` may render several passes.
   */
  draw(target: HTMLCanvasElement | null, w: number, h: number, draw: (r: THREE.WebGLRenderer) => void): void {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
    this.ensure(w, h)
    const r = this.renderer
    r.setRenderTarget(null)
    r.setViewport(0, 0, w, h)
    r.setScissor(0, 0, w, h)
    r.setScissorTest(true)
    r.autoClear = true
    draw(r)
    r.autoClear = true
    if (target) this.copyTo(target, w, h)
  }

  copyTo(target: HTMLCanvasElement, w: number, h: number): void {
    if (target.width !== w) target.width = w
    if (target.height !== h) target.height = h
    const ctx = target.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(this.canvas, 0, this.ch - h, w, h, 0, 0, w, h)
  }

  /** The last `w × h` render as a new canvas (for encoding thumbnails and shots). */
  snapshot(w: number, h: number, background?: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')!
    if (background) background(ctx)
    ctx.drawImage(this.canvas, 0, this.ch - h, w, h, 0, 0, w, h)
    return c
  }
}

let hub: RenderHub | null | undefined

/** The page's renderer, or null when WebGL is not available. */
export function getHub(): RenderHub | null {
  if (hub !== undefined) return hub
  try { hub = new RenderHub() } catch { hub = null }
  return hub
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/webp', quality = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), type, quality))
}

/** Device pixel ratio, capped by the plugin's machine setting `maxPixelRatio` (default 2). */
export function pixelRatio(cap = 2): number {
  return Math.max(1, Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, cap))
}
