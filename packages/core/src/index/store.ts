/**
 * Index writes and reads by id (line core-A). The query engine (index/query*.ts, line core-B) reads the same tables.
 * Everything here is rebuildable from the library folder.
 */
import {
  ASSET_FLAGS, effectiveReview, firstSentence, splitName, dirOf, baseOf, normalizeTag, serializeBmeta,
  type AssetSummary, type Bmeta, type Guid, type ProductionRecord, type TrashInfo
} from '@bowerbird/schema'
import type Database from 'better-sqlite3'
import type { IndexDb } from '../contracts.js'
import { FLAG, ISSUE_RANK } from './ddl.js'

export interface AssetRow {
  id: string; path: string; folder: string; name: string; stem: string; ext: string; format: string; plugin: string | null
  hash: string; size: number; mtime_ms: number; meta_mtime_ms: number; stage: string; review: string; review_status: string | null
  bundle: number; auxiliary: number; missing: number; created_at: string; created_by: string; modified_at: string
  description: string | null; auto_description: string | null; origin: string | null; method: string | null
  thumb_state: string; thumb_key: string | null; thumb_manual: number; aspect: number | null; badge: string | null
  cell_title: string | null; cell_excerpt: string | null; flags: number; issue_level: number; issue_count: number
  member_count: number; missing_plugin: string | null; meta_json: string; seq: number
}

export interface RelationRow {
  from_id: string; type: string; to_id: string; slot: string; to_hash: string | null; record: string | null
  note: string | null; broken: number; stale: number
}

export interface IssueRow {
  id: string; type: string; level: string; asset_id: string | null; rel_type: string | null; rel_to: string | null
  rel_slot: string | null; path: string | null; details_json: string; found_at: string
}

export interface TrashRow {
  id: string; asset_id: string; name: string; original_path: string; deleted_at: string; deleted_by: string
  size: number; format: string; info_json: string; meta_json: string | null
}

export interface FileRow { path: string; size: number; mtime_ms: number; hash: string | null }

/** The index copy of a sidecar: same key order as the file, compact (R8 / R10 restore from it). */
export function canonicalMetaJson(meta: Bmeta): string { return JSON.stringify(JSON.parse(serializeBmeta(meta))) }

/** Latest of created / modified / last version (index column modified_at). */
export function modifiedAtOf(meta: Bmeta): string {
  let m = meta.created.at
  if (meta.modified?.at && meta.modified.at > m) m = meta.modified.at
  const last = meta.versions?.[meta.versions.length - 1]
  if (last?.at && last.at > m) m = last.at
  return m
}

