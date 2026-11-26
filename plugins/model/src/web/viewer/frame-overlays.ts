/**
 * Overlays redrawn every frame the camera moves, written straight into the DOM (no React render per frame):
 * the bounding-box size lines with the scale bar (builtin-plugins.md「尺寸显示」) and the view cube.
 */
import * as THREE from 'three'
import { AXIS_COLOR, fmtSize, nearestEdges, pixelsPerMeter, scaleBar, type Vec3 } from '../lib/measure'
import { zh, type Key, type T } from '../i18n'

const v = new THREE.Vector3()

function escapeAttr(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }

function project(p: Vec3, cam: THREE.Camera, W: number, H: number) {
  v.set(p[0], p[1], p[2]).project(cam)
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, z: v.z }
}

/** Size lines on the three nearest edges, coloured by axis, and the scale bar true at the model centre's depth. */
export function drawSize(host: HTMLElement, cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, W: number, H: number, bounds: THREE.Box3, fov: number, tr: T = zh): void {
  const min: Vec3 = [bounds.min.x, bounds.min.y, bounds.min.z]
  const max: Vec3 = [bounds.max.x, bounds.max.y, bounds.max.z]
  const cp: Vec3 = [cam.position.x, cam.position.y, cam.position.z]
  let lines = '', labels = ''
  for (const e of nearestEdges(min, max, cp)) {
    const a = project(e.a, cam, W, H), b = project(e.b, cam, W, H)
    if (a.z > 1 || b.z > 1) continue
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 14) continue
    const nx = (-(b.y - a.y) / len) * 4, ny = ((b.x - a.x) / len) * 4
    const col = AXIS_COLOR[e.axis]
    const f = (n: number) => n.toFixed(1)
    lines += `<path d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}M${f(a.x - nx)} ${f(a.y - ny)}L${f(a.x + nx)} ${f(a.y + ny)}M${f(b.x - nx)} ${f(b.y - ny)}L${f(b.x + nx)} ${f(b.y + ny)}" stroke="${col}"/>`
    labels += `<span class="bbm-dim" style="left:${f((a.x + b.x) / 2)}px;top:${f((a.y + b.y) / 2)}px"><i style="background:${col}"></i>${e.length.toFixed(2)} m</span>`
  }
  const center = bounds.getCenter(new THREE.Vector3())
  const dir = new THREE.Vector3()
  cam.getWorldDirection(dir)
  const depth = center.clone().sub(cam.position).dot(dir)
  const ortho = (cam as THREE.OrthographicCamera).isOrthographicCamera === true
  const oc = cam as THREE.OrthographicCamera
  const ppm = pixelsPerMeter({ ortho, heightPx: H, fovDeg: fov, depth, orthoHeight: ortho ? (oc.top - oc.bottom) / oc.zoom : 1 })
  const bar = scaleBar(ppm)
  const size = bounds.getSize(new THREE.Vector3())
  host.innerHTML = `<svg class="bbm-dimsvg" width="${W}" height="${H}">${lines}</svg>${labels}` +
    `<div class="bbm-scale" title="${escapeAttr(tr('scaleTitle'))}"><span class="bbm-scale__bar" style="width:${bar.px.toFixed(1)}px"></span><span class="bbm-num">${bar.label}</span><small>${fmtSize(size.x, size.y, size.z)}</small></div>`
}

const AX: Array<[string, Vec3, string, string]> = [
  ['x', [1, 0, 0], 'X', AXIS_COLOR.x], ['-x', [-1, 0, 0], '', AXIS_COLOR.x],
  ['y', [0, 1, 0], 'Y', AXIS_COLOR.y], ['-y', [0, -1, 0], '', AXIS_COLOR.y],
  ['z', [0, 0, 1], 'Z', AXIS_COLOR.z], ['-z', [0, 0, -1], '', AXIS_COLOR.z]
]

/** The view cube: six axis ends, the nearer ones drawn on top; click one to look along it. */
export function drawGizmo(svg: SVGSVGElement, cam: THREE.Camera, tr: T = zh): void {
  const q = cam.quaternion.clone().invert()
  const items = AX.map(x => {
    const p = new THREE.Vector3(...x[1]).applyQuaternion(q)
    return { x, sx: 36 + p.x * 25, sy: 36 - p.y * 25, z: p.z }
  }).sort((m, n) => m.z - n.z)
  svg.innerHTML = '<circle cx="36" cy="36" r="34" class="bbm-gizmo__bg"/>' + items.map(it => {
    const [key, , label, col] = it.x
    const sx = it.sx.toFixed(1), sy = it.sy.toFixed(1)
    return (label ? `<line x1="36" y1="36" x2="${sx}" y2="${sy}" stroke="${col}" stroke-width="2"/>` : '') +
      `<g class="bbm-gizmo__end" data-view="${key}"><title>${escapeAttr(tr(`cube.${key}` as Key))}</title><circle cx="${sx}" cy="${sy}" r="${label ? 8 : 6}" fill="${label ? col : 'var(--surface-raised)'}" stroke="${col}" stroke-width="2"/>` +
      (label ? `<text x="${sx}" y="${(it.sy + 3.5).toFixed(1)}">${label}</text>` : '') + '</g>'
  }).join('')
}
