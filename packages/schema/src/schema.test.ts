import { describe, expect, it } from 'vitest'
import {
  Bmeta, LibraryJson, ProductionRecord, ViewGrid, copyName, effectiveReview, filterChips, firstSentence, formatQueryText,
  nextFreeName, parseQueryText, parseTargetSize, serializeBmeta, actorMatches, PluginPackageJson, versionNumberOf
} from './index.js'

const ID = '0192f3a7-5c1e-7b3a-9d2f-4a6c8e0b1d23'
const NOW = new Date('2026-11-25T04:00:00Z')

describe('query text syntax (search.md「文本语法」)', () => {
  it('parses every documented key', () => {
    const p = parseQueryText('stage:runtime format:model tag:宝箱 -tag:废弃 tris:<5000 folder:props/ review:pending is:issue is:stale is:missing when:week created:today by:agent:modeler method:ai-generate belongs:chest width:>=1024 dur:<5 宝箱', NOW)
    expect(p.q).toBe('宝箱')
    expect(p.filter.stage).toEqual(['runtime'])
    expect(p.filter.format).toEqual(['model'])
    expect(p.filter.tags).toEqual({ all: ['宝箱'], none: ['废弃'] })
    expect(p.filter.tech).toEqual({ triangles: { lt: 5000 }, width: { gte: 1024 }, duration: { lt: 5 } })
    expect(p.filter.folder).toBe('props/')
    expect(p.filter.review).toEqual(['pending'])
    expect(p.filter.hasIssues).toBe(true)
    expect(p.filter.issue).toEqual(['stale-upstream', 'missing-file'])
    expect(p.filter.modified?.after).toBe('2026-11-18T04:00:00.000Z')
    expect(p.filter.created?.after).toBe('2026-11-24T04:00:00.000Z')
    expect(p.filter.by).toBe('agent:modeler')
    expect(p.filter.method).toEqual(['ai-generate'])
    expect(p.filter.relation).toEqual({ type: 'belongs', to: 'chest' })
    expect(p.belongsName).toBe('chest')
  })
  it('keeps invalid values and unknown words as free text', () => {
    const p = parseQueryText('stage:nope foo:bar 红色 的 宝箱', NOW)
    expect(p.q).toBe('stage:nope foo:bar 红色 的 宝箱')
    expect(p.filter).toEqual({})
  })
  it('supports quoted values', () => {
    expect(parseQueryText('tag:"two words" x').filter.tags?.all).toEqual(['two words'])
  })
  it('round-trips through formatQueryText', () => {
    const text = 'stage:runtime format:model tag:宝箱 -tag:废弃 folder:props/ tris:<5000 when:week 宝箱'
    const p = parseQueryText(text, NOW)
    const again = parseQueryText(formatQueryText(p), NOW)
    expect(again.filter).toEqual(p.filter)
    expect(again.q).toBe(p.q)
    expect(filterChips(p.filter, p).map(c => c.key)).toEqual(['stage', 'format', 'tag', '-tag', 'folder', 'tris', 'when'])
  })
})

describe('naming (sync-and-integrity.md「副本的名字」)', () => {
  it('copies get _1, _2, _3', () => {
    const taken = new Set(['chest.png'])
    const n1 = copyName('chest.png', n => taken.has(n)); taken.add(n1)
    const n2 = copyName('chest.png', n => taken.has(n)); taken.add(n2)
    expect([n1, n2, copyName('chest.png', n => taken.has(n))]).toEqual(['chest_1.png', 'chest_2.png', 'chest_3.png'])
  })
  it('keep-both keeps the name when free', () => {
    expect(nextFreeName('a.glb', () => false)).toBe('a.glb')
    expect(nextFreeName('a.glb', n => n === 'a.glb')).toBe('a_1.glb')
    expect(copyName('Makefile', () => false)).toBe('Makefile_1')
  })
})

