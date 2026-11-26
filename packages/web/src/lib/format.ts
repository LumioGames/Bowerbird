import type { ReviewStatus, Stage } from '@bowerbird/schema'
import { t } from './i18n'

/** Display helpers shared by the shell. Numbers ≥ 4 digits get thousands separators (design-system README「文案」). */
export function fmtInt(n: number): string { return n.toLocaleString('en-US') }
export function fmtSize(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return Math.round(b / 1e3) + ' KB'
  return b + ' B'
}
/** 刚刚 / N 小时前 / N 天前 / N 个月前 (prototype app.js fmtTime). */
export function fmtRelative(iso: string, now = Date.now()): string {
  const tm = Date.parse(iso)
  const d = Math.floor((now - tm) / 86_400_000)
  if (d < 1) { const h = Math.floor((now - tm) / 3_600_000); return h < 1 ? t('time.now') : t('time.hours', { n: h }) }
  return d < 30 ? t('time.days', { n: d }) : t('time.months', { n: Math.floor(d / 30) })
}
function dateParams(d: Date): Record<string, string | number> {
  const pad = (n: number) => String(n).padStart(2, '0')
  return { month: t(`fmt.month.${d.getMonth() + 1}`), d: d.getDate(), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}
/** `11 月 24 日 16:42` in local time (prototype data.js fmtAt); each language orders month, day and time its own way. */
export function fmtDateTime(iso: string): string { return t('fmt.dateTime', dateParams(new Date(iso))) }
/** `11 月 24 日`. */
export function fmtDate(iso: string): string { return t('fmt.date', dateParams(new Date(iso))) }
/** `24 日 16:42` — the day of the month and the time (the relation graph's centre node). */
export function fmtDayTime(iso: string): string { return t('fmt.dayTime', dateParams(new Date(iso))) }
/** `user:unnamed` shows as「未署名」(ADR-023); other actors stay verbatim in mono. */
export function fmtActor(actor: string | null | undefined): string { return !actor || actor === 'user:unnamed' ? t('common.unnamed') : actor }
export const STAGE_LABEL = { reference: '参考素材', production: '生产物料', runtime: '运行时物料' } as const
export const STAGE_SHORT = { reference: '参考', production: '生产', runtime: '运行时' } as const
export const REVIEW_LABEL = { pending: '待审', approved: '通过', rejected: '打回', exempt: '免审' } as const

/** Localized stage name: long「参考素材」or short「参考」. */
export function stageLabel(s: Stage, short = false): string { return t((short ? 'stage.short.' : 'stage.') + s) }
export function reviewLabel(r: ReviewStatus): string { return t('review.' + r) }
/** Name without the extension: `chest.glb` → `chest`. */
export function stem(name: string): string { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name }
/** Upper-case extension for the list column: `chest.glb` → `GLB`. */
export function extOf(name: string): string { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toUpperCase() : '' }
/** Pluralless「{n} 个资产」or the one name. */
export function namesOrCount(names: string[]): string { return names.length === 1 ? names[0]! : t('common.nAssets', { n: names.length }) }
