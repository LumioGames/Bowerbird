/**
 * The one built-in check (ADR-020): the model's bounding box against the design object's target size, axis by
 * axis — width X, height Y, depth Z. Shown only; it never changes the review status. Shared by the server
 * validator and the turnaround overlay's size readout so both say the same thing.
 */

/** The validator id and its one rule (manifest `contributes.validators`). */
export const SIZE_CHECK = 'size-vs-design'

export interface Size3 { x: number; y: number; z: number }
export interface TargetSize { w: number; h: number; d: number }
export type Axis = 'w' | 'h' | 'd'

/**
 * Tolerance for "相符": within 1 cm or 2 % of the target, whichever is larger (proposed ADR, see the hand-back).
 * 1 cm keeps small props from failing on modelling noise; 2 % keeps large ones from needing millimetre accuracy.
 */
export const SIZE_TOLERANCE = { abs: 0.01, rel: 0.02 } as const

export const AXIS_LABEL: Record<Axis, string> = { w: '宽', h: '高', d: '深' }
/** Which model axis each target axis is measured on. */
export const AXIS_OF: Record<Axis, keyof Size3> = { w: 'x', h: 'y', d: 'z' }

export function sizeMatches(got: number, want: number): boolean {
  return Math.abs(got - want) <= Math.max(SIZE_TOLERANCE.abs, SIZE_TOLERANCE.rel * Math.abs(want)) + 1e-9
}

export interface AxisResult { axis: Axis; label: string; model: number; target: number; ok: boolean }
export interface SizeComparison { ok: boolean; axes: AxisResult[]; model: Size3; target: TargetSize }

export function compareSize(model: Size3, target: TargetSize): SizeComparison {
  const axes = (['w', 'h', 'd'] as Axis[]).map(axis => {
    const m = model[AXIS_OF[axis]]
    const t = target[axis]
    return { axis, label: AXIS_LABEL[axis], model: m, target: t, ok: sizeMatches(m, t) }
  })
  return { ok: axes.every(a => a.ok), axes, model, target }
}

export const m2 = (n: number): string => n.toFixed(2)

/** copy.md「自动检查」: 尺寸与设计对象：模型 {x × y × z} m · 目标 {w × h × d} m（不一致时逐轴写「宽 1.30 m，应为 1.26」）. */
export function sizeMessage(c: SizeComparison): string {
  const head = `尺寸与设计对象：模型 ${m2(c.model.x)} × ${m2(c.model.y)} × ${m2(c.model.z)} m · 目标 ${m2(c.target.w)} × ${m2(c.target.h)} × ${m2(c.target.d)} m`
  if (c.ok) return head
  return head + ' · ' + c.axes.filter(a => !a.ok).map(a => `${a.label} ${m2(a.model)} m，应为 ${m2(a.target)}`).join('；')
}

/** A size from tech values (`boundsX/Y/Z`), or null when any axis is missing. */
export function sizeFromTech(tech: Record<string, unknown> | null | undefined): Size3 | null {
  if (!tech) return null
  const x = tech.boundsX, y = tech.boundsY, z = tech.boundsZ
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  if (![x, y, z].every(Number.isFinite)) return null
  return { x, y, z }
}
