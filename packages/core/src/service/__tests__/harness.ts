/**
 * Test harness for line core-A: a real library folder in a temp dir, a real Hub and LibraryService, and minimal fakes
 * for the core-B parts (plugin host, query engine, pipeline).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Bmeta, Guid, PipelineStage, PluginInfo, Query, VersionEntry } from '@bowerbird/schema'
import type { VersionStore } from '@bowerbird/plugin-sdk'
import type {
  CallContext, CoreLogger, LibraryPlugins, LoadedFormat, Pipeline, PluginHost, QueryEngine, QueryEngineOptions
} from '../../contracts.js'
import { createHubWith, type HubImpl } from '../../hub.js'
import { createQueryEngine } from '../../index/query.js'
import { createPipeline } from '../../pipeline/index.js'
import { IndexStore, rowToSummary, type AssetRow } from '../../index/store.js'
import type { LibraryServiceImpl } from '../service.js'

export const ctx: CallContext = { actor: 'user:tester', isLocal: true }
export const agent: CallContext = { actor: 'agent:bot', isLocal: true }
export const remote: CallContext = { actor: 'user:remote', isLocal: false }

export interface LogLine { level: string; msg: string; data?: Record<string, unknown> }
export function captureLogger(lines: LogLine[]): CoreLogger {
  const l: CoreLogger = {
    debug: (msg, data) => lines.push({ level: 'debug', msg, data }),
    info: (msg, data) => lines.push({ level: 'info', msg, data }),
    warn: (msg, data) => lines.push({ level: 'warn', msg, data }),
    error: (msg, data) => lines.push({ level: 'error', msg, data }),
    child: () => l
  }
  return l
}

const IMAGE: LoadedFormat = {
  pluginId: 'test.image', pluginVersion: '1.0.0', handler: null,
  contribution: { id: 'image', displayName: '图片', extensions: ['.png', '.jpg'], priority: 0, thumbnail: 'server' }
}
const MODEL: LoadedFormat = {
  pluginId: 'test.model', pluginVersion: '2.0.0', handler: null,
  contribution: { id: 'model', displayName: '3D 模型', extensions: ['.gltf', '.glb'], priority: 0, thumbnail: 'browser' }
}

export interface FakePluginOptions {
  versionStore?: VersionStore | null
  missing?: Record<string, { id: string; range: string; displayName?: string }>
  relationTypes?: Array<{ id: string; name: string; inverseName: string; tracksVersion: boolean; plugin: string | null }>
  /** Extra plugin ids this fake machine has enabled (e.g. the real built-in ids of a fixture library). */
  extraEnabled?: Array<{ id: string; version: string }>
  actions?: Array<{ pluginId: string; action: import("@bowerbird/plugin-sdk").Action }>
  versionIgnore?: string[]
  versionConflicts?: string[]
}

export function fakePlugins(o: FakePluginOptions = {}): LibraryPlugins {
  const formats = [IMAGE, MODEL]
  return {
    enabled: () => [{ id: 'test.image', version: '1.0.0', displayName: '图片' }, { id: 'test.model', version: '2.0.0', displayName: '3D 模型' },
      ...(o.extraEnabled ?? []).map(p => ({ ...p, displayName: p.id })),
      ...[...new Set((o.actions ?? []).map(a => a.pluginId))].map(id => ({ id, version: "1.0.0", displayName: id }))],
    identify: async f => {
      const lf = formats.find(x => x.contribution.extensions.includes(f.ext))
      return lf ? { pluginId: lf.pluginId, pluginVersion: lf.pluginVersion, format: lf.contribution.id, thumbnail: lf.contribution.thumbnail } : null
    },
    format: id => formats.find(f => f.contribution.id === id) ?? null,
    formats: () => formats,
    missingPluginFor: ext => o.missing?.[ext] ?? null,
    searchProviders: () => [], enrichers: () => [], validators: () => [], templates: () => [], actions: () => o.actions ?? [],
    creators: () => [], creatorInfo: () => [],
    relationTypes: () => o.relationTypes ?? [],
    versionStore: () => (o.versionStore ? { pluginId: 'test.version', displayName: '测试版本', store: o.versionStore, ...(o.versionIgnore ? { ignore: o.versionIgnore } : {}), ...(o.versionConflicts ? { conflicts: o.versionConflicts } : {}) } : null),
    auth: () => [], routes: () => [],
    invoke: async (_p, _l, fn) => fn(),
    emitChange: () => {},
    reload: async () => {}
  }
}

