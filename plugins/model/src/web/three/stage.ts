/**
 * The scene around a loaded model, shared by the viewer, thumbnails, the grid turntable and the compare views:
 * environment lighting, an adjustable key light with shadow, ground, grid, bounding box, skeleton, animation,
 * and the channel passes (single, wipe, slanted strips) drawn with the same camera.
 */
import * as THREE from 'three'
import { isShaded } from '../lib/channels'
import { ChannelMaterials, patchMaterial, U, ALL_VISIBLE, type Visibility } from './materials'
import type { LoadedModel } from './load'
import type { ModelAnalysis } from './analyze'

export interface StageDisplay {
  light: boolean
  shadow: boolean
  /** Key light direction: azimuth around Y from +Z, elevation above the ground, degrees. */
  az: number
  el: number
  ground: boolean
  grid: boolean
  box: boolean
  skeleton: boolean
}

export const DEFAULT_DISPLAY: StageDisplay = { light: true, shadow: true, az: 40, el: 42, ground: true, grid: false, box: false, skeleton: false }

export type Region =
  | { kind: 'none' }
  | { kind: 'wipe'; x: number; y: number; angle: number }
  | { kind: 'strips' }

function niceStep(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

export class ModelStage {
  readonly scene = new THREE.Scene()
  readonly root: THREE.Object3D
  readonly mats: ChannelMaterials
  readonly key = new THREE.DirectionalLight(0xffffff, 1.6)
  readonly ground: THREE.Mesh
  readonly grid: THREE.GridHelper
  readonly box: THREE.Box3Helper
  readonly skeleton: THREE.SkeletonHelper | null = null
  private joints: THREE.Points | null = null
  readonly mixer: THREE.AnimationMixer | null
  private actions: THREE.AnimationAction[] = []
  private clipIndex = -1
  private display: StageDisplay = { ...DEFAULT_DISPLAY }
  private background: THREE.Texture | null = null
  vis: Visibility = ALL_VISIBLE

  constructor(readonly model: LoadedModel, readonly info: ModelAnalysis) {
    this.root = model.root
    this.scene.add(this.root)
    this.mats = new ChannelMaterials(this.root)
    this.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
    const { bounds, center, radius } = info

    const key = this.key
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0005
    key.shadow.normalBias = radius * 0.004
    key.shadow.radius = 3
    const sc = key.shadow.camera
    sc.left = sc.bottom = -radius * 1.6
    sc.right = sc.top = radius * 1.6
    sc.near = radius * 0.05
    sc.far = radius * 10
    key.target.position.copy(center)
    this.scene.add(key, key.target)

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 24, radius * 24), patchMaterial(new THREE.ShadowMaterial({ opacity: 0.34 })))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.set(center.x, bounds.min.y, center.z)
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    const cell = niceStep(radius / 8)
    this.grid = new THREE.GridHelper(cell * 40, 40, 0x9aa0aa, 0x9aa0aa)
    const gm = this.grid.material as THREE.LineBasicMaterial
    gm.transparent = true; gm.opacity = 0.25; gm.toneMapped = false
    patchMaterial(gm)
    this.grid.position.set(center.x, bounds.min.y + radius * 0.0005, center.z)
    this.scene.add(this.grid)

    this.box = new THREE.Box3Helper(bounds.clone(), new THREE.Color(0x8db4ff))
    patchMaterial(this.box.material as THREE.Material)
    ;(this.box.material as THREE.LineBasicMaterial).toneMapped = false
    this.scene.add(this.box)

    if (info.bones > 0) {
      const sk = new THREE.SkeletonHelper(this.root)
      const sm = sk.material as THREE.LineBasicMaterial
      sm.color = new THREE.Color(0xffd166); sm.depthTest = false; sm.transparent = true; sm.toneMapped = false
      sm.vertexColors = false
      patchMaterial(sm)
      sk.renderOrder = 9
      this.skeleton = sk
      this.scene.add(sk)
      const pts = new THREE.Points(sk.geometry, patchMaterial(new THREE.PointsMaterial({ color: 0xffd166, size: 7, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false })))
      pts.renderOrder = 9
      this.joints = pts
      this.scene.add(pts)
    }

    this.mixer = model.animations.length ? new THREE.AnimationMixer(this.root) : null
    if (this.mixer) this.actions = model.animations.map(c => this.mixer!.clipAction(c))
    this.setDisplay({})
  }

  get clips(): THREE.AnimationClip[] { return this.model.animations }

  setDisplay(d: Partial<StageDisplay>): void {
    this.display = { ...this.display, ...d }
    const { az, el } = this.display
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, R = this.info.radius * 4
    const c = this.info.center
    this.key.position.set(c.x + Math.sin(a) * Math.cos(e) * R, c.y + Math.sin(e) * R, c.z + Math.cos(a) * Math.cos(e) * R)
    this.key.castShadow = this.display.shadow
  }

  getDisplay(): StageDisplay { return this.display }

  /** Environment map, its rotation (degrees around Y), and the background picture (HDR) or none (CSS draws it). */
  setEnvironment(env: THREE.Texture | null, rotationDeg = 0, background: THREE.Texture | null = null, intensity = 1): void {
    this.scene.environment = env
    this.scene.environmentRotation.set(0, (rotationDeg * Math.PI) / 180, 0)
    this.scene.environmentIntensity = intensity
    this.background = background
    this.scene.backgroundRotation.set(0, (rotationDeg * Math.PI) / 180, 0)
  }

  /** Select an animation clip (−1: none) and put it at time `t` seconds. */
  pose(clip: number, t: number): void {
    if (!this.mixer) return
    if (clip !== this.clipIndex) {
      this.mixer.stopAllAction()
      this.clipIndex = clip
      const a = this.actions[clip]
      if (a) { a.reset(); a.play(); a.paused = true }
    }
    const a = this.actions[clip]
    if (!a) return
    a.time = t
    this.mixer.update(0)
  }

  private helpersFor(shaded: boolean, firstPass: boolean): void {
    const d = this.display
    this.key.visible = shaded && d.light
    this.ground.visible = shaded && d.ground && d.light && d.shadow
    this.grid.visible = d.grid
    this.box.visible = d.box
    if (this.skeleton) this.skeleton.visible = d.skeleton
    if (this.joints) this.joints.visible = d.skeleton
    this.scene.background = firstPass ? this.background : null
  }

  private pass(r: THREE.WebGLRenderer, cam: THREE.Camera, ch: string, first: boolean): void {
    const shaded = isShaded(ch)
    this.mats.apply(ch, this.vis)
    this.helpersFor(shaded, first)
    r.autoClear = first
    r.render(this.scene, cam)
    if (ch.split('.')[0] === 'wireover') {
      this.mats.applyWireOverlay(this.vis)
      this.ground.visible = false
      this.scene.background = null
      r.autoClear = false
      r.render(this.scene, cam)
    }
  }

  /**
   * Draw the channels into the current viewport (`w × h` device pixels): one channel, a wipe (two) or slanted
   * strips (two to four). All passes share the camera; each keeps only its region of the screen.
   */
  render(r: THREE.WebGLRenderer, cam: THREE.Camera, channels: string[], region: Region, w: number, h: number): void {
    U.bbRes.value.set(w, h)
    if (region.kind === 'none' || channels.length < 2) {
      U.bbRegMode.value = 0
      this.pass(r, cam, channels[0] ?? 'full', true)
    } else {
      U.bbRegMode.value = region.kind === 'wipe' ? 1 : 2
      if (region.kind === 'wipe') {
        U.bbWipeP.value.set(region.x, region.y)
        U.bbWipeN.value.set(Math.cos(region.angle), Math.sin(region.angle))
      }
      U.bbStripN.value = channels.length
      channels.forEach((ch, i) => { U.bbRegIdx.value = i; this.pass(r, cam, ch, i === 0) })
      U.bbRegMode.value = 0
    }
    r.autoClear = true
    this.mats.restore()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.mats.dispose()
    this.model.dispose()
    this.ground.geometry.dispose(); (this.ground.material as THREE.Material).dispose()
    this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose()
    this.box.geometry.dispose(); (this.box.material as THREE.Material).dispose()
    this.skeleton?.dispose()
    ;(this.joints?.material as THREE.Material | undefined)?.dispose()
  }
}
