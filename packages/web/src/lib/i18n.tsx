import * as React from 'react'
import { LOCALES, DEFAULT_LOCALE, fillPlaceholders, isLocale, localeChain, matchLocale, type Locale } from '@bowerbird/schema'

/**
 * All user-facing text is external (engineering.md「代码约定」). The languages are the list in @bowerbird/schema
 * (`LOCALES`, ADR-061); Chinese is the source (copied verbatim from design/docs/copy.md) and has every key, a key
 * missing in another language falls back to English, then Chinese. Params: `{name}`.
 *
 * Dictionaries are found by folder: i18n/<language>/shell.ts (web-1) and pages.ts (web-2), split by line to avoid edit
 * conflicts. A folder belongs to the language it names (`zh` → zh-CN, `ja` → ja), so adding a language is data only:
 * a line in `LOCALES` and a folder here.
 */
export type { Locale }
export { LOCALES }

const modules = import.meta.glob<Record<string, string>>('../i18n/*/*.ts', { eager: true, import: 'default' })
export const DICTS: Record<Locale, Record<string, string>> = Object.fromEntries(LOCALES.map(l => [l.id, {}])) as Record<Locale, Record<string, string>>
for (const [file, dict] of Object.entries(modules)) {
  const folder = /\/i18n\/([^/]+)\//.exec(file)?.[1]
  const locale = folder ? matchLocale([folder]) : null
  if (locale) Object.assign(DICTS[locale], dict)
}

/** What the language setting holds: a language, or `auto` = follow the system (browser) language. */
export type LocalePref = Locale | 'auto'
const KEY = 'bowerbird.locale'

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language ?? '']
}
/** The language the system asks for, among ours (else English). */
export function systemLocale(browser: readonly string[] = browserLanguages()): Locale { return matchLocale(browser) ?? DEFAULT_LOCALE }

/** The saved choice, else (none saved, or `auto`) the browser's languages, else English. */
export function initialLocale(saved: string | null, browser: readonly string[]): Locale {
  if (isLocale(saved)) return saved
  return systemLocale(browser)
}

let pref: LocalePref = (() => {
  let saved: string | null = null
  try { saved = localStorage.getItem(KEY) } catch { /* private mode */ }
  return isLocale(saved) ? saved : 'auto'
})()
let current: Locale = pref === 'auto' ? systemLocale() : pref
if (typeof document !== 'undefined') document.documentElement.lang = current
const listeners = new Set<() => void>()

function apply(next: Locale): void {
  if (next === current) { listeners.forEach(f => f()); return }
  current = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
  listeners.forEach(f => f())
}

// Following the system: switch as soon as the browser's language changes.
if (typeof window !== 'undefined') window.addEventListener('languagechange', () => { if (pref === 'auto') apply(systemLocale()) })

export function t(key: string, params?: Record<string, string | number>): string {
  for (const l of localeChain(current)) {
    const s = DICTS[l][key]
    if (s !== undefined) return fillPlaceholders(s, params)
  }
  return key
}
export function getLocale(): Locale { return current }
export function getLocalePref(): LocalePref { return pref }
/** Set the language setting: a language, or `auto` to follow the system again. */
export function setLocalePref(p: LocalePref): void {
  pref = p
  try { if (p === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p) } catch { /* ignore */ }
  apply(p === 'auto' ? systemLocale() : p)
}
/** Choose a language (same as `setLocalePref(l)`). */
export function setLocale(l: Locale): void { setLocalePref(l) }
/** Re-render on locale change. */
export function useLocale(): Locale {
  return React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => current)
}
/** The language setting (re-renders on change). */
export function useLocalePref(): LocalePref {
  return React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => pref)
}
