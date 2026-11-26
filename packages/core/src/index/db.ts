import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { IndexDb } from '../contracts.js'
import { DDL, INDEX_SCHEMA_VERSION } from './ddl.js'

/**
 * Open (or create) a library's index database. If the stored schema version differs, the file is dropped and
 * recreated: the index is fully rebuildable from the library folder (pipeline-and-cache.md「重建」).
 * Returns `rebuilt: true` when the caller must run a full scan to repopulate it.
 */
export function openIndexDb(file: string): { db: IndexDb; rebuilt: boolean } {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let db = new Database(file)
  let rebuilt = false
  const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get()
  const version = hasMeta ? (db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value?: string } | undefined)?.value : undefined
  if (version !== undefined && Number(version) !== INDEX_SCHEMA_VERSION) {
    db.close()
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true })
    db = new Database(file)
    rebuilt = true
  }
  if (version === undefined) rebuilt = true
  db.exec(DDL)
  db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(INDEX_SCHEMA_VERSION))
  return { db, rebuilt }
}

/** In-memory index for tests. */
export function openMemoryIndexDb(): IndexDb {
  const db = new Database(':memory:')
  db.exec(DDL)
  db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?)").run(String(INDEX_SCHEMA_VERSION))
  return db
}
