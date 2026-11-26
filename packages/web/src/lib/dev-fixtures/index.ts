/**
 * DEVELOPMENT ONLY — an in-memory stand-in for `bb serve`, so the shell can be built and looked at before the server
 * exists. Installed by App only when `import.meta.env.DEV` and `?fixtures` (or `?fixtures=100k`) are set; production
 * builds never import this module. It answers the endpoints the shell calls, close enough for development.
 */
import {
  parseQueryText, type AssetDetail, type AssetSummary, type EventType, type Filter, type FolderNode, type Issue, type LibraryInfo,
  type Query, type RelationView, type SmartView, type TrashItem
} from '@bowerbird/schema'
import { setApiFetch } from '../api'
import { setEventSourceFactory, type EventSourceLike } from '../events'
import { ago, FOLDER_META, guid, hash, NOW, SEEDS, thumbSvg, type Seed } from './data'

const LIB = 'xingluo'
const assets = new Map<string, AssetDetail>()
const trash: Array<TrashItem & { detail: AssetDetail }> = []
const views = new Map<string, Query>([
  ['本周新增', { q: 'when:week' }],
  ['运行时模型', { filter: { stage: ['runtime'], format: ['model'] } }],
  ['AI 生成待审', { filter: { review: ['pending'], method: ['ai-generate'] } }]
])
const extraFolders = new Set<string>()
const folderMeta = structuredClone(FOLDER_META)
let seq = 1000

/* ── building the sample assets ── */
function detailOf(s: Seed, n: number): AssetDetail {
  const id = guid(n)
  const modified = ago((s.modifiedAgo ?? ((n * 7) % 23)) + n / 24)
  const missing = s.state === 'missing'
  const thumbState: AssetDetail['thumbState'] = s.kind === 'doc' ? 'none' : s.kind === 'unknown' ? 'none' : s.state === 'waiting' ? 'render' : s.state === 'failed' ? 'failed' : 'ready'
  const flags: AssetDetail['flags'] = []
  if (s.issue === 'stale') flags.push('stale')
  if (s.issue === 'broken') flags.push('broken')
  if (missing) flags.push('missing')
  if (s.state === 'failed') flags.push('failed')
  const level = s.issue === 'stale' || s.issue === 'failed' || s.issue === 'plugin' ? 'warning' : s.issue ? 'error' : null
  const plugin = s.kind === 'unknown' ? null : `bowerbird.${s.kind}`
  const tech: Record<string, number | string | boolean> = {}
  if (s.w) { tech.width = s.w; tech.height = s.h! }
  if (s.tris) tech.triangles = s.tris
  if (s.dur) tech.duration = s.dur
  return {
    id, name: s.name, path: `${s.folder}/${s.name}`, format: s.kind, plugin, stage: s.stage ?? 'runtime', review: s.review ?? 'approved',
    tags: s.tags ?? [], autoTags: s.ai ?? [], description: s.desc ?? s.aiDesc ?? null, flags,
    thumbnail: thumbState === 'ready' || (missing && s.kind !== 'unknown') ? thumbSvg(s) : null, thumbState,
    aspect: s.kind === 'image' ? s.ar ?? (s.w && s.h ? s.w / s.h : 1) : s.kind === 'video' ? 16 / 9 : 1,
    badge: s.badge ?? null, issueLevel: level, issueCount: level ? 1 : 0, size: s.bytes ?? 40_000 + ((n * 7919) % 97) * 21_000,
    modified, created: ago((s.modifiedAgo ?? ((n * 7) % 23)) + ((n * 5) % 9) + 1), createdBy: s.by ?? 'user:mo',
    bundle: false, auxiliary: false, memberCount: 0,
    cellText: s.kind === 'doc' ? { title: s.title ?? s.name, excerpt: s.excerpt ?? '' } : null,
    missingPlugin: s.needs ? { id: 'community.spine', range: '^1.4', displayName: s.needs } : null,
    hash: `sha256:${hash(s.name).toString(16).padStart(8, '0')}${'0'.repeat(56)}`,
    descriptionFull: s.desc ?? null,
    auto: s.ai || s.aiDesc ? { tags: s.ai ?? [], description: s.aiDesc, by: 'bowerbird.enrich-demo@0.1.0' } : null,
    fields: {}, reviewVerdict: s.review === 'rejected' ? { status: 'rejected', by: 'user:lin', at: ago(1), note: '肩甲比例不对，参考原画再收窄一点' } : s.review === 'approved' ? { status: 'approved', by: 'user:lin', at: ago(3) } : null,
    versions: [{ hash: 'sha256:' + '1'.repeat(64), size: s.bytes ?? 100_000, at: ago(10), by: s.by ?? 'user:mo', note: '初版' }, ...(s.name === 'chest.glb' ? [{ hash: 'sha256:' + '2'.repeat(64), size: 1.2e6, at: ago(0.5), by: 'user:lin', note: '修正包边比例' }] : [])],
    views: s.grid ?? null, thumbnailManual: false, origin: null, modifiedBy: s.by ?? 'user:mo', tech, analysis: {}, unresolvedRefs: [], checks: [],
    relations: { outgoing: [], incoming: [] }, issues: [], record: s.prompt ? { id: 'rec_' + n, method: s.method ?? 'ai-generate', tool: 'Forge', prompt: s.prompt, params: { model: 'forge-xl 2.1', seed: 1337 }, by: s.by ?? 'agent:concept-artist', at: modified } : s.method ? { id: 'rec_' + n, method: s.method, tool: 'Bowerbird', by: s.by ?? 'user:mo', at: modified } : null,
    bundleFiles: null, targetSize: s.name === 'chest.md' ? { w: 1.26, h: 0.95, d: 0.87, from: id } : null,
    stages: s.state === 'failed' ? [{ stage: 'thumbnail', status: 'failed', error: '这台电脑的浏览器放不了这种视频（ProRes 4444）' }] : []
  }
}

