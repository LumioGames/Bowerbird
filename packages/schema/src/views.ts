/**
 * Read models returned by the HTTP API (api-and-agent.md, search.md「结果」, web-shell.md).
 * These are derived views; the source of truth stays in the library folder.
 */
import { z } from 'zod'
import { Actor, CompareMode, Guid, Hash, IsoTime, JobStatus, PipelineStage, ReviewStatus, Stage, ThumbVariant, ViewGrid } from './primitives.js'
import { AutoInfo, FolderDefaults, LibrarySettings, ProductionRecord, Review, VersionEntry } from './disk.js'
import { IssueType, Query } from './query.js'

/* ───────────── issues ───────────── */

export const ISSUE_LEVELS = ['error', 'warning', 'info'] as const
export const IssueLevel = z.enum(ISSUE_LEVELS)
export type IssueLevel = z.infer<typeof IssueLevel>

/** Level per type (sync-and-integrity.md「完整性问题」). */
export const ISSUE_LEVEL_OF: Readonly<Record<IssueType, IssueLevel>> = {
  'broken-reference': 'error',
  'missing-file': 'error',
  'duplicate-guid': 'error',
  'metadata-conflict': 'error',
  'stale-upstream': 'warning',
  'orphan-sidecar': 'warning',
  'pipeline-failed': 'warning',
  'plugin-missing': 'warning',
  'thumbnail-stale': 'info',
  'duplicate-content': 'info'
}

/**
 * Actions an issue can be resolved with through `POST /issues/{id}/resolve`.
 * UI-only actions (jump to graph, open compare, open replace dialog, open plugin settings) are not listed:
 * they lead to other endpoints.
 */
export const ISSUE_ACTIONS = {
  'broken-reference': ['remove-relation', 'restore-target'],
  'missing-file': ['relocate', 'confirm-deleted'],
  'duplicate-guid': ['confirm', 'swap'],
  'metadata-conflict': ['keep-local', 'keep-conflict'],
  'stale-upstream': ['acknowledge'],
  'orphan-sidecar': ['relocate', 'trash'],
  'pipeline-failed': ['retry'],
  'plugin-missing': [],
  'thumbnail-stale': ['clear-thumbnail'],
  'duplicate-content': ['ignore', 'mark-copy']
} as const satisfies Record<IssueType, readonly string[]>
export type IssueAction = (typeof ISSUE_ACTIONS)[IssueType][number]

export const Issue = z.object({
  /** Stable id derived from the cause, so the same cause keeps the same id. */
  id: z.string(),
  type: IssueType,
  level: IssueLevel,
  assetId: Guid.nullable(),
  /** The relation involved (broken-reference, stale-upstream). */
  relation: z.object({ type: z.string(), to: Guid, slot: z.string().optional() }).optional(),
  /** Library-relative path involved (missing file, orphan sidecar, conflict copy). */
  path: z.string().optional(),
  /** Type-specific facts for the UI text, e.g. { toName, fromVersion, toVersion, plugin, range, stage, error, otherId }. */
  details: z.record(z.string(), z.unknown()).default({}),
  foundAt: IsoTime
})
export type Issue = z.infer<typeof Issue>

/* ───────────── assets ───────────── */

export const ASSET_FLAGS = ['stale', 'broken', 'missing', 'processing', 'failed'] as const
export const AssetFlag = z.enum(ASSET_FLAGS)
export type AssetFlag = z.infer<typeof AssetFlag>

/** Where the grid thumbnail stands (web-shell.md「状态呈现」, ADR-025). */
export const THUMB_STATES = ['ready', 'pending', 'render', 'none', 'failed'] as const
export const ThumbState = z.enum(THUMB_STATES)
export type ThumbState = z.infer<typeof ThumbState>

/** A search hit outside the name: which field, the excerpt, and highlighted ranges within it. */
export const HitSnippet = z.object({
  field: z.enum(['prompt', 'description', 'text', 'tags', 'path', 'name']),
  text: z.string(),
  ranges: z.array(z.tuple([z.number().int(), z.number().int()]))
})
export type HitSnippet = z.infer<typeof HitSnippet>

/**
 * Compact asset summary: search results, grid cells, relation endpoints.
 * Fixed fields from search.md plus the few the grid needs to draw every cell state.
 */
