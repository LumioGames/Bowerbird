/**
 * The viewer's render loop: orbit camera, animation time, panel offset, channel passes, captures.
 * React owns the controls and hands the whole view state over; per-frame overlays (size lines, view cube)
 * are updated through `onFrame` without going through React.
 */
import * as THREE from 'three'
import type { RenderHub } from '../three/hub'
import type { ModelStage, Region } from '../three/stage'
import { Orbit } from '../three/orbit'
import { initialStrips } from '../lib/channels'

export type SplitMode = 'single' | 'wipe' | 'strips'
export type ToneMap = 'aces' | 'agx' | 'neutral' | 'none'
export type Background = 'env' | 'color' | 'none'

export interface ViewState {
  mode: SplitMode
  ch: string
  wipe: { ch: [string, string]; x: number; y: number; ang: number }
  strips: string[]
  env: string
  envRot: number
  exp: number
  tone: ToneMap
  bg: Background
  bgColor: string
  light: boolean
  az: number
  el: number
  shadow: boolean
  ortho: boolean
  fov: number
  ground: boolean
  grid: boolean
  dims: boolean
  skel: boolean
  turn: boolean
  hiddenMeshes: string[]
  hiddenMats: string[]
  solo: { kind: 'mesh' | 'material'; id: string } | null
  clip: number
  play: boolean
  loop: boolean
  speed: number
  panel: boolean
}

export function initialState(compact: boolean, env = 'studio'): ViewState {
  return {
    mode: 'single', ch: 'full', wipe: { ch: ['full', 'base'], x: 0.5, y: 0.5, ang: 0 }, strips: initialStrips('full'),
    env, envRot: 0, exp: 0, tone: 'aces', bg: 'env', bgColor: '#2a2c31',
    light: true, az: 40, el: 42, shadow: true, ortho: false, fov: 35,
    ground: true, grid: false, dims: !compact, skel: false, turn: compact,
    hiddenMeshes: [], hiddenMats: [], solo: null,
    clip: 0, play: false, loop: true, speed: 1, panel: false
  }
}

export const PANEL_W = 272

const TONE: Record<ToneMap, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping
}

export interface FrameInfo { cam: THREE.Camera; W: number; H: number; pw: number; stage: ModelStage }

export interface EngineOptions {
  compact: boolean
  pixelRatio: () => number
  onFrame?(f: FrameInfo): void
  onTime?(t: number, playing: boolean): void
  /** The turntable stopped by a drag (the tool bar button follows). */
  onTurnChange?(on: boolean): void
}

export class ViewerEngine {
  stage: ModelStage | null = null
  orbit: Orbit | null = null
  readonly persp = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
  st: ViewState
  time = 0
  private W = 1
  private H = 1
  private pw = 0
  private raf = 0
  private last = 0
  private dirty = true
  private envTex: THREE.Texture | null = null
  private bgTex: THREE.Texture | null = null
  private turnBeforeDrag = false

  constructor(private hub: RenderHub, private canvas: HTMLCanvasElement, initial: ViewState, private opts: EngineOptions) {
    this.st = initial
  }

  attach(stage: ModelStage): void {
    this.stage = stage
    const { radius, center } = stage.info
    const fov = this.st.fov
    const home = radius / Math.sin((fov * Math.PI) / 360) * 1.25
    this.orbit = new Orbit(home, center)
    this.time = 0
    stage.pose(this.st.clip, 0)
    this.applyState()
    this.start()
  }

  setState(st: ViewState): void {
    const prev = this.st
    this.st = st
    if (prev.clip !== st.clip) { this.time = 0; this.stage?.pose(st.clip, 0) }
    if (st.play && !prev.play && this.stage) {
      const clip = this.stage.clips[st.clip]
      if (clip && !st.loop && this.time >= clip.duration - 1e-3) this.time = 0
    }
    this.applyState()
  }

  private applyState(): void {
    const s = this.stage
    if (!s) return
    const st = this.st
    s.setDisplay({ light: st.light, shadow: st.shadow, az: st.az, el: st.el, ground: st.ground, grid: st.grid, box: st.dims && !this.opts.compact, skeleton: st.skel })
    s.vis = { hiddenMeshes: new Set(st.hiddenMeshes), hiddenMaterials: new Set(st.hiddenMats), solo: st.solo }
    s.setEnvironment(this.envTex, st.envRot, st.bg === 'env' ? this.bgTex : null)
    this.dirty = true
  }

  /** Environment map, and the HDR picture shown as background when the background shows the environment. */
  setEnvironment(env: THREE.Texture | null, background: THREE.Texture | null): void {
    this.envTex = env
    this.bgTex = background
    this.applyState()
  }

  resize(w: number, h: number): void {
    this.W = Math.max(1, w); this.H = Math.max(1, h)
    this.dirty = true
  }

  invalidate(): void { this.dirty = true }

  camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera { return this.st.ortho ? this.ortho : this.persp }

