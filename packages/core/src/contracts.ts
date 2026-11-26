/**
 * FROZEN internal contracts of @bowerbird/core.
 *
 * Who implements what (file ownership; see .workflow-drafts/…/phase1-impl.md):
 *   line core-A — library/, scanner/, model/, integrity/, service/, hub.ts      → LibraryFs, LibraryService, Hub, PipelineDeps
 *   line core-B — index/query*, pipeline/, plugins/                              → QueryEngine, Pipeline, PluginHost, LibraryPlugins
 *   line server — packages/server (HTTP)                                         → consumes Hub, LibraryService, PluginHost
 * Each line codes against these types only, never against another line's internals.
 * The SQLite schema shared by both core lines is index/ddl.ts.
 */
import type Database from 'better-sqlite3'
import type {
  AssetDetail, AssetPatch, AssetSummary, BatchRequest, BatchResponse, Bmeta, CacheResponse, CheckView, ConfigResponse,
  CopyResponse, CreatorInfo, EventType, EventPayload, ExportPlan, ExportRequest, FolderDefaults, FolderNode, Guid,
  Issue, IssueType, JobAction, JobInfo, JobsResponse, LibraryInfo, LibraryJson, LibraryRef, LibrarySettings, Lineage,
  LineageQuery, MachineConfig, OnConflict, PipelineStage, PluginInfo, PrecheckResponse, ProductionRecord, RecordInput,
  RegisterFields, RegisterResponse, RelationInput, RenderTask, RetargetResponse, ReviewStatus, SearchRequest,
  SearchResponse, SmartView, Stage, SummaryResponse, TagEdit, TagInfo, ThumbVariant, TrashItem, VersionsResponse,
  ViewGrid, Vocabulary, CacheCleanResponse, RelocateCandidates, FormatContribution, RelationTypeContribution,
  IssueResolveResponse, Query, CreatorInput
} from '@bowerbird/schema'
import type {
  Action, AssetFile, AuthProvider, Creator, Enricher, FileRef, FormatHandler, ProbeResult, RegisterRequest, Route,
  SearchDoc, SearchProvider, Template, Validator, VersionStore, AssetInfo, ThumbnailSet, AssetChange
} from '@bowerbird/plugin-sdk'

export type IndexDb = Database.Database

/* ───────────────────────── cross-cutting ───────────────────────── */

export interface CoreLogger {
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
  child(module: string): CoreLogger
}

/** In-process event bus; the server forwards a library's events over SSE. */
export interface EventBus {
  emit<T extends EventType>(library: string, type: T, data: EventPayload<T>): void
  on(library: string, handler: (type: EventType, data: unknown) => void): () => void
}

/** A kernel error with an API error code; the server maps it to the HTTP status of ERROR_CODES. */
export class CoreError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_local' | 'validation_failed' | 'conflict' | 'referenced' | 'cycle' | 'unsupported' | 'read_only' | 'internal',
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CoreError'
  }
}

/** Who is calling (attribution only, never access control). */
export interface CallContext {
  /** `user:<name>` | `agent:<name>`; defaults to `user:unnamed`. */
  actor: string
  /** Request comes from the server's own machine (ADR-023). */
  isLocal: boolean
  signal?: AbortSignal
}

/** Machine-local locations for one library (library-format.md「本机数据目录」). */
export interface LibraryPaths {
  /** Absolute library root folder. */
  root: string
  /** `<root>/.bowerbird` */
  metaDir: string
  /** Cache dir: `<root>/.bowerbird/cache` unless overridden in the machine config. */
  cacheDir: string
  /** `~/.bowerbird/libraries/<lib>/` */
  dataDir: string
  /** `~/.bowerbird/libraries/<lib>/index.sqlite` */
  indexPath: string
  /** `~/.bowerbird/tmp/` */
  tmpDir: string
}

/* ───────────────────────── library folder I/O (core-A) ───────────────────────── */