export const AssetSummary = z.object({
  id: Guid,
  name: z.string(),
  path: z.string(),
  /** Format id from the claiming plugin, or `unknown`. */
  format: z.string(),
  /** Plugin id that claimed the file, if any. */
  plugin: z.string().nullable(),
  stage: Stage,
  /** Effective review status. */
  review: ReviewStatus,
  tags: z.array(z.string()),
  autoTags: z.array(z.string()),
  /** First sentence of the description, human first. */
  description: z.string().nullable(),
  flags: z.array(AssetFlag),
  /** Thumbnail URL (immutable, cache-keyed) or null. */
  thumbnail: z.string().nullable(),
  thumbState: ThumbState,
  /** Thumbnail aspect (w/h) for masonry layout before the image loads. */
  aspect: z.number().nullable(),
  /** Badge text from the format plugin, e.g. `2,480 面`, `0:03`, `1024×1024`. */
  badge: z.string().nullable(),
  /** Highest error/warning/info issue level on this asset, and how many. */
  issueLevel: z.enum(['error', 'warning', 'info']).nullable(),
  issueCount: z.number().int(),
  size: z.number(),
  modified: IsoTime,
  created: IsoTime,
  createdBy: Actor,
  bundle: z.boolean(),
  auxiliary: z.boolean(),
  /** Number of assets that belong to this one (design objects have > 0). */
  memberCount: z.number().int(),
  /** Text cell content for formats without an image thumbnail (documents). */
  cellText: z.object({ title: z.string().optional(), excerpt: z.string().optional() }).nullable(),
  /** Missing plugin that would read this file (ADR-012). */
  missingPlugin: z.object({ id: z.string(), range: z.string().optional(), displayName: z.string().optional() }).nullable(),
  /** True when the asset is a turnaround sheet: its .bmeta has a view grid (`views`, ADR-019). Absent = no grid. */
  hasViews: z.boolean().optional(),
  /** Only with a query word: relevance and the snippet that matched outside the name. */
  score: z.number().optional(),
  hit: HitSnippet.optional()
})
export type AssetSummary = z.infer<typeof AssetSummary>

/** One edge as seen from an asset. */
export const RelationView = z.object({
  type: z.string(),
  /** Initiator ("I depend on…"). */
  from: Guid,
  to: Guid,
  /** Other end; null when the target no longer exists (broken). */
  target: AssetSummary.nullable(),
  /** Last known name of the target (for broken links). */
  targetName: z.string().nullable(),
  /** Target is in the trash (broken but restorable). */
  targetInTrash: z.boolean(),
  slot: z.string().optional(),
  note: z.string().optional(),
  toHash: Hash.optional(),
  record: z.string().optional(),
  broken: z.boolean(),
  stale: z.boolean(),
  /** For stale source relations: version numbers (1-based) the relation points at and the target is now at. */
  staleFrom: z.number().int().optional(),
  staleTo: z.number().int().optional()
})
export type RelationView = z.infer<typeof RelationView>

export const CheckView = z.object({
  validator: z.string(),
  rule: z.string(),
  verdict: z.enum(['pass', 'warn', 'fail']),
  message: z.string(),
  /** Measured values for display, e.g. { model: [1.3,0.95,0.87], target: [1.26,0.95,0.87] }. */
  values: z.record(z.string(), z.unknown()).optional()
})
export type CheckView = z.infer<typeof CheckView>

export const VersionView = VersionEntry.extend({
  /** 1-based version number in record order. */
  n: z.number().int(),
  current: z.boolean(),
  /** A version plugin holds this content (can preview, compare, restore). */
  hasContent: z.boolean(),
  /** Set when the note is a restore: the version number restored from. */
  restoredFrom: z.number().int().optional()
})
export type VersionView = z.infer<typeof VersionView>

export const BundleFile = z.object({ path: z.string(), size: z.number(), entry: z.boolean() })
export type BundleFile = z.infer<typeof BundleFile>

