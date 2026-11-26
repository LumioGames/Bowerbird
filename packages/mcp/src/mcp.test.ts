/**
 * MCP tools over the SDK's in-process transport, against a fake HTTP API (node:http) that records requests.
 * Checks each tool's input → HTTP call and its output shape, and that no delete tool exists.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AssetDetail, AssetSummary } from '@bowerbird/schema'
import { agentActor, createMcpServer, TOOL_NAMES } from './index.js'

const LIB = '01936b2a-0000-7000-8000-00000000a001'
const ID1 = '01936b2a-0000-7000-8000-000000000001'
const ID2 = '01936b2a-0000-7000-8000-000000000002'
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')

function summary(over: Partial<AssetSummary> = {}): AssetSummary {
  return {
    id: ID1, name: 'chest.glb', path: 'props/chest.glb', format: 'model', plugin: 'bowerbird.model', stage: 'runtime',
    review: 'approved', tags: ['宝箱'], autoTags: [], description: null, flags: ['stale'], thumbnail: null, thumbState: 'ready',
    aspect: 1, badge: '2,480 面', issueLevel: 'warning', issueCount: 1, size: 10, modified: '2026-11-25T00:00:00.000Z',
    created: '2026-11-25T00:00:00.000Z', createdBy: 'agent:modeler', bundle: false, auxiliary: false, memberCount: 0,
    cellText: null, missingPlugin: null, ...over
  }
}
function detail(over: Partial<AssetDetail> = {}): AssetDetail {
  return {
    ...summary(), hash: 'sha256:00', descriptionFull: '红色的卡通宝箱。', auto: null, fields: {}, reviewVerdict: null, versions: [], views: null,
    thumbnailManual: false, origin: null, modifiedBy: null, tech: { triangles: 2480 }, analysis: {}, unresolvedRefs: [], checks: [],
    relations: { outgoing: [{ type: 'uses', from: ID1, to: ID2, target: summary({ id: ID2, name: 'tex.png', path: 'props/tex.png', format: 'image' }), targetName: 'tex.png', targetInTrash: false, slot: 'chest_basecolor.png', broken: false, stale: false }], incoming: [] },
    issues: [{ id: 'iss1', type: 'stale-upstream', level: 'warning', assetId: ID1, details: {}, foundAt: '2026-11-25T00:00:00.000Z' }],
    record: { id: 'rec_1', method: 'ai-generate', tool: 'meshy', prompt: '红色的卡通宝箱', by: 'agent:modeler', at: '2026-11-25T00:00:00.000Z' },
    bundleFiles: null, targetSize: { w: 1.26, h: 0.95, d: 0.87, from: ID2 }, stages: [], ...over
  }
}

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: unknown; form?: Record<string, unknown> }
let seen: Seen[] = []
let isLocal = false
let root = ''
let summaryImage: string | null = null
/** Summary without image: 'pending' (format renders, not yet), 'none' (format has no overview image). */
let summaryMissing: 'pending' | 'none' = 'pending'
const BAD = '01936b2a-0000-7000-8000-000000000099'
/** A bundle asset (folder as one asset): `ui/proto`, three files, two of them named index.html. */
const BUNDLE = '01936b2a-0000-7000-8000-000000000003'
const BUNDLE_FILES = [{ path: 'index.html', size: 1, entry: true }, { path: 'js/app.js', size: 1, entry: false }, { path: 'js/index.html', size: 1, entry: false }]
/** How the fake plans a bundle export: by layout (keep/flat), with the future `inner` field, or as an unplaceable dependency. */
let bundlePlan: 'normal' | 'inner' | 'unplaceable' = 'normal'
let server: http.Server
let baseUrl = ''

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, 'http://x')
  const p = url.pathname.replace('/api/v1', '')
  const s: Seen = { method: req.method!, url: p + url.search, headers: req.headers, body: undefined }
  const ct = req.headers['content-type'] ?? ''
  if (ct.startsWith('multipart/form-data')) {
    const fd = await new Response(Readable.toWeb(req) as ReadableStream, { headers: { 'content-type': ct } }).formData()
    s.form = {}
    for (const [k, v] of fd.entries()) s.form[k] = typeof v === 'string' ? JSON.parse(v) : { name: (v as File).name, text: await (v as File).text() }
  } else {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    if (chunks.length) s.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  seen.push(s)
  const L = `/libraries/${LIB}`
  const route = `${req.method} ${p}`
  if (route === 'GET /libraries') return send(res, 200, { libraries: [{ id: LIB, name: '星落', root, state: 'ready' }], defaultId: LIB })
  if (route === `GET ${L}`) return send(res, 200, { id: LIB, name: '星落', root, state: 'ready', isLocal })
  if (route === `POST ${L}/search`) {
    const body = s.body as { filter?: { folder?: string; ids?: string[] } }
    if (body.filter?.ids) return send(res, 200, { items: body.filter.ids.map(id => summary({ id, path: id === ID2 ? 'props/tex.png' : 'props/chest.glb' })), total: 1, cursor: null })
    if (body.filter?.folder === 'props') return send(res, 200, { items: [summary(), summary({ id: ID2, path: 'props/tex.png' })], total: 2, cursor: null })
    return send(res, 200, { items: [summary()], total: 41, cursor: 'c2', scopedToApproved: true })
  }
  if (route === `GET ${L}/assets/${ID1}`) return send(res, 200, detail())
  if (route === `GET ${L}/assets/${ID2}`) return send(res, 200, detail({ id: ID2, name: 'tex.png', path: 'props/tex.png' }))
  if (route.startsWith(`GET ${L}/assets/`) && route.endsWith('/summary')) return send(res, 200, { text: '2,480 面，1 个材质', image: summaryImage, ...(summaryImage || summaryMissing === 'none' ? {} : { imageMissingReason: '概览图还没有渲染，有人打开页面后才会生成' }) })
  if (route === `GET ${L}/assets/${ID1}/thumbnail`) { res.writeHead(200, { 'content-type': 'image/webp' }); return res.end(PNG) }
  if (route === `GET ${L}/assets/${BUNDLE}`) return send(res, 200, detail({ id: BUNDLE, name: 'proto', path: 'ui/proto', format: 'doc', bundle: true, bundleFiles: BUNDLE_FILES, relations: { outgoing: [], incoming: [] } }))
  if (route === `GET ${L}/assets/${BUNDLE}/file`) { res.writeHead(200); return res.end('B:index.html') } // the entry file, whatever was asked
  if (route.startsWith(`GET ${L}/assets/${BUNDLE}/bundle/`)) {
    const inner = decodeURIComponent(p.slice(`${L}/assets/${BUNDLE}/bundle/`.length))
    if (!BUNDLE_FILES.some(f => f.path === inner)) return send(res, 404, { error: { code: 'not_found', message: 'no such file' } })
    res.writeHead(200); return res.end(`B:${inner}`)
  }
  if (route === `GET ${L}/assets/${ID1}/file` || route === `GET ${L}/assets/${ID2}/file`) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(Buffer.from(p.includes(ID2) ? 'TEX' : 'GLB')) }
  if (route === `GET ${L}/assets/${ID1}/lineage`) {
    return send(res, 200, {
      center: ID1, nodes: [summary(), summary({ id: ID2, path: 'concept/chest.png', format: 'image' })], missing: [],
      edges: [{ type: 'source', from: ID1, to: ID2, broken: false, stale: true, record: 'rec_1' }],
      records: { rec_1: { id: 'rec_1', method: 'ai-generate', tool: 'meshy', prompt: '由四视图生成模型', by: 'agent:modeler', at: '2026-11-25T00:00:00.000Z' } }
    })
  }
  if (route === `POST ${L}/records`) return send(res, 201, { id: 'rec_9', record: { id: 'rec_9', method: 'ai-generate', by: 'agent:modeler', at: 'x' } })
  if (route === `POST ${L}/assets`) {
    const meta = (s.form?.meta ?? s.body) as { path?: string }
    const file = s.form?.file as { name: string } | undefined
    if (file?.name === 'conflict.png') return send(res, 409, { error: { code: 'conflict', message: '目标位置已有同名文件' } })
    return send(res, 201, { asset: detail({ id: ID2, name: file?.name ?? 'x', path: meta.path ?? `props/${file?.name}` }), skipped: false, recordId: 'rec_9', newTags: [{ tag: '箱子', similar: ['宝箱'] }] })
  }
  if (route === `PATCH ${L}/assets/${ID1}`) return send(res, 200, { asset: detail(), newTags: [{ tag: '道具', similar: [] }] })
  if (route === `POST ${L}/assets/${ID1}/relations/replace` && (s.body as { newTo: string }).newTo === BAD) return send(res, 409, { error: { code: 'cycle', message: '来源关系会成环' } })
  if (route.startsWith(`POST ${L}/assets/${ID1}/relations`) || route === `DELETE ${L}/assets/${ID1}/relations`) return send(res, 200, detail())
  if (route === `POST ${L}/relations/retarget`) {
    const b = s.body as { dryRun: boolean }
    return send(res, 200, { affected: [{ assetId: ID1, assetName: 'chest.glb', type: 'uses', slot: 'a.png' }], applied: !b.dryRun })
  }
  if (route === `POST ${L}/export/plan` && (s.body as { ids: string[] }).ids[0] === BUNDLE) {
    const flat = (s.body as { layout?: string }).layout === 'flat'
    const base = flat ? 'proto' : 'ui/proto'
    const files = bundlePlan === 'unplaceable'
      // a bundle reached as a dependency under a slot name that matches none of its files
      ? [{ path: 'scene/textures/atlas.png', size: 1, assetId: BUNDLE, dependency: true }]
      : BUNDLE_FILES.map(f => ({ path: bundlePlan === 'inner' ? `x/${f.path.replace(/\//g, '_')}` : `${base}/${f.path}`, size: 1, assetId: BUNDLE, dependency: false, ...(bundlePlan === 'inner' ? { inner: f.path } : {}) }))
    return send(res, 200, { files, bytes: files.length, dependencies: 0, duplicateNames: false })
  }
  if (route === `POST ${L}/export/plan`) return send(res, 200, { files: [{ path: 'chest.glb', size: 3, assetId: ID1, dependency: false }, { path: 'chest_basecolor.png', size: 3, assetId: ID2, dependency: true, fromFile: 'tex.png' }], bytes: 6, dependencies: 1, duplicateNames: false })
  if (route === `POST ${L}/export`) return send(res, 200, { written: 2, dir: (s.body as { dir: string }).dir, bytes: 6 })
  if (route === `GET ${L}/creators`) return send(res, 200, { creators: [] })
  if (route === `POST ${L}/creators/gen.image/runs`) return send(res, 202, { id: 'job_1', kind: 'create', status: 'queued', attempts: 0, outputs: [], createdAt: 'x', updatedAt: 'x', creator: 'gen.image' })
  if (route === `GET ${L}/jobs/job_1`) return send(res, 200, { id: 'job_1', kind: 'create', status: 'done', progress: 1, attempts: 1, outputs: [ID2], createdAt: 'x', updatedAt: 'x' })
  if (route === `GET ${L}/vocabulary`) {
    return send(res, 200, {
      stages: [{ id: 'reference', name: '参考素材' }, { id: 'production', name: '生产物料' }, { id: 'runtime', name: '运行时物料' }],
      reviews: [{ id: 'pending', name: '待审' }], formats: [{ id: 'model', displayName: '3D 模型', plugin: 'bowerbird.model', count: 3 }],
      relationTypes: [{ id: 'source', name: '来源', inverseName: '产出', tracksVersion: true, plugin: null }],
      tags: [{ name: '宝箱', count: 12 }, { name: '道具', count: 3 }], methods: [], actors: [], templates: [], designObjects: []
    })
  }
  if (route === `GET ${L}/issues`) {
    return send(res, 200, { issues: [{ id: 'iss1', type: 'missing-file', level: 'error', assetId: ID1, details: {}, foundAt: 'x' }], assets: { [ID1]: summary() }, assetCount: 1, total: 1 })
  }
  return send(res, 404, { error: { code: 'not_found', message: `fake: no route ${route}` } })
}

