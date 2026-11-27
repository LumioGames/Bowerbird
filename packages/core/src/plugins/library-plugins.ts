/**
 * The plugins enabled for one library (plugin-system.md「生命周期」): built-ins always, third-party ones when the
 * library's library.json declares them (ADR-012). Activation builds a PluginContext bound to the library; every
 * call into plugin code goes through `invoke` (exceptions caught, timed, failures counted).
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CreatorInfo, MachineConfig, PluginManifest, RelationTypeContribution } from '@bowerbird/schema'
import type { AssetChange, FileRef, ServerPlugin } from '@bowerbird/plugin-sdk'
import type { CoreLogger, CreatorEntry, IdentifyResult, LibraryHandle, LibraryPlugins, LoadedFormat } from '../contracts.js'
import { createPluginContext, emptyRegistrations, findOnPath, type Registrations } from './context.js'

export interface KnownPlugin {
  id: string
  dir: string
  source: 'builtin' | 'npm' | 'path'
  packageName: string
  version: string | null
  displayName: string
  description?: string
  manifest: PluginManifest | null
  /** Manifest / apiVersion / missing-folder problem: the plugin cannot be loaded at all. */
  error: string | null
  missingTools: Set<string>
  /** Changes when the package changes on disk (version or file times): forces a fresh import. */
  stamp: string
  spec?: string
}

/**
 * What the pipeline reads from the LibraryPlugins of this host beyond the frozen interface (duck-typed there, so
 * fakes need not implement it).
 */
export interface LibraryPluginsExtras {
  /** The machine config (local compute concurrency). */
  machineConfig(): MachineConfig
  /** The manifest's `rateLimit` (calls per minute) of a plugin calling an external service, if any. */
  rateLimit(pluginId: string): number | null
  /** Called after the set of active plugins changed (enable, disable, install, update, remove). */
  onChange(listener: (change: { started: string[]; stopped: string[] }) => void): () => void
}

/** What a LibraryPlugins needs from the host. */
export interface HostInternals {
  known(): KnownPlugin[]
  log: CoreLogger
  machineConfig(): MachineConfig
  /** A call succeeded: clears the failure streak of its kind of work (see failureKind in host.ts). */
  recordSuccess(pluginId: string, label: string): void
  recordFailure(pluginId: string, label: string, reason: string): void
  markMissingTool(pluginId: string, tool: string): void
}

interface Active { k: KnownPlugin; readonly regs: Registrations; readonly plugin: ServerPlugin | null; readonly stamp: string }

/** Dynamic import of a plugin's server entry (a built ES module); the query string busts the module cache on update. */
const nativeImport = (specifier: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ specifier) as Promise<Record<string, unknown>>

export const BUILTIN_RELATION_TYPES: Array<RelationTypeContribution & { plugin: string | null }> = [
  { id: 'source', name: '来源', inverseName: '产出', tracksVersion: true, plugin: null },
  { id: 'reference', name: '参考', inverseName: '被参考', tracksVersion: false, plugin: null },
  { id: 'uses', name: '引用', inverseName: '被引用', tracksVersion: false, plugin: null },
  { id: 'belongs', name: '归属', inverseName: '成员', tracksVersion: false, plugin: null }
]

/** Creator ids are qualified by plugin so two plugins may use the same local id. */
export function creatorKey(pluginId: string, creatorId: string): string { return `${pluginId}:${creatorId}` }

function errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e) }

export class LibraryPluginsImpl implements LibraryPlugins, LibraryPluginsExtras {
  readonly active = new Map<string, Active>()
  /** Activation failures in this library (plugin id → reason). */
  readonly activationErrors = new Map<string, string>()
  private readonly subscribers = new Set<(change: AssetChange) => void>()
  private readonly changeListeners = new Set<(change: { started: string[]; stopped: string[] }) => void>()
  private formatsCache: LoadedFormat[] | null = null
  private readonly log: CoreLogger

  constructor(private readonly host: HostInternals, readonly handle: LibraryHandle) {
    this.log = host.log.child(`plugins.${handle.id}`)
  }

  /* ───────────── lifecycle ───────────── */

  declared(id: string): boolean {
    const plugins = this.handle.libraryJson()?.plugins ?? {}
    return Object.prototype.hasOwnProperty.call(plugins, id)
  }

