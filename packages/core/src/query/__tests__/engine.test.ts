import { beforeEach, describe, expect, it } from 'vitest'
import type { SearchDoc, SearchProvider, ScoredHit, IdSet } from '@bowerbird/plugin-sdk'
import type { Filter, SearchRequest } from '@bowerbird/schema'
import { openMemoryIndexDb } from '../../index/db.js'
import { createQueryEngine } from '../../index/query.js'
import { silentLogger } from '../../log.js'
import { CoreError, type IndexDb, type QueryEngine } from '../../contracts.js'
import { FLAG } from '../../index/ddl.js'
import { fuse } from '../fusion.js'
import { fakePlugins, gid, seedAsset, seedIssue, seedRelation, seedTrash } from './seed.js'

const human = { agent: false, scope: 'all' as const }
const thumbnailUrl = (id: string, key: string | null): string | null => (key ? `/t/${id}/${key}` : null)

function engine(db: IndexDb, providers: Array<{ pluginId: string; provider: SearchProvider }> = []): QueryEngine {
  return createQueryEngine({ db, plugins: fakePlugins({ providers }), thumbnailUrl, log: silentLogger })
}

async function names(q: QueryEngine, req: SearchRequest, opts = human): Promise<string[]> {
  return (await q.search({ limit: 1000, sort: 'name', ...req }, opts)).items.map(i => i.name)
}

