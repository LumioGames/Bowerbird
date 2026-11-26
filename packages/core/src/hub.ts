/**
 * Hub (line core-A): machine data dir (`BOWERBIRD_HOME`, default `~/.bowerbird`), machine config, registered
 * libraries, and lazily opened LibraryService instances wired to the core-B factories (plugin host, query engine,
 * pipeline). library-format.md「本机数据目录」, ADR-026, ADR-033.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import {
  FORMAT_VERSION, LIBRARY_DIR, MachineConfig, serializeJson, type ConfigResponse, type LibraryJson, type LibraryRef
} from '@bowerbird/schema'
import {
  CoreError, type CoreLogger, type CreateHub, type CreatePipeline, type CreatePluginHost, type CreateQueryEngine, type EventBus,
  type Hub, type HubOptions, type LibraryPaths, type LibraryService, type PluginHost
} from './contracts.js'
import { createEventBus } from './events.js'
import { openIndexDb } from './index/db.js'
import { createQueryEngine } from './index/query.js'
import { createLogger } from './log.js'
import { createPipeline } from './pipeline/index.js'
import { createPluginHost } from './plugins/index.js'
import { LocalLibraryFs } from './library/fs.js'
import { openLibraryService, type LibraryServiceImpl } from './service/service.js'

export interface HubFactories {
  createPluginHost: CreatePluginHost
  createQueryEngine: CreateQueryEngine
  createPipeline: CreatePipeline
}

export interface HubExtras {
  /** Scanner stability window (ms); tests use 0. */
  stableMs?: number
  /** File watching mode and per-directory limit (tests, CLI). */
  watchMode?: import('./scanner/watch.js').WatchMode
  maxWatchDirs?: number
  opener?: (target: string, reveal: boolean) => void
  now?: () => number
}

/** `BOWERBIRD_HOME` or `~/.bowerbird`. */
export function defaultHome(): string {
  return process.env.BOWERBIRD_HOME ? path.resolve(process.env.BOWERBIRD_HOME) : path.join(os.homedir(), '.bowerbird')
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, serializeJson(value))
  fs.renameSync(tmp, file)
}

/** Whether a folder has anything a first open would register (ignoring dot entries and OS junk). */
function hasUserFiles(root: string): boolean {
  let names: string[] = []
  try { names = fs.readdirSync(root) } catch { return false }
  return names.some(n => !n.startsWith('.') && n !== 'Thumbs.db' && n !== 'desktop.ini')
}

/** Machine settings that only take effect when Bowerbird starts. */
const RESTART_KEYS = ['host', 'port', 'cacheDirs', 'concurrency'] as const

export class HubImpl implements Hub {
  readonly home: string
  readonly events: EventBus
  readonly plugins: PluginHost
  readonly log: CoreLogger
  private cfg: MachineConfig
  private readonly open = new Map<string, Promise<LibraryServiceImpl>>()
  private readonly configFile: string
  /** What this process started with (saved config + command-line flags): what a restart-only change is compared to. */
  private readonly started: Pick<MachineConfig, typeof RESTART_KEYS[number]>
  /** Start-up settings saved in this run with a value this run does not use. */
  private readonly pendingRestart = new Set<typeof RESTART_KEYS[number]>()

  constructor(private readonly opts: HubOptions, private readonly f: HubFactories, private readonly extras: HubExtras = {}) {
    this.home = path.resolve(opts.home)
    for (const d of ['', 'logs', 'plugins', 'libraries', 'tmp']) fs.mkdirSync(path.join(this.home, d), { recursive: true })
    this.configFile = path.join(this.home, 'config.json')
    const parsed = MachineConfig.safeParse(readJson(this.configFile) ?? {})
    this.cfg = parsed.success ? parsed.data : MachineConfig.parse({})
    const run = this.running()
    this.started = Object.fromEntries(RESTART_KEYS.map(k => [k, run[k]])) as HubImpl['started']
    this.log = opts.log ?? createLogger({ dir: path.join(this.home, 'logs') })
    this.events = createEventBus()
    this.plugins = f.createPluginHost({
      builtinDirs: opts.builtinPluginDirs,
      installDir: path.join(this.home, 'plugins'),
      machineConfig: () => this.running(),
      saveMachineConfig: async patch => { this.mutateConfig(disk => ({ ...disk, ...patch })) },
      log: this.log.child('plugins'),
      events: this.events
    })
  }

  /** mtime of config.json when last read: another process (`bb plugin add`) may change it while we run (K6). */
  private configMtime = -1

  private readConfigFromDisk(): MachineConfig {
    try { this.configMtime = fs.statSync(this.configFile).mtimeMs } catch { this.configMtime = -1 }
    const parsed = MachineConfig.safeParse(readJson(this.configFile) ?? {})
    return parsed.success ? parsed.data : this.cfg
  }