beforeAll(async () => {
  server = http.createServer((req, res) => { handle(req, res).catch(e => send(res, 500, { error: { code: 'internal', message: String(e) } })) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-lib-'))
  fs.mkdirSync(path.join(root, 'props'))
  fs.writeFileSync(path.join(root, 'props', 'chest.glb'), 'GLB')
  fs.writeFileSync(path.join(root, 'props', 'tex.png'), 'TEX')
})
afterAll(async () => {
  await new Promise(r => server.close(r))
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => { seen = []; isLocal = false; summaryImage = null; summaryMissing = 'pending'; bundlePlan = 'normal' })

async function connect(actor = 'modeler') {
  const mcp = createMcpServer({ baseUrl, actor })
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([mcp.connect(a), client.connect(b)])
  return client
}

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>
async function call(name: string, args: Record<string, unknown> = {}) {
  const client = await connect()
  const r = await client.callTool({ name, arguments: args }) as { content: Content; isError?: boolean }
  await client.close()
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') }
}

describe('tool list', () => {
  it('has exactly the ten tools and no delete tool', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name).sort()).toEqual([...TOOL_NAMES].sort())
    expect(tools.length).toBe(10)
    expect(tools.some(t => /delete|remove|trash|purge|rm\b/i.test(t.name))).toBe(false)
    for (const t of tools) expect(t.inputSchema.type).toBe('object')
    await client.close()
  })
})

