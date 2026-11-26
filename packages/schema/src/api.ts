/**
 * HTTP API requests and responses (api-and-agent.md). Base path `/api/v1`.
 * Library-scoped endpoints live under `/libraries/{library}`; plugin management, machine config
 * and the library list are global. Every client (web shell, CLI, MCP) uses these definitions.
 */
import { z } from 'zod'
import { Guid, Hash, ReviewStatus, Stage, ViewGrid, PipelineStage, ThumbVariant } from './primitives.js'
import { FolderDefaults, LibrarySettings, ProductionRecord, TagDef } from './disk.js'
import { Query, IssueType } from './query.js'
import {
  ActionInfo, AssetDetail, AssetSummary, CreatorInfo, FolderNode, Issue, IssueLevel, JobInfo, LibraryInfo, LibraryRef, Lineage,
  MachineConfig, PluginInfo, ScanProgress, SmartView, StageStats, TagInfo, TrashItem, VersionView, Vocabulary
} from './views.js'

/* ───────────── errors ───────────── */

export const ERROR_CODES = {
  not_found: 404,
  not_local: 403,
  validation_failed: 400,
  conflict: 409,
  referenced: 409,
  cycle: 409,
  unsupported: 501,
  read_only: 403,
  /** Refused by the Host/Origin check or an access-control plugin. */
  forbidden: 403,
  /** Range request outside the file. */
  range_not_satisfiable: 416,
  internal: 500
} as const
export type ErrorCode = keyof typeof ERROR_CODES
export const ApiError = z.object({
  error: z.object({
    code: z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional()
  })
})
export type ApiError = z.infer<typeof ApiError>

/* ───────────── shared inputs ───────────── */

export const RelationInput = z.object({
  type: z.string().min(1),
  to: Guid,
  slot: z.string().optional(),
  note: z.string().optional(),
  /** Existing record id (source relations only). */
  record: z.string().optional()
})
export type RelationInput = z.infer<typeof RelationInput>

/** A production record as given by a client; the kernel adds id, input hashes, `plugin`, by and at. */
export const RecordInput = z.object({
  method: z.string().min(1),
  tool: z.string().optional(),
  prompt: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  inputs: z.array(z.object({ id: Guid, role: z.string().optional() })).optional(),
  note: z.string().optional()
})
export type RecordInput = z.infer<typeof RecordInput>

export const ON_CONFLICT = ['replace', 'keep-both', 'skip'] as const
export const OnConflict = z.enum(ON_CONFLICT)
export type OnConflict = z.infer<typeof OnConflict>

/**
 * Registration fields (`POST /assets`). The same structure is `RegisterRequest` for plugins (ADR-016):
 * with HTTP, the file travels as a multipart part named `file` and these fields as a JSON part named `meta`;
 * or `path` names a file already inside the library.
 */
export const RegisterFields = z.object({
  /** Library-relative path of a file already in the library (instead of uploading). */
  path: z.string().optional(),
  /** Target folder (library-relative, '' = root). */
  folder: z.string().optional(),
  /** File name to write (defaults to the uploaded name); may include sub folders to keep structure. */
  name: z.string().optional(),
  stage: Stage.optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  relations: z.array(RelationInput).optional(),
  record: z.union([RecordInput, z.string()]).optional(),
  views: ViewGrid.optional(),
  /** Review default override: `exempt` for review-free uploads. */
  review: z.enum(['pending', 'exempt']).optional(),
  onConflict: OnConflict.optional()
})
export type RegisterFields = z.infer<typeof RegisterFields>

export const RegisterResponse = z.object({
  /** Null when skipped. */
  asset: AssetDetail.nullable(),
  skipped: z.boolean(),
  recordId: z.string().nullable(),
  /** Tags not seen in the library before, each with similar existing tags (tag governance). */
  newTags: z.array(z.object({ tag: z.string(), similar: z.array(z.string()) }))
})
export type RegisterResponse = z.infer<typeof RegisterResponse>

/* ───────────── search ───────────── */

export const SearchRequest = Query.extend({
  /** Return facet counts (format, stage, review, tags). */
  facets: z.boolean().optional()
})
export type SearchRequest = z.infer<typeof SearchRequest>

