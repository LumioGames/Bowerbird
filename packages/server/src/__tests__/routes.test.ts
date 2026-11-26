/**
 * Route-layer tests against a fake Hub (no core needed): endpoint table coverage, validation, error mapping,
 * actor, host/origin checks, not_local, Range, uploads, export zip, plugin routes and web modules, access control.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CoreError } from '@bowerbird/core'
import { ENDPOINTS, FS_FOLDERS_LIMIT, type EndpointName } from '@bowerbird/schema'
import { buildApp, endpointRoute, matchRoutePath, parseRange } from '../index.js'
import { createFakeHub, ID1, ID2, LIB, LIB2, type FakeHub, type FakeOptions } from './fake-hub.js'

const L = `/api/v1/libraries/${LIB}`
let fake: FakeHub | null = null
let app: Awaited<ReturnType<typeof buildApp>> | null = null

async function setup(opts: FakeOptions & { host?: string; webDir?: string; allowedOrigins?: string[] } = {}) {
  fake = createFakeHub(opts)
  app = await buildApp({ hub: fake.hub, host: opts.host ?? '127.0.0.1', webDir: opts.webDir, allowedOrigins: opts.allowedOrigins })
  return { fake, app }
}

afterEach(async () => {
  await app?.close()
  fake?.cleanup()
  app = null
  fake = null
})

function multipartBody(parts: Array<{ name: string; value: string | Buffer; filename?: string; type?: string }>) {
  const boundary = '----bbtest' + Math.random().toString(16).slice(2)
  const chunks: Buffer[] = []
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`
    if (p.filename !== undefined) head += `; filename="${p.filename}"\r\nContent-Type: ${p.type ?? 'application/octet-stream'}`
    chunks.push(Buffer.from(head + '\r\n\r\n', 'utf8'), Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value, 'utf8'), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

describe('endpoint table', () => {
  it('registers every ENDPOINTS entry', async () => {
    const { app } = await setup()
    const missing = (Object.keys(ENDPOINTS) as EndpointName[]).filter(name => {
      const { method, url } = endpointRoute(name)
      return !app.hasRoute({ method: method as 'GET', url })
    })
    expect(missing).toEqual([])
  })

  it('maps L-prefixed paths under /libraries/:library', () => {
    expect(endpointRoute('search')).toEqual({ method: 'POST', url: '/api/v1/libraries/:library/search' })
    expect(endpointRoute('plugins')).toEqual({ method: 'GET', url: '/api/v1/plugins' })
  })
})

describe('actor', () => {
  it('defaults to user:unnamed', async () => {
    const { app, fake } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/search`, payload: {} })
    expect(res.statusCode).toBe(200)
    expect((fake.last('search')!.args[1] as { actor: string }).actor).toBe('user:unnamed')
  })
  it('takes X-Bowerbird-Actor, including percent-encoded names', async () => {
    const { app, fake } = await setup()
    await app.inject({ method: 'PATCH', url: `${L}/assets/${ID1}`, headers: { 'x-bowerbird-actor': 'agent:modeler' }, payload: { description: 'x' } })
    expect((fake.last('patch')!.args[2] as { actor: string }).actor).toBe('agent:modeler')
    await app.inject({ method: 'PATCH', url: `${L}/assets/${ID1}`, headers: { 'x-bowerbird-actor': 'user:' + encodeURIComponent('林') }, payload: {} })
    expect((fake.last('patch')!.args[2] as { actor: string }).actor).toBe('user:林')
  })
  it('rejects a malformed actor with 400', async () => {
    const { app } = await setup()
    for (const bad of ['bob', 'system:scanner', 'user:', 'robot:x']) {
      const res = await app.inject({ method: 'GET', url: `${L}/vocabulary`, headers: { 'x-bowerbird-actor': bad } })
      expect(res.statusCode, bad).toBe(400)
      expect(res.json().error.code).toBe('validation_failed')
    }
  })
})

describe('validation', () => {
  it('rejects a bad body with validation_failed and issue paths', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/search`, payload: { limit: 'many' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_failed')
    expect(res.json().error.details.issues[0].path).toBe('body.limit')
  })
  it('rejects a non-GUID asset id', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: `${L}/assets/not-a-guid` })
    expect(res.statusCode).toBe(400)
  })
  it('rejects broken JSON', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/search`, headers: { 'content-type': 'application/json' }, payload: '{nope' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_failed')
  })
  it('rejects a non-JSON body on a JSON endpoint', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/search`, headers: { 'content-type': 'text/csv' }, payload: 'a,b' })
    expect(res.statusCode).toBe(400)
  })
  it('parses lineage query parameters', async () => {
    const { app, fake } = await setup()
    const res = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/lineage?direction=down&types=source,uses&depth=3` })
    expect(res.statusCode).toBe(200)
    expect(fake.last('lineage')!.args[1]).toEqual({ direction: 'down', types: ['source', 'uses'], depth: 3 })
    const bad = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/lineage?direction=sideways` })
    expect(bad.statusCode).toBe(400)
  })
  it('uses lineage defaults', async () => {
    const { app, fake } = await setup()
    await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/lineage` })
    expect(fake.last('lineage')!.args[1]).toEqual({ direction: 'up', types: ['source'], depth: 5 })
  })
  it('parses issue filters', async () => {
    const { app, fake } = await setup()
    const res = await app.inject({ method: 'GET', url: `${L}/issues?type=missing-file,broken-reference&level=error` })
    expect(res.statusCode).toBe(200)
    expect(fake.last('issues')!.args[0]).toEqual({ type: ['missing-file', 'broken-reference'], level: ['error'] })
  })
})

describe('error mapping', () => {
  const cases: Array<[CoreError['code'], number]> = [
    ['not_found', 404], ['conflict', 409], ['referenced', 409], ['cycle', 409], ['unsupported', 501], ['read_only', 403], ['not_local', 403], ['validation_failed', 400]
  ]
  for (const [code, status] of cases) {
    it(`${code} → ${status}`, async () => {
      const { app } = await setup({ svc: { trash: async () => { throw new CoreError(code, '不行', code === 'referenced' ? { referrers: [ID2] } : undefined) } } })
      const res = await app.inject({ method: 'DELETE', url: `${L}/assets/${ID1}` })
      expect(res.statusCode).toBe(status)
      expect(res.json().error.code).toBe(code)
      if (code === 'referenced') expect(res.json().error.details.referrers).toEqual([ID2])
    })
  }
  it('unexpected errors are internal and logged', async () => {
    const { app, fake } = await setup({ svc: { vocabulary: async () => { throw new TypeError('boom at /secret/path') } } })
    const res = await app.inject({ method: 'GET', url: `${L}/vocabulary` })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: 'internal', message: expect.any(String) } })
    expect(res.body).not.toContain('/secret/path')
    expect(fake.errors.length).toBe(1)
  })
  it('unknown library is not_found', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: `/api/v1/libraries/nope/vocabulary` })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })
  it('unknown API path is not_found JSON', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: `/api/v1/nothing-here` })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })
  it('passes `force` to trash', async () => {
    const { app, fake } = await setup()
    await app.inject({ method: 'DELETE', url: `${L}/assets/${ID1}?force=true` })
    expect(fake.last('trash')!.args[1]).toEqual({ force: true })
  })
  it('passes `force` to folder delete (ADR-047)', async () => {
    const { app, fake } = await setup()
    await app.inject({ method: 'DELETE', url: `${L}/folders`, payload: { path: 'props', force: true } })
    expect(fake.last('trashFolder')!.args[2]).toEqual({ force: true })
    await app.inject({ method: 'DELETE', url: `${L}/folders`, payload: { path: 'props' } })
    expect(fake.last('trashFolder')!.args[2]).toEqual({ force: false })
  })
  it('restore leaves `rename` undefined when omitted (renames automatically), passes false through', async () => {
    const { app, fake } = await setup()
    await app.inject({ method: 'POST', url: `${L}/trash/t1/restore`, payload: {} })
    expect(fake.last('restore')!.args[1]).toBeUndefined()
    await app.inject({ method: 'POST', url: `${L}/trash/t1/restore`, payload: { rename: false } })
    expect(fake.last('restore')!.args[1]).toBe(false)
  })
})

describe('host and origin checks', () => {
  it('accepts localhost and loopback hosts', async () => {
    const { app } = await setup()
    for (const host of ['localhost:7420', '127.0.0.1:7420', '[::1]:7420', 'localhost', 'app.localhost:5173']) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host } })
      expect(res.statusCode, host).toBe(200)
    }
  })
  it('rejects foreign host names (DNS rebinding)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: 'evil.example:7420' } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: 'forbidden', details: { reason: 'host' } })
  })
  it('accepts interface addresses only when listening beyond loopback', async () => {
    const os = await import('node:os')
    const nic = Object.values(os.networkInterfaces()).flat().find(n => n && !n.internal && n.family === 'IPv4')
    if (!nic) return
    let r = await setup({ host: '127.0.0.1' })
    expect((await r.app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: `${nic.address}:7420` } })).statusCode).toBe(403)
    await app!.close(); fake!.cleanup()
    r = await setup({ host: '0.0.0.0' })
    expect((await r.app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: `${nic.address}:7420` } })).statusCode).toBe(200)
    expect((await r.app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: 'evil.example' } })).statusCode).toBe(403)
  })
  it('accepts any IP literal when listening beyond loopback (Docker: the NAS address differs from the container\'s)', async () => {
    const { app } = await setup({ host: '0.0.0.0' })
    expect((await app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: '192.0.2.10:7420' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: '[2001:db8::5]:7420' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: 'nas.example' } })).statusCode).toBe(403)
    await app.close(); fake!.cleanup()
    const loop = await setup({ host: '127.0.0.1' })
    expect((await loop.app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: '192.0.2.10:7420' } })).statusCode).toBe(403)
  })
  it('accepts same-origin requests and sends no CORS headers', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/search`, headers: { host: 'localhost:7420', origin: 'http://localhost:7420' }, payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
  it('rejects cross-origin requests from pages not in the allow list', async () => {
    const { app, fake } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/assets/batch`, headers: { host: 'localhost:7420', origin: 'https://evil.example' }, payload: { ids: [ID1], patch: { trash: true } } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: 'forbidden', details: { reason: 'origin' } })
    expect(fake.last('batch')).toBeUndefined()
  })
  it('rejects Origin: null (sandboxed HTML assets) on API calls', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: `${L}/vocabulary`, headers: { host: 'localhost:7420', origin: 'null' } })
    expect(res.statusCode).toBe(403)
  })
  it('lets a sandboxed bundle page load sub-resources of its own bundle (ADR-043)', async () => {
    const { app } = await setup()
    const page = `http://localhost:7420${L}/assets/${ID1}/bundle/index.html`
    const get = (headers: Record<string, string>) => app.inject({ method: 'GET', url: `${L}/assets/${ID1}/bundle/index.html`, headers: { host: 'localhost:7420', origin: 'null', ...headers } })
    const ok = await get({ 'sec-fetch-dest': 'script', referer: page })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['access-control-allow-origin']).toBe('null')
    expect(ok.headers['content-security-policy']).toBe('sandbox allow-scripts')
    expect(ok.headers['referrer-policy']).toBe('no-referrer-when-downgrade')
    expect((await get({ 'sec-fetch-dest': 'empty', referer: `http://localhost:7420${L}/assets/${ID1}/bundle/sub/app.js` })).statusCode).toBe(200)
    // no Referer, another asset's bundle, another host, a non-bundle page, or a navigation: refused
    for (const h of <Array<Record<string, string>>>[
      { 'sec-fetch-dest': 'script' },
      { 'sec-fetch-dest': 'script', referer: `http://localhost:7420${L}/assets/${ID2}/bundle/index.html` },
      { 'sec-fetch-dest': 'script', referer: `http://localhost:7420/api/v1/libraries/${LIB2}/assets/${ID1}/bundle/index.html` },
      { 'sec-fetch-dest': 'script', referer: `http://evil.example${L}/assets/${ID1}/bundle/index.html` },
      { 'sec-fetch-dest': 'script', referer: `http://localhost:7420${L}/assets/${ID1}/file` },
      { 'sec-fetch-dest': 'document', referer: page },
      { referer: page }
    ]) {
      const r = await get(h)
      expect(r.statusCode, JSON.stringify(h)).toBe(403)
      expect(r.json().error.code).toBe('forbidden')
    }
    // the exception covers bundle reads only
    const post = await app.inject({ method: 'POST', url: `${L}/search`, headers: { host: 'localhost:7420', origin: 'null', 'sec-fetch-dest': 'empty', referer: page }, payload: {} })
    expect(post.statusCode).toBe(403)
    const file = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file`, headers: { host: 'localhost:7420', origin: 'null', 'sec-fetch-dest': 'image', referer: page } })
    expect(file.statusCode).toBe(403)
  })
  it('serves CORS only to explicitly allowed origins', async () => {
    const { app } = await setup({ allowedOrigins: ['https://tools.example'] })
    const res = await app.inject({ method: 'POST', url: `${L}/search`, headers: { host: 'localhost:7420', origin: 'https://tools.example' }, payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('https://tools.example')
    const pre = await app.inject({ method: 'OPTIONS', url: `${L}/search`, headers: { host: 'localhost:7420', origin: 'https://tools.example', 'access-control-request-method': 'POST' } })
    expect(pre.statusCode).toBe(204)
    expect(pre.headers['access-control-allow-headers']).toContain('x-bowerbird-actor')
    const preBad = await app.inject({ method: 'OPTIONS', url: `${L}/search`, headers: { host: 'localhost:7420', origin: 'https://evil.example' } })
    expect(preBad.statusCode).toBe(403)
  })
  it('accepts the host name of an allowed origin (reverse proxy)', async () => {
    const { app } = await setup({ allowedOrigins: ['https://assets.example.com'] })
    const res = await app.inject({ method: 'GET', url: '/api/v1/libraries', headers: { host: 'assets.example.com', origin: 'https://assets.example.com' } })
    expect(res.statusCode).toBe(200)
  })
})

describe('local-only actions', () => {
  it('open and reveal run for local requests', async () => {
    const { app, fake } = await setup()
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/open`, payload: {} })).statusCode).toBe(204)
    expect(fake.last('open')).toBeDefined()
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/reveal`, payload: {} })).statusCode).toBe(204)
  })
  it('open, reveal and export-to-dir answer not_local to other machines', async () => {
    const { app, fake } = await setup({ host: '0.0.0.0' })
    for (const url of [`${L}/assets/${ID1}/open`, `${L}/assets/${ID1}/reveal`]) {
      const res = await app.inject({ method: 'POST', url, payload: {}, remoteAddress: '192.168.1.20' })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('not_local')
    }
    const ex = await app.inject({ method: 'POST', url: `${L}/export`, payload: { ids: [ID1], dir: '/tmp/out' }, remoteAddress: '192.168.1.20' })
    expect(ex.json().error.code).toBe('not_local')
    expect(fake.last('open')).toBeUndefined()
    expect(fake.last('exportToDir')).toBeUndefined()
  })
  it('a request relayed by a local reverse proxy is not local', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/open`, payload: {}, headers: { 'x-forwarded-for': '203.0.113.9' } })
    expect(res.json().error.code).toBe('not_local')
  })
  it('library info reports isLocal', async () => {
    const { app } = await setup({ host: '0.0.0.0' })
    expect((await app.inject({ method: 'GET', url: L })).json().isLocal).toBe(true)
    expect((await app.inject({ method: 'GET', url: L, remoteAddress: '10.0.0.5' })).json().isLocal).toBe(false)
  })
})

describe('files and ranges', () => {
  it('serves the whole file with Accept-Ranges', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('0123456789')
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['content-disposition']).toMatch(/^inline;/)
  })
  it('serves byte ranges', async () => {
    const { app } = await setup()
    const a = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file`, headers: { range: 'bytes=2-5' } })
    expect(a.statusCode).toBe(206)
    expect(a.body).toBe('2345')
    expect(a.headers['content-range']).toBe('bytes 2-5/10')
    const b = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file`, headers: { range: 'bytes=-3' } })
    expect(b.body).toBe('789')
    const c = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file`, headers: { range: 'bytes=7-' } })
    expect(c.body).toBe('789')
    const d = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file`, headers: { range: 'bytes=50-60' } })
    expect(d.statusCode).toBe(416)
    expect(d.headers['content-range']).toBe('bytes */10')
    expect(d.json().error.code).toBe('range_not_satisfiable')
    // RFC 9110: a syntactically invalid range is ignored — the whole file, 200
    const e = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file`, headers: { range: 'bytes=5-2' } })
    expect(e.statusCode).toBe(200)
    expect(e.body).toBe('0123456789')
  })
  it('download=1 sends an attachment with the UTF-8 name', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/file?download=1` })
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="__ chest.png"; filename\*=UTF-8''%E5%AE%9D%E7%AE%B1%20chest\.png$/)
  })
  it('HEAD answers without a body', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'HEAD', url: `${L}/assets/${ID1}/file` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-length']).toBe('10')
    expect(res.body).toBe('')
  })
  it('slot files and bundle files', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/slots/tex.png` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/slots/other.png` })).statusCode).toBe(404)
    const html = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/bundle/index.html` })
    expect(html.statusCode).toBe(200)
    expect(html.headers['content-security-policy']).toBe('sandbox allow-scripts')
    expect((await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/bundle/../secret` })).statusCode).toBe(404)
    for (const bad of ['..%5Csecret', 'a%5C..%5C..%5Csecret', 'sub/..%5Cx', '.%5Cindex.html']) {
      expect((await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/bundle/${bad}` })).statusCode, bad).toBe(404)
    }
  })
  it('thumbnails: keyed URLs cache forever, missing ones are 404', async () => {
    const { app } = await setup()
    const keyed = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/thumbnail?variant=thumb&v=abc` })
    expect(keyed.statusCode).toBe(200)
    expect(keyed.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const plain = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/thumbnail` })
    expect(plain.headers['cache-control']).toBe('no-cache')
    expect((await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/thumbnail?variant=poster` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/thumbnail?variant=huge` })).statusCode).toBe(400)
  })
  it('old version content needs a version plugin', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/versions/sha256:ab/file` })
    expect(res.statusCode).toBe(501)
    expect(res.json().error.code).toBe('unsupported')
  })
  it('streams old version content when a plugin has it', async () => {
    const { app } = await setup({ svc: { versionFile: async () => ({ stream: new Blob(['old-bytes']).stream(), name: 'chest.png', mime: 'image/png' }) } })
    const res = await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/versions/sha256:ab/file` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('old-bytes')
  })
  it('parseRange edge cases', () => {
    expect(parseRange(undefined, 10)).toBeNull()
    expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 })
    expect(parseRange('bytes=0-99', 10)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull()
    expect(parseRange('bytes=5-2', 10)).toBeNull()
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable')
    expect(parseRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseRange('items=0-1', 10)).toBeNull()
  })
})

describe('uploads', () => {
  it('streams the file to a temp path and hands tmpPath to register', async () => {
    let seen: { name: string; tmpPath: string; content: string } | null = null
    const { app, fake } = await setup({
      svc: {
        register: async (input: { file: { name: string; tmpPath: string } }) => {
          seen = { ...input.file, content: fs.readFileSync(input.file.tmpPath, 'utf8') }
          return { asset: null, skipped: false, recordId: 'rec_1', newTags: [{ tag: '箱子', similar: ['宝箱'] }] }
        }
      }
    })
    const mp = multipartBody([
      { name: 'meta', value: JSON.stringify({ folder: 'props', tags: ['箱子'], record: { method: 'ai-generate', prompt: '宝箱' } }) },
      { name: 'file', value: 'PNGDATA', filename: '宝箱.png', type: 'image/png' }
    ])
    const res = await app.inject({ method: 'POST', url: `${L}/assets`, ...mp })
    expect(res.statusCode).toBe(201)
    expect(res.json().newTags[0].similar).toEqual(['宝箱'])
    expect(seen!.name).toBe('宝箱.png')
    expect(seen!.content).toBe('PNGDATA')
    expect(seen!.tmpPath.startsWith(path.join(fake.tmp, 'tmp'))).toBe(true)
    expect(fs.existsSync(seen!.tmpPath)).toBe(false)
    expect((fake.last('register')!.args[0] as { fields: unknown }).fields).toEqual({ folder: 'props', tags: ['箱子'], record: { method: 'ai-generate', prompt: '宝箱' } })
  })
  it('upload conflicts answer 409 and leave no temp file', async () => {
    let tmpPath = ''
    const { app } = await setup({ svc: { register: async (i: { file: { tmpPath: string } }) => { tmpPath = i.file.tmpPath; throw new CoreError('conflict', '目标位置已有同名文件', { existing: ID1 }) } } })
    const mp = multipartBody([{ name: 'meta', value: '{"folder":"props"}' }, { name: 'file', value: 'x', filename: 'chest.png' }])
    const res = await app.inject({ method: 'POST', url: `${L}/assets`, ...mp })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: 'conflict', details: { existing: ID1 } })
    expect(fs.existsSync(tmpPath)).toBe(false)
  })
  it('registers an in-library path from JSON', async () => {
    const { app, fake } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/assets`, payload: { path: 'props/chest.png', stage: 'runtime' } })
    expect(res.statusCode).toBe(201)
    expect(fake.last('register')!.args[0]).toEqual({ fields: { path: 'props/chest.png', stage: 'runtime' } })
  })
  it('needs a file or a path; validates meta', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'POST', url: `${L}/assets`, payload: { folder: 'x' } })).statusCode).toBe(400)
    const mp = multipartBody([{ name: 'meta', value: '{"stage":"final"}' }, { name: 'file', value: 'x', filename: 'a.png' }])
    const bad = await app.inject({ method: 'POST', url: `${L}/assets`, ...mp })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details.issues[0].path).toBe('meta.stage')
    const broken = multipartBody([{ name: 'meta', value: '{oops' }, { name: 'file', value: 'x', filename: 'a.png' }])
    expect((await app.inject({ method: 'POST', url: `${L}/assets`, ...broken })).statusCode).toBe(400)
  })
  it('replaces content from a multipart upload', async () => {
    let got: unknown[] = []
    const { app } = await setup({ svc: { replaceContent: async (...a: unknown[]) => { got = a; return (await import('./fake-hub.js')).detail() } } })
    const mp = multipartBody([{ name: 'meta', value: '{"note":"改了颜色"}' }, { name: 'file', value: 'NEW', filename: 'chest.png' }])
    const res = await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/content`, ...mp })
    expect(res.statusCode).toBe(200)
    expect(got[0]).toBe(ID1)
    expect((got[1] as { name: string }).name).toBe('chest.png')
    expect(got[2]).toBe('改了颜色')
  })
  it('manual thumbnail and render results arrive as bytes', async () => {
    const { app, fake } = await setup()
    const t = multipartBody([{ name: 'image', value: Buffer.from([1, 2, 3]), filename: 'thumbnail.webp', type: 'image/webp' }])
    expect((await app.inject({ method: 'PUT', url: `${L}/assets/${ID1}/thumbnail`, ...t })).statusCode).toBe(200)
    expect(Array.from(fake.last('setManualThumbnail')!.args[1] as Uint8Array)).toEqual([1, 2, 3])
    const r = multipartBody([
      { name: 'meta', value: JSON.stringify({ tech: { triangles: 2480 }, aspect: 1.5 }) },
      { name: 'thumb', value: Buffer.from([9]), filename: 'thumb.webp' },
      { name: 'turnaround', value: Buffer.from([8, 8]), filename: 'turnaround.webp' }
    ])
    expect((await app.inject({ method: 'PUT', url: `${L}/render/job_7`, ...r })).statusCode).toBe(204)
    const [job, parts, fields] = fake.last('renderSubmit')!.args as [string, Record<string, Uint8Array>, unknown]
    expect(job).toBe('job_7')
    expect(Object.keys(parts).sort()).toEqual(['thumb', 'turnaround'])
    expect(fields).toEqual({ tech: { triangles: 2480 }, aspect: 1.5 })
    const failed = multipartBody([{ name: 'meta', value: JSON.stringify({ error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', retryable: false }) }])
    expect((await app.inject({ method: 'PUT', url: `${L}/render/job_8`, ...failed })).statusCode).toBe(204)
    expect(fake.last('renderSubmit')!.args[2]).toEqual({ error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', retryable: false })
  })
})

describe('export', () => {
  it('without dir streams a zip', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/export`, payload: { ids: [ID1], withDeps: true } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toMatch(/attachment/)
    const buf = res.rawPayload
    expect(buf.subarray(0, 4).toString('binary')).toBe('PK\x03\x04')
    expect(buf.includes(Buffer.from('props/chest.png'))).toBe(true)
    expect(buf.includes(Buffer.from('0123456789'))).toBe(true) // .png is stored, not deflated
  })
  it('with dir copies on this machine; dir must be absolute', async () => {
    const { app, fake } = await setup()
    const ok = await app.inject({ method: 'POST', url: `${L}/export`, payload: { ids: [ID1], dir: '/tmp/out' } })
    expect(ok.json()).toEqual({ written: 1, dir: '/tmp/out', bytes: 10 })
    expect(fake.last('exportToDir')!.args[0]).toMatchObject({ ids: [ID1], dir: '/tmp/out', withDeps: false, layout: 'keep' })
    expect((await app.inject({ method: 'POST', url: `${L}/export`, payload: { ids: [ID1], dir: 'relative/out' } })).statusCode).toBe(400)
  })
  it('export plan passes through', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/export/plan`, payload: { ids: [ID1] } })
    expect(res.json().files[0].path).toBe('chest.png')
  })

  const form = (fields: Array<[string, string]>) => new URLSearchParams(fields).toString()
  const formHeaders = { 'content-type': 'application/x-www-form-urlencoded', host: 'localhost:7420', origin: 'http://localhost:7420' }

  it('a same-origin form POST downloads the zip (the browser saves it itself)', async () => {
    const { app, fake } = await setup()
    const res = await app.inject({
      method: 'POST', url: `${L}/export`, headers: formHeaders,
      payload: form([['ids', ID1], ['ids', ID2], ['withDeps', 'true'], ['layout', 'flat'], ['name', '宝箱 chest.zip']])
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toBe(`attachment; filename="__ chest.zip"; filename*=UTF-8''%E5%AE%9D%E7%AE%B1%20chest.zip`)
    expect(res.rawPayload.subarray(0, 4).toString('binary')).toBe('PK\x03\x04')
    expect(fake.last('exportFiles')!.args[0]).toEqual({ ids: [ID1, ID2], withDeps: true, layout: 'flat' })
  })
  it('form fields: comma-separated ids, defaults, and a safe file name', async () => {
    const { app, fake } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/export`, headers: formHeaders, payload: form([['ids', `${ID1},${ID2}`], ['name', '../../etc/passwd']]) })
    expect(res.statusCode).toBe(200)
    expect(fake.last('exportFiles')!.args[0]).toEqual({ ids: [ID1, ID2], withDeps: false, layout: 'keep' })
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="passwd\.zip"/)
    const plain = await app.inject({ method: 'POST', url: `${L}/export`, headers: formHeaders, payload: form([['ids', ID1]]) })
    expect(plain.headers['content-disposition']).toMatch(/^attachment; filename="bowerbird-export\.zip"/)
  })
  it('a form cannot copy into a folder on the server, and bad fields are refused', async () => {
    const { app, fake } = await setup()
    const dir = await app.inject({ method: 'POST', url: `${L}/export`, headers: formHeaders, payload: form([['ids', ID1], ['dir', '/tmp/out']]) })
    expect(dir.statusCode).toBe(400)
    expect(dir.json().error.code).toBe('validation_failed')
    expect(fake.last('exportToDir')).toBeUndefined()
    expect((await app.inject({ method: 'POST', url: `${L}/export`, headers: formHeaders, payload: form([['ids', 'junk']]) })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `${L}/export`, headers: formHeaders, payload: form([['layout', 'flat']]) })).statusCode).toBe(400)
  })
  it('a form from another site, or from a sandboxed page, is refused', async () => {
    const { app, fake } = await setup()
    for (const origin of ['https://evil.example', 'null']) {
      const res = await app.inject({ method: 'POST', url: `${L}/export`, headers: { ...formHeaders, origin }, payload: form([['ids', ID1]]) })
      expect(res.statusCode, origin).toBe(403)
      expect(res.json().error.code).toBe('forbidden')
    }
    expect(fake.last('exportFiles')).toBeUndefined()
  })
  it('the JSON request still works and may name the file too', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: `${L}/export?name=chest.zip`, payload: { ids: [ID1] } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="chest\.zip"/)
  })
})