export interface SidecarRead { ok: true; meta: Bmeta; raw: string; mtimeMs: number }
export interface SidecarBroken { ok: false; error: string; raw: string | null; mtimeMs: number }

/**
 * The only module that writes into a library folder (engineering.md「代码约定」). Atomic writes (temp + rename).
 * Paths are library-relative POSIX paths.
 */
export interface LibraryFs {
  readonly root: string
  readLibraryJson(): Promise<LibraryJson | null>
  writeLibraryJson(lib: LibraryJson): Promise<void>
  readSidecar(assetPath: string): Promise<SidecarRead | SidecarBroken | null>
  writeSidecar(assetPath: string, meta: Bmeta): Promise<void>
  readFolderMeta(folder: string): Promise<import('@bowerbird/schema').FolderMeta | null>
  writeFolderMeta(folder: string, meta: import('@bowerbird/schema').FolderMeta | null): Promise<void>
  readRecord(id: string): Promise<ProductionRecord | null>
  writeRecord(rec: ProductionRecord): Promise<void>
  /** Stream SHA-256 of a file, or the directory fingerprint of a bundle. Returns `sha256:<hex>`. */
  hash(path: string): Promise<string>
  stat(path: string): Promise<{ size: number; mtimeMs: number; isDir: boolean } | null>
  absolute(path: string): string
  /** Whether the path is ignored (built-in rules + .bbignore). */
  ignored(path: string, isDir: boolean): boolean
}

/* ───────────────────────── plugins (core-B) ───────────────────────── */

export interface LoadedFormat {
  pluginId: string
  pluginVersion: string
  contribution: FormatContribution
  handler: FormatHandler | null
}

export interface IdentifyResult { pluginId: string; pluginVersion: string; format: string; thumbnail: 'server' | 'browser' | 'none' }

export interface CreatorEntry { pluginId: string; pluginName: string; pluginVersion: string; creator: Creator }

/** Plugins enabled for one library, with error-isolated invocation. */
export interface LibraryPlugins {
  /** Enabled plugin ids with versions. */
  enabled(): Array<{ id: string; version: string; displayName: string }>
  /** Identify a file: candidates by extension, then `match()` on the head; highest priority wins. */
  identify(file: FileRef): Promise<IdentifyResult | null>
  format(formatId: string): LoadedFormat | null
  formats(): LoadedFormat[]
  /** Extension of a file no enabled plugin reads, but a declared-and-missing plugin would (ADR-012). */
  missingPluginFor(ext: string): { id: string; range: string; displayName?: string } | null
  searchProviders(): Array<{ pluginId: string; provider: SearchProvider }>
  enrichers(): Array<{ pluginId: string; enricher: Enricher }>
  validators(): Array<{ pluginId: string; validator: Validator }>
  templates(): Array<{ pluginId: string; template: Template }>
  actions(): Array<{ pluginId: string; action: Action }>
  creators(): CreatorEntry[]
  creatorInfo(): CreatorInfo[]
  relationTypes(): Array<RelationTypeContribution & { plugin: string | null }>
  /** The enabled version store; `ignore` = folders its manifest asks the scanner to skip; `conflicts` = other enabled version plugins (only one may be active). */
  versionStore(): { pluginId: string; displayName: string; store: VersionStore; ignore?: string[]; conflicts?: string[] } | null
  auth(): Array<{ pluginId: string; provider: AuthProvider }>
  routes(): Array<{ pluginId: string; route: Route }>
  /** Calls into plugin code go through here: exceptions caught, timed, failures counted (plugin-system.md「错误隔离」). */
  invoke<T>(pluginId: string, label: string, fn: () => Promise<T>): Promise<T>
  /** Notify subscribers of a change (ADR-024 slot). */
  emitChange(change: AssetChange): void
  /** Re-read enablement after library.json changed. */
  reload(): Promise<void>
}