export const FacetCount = z.object({ value: z.string(), count: z.number().int() })
export const SearchResponse = z.object({
  items: z.array(AssetSummary),
  /** Estimated total matches. */
  total: z.number().int(),
  cursor: z.string().nullable(),
  facets: z.object({
    format: z.array(FacetCount),
    stage: z.array(FacetCount),
    review: z.array(FacetCount),
    tags: z.array(FacetCount)
  }).optional(),
  /** Agent scope narrowed to approved + exempt because the library says so and no review filter was given. */
  scopedToApproved: z.boolean().optional()
})
export type SearchResponse = z.infer<typeof SearchResponse>

/* ───────────── assets ───────────── */

export const PrecheckRequest = z.object({ folder: z.string(), names: z.array(z.string()) })
export const PrecheckResponse = z.object({ conflicts: z.array(z.object({ name: z.string(), existing: AssetSummary })) })
export type PrecheckResponse = z.infer<typeof PrecheckResponse>

export const TagEdit = z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional(), set: z.array(z.string()).optional() })
export type TagEdit = z.infer<typeof TagEdit>

export const AssetPatch = z.object({
  tags: TagEdit.optional(),
  description: z.string().optional(),
  stage: Stage.optional(),
  fields: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  auxiliary: z.boolean().optional(),
  views: ViewGrid.nullable().optional()
})
export type AssetPatch = z.infer<typeof AssetPatch>
export const AssetPatchResponse = z.object({ asset: AssetDetail, newTags: RegisterResponse.shape.newTags })

export const DeleteResponse = z.object({ trashId: z.string(), referrers: z.array(Guid) })
export const ContentReplaceFields = z.object({ note: z.string().optional() })
export const MoveRequest = z.object({ folder: z.string().optional(), name: z.string().optional(), onConflict: OnConflict.optional() })
export const CopyRequest = z.object({ folder: z.string().optional() })
export const CopyResponse = z.object({
  asset: AssetDetail,
  name: z.string(),
  /** The original is referenced by others; their references still point at the original. */
  originalReferenced: z.boolean(),
  /** Ready-to-show sentence:「已复制为 {副本名}」/「…，原来的引用仍指向原件」. */
  message: z.string()
})
export type CopyResponse = z.infer<typeof CopyResponse>

export const ReviewRequest = z.object({
  status: ReviewStatus,
  /** Required when rejecting. */
  note: z.string().optional(),
  /** Optimistic check for the review queue: fail with `conflict` if someone already reviewed this content. */
  expectHash: Hash.optional()
})
export type ReviewRequest = z.infer<typeof ReviewRequest>

export const TagNamesRequest = z.object({ tags: z.array(z.string()).min(1) })

export const SummaryResponse = z.object({
  text: z.string(),
  image: z.string().nullable(),
  /** Why there is no overview image yet, e.g.「概览图还没有渲染，有人打开页面后才会生成」. */
  imageMissingReason: z.string().optional()
})
export type SummaryResponse = z.infer<typeof SummaryResponse>

export const LineageQuery = z.object({
  direction: z.enum(['up', 'down', 'both']).default('up'),
  types: z.array(z.string()).default(['source']),
  depth: z.number().int().min(1).max(50).default(5)
})
export type LineageQuery = z.infer<typeof LineageQuery>

export const VersionsResponse = z.object({
  versions: z.array(VersionView),
  /** Enabled version store plugin, null without one (records only). */
  store: z.object({ id: z.string(), displayName: z.string() }).nullable()
})
export type VersionsResponse = z.infer<typeof VersionsResponse>
export const RestoreResponse = z.object({ asset: AssetDetail, version: z.number().int(), staleDownstream: z.number().int() })

export const BatchRequest = z.object({
  ids: z.array(Guid).optional(),
  query: Query.optional(),
  patch: z.object({
    tags: TagEdit.optional(),
    stage: Stage.optional(),
    review: z.object({ status: ReviewStatus, note: z.string().optional() }).optional(),
    move: z.object({ folder: z.string(), onConflict: OnConflict.optional() }).optional(),
    trash: z.boolean().optional(),
    force: z.boolean().optional()
  })
})
export type BatchRequest = z.infer<typeof BatchRequest>
export const BatchResponse = z.object({
  updated: z.array(Guid),
  failed: z.array(z.object({ id: Guid, code: z.string(), message: z.string() }))
})
export type BatchResponse = z.infer<typeof BatchResponse>

