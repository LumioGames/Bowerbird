import type { AssetSummary, Lineage, LineageEdge, Provenance, RelationView } from '@bowerbird/schema'

/**
 * The relation graph's model (web-shell.md 关系图): centred on one asset, left to right in production order.
 * Upstream `source` and `reference` relations (what an asset was made from, ADR-073) are traced to the top; downstream
 * opens `down` levels (default two) and grows on demand; only the chain the centre sits on is followed. Around the
 * centre only: what it uses (left), what uses it (right), its design object (above) and the assets belonging to it
 * (right). Downstream siblings made in one run (same `provenance.batch`, ADR-070) fold into a group when there are
 * more than 4; members of a design object when more than 6.
 * Pure: no React, no fetching — RelationGraph feeds it the lineages and the centre's relations.
 */

export const GROUP_SIBLINGS = 4
export const GROUP_MEMBERS = 6

export interface GraphInput {
  center: AssetSummary
  /** Lineage up, types [source, reference], deep enough to reach the top. */
  up?: Pick<Lineage, 'nodes' | 'edges' | 'missing' | 'provenance'> | null
  /** Lineage down, types [source, reference], depth = opts.down + 1 (one level more, to know what can still be opened). */
  down?: Pick<Lineage, 'nodes' | 'edges' | 'missing' | 'provenance'> | null
  /** The centre's own relations (all types, both directions). */
  relations: { outgoing: RelationView[]; incoming: RelationView[] }
  /** The centre's own provenance (also in the lineages; given here so the graph does not wait for them). */
  provenance?: Provenance | null
}
export interface GraphOpts { down: number; open: Record<string, boolean> }

/** The relation an edge stands for, in storage terms: `from` depends on `to`. */
export interface RelRef { type: string; from: string; to: string; slot?: string; note?: string; role?: string }

/** Relation types that say what an asset was made from: laid out as the production chain (ADR-073). */
export const isUpstreamType = (type: string): boolean => type === 'source' || type === 'reference'

export type Lane = 'main' | 'uses' | 'top'
export interface GNode {
  key: string
  kind: 'asset' | 'missing' | 'rec' | 'group' | 'frame'
  asset?: AssetSummary
  /** missing: last known name and whether it waits in the trash. */
  name?: string
  inTrash?: boolean
  /** rec: how the asset `recOf` was made, shown where its upstream would be (it was made from no asset). */
  rec?: Provenance
  recOf?: string
  items?: AssetSummary[]
  members?: boolean
  gkey?: string
  col: number
  lane: Lane
  center?: boolean
  /** Second line under the name (how it was made, or the relation's note). */
  sub?: string
  /** Downstream levels not shown yet: how many children wait behind「+N」. */
  more?: number
  x: number; y: number; w: number; h: number; spine: boolean
}
export interface GEdge {
  key: string
  type: string
  /** Node keys, drawn from → to (left to right / centre to design object). */
  from: string
  to: string
  rel?: RelRef
  broken: boolean
  stale: boolean
  /** Provenance edge (provenance node → the asset it made) or a grouped edge with the batch's provenance. */
  recNode?: Provenance
  rec?: Provenance
  /** The asset whose provenance `recNode` / `rec` is (a group: its first member). */
  recOf?: string
  group?: boolean
  items?: AssetSummary[]
  vertical?: boolean
  d: string; mx: number; my: number; y1: number; y2: number; spine: boolean
}
export interface Graph { nodes: Map<string, GNode>; order: string[]; edges: GEdge[]; bounds: { x0: number; y0: number; x1: number; y1: number } }

export const METHOD_KEYS: Record<string, string> = {
  'ai-generate': 'w2.method.ai-generate', manual: 'w2.method.manual', slice: 'w2.method.slice', render: 'w2.method.render',
  export: 'w2.method.export', convert: 'w2.method.convert', copy: 'w2.method.copy', other: 'w2.method.other'
}

type Tr = (key: string, p?: Record<string, string | number>) => string

const edgeKey = (type: string, from: string, to: string, slot?: string) => `${type}|${from}|${to}|${slot ?? ''}`

export function methodLabel(method: string, tr: Tr): string { return METHOD_KEYS[method] ? tr(METHOD_KEYS[method]!) : method }

