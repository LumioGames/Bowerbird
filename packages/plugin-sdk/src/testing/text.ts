/**
 * Checks for a plugin's text in every shell language (ADR-061): its UI dictionaries (`defineMessages`) and the
 * translations its manifest gives for what it hands to the shell (`l10n`). The languages come from `LOCALE_IDS`, so
 * a language added later is checked without touching the tests.
 */
import { findText, LOCALE_IDS, placeholdersOf, SOURCE_LOCALE } from '@bowerbird/schema/locale'
import type { PluginManifest } from '@bowerbird/schema'
import type { Registrations } from './context.js'

type Dict = Readonly<Record<string, string | undefined>>
/** The shape `defineMessages` takes: Chinese with every key, other languages partial. */
export type MessagesLike = { readonly 'zh-CN': Dict } & { readonly [locale: string]: Dict | undefined }

const SCRIPTS = { han: /\p{Script=Han}/u, kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, hangul: /\p{Script=Hangul}/u }
/** Scripts a language's strings should not contain (a sign of a string left untranslated or pasted in the wrong place). */
const FOREIGN: Readonly<Record<string, readonly RegExp[]>> = {
  en: [SCRIPTS.han, SCRIPTS.kana, SCRIPTS.hangul],
  ja: [SCRIPTS.hangul],
  ko: [SCRIPTS.han, SCRIPTS.kana]
}

function foreignIn(locale: string, s: string): boolean { return (FOREIGN[locale] ?? []).some(re => re.test(s)) }
function samePlaceholders(a: string, b: string): boolean { return placeholdersOf(a).join(',') === placeholdersOf(b).join(',') }

/**
 * Problems in a plugin's UI dictionaries: every language in `locales` has every key of the Chinese dictionary,
 * none empty, with the same `{placeholders}`, written in its own script; no language has keys Chinese does not.
 * Returns one line per problem (an empty list is a pass).
 */
export function messageProblems(messages: MessagesLike, locales: readonly string[] = LOCALE_IDS): string[] {
  const zh = messages['zh-CN']
  const keys = Object.keys(zh)
  const out: string[] = []
  for (const l of locales) {
    const d = messages[l]
    if (!d) { out.push(`${l}: no dictionary`); continue }
    for (const k of keys) {
      const s = d[k]
      if (typeof s !== 'string' || !s.trim()) { out.push(`${l}.${k}: missing`); continue }
      if (!samePlaceholders(s, zh[k] ?? '')) out.push(`${l}.${k}: placeholders ${placeholdersOf(s).join(',') || '-'} ≠ ${placeholdersOf(zh[k] ?? '').join(',') || '-'}`)
      if (foreignIn(l, s)) out.push(`${l}.${k}: not in this language: ${s}`)
    }
    for (const k of Object.keys(d)) if (!(k in zh)) out.push(`${l}.${k}: not in the Chinese dictionary`)
  }
  return out
}

type Schema = Record<string, unknown>

/** Display strings of a JSON Schema: `title`, `description`, `enumNames` / `x-enumNames`, `x-placeholder`, nested. */
export function schemaStrings(schema: unknown): string[] {
  const out: string[] = []
  const visit = (s: unknown) => {
    if (!s || typeof s !== 'object') return
    if (Array.isArray(s)) { s.forEach(visit); return }
    const o = s as Schema
    for (const k of ['title', 'description', 'x-placeholder'] as const) if (typeof o[k] === 'string' && o[k]) out.push(o[k] as string)
    for (const k of ['enumNames', 'x-enumNames'] as const) if (Array.isArray(o[k])) for (const n of o[k] as unknown[]) if (typeof n === 'string' && n) out.push(n)
    if (o.properties && typeof o.properties === 'object') Object.values(o.properties as Schema).forEach(visit)
    for (const k of ['items', 'oneOf', 'anyOf', 'allOf'] as const) visit(o[k])
  }
  visit(schema)
  return out
}

/** The strings a manifest hands to the shell: names, description, format names, settings form, relation types. */
export function manifestStrings(m: PluginManifest): string[] {
  const c = m.contributes ?? {}
  return unique([
    m.displayName,
    ...(m.description ? [m.description] : []),
    ...(c.formats ?? []).map(f => f.displayName),
    ...(c.relationTypes ?? []).flatMap(r => [r.name, r.inverseName]),
    ...(c.versionStore ? [c.versionStore.displayName] : []),
    ...schemaStrings(c.settings)
  ])
}

/** The strings `activate()` registered that the shell shows: creator and action names, their forms and input roles, templates. */
export function registeredStrings(r: Pick<Registrations, 'creators' | 'actions' | 'templates'>): string[] {
  return unique([
    ...r.creators.flatMap(c => [c.displayName, ...schemaStrings(c.params), ...(c.inputs ?? []).map(i => i.role)]),
    ...r.actions.flatMap(a => [a.title, ...schemaStrings(a.params)]),
    ...r.templates.flatMap(t => [t.displayName, ...schemaStrings(t.fields)])
  ])
}

function unique(list: string[]): string[] { return [...new Set(list.filter(s => typeof s === 'string' && s.trim()))] }

/**
 * Problems in a manifest's translations: each of `strings` (default: `manifestStrings`; add `registeredStrings` and
 * whatever else the plugin hands the shell, e.g. UI slot titles and job messages) has an entry — exact or a
 * `{placeholder}` pattern — in every language of `locales` except the one the plugin writes in, and every entry keeps
 * the placeholders of its source text and is written in its language's script.
 */
export function manifestTextProblems(m: PluginManifest, strings: readonly string[] = manifestStrings(m), locales: readonly string[] = LOCALE_IDS): string[] {
  const table = m.l10n ?? {}
  const source = m.sourceLocale ?? SOURCE_LOCALE
  const out: string[] = []
  for (const l of locales) {
    if (l === source) continue
    for (const s of unique([...strings])) if (findText(table[l], s) === undefined) out.push(`${l}: no translation for「${s}」`)
  }
  for (const [l, entries] of Object.entries(table)) {
    for (const [from, to] of Object.entries(entries)) {
      if (!samePlaceholders(from, to)) out.push(`${l}:「${from}」→「${to}」changes the placeholders`)
      if (foreignIn(l, to)) out.push(`${l}:「${from}」→「${to}」is not in this language`)
    }
  }
  return out
}
