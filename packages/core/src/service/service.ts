/**
 * LibraryService (line core-A): one method per library-scoped endpoint (api-and-agent.md), PipelineDeps for the
 * pipeline, and the LibraryHandle for the plugin host. Writes go through the library lock, update the sidecar and
 * the index together, leave one `write` line in the run log (ADR-024) and emit the matching event.
 */
import { spawn } from 'node:child_process'
import fsSync from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  BUILTIN_VIEWS, FORMAT_VERSION, ISSUE_ACTIONS, SIDECAR_SUFFIX, SCANNER_ACTOR, UNNAMED_ACTOR, actorKind, baseOf, copyName, isMakingRelation,
  dirOf, effectiveReview, joinPath, nextFreeName, normalizeTag, serializeBmeta, splitName, versionNumberOf,
  type AssetDetail, type AssetPatch, type AssetSummary, type BatchRequest, type BatchResponse, type Bmeta, type CacheCleanResponse,
  type CacheResponse, type CopyResponse, type CreatorInfo, type ExportPlan, type ExportRequest, type FolderDefaults, type FolderMeta,
  type FolderNode, type Guid, type Issue, type ActionInfo, type IssueResolveResponse, type IssueType, type JobInfo, type JobsResponse,
  type LibraryInfo, type LibraryJson, type LibrarySettings, type Lineage, type LineageEdge, type LineageQuery, type MachineConfig,
  type OnConflict, type PipelineStage, type PrecheckResponse, type ProductionRecord, type Query, type ProvenanceInput,
  type Provenance, type ApplyItem, type ApplyRequest, type ApplyResponse, type ApplyChange, type UntrackResponse,
  type RegisterFields, type RegisterResponse, type Relation, type RelationInput, type RelocateCandidates, type RenderTask,
  type RetargetResponse, type ReviewStatus, type SearchRequest, type SearchResponse, type SmartView, type SummaryResponse,
  type TagEdit, type TagInfo, type ThumbVariant, type TrashInfo, type TrashItem, type VersionsResponse, type Vocabulary
} from '@bowerbird/schema'
import type { AssetFile, AssetInfo, FileInput, LibraryReader, ProbeResult, RegisterRequest, SearchDoc } from '@bowerbird/plugin-sdk'
import {
  CoreError, type CallContext, type CoreLogger, type CreatePipeline, type CreateQueryEngine, type EventBus, type IdentifyResult,
  type IndexDb, type IssueResolution, type LibraryHandle, type LibraryPaths, type LibraryPlugins, type LibraryService, type Pipeline,
  type PipelineDeps, type PluginHost, type PluginRegisterContext, type QueryEngine, type RegisterInput
} from '../contracts.js'
import { IndexStore, canonicalMetaJson, rowToSummary, uniqTags, type AssetRow } from '../index/store.js'
import { IDENTITY_FIELD, Integrity, identityOf, issueId } from '../integrity/index.js'
import { ancestors, effectiveDefaults } from '../library/defaults.js'
import { LocalLibraryFs } from '../library/fs.js'
import { checkName, isSafeRelPath, isUnder, mimeOf, normRel } from '../library/paths.js'
import { isLoopbackHost } from './net.js'
import { LibraryCore, newBatchId, newId, nowIso } from '../model/core.js'
import { Scanner, type Scope } from '../scanner/index.js'
import { planExport } from './export.js'
import { createHandle } from './handle.js'
import { similarTags, similarity } from './similar.js'
import { VersionCommitter } from './versions.js'
import { buildDetail, bundleEntryOf, issueView, summaries, summaryOf, withOriginalPaths, type ViewDeps } from './views.js'

const DAY = 86_400_000
const STAGE_NAMES = { reference: '参考素材', production: '生产物料', runtime: '运行时物料' } as const
const REVIEW_NAMES = { pending: '待审', approved: '通过', rejected: '打回', exempt: '免审' } as const
const BUILTIN_RELATIONS = [
  { id: 'source', name: '来源', inverseName: '产出', tracksVersion: true, plugin: null },
  { id: 'reference', name: '参考', inverseName: '被参考', tracksVersion: false, plugin: null },
  { id: 'uses', name: '引用', inverseName: '被引用', tracksVersion: false, plugin: null },
  { id: 'belongs', name: '归属', inverseName: '包含', tracksVersion: false, plugin: null }
]
const BUILTIN_VIEW_QUERIES: Record<(typeof BUILTIN_VIEWS)[number], Query> = {
  all: {}, untagged: { filter: { untagged: true } }, pending: { filter: { review: ['pending'] } },
  issues: { filter: { hasIssues: true } }, trash: { filter: { inTrash: true } }
}
export const SUMMARY_IMAGE_MISSING = '概览图还没有渲染，有人打开页面后才会生成'

export type UploadSource =
  | { kind: 'bytes'; name: string; data: Uint8Array }
  | { kind: 'path'; name: string; abs: string }
  | { kind: 'library'; path: string }

export interface ServiceOptions {
  id: string
  /** Display name from the machine config (falls back to library.json, then the folder name). */
  name?: string
  paths: LibraryPaths
  db: IndexDb
  /** The index was (re)created: run a full scan to repopulate it. */
  rebuilt: boolean
  events: EventBus
  log: CoreLogger
  pluginHost: PluginHost
  createQueryEngine: CreateQueryEngine
  createPipeline: CreatePipeline
  machineConfig: () => MachineConfig
  address?: () => { host: string; port: number }
  /** Watchers and timers (false in tests). */
  watch?: boolean
  /** Scanner stability window (ms; 0 in tests). */
  stableMs?: number
  /** File watching (default auto) and the per-directory limit (default 20 000 directories). */
  watchMode?: import('../scanner/watch.js').WatchMode
  maxWatchDirs?: number
  /** Opens a file / reveals it in the file manager (tests replace it). */
  opener?: (target: string, reveal: boolean) => void
  now?: () => number
  /**
   * Run the processing pipeline (thumbnails, probes; default true). A command that opens the library on its own
   * while no server runs turns it off: processing waits for the next server (ADR-069).
   */
  processing?: boolean
}

function defaultOpener(target: string, reveal: boolean): void {
  const opts = { detached: true, stdio: 'ignore' as const }
  if (process.platform === 'darwin') spawn('open', reveal ? ['-R', target] : [target], opts).unref()
  else if (process.platform === 'win32') spawn('explorer', reveal ? [`/select,${target}`] : [target], opts).unref()
  else spawn('xdg-open', [reveal ? path.dirname(target) : target], opts).unref()
}

const fileOf = (f: RegisterInput['file']): UploadSource | null => {
  if (!f) return null
  return 'data' in f ? { kind: 'bytes', name: f.name, data: f.data } : { kind: 'path', name: f.name, abs: f.tmpPath }
}
const fromFileInput = (f: FileInput, name?: string): UploadSource => {
  if (f.kind === 'bytes') return { kind: 'bytes', name: name ?? f.name, data: f.data }
  if (f.kind === 'path') return { kind: 'path', name: name ?? f.name ?? path.basename(f.path), abs: f.path }
  return { kind: 'library', path: f.path }
}
/** The fingerprint a trashed asset had (from its sidecar copy in the trash entry). */
const trashedHash = (t: { meta_json: string | null } | undefined): string | undefined => {
  if (!t?.meta_json) return undefined
  try { return (JSON.parse(t.meta_json) as { hash?: string }).hash } catch { return undefined }
}

export class LibraryServiceImpl implements LibraryService {
  readonly id: string
  readonly paths: LibraryPaths
  readonly core: LibraryCore
  readonly store: IndexStore
  readonly fs: LocalLibraryFs
  readonly scanner: Scanner
  readonly handle: LibraryHandle & { cacheFor(pluginId: string): import('@bowerbird/plugin-sdk').CacheWriter }
  private _plugins: LibraryPlugins | null = null
  query: QueryEngine | null = null
  pipeline: Pipeline | null = null
  private readonly log: CoreLogger
  private readonly committer: VersionCommitter
  private readOnly = false
  private indexBuilding = false
  private firstOpenCache: { at: number; value: LibraryInfo['firstOpen'] } | null = null
  private trashTimer: NodeJS.Timeout | null = null
  private readonly now: () => number

  constructor(private readonly o: ServiceOptions) {
    this.id = o.id
    this.paths = o.paths
    this.log = o.log
    this.now = o.now ?? Date.now
    this.store = new IndexStore(o.db)
    let core: LibraryCore | null = null
    this.fs = new LocalLibraryFs(o.paths.root, { onWrite: rel => core?.expected.add(rel) })
    const integrity = new Integrity({
      store: this.store, events: o.events, library: o.id, log: o.log,
      ignored: () => new Set(this.core.lib?.settings?.ignoredIssues ?? []),
      thumbMtime: name => this.fs.thumbMtime(name),
      tracksVersion: t => this.core.tracksVersion(t),
      missingPlugin: row => this.missingPluginOf(row)
    })
    core = this.core = new LibraryCore(o.id, this.fs, this.store, integrity, o.events, o.log)
    this.committer = new VersionCommitter(() => this._plugins, o.log)
    this.scanner = new Scanner(this.core, {
      stableMs: o.stableMs,
      ...(o.watchMode ? { watchMode: o.watchMode } : {}),
      ...(o.maxWatchDirs ? { maxWatchDirs: o.maxWatchDirs } : {}),
      intervalMinutes: () => o.machineConfig().scanIntervalMinutes,
      registering: () => this.registering,
      beforeFull: () => this.loadLibraryData(),
      afterFull: () => this.afterFullScan(),
      onFullBusy: busy => this.pipeline?.yieldToScan?.(busy),
      canScan: async () => !!(await this.fs.stat(''))?.isDir && (!this.core.lib || (await this.fs.exists('.bowerbird/library.json'))),
      onIgnored: ids => this.letGoIgnored(ids),
      onScanned: ids => { this.core.lock.detached(() => { void this.pairPending(ids).catch(e => this.log.warn('slot pairing failed', { error: String(e) })) }) }
    })
    const self = this
    const reader: LibraryReader = {
      id: o.id,
      get name() { return self.libName() },
      root: o.paths.root,
      get: async id => { const r = this.store.row(id); return r ? buildDetail(this.vd, r) : null },
      getByPath: async p => { const r = this.store.rowByPath(normRel(p)); return r ? buildDetail(this.vd, r) : null },
      search: async q => { const r = await this.requireQuery().search(q, { agent: false, scope: 'all' }); return { ...r, items: withOriginalPaths(this.store, r.items) } },
      filePath: async id => { const r = this.store.row(id); return r && !r.missing ? this.fs.absolute(r.path) : null },
      issues: async assetId => (assetId ? this.store.issuesOf(assetId) : this.store.allIssues()).map(issueView)
    }
    this.handle = createHandle({
      id: o.id,
      name: () => this.libName(),
      paths: o.paths,
      libraryJson: () => this.core.lib,
      updateLibraryJson: mut => this.updateLibraryJson(mut),
      reader,
      register: (req, ctx) => this.registerFromPlugin(req, ctx),
      hashOf: id => this.store.row(id)?.hash ?? null,
      fs: this.fs
    })
    // core-B's pipeline writes and removes its cache files through this when the cache dir is inside the library
    Object.assign(this.handle, {
      cacheFiles: {
        write: (abs: string, data: Uint8Array) => this.fs.writeCacheFile(abs, data, o.paths.cacheDir),
        remove: (abs: string) => this.fs.removeCacheFile(abs, o.paths.cacheDir)
      }
    })
  }

  /** Bind plugins, query engine and pipeline; start scanning (background). */
  async start(): Promise<this> {
    const raw = await this.fs.readLibraryJsonRaw()
    this.core.lib = await this.fs.readLibraryJson()
    this.readOnly = !!raw && typeof raw.bb === 'number' && raw.bb > FORMAT_VERSION
    this._plugins = await this.o.pluginHost.forLibrary(this.handle)
    this.core.plugins = this._plugins
    this.applyVersionStore()
    this.query = this.o.createQueryEngine({ db: this.o.db, plugins: this._plugins, thumbnailUrl: this.thumbUrl, log: this.log.child('query') })
    this.pipeline = this.o.createPipeline({
      db: this.o.db, library: this.handle, plugins: this._plugins, query: this.query, deps: this.deps, events: this.o.events, log: this.log.child('pipeline')
    })
    const pipeline = this.pipeline
    const query = this.query
    // work handed to the pipeline / query engine runs later, on its own: never inside the caller's lock (P1-3)
    const lock = this.core.lock
    this.core.hooks = {
      enqueue: (id, stages, opts) => lock.detached(() => { try { pipeline.enqueue(id, stages, opts) } catch (e) { this.log.warn('enqueue failed', { id, error: String(e) }) } }),
      forget: id => lock.detached(() => { try { pipeline.forget(id) } catch { /* ignore */ } }),
      removeDocs: ids => lock.detached(() => { void query.removeDocs(ids).catch(() => {}) }),
      changed: (paths, actor, message) => lock.detached(() => this.committer.add(paths, actor, message)),
      wantsChanges: () => !!this._plugins?.versionStore()
    }
    if (this.o.processing !== false) {
      try { pipeline.start() } catch (e) { this.log.error('pipeline start failed', { error: String(e) }) }
    }
    if (this.core.lib && !this.readOnly) {
      if (this.o.rebuilt) {
        this.indexBuilding = true
        await query.clearProviders().catch(() => {})
      }
      // idle(): the index is built once the retry for files still being written has run too
      this.startupScan = this.scanner.scan('full').then(() => this.scanner.idle()).catch(e => this.log.error('startup scan failed', { error: String(e) })).finally(() => { this.indexBuilding = false })
      this.startBackground()
    }
    return this
  }

  /** Resolves when the start-up scan is done (a command without a server waits for it before it runs, ADR-069). */
  async ready(): Promise<void> { await this.startupScan }
  private startupScan: Promise<void> = Promise.resolve()

  private startBackground(): void {
    if (this.o.watch === false) return
    void this.scanner.startWatching().catch(e => this.log.warn('watch failed', { error: String(e) }))
    this.scanner.startTimer()
    if (!this.trashTimer) {
      this.trashTimer = setInterval(() => { void this.purgeExpired().catch(() => {}) }, 3_600_000)
      this.trashTimer.unref?.()
    }
  }

  /* ───────────── small helpers ───────────── */

  get registering(): boolean { return this._registering }
  private _registering = false
  get building(): boolean { return this.indexBuilding }

  /** `/api/v1/libraries/{lib}/assets/{id}/thumbnail?variant=<v>&v=<cacheKey>` (immutable, cache-keyed). */
  variantUrl(id: Guid, variant: ThumbVariant, key: string | null): string {
    return `/api/v1/libraries/${encodeURIComponent(this.id)}/assets/${id}/thumbnail?variant=${variant}${key ? `&v=${encodeURIComponent(key)}` : ''}`
  }

  readonly thumbUrl = (id: Guid, key: string | null): string => this.variantUrl(id, 'thumb', key)

  private get vd(): ViewDeps { return { store: this.store, fs: this.fs, query: () => this.query, thumbnailUrl: this.thumbUrl } }
  private get events(): EventBus { return this.o.events }
  private emit: LibraryCore['emit'] = (t, d) => this.core.emit(t, d)
  private libName(): string { return this.core.lib?.name ?? this.o.name ?? path.basename(this.paths.root) }
  private settings(): LibrarySettings {
    return (this.core.lib?.settings ?? { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 }) as LibrarySettings
  }
  private actor(ctx: CallContext): string { return ctx.actor || UNNAMED_ACTOR }
  private requireQuery(): QueryEngine { if (!this.query) throw new CoreError('internal', 'query engine not ready'); return this.query }
  private requirePipeline(): Pipeline { if (!this.pipeline) throw new CoreError('internal', 'pipeline not ready'); return this.pipeline }
  plugins(): LibraryPlugins { if (!this._plugins) throw new CoreError('internal', 'plugins not ready'); return this._plugins }

  private row404(id: Guid): AssetRow {
    const r = this.store.row(id)
    if (!r) throw new CoreError('not_found', `资产不存在：${id}`, { id })
    return r
  }

  private assertWritable(): void {
    if (this.readOnly) throw new CoreError('read_only', '这个资产库由更新版本的 Bowerbird 写入，只能以只读方式打开')
    if (!this.core.lib) throw new CoreError('validation_failed', '资产库还没有初始化')
    // an unmounted NAS / removed folder: never recreate the root by writing into it
    if (!fsSync.existsSync(path.join(this.fs.metaDir, 'library.json'))) {
      throw new CoreError('not_found', '资产库文件夹现在访问不到', { root: this.paths.root })
    }
  }

  /** Run a write under the library lock and leave one `write` line in the run log (ADR-024). */
  private async write<T>(op: string, ctx: CallContext, data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    this.assertWritable()
    const scopes: Scope[] = []
    const r = await this.core.lock.run(async () => {
      const top = this.scansAfter === null
      if (top) this.scansAfter = scopes
      const prevOp = this.core.op
      if (!prevOp) this.core.op = { actor: this.actor(ctx), name: op }
      try {
        const res = await fn()
        this.log.info('write', { op, actor: this.actor(ctx), library: this.id, ...data })
        return res
      } finally {
        if (top) this.scansAfter = null
        this.core.op = prevOp
      }
    })
    // never wait for the scan loop while holding the lock: the loop takes the lock itself (P1-4)
    if (scopes.length) await this.core.lock.detached(() => this.scanner.scan(scopes))
    return r
  }

  /** Scopes the current write wants scanned once it has released the lock. */
  private scansAfter: Scope[] | null = null
  private scanAfterWrite(...s: Scope[]): void {
    if (this.scansAfter) this.scansAfter.push(...s)
    else this.core.lock.detached(() => { void this.scanner.scan(s).catch(() => {}) })
  }

  /**
   * The asset as its sidecar is on disk right now (ADR-046): when the sidecar changed since the index last saw it,
   * take it in first (the write then applies on top of it); an unreadable one refuses the write with `conflict`.
   */
  private async current(id: Guid): Promise<{ row: AssetRow; meta: Bmeta }> { return this.freshRow(this.row404(id)) }

  private async freshRow(row: AssetRow): Promise<{ row: AssetRow; meta: Bmeta }> {
    const meta = this.store.meta(row)
    const st = await this.fs.stat(row.path + SIDECAR_SUFFIX)
    if (!st || st.isDir) return { row, meta }
    if (st.mtimeMs === row.meta_mtime_ms && st.size === Buffer.byteLength(serializeBmeta(meta))) return { row, meta }
    const disk = await this.fs.readSidecar(row.path)
    if (!disk) return { row, meta }
    if (!disk.ok) {
      const sc = row.path + SIDECAR_SUFFIX
      this.core.integrity.raise({ id: issueId.conflict(sc), type: 'metadata-conflict', assetId: row.id, path: row.path, details: { kind: 'broken', conflictPath: sc, error: disk.error } })
      throw new CoreError('conflict', `${row.name} 的记录文件读不出来，先在完整性里选择保留哪一份`, { path: sc })
    }
    if (disk.meta.id !== row.id) throw new CoreError('conflict', `${row.name} 的记录文件换成了另一个资产的`, { path: row.path, id: disk.meta.id })
    const changed = canonicalMetaJson(disk.meta) !== row.meta_json
    if (changed) {
      await this.core.indexMeta(row.path, disk.meta, { knownHash: false })
      await this.core.integrity.refresh([row.id])
      this.log.info('took in an outside edit of a sidecar before writing', { id: row.id, path: row.path })
      this.emit('asset.updated', { id: row.id, fields: ['metadata'] })
    } else {
      this.store.setStat(row.id, { metaMtimeMs: st.mtimeMs })
    }
    return { row: this.row404(row.id), meta: disk.meta }
  }

  private async detail(id: Guid): Promise<AssetDetail> { return buildDetail(this.vd, this.row404(id)) }

  /** Save metadata (sidecar + index); stamps `modified` unless told not to. */
  private async save(row: AssetRow, meta: Bmeta, by: string | null): Promise<Bmeta> {
    const m = by ? { ...meta, modified: { at: nowIso(), by } } : meta
    await this.core.writeMeta(row.path, m, { missing: !!row.missing })
    return m
  }

  /* ───────────── library ───────────── */

  async info(ctx: CallContext): Promise<LibraryInfo> {
    const lib = this.core.lib
    const rootExists = !!(await this.fs.stat(''))?.isDir
    const state: LibraryInfo['state'] = !rootExists ? 'unavailable' : this.readOnly ? 'read-only' : lib ? 'ready' : 'uninitialized'
    const plugins = this._plugins
    const enabled = new Map((plugins?.enabled() ?? []).map(p => [p.id, p]))
    let known = new Set<string>()
    try { known = new Set(this.o.pluginHost.list(this.handle).filter(p => p.status !== 'missing').map(p => p.id)) } catch { /* host without list */ }
    const st = this.store.prep('SELECT COUNT(*) n, COALESCE(SUM(size), 0) b FROM assets').get() as { n: number; b: number }
    const iss = this.store.prep('SELECT COUNT(*) n, COUNT(DISTINCT asset_id) a FROM issues').get() as { n: number; a: number }
    let counts = { all: 0, untagged: 0, pending: 0, issues: 0, trash: 0 }
    try { if (this.query) counts = this.query.counts() } catch { /* query engine not ready */ }
    const addr = this.o.address?.() ?? { host: this.o.machineConfig().host, port: this.o.machineConfig().port }
    const vs = plugins?.versionStore()
    return {
      id: this.id, name: this.libName(), root: this.paths.root, state,
      formatVersion: lib?.bb ?? null,
      settings: lib?.settings ?? null,
      requiredPlugins: Object.entries(lib?.plugins ?? {}).map(([id, range]) => ({ id, range, installed: enabled.has(id) || known.has(id), enabled: enabled.has(id) })),
      stats: { assets: st.n, bytes: st.b, issues: iss.n, issueAssets: iss.a },
      counts,
      isLocal: ctx.isLocal,
      versionStore: vs ? { id: vs.pluginId, displayName: vs.displayName } : null,
      hasCreators: (plugins?.creators().length ?? 0) > 0,
      firstOpen: state === 'uninitialized' ? await this.firstOpen() : null,
      scan: { ...this.scanner.progress },
      lanOpen: !isLoopbackHost(addr.host),
      address: `http://${addr.host.includes(':') ? `[${addr.host}]` : addr.host}:${addr.port}`,
      // not in the frozen schema yet: whether the folder is watched, and why not (periodic scans only)
      ...({ watch: { ...this.scanner.watchState } } as object)
    } as LibraryInfo
  }