export interface PluginHostOptions {
  /** Directories scanned for built-in plugins (each child with a package.json `bowerbird` field). */
  builtinDirs: string[]
  /** `~/.bowerbird/plugins/` */
  installDir: string
  machineConfig: () => MachineConfig
  saveMachineConfig: (patch: Partial<MachineConfig>) => Promise<void>
  log: CoreLogger
  events: EventBus
}

/** Global plugin manager (one per server). */
export interface PluginHost {
  /** Discover and validate manifests; does not activate. */
  discover(): Promise<void>
  /** All known plugins with status for the given library (enabled = declared in its library.json, builtins always). */
  list(library?: LibraryHandle): PluginInfo[]
  /** Activate the plugins this library enables, building plugin contexts bound to it. */
  forLibrary(library: LibraryHandle): Promise<LibraryPlugins>
  install(spec: string): Promise<PluginInfo>
  update(id: string): Promise<PluginInfo>
  remove(id: string): Promise<void>
  /** Absolute path of a plugin's built web module, if any. */
  webEntry(id: string): string | null
  machineSettings(id: string): Record<string, unknown>
  setMachineSettings(id: string, values: Record<string, unknown>): Promise<void>
  settingsSchema(id: string): Record<string, unknown> | null
  close(): Promise<void>
}

/** What the plugin host needs to know about a library to bind plugin contexts. */
export interface LibraryHandle {
  id: string
  name: string
  paths: LibraryPaths
  libraryJson(): LibraryJson | null
  updateLibraryJson(mut: (lib: LibraryJson) => void): Promise<void>
  /** Read-only library access for plugin contexts (implemented by core-A's service). */
  reader: import('@bowerbird/plugin-sdk').LibraryReader
  /** Registration channel for sources/actions/creators (ADR-016). */
  register(req: RegisterRequest, ctx: { actor: string; pluginId: string; pluginVersion: string; recordId?: string }): Promise<{ info: AssetInfo; recordId: string | null }>
  cache: { put(assetId: Guid, stage: PipelineStage, name: string, data: Uint8Array): Promise<string>; get(assetId: Guid, stage: PipelineStage, name: string): Promise<Uint8Array | null> }
}

/* ───────────────────────── query (core-B) ───────────────────────── */

export interface SearchOptions {
  /** Request comes from an agent (`agent:*` actor). */
  agent: boolean
  /** Library setting agentSearchScope. */
  scope: 'all' | 'approved'
}

export interface QueryEngine {
  search(req: SearchRequest, opts: SearchOptions): Promise<SearchResponse>
  /** Ids matching a query (batch by query, review queue), unpaged, capped. */
  ids(query: Query, cap?: number): Promise<Guid[]>
  /** Counts of the built-in views and smart folders. */
  counts(): { all: number; untagged: number; pending: number; issues: number; trash: number }
  countFor(query: Query): Promise<number>
  /** Summaries for ids in the given order (missing ids skipped). Used by every read that returns AssetSummary. */
  summaries(ids: Guid[]): AssetSummary[]
  /** Keep search providers in sync (called by the pipeline's index stage and on removal). */
  indexDocs(docs: SearchDoc[]): Promise<void>
  removeDocs(ids: Guid[]): Promise<void>
  /** Drop provider indexes (full rebuild). */
  clearProviders(): Promise<void>
}

export interface QueryEngineOptions {
  db: IndexDb
  plugins: LibraryPlugins
  /** Thumbnail URL builder for summaries (server decides the URL shape). */
  thumbnailUrl: (assetId: Guid, key: string | null) => string | null
  log: CoreLogger
}

/* ───────────────────────── pipeline (core-B) ───────────────────────── */

