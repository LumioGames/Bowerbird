/**
 * Review fixes: full file names (with extension) match at the highest weight and an exact name wins; text is
 * folded (NFKC + lower case) on both the index and the query side; highlight ranges point into the original
 * text even when folding changes lengths; one library's deactivation does not break another's index.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext } from '@bowerbird/plugin-sdk/testing'
import { fold } from './snippet.js'
import { KeywordIndex } from './store.js'
import plugin from './server.js'
import { doc } from './__tests__/docs.js'

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
let dir: string, idx: KeywordIndex
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-kw-names-')); idx = new KeywordIndex(path.join(dir, 'k.sqlite')) })
afterEach(() => { idx.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('full file names', () => {
  beforeEach(() => {
    idx.index([
      doc(1, { name: 'chest.glb', description: '新手村第一个能打开的宝箱，开箱动画在 chest_open_preview.mp4。' }),
      doc(2, { name: 'changelog.txt', format: 'doc', text: '2026-11-24 user:lin chest.glb 修正包边比例\n2026-11-21 agent:modeler chest.glb 初版\nchest.md 写好了' }),
      doc(3, { name: 'chest_open_preview.mp4', format: 'video' }),
      doc(4, { name: 'chest.md', format: 'doc', text: '宝箱' }),
      doc(5, { name: 'chest_basecolor.png' })
    ])
  })
  it('chest.glb → the asset named chest.glb first', () => {
    const hits = idx.query('chest.glb', { limit: 10 }).map(h => h.id)
    expect(hits[0]).toBe(id(1))
    expect(hits).toContain(id(2))
  })
  it('chest_open_preview.mp4 → the video first, then what mentions it', () => {
    expect(idx.query('chest_open_preview.mp4', { limit: 10 }).map(h => h.id)).toEqual([id(3), id(1)])
  })
  it('chest.md → found by its full name', () => {
    expect(idx.query('chest.md', { limit: 10 }).map(h => h.id)[0]).toBe(id(4))
  })
  it('a name hit comes without a snippet, a body hit with one', () => {
    const hits = idx.query('chest.glb', { limit: 10 })
    expect(hits.find(h => h.id === id(1))!.snippet).toBeUndefined()
    expect(hits.find(h => h.id === id(2))!.snippet!.field).toBe('text')
  })
})

describe('folding (NFKC + lower case) on both sides', () => {
  it('matches full-width and ligature forms either way', () => {
    idx.index([doc(1, { description: 'ＴＲＥＡＳＵＲＥ 宝箱' }), doc(2, { description: 'the ﬁle cabinet' }), doc(3, { description: 'plain treasure' })])
    expect(idx.query('treasure', { limit: 5 }).map(h => h.id).sort()).toEqual([id(1), id(3)])
    expect(idx.query('ｔｒｅａｓｕｒｅ', { limit: 5 }).map(h => h.id).sort()).toEqual([id(1), id(3)])
    expect(idx.query('file', { limit: 5 }).map(h => h.id)).toEqual([id(2)])
    expect(idx.query('宝箱', { limit: 5 }).map(h => h.id)).toEqual([id(1)])
  })
  it('highlights the original text of the hit, also after characters whose folding changes length', () => {
    idx.index([doc(1, { description: 'İİİ ﬃ ＴＲＥＡＳＵＲＥ chest' }), doc(2, { prompts: ['ǅ ǅ the ﬁle is here'] })])
    for (const [q, n] of [['treasure', 1], ['file', 2]] as const) {
      const h = idx.query(q, { limit: 5 }).find(x => x.id === id(n))!
      expect(h.snippet).toBeDefined()
      for (const [a, b] of h.snippet!.ranges) expect(fold(h.snippet!.text.slice(a, b))).toBe(q)
    }
  })
})

describe('snippet windows', () => {
  it('never cut a highlighted word at the edge of the window', () => {
    for (let pad = 0; pad < 70; pad += 3) {
      idx.index([doc(1, { text: 'x'.repeat(10) + ' chest.glb ' + 'y'.repeat(pad) + ' chest.glb ' + 'z'.repeat(200) })])
      const h = idx.query('chest.glb', { limit: 5, candidates: { has: () => true, size: 1, [Symbol.iterator]: () => [id(1)][Symbol.iterator]() } })[0]!
      for (const [a, b] of h.snippet!.ranges) expect(h.snippet!.text.slice(a, b)).toBe('chest.glb')
    }
  })
})

describe('several libraries', () => {
  it('deactivating the plugin does not leave another library with a closed index', async () => {
    const a = createTestContext({ pluginId: 'bowerbird.search-keyword' }), b = createTestContext({ pluginId: 'bowerbird.search-keyword' })
    await plugin.activate(a)
    await plugin.activate(b)
    const pa = a.registered.searchProviders[0]!, pb = b.registered.searchProviders[0]!
    await pa.index([doc(1, { description: 'alpha text' })])
    await pb.index([doc(2, { description: 'beta text' })])
    await plugin.deactivate!()
    expect((await pb.query('beta', { limit: 5 })).map(h => h.id)).toEqual([id(2)])
    expect((await pa.query('alpha', { limit: 5 })).map(h => h.id)).toEqual([id(1)])
    await plugin.deactivate!()
  })
})
