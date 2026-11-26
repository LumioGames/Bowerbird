/**
 * Index rows → AssetSummary (search.md「结果」). Every read that returns summaries goes through here.
 */
import {
  ASSET_FLAGS, effectiveReview, firstSentence, normalizeTag, type AssetFlag, type AssetSummary, type Bmeta, type Guid
} from '@bowerbird/schema'
import type { IndexDb } from '../contracts.js'
import { FLAG } from '../index/ddl.js'

export interface AssetRow {
  id: string; path: string; folder: string; name: string; stem: string; ext: string; format: string; plugin: string | null
  hash: string; size: number; stage: string; review: string; bundle: number; auxiliary: number; missing: number
  created_at: string; created_by: string; modified_at: string; description: string | null; auto_description: string | null
  thumb_state: string; thumb_key: string | null; thumb_manual: number; aspect: number | null; badge: string | null
  cell_title: string | null; cell_excerpt: string | null; flags: number; issue_level: number; issue_count: number
  member_count: number; missing_plugin: string | null; seq: number; meta_json: string
}

const COLUMNS = `a.id, a.path, a.folder, a.name, a.stem, a.ext, a.format, a.plugin, a.hash, a.size, a.stage, a.review, a.bundle,
  a.auxiliary, a.missing, a.created_at, a.created_by, a.modified_at, a.description, a.auto_description, a.thumb_state,
  a.thumb_key, a.thumb_manual, a.aspect, a.badge, a.cell_title, a.cell_excerpt, a.flags, a.issue_level, a.issue_count, a.member_count,
  a.missing_plugin, a.seq, a.meta_json`

const LEVELS = [null, 'info', 'warning', 'error'] as const

export function flagsOf(bits: number, missing: boolean): AssetFlag[] {
  const out: AssetFlag[] = []
  for (const f of ASSET_FLAGS) if ((bits & FLAG[f]) !== 0 || (f === 'missing' && missing)) out.push(f)
  return out
}

function parseMissingPlugin(raw: string | null): AssetSummary['missingPlugin'] {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { id?: unknown; range?: unknown; displayName?: unknown }
    if (!v || typeof v.id !== 'string') return null
    const out: NonNullable<AssetSummary['missingPlugin']> = { id: v.id }
    if (typeof v.range === 'string') out.range = v.range
    if (typeof v.displayName === 'string') out.displayName = v.displayName
    return out
  } catch { return null }
}

export type ThumbnailUrl = (assetId: Guid, key: string | null) => string | null

/** Tags in .bmeta order, normalized and de-duplicated (the order people gave them). */
function uniqTags(tags: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of Array.isArray(tags) ? tags : []) {
    if (typeof t !== 'string') continue
    const n = normalizeTag(t)
    if (n && !seen.has(n)) { seen.add(n); out.push(n) }
  }
  return out
}

/** Human tags and unadopted AI tags from the copy of the .bmeta in the index, and whether it has a view grid. */
export function tagsOfMeta(metaJson: string | null): { tags: string[]; autoTags: string[]; hasViews: boolean } {
  let meta: Partial<Bmeta> | null = null
  try { meta = metaJson ? (JSON.parse(metaJson) as Partial<Bmeta>) : null } catch { meta = null }
  const tags = uniqTags(meta?.tags)
  const human = new Set(tags)
  return { tags, autoTags: uniqTags(meta?.auto?.tags).filter(t => !human.has(t)), hasViews: !!meta?.views }
}

/**
 * Cache key in the thumbnail URL: the pipeline's key, or for a manual thumbnail (not a cache file) `m<seq>`, which
 * changes on every write of the asset, so browsers never keep a replaced manual thumbnail.
 */
export function thumbKeyOf(r: Pick<AssetRow, 'thumb_manual' | 'seq' | 'thumb_key'>): string | null {
  return r.thumb_manual ? `m${r.seq}` : r.thumb_key
}

