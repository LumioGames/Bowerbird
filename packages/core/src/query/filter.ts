/**
 * Structured filter → SQL over the index (search.md「筛选字段」). The result is a boolean expression over the
 * `assets` table aliased `a`, plus its positional parameters. Fields AND together; values inside one array OR.
 */
import { Guid, normalizeTag, TECH_ALIASES, type Filter } from '@bowerbird/schema'

export interface Where {
  sql: string
  params: unknown[]
  /** Something beyond the default scope (auxiliary exclusion) narrows the result. */
  restrictive: boolean
}

const ph = (n: number): string => Array.from({ length: n }, () => '?').join(', ')
const nonEmpty = <T>(arr: T[] | undefined): arr is T[] => Array.isArray(arr) && arr.length > 0

/** `props/` → `props`; `./a/b/` → `a/b`; `/` → `` (library root). */
export function normalizeFolder(folder: string): string {
  return folder.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

/** ISO time for comparison with stored UTC ISO strings; unparseable values are passed through. */
export function normalizeTime(value: string): string {
  const t = Date.parse(value)
  return Number.isNaN(t) ? value : new Date(t).toISOString()
}

/** Whether the filter asks for an explicit review condition (agent scope only applies without one). */
export function hasReviewCondition(filter: Filter | undefined): boolean {
  return nonEmpty(filter?.review)
}

export function buildWhere(f: Filter): Where {
  const conds: string[] = []
  const params: unknown[] = []
  let defaults = 0
  const add = (sql: string, ...p: unknown[]): void => { conds.push(sql); params.push(...p) }

  if (nonEmpty(f.stage)) add(`a.stage IN (${ph(f.stage.length)})`, ...f.stage)
  if (nonEmpty(f.format)) add(`a.format IN (${ph(f.format.length)})`, ...f.format)

  if (f.tags) {
    const ai = f.humanTagsOnly ? ' AND ai = 0' : ''
    const all = (f.tags.all ?? []).map(normalizeTag).filter(Boolean)
    const any = (f.tags.any ?? []).map(normalizeTag).filter(Boolean)
    const none = (f.tags.none ?? []).map(normalizeTag).filter(Boolean)
    for (const t of new Set(all)) add(`a.id IN (SELECT asset_id FROM tags WHERE tag = ?${ai})`, t)
    if (any.length) add(`a.id IN (SELECT asset_id FROM tags WHERE tag IN (${ph(any.length)})${ai})`, ...any)
    if (none.length) add(`a.id NOT IN (SELECT asset_id FROM tags WHERE tag IN (${ph(none.length)})${ai})`, ...none)
  }

  if (f.folder !== undefined) {
    const folder = normalizeFolder(f.folder)
    if (f.folderExact) add('a.folder = ?', folder)
    // '0' is the character after '/': the range covers every sub folder and stays index-friendly.
    else if (folder !== '') add('(a.folder = ? OR (a.folder >= ? AND a.folder < ?))', folder, folder + '/', folder + '0')
  }

  if (nonEmpty(f.review)) add(`a.review IN (${ph(f.review.length)})`, ...f.review)
  if (f.hasIssues === true) add('a.issue_level >= 2')
  else if (f.hasIssues === false) add('a.issue_level < 2')
  if (nonEmpty(f.issue)) add(`a.id IN (SELECT asset_id FROM issues WHERE asset_id IS NOT NULL AND type IN (${ph(f.issue.length)}))`, ...f.issue)

  for (const [rawKey, c] of Object.entries(f.tech ?? {})) {
    const key = TECH_ALIASES[rawKey] ?? rawKey
    const parts: string[] = []
    const p: unknown[] = [key]
    if (c.eq !== undefined) {
      if (typeof c.eq === 'number') { parts.push('num = ?'); p.push(c.eq) }
      else if (typeof c.eq === 'boolean') { parts.push('(num = ? OR txt = ?)'); p.push(c.eq ? 1 : 0, String(c.eq)) }
      else { parts.push('txt = ?'); p.push(c.eq) }
    }
    if (c.gte != null) { parts.push('num >= ?'); p.push(c.gte) }
    if (c.gt != null) { parts.push('num > ?'); p.push(c.gt) }
    if (c.lte != null) { parts.push('num <= ?'); p.push(c.lte) }
    if (c.lt != null) { parts.push('num < ?'); p.push(c.lt) }
    if (parts.length) add(`a.id IN (SELECT asset_id FROM tech WHERE key = ? AND ${parts.join(' AND ')})`, ...p)
  }

  if (f.relation) {
    const { type, to } = f.relation
    // `belongs:<name>` from the search box: the design object by name without extension, file name or title.
    const byGuid = Guid.safeParse(to).success
    const target = byGuid ? '= ?' : 'IN (SELECT id FROM assets WHERE stem = ? OR name = ? OR cell_title = ?)'
    const tp = byGuid ? [to] : [to, to, to]
    if ((f.relation.direction ?? 'out') === 'out') add(`a.id IN (SELECT from_id FROM relations WHERE type = ? AND to_id ${target})`, type, ...tp)
    else add(`a.id IN (SELECT to_id FROM relations WHERE type = ? AND from_id ${target})`, type, ...tp)
  }

  for (const [col, range] of [['a.created_at', f.created], ['a.modified_at', f.modified]] as const) {
    if (range?.after) add(`${col} >= ?`, normalizeTime(range.after))
    if (range?.before) add(`${col} < ?`, normalizeTime(range.before))
  }

  if (f.by) {
    // `agent` matches every agent; `agent:modeler` only that one (schema actorMatches).
    if (f.by.includes(':')) add('a.created_by = ?', f.by)
    else add('(a.created_by >= ? AND a.created_by < ?)', f.by + ':', f.by + ';')
  }

  if (nonEmpty(f.method)) {
    const m = ph(f.method.length)
    add(`(a.method IN (${m}) OR a.id IN (SELECT r.from_id FROM relations r JOIN records rec ON rec.id = r.record WHERE r.type = 'source' AND rec.method IN (${m})))`, ...f.method, ...f.method)
  }

  if (f.ids) {
    if (f.ids.length === 0) add('0')
    else add('a.id IN (SELECT value FROM json_each(?))', JSON.stringify(f.ids))
  }

  if (f.untagged === true) add('a.id NOT IN (SELECT asset_id FROM tags)')
  else if (f.untagged === false) add('a.id IN (SELECT asset_id FROM tags)')

  // Auxiliary files are hidden by default; an explicit id list (batch, review queue) is taken as given.
  if (!f.includeAuxiliary && !f.ids) { add('a.auxiliary = 0'); defaults++ }

  return { sql: conds.length ? conds.join(' AND ') : '1', params, restrictive: conds.length > defaults }
}

/** AND two where clauses. */
export function andWhere(w: Where, sql: string, ...params: unknown[]): Where {
  return { sql: `(${w.sql}) AND ${sql}`, params: [...w.params, ...params], restrictive: true }
}

/**
 * Merge the filter parsed from the search box text with the request's explicit filter. Rule: per field the
 * explicit filter wins (the filter panel is authoritative when both say something about the same field); fields only
 * in the text are added. `tags` merges per sub-key (all / any / none) and `tech` per key, the explicit side winning
 * on the same sub-key — so `tag:宝箱` in the text and `tags.none` in the filter both apply.
 */
export function mergeFilters(fromText: Filter, explicit: Filter): Filter {
  const out: Filter = { ...fromText }
  for (const [key, value] of Object.entries(explicit) as Array<[keyof Filter, unknown]>) {
    if (value === undefined) continue
    if (key === 'tags') out.tags = { ...(fromText.tags ?? {}), ...(value as NonNullable<Filter['tags']>) }
    else if (key === 'tech') out.tech = { ...(fromText.tech ?? {}), ...(value as NonNullable<Filter['tech']>) }
    else (out as Record<string, unknown>)[key] = value
  }
  return out
}
