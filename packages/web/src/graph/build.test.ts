import { describe, expect, it } from 'vitest'
import type { LineageEdge, ProductionRecord } from '@bowerbird/schema'
import { buildGraph, cyclePath, readingOrder, GROUP_MEMBERS, GROUP_SIBLINGS, type GraphInput } from './build'
import { gid, lineage, relation, summary } from '../pages/shared/test/fake'

const tr = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${JSON.stringify(p)}` : k)
const src = (from: string, to: string, o: Partial<LineageEdge> = {}): LineageEdge => ({ type: 'source', from, to, broken: false, stale: false, ...o })
const rec = (id: string, method = 'manual'): ProductionRecord => ({ id, method, by: 'agent:slicer', at: '2026-11-20T08:00:00.000Z' })

/* the chest chain from the prototype: concept → turnaround → high.blend → chest.glb → icon → icon_small → icon_tiny */
const C = summary({ id: gid(1), name: 'chest_concept.png' })
const T = summary({ id: gid(2), name: 'chest_turnaround.png' })
const B = summary({ id: gid(3), name: 'chest_high.blend', format: 'unknown' })
const G = summary({ id: gid(4), name: 'chest.glb', format: 'model' })
const I1 = summary({ id: gid(5), name: 'chest_icon.png' })
const I2 = summary({ id: gid(6), name: 'chest_icon_small.png' })
const I3 = summary({ id: gid(7), name: 'chest_icon_tiny.png' })

const chain = (): GraphInput => ({
  center: G,
  up: lineage(G.id, [C, T, B], [src(G.id, B.id), src(B.id, T.id), src(T.id, C.id)]),
  down: lineage(G.id, [I1, I2, I3], [src(I1.id, G.id), src(I2.id, I1.id), src(I3.id, I2.id)]),
  relations: { outgoing: [], incoming: [] }
})

describe('relation graph model', () => {
  it('traces upstream to the top and places it to the left, in production order', () => {
    const g = buildGraph(chain(), { down: 2, open: {} }, tr)
    expect(g.nodes.get(C.id)!.col).toBe(-3)
    expect(g.nodes.get(T.id)!.col).toBe(-2)
    expect(g.nodes.get(B.id)!.col).toBe(-1)
    expect(g.nodes.get(G.id)!.center).toBe(true)
    const xs = [C, T, B, G].map(a => g.nodes.get(a.id)!.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    /* the whole spine sits on one line */
    expect(new Set([C, T, B, G].map(a => g.nodes.get(a.id)!.y)).size).toBe(1)
  })

  it('opens two downstream levels by default and counts what waits behind「+N」', () => {
    const g = buildGraph(chain(), { down: 2, open: {} }, tr)
    expect(g.nodes.get(I1.id)!.col).toBe(1)
    expect(g.nodes.get(I2.id)!.col).toBe(2)
    expect(g.nodes.has(I3.id)).toBe(false)
    expect(g.nodes.get(I2.id)!.more).toBe(1)
    const more = buildGraph(chain(), { down: 3, open: {} }, tr)
    expect(more.nodes.get(I3.id)!.col).toBe(3)
    expect(more.nodes.get(I2.id)!.more).toBeUndefined()
  })

  it('folds more than 4 siblings from one production record into a group, and opens it as a frame', () => {
    const r = rec('rec_slice', 'slice')
    const kids = (k: number) => Array.from({ length: k }, (_, i) => summary({ id: gid(100 + i), name: `btn_${i}.png` }))
    const input = (k: number): GraphInput => ({
      center: G, up: lineage(G.id, [], []),
      down: lineage(G.id, kids(k), kids(k).map(a => src(a.id, G.id, { record: r.id })), { records: { [r.id]: r } }),
      relations: { outgoing: [], incoming: [] }
    })
    const four = buildGraph(input(GROUP_SIBLINGS), { down: 2, open: {} }, tr)
    expect([...four.nodes.values()].filter(n => n.kind === 'asset').length).toBe(GROUP_SIBLINGS + 1)
    const five = buildGraph(input(GROUP_SIBLINGS + 1), { down: 2, open: {} }, tr)
    const grp = five.nodes.get(`g:${G.id}:rec_slice`)!
    expect(grp.kind).toBe('group')
    expect(grp.items).toHaveLength(5)
    expect(grp.rec?.method).toBe('slice')
    const open = buildGraph(input(5), { down: 2, open: { [`g:${G.id}:rec_slice`]: true } }, tr)
    expect(open.nodes.get(`g:${G.id}:rec_slice`)!.kind).toBe('frame')
  })

  it('groups more than 6 members of a design object', () => {
    const doc = summary({ id: gid(50), name: 'chest.md', format: 'doc', memberCount: 7 })
    const members = (k: number) => Array.from({ length: k }, (_, i) => summary({ id: gid(200 + i), name: `m${i}.png` }))
    const input = (k: number): GraphInput => ({
      center: doc, up: lineage(doc.id, [], []), down: lineage(doc.id, [], []),
      relations: { outgoing: [], incoming: members(k).map(m => relation({ type: 'belongs', from: m.id, to: doc.id, target: m })) }
    })
    expect(buildGraph(input(GROUP_MEMBERS), { down: 2, open: {} }, tr).nodes.has(`m:${doc.id}`)).toBe(false)
    const g = buildGraph(input(GROUP_MEMBERS + 1), { down: 2, open: {} }, tr)
    expect(g.nodes.get(`m:${doc.id}`)!.members).toBe(true)
    expect(g.nodes.get(`m:${doc.id}`)!.items).toHaveLength(7)
  })

  it('draws uses on the left, users on the right, the design object above; slots and broken links are kept', () => {
    const tex = summary({ id: gid(10), name: 'chest_basecolor.png' })
    const doc = summary({ id: gid(11), name: 'chest.md', format: 'doc' })
    const user = summary({ id: gid(12), name: 'shop.html', format: 'doc' })
    const input: GraphInput = {
      ...chain(),
      relations: {
        outgoing: [
          relation({ type: 'uses', from: G.id, to: tex.id, target: tex, slot: 'chest_basecolor.png', note: '基础色' }),
          relation({ type: 'uses', from: G.id, to: gid(13), targetName: 'chest_orm.png', broken: true, slot: 'chest_orm.png' }),
          relation({ type: 'belongs', from: G.id, to: doc.id, target: doc })
        ],
        incoming: [relation({ type: 'uses', from: user.id, to: G.id, target: user })]
      }
    }
    const g = buildGraph(input, { down: 2, open: {} }, tr)
    expect(g.nodes.get(tex.id)!.col).toBe(-1)
    expect(g.nodes.get(tex.id)!.sub).toBe('基础色') // the note, as graph.js; the full position name is in the panel
    expect(g.nodes.get(doc.id)!.lane).toBe('top')
    expect(g.nodes.get(user.id)!.col).toBe(1)
    const miss = [...g.nodes.values()].find(n => n.kind === 'missing')!
    expect(miss.name).toBe('chest_orm.png')
    expect(g.edges.find(e => e.from === miss.key)!.broken).toBe(true)
    expect(g.edges.find(e => e.to === doc.id)!.vertical).toBe(true)
  })

  it('puts a missing upstream on a placeholder and the record of an origin before the top', () => {
    const r = rec('rec_concept', 'ai-generate')
    const input: GraphInput = {
      center: T,
      up: lineage(T.id, [C], [src(T.id, C.id), src(T.id, gid(99), { broken: true })], { missing: [{ id: gid(99), name: 'old_concept.png', inTrash: true }] }),
      down: lineage(T.id, [], []),
      relations: { outgoing: [], incoming: [] },
      origins: { [C.id]: r }
    }
    const g = buildGraph(input, { down: 2, open: {} }, tr)
    const miss = g.nodes.get(`miss:${T.id}:${gid(99)}`)!
    expect(miss.kind).toBe('missing')
    expect(miss.inTrash).toBe(true)
    expect(g.nodes.get('rec:rec_concept')!.col).toBe(-2)
  })

  it('lists asset nodes left to right for quick look', () => {
    const g = buildGraph(chain(), { down: 2, open: {} }, tr)
    expect(readingOrder(g)).toEqual([C.id, T.id, B.id, G.id, I1.id, I2.id])
  })
})

describe('loops of source relations (循环关系阻止)', () => {
  const edges = [{ from: G.id, to: B.id }, { from: B.id, to: T.id }, { from: T.id, to: C.id }]
  it('stops「turnaround 由 chest.glb 产出」because chest.glb already comes from the turnaround', () => {
    expect(cyclePath(edges, T.id, G.id)).toEqual([T.id, B.id, G.id])
  })
  it('lets a relation through when there is no loop, and stops relating an asset to itself', () => {
    expect(cyclePath(edges, G.id, C.id)).toBeNull()
    expect(cyclePath(edges, G.id, G.id)).toEqual([G.id])
  })
})