/** What the pipeline needs from the library service (implemented by core-A). */
export interface PipelineDeps {
  /** AssetFile for plugin calls (with readSlot resolving through slot relations). */
  assetFile(id: Guid): Promise<AssetFile | null>
  /** Store identify result (format, plugin) in the index; null = unknown format. */
  applyIdentify(id: Guid, result: IdentifyResult | null): Promise<void>
  /** Store tech/analysis/text in the index; pair slots and set `auxiliary` in the .bmeta (pipeline-and-cache.md「提取」). */
  applyProbe(id: Guid, pluginId: string, probe: ProbeResult): Promise<void>
  /** Record stored thumbnail variants (cache keys) and aspect; flips thumb_state. */
  applyThumbnails(id: Guid, stored: Partial<Record<ThumbVariant, { key: string; relPath: string; bytes: number }>>, aspect: number | null): Promise<void>
  /** Set thumb_state ('render' = waiting for a browser, ADR-025). */
  setThumbState(id: Guid, state: 'pending' | 'render' | 'ready' | 'none' | 'failed'): Promise<void>
  applyChecks(id: Guid, checks: CheckView[]): Promise<void>
  applyEnrich(id: Guid, pluginId: string, result: { tags?: string[]; description?: string }): Promise<void>
  /** Search document for the index stage. */
  searchDoc(id: Guid): Promise<SearchDoc | null>
  /** Content hashes of assets this asset references with `uses` (cache key input). */
  referencedHashes(id: Guid): Promise<string[]>
  assetDetail(id: Guid): Promise<AssetDetail | null>
  /** Pipeline state changed (flags processing/failed) — update index + emit events. */
  setProcessing(id: Guid, state: { processing: boolean; failed: boolean; error?: string; stage?: PipelineStage }): Promise<void>
  /** Raise or clear the pipeline-failed issue. */
  pipelineIssue(id: Guid, stage: PipelineStage, error: string | null): Promise<void>
  /** Kernel registration for creator outputs (same channel as POST /assets). */
  register(req: RegisterRequest, ctx: { actor: string; pluginId: string; pluginVersion: string; recordId?: string }): Promise<{ info: AssetInfo; recordId: string | null }>
}

export interface StoredThumb { key: string; relPath: string; bytes: number }

export interface Pipeline {
  start(): void
  stop(): Promise<void>
  /** Queue stages for an asset ('all' = 1..8). Higher priority runs first. */
  enqueue(id: Guid, stages: PipelineStage[] | 'all', opts?: { priority?: number; reason?: string }): void
  /** Drop queued jobs of an asset (deleted / missing). */
  forget(id: Guid): void
  /** Assets visible in some browser right now: raise their priority (pipeline-and-cache.md「优先级」). */
  markVisible(ids: Guid[]): void
  overview(): JobsResponse
  job(id: string): JobInfo | null
  cancel(id: string): void
  retry(req: { assetIds?: Guid[]; stage?: PipelineStage; failed?: boolean; jobIds?: string[] }): void
  /** Start a creation run (ADR-016). */
  startCreate(creatorId: string, req: { params: unknown; inputs: Array<{ role: string; id: Guid }>; folder?: string }, ctx: CallContext): Promise<JobInfo>
  /** Render worker: next task for a browser, visible assets first (ADR-025). */
  renderNext(visible: Guid[]): Promise<RenderTask | null>
  renderSubmit(job: string, parts: Partial<Record<ThumbVariant, Uint8Array>>, fields: { tech?: Record<string, number | string | boolean>; aspect?: number; error?: string; retryable?: boolean }): Promise<void>
  /** Absolute path of a cached thumbnail variant, or null. */
  thumbnailFile(id: Guid, variant: ThumbVariant): string | null
  cacheStats(): Promise<CacheResponse>
  cleanCache(all: boolean): Promise<CacheCleanResponse>
  /** Whether nothing is queued or running (tests). */
  idle(): Promise<void>
}

export interface PipelineOptions {
  db: IndexDb
  library: LibraryHandle
  plugins: LibraryPlugins
  query: QueryEngine
  deps: PipelineDeps
  events: EventBus
  log: CoreLogger
  /** Concurrency of local compute jobs (default cores − 1). */
  concurrency?: number
}

/* ───────────────────────── library service (core-A) ───────────────────────── */