  shouldBeActive(k: KnownPlugin): boolean {
    return !k.error && !!k.manifest && (k.source === 'builtin' || this.declared(k.id))
  }

  /** Bring the active set in line with discovery + library.json; `force` re-activates those ids. */
  async reconcile(force: ReadonlySet<string> = new Set()): Promise<string[]> {
    const want = new Map(this.host.known().filter(k => this.shouldBeActive(k)).map(k => [k.id, k]))
    const stopped: string[] = []
    for (const [id, a] of [...this.active]) {
      const k = want.get(id)
      if (!k || force.has(id) || k.stamp !== a.stamp || k.dir !== a.k.dir) { await this.deactivate(id); stopped.push(id) }
      else a.k = k // re-discovered, unchanged on disk: keep it running with the fresh record
    }
    for (const id of [...this.activationErrors.keys()]) if (!want.has(id)) this.activationErrors.delete(id)
    const started: string[] = []
    for (const k of want.values()) {
      if (this.active.has(k.id)) continue
      await this.activate(k)
      if (this.active.has(k.id)) started.push(k.id)
    }
    this.formatsCache = null
    if (started.length || stopped.length) {
      for (const l of [...this.changeListeners]) {
        try { l({ started, stopped }) } catch (e) { this.log.warn('plugin change listener failed', { error: errorMessage(e) }) }
      }
    }
    return started
  }

  /* ───────────── extras for the pipeline ───────────── */

  machineConfig(): MachineConfig { return this.host.machineConfig() }

  rateLimit(pluginId: string): number | null {
    const r = this.active.get(pluginId)?.k.manifest?.rateLimit
    return typeof r === 'number' && r > 0 ? r : null
  }