describe('effective review (data-model.md「有效状态的计算」)', () => {
  it('exempt stays exempt, stale verdicts become pending', () => {
    expect(effectiveReview({ hash: 'sha256:aa', review: { status: 'exempt' } })).toBe('exempt')
    expect(effectiveReview({ hash: 'sha256:aa', review: { status: 'approved', hash: 'sha256:bb' } })).toBe('pending')
    expect(effectiveReview({ hash: 'sha256:aa', review: { status: 'rejected', hash: 'sha256:aa' } })).toBe('rejected')
    expect(effectiveReview({ hash: 'sha256:aa' })).toBe('pending')
  })
})

describe('.bmeta (library-format.md)', () => {
  const base = { bb: 1, id: ID, hash: 'sha256:9c1e', stage: 'runtime', created: { at: '2026-11-20T03:12:00Z', by: 'agent:modeler' } }
  it('requires bb, id, hash, stage, created', () => {
    expect(Bmeta.safeParse(base).success).toBe(true)
    for (const k of ['bb', 'id', 'hash', 'stage', 'created']) {
      const m: Record<string, unknown> = { ...base }; delete m[k]
      expect(Bmeta.safeParse(m).success, k).toBe(false)
    }
  })
  it('keeps unknown keys and writes the fixed key order', () => {
    const m = Bmeta.parse({ ...base, futureField: { x: 1 }, tags: ['宝箱'], relations: [{ type: 'uses', to: ID, slot: 'chest_basecolor.png' }] })
    const text = serializeBmeta(m)
    expect(Object.keys(JSON.parse(text))).toEqual(['bb', 'id', 'hash', 'stage', 'tags', 'relations', 'created', 'futureField'])
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "id"')
  })
  it('validates turnaround grids', () => {
    expect(ViewGrid.safeParse({ rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] }).success).toBe(true)
    expect(ViewGrid.safeParse({ rows: 2, cols: 2, cells: ['front'] }).success).toBe(false)
  })
  it('library.json gets default settings', () => {
    const lib = LibraryJson.parse({ bb: 1, id: ID, name: 'x', created: '2026-11-25T00:00:00Z' })
    expect(lib.settings).toEqual({ defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 })
    expect(lib.plugins).toEqual({})
  })
  it('records have an open method and optional roles', () => {
    expect(ProductionRecord.safeParse({ id: 'rec_x', method: 'community.forge/model', by: 'user:unnamed', at: 'x', inputs: [{ id: ID, hash: 'sha256:aa', role: '四视图' }] }).success).toBe(true)
  })
})

describe('helpers', () => {
  it('first sentence', () => {
    expect(firstSentence('新手村第一个能打开的宝箱，运行时用。开箱动画在 x。')).toBe('新手村第一个能打开的宝箱，运行时用。')
    expect(firstSentence('One. Two.')).toBe('One.')
    expect(firstSentence('')).toBeNull()
  })
  it('target size', () => {
    expect(parseTargetSize('1.26 × 0.95 × 0.87 m')).toEqual({ w: 1.26, h: 0.95, d: 0.87 })
    expect(parseTargetSize('126x95x87 cm')).toEqual({ w: 1.26, h: 0.95, d: 0.87 })
    expect(parseTargetSize('big')).toBeNull()
  })
  it('actor filter', () => {
    expect(actorMatches('agent:modeler', 'agent')).toBe(true)
    expect(actorMatches('agent:modeler', 'agent:modeler')).toBe(true)
    expect(actorMatches('user:lin', 'agent')).toBe(false)
  })
  it('version numbers', () => {
    expect(versionNumberOf([{ hash: 'a' }, { hash: 'b' }, { hash: 'a' }], 'a')).toBe(3)
    expect(versionNumberOf([{ hash: 'a' }], 'z')).toBeNull()
  })
  it('plugin manifest', () => {
    const ok = PluginPackageJson.safeParse({ name: '@x/p', version: '1.0.0', bowerbird: { id: 'x.p', displayName: 'P', apiVersion: 1, contributes: { formats: [{ id: 'f', displayName: 'F', extensions: ['.foo'] }] } } })
    expect(ok.success).toBe(true)
    expect(ok.data?.bowerbird.contributes.formats?.[0]?.thumbnail).toBe('server')
  })
})