export const AssetDetail = AssetSummary.extend({
  hash: Hash,
  /** Human description in full, and the AI one. */
  descriptionFull: z.string().nullable(),
  auto: AutoInfo.nullable(),
  fields: z.record(z.string(), z.record(z.string(), z.unknown())),
  /** Latest human verdict (who, when, note); `review` above is the effective status. */
  reviewVerdict: Review.nullable(),
  versions: z.array(VersionEntry),
  views: ViewGrid.nullable(),
  thumbnailManual: z.boolean(),
  origin: z.string().nullable(),
  modifiedBy: Actor.nullable(),
  /** Tech info from the format plugin (index only). */
  tech: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  /** Analysis per plugin id (index only). */
  analysis: z.record(z.string(), z.record(z.string(), z.unknown())),
  /** Unresolved reference names found in the file (「引用的文件未找到」). */
  unresolvedRefs: z.array(z.string()),
  checks: z.array(CheckView),
  relations: z.object({ outgoing: z.array(RelationView), incoming: z.array(RelationView) }),
  issues: z.array(Issue),
  /** The production record that made it (origin or first source relation with a record). */
  record: ProductionRecord.nullable(),
  bundleFiles: z.array(BundleFile).nullable(),
  /** Design object target size from its front matter (documents) or the one this asset belongs to. */
  targetSize: z.object({ w: z.number(), h: z.number(), d: z.number(), from: Guid }).nullable(),
  /** Pipeline state per stage, for「处理中 / 失败」display. */
  stages: z.array(z.object({ stage: PipelineStage, status: JobStatus, error: z.string().optional() }))
})
export type AssetDetail = z.infer<typeof AssetDetail>

/* ───────────── lineage ───────────── */

export const LineageEdge = z.object({
  type: z.string(),
  from: Guid,
  to: Guid,
  slot: z.string().optional(),
  note: z.string().optional(),
  broken: z.boolean(),
  stale: z.boolean(),
  record: z.string().optional()
})
export type LineageEdge = z.infer<typeof LineageEdge>

export const Lineage = z.object({
  center: Guid,
  /** Existing assets; broken targets appear only as edge ends with a `missing` entry. */
  nodes: z.array(AssetSummary),
  missing: z.array(z.object({ id: Guid, name: z.string().nullable(), inTrash: z.boolean() })),
  edges: z.array(LineageEdge),
  records: z.record(z.string(), ProductionRecord)
})
export type Lineage = z.infer<typeof Lineage>

/* ───────────── folders, tags, views, trash ───────────── */

export interface FolderNode {
  path: string
  name: string
  label?: string
  icon?: string
  description?: string
  /** Assets in this folder and below. */
  count: number
  /** Latest modification time of assets inside (web-shell.md 文件夹形态). */
  modified: string | null
  defaults?: z.infer<typeof FolderDefaults>
  /** Defaults after inheritance, and which folder each item comes from. */
  effectiveDefaults: { stage?: string; review?: string; tags?: string[]; from: Record<string, string> }
  isBundle?: boolean
  children: FolderNode[]
}
export const FolderNode: z.ZodType<FolderNode> = z.lazy(() => z.object({
  path: z.string(),
  name: z.string(),
  label: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  count: z.number().int(),
  modified: z.string().nullable(),
  defaults: FolderDefaults.optional(),
  effectiveDefaults: z.object({ stage: z.string().optional(), review: z.string().optional(), tags: z.array(z.string()).optional(), from: z.record(z.string(), z.string()) }),
  isBundle: z.boolean().optional(),
  children: z.array(FolderNode)
})) as z.ZodType<FolderNode>

export const TagInfo = z.object({
  name: z.string(),
  /** Assets carrying it as a human tag. */
  count: z.number().int(),
  /** Assets carrying it only as an unadopted AI tag. */
  aiCount: z.number().int(),
  group: z.string().optional(),
  color: z.string().optional(),
  aliases: z.array(z.string()).optional()
})
export type TagInfo = z.infer<typeof TagInfo>

export const SmartView = z.object({
  name: z.string(),
  builtin: z.boolean(),
  query: Query,
  count: z.number().int()
})
export type SmartView = z.infer<typeof SmartView>

export const TrashItem = z.object({
  id: z.string(),
  assetId: Guid,
  name: z.string(),
  originalPath: z.string(),
  folder: z.string(),
  format: z.string(),
  stage: Stage,
  review: ReviewStatus,
  size: z.number(),
  thumbnail: z.string().nullable(),
  deletedAt: IsoTime,
  deletedBy: Actor,
  /** Whole days left before automatic purge. */
  daysLeft: z.number().int(),
  /** Assets still referencing it. */
  referencedBy: z.number().int(),
  recordOnly: z.boolean(),
  batch: z.string().optional()
})
export type TrashItem = z.infer<typeof TrashItem>

/* ───────────── jobs, creators, plugins ───────────── */

export const JobAction = z.object({
  label: z.string(),
  /** Plugin page id to open (registered through ui.pages). */
  page: z.string(),
  params: z.record(z.string(), z.string()).optional()
})
export type JobAction = z.infer<typeof JobAction>