  onChange(listener: (change: { started: string[]; stopped: string[] }) => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  private async activate(k: KnownPlugin): Promise<void> {
    this.activationErrors.delete(k.id)
    const manifest = k.manifest!
    for (const tool of manifest.requires.tools) if (!findOnPath(tool)) this.host.markMissingTool(k.id, tool)
    const regs = emptyRegistrations()
    let plugin: ServerPlugin | null = null
    if (manifest.server) {
      const file = path.resolve(k.dir, manifest.server)
      if (!fs.existsSync(file)) {
        this.activationErrors.set(k.id, `找不到服务端入口 ${manifest.server}，插件可能还没有构建`)
        return
      }
      try {
        const mod = await nativeImport(`${pathToFileURL(file).href}?v=${encodeURIComponent(k.stamp)}`)
        const candidate = (mod.default ?? mod) as Partial<ServerPlugin>
        if (!candidate || typeof candidate.activate !== 'function') throw new Error('服务端入口没有导出 activate')
        plugin = candidate as ServerPlugin
        const ctx = createPluginContext({
          pluginId: k.id, pluginVersion: k.version ?? '0.0.0', manifest, library: this.handle, machineConfig: () => this.host.machineConfig(),
          log: this.host.log.child(`plugin.${k.id}`), regs, subscribers: this.subscribers, onMissingTool: t => this.host.markMissingTool(k.id, t)
        })
        const p = plugin
        await this.invoke(k.id, 'activate', async () => { await p.activate(ctx) })
      } catch (e) {
        this.activationErrors.set(k.id, `启动失败：${errorMessage(e)}`)
        this.log.error('plugin activation failed', { plugin: k.id, error: errorMessage(e) })
        return
      }
    }
    const declaredFormats = new Set((manifest.contributes.formats ?? []).map(f => f.id))
    for (const h of regs.formats) {
      if (!declaredFormats.has(h.id)) this.log.warn('format registered without a manifest entry; ignored', { plugin: k.id, format: h.id })
    }
    this.active.set(k.id, { k, regs, plugin, stamp: k.stamp })
    this.formatsCache = null
  }

  async deactivate(id: string): Promise<void> {
    const a = this.active.get(id)
    if (!a) return
    this.active.delete(id)
    this.formatsCache = null
    const plugin = a.plugin
    if (plugin?.deactivate) {
      try { await this.invoke(id, 'deactivate', async () => { await plugin.deactivate!() }) }
      catch { /* logged by invoke */ }
    }
  }

  async deactivateAll(): Promise<void> {
    for (const id of [...this.active.keys()]) await this.deactivate(id)
  }

  /** Active plugins in discovery order. */
  private ordered(): Active[] {
    const out: Active[] = []
    for (const k of this.host.known()) { const a = this.active.get(k.id); if (a) out.push(a) }
    return out
  }

  /**
   * ADR-044: remember which declared third-party plugin reads which extension. Plugins in `overwrite` were just
   * enabled and take over their extensions; the others only fill extensions nobody is recorded for.
   */
  async recordPluginFormats(only?: string, overwrite: boolean | ReadonlySet<string> = false): Promise<void> {
    const current = this.handle.libraryJson()?.pluginFormats ?? {}
    const add: Record<string, string> = {}
    for (const a of this.ordered()) {
      if (a.k.source === 'builtin' || (only && a.k.id !== only)) continue
      for (const f of a.k.manifest?.contributes.formats ?? []) {
        for (const ext of f.extensions) {
          if (current[ext] === a.k.id) continue
          const takeOver = overwrite === true || (overwrite instanceof Set && overwrite.has(a.k.id))
          if (current[ext] && !takeOver) continue
          add[ext] = a.k.id
        }
      }
    }
    if (Object.keys(add).length === 0) return
    await this.handle.updateLibraryJson(lib => { lib.pluginFormats = { ...(lib.pluginFormats ?? {}), ...add } })
  }

  /* ───────────── LibraryPlugins ───────────── */

  enabled(): Array<{ id: string; version: string; displayName: string }> {
    return this.ordered().map(a => ({ id: a.k.id, version: a.k.version ?? '0.0.0', displayName: a.k.displayName }))
  }

  async identify(file: FileRef): Promise<IdentifyResult | null> {
    const ext = (file.ext ?? '').toLowerCase()
    const all = this.formats()
    // Bundles (and other names without an extension) go to every handler: the head/folder decides (K8).
    const candidates = all.filter(f => f.handler && (file.bundle || ext === '' || f.contribution.extensions.includes(ext)))
    const matches: Array<{ f: LoadedFormat; confidence: number; order: number }> = []
    for (const [order, c] of candidates.entries()) {
      let m: Awaited<ReturnType<NonNullable<LoadedFormat['handler']>['match']>> = null
      try { m = await this.invoke(c.pluginId, `match:${c.contribution.id}`, () => c.handler!.match(file)) }
      catch { continue }
      if (!m) continue
      const f = all.find(x => x.pluginId === c.pluginId && x.contribution.id === m!.format) ?? c
      matches.push({ f, confidence: typeof m.confidence === 'number' ? m.confidence : 1, order })
    }
    matches.sort((a, b) => (b.f.contribution.priority - a.f.contribution.priority) || (b.confidence - a.confidence) || (a.order - b.order))
    const best = matches[0]
    return best ? { pluginId: best.f.pluginId, pluginVersion: best.f.pluginVersion, format: best.f.contribution.id, thumbnail: best.f.contribution.thumbnail } : null
  }

  format(formatId: string): LoadedFormat | null {
    return this.formats().find(f => f.contribution.id === formatId) ?? null
  }

  formats(): LoadedFormat[] {
    if (this.formatsCache) return this.formatsCache
    const out: LoadedFormat[] = []
    for (const a of this.ordered()) {
      for (const contribution of a.k.manifest?.contributes.formats ?? []) {
        out.push({ pluginId: a.k.id, pluginVersion: a.k.version ?? '0.0.0', contribution, handler: a.regs.formats.find(h => h.id === contribution.id) ?? null })
      }
    }
    return (this.formatsCache = out)
  }

  missingPluginFor(ext: string): { id: string; range: string; displayName?: string } | null {
    const e = ext.toLowerCase()
    const lib = this.handle.libraryJson()
    const id = lib?.pluginFormats?.[e]
    if (!id) return null
    if (this.formats().some(f => f.handler && f.contribution.extensions.includes(e))) return null
    const range = lib?.plugins?.[id]
    if (range === undefined) return null
    if (this.host.known().some(k => k.id === id)) return null
    return { id, range }
  }

  searchProviders() { return this.ordered().flatMap(a => a.regs.searchProviders.map(provider => ({ pluginId: a.k.id, provider }))) }
  enrichers() { return this.ordered().flatMap(a => a.regs.enrichers.map(enricher => ({ pluginId: a.k.id, enricher }))) }
  validators() { return this.ordered().flatMap(a => a.regs.validators.map(validator => ({ pluginId: a.k.id, validator }))) }
  templates() { return this.ordered().flatMap(a => a.regs.templates.map(template => ({ pluginId: a.k.id, template }))) }
  actions() { return this.ordered().flatMap(a => a.regs.actions.map(action => ({ pluginId: a.k.id, action }))) }
  auth() { return this.ordered().flatMap(a => a.regs.auth.map(provider => ({ pluginId: a.k.id, provider }))) }
  routes() { return this.ordered().flatMap(a => a.regs.routes.map(route => ({ pluginId: a.k.id, route }))) }

  creators(): CreatorEntry[] {
    return this.ordered().flatMap(a => a.regs.creators.map(creator => ({ pluginId: a.k.id, pluginName: a.k.displayName, pluginVersion: a.k.version ?? '0.0.0', creator })))
  }

  creatorInfo(): CreatorInfo[] {
    return this.creators().map(e => ({
      id: creatorKey(e.pluginId, e.creator.id),
      pluginId: e.pluginId,
      pluginName: e.pluginName,
      displayName: e.creator.displayName,
      params: e.creator.params ?? {},
      inputs: (e.creator.inputs ?? []).map(i => ({ role: i.role, required: i.required, ...(i.formats ? { formats: i.formats } : {}), ...(i.views ? { views: true } : {}) })),
      ...(e.creator.page ? { page: e.creator.page } : {})
    }))
  }

  relationTypes(): Array<RelationTypeContribution & { plugin: string | null }> {
    const out = [...BUILTIN_RELATION_TYPES]
    for (const a of this.ordered()) {
      for (const r of a.k.manifest?.contributes.relationTypes ?? []) if (!out.some(x => x.id === r.id)) out.push({ ...r, plugin: a.k.id })
    }
    return out
  }

  /** The first active version store; others that are also active are reported as `conflicts` (only one may be). */
  versionStore() {
    const all = this.ordered().filter(a => a.regs.versionStores.length > 0 || !!a.k.manifest?.contributes.versionStore)
    const a = all.find(x => x.regs.versionStores.length > 0)
    if (!a) return null
    const declared = a.k.manifest?.contributes.versionStore
    const conflicts = all.filter(x => x !== a).map(x => x.k.id)
    return {
      pluginId: a.k.id,
      displayName: declared?.displayName ?? a.k.displayName,
      store: a.regs.versionStores[0]!,
      ...(declared?.ignore?.length ? { ignore: [...declared.ignore] } : {}),
      ...(conflicts.length ? { conflicts } : {})
    }
  }

  async invoke<T>(pluginId: string, label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now()
    try {
      const result = await fn()
      this.host.recordSuccess(pluginId, label)
      this.log.debug('plugin call', { plugin: pluginId, label, ms: Math.round(performance.now() - t0) })
      return result
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      // A tool the plugin spawned itself (not through ctx.exec) is missing: report it like ctx.exec does.
      const x = err as Error & { code?: unknown; syscall?: unknown; path?: unknown; tool?: unknown }
      if (x.code === 'ENOENT') {
        const tool = typeof x.tool === 'string' ? x.tool : typeof x.syscall === 'string' && x.syscall.startsWith('spawn') && typeof x.path === 'string' ? x.path : null
        if (tool) this.host.markMissingTool(pluginId, tool)
      }
      this.host.recordFailure(pluginId, label, err.message)
      this.log.warn('plugin call failed', { plugin: pluginId, label, ms: Math.round(performance.now() - t0), error: err.message })
      throw err
    }
  }

  emitChange(change: AssetChange): void {
    for (const h of [...this.subscribers]) {
      try { h(change) } catch (e) { this.log.warn('change subscriber failed', { error: errorMessage(e) }) }
    }
  }

  /** Re-read enablement after library.json changed (e.g. LibraryService.setPluginEnabled). */
  async reload(): Promise<void> {
    const started = await this.reconcile()
    await this.recordPluginFormats(undefined, new Set(started))
  }
}