/** Second line for an upstream edge: how the downstream asset was made and by whom (its provenance), else the type. */
export function sourceSub(prov: Provenance | undefined, tr: Tr, type = 'source'): string {
  return prov ? `${methodLabel(prov.method, tr)} · ${prov.by}` : tr(type === 'reference' ? 'w2.rel.type.reference' : 'w2.rel.type.source')
}
/** Second line for a uses edge: the note and the slot written in the file (ADR-018). */
/** Under a used asset's node: what it is for — the relation's note (「基础色」, graph.js), else its slot; the full
 *  position name「基础色 · chest_basecolor.png」is in the relation panel. */
export function usesSub(note: string | undefined, slot: string | undefined, _tr: Tr): string {
  return note || slot || ''
}

export function buildGraph(input: GraphInput, opts: GraphOpts, tr: Tr): Graph {
  const nodes = new Map<string, GNode>()
  const order: string[] = []
  const edges: GEdge[] = []
  const seenE = new Set<string>()
  const provs: Record<string, Provenance> = { ...(input.up?.provenance ?? {}), ...(input.down?.provenance ?? {}) }
  if (input.provenance) provs[input.center.id] = input.provenance
  const upNodes = new Map((input.up?.nodes ?? []).map(n => [n.id, n]))
  const downNodes = new Map((input.down?.nodes ?? []).map(n => [n.id, n]))
  const missing = new Map([...(input.up?.missing ?? []), ...(input.down?.missing ?? [])].map(m => [m.id, m]))
  const centerId = input.center.id

  const add = (n: Omit<GNode, 'x' | 'y' | 'w' | 'h' | 'spine'>): GNode => {
    const ex = nodes.get(n.key)
    if (ex) return ex
    const full = { ...n, x: 0, y: 0, w: 0, h: 0, spine: false } as GNode
    nodes.set(n.key, full); order.push(n.key)
    return full
  }
  const link = (e: Omit<GEdge, 'd' | 'mx' | 'my' | 'y1' | 'y2' | 'spine' | 'key'> & { key?: string }) => {
    const key = e.key ?? (e.rel ? edgeKey(e.rel.type, e.rel.from, e.rel.to, e.rel.slot) : `${e.type}|${e.from}>${e.to}`)
    if (seenE.has(key)) return
    seenE.add(key)
    edges.push({ ...e, key, d: '', mx: 0, my: 0, y1: 0, y2: 0, spine: false })
  }
  const relOf = (e: LineageEdge): RelRef => ({ type: e.type, from: e.from, to: e.to, slot: e.slot, note: e.note, role: e.role })

  add({ key: centerId, kind: 'asset', asset: input.center, col: 0, lane: 'main', center: true })

  /* upstream: every source and reference, to the top; a node reached by several paths sits left of all of them */
  const upEdges = (input.up?.edges ?? []).filter(e => isUpstreamType(e.type))
  const climb = (a: string, d: number, guard: number) => {
    if (guard > 60) return
    for (const e of upEdges) {
      if (e.from !== a) continue
      const t = e.broken ? null : upNodes.get(e.to) ?? null
      if (!t) {
        const m = missing.get(e.to)
        const mk = add({ key: `miss:${e.from}:${e.to}`, kind: 'missing', name: m?.name ?? e.to, inTrash: !!m?.inTrash, col: -(d + 1), lane: 'main' })
        link({ type: e.type, from: mk.key, to: a, rel: relOf(e), broken: true, stale: false })
        continue
      }
      const n = add({ key: t.id, kind: 'asset', asset: t, col: -(d + 1), lane: 'main', sub: sourceSub(provs[e.from], tr, e.type) })
      n.col = Math.min(n.col, -(d + 1))
      /* a reference never tracks the other side's version (ADR-073): never「上游已更新」 */
      link({ type: e.type, from: t.id, to: a, rel: relOf(e), broken: false, stale: e.type === 'source' && e.stale })
      climb(t.id, d + 1, guard + 1)
    }
    /* how an asset made from no other asset came to be (its provenance) sits where its upstream would be */
    const prov = provs[a]
    if (prov && !upEdges.some(e => e.from === a)) {
      const rk = add({ key: `rec:${a}`, kind: 'rec', rec: prov, recOf: a, col: -(d + 1), lane: 'main' })
      link({ key: `origin|${a}`, type: 'source', from: rk.key, to: a, recNode: prov, recOf: a, broken: false, stale: false })
    }
  }
  climb(centerId, 0, 0)

  /* downstream: opens on demand; siblings made in one run (same batch) fold into a group */
  const downEdges = (input.down?.edges ?? []).filter(e => isUpstreamType(e.type) && !e.broken)
  const descend = (a: string, d: number) => {
    const kids = downEdges.filter(e => e.to === a).map(e => ({ e, a: downNodes.get(e.from) })).filter((k): k is { e: LineageEdge; a: AssetSummary } => !!k.a && !nodes.has(k.a.id))
    if (!kids.length) return
    if (d >= opts.down) { const n = nodes.get(a); if (n) n.more = kids.length; return }
    const byBatch = new Map<string, typeof kids>()
    for (const k of kids) { const b = provs[k.a.id]?.batch ?? `_${k.e.from}`; byBatch.set(b, [...(byBatch.get(b) ?? []), k]) }
    for (const [b, ks] of byBatch) {
      if (ks.length > GROUP_SIBLINGS) {
        const gk = `g:${a}:${b}`
        const open = !!opts.open[gk]
        const first = ks[0]!.a.id
        const type = ks.every(k => k.e.type === 'reference') ? 'reference' : 'source'
        add({ key: gk, gkey: gk, kind: open ? 'frame' : 'group', items: ks.map(k => k.a), rec: provs[first], recOf: first, col: d + 1, lane: 'main' })
        link({ key: `grp|${gk}`, type, from: a, to: gk, group: true, rec: provs[first], recOf: first, items: ks.map(k => k.a), broken: false, stale: ks.some(k => k.e.type === 'source' && k.e.stale) })
        continue
      }
      for (const k of ks) {
        add({ key: k.a.id, kind: 'asset', asset: k.a, col: d + 1, lane: 'main', sub: sourceSub(provs[k.a.id], tr, k.e.type) })
        link({ type: k.e.type, from: a, to: k.a.id, rel: relOf(k.e), broken: false, stale: k.e.type === 'source' && k.e.stale })
        descend(k.a.id, d + 1)
      }
    }
  }
  descend(centerId, 0)

  /* around the centre: what it uses (left), what uses it (right), its design object (above) */
  const rv = (r: RelationView): RelRef => ({ type: r.type, from: r.from, to: r.to, slot: r.slot, note: r.note, role: r.role })
  for (const r of input.relations.outgoing) {
    if (isUpstreamType(r.type)) continue
    if (r.type === 'belongs') {
      if (!r.target) continue
      const o = r.target
      const b = nodes.get(o.id) ?? add({ key: o.id, kind: 'asset', asset: o, col: 0, lane: 'top', sub: tr('rel.designObject') })
      link({ type: 'belongs', from: centerId, to: b.key, rel: rv(r), broken: false, stale: false, vertical: b.lane === 'top' })
      continue
    }
    /* uses and plugin relation types */
    if (!r.target || r.broken) {
      const mk = add({ key: `miss:${centerId}:${r.to}:${r.slot ?? ''}`, kind: 'missing', name: r.targetName ?? r.to, inTrash: r.targetInTrash, col: -1, lane: 'uses' })
      link({ type: r.type, from: mk.key, to: centerId, rel: rv(r), broken: true, stale: false })
      continue
    }
    const n = nodes.get(r.target.id) ?? add({ key: r.target.id, kind: 'asset', asset: r.target, col: -1, lane: 'uses', sub: usesSub(r.note, r.slot, tr) })
    link({ type: r.type, from: n.key, to: centerId, rel: rv(r), broken: false, stale: r.stale })
  }
  const members: RelationView[] = []
  for (const r of input.relations.incoming) {
    if (isUpstreamType(r.type) || !r.target) continue
    if (r.type === 'belongs') { if (!nodes.has(r.target.id)) members.push(r); continue }
    const m = nodes.get(r.target.id) ?? add({ key: r.target.id, kind: 'asset', asset: r.target, col: 1, lane: 'uses', sub: usesSub(r.note, r.slot, tr) })
    link({ type: r.type, from: centerId, to: m.key, rel: rv(r), broken: false, stale: false })
  }
  if (members.length > GROUP_MEMBERS) {
    const mk = `m:${centerId}`
    const open = !!opts.open[mk]
    const items = members.map(r => r.target!)
    add({ key: mk, gkey: mk, kind: open ? 'frame' : 'group', items, members: true, col: 1, lane: 'uses' })
    link({ key: `grp|${mk}`, type: 'belongs', from: centerId, to: mk, group: true, items, broken: false, stale: false })
  } else {
    for (const r of members) {
      add({ key: r.target!.id, kind: 'asset', asset: r.target!, col: 1, lane: 'uses', sub: tr('rel.belongsIn') })
      link({ type: 'belongs', from: centerId, to: r.target!.id, rel: rv(r), broken: false, stale: false })
    }
  }
  const g: Graph = { nodes, order, edges, bounds: { x0: 0, y0: 0, x1: 0, y1: 0 } }
  layoutGraph(g, centerId)
  return g
}

