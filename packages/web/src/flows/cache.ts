import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { AssetDetail, AssetSummary, SearchResponse } from '@bowerbird/schema'

/**
 * Optimistic updates (web-shell.md「前端状态」: writes update at once, roll back with a toast on failure).
 * The rows shown live in the browse pages (`['lib', lib, 'browse', …]`) and in asset details; both are patched.
 */
type Pages = InfiniteData<SearchResponse, unknown>

function browseEntries(qc: QueryClient, lib: string) {
  return qc.getQueriesData<Pages>({ queryKey: ['lib', lib, 'browse'] }).filter(([, d]) => d && Array.isArray(d.pages))
}

/**
 * id → summary for one cached result, built once per data object (the cache replaces the object on every change, so
 * the index never goes stale). Lookups for a selection are then O(selected), not O(selected × loaded).
 */
const indexes = new WeakMap<object, Map<string, AssetSummary>>()
function indexOf(d: Pages | SearchResponse): Map<string, AssetSummary> {
  let m = indexes.get(d)
  if (!m) {
    m = new Map()
    for (const a of 'pages' in d ? d.pages.flatMap(p => p.items) : d.items ?? []) if (!m.has(a.id)) m.set(a.id, a)
    indexes.set(d, m)
  }
  return m
}

/** Find a summary anywhere in the cache (grid pages, asset details). */
export function findSummary(qc: QueryClient, lib: string, id: string): AssetSummary | null {
  return findSummaries(qc, lib, [id])[0] ?? null
}

export function findSummaries(qc: QueryClient, lib: string, ids: readonly string[]): AssetSummary[] {
  const pages = browseEntries(qc, lib).map(([, d]) => indexOf(d!))
  const searches = qc.getQueriesData<SearchResponse>({ queryKey: ['lib', lib, 'search'] }).filter(([, d]) => d && Array.isArray(d.items)).map(([, d]) => indexOf(d!))
  const out: AssetSummary[] = []
  for (const id of ids) {
    let a: AssetSummary | null | undefined = null
    for (const m of pages) { a = m.get(id); if (a) break }
    if (!a) a = qc.getQueryData<AssetDetail>(['lib', lib, 'asset', id]) ?? null
    if (!a) for (const m of searches) { a = m.get(id); if (a) break }
    if (a) out.push(a)
  }
  return out
}

/** Apply `fn` to every cached copy of these assets. Returns the rollback. */
export function patchAssets(qc: QueryClient, lib: string, ids: readonly string[], fn: <T extends AssetSummary>(a: T) => T): () => void {
  const set = new Set(ids)
  const saved: Array<[readonly unknown[], unknown]> = []
  for (const [key, d] of browseEntries(qc, lib)) {
    if (!d!.pages.some(p => p.items.some(a => set.has(a.id)))) continue
    saved.push([key, d])
    qc.setQueryData<Pages>(key, { ...d!, pages: d!.pages.map(p => ({ ...p, items: p.items.map(a => (set.has(a.id) ? fn(a) : a)) })) })
  }
  for (const id of ids) {
    const key = ['lib', lib, 'asset', id]
    const det = qc.getQueryData<AssetDetail>(key)
    if (det) { saved.push([key, det]); qc.setQueryData(key, fn(det)) }
  }
  return () => { for (const [key, d] of saved) qc.setQueryData(key, d) }
}

/** Replace cached summaries by fresh ones (from details or the server). */
export function putSummaries(qc: QueryClient, lib: string, fresh: readonly AssetSummary[]): void {
  const byId = new Map(fresh.map(a => [a.id, a]))
  for (const [key, d] of browseEntries(qc, lib)) {
    if (!d!.pages.some(p => p.items.some(a => byId.has(a.id)))) continue
    qc.setQueryData<Pages>(key, { ...d!, pages: d!.pages.map(p => ({ ...p, items: p.items.map(a => { const f = byId.get(a.id); return f ? toSummary(f, a) : a }) })) })
  }
}

/** Take the summary fields from a detail (keeps the hit snippet / score of the row it replaces). */
export function toSummary(f: AssetSummary, prev?: AssetSummary): AssetSummary {
  const s: AssetSummary = {
    id: f.id, name: f.name, path: f.path, format: f.format, plugin: f.plugin, stage: f.stage, review: f.review, tags: f.tags,
    autoTags: f.autoTags, description: f.description, flags: f.flags, thumbnail: f.thumbnail, thumbState: f.thumbState,
    aspect: f.aspect, badge: f.badge, issueLevel: f.issueLevel, issueCount: f.issueCount, size: f.size, modified: f.modified,
    created: f.created, createdBy: f.createdBy, bundle: f.bundle, auxiliary: f.auxiliary, memberCount: f.memberCount,
    cellText: f.cellText, missingPlugin: f.missingPlugin
  }
  if (prev?.score != null) s.score = prev.score
  if (prev?.hit) s.hit = prev.hit
  return s
}

/** Take assets out of the shown pages (trash, move out of a folder). Returns the rollback. */
export function removeAssets(qc: QueryClient, lib: string, ids: readonly string[]): () => void {
  const set = new Set(ids)
  const saved: Array<[readonly unknown[], unknown]> = []
  for (const [key, d] of browseEntries(qc, lib)) {
    if (!d!.pages.some(p => p.items.some(a => set.has(a.id)))) continue
    saved.push([key, d])
    let removed = 0
    const pages = d!.pages.map(p => { const items = p.items.filter(a => !set.has(a.id)); removed += p.items.length - items.length; return { ...p, items } })
    qc.setQueryData<Pages>(key, { ...d!, pages: pages.map((p, i) => (i === 0 ? { ...p, total: Math.max(0, p.total - removed) } : p)) })
  }
  return () => { for (const [key, d] of saved) qc.setQueryData(key, d) }
}

/** Run a write optimistically: apply now, call the server, roll back on failure (the caller shows the toast). */
export async function optimistic<T>(apply: () => () => void, request: () => Promise<T>): Promise<T> {
  const rollback = apply()
  try { return await request() } catch (e) { rollback(); throw e }
}