describe('bb_search', () => {
  it('parses the text syntax, sends the agent actor, and lists stage/review/issue markers', async () => {
    const r = await call('bb_search', { query: 'stage:runtime tag:宝箱 红色' })
    const req = seen.find(s => s.url.endsWith('/search'))!
    expect(req.body).toEqual({ q: '红色', filter: { stage: ['runtime'], tags: { all: ['宝箱'] } }, limit: 20 })
    expect(req.headers['x-bowerbird-actor']).toBe('agent:modeler')
    expect(r.text).toContain(`${ID1} props/chest.glb model stage=runtime review=approved issues=warning×1 flags=stale tags=宝箱 badge="2,480 面"`)
    expect(r.text).toContain('1 of ~41')
    expect(r.text).toContain('next cursor: c2')
    expect(r.text).toMatch(/approved \+ exempt/)
  })
  it('merges a structured filter and paging', async () => {
    await call('bb_search', { query: 'format:model', filter: { review: ['approved'] }, limit: 5, cursor: 'c2', sort: 'name' })
    expect(seen.find(s => s.url.endsWith('/search'))!.body).toEqual({ filter: { format: ['model'], review: ['approved'] }, sort: 'name', limit: 5, cursor: 'c2' })
  })
})

describe('bb_get', () => {
  it('returns compact details plus the overview image as MCP image content', async () => {
    summaryImage = `/api/v1/libraries/${LIB}/assets/${ID1}/thumbnail?variant=thumb&v=k1`
    const r = await call('bb_get', { id: ID1, image: true })
    expect(r.text).toContain('stage=runtime review=approved')
    expect(r.text).toContain('out: uses(chest_basecolor.png) →')
    expect(r.text).toContain('record: rec_1 method=ai-generate tool=meshy')
    expect(r.text).toContain('targetSize: 1.26×0.95×0.87 m')
    expect(r.text).toContain('summary: 2,480 面')
    const img = r.content.find(c => c.type === 'image')!
    expect(img.mimeType).toBe('image/webp')
    expect(Buffer.from(img.data!, 'base64').equals(PNG)).toBe(true)
  })
  it('explains a missing overview image instead of sending one — one sentence for each case', async () => {
    const count = (t: string, re: RegExp) => (t.match(re) ?? []).length
    const pending = await call('bb_get', { id: ID1, image: true })
    expect(pending.content.some(c => c.type === 'image')).toBe(false)
    expect(pending.text).toContain('overview image: 概览图还没有渲染，有人打开页面后才会生成')
    expect(count(pending.text, /概览图/g)).toBe(1)
    summaryMissing = 'none'
    const none = await call('bb_get', { id: ID1, image: true })
    expect(none.text).toContain('overview image: 这种格式没有概览图')
    expect(none.text).not.toContain('还没有渲染')
    summaryImage = `/api/v1/libraries/${LIB}/assets/${ID1}/thumbnail-broken`
    const broken = await call('bb_get', { id: ID1, image: true })
    expect(broken.text).toContain('overview image: 概览图读取失败')
    expect(count(broken.text, /概览图/g)).toBe(1)
    expect(broken.content.some(c => c.type === 'image')).toBe(false)
  })
  it('without image: true it still says once whether there is one', async () => {
    summaryImage = `/api/v1/libraries/${LIB}/assets/${ID1}/thumbnail?variant=thumb`
    const r = await call('bb_get', { id: ID1 })
    expect(r.text).toContain('overview image: available')
    expect(r.content.some(c => c.type === 'image')).toBe(false)
    expect(seen.some(x => x.url.includes('/thumbnail'))).toBe(false)
  })
  it('accepts a library path, looking it up in every review state (agent scope does not hide it)', async () => {
    const r = await call('bb_get', { id: 'props/tex.png' })
    expect((seen.find(s => s.url.endsWith('/search'))!.body as { filter: unknown }).filter).toEqual({ folder: 'props', folderExact: true, includeAuxiliary: true, review: ['pending', 'approved', 'rejected', 'exempt'] })
    expect(seen.some(s => s.url === `/libraries/${LIB}/assets/${ID2}`)).toBe(true)
    expect(r.text).toContain(ID2)
  })
  it('reports API errors as tool errors', async () => {
    const r = await call('bb_get', { id: 'props/none.png' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/not_found/)
  })
})

describe('bb_trace', () => {
  it('passes direction, types, depth and prints edges with their records', async () => {
    const r = await call('bb_trace', { id: ID1, direction: 'down', types: ['source', 'uses'], depth: 2 })
    expect(seen.find(s => s.url.includes('/lineage'))!.url).toBe(`/libraries/${LIB}/assets/${ID1}/lineage?direction=down&types=source%2Cuses&depth=2`)
    expect(r.text).toContain('props/chest.glb --source--> concept/chest.png [stale]')
    expect(r.text).toContain('prompt="由四视图生成模型"')
  })
})

describe('bb_register', () => {
  it('uploads several files sharing one production record, with relations and views', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-up-'))
    fs.writeFileSync(path.join(dir, 'a.png'), 'AAA')
    fs.writeFileSync(path.join(dir, '红色宝箱.png'), 'BBB')
    const r = await call('bb_register', {
      files: [path.join(dir, 'a.png'), path.join(dir, '红色宝箱.png')], folder: 'props', stage: 'production', tags: ['箱子'],
      relations: [{ type: 'belongs', to: ID2 }],
      record: { method: 'ai-generate', tool: 'sdxl', prompt: '红色宝箱四视图', params: { seed: 42 }, inputs: [{ id: ID2, role: 'reference' }] },
      views: { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] }
    })
    const recs = seen.filter(s => s.url.endsWith('/records'))
    expect(recs.length).toBe(1)
    expect(recs[0]!.body).toMatchObject({ method: 'ai-generate', prompt: '红色宝箱四视图', inputs: [{ id: ID2, role: 'reference' }] })
    const ups = seen.filter(s => s.method === 'POST' && s.url === `/libraries/${LIB}/assets`)
    expect(ups.length).toBe(2)
    expect(ups[0]!.form!.meta).toEqual({ folder: 'props', stage: 'production', tags: ['箱子'], relations: [{ type: 'belongs', to: ID2 }], views: { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] }, record: 'rec_9' })
    expect(ups[1]!.form!.file).toEqual({ name: '红色宝箱.png', text: 'BBB' })
    expect(r.text).toContain('registered')
    expect(r.text).toContain('new tag "箱子" — similar existing: 宝箱')
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('registers files already inside the library in place when on the server machine', async () => {
    isLocal = true
    await call('bb_register', { files: [path.join(root, 'props', 'chest.glb')], record: { method: 'manual' } })
    const up = seen.find(s => s.method === 'POST' && s.url === `/libraries/${LIB}/assets`)!
    expect(up.form?.file).toBeUndefined()
    expect(up.form!.meta).toEqual({ path: 'props/chest.glb', record: { method: 'manual' } })
  })
  it('reports what was registered when a later file fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-up-'))
    for (const n of ['one.png', 'conflict.png', 'three.png']) fs.writeFileSync(path.join(dir, n), n)
    const r = await call('bb_register', { files: ['one.png', 'conflict.png', 'three.png'].map(n => path.join(dir, n)), folder: 'props', record: { method: 'manual' } })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('done before the failure:')
    expect(r.text).toContain('record rec_9')
    expect(r.text).toMatch(new RegExp(`registered ${ID2} props/one\\.png`))
    expect(r.text).toContain(`failed: register ${path.join(dir, 'conflict.png')} — conflict: 目标位置已有同名文件`)
    expect(r.text).toContain('not run: 1 remaining step')
    expect(seen.filter(s => s.method === 'POST' && s.url === `/libraries/${LIB}/assets`).length).toBe(2)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('needs files or a path', async () => {
    const r = await call('bb_register', { tags: ['x'] })
    expect(r.isError).toBe(true)
  })
})