describe('plugins', () => {
  it('lists plugins with per-library status and missing ones', async () => {
    const { app } = await setup({ svc: { info: async (ctx: { isLocal: boolean }) => ({ ...(await (await import('./fake-hub.js')).createFakeHub().svc.info(ctx as never)), requiredPlugins: [{ id: 'community.spine2', range: '^1', installed: false, enabled: false }] }) } })
    const res = await app.inject({ method: 'GET', url: '/api/v1/plugins' })
    const list = res.json().plugins as Array<{ id: string; status: string }>
    expect(list.find(p => p.id === 'bowerbird.image')!.status).toBe('enabled')
    expect(list.find(p => p.id === 'community.spine')!.status).toBe('disabled')
    expect(list.find(p => p.id === 'community.spine2')!.status).toBe('missing')
  })
  it('install, update, remove go to the plugin host', async () => {
    const { app, fake } = await setup()
    expect((await app.inject({ method: 'POST', url: '/api/v1/plugins', payload: { spec: '@acme/bb-spine' } })).statusCode).toBe(201)
    expect(fake.last('plugins.install')!.args).toEqual(['@acme/bb-spine'])
    expect((await app.inject({ method: 'POST', url: '/api/v1/plugins/community.spine/update', payload: {} })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/plugins/community.spine' })).statusCode).toBe(204)
    expect((await app.inject({ method: 'POST', url: '/api/v1/plugins', payload: {} })).statusCode).toBe(400)
  })
  it('enable/disable need core support (unsupported until then)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/v1/plugins/community.spine/enable', payload: {} })
    expect(res.statusCode).toBe(501)
  })
  it('enable/disable call LibraryService.setPluginEnabled when present', async () => {
    const { app, fake } = await setup({ svc: { setPluginEnabled: async () => undefined } as never })
    const res = await app.inject({ method: 'POST', url: '/api/v1/plugins/community.spine/disable', payload: { library: LIB } })
    expect(res.statusCode).toBe(200)
    expect(fake.last('setPluginEnabled')!.args.slice(0, 2)).toEqual(['community.spine', false])
  })
  it('machine and library settings', async () => {
    const { app, fake } = await setup()
    const put = await app.inject({ method: 'PUT', url: '/api/v1/plugins/bowerbird.image/settings', payload: { values: { maxPixelRatio: 2 } } })
    expect(put.json().values).toEqual({ maxPixelRatio: 2 })
    const lib = await app.inject({ method: 'PUT', url: `${L}/plugins/bowerbird.image/settings`, payload: { values: { defaultEnvironment: 'night' } } })
    expect(lib.statusCode).toBe(200)
    expect(fake.last('setPluginLibrarySettings')!.args.slice(0, 2)).toEqual(['bowerbird.image', { defaultEnvironment: 'night' }])
  })
  it('serves the plugin web module as an ES module with its source map', async () => {
    const dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'bb-web-'))
    fs.writeFileSync(path.join(dir, 'web.js'), 'export default {}\n//# sourceMappingURL=web.js.map\n')
    fs.writeFileSync(path.join(dir, 'web.js.map'), '{"version":3}')
    fs.writeFileSync(path.join(dir, 'chunk-a.js'), 'export const a = 1')
    const { app } = await setup({ webEntry: id => id === 'bowerbird.model' ? path.join(dir, 'web.js') : null })
    const res = await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.model/web' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(res.headers.sourcemap).toBe('web.js.map')
    const map = await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.model/web.js.map' })
    expect(map.statusCode).toBe(200)
    expect(map.headers['content-type']).toBe('application/json; charset=utf-8')
    expect((await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.model/chunk-a.js' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.model/..%2F..%2Fetc%2Fpasswd' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.image/web' })).statusCode).toBe(404)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('mounts plugin routes under /plugins/{id}/ with the library from query or header', async () => {
    const seen: any[] = []
    const { app } = await setup({
      routes: [
        { pluginId: 'bowerbird.image', route: { method: 'GET', path: 'regions/:x', handler: async r => { seen.push(r); return { body: { x: r.params.x, lib: r.library?.id } } } } },
        { pluginId: 'bowerbird.image', route: { method: 'POST', path: '/echo', handler: async r => ({ status: 201, headers: { 'content-type': 'text/plain' }, body: `got ${(r.body as { a: number }).a}` }) } },
        { pluginId: 'bowerbird.image', route: { method: 'GET', path: 'bytes', handler: async () => ({ body: new Uint8Array([1, 2]) }) } },
        { pluginId: 'bowerbird.image', route: { method: 'GET', path: 'settings', handler: async () => ({ body: 'hijacked' }) } }
      ]
    })
    const a = await app.inject({ method: 'GET', url: `/api/v1/plugins/bowerbird.image/regions/5?library=${LIB}`, headers: { 'x-bowerbird-actor': 'agent:cutter' } })
    expect(a.json()).toEqual({ x: '5', lib: LIB })
    expect(seen[0].actor).toBe('agent:cutter')
    expect(seen[0].isLocal).toBe(true)
    expect(seen[0].query).toEqual({ library: LIB })
    const b = await app.inject({ method: 'POST', url: '/api/v1/plugins/bowerbird.image/echo', headers: { 'x-bowerbird-library': LIB }, payload: { a: 3 } })
    expect(b.statusCode).toBe(201)
    expect(b.body).toBe('got 3')
    const c = await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.image/bytes' })
    expect([...c.rawPayload]).toEqual([1, 2])
    // Reserved segments stay with the kernel.
    const s = await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.image/settings' })
    expect(s.json()).toHaveProperty('values')
    expect((await app.inject({ method: 'POST', url: '/api/v1/plugins/bowerbird.image/web' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.image/unknown' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/plugins/bowerbird.image/regions/5?library=nope' })).statusCode).toBe(404)
  })
  it('plugin routes pass the same origin check', async () => {
    const { app } = await setup({ routes: [{ pluginId: 'p', route: { method: 'GET', path: 'x', handler: async () => ({ body: {} }) } }] })
    expect((await app.inject({ method: 'GET', url: '/api/v1/plugins/p/x', headers: { origin: 'https://evil.example' } })).statusCode).toBe(403)
  })
  it('matchRoutePath', () => {
    expect(matchRoutePath('regions/:x', 'regions/5')).toEqual({ x: '5' })
    expect(matchRoutePath('/a/:b/c', 'a/%E5%AE%9D/c')).toEqual({ b: '宝' })
    expect(matchRoutePath('files/*', 'files/a/b.png')).toEqual({ '*': 'a/b.png' })
    expect(matchRoutePath('a', 'a/b')).toBeNull()
    expect(matchRoutePath('a/:b', 'a')).toBeNull()
  })
})

