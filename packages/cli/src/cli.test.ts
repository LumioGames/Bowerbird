/**
 * CLI tests: argument parsing and `--json` output. HTTP commands run against the real server package backed by
 * the server's fake Hub; init/serve/plugin use an injected hub factory; mcp an injected runner.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CoreError, type Hub } from '@bowerbird/core'
import { startServer, type RunningServer } from '@bowerbird/server'
import { createFakeHub, ID1, ID2, LIB, type FakeHub } from '../../server/src/__tests__/fake-hub.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '@bowerbird/mcp'
import { run, type CliIO } from './program.js'
import { locateAssets } from './locate.js'

let fake: FakeHub
let server: RunningServer
let tmp: string

beforeAll(async () => {
  fake = createFakeHub({
    svc: {
      register: async (input: { fields: Record<string, unknown>; file?: { name: string } }) => {
        if (input.file?.name === 'conflict.png') throw new CoreError('conflict', '目标位置已有同名文件')
        return { asset: (await import('../../server/src/__tests__/fake-hub.js')).detail(), skipped: false, newTags: [] }
      },
      trash: async (id: string, opts: { force: boolean }) => {
        if (id === ID2 && !opts.force) throw new CoreError('referenced', '该资产被 1 个资产引用', { referrers: [ID1] })
        return { trashId: 'trash_1', referrers: id === ID2 ? [ID1] : [] }
      }
    }
  })
  server = await startServer({ hub: fake.hub, host: '127.0.0.1', port: 0, print: () => undefined })
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cli-'))
})
afterAll(async () => {
  await server.close()
  fake.cleanup()
  fs.rmSync(tmp, { recursive: true, force: true })
})
beforeEach(() => { fake.calls.length = 0 })

interface Ran { code: number; out: string; err: string; json: any }

async function bb(args: string[], extra: Partial<CliIO> = {}): Promise<Ran> {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = {
    out: t => out.push(t), err: t => err.push(t), env: { BOWERBIRD_URL: server.url, BOWERBIRD_HOME: path.join(tmp, 'home') }, cwd: tmp,
    createHub: async () => { throw new Error('createHub not expected') },
    startServer: async () => { throw new Error('startServer not expected') },
    runMcpServer: async () => { throw new Error('runMcpServer not expected') },
    locate: () => ({ pluginsDir: '/opt/bb/plugins', webDir: null }),
    installSignalHandlers: false,
    ...extra
  }
  const code = await run(args, io)
  const text = out.join('\n')
  let json: unknown
  try { json = JSON.parse(text) } catch { json = undefined }
  return { code, out: text, err: err.join('\n'), json }
}

describe('search', () => {
  it('parses the text syntax into the query model', async () => {
    const r = await bb(['search', 'stage:runtime', 'format:model', 'tag:宝箱', '-tag:废弃', 'tris:<5000', '红色', '宝箱', '--limit', '10', '--sort', 'name'])
    expect(r.code).toBe(0)
    expect(fake.last('search')!.args[0]).toEqual({
      q: '红色 宝箱', sort: 'name', limit: 10,
      filter: { stage: ['runtime'], format: ['model'], tags: { all: ['宝箱'], none: ['废弃'] }, tech: { triangles: { lt: 5000 } } }
    })
    expect(r.out).toContain(`${ID1} props/chest.png image 阶段=production 校验=pending 标签=宝箱`)
  })
  it('--json prints the API response', async () => {
    const r = await bb(['search', '--json'])
    expect(r.json.items[0].id).toBe(ID1)
    expect(r.json.total).toBe(1)
  })
  it('global options work before or after the subcommand', async () => {
    const a = await bb(['--json', '--library', LIB, 'search', 'x'])
    const b = await bb(['search', 'x', '--library', LIB, '--json'])
    expect(a.json).toEqual(b.json)
  })
  it('with --json, argument errors are JSON on stdout too', async () => {
    for (const args of [['search', '--limit', '0', '--json'], ['serve', '--port', 'x', '--json'], ['tag', '--json'], ['search', '--sort', 'random', '--json'], ['apply', '--items', '{nope', '--json'], ['nope', '--json']]) {
      const r = await bb(args)
      expect(r.code, args.join(' ')).not.toBe(0)
      expect(r.err, args.join(' ')).toBe('')
      expect(r.json?.error?.code, args.join(' ')).toBe('validation_failed')
      expect(typeof r.json.error.message).toBe('string')
    }
  })
  it('rejects bad option values', async () => {
    const r = await bb(['search', '--limit', '0'])
    expect(r.code).not.toBe(0)
    expect(r.err).toContain('--limit')
    const s = await bb(['search', '--sort', 'random'])
    expect(s.code).not.toBe(0)
  })
  it('reports a server that is not running', async () => {
    const r = await bb(['search', 'x', '--server', 'http://127.0.0.1:1'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('连不上 Bowerbird 服务')
    const j = await bb(['search', 'x', '--server', 'http://127.0.0.1:1', '--json'])
    expect(j.json.error.code).toBe('network')
  })
})

describe('get / trace', () => {
  it('get by GUID and by library path', async () => {
    const a = await bb(['get', ID1, '--json'])
    expect(a.json.asset.id).toBe(ID1)
    expect(a.json.summary.imageMissingReason).toContain('概览图还没有渲染')
    const b = await bb(['get', 'props/chest.png'])
    expect(b.out).toContain(`chest.png  ${ID1}`)
    expect(b.out).toContain('阶段=production 校验=pending')
    expect((fake.last('search')!.args[0] as { filter: unknown }).filter).toEqual({ folder: 'props', folderExact: true, includeAuxiliary: true, review: ['pending', 'approved', 'rejected', 'exempt'] })
  })
  it('get by a local file path inside the library', async () => {
    const root = (await fake.svc.info({ actor: 'user:unnamed', isLocal: true })).root
    const r = await bb(['get', path.join(root, 'props', 'chest.png'), '--json'])
    expect(r.json.asset.id).toBe(ID1)
  })
  it('unknown path is an error', async () => {
    const r = await bb(['get', 'props/none.png'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('资产库里没有 props/none.png')
  })
  it('trace passes direction, types and depth', async () => {
    const r = await bb(['trace', ID1, '--direction', 'down', '--types', 'source,uses', '--depth', '2', '--json'])
    expect(r.code).toBe(0)
    expect(fake.last('lineage')!.args[1]).toEqual({ direction: 'down', types: ['source', 'uses'], depth: 2 })
    expect(r.json.center).toBe(ID1)
  })
})

describe('add', () => {
  it('uploads files outside the library with one provenance and one batch id, and source relations', async () => {
    const a = path.join(tmp, 'a.png'); fs.writeFileSync(a, 'AAA')
    const b = path.join(tmp, '红色宝箱.png'); fs.writeFileSync(b, 'BBB')
    const r = await bb(['add', 'a.png', '红色宝箱.png', '--folder', 'props', '--stage', 'production', '--tag', '宝箱', '--tag', '道具,红色',
      '--source', ID2, '--prompt', '红色的卡通宝箱', '--tool', 'sdxl', '--param', 'model=sdxl-1', '--param', 'seed=7', '--json'])
    expect(r.code).toBe(0)
    const regs = fake.calls.filter(c => c.method === 'register')
    expect(regs.length).toBe(2)
    const first = regs[0]!.args[0] as { fields: Record<string, unknown> & { provenance: { batch: string } }; file: { name: string } }
    expect(first.fields).toEqual({
      stage: 'production', tags: ['宝箱', '道具', '红色'], relations: [{ type: 'source', to: ID2 }], folder: 'props',
      provenance: { method: 'ai-generate', tool: 'sdxl', prompt: '红色的卡通宝箱', params: { model: 'sdxl-1', seed: 7 }, batch: expect.stringMatching(/^bat_/) }
    })
    expect((regs[1]!.args[0] as { fields: { provenance: { batch: string } } }).fields.provenance.batch).toBe(first.fields.provenance.batch)
    expect(r.json.batch).toBe(first.fields.provenance.batch)
    expect((regs[1]!.args[0] as { file: { name: string } }).file.name).toBe('红色宝箱.png')
    expect(r.json.registered.length).toBe(2)
    expect(r.json.failed).toBeNull()
  })
  it('a failure part-way reports what is already registered and what was not done', async () => {
    for (const n of ['one.png', 'conflict.png', 'three.png']) fs.writeFileSync(path.join(tmp, n), n)
    const r = await bb(['add', 'one.png', 'conflict.png', 'three.png', '--folder', 'props', '--method', 'manual', '--json'])
    expect(r.code).toBe(1)
    expect(r.json.registered.map((x: { file: string }) => x.file)).toEqual(['one.png'])
    expect(r.json.registered[0].result.asset.id).toBe(ID1)
    expect(r.json.failed).toEqual({ file: 'conflict.png', error: { code: 'conflict', message: '目标位置已有同名文件' }, notRun: ['three.png'] })
    const t = await bb(['add', 'one.png', 'conflict.png', 'three.png'])
    expect(t.code).toBe(1)
    expect(t.out).toContain(`已登记 ${ID1}`)
    expect(t.out).toContain('没有登记 conflict.png：目标位置已有同名文件')
    expect(t.out).toContain('没有处理：three.png')
  })
  it('registers a file already in the library in place, with its provenance', async () => {
    const root = (await fake.svc.info({ actor: 'user:unnamed', isLocal: true })).root
    const r = await bb(['add', path.join(root, 'props', 'chest.png'), '--method', 'manual'])
    expect(r.code).toBe(0)
    const reg = fake.last('register')!.args[0] as { fields: Record<string, unknown>; file?: unknown }
    expect(reg.file).toBeUndefined()
    expect(reg.fields).toEqual({ provenance: { method: 'manual' }, path: 'props/chest.png' })
    expect(r.out).toContain('已登记')
  })
  it('a missing local file is an error', async () => {
    const r = await bb(['add', 'nope.png'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('没有登记 nope.png：找不到文件')
  })
})

describe('BOWERBIRD_ACTOR', () => {
  it('a bare name counts as user:<name>; prefixed actors pass through; non-ASCII is encoded once', async () => {
    const env = (actor: string) => ({ env: { BOWERBIRD_URL: server.url, BOWERBIRD_ACTOR: actor } })
    for (const [given, recorded] of [['lin', 'user:lin'], ['林', 'user:林'], ['agent:cutter', 'agent:cutter'], ['user:莫', 'user:莫']]) {
      const r = await bb(['tag', ID1, '--add', 'x'], env(given!))
      expect(r.code, given).toBe(0)
      expect((fake.last('apply')!.args[1] as { actor: string }).actor, given).toBe(recorded)
    }
  })
})

describe('export of a bundle asset from another machine', () => {
  it('downloads each file inside the bundle under its own path', async () => {
    const BUNDLE = '01936b2a-0000-7000-8000-000000000003'
    const files = { 'index.html': 'entry', 'js/app.js': 'app', 'js/index.html': 'inner index' } as Record<string, string>
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cli-bundle-src-'))
    for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true }); fs.writeFileSync(path.join(src, rel), text) }
    const { detail } = await import('../../server/src/__tests__/fake-hub.js')
    const remote = createFakeHub({
      svc: {
        get: async () => detail({ id: BUNDLE, name: 'proto', path: 'ui/proto', bundle: true, bundleFiles: Object.keys(files).map(p => ({ path: p, size: 1, entry: p === 'index.html' })) }),
        exportPlan: async () => ({ files: Object.keys(files).map(p => ({ path: `ui/proto/${p}`, size: 1, assetId: BUNDLE, dependency: false })), bytes: 3, dependencies: 0, duplicateNames: false }),
        file: async () => ({ absPath: path.join(src, 'index.html'), size: 5, name: 'index.html', mime: 'text/html' }),
        bundleFile: async (_id: string, inner: string) => files[inner] !== undefined ? { absPath: path.join(src, inner), size: 1, name: path.basename(inner), mime: 'text/plain' } : null
      }
    })
    const srv = await startServer({ hub: remote.hub, host: '127.0.0.1', port: 0, print: () => undefined })
    // seen from the server, this client is another machine (relayed): no server-side export to a directory
    const viaProxy: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), 'x-forwarded-for': '192.0.2.7' } })
    const r = await bb(['export', BUNDLE, '--to', 'bundle-out', '--json'], { env: { BOWERBIRD_URL: srv.url }, fetch: viaProxy })
    expect(r.code).toBe(0)
    expect(remote.last('exportToDir')).toBeUndefined()
    for (const [rel, text] of Object.entries(files)) expect(fs.readFileSync(path.join(tmp, 'bundle-out/ui/proto', rel), 'utf8'), rel).toBe(text)
    await srv.close(); remote.cleanup(); fs.rmSync(src, { recursive: true, force: true })
  })
})

describe('tag / export / health / rescan / rm', () => {
  it('tag adds and removes', async () => {
    const r = await bb(['tag', ID1, '--add', '宝箱', '--add', '道具,红色', '--remove', '废弃', '--json'])
    expect(fake.last('apply')!.args[0]).toEqual({ items: [{ id: ID1, tags: { add: ['宝箱', '道具', '红色'], remove: ['废弃'] } }] })
    expect(r.json.results[0].id).toBe(ID1)
    expect((await bb(['tag', ID1])).code).toBe(1)
  })
  it('export to a directory on this machine', async () => {
    const r = await bb(['export', ID1, '--to', 'out', '--with-deps', '--flat', '--json'])
    expect(r.code).toBe(0)
    expect(fake.last('exportToDir')!.args[0]).toEqual({ ids: [ID1], withDeps: true, layout: 'flat', dir: path.join(tmp, 'out') })
    expect(r.json.written).toBe(1)
    // without --to: where the file is
    const where = await bb(['export', ID1])
    expect(where.code).toBe(0)
    expect(where.out).toMatch(/^(路径|地址)：/)
  })
  it('health filters by type and level', async () => {
    const r = await bb(['health', '--type', 'missing-file', '--level', 'error', '--json'])
    expect(fake.last('issues')!.args[0]).toEqual({ type: ['missing-file'], level: ['error'] })
    expect(r.json.total).toBe(0)
    const bad = await bb(['health', '--type', 'weird'])
    expect(bad.code).toBe(1)
  })
  it('rescan a folder', async () => {
    const r = await bb(['rescan', 'props', '--json'])
    expect(r.json).toEqual({ started: true, path: 'props' })
    expect(fake.last('rescan')!.args[0]).toBe('props')
  })
  it('rm moves to trash; referenced assets need --force', async () => {
    const r = await bb(['rm', ID1, ID2])
    expect(r.code).toBe(1)
    expect(r.out).toContain(`已移入回收站 ${ID1}`)
    expect(r.out).toContain('确认要删除请加 --force')
    const f = await bb(['rm', ID2, '--force', '--json'])
    expect(f.code).toBe(0)
    expect(f.json.trashed[0]).toEqual({ id: ID2, trashId: 'trash_1', referrers: [ID1] })
    expect(fake.last('trash')!.args[1]).toEqual({ force: true })
  })
})

describe('local commands', () => {
  function hubSpy() {
    const calls: Array<[string, unknown[]]> = []
    const opts: unknown[] = []
    const h = createFakeHub()
    const hub: Hub = {
      ...h.hub,
      initLibrary: async (root: string, name?: string) => { calls.push(['initLibrary', [root, name]]); return { id: LIB, name: name ?? 'lib', root, state: 'ready' } },
      addLibrary: async (root: string, name?: string) => { calls.push(['addLibrary', [root, name]]); return { id: LIB, name: name ?? 'lib', root, state: 'ready' } },
      close: async () => { calls.push(['close', []]) },
      plugins: {
        ...h.hub.plugins,
        discover: async () => { calls.push(['discover', []]) },
        install: async (spec: string) => { calls.push(['install', [spec]]); return h.hub.plugins.list()[1]! },
        update: async (id: string) => { calls.push(['update', [id]]); return h.hub.plugins.list()[1]! },
        remove: async (id: string) => { calls.push(['remove', [id]]) }
      }
    }
    return { calls, opts, hub, createHub: async (o: unknown) => { opts.push(o); return hub }, cleanup: h.cleanup }
  }

  it('init creates the library through the kernel', async () => {
    const s = hubSpy()
    const r = await bb(['init', 'newlib', '--name', '新库', '--json'], { createHub: s.createHub as CliIO['createHub'] })
    expect(r.code).toBe(0)
    expect(s.calls[0]).toEqual(['initLibrary', [path.join(tmp, 'newlib'), '新库']])
    expect(s.calls.at(-1)![0]).toBe('close')
    expect(s.opts[0]).toMatchObject({ home: path.join(tmp, 'home'), builtinPluginDirs: ['/opt/bb/plugins'], watch: false })
    expect(r.json.id).toBe(LIB)
    s.cleanup()
  })

  it('plugin add / list / update / remove work without a server', async () => {
    const s = hubSpy()
    const io = { createHub: s.createHub as CliIO['createHub'] }
    const list = await bb(['plugin', 'list', '--json'], io)
    expect(list.json.map((p: { id: string }) => p.id)).toEqual(['bowerbird.image', 'community.spine'])
    const add = await bb(['plugin', 'add', './my-plugin'], io)
    expect(add.code).toBe(0)
    expect(s.calls.find(c => c[0] === 'install')![1]).toEqual([path.join(tmp, 'my-plugin')])
    expect(add.out).toContain('重启后生效')
    await bb(['plugin', 'add', '@acme/bb-spine'], io)
    expect(s.calls.filter(c => c[0] === 'install').at(-1)![1]).toEqual(['@acme/bb-spine'])
    const upd = await bb(['plugin', 'update', '--json'], io)
    expect(upd.json.length).toBe(1)
    expect(s.calls.find(c => c[0] === 'update')![1]).toEqual(['community.spine'])
    const rm = await bb(['plugin', 'remove', 'community.spine', '--json'], io)
    expect(rm.json).toEqual({ removed: 'community.spine' })
    s.cleanup()
  })

  it('serve registers the folder as the opened library and starts the server', async () => {
    const s = hubSpy()
    let started: { server: RunningServer; hub: Hub } | null = null
    const r = await bb(['serve', 'lib', '--host', '127.0.0.1', '--port', '0', '--json'], {
      createHub: s.createHub as CliIO['createHub'],
      startServer: (o => startServer({ ...o, print: () => undefined })) as CliIO['startServer'],
      locate: () => ({ pluginsDir: '/opt/bb/plugins', webDir: null }),
      onServe: x => { started = x }
    })
    expect(r.code).toBe(0)
    expect(s.calls.find(c => c[0] === 'addLibrary')![1]).toEqual([path.join(tmp, 'lib'), undefined])
    expect(fs.existsSync(path.join(tmp, 'lib'))).toBe(true)
    expect(r.json.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(r.json.library.id).toBe(LIB)
    expect(s.opts[0]).toMatchObject({ overrides: { host: '127.0.0.1', port: 0 }, builtinPluginDirs: ['/opt/bb/plugins'] })
    const libs = await (await fetch(`${r.json.url}/api/v1/libraries`)).json() as { defaultId: string }
    expect(libs.defaultId).toBe(LIB)
    await started!.server.close()
    s.cleanup()
  })

  it('serve rejects a bad port', async () => {
    const r = await bb(['serve', '--port', 'x'])
    expect(r.code).not.toBe(0)
    expect(r.err).toContain('端口不对')
  })

  it('mcp starts the MCP server with an agent actor', async () => {
    let got: unknown = null
    const r = await bb(['mcp', '--name', 'modeler', '--library', LIB], { runMcpServer: async o => { got = o } })
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
    expect(got).toEqual({ baseUrl: server.url, library: LIB, actor: 'modeler', cwd: tmp })
    await bb(['mcp'], { runMcpServer: async o => { got = o }, env: { BOWERBIRD_URL: 'http://h:1', BOWERBIRD_AGENT: 'cutter' } })
    expect(got).toEqual({ baseUrl: 'http://h:1', actor: 'cutter', cwd: tmp })
    // no server named: the MCP server finds one per call, or opens the library itself (ADR-069)
    await bb(['mcp'], { runMcpServer: async o => { got = o }, env: { BOWERBIRD_HOME: path.join(tmp, 'home') } })
    expect(got).toMatchObject({ home: path.join(tmp, 'home'), openLocal: expect.any(Function), defaultUrl: 'http://127.0.0.1:7420' })
  })

  it('bb mcp --name 建模: the server records agent:建模 (encoded once, end to end)', async () => {
    const r = await bb(['mcp', '--name', '建模'], {
      runMcpServer: async o => {
        const mcp = createMcpServer(o)
        const client = new Client({ name: 'test', version: '1' })
        const [a, b] = InMemoryTransport.createLinkedPair()
        await Promise.all([mcp.connect(a), client.connect(b)])
        const res = await client.callTool({ name: 'bb_tag', arguments: { refs: [ID1], add: ['宝箱'] } }) as { isError?: boolean }
        expect(res.isError).toBeFalsy()
        await client.close()
      }
    })
    expect(r.code).toBe(0)
    expect((fake.last('apply')!.args[1] as { actor: string }).actor).toBe('agent:建模')
  })
})

describe('locate', () => {
  it('finds the monorepo plugins dir from this package', () => {
    const l = locateAssets(path.dirname(new URL(import.meta.url).pathname))
    expect(l.pluginsDir).toBe(path.resolve(new URL('../../../plugins', import.meta.url).pathname))
  })
  it('finds a published layout (plugins/ and web/ next to dist/)', () => {
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pkg-'))
    fs.mkdirSync(path.join(pkg, 'dist'))
    fs.mkdirSync(path.join(pkg, 'plugins', 'image'), { recursive: true })
    fs.writeFileSync(path.join(pkg, 'plugins', 'image', 'package.json'), JSON.stringify({ name: '@bowerbird/plugin-image', bowerbird: { id: 'bowerbird.image' } }))
    fs.mkdirSync(path.join(pkg, 'web', 'assets'), { recursive: true })
    fs.writeFileSync(path.join(pkg, 'web', 'index.html'), '<!doctype html><script type="module" src="/assets/index-x.js"></script>')
    expect(locateAssets(path.join(pkg, 'dist'))).toEqual({ pluginsDir: path.join(pkg, 'plugins'), webDir: path.join(pkg, 'web') })
    fs.rmSync(pkg, { recursive: true, force: true })
  })
  it('never serves the monorepo web *source* (index.html pointing at /src/main.tsx) as the shell', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-repo-'))
    fs.mkdirSync(path.join(repo, 'packages', 'cli', 'dist'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'packages', 'web', 'dist', 'assets'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'packages', 'web', 'index.html'), '<script type="module" src="/src/main.tsx"></script>')
    fs.writeFileSync(path.join(repo, 'packages', 'web', 'dist', 'index.html'), '<script type="module" src="/assets/index-x.js"></script>')
    expect(locateAssets(path.join(repo, 'packages', 'cli', 'dist')).webDir).toBe(path.join(repo, 'packages', 'web', 'dist'))
    fs.rmSync(path.join(repo, 'packages', 'web', 'dist'), { recursive: true })
    expect(locateAssets(path.join(repo, 'packages', 'cli', 'dist')).webDir).toBeNull()
    fs.rmSync(repo, { recursive: true, force: true })
  })
  it('finds the built shell of this monorepo', () => {
    const l = locateAssets(path.dirname(new URL(import.meta.url).pathname))
    if (fs.existsSync(new URL('../../web/dist/index.html', import.meta.url))) expect(l.webDir).toBe(path.resolve(new URL('../../web/dist', import.meta.url).pathname))
  })
})