export interface RegisterInput {
  fields: RegisterFields
  /** Uploaded content (absent when `fields.path` names an in-library file). */
  file?: { name: string; data: Uint8Array } | { name: string; tmpPath: string }
}

export interface IssueResolution { action: string; params?: Record<string, unknown> }

/** Everything one library can do; one method per library-scoped endpoint (api-and-agent.md). */
export interface LibraryService {
  readonly id: string
  readonly paths: LibraryPaths
  info(ctx: CallContext): Promise<LibraryInfo>
  patchLibrary(patch: { name?: string; settings?: Partial<LibrarySettings> }, ctx: CallContext): Promise<LibraryInfo>
  /** First open of a folder with files: register everything (stoppable; resumes next time). */
  initialize(ctx: CallContext): Promise<void>
  rescan(path: string | undefined, ctx: CallContext): Promise<void>
  stopScan(): Promise<void>
  vocabulary(): Promise<Vocabulary>

  search(req: SearchRequest, ctx: CallContext): Promise<SearchResponse>
  get(id: Guid, ctx: CallContext): Promise<AssetDetail>
  precheck(folder: string, names: string[]): Promise<PrecheckResponse>
  register(input: RegisterInput, ctx: CallContext): Promise<RegisterResponse>
  patch(id: Guid, patch: AssetPatch, ctx: CallContext): Promise<{ asset: AssetDetail; newTags: RegisterResponse['newTags'] }>
  trash(id: Guid, opts: { force: boolean }, ctx: CallContext): Promise<{ trashId: string; referrers: Guid[] }>
  replaceContent(id: Guid, file: { name: string; data: Uint8Array } | { name: string; tmpPath: string }, note: string | undefined, ctx: CallContext): Promise<AssetDetail>
  move(id: Guid, to: { folder?: string; name?: string; onConflict?: OnConflict }, ctx: CallContext): Promise<AssetDetail>
  copy(id: Guid, to: { folder?: string }, ctx: CallContext): Promise<CopyResponse>
  review(id: Guid, verdict: { status: ReviewStatus; note?: string; expectHash?: string }, ctx: CallContext): Promise<AssetDetail>
  acceptAutoTags(id: Guid, tags: string[], ctx: CallContext): Promise<AssetDetail>
  dismissAutoTags(id: Guid, tags: string[], ctx: CallContext): Promise<AssetDetail>
  /** Absolute path + size + mime of the asset file (range requests served by the server). Bundles: entry file. */
  file(id: Guid): Promise<{ absPath: string; size: number; name: string; mime: string }>
  /** Dependency file by slot name through slot relations (ADR-018). */
  slotFile(id: Guid, slot: string): Promise<{ absPath: string; size: number; name: string; mime: string } | null>
  bundleFile(id: Guid, inner: string): Promise<{ absPath: string; size: number; name: string; mime: string } | null>
  open(id: Guid, ctx: CallContext): Promise<void>
  reveal(id: Guid | null, ctx: CallContext): Promise<void>
  thumbnailFile(id: Guid, variant: ThumbVariant): Promise<string | null>
  setManualThumbnail(id: Guid, image: Uint8Array, ctx: CallContext): Promise<AssetDetail>
  clearManualThumbnail(id: Guid, ctx: CallContext): Promise<AssetDetail>
  summary(id: Guid): Promise<SummaryResponse>
  lineage(id: Guid, q: LineageQuery): Promise<Lineage>
  versions(id: Guid): Promise<VersionsResponse>
  versionFile(id: Guid, hash: string): Promise<{ stream: ReadableStream; name: string; mime: string }>
  restoreVersion(id: Guid, hash: string, ctx: CallContext): Promise<{ asset: AssetDetail; version: number; staleDownstream: number }>
  batch(req: BatchRequest, ctx: CallContext): Promise<BatchResponse>

