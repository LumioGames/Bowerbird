/**
 * Server-side plugin interfaces (plugin-system.md「服务端接口」).
 * A plugin's server entry default-exports a `ServerPlugin`; in `activate` it registers implementations
 * through `ctx.register`. Built-in and third-party plugins use exactly these types — there is no private channel.
 */
import type {
  AssetDetail, AssetSummary, Guid, Hash, JobAction, PipelineStage, RegisterFields, Stage,
  ViewGrid, Query, SearchResponse, Issue, Relation, Bmeta
} from '@bowerbird/schema'

export type JsonSchema = Record<string, unknown>
export type Awaitable<T> = T | Promise<T>

/* ───────────── context ───────────── */

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

/** Read-only view of the library (assets, relations, provenance). Plugins never write the library directly. */
export interface LibraryReader {
  readonly id: string
  readonly name: string
  /** Absolute root folder (read-only use: reading files). */
  readonly root: string
  get(id: Guid): Promise<AssetDetail | null>
  getByPath(path: string): Promise<AssetDetail | null>
  search(query: Query): Promise<SearchResponse>
  /** Absolute path of an asset's file (bundle: its folder). */
  filePath(id: Guid): Promise<string | null>
  issues(assetId?: Guid): Promise<Issue[]>
}

/** Writes cache files for this plugin (`.bowerbird/cache/<stage>/…`); content-addressed, never overwritten. */
export interface CacheWriter {
  /** Store bytes under the asset's current cache key for `stage` and `name`; returns the stored path. */
  put(assetId: Guid, stage: PipelineStage, name: string, data: Uint8Array): Promise<string>
  get(assetId: Guid, stage: PipelineStage, name: string): Promise<Uint8Array | null>
}

export interface SettingsReader {
  /** Effective value: library-scoped settings from library.json, machine-scoped from the machine config. */
  get<T = unknown>(key: string): T | undefined
  all(): Record<string, unknown>
}

export interface ExecOptions { cwd?: string; timeoutMs?: number; input?: Uint8Array | string; signal?: AbortSignal }
export interface ExecResult { code: number; stdout: Uint8Array; stderr: string }

/** What changed on an asset (change notification extension point, ADR-024; phase one only defines it). */
export interface AssetChange {
  id: Guid
  fields: string[]
  by: string
  at: string
  before?: Partial<Bmeta>
  after?: Partial<Bmeta>
}

export interface PluginContext {
  readonly pluginId: string
  readonly pluginVersion: string
  readonly library: LibraryReader
  readonly cache: CacheWriter
  readonly settings: SettingsReader
  readonly log: Logger
  /**
   * A local, rebuildable data directory for this plugin and library, inside the machine data dir
   * (`~/.bowerbird/libraries/<lib>/plugins/<pluginId>/`). Never synced, never inside the library.
   * Used e.g. by the keyword search plugin for its full-text index (ADR-028).
   */
  readonly dataDir: string
  /** Local temp dir for this plugin (`~/.bowerbird/tmp/<pluginId>/`): candidates that were not picked, etc. */
  readonly tmpDir: string
  readonly events: {
    /** Subscribe to change notifications. Phase one only defines the slot (ADR-024). */
    on(event: 'asset.changed', handler: (change: AssetChange) => void): () => void
  }
  /** Run an external command-line tool; a missing tool rejects with code ENOENT and is reported in plugin settings. */
  exec(tool: string, args: string[], opts?: ExecOptions): Promise<ExecResult>
  register: {
    format(impl: FormatHandler): void
    searchProvider(impl: SearchProvider): void
    enricher(impl: Enricher): void
    source(impl: Source): void
    creator(impl: Creator): void
    validator(impl: Validator): void
    template(impl: Template): void
    action(impl: Action): void
    versionStore(impl: VersionStore): void
    auth(impl: AuthProvider): void
    route(impl: Route): void
  }
}

export interface ServerPlugin {
  activate(ctx: PluginContext): Awaitable<void>
  deactivate?(): Awaitable<void>
}

/** Identity helper with types. */
export function defineServerPlugin(plugin: ServerPlugin): ServerPlugin { return plugin }

/* ───────────── registration (the only way into the library) ───────────── */

export type FileInput =
  | { kind: 'bytes'; data: Uint8Array; name: string }
  | { kind: 'path'; /** absolute path of a local file to copy in (e.g. a temp candidate) */ path: string; name?: string }
  | { kind: 'library'; /** library-relative path of a file already in the library */ path: string }

/** Same fields as `POST /assets` (ADR-016). */
export interface RegisterRequest extends Omit<RegisterFields, 'path' | 'name'> {
  file: FileInput
  /** Target file name (defaults to the input's name). */
  name?: string
}

/* ───────────── formats ───────────── */

