/**
 * Query model and text syntax (search.md). One model for the search box, the filter panel,
 * smart folders, the HTTP API, the CLI and MCP. The text syntax parser lives here (pure),
 * so the web shell can keep the filter panel and the search box in two-way sync.
 */
import { z } from 'zod'
import { FORMAT_VERSION, Guid, ReviewStatus, Stage } from './primitives.js'
import { SORT_KEYS } from './disk.js'

export const Comparison = z.object({
  eq: z.union([z.number(), z.string(), z.boolean()]).optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  lt: z.number().optional()
})
export type Comparison = z.infer<typeof Comparison>

export const TimeRange = z.object({ after: z.string().optional(), before: z.string().optional() })
export type TimeRange = z.infer<typeof TimeRange>

export const ISSUE_TYPES = [
  'broken-reference', 'missing-file', 'duplicate-guid', 'metadata-conflict', 'stale-upstream',
  'orphan-sidecar', 'pipeline-failed', 'plugin-missing', 'thumbnail-stale', 'duplicate-content'
] as const
export const IssueType = z.enum(ISSUE_TYPES)
export type IssueType = z.infer<typeof IssueType>

export const Filter = z.object({
  stage: z.array(Stage).optional(),
  format: z.array(z.string()).optional(),
  tags: z.object({
    all: z.array(z.string()).optional(),
    any: z.array(z.string()).optional(),
    none: z.array(z.string()).optional()
  }).optional(),
  /** Library-relative folder; includes sub folders unless `folderExact`. Trailing slash optional. */
  folder: z.string().optional(),
  folderExact: z.boolean().optional(),
  /** Effective review status. */
  review: z.array(ReviewStatus).optional(),
  /** Has error- or warning-level integrity issues. */
  hasIssues: z.boolean().optional(),
  issue: z.array(IssueType).optional(),
  /** Tech conditions keyed by plugin-defined tech keys (width, duration, triangles…). */
  tech: z.record(z.string(), Comparison).optional(),
  relation: z.object({
    type: z.string(),
    to: z.string(),
    /** out (default): this asset → `to`; in: `to` → this asset. */
    direction: z.enum(['out', 'in']).optional()
  }).optional(),
  created: TimeRange.optional(),
  modified: TimeRange.optional(),
  /** Creator actor; a bare category (`agent`) matches all of it. */
  by: z.string().optional(),
  /** Last actor who changed the asset's information (ADR-072); same matching as `by`. Files without a .bmeta never match. */
  modifiedBy: z.string().optional(),
  method: z.array(z.string()).optional(),
  /** Outputs of one run: assets whose provenance carries this batch id (ADR-070). */
  batch: z.string().optional(),
  includeAuxiliary: z.boolean().optional(),
  humanTagsOnly: z.boolean().optional(),
  inTrash: z.boolean().optional(),
  /** Restrict to these ids (used by batch operations and the review queue). */
  ids: z.array(Guid).optional(),
  /** Untagged (no human and no AI tags): the built-in「未打标签」view. */
  untagged: z.boolean().optional(),
  /** Semantic search by example; returns `unsupported` without a semantic plugin. */
  similarTo: z.string().optional()
})
export type Filter = z.infer<typeof Filter>

export const SortKey = z.enum(SORT_KEYS)
export type SortKey = z.infer<typeof SortKey>

export const Query = z.object({
  q: z.string().optional(),
  filter: Filter.optional(),
  sort: SortKey.optional(),
  /** asc / desc; default desc for time and size, asc for name and format. */
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().nullable().optional()
})
export type Query = z.infer<typeof Query>

/** `.bowerbird/views/<name>.json` — a saved query (smart folder). */
export const SmartViewFile = z.looseObject({
  bb: z.literal(FORMAT_VERSION),
  name: z.string().min(1),
  query: Query
})
export type SmartViewFile = z.infer<typeof SmartViewFile>

/** Built-in, undeletable views (search.md「智能文件夹」). */
export const BUILTIN_VIEWS = ['all', 'untagged', 'pending', 'issues', 'trash'] as const
export type BuiltinView = (typeof BUILTIN_VIEWS)[number]

/* ───────────────────────────── text syntax ───────────────────────────── */