  addRelation(id: Guid, rel: RelationInput, ctx: CallContext): Promise<AssetDetail>
  removeRelation(id: Guid, rel: { type: string; to: Guid; slot?: string }, ctx: CallContext): Promise<AssetDetail>
  replaceRelation(id: Guid, rel: { type: string; to: Guid; slot?: string; newTo: Guid }, ctx: CallContext): Promise<AssetDetail>
  acknowledgeUpstream(id: Guid, to: Guid, ctx: CallContext): Promise<AssetDetail>
  retarget(req: { from: Guid; to: Guid; types?: string[]; dryRun: boolean }, ctx: CallContext): Promise<RetargetResponse>
  createRecord(input: RecordInput, ctx: CallContext, plugin?: string): Promise<ProductionRecord>
  record(id: string): Promise<{ record: ProductionRecord; outputs: AssetSummary[] }>
  addRecordNote(id: string, text: string, ctx: CallContext): Promise<{ record: ProductionRecord; outputs: AssetSummary[] }>

  folders(): Promise<FolderNode>
  createFolder(path: string, ctx: CallContext): Promise<void>
  patchFolder(req: { path: string; rename?: string; moveTo?: string; label?: string | null; icon?: string | null; description?: string | null; defaults?: FolderDefaults | null }, ctx: CallContext): Promise<void>
  /** Assets referenced from outside the folder → CoreError('referenced', …, { referrers }) unless `force` (ADR-047). */
  trashFolder(path: string, ctx: CallContext, opts?: { force?: boolean }): Promise<{ trashed: number; batch: string | null }>
  makeBundle(path: string, entry: string | undefined, ctx: CallContext): Promise<AssetDetail>
  tags(): Promise<{ tags: TagInfo[]; groups: string[] }>
  patchTags(req: { rename?: { from: string; to: string }; merge?: { from: string; into: string }; define?: { name: string; group?: string; color?: string; aliases?: string[] }; groups?: string[] }, ctx: CallContext): Promise<{ affected: number }>
  acceptTagEverywhere(tag: string | null, ctx: CallContext): Promise<{ affected: number }>
  dismissTagEverywhere(tag: string | null, ctx: CallContext): Promise<{ affected: number }>
  views(): Promise<SmartView[]>
  putView(name: string, query: Query, rename: string | undefined, ctx: CallContext): Promise<SmartView[]>
  deleteView(name: string, ctx: CallContext): Promise<SmartView[]>

  issues(q: { type?: IssueType[]; level?: string[]; assetId?: Guid }): Promise<{ issues: Issue[]; assets: Record<string, AssetSummary>; assetCount: number; total: number }>
  resolveIssue(id: string, r: IssueResolution, ctx: CallContext): Promise<IssueResolveResponse>
  resolveIssues(r: IssueResolution & { ids?: string[]; type?: IssueType }, ctx: CallContext): Promise<IssueResolveResponse>
  relocateCandidates(issueId: string): Promise<RelocateCandidates>
  trashList(): Promise<{ items: TrashItem[]; trashDays: number }>
  /** `rename` undefined = rename automatically when the original path is taken; false = `conflict` instead. */
  restore(trashId: string, rename: boolean | undefined, ctx: CallContext): Promise<{ asset: AssetSummary; renamedTo: string | null }>
  purge(trashId: string, ctx: CallContext): Promise<void>
  emptyTrash(ctx: CallContext): Promise<void>

  /** Actions applicable to a selection, and running one (plugin-system.md「动作」). Optional until implemented. */
  actions?(ids: Guid[]): Promise<import('@bowerbird/schema').ActionInfo[]>
  runAction?(actionId: string, req: { ids: Guid[]; params?: unknown }, ctx: CallContext): Promise<JobInfo>
  creators(): Promise<CreatorInfo[]>
  startCreate(creatorId: string, req: { params: unknown; inputs: Array<{ role: string; id: Guid }>; folder?: string }, ctx: CallContext): Promise<JobInfo>
  jobs(): Promise<JobsResponse>
  job(id: string): Promise<JobInfo>
  cancelJob(id: string, ctx: CallContext): Promise<void>
  retryJobs(req: { assetIds?: Guid[]; stage?: PipelineStage; failed?: boolean; jobIds?: string[] }, ctx: CallContext): Promise<void>

