/**
 * PluginContext bound to one library (plugin-system.md「上下文」, ADR-028): read-only library, cache, settings,
 * logging, data and temp dirs, change notifications, external tools, registration.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { RESERVED_PLUGIN_PATHS, type MachineConfig, type PluginManifest } from '@bowerbird/schema'
import type {
  Action, AssetChange, AuthProvider, CacheWriter, Creator, Enricher, ExecOptions, ExecResult, FormatHandler, Logger, PluginContext, Route,
  SearchProvider, SettingsReader, Source, Template, Validator, VersionStore
} from '@bowerbird/plugin-sdk'
import type { CoreLogger, LibraryHandle } from '../contracts.js'
import { settingsProps } from './manifest.js'

export interface Registrations {
  formats: FormatHandler[]
  searchProviders: SearchProvider[]
  enrichers: Enricher[]
  sources: Source[]
  creators: Creator[]
  validators: Validator[]
  templates: Template[]
  actions: Action[]
  versionStores: VersionStore[]
  auth: AuthProvider[]
  routes: Route[]
}

export function emptyRegistrations(): Registrations {
  return { formats: [], searchProviders: [], enrichers: [], sources: [], creators: [], validators: [], templates: [], actions: [], versionStores: [], auth: [], routes: [] }
}

/** Whether an executable named `tool` is on PATH (or exists, when given as a path). */
export function findOnPath(tool: string): boolean {
  const isFile = (p: string): boolean => { try { return fs.statSync(p).isFile() } catch { return false } }
  if (tool.includes('/') || tool.includes('\\')) return isFile(tool)
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) if (isFile(path.join(dir, tool + ext))) return true
  }
  return false
}

export function missingToolMessage(tool: string): string { return `需要外部工具 ${tool}，这台电脑上没找到` }

/** Run an external tool without a shell: stdout bytes and stderr text; rejects with code ENOENT when missing. */
export function runTool(tool: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let child
    try { child = spawn(tool, args, { cwd: opts.cwd, signal: opts.signal, windowsHide: true }) }
    catch (e) { reject(e); return }
    const out: Buffer[] = []
    let err = ''
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.on('error', e => { if (timer) clearTimeout(timer); reject(e) })
    child.on('close', code => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout: new Uint8Array(Buffer.concat(out)), stderr: err }) })
    child.stdin.on('error', () => { /* tool exited before reading its input */ })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

/**
 * This plugin's cache writer. The frozen LibraryHandle.cache has no plugin parameter: the library service's handle
 * offers `cacheFor(pluginId)`, otherwise the plugin id travels as a `<pluginId>/<name>` name prefix.
 */
export function pluginCache(library: LibraryHandle, pluginId: string): CacheWriter {
  const direct = (library as LibraryHandle & { cacheFor?: (id: string) => CacheWriter }).cacheFor
  if (typeof direct === 'function') return direct.call(library, pluginId)
  return {
    put: (assetId, stage, name, data) => library.cache.put(assetId, stage, `${pluginId}/${name}`, data),
    get: (assetId, stage, name) => library.cache.get(assetId, stage, `${pluginId}/${name}`)
  }
}

export function pluginLogger(log: CoreLogger): Logger {
  return { debug: (m, d) => log.debug(m, d), info: (m, d) => log.info(m, d), warn: (m, d) => log.warn(m, d), error: (m, d) => log.error(m, d) }
}

/** Effective settings: library-scoped keys from library.json, machine-scoped from the machine config, else defaults. */
export function settingsReader(pluginId: string, manifest: PluginManifest | null, library: LibraryHandle | null, machine: () => MachineConfig): SettingsReader {
  const props = settingsProps(manifest)
  const libValues = (): Record<string, unknown> => (library?.libraryJson()?.settings?.plugins?.[pluginId] ?? {}) as Record<string, unknown>
  const machineValues = (): Record<string, unknown> => (machine().plugins?.[pluginId] ?? {}) as Record<string, unknown>
  const get = (key: string): unknown => {
    const scope = props[key]?.scope ?? 'machine'
    const v = scope === 'library' ? libValues()[key] : machineValues()[key]
    return v !== undefined ? v : props[key]?.default
  }
  return {
    get: <T = unknown>(key: string) => get(key) as T | undefined,
    all: () => {
      const keys = new Set([
        ...Object.keys(props),
        ...Object.keys(libValues()).filter(k => props[k]?.scope === 'library'),
        ...Object.keys(machineValues()).filter(k => (props[k]?.scope ?? 'machine') === 'machine')
      ])
      const out: Record<string, unknown> = {}
      for (const k of keys) { const v = get(k); if (v !== undefined) out[k] = v }
      return out
    }
  }
}

export interface ContextInput {
  pluginId: string
  pluginVersion: string
  manifest: PluginManifest
  library: LibraryHandle
  machineConfig: () => MachineConfig
  log: CoreLogger
  regs: Registrations
  subscribers: Set<(change: AssetChange) => void>
  onMissingTool: (tool: string) => void
}

export function createPluginContext(i: ContextInput): PluginContext {
  const dataDir = path.join(i.library.paths.dataDir, 'plugins', i.pluginId)
  const tmpDir = path.join(i.library.paths.tmpDir, i.pluginId)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  const log = pluginLogger(i.log)
  const reserved = new Set<string>(RESERVED_PLUGIN_PATHS)
  return {
    pluginId: i.pluginId,
    pluginVersion: i.pluginVersion,
    library: i.library.reader,
    cache: pluginCache(i.library, i.pluginId),
    settings: settingsReader(i.pluginId, i.manifest, i.library, i.machineConfig),
    log,
    dataDir,
    tmpDir,
    events: {
      on(event, handler) {
        if (event !== 'asset.changed') return () => {}
        i.subscribers.add(handler)
        return () => { i.subscribers.delete(handler) }
      }
    },
    async exec(tool, args, opts) {
      try { return await runTool(tool, args, opts) }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          i.onMissingTool(tool)
          throw Object.assign(new Error(missingToolMessage(tool)), { code: 'ENOENT', tool })
        }
        throw e
      }
    },
    register: {
      format: impl => { i.regs.formats.push(impl) },
      searchProvider: impl => { i.regs.searchProviders.push(impl) },
      enricher: impl => { i.regs.enrichers.push(impl) },
      source: impl => { i.regs.sources.push(impl) },
      creator: impl => { i.regs.creators.push(impl) },
      validator: impl => { i.regs.validators.push(impl) },
      template: impl => { i.regs.templates.push(impl) },
      action: impl => { i.regs.actions.push(impl) },
      versionStore: impl => { i.regs.versionStores.push(impl) },
      auth: impl => { i.regs.auth.push(impl) },
      route: impl => {
        const first = impl.path.replace(/^\/+/, '').split('/')[0] ?? ''
        if (reserved.has(first)) { log.warn('route path is reserved by the kernel; ignored', { path: impl.path }); return }
        i.regs.routes.push(impl)
      }
    }
  }
}