describe('bb_update', () => {
  it('patches fields and edits relations', async () => {
    const r = await call('bb_update', {
      id: ID1, tags: { add: ['道具'] }, stage: 'runtime',
      relations: { add: [{ type: 'uses', to: ID2, slot: 'a.png' }], replace: [{ type: 'uses', to: ID2, slot: 'a.png', newTo: ID1 }], remove: [{ type: 'belongs', to: ID2 }] }
    })
    expect(seen.find(s => s.method === 'PATCH')!.body).toEqual({ tags: { add: ['道具'] }, stage: 'runtime' })
    expect(seen.find(s => s.url.endsWith('/relations/replace'))!.body).toEqual({ type: 'uses', to: ID2, slot: 'a.png', newTo: ID1 })
    expect(seen.find(s => s.method === 'DELETE')!.body).toEqual({ type: 'belongs', to: ID2 })
    expect(r.text).toContain('new tag "道具"')
    expect(r.text).toContain('patched tags, stage')
  })
  it('reports the steps that took effect when a later one fails', async () => {
    const r = await call('bb_update', {
      id: ID1, tags: { add: ['道具'] },
      relations: { add: [{ type: 'uses', to: ID2 }], replace: [{ type: 'source', to: ID2, newTo: BAD }], remove: [{ type: 'belongs', to: ID2 }] }
    })
    expect(r.isError).toBe(true)
    expect(r.text).toContain(`asset ${ID1}`)
    expect(r.text).toContain('patched tags')
    expect(r.text).toContain(`added uses → ${ID2}`)
    expect(r.text).toContain(`failed: replace source ${ID2} → ${BAD} — cycle: 来源关系会成环`)
    expect(r.text).toContain('not run: 1 remaining step')
    expect(seen.some(s => s.method === 'DELETE')).toBe(false)
  })
  it('retarget previews unless apply is set', async () => {
    const p = await call('bb_update', { retarget: { from: ID1, to: ID2 } })
    expect(seen.at(-1)!.body).toEqual({ from: ID1, to: ID2, dryRun: true })
    expect(p.text).toContain('preview (not applied')
    const a = await call('bb_update', { retarget: { from: ID1, to: ID2, apply: true } })
    expect(seen.at(-1)!.body).toEqual({ from: ID1, to: ID2, dryRun: false })
    expect(a.text).toContain('retargeted: 1 relations')
  })
})

