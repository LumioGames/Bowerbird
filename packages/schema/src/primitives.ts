/**
 * Primitive values shared by every Bowerbird data structure.
 * Source of truth: .spec/knowledge/features/data-model.md, library-format.md.
 */
import { z } from 'zod'

/** Metadata format version written as `bb` in every .bmeta / library.json. */
export const FORMAT_VERSION = 1 as const

/** GUID: UUIDv7, lower-case, written once and never changed. */
export const Guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'not a GUID')
export type Guid = z.infer<typeof Guid>

/** Content fingerprint with algorithm prefix, e.g. `sha256:9c1e…`. */
export const Hash = z.string().regex(/^[a-z0-9]+:[0-9a-f]+$/, 'not a content hash')
export type Hash = z.infer<typeof Hash>

/** UTC ISO-8601 time string. */
export const IsoTime = z.string()
export type IsoTime = z.infer<typeof IsoTime>

/** Material stage (ADR-006). */
export const STAGES = ['reference', 'production', 'runtime'] as const
export const Stage = z.enum(STAGES)
export type Stage = z.infer<typeof Stage>

/** Stored review status (ADR-006, ADR-020). */
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'exempt'] as const
export const ReviewStatus = z.enum(REVIEW_STATUSES)
export type ReviewStatus = z.infer<typeof ReviewStatus>

/**
 * Actor: `user:<name>` | `agent:<name>` | `system:scanner` (data-model.md「执行者」).
 * Only for attribution, never for access control.
 */
export const Actor = z.string().regex(/^(user|agent|system):.+$/, 'actor must be user:<name>, agent:<name> or system:<name>')
export type Actor = z.infer<typeof Actor>
export const UNNAMED_ACTOR = 'user:unnamed' as const
export const SCANNER_ACTOR = 'system:scanner' as const

/** Built-in relation types; plugins may register more (string). */
export const BUILTIN_RELATION_TYPES = ['source', 'reference', 'uses', 'belongs'] as const
export type BuiltinRelationType = (typeof BUILTIN_RELATION_TYPES)[number]
export const RelationType = z.string().min(1)
export type RelationType = z.infer<typeof RelationType>

/** Built-in production methods; plugin-defined values are prefixed with the plugin id (ADR-016). */
export const BUILTIN_METHODS = ['ai-generate', 'manual', 'slice', 'render', 'export', 'convert', 'copy', 'other'] as const
export type BuiltinMethod = (typeof BUILTIN_METHODS)[number]

/** Turnaround view names (ADR-019). */
export const VIEW_NAMES = ['front', 'side', 'back', 'top'] as const
export const ViewName = z.enum(VIEW_NAMES)
export type ViewName = z.infer<typeof ViewName>

/** Turnaround grid: rows × cols, cells listed left→right, top→bottom (ADR-019). */
export const ViewGrid = z.object({
  rows: z.number().int().min(1).max(8),
  cols: z.number().int().min(1).max(8),
  cells: z.array(ViewName.nullable())
}).refine(g => g.cells.length === g.rows * g.cols, { message: 'cells must have rows × cols entries' })
export type ViewGrid = z.infer<typeof ViewGrid>

/** Pipeline stages, in order (pipeline-and-cache.md). */
export const PIPELINE_STAGES = ['identify', 'probe', 'derive', 'thumbnail', 'summary', 'enrich', 'validate', 'index'] as const
export const PipelineStage = z.enum(PIPELINE_STAGES)
export type PipelineStage = z.infer<typeof PipelineStage>

/** Job status (pipeline-and-cache.md「任务状态」). */
export const JOB_STATUSES = ['queued', 'running', 'waiting-renderer', 'done', 'skipped', 'failed', 'cancelled'] as const
export const JobStatus = z.enum(JOB_STATUSES)
export type JobStatus = z.infer<typeof JobStatus>

/** Compare modes (plugin-system.md). */
export const COMPARE_MODES = ['side', 'wipe', 'overlay', 'diff'] as const
export const CompareMode = z.enum(COMPARE_MODES)
export type CompareMode = z.infer<typeof CompareMode>

/** Thumbnail variants (pipeline-and-cache.md「规格」). */
export const THUMB_VARIANTS = ['thumb', 'preview', 'poster', 'scrub', 'peaks', 'turnaround'] as const
export const ThumbVariant = z.enum(THUMB_VARIANTS)
export type ThumbVariant = z.infer<typeof ThumbVariant>

/** Format id of files no plugin claims. */
export const UNKNOWN_FORMAT = 'unknown' as const

/** Default server port and host (api-and-agent.md). */
export const DEFAULT_PORT = 7420
export const DEFAULT_HOST = '127.0.0.1'
export const API_BASE = '/api/v1'
export const ACTOR_HEADER = 'x-bowerbird-actor'