/* ───────────── layout ───────────── */

export const SIZE = { asset: [144, 150], center: [188, 194], rec: [168, 60] } as const
export const GAP = 84
const VG = 18
const MINI = 76

function frameSize(n: number): [number, number] {
  const rows = Math.ceil(n / 3)
  return [3 * MINI + 2 * 8 + 20, 40 + rows * (MINI * 0.74 + 24) - 6 + 10]
}

/** Columns left to right; the lineage spine on one line; edge ends fanned by where they come from. */
export function layoutGraph(G: Graph, centerId: string): void {
  const N = G.nodes
  const spine = new Set([centerId])
  let cur = centerId
  for (let i = 0; i < 60; i++) {
    const e = G.edges.find(x => isUpstreamType(x.type) && x.to === cur && N.get(x.from)?.lane === 'main')
    if (!e) break
    cur = e.from; spine.add(cur)
  }
  cur = centerId
  for (let i = 0; i < 60; i++) {
    const e = G.edges.find(x => isUpstreamType(x.type) && x.from === cur && N.get(x.to)?.lane === 'main')
    if (!e) break
    cur = e.to; spine.add(cur)
  }
  const cols = new Map<number, GNode[]>()
  for (const k of G.order) {
    const n = N.get(k)!
    const s: readonly [number, number] = n.kind === 'frame' ? frameSize(n.items!.length) : n.center ? SIZE.center : n.kind === 'rec' ? SIZE.rec : SIZE.asset
    n.w = s[0]; n.h = s[1]; n.spine = spine.has(k)
    cols.set(n.col, [...(cols.get(n.col) ?? []), n])
  }
  const keys = [...cols.keys()].sort((a, b) => a - b)
  const cw = new Map<number, number>()
  for (const c of keys) cw.set(c, Math.max(0, ...cols.get(c)!.filter(n => n.lane !== 'top').map(n => n.w)))
  const cx = new Map<number, number>([[0, 0]])
  const W0 = SIZE.asset[0]
  for (let c = 1; c <= keys[keys.length - 1]!; c++) cx.set(c, cx.get(c - 1)! + (cw.get(c - 1) || 0) / 2 + GAP + (cw.get(c) || W0) / 2)
  for (let c = -1; c >= keys[0]!; c--) cx.set(c, cx.get(c + 1)! - (cw.get(c + 1) || 0) / 2 - GAP - (cw.get(c) || W0) / 2)
  const hasIssue = (n: GNode) => (n.asset?.issueLevel ? 1 : 0)
  const centerH = N.get(centerId)!.h
  for (const c of keys) {
    const list = cols.get(c)!.filter(n => n.lane !== 'top')
    list.sort((a, b) => (Number(b.spine) - Number(a.spine)) || (Number(a.lane === 'uses') - Number(b.lane === 'uses')) || (hasIssue(b) - hasIssue(a)))
    let y: number | null = null
    let lastLane: Lane | null = null
    for (const n of list) {
      if (y === null) { n.y = 0; y = n.h / 2 } else { y += VG + (lastLane !== n.lane ? 22 : 0); n.y = y + n.h / 2; y = n.y + n.h / 2 }
      n.x = cx.get(c)!; lastLane = n.lane
    }
    for (const n of cols.get(c)!.filter(n => n.lane === 'top')) { n.x = cx.get(c)!; n.y = -(centerH / 2 + 64 + n.h / 2) }
  }
  /* fan the ends of several edges on one side of a node, ordered by where they come from */
  const ins = new Map<string, GEdge[]>(), outs = new Map<string, GEdge[]>()
  for (const e of G.edges) {
    if (e.vertical) continue
    outs.set(e.from, [...(outs.get(e.from) ?? []), e]); ins.set(e.to, [...(ins.get(e.to) ?? []), e])
  }
  const fan = (map: Map<string, GEdge[]>, key: 'y1' | 'y2', side: 'from' | 'to') => {
    for (const [k, list] of map) {
      const n = N.get(k)!
      list.sort((a, b) => N.get(a[side])!.y - N.get(b[side])!.y)
      const m = list.length
      const step = Math.min(14, (n.h * 0.5) / Math.max(1, m - 1))
      list.forEach((e, i) => { e[key] = n.y + (i - (m - 1) / 2) * step })
    }
  }
  fan(outs, 'y1', 'to'); fan(ins, 'y2', 'from')
  for (const e of G.edges) {
    const f = N.get(e.from)!, t = N.get(e.to)!
    if (e.vertical) {
      const y1 = f.y - f.h / 2, y2 = t.y + t.h / 2
      e.d = `M${f.x} ${y1} C${f.x} ${y1 - 36} ${t.x} ${y2 + 36} ${t.x} ${y2}`
      e.mx = (f.x + t.x) / 2; e.my = (y1 + y2) / 2
      continue
    }
    const x1 = f.x + f.w / 2, x2 = t.x - t.w / 2, y1 = e.y1, y2 = e.y2, dx = Math.max(36, (x2 - x1) / 2)
    e.d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
    e.mx = (x1 + 3 * (x1 + dx) + 3 * (x2 - dx) + x2) / 8
    e.my = (y1 + 3 * y1 + 3 * y2 + y2) / 8
    e.spine = f.spine && t.spine
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const k of G.order) {
    const n = N.get(k)!
    x0 = Math.min(x0, n.x - n.w / 2); x1 = Math.max(x1, n.x + n.w / 2); y0 = Math.min(y0, n.y - n.h / 2); y1 = Math.max(y1, n.y + n.h / 2)
  }
  G.bounds = { x0, y0, x1, y1 }
}

