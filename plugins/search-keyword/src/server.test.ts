import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchDoc } from '@bowerbird/plugin-sdk'
import { findRanges, makeSnippet, queryTerms } from './snippet.js'
import { KeywordIndex } from './store.js'

import { doc } from './__tests__/docs.js'
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
const ids = (set: string[]) => ({ has: (x: string) => set.includes(x), size: set.length, [Symbol.iterator]: () => set[Symbol.iterator]() })

let dir: string, idx: KeywordIndex
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-kw-')); idx = new KeywordIndex(path.join(dir, 'k.sqlite')) })
afterEach(() => { idx.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('keyword index', () => {
  it('finds Chinese substrings of three or more characters anywhere (trigram)', () => {
    idx.index([doc(1, { description: '红色的卡通宝箱，木质箱体加黄铜包边' }), doc(2, { description: '蓝色的药水瓶' })])
    expect(idx.query('卡通宝箱', { limit: 10 }).map(h => h.id)).toEqual([id(1)])
    expect(idx.query('黄铜包', { limit: 10 }).map(h => h.id)).toEqual([id(1)])
  })

  it('falls back to substring matching for terms under three characters', () => {
    idx.index([doc(1, { name: 'chest.png', tags: ['宝箱'] }), doc(2, { text: '这里提到宝箱一次' }), doc(3, { tags: ['药水'] })])
    const hits = idx.query('宝箱', { limit: 10 })
    expect(hits.map(h => h.id)).toEqual([id(1), id(2)])
    expect(idx.query('ui', { limit: 10 })).toEqual([])
  })

  it('weights the name and human tags above descriptions, prompts above body text', () => {
    idx.index([
      doc(1, { text: 'a lantern is mentioned in the body' }),
      doc(2, { name: 'lantern.glb' }),
      doc(3, { description: 'brass lantern with frosted glass' }),
      doc(4, { tags: ['lantern'] }),
      doc(5, { prompts: ['a cartoon lantern, warm light'] })
    ])
    const order = idx.query('lantern', { limit: 10 }).map(h => h.id)
    expect(order.indexOf(id(2))).toBeLessThan(order.indexOf(id(3)))
    expect(order.indexOf(id(4))).toBeLessThan(order.indexOf(id(3)))
    expect(order.indexOf(id(5))).toBeLessThan(order.indexOf(id(1)))
    expect(order[order.length - 1]).toBe(id(1))
  })

  it('searches folder names, AI tags and AI descriptions', () => {
    idx.index([doc(1, { folder: 'ui/shop', path: 'ui/shop/a.png' }), doc(2, { autoTags: ['wooden'] }), doc(3, { autoDescription: 'a glowing potion' })])
    expect(idx.query('shop', { limit: 5 }).map(h => h.id)).toEqual([id(1)])
    expect(idx.query('wooden', { limit: 5 }).map(h => h.id)).toEqual([id(2)])
    expect(idx.query('glowing', { limit: 5 })[0]!.snippet?.field).toBe('description')
  })

  it('requires every term and mixes long and short terms', () => {
    idx.index([doc(1, { description: '宝箱 brass lid' }), doc(2, { description: 'brass lantern' })])
    expect(idx.query('brass 宝箱', { limit: 5 }).map(h => h.id)).toEqual([id(1)])
    expect(idx.query('brass lid', { limit: 5 }).map(h => h.id)).toEqual([id(1)])
  })

  it('returns only candidates, small sets and large ones', () => {
    idx.index(Array.from({ length: 30 }, (_, i) => doc(i + 1, { description: 'common word' })))
    expect(idx.query('common', { limit: 50, candidates: ids([id(3), id(7)]) }).map(h => h.id).sort()).toEqual([id(3), id(7)])
    expect(idx.query('co', { limit: 50, candidates: ids([id(4)]) }).map(h => h.id)).toEqual([id(4)])
    expect(idx.query('common', { limit: 50, candidates: ids([]) })).toEqual([])
    const big = Array.from({ length: 6000 }, (_, i) => id(i + 10))
    expect(idx.query('common', { limit: 50, candidates: ids(big) }).map(h => h.id).sort()).toEqual(Array.from({ length: 21 }, (_, i) => id(i + 10)).sort())
  })

  it('honours the limit and sorts by score', () => {
    idx.index(Array.from({ length: 20 }, (_, i) => doc(i + 1, { description: 'shared phrase' })))
    const h = idx.query('shared', { limit: 5 })
    expect(h).toHaveLength(5)
    for (let i = 1; i < h.length; i++) expect(h[i - 1]!.score).toBeGreaterThanOrEqual(h[i]!.score)
  })

  it('returns the snippet and highlight ranges when the hit is outside the name', () => {
    idx.index([doc(1, { prompts: ['low poly treasure chest, brass trim, warm light from inside'] }), doc(2, { name: 'treasure_map.png' })])
    const [p] = idx.query('treasure', { limit: 5, candidates: ids([id(1)]) })
    expect(p!.snippet!.field).toBe('prompt')
    const [a, b] = p!.snippet!.ranges[0]!
    expect(p!.snippet!.text.slice(a, b).toLowerCase()).toBe('treasure')
    expect(idx.query('treasure', { limit: 5, candidates: ids([id(2)]) })[0]!.snippet).toBeUndefined()
  })

  it('updates, removes and clears', () => {
    idx.index([doc(1, { description: 'old words' })])
    idx.index([doc(1, { description: 'new words' })])
    expect(idx.query('old', { limit: 5 })).toEqual([])
    expect(idx.query('new', { limit: 5 }).map(h => h.id)).toEqual([id(1)])
    expect(idx.size).toBe(1)
    idx.remove([id(1), id(99)])
    expect(idx.query('new', { limit: 5 })).toEqual([])
    idx.index([doc(2, { description: 'again' })])
    idx.clear()
    expect(idx.size).toBe(0)
    expect(idx.query('again', { limit: 5 })).toEqual([])
  })

  it('treats FTS syntax in queries as text', () => {
    idx.index([doc(1, { description: 'size "large" AND NOT small' })])
    expect(() => idx.query('"large" OR', { limit: 5 })).not.toThrow()
    expect(idx.query('large*', { limit: 5 }).map(h => h.id)).toEqual([id(1)])
  })

  it('survives reopening (index lives in the data folder)', () => {
    idx.index([doc(1, { description: 'persistent text' })])
    idx.close()
    idx = new KeywordIndex(path.join(dir, 'k.sqlite'))
    expect(idx.query('persistent', { limit: 5 }).map(h => h.id)).toEqual([id(1)])
  })
})

describe('snippets', () => {
  it('splits terms and merges ranges', () => {
    expect(queryTerms('  宝箱  Chest chest "x"')).toEqual(['宝箱', 'chest', 'x'])
    expect(findRanges('Chest chest', ['chest'])).toEqual([[0, 5], [6, 11]])
    expect(findRanges('abcabc', ['abc', 'bca'])).toEqual([[0, 6]])
  })
  it('cuts a window around the first hit and marks the cuts', () => {
    const text = 'x'.repeat(100) + ' the brass lid ' + 'y'.repeat(100)
    const s = makeSnippet(text, ['brass'], 40)!
    expect(s.text.startsWith('…')).toBe(true)
    expect(s.text.endsWith('…')).toBe(true)
    const [a, b] = s.ranges[0]!
    expect(s.text.slice(a, b)).toBe('brass')
    expect(makeSnippet('nothing here', ['zzz'])).toBeNull()
  })
})