  /** What a first open would register (ADR-033): files, folders, extensions no plugin reads. */
  private async firstOpen(): Promise<LibraryInfo['firstOpen']> {
    if (this.firstOpenCache && this.now() - this.firstOpenCache.at < 5000) return this.firstOpenCache.value
    const exts = new Set((this._plugins?.formats() ?? []).flatMap(f => f.contribution.extensions))
    let files = 0
    let folders = 0
    const unsupported = new Map<string, number>()
    const walk = async (rel: string): Promise<void> => {
      for (const e of await this.fs.readdir(rel)) {
        const p = joinPath(rel, e.name)
        if (e.isDirectory()) {
          if (this.fs.ignored(p, true)) continue
          folders++
          await walk(p)
        } else if (e.isFile()) {
          if (this.fs.ignored(p, false)) continue
          files++
          const ext = splitName(e.name).ext.toLowerCase()
          if (!exts.has(ext)) unsupported.set(ext, (unsupported.get(ext) ?? 0) + 1)
        }
      }
    }
    await walk('')
    const value = {
      files, folders,
      unsupported: [...unsupported].sort((a, b) => b[1] - a[1]).map(([ext, count]) => {
        const m = ext ? this._plugins?.missingPluginFor(ext) : null
        return { ext: ext || '(无后缀)', count, ...(m ? { hint: `${m.displayName ?? m.id}（${m.id} ${m.range}）` } : {}) }
      })
    }
    this.firstOpenCache = { at: this.now(), value }
    return value
  }

  async updateLibraryJson(mut: (lib: LibraryJson) => void): Promise<void> {
    await this.core.lock.run(async () => {
      const lib = (await this.fs.readLibraryJson()) ?? this.core.lib
      if (!lib) throw new CoreError('validation_failed', '资产库还没有初始化')
      const next = structuredClone(lib)
      mut(next)
      await this.fs.writeLibraryJson(next)
      this.core.lib = next
    })
  }

  async patchLibrary(patch: { name?: string; settings?: Partial<LibrarySettings> }, ctx: CallContext): Promise<LibraryInfo> {
    const fields: string[] = []
    for (const [pid, vals] of Object.entries(patch.settings?.plugins ?? {})) this.checkLibrarySettings(pid, (vals ?? {}) as Record<string, unknown>)
    await this.write('library.patch', ctx, { fields: Object.keys(patch) }, async () => {
      await this.updateLibraryJson(lib => {
        if (patch.name !== undefined && patch.name.trim()) { lib.name = patch.name.trim(); fields.push('name') }
        if (patch.settings) {
          // only keys the caller really gave (a zod `.partial()` parse may have filled defaults in)
          const given = Object.fromEntries(Object.entries(patch.settings).filter(([, v]) => v !== undefined))
          lib.settings = { ...lib.settings, ...given } as LibrarySettings
          for (const k of Object.keys(given)) fields.push(`settings.${k}`)
        }
      })
    })
    if (fields.some(f => f.startsWith('settings.plugins'))) await this.reloadPlugins()
    if (fields.includes('settings.trashDays')) await this.purgeExpired()
    if (fields.includes('settings.ignoredIssues')) await this.core.lock.run(() => this.core.integrity.refreshAll())
    this.emit('library.updated', { fields })
    return this.info(ctx)
  }

  async initialize(ctx: CallContext): Promise<void> {
    if (this.readOnly) throw new CoreError('read_only', '资产库只能以只读方式打开')
    if (!this.core.lib) this.core.lib = await this.fs.readLibraryJson() // written by `bb init` meanwhile
    if (!this.core.lib) {
      await this.core.lock.run(async () => {
        const lib = await initialLibraryJson(this.o.pluginHost, this.handle, this._plugins, this.libName())
        await this.fs.writeLibraryJson(lib)
        this.core.lib = lib
        this.log.info('write', { op: 'library.init', actor: this.actor(ctx), library: this.id })
      })
      await this.reloadPlugins()
      this.emit('library.updated', { fields: ['state'] })
      this.startBackground()
    }
    this._registering = true
    // registering lasts until the retry for files still being written has run (the scan reports `registering` until then)
    void this.scanner.scan('full').then(() => this.scanner.idle()).catch(e => this.log.error('registration scan failed', { error: String(e) })).finally(() => { this._registering = false })
  }

  async rescan(p: string | undefined, _ctx: CallContext): Promise<void> {
    this.assertWritable()
    const folder = normRel(p)
    if (folder) {
      const st = await this.fs.stat(folder)
      if (!st) throw new CoreError('not_found', `路径不存在：${folder}`, { path: folder })
      if (!st.isDir) return this.scanner.scan([{ folder: dirOf(folder), recursive: false }])
    }
    await this.scanner.scan([{ folder, recursive: true }])
  }

  async stopScan(): Promise<void> { await this.scanner.stop() }

  async vocabulary(): Promise<Vocabulary> {
    const db = this.store.db
    const formatCounts = new Map((db.prepare('SELECT format, COUNT(*) n FROM assets GROUP BY format').all() as Array<{ format: string; n: number }>).map(r => [r.format, r.n]))
    const formats: Vocabulary['formats'] = []
    const seen = new Set<string>()
    for (const f of this._plugins?.formats() ?? []) {
      if (seen.has(f.contribution.id)) continue
      seen.add(f.contribution.id)
      formats.push({ id: f.contribution.id, displayName: f.contribution.displayName, plugin: f.pluginId, count: formatCounts.get(f.contribution.id) ?? 0 })
    }
    formats.push({ id: 'unknown', displayName: '未知格式', plugin: null, count: formatCounts.get('unknown') ?? 0 })
    const relationTypes: Vocabulary['relationTypes'] = [...BUILTIN_RELATIONS]
    for (const t of this._plugins?.relationTypes() ?? []) {
      if (relationTypes.some(r => r.id === t.id)) continue
      relationTypes.push({ id: t.id, name: t.name, inverseName: t.inverseName, tracksVersion: !!t.tracksVersion, plugin: t.plugin })
    }
    const designObjects = (db.prepare('SELECT id, name FROM assets WHERE member_count > 0 ORDER BY name').all() as Array<{ id: string; name: string }>)
      .map(r => { const t = this.store.tech(r.id).title; return { id: r.id, name: r.name, ...(typeof t === 'string' ? { title: t } : {}) } })
    return {
      stages: (['reference', 'production', 'runtime'] as const).map(id => ({ id, name: STAGE_NAMES[id] })),
      reviews: (['pending', 'approved', 'rejected', 'exempt'] as const).map(id => ({ id, name: REVIEW_NAMES[id] })),
      formats,
      relationTypes,
      tags: (db.prepare('SELECT tag name, COUNT(DISTINCT asset_id) count FROM tags WHERE ai = 0 GROUP BY tag ORDER BY count DESC, tag').all() as Array<{ name: string; count: number }>),
      methods: (db.prepare('SELECT method id, COUNT(*) count FROM assets WHERE method IS NOT NULL GROUP BY method ORDER BY count DESC').all() as Array<{ id: string; count: number }>),
      actors: (db.prepare('SELECT created_by id, COUNT(*) count FROM assets GROUP BY created_by ORDER BY count DESC').all() as Array<{ id: string; count: number }>),
      templates: (this._plugins?.templates() ?? []).map(t => ({ id: t.template.id, displayName: t.template.displayName, plugin: t.pluginId })),
      designObjects
    }
  }

  /* ───────────── search & read ───────────── */

  async search(req: SearchRequest, ctx: CallContext): Promise<SearchResponse> {
    const q = this.resolveBelongsName(req)
    const res = await this.requireQuery().search(q, { agent: actorKind(this.actor(ctx)) === 'agent', scope: this.settings().agentSearchScope ?? 'all' })
    return { ...res, items: withOriginalPaths(this.store, res.items) }
  }

  /** `belongs:<名称>` arrives as a name: resolve it to the design object's GUID. */
  private resolveBelongsName<T extends Query>(req: T): T {
    const rel = req.filter?.relation
    if (!rel || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(rel.to)) return req
    const r = this.store.prep('SELECT id FROM assets WHERE name = ? OR stem = ? ORDER BY member_count DESC LIMIT 1').get(rel.to, rel.to) as { id: string } | undefined
    if (!r) return req
    return { ...req, filter: { ...req.filter, relation: { ...rel, to: r.id } } }
  }

  async get(id: Guid, _ctx: CallContext): Promise<AssetDetail> { return this.detail(id) }

  async precheck(folder: string, names: string[]): Promise<PrecheckResponse> {
    const f = normRel(folder)
    const conflicts: PrecheckResponse['conflicts'] = []
    for (const n of names) {
      const p = joinPath(f, normRel(n))
      const row = this.store.rowByPath(p)
      if (row) { const s = summaryOf(this.vd, row.id); if (s) conflicts.push({ name: n, existing: s }) }
    }
    return { conflicts }
  }

  /* ───────────── registration ───────────── */

  async register(input: RegisterInput, ctx: CallContext): Promise<RegisterResponse> {
    return this.write('asset.register', ctx, { name: input.fields.name ?? input.file?.name ?? input.fields.path }, async () => {
      return this.doRegister(input.fields, fileOf(input.file), ctx, {})
    })
  }

  /**
   * Registration channel of plugins (sources, actions, creators; ADR-016). Every output of one run carries the run's
   * provenance with the same batch id in its own .bmeta, and the run's inputs as source relations (ADR-070).
   */
  async registerFromPlugin(req: RegisterRequest, ctx: PluginRegisterContext): Promise<{ info: AssetInfo }> {
    const call: CallContext = { actor: ctx.actor || UNNAMED_ACTOR, isLocal: true }
    const { file, name, ...rest } = req
    const fields: RegisterFields = { ...rest, ...(name ? { name } : {}) }
    const prov = fields.provenance ?? ctx.provenance
    if (prov || ctx.batch) fields.provenance = { ...(prov ?? { method: `${ctx.pluginId}/output` }), ...(ctx.batch && !prov?.batch ? { batch: ctx.batch } : {}) }
    if (ctx.inputs?.length && !(fields.relations ?? []).some(r => isMakingRelation(r.type))) {
      fields.relations = [...(fields.relations ?? []), ...ctx.inputs.map(i => ({ type: 'source', to: i.id, ...(i.role ? { role: i.role } : {}) }))]
    }
    return this.write('asset.register', call, { plugin: ctx.pluginId, name: name ?? (file.kind === 'library' ? file.path : file.name) }, async () => {
      const src = fromFileInput(file, name)
      if (src.kind === 'library') fields.path = src.path
      const response = await this.doRegister(fields, src.kind === 'library' ? null : src, call, { plugin: `${ctx.pluginId}@${ctx.pluginVersion}` })
      if (!response.asset) throw new CoreError('conflict', '登记被跳过')
      const info = summaryOf(this.vd, response.asset.id)!
      return { info }
    })
  }

  /** The information a registration request carries, as one wanted state (ADR-068). */
  private itemOf(fields: RegisterFields): ApplyItem {
    return {
      ...(fields.stage ? { stage: fields.stage } : {}),
      ...(fields.tags?.length ? { tags: { add: fields.tags } } : {}),
      ...(fields.description ? { description: fields.description } : {}),
      ...(fields.review === 'exempt' ? { review: 'exempt' as const } : {}),
      ...(fields.provenance ? { provenance: fields.provenance } : {}),
      ...(fields.relations?.length ? { relations: { add: fields.relations } } : {}),
      ...(fields.views ? { views: fields.views } : {})
    }
  }

  private async doRegister(fields: RegisterFields, file: UploadSource | null, ctx: CallContext, o: { plugin?: string }): Promise<RegisterResponse> {
    const by = this.actor(ctx)
    const knownTags = this.store.knownTags()
    const item = this.itemOf(fields)
    // a file already in the library: the same as saying what it should have (ADR-068) — again and again is harmless
    if (!file || fields.path || file.kind === 'library') {
      const p = fields.path ?? (file?.kind === 'library' ? file.path : undefined)
      if (!p) throw new CoreError('validation_failed', '需要上传文件，或给出资产库内的路径')
      const res = await this.applyOne({ ...item, path: p }, ctx, { dryRun: false, plugin: o.plugin })
      return { asset: await this.detail(res.id!), skipped: false, newTags: this.newTags(res.addedTags, knownTags) }
    }

    this.prepareRelations(fields.relations ?? [], null) // validate before writing anything
    const folder = normRel(fields.folder ?? '')
    const nameRel = normRel(fields.name ?? file.name)
    if (!nameRel) throw new CoreError('validation_failed', '缺少文件名')
    checkName(baseOf(nameRel))
    let p = joinPath(folder, nameRel)
    if (isUnder(p, '.bowerbird')) throw new CoreError('validation_failed', `路径不合法：${p}`)
    if (this.fs.ignored(p, false)) throw new CoreError('validation_failed', `这个文件名会被忽略规则跳过：${baseOf(p)}`, { path: p })
    const occupied = this.store.rowByPath(p) ?? undefined
    if (occupied || (await this.fs.exists(p)) || (await this.fs.exists(p + SIDECAR_SUFFIX))) {
      const mode: OnConflict | undefined = fields.onConflict
      if (!mode) throw new CoreError('conflict', `${dirOf(p) || '根目录'} 里已经有 ${baseOf(p)}`, { path: p, existing: occupied?.id ?? null })
      if (mode === 'skip') return { asset: null, skipped: true, newTags: [] }
      if (mode === 'replace' && !occupied) {
        // ADR-047: an unregistered file is never overwritten
        throw new CoreError('conflict', `${baseOf(p)} 是一个还没登记的文件，不会覆盖它`, { path: p, existing: null })
      }
      if (mode === 'replace' && occupied) {
        await this.doReplaceContent(occupied, file, undefined, by)
        const res = await this.applyOne({ ...item, id: occupied.id }, ctx, { dryRun: false, plugin: o.plugin })
        return { asset: await this.detail(occupied.id), skipped: false, newTags: this.newTags(res.addedTags, knownTags) }
      }
      if (mode === 'keep-both') {
        const dir = dirOf(p)
        const free = nextFreeName(baseOf(p), c => !!this.store.rowByPath(joinPath(dir, c)) || this.existsSync(joinPath(dir, c)) || this.existsSync(joinPath(dir, c) + SIDECAR_SUFFIX))
        p = joinPath(dir, free)
      }
    }
    if (file.kind === 'bytes') await this.fs.writeFile(p, file.data)
    else if (file.kind === 'path') await this.fs.copyIn(file.abs, p)

    const st = await this.fs.contentStat(p)
    if (!st) throw new CoreError('internal', `写入失败：${p}`)
    const hash = await this.fs.hash(p)
    // written once, with what the request says (nobody ever sees it without); an upload that says nothing about the
    // file is only seen, like a file copied in (ADR-067)
    const fresh = await this.core.newMeta(p, { hash, size: st.size, isDir: st.isDir }, { by })
    const { next: meta, changes, addedTags } = this.wanted(fresh, item, by, fresh.id, o.plugin)
    if (changes.length) await this.core.writeMeta(p, meta)
    else await this.core.indexOnly(p, meta)
    this.store.setFile(p, st.size, st.mtimeMs, hash)
    if (changes.some(c => c.field === 'relations')) for (const r of meta.relations ?? []) this.relationPipeline(meta.id, r.type)
    await this.core.integrity.refresh([meta.id, ...(meta.relations ?? []).map(r => r.to)])
    this.core.hooks.enqueue(meta.id, 'all', { priority: 1, reason: 'registered' })
    this.core.hooks.changed([p], by, 'register')
    this.emit('asset.created', { id: meta.id, path: p, by })
    for (const r of meta.relations ?? []) this.emit('relation.updated', { from: meta.id, type: r.type, to: r.to, op: 'added' })
    await this.pairPending(new Set([meta.id]))
    return { asset: await this.detail(meta.id), skipped: false, newTags: this.newTags(addedTags, knownTags) }
  }

  private existsSync(rel: string): boolean {
    try { return fsSync.existsSync(this.fs.absolute(rel)) } catch { return false }
  }

  /**
   * Validate relation inputs and fill toHash: a `source` relation remembers the counterpart's content to notice when
   * it changes; a `reference` one keeps it only for the record (ADR-073). `trashedOk`: a target in the trash is
   * accepted (the relation is broken until it is restored), so that undoing「删除这条关系」on a broken link can put it
   * back; a target that is neither indexed nor in the trash never is.
   */
  private prepareRelations(inputs: RelationInput[], self: Guid | null, trashedOk = false): Relation[] {
    const out: Relation[] = []
    const types = new Set([...BUILTIN_RELATIONS.map(r => r.id), ...(this._plugins?.relationTypes() ?? []).map(r => r.id)])
    for (const r of inputs) {
      if (!types.has(r.type)) throw new CoreError('validation_failed', `未知的关系类型：${r.type}`, { type: r.type })
      if (self && r.to === self) throw new CoreError('validation_failed', '资产不能和自己建立关系')
      if (r.slot !== undefined && !isSafeRelPath(r.slot)) throw new CoreError('validation_failed', `位置名必须是相对路径：${r.slot}`, { slot: r.slot })
      const target = this.store.row(r.to)
      const trashed = !target && trashedOk ? this.store.trashByAsset(r.to) : undefined
      if (!target && !trashed) throw new CoreError('validation_failed', `关系的对方不存在：${r.to}`, { to: r.to })
      const toHash = target ? target.hash : trashedHash(trashed)
      if (self && r.type === 'source') this.assertNoCycle(self, r.to)
      const keepsHash = this.core.tracksVersion(r.type) || isMakingRelation(r.type)
      out.push({
        type: r.type, to: r.to,
        ...(keepsHash && toHash ? { toHash } : {}),
        ...(r.role && isMakingRelation(r.type) ? { role: r.role } : {}),
        ...(r.slot ? { slot: r.slot } : {}), ...(r.note ? { note: r.note } : {})
      })
    }
    return dedupeRelations(out)
  }

  private newTags(tags: string[], known: Set<string>): RegisterResponse['newTags'] {
    const fresh = tags.filter(t => !known.has(t))
    if (!fresh.length) return []
    const counts = new Map((this.store.prep('SELECT tag, COUNT(DISTINCT asset_id) n FROM tags WHERE ai = 0 GROUP BY tag').all() as Array<{ tag: string; n: number }>).map(r => [r.tag, r.n]))
    for (const t of fresh) counts.delete(t)
    for (const k of [...counts.keys()]) if (!known.has(k)) counts.delete(k)
    const aliases = new Map<string, string>()
    // aliases from tags.json are loaded lazily (sync read is fine: small file)
    try {
      const raw = JSON.parse(fsSync.readFileSync(path.join(this.fs.metaDir, 'tags.json'), 'utf8')) as { tags?: Record<string, { aliases?: string[] }> }
      for (const [name, def] of Object.entries(raw.tags ?? {})) for (const a of def.aliases ?? []) aliases.set(a, name)
    } catch { /* no tags.json */ }
    return fresh.map(tag => ({ tag, similar: similarTags(tag, counts, aliases) }))
  }

  /* ───────────── wanted state (ADR-068) ───────────── */

  async apply(req: ApplyRequest, ctx: CallContext): Promise<ApplyResponse> {
    const dryRun = !!req.dryRun
    const known = this.store.knownTags()
    const results: ApplyResponse['results'] = []
    const added = new Set<string>()
    const run = async () => {
      for (const [index, item] of req.items.entries()) {
        try {
          const r = await this.applyOne(item, ctx, { dryRun })
          for (const t of r.addedTags) added.add(t)
          results.push({ index, id: r.id, path: r.path, changed: r.changes.length > 0, changes: r.changes })
        } catch (e) {
          const err = e instanceof CoreError ? { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } : { code: 'internal', message: String((e as Error)?.message ?? e) }
          results.push({ index, id: item.id ?? null, path: item.path ?? null, changed: false, changes: [], error: err })
        }
      }
    }
    if (dryRun) await run()
    else await this.write('asset.apply', ctx, { items: req.items.length }, run)
    return { results, dryRun, newTags: dryRun ? [] : this.newTags([...added], known) }
  }

  /**
   * Compare one wanted state with the asset and write the difference (inside the write lock unless `dryRun`).
   * A `path` that the index does not know yet is taken in first: a file with its own .bmeta as it is, a bare file
   * as a seen asset (it gets its .bmeta only when there is something to write).
   */
  private async applyOne(item: ApplyItem, ctx: CallContext, o: { dryRun: boolean; plugin?: string; quiet?: boolean }): Promise<{ id: Guid | null; path: string | null; changes: ApplyChange[]; addedTags: string[] }> {
    const by = this.actor(ctx)
    let row = item.id ? this.row404(item.id) : await this.rowAtPath(item.path, o.dryRun)
    if (!row) {
      // dry run on a file the index has not taken in yet: compare with what a fresh asset would be
      const p = normRel(item.path ?? '')
      const blank = await this.blankMeta(p, by)
      const { changes, addedTags } = this.wanted(blank, item, by, null, o.plugin)
      return { id: null, path: p, changes, addedTags }
    }
    if (item.id && item.path && normRel(item.path) !== row.path) throw new CoreError('validation_failed', `id 与路径指的不是同一个资产：${item.path}`, { id: item.id, path: item.path })
    if (row.missing) throw new CoreError('conflict', `${row.name} 的文件不见了，先在完整性里处理`, { id: row.id })
    const cur = o.dryRun ? { row, meta: this.store.meta(row) } : await this.freshRow(row)
    row = cur.row
    const { next, changes, addedTags } = this.wanted(cur.meta, item, by, row.id, o.plugin)
    if (!changes.length || o.dryRun) return { id: row.id, path: row.path, changes, addedTags }
    await this.save(row, next, by)
    const fields = [...new Set(changes.map(c => c.field.split('.')[0]!))]
    if (fields.some(f => f === 'tags' || f === 'description' || f === 'stage' || f === 'provenance')) this.core.hooks.enqueue(row.id, ['index'], { reason: 'apply' })
    if (fields.includes('relations')) {
      const before = new Set((cur.meta.relations ?? []).map(relKey))
      const after = new Set((next.relations ?? []).map(relKey))
      for (const r of next.relations ?? []) if (!before.has(relKey(r))) { this.relationPipeline(row.id, r.type); if (!o.quiet) this.emit('relation.updated', { from: row.id, type: r.type, to: r.to, op: 'added' }) }
      for (const r of cur.meta.relations ?? []) if (!after.has(relKey(r))) { this.relationPipeline(row.id, r.type); if (!o.quiet) this.emit('relation.updated', { from: row.id, type: r.type, to: r.to, op: 'removed' }) }
      await this.core.integrity.refresh([row.id, ...(next.relations ?? []).map(r => r.to), ...(cur.meta.relations ?? []).map(r => r.to)])
    }
    this.core.hooks.changed([row.path], by, 'metadata')
    if (!o.quiet) this.emit('asset.updated', { id: row.id, fields, by })
    return { id: row.id, path: row.path, changes, addedTags }
  }