export function uniqTags(tags: Iterable<string> | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of tags ?? []) {
    const n = normalizeTag(t)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** Index path of an asset whose file and sidecar are gone while its last path now belongs to another asset. */
export const PARKED_PREFIX = '.bowerbird/missing/'
export const parkedPath = (id: string, originalPath: string): string => `${PARKED_PREFIX}${id}/${baseOf(originalPath)}`

export class IndexStore {
  constructor(readonly db: IndexDb) {
    // line core-A's own table (ddl.ts allows owners to add tables): last real path of parked assets
    db.exec('CREATE TABLE IF NOT EXISTS parked (asset_id TEXT PRIMARY KEY, original_path TEXT NOT NULL)')
  }

  private readonly stmts = new Map<string, Database.Statement>()
  /**
   * A prepared statement per SQL text, prepared once and reused. Preparing per call left one native statement per
   * call waiting for the garbage collector: a 100 000-asset scan peaked at ~550 MB RSS from that alone.
   */
  prep(sql: string): Database.Statement {
    let st = this.stmts.get(sql)
    if (!st) { st = this.db.prepare(sql); this.stmts.set(sql, st) }
    return st
  }

  /** Keep a vanished asset as missing although its last path is taken (it moves to a parked index path). */
  park(id: string, originalPath: string): void {
    this.prep('INSERT OR REPLACE INTO parked (asset_id, original_path) VALUES (?, ?)').run(id, originalPath)
    this.updatePath(id, parkedPath(id, originalPath))
    this.prep('UPDATE assets SET missing = 1, mtime_ms = 0, seq = seq + 1 WHERE id = ?').run(id)
  }
  /** Every parked asset's real last path (a small table: parked assets are rare). */
  parkedPaths(): Map<string, string> {
    return new Map((this.prep('SELECT asset_id, original_path FROM parked').all() as Array<{ asset_id: string; original_path: string }>).map(r => [r.asset_id, r.original_path]))
  }

  /** The real last path of an asset (parked ones keep it here). */
  originalPath(id: string): string | null {
    const r = this.prep('SELECT original_path p FROM parked WHERE asset_id = ?').get(id) as { p: string } | undefined
    return r?.p ?? null
  }

  tx<T>(fn: () => T): T { return this.db.transaction(fn)() }

  /* ───────────── assets ───────────── */

  row(id: string): AssetRow | undefined { return this.prep('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined }
  rowByPath(path: string): AssetRow | undefined { return this.prep('SELECT * FROM assets WHERE path = ?').get(path) as AssetRow | undefined }
  rowsByHash(hash: string): AssetRow[] { return this.prep('SELECT * FROM assets WHERE hash = ? ORDER BY created_at, path').all(hash) as AssetRow[] }
  allRows(): AssetRow[] { return this.prep('SELECT * FROM assets').all() as AssetRow[] }
  allIds(): string[] { return (this.prep('SELECT id FROM assets').all() as Array<{ id: string }>).map(r => r.id) }
  count(): number { return (this.prep('SELECT COUNT(*) n FROM assets').get() as { n: number }).n }

  /** Assets in a folder (recursive: also below it). */
  rowsUnder(folder: string, recursive: boolean): AssetRow[] {
    if (!recursive) return this.prep('SELECT * FROM assets WHERE folder = ?').all(folder) as AssetRow[]
    if (folder === '') return this.allRows()
    return this.prep("SELECT * FROM assets WHERE path = ? OR substr(path, 1, ?) = ?").all(folder, folder.length + 1, folder + '/') as AssetRow[]
  }

  meta(row: AssetRow): Bmeta { return JSON.parse(row.meta_json) as Bmeta }
  metaOf(id: string): Bmeta | null { const r = this.row(id); return r ? this.meta(r) : null }

  /** Method of the record that produced the asset (origin, else the first source relation with a record). */
  methodOf(meta: Bmeta): string | null {
    const recId = meta.origin ?? meta.relations?.find(r => r.type === 'source' && r.record)?.record
    if (!recId) return null
    const r = this.prep('SELECT method FROM records WHERE id = ?').get(recId) as { method: string } | undefined
    return r?.method ?? null
  }

  /**
   * Write the meta-derived columns of an asset, its tags and its outgoing relations.
   * Pipeline-owned columns (format, plugin, thumb_key, aspect, badge, cell_*) are kept on update.
   * Relation broken/stale flags are recomputed by integrity afterwards.
   */
  upsertAsset(a: { meta: Bmeta; path: string; size: number; mtimeMs: number; metaMtimeMs: number; missing: boolean }): void {
    const { meta, path } = a
    const other = this.rowByPath(path)
    if (other && other.id !== meta.id) throw new Error(`index: path ${path} already belongs to ${other.id}`)
    const name = baseOf(path)
    const bundle = meta.bundle ? 1 : 0
    const { base, ext } = bundle ? { base: name, ext: '' } : splitName(name)
    const tags = uniqTags(meta.tags)
    const human = new Set(tags)
    const ai = uniqTags(meta.auto?.tags).filter(t => !human.has(t))
    const thumbManual = meta.thumbnail ? 1 : 0
    this.tx(() => {
      this.prep(`INSERT INTO assets (id, path, folder, name, stem, ext, hash, size, mtime_ms, meta_mtime_ms, stage, review, review_status,
          bundle, auxiliary, missing, created_at, created_by, modified_at, description, auto_description, origin, method, thumb_manual,
          thumb_state, meta_json, seq)
        VALUES (@id, @path, @folder, @name, @stem, @ext, @hash, @size, @mtime, @metaMtime, @stage, @review, @reviewStatus,
          @bundle, @auxiliary, @missing, @createdAt, @createdBy, @modifiedAt, @description, @autoDescription, @origin, @method, @thumbManual,
          @thumbState, @metaJson, 1)
        ON CONFLICT(id) DO UPDATE SET path=excluded.path, folder=excluded.folder, name=excluded.name, stem=excluded.stem, ext=excluded.ext,
          hash=excluded.hash, size=excluded.size, mtime_ms=excluded.mtime_ms, meta_mtime_ms=excluded.meta_mtime_ms, stage=excluded.stage,
          review=excluded.review, review_status=excluded.review_status, bundle=excluded.bundle, auxiliary=excluded.auxiliary,
          missing=excluded.missing, created_at=excluded.created_at, created_by=excluded.created_by, modified_at=excluded.modified_at,
          description=excluded.description, auto_description=excluded.auto_description, origin=excluded.origin, method=excluded.method,
          thumb_state=CASE WHEN excluded.thumb_manual=1 THEN 'ready' WHEN assets.thumb_manual=1 THEN 'pending' ELSE assets.thumb_state END,
          thumb_manual=excluded.thumb_manual, meta_json=excluded.meta_json, seq=assets.seq+1`).run({
        id: meta.id, path, folder: dirOf(path), name, stem: base, ext: ext.toLowerCase(), hash: meta.hash, size: a.size,
        mtime: a.mtimeMs, metaMtime: a.metaMtimeMs, stage: meta.stage, review: effectiveReview(meta), reviewStatus: meta.review?.status ?? null,
        bundle, auxiliary: meta.auxiliary ? 1 : 0, missing: a.missing ? 1 : 0, createdAt: meta.created.at, createdBy: meta.created.by,
        modifiedAt: modifiedAtOf(meta), description: meta.description ?? null, autoDescription: meta.auto?.description ?? null,
        origin: meta.origin ?? null, method: this.methodOf(meta), thumbManual, thumbState: thumbManual ? 'ready' : 'pending',
        metaJson: canonicalMetaJson(meta)
      })
      if (!path.startsWith(PARKED_PREFIX)) this.prep('DELETE FROM parked WHERE asset_id = ?').run(meta.id)
      this.prep('DELETE FROM tags WHERE asset_id = ?').run(meta.id)
      const ins = this.prep('INSERT OR IGNORE INTO tags (asset_id, tag, ai) VALUES (?, ?, ?)')
      for (const t of tags) ins.run(meta.id, t, 0)
      for (const t of ai) ins.run(meta.id, t, 1)
      this.writeRelations(meta)
    })
  }

  private writeRelations(meta: Bmeta): void {
    const old = new Map<string, RelationRow>()
    for (const r of this.outgoing(meta.id)) old.set(`${r.type}\u0000${r.to_id}\u0000${r.slot}`, r)
    this.prep('DELETE FROM relations WHERE from_id = ?').run(meta.id)
    const ins = this.prep(`INSERT OR REPLACE INTO relations (from_id, type, to_id, slot, to_hash, record, note, broken, stale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const r of meta.relations ?? []) {
      const slot = r.slot ?? ''
      const prev = old.get(`${r.type}\u0000${r.to}\u0000${slot}`)
      ins.run(meta.id, r.type, r.to, slot, r.toHash ?? null, r.record ?? null, r.note ?? null, prev?.broken ?? 0, prev?.stale ?? 0)
    }
  }

  /** Change only the path columns (move / rename keeps everything else). */
  updatePath(id: string, path: string): void {
    const name = baseOf(path)
    const r = this.row(id)
    const { base, ext } = r?.bundle ? { base: name, ext: '' } : splitName(name)
    this.prep('UPDATE assets SET path=?, folder=?, name=?, stem=?, ext=?, seq=seq+1 WHERE id=?').run(path, dirOf(path), name, base, ext.toLowerCase(), id)
    if (!path.startsWith(PARKED_PREFIX)) this.prep('DELETE FROM parked WHERE asset_id = ?').run(id)
  }

  setStat(id: string, s: { size?: number; mtimeMs?: number; metaMtimeMs?: number; missing?: boolean }): void {
    const sets: string[] = []
    const vals: unknown[] = []
    if (s.size !== undefined) { sets.push('size=?'); vals.push(s.size) }
    if (s.mtimeMs !== undefined) { sets.push('mtime_ms=?'); vals.push(s.mtimeMs) }
    if (s.metaMtimeMs !== undefined) { sets.push('meta_mtime_ms=?'); vals.push(s.metaMtimeMs) }
    if (s.missing !== undefined) { sets.push('missing=?'); vals.push(s.missing ? 1 : 0) }
    if (!sets.length) return
    this.prep(`UPDATE assets SET ${sets.join(', ')}, seq=seq+1 WHERE id=?`).run(...vals, id)
  }

  /** Remove an asset and everything derived from it (incoming relations live in other rows and stay). */
  deleteAsset(id: string): void {
    this.tx(() => {
      for (const t of ['tags', 'tech', 'analysis', 'checks']) this.prep(`DELETE FROM ${t} WHERE asset_id = ?`).run(id)
      this.prep('DELETE FROM probe WHERE asset_id = ?').run(id)
      this.prep('DELETE FROM relations WHERE from_id = ?').run(id)
      this.prep('DELETE FROM parked WHERE asset_id = ?').run(id)
      this.prep('DELETE FROM assets WHERE id = ?').run(id)
    })
  }

  /* ───────────── relations ───────────── */

  outgoing(id: string): RelationRow[] { return this.prep('SELECT * FROM relations WHERE from_id = ?').all(id) as RelationRow[] }
  incoming(id: string): RelationRow[] { return this.prep('SELECT * FROM relations WHERE to_id = ? AND from_id != ?').all(id, id) as RelationRow[] }
  /** Distinct assets with any relation to `id` (excluding itself). */
  referrers(id: string, types?: string[]): string[] {
    const rows = this.incoming(id).filter(r => !types || types.includes(r.type))
    return [...new Set(rows.map(r => r.from_id))]
  }
  setRelationState(r: RelationRow, broken: boolean, stale: boolean): void {
    this.prep('UPDATE relations SET broken=?, stale=? WHERE from_id=? AND type=? AND to_id=? AND slot=?')
      .run(broken ? 1 : 0, stale ? 1 : 0, r.from_id, r.type, r.to_id, r.slot)
  }

  /* ───────────── tags ───────────── */

  /** Human and AI tags in the order the sidecar lists them. */
  tagsOf(id: string): { tags: string[]; autoTags: string[] } {
    const meta = this.metaOf(id)
    const tags = uniqTags(meta?.tags)
    const human = new Set(tags)
    return { tags, autoTags: uniqTags(meta?.auto?.tags).filter(t => !human.has(t)) }
  }
  knownTags(): Set<string> {
    return new Set((this.prep('SELECT DISTINCT tag FROM tags').all() as Array<{ tag: string }>).map(r => r.tag))
  }
  assetsWithTag(tag: string, ai: boolean | null): string[] {
    const sql = ai === null ? 'SELECT DISTINCT asset_id FROM tags WHERE tag = ?' : 'SELECT DISTINCT asset_id FROM tags WHERE tag = ? AND ai = ' + (ai ? 1 : 0)
    return (this.prep(sql).all(tag) as Array<{ asset_id: string }>).map(r => r.asset_id)
  }

  /* ───────────── records ───────────── */

  upsertRecord(rec: ProductionRecord): void {
    this.prep(`INSERT INTO records (id, method, by, at, prompt, json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET method=excluded.method, by=excluded.by, at=excluded.at, prompt=excluded.prompt, json=excluded.json`)
      .run(rec.id, rec.method, rec.by, rec.at, rec.prompt ?? null, JSON.stringify(rec))
  }
  record(id: string): ProductionRecord | null {
    const r = this.prep('SELECT json FROM records WHERE id = ?').get(id) as { json: string } | undefined
    return r ? JSON.parse(r.json) as ProductionRecord : null
  }
  recordOutputs(id: string): string[] {
    const a = (this.prep('SELECT id FROM assets WHERE origin = ?').all(id) as Array<{ id: string }>).map(r => r.id)
    const b = (this.prep('SELECT DISTINCT from_id id FROM relations WHERE record = ?').all(id) as Array<{ id: string }>).map(r => r.id)
    return [...new Set([...a, ...b])]
  }

  /* ───────────── files (scan shortcut) ───────────── */

  file(path: string): FileRow | undefined { return this.prep('SELECT * FROM files WHERE path = ?').get(path) as FileRow | undefined }
  setFile(path: string, size: number, mtimeMs: number, hash: string | null): void {
    this.prep('INSERT INTO files (path, size, mtime_ms, hash) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime_ms=excluded.mtime_ms, hash=excluded.hash')
      .run(path, size, mtimeMs, hash)
  }
  deleteFile(path: string): void { this.prep('DELETE FROM files WHERE path = ? OR substr(path, 1, ?) = ?').run(path, path.length + 1, path + '/') }
  filesUnder(folder: string): FileRow[] {
    if (folder === '') return this.prep('SELECT * FROM files').all() as FileRow[]
    return this.prep('SELECT * FROM files WHERE substr(path, 1, ?) = ?').all(folder.length + 1, folder + '/') as FileRow[]
  }
  /** Rename the scan-shortcut rows under a moved path (file or folder). */
  renameFiles(from: string, to: string): void {
    const rows = this.prep('SELECT * FROM files WHERE path = ? OR substr(path, 1, ?) = ?').all(from, from.length + 1, from + '/') as FileRow[]
    this.tx(() => {
      for (const r of rows) {
        this.prep('DELETE FROM files WHERE path = ?').run(r.path)
        this.setFile(to + r.path.slice(from.length), r.size, r.mtime_ms, r.hash)
      }
    })
  }

  /* ───────────── trash ───────────── */

  insertTrash(info: TrashInfo, meta: Bmeta | null, size: number, format: string): void {
    this.prep(`INSERT OR REPLACE INTO trash (id, asset_id, name, original_path, deleted_at, deleted_by, size, format, info_json, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(info.id, info.assetId, info.name, info.originalPath, info.deletedAt, info.deletedBy,
      size, format, JSON.stringify(info), meta ? JSON.stringify(meta) : null)
  }
  trashRow(id: string): TrashRow | undefined { return this.prep('SELECT * FROM trash WHERE id = ?').get(id) as TrashRow | undefined }
  trashRows(): TrashRow[] { return this.prep('SELECT * FROM trash ORDER BY deleted_at DESC').all() as TrashRow[] }
  trashByAsset(assetId: string): TrashRow | undefined {
    return this.prep('SELECT * FROM trash WHERE asset_id = ? ORDER BY deleted_at DESC').get(assetId) as TrashRow | undefined
  }
  deleteTrash(id: string): void { this.prep('DELETE FROM trash WHERE id = ?').run(id) }

  /* ───────────── issues ───────────── */

  issuesOf(assetId: string): IssueRow[] { return this.prep('SELECT * FROM issues WHERE asset_id = ?').all(assetId) as IssueRow[] }
  issue(id: string): IssueRow | undefined { return this.prep('SELECT * FROM issues WHERE id = ?').get(id) as IssueRow | undefined }
  allIssues(): IssueRow[] { return this.prep('SELECT * FROM issues ORDER BY found_at, id').all() as IssueRow[] }

  /* ───────────── pipeline-side data (read) ───────────── */

  tech(id: string): Record<string, number | string | boolean> {
    const out: Record<string, number | string | boolean> = {}
    for (const r of this.prep('SELECT key, num, txt FROM tech WHERE asset_id = ?').all(id) as Array<{ key: string; num: number | null; txt: string | null }>) {
      if (r.txt === 'true' && r.num === 1) out[r.key] = true
      else if (r.txt === 'false' && r.num === 0) out[r.key] = false
      else out[r.key] = r.num ?? r.txt ?? ''
    }
    return out
  }
}

/** Bit flags → names. */
export function flagNames(flags: number): AssetSummary['flags'] {
  const out: AssetSummary['flags'] = []
  for (const f of ASSET_FLAGS) if (flags & FLAG[f]) out.push(f)
  return out
}

export function issueLevelName(rank: number): 'error' | 'warning' | 'info' | null {
  return rank >= ISSUE_RANK.error ? 'error' : rank === ISSUE_RANK.warning ? 'warning' : rank === ISSUE_RANK.info ? 'info' : null
}

/**
 * Summary built straight from an index row (fallback when the query engine has none, and for fakes in tests).
 * The query engine's `summaries` is the primary source.
 */
export function rowToSummary(store: IndexStore, row: AssetRow, thumbnailUrl: (id: Guid, key: string | null) => string | null): AssetSummary {
  const { tags, autoTags } = store.tagsOf(row.id)
  const hasViews = !!store.metaOf(row.id)?.views
  let missingPlugin: AssetSummary['missingPlugin'] = null
  if (row.missing_plugin) { try { missingPlugin = JSON.parse(row.missing_plugin) } catch { /* ignore */ } }
  const ready = row.thumb_state === 'ready'
  return {
    id: row.id, name: row.name, path: row.path, format: row.format, plugin: row.plugin,
    stage: row.stage as AssetSummary['stage'], review: row.review as AssetSummary['review'], tags, autoTags,
    description: firstSentence(row.description ?? row.auto_description), flags: flagNames(row.flags),
    thumbnail: ready ? thumbnailUrl(row.id, row.thumb_manual ? `m${row.seq}` : row.thumb_key) : null,
    thumbState: row.thumb_state as AssetSummary['thumbState'], aspect: row.aspect, badge: row.badge,
    issueLevel: issueLevelName(row.issue_level), issueCount: row.issue_count, size: row.size, modified: row.modified_at,
    created: row.created_at, createdBy: row.created_by, bundle: !!row.bundle, auxiliary: !!row.auxiliary, memberCount: row.member_count,
    cellText: row.cell_title || row.cell_excerpt ? { ...(row.cell_title ? { title: row.cell_title } : {}), ...(row.cell_excerpt ? { excerpt: row.cell_excerpt } : {}) } : null,
    missingPlugin,
    ...(hasViews ? { hasViews: true } : {})
  }
}
