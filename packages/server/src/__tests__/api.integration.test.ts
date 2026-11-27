/**
 * HTTP API tests against the REAL kernel (`createHub`), in a temporary library and `BOWERBIRD_HOME`
 * (engineering.md「测试策略 · 接口」).
 *
 * DEPENDS ON line core-A (Hub, LibraryService) and line core-B (query, pipeline, plugin host). Until both are
 * merged, `createHub` is the scaffold placeholder that throws「not implemented yet」and this whole file is skipped.
 * Any other failure to create a hub fails loudly.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHub, type Hub } from '@bowerbird/core'
import { createApiClient, parseQueryText, type ApiClient } from '@bowerbird/schema'
import { startServer, type RunningServer } from '../index.js'

async function coreReady(): Promise<boolean> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-probe-'))
  try {
    const hub = await createHub({ home, builtinPluginDirs: [], watch: false })
    await hub.close()
    return true
  } catch (e) {
    if (/not implemented yet/.test((e as Error).message)) return false
    throw e
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

const READY = await coreReady()

/** 1×1 transparent PNG. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (ok(v)) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting; last value: ${JSON.stringify(v).slice(0, 400)}`)
    await new Promise(r => setTimeout(r, 50))
  }
}

describe.skipIf(!READY)('HTTP API over the real kernel', () => {
  let tmp: string
  let rootA: string
  let rootB: string
  let hub: Hub
  let server: RunningServer
  let api: ApiClient
  let agent: ApiClient
  let libA: string
  let libB: string

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-api-'))
    const home = path.join(tmp, 'home')
    process.env.BOWERBIRD_HOME = home
    rootA = path.join(tmp, 'xingluo')
    rootB = path.join(tmp, 'second')
    fs.mkdirSync(path.join(rootA, 'props'), { recursive: true })
    fs.writeFileSync(path.join(rootA, 'props', 'existing.png'), PNG)
    fs.mkdirSync(rootB, { recursive: true })
    hub = await createHub({ home, builtinPluginDirs: [], watch: false })
    const refA = await hub.addLibrary(rootA, '星落')
    const refB = await hub.addLibrary(rootB, '第二个库')
    server = await startServer({ hub, host: '127.0.0.1', port: 0, defaultLibrary: refA.id, print: () => undefined })
    api = createApiClient({ baseUrl: server.url, actor: 'user:lin' })
    agent = createApiClient({ baseUrl: server.url, actor: 'agent:modeler' })
    // The id may change from a slug to the library GUID on first open; read it back from the API.
    await api.libraries.init(refA.id).catch(() => undefined)
    await api.libraries.init(refB.id).catch(() => undefined)
    const libs = await until(() => api.libraries.list(), r => r.libraries.length >= 2 && r.libraries.every(l => l.state === 'ready'))
    libA = libs.libraries.find(l => path.resolve(l.root) === path.resolve(rootA))!.id
    libB = libs.libraries.find(l => path.resolve(l.root) === path.resolve(rootB))!.id
    await until(() => api.libraries.get(libA), info => !info.scan.running && info.stats.assets >= 1)
  })

  afterAll(async () => {
    await server?.close()
    await hub?.close()
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('lists libraries with the opened one as default', async () => {
    const r = await api.libraries.list()
    expect(r.libraries.map(l => l.id).sort()).toEqual([libA, libB].sort())
    expect(r.defaultId).toBe(libA)
    const info = await api.libraries.get(libA)
    expect(info.isLocal).toBe(true)
    expect(info.name).toBe('星落')
  })

  it('health reports every library', async () => {
    const h = await api.health()
    expect(h.status).toMatch(/ok|degraded/)
    expect(h.libraries.map(l => l.id)).toEqual(expect.arrayContaining([libA, libB]))
  })

  let chestId = ''
  let lidId = ''

  it('uploads, then answers conflict / keep-both / skip for the same name', async () => {
    const pre = await api.assets.precheck(libA, { folder: 'props', names: ['chest.png'] })
    expect(pre.conflicts).toEqual([])
    const r = await api.assets.register(libA, { folder: 'props', tags: ['宝箱'], stage: 'production', provenance: { method: 'ai-generate', prompt: '红色的卡通宝箱', params: { seed: 7 } } }, { data: PNG, name: 'chest.png', type: 'image/png' })
    expect(r.asset!.path).toBe('props/chest.png')
    expect(r.asset!.provenance).toMatchObject({ method: 'ai-generate', prompt: '红色的卡通宝箱', params: { seed: 7 } })
    chestId = r.asset!.id
    expect(fs.existsSync(path.join(rootA, 'props', 'chest.png.bmeta'))).toBe(true)
    const pre2 = await api.assets.precheck(libA, { folder: 'props', names: ['chest.png'] })
    expect(pre2.conflicts[0]!.existing.id).toBe(chestId)
    await expect(api.assets.register(libA, { folder: 'props' }, { data: PNG, name: 'chest.png' })).rejects.toMatchObject({ status: 409, code: 'conflict' })
    const both = await api.assets.register(libA, { folder: 'props', onConflict: 'keep-both' }, { data: PNG, name: 'chest.png' })
    expect(both.asset!.path).toBe('props/chest_1.png')
    const skipped = await api.assets.register(libA, { folder: 'props', onConflict: 'skip' }, { data: PNG, name: 'chest.png' })
    expect(skipped.skipped).toBe(true)
  })

  it('registers with a source relation and traces lineage', async () => {
    const r = await agent.assets.register(libA, {
      folder: 'props', tags: ['宝箱', '盖子'], relations: [{ type: 'source', to: chestId, role: 'reference' }],
      provenance: { method: 'slice', params: { rect: [0, 0, 1, 1] } }
    }, { data: PNG, name: 'lid.png' })
    lidId = r.asset!.id
    expect(r.newTags.map(t => t.tag)).toContain('盖子')
    expect(r.asset!.createdBy).toBe('agent:modeler')
    const up = await api.assets.lineage(libA, lidId, { direction: 'up' })
    expect(up.nodes.map(n => n.id)).toEqual(expect.arrayContaining([chestId, lidId]))
    expect(up.edges.find(e => e.from === lidId && e.to === chestId)!.type).toBe('source')
    expect(up.edges.find(e => e.from === lidId && e.to === chestId)!.role).toBe('reference')
    expect(up.provenance[lidId]).toMatchObject({ method: 'slice', by: 'agent:modeler' })
    const down = await api.assets.lineage(libA, chestId, { direction: 'down' })
    expect(down.nodes.map(n => n.id)).toContain(lidId)
    // saying the same thing again writes nothing (ADR-068)
    const before = fs.readFileSync(path.join(rootA, 'props', 'lid.png.bmeta'), 'utf8')
    const again = await agent.assets.apply(libA, { items: [{ id: lidId, tags: { add: ['盖子'] }, provenance: { method: 'slice', params: { rect: [0, 0, 1, 1] } } }] })
    expect(again.results[0]).toMatchObject({ changed: false, changes: [] })
    expect(fs.readFileSync(path.join(rootA, 'props', 'lid.png.bmeta'), 'utf8')).toBe(before)
  })

  it('searches with the text syntax and patches tags', async () => {
    const parsed = parseQueryText('tag:盖子 folder:props')
    const res = await api.search(libA, { q: parsed.q || undefined, filter: parsed.filter })
    expect(res.items.map(i => i.id)).toEqual([lidId])
    expect(res.items[0]).toMatchObject({ stage: expect.any(String), review: 'pending', flags: expect.any(Array) })
    const p = await api.assets.patch(libA, chestId, { tags: { add: ['道具'] }, description: '红色宝箱。第二句。' })
    expect(p.asset.tags).toEqual(expect.arrayContaining(['宝箱', '道具']))
    expect(p.newTags.map(t => t.tag)).toContain('道具')
  })

  it('serves files with byte ranges', async () => {
    const full = await api.raw('GET', `/libraries/${libA}/assets/${chestId}/file`)
    expect(Buffer.from(await full.arrayBuffer()).equals(PNG)).toBe(true)
    const part = await fetch(api.assets.fileUrl(libA, chestId), { headers: { range: 'bytes=0-7' } })
    expect(part.status).toBe(206)
    expect(Buffer.from(await part.arrayBuffer()).equals(PNG.subarray(0, 8))).toBe(true)
    const dl = await fetch(api.assets.fileUrl(libA, chestId, true))
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/)
  })

  it('agent search scope: approved-only when the library says so', async () => {
    await api.assets.review(libA, chestId, { status: 'approved' })
    await api.libraries.patch(libA, { settings: { agentSearchScope: 'approved' } })
    const asAgent = await agent.search(libA, { filter: { folder: 'props' } })
    expect(asAgent.scopedToApproved).toBe(true)
    expect(asAgent.items.every(i => i.review === 'approved' || i.review === 'exempt')).toBe(true)
    expect(asAgent.items.map(i => i.id)).toContain(chestId)
    const asUser = await api.search(libA, { filter: { folder: 'props' } })
    expect(asUser.items.map(i => i.id)).toEqual(expect.arrayContaining([chestId, lidId]))
    const explicit = await agent.search(libA, { filter: { folder: 'props', review: ['pending'] } })
    expect(explicit.items.map(i => i.id)).toContain(lidId)
    await api.libraries.patch(libA, { settings: { agentSearchScope: 'all' } })
  })

  it('refuses to trash a referenced asset without force; trash and restore', async () => {
    await expect(api.assets.remove(libA, chestId)).rejects.toMatchObject({ status: 409, code: 'referenced', details: { referrers: [lidId] } })
    const del = await api.assets.remove(libA, chestId, true)
    expect(del.referrers).toEqual([lidId])
    const trash = await api.trash.list(libA)
    const item = trash.items.find(i => i.assetId === chestId)!
    expect(item).toBeDefined()
    await expect(api.assets.get(libA, chestId)).rejects.toMatchObject({ status: 404 })
    const restored = await api.trash.restore(libA, item.id)
    expect(restored.asset.id).toBe(chestId)
  })

  it('cycles are refused', async () => {
    await expect(api.relations.add(libA, chestId, { type: 'source', to: lidId })).rejects.toMatchObject({ status: 409, code: 'cycle' })
  })

  it('keeps libraries apart (multi-library paths)', async () => {
    const r = await api.assets.register(libB, { folder: '' }, { data: PNG, name: 'only-in-b.png' })
    const inB = await api.search(libB, {})
    expect(inB.items.map(i => i.id)).toContain(r.asset!.id)
    const inA = await api.search(libA, { filter: { includeAuxiliary: true } })
    expect(inA.items.map(i => i.id)).not.toContain(r.asset!.id)
    await expect(api.assets.get(libA, r.asset!.id)).rejects.toMatchObject({ status: 404 })
    expect(fs.existsSync(path.join(rootB, 'only-in-b.png'))).toBe(true)
  })

  it('pushes asset.created over SSE', async () => {
    const ac = new AbortController()
    const res = await fetch(api.libraries.eventsUrl(libA), { signal: ac.signal })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let text = ''
    while (!text.includes(': connected')) text += dec.decode((await reader.read()).value)
    const created = await api.assets.register(libA, { folder: 'props' }, { data: PNG, name: 'event.png' })
    const deadline = Date.now() + 5000
    while (!text.includes(created.asset!.id) && Date.now() < deadline) text += dec.decode((await reader.read()).value)
    ac.abort()
    expect(text).toMatch(new RegExp(`event: asset\\.created\\ndata: \\{[^\\n]*"id":"${created.asset!.id}"`))
  })

  it('exports a zip, and to a directory for local requests only', async () => {
    const zip = await api.exports.run(libA, { ids: [lidId], withDeps: false })
    expect(zip.headers.get('content-type')).toBe('application/zip')
    const buf = Buffer.from(await zip.arrayBuffer())
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    expect(buf.includes(Buffer.from('lid.png'))).toBe(true)
    const out = path.join(tmp, 'export-out')
    const r = await (await api.exports.run(libA, { ids: [lidId], dir: out, layout: 'flat' })).json() as { written: number }
    expect(r.written).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(out, 'lid.png'))).toBe(true)
    const remote = await server.app.inject({ method: 'POST', url: `/api/v1/libraries/${libA}/export`, payload: { ids: [lidId], dir: out }, remoteAddress: '192.168.7.7' })
    expect(remote.statusCode).toBe(403)
    expect(remote.json().error.code).toBe('not_local')
  })

  it('open and reveal are local-only', async () => {
    const remote = await server.app.inject({ method: 'POST', url: `/api/v1/libraries/${libA}/assets/${lidId}/reveal`, payload: {}, remoteAddress: '192.168.7.7' })
    expect(remote.statusCode).toBe(403)
    expect(remote.json().error.code).toBe('not_local')
  })

  it('checks Host and Origin', async () => {
    const evilHost = await server.app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: 'attacker.example:7420' } })
    expect(evilHost.statusCode).toBe(403)
    const evilOrigin = await server.app.inject({ method: 'DELETE', url: `/api/v1/libraries/${libA}/assets/${lidId}`, headers: { host: 'localhost', origin: 'https://attacker.example' } })
    expect(evilOrigin.statusCode).toBe(403)
    const sandboxed = await server.app.inject({ method: 'GET', url: `/api/v1/libraries/${libA}/vocabulary`, headers: { host: 'localhost', origin: 'null' } })
    expect(sandboxed.statusCode).toBe(403)
    expect((await api.assets.get(libA, lidId)).id).toBe(lidId)
  })

  it('validation errors and unknown ids', async () => {
    await expect(api.search(libA, { limit: 0 } as never)).rejects.toMatchObject({ status: 400, code: 'validation_failed' })
    await expect(api.assets.get(libA, '01936b2a-0000-7000-8000-0000000000ff')).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await expect(api.libraries.get('no-such-library')).rejects.toMatchObject({ status: 404 })
    await expect(api.assets.untrack(libA, '01936b2a-0000-7000-8000-0000000000ff')).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await expect(api.assets.apply(libA, { items: [] })).rejects.toMatchObject({ status: 400, code: 'validation_failed' })
  })

  it('vocabulary, folders, tags, issues, jobs, creators answer with schema shapes', async () => {
    const v = await api.libraries.vocabulary(libA)
    expect(v.tags.map(t => t.name)).toContain('宝箱')
    const f = await api.folders.tree(libA)
    expect(f.root.children.map(c => c.name)).toContain('props')
    const t = await api.tags.list(libA)
    expect(t.tags.find(x => x.name === '宝箱')!.count).toBeGreaterThan(0)
    const i = await api.issues.list(libA)
    expect(Array.isArray(i.issues)).toBe(true)
    const j = await api.jobs.overview(libA)
    expect(j.scan).toBeDefined()
    const c = await api.creators.list(libA)
    expect(c.creators).toEqual([])
  })
})