describe('QueryEngine filters', () => {
  let db: IndexDb
  let q: QueryEngine
  const ids: Record<string, string> = {}

  beforeEach(() => {
    db = openMemoryIndexDb()
    q = engine(db)
    ids.chest = seedAsset(db, { path: 'props/chest.glb', format: 'model', plugin: 'bowerbird.model', stage: 'runtime', review: 'approved', tags: ['宝箱', '道具'], aiTags: ['木头'], tech: { triangles: 2480, width: 0, rig: true, codec: 'none' }, created: '2026-11-02T00:00:00.000Z', modified: '2026-11-20T00:00:00.000Z', createdBy: 'agent:modeler', modifiedBy: 'user:lin', method: 'ai-generate', batch: 'bat_1', size: 5000 })
    ids.chestTex = seedAsset(db, { path: 'props/tex/chest_albedo.png', format: 'image', plugin: 'bowerbird.image', stage: 'production', review: 'pending', tags: ['道具'], tech: { width: 2048, height: 2048 }, created: '2026-11-03T00:00:00.000Z', modified: '2026-11-03T00:00:00.000Z', createdBy: 'user:lin', method: 'manual', size: 9000 })
    ids.bin = seedAsset(db, { path: 'props/chest.bin', format: 'gltf-buffer', auxiliary: true, review: 'exempt', created: '2026-11-02T00:00:00.000Z', size: 100 })
    ids.concept = seedAsset(db, { path: 'concept/chest_concept.png', format: 'image', stage: 'reference', review: 'rejected', aiTags: ['宝箱'], tech: { width: 1024 }, created: '2026-10-01T00:00:00.000Z', modified: '2026-10-02T00:00:00.000Z', createdBy: 'agent:painter', issueLevel: 3, size: 300 })
    ids.doc = seedAsset(db, { path: 'docs/chest.md', format: 'doc', stage: 'reference', review: 'exempt', created: '2026-09-01T00:00:00.000Z', createdBy: 'user:wang', issueLevel: 1, size: 20, memberCount: 1 })
    ids.sfx = seedAsset(db, { path: 'audio/open.wav', format: 'audio', stage: 'runtime', review: 'pending', tags: ['废弃'], tech: { duration: 1.5 }, created: '2026-11-10T00:00:00.000Z', createdBy: 'user:lin', issueLevel: 2, size: 700 })
    seedRelation(db, ids.chest!, 'uses', ids.chestTex!, { slot: 'albedo.png' })
    seedRelation(db, ids.chest!, 'belongs', ids.doc!)
    seedRelation(db, ids.chest!, 'source', ids.concept!, { role: 'reference' })
    seedRelation(db, ids.chestTex!, 'source', ids.concept!)
    seedIssue(db, ids.concept!, 'broken-reference', 'error')
    seedIssue(db, ids.sfx!, 'stale-upstream', 'warning')
    seedIssue(db, ids.doc!, 'duplicate-content', 'info')
  })

  const cases: Array<[string, Filter, string[]]> = [
    ['stage', { stage: ['runtime'] }, ['chest.glb', 'open.wav']],
    ['stage OR inside the array', { stage: ['runtime', 'reference'] }, ['chest.glb', 'chest.md', 'chest_concept.png', 'open.wav']],
    ['format', { format: ['image'] }, ['chest_albedo.png', 'chest_concept.png']],
    ['tags.all (human + AI by default)', { tags: { all: ['宝箱'] } }, ['chest.glb', 'chest_concept.png']],
    ['tags.all, human tags only', { tags: { all: ['宝箱'] }, humanTagsOnly: true }, ['chest.glb']],
    ['tags.all needs every tag', { tags: { all: ['宝箱', '道具'] } }, ['chest.glb']],
    ['tags.any', { tags: { any: ['木头', '废弃'] } }, ['chest.glb', 'open.wav']],
    ['tags.none', { tags: { none: ['道具', '废弃'] } }, ['chest.md', 'chest_concept.png']],
    ['folder includes sub folders', { folder: 'props/' }, ['chest.glb', 'chest_albedo.png']],
    ['folder exact', { folder: 'props', folderExact: true }, ['chest.glb']],
    ['folder root', { folder: '' }, ['chest.glb', 'chest.md', 'chest_albedo.png', 'chest_concept.png', 'open.wav']],
    ['review', { review: ['pending', 'rejected'] }, ['chest_albedo.png', 'chest_concept.png', 'open.wav']],
    ['hasIssues = error or warning level', { hasIssues: true }, ['chest_concept.png', 'open.wav']],
    ['hasIssues false', { hasIssues: false }, ['chest.glb', 'chest.md', 'chest_albedo.png']],
    ['issue type', { issue: ['stale-upstream'] }, ['open.wav']],
    ['tech gte', { tech: { width: { gte: 1024 } } }, ['chest_albedo.png', 'chest_concept.png']],
    ['tech range', { tech: { width: { gt: 1000, lt: 2000 } } }, ['chest_concept.png']],
    ['tech alias tris', { tech: { tris: { lte: 5000 } } }, ['chest.glb']],
    ['tech eq number', { tech: { duration: { eq: 1.5 } } }, ['open.wav']],
    ['tech eq string', { tech: { codec: { eq: 'none' } } }, ['chest.glb']],
    ['tech eq boolean', { tech: { rig: { eq: true } } }, ['chest.glb']],
    ['created after', { created: { after: '2026-11-02T00:00:00Z' } }, ['chest.glb', 'chest_albedo.png', 'open.wav']],
    ['created before', { created: { before: '2026-10-15T00:00:00Z' } }, ['chest.md', 'chest_concept.png']],
    ['modified range', { modified: { after: '2026-11-15T00:00:00Z', before: '2026-11-30T00:00:00Z' } }, ['chest.glb']],
    ['by category', { by: 'agent' }, ['chest.glb', 'chest_concept.png']],
    ['by exact actor', { by: 'agent:painter' }, ['chest_concept.png']],
    ['method from the provenance', { method: ['manual'] }, ['chest_albedo.png']],
    ['method column', { method: ['ai-generate'] }, ['chest.glb']],
    ['batch: outputs of one run', { batch: 'bat_1' }, ['chest.glb']],
    ['last editor (ADR-072)', { modifiedBy: 'user:lin' }, ['chest.glb', 'chest_albedo.png', 'open.wav']],
    ['last editor by category', { modifiedBy: 'agent' }, ['chest_concept.png']],
    ['auxiliary included on request', { includeAuxiliary: true, folder: 'props' }, ['chest.bin', 'chest.glb', 'chest_albedo.png']],
    ['untagged = no human and no AI tags', { untagged: true }, ['chest.md']]
  ]
  for (const [label, filter, expected] of cases) {
    it(label, async () => {
      expect(await names(q, { filter })).toEqual(expected)
    })
  }

  it('excludes auxiliary files by default', async () => {
    expect(await names(q, {})).not.toContain('chest.bin')
  })

  it('restricts to ids (auxiliary ones included when listed)', async () => {
    expect(await names(q, { filter: { ids: [ids.bin!, ids.doc!] } })).toEqual(['chest.bin', 'chest.md'])
    expect(await names(q, { filter: { ids: [] } })).toEqual([])
  })

  it('relation direction out and in', async () => {
    expect(await names(q, { filter: { relation: { type: 'belongs', to: ids.doc! } } })).toEqual(['chest.glb'])
    expect(await names(q, { filter: { relation: { type: 'uses', to: ids.chest!, direction: 'in' } } })).toEqual(['chest_albedo.png'])
    expect(await names(q, { filter: { relation: { type: 'source', to: ids.concept! } } })).toEqual(['chest.glb', 'chest_albedo.png'])
  })

  it('relation by design object name (belongs:<name>)', async () => {
    expect(await names(q, { filter: { relation: { type: 'belongs', to: 'chest' } } })).toEqual(['chest.glb'])
    expect(await names(q, { filter: { relation: { type: 'belongs', to: 'chest.md' } } })).toEqual(['chest.glb'])
  })

  it('parses the search box syntax inside q; the explicit filter wins per field', async () => {
    expect(await names(q, { q: 'stage:runtime' })).toEqual(['chest.glb', 'open.wav'])
    expect(await names(q, { q: 'stage:runtime chest' })).toEqual(['chest.glb'])
    expect(await names(q, { q: 'format:image -tag:道具' })).toEqual(['chest_concept.png'])
    expect(await names(q, { q: 'tris:<5000 by:agent' })).toEqual(['chest.glb'])
    expect(await names(q, { q: 'is:issue' })).toEqual(['chest_concept.png', 'open.wav'])
    expect(await names(q, { q: 'is:stale' })).toEqual(['open.wav'])
    // Same field in both: the filter decides; different fields: both apply.
    expect(await names(q, { q: 'stage:runtime', filter: { stage: ['reference'] } })).toEqual(['chest.md', 'chest_concept.png'])
    expect(await names(q, { q: 'tag:道具', filter: { tags: { none: ['宝箱'] } } })).toEqual(['chest_albedo.png'])
    expect(await names(q, { q: 'tag:道具', filter: { tags: { all: ['宝箱'] } } })).toEqual(['chest.glb', 'chest_concept.png'])
    expect(await q.countFor({ q: 'format:image' })).toBe(2)
    expect(await q.ids({ q: 'stage:reference', sort: 'name' })).toEqual([ids.doc, ids.concept])
  })

  it('relative times in q are resolved when the query runs (saved view「本周新增」)', async () => {
    const recent = seedAsset(db, { path: 'new.png', created: new Date(Date.now() - 2 * 86_400_000).toISOString() })
    seedAsset(db, { path: 'old.png', created: new Date(Date.now() - 20 * 86_400_000).toISOString() })
    const rootOnly = { folder: '', folderExact: true }
    const r = await q.search({ q: 'created:week', filter: rootOnly }, human)
    expect(r.items.map(i => i.id)).toEqual([recent])
    expect(r.items[0]!.score).toBeUndefined()
    expect(await names(q, { q: 'created:month', filter: rootOnly })).toEqual(['new.png', 'old.png'])
  })

  it('belongs:<name> finds the design object by name without extension, file name or title', async () => {
    db.prepare("UPDATE assets SET cell_title = '宝箱设计' WHERE id = ?").run(ids.doc!)
    expect(await names(q, { q: 'belongs:chest' })).toEqual(['chest.glb'])
    expect(await names(q, { q: 'belongs:宝箱设计' })).toEqual(['chest.glb'])
    expect(await names(q, { q: `belongs:${ids.doc}` })).toEqual(['chest.glb'])
  })

  it('a review condition written in q counts for the agent scope', async () => {
    const agent = { agent: true, scope: 'approved' as const }
    const r = await q.search({ q: 'review:pending', sort: 'name' }, agent)
    expect(r.items.map(i => i.name)).toEqual(['chest_albedo.png', 'open.wav'])
    expect(r.scopedToApproved).toBeUndefined()
  })

  it('combines fields with AND', async () => {
    expect(await names(q, { filter: { stage: ['runtime'], tags: { all: ['道具'] }, review: ['approved'] } })).toEqual(['chest.glb'])
  })

  it('similarTo without a semantic plugin is unsupported', async () => {
    await expect(q.search({ filter: { similarTo: ids.chest! } }, human)).rejects.toMatchObject({ code: 'unsupported' })
    await expect(q.search({ filter: { similarTo: ids.chest! } }, human)).rejects.toBeInstanceOf(CoreError)
  })

  it('inTrash searches the trash only', async () => {
    seedTrash(db, { assetId: gid(900), name: 'old_chest.glb', originalPath: 'props/old_chest.glb', stage: 'runtime', tags: ['宝箱'], format: 'model' })
    seedTrash(db, { assetId: gid(901), name: 'note.md', originalPath: 'docs/note.md', deletedAt: '2026-11-21T00:00:00Z' })
    db.prepare("INSERT INTO cache_files (key, asset_id, stage, variant, rel_path, bytes, created_at) VALUES ('k1', ?, 'thumbnail', 'thumb', 'thumbnail/k1/k1.webp', 1, 'x')").run(gid(900))
    const all = await q.search({ filter: { inTrash: true } }, human)
    expect(all.items.map(i => i.name)).toEqual(['note.md', 'old_chest.glb'])
    expect(all.items[1]!.thumbnail).toBe(`/t/${gid(900)}/k1`)
    expect(await names(q, { filter: { inTrash: true, tags: { all: ['宝箱'] } } })).toEqual(['old_chest.glb'])
    expect(await names(q, { filter: { inTrash: true, folder: 'docs' } })).toEqual(['note.md'])
    expect(await names(q, { q: 'chest', filter: { inTrash: true } })).toEqual(['old_chest.glb'])
    expect(await names(q, {})).not.toContain('old_chest.glb')
    expect(await q.countFor({ filter: { inTrash: true } })).toBe(2)
  })
})

