/**
 * Reading and validating plugin manifests (plugin-system.md「清单」「版本兼容」). The kernel decides what to load
 * from the `bowerbird` field of package.json only; it never scans code.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PLUGIN_API_VERSION, PluginPackageJson, SUPPORTED_API_VERSIONS, type PluginManifest } from '@bowerbird/schema'

/** Version of this kernel (packages/core/package.json), read at runtime from src/ and dist/ alike. */
export const KERNEL_VERSION: string = (() => {
  try { return (createRequire(import.meta.url)('../../package.json') as { version?: string }).version ?? '0.0.0' }
  catch { return '0.0.0' }
})()

function majorMinor(v: string): string { return v.split('.').slice(0, 2).join('.') }

/** Why a manifest's apiVersion cannot be loaded, as shown in the plugin settings (copy.md「加载失败原因」); null = fine. */
export function apiVersionProblem(apiVersion: number): string | null {
  if (SUPPORTED_API_VERSIONS.includes(apiVersion)) return null
  if (apiVersion > PLUGIN_API_VERSION) return `这个插件需要更新版本的 Bowerbird（${apiVersion}.x），现在是 ${majorMinor(KERNEL_VERSION)}`
  return `这个插件是给旧版本 Bowerbird（${apiVersion}.x）写的，现在是 ${majorMinor(KERNEL_VERSION)}，需要插件更新`
}

export interface ManifestRead {
  /** Plugin id (falls back to the package name, then the folder name, when the manifest is broken). */
  id: string
  packageName: string
  version: string | null
  displayName: string
  description?: string
  manifest: PluginManifest | null
  /** Set when the plugin cannot be loaded. */
  error: string | null
}

/** Whether a folder holds a plugin package (package.json with a `bowerbird` field). */
export function looksLikePlugin(dir: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
    return !!raw && typeof raw === 'object' && 'bowerbird' in raw
  } catch { return false }
}

export function readManifest(dir: string): ManifestRead {
  const fallback = path.basename(dir)
  let raw: Record<string, unknown>
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<string, unknown> }
  catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
    return { id: fallback, packageName: fallback, version: null, displayName: fallback, manifest: null, error: missing ? `找不到插件：${dir}` : '插件的 package.json 不是合法的 JSON' }
  }
  const bb = (raw.bowerbird ?? {}) as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name : fallback
  const id = typeof bb.id === 'string' && bb.id ? bb.id : name
  const version = typeof raw.version === 'string' ? raw.version : null
  const displayName = typeof bb.displayName === 'string' ? bb.displayName : id
  const description = typeof bb.description === 'string' ? bb.description : typeof raw.description === 'string' ? raw.description : undefined
  const parsed = PluginPackageJson.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('；')
    return { id, packageName: name, version, displayName, ...(description ? { description } : {}), manifest: null, error: `清单不合法：${issues}` }
  }
  const manifest = parsed.data.bowerbird
  const apiProblem = apiVersionProblem(manifest.apiVersion)
  return { id: manifest.id, packageName: parsed.data.name, version: parsed.data.version, displayName: manifest.displayName, ...(description ? { description } : {}), manifest, error: apiProblem }
}

/** npm package name of an install spec: `@scope/name@^1` → `@scope/name`, `name@1.2.3` → `name`. */
export function packageNameOf(spec: string): string {
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1)
    return at > 0 ? spec.slice(0, at) : spec
  }
  const at = spec.indexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}

/** Whether an install spec names a folder on this machine rather than an npm package. */
export function isPathSpec(spec: string): boolean {
  if (/^(\/|\.{1,2}[\\/]|~[\\/]?|[A-Za-z]:[\\/])/.test(spec) || spec === '.' || spec === '~') return true
  if (spec.startsWith('@')) return false
  return spec.includes('/') || spec.includes('\\')
}

export function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') || p.startsWith('~\\') ? path.join(home, p.slice(2)) : p
}

/** Keys of `contributes` that name extension points this plugin provides. */
export function contributedKeys(m: PluginManifest): string[] {
  const c = m.contributes as Record<string, unknown>
  const keys = ['formats', 'searchProviders', 'enrichers', 'sources', 'creators', 'validators', 'templates', 'actions', 'ui', 'versionStore', 'relationTypes', 'auth']
  return keys.filter(k => {
    const v = c[k]
    if (v == null) return false
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'object') return Object.keys(v as object).length > 0
    return true
  })
}

/** Settings schema properties with their scope (default machine). */
export function settingsProps(m: PluginManifest | null): Record<string, { scope: 'library' | 'machine'; default?: unknown }> {
  const props = (m?.contributes.settings as { properties?: Record<string, Record<string, unknown>> } | undefined)?.properties ?? {}
  const out: Record<string, { scope: 'library' | 'machine'; default?: unknown }> = {}
  for (const [k, v] of Object.entries(props)) {
    out[k] = { scope: v?.scope === 'library' ? 'library' : 'machine', ...(v && 'default' in v ? { default: v.default } : {}) }
  }
  return out
}