function summary(a: AssetDetail): AssetSummary {
  const { hash: _h, descriptionFull: _d, auto: _a, fields: _f, reviewVerdict: _r, versions: _v, views: _vw, thumbnailManual: _t, origin: _o, modifiedBy: _m, tech: _te, analysis: _an, unresolvedRefs: _u, checks: _c, relations: _re, issues: _i, record: _rc, bundleFiles: _b, targetSize: _ts, stages: _s, ...rest } = a
  return rest
}

function byName(n: string): AssetDetail | undefined { for (const a of assets.values()) if (a.name === n) return a; return undefined }

function relView(type: string, from: AssetDetail, to: AssetDetail | null, o: Partial<RelationView> = {}, outgoing = true): RelationView {
  return { type, from: from.id, to: to?.id ?? o.to ?? guid(9999), target: to ? summary(outgoing ? to : from) : null, targetName: to?.name ?? o.targetName ?? null, targetInTrash: false, broken: !to, stale: false, ...o }
}
function link(type: string, fromN: string, toN: string, o: Partial<RelationView> = {}) {
  const f = byName(fromN), t = byName(toN)
  if (!f || !t) return
  f.relations.outgoing.push(relView(type, f, t, o))
  t.relations.incoming.push({ ...relView(type, f, t, o, false), target: summary(f) })
}

function seed(big: number) {
  assets.clear(); trash.length = 0
  SEEDS.forEach((s, i) => { const d = detailOf(s, i + 1); assets.set(d.id, d) })
  link('source', 'chest.glb', 'chest_concept.png', { record: 'rec_x' })
  link('source', 'chest.glb', 'chest_turnaround.png')
  link('uses', 'chest.glb', 'chest_basecolor.png', { slot: 'chest_basecolor.png', note: '基础色' })
  link('uses', 'chest.glb', 'chest_normal.png', { slot: 'chest_normal.png', note: '法线' })
  link('uses', 'chest.glb', 'chest_orm.png', { slot: 'chest_orm.png', note: 'ORM' })
  link('source', 'chest_icon.png', 'chest.glb', { stale: true, staleFrom: 1, staleTo: 2 })
  for (const n of ['chest_concept.png', 'chest_turnaround.png', 'chest.glb', 'chest_icon.png', 'chest_open.wav']) link('belongs', n, 'chest.md')
  const potion = byName('potion.glb')!
  potion.relations.outgoing.push(relView('uses', potion, null, { targetName: 'potion_basecolor.png', slot: 'potion_basecolor.png', note: '基础色', targetInTrash: true }))
  for (const a of assets.values()) a.issues = issuesOf(a)
  if (big) {
    for (let i = 0; i < big; i++) {
      const s: Seed = { name: `bench_${String(i).padStart(6, '0')}.png`, folder: `bench/${String(Math.floor(i / 1000)).padStart(3, '0')}`, kind: 'image', hue: (i * 37) % 360, ar: [1, 0.75, 1.33, 1.78][i % 4], badge: '1024×1024', w: 1024, h: 1024, tags: ['bench'], stage: (['reference', 'production', 'runtime'] as const)[i % 3] }
      const d = detailOf(s, 10_000 + i)
      assets.set(d.id, d)
    }
  }
}

