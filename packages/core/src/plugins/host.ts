/**
 * PluginHost (plugin-system.md「生命周期」「安装与更新」, ADR-012): discovers plugins in the built-in directories,
 * `~/.bowerbird/plugins/` and the machine config's path installs; validates manifests and apiVersion; reports status
 * per library; activates per library; installs, updates and removes; machine-scoped settings.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MachineConfig, PluginInfo } from '@bowerbird/schema'
import { CoreError, type LibraryHandle, type LibraryPlugins, type PluginHost, type PluginHostOptions } from '../contracts.js'
import { contributedKeys, expandHome, isPathSpec, looksLikePlugin, packageNameOf, readManifest, settingsProps } from './manifest.js'
import { LibraryPluginsImpl, type HostInternals, type KnownPlugin } from './library-plugins.js'
import { findOnPath } from './context.js'

/** Consecutive failures from which the plugin settings show a warning (never auto-disabled). */
export const FAILURE_THRESHOLD = 3

export type NpmRunner = (args: string[], cwd: string) => Promise<void>

export interface PluginHostExtraOptions {
  /** Runs npm (tests inject a fake). */
  npm?: NpmRunner
  /** Home dir for `~` in path installs. */
  home?: string
  failureThreshold?: number
}

/** The host plus enable/disable, which the frozen PluginHost interface leaves to library.json edits. */
export interface PluginHostImpl extends PluginHost {
  /** Declare (enable) or undeclare (disable) a third-party plugin in a library's library.json, then reload it. */
  setEnabled(id: string, enabled: boolean, library?: string | LibraryHandle): Promise<PluginInfo>
  /** The LibraryPlugins bound to an open library, if any. */
  bound(libraryId: string): LibraryPlugins | null
}

const defaultNpm: NpmRunner = (args, cwd) => new Promise((resolve, reject) => {
  const win = process.platform === 'win32'
  const child = spawn(win ? 'npm.cmd' : 'npm', args, { cwd, shell: win, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  child.stderr.on('data', (d: Buffer) => { err += d.toString() })
  child.on('error', e => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('需要外部工具 npm，这台电脑上没找到') : e))
  child.on('close', code => (code === 0 ? resolve() : reject(new Error(`npm ${args[0]} 失败（${code}）：${err.trim().split('\n').slice(-3).join(' ')}`))))
})

/** Changes when the package or its server entry changes on disk (path installs under development included). */
function stampOf(dir: string, version: string | null, server?: string): string {
  let m = 0
  for (const f of ['package.json', ...(server ? [server] : [])]) { try { m = Math.max(m, fs.statSync(path.resolve(dir, f)).mtimeMs) } catch { /* missing */ } }
  return `${version ?? '0'}-${Math.round(m)}`
}

function childDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() || e.isSymbolicLink())
      .map(e => path.join(dir, e.name))
      .sort()
  } catch { return [] }
}

function errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e) }

/**
 * The kind of work a plugin call does, from its `invoke` label. Consecutive failures are counted per kind, so a
 * success of one kind (the plugin's page polling its routes, the queue probing files) never clears a failure streak of
 * another (creations failing): `create:` and `action:` runs, `route …` calls from the plugin's pages, `auth.` checks,
 * and everything else (processing, search, version store, activation).
 */
export function failureKind(label: string): 'create' | 'action' | 'route' | 'auth' | 'other' {
  if (label.startsWith('create:')) return 'create'
  if (label.startsWith('action:')) return 'action'
  if (label.startsWith('route ')) return 'route'
  if (label.startsWith('auth.')) return 'auth'
  return 'other'
}

