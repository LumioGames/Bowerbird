/**
 * QueryEngine (search.md「检索与融合」): structured filter in SQL → candidates; with a query word the candidates go
 * to every enabled search provider and the hit lists are fused by reciprocal rank; then sorting and cursor paging.
 * Without any provider, query words fall back to substring matching on name, tags and description.
 */
import type Database from 'better-sqlite3'
import {
  dirOf, normalizeTag, parseQueryText, type AssetSummary, type FacetCount, type Filter, type Guid, type Query, type SearchRequest,
  type SearchResponse
} from '@bowerbird/schema'
import type { IdSet, ScoredHit, SearchDoc } from '@bowerbird/plugin-sdk'
import { CoreError, type CreateQueryEngine, type QueryEngine, type SearchOptions } from '../contracts.js'
import { andWhere, buildWhere, hasReviewCondition, mergeFilters, normalizeFolder, normalizeTime, type Where } from './filter.js'
import { cursorOffset, decodeCursor, encodeCursor, keysetCursor, keysetWhere, orderBy, resolveSort, sortSelect, type SortSpec } from './sort.js'
import { fuse, type FusedHit } from './fusion.js'
import { fallbackSnippet, queryWords, substringSql } from './fallback.js'
import { loadSummaries, trashToSummary, type TrashRow } from './summaries.js'
import { providersCleared } from './refeed.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 1000
/** Minimum hits asked from each provider, so fusion and the first pages have enough to work with. */
const PROVIDER_MIN = 1000
/** Upper bound of the substring fallback's ordered list. */
const FALLBACK_CAP = 50_000
const IDS_CAP = 10_000
const TAG_FACETS = 200

interface HitList {
  list: FusedHit[]
  total: number
  /** Substring fallback words (snippets are computed for the page only). */
  words?: string[]
}

type Facets = NonNullable<SearchResponse['facets']>

function idSet(ids: Iterable<string>): IdSet {
  const s = new Set(ids)
  return { has: (id: string) => s.has(id), get size() { return s.size }, [Symbol.iterator]: () => s[Symbol.iterator]() }
}

function clampLimit(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)))
}

function errMessage(e: unknown): string { return e instanceof Error ? e.message : String(e) }

/**
 * A change counter for the columns the built-in view counts read, kept by temporary triggers on this connection
 * (every engine on the same connection shares them). Writes to other tables (jobs, cache) leave it alone.
 */
const counted = new WeakMap<object, { n: number }>()
function watchCountedTables(db: Database.Database): { version(): number } {
  let state = counted.get(db)
  if (!state) {
    const s = { n: 0 }
    counted.set(db, s)
    state = s
    db.function('bb_q_counted_changed', () => { s.n++; return null })
    const on = (name: string, event: string): string =>
      `CREATE TEMP TRIGGER IF NOT EXISTS ${name} AFTER ${event} BEGIN SELECT bb_q_counted_changed(); END;`
    db.exec([
      on('bb_q_assets_ins', 'INSERT ON main.assets'),
      on('bb_q_assets_del', 'DELETE ON main.assets'),
      on('bb_q_assets_upd', 'UPDATE OF auxiliary, review, issue_level, id ON main.assets'),
      on('bb_q_tags_ins', 'INSERT ON main.tags'),
      on('bb_q_tags_del', 'DELETE ON main.tags'),
      on('bb_q_tags_upd', 'UPDATE ON main.tags'),
      on('bb_q_trash_ins', 'INSERT ON main.trash'),
      on('bb_q_trash_del', 'DELETE ON main.trash')
    ].join('\n'))
  }
  const st = state
  return { version: () => st.n }
}