/* ───────────── relations & records ───────────── */

export const RelationRef = z.object({ type: z.string(), to: Guid, slot: z.string().optional() })
export const RelationReplaceRequest = RelationRef.extend({ newTo: Guid })
export const RelationAckRequest = z.object({ to: Guid })
export const RetargetRequest = z.object({ from: Guid, to: Guid, types: z.array(z.string()).optional(), dryRun: z.boolean().default(true) })
export const RetargetResponse = z.object({
  affected: z.array(z.object({ assetId: Guid, assetName: z.string(), type: z.string(), slot: z.string().optional() })),
  applied: z.boolean()
})
export type RetargetResponse = z.infer<typeof RetargetResponse>
export const CycleDetails = z.object({ path: z.array(z.object({ id: Guid, name: z.string() })) })

export const RecordCreateResponse = z.object({ id: z.string(), record: ProductionRecord })
export const RecordResponse = z.object({ record: ProductionRecord, outputs: z.array(AssetSummary) })
export const RecordNoteRequest = z.object({ text: z.string().min(1) })

/* ───────────── folders, tags, views ───────────── */

export const FoldersResponse = z.object({ root: FolderNode })
export const FolderCreateRequest = z.object({ path: z.string().min(1) })
export const FolderPatchRequest = z.object({
  path: z.string(),
  /** New directory name on disk (assets inside change path, references unaffected). */
  rename: z.string().optional(),
  /** New parent folder. */
  moveTo: z.string().optional(),
  label: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  defaults: FolderDefaults.nullable().optional()
})
export const FolderDeleteRequest = z.object({ path: z.string(), force: z.boolean().optional() })
export const FolderDeleteResponse = z.object({ trashed: z.number().int(), batch: z.string().nullable() })
/** Make a folder one bundle asset (library-format.md「包式资产」; explicit only). */
export const BundleRequest = z.object({ path: z.string(), entry: z.string().optional() })

export const TagsResponse = z.object({ tags: z.array(TagInfo), groups: z.array(z.string()) })
export const TagsPatchRequest = z.object({
  rename: z.object({ from: z.string(), to: z.string() }).optional(),
  merge: z.object({ from: z.string(), into: z.string() }).optional(),
  define: z.object({ name: z.string() }).merge(TagDef).optional(),
  groups: z.array(z.string()).optional()
})
export const TagsPatchResponse = z.object({ affected: z.number().int() })
export const LibraryTagRequest = z.object({ tag: z.string().optional(), all: z.boolean().optional() })

export const ViewsResponse = z.object({ views: z.array(SmartView) })
export const ViewPutRequest = z.object({ query: Query, rename: z.string().optional() })

/* ───────────── issues & trash ───────────── */

export const IssuesQuery = z.object({ type: z.array(IssueType).optional(), level: z.array(IssueLevel).optional(), assetId: Guid.optional() })
export const IssuesResponse = z.object({
  issues: z.array(Issue),
  /** Assets referenced by the issues (for rows), keyed by id. */
  assets: z.record(z.string(), AssetSummary),
  assetCount: z.number().int(),
  total: z.number().int()
})
export type IssuesResponse = z.infer<typeof IssuesResponse>
export const IssueResolveRequest = z.object({
  action: z.string(),
  /** relocate: { path, moveBack }; swap: {}; restore-target: {}; … */
  params: z.record(z.string(), z.unknown()).optional()
})
export const IssueBatchResolveRequest = IssueResolveRequest.extend({ ids: z.array(z.string()).optional(), type: IssueType.optional() })
export const IssueResolveResponse = z.object({ resolved: z.array(z.string()), failed: z.array(z.object({ id: z.string(), message: z.string() })) })
export const RelocateCandidates = z.object({
  candidates: z.array(z.object({ path: z.string(), size: z.number(), sameContent: z.boolean(), similarity: z.number(), reason: z.string() }))
})