  exportPlan(req: ExportRequest): Promise<ExportPlan>
  /** Copy to a directory on this machine (local only). */
  exportToDir(req: ExportRequest & { dir: string }, ctx: CallContext): Promise<{ written: number; dir: string; bytes: number }>
  /** Files to stream into a zip: [archivePath, absPath]. */
  exportFiles(req: ExportRequest): Promise<Array<[string, string]>>

  renderNext(visible: Guid[]): Promise<RenderTask | null>
  renderSubmit(job: string, parts: Partial<Record<ThumbVariant, Uint8Array>>, fields: { tech?: Record<string, number | string | boolean>; aspect?: number; error?: string; retryable?: boolean }): Promise<void>
  cache(): Promise<CacheResponse>
  cleanCache(all: boolean): Promise<CacheCleanResponse>
  /** Enable / disable a plugin for this library: declare or remove it in library.json `plugins` (builtins cannot be disabled). */
  setPluginEnabled?(pluginId: string, enabled: boolean, ctx: CallContext): Promise<void>
  pluginLibrarySettings(pluginId: string): Promise<Record<string, unknown>>
  setPluginLibrarySettings(pluginId: string, values: Record<string, unknown>, ctx: CallContext): Promise<void>
  /** Plugin routes bound to this library. */
  plugins(): LibraryPlugins

  close(): Promise<void>
}

/* ───────────────────────── hub (core-A wires everything) ───────────────────────── */

export interface HubOptions {
  /** `BOWERBIRD_HOME` or `~/.bowerbird`. */
  home: string
  builtinPluginDirs: string[]
  log?: CoreLogger
  /** Server address as seen by clients (for LibraryInfo.address / lanOpen). */
  address?: () => { host: string; port: number }
  /** Disable watchers and timers (tests). */
  watch?: boolean
  /** Override machine config values for this process (CLI flags). */
  overrides?: Partial<MachineConfig>
}

export interface Hub {
  readonly home: string
  readonly events: EventBus
  readonly plugins: PluginHost
  readonly log: CoreLogger
  config(): MachineConfig
  patchConfig(patch: Partial<MachineConfig>): Promise<ConfigResponse>
  /** A saved setting that only applies at start-up (host, port, cache dirs, concurrency) differs from what this run uses. */
  restartPending?(): boolean
  libraries(): LibraryRef[]
  defaultLibraryId(): string | null
  /** Register a folder as a library (creates nothing on disk until initialized/opened). */
  addLibrary(root: string, name?: string): Promise<LibraryRef>
  /** Open (lazily) the library service for an id. Throws CoreError('not_found'). */
  library(id: string): Promise<LibraryService>
  /** `bb init`: write .bowerbird/library.json declaring the builtin plugins. */
  initLibrary(root: string, name?: string): Promise<LibraryRef>
  health(): Promise<{ status: 'ok' | 'degraded'; libraries: Array<{ id: string; state: string; index: 'ready' | 'building'; scan?: import('@bowerbird/schema').ScanProgress }> }>
  close(): Promise<void>
}

/** Factories each line exports (wired by hub.ts). */
export type CreateQueryEngine = (opts: QueryEngineOptions) => QueryEngine
export type CreatePipeline = (opts: PipelineOptions) => Pipeline
export type CreatePluginHost = (opts: PluginHostOptions) => PluginHost
export type CreateHub = (opts: HubOptions) => Promise<Hub>

export type {
  AssetChange, AssetFile, AssetInfo, CreatorInput, FileRef, LibrarySettings, LineageQuery, ProbeResult, RegisterRequest,
  SearchDoc, Stage, TagEdit, ThumbnailSet, ViewGrid, JobAction
}