/** Keys the search box understands, with the Chinese meaning shown by completion (prototype app.js SK). */
export const SYNTAX_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'stage', label: '物料阶段' },
  { key: 'format', label: '格式' },
  { key: 'tag', label: '包含标签' },
  { key: '-tag', label: '排除标签' },
  { key: 'folder', label: '文件夹' },
  { key: 'review', label: '校验状态' },
  { key: 'is', label: '问题' },
  { key: 'tris', label: '面数' },
  { key: 'width', label: '宽度' },
  { key: 'height', label: '高度' },
  { key: 'dur', label: '时长（秒）' },
  { key: 'when', label: '修改时间' },
  { key: 'created', label: '创建时间' },
  { key: 'by', label: '执行者' },
  { key: 'editor', label: '最后修改者' },
  { key: 'belongs', label: '归属于设计对象' },
  { key: 'method', label: '生产方式' },
  { key: 'batch', label: '同一批产出' }
]

/** Short tech keys in the syntax. */
export const TECH_ALIASES: Readonly<Record<string, string>> = { tris: 'triangles', dur: 'duration' }

export const WHEN_VALUES = ['today', 'week', 'month'] as const
export type WhenValue = (typeof WHEN_VALUES)[number]

/** Result of parsing the search box: structured filter + the remaining free text. */
export interface ParsedQueryText {
  q: string
  filter: Filter
  /** `belongs:` given by name (not GUID) — resolved by the kernel. */
  belongsName?: string
  /** `when:`/`created:` relative values kept so formatting can round-trip them. */
  when?: WhenValue
  createdWhen?: WhenValue
}

const KNOWN = new Set(['stage', 'format', 'tag', 'folder', 'review', 'is', 'when', 'created', 'by', 'editor', 'belongs', 'method', 'batch'])
const CMP_RE = /^(<=|>=|<|>|=)?(-?\d+(?:\.\d+)?)$/

/** Split on whitespace, honouring double quotes: `tag:"two words"`. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; continue }
    if (!quoted && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** Start of a relative range, in UTC, relative to `now`. today = since local midnight is approximated by 24 h. */
export function whenToRange(when: WhenValue, now: Date = new Date()): TimeRange {
  const day = 86_400_000
  const span = when === 'today' ? day : when === 'week' ? 7 * day : 30 * day
  return { after: new Date(now.getTime() - span).toISOString() }
}

function addCmp(filter: Filter, key: string, op: string | undefined, n: number): void {
  const tech = (filter.tech ??= {})
  const c = (tech[key] ??= {})
  switch (op) {
    case '<': c.lt = n; break
    case '<=': c.lte = n; break
    case '>': c.gt = n; break
    case '>=': c.gte = n; break
    default: c.eq = n
  }
}

/**
 * Parse the search box text into a filter + free text (search.md「文本语法」).
 * Unknown `key:value` pairs whose value is a comparison are tech conditions (`width:>=1024`);
 * anything else stays in the free text.
 */
export function parseQueryText(text: string, now: Date = new Date()): ParsedQueryText {
  const filter: Filter = {}
  const words: string[] = []
  const result: ParsedQueryText = { q: '', filter }
  for (const token of tokenize(text)) {
    const m = /^(-?)([a-zA-Z][\w.-]*):(.+)$/.exec(token)
    if (!m) { words.push(token); continue }
    const neg = m[1] === '-'
    const key = m[2]!.toLowerCase()
    const value = m[3]!
    if (neg && key !== 'tag') { words.push(token); continue }
    if (KNOWN.has(key)) {
      switch (key) {
        case 'stage': {
          const s = Stage.safeParse(value)
          if (s.success) (filter.stage ??= []).includes(s.data) || filter.stage.push(s.data)
          else words.push(token)
          break
        }
        case 'format': (filter.format ??= []).includes(value) || filter.format.push(value); break
        case 'tag': {
          const tags = (filter.tags ??= {})
          const arr = neg ? (tags.none ??= []) : (tags.all ??= [])
          if (!arr.includes(value)) arr.push(value)
          break
        }
        case 'folder': filter.folder = value; break
        case 'review': {
          const r = ReviewStatus.safeParse(value)
          if (r.success) (filter.review ??= []).includes(r.data) || filter.review.push(r.data)
          else words.push(token)
          break
        }
        case 'is':
          if (value === 'issue') filter.hasIssues = true
          else if (value === 'stale') (filter.issue ??= []).includes('stale-upstream') || filter.issue.push('stale-upstream')
          else if (value === 'missing') (filter.issue ??= []).includes('missing-file') || filter.issue.push('missing-file')
          else words.push(token)
          break
        case 'when':
        case 'created': {
          if ((WHEN_VALUES as readonly string[]).includes(value)) {
            const w = value as WhenValue
            if (key === 'when') { filter.modified = whenToRange(w, now); result.when = w } else { filter.created = whenToRange(w, now); result.createdWhen = w }
          } else words.push(token)
          break
        }
        case 'by': filter.by = value; break
        case 'editor': filter.modifiedBy = value; break
        case 'batch': filter.batch = value; break
        case 'belongs':
          filter.relation = { type: 'belongs', to: value }
          if (!Guid.safeParse(value).success) result.belongsName = value
          break
        case 'method': (filter.method ??= []).includes(value) || filter.method.push(value); break
      }
      continue
    }
    const cmp = CMP_RE.exec(value)
    if (cmp) { addCmp(filter, TECH_ALIASES[key] ?? key, cmp[1], Number(cmp[2])); continue }
    words.push(token)
  }
  result.q = words.join(' ')
  return result
}