describe('bb_fetch', () => {
  it('returns the local path on the server machine', async () => {
    isLocal = true
    const r = await call('bb_fetch', { id: ID1, withDeps: true })
    expect(r.text).toContain(`path: ${path.join(root, 'props', 'chest.glb')}`)
    expect(r.text).toContain(`dep chest_basecolor.png ← ${ID2}: ${path.join(root, 'props', 'tex.png')}`)
  })
  it('returns a download URL elsewhere', async () => {
    const r = await call('bb_fetch', { id: ID1 })
    expect(r.text).toContain(`url: ${baseUrl}/api/v1/libraries/${LIB}/assets/${ID1}/file?download=1`)
  })
  it('exports with dependencies under slot names: server-side when local, download otherwise', async () => {
    isLocal = true
    const out1 = path.join(os.tmpdir(), `bb-mcp-out-${Date.now()}`)
    const a = await call('bb_fetch', { id: ID1, withDeps: true, to: out1 })
    expect(seen.find(s => s.url === `/libraries/${LIB}/export`)!.body).toEqual({ ids: [ID1], withDeps: true, layout: 'keep', dir: out1 })
    expect(a.text).toContain('exported 2 files')
    isLocal = false
    seen = []
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-dl-'))
    const b = await call('bb_fetch', { id: ID1, withDeps: true, to: out2 })
    expect(seen.some(s => s.url === `/libraries/${LIB}/export`)).toBe(false)
    expect(fs.readFileSync(path.join(out2, 'chest_basecolor.png'), 'utf8')).toBe('TEX')
    expect(fs.readFileSync(path.join(out2, 'chest.glb'), 'utf8')).toBe('GLB')
    expect(b.text).toContain('downloaded 2 files')
    fs.rmSync(out2, { recursive: true, force: true })
  })
})

