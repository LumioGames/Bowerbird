/**
 * Orbit camera of the prototype (model.js): spherical angles with critically damped springs for presets and
 * zoom, momentum after a flick, a rubber band at the poles, pan along the screen plane. Kept in the render
 * loop, never in React state (review A-18).
 */
import * as THREE from 'three'

export const PH_MIN = 0.06
export const PH_MAX = Math.PI - 0.06
const WN = (2 * Math.PI) / 0.42

export function wrapAngle(x: number): number { return Math.atan2(Math.sin(x), Math.cos(x)) }

export function rubberband(over: number, k = 1.4): number {
  const d = 0.55
  return (1 - 1 / ((Math.abs(over) * d) / k + 1)) * k * Math.sign(over)
}

/** Six view directions (正 / 背 / 右 / 左 / 顶 / 底, titles `cube.<key>` in i18n): azimuth (null keeps it) and polar angle. */
export const VIEWS: Record<'z' | '-z' | 'x' | '-x' | 'y' | '-y', [number | null, number]> = {
  z: [0, Math.PI / 2],
  '-z': [Math.PI, Math.PI / 2],
  x: [Math.PI / 2, Math.PI / 2],
  '-x': [-Math.PI / 2, Math.PI / 2],
  y: [null, 0.0012],
  '-y': [null, Math.PI - 0.0012]
}

export const HOME = { th: 0.62, ph: 1.12 }

export class Orbit {
  th = HOME.th
  ph = HOME.ph
  r: number
  tr: number
  vth = 0
  vph = 0
  vr = 0
  goal: { th: number; ph: number } | null = null
  target: THREE.Vector3
  drag: { x: number; y: number; th: number; ph: number; pan: boolean; tgt: THREE.Vector3 } | null = null
  private samples: Array<{ x: number; y: number; t: number }> = []

  constructor(readonly home: number, readonly center: THREE.Vector3) {
    this.r = this.tr = home
    this.target = center.clone()
  }

  private spring(k: 'th' | 'ph' | 'r', g: number, dt: number): void {
    const v = ('v' + k) as 'vth' | 'vph' | 'vr'
    const h = dt / 4
    for (let i = 0; i < 4; i++) { this[v] += (-WN * WN * (this[k] - g) - 2 * WN * this[v]) * h; this[k] += this[v] * h }
  }

  /** Advance one frame; returns whether anything moved. */
  step(dt: number, turntable: boolean): boolean {
    let moving = false
    if (!this.drag) {
      if (this.goal) {
        this.spring('th', this.goal.th, dt); this.spring('ph', this.goal.ph, dt); moving = true
        if (Math.abs(this.th - this.goal.th) < 1e-4 && Math.abs(this.ph - this.goal.ph) < 1e-4 && Math.abs(this.vth) + Math.abs(this.vph) < 1e-3) {
          this.th = this.goal.th; this.ph = this.goal.ph; this.goal = null; this.vth = this.vph = 0
        }
      } else {
        if (Math.abs(this.vth) + Math.abs(this.vph) > 1e-3) {
          const k = Math.exp(-dt * 4.5)
          this.th += this.vth * dt; this.ph += this.vph * dt; this.vth *= k; this.vph *= k; moving = true
        }
        if (this.ph < PH_MIN || this.ph > PH_MAX) {
          this.vph = 0
          this.ph += (THREE.MathUtils.clamp(this.ph, PH_MIN, PH_MAX) - this.ph) * (1 - Math.exp(-dt * 16)); moving = true
        }
        if (turntable) { this.th += dt * 0.45; moving = true }
      }
      if (Math.abs(this.r - this.tr) > 1e-5 * this.home || Math.abs(this.vr) > 1e-5) { this.spring('r', this.tr, dt); moving = true }
    }
    return moving
  }

  setView(key: string): void {
    const v = VIEWS[key as keyof typeof VIEWS]
    if (!v) return
    const th = v[0] === null ? this.th : this.th + wrapAngle(v[0] - this.th)
    this.goal = { th, ph: v[1] }
    this.vth = this.vph = 0
  }

  /** Azimuth / polar goal directly (compare views' 正 / 侧 / 背 / 顶 presets). */
  setGoal(th: number, ph: number): void {
    this.goal = { th: this.th + wrapAngle(th - this.th), ph }
    this.vth = this.vph = 0
  }

  frameAll(): void {
    this.target.copy(this.center)
    this.tr = this.home
    this.goal = { th: this.th + wrapAngle(HOME.th - this.th), ph: HOME.ph }
  }

  zoom(deltaY: number): void {
    this.tr = THREE.MathUtils.clamp(this.tr * Math.exp(deltaY * 0.0012), this.home * 0.05, this.home * 4)
  }

  begin(x: number, y: number, pan: boolean): void {
    this.goal = null; this.vth = this.vph = 0
    this.drag = { x, y, th: this.th, ph: this.ph, pan, tgt: this.target.clone() }
    this.samples = [{ x, y, t: performance.now() }]
  }

  move(x: number, y: number, cam: THREE.Camera): void {
    const d = this.drag
    if (!d) return
    this.samples.push({ x, y, t: performance.now() })
    if (this.samples.length > 6) this.samples.shift()
    const dx = x - d.x, dy = y - d.y
    if (d.pan) {
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1)
      const k = this.r * 0.0017
      this.target.copy(d.tgt).addScaledVector(right, -dx * k).addScaledVector(up, dy * k)
    } else {
      this.th = d.th - dx * 0.008
      const raw = d.ph - dy * 0.008
      this.ph = raw < PH_MIN ? PH_MIN + rubberband(raw - PH_MIN) : raw > PH_MAX ? PH_MAX + rubberband(raw - PH_MAX) : raw
    }
  }

  /** Release: a flick keeps turning and slows down. Returns whether it flicked. */
  end(): boolean {
    const d = this.drag
    this.drag = null
    if (!d || d.pan) return false
    const s = this.samples
    if (s.length < 2) return false
    const a = s[0]!, b = s[s.length - 1]!
    const dt = Math.max(1, b.t - a.t) / 1000
    if (performance.now() - b.t > 80) return false
    this.vth = (-(b.x - a.x) / dt) * 0.008
    this.vph = (-(b.y - a.y) / dt) * 0.008
    return Math.abs(this.vth) > 1e-3
  }

  place(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number, fovDeg: number): void {
    const sp = Math.sin(this.ph)
    cam.position.set(this.target.x + this.r * sp * Math.sin(this.th), this.target.y + this.r * Math.cos(this.ph), this.target.z + this.r * sp * Math.cos(this.th))
    cam.up.set(0, 1, 0)
    cam.lookAt(this.target)
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = cam as THREE.OrthographicCamera
      const hh = this.r * Math.tan((fovDeg * Math.PI) / 360)
      o.left = -hh * aspect; o.right = hh * aspect; o.top = hh; o.bottom = -hh
    } else {
      const p = cam as THREE.PerspectiveCamera
      p.fov = fovDeg; p.aspect = aspect
    }
    cam.near = this.home * 0.002
    cam.far = this.home * 60
    cam.updateMatrixWorld(true)
  }
}