export interface FileRef {
  /** Absolute path on disk (bundle: the folder). */
  absPath: string
  /** Library-relative path. */
  path: string
  name: string
  ext: string
  size: number
  bundle: boolean
  /** First bytes of the file (≤ 64 KiB) for magic-number checks; empty for bundles. */
  head: Uint8Array
}

export interface MatchResult {
  /** Format id from the manifest. */
  format: string
  /** Confidence 0..1 (ties broken by manifest priority). */
  confidence?: number
}

export interface AssetFile extends FileRef {
  id: Guid
  hash: Hash
  stage: Stage
  /** Tech info from probe (available to later stages). */
  tech: Record<string, number | string | boolean>
  views: ViewGrid | null
  /** Read the whole file. */
  read(): Promise<Uint8Array>
  /**
   * Read a dependency by its slot name (texture / .bin name written in the file):
   * resolved through the `slot` relations in the .bmeta (ADR-018). Null if unresolved.
   */
  readSlot(slot: string): Promise<Uint8Array | null>
  /** Assets this asset depends on, with their slots. */
  relations: Relation[]
  /** The design object this asset belongs to, with its target size if any. */
  designObject?: { id: Guid; targetSize?: { w: number; h: number; d: number } } | null
}

export interface ProbeResult {
  tech: Record<string, number | string | boolean>
  /** Grid badge, e.g.「2,480 面」「0:03」「1024×1024」. */
  badge?: string
  /** Structured data, index only (e.g. image dominant colours). */
  analysis?: Record<string, unknown>
  /** Slot names written in the file (texture names, .bin names, embedded image names). */
  references?: string[]
  /**
   * The subset of `references` that name data packed inside the file (e.g. images in a GLB). They are paired by
   * name like the others, but an unpaired one is not「引用的文件未找到」: the file carries its own copy.
   */
  embedded?: string[]
  /** Searchable text (document body…). */
  text?: string
  auxiliary?: boolean
  /** Thumbnail aspect (w/h) known at probe time. */
  aspect?: number
}

export interface Derivative { name: string; data: Uint8Array; mime: string }

/** Server-generated thumbnail set; keys are thumbnail variants. Images are WebP; `peaks` is JSON. */
export interface ThumbnailSet {
  thumb?: Uint8Array
  preview?: Uint8Array
  poster?: Uint8Array
  scrub?: Uint8Array
  peaks?: Uint8Array
  turnaround?: Uint8Array
  /** Aspect (w/h) of `thumb`. */
  aspect?: number
}

export interface SummaryText { text: string }

export interface FormatHandler {
  /** Format id from the manifest `contributes.formats`. */
  id: string
  /** Read the file head and decide whether to claim it; null = not mine. */
  match(file: FileRef): Promise<MatchResult | null>
  probe?(asset: AssetFile): Promise<ProbeResult>
  derive?(asset: AssetFile): Promise<Derivative[]>
  /** Server thumbnails; browser-rendered formats do not implement this. */
  thumbnail?(asset: AssetFile): Promise<ThumbnailSet>
  summarize?(asset: AssetFile): Promise<SummaryText>
}

/* ───────────── search ───────────── */

export interface SearchDoc {
  id: Guid
  name: string
  /** Name without extension. */
  stem: string
  path: string
  folder: string
  tags: string[]
  autoTags: string[]
  description: string
  autoDescription: string
  prompts: string[]
  text: string
  format: string
}

export interface IdSet { has(id: Guid): boolean; readonly size: number; [Symbol.iterator](): Iterator<Guid> }

export interface ScoredHit {
  id: Guid
  score: number
  /** Where the hit was found outside the name, with highlight ranges (for「命中片段」). */
  snippet?: { field: 'prompt' | 'description' | 'text' | 'tags' | 'path' | 'name'; text: string; ranges: Array<[number, number]> }
}

export interface SearchProvider {
  id: string
  index(docs: SearchDoc[]): Promise<void>
  remove(ids: Guid[]): Promise<void>
  /** `candidates`: ids that passed the structured filter; absent = whole library. */
  query(q: string, opts: { candidates?: IdSet; limit: number }): Promise<ScoredHit[]>
  /** Drop everything (index rebuild). */
  clear?(): Promise<void>
}

/* ───────────── enrichers, validators, templates ───────────── */

export interface AssetInfo extends AssetSummary {}
export interface NamedVector { name: string; model: string; values: Float32Array | number[] }

export interface Enricher {
  id: string
  appliesTo(asset: AssetInfo): boolean
  enrich(asset: AssetFile): Promise<{ tags?: string[]; description?: string; vectors?: NamedVector[] }>
}

export interface CheckResult {
  rule: string
  verdict: 'pass' | 'warn' | 'fail'
  message: string
  values?: Record<string, unknown>
}