function issuesOf(a: AssetDetail): Issue[] {
  const mk = (type: Issue['type'], level: Issue['level'], extra: Partial<Issue> = {}): Issue => ({ id: `${type}:${a.id}`, type, level, assetId: a.id, details: {}, foundAt: ago(1), ...extra })
  const out: Issue[] = []
  if (a.flags.includes('stale')) { const r = a.relations.outgoing.find(x => x.stale); out.push(mk('stale-upstream', 'warning', { relation: r ? { type: r.type, to: r.to } : undefined, details: { toName: r?.targetName, fromVersion: 1, toVersion: 2 } })) }
  if (a.flags.includes('broken')) { const r = a.relations.outgoing.find(x => x.broken); out.push(mk('broken-reference', 'error', { relation: r ? { type: r.type, to: r.to } : undefined, details: { toName: r?.targetName } })) }
  if (a.flags.includes('missing')) out.push(mk('missing-file', 'error', { path: a.path }))
  if (a.flags.includes('failed')) out.push(mk('pipeline-failed', 'warning', { details: { error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', retryable: false } }))
  if (a.missingPlugin) out.push(mk('plugin-missing', 'warning', { details: { plugin: a.missingPlugin.id, displayName: 'Spine', range: '^1.4' } }))
  if (a.name === 'btn_buy (1).png') out.push(mk('duplicate-guid', 'error'))
  return out
}

/* ── searching ── */
function textOf(a: AssetDetail): string { return [a.name, a.tags.join(' '), a.autoTags.join(' '), a.descriptionFull ?? '', a.auto?.description ?? '', a.cellText?.title ?? '', a.cellText?.excerpt ?? '', a.record?.prompt ?? '', a.path].join(' ').toLowerCase() }

function matches(a: AssetDetail, f: Filter, q: string): boolean {
  if (f.folder != null && f.folder !== '' && !(a.path.startsWith(f.folder.replace(/\/$/, '') + '/'))) return false
  if (f.stage?.length && !f.stage.includes(a.stage)) return false
  if (f.format?.length && !f.format.includes(a.format)) return false
  if (f.review?.length && !f.review.includes(a.review)) return false
  if (f.hasIssues && !(a.issueLevel === 'error' || a.issueLevel === 'warning')) return false
  if (f.issue?.length && !f.issue.some(i => a.issues.some(x => x.type === i))) return false
  if (f.untagged && (a.tags.length || a.autoTags.length)) return false
  if (f.ids && !f.ids.includes(a.id)) return false
  const all = f.humanTagsOnly ? a.tags : [...a.tags, ...a.autoTags]
  if (f.tags?.all?.length && !f.tags.all.every(t => all.includes(t))) return false
  if (f.tags?.any?.length && !f.tags.any.some(t => all.includes(t))) return false
  if (f.tags?.none?.length && f.tags.none.some(t => all.includes(t))) return false
  for (const [k, c] of Object.entries(f.tech ?? {})) {
    const v = a.tech[k]
    if (typeof v !== 'number') return false
    if (c.gte != null && v < c.gte) return false
    if (c.gt != null && v <= c.gt) return false
    if (c.lte != null && v > c.lte) return false
    if (c.lt != null && v >= c.lt) return false
    if (c.eq != null && v !== c.eq) return false
  }
  if (f.modified?.after && a.modified < f.modified.after) return false
  if (f.created?.after && a.created < f.created.after) return false
  if (f.by && !(f.by.includes(':') ? a.createdBy === f.by : a.createdBy.startsWith(f.by + ':'))) return false
  if (f.method?.length && !(a.record && f.method.includes(a.record.method))) return false
  if (f.relation?.type === 'belongs') {
    const to = f.relation.to
    if (!a.relations.outgoing.some(r => r.type === 'belongs' && (r.to === to || r.targetName?.replace(/\.[^.]+$/, '') === to))) return false
  }
  if (q) { const hay = textOf(a); if (q.toLowerCase().split(/\s+/).some(w => w && !hay.includes(w))) return false }
  return true
}

function hitOf(a: AssetDetail, q: string): AssetSummary['hit'] {
  const ws = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!ws.length || ws.every(w => a.name.toLowerCase().includes(w))) return undefined
  const src: Array<['prompt' | 'description' | 'text', string]> = [['prompt', a.record?.prompt ?? ''], ['description', a.descriptionFull ?? a.auto?.description ?? ''], ['text', a.cellText?.excerpt ?? '']]
  for (const [field, text] of src) {
    const lower = text.toLowerCase()
    const w = ws.find(x => lower.includes(x))
    if (!w) continue
    const i = lower.indexOf(w), from = Math.max(0, i - 8)
    const cut = (from ? '…' : '') + text.slice(from, from + 34) + (text.length > from + 34 ? '…' : '')
    const ranges: Array<[number, number]> = []
    for (const x of ws) { const j = cut.toLowerCase().indexOf(x); if (j >= 0) ranges.push([j, j + x.length]) }
    return { field, text: cut, ranges }
  }
  return undefined
}

function search(body: Query & { facets?: boolean }) {
  const parsed = parseQueryText(body.q ?? '')
  const f: Filter = { ...(body.filter ?? {}), ...parsed.filter }
  const q = parsed.q
  let list = [...assets.values()].filter(a => matches(a, f, q))
  const sort = body.sort ?? (q ? 'relevance' : 'modified'), dir = body.order === 'asc' ? 1 : body.order === 'desc' ? -1 : sort === 'name' || sort === 'format' ? 1 : -1
  const val = (a: AssetDetail): string | number => sort === 'name' ? a.name : sort === 'size' ? a.size : sort === 'created' ? a.created : sort === 'format' ? a.format : sort === 'relevance' ? (a.name.toLowerCase().includes(q.toLowerCase()) ? 2 : 1) : a.modified
  list.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir || (x.name < y.name ? -1 : 1) })
  const start = body.cursor ? Number(body.cursor) : 0, limit = body.limit ?? 100
  const page = list.slice(start, start + limit).map(a => ({ ...summary(a), ...(q ? { score: 1, hit: hitOf(a, q) } : {}) }))
  const facet = (key: (a: AssetDetail) => string[]) => { const m = new Map<string, number>(); for (const a of list) for (const v of key(a)) m.set(v, (m.get(v) ?? 0) + 1); return [...m].map(([value, count]) => ({ value, count })) }
  const res = { items: page, total: list.length, cursor: start + limit < list.length ? String(start + limit) : null, ...(body.facets ? { facets: { format: facet(a => [a.format]), stage: facet(a => [a.stage]), review: facet(a => [a.review]), tags: facet(a => a.tags) } } : {}) }
  list = []
  return res
}

/* ── folders, views, info ── */
function folderTree(): FolderNode {
  const root: FolderNode = { path: '', name: '', count: 0, modified: null, effectiveDefaults: { from: {} }, children: [] }
  const ensure = (path: string): FolderNode => {
    if (!path) return root
    const parent = ensure(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    let n = parent.children.find(c => c.path === path)
    if (!n) {
      const m = folderMeta[path] ?? {}
      n = { path, name: path.split('/').pop()!, count: 0, modified: null, ...(m.label ? { label: m.label } : {}), ...(m.icon ? { icon: m.icon } : {}), ...(m.description ? { description: m.description } : {}), ...(m.defaults ? { defaults: m.defaults } : {}), effectiveDefaults: { from: {} }, children: [] }
      parent.children.push(n)
    }
    return n
  }
  for (const p of extraFolders) ensure(p)
  for (const a of assets.values()) {
    const dir = a.path.slice(0, a.path.lastIndexOf('/'))
    let n: FolderNode | undefined = ensure(dir)
    const parts = dir.split('/')
    for (let i = parts.length; i >= 0; i--) { const node = ensure(parts.slice(0, i).join('/')); node.count++; if (!node.modified || a.modified > node.modified) node.modified = a.modified }
    n = undefined
  }
  const eff = (n: FolderNode, inh: FolderNode['effectiveDefaults']) => {
    const e = { ...inh, from: { ...inh.from } }
    const d = folderMeta[n.path]?.defaults
    if (d?.stage) { e.stage = d.stage; e.from.stage = n.path }
    if (d?.review) { e.review = d.review; e.from.review = n.path }
    if (d?.tags) { e.tags = d.tags; e.from.tags = n.path }
    n.effectiveDefaults = e
    n.children.sort((a, b) => a.name.localeCompare(b.name)).forEach(c => eff(c, e))
  }
  eff(root, { from: {} })
  return root
}

function viewsList(): SmartView[] {
  const count = (q: Query) => search({ ...q, limit: 1 }).total
  return [
    { name: 'all', builtin: true, query: {}, count: assets.size },
    ...[...views].map(([name, query]) => ({ name, builtin: false, query, count: count(query) }))
  ]
}

function info(): LibraryInfo {
  const list = [...assets.values()]
  return {
    id: LIB, name: '星落镇', root: '~/Art/星落镇', state: 'ready', formatVersion: 1,
    settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 },
    requiredPlugins: [{ id: 'community.spine', range: '^1.4', installed: false, enabled: false }],
    stats: { assets: list.length, bytes: list.reduce((s, a) => s + a.size, 0), issues: list.reduce((s, a) => s + a.issues.length, 0), issueAssets: list.filter(a => a.issues.length).length },
    counts: { all: list.length, untagged: list.filter(a => !a.tags.length && !a.autoTags.length).length, pending: list.filter(a => a.review === 'pending').length, issues: list.filter(a => a.issueLevel === 'error' || a.issueLevel === 'warning').length, trash: trash.length },
    isLocal: !sessionStorage.getItem('bowerbird.fixtures.remote'), versionStore: null, hasCreators: false, firstOpen: null,
    scan: { running: false, phase: 'idle', done: 0, total: 0 }, lanOpen: false, address: '127.0.0.1:7420'
  }
}

/* ── events ── */
const sources = new Set<{ ls: Map<string, Array<(ev: MessageEvent) => void>> }>()
function emit(type: EventType, data: unknown) {
  for (const s of sources) for (const l of s.ls.get(type) ?? []) l({ data: JSON.stringify(data) } as MessageEvent)
}
const touched = (id: string, fields: string[]) => emit('asset.updated', { id, fields })

/* ── router ── */
const json = (v: unknown, status = 200) => new Response(v === undefined ? null : JSON.stringify(v), { status: v === undefined ? 204 : status, headers: { 'content-type': 'application/json' } })
const fail = (code: string, message: string, status = 400) => json({ error: { code, message } }, status)

function refresh(a: AssetDetail) { a.issues = issuesOf(a); a.issueLevel = a.issues.some(i => i.level === 'error') ? 'error' : a.issues.some(i => i.level === 'warning') ? 'warning' : null; a.issueCount = a.issues.length; a.modified = new Date().toISOString() }

function copyName(dir: string, name: string): string {
  const i = name.lastIndexOf('.'), base = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : ''
  for (let n = 1; ; n++) { const c = `${base}_${n}${ext}`; if (![...assets.values()].some(a => a.path === `${dir}/${c}`)) return c }
}

async function handle(method: string, path: string, body: any, form: FormData | null): Promise<Response> {
  let m: RegExpMatchArray | null
  if (path === '/libraries' && method === 'GET') return json({ libraries: [{ id: LIB, name: '星落镇', root: '~/Art/星落镇', state: 'ready' }, { id: 'pixel', name: '像素小队', root: '~/Projects/pixel-squad/assets', state: 'ready' }], defaultId: LIB })
  if (path === '/plugins') return json({ plugins: ['image', 'video', 'audio', 'model', 'doc'].map(k => ({ id: `bowerbird.${k}`, packageName: `@bowerbird/plugin-${k}`, version: '0.1.0', displayName: k, builtin: true, status: 'enabled', contributes: ['formats'], formats: [{ id: k, displayName: k, extensions: [] }], hasWeb: false, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'builtin' })) })
  if (path === '/config') return json({ config: { host: '127.0.0.1', port: 7420, libraries: [], cacheDirs: {}, scanIntervalMinutes: 10, allowedOrigins: [], plugins: {}, installed: [] }, dataDir: '~/.bowerbird', restartRequired: false })
  if (!(m = /^\/libraries\/([^/]+)(\/.*)?$/.exec(path))) return fail('not_found', path, 404)
  if (m[1] !== LIB && m[1] !== 'pixel') return fail('not_found', 'library', 404)
  const p = m[2] ?? ''
  if (p === '' && method === 'GET') return json(m[1] === 'pixel' ? { ...info(), id: 'pixel', name: '像素小队', root: '~/Projects/pixel-squad/assets', counts: { all: 0, untagged: 0, pending: 0, issues: 0, trash: 0 } } : info())
  if (m[1] === 'pixel') return p === '/search' ? json({ items: [], total: 0, cursor: null }) : p === '/folders' ? json({ root: { path: '', name: '', count: 0, modified: null, effectiveDefaults: { from: {} }, children: [] } }) : p === '/views' ? json({ views: [] }) : p === '/jobs' ? json({ stages: [], waitingRender: 0, busy: 0, scan: info().scan, failed: [], creates: [], processing: [] }) : json({ formats: [], tags: [], methods: [], actors: [], designObjects: [], stages: [], reviews: [], relationTypes: [], templates: [] })
  if (p === '/search') return json(search(body ?? {}))
  if (p === '/folders' && method === 'GET') return json({ root: folderTree() })
  if (p === '/folders' && method === 'POST') { extraFolders.add(body.path); emit('folder.updated', { path: body.path }); return json({ root: folderTree() }) }
  if (p === '/folders' && method === 'PATCH') {
    const meta = (folderMeta[body.path] ??= {})
    for (const k of ['label', 'icon', 'description', 'defaults'] as const) if (k in body) { if (body[k] == null) delete meta[k]; else (meta as Record<string, unknown>)[k] = body[k] }
    if (body.rename) {
      const np = body.path.slice(0, body.path.length - body.path.split('/').pop().length) + body.rename
      for (const a of assets.values()) if (a.path.startsWith(body.path + '/')) a.path = np + a.path.slice(body.path.length)
      folderMeta[np] = meta; delete folderMeta[body.path]
    }
    emit('folder.updated', { path: body.path }); return json({ root: folderTree() })
  }
  if (p === '/folders' && method === 'DELETE') {
    const inside = [...assets.values()].filter(a => a.path.startsWith(body.path + '/'))
    for (const a of inside) trashOne(a, 'b1')
    extraFolders.delete(body.path)
    emit('folder.updated', { path: body.path }); emit('trash.updated', {}); return json({ trashed: inside.length, batch: 'b1' })
  }
  if (p === '/views' && method === 'GET') return json({ views: viewsList() })
  if ((m = /^\/views\/(.+)$/.exec(p))) {
    const name = decodeURIComponent(m[1]!)
    if (method === 'PUT') { if (body.rename) { views.delete(name); views.set(body.rename, body.query) } else views.set(name, body.query); emit('view.updated', { name }); return json({ views: viewsList() }) }
    if (method === 'DELETE') { views.delete(name); emit('view.updated', { name }); return json({ views: viewsList() }) }
  }
  if (p === '/vocabulary') {
    const list = [...assets.values()]
    const tags = new Map<string, number>(); for (const a of list) for (const t of a.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
    const fm = new Map<string, number>(); for (const a of list) fm.set(a.format, (fm.get(a.format) ?? 0) + 1)
    const names: Record<string, string> = { image: '图片', video: '视频', audio: '音频', model: '模型', doc: '文档', unknown: '其他' }
    return json({
      stages: [], reviews: [], formats: [...fm].map(([id, count]) => ({ id, displayName: names[id] ?? id, plugin: id === 'unknown' ? null : `bowerbird.${id}`, count })),
      relationTypes: [{ id: 'source', name: '来源', inverseName: '下游', tracksVersion: true, plugin: null }, { id: 'uses', name: '引用', inverseName: '被引用', tracksVersion: false, plugin: null }, { id: 'belongs', name: '归属', inverseName: '归属于它', tracksVersion: false, plugin: null }],
      tags: [...tags].map(([name, count]) => ({ name, count })), methods: [{ id: 'ai-generate', count: 3 }, { id: 'slice', count: 10 }],
      actors: [...new Set(list.map(a => a.createdBy))].map(id => ({ id, count: 1 })), templates: [],
      designObjects: list.filter(a => a.relations.incoming.some(r => r.type === 'belongs')).map(a => ({ id: a.id, name: a.name, title: a.cellText?.title }))
    })
  }
  if (p === '/jobs') {
    const processing = [...assets.values()].filter(a => a.flags.includes('processing')).map(a => ({ id: 'j' + a.id, kind: 'process', stage: 'thumbnail', assetId: a.id, assetName: a.name, status: 'running', progress: 0.4, attempts: 1, outputs: [], createdAt: a.modified, updatedAt: a.modified }))
    return json({ stages: [], waitingRender: [...assets.values()].filter(a => a.thumbState === 'render').length, busy: processing.length, scan: info().scan, failed: [], creates: [], processing })
  }
  if (p === '/creators') return json({ creators: [] })
  if (p === '/render/next') return json({ task: null })
  if (p === '/rescan' || p === '/rescan/stop' || p === '/init') return json(undefined)
  if (p === '/tags') return json({ tags: [], groups: [] })
  if (p === '/issues') { const all = [...assets.values()].flatMap(a => a.issues); return json({ issues: all, assets: {}, assetCount: new Set(all.map(i => i.assetId)).size, total: all.length }) }
  if ((m = /^\/issues\/([^/]+)\/resolve$/.exec(p))) {
    const id = decodeURIComponent(m[1]!); const a = [...assets.values()].find(x => x.issues.some(i => i.id === id))
    if (a) { a.flags = a.flags.filter(f => f === 'processing'); refresh(a); touched(a.id, ['issues']); emit('issue.resolved', { id, type: '', assetId: a.id }) }
    return json({ resolved: [id], failed: [] })
  }
  if (p === '/trash' && method === 'GET') return json({ items: trash.map(({ detail: _d, ...x }) => x), trashDays: 7 })
  if ((m = /^\/trash\/([^/]+)\/restore$/.exec(p))) {
    const i = trash.findIndex(x => x.id === m![1]); if (i < 0) return fail('not_found', 'trash', 404)
    const [it] = trash.splice(i, 1); assets.set(it!.detail.id, it!.detail); emit('asset.created', { id: it!.detail.id, path: it!.detail.path, by: 'user:unnamed' }); emit('trash.updated', {})
    return json({ asset: summary(it!.detail), renamedTo: null })
  }
  if ((m = /^\/trash\/([^/]+)$/.exec(p)) && method === 'DELETE') { const i = trash.findIndex(x => x.id === m![1]); if (i >= 0) trash.splice(i, 1); emit('trash.updated', {}); return json(undefined) }
  if (p === '/export/plan') { const files = (body.ids as string[]).map(id => assets.get(id)!).filter(Boolean).map(a => ({ path: body.layout === 'flat' ? a.name : a.path, size: a.size, assetId: a.id, dependency: false })); return json({ files, bytes: files.reduce((s, f) => s + f.size, 0), dependencies: 0, duplicateNames: false }) }
  if (p === '/export') return body.dir ? json({ written: body.ids.length, dir: body.dir, bytes: 0 }) : new Response(new Blob(['zip']), { status: 200 })
  if (p === '/records' && method === 'POST') { const id = 'rec_' + ++seq; return json({ id, record: { id, ...body, by: 'user:unnamed', at: new Date().toISOString() } }) }
  if ((m = /^\/records\/([^/]+)\/notes$/.exec(p))) return json({ record: { id: m[1], method: 'manual', by: 'user:unnamed', at: '' }, outputs: [] })
  if (p === '/assets/precheck') {
    const conflicts = (body.names as string[]).map(n => ({ n, a: [...assets.values()].find(a => a.path === (body.folder ? `${body.folder}/${n}` : n)) })).filter(x => x.a).map(x => ({ name: x.n, existing: summary(x.a!) }))
    return json({ conflicts })
  }
  if (p === '/assets' && method === 'POST') {
    const meta = JSON.parse(String(form?.get('meta') ?? '{}'))
    const file = form?.get('file') as File | null
    const name = meta.name ?? file?.name ?? 'file'
    const folder = meta.folder ?? ''
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    const kind: Seed['kind'] = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? 'image' : ['glb', 'gltf', 'fbx'].includes(ext) ? 'model' : ['wav', 'mp3', 'ogg'].includes(ext) ? 'audio' : ['mp4', 'mov', 'webm'].includes(ext) ? 'video' : ['md', 'txt', 'html', 'json'].includes(ext) ? 'doc' : 'unknown'
    const existing = [...assets.values()].find(a => a.path === `${folder}/${name}`)
    if (existing && meta.onConflict === 'skip') return json({ asset: null, skipped: true, recordId: null, newTags: [] })
    if (existing && meta.onConflict === 'replace') { existing.versions.push({ hash: existing.hash, size: file?.size ?? 0, at: new Date().toISOString(), by: 'user:unnamed' }); existing.review = 'pending'; refresh(existing); touched(existing.id, ['content']); return json({ asset: existing, skipped: false, recordId: null, newTags: [] }) }
    const finalName = existing ? copyName(folder, name) : name
    const d = detailOf({ name: finalName, folder, kind, stage: meta.stage, review: meta.review === 'exempt' ? 'exempt' : 'pending', tags: meta.tags, bytes: file?.size, state: kind === 'model' ? 'waiting' : undefined, title: finalName, excerpt: '' }, ++seq)
    d.modified = new Date().toISOString()
    if (kind === 'image' && file) { d.thumbnail = URL.createObjectURL(file) }
    assets.set(d.id, d)
    emit('asset.created', { id: d.id, path: d.path, by: 'user:unnamed' })
    return json({ asset: d, skipped: false, recordId: null, newTags: [] })
  }
  if (p === '/assets/batch') {
    const ids: string[] = body.ids ?? []
    for (const id of ids) {
      const a = assets.get(id); if (!a) continue
      const pt = body.patch
      if (pt.stage) a.stage = pt.stage
      if (pt.review) a.review = pt.review.status
      if (pt.tags) applyTags(a, pt.tags)
      if (pt.move) { const target = pt.move.folder; a.path = (target ? target + '/' : '') + a.name }
      if (pt.trash) { trashOne(a); continue }
      refresh(a); touched(a.id, Object.keys(pt))
    }
    if (body.patch.trash) emit('trash.updated', {})
    return json({ updated: ids, failed: [] })
  }
  if ((m = /^\/assets\/([^/]+)(\/.*)?$/.exec(p))) {
    const a = assets.get(m[1]!); const rest = m[2] ?? ''
    if (!a) return fail('not_found', 'asset', 404)
    if (rest === '' && method === 'GET') return json(a)
    if (rest === '' && method === 'PATCH') { if (body.tags) applyTags(a, body.tags); if ('description' in body) { a.descriptionFull = body.description || null; a.description = body.description || a.auto?.description || null } if (body.stage) a.stage = body.stage; refresh(a); touched(a.id, Object.keys(body)); return json({ asset: a, newTags: [] }) }
    if (rest === '' && method === 'DELETE') { const tid = trashOne(a); emit('trash.updated', {}); return json({ trashId: tid, referrers: [] }) }
    if (rest === '/review') { a.review = body.status; a.reviewVerdict = { status: body.status, by: 'user:unnamed', at: new Date().toISOString(), ...(body.note ? { note: body.note } : {}) }; refresh(a); touched(a.id, ['review']); return json(a) }
    if (rest === '/move') { const dir = body.folder ?? a.path.slice(0, a.path.lastIndexOf('/')); if (body.name) a.name = body.name; a.path = (dir ? dir + '/' : '') + a.name; refresh(a); touched(a.id, ['path']); return json(a) }
    if (rest === '/copy') {
      const dir = a.path.slice(0, a.path.lastIndexOf('/')), name = copyName(dir, a.name)
      const c: AssetDetail = structuredClone(a); c.id = guid(++seq); c.name = name; c.path = `${dir}/${name}`; c.review = a.review === 'exempt' ? 'exempt' : 'pending'; c.relations = { outgoing: [], incoming: [] }; c.modified = new Date().toISOString()
      assets.set(c.id, c); emit('asset.created', { id: c.id, path: c.path, by: 'user:unnamed' })
      const ref = a.relations.incoming.length > 0
      return json({ asset: c, name, originalReferenced: ref, message: ref ? `已复制为 ${name}，原来的引用仍指向原件` : `已复制为 ${name}` })
    }
    if (rest === '/tags/accept') { applyTags(a, { add: body.tags }); a.autoTags = a.autoTags.filter(t => !body.tags.includes(t)); touched(a.id, ['tags']); return json(a) }
    if (rest === '/tags/dismiss') { a.autoTags = a.autoTags.filter(t => !body.tags.includes(t)); touched(a.id, ['tags']); return json(a) }
    if (rest === '/open' || rest === '/reveal') return info().isLocal ? json(undefined) : fail('not_local', '只在本机', 403)
    if (rest === '/relations' && method === 'POST') { const t = assets.get(body.to); if (!t) return fail('not_found', 'to', 404); a.relations.outgoing.push(relView(body.type, a, t, { ...(body.slot ? { slot: body.slot } : {}) })); t.relations.incoming.push({ ...relView(body.type, a, t, {}, false), target: summary(a) }); emit('relation.updated', { from: a.id, type: body.type, to: t.id, op: 'added' }); return json(a) }
    if (rest === '/relations' && method === 'DELETE') { a.relations.outgoing = a.relations.outgoing.filter(r => !(r.type === body.type && r.to === body.to)); const t = assets.get(body.to); if (t) t.relations.incoming = t.relations.incoming.filter(r => !(r.type === body.type && r.from === a.id)); a.flags = a.flags.filter(f => f !== 'broken'); refresh(a); emit('relation.updated', { from: a.id, type: body.type, to: body.to, op: 'removed' }); return json(a) }
    if (rest === '/relations/acknowledge') { a.relations.outgoing.forEach(r => { if (r.to === body.to) r.stale = false }); a.flags = a.flags.filter(f => f !== 'stale'); refresh(a); touched(a.id, ['relations']); return json(a) }
    if (rest === '/content') { a.versions.push({ hash: a.hash, size: a.size, at: new Date().toISOString(), by: 'user:unnamed' }); a.review = 'pending'; refresh(a); touched(a.id, ['content']); return json(a) }
  }
  return fail('not_found', `${method} ${path}`, 404)
}

function applyTags(a: AssetDetail, e: { add?: string[]; remove?: string[]; set?: string[] }) {
  if (e.set) a.tags = [...e.set]
  if (e.remove) a.tags = a.tags.filter(t => !e.remove!.includes(t))
  if (e.add) for (const t of e.add) if (!a.tags.includes(t)) a.tags.push(t)
}

function trashOne(a: AssetDetail, batch?: string): string {
  const id = 't' + ++seq
  assets.delete(a.id)
  trash.unshift({ id, assetId: a.id, name: a.name, originalPath: a.path, folder: a.path.slice(0, a.path.lastIndexOf('/')), format: a.format, stage: a.stage, review: a.review, size: a.size, thumbnail: a.thumbnail, deletedAt: new Date().toISOString(), deletedBy: 'user:unnamed', daysLeft: 7, referencedBy: 0, recordOnly: false, ...(batch ? { batch } : {}), detail: a })
  emit('asset.removed', { id: a.id, reason: 'trash' })
  return id
}

export function installFixtures(mode: string): void {
  seed(mode === '100k' ? 100_000 : 0)
  setApiFetch(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
    let body: unknown = undefined
    if (!isForm && typeof init?.body === 'string') { try { body = JSON.parse(init.body) } catch { body = undefined } }
    if (method === 'GET' && url.search) body = Object.fromEntries(url.searchParams)
    await new Promise(r => setTimeout(r, 40 + (hash(path) % 60)))
    return handle(method, decodeURI(path), body, isForm ? (init!.body as FormData) : null)
  })
  setEventSourceFactory(() => {
    const src = { ls: new Map<string, Array<(ev: MessageEvent) => void>>() }
    sources.add(src)
    const es: EventSourceLike = {
      addEventListener: (type, l) => { src.ls.set(type, [...(src.ls.get(type) ?? []), l]) },
      close: () => { sources.delete(src) }
    }
    return es
  })
  ;(globalThis as Record<string, unknown>).__bbFixtures = { emit, assets, NOW }
  console.info(`[bowerbird] development fixtures installed (${assets.size} assets). Add ?nofixtures to leave.`)
}