  /** The asset at a library path, taking a file the index has not seen yet in (ADR-067); null only on a dry run. */
  private async rowAtPath(pathIn: string | undefined, dryRun: boolean): Promise<AssetRow | null> {
    if (!pathIn) throw new CoreError('validation_failed', '给出资产的 id 或资产库内的路径')
    const p = normRel(pathIn)
    if (!p || isUnder(p, '.bowerbird')) throw new CoreError('validation_failed', `路径不合法：${pathIn}`)
    const known = this.store.rowByPath(p)
    const st = await this.fs.stat(p)
    if (!st) {
      if (known?.missing) return known
      throw new CoreError('not_found', `资产库里没有这个文件：${p}`, { path: p })
    }
    if (this.fs.ignored(p, st.isDir)) throw new CoreError('validation_failed', `这个文件会被忽略规则跳过：${p}`, { path: p })
    // a file inside a bundle is part of that one asset; a plain folder is not an asset (bundles are made explicitly)
    for (const a of ancestors(dirOf(p))) {
      if (a && (this.store.rowByPath(a)?.bundle || (await this.fs.exists(a + SIDECAR_SUFFIX)))) throw new CoreError('validation_failed', `${p} 在包式资产 ${a} 里面，只能对整个包写信息`, { path: p, bundle: a })
    }
    if (st.isDir && !known?.bundle && !(await this.fs.exists(p + SIDECAR_SUFFIX))) {
      throw new CoreError('validation_failed', `${p} 是一个文件夹，不是资产；要把它当成一个资产，先把它建成包式资产`, { path: p })
    }
    const sc = await this.fs.readSidecar(p)
    if (sc && !sc.ok) throw new CoreError('conflict', `这个文件的记录读不出来：${p}${SIDECAR_SUFFIX}`, { path: p })
    if (sc?.ok) {
      const byId = this.store.row(sc.meta.id)
      if (byId && byId.path !== p) throw new CoreError('conflict', '同一个资产出现在两个位置', { path: p, id: sc.meta.id, existing: byId.path })
      if (byId) return byId
      if (dryRun) return null
      // a file that arrived with its own sidecar and was not scanned yet: take it as it is (never a new GUID)
      if (known && known.id !== sc.meta.id && !known.sidecar) { this.store.deleteAsset(known.id); this.core.hooks.forget(known.id) }
      await this.core.indexMeta(p, sc.meta, { knownHash: false })
      await this.core.integrity.refresh([sc.meta.id])
      this.core.hooks.enqueue(sc.meta.id, 'all', { reason: 'registered' })
      this.emit('asset.created', { id: sc.meta.id, path: p, by: SCANNER_ACTOR })
      return this.row404(sc.meta.id)
    }
    if (known) return known
    if (dryRun) return null
    // a bare file the scanner has not reached yet: the library sees it now
    const hash = await this.fs.hash(p)
    const cst = await this.fs.contentStat(p)
    const fileTime = new Date(cst?.mtimeMs ?? this.now()).toISOString()
    const meta = await this.core.claim(p, { hash, size: cst?.size ?? st.size, isDir: st.isDir }, { by: SCANNER_ACTOR, at: fileTime, versionAt: fileTime, indexOnly: true })
    if (cst) this.store.setFile(p, cst.size, cst.mtimeMs, hash)
    await this.core.integrity.refresh([meta.id])
    this.core.hooks.enqueue(meta.id, 'all', { priority: 1, reason: 'registered' })
    this.emit('asset.created', { id: meta.id, path: p, by: SCANNER_ACTOR })
    return this.row404(meta.id)
  }

  /** What a fresh asset at `p` would be (dry run before the file is taken in). */
  private async blankMeta(p: string, by: string): Promise<Bmeta> {
    const st = await this.fs.stat(p)
    if (!st) throw new CoreError('not_found', `资产库里没有这个文件：${p}`, { path: p })
    const defaults = await effectiveDefaults(this.fs, dirOf(p))
    const tags = uniqTags(defaults.tags)
    return {
      bb: FORMAT_VERSION, id: '00000000-0000-7000-8000-000000000000', hash: 'sha256:', stage: defaults.stage ?? this.core.defaultStage(),
      ...(tags.length ? { tags } : {}), ...(defaults.review === 'exempt' ? { review: { status: 'exempt', by, at: nowIso() } } : {}),
      created: { at: nowIso(), by }
    }
  }

