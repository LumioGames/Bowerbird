/**
 * Performance benchmark (search.md「性能目标」): 100 000 assets, pure filter queries within 100 ms, keyword queries
 * within 200 ms. Rows are written straight into a file-backed index. Prints the measured times; asserts with a
 * margin (×3) so a loaded CI machine does not flake, while a regression by an order of magnitude still fails.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IdSet, ScoredHit, SearchProvider } from '@bowerbird/plugin-sdk'
import type { SearchRequest } from '@bowerbird/schema'
import { openIndexDb } from '../../index/db.js'
import { createQueryEngine } from '../../index/query.js'
import { silentLogger } from '../../log.js'
import type { IndexDb, QueryEngine } from '../../contracts.js'
import { fakePlugins } from './seed.js'

const N = 100_000
const FILTER_MS = 100
const KEYWORD_MS = 200
/** Library info and the sidebar's view counts call counts() on every load (coordinator target). */
const COUNTS_MS = 50
const MARGIN = 3

const FORMATS = ['image', 'model', 'audio', 'video', 'doc']
const EXT: Record<string, string> = { image: '.png', model: '.glb', audio: '.wav', video: '.mp4', doc: '.md' }
const STAGES = ['reference', 'production', 'runtime']
const REVIEWS = ['pending', 'approved', 'rejected', 'exempt']
const WORDS = ['chest', 'sword', 'shield', 'tree', 'rock', 'hero', 'slime', 'door', 'torch', 'coin', '宝箱', '剑', '盾', '树', '石头']
const TAGS = Array.from({ length: 200 }, (_, i) => (i % 2 ? `tag${i}` : `标签${i}`))