export const TrashResponse = z.object({ items: z.array(TrashItem), trashDays: z.number().int() })
/** `rename` omitted = rename automatically when the original path is taken (sync-and-integrity.md); `false` = answer `conflict` instead. */
export const TrashRestoreRequest = z.object({ rename: z.boolean().optional() })
export const TrashRestoreResponse = z.object({ asset: AssetSummary, renamedTo: z.string().nullable() })

/* ───────────── creators & jobs ───────────── */

export const CreatorsResponse = z.object({ creators: z.array(CreatorInfo) })
/** `GET /actions?ids=a,b`: actions whose appliesTo() accepts this selection. */
export const ActionsResponse = z.object({ actions: z.array(ActionInfo) })
/** `POST /actions/{id}/runs`: run an action on a selection; returns the job (new assets register through the kernel). */
export const ActionRunRequest = z.object({ ids: z.array(Guid).min(1), params: z.unknown().optional() })
export const CreateRunRequest = z.object({
  params: z.unknown(),
  inputs: z.array(z.object({ role: z.string(), id: Guid })).default([]),
  folder: z.string().optional()
})
export const JobsResponse = z.object({
  stages: z.array(StageStats),
  /** Assets waiting for a browser to render their thumbnail (no switch, ADR-025). */
  waitingRender: z.number().int(),
  /** One number for the toolbar: assets being processed + running create jobs. */
  busy: z.number().int(),
  scan: ScanProgress,
  failed: z.array(JobInfo),
  creates: z.array(JobInfo),
  processing: z.array(JobInfo)
})
export type JobsResponse = z.infer<typeof JobsResponse>
export const JobsRetryRequest = z.object({ assetIds: z.array(Guid).optional(), stage: PipelineStage.optional(), failed: z.boolean().optional(), jobIds: z.array(z.string()).optional() })

/* ───────────── export ───────────── */

export const ExportRequest = z.object({
  ids: z.array(Guid).min(1),
  withDeps: z.boolean().default(false),
  layout: z.enum(['keep', 'flat']).default('keep'),
  /** Absolute directory on the server machine (local only); omit to download a zip. */
  dir: z.string().optional()
})
export type ExportRequest = z.infer<typeof ExportRequest>
export const ExportPlan = z.object({
  files: z.array(z.object({
    /** Path as written in the export. */
    path: z.string(),
    size: z.number(),
    assetId: Guid,
    /** Written under its slot name though the actual file differs (relation replaced). */
    fromFile: z.string().optional(),
    /** For files of a bundle asset: the path inside the bundle (download with the bundle file endpoint). */
    inner: z.string().optional(),
    dependency: z.boolean()
  })),
  bytes: z.number(),
  dependencies: z.number().int(),
  duplicateNames: z.boolean()
})
export type ExportPlan = z.infer<typeof ExportPlan>
export const ExportResponse = z.object({
  written: z.number().int(), dir: z.string(), bytes: z.number(),
  /** Files not written: an unsafe slot name or a path outside the export folder (ADR-048). */
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })).optional()
})

/* ───────────── render worker ───────────── */

export const RenderTask = z.object({
  job: z.string(),
  assetId: Guid,
  kind: z.enum(['thumbnail', 'summary']),
  format: z.string(),
  plugin: z.string(),
  asset: AssetDetail
})
export type RenderTask = z.infer<typeof RenderTask>
export const RenderNextResponse = z.object({ task: RenderTask.nullable() })
/** `PUT /render/{job}` multipart: parts named after ThumbVariant (images / peaks json) plus optional `tech` JSON. */
export const RenderResultFields = z.object({
  tech: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  aspect: z.number().optional(),
  /** The browser could not render it (e.g.「这台电脑的浏览器放不了这种视频（ProRes 4444）」); no parts are sent. */
  error: z.string().optional(),
  /** Whether retrying can help (an undecodable codec cannot). */
  retryable: z.boolean().optional()
})
export const RENDER_PARTS = ['thumb', 'poster', 'scrub', 'turnaround', 'preview'] as const satisfies readonly z.infer<typeof ThumbVariant>[]

/* ───────────── libraries, config, plugins, cache, health ───────────── */