export const JobInfo = z.object({
  id: z.string(),
  kind: z.enum(['process', 'create', 'render', 'action']),
  /** Action jobs: the action id (`pluginId:actionId`) and the selection it ran on. */
  actionId: z.string().optional(),
  stage: PipelineStage.optional(),
  assetId: Guid.optional(),
  assetName: z.string().optional(),
  creator: z.string().optional(),
  creatorName: z.string().optional(),
  pluginId: z.string().optional(),
  status: JobStatus,
  progress: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
  /** A follow-up the plugin asks the user for (e.g. pick candidates). */
  action: JobAction.optional(),
  error: z.string().optional(),
  /** Whether retrying can help (e.g. an undecodable codec cannot). */
  retryable: z.boolean().optional(),
  attempts: z.number().int(),
  outputs: z.array(Guid),
  createdAt: IsoTime,
  updatedAt: IsoTime,
  by: Actor.optional()
})
export type JobInfo = z.infer<typeof JobInfo>

export const StageStats = z.object({
  stage: PipelineStage,
  queued: z.number().int(),
  running: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  /** Items per minute over the last few minutes. */
  rate: z.number(),
  /** No plugin handles this stage (e.g. enrich in phase one) — hide it. */
  idle: z.boolean()
})
export type StageStats = z.infer<typeof StageStats>

export const ScanProgress = z.object({
  running: z.boolean(),
  phase: z.enum(['idle', 'walking', 'hashing', 'reconciling', 'registering', 'stopped', 'done']),
  done: z.number().int(),
  total: z.number().int(),
  current: z.string().optional(),
  startedAt: IsoTime.optional(),
  finishedAt: IsoTime.optional()
})
export type ScanProgress = z.infer<typeof ScanProgress>

/** A plugin action that applies to the current selection (right-click menu item, plugin-system.md「动作」). */
export const ActionInfo = z.object({
  /** `pluginId:actionId`. */
  id: z.string(),
  pluginId: z.string(),
  pluginName: z.string(),
  title: z.string(),
  /** JSON Schema of the parameter form; absent = run directly. */
  params: z.record(z.string(), z.unknown()).optional()
})
export type ActionInfo = z.infer<typeof ActionInfo>

/** `views`: the input must be a turnaround sheet (an asset with a view grid, `AssetSummary.hasViews`). */
export const CreatorInput = z.object({ role: z.string(), formats: z.array(z.string()).optional(), views: z.boolean().optional(), required: z.boolean() })
export type CreatorInput = z.infer<typeof CreatorInput>

export const CreatorInfo = z.object({
  id: z.string(),
  pluginId: z.string(),
  pluginName: z.string(),
  displayName: z.string(),
  /** JSON Schema of the parameter form. */
  params: z.record(z.string(), z.unknown()),
  inputs: z.array(CreatorInput),
  /** Creator opens its own plugin page instead of the generated form. */
  page: z.string().optional()
})
export type CreatorInfo = z.infer<typeof CreatorInfo>

export const PLUGIN_STATUSES = ['enabled', 'disabled', 'failed', 'missing'] as const
export const PluginInfo = z.object({
  id: z.string(),
  /** npm package name. */
  packageName: z.string(),
  version: z.string().nullable(),
  displayName: z.string(),
  description: z.string().optional(),
  builtin: z.boolean(),
  status: z.enum(PLUGIN_STATUSES),
  /** Why it failed to load / why it is missing. */
  reason: z.string().optional(),
  /** Version range the library requires. */
  required: z.string().optional(),
  /** Extension point keys it contributes (formats, creators, …). */
  contributes: z.array(z.string()),
  formats: z.array(z.object({ id: z.string(), displayName: z.string(), extensions: z.array(z.string()) })),
  hasWeb: z.boolean(),
  /** Settings JSON Schema (properties carry `scope`). */
  settings: z.record(z.string(), z.unknown()).nullable(),
  /** Settings pages registered by the web part are discovered client side. */
  missingTools: z.array(z.string()),
  consecutiveFailures: z.object({ count: z.number().int(), reason: z.string() }).nullable(),
  update: z.object({ version: z.string() }).nullable(),
  source: z.enum(['builtin', 'npm', 'path']),
  installPath: z.string().optional(),
  /** The manifest's translations of the plugin's text (`PluginManifest.l10n`), for the shell to show it in its language. */
  l10n: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  /** The language the plugin's text is written in (`PluginManifest.sourceLocale`); absent = `zh-CN`. */
  sourceLocale: z.string().optional()
})
export type PluginInfo = z.infer<typeof PluginInfo>

/* ───────────── libraries & config ───────────── */