export const createQueryEngine: CreateQueryEngine = (opts) => {
  const { db, plugins, thumbnailUrl } = opts
  const log = opts.log.child('query')

  // Covering indexes (rebuildable like the rest of the index; owned by the query engine):
  // - q_facets: facet counts; `auxiliary` goes last, as a leading column the planner would take it for the
  //   (unselective) default scope;
  // - q_tags_count: tag counts;
  // - q_narrow: a narrow copy of the columns whole-library counts read, so they never scan the wide rows
  //   (meta_json makes a row ~1–2 KB). Leading `id`, so it is only ever used for id lookups or covering scans.
  db.exec(`DROP INDEX IF EXISTS q_assets_facets;
    CREATE INDEX IF NOT EXISTS q_facets ON assets(format, stage, review, auxiliary);
    CREATE INDEX IF NOT EXISTS q_tags_count ON tags(tag, ai, asset_id);
    CREATE INDEX IF NOT EXISTS q_narrow ON assets(id, auxiliary, review, issue_level);`)
  const changes = watchCountedTables(db)
  let countsCache: { version: string; value: ReturnType<QueryEngine['counts']> } | null = null
  const stmts = new Map<string, Database.Statement>()
  function stmt(sql: string): Database.Statement {
    let s = stmts.get(sql)
    if (!s) {
      if (stmts.size > 500) stmts.clear()
      s = db.prepare(sql)
      stmts.set(sql, s)
    }
    return s
  }

  /* ───────────── SQL helpers ───────────── */

  function count(w: Where): number {
    return stmt(`SELECT COUNT(*) FROM assets a WHERE ${w.sql}`).pluck().get(...w.params) as number
  }

  function sqlPage(w: Where, spec: SortSpec, cursor: ReturnType<typeof decodeCursor>, limit: number): { ids: string[]; next: string | null } {
    const ks = keysetWhere(spec, cursor)
    const ww = ks ? andWhere(w, ks.sql, ...ks.params) : w
    const rows = stmt(`SELECT a.id${sortSelect(spec)} FROM assets a WHERE ${ww.sql} ORDER BY ${orderBy(spec)} LIMIT ?`)
      .all(...ww.params, limit + 1) as Array<Record<string, unknown>>
    const more = rows.length > limit
    const page = rows.slice(0, limit)
    return { ids: page.map(r => r.id as string), next: more ? keysetCursor(spec, page[page.length - 1]!) : null }
  }

  function sqlIds(w: Where, spec: SortSpec, cap: number): string[] {
    return stmt(`SELECT a.id FROM assets a WHERE ${w.sql} ORDER BY ${orderBy(spec)} LIMIT ?`).pluck().all(...w.params, cap) as string[]
  }

  /**
   * Facet counts over the matched set in two queries: one GROUP BY over (format, stage, review), summed in JS, and one
   * over tags. The covering indexes below keep the whole-library case (the default view) an index-only scan.
   * A tag is either human or AI on one asset (core-A writes AI rows only for unadopted tags), so COUNT(*) is exact.
   */
  function facetsFor(w: Where, humanTagsOnly: boolean): Facets {
    const rows = stmt(`SELECT a.format AS f, a.stage AS s, a.review AS r, COUNT(*) AS n FROM assets a WHERE ${w.sql} GROUP BY 1, 2, 3`).all(...w.params) as Array<{ f: string; s: string; r: string; n: number }>
    const tally = (pick: (x: { f: string; s: string; r: string }) => string): FacetCount[] => {
      const m = new Map<string, number>()
      for (const x of rows) m.set(pick(x), (m.get(pick(x)) ?? 0) + x.n)
      return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
    }
    // Default scope (only auxiliary files hidden): exclude the few auxiliary ids instead of listing ~all ids.
    const scope = !w.restrictive && w.sql === 'a.auxiliary = 0'
      ? { sql: 'asset_id NOT IN (SELECT id FROM assets WHERE auxiliary = 1)', params: [] as unknown[] }
      : !w.restrictive && w.sql === '1'
        ? { sql: '1', params: [] as unknown[] }
        : { sql: `asset_id IN (SELECT a.id FROM assets a WHERE ${w.sql})`, params: w.params }
    const tags = stmt(`SELECT tag AS value, COUNT(*) AS count FROM tags WHERE ${scope.sql}${humanTagsOnly ? ' AND ai = 0' : ''}
      GROUP BY tag ORDER BY count DESC, value LIMIT ${TAG_FACETS}`).all(...scope.params) as FacetCount[]
    return { format: tally(x => x.f), stage: tally(x => x.s), review: tally(x => x.r), tags }
  }

  function inIds(w: Where, ids: string[]): Where {
    return andWhere(w, 'a.id IN (SELECT value FROM json_each(?))', JSON.stringify(ids))
  }

  /* ───────────── query words ───────────── */

  async function hits(q: string, filter: Filter, where: Where, want: number): Promise<HitList> {
    const providers = plugins.searchProviders()
    if (providers.length === 0) {
      const words = queryWords(q)
      const s = substringSql(words, !!filter.humanTagsOnly)
      const rows = stmt(`SELECT a.id AS id, (${s.score}) AS sc FROM assets a WHERE (${where.sql}) AND ${s.cond}
        ORDER BY sc DESC, a.modified_at DESC, a.id DESC LIMIT ?`).all(...s.scoreParams, ...where.params, ...s.condParams, FALLBACK_CAP) as Array<{ id: string; sc: number }>
      const total = rows.length < FALLBACK_CAP ? rows.length : count(andWhere(where, s.cond, ...s.condParams))
      return { list: rows.map(r => ({ id: r.id, score: r.sc })), total, words }
    }

    let candidates: IdSet | undefined
    if (where.restrictive) {
      const ids = stmt(`SELECT a.id FROM assets a WHERE ${where.sql}`).pluck().all(...where.params) as string[]
      if (ids.length === 0) return { list: [], total: 0 }
      candidates = idSet(ids)
    }
    const limit = Math.max(PROVIDER_MIN, want)
    const lists = await Promise.all(providers.map(({ pluginId, provider }) =>
      plugins.invoke(pluginId, `search.query:${provider.id}`, () => provider.query(q, candidates ? { candidates, limit } : { limit }))
        .then(r => (Array.isArray(r) ? r : []))
        .catch((e: unknown): ScoredHit[] => {
          log.warn('search provider failed', { plugin: pluginId, provider: provider.id, error: errMessage(e) })
          return []
        })))
    const fused = fuse(lists)
    if (fused.length === 0) return { list: [], total: 0 }
    // Post-filter: providers may answer for the whole library or hold stale ids.
    const ok = new Set(stmt(`SELECT a.id FROM assets a WHERE (${where.sql}) AND a.id IN (SELECT value FROM json_each(?))`)
      .pluck().all(...where.params, JSON.stringify(fused.map(h => h.id))) as string[])
    const list = fused.filter(h => ok.has(h.id))
    return { list, total: list.length }
  }

  function decorate(items: AssetSummary[], byId: Map<string, FusedHit>, words: string[] | undefined): AssetSummary[] {
    let full: Map<string, { description: string | null; autoDescription: string | null }> | null = null
    if (words && items.length) {
      const rows = stmt('SELECT id, description, auto_description FROM assets WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(items.map(i => i.id))) as Array<{ id: string; description: string | null; auto_description: string | null }>
      full = new Map(rows.map(r => [r.id, { description: r.description, autoDescription: r.auto_description }]))
    }
    return items.map(s => {
      const h = byId.get(s.id)
      const out: AssetSummary = { ...s, score: h?.score ?? 0 }
      const hit = words ? fallbackSnippet(s, words, full?.get(s.id) ?? { description: null, autoDescription: null }) : h?.hit
      if (hit) out.hit = hit
      return out
    })
  }

  /* ───────────── trash ───────────── */

  function trashItems(): Array<{ row: TrashRow; s: AssetSummary }> {
    const rows = stmt('SELECT id, asset_id, name, original_path, deleted_at, deleted_by, size, format, meta_json FROM trash').all() as TrashRow[]
    const thumbs = new Map((stmt("SELECT asset_id, key FROM cache_files WHERE variant = 'thumb' AND asset_id IN (SELECT asset_id FROM trash)").all() as Array<{ asset_id: string; key: string }>)
      .map(r => [r.asset_id, r.key]))
    return rows.map(row => ({ row, s: trashToSummary(row, thumbs.get(row.asset_id) ?? null, thumbnailUrl) }))
  }

  /** Filters the trash in memory (it is small); only fields a trashed asset still has apply. */
  function trashMatch(filter: Filter, q: string): (x: { row: TrashRow; s: AssetSummary }) => boolean {
    const words = queryWords(q).map(w => w.toLowerCase())
    const folder = filter.folder !== undefined ? normalizeFolder(filter.folder) : null
    const all = (filter.tags?.all ?? []).map(normalizeTag)
    const any = (filter.tags?.any ?? []).map(normalizeTag)
    const none = (filter.tags?.none ?? []).map(normalizeTag)
    const ids = filter.ids ? new Set(filter.ids) : null
    return ({ s }) => {
      const tagPool = filter.humanTagsOnly ? s.tags : [...s.tags, ...s.autoTags]
      if (filter.stage?.length && !filter.stage.includes(s.stage)) return false
      if (filter.format?.length && !filter.format.includes(s.format)) return false
      if (filter.review?.length && !filter.review.includes(s.review)) return false
      if (all.some(t => !tagPool.includes(t))) return false
      if (any.length && !any.some(t => tagPool.includes(t))) return false
      if (none.some(t => tagPool.includes(t))) return false
      if (folder !== null) {
        const f = dirOf(s.path)
        if (filter.folderExact ? f !== folder : folder !== '' && f !== folder && !f.startsWith(folder + '/')) return false
      }
      if (filter.created?.after && s.created < normalizeTime(filter.created.after)) return false
      if (filter.created?.before && s.created >= normalizeTime(filter.created.before)) return false
      if (filter.modified?.after && s.modified < normalizeTime(filter.modified.after)) return false
      if (filter.modified?.before && s.modified >= normalizeTime(filter.modified.before)) return false
      if (filter.by && !(filter.by.includes(':') ? s.createdBy === filter.by : s.createdBy.startsWith(filter.by + ':'))) return false
      if (ids && !ids.has(s.id)) return false
      if (filter.untagged === true && (s.tags.length || s.autoTags.length)) return false
      if (filter.untagged === false && !(s.tags.length || s.autoTags.length)) return false
      if (!filter.includeAuxiliary && !ids && s.auxiliary) return false
      for (const w of words) {
        const hay = [s.name, ...tagPool, s.description ?? ''].join('\n').toLowerCase()
        if (!hay.includes(w)) return false
      }
      return true
    }
  }

  function trashSorted(filter: Filter, q: string, spec: SortSpec): Array<{ row: TrashRow; s: AssetSummary }> {
    const items = trashItems().filter(trashMatch(filter, q))
    const sign = spec.dir === 'asc' ? 1 : -1
    const cmp = (x: string | number, y: string | number): number => (x < y ? -1 : x > y ? 1 : 0)
    const key = (x: { row: TrashRow; s: AssetSummary }): Array<string | number> => {
      switch (spec.key) {
        case 'name': return [x.s.name.toLowerCase()]
        case 'modified': return [x.s.modified]
        case 'created': return [x.s.created]
        case 'size': return [x.s.size]
        case 'format': return [x.s.format, x.s.name.toLowerCase()]
        default: return [x.row.deleted_at]
      }
    }
    return items.sort((a, b) => {
      const ka = key(a), kb = key(b)
      for (let i = 0; i < ka.length; i++) { const c = cmp(ka[i]!, kb[i]!); if (c) return c * sign }
      return cmp(a.s.id, b.s.id) * sign
    })
  }

  function trashFacets(items: AssetSummary[]): Facets {
    const tally = (vals: string[]): FacetCount[] => {
      const m = new Map<string, number>()
      for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1)
      return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1))
    }
    return {
      format: tally(items.map(i => i.format)),
      stage: tally(items.map(i => i.stage)),
      review: tally(items.map(i => i.review)),
      tags: tally(items.flatMap(i => [...new Set([...i.tags, ...i.autoTags])])).slice(0, TAG_FACETS)
    }
  }

  /* ───────────── public ───────────── */

  function prepare(query: Query, agent: SearchOptions | null): { q: string; filter: Filter; scoped: boolean } {
    // The search box syntax (`stage:runtime created:week tag:宝箱 …`) is parsed here, at execution time, so relative
    // times in saved views stay relative; only the remaining free text goes to the search providers.
    const parsed = parseQueryText(query.q ?? '', new Date())
    const q = parsed.q.trim()
    const filter: Filter = mergeFilters(parsed.filter, query.filter ?? {})
    if (filter.similarTo) throw new CoreError('unsupported', '以图搜图需要语义搜索插件，现在没有安装', { feature: 'similarTo' })
    let scoped = false
    if (agent?.agent && agent.scope === 'approved' && !hasReviewCondition(filter)) {
      filter.review = ['approved', 'exempt']
      scoped = true
    }
    return { q, filter, scoped }
  }

  const engine: QueryEngine = {
    async search(req: SearchRequest, so: SearchOptions): Promise<SearchResponse> {
      const { q, filter, scoped } = prepare(req, so)
      const limit = clampLimit(req.limit)
      const spec = resolveSort(req.sort, req.order, q !== '')
      const cursor = decodeCursor(req.cursor, spec)
      const withScope = (r: SearchResponse): SearchResponse => (scoped ? { ...r, scopedToApproved: true } : r)

      if (filter.inTrash) {
        const all = trashSorted(filter, q, spec)
        const off = cursorOffset(cursor)
        const page = all.slice(off, off + limit).map(x => x.s)
        const res: SearchResponse = {
          items: q ? page.map(s => ({ ...s, score: 0 })) : page,
          total: all.length,
          cursor: off + limit < all.length ? encodeCursor({ s: spec.key, d: spec.dir, off: off + limit }) : null
        }
        if (req.facets) res.facets = trashFacets(all.map(x => x.s))
        return withScope(res)
      }

      const where = buildWhere(filter)
      if (!q) {
        const { ids, next } = sqlPage(where, spec, cursor, limit)
        const res: SearchResponse = { items: loadSummaries(db, ids, thumbnailUrl), total: count(where), cursor: next }
        if (req.facets) res.facets = facetsFor(where, !!filter.humanTagsOnly)
        return withScope(res)
      }

      const relevance = spec.key === 'relevance'
      const off = relevance ? cursorOffset(cursor) : 0
      const h = await hits(q, filter, where, relevance ? off + limit + 1 : IDS_CAP)
      const byId = new Map(h.list.map(x => [x.id, x]))
      let ids: string[]
      let next: string | null
      if (relevance) {
        ids = h.list.slice(off, off + limit).map(x => x.id)
        next = off + limit < h.list.length ? encodeCursor({ s: spec.key, d: spec.dir, off: off + limit }) : null
      } else {
        ({ ids, next } = h.list.length ? sqlPage(inIds(where, h.list.map(x => x.id)), spec, cursor, limit) : { ids: [], next: null })
      }
      const res: SearchResponse = { items: decorate(loadSummaries(db, ids, thumbnailUrl), byId, h.words), total: h.total, cursor: next }
      if (req.facets) {
        res.facets = h.list.length
          ? facetsFor(inIds(where, h.list.map(x => x.id)), !!filter.humanTagsOnly)
          : { format: [], stage: [], review: [], tags: [] }
      }
      return withScope(res)
    },

    async ids(query: Query, cap: number = IDS_CAP): Promise<Guid[]> {
      const { q, filter } = prepare(query, null)
      const spec = resolveSort(query.sort, query.order, q !== '')
      if (filter.inTrash) return trashSorted(filter, q, spec).slice(0, cap).map(x => x.s.id)
      const where = buildWhere(filter)
      if (!q) return sqlIds(where, spec, cap)
      const h = await hits(q, filter, where, cap)
      if (spec.key === 'relevance') return h.list.slice(0, cap).map(x => x.id)
      return h.list.length ? sqlIds(inIds(where, h.list.map(x => x.id)), spec, cap) : []
    },

    counts() {
      // The built-in views are counted on every page load: recount only after a counted column changed on this
      // connection (triggers below) or another connection committed (data_version). Job and cache writes don't count.
      const version = `${changes.version()}:${db.pragma('data_version', { simple: true }) as number}`
      if (countsCache && countsCache.version === version) return { ...countsCache.value }
      // One covering scan of the narrow index; untagged probes the tags primary key per asset.
      const r = stmt(`SELECT COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN a.review = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN a.issue_level >= 2 THEN 1 ELSE 0 END), 0) AS issues,
          COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM tags t WHERE t.asset_id = a.id) THEN 1 ELSE 0 END), 0) AS untagged
        FROM assets a INDEXED BY q_narrow WHERE a.auxiliary = 0`).get() as { total: number; pending: number; issues: number; untagged: number }
      const trash = stmt('SELECT COUNT(*) FROM trash').pluck().get() as number
      const value = { all: r.total, untagged: r.untagged, pending: r.pending, issues: r.issues, trash }
      countsCache = { version, value }
      return { ...value }
    },

    async countFor(query: Query): Promise<number> {
      const { q, filter } = prepare(query, null)
      if (filter.inTrash) return trashItems().filter(trashMatch(filter, q)).length
      const where = buildWhere(filter)
      if (!q) return count(where)
      return (await hits(q, filter, where, IDS_CAP)).total
    },

    summaries(ids: Guid[]): AssetSummary[] {
      return loadSummaries(db, ids, thumbnailUrl)
    },

    async indexDocs(docs: SearchDoc[]): Promise<void> {
      if (docs.length === 0) return
      await forEachProvider('index', p => p.index(docs))
    },

    async removeDocs(ids: Guid[]): Promise<void> {
      if (ids.length === 0) return
      await forEachProvider('remove', p => p.remove(ids))
    },

    async clearProviders(): Promise<void> {
      try { await forEachProvider('clear', p => (p.clear ? p.clear() : Promise.resolve())) }
      finally { providersCleared(db) } // the pipeline feeds every asset again
    }
  }

  /** Run on every provider; one failing provider does not stop the others; the first error is rethrown. */
  async function forEachProvider(label: string, fn: (p: import('@bowerbird/plugin-sdk').SearchProvider) => Promise<void>): Promise<void> {
    let first: unknown = null
    for (const { pluginId, provider } of plugins.searchProviders()) {
      try { await plugins.invoke(pluginId, `search.${label}:${provider.id}`, () => fn(provider)) }
      catch (e) {
        log.warn(`search provider ${label} failed`, { plugin: pluginId, provider: provider.id, error: errMessage(e) })
        first ??= e
      }
    }
    if (first) throw first
  }

  return engine
}
