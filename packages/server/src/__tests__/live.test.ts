/**
 * Tests over a real socket (fake Hub): SSE delivery, heartbeat and cleanup, LAN warning, uploads through fetch.
 */
import fs from 'node:fs'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApiClient } from '@bowerbird/schema'
import { startServer, type RunningServer } from '../index.js'
import { createFakeHub, ID1, LIB, type FakeHub, type FakeOptions } from './fake-hub.js'

let fake: FakeHub | null = null
let server: RunningServer | null = null

async function start(opts: FakeOptions & { host?: string; sseMaxBufferBytes?: number } = {}, print?: (t: string) => void) {
  fake = createFakeHub(opts)
  server = await startServer({ hub: fake.hub, host: opts.host ?? '127.0.0.1', port: 0, heartbeatMs: 40, print: print ?? (() => undefined), ...(opts.sseMaxBufferBytes ? { sseMaxBufferBytes: opts.sseMaxBufferBytes } : {}) })
  return { fake, server }
}

afterEach(async () => {
  await server?.close()
  fake?.cleanup()
  server = null
  fake = null
})

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pred: (text: string) => boolean, timeoutMs = 3000): Promise<string> {
  const dec = new TextDecoder()
  let text = ''
  const deadline = Date.now() + timeoutMs
  while (!pred(text)) {
    if (Date.now() > deadline) throw new Error(`timed out; got: ${text}`)
    const { value, done } = await reader.read()
    if (done) break
    text += dec.decode(value, { stream: true })
  }
  return text
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met')
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('SSE', () => {
  it('forwards library events with EVENT_TYPES names, sends heartbeats, cleans up on disconnect', async () => {
    const { fake, server } = await start()
    const ac = new AbortController()
    const res = await fetch(`${server.url}/api/v1/libraries/${LIB}/events`, { signal: ac.signal })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const reader = res.body!.getReader()
    await readUntil(reader, t => t.includes(': connected'))
    expect(server.app.sse.size).toBe(1)
    fake.events.emit(LIB, 'asset.created', { id: ID1, path: 'props/chest.png', by: 'agent:painter' })
    fake.events.emit('other-library', 'asset.removed', { id: ID1, reason: 'trash' })
    fake.events.emit(LIB, 'scan.progress', { running: true, phase: 'walking', done: 1, total: 5 })
    const text = await readUntil(reader, t => t.includes('event: scan.progress'))
    expect(text).toContain(`event: asset.created\ndata: ${JSON.stringify({ id: ID1, path: 'props/chest.png', by: 'agent:painter' })}\n\n`)
    expect(text).not.toContain('asset.removed')
    await readUntil(reader, t => t.includes(': ping'))
    ac.abort()
    await waitFor(() => server.app.sse.size === 0)
  })

  it('closing the server ends open streams', async () => {
    const { server } = await start()
    const res = await fetch(`${server.url}/api/v1/libraries/${LIB}/events`)
    const reader = res.body!.getReader()
    await readUntil(reader, t => t.includes(': connected'))
    const t0 = Date.now()
    await server.close()
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('a client gone while the library was still opening leaves no subscription and no heartbeat', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    let opening!: () => void
    const opened = new Promise<void>(r => { opening = r })
    const { fake, server } = await start({ openGate: async () => { opening(); await gate } })
    const ac = new AbortController()
    const pending = fetch(`${server.url}/api/v1/libraries/${LIB}/events`, { signal: ac.signal }).catch(e => e)
    await opened
    ac.abort()
    await pending
    await new Promise(r => setTimeout(r, 50))
    release()
    await new Promise(r => setTimeout(r, 100))
    expect(server.app.sse.size).toBe(0)
    fake.events.emit(LIB, 'asset.created', { id: ID1, path: 'x' })
    expect(server.app.sse.size).toBe(0)
  })

  it('drops a client that stops reading once its send buffer passes the limit', async () => {
    const { fake, server } = await start({ sseMaxBufferBytes: 64 * 1024 })
    const sock = net.connect(server.port, '127.0.0.1')
    await new Promise<void>(r => sock.once('connect', () => r()))
    sock.write(`GET /api/v1/libraries/${LIB}/events HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\n\r\n`)
    await waitFor(() => server.app.sse.size === 1)
    sock.pause() // never read again
    let closed = false
    sock.on('close', () => { closed = true })
    const big = 'x'.repeat(64 * 1024)
    for (let i = 0; i < 400 && server.app.sse.size === 1; i++) {
      fake.events.emit(LIB, 'asset.updated', { id: ID1, fields: [big] })
      await new Promise(r => setImmediate(r))
    }
    await waitFor(() => server.app.sse.size === 0, 5000)
    sock.destroy()
    expect(closed || sock.destroyed).toBe(true)
  })

  it('unknown library is a 404 before streaming', async () => {
    const { server } = await start()
    const res = await fetch(`${server.url}/api/v1/libraries/nope/events`)
    expect(res.status).toBe(404)
  })

  it('refuses event streams for foreign pages', async () => {
    const { server } = await start()
    const res = await fetch(`${server.url}/api/v1/libraries/${LIB}/events`, { headers: { origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })
})

describe('startup', () => {
  it('prints the LAN warning only when listening beyond loopback', async () => {
    const lines: string[] = []
    const a = await start({}, t => lines.push(t))
    expect(a.server.lanOpen).toBe(false)
    expect(lines).toEqual([])
    await server!.close(); fake!.cleanup(); server = null; fake = null
    const b = await start({ host: '0.0.0.0' }, t => lines.push(t))
    expect(b.server.lanOpen).toBe(true)
    expect(b.server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(lines.join('\n')).toContain('任何能访问这个地址的人，都能读写整个资产库')
    expect(lines.join('\n')).toContain('不要直接暴露到公网')
    expect(lines.join('\n')).toContain(`:${b.server.port}`)
  })
})

describe('export download', () => {
  it('a form POST gets the zip streamed in chunks, complete, for the browser to save', async () => {
    const os = await import('node:os')
    const path = await import('node:path')
    const crypto = await import('node:crypto')
    const { readZip } = await import('./zip.js')
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-zip-src-'))
    const files: Array<[string, string]> = []
    const contents = new Map<string, Buffer>()
    for (const [i, name] of ['a.png', 'b.png', 'c.png', 'notes.txt'].entries()) {
      // 3 MB of noise per image (stored), a compressible text file (deflated)
      const data = name.endsWith('.txt') ? Buffer.from('宝箱 '.repeat(200_000)) : crypto.randomBytes(3 * 1024 * 1024)
      const abs = path.join(src, name)
      fs.writeFileSync(abs, data)
      const entry = `props/${i}/${name}`
      files.push([entry, abs])
      contents.set(entry, data)
    }
    const { server } = await start({ svc: { exportFiles: async () => files } })
    const res = await fetch(`${server.url}/api/v1/libraries/${LIB}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: server.url },
      body: new URLSearchParams([['ids', ID1], ['name', 'chest.zip']]).toString()
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="chest\.zip"/)
    // streamed: no length up front, sent in chunks as the archive is written
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('transfer-encoding')).toBe('chunked')
    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    expect(chunks.length).toBeGreaterThan(1)
    const zip = readZip(Buffer.concat(chunks))
    expect([...zip.keys()].sort()).toEqual([...contents.keys()].sort())
    for (const [entry, data] of contents) expect(zip.get(entry)!.equals(data), entry).toBe(true)
    fs.rmSync(src, { recursive: true, force: true })
  })
})

describe('client over HTTP', () => {
  it('uploads with the schema client (multipart + UTF-8 file name)', async () => {
    let seen: { name: string; content: string } | null = null
    const { server } = await start({
      svc: {
        register: async (input: { fields: unknown; file: { name: string; tmpPath: string } }) => {
          seen = { name: input.file.name, content: fs.readFileSync(input.file.tmpPath, 'utf8') }
          return { asset: null, skipped: true, recordId: null, newTags: [] }
        }
      }
    })
    const client = createApiClient({ baseUrl: server.url, actor: 'agent:painter' })
    const res = await client.assets.register(LIB, { folder: 'props', onConflict: 'skip' }, { data: new TextEncoder().encode('hello'), name: '红色宝箱.png', type: 'image/png' })
    expect(res.skipped).toBe(true)
    expect(seen).toEqual({ name: '红色宝箱.png', content: 'hello' })
  })

  it('maps API errors into BowerbirdApiError', async () => {
    const { server } = await start()
    const client = createApiClient({ baseUrl: server.url })
    await expect(client.assets.get(LIB, '01936b2a-0000-7000-8000-0000000000ff')).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })
})
