/**
 * ADR-069 over the REAL kernel: with no server running, a command opens the library itself, does its work and lets
 * go; a server that runs announces itself in server.json and commands use it — but only when it has the library
 * the command is about open.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHub } from '@bowerbird/core'
import { startServer, type RunningServer } from '@bowerbird/server'
import { run, type CliIO } from './program.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cli-local-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

async function bb(args: string[], cwd: string, extra: Partial<CliIO> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = await run(args, {
    out: t => out.push(t), err: t => err.push(t),
    env: { BOWERBIRD_HOME: path.join(tmp, 'home'), BOWERBIRD_ACTOR: 'agent:tester' }, cwd,
    createHub, startServer, runMcpServer: async () => { throw new Error('not used') },
    locate: () => ({ pluginsDir: null, webDir: null }), installSignalHandlers: false,
    // never look at the default address: another Bowerbird may run on this machine
    defaultUrl: null,
    ...extra
  })
  const text = out.join('\n')
  let json: any
  try { json = JSON.parse(text) } catch { json = undefined }
  return { code, out: text, err: err.join('\n'), json }
}

describe('no server running (ADR-069)', () => {
  it('a command opens only the library it is about, even when this machine knows others', async () => {
    const a = path.join(tmp, 'A')
    const b = path.join(tmp, 'B')
    for (const d of [a, b]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'x.png'), d) }
    expect((await bb(['init', '.'], a)).code).toBe(0)
    expect((await bb(['init', '.'], b)).code).toBe(0)
    const opened: string[] = []
    const spyHub: CliIO['createHub'] = async o => {
      const hub = await createHub(o)
      const open = hub.library.bind(hub)
      hub.library = async (id: string) => { opened.push(id); return open(id) }
      return hub
    }
    const r = await bb(['search', '--json'], a, { createHub: spyHub })
    expect(r.code, r.err).toBe(0)
    expect(new Set(opened).size).toBe(1)
    expect(r.json.items.map((i: { path: string }) => i.path)).toEqual(['x.png'])
  }, 60_000)

  it('commands open the library themselves; init writes no .bmeta; apply writes only differences', async () => {
    const lib = path.join(tmp, 'Art')
    fs.mkdirSync(path.join(lib, 'gen'), { recursive: true })
    fs.mkdirSync(path.join(lib, 'proto'), { recursive: true })
    fs.writeFileSync(path.join(lib, 'gen', 'shop.png'), 'shop')
    fs.writeFileSync(path.join(lib, 'proto', 'shop.png'), 'proto')
    fs.writeFileSync(path.join(lib, 'tool.js'), 'js')
    expect((await bb(['init', '.'], lib)).code).toBe(0)
    const s = await bb(['search', '--json'], lib)
    expect(s.code).toBe(0)
    expect(s.json.items.map((i: { path: string }) => i.path).sort()).toEqual(['gen/shop.png', 'proto/shop.png', 'tool.js'])
    expect(fs.readdirSync(lib, { recursive: true }).some(f => String(f).endsWith('.bmeta'))).toBe(false)
    const manifest = path.join(tmp, 'm.jsonl')
    fs.writeFileSync(manifest, JSON.stringify({ path: 'gen/shop.png', tags: { add: ['效果图'] }, provenance: { method: 'ai-generate', prompt: '商店' }, relations: { add: [{ type: 'reference', to: 'proto/shop.png', role: '原型稿' }] } }) + '\n')
    const dry = await bb(['apply', manifest, '--dry-run', '--json'], lib)
    expect(dry.json.results[0].changed).toBe(true)
    expect(fs.existsSync(path.join(lib, 'gen', 'shop.png.bmeta'))).toBe(false)
    expect((await bb(['apply', manifest], lib)).code).toBe(0)
    const before = fs.readFileSync(path.join(lib, 'gen', 'shop.png.bmeta'), 'utf8')
    const again = await bb(['apply', manifest, '--json'], lib)
    expect(again.json.results[0]).toMatchObject({ changed: false })
    expect(fs.readFileSync(path.join(lib, 'gen', 'shop.png.bmeta'), 'utf8')).toBe(before)
    // only what was talked about has a .bmeta: the asset, and the counterpart its relation names
    expect(fs.existsSync(path.join(lib, 'proto', 'shop.png.bmeta'))).toBe(true)
    expect(fs.existsSync(path.join(lib, 'tool.js.bmeta'))).toBe(false)
    // 我这次改了什么: both .bmeta files written by this actor (ADR-072)
    const c = await bb(['changes', '--json'], lib)
    expect(c.json.files.sort()).toEqual(['gen/shop.png', 'gen/shop.png.bmeta', 'proto/shop.png', 'proto/shop.png.bmeta'])
    // the command let go of the library: no lock is left behind
    const locks = fs.readdirSync(path.join(tmp, 'home', 'libraries'), { recursive: true }).filter(f => String(f).endsWith('writer.lock'))
    expect(locks).toEqual([])
  }, 60_000)

  it('a running server is used when it has the library open, never one that serves another library', async () => {
    const a = path.join(tmp, 'A')
    const b = path.join(tmp, 'B')
    for (const d of [a, b]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'x.png'), d) }
    expect((await bb(['init', '.'], a)).code).toBe(0)
    expect((await bb(['init', '.'], b)).code).toBe(0)
    let served: { server: RunningServer; hub: import('@bowerbird/core').Hub; forget: () => void } | null = null
    // the server runs in its own home with library A only, and announces itself in the commands' home
    const srvHome = path.join(tmp, 'srv-home')
    const r = await bb(['serve', a, '--port', '0', '--json'], a, { env: { BOWERBIRD_HOME: srvHome }, onServe: x => { served = x } })
    expect(r.code).toBe(0)
    fs.mkdirSync(path.join(tmp, 'home'), { recursive: true })
    fs.copyFileSync(path.join(srvHome, 'server.json'), path.join(tmp, 'home', 'server.json'))
    try {
      await (await served!.hub.library(served!.hub.defaultLibraryId()!)).ready?.()
      // in A: the server's library — the tag goes through the server (it knows the actor and writes)
      const ta = await bb(['tag', 'x.png', '--add', 'A'], a)
      expect(ta.code, ta.err + ta.out).toBe(0)
      expect(JSON.parse(fs.readFileSync(path.join(a, 'x.png.bmeta'), 'utf8')).tags).toEqual(['A'])
      // in B: the server does not have it open — the command opens B itself instead of writing into A
      expect((await bb(['tag', 'x.png', '--add', 'B'], b)).code).toBe(0)
      expect(JSON.parse(fs.readFileSync(path.join(b, 'x.png.bmeta'), 'utf8')).tags).toEqual(['B'])
      expect(JSON.parse(fs.readFileSync(path.join(a, 'x.png.bmeta'), 'utf8')).tags).toEqual(['A'])
    } finally {
      served!.forget()
      await served!.server.close()
    }
    expect(fs.existsSync(path.join(srvHome, 'server.json'))).toBe(false)
  }, 60_000)
})