describe('bb_fetch of a bundle asset from another machine', () => {
  const read = (dir: string) => Object.fromEntries(
    (fs.readdirSync(dir, { recursive: true }) as string[]).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => [f.split(path.sep).join('/'), fs.readFileSync(path.join(dir, f), 'utf8')])
  )
  it('downloads every file inside the bundle, not the entry file each time (keep and flat layouts)', async () => {
    const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-bundle-'))
    const r = await call('bb_fetch', { id: BUNDLE, to: keep })
    expect(r.isError).toBeFalsy()
    expect(read(keep)).toEqual({ 'ui/proto/index.html': 'B:index.html', 'ui/proto/js/app.js': 'B:js/app.js', 'ui/proto/js/index.html': 'B:js/index.html' })
    expect(seen.some(s => s.url.endsWith(`/assets/${BUNDLE}/file`))).toBe(false)
    const flat = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-bundle-'))
    await call('bb_fetch', { id: BUNDLE, to: flat, layout: 'flat' })
    expect(read(flat)).toEqual({ 'proto/index.html': 'B:index.html', 'proto/js/app.js': 'B:js/app.js', 'proto/js/index.html': 'B:js/index.html' })
    fs.rmSync(keep, { recursive: true, force: true }); fs.rmSync(flat, { recursive: true, force: true })
  })
  it('uses the plan\'s path inside the bundle when the server gives it', async () => {
    bundlePlan = 'inner'
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-bundle-'))
    await call('bb_fetch', { id: BUNDLE, to: out })
    expect(read(out)).toEqual({ 'x/index.html': 'B:index.html', 'x/js_app.js': 'B:js/app.js', 'x/js_index.html': 'B:js/index.html' })
    fs.rmSync(out, { recursive: true, force: true })
  })
  it('refuses rather than write a wrong file when the place inside the bundle cannot be told', async () => {
    bundlePlan = 'unplaceable'
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-bundle-'))
    const r = await call('bb_fetch', { id: BUNDLE, to: out })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('scene/textures/atlas.png')
    expect(read(out)).toEqual({})
    fs.rmSync(out, { recursive: true, force: true })
  })
})