export const LibrariesResponse = z.object({ libraries: z.array(LibraryRef), defaultId: z.string().nullable() })
/**
 * `create`: a new library folder (「新建资产库」). The folder must not exist yet or be empty; otherwise 409 `conflict`
 * with `details.reason: 'not_empty'` and nothing is registered.
 */
export const LibraryAddRequest = z.object({ root: z.string().min(1), name: z.string().optional(), create: z.boolean().optional() })
export const LibraryPatchRequest = z.object({ name: z.string().optional(), settings: LibrarySettings.partial().optional() })
export const RescanRequest = z.object({ path: z.string().optional() })

/**
 * Folders of the computer running Bowerbird, for the folder chooser (`GET /fs/folders?path=`; local requests only,
 * `not_local` otherwise). Only folders, hidden (dot) folders left out, sorted by name, at most FS_FOLDERS_LIMIT.
 */
export const FS_FOLDERS_LIMIT = 2000
export const FsFolder = z.object({
  name: z.string(),
  path: z.string(),
  /** Already a Bowerbird library (`.bowerbird/library.json`). */
  library: z.boolean()
})
export const FsFoldersResponse = z.object({
  /** The listed folder (absolute; the home folder when no path was given). */
  path: z.string(),
  /** Its parent; null at the top of the disk. */
  parent: z.string().nullable(),
  /** The home folder of the account running Bowerbird. */
  home: z.string(),
  /** `path` itself is already a library. */
  library: z.boolean(),
  folders: z.array(FsFolder),
  /** More than FS_FOLDERS_LIMIT folders: only the first ones by name are listed. */
  truncated: z.boolean()
})
export const ConfigPatchRequest = MachineConfig.partial()
export const ConfigResponse = z.object({ config: MachineConfig, dataDir: z.string(), restartRequired: z.boolean() })

export const PluginsResponse = z.object({ plugins: z.array(PluginInfo) })
export const PluginInstallRequest = z.object({ spec: z.string().min(1) })
export const PluginToggleRequest = z.object({ library: z.string().optional() })
export const PluginSettingsResponse = z.object({ values: z.record(z.string(), z.unknown()), schema: z.record(z.string(), z.unknown()).nullable() })
export const PluginSettingsPut = z.object({ values: z.record(z.string(), z.unknown()) })

export const CacheResponse = z.object({ bytes: z.number(), files: z.number().int(), dir: z.string(), inLibrary: z.boolean() })
export const CacheCleanRequest = z.object({ all: z.boolean().optional() })
export const CacheCleanResponse = z.object({ removedBytes: z.number(), removedFiles: z.number().int() })

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  libraries: z.array(z.object({ id: z.string(), state: z.string(), index: z.enum(['ready', 'building']), scan: ScanProgress }))
})

export const VocabularyResponse = Vocabulary
export const AssetResponse = AssetDetail
export const LineageResponse = Lineage
export const LibraryResponse = LibraryInfo
export const JobResponse = JobInfo
export type { FolderNode }

/* ───────────── endpoint table ───────────── */

/**
 * Paths relative to `/api/v1`. `L` = `/libraries/{library}` prefix.
 * The table is documentation for clients and tests; servers register the same paths.
 */
