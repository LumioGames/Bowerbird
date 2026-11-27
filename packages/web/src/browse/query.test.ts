import { describe, expect, it } from 'vitest'
import {
  absorbTyped, buildQuery, chipsOf, effectiveSort, EMPTY_STATE, paramsFromState, removeChip, smartQueryOf,
  stateFromParams, stateFromSmart, type BrowseState
} from './query'

const sp = (s: string) => new URLSearchParams(s)

describe('browse query in the address', () => {
  it('reads location, conditions and free words from the URL', () => {
    const s = stateFromParams(sp('folder=props/chest&q=stage:runtime%20tag:宝箱%20宝箱'))
    expect(s.loc).toEqual({ type: 'folder', path: 'props/chest' })
    expect(s.filter.stage).toEqual(['runtime'])
    expect(s.filter.tags?.all).toEqual(['宝箱'])
    expect(s.text).toBe('宝箱')
  })

  it('round-trips conditions through the text syntax', () => {
    const s: BrowseState = { ...EMPTY_STATE, loc: { type: 'view', id: 'pending' }, text: 'chest', filter: { format: ['model'], tags: { none: ['废弃'] }, tech: { triangles: { lt: 5000 } } }, extras: {} }
    const back = stateFromParams(paramsFromState(s))
    expect(back.loc).toEqual(s.loc)
    expect(back.text).toBe('chest')
    expect(back.filter.format).toEqual(['model'])
    expect(back.filter.tags?.none).toEqual(['废弃'])
    expect(back.filter.tech?.triangles).toEqual({ lt: 5000 })
  })

  it('keeps the tag mode, human-only and auxiliary switches', () => {
    const s = stateFromParams(sp('q=tag:a%20tag:b&tags=any&human=1&aux=1'))
    expect(s.tagMode).toBe('any')
    expect(s.filter.tags?.any).toEqual(['a', 'b'])
    expect(s.filter.humanTagsOnly).toBe(true)
    expect(s.filter.includeAuxiliary).toBe(true)
    const p = paramsFromState(s)
    expect(p.get('tags')).toBe('any')
    expect(p.get('human')).toBe('1')
  })
})

describe('search box ↔ filter panel', () => {
  it('turns a finished key:value into a chip and keeps the word being typed', () => {
    const r = absorbTyped(EMPTY_STATE, 'stage:runtime chest', false)
    expect(r.changed).toBe(true)
    expect(r.filter.stage).toEqual(['runtime'])
    expect(r.input).toBe('chest')
  })

  it('leaves the token under the caret alone until Enter', () => {
    const typing = absorbTyped(EMPTY_STATE, 'stage:runt', false)
    expect(typing.changed).toBe(false)
    expect(typing.input).toBe('stage:runt')
    const enter = absorbTyped(EMPTY_STATE, 'stage:runtime', true)
    expect(enter.filter.stage).toEqual(['runtime'])
    expect(enter.input).toBe('')
  })

  it('a condition added in the panel shows as a chip, and removing the chip clears the panel', () => {
    const s: BrowseState = { ...EMPTY_STATE, filter: { review: ['pending'], hasIssues: true } }
    const chips = chipsOf(s)
    expect(chips).toEqual([{ key: 'review', value: 'pending' }, { key: 'is', value: 'issue' }])
    const after = removeChip(s, chips[1]!)
    expect(after.filter.hasIssues).toBeUndefined()
    expect(after.filter.review).toEqual(['pending'])
  })

  it('removes tech conditions one comparator at a time', () => {
    const s = { filter: { tech: { width: { gte: 512, lte: 2048 } } }, extras: {} }
    const r = removeChip(s, { key: 'width', value: '>=512' })
    expect(r.filter.tech?.width).toEqual({ lte: 2048 })
    const r2 = removeChip({ ...s, filter: r.filter }, { key: 'width', value: '<=2048' })
    expect(r2.filter.tech).toBeUndefined()
  })

  it('removes relative time chips with their range', () => {
    const s = stateFromParams(sp('q=when:week'))
    expect(s.filter.modified?.after).toBeTruthy()
    const r = removeChip(s, { key: 'when', value: 'week' })
    expect(r.filter.modified).toBeUndefined()
    expect(r.extras.when).toBeUndefined()
  })

  it('last modifier (editor:) and one run\'s outputs (batch:) become chips and go away with them (ADR-072, ADR-070)', () => {
    const r = absorbTyped(EMPTY_STATE, 'editor:agent:slicer batch:bat_shop ', false)
    expect(r.filter).toMatchObject({ modifiedBy: 'agent:slicer', batch: 'bat_shop' })
    const s = { ...EMPTY_STATE, filter: r.filter, extras: r.extras }
    expect(chipsOf(s)).toEqual([{ key: 'editor', value: 'agent:slicer' }, { key: 'batch', value: 'bat_shop' }])
    expect(stateFromParams(paramsFromState(s)).filter).toMatchObject({ modifiedBy: 'agent:slicer', batch: 'bat_shop' })
    const a = removeChip(s, { key: 'editor', value: 'agent:slicer' })
    expect(a.filter.modifiedBy).toBeUndefined()
    expect(removeChip({ ...s, filter: a.filter }, { key: 'batch', value: 'bat_shop' }).filter).toEqual({})
  })
})

describe('request', () => {
  it('relevance only with a query word', () => {
    expect(effectiveSort({ ...EMPTY_STATE }).sort).toBe('modified')
    expect(effectiveSort({ ...EMPTY_STATE, text: 'chest' }).sort).toBe('relevance')
    expect(effectiveSort({ ...EMPTY_STATE, sort: 'relevance' }).sort).toBe('modified')
    expect(effectiveSort({ ...EMPTY_STATE, sort: 'name' })).toEqual({ sort: 'name', order: 'asc' })
  })

  it('merges the location with the conditions', () => {
    const q = buildQuery({ ...EMPTY_STATE, loc: { type: 'folder', path: 'props' }, filter: { stage: ['runtime'] } })
    expect(q.filter).toEqual({ folder: 'props', stage: ['runtime'] })
    const p = buildQuery({ ...EMPTY_STATE, loc: { type: 'view', id: 'pending' } })
    expect(p.filter?.review).toEqual(['pending'])
  })

  it('resolves a design object name to its GUID', () => {
    const s = stateFromParams(sp('q=belongs:chest'))
    const q = buildQuery(s, null, n => (n === 'chest' ? '0192f3a4-7c1e-7b52-9d06-4e8a51c0d201' : null))
    expect(q.filter?.relation).toEqual({ type: 'belongs', to: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d201' })
  })

  it('a smart folder keeps relative times as syntax and comes back as chips', () => {
    const s = stateFromParams(sp('folder=props&q=when:week%20review:pending'))
    const saved = smartQueryOf(s)
    expect(saved.q).toBe('when:week')
    expect(saved.filter?.modified).toBeUndefined()
    expect(saved.filter?.folder).toBe('props')
    const back = stateFromSmart({ name: 'x', builtin: false, query: saved, count: 0 })
    expect(back.extras.when).toBe('week')
    expect(back.filter.review).toEqual(['pending'])
    expect(back.editSmart).toBe('x')
  })
})