export function fakePluginHost(plugins: LibraryPlugins): PluginHost {
  const info = (id: string, version: string): PluginInfo => ({
    id, packageName: id, version, displayName: id, builtin: true, status: 'enabled', contributes: ['formats'], formats: [],
    hasWeb: false, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'builtin'
  })
  return {
    discover: async () => {},
    list: () => [info('test.image', '1.0.0'), info('test.model', '2.0.0'), {
      ...info('community.spine', '1.4.2'), builtin: false, status: 'disabled', source: 'npm',
      formats: [{ id: 'spine', displayName: 'Spine', extensions: ['.skel'] }]
    }],
    forLibrary: async () => plugins,
    install: async () => { throw new Error('no') }, update: async () => { throw new Error('no') }, remove: async () => {},
    webEntry: () => null, machineSettings: () => ({}), setMachineSettings: async () => {},
    settingsSchema: id => (id === 'test.model' ? { type: 'object', properties: { environment: { type: 'string', scope: 'library' }, apiKey: { type: 'string', scope: 'machine' }, maxPixelRatio: { type: 'number' } } } : null),
    close: async () => {}
  }
}

/** Minimal query engine straight on the index tables. */
export function fakeQuery(o: QueryEngineOptions): QueryEngine & { removed: string[] } {
  const store = new IndexStore(o.db)
  const removed: string[] = []
  const ids = (q: Query): string[] => {
    const f = q.filter ?? {}
    let rows = store.allRows()
    if (f.ids) rows = rows.filter(r => f.ids!.includes(r.id))
    if (f.folder) rows = rows.filter(r => r.path === f.folder || r.path.startsWith(f.folder!.replace(/\/$/, '') + '/'))
    if (f.review) rows = rows.filter(r => f.review!.includes(r.review as never))
    return rows.map(r => r.id)
  }
  return {
    removed,
    search: async req => { const list = ids(req); return { items: list.map(id => rowToSummary(store, store.row(id)!, o.thumbnailUrl)), total: list.length, cursor: null } },
    ids: async q => ids(q),
    counts: () => ({
      all: store.count(),
      untagged: (o.db.prepare('SELECT COUNT(*) n FROM assets WHERE id NOT IN (SELECT asset_id FROM tags)').get() as { n: number }).n,
      pending: (o.db.prepare("SELECT COUNT(*) n FROM assets WHERE review = 'pending'").get() as { n: number }).n,
      issues: (o.db.prepare('SELECT COUNT(*) n FROM assets WHERE issue_level >= 2').get() as { n: number }).n,
      trash: (o.db.prepare('SELECT COUNT(*) n FROM trash').get() as { n: number }).n
    }),
    countFor: async q => ids(q).length,
    summaries: list => list.map(id => store.row(id)).filter((r): r is AssetRow => !!r).map(r => rowToSummary(store, r, o.thumbnailUrl)),
    indexDocs: async () => {},
    removeDocs: async list => { removed.push(...list) },
    clearProviders: async () => {}
  }
}

export interface FakePipeline extends Pipeline {
  calls: Array<{ id: Guid; stages: PipelineStage[] | 'all'; reason?: string }>
  /** yieldToScan calls, in order (full scans start / end). */
  yields: boolean[]
  actionRuns: Array<{ actionId: string; ids: Guid[]; params?: unknown; actor: string }>
  /** What summaryImage answers (tests set it). */
  summaryImages: Map<Guid, { variant: 'turnaround' | 'thumb'; path: string }>
  startAction(actionId: string, req: { ids: Guid[]; params?: unknown }, ctx: { actor: string }): Promise<import('@bowerbird/schema').JobInfo>
  summaryImage(id: Guid): { variant: 'turnaround' | 'thumb'; path: string } | null
}

