/**
 * Strings for plugin UIs in every shell language (ADR-061). A plugin gives its strings per language; Chinese is
 * required (the source), others are optional and fall back to English, then Chinese:
 *
 *   const messages = defineMessages({
 *     'zh-CN': { play: '播放', frameOf: '帧 {i} / {n}' },
 *     en: { play: 'Play', frameOf: 'Frame {i} / {n}' },
 *     ja: { play: '再生' }
 *   })
 *   function Toolbar() { const m = useMessages(messages); return <button>{m('play')}</button> }
 *
 * Code outside components (a function the shell calls) uses `translate(messages, pageLocale(), key)`.
 */
import * as React from 'react'
// the subpath keeps the schema's zod models out of this module (only the language list and lookup order)
import { LOCALES, fillPlaceholders, localeChain, localizeText, matchLocale, SOURCE_LOCALE, type Locale, type TextTable } from '@bowerbird/schema/locale'
import { ShellContext } from './shell'

export { LOCALES, localeChain, localizeText, matchLocale, type Locale, type TextTable }

export type Messages<K extends string> = { readonly 'zh-CN': Readonly<Record<K, string>> } &
  { readonly [L in Exclude<Locale, 'zh-CN'>]?: Readonly<Partial<Record<K, string>>> }

/** Identity, for type inference: the keys come from the Chinese strings. */
export function defineMessages<K extends string>(m: Messages<K>): Messages<K> { return m }

export function translate<K extends string>(m: Messages<K>, locale: string, key: K, params?: Record<string, string | number>): string {
  for (const l of localeChain(locale)) {
    const s = (m as Partial<Record<Locale, Partial<Record<K, string>>>>)[l]?.[key]
    if (s !== undefined) return fillPlaceholders(s, params)
  }
  return fillPlaceholders(m['zh-CN'][key] ?? key, params)
}

/** The page language the shell set on `<html lang>` (for code that runs outside components). */
export function pageLocale(): Locale {
  try { return (typeof document !== 'undefined' && matchLocale([document.documentElement.lang])) || SOURCE_LOCALE } catch { return SOURCE_LOCALE }
}

/** A translate function for the shell's current language; re-renders when the language changes. */
export function useMessages<K extends string>(m: Messages<K>): (key: K, params?: Record<string, string | number>) => string {
  const shell = React.useContext(ShellContext)
  const locale = shell?.locale ?? pageLocale()
  return React.useCallback((key: K, params?: Record<string, string | number>) => translate(m, locale, key, params), [m, locale])
}

/** The language names to show in a language picker, each in its own language. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = Object.fromEntries(LOCALES.map(l => [l.id, l.name])) as Record<Locale, string>