describe('access control extension point', () => {
  it('without auth plugins every request passes (phase one)', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: `${L}/vocabulary` })).statusCode).toBe(200)
  })
  it('an auth plugin can refuse a request', async () => {
    const { app, fake } = await setup({ auth: [{ pluginId: 'acme.login', provider: { id: 'login', check: async () => ({ allow: false, status: 401, message: '请先登录' }) } }] })
    const res = await app.inject({ method: 'POST', url: `${L}/search`, payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toMatchObject({ code: 'forbidden', message: '请先登录' })
    expect(fake.last('search')).toBeUndefined()
    // health stays reachable
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200)
  })
  it('a recognized name becomes the actor', async () => {
    const checked: any[] = []
    const { app, fake } = await setup({ auth: [{ pluginId: 'acme.login', provider: { id: 'login', check: async r => { checked.push(r); return { allow: true, actor: 'user:lin' } } } }] })
    await app.inject({ method: 'PATCH', url: `${L}/assets/${ID1}`, payload: {}, headers: { 'x-bowerbird-actor': 'user:someone-else' } })
    expect((fake.last('patch')!.args[2] as { actor: string }).actor).toBe('user:lin')
    expect(checked[0]).toMatchObject({ method: 'PATCH', isLocal: true })
    // global endpoints are checked against every library's providers
    await app.inject({ method: 'GET', url: '/api/v1/libraries' })
    expect(checked.length).toBe(2)
  })

  const deny = { pluginId: 'acme.login', provider: { id: 'login', check: async () => ({ allow: false, message: '请先登录' }) } }
  const allowAs = (name: string) => ({ pluginId: 'acme.sso', provider: { id: 'sso', check: async () => ({ allow: true, actor: name }) } })

  it('an unknown library in the path is 404, not waved through', async () => {
    const { app } = await setup({ auth: [deny] })
    const res = await app.inject({ method: 'POST', url: '/api/v1/libraries/nope/search', payload: {} })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })

  it('global endpoints ask every library; ?library= and X-Bowerbird-Library cannot pick a lenient gate', async () => {
    const other = createFakeHub({ libraryId: LIB2 }) // no auth plugin
    const { app, fake } = await setup({ auth: [deny], extra: [other] })
    const tries: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; payload?: unknown; headers?: Record<string, string> }> = [
      { method: 'POST', url: '/api/v1/plugins', payload: { spec: '@acme/evil' } },
      { method: 'POST', url: `/api/v1/plugins?library=${LIB2}`, payload: { spec: '@acme/evil' } },
      { method: 'POST', url: '/api/v1/plugins?library=nope', payload: { spec: '@acme/evil' } },
      { method: 'POST', url: '/api/v1/plugins', payload: { spec: '@acme/evil' }, headers: { 'x-bowerbird-library': LIB2 } },
      { method: 'POST', url: '/api/v1/plugins/community.spine/update?library=nope', payload: {} },
      { method: 'DELETE', url: `/api/v1/plugins/community.spine?library=${LIB2}` },
      { method: 'PUT', url: `/api/v1/plugins/community.spine/settings?library=${LIB2}`, payload: { values: {} } },
      { method: 'PATCH', url: `/api/v1/config?library=${LIB2}`, payload: { port: 1 } },
      { method: 'POST', url: `/api/v1/libraries?library=${LIB2}`, payload: { root: '/srv/x' } },
      { method: 'POST', url: `/api/v1/plugins/bowerbird.image/regions?library=${LIB2}`, payload: {} }
    ]
    for (const t of tries) {
      const res = await app.inject({ method: t.method, url: t.url, payload: t.payload as never, headers: t.headers })
      expect(res.statusCode, `${t.method} ${t.url}`).toBe(403)
      expect(res.json().error.code).toBe('forbidden')
    }
    expect(fake.last('plugins.install')).toBeUndefined()
    expect(fake.last('plugins.remove')).toBeUndefined()
    // a library endpoint is checked by that library's own plugins: the other library has none
    expect((await app.inject({ method: 'POST', url: `/api/v1/libraries/${LIB2}/search`, payload: {} })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `${L}/search`, payload: {} })).statusCode).toBe(403)
    other.cleanup()
  })

  it('a refusal in another library also refuses global endpoints', async () => {
    const other = createFakeHub({ libraryId: LIB2, auth: [deny] })
    const { app } = await setup({ extra: [other] })
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: `${L}/vocabulary` })).statusCode).toBe(200)
    other.cleanup()
  })

  it('the actor is the first name any provider gives', async () => {
    const other = createFakeHub({ libraryId: LIB2, auth: [allowAs('user:second')] })
    const { app, fake } = await setup({ auth: [allowAs('user:first'), allowAs('user:also')], extra: [other] })
    await app.inject({ method: 'POST', url: '/api/v1/plugins', payload: { spec: 'x' }, headers: { 'x-bowerbird-actor': 'user:claimed' } })
    expect(fake.last('plugins.install')).toBeDefined()
    await app.inject({ method: 'PATCH', url: `${L}/assets/${ID1}`, payload: {} })
    expect((fake.last('patch')!.args[2] as { actor: string }).actor).toBe('user:first')
    other.cleanup()
  })
})