function gid(n: number): string { return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}` }

/** A .bmeta copy of realistic size (~1.5 KB, like core-A's meta_json): rows as wide as in a real index. */
function metaJson(id: string, i: number, word: string, at: string): string {
  const h = (n: number): string => `sha256:${(n * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8)}`
  return JSON.stringify({
    bb: 1, id, hash: h(i), stage: STAGES[i % 3], tags: [TAGS[i % TAGS.length], TAGS[(i * 31) % TAGS.length]],
    description: `A ${word} made for the ${WORDS[(i * 3) % WORDS.length]} scene, with the usual notes about scale, materials and where it is used in the level.`,
    fields: { design: { owner: 'lin', budget: 'B', notes: 'keep the silhouette readable at 30 m' } },
    auto: { tags: [TAGS[(i * 7) % TAGS.length]], description: 'An automatically generated description of the asset that is long enough to matter.', by: 'bowerbird.enrich@1.0.0' },
    relations: [{ type: 'source', to: gid(((i * 17) % N) + 1), toHash: h(i + 1), record: `rec_${i}` }, { type: 'belongs', to: gid(((i * 29) % N) + 1) }],
    review: { status: REVIEWS[(i >> 2) % 4], hash: h(i), by: 'user:lin', at, note: 'checked against the style guide' },
    versions: [{ hash: h(i + 7), size: 1000, at, by: 'user:lin', note: 'first version' }, { hash: h(i), size: 1200, at, by: 'agent:modeler', note: 'fixed normals' }],
    created: { at, by: 'user:lin' }, modified: { at, by: 'agent:modeler' }
  })
}

function populate(db: IndexDb): void {
  const asset = db.prepare(`INSERT INTO assets (id, path, folder, name, stem, ext, format, plugin, hash, size, stage, review, auxiliary,
      created_at, created_by, modified_at, description, thumb_state, thumb_key, flags, issue_level, member_count, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, 0, ?, 0, ?)`)
  const tag = db.prepare('INSERT OR IGNORE INTO tags (asset_id, tag, ai) VALUES (?, ?, ?)')
  const tech = db.prepare('INSERT INTO tech (asset_id, key, num) VALUES (?, ?, ?)')
  const t0 = Date.parse('2025-01-01T00:00:00Z')
  db.transaction(() => {
    for (let i = 0; i < N; i++) {
      const id = gid(i + 1)
      const format = FORMATS[i % FORMATS.length]!
      const word = WORDS[(i * 7) % WORDS.length]!
      const folder = `area${i % 20}/group${i % 300}`
      const name = `${word}_${i}${EXT[format]}`
      const at = new Date(t0 + i * 60_000).toISOString()
      asset.run(id, `${folder}/${name}`, folder, name, `${word}_${i}`, EXT[format], format, `bowerbird.${format}`, `sha256:${i.toString(16)}`,
        1000 + ((i * 7919) % 5_000_000), STAGES[i % 3], REVIEWS[(i >> 2) % 4], i % 50 === 0 ? 1 : 0, at, i % 3 ? 'user:lin' : 'agent:modeler',
        at, i % 4 === 0 ? `A ${word} made for the ${WORDS[(i * 3) % WORDS.length]} scene.` : null, `k${i}`, i % 13 === 0 ? 2 : 0, metaJson(id, i, word, at))
      tag.run(id, TAGS[i % TAGS.length], 0)
      tag.run(id, TAGS[(i * 31) % TAGS.length], i % 5 === 0 ? 1 : 0)
      if (format === 'image') { tech.run(id, 'width', 256 << (i % 4)); tech.run(id, 'height', 256 << (i % 3)) }
      if (format === 'model') tech.run(id, 'triangles', (i * 37) % 50_000)
      if (format === 'audio' || format === 'video') tech.run(id, 'duration', (i % 600) / 10)
    }
  })()
  // No ANALYZE: the kernel never runs it, so the planner works from the schema alone, as in production.
}

/** An in-memory keyword provider: substring over names, restricted to candidates (stands in for the FTS plugin). */
function memoryProvider(db: IndexDb): SearchProvider {
  const docs = db.prepare('SELECT id, name FROM assets').all() as Array<{ id: string; name: string }>
  return {
    id: 'mem',
    async index() {}, async remove() {},
    async query(q: string, opts: { candidates?: IdSet; limit: number }): Promise<ScoredHit[]> {
      const out: ScoredHit[] = []
      for (const d of docs) {
        if (opts.candidates && !opts.candidates.has(d.id)) continue
        const i = d.name.indexOf(q)
        if (i >= 0) out.push({ id: d.id, score: 1 / (1 + i), snippet: { field: 'name', text: d.name, ranges: [[i, i + q.length]] } })
      }
      return out.sort((a, b) => b.score - a.score).slice(0, opts.limit)
    }
  }
}

async function time(fn: () => Promise<unknown> | unknown, runs = 5): Promise<number> {
  await fn() // warm up statement cache
  const ms: number[] = []
  for (let i = 0; i < runs; i++) { const t = performance.now(); await fn(); ms.push(performance.now() - t) }
  return ms.sort((a, b) => a - b)[Math.floor(runs / 2)]!
}

describe(`query benchmark (${N.toLocaleString()} assets)`, () => {
  let dir: string
  let db: IndexDb
  let plain: QueryEngine
  let withProvider: QueryEngine
  const results: Array<{ name: string; ms: number; target: number }> = []

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-bench-'))
    db = openIndexDb(path.join(dir, 'index.sqlite')).db
    const t = performance.now()
    populate(db)
    console.log(`[bench] populated ${N} assets in ${(performance.now() - t).toFixed(0)} ms`)
    plain = createQueryEngine({ db, plugins: fakePlugins(), thumbnailUrl: (id, k) => `/t/${id}/${k}`, log: silentLogger })
    withProvider = createQueryEngine({ db, plugins: fakePlugins({ providers: [{ pluginId: 'mem', provider: memoryProvider(db) }] }), thumbnailUrl: (id, k) => `/t/${id}/${k}`, log: silentLogger })
  }, 120_000)

  afterAll(() => {
    console.log('[bench] ' + results.map(r => `${r.name}: ${r.ms.toFixed(1)} ms (target ${r.target})`).join('\n[bench] '))
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const human = { agent: false, scope: 'all' as const }
  const filters: Array<[string, SearchRequest]> = [
    ['default view (all, newest first)', {}],
    ['stage + format', { filter: { stage: ['runtime'], format: ['model'] } }],
    ['tag all + review', { filter: { tags: { all: ['tag31'] }, review: ['approved', 'exempt'] } }],
    ['tags any + none', { filter: { tags: { any: ['标签2', 'tag3', 'tag5'], none: ['tag7'] } } }],
    ['tech range', { filter: { tech: { triangles: { lte: 5000 } } } }],
    ['tech width >= 1024 sorted by size', { filter: { tech: { width: { gte: 1024 } } }, sort: 'size' }],
    ['folder subtree, name sort', { filter: { folder: 'area3' }, sort: 'name' }],
    ['modified this month + by agent', { filter: { modified: { after: '2025-02-01T00:00:00Z' }, by: 'agent' } }],
    ['has issues', { filter: { hasIssues: true } }],
    ['deep page (cursor)', { limit: 100 }]
  ]
  for (const [name, req] of filters) {
    it(`pure filter: ${name}`, async () => {
      let r = req
      if (name.startsWith('deep page')) {
        let cursor: string | null = null
        for (let i = 0; i < 50; i++) cursor = (await plain.search({ ...req, cursor }, human)).cursor
        r = { ...req, cursor }
      }
      const ms = await time(() => plain.search({ limit: 100, ...r }, human))
      results.push({ name: `filter · ${name}`, ms, target: FILTER_MS })
      expect(ms).toBeLessThan(FILTER_MS * MARGIN)
    })
  }

  it('counts of the built-in views: recount after an asset changed, cached otherwise', async () => {
    // A change to an asset row before each read defeats the cache: this is the recount.
    const touch = db.prepare("UPDATE assets SET review = review WHERE id = ?")
    let n = 0
    const recount = await time(() => { touch.run(gid(++n)); return plain.counts() })
    results.push({ name: 'counts() after an asset write', ms: recount, target: COUNTS_MS })
    // ~26 ms on an idle machine; ×2 so the other benchmark running in parallel does not make it flake.
    expect(recount).toBeLessThan(COUNTS_MS * 2)
    // Writes elsewhere (the job queue) do not invalidate it.
    const jobs = db.prepare("INSERT INTO jobs (id, kind, status, created_at, updated_at) VALUES (?, 'process', 'queued', 'x', 'x')")
    const cached = await time(() => { jobs.run(`j${++n}`); return plain.counts() })
    results.push({ name: 'counts() after a job write (cached)', ms: cached, target: COUNTS_MS })
    expect(cached).toBeLessThan(5)
    expect(plain.counts().all).toBe(N - N / 50)
  })

  it('keyword without a search plugin (substring fallback)', async () => {
    const ms = await time(() => plain.search({ q: 'chest', limit: 100 }, human))
    results.push({ name: 'keyword · substring fallback', ms, target: KEYWORD_MS })
    expect(ms).toBeLessThan(KEYWORD_MS * MARGIN)
  })

  it('keyword + filter without a search plugin', async () => {
    const ms = await time(() => plain.search({ q: 'sword', filter: { format: ['model'], stage: ['runtime'] }, limit: 100 }, human))
    results.push({ name: 'keyword · substring + filter', ms, target: KEYWORD_MS })
    expect(ms).toBeLessThan(KEYWORD_MS * MARGIN)
  })

  it('keyword through a provider (whole library)', async () => {
    const ms = await time(() => withProvider.search({ q: 'chest', limit: 100 }, human))
    results.push({ name: 'keyword · provider, whole library', ms, target: KEYWORD_MS })
    expect(ms).toBeLessThan(KEYWORD_MS * MARGIN)
  })

  it('keyword through a provider with a broad filter (100k-candidate set)', async () => {
    const ms = await time(() => withProvider.search({ q: 'tree', filter: { stage: ['reference', 'production', 'runtime'] }, limit: 100 }, human))
    results.push({ name: 'keyword · provider, broad candidates', ms, target: KEYWORD_MS })
    expect(ms).toBeLessThan(KEYWORD_MS * MARGIN)
  })

  it('facets over the whole library', async () => {
    const ms = await time(() => plain.search({ facets: true, limit: 100 }, human), 3)
    results.push({ name: 'filter · with facets', ms, target: FILTER_MS })
    expect(ms).toBeLessThan(FILTER_MS * MARGIN * 2)
  })
})