describe('QueryEngine sorting and paging', () => {
  let db: IndexDb
  let q: QueryEngine
  beforeEach(() => {
    db = openMemoryIndexDb()
    q = engine(db)
    const rows: Array<[string, string, number, string, string]> = [
      ['b.png', 'image', 30, '2026-11-05T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
      ['A.png', 'image', 10, '2026-11-04T00:00:00.000Z', '2026-11-02T00:00:00.000Z'],
      ['c.glb', 'model', 20, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'],
      ['d.wav', 'audio', 40, '2026-11-02T00:00:00.000Z', '2026-11-04T00:00:00.000Z'],
      ['e.glb', 'model', 50, '2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z']
    ]
    for (const [path, format, size, modified, created] of rows) seedAsset(db, { path, format, size, modified, created })
  })

  it('defaults to modified time, newest first', async () => {
    expect((await q.search({}, human)).items.map(i => i.name)).toEqual(['b.png', 'A.png', 'c.glb', 'd.wav', 'e.glb'])
  })

  it('relevance without a query word falls back to modified', async () => {
    expect((await q.search({ sort: 'relevance' }, human)).items.map(i => i.name)[0]).toBe('b.png')
  })

  it('sorts by name (case-insensitive, ascending by default), size, created, format', async () => {
    expect((await q.search({ sort: 'name' }, human)).items.map(i => i.name)).toEqual(['A.png', 'b.png', 'c.glb', 'd.wav', 'e.glb'])
    expect((await q.search({ sort: 'name', order: 'desc' }, human)).items.map(i => i.name)).toEqual(['e.glb', 'd.wav', 'c.glb', 'b.png', 'A.png'])
    expect((await q.search({ sort: 'size' }, human)).items.map(i => i.size)).toEqual([50, 40, 30, 20, 10])
    expect((await q.search({ sort: 'size', order: 'asc' }, human)).items.map(i => i.size)).toEqual([10, 20, 30, 40, 50])
    expect((await q.search({ sort: 'created' }, human)).items.map(i => i.name)).toEqual(['e.glb', 'd.wav', 'c.glb', 'A.png', 'b.png'])
    expect((await q.search({ sort: 'format' }, human)).items.map(i => i.name)).toEqual(['d.wav', 'A.png', 'b.png', 'c.glb', 'e.glb'])
  })

  for (const sort of ['name', 'modified', 'size', 'format', 'created'] as const) {
    for (const order of ['asc', 'desc'] as const) {
      it(`pages with a cursor (${sort} ${order})`, async () => {
        const full = (await q.search({ sort, order }, human)).items.map(i => i.id)
        const seen: string[] = []
        let cursor: string | null = null
        for (let i = 0; i < 10; i++) {
          const page = await q.search({ sort, order, limit: 2, cursor }, human)
          expect(page.total).toBe(5)
          seen.push(...page.items.map(x => x.id))
          cursor = page.cursor
          if (!cursor) break
        }
        expect(seen).toEqual(full)
      })
    }
  }

  it('never puts an unknown sort key or order into SQL', async () => {
    const injected = { sort: 'name; DROP TABLE assets' as never, order: 'desc; DROP TABLE assets' as never }
    const r = await q.search(injected, human)
    expect(r.items.map(i => i.name)).toEqual(['b.png', 'A.png', 'c.glb', 'd.wav', 'e.glb'])
    expect((await q.search({ sort: 'size', order: 'sideways' as never }, human)).items.map(i => i.size)).toEqual([50, 40, 30, 20, 10])
    expect(await q.ids({ sort: 'bogus' as never })).toHaveLength(5)
    expect(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 'assets'").pluck().get()).toBe(1)
  })

  it('rejects a cursor of another sort', async () => {
    const page = await q.search({ sort: 'name', limit: 2 }, human)
    await expect(q.search({ sort: 'size', limit: 2, cursor: page.cursor }, human)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(q.search({ cursor: 'garbage' }, human)).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('ids() returns the sorted ids, capped', async () => {
    const ids = await q.ids({ sort: 'size', order: 'asc' }, 3)
    expect(q.summaries(ids).map(s => s.size)).toEqual([10, 20, 30])
  })
})

describe('QueryEngine facets, counts, agent scope', () => {
  let db: IndexDb
  let q: QueryEngine
  beforeEach(() => {
    db = openMemoryIndexDb()
    q = engine(db)
    seedAsset(db, { path: 'a.png', format: 'image', review: 'approved', tags: ['x', 'y'] })
    seedAsset(db, { path: 'b.png', format: 'image', review: 'exempt', aiTags: ['x'] })
    seedAsset(db, { path: 'c.glb', format: 'model', review: 'pending', stage: 'runtime', issueLevel: 2 })
    seedAsset(db, { path: 'd.glb', format: 'model', review: 'rejected', issueLevel: 1, tags: ['y'] })
    seedAsset(db, { path: 'e.bin', format: 'gltf-buffer', auxiliary: true, review: 'pending' })
    seedTrash(db, { assetId: gid(777), name: 'gone.png', originalPath: 'gone.png' })
  })

  it('returns facet counts over the matched set', async () => {
    const r = await q.search({ facets: true }, human)
    expect(r.facets!.format).toEqual([{ value: 'image', count: 2 }, { value: 'model', count: 2 }])
    expect(r.facets!.stage).toEqual([{ value: 'production', count: 3 }, { value: 'runtime', count: 1 }])
    expect(r.facets!.review).toEqual(expect.arrayContaining([{ value: 'approved', count: 1 }, { value: 'pending', count: 1 }]))
    expect(r.facets!.tags).toEqual([{ value: 'x', count: 2 }, { value: 'y', count: 2 }])
    // includeAuxiliary (no restriction at all) and a restrictive filter take other SQL paths: same semantics.
    const withAux = await q.search({ facets: true, filter: { includeAuxiliary: true } }, human)
    expect(withAux.facets!.format).toEqual([{ value: 'image', count: 2 }, { value: 'model', count: 2 }, { value: 'gltf-buffer', count: 1 }])
    const narrow = await q.search({ facets: true, filter: { review: ['approved', 'rejected'] } }, human)
    expect(narrow.facets).toEqual({
      format: [{ value: 'image', count: 1 }, { value: 'model', count: 1 }],
      stage: [{ value: 'production', count: 2 }],
      review: [{ value: 'approved', count: 1 }, { value: 'rejected', count: 1 }],
      tags: [{ value: 'y', count: 2 }, { value: 'x', count: 1 }]
    })
    const human2 = await q.search({ facets: true, filter: { format: ['image'], humanTagsOnly: true } }, human)
    expect(human2.facets!.tags).toEqual([{ value: 'x', count: 1 }, { value: 'y', count: 1 }])
    expect((await q.search({}, human)).facets).toBeUndefined()
  })

  it('counts the built-in views (auxiliary files excluded) and any query', async () => {
    expect(q.counts()).toEqual({ all: 4, untagged: 1, pending: 1, issues: 1, trash: 1 })
    expect(await q.countFor({ filter: { format: ['model'] } })).toBe(2)
    expect(await q.countFor({ filter: { untagged: true } })).toBe(q.counts().untagged)
    expect(await q.countFor({ filter: { review: ['pending'] } })).toBe(q.counts().pending)
    expect(await q.countFor({ filter: { hasIssues: true } })).toBe(q.counts().issues)
    expect(await q.countFor({ q: 'png' })).toBe(2)
    // Cached between reads, recounted after any write.
    expect(q.counts()).toEqual(q.counts())
    seedAsset(db, { path: 'f.png', review: 'pending' })
    expect(q.counts()).toMatchObject({ all: 5, untagged: 2, pending: 2 })
    db.prepare("UPDATE assets SET review = 'approved' WHERE path = 'f.png'").run()
    expect(q.counts().pending).toBe(1)
  })

  it('agent scope approved: only approved + exempt without a review condition, flagged in the response', async () => {
    const agent = { agent: true, scope: 'approved' as const }
    const r = await q.search({ sort: 'name' }, agent)
    expect(r.items.map(i => i.name)).toEqual(['a.png', 'b.png'])
    expect(r.scopedToApproved).toBe(true)
    const explicit = await q.search({ filter: { review: ['pending'] } }, agent)
    expect(explicit.items.map(i => i.name)).toEqual(['c.glb'])
    expect(explicit.scopedToApproved).toBeUndefined()
    expect((await q.search({}, { agent: true, scope: 'all' })).items).toHaveLength(4)
    expect((await q.search({}, { agent: false, scope: 'approved' })).items).toHaveLength(4)
    expect((await q.search({}, { agent: false, scope: 'approved' })).scopedToApproved).toBeUndefined()
  })
})

describe('QueryEngine summaries', () => {
  it('maps index rows to AssetSummary', () => {
    const db = openMemoryIndexDb()
    const q = engine(db)
    const id = seedAsset(db, {
      path: 'docs/chest.md', format: 'doc', plugin: 'bowerbird.doc', description: '宝箱的设计说明。第二句不显示。', autoDescription: 'AI 写的。',
      flags: FLAG.stale | FLAG.processing, missing: true, thumbState: 'ready', thumbKey: 'abc', aspect: 1.5, badge: '1 页',
      cellTitle: '宝箱', cellExcerpt: '开头几行', issueLevel: 3, issueCount: 2, memberCount: 4, tags: ['宝箱', '道具'], aiTags: ['宝箱', '木头'],
      missingPlugin: { id: 'community.spine', range: '^1.4' }, createdBy: 'agent:writer'
    })
    const plain = seedAsset(db, { path: 'x.png', autoDescription: 'Only the AI one. Second.' })
    const [s, p] = q.summaries([id, gid(99999), plain])
    expect(q.summaries([gid(99999)])).toEqual([])
    expect(s).toMatchObject({
      id, name: 'chest.md', path: 'docs/chest.md', format: 'doc', plugin: 'bowerbird.doc', description: '宝箱的设计说明。',
      flags: ['stale', 'missing', 'processing'], thumbnail: `/t/${id}/abc`, thumbState: 'ready', aspect: 1.5, badge: '1 页',
      cellText: { title: '宝箱', excerpt: '开头几行' }, issueLevel: 'error', issueCount: 2, memberCount: 4,
      tags: ['宝箱', '道具'], autoTags: ['木头'], missingPlugin: { id: 'community.spine', range: '^1.4' }, createdBy: 'agent:writer',
      bundle: false, auxiliary: false
    })
    expect(p).toMatchObject({ description: 'Only the AI one.', thumbnail: null, cellText: null, missingPlugin: null, issueLevel: null, flags: [] })
    // Tags in .bmeta order; a manual thumbnail is addressed by m<seq> so a replaced one is never served from a browser cache.
    const ordered = seedAsset(db, { path: 'o.png', tags: ['z', 'a', 'm'], aiTags: ['k', 'z', 'b'], thumbState: 'ready', thumbKey: 'k1' })
    db.prepare('UPDATE assets SET thumb_manual = 1, seq = 5 WHERE id = ?').run(ordered)
    expect(q.summaries([ordered])[0]).toMatchObject({ tags: ['z', 'a', 'm'], autoTags: ['k', 'b'], thumbnail: `/t/${ordered}/m5` })
  })
  it('marks turnaround sheets (a view grid in the .bmeta) with hasViews, and only them', () => {
    const db = openMemoryIndexDb()
    const q = engine(db)
    const sheet = seedAsset(db, { path: 'props/chest/chest_turnaround.png', format: 'image' })
    const meta = JSON.parse(db.prepare('SELECT meta_json FROM assets WHERE id = ?').pluck().get(sheet) as string)
    db.prepare('UPDATE assets SET meta_json = ? WHERE id = ?').run(JSON.stringify({ ...meta, views: { cols: 2, rows: 2, cells: { front: [0, 0], side: [1, 0], back: [0, 1], top: [1, 1] } } }), sheet)
    const concept = seedAsset(db, { path: 'props/chest/chest_concept.png', format: 'image' })
    const [a, b] = q.summaries([sheet, concept])
    expect(a!.hasViews).toBe(true)
    expect(b!.hasViews).toBeUndefined()
  })
})

/* ───────────── query words ───────────── */

function provider(id: string, fn: (q: string, opts: { candidates?: IdSet; limit: number }) => ScoredHit[]): SearchProvider & { calls: Array<{ q: string; candidates?: string[]; limit: number }>; docs: SearchDoc[]; removed: string[]; cleared: number } {
  const p = {
    id, calls: [] as Array<{ q: string; candidates?: string[]; limit: number }>, docs: [] as SearchDoc[], removed: [] as string[], cleared: 0,
    async index(docs: SearchDoc[]) { p.docs.push(...docs) },
    async remove(ids: string[]) { p.removed.push(...ids) },
    async clear() { p.cleared++ },
    async query(q: string, opts: { candidates?: IdSet; limit: number }) {
      p.calls.push({ q, candidates: opts.candidates ? [...opts.candidates] : undefined, limit: opts.limit })
      return fn(q, opts)
    }
  }
  return p
}

describe('QueryEngine with search providers', () => {
  let db: IndexDb
  const id: Record<string, string> = {}
  beforeEach(() => {
    db = openMemoryIndexDb()
    for (const n of ['a', 'b', 'c', 'd', 'e']) id[n] = seedAsset(db, { path: `${n}.png`, format: n === 'e' ? 'model' : 'image', modified: `2026-11-0${'abcde'.indexOf(n) + 1}T00:00:00.000Z`, size: 'abcde'.indexOf(n) })
    id.aux = seedAsset(db, { path: 'z.bin', auxiliary: true })
  })

  it('uses a single provider order and score directly, with its snippet', async () => {
    const p = provider('kw', () => [{ id: id.c!, score: 9, snippet: { field: 'prompt', text: 'a red chest', ranges: [[2, 5]] } }, { id: id.a!, score: 5 }, { id: id.aux!, score: 4 }, { id: gid(4242), score: 3 }])
    const q = engine(db, [{ pluginId: 'p1', provider: p }])
    const r = await q.search({ q: 'red' }, human)
    expect(r.items.map(i => i.name)).toEqual(['c.png', 'a.png'])
    expect(r.items[0]!.score).toBe(9)
    expect(r.items[0]!.hit).toEqual({ field: 'prompt', text: 'a red chest', ranges: [[2, 5]] })
    expect(r.total).toBe(2)
    // Default scope only: the whole library is the candidate set (post-filtered afterwards).
    expect(p.calls[0]!.candidates).toBeUndefined()
  })

  it('fuses several providers by reciprocal rank (k = 60)', async () => {
    const p1 = provider('kw', () => [{ id: id.a!, score: 100 }, { id: id.b!, score: 50 }, { id: id.c!, score: 1 }])
    const p2 = provider('sem', () => [{ id: id.c!, score: 0.9 }, { id: id.b!, score: 0.8 }, { id: id.d!, score: 0.1 }])
    const q = engine(db, [{ pluginId: 'p1', provider: p1 }, { pluginId: 'p2', provider: p2 }])
    const r = await q.search({ q: 'x' }, human)
    // b: 1/62 + 1/62; a: 1/61; c: 1/63 + 1/61; d: 1/63
    expect(r.items.map(i => i.name)).toEqual(['c.png', 'b.png', 'a.png', 'd.png'])
    expect(r.items[0]!.score).toBeCloseTo(1 / 63 + 1 / 61, 10)
    const f = fuse([[{ id: 'x', score: 1 }], [{ id: 'y', score: 1 }]])
    expect(f.map(h => h.id)).toEqual(['x', 'y'])
  })

  it('passes the filtered candidates to providers and pages the fused list', async () => {
    const p = provider('kw', (_q, o) => [id.a!, id.b!, id.c!, id.d!, id.e!].filter(x => !o.candidates || o.candidates.has(x)).map((x, i) => ({ id: x, score: 10 - i })))
    const q = engine(db, [{ pluginId: 'p1', provider: p }])
    const r = await q.search({ q: 'x', filter: { format: ['image'] }, limit: 3 }, human)
    expect(p.calls[0]!.candidates!.sort()).toEqual([id.a!, id.b!, id.c!, id.d!].sort())
    expect(r.items.map(i => i.name)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(r.total).toBe(4)
    const r2 = await q.search({ q: 'x', filter: { format: ['image'] }, limit: 3, cursor: r.cursor }, human)
    expect(r2.items.map(i => i.name)).toEqual(['d.png'])
    expect(r2.cursor).toBeNull()
    expect(p.calls[0]!.limit).toBeGreaterThanOrEqual(1000)
  })

  it('sorts hits by another key when asked, keeping scores', async () => {
    const p = provider('kw', () => [{ id: id.a!, score: 3 }, { id: id.d!, score: 2 }, { id: id.b!, score: 1 }])
    const q = engine(db, [{ pluginId: 'p1', provider: p }])
    const r = await q.search({ q: 'x', sort: 'size', order: 'desc', limit: 2 }, human)
    expect(r.items.map(i => i.name)).toEqual(['d.png', 'b.png'])
    expect(r.items[0]!.score).toBe(2)
    const r2 = await q.search({ q: 'x', sort: 'size', order: 'desc', limit: 2, cursor: r.cursor }, human)
    expect(r2.items.map(i => i.name)).toEqual(['a.png'])
    const facets = await q.search({ q: 'x', facets: true }, human)
    expect(facets.facets!.format).toEqual([{ value: 'image', count: 3 }])
  })

  it('gives providers only the free text left after the syntax, and the narrowed candidates', async () => {
    const p = provider('kw', (_q, o) => [id.a!, id.e!].filter(x => !o.candidates || o.candidates.has(x)).map(x => ({ id: x, score: 1 })))
    const q = engine(db, [{ pluginId: 'p1', provider: p }])
    const r = await q.search({ q: 'format:model red   chest' }, human)
    expect(p.calls[0]!.q).toBe('red chest')
    expect(p.calls[0]!.candidates).toEqual([id.e!])
    expect(r.items.map(i => i.name)).toEqual(['e.png'])
    // Syntax only: a pure filter, no provider call.
    await q.search({ q: 'format:model' }, human)
    expect(p.calls).toHaveLength(1)
  })

  it('isolates a failing provider', async () => {
    const bad = provider('bad', () => { throw new Error('boom') })
    const good = provider('kw', () => [{ id: id.b!, score: 1 }])
    const q = engine(db, [{ pluginId: 'bad', provider: bad }, { pluginId: 'p1', provider: good }])
    expect((await q.search({ q: 'x' }, human)).items.map(i => i.name)).toEqual(['b.png'])
  })

  it('returns nothing without asking providers when the filter matches nothing', async () => {
    const p = provider('kw', () => [{ id: id.a!, score: 1 }])
    const q = engine(db, [{ pluginId: 'p1', provider: p }])
    const r = await q.search({ q: 'x', filter: { format: ['video'] }, facets: true }, human)
    expect(r.items).toEqual([])
    expect(p.calls).toHaveLength(0)
  })

  it('forwards index, remove and clear to every provider; one failing does not stop the others', async () => {
    const p1 = provider('kw', () => [])
    const p2 = provider('sem', () => [])
    const broken = { ...provider('x', () => []), index: async () => { throw new Error('disk full') } }
    const q = engine(db, [{ pluginId: 'p1', provider: p1 }, { pluginId: 'bad', provider: broken }, { pluginId: 'p2', provider: p2 }])
    const doc = { id: id.a!, name: 'a.png', stem: 'a', path: 'a.png', folder: '', tags: [], autoTags: [], description: '', autoDescription: '', prompts: [], text: '', format: 'image' }
    await expect(q.indexDocs([doc])).rejects.toThrow('disk full')
    expect(p1.docs).toHaveLength(1)
    expect(p2.docs).toHaveLength(1)
    await q.removeDocs([id.a!])
    expect(p1.removed).toEqual([id.a!])
    await q.clearProviders()
    expect(p1.cleared + p2.cleared).toBe(2)
  })
})

describe('QueryEngine substring fallback (no search plugin)', () => {
  it('matches name, tags and description; ranks name > tag > description; gives snippets', async () => {
    const db = openMemoryIndexDb()
    const q = engine(db)
    seedAsset(db, { path: 'props/treasure_chest.glb', modified: '2026-11-01T00:00:00.000Z' })
    seedAsset(db, { path: 'props/box.glb', tags: ['Chest'], modified: '2026-11-02T00:00:00.000Z' })
    seedAsset(db, { path: 'props/crate.glb', description: 'A wooden crate, not a chest at all.', modified: '2026-11-03T00:00:00.000Z' })
    seedAsset(db, { path: 'props/barrel.glb', modified: '2026-11-04T00:00:00.000Z' })
    seedAsset(db, { path: 'props/ai.glb', autoDescription: 'Looks like a chest_lid.', modified: '2026-11-05T00:00:00.000Z' })
    const r = await q.search({ q: 'chest' }, human)
    expect(r.items.map(i => i.name)).toEqual(['treasure_chest.glb', 'box.glb', 'ai.glb', 'crate.glb'])
    expect(r.total).toBe(4)
    expect(r.items[0]!.hit).toBeUndefined()
    expect(r.items[1]!.hit).toEqual({ field: 'tags', text: 'Chest', ranges: [[0, 5]] })
    const crate = r.items.find(i => i.name === 'crate.glb')!
    expect(crate.hit!.field).toBe('description')
    expect(crate.hit!.text.slice(crate.hit!.ranges[0]![0], crate.hit!.ranges[0]![1])).toBe('chest')
    // every word must match; % and _ are literal
    expect((await q.search({ q: 'wooden chest' }, human)).items.map(i => i.name)).toEqual(['crate.glb'])
    expect((await q.search({ q: '100%' }, human)).items).toEqual([])
    expect((await q.search({ q: 'chest_' }, human)).items.map(i => i.name)).toEqual(['ai.glb'])
  })
})
