/**
 * On-disk formats of a library folder (library-format.md, ADR-017).
 * Everything here is the source of truth: .bmeta sidecars, _folder.bmeta,
 * .bowerbird/library.json, tags.json, views/*.json, trash/<id>/info.json (and, read once for conversion, the
 * `records/<year>/*.json` of libraries written before ADR-070).
 *
 * Unknown top-level keys must be preserved (looseObject) so an older Bowerbird
 * never drops data written by a newer one.
 */
import { z } from 'zod'
import { Actor, FORMAT_VERSION, Guid, Hash, IsoTime, RelationType, ReviewStatus, Stage, ViewGrid } from './primitives.js'

export const SIDECAR_SUFFIX = '.bmeta' as const
export const FOLDER_META_NAME = '_folder.bmeta' as const
export const LIBRARY_DIR = '.bowerbird' as const
export const IGNORE_FILE = '.bbignore' as const

/** Who and when. */
export const Stamp = z.object({ at: IsoTime, by: Actor })
export type Stamp = z.infer<typeof Stamp>

/** A relation, written in the initiator's sidecar ("I depend on `to`"). data-model.md「关系的字段」, ADR-018. */
export const Relation = z.looseObject({
  type: RelationType,
  to: Guid,
  /** Counterpart content hash when the relation was made / last acknowledged: `source` (tracked) and `reference` (kept, not tracked). */
  toHash: Hash.optional(),
  /** What the counterpart was to the making of this asset, e.g. reference, mask, turnaround (ADR-070). Only source / reference. */
  role: z.string().optional(),
  /** Slot name: the reference name written inside the asset file (e.g. a texture file name in a glTF). */
  slot: z.string().optional(),
  note: z.string().optional()
})
export type Relation = z.infer<typeof Relation>

/** Latest human review verdict only (ADR-024). */
export const Review = z.looseObject({
  status: ReviewStatus,
  /** Content hash the verdict applies to. */
  hash: Hash.optional(),
  by: Actor.optional(),
  at: IsoTime.optional(),
  note: z.string().optional()
})
export type Review = z.infer<typeof Review>

/** One content version record; the old content itself is not kept by the kernel (ADR-007). */
export const VersionEntry = z.looseObject({
  hash: Hash,
  size: z.number().int().nonnegative(),
  at: IsoTime,
  by: Actor,
  note: z.string().optional()
})
export type VersionEntry = z.infer<typeof VersionEntry>

/** AI output, kept apart from human info. */
export const AutoInfo = z.looseObject({
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  /** Producer, e.g. `bowerbird.enrich-vision@1.2.0`. */
  by: z.string().optional(),
  hash: Hash.optional()
})
export type AutoInfo = z.infer<typeof AutoInfo>

/**
 * How an asset was made (ADR-070): its own information, written in its own .bmeta and editable like a tag.
 * The input assets are its `source` / `reference` relations (with `role`). Outputs of one run share `batch`.
 */
export const Provenance = z.looseObject({
  /** Open value: built-in methods, or `<pluginId>/<name>` for plugin-defined ones. */
  method: z.string().min(1),
  tool: z.string().optional(),
  /** `<pluginId>@<version>`, filled by the kernel when a plugin registered the output. */
  plugin: z.string().optional(),
  prompt: z.string().optional(),
  /** Conventional keys: model, seed, negativePrompt; slices put their `rect` here (ADR-036). */
  params: z.record(z.string(), z.unknown()).optional(),
  /** Outputs of one run carry the same batch id. */
  batch: z.string().optional(),
  by: Actor,
  at: IsoTime,
  note: z.string().optional()
})
export type Provenance = z.infer<typeof Provenance>
export const PROVENANCE_KEY_ORDER = ['method', 'tool', 'plugin', 'prompt', 'params', 'batch', 'by', 'at', 'note'] as const

/**
 * The .bmeta sidecar. Required: bb, id, hash, stage, created. It exists only once the asset has information that
 * cannot be recomputed from the file (ADR-067); a file nobody said anything about lives in the index only.
 */
export const Bmeta = z.looseObject({
  bb: z.literal(FORMAT_VERSION),
  id: Guid,
  hash: Hash,
  stage: Stage,
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  fields: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  auto: AutoInfo.optional(),
  relations: z.array(Relation).optional(),
  review: Review.optional(),
  versions: z.array(VersionEntry).optional(),
  auxiliary: z.boolean().optional(),
  bundle: z.boolean().optional(),
  thumbnail: z.string().nullable().optional(),
  views: ViewGrid.optional(),
  provenance: Provenance.optional(),
  created: Stamp,
  modified: Stamp.optional()
})
export type Bmeta = z.infer<typeof Bmeta>

/** Output key order of a .bmeta (fixed, two-space indent). Unknown keys follow in their original order. */
export const BMETA_KEY_ORDER = [
  'bb', 'id', 'hash', 'stage', 'tags', 'description', 'fields', 'auto', 'relations', 'review', 'versions',
  'auxiliary', 'bundle', 'thumbnail', 'views', 'provenance', 'created', 'modified'
] as const

/** Defaults a folder gives to assets claimed inside it; inherited item by item from ancestors. */
export const FolderDefaults = z.looseObject({
  stage: Stage.optional(),
  /** `exempt` makes the folder review-free; `pending` is the normal default. */
  review: z.enum(['pending', 'exempt']).optional(),
  tags: z.array(z.string()).optional()
})
export type FolderDefaults = z.infer<typeof FolderDefaults>