export const LIBRARY_STATES = ['ready', 'uninitialized', 'read-only', 'unavailable'] as const
export const LibraryRef = z.object({
  /** Library id in URLs; equals the library GUID, or a slug before initialization. */
  id: z.string(),
  name: z.string(),
  root: z.string(),
  state: z.enum(LIBRARY_STATES)
})
export type LibraryRef = z.infer<typeof LibraryRef>

export const FirstOpenPreview = z.object({
  files: z.number().int(),
  folders: z.number().int(),
  /** Formats no installed plugin can read, with counts (they are still registered). */
  unsupported: z.array(z.object({ ext: z.string(), count: z.number().int(), hint: z.string().optional() }))
})
export type FirstOpenPreview = z.infer<typeof FirstOpenPreview>

export const LibraryInfo = LibraryRef.extend({
  formatVersion: z.number().int().nullable(),
  settings: LibrarySettings.nullable(),
  /** Plugins declared in library.json, with whether this machine has them. */
  requiredPlugins: z.array(z.object({ id: z.string(), range: z.string(), installed: z.boolean(), enabled: z.boolean() })),
  stats: z.object({ assets: z.number().int(), bytes: z.number(), issues: z.number().int(), issueAssets: z.number().int() }),
  /** Counts of the built-in views. */
  counts: z.object({ all: z.number().int(), untagged: z.number().int(), pending: z.number().int(), issues: z.number().int(), trash: z.number().int() }),
  /** The request comes from the machine the server runs on (ADR-023). */
  isLocal: z.boolean(),
  /** A version store plugin is enabled. */
  versionStore: z.object({ id: z.string(), displayName: z.string() }).nullable(),
  /** Any creator is available → toolbar shows「新建」. */
  hasCreators: z.boolean(),
  firstOpen: FirstOpenPreview.nullable(),
  scan: ScanProgress,
  /** Server is listening beyond loopback (show the LAN warning). */
  lanOpen: z.boolean(),
  address: z.string(),
  /** File watching: native recursive, per directory, or off (too many folders / unsupported) with the reason; periodic scans cover it. */
  watch: z.object({ enabled: z.boolean(), mode: z.string(), reason: z.string().optional(), dirs: z.number().int().optional() }).optional()
})
export type LibraryInfo = z.infer<typeof LibraryInfo>

export const MachineConfig = z.looseObject({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().default(7420),
  libraries: z.array(z.object({ id: z.string(), root: z.string(), name: z.string().optional() })).default([]),
  /** Per-library cache dir override (library id → absolute path). */
  cacheDirs: z.record(z.string(), z.string()).default({}),
  scanIntervalMinutes: z.number().int().min(1).default(10),
  /** Concurrency of local compute jobs; default cores − 1. */
  concurrency: z.number().int().min(1).optional(),
  /** Extra allowed origins for CORS (none by default). */
  allowedOrigins: z.array(z.string()).default([]),
  /** Machine-scoped plugin settings, keyed by plugin id. */
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** Plugins installed from npm or a path (builtin ones are not listed). */
  installed: z.array(z.object({ id: z.string(), spec: z.string(), source: z.enum(['npm', 'path']) })).default([])
})
export type MachineConfig = z.infer<typeof MachineConfig>

export const Vocabulary = z.object({
  stages: z.array(z.object({ id: Stage, name: z.string() })),
  reviews: z.array(z.object({ id: ReviewStatus, name: z.string() })),
  formats: z.array(z.object({ id: z.string(), displayName: z.string(), plugin: z.string().nullable(), count: z.number().int() })),
  relationTypes: z.array(z.object({ id: z.string(), name: z.string(), inverseName: z.string(), tracksVersion: z.boolean(), plugin: z.string().nullable() })),
  tags: z.array(z.object({ name: z.string(), count: z.number().int() })),
  methods: z.array(z.object({ id: z.string(), count: z.number().int() })),
  actors: z.array(z.object({ id: z.string(), count: z.number().int() })),
  templates: z.array(z.object({ id: z.string(), displayName: z.string(), plugin: z.string() })),
  designObjects: z.array(z.object({ id: Guid, name: z.string(), title: z.string().optional() }))
})
export type Vocabulary = z.infer<typeof Vocabulary>

export const CompareModeSupport = z.object({ mode: CompareMode, available: z.boolean(), reason: z.string().optional(), default: z.boolean().optional() })
export type CompareModeSupport = z.infer<typeof CompareModeSupport>

export const ThumbVariantInfo = z.object({ variant: ThumbVariant, url: z.string() })
export type ThumbVariantInfo = z.infer<typeof ThumbVariantInfo>