  private place(W: number, H: number, pw: number): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    const cam = this.camera()
    this.orbit!.place(cam, W / H, this.st.fov)
    if (pw > 0.5) cam.setViewOffset(W, H, pw / 2, 0, W, H)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
    return cam
  }

  private channels(): { list: string[]; region: Region } {
    const st = this.st
    const dpr = this.opts.pixelRatio()
    if (this.opts.compact || st.mode === 'single') return { list: [st.ch], region: { kind: 'none' } }
    if (st.mode === 'wipe') return { list: st.wipe.ch, region: { kind: 'wipe', x: st.wipe.x * this.W * dpr, y: st.wipe.y * this.H * dpr, angle: st.wipe.ang } }
    return { list: st.strips, region: { kind: 'strips' } }
  }

  private draw(): void {
    const s = this.stage
    if (!s || !this.orbit) return
    const dpr = this.opts.pixelRatio()
    const wd = Math.round(this.W * dpr), hd = Math.round(this.H * dpr)
    const cam = this.place(this.W, this.H, this.pw)
    const { list, region } = this.channels()
    this.hub.draw(this.canvas, wd, hd, r => {
      r.toneMapping = TONE[this.st.tone]
      r.toneMappingExposure = Math.pow(2, this.st.exp)
      s.render(r, cam, list, region, wd, hd)
    })
    this.opts.onFrame?.({ cam, W: this.W, H: this.H, pw: this.pw, stage: s })
  }

  start(): void {
    if (this.raf) return
    this.last = performance.now()
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      let moving = false
      const s = this.stage
      const st = this.st
      if (s && st.play) {
        const clip = s.clips[st.clip]
        if (clip) {
          let t = this.time + dt * st.speed
          if (t >= clip.duration) {
            if (st.loop) t = clip.duration > 0 ? t % clip.duration : 0
            else { t = clip.duration; this.opts.onTime?.(t, false) }
          }
          this.time = t
          s.pose(st.clip, t)
          this.opts.onTime?.(t, st.play && (st.loop || t < clip.duration))
          moving = true
        }
      }
      if (this.orbit && this.orbit.step(dt, st.turn && !this.orbit.drag)) moving = true
      const pwT = st.panel && !this.opts.compact ? PANEL_W : 0
      if (Math.abs(this.pw - pwT) > 0.5) { this.pw += (pwT - this.pw) * (1 - Math.exp(-dt * 12)); moving = true }
      else if (this.pw !== pwT) { this.pw = pwT; moving = true }
      if (moving || this.dirty) { this.dirty = false; this.draw() }
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0 }

  /* ───────────── time ───────────── */

  setTime(t: number): void {
    this.time = t
    this.stage?.pose(this.st.clip, t)
    this.opts.onTime?.(t, false)
    this.dirty = true
  }

  /* ───────────── input ───────────── */

  pointerDown(x: number, y: number, pan: boolean): void {
    if (!this.orbit) return
    this.turnBeforeDrag = this.st.turn
    this.orbit.begin(x, y, pan)
    if (this.st.turn) this.opts.onTurnChange?.(false)
  }

  pointerMove(x: number, y: number): void {
    if (!this.orbit?.drag) return
    this.orbit.move(x, y, this.camera())
    this.dirty = true
  }

  pointerUp(): void {
    if (!this.orbit?.drag) return
    const flicked = this.orbit.end()
    if (this.turnBeforeDrag && !flicked) this.opts.onTurnChange?.(true)
  }

  wheel(deltaY: number): void { this.orbit?.zoom(deltaY); this.dirty = true }
  setView(key: string): void { this.orbit?.setView(key); this.dirty = true }
  frameAll(): void { this.orbit?.frameAll(); this.dirty = true }

  /* ───────────── output ───────────── */

  /**
   * A square shot of the current view (出图): one channel (the current one, or 完整渲染 in a split), no size
   * lines, grid or skeleton; ground and background only when not transparent.
   */
  capture(px: number, transparent: boolean, background: (ctx: CanvasRenderingContext2D, px: number) => void): HTMLCanvasElement {
    const s = this.stage!
    const st = this.st
    const keep = s.getDisplay()
    s.setDisplay({ grid: false, skeleton: false, box: false, ground: keep.ground && !transparent })
    const savedBg = this.bgTex
    if (transparent) s.setEnvironment(this.envTex, st.envRot, null)
    const cam = this.camera()
    this.orbit!.place(cam, 1, st.fov)
    cam.clearViewOffset()
    cam.updateProjectionMatrix()
    const ch = st.mode === 'single' ? st.ch : 'full'
    this.hub.draw(null, px, px, r => {
      r.toneMapping = TONE[st.tone]
      r.toneMappingExposure = Math.pow(2, st.exp)
      s.render(r, cam, [ch], { kind: 'none' }, px, px)
    })
    const out = this.hub.snapshot(px, px, transparent ? undefined : ctx => background(ctx, px))
    s.setDisplay(keep)
    if (transparent) s.setEnvironment(this.envTex, st.envRot, st.bg === 'env' ? savedBg : null)
    this.dirty = true
    return out
  }

  dispose(): void {
    this.stop()
    this.stage?.dispose()
    this.stage = null
  }
}