  /** Read-modify-write: always start from what is on disk now, never from an older snapshot. */
  private mutateConfig(fn: (disk: MachineConfig) => Record<string, unknown>): void {
    const disk = this.readConfigFromDisk()
    this.cfg = MachineConfig.parse(fn(disk))
    writeJsonAtomic(this.configFile, this.cfg)
    try { this.configMtime = fs.statSync(this.configFile).mtimeMs } catch { /* ignore */ }
  }

  /** The machine config as on disk now (the library registry is read from it). */
  private fresh(): MachineConfig { return this.config() }

  /**
   * The machine config as saved (what 设置 › 本机 shows and edits). Command-line flags (`--host`, `--port`) are not
   * in it: they only apply to this run (see running()).
   */
  config(): MachineConfig {
    let m = -1
    try { m = fs.statSync(this.configFile).mtimeMs } catch { /* not written yet */ }
    if (m !== this.configMtime) this.cfg = this.readConfigFromDisk()
    return this.cfg
  }

  /** What this process uses: the saved config with this run's command-line flags on top. */
  private running(): MachineConfig {
    const saved = this.config()
    return this.opts.overrides ? { ...saved, ...this.opts.overrides } as MachineConfig : saved
  }

  async patchConfig(patch: Partial<MachineConfig>): Promise<ConfigResponse> {
    const before = this.config()
    // only keys the caller really gave; the library list and installed plugins are managed elsewhere
    // (a zod `.partial()` parse fills defaults such as `libraries: []`, which must never wipe the registry)
    const given = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && k !== 'libraries' && k !== 'installed'))
    this.mutateConfig(disk => ({ ...disk, ...given }))
    const after = this.config()
    // a restart-only setting this patch changed, which now differs from what this process runs with
    // (started with `--host 127.0.0.1`, saving 0.0.0.0 needs a restart; saving 127.0.0.1 again does not)
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    const restartRequired = RESTART_KEYS.some(k => !same(before[k], after[k]) && !same(after[k], this.started[k]))
    for (const k of RESTART_KEYS) {
      if (same(before[k], after[k])) continue
      if (same(after[k], this.started[k])) this.pendingRestart.delete(k)
      else this.pendingRestart.add(k)
    }
    this.log.info('write', { op: 'config.patch', fields: Object.keys(given) })
    return { config: after, dataDir: this.home, restartRequired }
  }

  /**
   * Whether a start-up setting was changed in this run and differs from what the run uses (GET /config after a page
   * reload). Command-line flags (`--host`, `--port`) are not pending changes: they apply to this run only.
   */
  restartPending(): boolean { return this.pendingRestart.size > 0 }

  private refOf(entry: { id: string; root: string; name?: string }): LibraryRef {
    const root = entry.root
    let state: LibraryRef['state'] = 'uninitialized'
    let name = entry.name
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) state = 'unavailable'
    else {
      const lib = readJson(path.join(root, LIBRARY_DIR, 'library.json')) as { bb?: number; name?: string } | null
      if (lib) {
        state = typeof lib.bb === 'number' && lib.bb > FORMAT_VERSION ? 'read-only' : 'ready'
        name = lib.name ?? name
      }
    }
    return { id: entry.id, name: name ?? path.basename(root), root, state }
  }

  libraries(): LibraryRef[] { return this.fresh().libraries.map(e => this.refOf(e)) }

  defaultLibraryId(): string | null { return this.fresh().libraries[0]?.id ?? null }

  /** Declarations of every built-in plugin (`^<version>`) for a new library.json. */
  private builtinDeclarations(): Record<string, string> {
    const out: Record<string, string> = {}
    try { for (const p of this.plugins.list()) if (p.builtin && p.version) out[p.id] = `^${p.version}` } catch { /* none */ }
    return out
  }

  private async writeLibraryJson(root: string, id: string, name: string): Promise<void> {
    const lib: LibraryJson = {
      bb: FORMAT_VERSION, id, name, created: new Date().toISOString(), plugins: this.builtinDeclarations(),
      settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 }
    }
    // writes into a library folder go through the library module (engineering.md「代码约定」)
    await new LocalLibraryFs(root).writeLibraryJson(lib)
  }

  async addLibrary(root: string, name?: string): Promise<LibraryRef> {
    const abs = path.resolve(root)
    const existing = this.fresh().libraries.find(l => path.resolve(l.root) === abs)
    if (existing) return this.refOf(existing)
    fs.mkdirSync(abs, { recursive: true })
    const lib = readJson(path.join(abs, LIBRARY_DIR, 'library.json')) as { id?: string; name?: string } | null
    let id: string
    if (lib?.id) {
      id = lib.id
      if (this.fresh().libraries.some(l => l.id === id)) throw new CoreError('conflict', '同一个资产库已经登记过了（可能是复制出来的文件夹）', { id })
    } else {
      // the id is chosen now and written into library.json at initialization, so it never changes (ADR-033)
      id = uuidv7()
      if (!hasUserFiles(abs)) await this.writeLibraryJson(abs, id, name ?? path.basename(abs))
    }
    const entry = { id, root: abs, ...(name ? { name } : {}) }
    this.mutateConfig(disk => ({ ...disk, libraries: [...disk.libraries.filter(l => l.id !== id && path.resolve(l.root) !== abs), entry] }))
    this.log.info('write', { op: 'library.add', library: id, root: abs })
    return this.refOf(entry)
  }

  async initLibrary(root: string, name?: string): Promise<LibraryRef> {
    const abs = path.resolve(root)
    fs.mkdirSync(abs, { recursive: true })
    const libFile = path.join(abs, LIBRARY_DIR, 'library.json')
    const entry = this.fresh().libraries.find(l => path.resolve(l.root) === abs)
    if (!fs.existsSync(libFile)) await this.writeLibraryJson(abs, entry?.id ?? uuidv7(), name ?? path.basename(abs))
    const ref = await this.addLibrary(abs, name)
    const svc = this.open.get(ref.id)
    if (svc) await (await svc).initialize({ actor: 'user:unnamed', isLocal: true })
    return this.refOf(this.fresh().libraries.find(l => l.id === ref.id)!)
  }

  library(id: string): Promise<LibraryService> {
    const entry = this.fresh().libraries.find(l => l.id === id)
    if (!entry) return Promise.reject(new CoreError('not_found', `资产库不存在：${id}`, { id }))
    let p = this.open.get(id)
    if (!p) {
      p = this.openLibrary(entry)
      this.open.set(id, p)
      p.catch(() => this.open.delete(id))
    }
    return p
  }

  /** The concrete service (tests and the CLI use its scanner and extra helpers). */
  service(id: string): Promise<LibraryServiceImpl> { return this.library(id) as Promise<LibraryServiceImpl> }

  private async openLibrary(entry: { id: string; root: string; name?: string }): Promise<LibraryServiceImpl> {
    const cfg = this.running()
    const root = path.resolve(entry.root)
    const dataDir = path.join(this.home, 'libraries', entry.id)
    const paths: LibraryPaths = {
      root,
      metaDir: path.join(root, LIBRARY_DIR),
      cacheDir: cfg.cacheDirs[entry.id] ?? path.join(root, LIBRARY_DIR, 'cache'),
      dataDir,
      indexPath: path.join(dataDir, 'index.sqlite'),
      tmpDir: path.join(this.home, 'tmp')
    }
    fs.mkdirSync(dataDir, { recursive: true })
    const { db, rebuilt } = openIndexDb(paths.indexPath)
    return openLibraryService({
      id: entry.id, ...(entry.name ? { name: entry.name } : {}), paths, db, rebuilt, events: this.events,
      log: this.log.child(`library`), pluginHost: this.plugins,
      createQueryEngine: this.f.createQueryEngine, createPipeline: this.f.createPipeline,
      machineConfig: () => this.running(),
      ...(this.opts.address ? { address: this.opts.address } : {}),
      watch: this.opts.watch !== false,
      ...(this.extras.stableMs !== undefined ? { stableMs: this.extras.stableMs } : {}),
      ...(this.extras.opener ? { opener: this.extras.opener } : {}),
      ...(this.extras.watchMode ? { watchMode: this.extras.watchMode } : {}),
      ...(this.extras.maxWatchDirs ? { maxWatchDirs: this.extras.maxWatchDirs } : {}),
      ...(this.extras.now ? { now: this.extras.now } : {})
    })
  }

  async health(): Promise<{ status: 'ok' | 'degraded'; libraries: Array<{ id: string; state: string; index: 'ready' | 'building' }> }> {
    const libs: Array<{ id: string; state: string; index: 'ready' | 'building' }> = []
    for (const ref of this.libraries()) {
      let index: 'ready' | 'building' = 'ready'
      const p = this.open.get(ref.id)
      let scan: unknown = undefined
      if (p) { try { const s = await p; index = s.building ? 'building' : 'ready'; scan = { ...s.scanner.progress } } catch { /* failed to open */ } }
      // `scan` (not in the frozen type): the cheap way for /health to report progress, without the job overview
      libs.push({ id: ref.id, state: ref.state, index, ...(scan ? { scan } : {}) } as { id: string; state: string; index: 'ready' | 'building' })

    }
    const status = libs.some(l => l.state === 'unavailable') ? 'degraded' : 'ok'
    return { status, libraries: libs }
  }

  async close(): Promise<void> {
    for (const p of this.open.values()) {
      try { await (await p).close() } catch { /* ignore */ }
    }
    this.open.clear()
    try { await this.plugins.close() } catch { /* ignore */ }
  }
}

/** Hub with explicit factories (tests inject fakes for the core-B parts). */
export async function createHubWith(opts: HubOptions, f: HubFactories, extras: HubExtras = {}): Promise<HubImpl> {
  const hub = new HubImpl(opts, f, extras)
  await hub.plugins.discover()
  return hub
}

export const createHub: CreateHub = opts => createHubWith(opts, { createPluginHost, createQueryEngine, createPipeline })