function quote(v: string): string { return /\s/.test(v) ? `"${v}"` : v }

/** One removable condition chip, in display order. */
export interface QueryChip { key: string; value: string }

/** The chips (key:value) a filter shows in the search box, in a stable order. */
export function filterChips(filter: Filter, extras: { when?: WhenValue; createdWhen?: WhenValue; belongsName?: string } = {}): QueryChip[] {
  const out: QueryChip[] = []
  filter.stage?.forEach(v => out.push({ key: 'stage', value: v }))
  filter.format?.forEach(v => out.push({ key: 'format', value: v }))
  filter.tags?.all?.forEach(v => out.push({ key: 'tag', value: v }))
  filter.tags?.any?.forEach(v => out.push({ key: 'tag', value: v }))
  filter.tags?.none?.forEach(v => out.push({ key: '-tag', value: v }))
  filter.review?.forEach(v => out.push({ key: 'review', value: v }))
  if (filter.hasIssues) out.push({ key: 'is', value: 'issue' })
  if (filter.issue?.includes('stale-upstream')) out.push({ key: 'is', value: 'stale' })
  if (filter.issue?.includes('missing-file')) out.push({ key: 'is', value: 'missing' })
  if (filter.folder) out.push({ key: 'folder', value: filter.folder })
  if (filter.relation?.type === 'belongs') out.push({ key: 'belongs', value: extras.belongsName ?? filter.relation.to })
  filter.method?.forEach(v => out.push({ key: 'method', value: v }))
  const rev: Record<string, string> = { triangles: 'tris', duration: 'dur' }
  for (const [k, c] of Object.entries(filter.tech ?? {})) {
    const key = rev[k] ?? k
    if (c.gte != null) out.push({ key, value: `>=${c.gte}` })
    if (c.gt != null) out.push({ key, value: `>${c.gt}` })
    if (c.lte != null) out.push({ key, value: `<=${c.lte}` })
    if (c.lt != null) out.push({ key, value: `<${c.lt}` })
    if (c.eq != null) out.push({ key, value: String(c.eq) })
  }
  if (extras.when) out.push({ key: 'when', value: extras.when })
  if (extras.createdWhen) out.push({ key: 'created', value: extras.createdWhen })
  if (filter.by) out.push({ key: 'by', value: filter.by })
  if (filter.modifiedBy) out.push({ key: 'editor', value: filter.modifiedBy })
  if (filter.batch) out.push({ key: 'batch', value: filter.batch })
  return out
}

/** Inverse of parseQueryText (round-trips everything the syntax can express). */
export function formatQueryText(parsed: { q?: string; filter?: Filter; when?: WhenValue; createdWhen?: WhenValue; belongsName?: string }): string {
  const chips = filterChips(parsed.filter ?? {}, parsed)
  const parts = chips.map(c => `${c.key}:${quote(c.value)}`)
  if (parsed.q) parts.push(parsed.q)
  return parts.join(' ')
}