  /**
   * The next metadata for a wanted state, and what differs (ADR-068). Nothing here writes. Lists (tags, relations)
   * are said item by item — has / has not — so two callers never undo each other.
   */
  private wanted(meta: Bmeta, item: ApplyItem, by: string, self: Guid | null, plugin?: string): { next: Bmeta; changes: ApplyChange[]; addedTags: string[] } {
    const next: Bmeta = { ...meta }
    const changes: ApplyChange[] = []
    const change = (field: string, before: unknown, after: unknown) => changes.push({ field, before: before ?? null, after: after ?? null })
    let addedTags: string[] = []
    if (item.stage && item.stage !== meta.stage) { change('stage', meta.stage, item.stage); next.stage = item.stage }
    if (item.tags) {
      const before = uniqTags(meta.tags)
      const remove = new Set(uniqTags(item.tags.remove))
      const after = uniqTags([...before.filter(t => !remove.has(t)), ...uniqTags(item.tags.add).filter(t => !remove.has(t))])
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        addedTags = after.filter(t => !before.includes(t))
        change('tags', before, after)
        if (after.length) next.tags = after
        else delete next.tags
      }
    }
    if (item.description !== undefined) {
      const want = item.description ?? ''
      if (want !== (meta.description ?? '')) {
        change('description', meta.description, want || null)
        if (want) next.description = want
        else delete next.description
      }
    }
    if (item.review === 'exempt' && meta.review?.status !== 'exempt') {
      change('review', meta.review?.status ?? 'pending', 'exempt')
      next.review = { status: 'exempt', by, at: nowIso() }
    } else if (item.review === 'pending' && meta.review?.status === 'exempt') {
      change('review', 'exempt', 'pending')
      delete next.review
    }
    if (item.provenance !== undefined) {
      const before = meta.provenance
      if (item.provenance === null) {
        if (before) { change('provenance', before, null); delete next.provenance }
      } else {
        const want = provenanceOf(item.provenance, before, by, plugin)
        if (!sameProvenance(before, want)) { change('provenance', before, want); next.provenance = want }
      }
    }
    if (item.relations) {
      const cur = meta.relations ?? []
      const prepared = this.prepareRelations(item.relations.add ?? [], self)
      let list = cur.map(r => ({ ...r }))
      for (const r of prepared) {
        const i = list.findIndex(x => relKey(x) === relKey(r))
        if (i < 0) { list.push(r); continue }
        const x = list[i]!
        // an existing relation keeps the version it points at (making it again never acknowledges an update)
        const merged: Relation = { ...x, ...(r.to !== x.to ? { to: r.to, ...(r.toHash ? { toHash: r.toHash } : {}) } : {}), ...(r.role ? { role: r.role } : {}), ...(r.note ? { note: r.note } : {}) }
        list[i] = merged
      }
      for (const rm of item.relations.remove ?? []) {
        list = list.filter(x => !(x.type === rm.type && x.to === rm.to && (rm.slot === undefined || (x.slot ?? '') === rm.slot)))
      }
      if (JSON.stringify(cur) !== JSON.stringify(list)) {
        change('relations', cur, list)
        if (list.length) next.relations = list
        else delete next.relations
      }
    }
    if (item.views !== undefined) {
      const want = item.views ?? undefined
      if (JSON.stringify(meta.views ?? null) !== JSON.stringify(want ?? null)) {
        change('views', meta.views, want)
        if (want) next.views = want
        else delete next.views
      }
    }
    if (item.fields) {
      const reserved = Object.keys(item.fields).filter(ns => ns === 'bowerbird' || ns.startsWith('bowerbird.'))
      if (reserved.length) throw new CoreError('validation_failed', `字段命名空间 ${reserved.join('、')} 由内核使用，不能直接改`, { namespaces: reserved })
      const f = { ...(meta.fields ?? {}) }
      for (const [ns, v] of Object.entries(item.fields)) {
        const want = v && Object.keys(v).length ? v : undefined
        if (JSON.stringify(f[ns] ?? null) === JSON.stringify(want ?? null)) continue
        change(`fields.${ns}`, f[ns], want)
        if (want) f[ns] = want
        else delete f[ns]
      }
      if (Object.keys(f).length) next.fields = f
      else delete next.fields
    }
    if (item.auxiliary !== undefined && item.auxiliary !== !!meta.auxiliary) {
      change('auxiliary', !!meta.auxiliary, item.auxiliary)
      if (item.auxiliary) next.auxiliary = true
      else delete next.auxiliary
    }
    return { next, changes, addedTags }
  }

  /* ───────────── asset edits ───────────── */

  async patch(id: Guid, patch: AssetPatch, ctx: CallContext): Promise<{ asset: AssetDetail; newTags: RegisterResponse['newTags'] }> {
    return this.write('asset.patch', ctx, { id, fields: Object.keys(patch) }, async () => {
      const known = this.store.knownTags()
      const { added } = await this.doPatch(id, patch, ctx)
      return { asset: await this.detail(id), newTags: this.newTags(added, known) }
    })
  }

  /** A patch is a wanted state too; `tags.set` is said as has / has not against the tags now. */
  private async doPatch(id: Guid, patch: AssetPatch, ctx: CallContext): Promise<{ fields: string[]; added: string[] }> {
    const row = this.row404(id)
    let tags: ApplyItem['tags']
    if (patch.tags?.set) {
      const now = uniqTags(this.store.meta(row).tags)
      const set = uniqTags(patch.tags.set)
      tags = { add: set, remove: now.filter(t => !set.includes(t)) }
    } else if (patch.tags) tags = { ...(patch.tags.add ? { add: patch.tags.add } : {}), ...(patch.tags.remove ? { remove: patch.tags.remove } : {}) }
    const item: ApplyItem = {
      id,
      ...(tags ? { tags } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.stage ? { stage: patch.stage } : {}),
      ...(patch.fields ? { fields: patch.fields } : {}),
      ...(patch.auxiliary !== undefined ? { auxiliary: patch.auxiliary } : {}),
      ...(patch.views !== undefined ? { views: patch.views } : {}),
      ...(patch.provenance !== undefined ? { provenance: patch.provenance } : {})
    }
    const r = await this.applyOne(item, ctx, { dryRun: false })
    return { fields: [...new Set(r.changes.map(c => c.field.split('.')[0]!))], added: r.addedTags }
  }

  /* ───────────── untrack (ADR-067) ───────────── */

  async untrack(id: Guid, ctx: CallContext): Promise<UntrackResponse> {
    return this.write('asset.untrack', ctx, { id }, async () => {
      const row = this.row404(id)
      const referrers = this.store.referrers(id)
      const trashId = await this.doUntrack(row, this.actor(ctx))
      return { trashId, referrers }
    })
  }

  /** The library lets go of an asset: its .bmeta to the trash (restorable), the file stays; the index forgets it. */
  private async doUntrack(row: AssetRow, by: string): Promise<string | null> {
    const trashId = await this.trashSidecarOf(row, by)
    const referrers = this.store.referrers(row.id)
    this.store.deleteAsset(row.id)
    this.core.integrity.removeAsset(row.id)
    this.core.hooks.forget(row.id)
    this.core.hooks.removeDocs([row.id])
    this.core.hooks.changed([row.path], by, 'untrack')
    await this.core.integrity.refresh(referrers)
    this.emit('asset.removed', { id: row.id, reason: 'untracked' })
    // the file is still there: the next scan sees it again, as a file nobody said anything about
    this.scanAfterWrite({ folder: dirOf(row.path), recursive: false })
    return trashId
  }

  /**
   * Move an asset's .bmeta to the trash (restorable). When the index knows a .bmeta the disk no longer has, the
   * index copy is written out first, so the information still ends up in the trash instead of nowhere.
   */
  private async trashSidecarOf(row: AssetRow, by: string): Promise<string | null> {
    if (!row.sidecar) return null
    if (!(await this.fs.exists(row.path + SIDECAR_SUFFIX))) await this.fs.writeSidecar(row.path, this.store.meta(row))
    return this.trashLoose(row.path + SIDECAR_SUFFIX, by, { kind: 'sidecar', assetId: row.id })
  }

  /** Scanner hook: assets with a .bmeta now matched by an ignore rule (inside the scan's lock). */
  private async letGoIgnored(ids: Guid[]): Promise<void> {
    for (const id of ids) {
      const row = this.store.row(id)
      if (!row) continue
      let trashId: string | null = null
      try { trashId = await this.trashSidecarOf(row, SCANNER_ACTOR) } catch (e) { this.log.warn('could not move the .bmeta of an ignored file to the trash', { path: row.path, error: String(e) }); continue }
      const referrers = this.store.referrers(id)
      this.store.deleteAsset(id)
      this.core.integrity.removeAsset(id)
      this.core.hooks.forget(id)
      this.core.hooks.removeDocs([id])
      await this.core.integrity.refresh(referrers)
      this.log.info('asset now ignored: its .bmeta went to the trash, the file stays', { id, path: row.path, trashId })
      this.emit('asset.removed', { id, reason: 'untracked' })
    }
  }

  /* ───────────── trash ───────────── */

  async trash(id: Guid, opts: { force: boolean }, ctx: CallContext): Promise<{ trashId: string; referrers: Guid[] }> {
    return this.write('asset.trash', ctx, { id, force: opts.force }, async () => {
      const row = this.row404(id)
      const referrers = this.store.referrers(id)
      if (referrers.length && !opts.force) {
        throw new CoreError('referenced', `该资产被 ${referrers.length} 个资产引用`, { referrers })
      }
      const trashId = await this.trashRow(row, this.actor(ctx), {})
      this.emit('trash.updated', {})
      return { trashId, referrers }
    })
  }

  /** Move an asset (file + sidecar) into `.bowerbird/trash/<id>/`; relations to it become broken. */
  private async trashRow(row: AssetRow, by: string, o: { batch?: string; recordOnly?: boolean }): Promise<string> {
    const meta = this.store.meta(row)
    const trashId = newId()
    const name = row.name
    const originalPath = this.store.originalPath(row.id) ?? row.path
    const fileThere = !o.recordOnly && !row.missing && !!(await this.fs.stat(row.path))
    if (fileThere) await this.fs.moveIntoTrash(row.path, trashId, name)
    if (await this.fs.exists(row.path + SIDECAR_SUFFIX)) await this.fs.moveIntoTrash(row.path + SIDECAR_SUFFIX, trashId, name + SIDECAR_SUFFIX)
    else await this.fs.writeAbsAtomic(this.fs.trashAbs(trashId, name + SIDECAR_SUFFIX), serializeBmeta(meta))
    const info: TrashInfo = {
      bb: FORMAT_VERSION, id: trashId, assetId: row.id, name, originalPath, deletedAt: new Date(this.now()).toISOString(), deletedBy: by,
      ...(row.bundle ? { bundle: true } : {}), ...(o.batch ? { batch: o.batch } : {}), ...(fileThere ? {} : { recordOnly: true }),
      // a file the library only saw: restoring it brings the file back, never a .bmeta it did not have (ADR-067)
      ...(row.sidecar ? {} : { seen: true })
    }
    await this.fs.writeTrashInfo(info)
    this.store.insertTrash(info, meta, row.size, row.format)
    this.core.integrity.removeAsset(row.id)
    this.store.deleteAsset(row.id)
    this.store.deleteFile(row.path)
    this.core.hooks.forget(row.id)
    this.core.hooks.removeDocs([row.id])
    await this.core.integrity.refresh([row.id])
    this.core.hooks.changed([row.path], by, 'trash')
    this.emit('asset.removed', { id: row.id, reason: 'trash' })
    return trashId
  }

  /**
   * Move one loose file (an orphan or conflict-copy sidecar, a folder's `_folder.bmeta`) into its own trash entry with
   * info.json, so nothing is ever deleted outright (ADR-047). `kind` tells restore what it is.
   */
  private async trashLoose(rel: string, by: string, o: { kind: 'sidecar' | 'folder-meta'; assetId?: Guid; batch?: string }): Promise<string> {
    const trashId = newId()
    const name = baseOf(rel)
    let meta: Bmeta | null = null
    if (o.kind === 'sidecar') { const r = await this.fs.readSidecarAbs(this.fs.absolute(rel)); if (r?.ok) meta = r.meta }
    await this.fs.moveIntoTrash(rel, trashId, name)
    this.core.hooks.changed([rel], this.core.op?.actor ?? SCANNER_ACTOR, this.core.op?.name ?? 'trash')
    const info = {
      bb: FORMAT_VERSION, id: trashId, assetId: o.assetId ?? meta?.id ?? newId(), name, originalPath: rel,
      deletedAt: new Date(this.now()).toISOString(), deletedBy: by, recordOnly: true, kind: o.kind, ...(o.batch ? { batch: o.batch } : {})
    } as TrashInfo
    await this.fs.writeTrashInfo(info)
    this.store.insertTrash(info, meta, 0, o.kind === 'folder-meta' ? 'folder-meta' : 'unknown')
    this.log.info('moved to trash', { path: rel, trashId, kind: o.kind })
    return trashId
  }

  async trashList(): Promise<{ items: TrashItem[]; trashDays: number }> {
    await this.purgeExpired()
    const days = this.settings().trashDays ?? 7
    const items: TrashItem[] = this.store.trashRows().filter(t => (JSON.parse(t.info_json) as { kind?: string }).kind !== 'folder-meta').map(t => {
      const info = JSON.parse(t.info_json) as TrashInfo
      const meta = t.meta_json ? JSON.parse(t.meta_json) as Bmeta : null
      const age = this.now() - Date.parse(t.deleted_at)
      const referencedBy = (this.store.prep('SELECT COUNT(DISTINCT from_id) n FROM relations WHERE to_id = ?').get(t.asset_id) as { n: number }).n
      return {
        id: t.id, assetId: t.asset_id, name: t.name, originalPath: t.original_path, folder: dirOf(t.original_path), format: t.format,
        stage: meta?.stage ?? 'production', review: meta ? effectiveReview(meta) : 'pending', size: t.size, thumbnail: null,
        deletedAt: t.deleted_at, deletedBy: t.deleted_by, daysLeft: Math.max(0, Math.ceil((days * DAY - age) / DAY)), referencedBy,
        recordOnly: !!info.recordOnly, ...(info.batch ? { batch: info.batch } : {})
      }
    })
    return { items, trashDays: days }
  }

  /** `rename` omitted = rename automatically when the place is taken; `false` = answer `conflict` instead. */
  async restore(trashId: string, rename: boolean | undefined, ctx: CallContext): Promise<{ asset: AssetSummary; renamedTo: string | null }> {
    return this.write('trash.restore', ctx, { trashId, rename }, async () => {
      const r = await this.doRestore(trashId, rename, this.actor(ctx))
      this.emit('trash.updated', {})
      return r
    })
  }

  private async doRestore(trashId: string, rename: boolean | undefined, by: string): Promise<{ asset: AssetSummary; renamedTo: string | null }> {
    const t = this.store.trashRow(trashId)
    if (!t) throw new CoreError('not_found', `回收站里没有这一项：${trashId}`, { trashId })
    const info = JSON.parse(t.info_json) as TrashInfo & { kind?: string }
    if (info.kind === 'sidecar' || info.kind === 'folder-meta') return this.restoreLoose(t.id, info, rename)
    let meta: Bmeta | null = t.meta_json ? JSON.parse(t.meta_json) as Bmeta : null
    const sc = await this.fs.readSidecarAbs(this.fs.trashAbs(trashId, info.name + SIDECAR_SUFFIX))
    if (sc?.ok) meta = sc.meta
    if (!meta) throw new CoreError('internal', '回收站里的记录损坏了')
    if (this.store.row(meta.id)) throw new CoreError('conflict', '资产库里已经有同一个资产', { id: meta.id })
    let target = info.originalPath
    const dir = dirOf(target)
    const taken = (n: string) => { const p = joinPath(dir, n); return !!this.store.rowByPath(p) || this.existsSync(p) || this.existsSync(p + SIDECAR_SUFFIX) }
    let renamedTo: string | null = null
    if (taken(baseOf(target))) {
      const suggested = nextFreeName(baseOf(target), taken)
      if (rename === false) throw new CoreError('conflict', `${dir || '根目录'} 里已经有一个同名文件`, { path: target, suggested })
      target = joinPath(dir, suggested)
      renamedTo = suggested
    }
    const hasFile = !info.recordOnly && (await this.fs.trashEntryExists(trashId, info.name))
    const seenOnly = !!(info as { seen?: boolean }).seen && hasFile
    if (hasFile) await this.fs.moveOutOfTrash(trashId, info.name, target)
    if (seenOnly) { /* no .bmeta: the file comes back as it was, only seen */ }
    else if (await this.fs.trashEntryExists(trashId, info.name + SIDECAR_SUFFIX)) await this.fs.moveOutOfTrash(trashId, info.name + SIDECAR_SUFFIX, target + SIDECAR_SUFFIX)
    else await this.fs.writeSidecar(target, meta)
    await this.fs.purgeTrashEntry(trashId)
    this.store.deleteTrash(trashId)
    if (seenOnly) await this.core.indexOnly(target, meta)
    else await this.core.indexMeta(target, meta, { missing: !hasFile })
    await this.core.integrity.refresh([meta.id])
    if (hasFile) this.core.hooks.enqueue(meta.id, 'all', { reason: 'restored' })
    this.core.hooks.changed([target], by, 'restore')
    this.emit('asset.created', { id: meta.id, path: target, by })
    // folder settings deleted with the same folder come back with it
    if (info.batch) {
      for (const fm of this.store.trashRows()) {
        const fi = JSON.parse(fm.info_json) as TrashInfo & { kind?: string }
        if (fi.kind !== 'folder-meta' || fi.batch !== info.batch || !isUnder(dirOf(target), dirOf(fi.originalPath))) continue
        if (await this.fs.exists(fi.originalPath)) continue
        await this.fs.moveOutOfTrash(fm.id, fi.name, fi.originalPath)
        await this.fs.purgeTrashEntry(fm.id)
        this.store.deleteTrash(fm.id)
        this.emit('folder.updated', { path: dirOf(fi.originalPath) })
      }
    }
    return { asset: summaryOf(this.vd, meta.id)!, renamedTo }
  }

  /** Restore a loose trash entry (sidecar copy, folder settings); the scanner then looks at it again. */
  private async restoreLoose(trashId: string, info: TrashInfo, rename: boolean | undefined): Promise<{ asset: AssetSummary; renamedTo: string | null }> {
    let target = info.originalPath
    const dir = dirOf(target)
    const kind = (info as { kind?: string }).kind
    if (kind === 'sidecar' && target.endsWith(SIDECAR_SUFFIX)) {
      // the .bmeta of a file an ignore rule matches would only be let go again by the next scan (ADR-067)
      const assetPath = target.slice(0, -SIDECAR_SUFFIX.length)
      const st = await this.fs.stat(assetPath)
      if (st && this.fs.ignored(assetPath, st.isDir)) throw new CoreError('conflict', `${baseOf(assetPath)} 现在被忽略规则跳过，先改 .bbignore 再恢复`, { path: assetPath })
    }
    let renamedTo: string | null = null
    if (this.existsSync(target)) {
      if (rename === false) throw new CoreError('conflict', `${dir || '根目录'} 里已经有一个同名文件`, { path: target })
      const { base, ext } = splitName(baseOf(target))
      // keep `.bmeta` last so the copy stays a sidecar-shaped name
      const stem = ext === SIDECAR_SUFFIX ? base : baseOf(target)
      const suffix = ext === SIDECAR_SUFFIX ? SIDECAR_SUFFIX : ''
      for (let n = 1; ; n++) { const c = joinPath(dir, `${stem} (${n})${suffix}`); if (!this.existsSync(c)) { target = c; break } }
      renamedTo = baseOf(target)
    }
    await this.fs.moveOutOfTrash(trashId, info.name, target)
    await this.fs.purgeTrashEntry(trashId)
    this.store.deleteTrash(trashId)
    this.scanAfterWrite({ folder: dir, recursive: false })
    const owner = this.store.row(info.assetId)
    const asset: AssetSummary = owner ? summaryOf(this.vd, owner.id)! : {
      id: info.assetId, name: baseOf(target), path: target, format: 'unknown', plugin: null, stage: 'production', review: 'pending', tags: [],
      autoTags: [], description: null, flags: [], thumbnail: null, thumbState: 'none', aspect: null, badge: null, issueLevel: null, issueCount: 0,
      size: 0, modified: info.deletedAt, created: info.deletedAt, createdBy: info.deletedBy, bundle: false, auxiliary: false, memberCount: 0,
      cellText: null, missingPlugin: null
    }
    return { asset, renamedTo }
  }

  async purge(trashId: string, ctx: CallContext): Promise<void> {
    await this.write('trash.purge', ctx, { trashId }, async () => {
      if (!this.store.trashRow(trashId)) throw new CoreError('not_found', `回收站里没有这一项：${trashId}`, { trashId })
      await this.purgeEntry(trashId)
      this.emit('trash.updated', {})
    })
  }

  async emptyTrash(ctx: CallContext): Promise<void> {
    await this.write('trash.empty', ctx, {}, async () => {
      for (const t of this.store.trashRows()) await this.purgeEntry(t.id)
      this.emit('trash.updated', {})
    })
  }

  private async purgeEntry(trashId: string): Promise<void> {
    const t = this.store.trashRow(trashId)
    if (t?.meta_json) {
      const meta = JSON.parse(t.meta_json) as Bmeta
      if (meta.thumbnail) await this.fs.removeThumb(meta.thumbnail)
    }
    await this.fs.purgeTrashEntry(trashId)
    this.store.deleteTrash(trashId)
    if (t) this.emit('asset.removed', { id: t.asset_id, reason: 'purged' })
  }

  /** Entries older than `settings.trashDays` are removed for good. */
  async purgeExpired(): Promise<number> {
    if (!this.core.lib || this.readOnly) return 0
    const days = this.settings().trashDays ?? 7
    const expired = this.store.trashRows().filter(t => this.now() - Date.parse(t.deleted_at) >= days * DAY)
    if (!expired.length) return 0
    await this.core.lock.run(async () => {
      for (const t of expired) await this.purgeEntry(t.id)
      this.log.info('write', { op: 'trash.expire', actor: SCANNER_ACTOR, library: this.id, count: expired.length })
    })
    this.emit('trash.updated', {})
    return expired.length
  }

  /* ───────────── content ───────────── */

  async replaceContent(id: Guid, file: { name: string; data: Uint8Array } | { name: string; tmpPath: string }, note: string | undefined, ctx: CallContext): Promise<AssetDetail> {
    return this.write('asset.content', ctx, { id }, async () => {
      await this.doReplaceContent(this.row404(id), fileOf(file)!, note, this.actor(ctx))
      return this.detail(id)
    })
  }

  /**
   * Replace content (sync-and-integrity.md「替换内容」): GUID kept, new hash and version record, review back to pending
   * (effective), pipeline reruns, source downstream becomes stale, uses referrers redo thumbnails.
   */
  private async doReplaceContent(rowIn: AssetRow, file: UploadSource, note: string | undefined, by: string, extra?: { restoredFrom?: number }): Promise<boolean> {
    if (rowIn.bundle) throw new CoreError('validation_failed', '包式资产不能用单个文件替换内容')
    // ADR-046: before touching the file, take in an outside edit of the sidecar (or stop at an unreadable one)
    const { row, meta: freshMeta } = await this.freshRow(rowIn)
    if (file.kind === 'bytes') await this.fs.writeFile(row.path, file.data)
    else if (file.kind === 'path') await this.fs.copyIn(file.abs, row.path)
    else throw new CoreError('validation_failed', '替换内容需要上传文件')
    const st = await this.fs.contentStat(row.path)
    const hash = await this.fs.hash(row.path)
    const meta = freshMeta
    if (hash === meta.hash && !extra?.restoredFrom) {
      await this.core.indexMeta(row.path, meta, { missing: false })
      return false
    }
    const at = nowIso()
    const next: Bmeta = {
      ...meta, hash,
      versions: [...(meta.versions ?? []), { hash, size: st?.size ?? 0, at, by, ...(note ? { note } : {}), ...(extra?.restoredFrom ? { restoredFrom: extra.restoredFrom } : {}) }],
      modified: { at, by }
    }
    await this.core.writeMeta(row.path, next, { missing: false })
    this.contentDownstream(row.id)
    await this.core.integrity.refresh([row.id])
    this.core.hooks.enqueue(row.id, 'all', { priority: 1, reason: 'content' })
    this.core.hooks.changed([row.path], by, 'content')
    this.emit('asset.updated', { id: row.id, fields: ['content'], by, version: next.versions!.length })
    return true
  }

  private contentDownstream(id: Guid): void {
    for (const r of this.store.incoming(id)) {
      if (r.type === 'uses') this.core.hooks.enqueue(r.from_id, ['thumbnail', 'summary'], { reason: 'dependency changed' })
      if (r.type === 'belongs') this.core.hooks.enqueue(r.from_id, ['validate'], { reason: 'design object changed' })
    }
  }

  /* ───────────── move & copy ───────────── */

  async move(id: Guid, to: { folder?: string; name?: string; onConflict?: OnConflict }, ctx: CallContext): Promise<AssetDetail> {
    return this.write('asset.move', ctx, { id, ...to }, async () => {
      await this.doMove(id, to, this.actor(ctx))
      return this.detail(id)
    })
  }

  private async doMove(id: Guid, to: { folder?: string; name?: string; onConflict?: OnConflict }, by: string): Promise<boolean> {
    const row = this.row404(id)
    const folder = to.folder !== undefined ? normRel(to.folder) : row.folder
    const name = to.name !== undefined ? checkName(to.name) : row.name
    if (isUnder(folder, '.bowerbird')) throw new CoreError('validation_failed', '不能移到 .bowerbird 里')
    if (row.bundle && isUnder(folder, row.path)) throw new CoreError('validation_failed', '不能把包式资产移进它自己')
    for (const a of ancestors(folder)) if (a && this.store.rowByPath(a)?.bundle) throw new CoreError('validation_failed', '不能移进包式资产里')
    let target = joinPath(folder, name)
    if (target === row.path) return false
    if (this.fs.ignored(target, !!row.bundle)) throw new CoreError('validation_failed', `这个名字会被忽略规则跳过：${name}`)
    const taken = (p: string) => (!!this.store.rowByPath(p) && this.store.rowByPath(p)!.id !== id) ||
      (p.toLowerCase() !== row.path.toLowerCase() && (this.existsSync(p) || this.existsSync(p + SIDECAR_SUFFIX)))
    if (taken(target)) {
      if (!to.onConflict) throw new CoreError('conflict', `${folder || '根目录'} 里已经有 ${name}`, { path: target, existing: this.store.rowByPath(target)?.id ?? null })
      if (to.onConflict === 'skip') return false
      if (to.onConflict === 'keep-both') target = joinPath(folder, nextFreeName(name, n => taken(joinPath(folder, n))))
      else {
        const other = this.store.rowByPath(target)
        if (!other) throw new CoreError('conflict', `${name} 是一个还没登记的文件，不会覆盖它`, { path: target, existing: null })
        const refs = this.store.referrers(other.id).filter(r => r !== id)
        if (refs.length) throw new CoreError('referenced', `${name} 被 ${refs.length} 个资产引用`, { referrers: refs })
        await this.trashRow(other, by, {})
        this.emit('trash.updated', {})
      }
    }
    if (!row.missing) await this.fs.move(row.path, target)
    if (await this.fs.exists(row.path + SIDECAR_SUFFIX)) await this.fs.move(row.path + SIDECAR_SUFFIX, target + SIDECAR_SUFFIX)
    this.store.updatePath(id, target)
    this.store.renameFiles(row.path, target)
    const sc = await this.fs.stat(target + SIDECAR_SUFFIX)
    if (sc) this.store.setStat(id, { metaMtimeMs: sc.mtimeMs })
    if (row.missing) await this.core.integrity.refresh([id])
    this.core.hooks.enqueue(id, ['index'], { reason: 'moved' })
    this.core.hooks.changed([row.path, target], by, 'move')
    this.emit('asset.updated', { id, fields: ['path'], by })
    return true
  }

  async copy(id: Guid, to: { folder?: string }, ctx: CallContext): Promise<CopyResponse> {
    return this.write('asset.copy', ctx, { id, folder: to.folder }, async () => {
      const by = this.actor(ctx)
      const row = this.row404(id)
      if (row.missing) throw new CoreError('validation_failed', '文件不见了，不能复制')
      const folder = to.folder !== undefined ? normRel(to.folder) : row.folder
      if (isUnder(folder, '.bowerbird') && folder !== '') throw new CoreError('validation_failed', '不能复制到 .bowerbird 里')
      if (ancestors(folder).some(a => a && this.fs.ignored(a, true))) throw new CoreError('validation_failed', `这个文件夹被忽略规则跳过了：${folder}`)
      for (const a of ancestors(folder)) if (a && this.store.rowByPath(a)?.bundle) throw new CoreError('validation_failed', '不能复制进包式资产里')
      const name = copyName(row.name, n => { const p = joinPath(folder, n); return !!this.store.rowByPath(p) || this.existsSync(p) || this.existsSync(p + SIDECAR_SUFFIX) })
      const target = joinPath(folder, name)
      await this.fs.copy(row.path, target)
      const st = await this.fs.contentStat(target)
      const { meta: orig } = await this.freshRow(row)
      const at = nowIso()
      const meta = this.core.copyMeta(orig, { hash: orig.hash, size: st?.size ?? row.size, by, at })
      if (orig.thumbnail) {
        // a manual thumbnail is part of what was copied
        try {
          const data = await fsp.readFile(this.fs.thumbAbs(orig.thumbnail))
          const thumb = `${meta.id}.webp`
          await this.fs.writeThumb(thumb, data)
          meta.thumbnail = thumb
        } catch { /* no thumbnail file */ }
      }
      await this.core.writeMeta(target, meta)
      await this.core.integrity.refresh([meta.id, id])
      this.core.hooks.enqueue(meta.id, 'all', { reason: 'copied' })
      this.core.hooks.changed([target], by, 'copy')
      this.emit('asset.created', { id: meta.id, path: target, by })
      const originalReferenced = this.store.referrers(id).some(r => r !== meta.id)
      return {
        asset: await this.detail(meta.id),
        name,
        originalReferenced,
        message: originalReferenced ? `已复制为 ${name}，原来的引用仍指向原件` : `已复制为 ${name}`
      }
    })
  }

  /* ───────────── review & AI tags ───────────── */

  async review(id: Guid, verdict: { status: ReviewStatus; note?: string; expectHash?: string }, ctx: CallContext): Promise<AssetDetail> {
    return this.write('asset.review', ctx, { id, status: verdict.status }, async () => {
      await this.doReview(id, verdict, this.actor(ctx))
      return this.detail(id)
    })
  }

  private async doReview(id: Guid, verdict: { status: ReviewStatus; note?: string; expectHash?: string }, by: string): Promise<void> {
    const { row, meta } = await this.current(id)
    if (verdict.status === 'rejected' && !verdict.note?.trim()) throw new CoreError('validation_failed', '打回需要写意见')
    if (verdict.expectHash) {
      // ADR-038: someone else reviewed this content already, or the content changed
      if (verdict.expectHash !== meta.hash) throw new CoreError('conflict', '内容已经变了', { hash: meta.hash })
      if (effectiveReview(meta) !== 'pending' && meta.review?.by !== by) throw new CoreError('conflict', `${meta.review?.by ?? '别人'} 已经审过了`, { review: meta.review })
    }
    const at = nowIso()
    const review = verdict.status === 'exempt'
      ? { status: 'exempt' as const, by, at, ...(verdict.note ? { note: verdict.note } : {}) }
      : { status: verdict.status, hash: meta.hash, by, at, ...(verdict.note ? { note: verdict.note } : {}) }
    await this.save(row, { ...meta, review }, by)
    this.core.hooks.changed([row.path], by, 'review')
    this.emit('asset.updated', { id, fields: ['review'], by })
  }

  async acceptAutoTags(id: Guid, tags: string[], ctx: CallContext): Promise<AssetDetail> {
    return this.write('asset.tags.accept', ctx, { id, tags }, async () => {
      await this.moveAutoTags(id, tags.map(normalizeTag), true, this.actor(ctx))
      return this.detail(id)
    })
  }

  async dismissAutoTags(id: Guid, tags: string[], ctx: CallContext): Promise<AssetDetail> {
    return this.write('asset.tags.dismiss', ctx, { id, tags }, async () => {
      await this.moveAutoTags(id, tags.map(normalizeTag), false, this.actor(ctx))
      return this.detail(id)
    })
  }

  /** Adopt (into `tags`) or drop AI tags; null = all of them. Returns whether anything changed. */
  private async moveAutoTags(id: Guid, tags: string[] | null, adopt: boolean, by: string): Promise<boolean> {
    const { row, meta } = await this.current(id)
    const auto = uniqTags(meta.auto?.tags)
    const pick = tags ? auto.filter(t => tags.includes(t)) : auto
    if (!pick.length) return false
    const next: Bmeta = { ...meta, auto: { ...(meta.auto ?? {}), tags: auto.filter(t => !pick.includes(t)) } }
    if (!next.auto!.tags!.length) delete next.auto!.tags
    if (next.auto && !Object.keys(next.auto).length) delete next.auto
    if (adopt) next.tags = uniqTags([...(meta.tags ?? []), ...pick])
    await this.save(row, next, by)
    this.core.hooks.enqueue(id, ['index'], { reason: 'tags' })
    this.emit('asset.updated', { id, fields: adopt ? ['tags', 'auto'] : ['auto'], by })
    return true
  }

  /* ───────────── files ───────────── */

  async file(id: Guid): Promise<{ absPath: string; size: number; name: string; mime: string }> {
    const row = this.row404(id)
    if (row.missing) throw new CoreError('not_found', `文件不见了：${row.path}`, { path: row.path })
    if (row.bundle) {
      const meta = this.store.meta(row)
      const files = await this.fs.bundleFiles(row.path)
      const entry = bundleEntryOf(meta, files)
      if (!entry) throw new CoreError('not_found', '包式资产里没有文件')
      const f = files.find(x => x.path === entry)!
      return { absPath: this.fs.absolute(joinPath(row.path, entry)), size: f.size, name: baseOf(entry), mime: mimeOf(entry) }
    }
    const st = await this.fs.stat(row.path)
    if (!st) throw new CoreError('not_found', `文件不见了：${row.path}`, { path: row.path })
    return { absPath: this.fs.absolute(row.path), size: st.size, name: row.name, mime: mimeOf(row.name) }
  }

  async slotFile(id: Guid, slot: string): Promise<{ absPath: string; size: number; name: string; mime: string } | null> {
    const meta = this.store.meta(this.row404(id))
    if (!isSafeRelPath(slot)) return null
    const rel = (meta.relations ?? []).find(r => r.slot === slot && r.type === 'uses') ?? (meta.relations ?? []).find(r => r.slot === slot)
    if (!rel) return null
    const target = this.store.row(rel.to)
    if (!target || target.missing) return null
    if (target.bundle) {
      // ADR-041: the slot names a file inside the bundle
      const files = await this.fs.bundleFiles(target.path)
      const f = files.find(x => x.path === slot) ?? files.find(x => baseOf(x.path) === baseOf(slot))
      return f ? this.bundleFile(target.id, f.path) : null
    }
    return this.file(target.id).catch(() => null)
  }

  async bundleFile(id: Guid, inner: string): Promise<{ absPath: string; size: number; name: string; mime: string } | null> {
    const row = this.row404(id)
    if (!row.bundle) return null
    let rel: string
    try { rel = normRel(inner) } catch { return null }
    if (!rel) return null
    const p = joinPath(row.path, rel)
    const st = await this.fs.stat(p)
    if (!st || st.isDir) return null
    return { absPath: this.fs.absolute(p), size: st.size, name: baseOf(rel), mime: mimeOf(rel) }
  }

  async open(id: Guid, ctx: CallContext): Promise<void> {
    if (!ctx.isLocal) throw new CoreError('not_local', '只能在服务所在的电脑上打开源文件')
    const row = this.row404(id)
    if (row.missing) throw new CoreError('not_found', `文件不见了：${row.path}`)
    ;(this.o.opener ?? defaultOpener)(this.fs.absolute(row.path), false)
  }

  async reveal(id: Guid | null, ctx: CallContext): Promise<void> {
    if (!ctx.isLocal) throw new CoreError('not_local', '只能在服务所在的电脑上显示源文件')
    const target = id ? this.fs.absolute(this.row404(id).path) : this.paths.root
    ;(this.o.opener ?? defaultOpener)(target, true)
  }

  async thumbnailFile(id: Guid, variant: ThumbVariant): Promise<string | null> {
    const row = this.row404(id)
    const meta = this.store.meta(row)
    if (meta.thumbnail && (variant === 'thumb' || variant === 'preview' || variant === 'poster')) {
      const abs = this.fs.thumbAbs(meta.thumbnail)
      if (await this.fs.thumbMtime(meta.thumbnail) !== null) return abs
    }
    return this.pipeline?.thumbnailFile(id, variant) ?? null
  }

  async setManualThumbnail(id: Guid, image: Uint8Array, ctx: CallContext): Promise<AssetDetail> {
    return this.write('asset.thumbnail.set', ctx, { id }, async () => {
      const by = this.actor(ctx)
      const { row, meta } = await this.current(id)
      const name = `${id}.webp`
      await this.fs.writeThumb(name, image)
      await this.save(row, { ...meta, thumbnail: name }, by)
      await this.core.integrity.refresh([id], { expand: false })
      this.emit('asset.thumbnail', { id, url: this.thumbUrl(id, `m${this.store.row(id)?.seq ?? 0}`) })
      this.emit('asset.updated', { id, fields: ['thumbnail'], by })
      return this.detail(id)
    })
  }

  async clearManualThumbnail(id: Guid, ctx: CallContext): Promise<AssetDetail> {
    return this.write('asset.thumbnail.clear', ctx, { id }, async () => {
      await this.doClearThumbnail(id, this.actor(ctx))
      return this.detail(id)
    })
  }

  private async doClearThumbnail(id: Guid, by: string): Promise<void> {
    const { row, meta } = await this.current(id)
    if (!meta.thumbnail) return
    await this.fs.removeThumb(meta.thumbnail)
    const next: Bmeta = { ...meta }
    delete next.thumbnail
    await this.save(row, next, by)
    await this.core.integrity.refresh([id], { expand: false })
    this.core.hooks.enqueue(id, ['thumbnail'], { reason: 'manual thumbnail cleared' })
    const r = this.store.row(id)
    this.emit('asset.thumbnail', { id, url: r?.thumb_state === 'ready' ? this.thumbUrl(id, r.thumb_key) : null })
    this.emit('asset.updated', { id, fields: ['thumbnail'], by })
  }

  /* ───────────── summary, lineage, versions ───────────── */

  async summary(id: Guid): Promise<SummaryResponse> {
    const row = this.row404(id)
    const pipe = this.pipeline as (Pipeline & { summaryText?: (id: Guid) => Promise<string | null>; summaryImage?: (id: Guid) => { variant: ThumbVariant; path: string } | null }) | null
    let text = ''
    try { text = (await pipe?.summaryText?.(id)) ?? '' } catch { text = '' }
    const format = row.format !== 'unknown' ? this._plugins?.format(row.format) : null
    if (!text && format?.handler?.summarize && !row.missing) {
      const af = await this.assetFile(id)
      if (af) {
        try { text = (await this._plugins!.invoke(format.pluginId, 'summarize', () => format.handler!.summarize!(af))).text } catch (e) {
          this.log.warn('summarize failed', { id, error: String(e) })
        }
      }
    }
    if (!text) {
      const tech = this.store.tech(id)
      const facts = Object.entries(tech).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join('，')
      text = [row.name, facts].filter(Boolean).join('：')
    }
    let image: string | null = null
    const img = pipe?.summaryImage?.(id) ?? null
    if (img) {
      // cache files are named after their key: `<stage>/<k0k1>/<key>.<ext>`
      const file = path.basename(img.path)
      const key = file.includes('.') ? file.slice(0, file.lastIndexOf('.')) : file
      image = this.variantUrl(id, img.variant, key || null)
    }
    if (!image && row.thumb_manual) image = this.thumbUrl(id, `m${row.seq}`)
    const mode = format?.contribution.thumbnail ?? 'none'
    return { text, image, ...(!image && mode !== 'none' ? { imageMissingReason: SUMMARY_IMAGE_MISSING } : {}) }
  }

  async lineage(id: Guid, q: LineageQuery): Promise<Lineage> {
    this.row404(id)
    const types = q.types?.length ? q.types : ['source', 'reference']
    const depth = q.depth ?? 5
    const direction = q.direction ?? 'up'
    const edges = new Map<string, LineageEdge>()
    const seen = new Set<string>([id])
    const walk = (up: boolean) => {
      let frontier = [id]
      for (let d = 0; d < depth && frontier.length; d++) {
        const next: string[] = []
        for (const n of frontier) {
          const rows = up ? this.store.outgoing(n) : this.store.incoming(n)
          for (const r of rows) {
            if (!types.includes(r.type)) continue
            const key = `${r.from_id}\u0000${r.type}\u0000${r.to_id}\u0000${r.slot}`
            if (!edges.has(key)) edges.set(key, {
              type: r.type, from: r.from_id, to: r.to_id, ...(r.slot ? { slot: r.slot } : {}), ...(r.note ? { note: r.note } : {}),
              broken: !!r.broken || !this.store.row(r.to_id), stale: !!r.stale, ...(r.role ? { role: r.role } : {})
            })
            const other = up ? r.to_id : r.from_id
            if (seen.has(other)) continue
            seen.add(other)
            if (this.store.row(other)) next.push(other)
          }
        }
        frontier = next
      }
    }
    if (direction === 'up' || direction === 'both') walk(true)
    if (direction === 'down' || direction === 'both') walk(false)
    const existing = [...seen].filter(x => this.store.row(x))
    const missing = [...seen].filter(x => !this.store.row(x)).map(x => { const t = this.store.trashByAsset(x); return { id: x, name: t?.name ?? null, inTrash: !!t } })
    const provenance: Record<string, Provenance> = {}
    for (const x of existing) { const p = this.store.metaOf(x)?.provenance; if (p) provenance[x] = p }
    return { center: id, nodes: summaries(this.vd, existing), missing, edges: [...edges.values()], provenance }
  }

  async versions(id: Guid): Promise<VersionsResponse> {
    const row = this.row404(id)
    const meta = this.store.meta(row)
    const vs = this._plugins?.versionStore() ?? null
    const list = meta.versions ?? []
    const out: VersionsResponse['versions'] = []
    for (let i = 0; i < list.length; i++) {
      const v = list[i]!
      let hasContent = false
      if (vs) {
        try { hasContent = await this._plugins!.invoke(vs.pluginId, 'versionStore.has', () => vs.store.has(row.path, v.hash)) } catch { hasContent = false }
      }
      const restoredFrom = typeof (v as Record<string, unknown>).restoredFrom === 'number' ? (v as Record<string, unknown>).restoredFrom as number : undefined
      out.push({ ...v, n: i + 1, current: i === list.length - 1, hasContent, ...(restoredFrom ? { restoredFrom } : {}) })
    }
    return { versions: out, store: vs ? { id: vs.pluginId, displayName: vs.displayName } : null }
  }

  async versionFile(id: Guid, hash: string): Promise<{ stream: ReadableStream; name: string; mime: string }> {
    const row = this.row404(id)
    const vs = this._plugins?.versionStore()
    if (!vs) throw new CoreError('unsupported', '读取旧版本的内容需要版本插件')
    const points = await this._plugins!.invoke(vs.pluginId, 'versionStore.history', () => vs.store.history(row.path))
    const point = points.find(p => p.hash === hash)
    if (!point) throw new CoreError('not_found', '版本插件里没有这一版的内容', { hash })
    const stream = await this._plugins!.invoke(vs.pluginId, 'versionStore.read', () => vs.store.read(row.path, point.id))
    return { stream, name: row.name, mime: mimeOf(row.name) }
  }

  async restoreVersion(id: Guid, hash: string, ctx: CallContext): Promise<{ asset: AssetDetail; version: number; staleDownstream: number }> {
    const vs = this._plugins?.versionStore()
    if (!vs) throw new CoreError('unsupported', '恢复旧版本需要版本插件')
    const row = this.row404(id)
    const n = versionNumberOf(this.store.meta(row).versions ?? [], hash)
    if (!n) throw new CoreError('not_found', '没有这一版', { hash })
    const { stream } = await this.versionFile(id, hash)
    const data = new Uint8Array(await new Response(stream).arrayBuffer())
    return this.write('asset.version.restore', ctx, { id, hash }, async () => {
      await this.doReplaceContent(this.row404(id), { kind: 'bytes', name: row.name, data }, `恢复为 v${n}`, this.actor(ctx), { restoredFrom: n })
      const meta = this.store.metaOf(id)!
      const staleDownstream = this.store.incoming(id).filter(r => this.core.tracksVersion(r.type)).length
      return { asset: await this.detail(id), version: meta.versions?.length ?? 0, staleDownstream }
    })
  }

  /* ───────────── batch ───────────── */

  async batch(req: BatchRequest, ctx: CallContext): Promise<BatchResponse> {
    const ids = req.ids ?? (req.query ? await this.requireQuery().ids(this.resolveBelongsName(req.query), 10_000) : [])
    const updated: Guid[] = []
    const failed: BatchResponse['failed'] = []
    const by = this.actor(ctx)
    await this.write('asset.batch', ctx, { count: ids.length, ops: Object.keys(req.patch) }, async () => {
      const p = req.patch
      for (const id of ids) {
        try {
          // An asset only counts as updated when one of the ops did something: a move skipped on a name
          // clash (onConflict 'skip') or onto its own path is neither updated nor failed.
          let did = false
          if (p.tags || p.stage) { await this.doPatch(id, { ...(p.tags ? { tags: p.tags } : {}), ...(p.stage ? { stage: p.stage } : {}) }, ctx); did = true }
          if (p.review) { await this.doReview(id, p.review, by); did = true }
          if (p.move && await this.doMove(id, { folder: p.move.folder, onConflict: p.move.onConflict }, by)) did = true
          if (p.trash) {
            const row = this.row404(id)
            const refs = this.store.referrers(id).filter(r => !ids.includes(r))
            if (refs.length && !p.force) throw new CoreError('referenced', `该资产被 ${refs.length} 个资产引用`, { referrers: refs })
            await this.trashRow(row, by, {})
            did = true
          }
          if (did) updated.push(id)
        } catch (e) {
          const err = e instanceof CoreError ? e : new CoreError('internal', String((e as Error)?.message ?? e))
          failed.push({ id, code: err.code, message: err.message })
        }
      }
      if (p.trash) this.emit('trash.updated', {})
    })
    return { updated, failed }
  }

  /* ───────────── relations ───────────── */

  /** Adding `from --source--> to` must not close a loop (data-model.md「不允许来源关系成环」). */
  private assertNoCycle(from: Guid, to: Guid): void {
    const name = (i: string) => ({ id: i, name: this.store.row(i)?.name ?? i })
    if (from === to) throw new CoreError('cycle', '来源关系不能指向自己', { path: [name(from), name(from)] })
    const parent = new Map<string, string>()
    const queue = [to]
    const seen = new Set([to])
    while (queue.length) {
      const n = queue.shift()!
      for (const r of this.store.outgoing(n)) {
        if (r.type !== 'source' || seen.has(r.to_id)) continue
        parent.set(r.to_id, n)
        if (r.to_id === from) {
          // existing chain to → … → from, closed by the new edge from → to
          const chain = [from]
          let c = n
          while (c !== to) { chain.push(c); c = parent.get(c)! }
          chain.push(to)
          const loop = [from, ...chain.reverse()]
          throw new CoreError('cycle', '来源关系会成环', { path: loop.map(name) })
        }
        seen.add(r.to_id)
        queue.push(r.to_id)
      }
    }
  }

  async addRelation(id: Guid, rel: RelationInput, ctx: CallContext): Promise<AssetDetail> {
    return this.write('relation.add', ctx, { id, type: rel.type, to: rel.to }, async () => {
      const by = this.actor(ctx)
      const { row, meta } = await this.current(id)
      const [r] = this.prepareRelations([rel], id, true)
      const existing = meta.relations ?? []
      const clash = r!.slot
        ? existing.find(x => x.type === r!.type && x.slot === r!.slot)
        : existing.find(x => x.type === r!.type && x.to === r!.to && !x.slot)
      if (clash) throw new CoreError('conflict', '这条关系已经有了', { type: r!.type, to: clash.to, slot: r!.slot ?? null })
      await this.save(row, { ...meta, relations: [...existing, r!] }, by)
      await this.core.integrity.refresh([id])
      this.relationPipeline(id, r!.type)
      this.core.hooks.changed([row.path], by, 'relation')
      this.emit('relation.updated', { from: id, type: r!.type, to: r!.to, op: 'added' })
      return this.detail(id)
    })
  }

  private relationPipeline(id: Guid, type: string): void {
    if (type === 'uses') this.core.hooks.enqueue(id, ['thumbnail', 'summary'], { reason: 'relation changed' })
    else if (type === 'belongs') this.core.hooks.enqueue(id, ['validate'], { reason: 'design object changed' })
  }

  private findRelation(meta: Bmeta, rel: { type: string; to: Guid; slot?: string }): number {
    const list = meta.relations ?? []
    let i = list.findIndex(x => x.type === rel.type && x.to === rel.to && (x.slot ?? '') === (rel.slot ?? ''))
    if (i < 0 && rel.slot === undefined) {
      const c = list.map((x, k) => [x, k] as const).filter(([x]) => x.type === rel.type && x.to === rel.to)
      if (c.length === 1) i = c[0]![1]
    }
    return i
  }

  async removeRelation(id: Guid, rel: { type: string; to: Guid; slot?: string }, ctx: CallContext): Promise<AssetDetail> {
    return this.write('relation.remove', ctx, { id, ...rel }, async () => {
      await this.doRemoveRelation(id, rel, this.actor(ctx))
      return this.detail(id)
    })
  }

  private async doRemoveRelation(id: Guid, rel: { type: string; to: Guid; slot?: string }, by: string): Promise<void> {
    const { row, meta } = await this.current(id)
    const i = this.findRelation(meta, rel)
    if (i < 0) throw new CoreError('not_found', '没有这条关系', rel)
    const list = [...(meta.relations ?? [])]
    list.splice(i, 1)
    const next: Bmeta = { ...meta, relations: list }
    if (!list.length) delete next.relations
    await this.save(row, next, by)
    await this.core.integrity.refresh([id])
    this.relationPipeline(id, rel.type)
    this.core.hooks.changed([row.path], by, 'relation')
    this.emit('relation.updated', { from: id, type: rel.type, to: rel.to, op: 'removed' })
  }

  async replaceRelation(id: Guid, rel: { type: string; to: Guid; slot?: string; newTo: Guid }, ctx: CallContext): Promise<AssetDetail> {
    return this.write('relation.replace', ctx, { id, ...rel }, async () => {
      await this.doReplaceRelation(id, rel, this.actor(ctx))
      return this.detail(id)
    })
  }

  private async doReplaceRelation(id: Guid, rel: { type: string; to: Guid; slot?: string; newTo: Guid }, by: string): Promise<void> {
    const { row, meta } = await this.current(id)
    const i = this.findRelation(meta, rel)
    if (i < 0) throw new CoreError('not_found', '没有这条关系', { type: rel.type, to: rel.to, slot: rel.slot })
    if (rel.newTo === id) throw new CoreError('validation_failed', '资产不能和自己建立关系')
    const target = this.store.row(rel.newTo)
    if (!target) throw new CoreError('validation_failed', `新的对方不存在：${rel.newTo}`, { to: rel.newTo })
    if (rel.type === 'source') this.assertNoCycle(id, rel.newTo)
    const list = [...(meta.relations ?? [])]
    const old = list[i]!
    const replaced: Relation = { ...old, to: rel.newTo }
    if (this.core.tracksVersion(old.type)) replaced.toHash = target.hash
    if (list.some((x, k) => k !== i && x.type === replaced.type && x.to === replaced.to && (x.slot ?? '') === (replaced.slot ?? ''))) {
      list.splice(i, 1)
    } else list[i] = replaced
    await this.save(row, { ...meta, relations: list }, by)
    await this.core.integrity.refresh([id, rel.to])
    this.relationPipeline(id, old.type)
    this.core.hooks.changed([row.path], by, 'relation')
    this.emit('relation.updated', { from: id, type: old.type, to: rel.newTo, op: 'replaced' })
  }

  async acknowledgeUpstream(id: Guid, to: Guid, ctx: CallContext): Promise<AssetDetail> {
    return this.write('relation.acknowledge', ctx, { id, to }, async () => {
      await this.doAcknowledge(id, to, this.actor(ctx))
      return this.detail(id)
    })
  }

  private async doAcknowledge(id: Guid, to: Guid, by: string): Promise<void> {
    const { row, meta } = await this.current(id)
    const target = this.store.row(to)
    if (!target) throw new CoreError('not_found', `上游不存在：${to}`, { to })
    let changed = false
    const list = (meta.relations ?? []).map(r => {
      if (r.to === to && this.core.tracksVersion(r.type) && r.toHash !== target.hash) { changed = true; return { ...r, toHash: target.hash } }
      return r
    })
    if (!changed) {
      if (!(meta.relations ?? []).some(r => r.to === to && this.core.tracksVersion(r.type))) throw new CoreError('not_found', '没有指向它的来源关系', { to })
      return
    }
    await this.save(row, { ...meta, relations: list }, by)
    await this.core.integrity.refresh([id], { expand: false })
    this.emit('relation.updated', { from: id, type: 'source', to, op: 'acknowledged' })
  }

  async retarget(req: { from: Guid; to: Guid; types?: string[]; dryRun: boolean }, ctx: CallContext): Promise<RetargetResponse> {
    if (!this.store.row(req.to)) throw new CoreError('validation_failed', `新的对方不存在：${req.to}`, { to: req.to })
    const rows = this.store.incoming(req.from).filter(r => !req.types?.length || req.types.includes(r.type))
    const affected = rows.map(r => ({ assetId: r.from_id, assetName: this.store.row(r.from_id)?.name ?? r.from_id, type: r.type, ...(r.slot ? { slot: r.slot } : {}) }))
    if (req.dryRun) return { affected, applied: false }
    await this.write('relation.retarget', ctx, { from: req.from, to: req.to, count: rows.length }, async () => {
      const by = this.actor(ctx)
      const todo = rows.filter(r => r.from_id !== req.to)
      // all or nothing: check every change before touching anything
      for (const r of todo) if (r.type === 'source') this.assertNoCycle(r.from_id, req.to)
      const before = new Map<string, Bmeta>()
      for (const r of todo) if (!before.has(r.from_id)) before.set(r.from_id, (await this.current(r.from_id)).meta)
      try {
        for (const r of todo) await this.doReplaceRelation(r.from_id, { type: r.type, to: req.from, ...(r.slot ? { slot: r.slot } : {}), newTo: req.to }, by)
      } catch (e) {
        for (const [aid, m] of before) { const row = this.store.row(aid); if (row) await this.core.writeMeta(row.path, m, { missing: !!row.missing }) }
        await this.core.integrity.refresh([...before.keys()])
        throw e instanceof CoreError ? new CoreError(e.code, `${e.message}（已撤回，没有改动任何关系）`, { ...(e.details ?? {}), applied: 0 }) : e
      }
    })
    return { affected, applied: true }
  }

  /* ───────────── folders ───────────── */

  async folders(): Promise<FolderNode> {
    const counts = new Map<string, { n: number; m: string | null }>()
    for (const r of this.store.prep('SELECT folder, COUNT(*) n, MAX(modified_at) m FROM assets WHERE auxiliary = 0 GROUP BY folder').all() as Array<{ folder: string; n: number; m: string | null }>) {
      counts.set(r.folder, { n: r.n, m: r.m })
    }
    const bundles = new Map((this.store.prep('SELECT path, modified_at FROM assets WHERE bundle = 1').all() as Array<{ path: string; modified_at: string }>).map(r => [r.path, r.modified_at]))
    const build = async (rel: string, inherited: FolderNode['effectiveDefaults']): Promise<FolderNode> => {
      const fm = await this.fs.readFolderMeta(rel)
      const eff: FolderNode['effectiveDefaults'] = { ...inherited, from: { ...inherited.from } }
      const d = fm?.defaults
      if (d?.stage) { eff.stage = d.stage; eff.from.stage = rel }
      if (d?.review) { eff.review = d.review; eff.from.review = rel }
      if (d?.tags) { eff.tags = d.tags; eff.from.tags = rel }
      const children: FolderNode[] = []
      for (const e of (await this.fs.readdir(rel)).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (!e.isDirectory()) continue
        const p = joinPath(rel, e.name)
        if (this.fs.ignored(p, true) || (rel === '' && e.name === '.bowerbird')) continue
        if (bundles.has(p)) {
          children.push({ path: p, name: e.name, count: 1, modified: bundles.get(p) ?? null, effectiveDefaults: { ...eff, from: { ...eff.from } }, isBundle: true, children: [] })
          continue
        }
        children.push(await build(p, eff))
      }
      const own = counts.get(rel) ?? { n: 0, m: null }
      let count = own.n
      let modified = own.m
      for (const c of children) {
        if (!c.isBundle) count += c.count
        if (c.modified && (!modified || c.modified > modified)) modified = c.modified
      }
      return {
        path: rel, name: rel ? baseOf(rel) : this.libName(),
        ...(fm?.label ? { label: fm.label } : {}), ...(fm?.icon ? { icon: fm.icon } : {}), ...(fm?.description ? { description: fm.description } : {}),
        count, modified, ...(fm?.defaults ? { defaults: fm.defaults } : {}), effectiveDefaults: eff, children
      }
    }
    return build('', { from: {} })
  }

  async createFolder(p: string, ctx: CallContext): Promise<void> {
    await this.write('folder.create', ctx, { path: p }, async () => {
      const rel = normRel(p)
      if (!rel || isUnder(rel, '.bowerbird')) throw new CoreError('validation_failed', `文件夹路径不合法：${p}`)
      for (const seg of rel.split('/')) checkName(seg)
      if (this.fs.ignored(rel, true)) throw new CoreError('validation_failed', `这个文件夹会被忽略规则跳过：${rel}`)
      for (const a of ancestors(rel)) if (a && this.store.rowByPath(a)) throw new CoreError('validation_failed', '不能在包式资产或文件里建文件夹')
      if (await this.fs.exists(rel)) throw new CoreError('conflict', `已经有 ${rel}`, { path: rel })
      await this.fs.mkdir(rel)
      this.emit('folder.updated', { path: rel })
    })
  }

  async patchFolder(req: { path: string; rename?: string; moveTo?: string; label?: string | null; icon?: string | null; description?: string | null; defaults?: FolderDefaults | null }, ctx: CallContext): Promise<void> {
    await this.write('folder.patch', ctx, { path: req.path, ...(req.rename ? { rename: req.rename } : {}), ...(req.moveTo !== undefined ? { moveTo: req.moveTo } : {}) }, async () => {
      const by = this.actor(ctx)
      let rel = normRel(req.path)
      const st = await this.fs.stat(rel)
      if (!st?.isDir) throw new CoreError('not_found', `文件夹不存在：${req.path}`, { path: req.path })
      if (req.label !== undefined || req.icon !== undefined || req.description !== undefined || req.defaults !== undefined) {
        const fm: FolderMeta = { ...((await this.fs.readFolderMeta(rel)) ?? { bb: FORMAT_VERSION }) }
        const setOrDel = (k: 'label' | 'icon' | 'description', v: string | null | undefined) => {
          if (v === undefined) return
          if (v === null || v === '') delete fm[k]
          else fm[k] = v
        }
        setOrDel('label', req.label)
        setOrDel('icon', req.icon)
        setOrDel('description', req.description)
        if (req.defaults !== undefined) {
          const d = req.defaults ? Object.fromEntries(Object.entries(req.defaults).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))) : {}
          if (Object.keys(d).length) fm.defaults = d as FolderDefaults
          else delete fm.defaults
        }
        const meaningful = Object.keys(fm).some(k => k !== 'bb')
        if (rel) await this.fs.writeFolderMeta(rel, meaningful ? fm : null)
        else await this.fs.writeFolderMeta('', meaningful ? fm : null)
        this.core.folderMetaChanged(rel)
        this.emit('folder.updated', { path: rel })
      }
      if (req.rename !== undefined || req.moveTo !== undefined) {
        if (!rel) throw new CoreError('validation_failed', '不能移动资产库根目录')
        const name = req.rename !== undefined ? checkName(req.rename) : baseOf(rel)
        const parent = req.moveTo !== undefined ? normRel(req.moveTo) : dirOf(rel)
        const target = joinPath(parent, name)
        if (target === rel) return
        if (isUnder(target, rel)) throw new CoreError('validation_failed', '不能把文件夹移进它自己')
        if (isUnder(target, '.bowerbird') || this.fs.ignored(target, true)) throw new CoreError('validation_failed', `路径不合法：${target}`)
        for (const a of ancestors(parent)) if (a && this.store.rowByPath(a)) throw new CoreError('validation_failed', '不能移进包式资产里')
        if (await this.fs.exists(target)) throw new CoreError('conflict', `已经有 ${target}`, { path: target })
        const inside = this.store.rowsUnder(rel, true)
        await this.fs.move(rel, target)
        for (const r of inside) {
          const np = target + r.path.slice(rel.length)
          this.store.updatePath(r.id, np)
          this.core.expected.add(np)
          this.core.expected.add(np + SIDECAR_SUFFIX)
        }
        this.store.renameFiles(rel, target)
        for (const r of inside) {
          this.core.hooks.enqueue(r.id, ['index'], { reason: 'folder moved' })
          this.emit('asset.updated', { id: r.id, fields: ['path'], by })
        }
        this.core.hooks.changed([...inside.map(r => r.path), ...inside.map(r => target + r.path.slice(rel.length))], by, 'folder move')
        this.emit('folder.updated', { path: rel })
        this.emit('folder.updated', { path: target })
        rel = target
      }
    })
  }

  /**
   * Delete a folder (ADR-047): only its assets (file + sidecar) and its `_folder.bmeta` files go to the trash, with
   * info.json; ignored and unregistered files stay where they are and keep the folder. Assets referenced from outside
   * the folder need `force`. The root, `.bowerbird` and ignored folders are refused.
   */
  async trashFolder(p: string, ctx: CallContext, opts: { force?: boolean } = {}): Promise<{ trashed: number; batch: string | null }> {
    return this.write('folder.trash', ctx, { path: p, force: !!opts.force }, async () => {
      const by = this.actor(ctx)
      const rel = normRel(p)
      if (!rel) throw new CoreError('validation_failed', '不能删除资产库根目录')
      if (isUnder(rel, '.bowerbird')) throw new CoreError('validation_failed', '不能删除 .bowerbird')
      if (ancestors(rel).some(a => a && this.fs.ignored(a, true))) throw new CoreError('validation_failed', `这个文件夹被忽略规则跳过了：${rel}`, { path: rel })
      const st = await this.fs.stat(rel)
      if (!st?.isDir) throw new CoreError('not_found', `文件夹不存在：${p}`, { path: p })
      if (this.store.rowByPath(rel)) throw new CoreError('validation_failed', '这是一个包式资产，请按资产删除', { path: rel })
      const rows = this.store.rowsUnder(rel, true).filter(r => r.path !== rel)
      const inside = new Set(rows.map(r => r.id))
      const referrers = [...new Set(rows.flatMap(r => this.store.referrers(r.id)).filter(x => !inside.has(x)))]
      if (referrers.length && !opts.force) {
        throw new CoreError('referenced', `文件夹里的资产被外面 ${referrers.length} 个资产引用`, { referrers })
      }
      // folder settings of the folder and its sub folders (not inside ignored ones)
      const folderMetas: string[] = []
      const collect = async (dir: string): Promise<void> => {
        for (const e of await this.fs.readdir(dir)) {
          const c = joinPath(dir, e.name)
          if (e.isDirectory()) { if (!this.fs.ignored(c, true) && !this.store.rowByPath(c)?.bundle) await collect(c) }
          else if (e.isFile() && e.name === '_folder.bmeta') folderMetas.push(c)
        }
      }
      await collect(rel)
      const batch = rows.length || folderMetas.length ? newId() : null
      for (const r of rows) await this.trashRow(r, by, { batch: batch! })
      for (const fm of folderMetas) if (await this.fs.exists(fm)) await this.trashLoose(fm, by, { kind: 'folder-meta', batch: batch! })
      // remove folders that are empty now; anything else (ignored, unregistered) keeps its folder
      const prune = async (dir: string): Promise<boolean> => {
        let empty = true
        for (const e of await this.fs.readdir(dir)) {
          if (e.isDirectory() && (await prune(joinPath(dir, e.name)))) continue
          empty = false
        }
        return empty && (await this.fs.removeEmptyDir(dir))
      }
      await prune(rel)
      if (batch) this.emit('trash.updated', {})
      this.emit('folder.updated', { path: rel })
      return { trashed: rows.length, batch }
    })
  }

  /** Make a folder one bundle asset (library-format.md「包式资产」, ADR-041). */
  async makeBundle(p: string, entry: string | undefined, ctx: CallContext): Promise<AssetDetail> {
    return this.write('folder.bundle', ctx, { path: p }, async () => {
      const by = this.actor(ctx)
      const rel = normRel(p)
      if (!rel) throw new CoreError('validation_failed', '资产库根目录不能作为一个资产')
      const st = await this.fs.stat(rel)
      if (!st?.isDir) throw new CoreError('not_found', `文件夹不存在：${p}`, { path: p })
      if (this.store.rowByPath(rel)) throw new CoreError('conflict', '它已经是一个资产了')
      for (const a of ancestors(dirOf(rel))) if (a && this.store.rowByPath(a)?.bundle) throw new CoreError('validation_failed', '不能在包式资产里再建包式资产')
      if (await this.fs.exists(rel + SIDECAR_SUFFIX)) throw new CoreError('conflict', `已经有 ${rel}${SIDECAR_SUFFIX}`)
      const inner = this.store.rowsUnder(rel, true).filter(r => r.path !== rel)
      const innerIds = new Set(inner.map(r => r.id))
      const tags = uniqTags(inner.flatMap(r => this.store.meta(r).tags ?? []))
      // what the inner files depended on outside the folder, the bundle now depends on
      const outward = dedupeRelations(inner.flatMap(r => (this.store.meta(r).relations ?? []).filter(x => !innerIds.has(x.to)).map(x => ({ ...x }))))
      // the folder is now one asset: the inner records and folder settings go to the trash, never deleted (ADR-047)
      const batch = newId()
      for (const r of inner) {
        if (await this.fs.exists(r.path + SIDECAR_SUFFIX)) await this.trashLoose(r.path + SIDECAR_SUFFIX, by, { kind: 'sidecar', assetId: r.id, batch })
        this.core.integrity.removeAsset(r.id)
      }
      for (const fm of await this.fs.readdir(rel)) if (fm.name === '_folder.bmeta') await this.trashLoose(joinPath(rel, fm.name), by, { kind: 'folder-meta', batch })
      const hash = await this.fs.hash(rel)
      const cst = await this.fs.contentStat(rel)
      const entryRel = entry ? normRel(entry) : undefined
      const meta = await this.core.claim(rel, { hash, size: cst?.size ?? 0, isDir: true }, {
        by, tags, relations: outward, ...(entryRel ? { fields: { 'bowerbird.bundle': { entry: entryRel } } } : {})
      })
      // relations into the folder now point at the bundle; the inner file is kept as the slot (ADR-041)
      const retargeted = new Set<Guid>()
      for (const r of inner) {
        for (const ref of this.store.incoming(r.id)) {
          if (innerIds.has(ref.from_id)) continue
          const row0 = this.store.row(ref.from_id)
          if (!row0) continue
          const { row, meta: m } = await this.freshRow(row0)
          const innerPath = r.path.slice(rel.length + 1)
          const list = (m.relations ?? []).map(x => (x.to === r.id ? { ...x, to: meta.id, slot: x.slot ?? innerPath, ...(this.core.tracksVersion(x.type) ? { toHash: meta.hash } : {}) } : x))
          await this.save(row, { ...m, relations: dedupeRelations(list) }, null)
          retargeted.add(row.id)
          this.emit('relation.updated', { from: row.id, type: ref.type, to: meta.id, op: 'replaced' })
        }
      }
      for (const r of inner) {
        this.store.deleteAsset(r.id)
        this.store.deleteFile(r.path)
        this.core.hooks.forget(r.id)
        this.core.hooks.removeDocs([r.id])
        this.emit('asset.removed', { id: r.id, reason: 'purged' })
      }
      await this.core.integrity.refresh([meta.id, ...retargeted, ...innerIds])
      this.core.hooks.enqueue(meta.id, 'all', { reason: 'bundle' })
      this.core.hooks.changed([rel], by, 'bundle')
      this.emit('asset.created', { id: meta.id, path: rel, by })
      this.emit('folder.updated', { path: rel })
      return this.detail(meta.id)
    })
  }

  /* ───────────── tags ───────────── */

  async tags(): Promise<{ tags: TagInfo[]; groups: string[] }> {
    const defs = await this.fs.readTags()
    const human = new Map((this.store.prep('SELECT tag, COUNT(DISTINCT asset_id) n FROM tags WHERE ai = 0 GROUP BY tag').all() as Array<{ tag: string; n: number }>).map(r => [r.tag, r.n]))
    const ai = new Map((this.store.prep('SELECT tag, COUNT(DISTINCT asset_id) n FROM tags WHERE ai = 1 GROUP BY tag').all() as Array<{ tag: string; n: number }>).map(r => [r.tag, r.n]))
    const names = new Set([...human.keys(), ...ai.keys(), ...Object.keys(defs.tags)])
    const tags: TagInfo[] = [...names].sort((a, b) => (human.get(b) ?? 0) - (human.get(a) ?? 0) || (a < b ? -1 : 1)).map(name => {
      const d = defs.tags[name]
      return {
        name, count: human.get(name) ?? 0, aiCount: ai.get(name) ?? 0,
        ...(d?.group ? { group: d.group } : {}), ...(d?.color ? { color: d.color } : {}), ...(d?.aliases?.length ? { aliases: d.aliases } : {})
      }
    })
    return { tags, groups: defs.groups }
  }

  async patchTags(req: { rename?: { from: string; to: string }; merge?: { from: string; into: string }; define?: { name: string; group?: string; color?: string; aliases?: string[] }; groups?: string[] }, ctx: CallContext): Promise<{ affected: number }> {
    return this.write('tags.patch', ctx, { ops: Object.keys(req) }, async () => {
      const by = this.actor(ctx)
      const defs = await this.fs.readTags()
      let affected = 0
      const retag = async (from: string, to: string) => {
        const f = normalizeTag(from)
        const t = normalizeTag(to)
        if (!f || !t) throw new CoreError('validation_failed', '标签不能为空')
        for (const id of this.store.assetsWithTag(f, null)) {
          const row0 = this.store.row(id)
          if (!row0) continue
          let fresh: { row: AssetRow; meta: Bmeta }
          try { fresh = await this.freshRow(row0) } catch (e) { this.log.warn('tag rename skipped an asset', { id, error: String(e) }); continue }
          const { row, meta } = fresh
          const next: Bmeta = { ...meta }
          if (meta.tags?.includes(f)) next.tags = uniqTags(meta.tags.map(x => (x === f ? t : x)))
          if (meta.auto?.tags?.includes(f)) next.auto = { ...meta.auto, tags: uniqTags(meta.auto.tags.map(x => (x === f ? t : x))) }
          await this.save(row, next, by)
          this.core.hooks.enqueue(id, ['index'], { reason: 'tag renamed' })
          this.emit('asset.updated', { id, fields: ['tags'], by })
          affected++
        }
        // definitions: the old name stays as an alias
        const old = defs.tags[f]
        const target = { ...(defs.tags[t] ?? {}), ...(old && !defs.tags[t] ? old : {}) }
        target.aliases = uniqTags([...(target.aliases ?? []), ...(old?.aliases ?? []), f]).filter(a => a !== t)
        delete defs.tags[f]
        defs.tags[t] = target
      }
      if (req.rename) await retag(req.rename.from, req.rename.to)
      if (req.merge) await retag(req.merge.from, req.merge.into)
      if (req.define) {
        const n = normalizeTag(req.define.name)
        if (!n) throw new CoreError('validation_failed', '标签不能为空')
        const cur = { ...(defs.tags[n] ?? {}) }
        if (req.define.group !== undefined) { if (req.define.group) cur.group = req.define.group; else delete cur.group }
        if (req.define.color !== undefined) { if (req.define.color) cur.color = req.define.color; else delete cur.color }
        if (req.define.aliases !== undefined) { const a = uniqTags(req.define.aliases).filter(x => x !== n); if (a.length) cur.aliases = a; else delete cur.aliases }
        defs.tags[n] = cur
        if (cur.group && !defs.groups.includes(cur.group)) defs.groups.push(cur.group)
      }
      if (req.groups) defs.groups = [...new Set(req.groups)]
      await this.fs.writeTags(defs)
      this.emit('tags.updated', {})
      return { affected }
    })
  }

  async acceptTagEverywhere(tag: string | null, ctx: CallContext): Promise<{ affected: number }> {
    return this.write('tags.accept', ctx, { tag }, async () => {
      let affected = 0
      for (const id of this.assetsWithAutoTag(tag)) if (await this.moveAutoTags(id, tag ? [normalizeTag(tag)] : null, true, this.actor(ctx))) affected++
      this.emit('tags.updated', {})
      return { affected }
    })
  }

  async dismissTagEverywhere(tag: string | null, ctx: CallContext): Promise<{ affected: number }> {
    return this.write('tags.dismiss', ctx, { tag }, async () => {
      let affected = 0
      for (const id of this.assetsWithAutoTag(tag)) if (await this.moveAutoTags(id, tag ? [normalizeTag(tag)] : null, false, this.actor(ctx))) affected++
      this.emit('tags.updated', {})
      return { affected }
    })
  }

  /** Assets whose sidecar lists this AI tag (null: any AI tag), including ones also set by a human. */
  private assetsWithAutoTag(tag: string | null): Guid[] {
    const t = tag ? normalizeTag(tag) : null
    const rows = this.store.prep("SELECT id, meta_json FROM assets WHERE meta_json LIKE '%\"auto\"%'").all() as Array<{ id: string; meta_json: string }>
    return rows.filter(r => {
      const tags = (JSON.parse(r.meta_json) as Bmeta).auto?.tags ?? []
      return t ? tags.map(normalizeTag).includes(t) : tags.length > 0
    }).map(r => r.id)
  }

  /* ───────────── smart folders ───────────── */

  async views(): Promise<SmartView[]> {
    let counts = { all: 0, untagged: 0, pending: 0, issues: 0, trash: 0 }
    try { if (this.query) counts = this.query.counts() } catch { /* not ready */ }
    const out: SmartView[] = BUILTIN_VIEWS.map(name => ({ name, builtin: true, query: BUILTIN_VIEW_QUERIES[name], count: counts[name] }))
    for (const { view } of await this.fs.listViews()) {
      let count = 0
      try { count = this.query ? await this.query.countFor(this.resolveBelongsName(view.query)) : 0 } catch { /* unsupported filter */ }
      out.push({ name: view.name, builtin: false, query: view.query, count })
    }
    return out
  }

  async putView(name: string, query: Query, rename: string | undefined, ctx: CallContext): Promise<SmartView[]> {
    await this.write('view.put', ctx, { name, rename }, async () => {
      const n = name.trim()
      const target = (rename ?? n).trim()
      if (!target) throw new CoreError('validation_failed', '名称不能为空')
      if ((BUILTIN_VIEWS as readonly string[]).includes(target) || (BUILTIN_VIEWS as readonly string[]).includes(n)) throw new CoreError('validation_failed', '这是内置视图的名字')
      const list = await this.fs.listViews()
      const cur = list.find(v => v.view.name === n)
      if (rename && rename.trim() !== n && list.some(v => v.view.name === target)) throw new CoreError('conflict', `已经有「${target}」`)
      if (cur && rename && rename.trim() !== n) await this.fs.deleteViewFile(cur.file)
      await this.fs.writeView({ bb: FORMAT_VERSION, name: target, query })
      this.emit('view.updated', { name: target })
    })
    return this.views()
  }

  async deleteView(name: string, ctx: CallContext): Promise<SmartView[]> {
    await this.write('view.delete', ctx, { name }, async () => {
      if ((BUILTIN_VIEWS as readonly string[]).includes(name)) throw new CoreError('validation_failed', '内置视图不能删除')
      const cur = (await this.fs.listViews()).find(v => v.view.name === name)
      if (!cur) throw new CoreError('not_found', `没有「${name}」`)
      await this.fs.deleteViewFile(cur.file)
      this.emit('view.updated', { name })
    })
    return this.views()
  }

  /* ───────────── integrity ───────────── */

  async issues(q: { type?: IssueType[]; level?: string[]; assetId?: Guid }): Promise<{ issues: Issue[]; assets: Record<string, AssetSummary>; assetCount: number; total: number }> {
    let rows = this.store.allIssues()
    if (q.type?.length) rows = rows.filter(r => q.type!.includes(r.type as IssueType))
    if (q.level?.length) rows = rows.filter(r => q.level!.includes(r.level))
    if (q.assetId) rows = rows.filter(r => r.asset_id === q.assetId)
    const issues = rows.map(issueView)
    const ids = new Set<string>()
    for (const i of issues) {
      if (i.assetId) ids.add(i.assetId)
      if (i.relation?.to) ids.add(i.relation.to)
      const other = i.details.otherId
      if (typeof other === 'string') ids.add(other)
    }
    const assets: Record<string, AssetSummary> = {}
    for (const s of summaries(this.vd, [...ids])) assets[s.id] = s
    return { issues, assets, assetCount: new Set(issues.map(i => i.assetId).filter(Boolean)).size, total: issues.length }
  }

  async resolveIssue(id: string, r: IssueResolution, ctx: CallContext): Promise<IssueResolveResponse> {
    return this.write('issue.resolve', ctx, { issue: id, action: r.action }, async () => {
      try {
        await this.doResolve(id, r, ctx)
        return { resolved: [id], failed: [] }
      } catch (e) {
        if (e instanceof CoreError && (e.code === 'not_found' || e.code === 'validation_failed' || e.code === 'conflict' || e.code === 'cycle')) {
          if (e.code === 'not_found' && !this.store.issue(id)) throw e
          return { resolved: [], failed: [{ id, message: e.message }] }
        }
        throw e
      }
    })
  }

  async resolveIssues(r: IssueResolution & { ids?: string[]; type?: IssueType }, ctx: CallContext): Promise<IssueResolveResponse> {
    const ids = r.ids ?? (r.type ? this.store.allIssues().filter(i => i.type === r.type).map(i => i.id) : [])
    const resolved: string[] = []
    const failed: IssueResolveResponse['failed'] = []
    await this.write('issue.resolve.batch', ctx, { count: ids.length, action: r.action }, async () => {
      for (const id of ids) {
        try { await this.doResolve(id, { action: r.action, params: r.params }, ctx); resolved.push(id) } catch (e) { failed.push({ id, message: String((e as Error)?.message ?? e) }) }
      }
    })
    return { resolved, failed }
  }

  private async doResolve(issue: string, r: IssueResolution, ctx: CallContext): Promise<void> {
    const by = this.actor(ctx)
    const row = this.store.issue(issue)
    if (!row) throw new CoreError('not_found', `问题不存在：${issue}`, { id: issue })
    const type = row.type as IssueType
    const allowed = ISSUE_ACTIONS[type] as readonly string[]
    if (!allowed.includes(r.action)) throw new CoreError('validation_failed', `「${type}」不能用「${r.action}」处理`, { allowed })
    const details = JSON.parse(row.details_json) as Record<string, unknown>
    const params = r.params ?? {}
    switch (`${type}:${r.action}`) {
      case 'broken-reference:remove-relation':
        await this.doRemoveRelation(row.asset_id!, { type: row.rel_type!, to: row.rel_to!, ...(row.rel_slot ? { slot: row.rel_slot } : {}) }, by)
        break
      case 'broken-reference:restore-target': {
        const t = this.store.trashByAsset(row.rel_to!)
        if (!t) throw new CoreError('not_found', '回收站里没有它')
        await this.doRestore(t.id, true, by)
        this.emit('trash.updated', {})
        break
      }
      case 'missing-file:relocate':
      case 'orphan-sidecar:relocate':
        await this.relocate(row, String(params.path ?? ''), !!params.moveBack, by)
        this.emit('trash.updated', {})
        break
      case 'missing-file:confirm-deleted': {
        const a = this.store.row(row.asset_id!)
        if (!a) throw new CoreError('not_found', '资产已经不在了')
        await this.trashRow(a, by, {})
        this.emit('trash.updated', {})
        break
      }
      case 'orphan-sidecar:trash': {
        const sc = row.path!
        if (await this.fs.exists(sc)) await this.trashLoose(sc, by, { kind: 'sidecar' })
        this.core.integrity.resolve(issue)
        this.emit('trash.updated', {})
        break
      }
      case 'duplicate-guid:confirm':
        await this.clearIdentityNote(row.asset_id!, by)
        this.core.integrity.resolve(issue)
        break
      case 'duplicate-guid:swap':
        await this.swapIdentity(row.asset_id!, String(details.otherId), by)
        await this.clearIdentityNote(row.asset_id!, by)
        this.core.integrity.resolve(issue)
        break
      case 'metadata-conflict:keep-local':
      case 'metadata-conflict:keep-conflict':
        await this.resolveConflict(row, details, r.action === 'keep-conflict', by)
        break
      case 'stale-upstream:acknowledge':
        await this.doAcknowledge(row.asset_id!, row.rel_to!, by)
        break
      case 'pipeline-failed:retry':
        this.requirePipeline().retry({ assetIds: [row.asset_id!], ...(details.stage ? { stage: details.stage as PipelineStage } : {}) })
        break
      case 'thumbnail-stale:clear-thumbnail':
        await this.doClearThumbnail(row.asset_id!, by)
        break
      case 'duplicate-content:ignore':
        await this.updateLibraryJson(lib => {
          const list = new Set(lib.settings.ignoredIssues ?? [])
          list.add(issue)
          lib.settings = { ...lib.settings, ignoredIssues: [...list] }
        })
        this.core.integrity.resolve(issue)
        break
      case 'duplicate-content:mark-copy': {
        // ADR-037: the later one becomes a copy of the earlier one
        const a = this.store.row(row.asset_id!)
        const b = this.store.row(String(details.otherId))
        if (!a || !b) throw new CoreError('not_found', '资产已经不在了')
        const [older, newer] = a.created_at < b.created_at || (a.created_at === b.created_at && a.path < b.path) ? [a, b] : [b, a]
        const { meta: nm } = await this.freshRow(newer)
        await this.save(newer, {
          ...nm, relations: dedupeRelations([...(nm.relations ?? []), { type: 'source', to: older.id, toHash: older.hash }]),
          ...(nm.provenance ? {} : { provenance: { method: 'copy', by, at: nowIso() } })
        }, by)
        await this.core.integrity.refresh([newer.id, older.id])
        this.emit('relation.updated', { from: newer.id, type: 'source', to: older.id, op: 'added' })
        break
      }
      default:
        throw new CoreError('validation_failed', `不支持的处理：${r.action}`)
    }
  }

  /** missing-file / orphan-sidecar: attach the asset to another file (content change = new version). */
  private async relocate(issue: { asset_id: string | null; path: string | null; type: string }, target: string, moveBack: boolean, by: string): Promise<void> {
    const p = normRel(target)
    if (!p) throw new CoreError('validation_failed', '需要选一个文件')
    const st = await this.fs.stat(p)
    if (!st) throw new CoreError('not_found', `文件不存在：${p}`)
    if (issue.type === 'orphan-sidecar') {
      const sc = issue.path!
      if (await this.fs.exists(p + SIDECAR_SUFFIX)) throw new CoreError('conflict', '这个文件已经有自己的记录了')
      await this.fs.move(sc, p + SIDECAR_SUFFIX)
      // the scanner decides what the moved record is, after this write released the lock (P1-4)
      this.scanAfterWrite({ folder: dirOf(p), recursive: false }, { folder: dirOf(sc), recursive: false })
      return
    }
    const row = this.store.row(issue.asset_id!)
    if (!row) throw new CoreError('not_found', '资产已经不在了')
    const other = this.store.rowByPath(p)
    if (other && other.id !== row.id) {
      // the chosen file was registered on its own: its record goes to the trash (never deleted), the file becomes this asset
      const refs = this.store.referrers(other.id).filter(x => x !== row.id)
      if (refs.length) throw new CoreError('referenced', `${other.name} 已经被 ${refs.length} 个资产引用，不能拿来顶替`, { referrers: refs })
      await this.trashRow(other, by, { recordOnly: true })
    } else if (await this.fs.exists(p + SIDECAR_SUFFIX)) {
      throw new CoreError('conflict', '这个文件已经有自己的记录了', { path: p })
    }
    let finalPath = p
    const back = this.store.originalPath(row.id) ?? row.path
    if (moveBack) {
      if ((await this.fs.exists(back)) || this.store.rowByPath(back)?.id !== undefined && this.store.rowByPath(back)!.id !== row.id) {
        throw new CoreError('conflict', `原来的位置已经有文件了：${back}`, { path: back })
      }
      await this.fs.move(p, back)
      if (back !== row.path) this.store.updatePath(row.id, back)
      finalPath = back
    } else {
      if (await this.fs.exists(row.path + SIDECAR_SUFFIX)) await this.fs.move(row.path + SIDECAR_SUFFIX, p + SIDECAR_SUFFIX)
      this.store.updatePath(row.id, p)
    }
    const { meta } = await this.current(row.id)
    const hash = await this.fs.hash(finalPath)
    const cst = await this.fs.contentStat(finalPath)
    let next = meta
    if (hash !== meta.hash) {
      const at = nowIso()
      next = { ...meta, hash, versions: [...(meta.versions ?? []), { hash, size: cst?.size ?? 0, at, by }], modified: { at, by } }
    }
    await this.core.writeMeta(finalPath, next, { missing: false })
    if (hash !== meta.hash) this.contentDownstream(row.id)
    await this.core.integrity.refresh([row.id])
    this.core.hooks.enqueue(row.id, 'all', { reason: 'relocated' })
    this.emit('asset.updated', { id: row.id, fields: hash !== meta.hash ? ['path', 'missing', 'content'] : ['path', 'missing'], by })
  }

  /** The pending identity decision is settled: drop the note from the copy's sidecar (P2-6). */
  private async clearIdentityNote(id: Guid, by: string): Promise<void> {
    const row = this.store.row(id)
    if (!row) return
    const { meta } = await this.freshRow(row)
    if (!identityOf(meta)) return
    const fields = { ...(meta.fields ?? {}) }
    delete fields[IDENTITY_FIELD]
    const next: Bmeta = { ...meta, fields }
    if (!Object.keys(fields).length) delete next.fields
    await this.save(this.row404(id), next, by)
    await this.core.integrity.refresh([id])
  }

  /** duplicate-guid「其实这个才是原件」: the two assets trade places (each keeps its metadata, files swap). */
  private async swapIdentity(copyId: Guid, originalId: Guid, by: string): Promise<void> {
    const { row: a, meta: am } = await this.current(copyId)
    const { row: b, meta: bm } = await this.current(originalId)
    const tmp = `${b.path}.${newId()}.swap`
    this.store.updatePath(b.id, tmp)
    this.store.updatePath(a.id, b.path)
    this.store.updatePath(b.id, a.path)
    const fix = async (p: string, m: Bmeta) => {
      const hash = await this.fs.hash(p)
      const cst = await this.fs.contentStat(p)
      const at = nowIso()
      const next = hash === m.hash ? m : { ...m, hash, versions: [...(m.versions ?? []), { hash, size: cst?.size ?? 0, at, by }], modified: { at, by } }
      await this.core.writeMeta(p, next, { checked: true })
    }
    await fix(b.path, am)
    await fix(a.path, bm)
    await this.core.integrity.refresh([a.id, b.id])
    this.emit('asset.updated', { id: a.id, fields: ['path'], by })
    this.emit('asset.updated', { id: b.id, fields: ['path'], by })
  }

  /** metadata-conflict「保留哪一份」: the other copy goes to the trash. */
  private async resolveConflict(issue: { id: string; asset_id: string | null; path: string | null }, details: Record<string, unknown>, keepConflict: boolean, by: string): Promise<void> {
    const conflictPath = String(details.conflictPath ?? '')
    const kind = details.kind
    if (kind === 'slot') {
      // ADR-048: keep the relations, drop the slot names that are not relative paths
      if (keepConflict) throw new CoreError('validation_failed', '不合法的位置名不能保留')
      const { row, meta } = await this.current(issue.asset_id!)
      const relations = (meta.relations ?? []).map(r => {
        if (r.slot === undefined || isSafeRelPath(r.slot)) return r
        const { slot: _bad, ...rest } = r
        void _bad
        return rest as Relation
      })
      await this.save(row, { ...meta, relations }, by)
      await this.core.integrity.refresh([row.id])
      this.emit('asset.updated', { id: row.id, fields: ['relations'], by })
      return
    }
    if (kind === 'broken') {
      const assetPath = conflictPath.slice(0, -SIDECAR_SUFFIX.length)
      if (keepConflict) throw new CoreError('validation_failed', '这份记录读不出来，不能保留')
      const row = issue.asset_id ? this.store.row(issue.asset_id) : this.store.rowByPath(assetPath)
      if (await this.fs.exists(conflictPath)) await this.trashLoose(conflictPath, by, { kind: 'sidecar', ...(row ? { assetId: row.id } : {}) })
      if (row) await this.core.writeMeta(row.path, this.store.meta(row), { missing: !!row.missing })
      this.core.integrity.resolve(issue.id)
      if (!row) this.scanAfterWrite({ folder: dirOf(assetPath), recursive: false })
      this.emit('trash.updated', {})
      return
    }
    const row = this.row404(issue.asset_id!)
    if (keepConflict) {
      const r = await this.fs.readSidecarAbs(this.fs.absolute(conflictPath))
      if (!r?.ok) throw new CoreError('validation_failed', '冲突副本读不出来')
      const local = row.path + SIDECAR_SUFFIX
      if (await this.fs.exists(local)) await this.trashLoose(local, by, { kind: 'sidecar', assetId: row.id })
      await this.fs.move(conflictPath, local)
      const meta = { ...r.meta, id: row.id }
      const hash = row.missing ? meta.hash : await this.fs.hash(row.path)
      await this.core.writeMeta(row.path, hash === meta.hash ? meta : { ...meta, hash, versions: [...(meta.versions ?? []), { hash, size: row.size, at: nowIso(), by }] }, { missing: !!row.missing, checked: true })
    } else {
      await this.trashLoose(conflictPath, by, { kind: 'sidecar', assetId: row.id })
    }
    this.core.integrity.resolve(issue.id)
    await this.core.integrity.refresh([row.id])
    this.emit('trash.updated', {})
    this.emit('asset.updated', { id: row.id, fields: ['metadata'], by })
  }

  async relocateCandidates(issueId: string): Promise<RelocateCandidates> {
    const row = this.store.issue(issueId)
    if (!row) throw new CoreError('not_found', `问题不存在：${issueId}`)
    const asset = row.asset_id ? this.store.row(row.asset_id) : undefined
    const refPath = asset?.path ?? (row.path?.endsWith(SIDECAR_SUFFIX) ? row.path.slice(0, -SIDECAR_SUFFIX.length) : row.path ?? '')
    const refName = baseOf(refPath)
    const { base, ext } = splitName(refName)
    const refHash = asset?.hash ?? null
    const refSize = asset?.size ?? 0
    const cands: RelocateCandidates['candidates'] = []
    for (const f of this.store.filesUnder('')) {
      if (f.path === refPath) continue
      const other = this.store.rowByPath(f.path)
      if (other && other.id === asset?.id) continue
      const fe = splitName(baseOf(f.path))
      const sameContent = !!refHash && f.hash === refHash
      const nameSim = similarity(fe.base, base)
      const sizeSim = refSize && f.size ? Math.min(refSize, f.size) / Math.max(refSize, f.size) : 0
      const extOk = fe.ext.toLowerCase() === ext.toLowerCase()
      const score = sameContent ? 1 : (extOk ? 0.15 : 0) + nameSim * 0.6 + sizeSim * 0.25
      if (!sameContent && score < 0.35) continue
      const reason = sameContent ? '内容完全一样' : nameSim >= 0.6 ? '名字相近' : sizeSim >= 0.9 ? '大小相近' : '格式相同'
      cands.push({ path: f.path, size: f.size, sameContent, similarity: Math.round(score * 100) / 100, reason })
    }
    cands.sort((a, b) => b.similarity - a.similarity || (a.path < b.path ? -1 : 1))
    return { candidates: cands.slice(0, 10) }
  }

  /* ───────────── creators, jobs, render, cache ───────────── */

  async creators(): Promise<CreatorInfo[]> { return this._plugins?.creatorInfo() ?? [] }

  async startCreate(creatorId: string, req: { params: unknown; inputs: Array<{ role: string; id: Guid }>; folder?: string }, ctx: CallContext): Promise<JobInfo> {
    this.assertWritable()
    for (const i of req.inputs) this.row404(i.id)
    this.log.info('write', { op: 'create.start', actor: this.actor(ctx), library: this.id, creator: creatorId })
    return this.requirePipeline().startCreate(creatorId, req, ctx)
  }

  /* ───────────── plugin actions (K11) ───────────── */

  /** Actions whose `appliesTo(selection)` accepts these assets; id is `pluginId:actionId`. */
  async actions(ids: Guid[]): Promise<ActionInfo[]> {
    const sel = summaries(this.vd, ids)
    if (sel.length !== new Set(ids).size) throw new CoreError('not_found', '有的资产不存在', { ids })
    if (!sel.length) return []
    const names = new Map(this.plugins().enabled().map(p => [p.id, p.displayName]))
    const out: ActionInfo[] = []
    for (const { pluginId, action } of this.plugins().actions()) {
      let ok = false
      try { ok = !!action.appliesTo(sel) } catch (e) { this.log.warn('action appliesTo failed', { plugin: pluginId, action: action.id, error: String(e) }) }
      if (ok) out.push({ id: `${pluginId}:${action.id}`, pluginId, pluginName: names.get(pluginId) ?? pluginId, title: action.title, ...(action.params ? { params: action.params } : {}) })
    }
    return out
  }

  /** Run an action: an `action` job of the pipeline (its outputs register through the kernel's channel). */
  async runAction(actionId: string, req: { ids: Guid[]; params?: unknown }, ctx: CallContext): Promise<JobInfo> {
    this.assertWritable()
    const p = this.requirePipeline() as Pipeline & { startAction?: (id: string, r: { ids: Guid[]; params?: unknown }, c: CallContext) => Promise<JobInfo> }
    if (typeof p.startAction !== 'function') throw new CoreError('unsupported', '这个版本的管线还不能运行插件动作')
    const i = actionId.indexOf(':')
    const entry = i > 0 ? this.plugins().actions().find(a => a.pluginId === actionId.slice(0, i) && a.action.id === actionId.slice(i + 1)) : undefined
    if (!entry) throw new CoreError('not_found', `没有这个动作：${actionId}`, { id: actionId })
    const sel = summaries(this.vd, req.ids)
    if (!req.ids.length || sel.length !== new Set(req.ids).size) throw new CoreError('not_found', '有的资产不存在', { ids: req.ids })
    let applies = false
    try { applies = !!entry.action.appliesTo(sel) } catch { applies = false }
    if (!applies) throw new CoreError('validation_failed', '这个动作不适用于选中的资产', { id: actionId })
    return p.startAction(actionId, { ids: req.ids, ...(req.params !== undefined ? { params: req.params } : {}) }, ctx)
  }

  async jobs(): Promise<JobsResponse> {
    const r = this.requirePipeline().overview()
    return { ...r, scan: { ...this.scanner.progress } }
  }

  async job(id: string): Promise<JobInfo> {
    const j = this.requirePipeline().job(id)
    if (!j) throw new CoreError('not_found', `任务不存在：${id}`, { id })
    return j
  }

  async cancelJob(id: string, ctx: CallContext): Promise<void> {
    await this.job(id)
    this.log.info('write', { op: 'job.cancel', actor: this.actor(ctx), library: this.id, job: id })
    this.requirePipeline().cancel(id)
  }

  async retryJobs(req: { assetIds?: Guid[]; stage?: PipelineStage; failed?: boolean; jobIds?: string[] }, ctx: CallContext): Promise<void> {
    this.log.info('write', { op: 'job.retry', actor: this.actor(ctx), library: this.id })
    this.requirePipeline().retry(req)
  }

  async renderNext(visible: Guid[]): Promise<RenderTask | null> {
    this.pipeline?.markVisible(visible)
    return this.requirePipeline().renderNext(visible)
  }

  async renderSubmit(job: string, parts: Partial<Record<ThumbVariant, Uint8Array>>, fields: { tech?: Record<string, number | string | boolean>; aspect?: number; error?: string; retryable?: boolean }): Promise<void> {
    return this.requirePipeline().renderSubmit(job, parts, fields)
  }

  async cache(): Promise<CacheResponse> { return this.requirePipeline().cacheStats() }
  async cleanCache(all: boolean): Promise<CacheCleanResponse> { return this.requirePipeline().cleanCache(all) }

  async pluginLibrarySettings(pluginId: string): Promise<Record<string, unknown>> {
    return { ...((this.core.lib?.settings?.plugins ?? {})[pluginId] ?? {}) }
  }

  /**
   * Only settings the plugin's manifest declares with `scope: library` may live in library.json; machine-scoped ones
   * (credentials among them) never enter the library (ADR-016 §9, engineering.md「配置」).
   */
  private checkLibrarySettings(pluginId: string, values: Record<string, unknown>): void {
    let schema: Record<string, unknown> | null = null
    try { schema = this.o.pluginHost.settingsSchema(pluginId) } catch { schema = null }
    const props = ((schema?.properties ?? {}) as Record<string, { scope?: string }>)
    const bad = Object.keys(values).filter(k => props[k]?.scope !== 'library')
    if (bad.length) {
      throw new CoreError('validation_failed', `这些设置不随资产库保存：${bad.join('、')}（只在本机保存，或插件没有声明）`, { plugin: pluginId, keys: bad })
    }
  }

  async setPluginLibrarySettings(pluginId: string, values: Record<string, unknown>, ctx: CallContext): Promise<void> {
    this.checkLibrarySettings(pluginId, values ?? {})
    await this.write('plugin.settings', ctx, { plugin: pluginId }, async () => {
      await this.updateLibraryJson(lib => {
        const all = { ...(lib.settings.plugins ?? {}) }
        all[pluginId] = { ...values }
        lib.settings = { ...lib.settings, plugins: all }
      })
    })
    await this.reloadPlugins()
    this.emit('library.updated', { fields: ['settings.plugins'] })
  }

  /* ───────────── export ───────────── */

  async exportPlan(req: ExportRequest): Promise<ExportPlan> { return (await planExport(this.store, this.fs, req)).plan }

  async exportFiles(req: ExportRequest): Promise<Array<[string, string]>> {
    return (await planExport(this.store, this.fs, req)).files.map(f => [f.path, f.abs])
  }

  async exportToDir(req: ExportRequest & { dir: string }, ctx: CallContext): Promise<{ written: number; dir: string; bytes: number }> {
    if (!ctx.isLocal) throw new CoreError('not_local', '只能导出到服务所在电脑上的文件夹')
    if (!path.isAbsolute(req.dir)) throw new CoreError('validation_failed', '需要一个绝对路径')
    const dir = path.resolve(req.dir)
    if (dir === this.paths.root || dir.startsWith(this.paths.root + path.sep)) throw new CoreError('validation_failed', '不能导出到资产库里面')
    const { files, skipped } = await planExport(this.store, this.fs, req)
    let bytes = 0
    let written = 0
    const outside: string[] = [...skipped]
    for (const f of files) {
      const dst = path.resolve(dir, ...f.path.split('/'))
      if (!dst.startsWith(dir + path.sep)) { outside.push(f.path); continue }
      await fsp.mkdir(path.dirname(dst), { recursive: true })
      await fsp.copyFile(f.abs, dst)
      bytes += f.size
      written++
    }
    this.log.info('write', { op: 'export', actor: this.actor(ctx), library: this.id, count: written, dir, skipped: outside.length })
    return { written, dir, bytes, ...(outside.length ? { skipped: outside } : {}) }
  }

  /* ───────────── PipelineDeps ───────────── */

  async assetFile(id: Guid): Promise<AssetFile | null> {
    const row = this.store.row(id)
    if (!row || row.missing) return null
    const meta = this.store.meta(row)
    const abs = this.fs.absolute(row.path)
    let head: Uint8Array = new Uint8Array()
    if (!row.bundle) { try { head = await this.fs.readHead(row.path) } catch { return null } }
    const belongs = (meta.relations ?? []).find(r => r.type === 'belongs' && this.store.row(r.to))
    let designObject: AssetFile['designObject'] = null
    if (belongs) {
      const t = this.store.tech(belongs.to)
      const w = Number(t.targetWidth), h = Number(t.targetHeight), d = Number(t.targetDepth)
      designObject = { id: belongs.to, ...([w, h, d].every(v => Number.isFinite(v) && v > 0) ? { targetSize: { w, h, d } } : {}) }
    }
    return {
      absPath: abs, path: row.path, name: row.name, ext: row.ext, size: row.size, bundle: !!row.bundle, head,
      id, hash: row.hash, stage: meta.stage, tech: this.store.tech(id), views: meta.views ?? null,
      read: async () => {
        if (row.bundle) { const f = await this.file(id); return new Uint8Array(await fsp.readFile(f.absPath)) }
        return new Uint8Array(await this.fs.readFile(row.path))
      },
      readSlot: async slot => {
        const f = await this.slotFile(id, slot).catch(() => null)
        return f ? new Uint8Array(await fsp.readFile(f.absPath)) : null
      },
      relations: meta.relations ?? [],
      designObject
    }
  }

  async applyIdentify(id: Guid, result: IdentifyResult | null): Promise<void> {
    await this.core.lock.run(async () => {
      const row = this.store.row(id)
      if (!row) return
      let missingPlugin: string | null = null
      if (!result && row.ext) {
        const m = this._plugins?.missingPluginFor(row.ext)
        if (m) missingPlugin = JSON.stringify(m)
      }
      this.store.prep('UPDATE assets SET format=?, plugin=?, missing_plugin=?, seq=seq+1 WHERE id=?')
        .run(result?.format ?? 'unknown', result?.pluginId ?? null, missingPlugin, id)
      if (!result && row.thumb_state === 'pending' && !row.thumb_manual) this.store.prep("UPDATE assets SET thumb_state='none' WHERE id=?").run(id)
      if (row.format !== (result?.format ?? 'unknown')) this.emit('asset.updated', { id, fields: ['format'] })
      await this.core.integrity.refresh([id], { expand: false })
    })
  }

  async applyProbe(id: Guid, pluginId: string, probe: ProbeResult): Promise<void> {
    await this.core.lock.run(async () => {
      const row = this.store.row(id)
      if (!row) return
      const db = this.store.db
      this.store.tx(() => {
        db.prepare('DELETE FROM tech WHERE asset_id = ?').run(id)
        const ins = db.prepare('INSERT OR REPLACE INTO tech (asset_id, key, num, txt) VALUES (?, ?, ?, ?)')
        for (const [k, v] of Object.entries(probe.tech ?? {})) {
          if (typeof v === 'number') ins.run(id, k, Number.isFinite(v) ? v : null, null)
          else if (typeof v === 'boolean') ins.run(id, k, v ? 1 : 0, v ? 'true' : 'false')
          else ins.run(id, k, null, String(v))
        }
        if (probe.analysis) db.prepare('INSERT OR REPLACE INTO analysis (asset_id, plugin, json) VALUES (?, ?, ?)').run(id, pluginId, JSON.stringify(probe.analysis))
      })
      let meta = this.store.meta(row)
      let sidecarOk = true
      try { meta = (await this.freshRow(row)).meta } catch { sidecarOk = false /* unreadable sidecar: never overwrite it (ADR-046) */ }
      const reported = Array.isArray(probe.references)
      const prev = db.prepare('SELECT refs_json, unresolved_json FROM probe WHERE asset_id = ?').get(id) as { refs_json: string | null; unresolved_json: string | null } | undefined
      const { relations, added, removed, unresolved } = reported
        ? this.pairSlots(row, meta, probe.references!, new Set(probe.embedded ?? []))
        : { relations: meta.relations ?? [], added: [] as Relation[], removed: [] as Relation[], unresolved: JSON.parse(prev?.unresolved_json ?? '[]') as string[] }
      db.prepare('INSERT OR REPLACE INTO probe (asset_id, plugin, refs_json, unresolved_json, text) VALUES (?, ?, ?, ?, ?)')
        .run(id, pluginId, reported ? JSON.stringify([...new Set(probe.references!)]) : (prev?.refs_json ?? '[]'), JSON.stringify(unresolved), probe.text ?? null)
      const title = typeof probe.tech?.title === 'string' ? probe.tech.title : null
      const analysisExcerpt = typeof probe.analysis?.excerpt === 'string' ? probe.analysis.excerpt : null
      const excerpt = analysisExcerpt ?? (probe.text ? probe.text.replace(/\s+/g, ' ').trim().slice(0, 240) : null)
      db.prepare('UPDATE assets SET badge=?, aspect=COALESCE(?, aspect), cell_title=?, cell_excerpt=?, seq=seq+1 WHERE id=?')
        .run(probe.badge ?? null, probe.aspect ?? null, title, excerpt, id)
      let next: Bmeta | null = null
      if (added.length || removed.length) {
        next = { ...meta, relations }
        if (!relations.length) delete next.relations
      }
      if (probe.auxiliary !== undefined && probe.auxiliary !== !!meta.auxiliary) {
        next = { ...(next ?? meta) }
        if (probe.auxiliary) next.auxiliary = true
        else delete next.auxiliary
      }
      if (!sidecarOk) next = null
      if (next) {
        await this.writeWorkedOut(row, next)
        if (added.length || removed.length) await this.core.integrity.refresh([id])
        for (const r of added) this.emit('relation.updated', { from: id, type: 'uses', to: r.to, op: 'added' })
        for (const r of removed) this.emit('relation.updated', { from: id, type: 'uses', to: r.to, op: 'removed' })
        this.core.hooks.changed([row.path], SCANNER_ACTOR, 'probe')
      }
      this.emit('asset.updated', { id, fields: ['tech', ...(next ? ['relations', 'auxiliary'] : [])] })
    })
  }

  /**
   * Slot pairing (ADR-018, pipeline-and-cache.md「提取」): slot names found in the file are paired with assets of that
   * file name in the same folder or below the first time; existing slot relations are never overwritten (even when
   * replaced or broken); new names are paired; names no longer in the file lose their relation; unfound ones are listed.
   */
  private pairSlots(row: AssetRow, meta: Bmeta, refsIn: string[], embedded: Set<string> = new Set()): { relations: Relation[]; added: Relation[]; removed: Relation[]; unresolved: string[] } {
    const refs = [...new Set(refsIn.filter(r => typeof r === 'string' && r.length))]
    const refSet = new Set(refs)
    const current = meta.relations ?? []
    const removed = current.filter(r => r.type === 'uses' && r.slot && !refSet.has(r.slot))
    const relations = current.filter(r => !removed.includes(r))
    const have = new Set(relations.filter(r => r.type === 'uses' && r.slot).map(r => r.slot!))
    const added: Relation[] = []
    const unresolved: string[] = []
    for (const ref of refs) {
      if (have.has(ref)) continue
      const target = isSafeRelPath(ref) ? this.findSlotTarget(row, ref) : null
      if (target) {
        const r: Relation = { type: 'uses', to: target, slot: ref }
        relations.push(r)
        added.push(r)
        have.add(ref)
      } else if (!embedded.has(ref)) unresolved.push(ref) // embedded data needs no outside file (K1)
    }
    return { relations, added, removed, unresolved }
  }

  /**
   * Asset for a slot name in the referrer's folder or below (K3): the relative path as written (folders included)
   * first, then the same relative path deeper down, then the file name alone; URI-encoded names are tried decoded.
   */
  private findSlotTarget(row: AssetRow, ref: string): Guid | null {
    const dir = row.folder
    const variants: string[] = []
    for (const v of [ref, (() => { try { return decodeURIComponent(ref) } catch { return ref } })()]) {
      const clean = v.replace(/\\/g, '/').replace(/^\.\//, '')
      if (!clean || clean.startsWith('/') || clean.split('/').includes('..') || /^[a-z]+:/i.test(clean) || variants.includes(clean)) continue
      variants.push(clean)
    }
    const under = (name: string) => (this.store.prep('SELECT * FROM assets WHERE name = ? AND missing = 0 AND id != ?').all(name, row.id) as AssetRow[])
      .filter(c => isUnder(c.folder, dir))
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : 1))
    for (const clean of variants) {
      const exact = this.store.rowByPath(joinPath(dir, clean))
      if (exact && exact.id !== row.id && !exact.missing) return exact.id
    }
    for (const clean of variants) {
      if (!clean.includes('/')) continue
      const hit = under(baseOf(clean)).find(c => c.path.endsWith('/' + clean))
      if (hit) return hit.id
    }
    for (const clean of variants) {
      const hit = under(baseOf(clean))[0]
      if (hit) return hit.id
    }
    return null
  }

  /** New assets may resolve slot names other assets could not find before (unresolved references). */
  private async pairPending(ids: Set<Guid>): Promise<void> {
    if (!ids.size) return
    // only the (few) unresolved names are looked up — never every new asset (a rebuild hands over 100 000 ids)
    const rows = this.store.prep("SELECT asset_id, unresolved_json FROM probe WHERE unresolved_json IS NOT NULL AND unresolved_json != '[]'").all() as Array<{ asset_id: string; unresolved_json: string }>
    if (!rows.length) return
    const byName = this.store.prep('SELECT id FROM assets WHERE name = ? AND missing = 0')
    const memo = new Map<string, boolean>()
    const isFresh = (name: string): boolean => {
      let v = memo.get(name)
      if (v === undefined) { v = (byName.all(name) as Array<{ id: string }>).some(r => ids.has(r.id)); memo.set(name, v) }
      return v
    }
    const bases = (n: string): string[] => {
      const out = [baseOf(n.replace(/\\/g, '/'))]
      try { out.push(baseOf(decodeURIComponent(n).replace(/\\/g, '/'))) } catch { /* not encoded */ }
      return out
    }
    let n = 0
    for (const p of rows) {
      if (++n % 500 === 0) await new Promise<void>(r => setImmediate(r))
      let names: string[] = []
      try { names = JSON.parse(p.unresolved_json) } catch { continue }
      if (!names.some(nm => bases(nm).some(isFresh))) continue
      await this.core.lock.run(async () => {
        const row0 = this.store.row(p.asset_id)
        if (!row0) return
        let fresh: { row: AssetRow; meta: Bmeta }
        try { fresh = await this.freshRow(row0) } catch { return }
        const { row, meta } = fresh
        const have = new Set((meta.relations ?? []).filter(r => r.type === 'uses' && r.slot).map(r => r.slot!))
        const added: Relation[] = []
        const still: string[] = []
        for (const n of names) {
          if (have.has(n)) continue
          const t = this.findSlotTarget(row, n)
          if (t) added.push({ type: 'uses', to: t, slot: n })
          else still.push(n)
        }
        if (!added.length) return
        await this.writeWorkedOut(row, { ...meta, relations: [...(meta.relations ?? []), ...added] })
        this.store.prep('UPDATE probe SET unresolved_json = ? WHERE asset_id = ?').run(JSON.stringify(still), row.id)
        await this.core.integrity.refresh([row.id])
        for (const r of added) this.emit('relation.updated', { from: row.id, type: 'uses', to: r.to, op: 'added' })
        this.core.hooks.enqueue(row.id, ['thumbnail', 'summary'], { reason: 'slot paired' })
      })
    }
  }

  async applyThumbnails(id: Guid, stored: Partial<Record<ThumbVariant, { key: string; relPath: string; bytes: number }>>, aspect: number | null): Promise<void> {
    const row = this.store.row(id)
    if (!row) return
    const key = stored.thumb?.key ?? null
    if (key) {
      this.store.prep("UPDATE assets SET thumb_key=?, thumb_state='ready', aspect=COALESCE(?, aspect), seq=seq+1 WHERE id=?").run(key, aspect, id)
    } else if (aspect != null) {
      this.store.prep('UPDATE assets SET aspect=?, seq=seq+1 WHERE id=?').run(aspect, id)
    }
    const r = this.store.row(id)!
    if (key && !r.thumb_manual) this.emit('asset.thumbnail', { id, url: this.thumbUrl(id, key) })
  }

  async setThumbState(id: Guid, state: 'pending' | 'render' | 'ready' | 'none' | 'failed'): Promise<void> {
    const row = this.store.row(id)
    if (!row || row.thumb_manual) return
    if (row.thumb_state === state) return
    this.store.prep('UPDATE assets SET thumb_state=?, seq=seq+1 WHERE id=?').run(state, id)
    this.emit('asset.updated', { id, fields: ['thumbnail'] })
  }

  async applyChecks(id: Guid, checks: Array<{ validator: string; rule: string; verdict: 'pass' | 'warn' | 'fail'; message: string; values?: Record<string, unknown> }>): Promise<void> {
    if (!this.store.row(id)) return
    const db = this.store.db
    this.store.tx(() => {
      db.prepare('DELETE FROM checks WHERE asset_id = ?').run(id)
      const ins = db.prepare('INSERT OR REPLACE INTO checks (asset_id, validator, rule, verdict, message, values_json) VALUES (?, ?, ?, ?, ?, ?)')
      for (const c of checks) ins.run(id, c.validator, c.rule, c.verdict, c.message, c.values ? JSON.stringify(c.values) : null)
    })
    this.emit('asset.updated', { id, fields: ['checks'] })
  }

  async applyEnrich(id: Guid, pluginId: string, result: { tags?: string[]; description?: string }): Promise<void> {
    await this.core.lock.run(async () => {
      const row0 = this.store.row(id)
      if (!row0) return
      let fresh: { row: AssetRow; meta: Bmeta }
      try { fresh = await this.freshRow(row0) } catch { return /* unreadable sidecar: AI output waits (ADR-046) */ }
      const { row, meta } = fresh
      const version = this._plugins?.enabled().find(p => p.id === pluginId)?.version
      const human = new Set(meta.tags ?? [])
      const auto = {
        ...(meta.auto ?? {}),
        ...(result.tags ? { tags: uniqTags(result.tags).filter(t => !human.has(t)) } : {}),
        ...(result.description ? { description: result.description } : {}),
        by: version ? `${pluginId}@${version}` : pluginId,
        hash: meta.hash
      }
      await this.core.writeMeta(row.path, { ...meta, auto }, { missing: !!row.missing })
      this.emit('asset.updated', { id, fields: ['auto'] })
    })
  }

  /**
   * What the pipeline works out of a file (auxiliary, slot pairing) can always be worked out again: an asset with a
   * .bmeta keeps it there, one the library only sees keeps it in the index only (ADR-067).
   */
  private async writeWorkedOut(row: AssetRow, next: Bmeta): Promise<void> {
    if (row.sidecar) await this.core.writeMeta(row.path, next, { missing: !!row.missing })
    else await this.core.indexOnly(row.path, next)
  }

  async searchDoc(id: Guid): Promise<SearchDoc | null> {
    const row = this.store.row(id)
    if (!row) return null
    const meta = this.store.meta(row)
    const { tags, autoTags } = this.store.tagsOf(id)
    const prompts = meta.provenance?.prompt ? [meta.provenance.prompt] : []
    const probe = this.store.prep('SELECT text FROM probe WHERE asset_id = ?').get(id) as { text: string | null } | undefined
    const title = this.store.tech(id).title
    const text = [typeof title === 'string' ? title : '', probe?.text ?? ''].filter(Boolean).join('\n')
    return {
      id, name: row.name, stem: row.stem, path: row.path, folder: row.folder, tags, autoTags,
      description: meta.description ?? '', autoDescription: meta.auto?.description ?? '', prompts, text, format: row.format
    }
  }

  async referencedHashes(id: Guid): Promise<string[]> {
    const meta = this.store.metaOf(id)
    const out: string[] = []
    for (const r of meta?.relations ?? []) {
      if (r.type !== 'uses') continue
      const t = this.store.row(r.to)
      out.push(t ? `${r.slot ?? ''}=${t.hash}` : `${r.slot ?? ''}=missing:${r.to}`)
    }
    return out
  }

  async assetDetail(id: Guid): Promise<AssetDetail | null> {
    const row = this.store.row(id)
    return row ? buildDetail(this.vd, row) : null
  }

  async setProcessing(id: Guid, state: { processing: boolean; failed: boolean; error?: string; stage?: PipelineStage }): Promise<void> {
    if (this.core.integrity.setPipelineFlags(id, state.processing, state.failed)) this.emit('asset.updated', { id, fields: ['flags'] })
  }

  async pipelineIssue(id: Guid, stage: PipelineStage, error: string | null): Promise<void> {
    const iid = issueId.pipeline(id, stage)
    if (error === null) { this.core.integrity.resolve(iid); return }
    if (!this.store.row(id)) return
    this.core.integrity.raise({ id: iid, type: 'pipeline-failed', assetId: id, details: { stage, error } })
  }

  /** PipelineDeps as a separate object: its `register` (plugin channel) differs from LibraryService.register. */
  readonly deps: PipelineDeps = {
    assetFile: id => this.assetFile(id),
    applyIdentify: (id, r) => this.applyIdentify(id, r),
    applyProbe: (id, p, r) => this.applyProbe(id, p, r),
    applyThumbnails: (id, s, a) => this.applyThumbnails(id, s, a),
    setThumbState: (id, s) => this.setThumbState(id, s),
    applyChecks: (id, c) => this.applyChecks(id, c),
    applyEnrich: (id, p, r) => this.applyEnrich(id, p, r),
    searchDoc: id => this.searchDoc(id),
    referencedHashes: id => this.referencedHashes(id),
    assetDetail: id => this.assetDetail(id),
    setProcessing: (id, s) => this.setProcessing(id, s),
    pipelineIssue: (id, s, e) => this.pipelineIssue(id, s, e),
    register: (req, ctx) => this.registerFromPlugin(req, ctx)
  }

  /* ───────────── full-scan hooks ───────────── */

  /** Load records and trash entries into the index (rebuild) before a full scan. */
  private async loadLibraryData(): Promise<void> {
    const known = new Set(this.store.trashRows().map(t => t.id))
    const onDisk = new Set(await this.fs.listTrashIds())
    for (const id of onDisk) {
      if (known.has(id)) continue
      const info = await this.fs.readTrashInfo(id)
      if (!info) continue
      const loose = (info as { kind?: string }).kind
      const sc = await this.fs.readSidecarAbs(this.fs.trashAbs(id, loose ? info.name : info.name + SIDECAR_SUFFIX))
      const meta = loose === 'folder-meta' ? null : sc?.ok ? sc.meta : null
      let size = meta?.versions?.at(-1)?.size ?? 0
      try { size = (await fsp.stat(this.fs.trashAbs(id, info.name))).size } catch { /* record only */ }
      this.store.insertTrash(info, meta, size, 'unknown')
    }
    for (const id of known) if (!onDisk.has(id)) this.store.deleteTrash(id)
  }

  /**
   * A library written before ADR-070 keeps its production records in `.bowerbird/records/`: each record's content
   * moves into the `provenance` of the assets it made (the outputs of one record share a batch id), record inputs
   * become source relations with their roles, and the records folder is set aside (never deleted). Runs once, after
   * the first full scan has indexed every asset.
   */
  private async convertLegacyRecords(): Promise<void> {
    if (this.readOnly || !this.core.lib || !(await this.fs.hasLegacyRecords())) return
    const recs = new Map((await this.fs.listRecords()).map(r => [r.id, r]))
    await this.core.lock.run(async () => {
      const recOf = (m: Record<string, unknown>): string | undefined => {
        if (typeof m.origin === 'string') return m.origin
        const r = ((m.relations as Array<Record<string, unknown>> | undefined) ?? []).find(x => typeof x.record === 'string')
        return r?.record as string | undefined
      }
      const rows = this.store.allRows().filter(r => r.sidecar && !r.path.startsWith('.bowerbird/'))
      const outputs = new Map<string, number>()
      for (const row of rows) {
        const m = this.store.meta(row) as Bmeta & Record<string, unknown>
        // outputs converted by an earlier, interrupted pass still count (their batch is bat_<record id without rec_>)
        const id = recOf(m) ?? (m.provenance?.batch?.startsWith('bat_') ? `rec_${m.provenance.batch.slice(4)}` : undefined)
        if (id) outputs.set(id, (outputs.get(id) ?? 0) + 1)
      }
      let converted = 0
      for (const row of rows) {
        const meta = this.store.meta(row) as Bmeta & Record<string, unknown>
        const recId = recOf(meta)
        const hasLegacy = recId !== undefined || 'origin' in meta || (meta.relations ?? []).some(r => 'record' in r)
        if (!hasLegacy) continue
        const rec = recId ? recs.get(recId) : undefined
        const next: Bmeta & Record<string, unknown> = { ...meta }
        delete next.origin
        const rels: Relation[] = (meta.relations ?? []).map(r => {
          const { record: _r, ...rest } = r as Relation & { record?: unknown }
          const role = rec?.inputs?.find(i => i.id === r.to)?.role
          return { ...rest, ...(role && !rest.role && isMakingRelation(rest.type) ? { role } : {}) }
        })
        for (const inp of rec?.inputs ?? []) {
          if (inp.id === meta.id || rels.some(r => isMakingRelation(r.type) && r.to === inp.id) || !this.store.row(inp.id)) continue
          rels.push({ type: 'source', to: inp.id, toHash: inp.hash, ...(inp.role ? { role: inp.role } : {}) })
        }
        if (rels.length) next.relations = rels
        else delete next.relations
        if (rec && !meta.provenance) {
          let params = rec.params
          const rect = params?.rect
          if (rect && typeof rect === 'object' && !Array.isArray(rect)) params = { ...params, rect: (rect as Record<string, unknown>)[meta.id] }
          if (params && params.rect === undefined) { const { rect: _x, ...p } = params; params = p }
          const notes = [rec.note, ...(rec.notes ?? []).map(n => n.text)].filter((t): t is string => !!t)
          next.provenance = {
            method: rec.method, ...(rec.tool ? { tool: rec.tool } : {}), ...(rec.plugin ? { plugin: rec.plugin } : {}),
            ...(rec.prompt ? { prompt: rec.prompt } : {}), ...(params && Object.keys(params).length ? { params } : {}),
            ...((outputs.get(rec.id) ?? 0) > 1 ? { batch: `bat_${rec.id.slice(4)}` } : {}),
            by: rec.by, at: rec.at, ...(notes.length ? { note: notes.join('\n') } : {})
          }
        }
        // a missing asset keeps its .bmeta where its file was (R7): rewrite it there, when it is there
        if (row.missing && !(await this.fs.exists(row.path + SIDECAR_SUFFIX))) continue
        await this.core.writeMeta(row.path, next, { missing: !!row.missing, checked: true })
        converted++
      }
      // set the folder aside only once every asset has been converted and the scan saw the whole library: a stopped
      // scan, or an asset that could not be rewritten, leaves it for the next full scan (nothing is lost meanwhile)
      const left = this.store.allRows().some(r => { const m = this.store.meta(r) as Record<string, unknown>; return r.sidecar && ('origin' in m || ((m.relations as Array<Record<string, unknown>> | undefined) ?? []).some(x => 'record' in x)) })
      if (left || this.scanner.stopping) { this.log.info('converted part of the production records of an older library; the rest on the next full scan', { assets: converted }); return }
      const aside = await this.fs.setAsideRecords()
      this.log.info('converted the production records of an older library into provenance', { assets: converted, records: recs.size, setAside: `.bowerbird/${aside}` })
    })
  }

  private async afterFullScan(): Promise<void> {
    try { await this.convertLegacyRecords() } catch (e) { this.log.error('could not convert the production records of an older library', { error: String((e as Error)?.stack ?? e) }) }
    await this.core.lock.run(async () => this.refreshPluginIssues())
    await this.purgeExpired()
  }

  /**
   * A version store's own data folders are skipped by the scanner (versioning.md「约束」); with several version
   * plugins enabled only the first is used, and a library-level issue says so.
   */
  private applyVersionStore(): void {
    const vs = this._plugins?.versionStore() ?? null
    this.fs.setExtraIgnores((vs?.ignore ?? []).map(p => p.replace(/^\/+/, '')).filter(Boolean))
    const id = 'plugin-missing:version-store'
    if (vs?.conflicts?.length) {
      this.core.integrity.raise({
        id, type: 'plugin-missing', assetId: null,
        details: {
          kind: 'version-store-conflict', plugin: vs.pluginId, used: vs.displayName, conflicts: vs.conflicts,
          message: `同时启用了多个版本插件，只用「${vs.displayName}」，${vs.conflicts.join('、')} 不生效。停用多余的版本插件后这条提示会消失。`
        }
      })
    } else this.core.integrity.resolve(id)
  }

  private async reloadPlugins(): Promise<void> {
    await this._plugins?.reload().catch(e => this.log.warn('plugin reload failed', { error: String(e) }))
    this.applyVersionStore()
  }

  /**
   * Plugins the library declares but this machine does not have (ADR-012): each asset such a plugin would read gets
   * its own issue (derived, ADR-044); a missing plugin with no asset to point at gets one library-level issue.
   */
  private refreshPluginIssues(): void {
    const enabled = new Set((this._plugins?.enabled() ?? []).map(p => p.id))
    const declared = this.core.lib?.plugins ?? {}
    const perAsset = new Set(this.store.allIssues().filter(r => r.type === 'plugin-missing' && r.asset_id).map(r => String(JSON.parse(r.details_json).plugin)))
    for (const [pid, range] of Object.entries(declared)) {
      if (enabled.has(pid) || perAsset.has(pid)) this.core.integrity.resolve(issueId.plugin(pid))
      else this.core.integrity.raise({ id: issueId.plugin(pid), type: 'plugin-missing', assetId: null, details: { plugin: pid, range } })
    }
    this.core.integrity.resolveWhere(r => r.type === 'plugin-missing' && !r.asset_id && r.id !== 'plugin-missing:version-store' && !(String(JSON.parse(r.details_json).plugin) in declared))
  }

  /** The declared plugin this machine lacks that would read an asset (library.json `pluginFormats`, ADR-044). */
  private missingPluginOf(row: AssetRow): { id: string; range: string; displayName?: string } | null {
    if (!row.ext || row.plugin) return null
    const lib = this.core.lib
    const enabled = new Set((this._plugins?.enabled() ?? []).map(p => p.id))
    const pid = lib?.pluginFormats?.[row.ext]
    if (pid && lib?.plugins[pid] && !enabled.has(pid)) return { id: pid, range: lib.plugins[pid]! }
    if (pid) return null
    try { return this._plugins?.missingPluginFor(row.ext) ?? null } catch { return null }
  }

  /**
   * Enable / disable a plugin for this library: declare it in library.json `plugins` as `^<version>` or remove it.
   * Built-in plugins cannot be disabled. Enabling a non-builtin plugin records its extensions in `pluginFormats`
   * (ADR-044; kept on disable). Assets the change affects are identified again.
   */
  async setPluginEnabled(pluginId: string, enabled: boolean, ctx: CallContext): Promise<void> {
    let info: import('@bowerbird/schema').PluginInfo | undefined
    try { info = this.o.pluginHost.list(this.handle).find(p => p.id === pluginId) } catch { info = undefined }
    if (!info && enabled) throw new CoreError('not_found', `插件不存在：${pluginId}`, { id: pluginId })
    if (info?.builtin && !enabled) throw new CoreError('validation_failed', '内置插件不能禁用', { id: pluginId })
    const exts = info?.formats.flatMap(f => f.extensions) ?? []
    await this.write('plugin.toggle', ctx, { plugin: pluginId, enabled }, async () => {
      await this.updateLibraryJson(lib => {
        const plugins = { ...lib.plugins }
        if (enabled) {
          if (!info?.version) throw new CoreError('validation_failed', `插件没有安装：${pluginId}`, { id: pluginId })
          if (!plugins[pluginId]) plugins[pluginId] = `^${info.version}`
          if (!info.builtin && exts.length) {
            const pf = { ...(lib.pluginFormats ?? {}) }
            for (const e of exts) pf[e.toLowerCase()] = pluginId
            lib.pluginFormats = pf
          }
        } else delete plugins[pluginId]
        lib.plugins = plugins
      })
    })
    await this.reloadPlugins()
    await this.core.lock.run(async () => { await this.core.integrity.refreshAll(); this.refreshPluginIssues() })
    // identify again what this plugin can now read (or no longer reads)
    const rows = enabled
      ? (exts.length ? this.store.prep(`SELECT id FROM assets WHERE missing = 0 AND (format = 'unknown' OR plugin IS NULL) AND ext IN (${exts.map(() => '?').join(',')})`).all(...exts.map(e => e.toLowerCase())) as Array<{ id: string }> : [])
      : this.store.prep('SELECT id FROM assets WHERE missing = 0 AND plugin = ?').all(pluginId) as Array<{ id: string }>
    for (const r of rows) this.core.hooks.enqueue(r.id, 'all', { reason: enabled ? 'plugin enabled' : 'plugin disabled' })
    this.emit('library.updated', { fields: ['plugins'] })
    this.emit('plugin.updated', { id: pluginId, status: enabled ? 'enabled' : 'disabled' })
  }

  async close(): Promise<void> {
    if (this.trashTimer) clearInterval(this.trashTimer)
    this.trashTimer = null
    await this.scanner.close()
    await this.committer.flush()
    try { await this.pipeline?.stop() } catch { /* ignore */ }
    try { this.o.db.close() } catch { /* ignore */ }
  }
}