describe('writeOnly plugin settings', () => {
  const schemas = {
    'community.forge': {
      type: 'object',
      properties: {
        endpoint: { type: 'string', scope: 'library' },
        apiKey: { type: 'string', scope: 'machine', writeOnly: true },
        simulate: { type: 'string', scope: 'machine' }
      }
    }
  }
  it('are never returned in clear; placeholders and omissions keep the stored value; null clears', async () => {
    const { app, fake } = await setup({ schemas })
    const url = '/api/v1/plugins/community.forge/settings'
    const put1 = await app.inject({ method: 'PUT', url, payload: { values: { apiKey: 'fk_secret_1234', simulate: 'none' } } })
    expect(put1.json().values).toEqual({ apiKey: { set: true }, simulate: 'none' })
    expect(put1.body).not.toContain('fk_secret')
    const get = await app.inject({ method: 'GET', url })
    expect(get.json().values).toEqual({ apiKey: { set: true }, simulate: 'none' })
    // the settings page sends the placeholder back while changing something else
    await app.inject({ method: 'PUT', url, payload: { values: { apiKey: { set: true }, simulate: 'unavailable' } } })
    expect(fake.hub.plugins.machineSettings('community.forge')).toEqual({ apiKey: 'fk_secret_1234', simulate: 'unavailable' })
    await app.inject({ method: 'PUT', url, payload: { values: { simulate: 'none' } } })
    expect(fake.hub.plugins.machineSettings('community.forge').apiKey).toBe('fk_secret_1234')
    await app.inject({ method: 'PUT', url, payload: { values: { apiKey: 'fk_new_9' } } })
    expect(fake.hub.plugins.machineSettings('community.forge').apiKey).toBe('fk_new_9')
    // GET /config and PATCH /config mask them too
    const cfg = await app.inject({ method: 'GET', url: '/api/v1/config' })
    expect(cfg.json().config.plugins['community.forge']).toEqual({ apiKey: { set: true }, simulate: 'none' })
    expect(cfg.body).not.toContain('fk_new_9')
    let patched: any = null
    const orig = fake.hub.patchConfig
    fake.hub.patchConfig = async p => { patched = p; return orig(p) }
    const pc = await app.inject({ method: 'PATCH', url: '/api/v1/config', payload: { plugins: { 'community.forge': { apiKey: { set: true }, simulate: 'none' } } } })
    expect(patched.plugins['community.forge'].apiKey).toBe('fk_new_9')
    expect(pc.body).not.toContain('fk_new_9')
    // clearing
    await app.inject({ method: 'PUT', url, payload: { values: { apiKey: null } } })
    expect((await app.inject({ method: 'GET', url })).json().values).toEqual({ simulate: 'none' })
  })
  it('unknown plugins: every stored value is masked', async () => {
    const { app } = await setup()
    await app.inject({ method: 'PUT', url: '/api/v1/plugins/gone.plugin/settings', payload: { values: { token: 'abc' } } })
    const cfg = (await app.inject({ method: 'GET', url: '/api/v1/config' })).json()
    expect(cfg.config.plugins['gone.plugin']).toEqual({ token: { set: true } })
  })
  it('library-scoped settings are masked the same way', async () => {
    let stored: Record<string, unknown> = { endpoint: 'https://x', apiKey: 'fk_lib_7' }
    const { app } = await setup({
      schemas,
      svc: {
        pluginLibrarySettings: async () => ({ ...stored }),
        setPluginLibrarySettings: async (_id: string, v: Record<string, unknown>) => { stored = v }
      }
    })
    const url = `${L}/plugins/community.forge/settings`
    expect((await app.inject({ method: 'GET', url })).json().values).toEqual({ endpoint: 'https://x', apiKey: { set: true } })
    await app.inject({ method: 'PUT', url, payload: { values: { endpoint: 'https://y', apiKey: { set: true } } } })
    expect(stored).toEqual({ endpoint: 'https://y', apiKey: 'fk_lib_7' })
  })
})