export const ENDPOINTS = {
  health: 'GET /health',
  libraries: 'GET /libraries',
  libraryAdd: 'POST /libraries',
  library: 'GET /libraries/:library',
  libraryPatch: 'PATCH /libraries/:library',
  libraryInit: 'POST /libraries/:library/init',
  rescanStop: 'POST /libraries/:library/rescan/stop',
  libraryReveal: 'POST /libraries/:library/reveal',
  fsFolders: 'GET /fs/folders',
  config: 'GET /config',
  configPatch: 'PATCH /config',
  plugins: 'GET /plugins',
  pluginInstall: 'POST /plugins',
  pluginUpdate: 'POST /plugins/:id/update',
  pluginRemove: 'DELETE /plugins/:id',
  pluginEnable: 'POST /plugins/:id/enable',
  pluginDisable: 'POST /plugins/:id/disable',
  pluginSettings: 'GET /plugins/:id/settings',
  pluginSettingsPut: 'PUT /plugins/:id/settings',
  pluginWeb: 'GET /plugins/:id/web',
  rescan: 'POST L/rescan',
  vocabulary: 'GET L/vocabulary',
  cache: 'GET L/cache',
  cacheClean: 'POST L/cache/clean',
  search: 'POST L/search',
  asset: 'GET L/assets/:id',
  precheck: 'POST L/assets/precheck',
  register: 'POST L/assets',
  patch: 'PATCH L/assets/:id',
  remove: 'DELETE L/assets/:id',
  content: 'POST L/assets/:id/content',
  move: 'POST L/assets/:id/move',
  copy: 'POST L/assets/:id/copy',
  review: 'POST L/assets/:id/review',
  tagsAccept: 'POST L/assets/:id/tags/accept',
  tagsDismiss: 'POST L/assets/:id/tags/dismiss',
  file: 'GET L/assets/:id/file',
  open: 'POST L/assets/:id/open',
  reveal: 'POST L/assets/:id/reveal',
  thumbnail: 'GET L/assets/:id/thumbnail',
  thumbnailPut: 'PUT L/assets/:id/thumbnail',
  thumbnailDelete: 'DELETE L/assets/:id/thumbnail',
  summary: 'GET L/assets/:id/summary',
  lineage: 'GET L/assets/:id/lineage',
  versions: 'GET L/assets/:id/versions',
  versionFile: 'GET L/assets/:id/versions/:hash/file',
  versionRestore: 'POST L/assets/:id/versions/:hash/restore',
  slotFile: 'GET L/assets/:id/slots/:slot',
  bundleFile: 'GET L/assets/:id/bundle/*',
  batch: 'POST L/assets/batch',
  relationAdd: 'POST L/assets/:id/relations',
  relationDelete: 'DELETE L/assets/:id/relations',
  relationReplace: 'POST L/assets/:id/relations/replace',
  relationAck: 'POST L/assets/:id/relations/acknowledge',
  retarget: 'POST L/relations/retarget',
  recordCreate: 'POST L/records',
  record: 'GET L/records/:id',
  recordNote: 'POST L/records/:id/notes',
  folders: 'GET L/folders',
  folderCreate: 'POST L/folders',
  folderPatch: 'PATCH L/folders',
  folderDelete: 'DELETE L/folders',
  folderBundle: 'POST L/folders/bundle',
  tags: 'GET L/tags',
  tagsPatch: 'PATCH L/tags',
  libraryTagAccept: 'POST L/tags/accept',
  libraryTagDismiss: 'POST L/tags/dismiss',
  views: 'GET L/views',
  viewPut: 'PUT L/views/:name',
  viewDelete: 'DELETE L/views/:name',
  issues: 'GET L/issues',
  issueResolve: 'POST L/issues/:id/resolve',
  issuesResolve: 'POST L/issues/resolve',
  issueCandidates: 'GET L/issues/:id/candidates',
  trash: 'GET L/trash',
  trashRestore: 'POST L/trash/:id/restore',
  trashDelete: 'DELETE L/trash/:id',
  trashEmpty: 'DELETE L/trash',
  actions: 'GET L/actions',
  actionRun: 'POST L/actions/:id/runs',
  creators: 'GET L/creators',
  createRun: 'POST L/creators/:id/runs',
  jobs: 'GET L/jobs',
  job: 'GET L/jobs/:id',
  jobCancel: 'DELETE L/jobs/:id',
  jobsRetry: 'POST L/jobs/retry',
  exportPlan: 'POST L/export/plan',
  export: 'POST L/export',
  renderNext: 'GET L/render/next',
  renderPut: 'PUT L/render/:job',
  libraryPluginSettings: 'GET L/plugins/:id/settings',
  libraryPluginSettingsPut: 'PUT L/plugins/:id/settings',
  events: 'GET L/events'
} as const
export type EndpointName = keyof typeof ENDPOINTS

