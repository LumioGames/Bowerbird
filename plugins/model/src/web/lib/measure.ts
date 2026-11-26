/**
 * Size display (builtin-plugins.md「尺寸显示」): the bounding box with its three edges nearest the camera
 * measured, coloured by axis, in metres; and a scale bar true at the depth of the model's centre, following
 * zoom and field of view (orthographic: the frustum height). Pure.
 */

export const AXIS_COLOR = { x: '#e5534b', y: '#6cbf43', z: '#4f8ff0' } as const
export type Vec3 = [number, number, number]

/** Pixels per metre at the model centre's depth. Perspective: depth along the view direction; orthographic: frustum height. */
export function pixelsPerMeter(o: { ortho: boolean; heightPx: number; fovDeg: number; depth: number; orthoHeight: number }): number {
  if (o.ortho) return o.heightPx / Math.max(1e-9, o.orthoHeight)
  const visible = 2 * Math.max(1e-9, o.depth) * Math.tan((o.fovDeg * Math.PI) / 360)
  return o.heightPx / visible
}

export const SCALE_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]

/** The longest round length whose bar fits in `maxPx` (default 132 px, as in the prototype). */
export function scaleBar(ppm: number, maxPx = 132): { meters: number; px: number; label: string } {
  let L = SCALE_STEPS[0]!
  for (const s of SCALE_STEPS) if (s * ppm <= maxPx) L = s
  const label = L < 0.01 ? `${Math.round(L * 1000)} mm` : L < 1 ? `${Math.round(L * 100)} cm` : `${L} m`
  return { meters: L, px: L * ppm, label }
}

export interface Edge { axis: 'x' | 'y' | 'z'; a: Vec3; b: Vec3; length: number }

/**
 * The three measured edges: along the bottom, the X and Z edges on the sides facing the camera, and the
 * vertical Y edge at their shared corner.
 */
export function nearestEdges(min: Vec3, max: Vec3, cam: Vec3): Edge[] {
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2
  const xs = cam[0] >= cx ? max[0] : min[0]
  const zs = cam[2] >= cz ? max[2] : min[2]
  const y0 = min[1]
  return [
    { axis: 'x', a: [min[0], y0, zs], b: [max[0], y0, zs], length: max[0] - min[0] },
    { axis: 'z', a: [xs, y0, min[2]], b: [xs, y0, max[2]], length: max[2] - min[2] },
    { axis: 'y', a: [xs, y0, zs], b: [xs, max[1], zs], length: max[1] - min[1] }
  ]
}

export function fmtMeters(m: number): string { return `${m.toFixed(2)} m` }
export function fmtSize(x: number, y: number, z: number): string { return `${x.toFixed(2)} × ${y.toFixed(2)} × ${z.toFixed(2)} m` }