describe('library root, actions', () => {
  it('reveal the library root: local only', async () => {
    const { app, fake } = await setup({ host: '0.0.0.0' })
    expect((await app.inject({ method: 'POST', url: `${L}/reveal`, payload: {} })).statusCode).toBe(204)
    expect(fake.last('reveal')!.args[0]).toBeNull()
    const remote = await app.inject({ method: 'POST', url: `${L}/reveal`, payload: {}, remoteAddress: '192.168.1.20' })
    expect(remote.statusCode).toBe(403)
    expect(remote.json().error.code).toBe('not_local')
    expect((await app.inject({ method: 'POST', url: '/api/v1/libraries/nope/reveal', payload: {} })).statusCode).toBe(404)
  })
  it('lists actions for a selection and runs one', async () => {
    const { app, fake } = await setup()
    const list = await app.inject({ method: 'GET', url: `${L}/actions?ids=${ID1},${ID2}` })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual({ actions: [{ id: 'acme.tools:trim', pluginId: 'acme.tools', pluginName: 'Acme 工具', title: '裁掉透明边' }] })
    expect(fake.last('actions')!.args[0]).toEqual([ID1, ID2])
    expect((await app.inject({ method: 'GET', url: `${L}/actions?ids=junk` })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: `${L}/actions` })).json()).toEqual({ actions: [] })
    const run = await app.inject({ method: 'POST', url: `${L}/actions/acme.tools:trim/runs`, payload: { ids: [ID1], params: { margin: 2 } }, headers: { 'x-bowerbird-actor': 'agent:cutter' } })
    expect(run.statusCode).toBe(202)
    expect(run.json()).toMatchObject({ id: 'job_a1', kind: 'action', by: 'agent:cutter' })
    expect(fake.last('runAction')!.args.slice(0, 2)).toEqual(['acme.tools:trim', { ids: [ID1], params: { margin: 2 } }])
    expect((await app.inject({ method: 'POST', url: `${L}/actions/acme.tools:trim/runs`, payload: { ids: [] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `${L}/actions/nope/runs`, payload: { ids: [ID1] } })).statusCode).toBe(404)
  })
  it('answers unsupported while the kernel has no actions', async () => {
    const { app } = await setup({ svc: { actions: undefined, runAction: undefined } as never })
    const a = await app.inject({ method: 'GET', url: `${L}/actions?ids=${ID1}` })
    expect(a.statusCode).toBe(501)
    expect(a.json().error.code).toBe('unsupported')
    expect((await app.inject({ method: 'POST', url: `${L}/actions/x/runs`, payload: { ids: [ID1] } })).statusCode).toBe(501)
  })
})