export function rowToSummary(r: AssetRow, tags: string[], autoTags: string[], thumbnailUrl: ThumbnailUrl, hasViews = false): AssetSummary {
  const level = LEVELS[Math.max(0, Math.min(3, r.issue_level))] ?? null
  const thumbState = (['ready', 'pending', 'render', 'none', 'failed'] as const).find(s => s === r.thumb_state) ?? 'pending'
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    format: r.format,
    plugin: r.plugin,
    stage: r.stage as AssetSummary['stage'],
    review: r.review as AssetSummary['review'],
    tags,
    autoTags,
    description: firstSentence(r.description) ?? firstSentence(r.auto_description),
    flags: flagsOf(r.flags, r.missing !== 0),
    thumbnail: thumbState === 'ready' ? thumbnailUrl(r.id, thumbKeyOf(r)) : null,
    thumbState,
    aspect: r.aspect ?? null,
    badge: r.badge ?? null,
    issueLevel: level,
    issueCount: r.issue_count,
    size: r.size,
    modified: r.modified_at,
    created: r.created_at,
    createdBy: r.created_by,
    bundle: r.bundle !== 0,
    auxiliary: r.auxiliary !== 0,
    memberCount: r.member_count,
    cellText: r.cell_title != null || r.cell_excerpt != null
      ? { ...(r.cell_title != null ? { title: r.cell_title } : {}), ...(r.cell_excerpt != null ? { excerpt: r.cell_excerpt } : {}) }
      : null,
    missingPlugin: parseMissingPlugin(r.missing_plugin),
    ...(hasViews ? { hasViews: true } : {})
  }
}

/** Summaries for ids, in the given order; unknown ids are skipped. */
export function loadSummaries(db: IndexDb, ids: Guid[], thumbnailUrl: ThumbnailUrl): AssetSummary[] {
  if (ids.length === 0) return []
  const json = JSON.stringify(ids)
  const rows = db.prepare(`SELECT ${COLUMNS} FROM assets a WHERE a.id IN (SELECT value FROM json_each(?))`).all(json) as AssetRow[]
  const byId = new Map(rows.map(r => [r.id, r]))
  const out: AssetSummary[] = []
  for (const id of ids) {
    const r = byId.get(id)
    if (!r) continue
    const { tags, autoTags, hasViews } = tagsOfMeta(r.meta_json)
    out.push(rowToSummary(r, tags, autoTags, thumbnailUrl, hasViews))
  }
  return out
}

/* ───────────── trash ───────────── */

export interface TrashRow {
  id: string; asset_id: string; name: string; original_path: string; deleted_at: string; deleted_by: string
  size: number; format: string; meta_json: string | null
}

/** A summary for a trashed asset, from the copy of its .bmeta kept in the trash table. */
export function trashToSummary(r: TrashRow, thumbKey: string | null, thumbnailUrl: ThumbnailUrl): AssetSummary {
  let meta: Partial<Bmeta> | null = null
  try { meta = r.meta_json ? (JSON.parse(r.meta_json) as Partial<Bmeta>) : null } catch { meta = null }
  const tags = (meta?.tags ?? []).map(normalizeTag)
  const autoTags = (meta?.auto?.tags ?? []).map(normalizeTag).filter(t => !tags.includes(t))
  const review = meta && meta.hash ? effectiveReview({ hash: meta.hash, review: meta.review }) : 'pending'
  return {
    id: r.asset_id,
    name: r.name,
    path: r.original_path,
    format: r.format,
    plugin: null,
    stage: meta?.stage ?? 'production',
    review,
    tags,
    autoTags,
    description: firstSentence(meta?.description) ?? firstSentence(meta?.auto?.description),
    flags: [],
    thumbnail: thumbKey ? thumbnailUrl(r.asset_id, thumbKey) : null,
    thumbState: thumbKey ? 'ready' : 'none',
    aspect: null,
    badge: null,
    issueLevel: null,
    issueCount: 0,
    size: r.size,
    modified: meta?.modified?.at ?? meta?.created?.at ?? r.deleted_at,
    created: meta?.created?.at ?? r.deleted_at,
    createdBy: meta?.created?.by ?? 'user:unnamed',
    bundle: Boolean(meta?.bundle),
    auxiliary: Boolean(meta?.auxiliary),
    memberCount: 0,
    cellText: null,
    missingPlugin: null
  }
}
