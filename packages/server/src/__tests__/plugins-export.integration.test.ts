/**
 * Over the REAL kernel: enabling / disabling the Forge test plugin installed from a path (needs
 * `pnpm --filter @bowerbird-fixtures/plugin-forge build`, skipped otherwise), its write-only access key, and a
 * zip export with dependencies written under their slot names, from a copy of「星落镇」.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHub, type Hub } from '@bowerbird/core'
import { createApiClient, type ApiClient } from '@bowerbird/schema'
import { startServer, type RunningServer } from '../index.js'
import { readZip } from './zip.js'

const REPO = path.resolve(import.meta.dirname, '../../../..')
const FORGE = path.join(REPO, 'fixtures/plugins/forge')
const FORGE_BUILT = fs.existsSync(path.join(FORGE, 'dist', 'server.js')) && fs.existsSync(path.join(FORGE, 'dist', 'web.js'))

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (ok(v)) return v
    if (Date.now() > deadline) throw new Error(`timed out; last: ${JSON.stringify(v).slice(0, 300)}`)
    await new Promise(r => setTimeout(r, 50))
  }
}

describe.skipIf(!FORGE_BUILT)('Forge installed from a path: enable, disable, write-only key (real kernel)', () => {
  let tmp: string
  let hub: Hub
  let server: RunningServer
  let api: ApiClient
  let lib: string
  let root: string

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-forge-http-'))
    root = path.join(tmp, 'lib')
    hub = await createHub({ home: path.join(tmp, 'home'), builtinPluginDirs: [], watch: false })
    lib = (await hub.addLibrary(root, '测试库')).id
    server = await startServer({ hub, host: '127.0.0.1', port: 0, defaultLibrary: lib, print: () => undefined })
    api = createApiClient({ baseUrl: server.url, actor: 'user:lin' })
    await until(() => api.libraries.get(lib), i => i.state === 'ready')
  })
  afterAll(async () => {
    await server?.close()
    await hub?.close()
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  const forgeOf = async () => (await api.plugins.list()).plugins.find(p => p.id === 'community.forge')
  const declared = () => JSON.parse(fs.readFileSync(path.join(root, '.bowerbird', 'library.json'), 'utf8')).plugins as Record<string, string>

  it('installs from a path, disabled until enabled for the library', async () => {
    const r = await api.plugins.install(FORGE)
    expect(r.plugins.find(p => p.id === 'community.forge')).toMatchObject({ source: 'path', status: 'disabled', version: '0.4.0' })
    expect(declared()['community.forge']).toBeUndefined()
    expect((await api.creators.list(lib)).creators).toEqual([])
  })

  it('enable declares it in library.json and activates it; its web module is served', async () => {
    const r = await api.plugins.enable('community.forge', lib)
    expect(r.plugins.find(p => p.id === 'community.forge')!.status).toBe('enabled')
    expect(declared()['community.forge']).toBe('^0.4.0')
    expect((await api.creators.list(lib)).creators.map(c => c.id)).toEqual(['community.forge:image', 'community.forge:model'])
    const web = await fetch(api.plugins.webUrl('community.forge'))
    expect(web.status).toBe(200)
    expect(web.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
  })

  it('the write-only access key never comes back in clear', async () => {
    const put = await api.plugins.putMachineSettings('community.forge', { apiKey: 'fk_live_secret_4321', simulate: 'none' })
    expect(put.values.apiKey).toEqual({ set: true })
    const get = await api.plugins.machineSettings('community.forge')
    expect(get.values).toMatchObject({ apiKey: { set: true }, simulate: 'none' })
    const cfg = await api.config.get()
    expect(JSON.stringify(cfg)).not.toContain('fk_live_secret_4321')
    expect((cfg.config.plugins as Record<string, Record<string, unknown>>)['community.forge']!.apiKey).toEqual({ set: true })
    // sending the placeholder back (what a settings form does) keeps the key
    await api.plugins.putMachineSettings('community.forge', { apiKey: { set: true }, simulate: 'unavailable' })
    expect(hub.plugins.machineSettings('community.forge')).toMatchObject({ apiKey: 'fk_live_secret_4321', simulate: 'unavailable' })
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'home', 'config.json'), 'utf8'))
    expect(onDisk.plugins['community.forge'].apiKey).toBe('fk_live_secret_4321')
  })

  it('disable removes the declaration and the creators', async () => {
    const r = await api.plugins.disable('community.forge', lib)
    expect(r.plugins.find(p => p.id === 'community.forge')!.status).toBe('disabled')
    expect(declared()['community.forge']).toBeUndefined()
    expect((await api.creators.list(lib)).creators).toEqual([])
    expect((await forgeOf())!.status).toBe('disabled')
  })
})

describe('export with dependencies under their slot names (real kernel, 星落镇 copy)', () => {
  let tmp: string
  let hub: Hub
  let server: RunningServer
  let api: ApiClient
  let lib: string
  let root: string
  const CHEST_GLB = '0192f3a4-7c1e-7b52-9d06-4e8a51c0d205'
  const BASECOLOR = '0192f3a4-7c1e-7b52-9d06-4e8a51c0d206'

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-export-'))
    root = path.join(tmp, 'xingluo')
    execFileSync(process.execPath, [path.join(REPO, 'fixtures/scripts/copy-library.mjs'), root, '--rebase-trash'], { cwd: REPO, stdio: 'pipe' })
    hub = await createHub({ home: path.join(tmp, 'home'), builtinPluginDirs: [], watch: false })
    lib = (await hub.addLibrary(root)).id
    server = await startServer({ hub, host: '127.0.0.1', port: 0, defaultLibrary: lib, print: () => undefined })
    api = createApiClient({ baseUrl: server.url, actor: 'user:lin' })
    await until(() => api.assets.get(lib, CHEST_GLB).then(a => a, () => null), a => !!a && a.relations.outgoing.some(r => r.slot === 'chest_basecolor.png'), 60_000)
    // the whole first scan must be in the index (not only chest.glb): the tests search for other assets of the folder
    await until(() => api.libraries.get(lib), i => !i.scan.running && i.scan.phase === 'done', 60_000)
  }, 120_000)
  afterAll(async () => {
    await server?.close()
    await hub?.close()
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('writes the texture an asset slot points at under the name the model file uses', async () => {
    // swap the base colour for the dark variant (ADR-018): the model file still says chest_basecolor.png
    const dark = (await api.search(lib, { filter: { folder: 'props/chest', folderExact: true, includeAuxiliary: true, review: ['pending', 'approved', 'rejected', 'exempt'] }, limit: 200 }))
      .items.find(i => i.name === 'chest_basecolor_dark.png')!
    expect(dark).toBeDefined()
    await api.relations.replace(lib, CHEST_GLB, { type: 'uses', to: BASECOLOR, slot: 'chest_basecolor.png', newTo: dark.id })

    const plan = await api.exports.plan(lib, { ids: [CHEST_GLB], withDeps: true })
    const byPath = new Map(plan.files.map(f => [f.path, f]))
    expect(byPath.get('props/chest/chest.glb')).toMatchObject({ dependency: false, assetId: CHEST_GLB })
    expect(byPath.get('props/chest/chest_basecolor.png')).toMatchObject({ dependency: true, assetId: dark.id, fromFile: 'chest_basecolor_dark.png' })
    expect(byPath.has('props/chest/chest_normal.png')).toBe(true)
    expect(byPath.has('props/chest/chest_orm.png')).toBe(true)

    const res = await api.exports.run(lib, { ids: [CHEST_GLB], withDeps: true })
    expect(res.headers.get('content-type')).toBe('application/zip')
    const zip = readZip(Buffer.from(await res.arrayBuffer()))
    expect([...zip.keys()].sort()).toEqual([...byPath.keys()].sort())
    expect(zip.get('props/chest/chest.glb')!.equals(fs.readFileSync(path.join(root, 'props/chest/chest.glb')))).toBe(true)
    expect(zip.get('props/chest/chest_basecolor.png')!.equals(fs.readFileSync(path.join(root, 'props/chest/chest_basecolor_dark.png')))).toBe(true)
    expect(zip.has('props/chest/chest_basecolor_dark.png')).toBe(false)
  })

  it('a flat export to a directory on this machine uses the same names', async () => {
    const out = path.join(tmp, 'out')
    const r = await (await api.exports.run(lib, { ids: [CHEST_GLB], withDeps: true, layout: 'flat', dir: out })).json() as { written: number }
    expect(r.written).toBeGreaterThanOrEqual(4)
    expect(fs.readFileSync(path.join(out, 'chest_basecolor.png')).equals(fs.readFileSync(path.join(root, 'props/chest/chest_basecolor_dark.png')))).toBe(true)
    expect(fs.existsSync(path.join(out, 'chest.glb'))).toBe(true)
  })
})
