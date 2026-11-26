/** Hub (machine data dir, library registry) and the LibraryHandle given to the plugin host. */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHubWith } from '../../hub.js'
import { silentLogger } from '../../log.js'
import { cleanupTmp, ctx, fakePipeline, fakePluginHost, fakePlugins, fakeQuery, makeLib, tmpDir, type TestLib } from './harness.js'

let libs: TestLib[] = []
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const factories = () => {
  const plugins = fakePlugins()
  return { createPluginHost: () => fakePluginHost(plugins), createQueryEngine: fakeQuery, createPipeline: () => fakePipeline() }
}

describe('hub', () => {
  it('keeps config, logs, plugins and one index per library under the home dir', async () => {
    const base = tmpDir('hub')
    const home = path.join(base, 'home')
    const hub = await createHubWith({ home, builtinPluginDirs: [], watch: false, log: silentLogger, overrides: { port: 9999 } }, factories(), { stableMs: 0 })
    for (const d of ['logs', 'plugins', 'libraries', 'tmp']) expect(fs.existsSync(path.join(home, d))).toBe(true)
    expect(hub.config().port).toBe(7420) // the saved config: --port only applies to this run (below)
    const empty = await hub.addLibrary(path.join(base, 'Empty'), '空库')
    expect(empty.state).toBe('ready')
    expect(JSON.parse(fs.readFileSync(path.join(base, 'Empty/.bowerbird/library.json'), 'utf8'))).toMatchObject({ id: empty.id, name: '空库', plugins: { 'test.image': '^1.0.0' } })
    fs.mkdirSync(path.join(base, 'Full'))
    fs.writeFileSync(path.join(base, 'Full/a.png'), 'a')
    const full = await hub.addLibrary(path.join(base, 'Full'))
    expect(full.state).toBe('uninitialized')
    expect(await hub.addLibrary(path.join(base, 'Full'))).toEqual(full)
    expect(hub.libraries().map(l => l.id)).toEqual([empty.id, full.id])
    expect(hub.defaultLibraryId()).toBe(empty.id)
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'))
    expect(cfg.libraries.map((l: { id: string }) => l.id)).toEqual([empty.id, full.id])
    expect(cfg.port).toBe(7420)
    const svc = await hub.library(empty.id)
    expect((await svc.info(ctx)).address).toBe('http://127.0.0.1:9999')
    expect(svc.paths).toMatchObject({ indexPath: path.join(home, 'libraries', empty.id, 'index.sqlite'), cacheDir: path.join(base, 'Empty/.bowerbird/cache') })
    expect(fs.existsSync(path.join(home, 'libraries', empty.id, 'index.sqlite'))).toBe(true)
    await expect(hub.library('nope')).rejects.toMatchObject({ code: 'not_found' })
    // bb init on a folder with files writes library.json right away
    const init = await hub.initLibrary(path.join(base, 'Full'))
    expect(init.state).toBe('ready')
    expect(init.id).toBe(full.id)
    // a copied library folder cannot be registered twice
    fs.cpSync(path.join(base, 'Empty'), path.join(base, 'EmptyCopy'), { recursive: true })
    await expect(hub.addLibrary(path.join(base, 'EmptyCopy'))).rejects.toMatchObject({ code: 'conflict' })
    // an unmounted library is unavailable and never scanned into「文件缺失」
    fs.renameSync(path.join(base, 'Empty'), path.join(base, 'Gone'))
    expect(hub.libraries()[0]?.state).toBe('unavailable')
    const emptySvc = await hub.service(empty.id)
    await expect(emptySvc.register({ fields: {}, file: { name: 'x.png', data: new Uint8Array([1]) } }, ctx)).rejects.toMatchObject({ code: 'not_found' })
    await expect(emptySvc.rescan(undefined, ctx)).rejects.toMatchObject({ code: 'not_found' })
    await emptySvc.scanner.scan('full')
    expect(fs.existsSync(path.join(base, 'Empty'))).toBe(false)
    expect(emptySvc.store.allRows().filter(r => r.missing)).toEqual([])
    expect((await hub.health()).status).toBe('degraded')
    await hub.close()
  })
})

describe('library handle', () => {
  it('reads through the service and writes plugin cache files once under <stage>/plugins/<id>/<asset>-<hash8>/', async () => {
    const t = await makeLib()
    libs.push(t)
    const r = await t.svc.register({ fields: {}, file: { name: 'a.png', data: new Uint8Array(Buffer.from('a')) } }, ctx)
    const id = r.asset!.id
    const h = t.svc.handle
    expect(h.id).toBe(t.id)
    expect((await h.reader.get(id))?.name).toBe('a.png')
    expect((await h.reader.getByPath('a.png'))?.id).toBe(id)
    expect(await h.reader.filePath(id)).toBe(t.abs('a.png'))
    const cache = h.cacheFor('test.model')
    const p = await cache.put(id, 'derive', 'preview.glb', new Uint8Array([1, 2, 3]))
    const hash8 = t.row(id)!.hash.slice('sha256:'.length, 'sha256:'.length + 8)
    expect(p).toBe(path.join(t.svc.paths.cacheDir, 'derive', 'plugins', 'test.model', `${id}-${hash8}`, 'preview.glb'))
    expect(await cache.put(id, 'derive', 'preview.glb', new Uint8Array([9]))).toBe(p)
    expect(Array.from((await cache.get(id, 'derive', 'preview.glb'))!)).toEqual([1, 2, 3])
    expect(await h.cache.put(id, 'summary', 'test.model/sum.txt', new Uint8Array([4]))).toBe(path.join(t.svc.paths.cacheDir, 'summary', 'plugins', 'test.model', `${id}-${hash8}`, 'sum.txt'))
    await h.updateLibraryJson(l => { l.settings = { ...l.settings, plugins: { 'test.model': { env: 'studio' } } } })
    expect(h.libraryJson()?.settings.plugins).toEqual({ 'test.model': { env: 'studio' } })
    expect(await t.svc.pluginLibrarySettings('test.model')).toEqual({ env: 'studio' })
  })
})