export function createPluginHostImpl(opts: PluginHostOptions & PluginHostExtraOptions): PluginHostImpl {
  const log = opts.log.child('plugins')
  const npm = opts.npm ?? defaultNpm
  const home = opts.home ?? os.homedir()
  const threshold = opts.failureThreshold ?? FAILURE_THRESHOLD
  let known: KnownPlugin[] = []
  /** Consecutive failures per plugin and kind of work (failureKind). */
  const failures = new Map<string, Map<string, { count: number; reason: string }>>()
  const bound = new Map<string, LibraryPluginsImpl>()

  const internals: HostInternals = {
    known: () => known,
    log: opts.log,
    machineConfig: () => opts.machineConfig(),
    recordSuccess(id, label) {
      const kinds = failures.get(id)
      if (!kinds) return
      kinds.delete(failureKind(label))
      if (kinds.size === 0) failures.delete(id)
    },
    recordFailure(id, label, reason) {
      let kinds = failures.get(id)
      if (!kinds) failures.set(id, (kinds = new Map()))
      const kind = failureKind(label)
      const f = kinds.get(kind) ?? { count: 0, reason }
      f.count++
      f.reason = reason
      kinds.set(kind, f)
      if (f.count === threshold) emitPlugin(id, 'failing')
    },
    markMissingTool(id, tool) {
      const k = known.find(x => x.id === id)
      if (k && !k.missingTools.has(tool)) { k.missingTools.add(tool); emitPlugin(id, 'missing-tool') }
    }
  }

  function emitPlugin(id: string, status: string): void {
    const libs = bound.size ? [...bound.keys()] : ['']
    for (const lib of libs) opts.events.emit(lib, 'plugin.updated', { id, status })
  }

  function config(): MachineConfig { return opts.machineConfig() }

  function load(dir: string, source: KnownPlugin['source'], spec?: string): KnownPlugin {
    const m = readManifest(dir)
    const k: KnownPlugin = {
      id: m.id, dir, source, packageName: m.packageName, version: m.version, displayName: m.displayName,
      ...(m.description ? { description: m.description } : {}), manifest: m.manifest, error: m.error,
      missingTools: new Set(), stamp: stampOf(dir, m.version, m.manifest?.server), ...(spec ? { spec } : {})
    }
    if (k.manifest && !k.error) {
      for (const t of k.manifest.requires.tools) if (!findOnPath(t)) k.missingTools.add(t)
    }
    return k
  }

  async function discover(): Promise<void> {
    const out: KnownPlugin[] = []
    const seen = new Set<string>()
    const push = (k: KnownPlugin): void => {
      if (seen.has(k.id)) { log.warn('duplicate plugin id; keeping the first one', { id: k.id, dir: k.dir }); return }
      seen.add(k.id)
      // Keep the missing tools found at runtime across re-discovery.
      const prev = known.find(p => p.id === k.id && p.dir === k.dir)
      if (prev) for (const t of prev.missingTools) k.missingTools.add(t)
      out.push(k)
    }
    for (const dir of opts.builtinDirs) for (const child of childDirs(dir)) if (looksLikePlugin(child)) push(load(child, 'builtin'))
    const nodeModules = path.join(opts.installDir, 'node_modules')
    for (const entry of config().installed ?? []) {
      const dir = entry.source === 'path' ? path.resolve(expandHome(entry.spec, home)) : path.join(nodeModules, packageNameOf(entry.spec))
      const k = load(dir, entry.source, entry.spec)
      if (k.error && !fs.existsSync(path.join(dir, 'package.json'))) { k.id = entry.id; k.displayName = entry.id; k.packageName = entry.source === 'npm' ? packageNameOf(entry.spec) : entry.id }
      const lib = entry.source === 'path' ? insideLibrary(dir) : null
      if (lib) k.error = inLibraryMessage(lib)
      push(k)
    }
    // Packages installed into ~/.bowerbird/plugins by hand (npm or copied folders).
    for (const child of childDirs(nodeModules)) {
      const dirs = path.basename(child).startsWith('@') ? childDirs(child) : [child]
      for (const d of dirs) if (looksLikePlugin(d) && !out.some(k => k.dir === d)) push(load(d, 'npm'))
    }
    for (const child of childDirs(opts.installDir)) {
      if (path.basename(child) === 'node_modules') continue
      if (looksLikePlugin(child) && !out.some(k => k.dir === child)) push(load(child, 'path'))
    }
    known = out
    recheckLibraryPaths()
  }

  /** Library roots on this machine: registered ones and those opened through forLibrary. */
  function libraryRoots(): string[] {
    const roots = (config().libraries ?? []).map(l => path.resolve(expandHome(l.root, home)))
    for (const lp of bound.values()) roots.push(path.resolve(lp.handle.paths.root))
    return [...new Set(roots)]
  }

  /** ADR-012: a library never carries plugin code — a plugin folder inside any library is refused. */
  function insideLibrary(dir: string): string | null {
    const abs = path.resolve(dir)
    let real = abs
    try { real = fs.realpathSync(abs) } catch { /* keep as given */ }
    for (const root of libraryRoots()) {
      let r = root
      try { r = fs.realpathSync(root) } catch { /* keep */ }
      for (const [d, lr] of [[abs, root], [real, r]] as const) {
        const rel = path.relative(lr, d)
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return root
      }
    }
    return null
  }

  function inLibraryMessage(root: string): string { return `插件不能放在资产库里（${root}）：打开资产库不会运行库里的代码，请把插件放到资产库以外的文件夹` }

  /**
   * ADR-012 again whenever libraries may have changed (discovery, listing, opening a library): a plugin installed from
   * a folder that now lies inside a registered library is failed and stopped.
   */
  function recheckLibraryPaths(): string[] {
    const hit: string[] = []
    for (const k of known) {
      if (k.source === 'builtin' || (k.error && k.error.startsWith('插件不能放在资产库里'))) continue
      const lib = insideLibrary(k.dir)
      if (lib) { k.error = inLibraryMessage(lib); hit.push(k.id) }
    }
    if (hit.length) {
      log.warn('plugin folders inside a library are not loaded', { plugins: hit })
      void refreshBound(hit).catch(e => log.warn('could not stop plugins inside a library', { error: errorMessage(e) }))
    }
    return hit
  }

  function find(id: string): KnownPlugin {
    const k = known.find(x => x.id === id)
    if (!k) throw new CoreError('not_found', `没有找到插件 ${id}`)
    return k
  }

  function info(k: KnownPlugin, library?: LibraryHandle): PluginInfo {
    const lib = library ? library.libraryJson() : null
    const required = lib?.plugins?.[k.id]
    const lp = library ? bound.get(library.id) : undefined
    let status: PluginInfo['status']
    let reason: string | undefined
    // Without a library (GET /plugins): a plugin that failed to start in any open library is failed, with why.
    const activationError = lp ? lp.activationErrors.get(k.id) : [...bound.values()].map(b => b.activationErrors.get(k.id)).find(Boolean)
    if (k.error) { status = 'failed'; reason = k.error }
    else if (activationError) { status = 'failed'; reason = activationError }
    else if (k.source === 'builtin' || required !== undefined) status = 'enabled'
    else status = 'disabled'
    // The warning shows the worst kind of work that is failing in a row.
    const f = [...(failures.get(k.id)?.values() ?? [])].filter(x => x.count >= threshold).sort((a, b) => b.count - a.count)[0]
    const m = k.manifest
    return {
      id: k.id,
      packageName: k.packageName,
      version: k.version,
      displayName: k.displayName,
      ...(k.description ? { description: k.description } : {}),
      builtin: k.source === 'builtin',
      status,
      ...(reason ? { reason } : {}),
      ...(required !== undefined ? { required } : {}),
      contributes: m ? contributedKeys(m) : [],
      formats: (m?.contributes.formats ?? []).map(x => ({ id: x.id, displayName: x.displayName, extensions: x.extensions })),
      hasWeb: !!m?.web,
      settings: (m?.contributes.settings as Record<string, unknown> | undefined) ?? null,
      missingTools: [...k.missingTools],
      consecutiveFailures: f ? { count: f.count, reason: f.reason } : null,
      update: null,
      source: k.source,
      installPath: k.dir,
      ...(m?.l10n ? { l10n: m.l10n } : {}),
      ...(m?.sourceLocale ? { sourceLocale: m.sourceLocale } : {})
    }
  }

  function resolveLibrary(library?: string | LibraryHandle): LibraryPluginsImpl {
    if (library && typeof library === 'object') {
      const lp = bound.get(library.id)
      if (lp) return lp
      throw new CoreError('not_found', `资产库 ${library.id} 没有打开`)
    }
    if (typeof library === 'string') {
      const lp = bound.get(library)
      if (!lp) throw new CoreError('not_found', `资产库 ${library} 没有打开`)
      return lp
    }
    if (bound.size === 1) return [...bound.values()][0]!
    throw new CoreError('validation_failed', bound.size ? '请指明要启用插件的资产库' : '没有打开的资产库')
  }

  async function refreshBound(ids: string[]): Promise<void> {
    for (const lp of bound.values()) {
      await lp.reconcile(new Set(ids))
      await lp.recordPluginFormats()
    }
  }

  async function readValidated(dir: string): Promise<KnownPlugin> {
    const k = load(dir, 'path')
    if (k.error) throw new CoreError('validation_failed', k.error, { id: k.id })
    const clash = known.find(x => x.id === k.id && x.source === 'builtin')
    if (clash) throw new CoreError('conflict', `插件 ${k.id} 与内置插件同名`, { id: k.id })
    return k
  }

  const host: PluginHostImpl = {
    discover,

    list(library?: LibraryHandle): PluginInfo[] {
      recheckLibraryPaths()
      const out = known.map(k => info(k, library))
      const lib = library?.libraryJson()
      for (const [id, range] of Object.entries(lib?.plugins ?? {})) {
        if (known.some(k => k.id === id)) continue
        out.push({
          id, packageName: id, version: null, displayName: id, builtin: false, status: 'missing', reason: '本机没有安装', required: range,
          contributes: [], formats: [], hasWeb: false, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'npm'
        })
      }
      return out
    },

    async forLibrary(library: LibraryHandle): Promise<LibraryPlugins> {
      const prev = bound.get(library.id)
      if (prev && prev.handle === library) return prev
      if (prev) await prev.deactivateAll()
      const lp = new LibraryPluginsImpl(internals, library)
      bound.set(library.id, lp)
      recheckLibraryPaths()
      await lp.reconcile()
      try { await lp.recordPluginFormats() } catch (e) { log.warn('could not record plugin formats in library.json', { library: library.id, error: errorMessage(e) }) }
      return lp
    },

    async install(spec: string): Promise<PluginInfo> {
      const s = spec.trim()
      if (!s) throw new CoreError('validation_failed', '请填写 npm 包名或文件夹路径')
      let entry: MachineConfig['installed'][number]
      if (isPathSpec(s)) {
        const dir = path.resolve(expandHome(s, home))
        const lib = insideLibrary(dir)
        if (lib) throw new CoreError('validation_failed', inLibraryMessage(lib), { library: lib })
        if (!fs.existsSync(path.join(dir, 'package.json'))) throw new CoreError('validation_failed', `这个文件夹里没有插件：${dir}`)
        const k = await readValidated(dir)
        entry = { id: k.id, spec: dir, source: 'path' }
      } else {
        fs.mkdirSync(opts.installDir, { recursive: true })
        await npm(['install', '--prefix', opts.installDir, '--no-audit', '--no-fund', s], opts.installDir)
        const name = packageNameOf(s)
        const dir = path.join(opts.installDir, 'node_modules', name)
        let k: KnownPlugin
        try { k = await readValidated(dir) }
        catch (e) {
          await npm(['uninstall', '--prefix', opts.installDir, name], opts.installDir).catch(() => {})
          throw e
        }
        entry = { id: k.id, spec: name, source: 'npm' }
      }
      const installed = (config().installed ?? []).filter(e => e.id !== entry.id).concat(entry)
      await opts.saveMachineConfig({ installed })
      await discover()
      await refreshBound([entry.id])
      log.info('write', { op: 'plugin.install', id: entry.id, source: entry.source })
      const k = find(entry.id)
      emitPlugin(k.id, 'installed')
      return info(k)
    },

    async update(id: string): Promise<PluginInfo> {
      const k = find(id)
      if (k.source === 'builtin') throw new CoreError('unsupported', '内置插件随 Bowerbird 一起更新')
      if (k.source === 'npm') await npm(['install', '--prefix', opts.installDir, '--no-audit', '--no-fund', `${k.packageName}@latest`], opts.installDir)
      await discover()
      await refreshBound([id])
      log.info('write', { op: 'plugin.update', id })
      const n = find(id)
      emitPlugin(id, 'updated')
      return info(n)
    },

    async remove(id: string): Promise<void> {
      const k = find(id)
      if (k.source === 'builtin') throw new CoreError('unsupported', '内置插件不能卸载')
      for (const lp of bound.values()) await lp.deactivate(id)
      if (k.source === 'npm') await npm(['uninstall', '--prefix', opts.installDir, k.packageName], opts.installDir)
      const installed = (config().installed ?? []).filter(e => e.id !== id)
      await opts.saveMachineConfig({ installed })
      known = known.filter(x => x.id !== id)
      failures.delete(id)
      await refreshBound([])
      log.info('write', { op: 'plugin.remove', id })
      emitPlugin(id, 'removed')
    },

    async setEnabled(id: string, enabled: boolean, library?: string | LibraryHandle): Promise<PluginInfo> {
      const lp = resolveLibrary(library)
      const k = known.find(x => x.id === id)
      if (!k) {
        if (enabled) throw new CoreError('not_found', `没有找到插件 ${id}`)
      } else if (k.source === 'builtin') {
        if (!enabled) throw new CoreError('unsupported', '内置插件始终启用，不能停用')
        return info(k, lp.handle)
      }
      await lp.handle.updateLibraryJson(lib => {
        lib.plugins ??= {}
        if (enabled) lib.plugins[id] = `^${k!.version ?? '0.0.0'}`
        else delete lib.plugins[id]
      })
      await lp.reconcile()
      if (enabled) await lp.recordPluginFormats(id, true)
      log.info('write', { op: enabled ? 'plugin.enable' : 'plugin.disable', id, library: lp.handle.id })
      const result = k ? info(k, lp.handle) : null
      emitPlugin(id, result?.status ?? 'disabled')
      return result ?? host.list(lp.handle).find(p => p.id === id) ?? {
        id, packageName: id, version: null, displayName: id, builtin: false, status: 'disabled', contributes: [], formats: [], hasWeb: false,
        settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'npm'
      }
    },

    bound(libraryId: string): LibraryPlugins | null { return bound.get(libraryId) ?? null },

    webEntry(id: string): string | null {
      const k = known.find(x => x.id === id)
      if (!k || k.error || !k.manifest?.web) return null
      const file = path.resolve(k.dir, k.manifest.web)
      return fs.existsSync(file) ? file : null
    },

    machineSettings(id: string): Record<string, unknown> {
      const k = find(id)
      const props = settingsProps(k.manifest)
      const stored = (config().plugins?.[id] ?? {}) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, p] of Object.entries(props)) {
        if (p.scope !== 'machine') continue
        const v = stored[key] !== undefined ? stored[key] : p.default
        if (v !== undefined) out[key] = v
      }
      return out
    },

    async setMachineSettings(id: string, values: Record<string, unknown>): Promise<void> {
      const k = find(id)
      const props = settingsProps(k.manifest)
      for (const key of Object.keys(values)) {
        const p = props[key]
        if (!p) throw new CoreError('validation_failed', `插件 ${k.displayName} 没有设置项「${key}」`, { key })
        if (p.scope !== 'machine') throw new CoreError('validation_failed', `「${key}」随资产库保存，要在资产库的插件设置里修改`, { key })
      }
      const cfg = config()
      const next: Record<string, unknown> = { ...((cfg.plugins?.[id] ?? {}) as Record<string, unknown>) }
      for (const [key, v] of Object.entries(values)) { if (v === null || v === undefined) delete next[key]; else next[key] = v }
      await opts.saveMachineConfig({ plugins: { ...(cfg.plugins ?? {}), [id]: next } })
      log.info('write', { op: 'plugin.settings', id, keys: Object.keys(values) })
    },

    settingsSchema(id: string): Record<string, unknown> | null {
      const k = find(id)
      return (k.manifest?.contributes.settings as Record<string, unknown> | undefined) ?? null
    },

    async close(): Promise<void> {
      for (const lp of bound.values()) await lp.deactivateAll()
      bound.clear()
    }
  }
  return host
}