/* ───────────── helpers ───────────── */

export function applyTagEdit(current: string[], edit: TagEdit): string[] {
  if (edit.set) return uniqTags(edit.set)
  const remove = new Set(uniqTags(edit.remove))
  return uniqTags([...current.filter(t => !remove.has(t)), ...uniqTags(edit.add).filter(t => !remove.has(t))])
}

/** Identity of a relation for has / has-not: its type plus its slot, or its counterpart when it has no slot. */
export function relKey(r: { type: string; to: string; slot?: string }): string {
  return r.slot ? `${r.type}\u0000slot\u0000${r.slot}` : `${r.type}\u0000to\u0000${r.to}`
}

/**
 * The provenance a wanted state asks for (ADR-070): `by` / `at` are stamped now; a batch id not said again is kept;
 * the plugin that made the asset stays as long as the method does.
 */
export function provenanceOf(input: ProvenanceInput, before: Provenance | undefined, by: string, plugin?: string): Provenance {
  const keepPlugin = plugin ?? (before?.plugin && before.method === input.method ? before.plugin : undefined)
  const batch = input.batch ?? before?.batch
  return {
    method: input.method,
    ...(input.tool ? { tool: input.tool } : {}),
    ...(keepPlugin ? { plugin: keepPlugin } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.params && Object.keys(input.params).length ? { params: input.params } : {}),
    ...(batch ? { batch } : {}),
    by, at: nowIso(),
    ...(input.note ? { note: input.note } : {})
  }
}