/** `_folder.bmeta`: display info (not inherited) plus defaults (inherited). */
export const FolderMeta = z.looseObject({
  bb: z.literal(FORMAT_VERSION),
  label: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  defaults: FolderDefaults.optional()
})
export type FolderMeta = z.infer<typeof FolderMeta>
export const FOLDER_META_KEY_ORDER = ['bb', 'label', 'icon', 'description', 'defaults'] as const

export const AGENT_SEARCH_SCOPES = ['all', 'approved'] as const
export const LibrarySettings = z.looseObject({
  defaultStage: Stage.default('production'),
  /** all: return everything with status; approved: agent queries without a review filter only see approved + exempt. */
  agentSearchScope: z.enum(AGENT_SEARCH_SCOPES).default('all'),
  trashDays: z.number().int().min(1).max(3650).default(7),
  /** Plugin settings whose manifest `scope` is `library`, keyed by plugin id. */
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  /** Cause keys of info-level issues people chose to ignore (sync-and-integrity.md「约定」). */
  ignoredIssues: z.array(z.string()).optional()
})
export type LibrarySettings = z.infer<typeof LibrarySettings>

/** `.bowerbird/library.json`. */
export const LibraryJson = z.looseObject({
  bb: z.literal(FORMAT_VERSION),
  id: Guid,
  name: z.string().min(1),
  created: IsoTime,
  /** Required plugins and version ranges. The library never carries plugin code (ADR-012). */
  plugins: z.record(z.string(), z.string()).default({}),
  /**
   * Which declared plugin reads which extension (`.skel` → `community.spine`), written when a non-builtin plugin
   * is enabled, so a machine without that plugin can still say「需要 Spine 插件」per asset (ADR-044).
   */
  pluginFormats: z.record(z.string(), z.string()).optional(),
  settings: LibrarySettings.default({ defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 })
})
export type LibraryJson = z.infer<typeof LibraryJson>

/** Tag definitions (`.bowerbird/tags.json`), separate from tag values on assets. */
export const TagDef = z.looseObject({
  group: z.string().optional(),
  color: z.string().optional(),
  aliases: z.array(z.string()).optional()
})
export type TagDef = z.infer<typeof TagDef>
export const TagsJson = z.looseObject({
  bb: z.literal(FORMAT_VERSION),
  /** Group display order. */
  groups: z.array(z.string()).default([]),
  tags: z.record(z.string(), TagDef).default({}),
  /** Unused: ignored issues live in library.json `settings.ignoredIssues`. Kept so older files still parse. */
  ignoredIssues: z.array(z.string()).optional()
})
export type TagsJson = z.infer<typeof TagsJson>

/** Production record input: asset + its content hash at the time + optional role (ADR-016). */
export const RecordInputRef = z.looseObject({
  id: Guid,
  hash: Hash,
  role: z.string().optional()
})
export type RecordInputRef = z.infer<typeof RecordInputRef>

/** Appended note on a record (the record itself is immutable). */
export const RecordNote = z.object({ at: IsoTime, by: Actor, text: z.string() })
export type RecordNote = z.infer<typeof RecordNote>

/**
 * `.bowerbird/records/<year>/<id>.json` of libraries written before ADR-070. Read only to convert such a library:
 * each record's content moves into the `provenance` of the assets it made, and the records folder is set aside.
 */
export const ProductionRecord = z.looseObject({
  bb: z.literal(FORMAT_VERSION).optional(),
  id: z.string().regex(/^rec_/),
  /** Open value: built-in methods, or `<pluginId>/<name>` for plugin-defined ones. */
  method: z.string().min(1),
  tool: z.string().optional(),
  /** `<pluginId>@<version>`, filled by the kernel when a plugin registered the output. */
  plugin: z.string().optional(),
  prompt: z.string().optional(),
  /** Conventional keys: model, seed, negativePrompt; others free (slices also record their rect here). */
  params: z.record(z.string(), z.unknown()).optional(),
  inputs: z.array(RecordInputRef).optional(),
  by: Actor,
  at: IsoTime,
  note: z.string().optional(),
  notes: z.array(RecordNote).optional()
})
export type ProductionRecord = z.infer<typeof ProductionRecord>
export const RECORD_KEY_ORDER = ['bb', 'id', 'method', 'tool', 'plugin', 'prompt', 'params', 'inputs', 'by', 'at', 'note', 'notes'] as const

/** Sort keys (search.md). */
export const SORT_KEYS = ['relevance', 'name', 'modified', 'created', 'size', 'format'] as const

/** `.bowerbird/trash/<trashId>/info.json`; the asset file and its .bmeta sit next to it. */
export const TrashInfo = z.looseObject({
  bb: z.literal(FORMAT_VERSION),
  id: z.string(),
  assetId: Guid,
  name: z.string(),
  /** Library-relative path the asset had before deletion. */
  originalPath: z.string(),
  deletedAt: IsoTime,
  deletedBy: Actor,
  bundle: z.boolean().optional(),
  /** Entries deleted together (a folder) share a batch id. */
  batch: z.string().optional(),
  /** Only the record was moved (file already gone; "确认文件已删"). */
  recordOnly: z.boolean().optional()
})
export type TrashInfo = z.infer<typeof TrashInfo>

/** Built-in ignore rules (library-format.md「忽略规则」). Patterns use .gitignore syntax. */
export const BUILTIN_IGNORES = [
  '.bowerbird/', '*.bmeta', '_folder.bmeta', '.bbignore', '.*', 'Thumbs.db', 'desktop.ini', '~$*', '*.tmp', '*.part', '*.crdownload'
] as const
