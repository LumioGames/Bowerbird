/**
 * Text that plugins hand to the shell, shown in the shell's language (ADR-061):
 *
 * - names and forms from the manifest and from `activate()` (plugin, format, creator and action names, settings and
 *   parameter forms, relation types, UI slot titles, job messages) go through the plugin's `l10n` translations
 *   (`PluginInfo.l10n`, looked up like every other string: the language, then English, then Chinese);
 * - text the server part wrote down (the grid badge, validator check messages) goes through the plugin's web module
 *   (`FormatView.formatBadge`, `WebPlugin.validators`), so the plugin owns both ends and the kernel stays format-blind.
 *
 * Anything without a translation is shown as the plugin wrote it.
 */
import { localizeText, type AssetSummary, type CheckView, type Locale, type PluginInfo } from '@bowerbird/schema'
import { getLocale, t } from '../lib/i18n'
import type { PluginRegistry } from './registry'

type Texts = Pick<PluginInfo, 'l10n' | 'sourceLocale'>
let byId: ReadonlyMap<string, Texts> = new Map()
let last: readonly PluginInfo[] | undefined

/** Keep the plugins' translations at hand (the shell frame calls this with the plugin list, like `setRuntime`). */
export function setPluginTexts(list: readonly PluginInfo[] | undefined): void {
  if (!list || list === last) return
  last = list
  byId = new Map(list.filter(p => p.l10n).map(p => [p.id, { l10n: p.l10n, sourceLocale: p.sourceLocale }]))
}

/** Text of one plugin (from its PluginInfo) in a language. */
export function textOf(info: Texts | undefined, text: string, locale: string = getLocale()): string {
  return info?.l10n ? localizeText(text, locale, info.l10n, info.sourceLocale) : text
}

/**
 * A plugin's text in the shell's language, through that plugin's own translations. Without a plugin id the text is
 * the kernel's (e.g. a built-in relation type) and is returned as it is; so is text of a plugin with no translations.
 */
export function pluginText(pluginId: string | null | undefined, text: string, locale?: string): string
export function pluginText(pluginId: string | null | undefined, text: string | null | undefined, locale?: string): string | undefined
export function pluginText(pluginId: string | null | undefined, text: string | null | undefined, locale: string = getLocale()): string | undefined {
  if (!text) return text ?? undefined
  return textOf(pluginId ? byId.get(pluginId) : undefined, text, locale)
}

type Schema = Record<string, unknown>
const SCHEMA_TEXT = ['title', 'description', 'x-placeholder'] as const
const SCHEMA_NAMES = ['enumNames', 'x-enumNames'] as const
const SCHEMA_NESTED = ['items', 'oneOf', 'anyOf', 'allOf'] as const

/**
 * A plugin's JSON Schema (settings, creator and action parameters) with its display strings in the shell's language:
 * `title`, `description`, `x-placeholder` and the option labels `enumNames` / `x-enumNames`, nested ones included.
 * Values, defaults and keys are left alone.
 */
export function pluginSchema<T>(pluginId: string | null | undefined, schema: T, locale: string = getLocale()): T {
  const visit = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(visit)
    if (!s || typeof s !== 'object') return s
    const o: Schema = { ...(s as Schema) }
    for (const k of SCHEMA_TEXT) if (typeof o[k] === 'string') o[k] = pluginText(pluginId, o[k] as string, locale)
    for (const k of SCHEMA_NAMES) if (Array.isArray(o[k])) o[k] = (o[k] as unknown[]).map(n => (typeof n === 'string' ? pluginText(pluginId, n, locale) : n))
    if (o.properties && typeof o.properties === 'object') o.properties = Object.fromEntries(Object.entries(o.properties as Schema).map(([k, v]) => [k, visit(v)]))
    for (const k of SCHEMA_NESTED) if (o[k] !== undefined) o[k] = visit(o[k])
    return o
  }
  return visit(schema) as T
}

/** The label of option `i` of an enum (`enumNames` / `x-enumNames` when given, else the value itself). */
export function enumLabel(schema: { enumNames?: unknown; 'x-enumNames'?: unknown }, value: unknown, i: number): string {
  const names = (Array.isArray(schema.enumNames) ? schema.enumNames : Array.isArray(schema['x-enumNames']) ? schema['x-enumNames'] : null) as unknown[] | null
  const n = names?.[i]
  return typeof n === 'string' && n ? n : String(value)
}

/** A format's name (vocabulary / plugin list) in the shell's language; the kernel's own「未知格式」uses the shell's word. */
export function formatName(f: { id: string; displayName: string; plugin?: string | null }, locale: string = getLocale()): string {
  if (f.id === 'unknown' && !f.plugin) return t('kind.unknown')
  return pluginText(f.plugin, f.displayName, locale)
}

/**
 * The grid badge in the shell's language: the format plugin's `formatBadge` turns the badge its server part wrote
 * (「2,480 面」) into this language; without it, or when it fails, the badge as written.
 */
export function badgeText(reg: Pick<PluginRegistry, 'formatView'>, asset: Pick<AssetSummary, 'format' | 'badge'>, locale: Locale = getLocale()): string | null {
  const b = asset.badge
  if (!b) return b ?? null
  const fv = reg.formatView(asset.format)
  if (!fv?.view.formatBadge) return b
  try { return fv.view.formatBadge(b, locale) || b } catch { return b }
}

/**
 * An automatic check's name and sentence in the shell's language, from the web module of the plugin that declares the
 * validator (`WebPlugin.validators[check.validator]`). Null label = the shell's own name for it; the message falls
 * back to what the validator wrote.
 */
export function checkText(reg: Pick<PluginRegistry, 'validatorView'>, check: CheckView, locale: Locale = getLocale()): { label: string | null; message: string } {
  const v = reg.validatorView?.(check.validator)?.view
  let label: string | null = null, message = check.message
  try { label = v?.label?.(check, locale) || null } catch { label = null }
  try { message = v?.message?.(check, locale) || check.message } catch { message = check.message }
  return { label, message }
}
