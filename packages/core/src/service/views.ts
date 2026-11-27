/** Read models built from the index (AssetDetail, RelationView, Issue). */
import {
  versionNumberOf, type AssetDetail, type AssetSummary, type Bmeta, type CheckView, type Guid, type Issue, type IssueType,
  type JobStatus, type PipelineStage, type RelationView
} from '@bowerbird/schema'
import type { QueryEngine } from '../contracts.js'
import { rowToSummary, type AssetRow, type IndexStore, type IssueRow } from '../index/store.js'
import type { LocalLibraryFs } from '../library/fs.js'

export function issueView(r: IssueRow): Issue {
  let details: Record<string, unknown> = {}
  try { details = JSON.parse(r.details_json) as Record<string, unknown> } catch { /* keep empty */ }
  const withRelation = (r.type === 'broken-reference' || r.type === 'stale-upstream') && r.rel_to && r.rel_type
  return {
    id: r.id,
    type: r.type as IssueType,
    level: r.level as Issue['level'],
    assetId: r.asset_id,
    ...(withRelation ? { relation: { type: r.rel_type!, to: r.rel_to!, ...(r.rel_slot ? { slot: r.rel_slot } : {}) } } : {}),
    ...(r.path ? { path: r.path } : {}),
    details,
    foundAt: r.found_at
  }
}

export interface ViewDeps {
  store: IndexStore
  fs: LocalLibraryFs
  query: () => QueryEngine | null
  thumbnailUrl: (id: Guid, key: string | null) => string | null
}

/**
 * A parked missing asset (its last path now belongs to another asset) is shown with its real last path, never the
 * internal `.bowerbird/missing/…` index path.
 */
export function withOriginalPaths<T extends { id: string; path: string; name: string }>(store: IndexStore, list: T[]): T[] {
  const parked = store.parkedPaths()
  if (!parked.size) return list
  return list.map(s => { const p = parked.get(s.id); return p ? { ...s, path: p, name: p.slice(p.lastIndexOf('/') + 1) } : s })
}

/** Summaries in the given order: the query engine first, the index row as a fallback. */
export function summaries(d: ViewDeps, ids: Guid[]): AssetSummary[] {
  const uniq = [...new Set(ids)]
  const map = new Map<string, AssetSummary>()
  const q = d.query()
  if (q && uniq.length) {
    try { for (const s of q.summaries(uniq)) map.set(s.id, s) } catch { /* fall back */ }
  }
  for (const id of uniq) {
    if (map.has(id)) continue
    const row = d.store.row(id)
    if (row) map.set(id, rowToSummary(d.store, row, d.thumbnailUrl))
  }
  return withOriginalPaths(d.store, uniq.map(id => map.get(id)).filter((s): s is AssetSummary => !!s))
}

export function summaryOf(d: ViewDeps, id: Guid): AssetSummary | null { return summaries(d, [id])[0] ?? null }

function targetSizeOf(store: IndexStore, id: Guid, meta: Bmeta): AssetDetail['targetSize'] {
  const from = (aid: Guid): AssetDetail['targetSize'] => {
    const t = store.tech(aid)
    const w = Number(t.targetWidth), h = Number(t.targetHeight), dd = Number(t.targetDepth)
    return [w, h, dd].every(v => Number.isFinite(v) && v > 0) ? { w, h, d: dd, from: aid } : null
  }
  const own = from(id)
  if (own) return own
  for (const r of meta.relations ?? []) {
    if (r.type !== 'belongs') continue
    const t = from(r.to)
    if (t) return t
  }
  return null
}

export function bundleEntryOf(meta: Bmeta, files: Array<{ path: string }>): string | null {
  const explicit = (meta.fields?.['bowerbird.bundle'] as { entry?: string } | undefined)?.entry
  if (explicit && files.some(f => f.path === explicit)) return explicit
  const lower = files.map(f => f.path)
  return lower.find(p => p.toLowerCase() === 'index.html') ?? lower.find(p => /\.html?$/i.test(p) && !p.includes('/'))
    ?? lower.find(p => /\.html?$/i.test(p)) ?? lower[0] ?? null
}