/* ───────────── rules ───────────── */

/**
 * Adding「from 由 to 产出」(from → to, source) closes a loop when `to` already comes from `from`. Returns the chain
 * from → … → to in production order (for the explanation), or null. Only `source` is checked (data-model.md: 引用和归属不做环检查).
 */
export function cyclePath(sourceEdges: Array<Pick<RelRef, 'from' | 'to'>>, from: string, to: string): string[] | null {
  if (from === to) return [from]
  const prev = new Map<string, string>()
  const seen = new Set([to])
  const q = [to]
  while (q.length) {
    const id = q.shift()!
    if (id === from) {
      const path = [id]
      let x = id
      while (prev.has(x)) { x = prev.get(x)!; path.push(x) }
      return path
    }
    for (const e of sourceEdges) if (e.from === id && !seen.has(e.to)) { seen.add(e.to); prev.set(e.to, id); q.push(e.to) }
  }
  return null
}

/** Asset ids of the graph in reading order (left to right, top to bottom): quick look's ← / → walk this. */
export function readingOrder(G: Graph): string[] {
  const out: Array<{ id: string; x: number; y: number }> = []
  for (const k of G.order) {
    const n = G.nodes.get(k)!
    if (n.kind === 'asset' && n.asset) out.push({ id: n.asset.id, x: n.x, y: n.y })
    if (n.kind === 'frame' && n.items) n.items.forEach((a, i) => out.push({ id: a.id, x: n.x, y: n.y + i }))
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y)
  return [...new Set(out.map(o => o.id))]
}