/** Results are display-only; they never change the review status (ADR-020). */
export interface Validator {
  id: string
  appliesTo(asset: AssetInfo): boolean
  check(asset: AssetFile): Promise<CheckResult[]>
}

export interface Template {
  id: string
  displayName: string
  appliesTo(asset: AssetInfo): boolean
  fields: JsonSchema
  slots: Array<{ name: string; relationType: string; formats?: string[]; stage?: Stage; required: boolean }>
}

/* ───────────── actions, sources, creators ───────────── */

export interface ActionContext { actor: string; log: Logger; signal: AbortSignal }
export interface ActionResult {
  /** New assets, registered by the kernel one by one. */
  assets?: RegisterRequest[]
  message?: string
}
export interface Action {
  id: string
  title: string
  appliesTo(selection: AssetInfo[]): boolean
  params?: JsonSchema
  run(selection: AssetInfo[], params: unknown, ctx: ActionContext): Promise<ActionResult>
}

export type IngestFn = (request: RegisterRequest) => Promise<AssetInfo>
export interface Source {
  id: string
  start(ingest: IngestFn): Promise<void>
  stop(): Promise<void>
}

export interface CreatorInputSpec {
  /** Written as the `role` of the output's source relation to this input (ADR-070). */
  role: string
  formats?: string[]
  /** The input must be a turnaround sheet: an asset whose .bmeta has a view grid (`views`, ADR-019). */
  views?: boolean
  required: boolean
}

export interface Creator {
  id: string
  displayName: string
  params: JsonSchema
  inputs: CreatorInputSpec[]
  /** Open this plugin page (ui.pages id) instead of the generated form. */
  page?: string
  run(request: CreateRequest, job: JobContext): Promise<void>
}

export interface CreateRequest {
  params: unknown
  inputs: Array<{ role: string; asset: AssetInfo }>
  /** Folder chosen in the form (default: current folder). */
  folder?: string
  actor: string
}

export interface JobContext {
  readonly id: string
  /** 0..1 plus a sentence; `action` asks the user for a follow-up in a plugin page (e.g. pick candidates). */
  progress(value: number, message?: string, action?: JobAction): void
  readonly signal: AbortSignal
  /**
   * Register one output through the kernel. Every output of one run gets the run's provenance in its own .bmeta,
   * with the same `batch` id (ADR-070): give `provenance` on an output to say more (tool, prompt, params), otherwise
   * the kernel writes `method = <pluginId>/<creatorId>` with the run's params. The run's inputs become source
   * relations of each output, with their roles, unless the output names its own relations.
   */
  register(output: RegisterRequest): Promise<AssetInfo>
}

/* ───────────── access control (slot only, ADR-023) ───────────── */

export interface IncomingRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  remoteAddress: string
  isLocal: boolean
}
export interface AuthDecision { allow: boolean; actor?: string; status?: number; message?: string }
export interface AuthProvider {
  id: string
  check(request: IncomingRequest): Promise<AuthDecision>
}

/* ───────────── plugin routes ───────────── */

export interface RouteRequest {
  method: string
  /** Path after `/plugins/{id}/`. */
  path: string
  params: Record<string, string>
  query: Record<string, string | string[]>
  headers: Record<string, string | string[] | undefined>
  body: unknown
  actor: string
  isLocal: boolean
  library: LibraryReader | null
}
export interface RouteResponse {
  status?: number
  headers?: Record<string, string>
  /** Object → JSON; Uint8Array/string → raw. */
  body?: unknown
}
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Relative to `/plugins/{id}/`; `:name` params allowed. */
  path: string
  handler(request: RouteRequest): Promise<RouteResponse>
}

/* ───────────── version store (versioning.md) ───────────── */

export interface LibraryInfoLite { id: string; name: string; root: string }
export interface VersionStoreStatus { ready: boolean; dirty: boolean; remoteReachable?: boolean; message?: string }
export interface ChangeSet { paths: string[] }
export interface CommitMeta { actor: string; message: string; at: string }
export type VersionPointId = string
export interface VersionPoint { id: VersionPointId; at: string; actor: string; message: string; hash?: Hash }
export interface SyncResult { pushed: number; pulled: number; conflicts: string[] }
export interface VersionStore {
  id: string
  init(library: LibraryInfoLite): Promise<void>
  status(): Promise<VersionStoreStatus>
  commit(changes: ChangeSet, meta: CommitMeta): Promise<VersionPoint>
  history(path: string, opts?: { limit?: number }): Promise<VersionPoint[]>
  read(path: string, point: VersionPointId): Promise<ReadableStream>
  has(path: string, hash: string): Promise<boolean>
  sync?(): Promise<SyncResult>
}