export function fakePipeline(): FakePipeline {
  const calls: FakePipeline['calls'] = []
  const yields: boolean[] = []
  const actionRuns: FakePipeline['actionRuns'] = []
  const summaryImages: FakePipeline['summaryImages'] = new Map()
  const scan = { running: false, phase: 'idle' as const, done: 0, total: 0 }
  return {
    calls,
    yields,
    yieldToScan(on) { yields.push(on) },
    start() {}, stop: async () => {},
    enqueue(id, stages, opts) { calls.push({ id, stages, reason: opts?.reason }) },
    forget() {}, markVisible() {},
    overview: () => ({ stages: [], waitingRender: 0, busy: 0, scan, failed: [], creates: [], processing: [] }),
    job: () => null, cancel() {}, retry() {},
    startCreate: async () => { throw new Error('no creators') },
    actionRuns,
    summaryImages,
    startAction: async (actionId, req, c) => {
      actionRuns.push({ actionId, ids: req.ids, ...(req.params !== undefined ? { params: req.params } : {}), actor: c.actor })
      const at = new Date().toISOString()
      return { id: `job-${actionRuns.length}`, kind: 'action', actionId, status: 'running', attempts: 0, outputs: [], createdAt: at, updatedAt: at, by: c.actor }
    },
    summaryImage: id => summaryImages.get(id) ?? null,
    renderNext: async () => null, renderSubmit: async () => {},
    thumbnailFile: () => null,
    cacheStats: async () => ({ bytes: 0, files: 0, dir: '', inLibrary: true }),
    cleanCache: async () => ({ removedBytes: 0, removedFiles: 0 }),
    idle: async () => {}
  }
}

/** In-memory version store keyed by path + hash (content snapshot at commit time). */
export function fakeVersionStore(root: string): VersionStore & { commits: string[][] } {
  const snaps = new Map<string, Array<{ id: string; hash: string; data: Buffer; at: string }>>()
  const commits: string[][] = []
  let n = 0
  return {
    commits,
    id: 'fake',
    init: async () => {},
    status: async () => ({ ready: true, dirty: false }),
    commit: async (changes, meta) => {
      commits.push(changes.paths)
      for (const p of changes.paths) {
        if (p.endsWith('.bmeta')) continue
        const abs = path.join(root, p)
        if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue
        const data = fs.readFileSync(abs)
        const { createHash } = await import('node:crypto')
        const hash = 'sha256:' + createHash('sha256').update(data).digest('hex')
        const list = snaps.get(p) ?? []
        list.push({ id: `p${++n}`, hash, data, at: meta.at })
        snaps.set(p, list)
      }
      return { id: `p${n}`, at: meta.at, actor: meta.actor, message: meta.message }
    },
    history: async p => (snaps.get(p) ?? []).map(s => ({ id: s.id, at: s.at, actor: 'x', message: '', hash: s.hash })).reverse(),
    read: async (p, point) => {
      const s = (snaps.get(p) ?? []).find(x => x.id === point)!
      return new Blob([s.data]).stream() as unknown as ReadableStream
    },
    has: async (p, hash) => (snaps.get(p) ?? []).some(s => s.hash === hash)
  }
}

export interface TestLib {
  root: string
  home: string
  hub: HubImpl
  svc: LibraryServiceImpl
  id: string
  pipeline: FakePipeline
  /** core-B's pipeline when `realEngines` is set. */
  real: import("../../contracts.js").Pipeline | null
  plugins: LibraryPlugins
  logs: LogLine[]
  abs(rel: string): string
  write(rel: string, data: string | Buffer, mtimeOffsetSec?: number): void
  read(rel: string): string
  rm(rel: string): void
  mv(from: string, to: string): void
  cp(from: string, to: string): void
  exists(rel: string): boolean
  sidecar(rel: string): Bmeta
  setSidecar(rel: string, meta: unknown): void
  scan(p?: string): Promise<void>
  row(id: string): AssetRow | undefined
  rowByPath(p: string): AssetRow | undefined
  idOf(p: string): string
  issues(type?: string): Array<{ id: string; type: string; asset_id: string | null; rel_to: string | null; details_json: string }>
  reopen(opts?: { dropIndex?: boolean; now?: () => number }): Promise<void>
  close(): Promise<void>
}