/** Full detail of one asset. */
export async function buildDetail(d: ViewDeps, row: AssetRow): Promise<AssetDetail> {
  const { store } = d
  const meta = store.meta(row)
  const id = row.id
  const outRows = store.outgoing(id)
  const inRows = store.incoming(id)
  const related = [...outRows.map(r => r.to_id), ...inRows.map(r => r.from_id)]
  const sums = new Map(summaries(d, [id, ...related]).map(s => [s.id, s]))
  const self = sums.get(id) ?? rowToSummary(store, row, d.thumbnailUrl)
  const relState = new Map(outRows.map(r => [`${r.type}\u0000${r.to_id}\u0000${r.slot}`, r]))

  const nameOf = (aid: Guid): { name: string | null; inTrash: boolean } => {
    const s = sums.get(aid)
    if (s) return { name: s.name, inTrash: false }
    const t = store.trashByAsset(aid)
    return { name: t?.name ?? null, inTrash: !!t }
  }

  const outgoing: RelationView[] = (meta.relations ?? []).map(r => {
    const st = relState.get(`${r.type}\u0000${r.to}\u0000${r.slot ?? ''}`)
    const target = sums.get(r.to) ?? null
    const n = nameOf(r.to)
    const view: RelationView = {
      type: r.type, from: id, to: r.to, target, targetName: n.name, targetInTrash: n.inTrash,
      ...(r.slot ? { slot: r.slot } : {}), ...(r.note ? { note: r.note } : {}), ...(r.toHash ? { toHash: r.toHash } : {}),
      ...(r.role ? { role: r.role } : {}),
      broken: st ? !!st.broken : !target, stale: st ? !!st.stale : false
    }
    if (view.stale && target && r.toHash) {
      const tm = store.metaOf(r.to)
      const versions = tm?.versions ?? []
      const a = versionNumberOf(versions, r.toHash)
      const b = versionNumberOf(versions, target ? (store.row(r.to)?.hash ?? '') : '') ?? versions.length
      if (a) view.staleFrom = a
      if (b) view.staleTo = b
    }
    return view
  })
  const incoming: RelationView[] = inRows.map(r => {
    const n = nameOf(r.from_id)
    return {
      type: r.type, from: r.from_id, to: id, target: sums.get(r.from_id) ?? null, targetName: n.name, targetInTrash: n.inTrash,
      ...(r.slot ? { slot: r.slot } : {}), ...(r.note ? { note: r.note } : {}), ...(r.to_hash ? { toHash: r.to_hash } : {}),
      ...(r.role ? { role: r.role } : {}), broken: false, stale: !!r.stale
    }
  })

  const analysis: Record<string, Record<string, unknown>> = {}
  for (const a of store.prep('SELECT plugin, json FROM analysis WHERE asset_id = ?').all(id) as Array<{ plugin: string; json: string }>) {
    try { analysis[a.plugin] = JSON.parse(a.json) } catch { /* skip */ }
  }
  const probe = store.prep('SELECT unresolved_json FROM probe WHERE asset_id = ?').get(id) as { unresolved_json: string | null } | undefined
  let unresolvedRefs: string[] = []
  try { unresolvedRefs = probe?.unresolved_json ? JSON.parse(probe.unresolved_json) : [] } catch { /* skip */ }
  const checks: CheckView[] = (store.prep('SELECT * FROM checks WHERE asset_id = ? ORDER BY validator, rule').all(id) as Array<{ validator: string; rule: string; verdict: string; message: string; values_json: string | null }>)
    .map(c => ({ validator: c.validator, rule: c.rule, verdict: c.verdict as CheckView['verdict'], message: c.message, ...(c.values_json ? { values: JSON.parse(c.values_json) } : {}) }))

  const stageMap = new Map<string, { stage: PipelineStage; status: JobStatus; error?: string }>()
  for (const j of store.prep("SELECT stage, status, error FROM jobs WHERE asset_id = ? AND kind = 'process' AND stage IS NOT NULL ORDER BY updated_at").all(id) as Array<{ stage: PipelineStage; status: JobStatus; error: string | null }>) {
    stageMap.set(j.stage, { stage: j.stage, status: j.status, ...(j.error ? { error: j.error } : {}) })
  }

  let bundleFiles: AssetDetail['bundleFiles'] = null
  if (row.bundle && !row.missing) {
    const files = await d.fs.bundleFiles(row.path)
    const entry = bundleEntryOf(meta, files)
    bundleFiles = files.map(f => ({ path: f.path, size: f.size, entry: f.path === entry }))
  }

  return {
    ...self,
    hash: meta.hash,
    descriptionFull: meta.description ?? null,
    auto: meta.auto ?? null,
    fields: meta.fields ?? {},
    reviewVerdict: meta.review ?? null,
    versions: meta.versions ?? [],
    views: meta.views ?? null,
    thumbnailManual: !!meta.thumbnail,
    provenance: meta.provenance ?? null,
    modifiedBy: row.sidecar ? (meta.modified?.by ?? null) : null,
    tech: store.tech(id),
    analysis,
    unresolvedRefs,
    checks,
    relations: { outgoing, incoming },
    issues: store.issuesOf(id).map(issueView),
    bundleFiles,
    targetSize: targetSizeOf(store, id, meta),
    stages: [...stageMap.values()]
  }
}
