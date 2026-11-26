import { BowerbirdApiError, splitName } from '@bowerbird/schema'
import { serverMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { fmtDate, fmtDateTime, fmtDayTime, fmtInt, fmtSize } from '../../lib/format'

/** Display helpers for web-2 that follow the UI language. */

export { fmtInt, fmtSize }

/** 刚刚 / N 小时前 / N 天前 / N 个月前. */
export function ago(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return '—'
  const tms = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(tms)) return '—'
  const d = Math.floor((now - tms) / 86_400_000)
  if (d < 1) {
    const h = Math.floor((now - tms) / 3_600_000)
    if (h >= 1) return t('w2.time.hours', { n: h })
    const m = Math.floor((now - tms) / 60_000)
    return m >= 1 ? t('w2.time.minutes', { n: m }) : t('w2.time.now')
  }
  return d < 30 ? t('w2.time.days', { n: d }) : t('w2.time.months', { n: Math.floor(d / 30) })
}

const valid = (iso: string | null | undefined): iso is string => !!iso && !Number.isNaN(new Date(iso).getTime())
/** `11 月 24 日 16:42` / `Nov 24 16:42` / `11月24日 16:42` / `11월 24일 16:42` (lib/format, ADR-061). */
export function at(iso: string | null | undefined): string { return valid(iso) ? fmtDateTime(iso) : '—' }
/** Date only: `11 月 24 日` / `Nov 24`. */
export function day(iso: string | null | undefined): string { return valid(iso) ? fmtDate(iso) : '—' }
/** Day of the month and time: `24 日 16:42`. */
export function dayTime(iso: string | null | undefined): string { return valid(iso) ? fmtDayTime(iso) : '—' }

/** `user:unnamed` shows as「未署名」(ADR-023); other actors stay verbatim. */
export function who(actor: string | null | undefined): string {
  return !actor || actor === 'user:unnamed' ? t('w2.common.unnamed') : actor
}

/** Last path segment. */
export function baseName(path: string): string { const i = path.lastIndexOf('/'); return i < 0 ? path : path.slice(i + 1) }
/** Folder of a library-relative path ('' = root). */
export function folderOf(path: string): string { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i) }
/** Extension without the dot, lower case. */
export function extOf(name: string): string { const i = name.lastIndexOf('.'); return i <= 0 ? '' : name.slice(i + 1).toLowerCase() }

/** The message of an API error, for toasts. */
export function errText(e: unknown): string {
  if (e instanceof BowerbirdApiError) return e.code === 'network' ? t('common.offline') : serverMessage(e)
  return e instanceof Error ? e.message : String(e)
}
export function errCode(e: unknown): string | null { return e instanceof BowerbirdApiError ? e.code : null }

/** The name a restored file gets when its place is taken (sync-and-integrity.md「副本的名字」). */
export function renamedName(name: string): string { const { base, ext } = splitName(name); return `${base}_1${ext}` }
