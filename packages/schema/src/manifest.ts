/**
 * Plugin manifest: the `bowerbird` field of a plugin's package.json (plugin-system.md「清单」).
 * The kernel decides what to load from the manifest only; it never scans code.
 */
import { z } from 'zod'

export const PLUGIN_API_VERSION = 1 as const
/** The kernel supports the current and the previous API major. */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1]

export const FormatContribution = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  /** Lower-case with dot: `.glb`. */
  extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/)),
  priority: z.number().default(0),
  /** Where thumbnails are produced. */
  thumbnail: z.enum(['server', 'browser', 'none']).default('server')
})
export type FormatContribution = z.infer<typeof FormatContribution>

export const RelationTypeContribution = z.object({
  id: z.string(),
  name: z.string(),
  inverseName: z.string(),
  tracksVersion: z.boolean().default(false)
})
export type RelationTypeContribution = z.infer<typeof RelationTypeContribution>

/** Static declarations of runtime-registered extension points; presence of a key = contributes it. */
const Declared = z.array(z.object({ id: z.string() }).loose()).optional()

export const PluginManifest = z.object({
  /** Globally unique plugin id, e.g. `bowerbird.model`. */
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  displayName: z.string(),
  description: z.string().optional(),
  apiVersion: z.number().int(),
  /** Server entry (ES module exporting a ServerPlugin as default). */
  server: z.string().optional(),
  /** Web entry (ES module exporting a WebPlugin as default). */
  web: z.string().optional(),
  contributes: z.object({
    formats: z.array(FormatContribution).optional(),
    searchProviders: Declared,
    enrichers: Declared,
    sources: Declared,
    creators: Declared,
    validators: Declared,
    templates: Declared,
    actions: Declared,
    ui: z.record(z.string(), z.unknown()).optional(),
    versionStore: z.object({ id: z.string(), displayName: z.string(), ignore: z.array(z.string()).optional() }).optional(),
    relationTypes: z.array(RelationTypeContribution).optional(),
    auth: Declared,
    /** JSON Schema; each property may carry `scope: 'library' | 'machine'` (default machine). */
    settings: z.record(z.string(), z.unknown()).optional()
  }).default({}),
  requires: z.object({ tools: z.array(z.string()).default([]) }).default({ tools: [] }),
  /** Rate limit for jobs calling external services (per minute). */
  rateLimit: z.number().optional(),
  /**
   * Translations of the text this plugin hands to the shell (ADR-061): language → source text → translation, for the
   * manifest's own strings (`displayName`, `description`, format names, settings titles, descriptions and
   * `enumNames`, relation type names) and for what `activate()` registers (creator and action names, their parameter
   * forms and input roles, UI slot titles, job messages). Source texts may hold `{name}` placeholders. Optional:
   * text without a translation is shown as written. See `localizeText` in `@bowerbird/schema/locale`.
   */
  l10n: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  /** The language the plugin's own text is written in (a `LOCALES` id); default `zh-CN`. */
  sourceLocale: z.string().optional()
})
export type PluginManifest = z.infer<typeof PluginManifest>

/** The package.json shape the kernel reads. */
export const PluginPackageJson = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  bowerbird: PluginManifest
}).loose()
export type PluginPackageJson = z.infer<typeof PluginPackageJson>

export const EXTENSION_POINT_KEYS = [
  'formats', 'searchProviders', 'enrichers', 'sources', 'creators', 'validators', 'templates',
  'actions', 'ui', 'versionStore', 'relationTypes', 'auth'
] as const
export type ExtensionPointKey = (typeof EXTENSION_POINT_KEYS)[number]

/** Kernel-reserved path segments under /plugins/{id}/ (plugin routes may not use them). */
export const RESERVED_PLUGIN_PATHS = ['web', 'settings', 'update', 'enable', 'disable'] as const
