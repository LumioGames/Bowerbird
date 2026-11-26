import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { spinCamera, turnAbout } from '../GridCell'
import type { ModelAnalysis } from '../three/analyze'

/** A long, off-centre box (like a chest that is wider than deep), with the minimal analysis the turntable reads. */
function info(): ModelAnalysis {
  const bounds = new THREE.Box3(new THREE.Vector3(0.4, 0, -0.2), new THREE.Vector3(2.0, 0.9, 0.5))
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  return { bounds, size, center, radius: size.length() / 2 } as unknown as ModelAnalysis
}

function cornersNdc(a: ModelAnalysis, cam: THREE.Camera, root: THREE.Object3D): THREE.Vector3[] {
  const b = a.bounds, out: THREE.Vector3[] = []
  for (let k = 0; k < 8; k++) {
    // corners of the model as positioned in its original pose, then moved by the root's turn
    const local = new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z)
    out.push(local.applyMatrix4(root.matrixWorld).project(cam))
  }
  return out
}

describe('grid turntable (the model turns, the camera stays still — prototype model.js spin)', () => {
  it('turns the model about the vertical axis through its centre and restores the pose', () => {
    const a = info()
    const root = new THREE.Group()
    const p0 = root.position.clone(), q0 = root.quaternion.clone()
    turnAbout(root, a.center, p0, q0, Math.PI / 2)
    // the centre does not move; a point on the +X side ends up on the −Z side
    const c = a.center.clone().applyMatrix4(root.matrixWorld)
    expect(c.distanceTo(a.center)).toBeLessThan(1e-9)
    const px = new THREE.Vector3(a.bounds.max.x, a.center.y, a.center.z).applyMatrix4(root.matrixWorld)
    expect(px.x).toBeCloseTo(a.center.x, 9)
    expect(px.z).toBeLessThan(a.center.z)
    turnAbout(root, a.center, p0, q0, 0)
    expect(root.position.length()).toBeLessThan(1e-9)
  })

  it('uses one camera for the whole turn and keeps the model inside the frame at every angle', () => {
    const a = info()
    const cam = spinCamera(a)
    const before = cam.matrixWorld.clone()
    const root = new THREE.Group()
    const p0 = root.position.clone(), q0 = root.quaternion.clone()
    let maxExtent = 0
    for (let i = 0; i < 72; i++) {
      turnAbout(root, a.center, p0, q0, (i / 72) * Math.PI * 2)
      for (const v of cornersNdc(a, cam, root)) {
        expect(Math.abs(v.x)).toBeLessThanOrEqual(1.0001)
        expect(Math.abs(v.y)).toBeLessThanOrEqual(1.0001)
        maxExtent = Math.max(maxExtent, Math.abs(v.x), Math.abs(v.y))
      }
    }
    // the camera itself never moved, and the turn still fills most of the cell (88 % target)
    expect(cam.matrixWorld.equals(before)).toBe(true)
    expect(maxExtent).toBeGreaterThan(0.8)
  })
})