const tmpRoots: string[] = []
export function tmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `bb-${prefix}-`))
  tmpRoots.push(d)
  return d
}
export function cleanupTmp(): void {
  for (const d of tmpRoots.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
}

export interface MakeLibOptions {
  /** Files written before the library is added. */
  files?: Record<string, string | Buffer>
  /** Copy an existing library folder in first (fixtures). */
  copyFrom?: string
  /** The fixture's own clock: trash ages are rebased from it to now. */
  fixtureNow?: number
  /** Write library.json up front (default true when no files given: added as an empty library). */
  plugins?: FakePluginOptions
  now?: () => number
  watch?: boolean
  stableMs?: number
  /** Use core-B's real query engine and pipeline (scale tests). */
  realEngines?: boolean
}

export async function makeLib(o: MakeLibOptions = {}): Promise<TestLib> {
  const base = tmpDir('lib')
  const root = path.join(base, 'Library')
  const home = path.join(base, 'home')
  fs.mkdirSync(root, { recursive: true })
  if (o.copyFrom) {
    const cache = path.join(o.copyFrom, '.bowerbird', 'cache')
    fs.cpSync(o.copyFrom, root, { recursive: true, filter: p => p !== cache && !p.startsWith(cache + path.sep) })
    // keep trash entries as old relative to today as they were relative to the fixture's clock
    const trash = path.join(root, '.bowerbird/trash')
    if (o.fixtureNow && fs.existsSync(trash)) for (const id of fs.readdirSync(trash)) {
      const f = path.join(trash, id, 'info.json')
      if (!fs.existsSync(f)) continue
      const info = JSON.parse(fs.readFileSync(f, 'utf8'))
      info.deletedAt = new Date(Date.now() - (o.fixtureNow - Date.parse(info.deletedAt))).toISOString()
      fs.writeFileSync(f, JSON.stringify(info, null, 2) + '\n')
    }
  }
  for (const [rel, data] of Object.entries(o.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), data)
  }
  const logs: LogLine[] = []
  let plugins = fakePlugins(o.plugins)
  let pipeline = fakePipeline()
  let realPipeline: import("../../contracts.js").Pipeline | null = null
  let hub!: HubImpl
  let svc!: LibraryServiceImpl
  let id = ''
  let now = o.now
  const open = async () => {
    plugins = fakePlugins(o.plugins)
    pipeline = fakePipeline()
    hub = await createHubWith(
      { home, builtinPluginDirs: [], watch: o.watch ?? false, log: captureLogger(logs) },
      { createPluginHost: () => fakePluginHost(plugins), createQueryEngine: o.realEngines ? createQueryEngine : fakeQuery, createPipeline: o.realEngines ? (po => { realPipeline = createPipeline(po); return realPipeline }) : () => pipeline },
      { stableMs: o.stableMs ?? 0, opener: () => {}, ...(now ? { now } : {}) }
    )
    const ref = id ? { id } : await hub.addLibrary(root)
    id = ref.id
    svc = await hub.service(id)
    await svc.scanner.idle()
  }
  await open()
  let mtimeBump = 0
  const t: TestLib = {
    root, home, logs,
    get hub() { return hub }, get svc() { return svc }, get id() { return id }, get pipeline() { return pipeline }, get real() { return realPipeline }, get plugins() { return plugins },
    abs: rel => path.join(root, rel),
    write(rel, data, off) {
      const abs = path.join(root, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, data)
      // make every write visible to the size+mtime shortcut
      const ts = Date.now() / 1000 + (off ?? ++mtimeBump)
      fs.utimesSync(abs, ts, ts)
    },
    read: rel => fs.readFileSync(path.join(root, rel), 'utf8'),
    rm: rel => fs.rmSync(path.join(root, rel), { recursive: true, force: true }),
    mv(from, to) { fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true }); fs.renameSync(path.join(root, from), path.join(root, to)) },
    cp(from, to) { fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true }); fs.cpSync(path.join(root, from), path.join(root, to), { recursive: true }) },
    exists: rel => fs.existsSync(path.join(root, rel)),
    sidecar: rel => JSON.parse(fs.readFileSync(path.join(root, rel + '.bmeta'), 'utf8')) as Bmeta,
    setSidecar(rel, meta) { fs.writeFileSync(path.join(root, rel + '.bmeta'), typeof meta === 'string' ? meta : JSON.stringify(meta, null, 2)) },
    scan: async p => { await svc.rescan(p, ctx) },
    row: rid => svc.store.row(rid),
    rowByPath: p => svc.store.rowByPath(p),
    idOf(p) { const r = svc.store.rowByPath(p); if (!r) throw new Error(`no asset at ${p}`); return r.id },
    issues: type => svc.store.allIssues().filter(i => !type || i.type === type),
    async reopen(ro = {}) {
      await hub.close()
      if (ro.dropIndex) fs.rmSync(path.join(home, 'libraries', id), { recursive: true, force: true })
      if (ro.now) now = ro.now
      await open()
    },
    close: async () => { await hub.close() }
  }
  return t
}

export function versionsOf(meta: Bmeta): VersionEntry[] { return meta.versions ?? [] }
