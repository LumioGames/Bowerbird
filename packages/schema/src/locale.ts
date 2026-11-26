/**
 * UI languages (ADR-061). Chinese is the source language: design/docs/copy.md is written in it and every dictionary
 * has every key in Chinese. A string missing in a language falls back to English, then Chinese.
 *
 * Adding a language: append it here, add the shell dictionaries (packages/web/src/i18n/<id>/), and give the
 * built-in plugins its strings. Until a plugin has them, the plugin shows its English (or Chinese) text.
 */
export const LOCALES = [
  { id: 'zh-CN', name: '简体中文' },
  { id: 'en', name: 'English' },
  { id: 'ja', name: '日本語' },
  { id: 'ko', name: '한국어' }
] as const
export type Locale = (typeof LOCALES)[number]['id']
export const LOCALE_IDS: readonly Locale[] = LOCALES.map(l => l.id)
/** The language every string is written in first. */
export const SOURCE_LOCALE: Locale = 'zh-CN'
/** The language used when the browser asks for none we have. */
export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALE_IDS as readonly string[]).includes(v)
}

/**
 * The first supported language for a list of language tags (e.g. `navigator.languages`): an exact match, else the
 * same language (`ja-JP` → `ja`, `zh-TW` → `zh-CN`, `en-GB` → `en`). Null when none fits.
 */
export function matchLocale(tags: readonly string[]): Locale | null {
  for (const raw of tags) {
    const tag = raw.trim()
    if (!tag) continue
    const exact = LOCALE_IDS.find(id => id.toLowerCase() === tag.toLowerCase())
    if (exact) return exact
    const lang = tag.toLowerCase().split(/[-_]/)[0]
    const same = LOCALE_IDS.find(id => id.toLowerCase().split('-')[0] === lang)
    if (same) return same
  }
  return null
}

/** Where to look a string up, in order: the language itself, then English, then Chinese. */
export function localeChain(locale: string): Locale[] {
  const first = isLocale(locale) ? locale : (matchLocale([locale]) ?? DEFAULT_LOCALE)
  return [...new Set<Locale>([first, 'en', SOURCE_LOCALE])]
}

/** `{name}` placeholders filled from params; unknown ones are left as they are. */
export function fillPlaceholders(s: string, params?: Record<string, string | number>): string {
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s
}

/** The `{name}` placeholders a string uses (dictionary checks). */
export function placeholdersOf(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]!))].sort()
}

/**
 * Translations of the text a plugin hands to the shell (manifest strings, creator and action names, their parameter
 * forms, job messages): language → source text → translation, e.g. `{ en: { '音频': 'Audio' }, ja: { '音频': 'オーディオ' } }`.
 * A source text may hold `{name}` placeholders; it then matches any text of that shape and the translation gets the
 * matched parts (`'生成中 {pct}%': 'Generating {pct}%'` turns「生成中 35%」into "Generating 35%").
 */
export type TextTable = Readonly<Record<string, Readonly<Record<string, string>>>>

interface TextPattern { re: RegExp; names: string[]; to: string }
const patternCache = new WeakMap<object, TextPattern[]>()

function patternsOf(entries: Readonly<Record<string, string>>): TextPattern[] {
  let list = patternCache.get(entries)
  if (!list) {
    list = []
    for (const [from, to] of Object.entries(entries)) {
      if (!/\{\w+\}/.test(from)) continue
      const names: string[] = []
      const src = from.split(/(\{\w+\})/).map(part => {
        const m = /^\{(\w+)\}$/.exec(part)
        if (m) { names.push(m[1]!); return '([\\s\\S]+?)' }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }).join('')
      list.push({ re: new RegExp(`^${src}$`), names, to })
    }
    patternCache.set(entries, list)
  }
  return list
}

/** The translation of `text` in one language's entries (exact, else the first matching placeholder pattern). */
export function findText(entries: Readonly<Record<string, string>> | undefined, text: string): string | undefined {
  if (!entries || typeof entries !== 'object') return undefined
  if (Object.hasOwn(entries, text) && typeof entries[text] === 'string') return entries[text]
  for (const p of patternsOf(entries)) {
    const m = p.re.exec(text)
    if (m) return fillPlaceholders(p.to, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]!])))
  }
  return undefined
}

/**
 * Plugin-provided text in a language: looked up in the language, then English, then Chinese, like every other
 * string — where the language the plugin wrote its text in (`sourceLocale`, Chinese unless the plugin says
 * otherwise) is the text itself. Text without a translation is shown as it is.
 */
export function localizeText(text: string, locale: string, table: TextTable | null | undefined, sourceLocale: string = SOURCE_LOCALE): string {
  if (!text || !table) return text
  for (const l of localeChain(locale)) {
    if (l === sourceLocale) return text
    const hit = findText(table[l], text)
    if (hit !== undefined) return hit
  }
  return text
}