/** Same provenance apart from who wrote it down and when. */
export function sameProvenance(a: Provenance | undefined, b: Provenance | undefined): boolean {
  if (!a || !b) return !a && !b
  const strip = (p: Provenance) => { const { by: _b, at: _a, ...rest } = p; return canonicalJson(rest) }
  return strip(a) === strip(b)
}

/** JSON with object keys sorted (order-insensitive comparison of parameters). */
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, (x as Record<string, unknown>)[k]])) : x))
}

/** One relation per (type, target) — slot relations are distinct per slot (data-model.md「语义约定」). */
export function dedupeRelations(list: Relation[]): Relation[] {
  const out: Relation[] = []
  for (const r of list) {
    const dup = out.findIndex(x => x.type === r.type && (r.slot || x.slot ? (x.slot ?? '') === (r.slot ?? '') && (!!r.slot || x.to === r.to) : x.to === r.to))
    if (dup >= 0) out[dup] = { ...out[dup]!, ...r }
    else out.push(r)
  }
  return out
}

/** library.json for a fresh library: declares every built-in plugin as `^<version>` (ADR-033). */
export async function initialLibraryJson(host: PluginHost, handle: LibraryHandle, plugins: LibraryPlugins | null, name: string, id?: string): Promise<LibraryJson> {
  const declared: Record<string, string> = {}
  let list: Array<{ id: string; version: string | null; builtin: boolean }> = []
  try { list = host.list(handle) } catch { list = [] }
  for (const p of list) if (p.builtin && p.version) declared[p.id] = `^${p.version}`
  if (!Object.keys(declared).length) for (const p of plugins?.enabled() ?? []) declared[p.id] = `^${p.version}`
  return {
    bb: FORMAT_VERSION, id: id ?? handle.id, name, created: nowIso(), plugins: declared,
    settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 }
  }
}

export async function openLibraryService(o: ServiceOptions): Promise<LibraryServiceImpl> {
  return new LibraryServiceImpl(o).start()
}

/** Folder defaults as the folder tree shows them (exported for the hub and tests). */
export { effectiveDefaults }
