import { describe, expect, it } from 'vitest'
import { openMemoryIndexDb } from './db.js'
import { IndexStore } from './store.js'

describe('IndexStore', () => {
  it('prepares each statement once and reuses it (no native statement per call)', () => {
    const db = openMemoryIndexDb()
    const store = new IndexStore(db)
    const a = store.prep('SELECT id FROM assets WHERE id = ?')
    expect(store.prep('SELECT id FROM assets WHERE id = ?')).toBe(a)
    let prepared = 0
    const real = db.prepare.bind(db)
    ;(db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => { prepared++; return real(sql) }) as typeof db.prepare
    for (let i = 0; i < 1000; i++) { store.row(`id${i}`); store.rowByPath(`p${i}`); store.outgoing(`id${i}`); store.issuesOf(`id${i}`) }
    expect(prepared).toBeLessThanOrEqual(4)
  })
})