describe('bb_creators / bb_create', () => {
  it('lists creators (none in phase one)', async () => {
    const r = await call('bb_creators')
    expect(r.text).toContain('no creators available')
  })
  it('starts a run and checks a job', async () => {
    const s = await call('bb_create', { creator: 'gen.image', params: { prompt: '宝箱' }, inputs: [{ role: 'reference', id: ID2 }] })
    expect(seen.find(x => x.url.endsWith('/runs'))!.body).toEqual({ params: { prompt: '宝箱' }, inputs: [{ role: 'reference', id: ID2 }] })
    expect(s.text).toContain('job job_1 kind=create status=queued')
    const j = await call('bb_create', { job: 'job_1' })
    expect(j.text).toContain(`status=done progress=100% outputs=${ID2}`)
  })
})

describe('bb_vocabulary / bb_health', () => {
  it('vocabulary lists tags with counts', async () => {
    const r = await call('bb_vocabulary')
    expect(r.text).toContain('宝箱×12')
    expect(r.text).toContain('runtime(运行时物料)')
  })
  it('health lists issues with filters', async () => {
    const r = await call('bb_health', { type: ['missing-file'], level: ['error'] })
    expect(seen.find(s => s.url.includes('/issues'))!.url).toBe(`/libraries/${LIB}/issues?type=missing-file&level=error`)
    expect(r.text).toContain(`[error] missing-file ${ID1} props/chest.glb`)
  })
})

describe('stdio', () => {
  it('answers the calls it already received when stdin ends, then stops', async () => {
    const { PassThrough } = await import('node:stream')
    const { runMcpServer } = await import('./index.js')
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let out = ''
    stdout.on('data', d => { out += String(d) })
    const done = runMcpServer({ baseUrl, actor: 'smoke', stdin, stdout })
    const send = (m: object) => stdin.write(JSON.stringify(m) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bb_vocabulary', arguments: {} } })
    stdin.end()
    await done
    const replies = out.trim().split('\n').map(l => JSON.parse(l) as { id?: number; result?: { content?: Array<{ text: string }> } })
    const call = replies.find(r => r.id === 2)
    expect(call, out).toBeDefined()
    expect(call!.result!.content![0]!.text).toContain('宝箱×12')
  })
})

describe('actor', () => {
  it('prefixes agent: and percent-encodes non-ASCII names', () => {
    expect(agentActor('modeler')).toBe('agent:modeler')
    expect(agentActor('agent:cutter')).toBe('agent:cutter')
    expect(agentActor(undefined)).toBe('agent:unnamed')
    expect(agentActor('建模')).toBe('agent:%E5%BB%BA%E6%A8%A1')
  })
})
