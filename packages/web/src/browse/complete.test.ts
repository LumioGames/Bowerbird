import { describe, expect, it } from 'vitest'
import type { Vocabulary } from '@bowerbird/schema'
import { applyCompletion, complete } from './complete'

const vocabulary = {
  stages: [], reviews: [], relationTypes: [], templates: [],
  formats: [{ id: 'model', displayName: '模型', plugin: 'bowerbird.model', count: 3 }, { id: 'image', displayName: '图片', plugin: 'bowerbird.image', count: 9 }],
  tags: [{ name: '宝箱', count: 12 }, { name: '道具', count: 40 }],
  methods: [{ id: 'community.forge/model', count: 1 }],
  actors: [{ id: 'agent:modeler', count: 3 }],
  designObjects: [{ id: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d201', name: 'chest.md', title: '宝箱' }]
} as Vocabulary

describe('search syntax completion', () => {
  it('offers keys with their Chinese meaning', () => {
    const r = complete('st', 2, { vocabulary })
    expect(r.items[0]).toMatchObject({ insert: 'stage:', detail: '物料阶段', done: false })
  })

  it('finds a key by its meaning', () => {
    const r = complete('面数', 2, { vocabulary })
    expect(r.items.map(i => i.insert)).toContain('tris:')
  })

  it('offers values from the library after key:', () => {
    expect(complete('format:', 7, { vocabulary }).items.map(i => i.label)).toEqual(['model', 'image'])
    expect(complete('tag:宝', 5, { vocabulary }).items.map(i => i.insert)).toEqual(['tag:宝箱'])
    expect(complete('belongs:', 8, { vocabulary }).items[0]).toMatchObject({ label: 'chest', detail: '宝箱' })
    expect(complete('method:comm', 11, { vocabulary }).items[0]!.label).toBe('community.forge/model')
    expect(complete('folder:pr', 9, { folders: ['props', 'props/chest'] }).items[0]).toMatchObject({ insert: 'folder:props/', done: false })
  })

  it('a finished value is inserted with a space so it becomes a chip', () => {
    const r = complete('chest format:mo', 15, { vocabulary })
    const out = applyCompletion('chest format:mo', r.items[0]!, r.start, r.end)
    expect(out.text).toBe('chest format:model ')
    expect(out.caret).toBe(out.text.length)
  })

  it('a key is inserted without a space so values follow', () => {
    const r = complete('rev', 3, { vocabulary })
    const out = applyCompletion('rev', r.items[0]!, r.start, r.end)
    expect(out.text).toBe('review:')
  })

  it('nothing for an empty word', () => {
    expect(complete('chest ', 6, { vocabulary }).items).toEqual([])
  })
})
