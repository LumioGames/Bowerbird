/**
 * Sorting and cursor paging (search.md「排序项」). SQL sorts page by keyset (stable under inserts);
 * relevance lists page by offset into the fused list.
 */
import type { SortKey } from '@bowerbird/schema'
import { CoreError } from '../contracts.js'

export type Dir = 'asc' | 'desc'

/** A column of the sort, as the SQL expression and the selected alias holding its value. */
interface SortCol { expr: string; alias: string }

const COLS: Record<Exclude<SortKey, 'relevance'>, SortCol[]> = {
  name: [{ expr: 'a.name COLLATE NOCASE', alias: 's0' }],
  modified: [{ expr: 'a.modified_at', alias: 's0' }],
  created: [{ expr: 'a.created_at', alias: 's0' }],
  size: [{ expr: 'a.size', alias: 's0' }],
  format: [{ expr: 'a.format', alias: 's0' }, { expr: 'a.name COLLATE NOCASE', alias: 's1' }]
}

export interface SortSpec {
  key: SortKey
  dir: Dir
}

/** Default sort: relevance with a query word, otherwise modified time descending. */
const KEYS: ReadonlySet<string> = new Set(['relevance', ...Object.keys(COLS)])

/**
 * Default sort: relevance with a query word, otherwise modified time descending. Only known keys and `asc`/`desc`
 * ever reach SQL (whitelist here, independent of request validation upstream).
 */
export function resolveSort(sort: SortKey | undefined, order: Dir | undefined, hasQuery: boolean): SortSpec {
  let key: SortKey = typeof sort === 'string' && KEYS.has(sort) ? sort : hasQuery ? 'relevance' : 'modified'
  if (key === 'relevance' && !hasQuery) key = 'modified'
  const given: Dir | null = order === 'asc' || order === 'desc' ? order : null
  const dir: Dir = key === 'relevance' ? 'desc' : given ?? (key === 'name' || key === 'format' ? 'asc' : 'desc')
  return { key, dir }
}

const SQL_DIR: Readonly<Record<Dir, 'ASC' | 'DESC'>> = { asc: 'ASC', desc: 'DESC' }

/** SELECT list fragment carrying the sort values (for keyset cursors). */
export function sortSelect(spec: SortSpec): string {
  if (spec.key === 'relevance') return ''
  return COLS[spec.key].map(c => `, ${c.expr} AS ${c.alias}`).join('')
}

export function orderBy(spec: SortSpec): string {
  if (spec.key === 'relevance') throw new Error('relevance is ordered by fusion, not SQL')
  const cols = COLS[spec.key]
  const d = SQL_DIR[spec.dir]
  if (!cols || !d) throw new Error('unknown sort')
  return [...cols.map(c => `${c.expr} ${d}`), `a.id ${d}`].join(', ')
}

/* ───────────── cursors ───────────── */

export type Cursor =
  | { s: SortKey; d: Dir; v: Array<string | number>; id: string }
  | { s: SortKey; d: Dir; off: number }

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | null | undefined, spec: SortSpec): Cursor | null {
  if (!raw) return null
  let c: Cursor
  try { c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor }
  catch { throw new CoreError('validation_failed', 'cursor is not valid') }
  if (!c || typeof c !== 'object' || c.s !== spec.key || c.d !== spec.dir) {
    throw new CoreError('validation_failed', 'cursor does not belong to this sort')
  }
  return c
}

/** Offset of an offset cursor (0 when absent). */
export function cursorOffset(c: Cursor | null): number {
  if (!c) return 0
  if (!('off' in c) || !Number.isInteger(c.off) || c.off < 0) throw new CoreError('validation_failed', 'cursor is not valid')
  return c.off
}

/** Keyset condition: rows strictly after the cursor row in the sort order. */
export function keysetWhere(spec: SortSpec, c: Cursor | null): { sql: string; params: unknown[] } | null {
  if (!c) return null
  if (spec.key === 'relevance' || !('v' in c)) throw new CoreError('validation_failed', 'cursor is not valid')
  const cols = [...COLS[spec.key].map(x => x.expr), 'a.id']
  const vals = [...c.v, c.id]
  if (vals.length !== cols.length) throw new CoreError('validation_failed', 'cursor is not valid')
  const op = spec.dir === 'asc' ? '>' : '<'
  const ors: string[] = []
  const params: unknown[] = []
  for (let i = 0; i < cols.length; i++) {
    const ands: string[] = []
    for (let j = 0; j < i; j++) { ands.push(`${cols[j]} = ?`); params.push(vals[j]) }
    ands.push(`${cols[i]} ${op} ?`)
    params.push(vals[i])
    ors.push(`(${ands.join(' AND ')})`)
  }
  return { sql: `(${ors.join(' OR ')})`, params }
}

/** Cursor pointing after a selected row (row carries s0[, s1] and id). */
export function keysetCursor(spec: SortSpec, row: Record<string, unknown>): string {
  if (spec.key === 'relevance') throw new Error('relevance pages by offset')
  const v = COLS[spec.key].map(c => row[c.alias] as string | number)
  return encodeCursor({ s: spec.key, d: spec.dir, v, id: row.id as string })
}
