/**
 * The keyword index (ADR-028): an SQLite FTS5 table with the trigram tokenizer in the plugin's own data folder.
 * Columns carry the weights of search.md「检索范围」: file name (with and without extension) and human tags high;
 * descriptions, AI tags and AI description, folder names and prompts medium; document text low.
 * Queries with a term shorter than three characters fall back to substring matching field by field.
 *
 * Indexed text is folded (NFKC + lower case, see snippet.ts) — the same as queries; the original text is kept
 * beside it for snippets, whose highlight ranges are mapped back onto it.
 */
import Database from 'better-sqlite3'
import type { IdSet, ScoredHit, SearchDoc } from '@bowerbird/plugin-sdk'
import { charLength, fold, makeSnippet, queryTerms } from './snippet.js'

export const SCHEMA_VERSION = 3

/** Indexed columns in order, with their weight and the snippet field they report as. */
export const COLUMNS = [
  { name: 'name', weight: 10, field: 'name' },
  { name: 'tags', weight: 10, field: 'tags' },
  { name: 'description', weight: 4, field: 'description' },
  { name: 'auto_description', weight: 4, field: 'description' },
  { name: 'auto_tags', weight: 4, field: 'tags' },
  { name: 'folders', weight: 4, field: 'path' },
  { name: 'prompts', weight: 4, field: 'prompt' },
  { name: 'body', weight: 1, field: 'text' }
] as const
type Col = (typeof COLUMNS)[number]['name']
type Field = NonNullable<ScoredHit['snippet']>['field']

/** Snippets are looked for in this order (the name itself is highlighted by the grid). */
const SNIPPET_ORDER: readonly Col[] = ['prompts', 'description', 'auto_description', 'body', 'tags', 'auto_tags', 'folders']
/** Up to this many candidates are pushed into SQL; larger sets are filtered while reading ranked rows. */
export const SQL_CANDIDATES = 5000
/** Body text kept per document. */
export const MAX_BODY = 200_000
/** Score added when the query is the whole file name, the name without extension, or starts either. */
export const NAME_BONUS = { name: 100, stem: 50, prefix: 10 } as const

/** Original column texts of a document (snippets are cut from these). */
export function docColumns(d: SearchDoc): Record<Col, string> {
  return {
    // Both forms, so `chest`, `chest.glb` and `chest_open_preview.mp4` all hit the name.
    name: d.stem === d.name ? d.name : `${d.stem} ${d.name}`,
    tags: d.tags.join(' '),
    description: d.description,
    auto_description: d.autoDescription,
    auto_tags: d.autoTags.join(' '),
    folders: d.folder.split('/').filter(Boolean).join(' '),
    prompts: d.prompts.join('\n'),
    body: d.text.length > MAX_BODY ? d.text.slice(0, MAX_BODY) : d.text
  }
}

const CNAMES = COLUMNS.map(c => c.name)
/** Separates the fields inside `docs.hay`. */
const SEP = '\u0001'

export class KeywordIndex {
  readonly file: string
  private handle: Database.Database | null = null
  private stmts!: ReturnType<KeywordIndex['prepare']>

  constructor(file: string) {
    this.file = file
    this.open()
  }

  /**
   * The database, opened again if it was closed: the kernel deactivates the plugin once per library, and
   * `deactivate()` cannot tell which library it is for, so it closes every handle and the others reopen here.
   */
  get db(): Database.Database { return this.open() }

  private open(): Database.Database {
    if (this.handle?.open) return this.handle
    const db = new Database(this.file)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    this.handle = db
    this.migrate(db)
    this.stmts = this.prepare(db)
    return db
  }