describe('folder chooser (GET /fs/folders) and 新建资产库 (POST /libraries create)', () => {
  const FS = '/api/v1/fs/folders'
  const at = (p?: string) => (p === undefined ? FS : `${FS}?path=${encodeURIComponent(p)}`)
  /** A small disk: folders a, B, c2, c10, a hidden one, a library, a file and a link to a folder. */
  function disk(): string {
    const dir = fs.mkdtempSync(path.join(fake!.tmp, 'disk-'))
    for (const d of ['a', 'B', 'c10', 'c2', '.hidden', 'starfall/.bowerbird', 'a/inner']) fs.mkdirSync(path.join(dir, d), { recursive: true })
    fs.writeFileSync(path.join(dir, 'starfall/.bowerbird/library.json'), '{}')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a folder')
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'link-to-a'))
    fs.symlinkSync(path.join(dir, 'gone'), path.join(dir, 'dangling'))
    return dir
  }

  it('lists only folders, sorted by name, hidden ones left out, libraries marked; parent and home', async () => {
    const { app } = await setup()
    const dir = disk()
    const res = await app.inject({ method: 'GET', url: at(dir) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.path).toBe(dir)
    expect(body.parent).toBe(path.dirname(dir))
    expect(body.home).toBe(path.resolve(os.homedir()))
    expect(body.library).toBe(false)
    expect(body.truncated).toBe(false)
    expect(body.folders.map((f: { name: string }) => f.name)).toEqual(['a', 'B', 'c2', 'c10', 'link-to-a', 'starfall'])
    expect(body.folders.find((f: { name: string }) => f.name === 'starfall')).toEqual({ name: 'starfall', path: path.join(dir, 'starfall'), library: true })
    expect(body.folders.filter((f: { library: boolean }) => f.library).map((f: { name: string }) => f.name)).toEqual(['starfall'])
    expect(body.folders.find((f: { name: string }) => f.name === 'a').path).toBe(path.join(dir, 'a'))
    // the listed folder itself can be a library too
    expect((await app.inject({ method: 'GET', url: at(path.join(dir, 'starfall')) })).json()).toMatchObject({ library: true, folders: [] })
    // names only: no file and no file contents in the answer
    expect(res.body).not.toContain('notes.txt')
    expect(res.body).not.toContain('not a folder')
  })

  it('starts at the home folder; ~ is the home folder; the top of the disk has no parent', async () => {
    const { app } = await setup()
    const home = disk()
    const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
    process.env.HOME = home; process.env.USERPROFILE = home
    try {
      const res = (await app.inject({ method: 'GET', url: FS })).json()
      expect(res.path).toBe(home)
      expect(res.home).toBe(home)
      expect(res.folders.map((f: { name: string }) => f.name)).toContain('starfall')
      expect((await app.inject({ method: 'GET', url: at('~') })).json().path).toBe(home)
      expect((await app.inject({ method: 'GET', url: at('~/a') })).json()).toMatchObject({ path: path.join(home, 'a'), parent: home, folders: [{ name: 'inner' }] })
    } finally {
      for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
    const top = (await app.inject({ method: 'GET', url: at(path.parse(home).root) })).json()
    expect(top.parent).toBeNull()
  })

  it('a bad path is 400 validation_failed with the reason', async () => {
    const { app } = await setup()
    const dir = disk()
    for (const [p, reason] of [['relative/path', 'not_absolute'], [path.join(dir, 'missing'), 'not_found'], [path.join(dir, 'notes.txt'), 'not_directory']] as const) {
      const res = await app.inject({ method: 'GET', url: at(p) })
      expect(res.statusCode, p).toBe(400)
      expect(res.json().error.code).toBe('validation_failed')
      expect(res.json().error.details.reason, p).toBe(reason)
    }
  })

  it('only for a browser on this computer: another machine, or a relayed request, is 403 not_local', async () => {
    const { app } = await setup({ host: '0.0.0.0' })
    const dir = disk()
    const remote = await app.inject({ method: 'GET', url: at(dir), remoteAddress: '192.168.1.20' })
    expect(remote.statusCode).toBe(403)
    expect(remote.json().error.code).toBe('not_local')
    expect(remote.body).not.toContain('starfall')
    const relayed = await app.inject({ method: 'GET', url: at(dir), headers: { 'x-forwarded-for': '203.0.113.9' } })
    expect(relayed.json().error.code).toBe('not_local')
    expect((await app.inject({ method: 'GET', url: at(dir) })).statusCode).toBe(200)
  })

  it(`lists at most ${FS_FOLDERS_LIMIT} folders and says when there were more`, async () => {
    const { app } = await setup()
    const dir = fs.mkdtempSync(path.join(fake!.tmp, 'many-'))
    for (let i = 0; i <= FS_FOLDERS_LIMIT; i++) fs.mkdirSync(path.join(dir, `f${String(i).padStart(4, '0')}`))
    const res = (await app.inject({ method: 'GET', url: at(dir) })).json()
    expect(res.truncated).toBe(true)
    expect(res.folders).toHaveLength(FS_FOLDERS_LIMIT)
    expect(res.folders[0].name).toBe('f0000')
    expect(res.folders.at(-1).name).toBe(`f${String(FS_FOLDERS_LIMIT - 1).padStart(4, '0')}`)
    fs.rmSync(path.join(dir, 'f0000'), { recursive: true })
    const exact = (await app.inject({ method: 'GET', url: at(dir) })).json()
    expect(exact.truncated).toBe(false)
    expect(exact.folders).toHaveLength(FS_FOLDERS_LIMIT)
  })

  it('create: a missing or empty folder is registered; one holding anything is 409 conflict and nothing is registered', async () => {
    const { app, fake } = await setup()
    const dir = disk()
    const fresh = path.join(dir, '我的资产库')
    const ok = await app.inject({ method: 'POST', url: '/api/v1/libraries', payload: { root: fresh, name: '我的资产库', create: true } })
    expect(ok.statusCode).toBe(201)
    expect(fake.last('hub.addLibrary')!.args).toEqual([fresh, '我的资产库'])
    fs.writeFileSync(path.join(dir, 'c2', '.DS_Store'), '')
    expect((await app.inject({ method: 'POST', url: '/api/v1/libraries', payload: { root: path.join(dir, 'c2'), create: true } })).statusCode).toBe(201)
    const before = fake.calls.filter(c => c.method === 'hub.addLibrary').length
    for (const taken of [path.join(dir, 'a'), path.join(dir, 'starfall'), path.join(dir, 'notes.txt')]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/libraries', payload: { root: taken, create: true } })
      expect(res.statusCode, taken).toBe(409)
      expect(res.json().error).toMatchObject({ code: 'conflict', details: { reason: 'not_empty', path: taken } })
    }
    expect(fake.calls.filter(c => c.method === 'hub.addLibrary').length).toBe(before)
    // without create, a folder with files is added as before (first open)
    expect((await app.inject({ method: 'POST', url: '/api/v1/libraries', payload: { root: path.join(dir, 'a') } })).statusCode).toBe(201)
  })
})

