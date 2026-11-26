/**
 * The model plugin's words for what its server part wrote down (ADR-061): the grid badge and the size check
 * (ADR-020) in any shell language, rebuilt from the badge's count and the check's measured values. The server keeps
 * writing them in the source language; when the values are not what this expects the shell shows them as written.
 */
import type { CheckView } from '@bowerbird/schema'
import type { ValidatorView } from '@bowerbird/plugin-sdk/web'
import { inLocale, type Key, type T } from '../i18n'
import { trianglesOfBadge } from '../../shared/badge'
import { SIZE_CHECK } from '../../shared/size'

const m2 = (n: number): string => n.toFixed(2)
const AXES = new Set(['w', 'h', 'd'])

function triple(v: unknown): [number, number, number] | null {
  return Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v as [number, number, number] : null
}

/** 「2,480 面」in a language (any other badge unchanged). */
export function modelBadge(badge: string, tr: T): string {
  const n = trianglesOfBadge(badge)
  return n ? tr('badge', { n }) : badge
}

/**
 * The size check's sentence without its label: 模型 x × y × z m · 目标 w × h × d m, then each axis that is off
 * (「宽 1.30 m，应为 1.26」) — the same words as the server's `sizeMessage`, in the language of `tr`.
 */
export function sizeCheckMessage(check: Pick<CheckView, 'rule' | 'values'>, tr: T): string | null {
  if (check.rule !== SIZE_CHECK) return null
  const v = check.values ?? {}
  const model = triple(v.model), target = triple(v.target)
  if (!model || !target) return null
  const head = `${tr('checkModel', { x: m2(model[0]), y: m2(model[1]), z: m2(model[2]) })} · ${tr('checkTarget', { w: m2(target[0]), h: m2(target[1]), d: m2(target[2]) })}`
  const off = (Array.isArray(v.axes) ? v.axes : []).filter((a): a is { axis: string; model: number; target: number; ok: false } => {
    const x = a as Record<string, unknown> | null
    return !!x && x.ok === false && typeof x.axis === 'string' && AXES.has(x.axis) && typeof x.model === 'number' && typeof x.target === 'number'
  })
  if (!off.length) return head
  return `${head} · ${off.map(a => tr('checkAxis', { axis: tr(`axis.${a.axis}` as Key), model: m2(a.model), target: m2(a.target) })).join(tr('checkAxisSep'))}`
}

/** How the shell shows the size check (`WebPlugin.validators['size-vs-design']`). */
export const sizeCheckView: ValidatorView = {
  label: (check, locale) => (check.rule === SIZE_CHECK ? inLocale(locale)('checkLabel') : null),
  message: (check, locale) => sizeCheckMessage(check, inLocale(locale))
}