  private migrate(db: Database.Database) {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
    const v = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined
    if (v && Number(v.value) !== SCHEMA_VERSION) db.exec('DROP TABLE IF EXISTS fts; DROP TABLE IF EXISTS docs;')
    db.exec(`
      -- fname / fstem: folded full name and name without extension (exact-name bonus);
      -- hay: every folded field in one column, scanned by the substring fallback (one instr per row);
      -- orig: the original column texts as JSON, for snippets.
      CREATE TABLE IF NOT EXISTS docs (rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, fname TEXT NOT NULL DEFAULT '',
        fstem TEXT NOT NULL DEFAULT '', hay TEXT NOT NULL DEFAULT '', orig TEXT NOT NULL DEFAULT '{}');
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(${CNAMES.join(', ')}, tokenize = 'trigram');
    `)
    // `rank` = weighted bm25, so `ORDER BY rank` takes FTS5's fast path.
    db.prepare("INSERT INTO fts (fts, rank) VALUES ('rank', ?)").run(`bm25(${COLUMNS.map(c => c.weight).join(', ')})`)
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION))
  }

  private prepare(db: Database.Database) {
    return {
      rid: db.prepare('SELECT rid FROM docs WHERE id = ?').pluck(),
      newDoc: db.prepare('INSERT INTO docs (id, fname, fstem, hay, orig) VALUES (?, ?, ?, ?, ?)'),
      setDoc: db.prepare('UPDATE docs SET fname = ?, fstem = ?, hay = ?, orig = ? WHERE rid = ?'),
      delFts: db.prepare('DELETE FROM fts WHERE rowid = ?'),
      delDoc: db.prepare('DELETE FROM docs WHERE rid = ?'),
      insFts: db.prepare(`INSERT INTO fts (rowid, ${CNAMES.join(', ')}) VALUES (?, ${CNAMES.map(() => '?').join(', ')})`),
      orig: db.prepare('SELECT orig FROM docs WHERE rid = ?').pluck(),
      count: db.prepare('SELECT count(*) FROM docs').pluck()
    }
  }

  get size(): number { this.open(); return this.stmts.count.get() as number }

  index(docs: SearchDoc[]): void {
    const db = this.open()
    const tx = db.transaction((list: SearchDoc[]) => {
      for (const d of list) {
        const c = docColumns(d)
        const f = CNAMES.map(n => fold(c[n]))
        const hay = f.map(x => x.replaceAll(SEP, ' ')).join(SEP)
        const fname = fold(d.name), fstem = fold(d.stem), orig = JSON.stringify(c)
        let rid = this.stmts.rid.get(d.id) as number | undefined
        if (rid === undefined) rid = Number(this.stmts.newDoc.run(d.id, fname, fstem, hay, orig).lastInsertRowid)
        else { this.stmts.delFts.run(rid); this.stmts.setDoc.run(fname, fstem, hay, orig, rid) }
        this.stmts.insFts.run(rid, ...f)
      }
    })
    tx(docs)
  }

  remove(ids: string[]): void {
    const db = this.open()
    const tx = db.transaction((list: string[]) => {
      for (const id of list) {
        const rid = this.stmts.rid.get(id) as number | undefined
        if (rid === undefined) continue
        this.stmts.delFts.run(rid)
        this.stmts.delDoc.run(rid)
      }
    })
    tx(ids)
  }

  clear(): void {
    this.open().exec('DELETE FROM fts; DELETE FROM docs;')
  }

  close(): void { if (this.handle?.open) this.handle.close(); this.handle = null }

  query(q: string, opts: { candidates?: IdSet; limit: number }): ScoredHit[] {
    const terms = queryTerms(q)
    if (!terms.length || opts.limit <= 0) return []
    if (opts.candidates && opts.candidates.size === 0) return []
    const db = this.open()
    const long = terms.filter(t => charLength(t) >= 3)
    const short = terms.filter(t => charLength(t) < 3)
    const small = opts.candidates && opts.candidates.size <= SQL_CANDIDATES ? JSON.stringify([...opts.candidates]) : null
    const keep = (id: string) => !opts.candidates || small !== null || opts.candidates.has(id)
    // Substring score of the short terms over folded field texts: every term must occur somewhere.
    const shortScore = (fields: string[]): number => {
      let s = 0
      for (const t of short) {
        let any = 0
        for (let i = 0; i < COLUMNS.length; i++) if (fields[i] && fields[i]!.includes(t)) any += COLUMNS[i]!.weight
        if (!any) return -1
        s += any
      }
      return s
    }
    const whole = terms.join(' ')
    const nameBonus = (fname: string, fstem: string): number =>
      fname === whole ? NAME_BONUS.name : fstem === whole ? NAME_BONUS.stem : fname.startsWith(whole) || fstem.startsWith(whole) ? NAME_BONUS.prefix : 0
    const hits: Array<{ rid: number; id: string; score: number }> = []

    if (long.length) {
      const match = long.map(t => `"${t.replace(/"/g, '""')}"`).join(' AND ')
      const inSet = small ? ' AND f.rowid IN (SELECT d2.rid FROM docs d2 WHERE d2.id IN (SELECT value FROM json_each(?)))' : ''
      const cols = short.length ? ', ' + CNAMES.map(n => `f.${n}`).join(', ') : ''
      const sql = `SELECT f.rowid AS rid, d.id AS id, d.fname AS fname, d.fstem AS fstem, -f.rank AS score${cols} FROM fts f JOIN docs d ON d.rid = f.rowid WHERE fts MATCH ?${inSet} ORDER BY f.rank`
      const args: unknown[] = small ? [match, small] : [match]
      // An exact name can sit anywhere in bm25 order, so read further than `limit` before cutting.
      const enough = opts.limit * 4 + 50
      for (const r of db.prepare(sql).iterate(...args) as IterableIterator<Record<string, string | number>>) {
        if (!keep(r.id as string)) continue
        let score = (r.score as number) + nameBonus(r.fname as string, r.fstem as string)
        if (short.length) { const s = shortScore(CNAMES.map(n => r[n] as string)); if (s < 0) continue; score += s }
        hits.push({ rid: r.rid as number, id: r.id as string, score })
        if (!short.length && hits.length >= enough) break
      }
    } else {
      // All terms shorter than three characters: substring match field by field (search.md「中文处理」),
      // scanning the folded `hay` column.
      const where = short.map(() => 'instr(hay, ?) > 0').join(' AND ')
      const inDocs = small ? ' AND id IN (SELECT value FROM json_each(?))' : ''
      const args: unknown[] = [...short]
      if (small) args.push(small)
      const stmt = db.prepare(`SELECT rid, id, fname, fstem, hay FROM docs WHERE ${where}${inDocs}`)
      for (const r of stmt.iterate(...args) as IterableIterator<{ rid: number; id: string; fname: string; fstem: string; hay: string }>) {
        if (!keep(r.id)) continue
        const s = shortScore(r.hay.split(SEP))
        if (s >= 0) hits.push({ rid: r.rid, id: r.id, score: s + nameBonus(r.fname, r.fstem) })
      }
    }

    hits.sort((a, b) => b.score - a.score || a.rid - b.rid)
    return hits.slice(0, opts.limit).map(({ rid, id, score }) => {
      const hit: ScoredHit = { id, score: Math.round(score * 1000) / 1000 }
      let orig: Record<Col, string> | null = null
      try { orig = JSON.parse(this.stmts.orig.get(rid) as string) as Record<Col, string> } catch { /* no snippet */ }
      const sn = orig ? snippetOf(orig, terms) : undefined
      if (sn) hit.snippet = sn
      return hit
    })
  }
}

/** The first field outside the name that contains a term; none when the name itself matches. */
function snippetOf(row: Record<Col, string>, terms: string[]): ScoredHit['snippet'] | undefined {
  const name = fold(row.name)
  if (terms.some(t => name.includes(t))) return undefined
  for (const col of SNIPPET_ORDER) {
    const s = row[col] ? makeSnippet(row[col], terms) : null
    if (s) return { field: COLUMNS.find(c => c.name === col)!.field as Field, text: s.text, ranges: s.ranges }
  }
  return undefined
}