/* inferred types */
export type FacetCount = z.infer<typeof FacetCount>
export type PrecheckRequest = z.infer<typeof PrecheckRequest>
export type AssetPatchResponse = z.infer<typeof AssetPatchResponse>
export type DeleteResponse = z.infer<typeof DeleteResponse>
export type ContentReplaceFields = z.infer<typeof ContentReplaceFields>
export type MoveRequest = z.infer<typeof MoveRequest>
export type CopyRequest = z.infer<typeof CopyRequest>
export type TagNamesRequest = z.infer<typeof TagNamesRequest>
export type RestoreResponse = z.infer<typeof RestoreResponse>
export type RelationRef = z.infer<typeof RelationRef>
export type RelationReplaceRequest = z.infer<typeof RelationReplaceRequest>
export type RelationAckRequest = z.infer<typeof RelationAckRequest>
export type RetargetRequest = z.infer<typeof RetargetRequest>
export type CycleDetails = z.infer<typeof CycleDetails>
export type RecordCreateResponse = z.infer<typeof RecordCreateResponse>
export type RecordResponse = z.infer<typeof RecordResponse>
export type RecordNoteRequest = z.infer<typeof RecordNoteRequest>
export type FoldersResponse = z.infer<typeof FoldersResponse>
export type FolderCreateRequest = z.infer<typeof FolderCreateRequest>
export type FolderPatchRequest = z.infer<typeof FolderPatchRequest>
export type FolderDeleteRequest = z.infer<typeof FolderDeleteRequest>
export type FolderDeleteResponse = z.infer<typeof FolderDeleteResponse>
export type BundleRequest = z.infer<typeof BundleRequest>
export type TagsResponse = z.infer<typeof TagsResponse>
export type TagsPatchRequest = z.infer<typeof TagsPatchRequest>
export type TagsPatchResponse = z.infer<typeof TagsPatchResponse>
export type LibraryTagRequest = z.infer<typeof LibraryTagRequest>
export type ViewsResponse = z.infer<typeof ViewsResponse>
export type ViewPutRequest = z.infer<typeof ViewPutRequest>
export type IssuesQuery = z.infer<typeof IssuesQuery>
export type IssueResolveRequest = z.infer<typeof IssueResolveRequest>
export type IssueBatchResolveRequest = z.infer<typeof IssueBatchResolveRequest>
export type IssueResolveResponse = z.infer<typeof IssueResolveResponse>
export type RelocateCandidates = z.infer<typeof RelocateCandidates>
export type TrashResponse = z.infer<typeof TrashResponse>
export type TrashRestoreRequest = z.infer<typeof TrashRestoreRequest>
export type TrashRestoreResponse = z.infer<typeof TrashRestoreResponse>
export type CreatorsResponse = z.infer<typeof CreatorsResponse>
export type CreateRunRequest = z.infer<typeof CreateRunRequest>
export type JobsRetryRequest = z.infer<typeof JobsRetryRequest>
export type ExportResponse = z.infer<typeof ExportResponse>
export type RenderNextResponse = z.infer<typeof RenderNextResponse>
export type RenderResultFields = z.infer<typeof RenderResultFields>
export type LibrariesResponse = z.infer<typeof LibrariesResponse>
export type LibraryAddRequest = z.infer<typeof LibraryAddRequest>
export type LibraryPatchRequest = z.infer<typeof LibraryPatchRequest>
export type RescanRequest = z.infer<typeof RescanRequest>
export type FsFolder = z.infer<typeof FsFolder>
export type FsFoldersResponse = z.infer<typeof FsFoldersResponse>
export type ConfigResponse = z.infer<typeof ConfigResponse>
export type PluginsResponse = z.infer<typeof PluginsResponse>
export type PluginInstallRequest = z.infer<typeof PluginInstallRequest>
export type PluginToggleRequest = z.infer<typeof PluginToggleRequest>
export type PluginSettingsResponse = z.infer<typeof PluginSettingsResponse>
export type PluginSettingsPut = z.infer<typeof PluginSettingsPut>
export type CacheResponse = z.infer<typeof CacheResponse>
export type CacheCleanRequest = z.infer<typeof CacheCleanRequest>
export type CacheCleanResponse = z.infer<typeof CacheCleanResponse>
export type HealthResponse = z.infer<typeof HealthResponse>
export type ActionsResponse = z.infer<typeof ActionsResponse>
export type ActionRunRequest = z.infer<typeof ActionRunRequest>