describe('other endpoints', () => {
  it('libraries, health, config', async () => {
    const { app, fake } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/v1/libraries' })).json()).toMatchObject({ defaultId: LIB, libraries: [{ id: LIB }] })
    const h = (await app.inject({ method: 'GET', url: '/api/v1/health' })).json()
    expect(h).toMatchObject({ status: 'ok', version: expect.any(String), libraries: [{ id: LIB, index: 'ready', scan: { phase: 'idle' } }] })
    const add = await app.inject({ method: 'POST', url: '/api/v1/libraries', payload: { root: '/srv/lib-b', name: 'B' } })
    expect(add.statusCode).toBe(201)
    expect(fake.last('hub.addLibrary')!.args).toEqual(['/srv/lib-b', 'B'])
    const cfg = await app.inject({ method: 'GET', url: '/api/v1/config' })
    expect(cfg.json()).toMatchObject({ config: { port: 7420 }, dataDir: fake.tmp, restartRequired: false })
    const patched = await app.inject({ method: 'PATCH', url: '/api/v1/config', payload: { port: 7421 } })
    expect(patched.json().restartRequired).toBe(true)
    // a page reloaded after that still learns a restart is pending (Hub.restartPending)
    fake.hub.restartPending = () => true
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().restartRequired).toBe(true)
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/config', payload: { port: 'x' } })).statusCode).toBe(400)
  })
  it('patches pass on only the fields the client sent (no schema defaults)', async () => {
    let got: unknown = null
    const { app, fake } = await setup()
    const orig = fake.hub.patchConfig
    fake.hub.patchConfig = async p => { got = p; return orig(p) }
    await app.inject({ method: 'PATCH', url: '/api/v1/config', payload: { port: 7421 } })
    expect(got).toEqual({ port: 7421 })
    await app.inject({ method: 'PATCH', url: L, payload: { settings: { trashDays: 30 } } })
    expect(fake.last('patchLibrary')!.args[0]).toEqual({ settings: { trashDays: 30 } })
    await app.inject({ method: 'PATCH', url: L, payload: { name: '新名字' } })
    expect(fake.last('patchLibrary')!.args[0]).toEqual({ name: '新名字' })
  })
  it('rescan starts in the background', async () => {
    let resolve!: () => void
    const { app, fake } = await setup({ svc: { rescan: () => new Promise<void>(r => { resolve = r }) } })
    const res = await app.inject({ method: 'POST', url: `${L}/rescan`, payload: { path: 'props' } })
    expect(res.statusCode).toBe(202)
    expect(fake.last('rescan')!.args[0]).toBe('props')
    resolve()
  })
  it('rescan errors in the first moments reach the caller', async () => {
    const { app } = await setup({ svc: { rescan: async () => { throw new CoreError('not_found', '没有这个文件夹') } } })
    expect((await app.inject({ method: 'POST', url: `${L}/rescan`, payload: { path: 'nope' } })).statusCode).toBe(404)
  })
  it('records, relations, retarget, folders, tags, views, trash, jobs', async () => {
    const { app, fake } = await setup()
    const rec = await app.inject({ method: 'POST', url: `${L}/records`, payload: { method: 'ai-generate', prompt: '红色宝箱' }, headers: { 'x-bowerbird-actor': 'agent:painter' } })
    expect(rec.statusCode).toBe(201)
    expect(rec.json()).toMatchObject({ id: 'rec_1', record: { by: 'agent:painter' } })
    expect((await app.inject({ method: 'GET', url: `${L}/records/rec_1` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `${L}/records/rec_404` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `${L}/records/rec_1/notes`, payload: { text: '' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/relations`, payload: { type: 'uses', to: ID2, slot: 'tex.png' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `${L}/assets/${ID1}/relations`, payload: { type: 'uses', to: ID2 } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/relations/replace`, payload: { type: 'uses', to: ID2, newTo: ID1 } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/relations/acknowledge`, payload: { to: ID2 } })).statusCode).toBe(200)
    const rt = await app.inject({ method: 'POST', url: `${L}/relations/retarget`, payload: { from: ID1, to: ID2 } })
    expect(rt.json().applied).toBe(false)
    expect(fake.last('retarget')!.args[0]).toMatchObject({ dryRun: true })
    expect((await app.inject({ method: 'POST', url: `${L}/folders`, payload: { path: 'props/new' } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'PATCH', url: `${L}/folders`, payload: { path: 'props', label: '道具' } })).json()).toHaveProperty('root')
    expect((await app.inject({ method: 'DELETE', url: `${L}/folders`, payload: { path: 'props/new' } })).json()).toEqual({ trashed: 0, batch: null })
    expect((await app.inject({ method: 'POST', url: `${L}/folders/bundle`, payload: { path: 'proto' } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: `${L}/tags/accept`, payload: {} })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `${L}/tags/dismiss`, payload: { all: true } })).statusCode).toBe(200)
    expect(fake.last('dismissTagEverywhere')!.args[0]).toBeNull()
    expect((await app.inject({ method: 'PUT', url: `${L}/views/${encodeURIComponent('AI 生成待审')}`, payload: { query: { filter: { review: ['pending'] } } } })).statusCode).toBe(200)
    expect(fake.last('putView')!.args[0]).toBe('AI 生成待审')
    expect((await app.inject({ method: 'POST', url: `${L}/trash/t1/restore`, payload: { rename: true } })).statusCode).toBe(200)
    expect(fake.last('restore')!.args.slice(0, 2)).toEqual(['t1', true])
    expect((await app.inject({ method: 'DELETE', url: `${L}/trash/t1` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `${L}/trash` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `${L}/jobs/j1` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `${L}/jobs/retry`, payload: { failed: true } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `${L}/creators` })).json()).toEqual({ creators: [] })
    expect((await app.inject({ method: 'POST', url: `${L}/creators/nope/runs`, payload: { params: {} } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `${L}/render/next?visible=${ID1},junk` })).json()).toEqual({ task: null })
    expect(fake.last('renderNext')!.args[0]).toEqual([ID1])
    expect((await app.inject({ method: 'POST', url: `${L}/assets/batch`, payload: { ids: [ID1], patch: { stage: 'runtime' } } })).json()).toEqual({ updated: [ID1], failed: [] })
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/review`, payload: { status: 'rejected', note: '比例不对' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/copy`, payload: {} })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: `${L}/assets/${ID1}/move`, payload: { folder: 'props/old' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `${L}/assets/${ID1}/summary` })).json().imageMissingReason).toContain('概览图还没有渲染')
    expect((await app.inject({ method: 'POST', url: `${L}/libraries`.replace(L, '') })).statusCode).toBe(404)
  })
})

describe('web shell hosting', () => {
  it('serves files and falls back to index.html outside /api', async () => {
    const os = await import('node:os')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-shell-'))
    fs.mkdirSync(path.join(dir, 'assets'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Bowerbird</title>')
    fs.writeFileSync(path.join(dir, 'assets', 'app-1234.js'), 'console.log(1)')
    const { app } = await setup({ webDir: dir })
    const root = await app.inject({ method: 'GET', url: '/' })
    expect(root.statusCode).toBe(200)
    expect(root.body).toContain('Bowerbird')
    const deep = await app.inject({ method: 'GET', url: `/libraries/${LIB}/browse` })
    expect(deep.statusCode).toBe(200)
    expect(deep.body).toContain('Bowerbird')
    expect(deep.headers['cache-control']).toBe('no-cache')
    // the shell page may only load from this server (viewers cannot reach addresses named inside asset files)
    for (const res of [root, deep]) {
      const csp = String(res.headers['content-security-policy'])
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("connect-src 'self' data: blob:")
      expect(csp).toContain("img-src 'self' data: blob:")
      expect(csp).toContain("object-src 'none'")
    }
    const asset = await app.inject({ method: 'GET', url: '/assets/app-1234.js' })
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404)
    const api = await app.inject({ method: 'GET', url: '/api/v1/nope' })
    expect(api.statusCode).toBe(404)
    expect(api.json().error.code).toBe('not_found')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('pages whose path has a dot (plugin ids) still get the shell; missing files do not', async () => {
    const os = await import('node:os')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-shell-'))
    fs.mkdirSync(path.join(dir, 'assets'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Bowerbird</title>')
    fs.writeFileSync(path.join(dir, 'favicon.svg'), '<svg/>')
    const { app } = await setup({ webDir: dir })
    const page = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'sec-fetch-dest': 'document' }
    // opened directly or refreshed: /libraries/{id}/settings/community.forge
    for (const url of [`/libraries/${LIB}/settings/community.forge`, `/libraries/${LIB}/plugins/bowerbird.model/viewer?x=1`, `/libraries/${LIB}/browse/v1.2`]) {
      const res = await app.inject({ method: 'GET', url, headers: page })
      expect(res.statusCode, url).toBe(200)
      expect(res.headers['content-type'], url).toMatch(/^text\/html/)
      expect(res.body, url).toContain('Bowerbird')
      expect(String(res.headers['content-security-policy']), url).toContain("default-src 'self'")
      expect(res.headers['cache-control'], url).toBe('no-cache')
    }
    // a navigation that does not say text/html in Accept is still a page
    expect((await app.inject({ method: 'GET', url: `/libraries/${LIB}/settings/community.forge`, headers: { 'sec-fetch-dest': 'document' } })).statusCode).toBe(200)
    // real files are still files; the shell's asset folder never falls back, even for a page request
    const icon = await app.inject({ method: 'GET', url: '/favicon.svg', headers: page })
    expect(icon.body).toBe('<svg/>')
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js', headers: page })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/assets/sub/missing.css' })).statusCode).toBe(404)
    // a missing file asked for as a sub-resource (image, script) is a 404, not an HTML page
    expect((await app.inject({ method: 'GET', url: '/missing.png', headers: { accept: 'image/avif,image/webp,*/*', 'sec-fetch-dest': 'image' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/chunk-x.js', headers: { accept: '*/*', 'sec-fetch-dest': 'script' } })).statusCode).toBe(404)
    // the API never falls back
    expect((await app.inject({ method: 'GET', url: '/api/v1/plugins/x.y/z.js', headers: page })).statusCode).toBe(404)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
