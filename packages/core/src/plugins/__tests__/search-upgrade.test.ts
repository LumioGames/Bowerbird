/**
 * A search plugin upgraded between two runs rebuilds its own index empty (the keyword plugin drops its full-text
 * tables when its schema changes). After the restart the kernel must feed every existing asset to it again: the index
 * stage is redone because it ran with another version of the search plugin.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openIndexDb } from '../../index/db.js'
import { createQueryEngine } from '../../index/query.js'
import { createEventBus } from '../../events.js'
import { silentLogger } from '../../log.js'
import { createPipelineImpl } from '../../pipeline/pipeline.js'
import { FakeDeps, seedAsset } from '../../pipeline/__tests__/fakes.js'
import { createPluginHostImpl } from '../host.js'
import { fakeLibrary, libraryJson, machine, tmpDir, writePlugin } from './helpers.js'

/** A search plugin keeping its index in its data dir; a new version starts from an empty index (like a schema change). */
const SEARCH_SERVER = `
import fs from 'node:fs'
import path from 'node:path'
export default {
  activate(ctx) {
    const file = path.join(ctx.dataDir, 'index.json')
    let state = { schema: ctx.pluginVersion, docs: {} }
    try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s.schema === ctx.pluginVersion) state = s } catch {}
    const save = () => fs.writeFileSync(file, JSON.stringify(state))
    save()
    ctx.register.searchProvider({
      id: 'kw',
      async index(docs) { for (const d of docs) state.docs[d.id] = d.name; save() },
      async remove(ids) { for (const id of ids) delete state.docs[id]; save() },
      async clear() { state.docs = {}; save() },
      async query(q, opts) {
        return Object.entries(state.docs)
          .filter(([id, name]) => name.includes(q) && (!opts.candidates || opts.candidates.has(id)))
          .map(([id]) => ({ id, score: 1 }))
      }
    })
  }
}
`

async function setup(plugins: Array<{ folder: string; id: string; version: string }>) {
  const base = tmpDir('bb-search-upgrade-')
  const builtin = path.join(base, 'builtin')
  fs.mkdirSync(builtin, { recursive: true })
  const dirs = new Map(plugins.map(p => [p.id, writePlugin(builtin, p.folder, { id: p.id, version: p.version, manifest: { contributes: { searchProviders: [{ id: 'kw' }] } }, server: SEARCH_SERVER })]))
  const { db } = openIndexDb(path.join(base, 'home', 'libraries', 'lib1', 'index.sqlite'))
  const ids = ['red_chest.glb', 'blue_chest.glb', 'sword.png'].map(p => seedAsset(db, { path: p, format: 'unknown' }))
  const cfg = machine()
  const session = async () => {
    const host = createPluginHostImpl({ builtinDirs: [builtin], installDir: path.join(base, 'home', 'plugins'), machineConfig: cfg.get, saveMachineConfig: cfg.save, log: silentLogger, events: createEventBus() })
    await host.discover()
    const lib = fakeLibrary(base, libraryJson())
    const plugins = await host.forLibrary(lib)
    const query = createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger })
    const pipeline = createPipelineImpl({ db, library: lib, plugins, query, deps: new FakeDeps(db), events: createEventBus(), log: silentLogger, cleanIntervalMs: 0 })
    pipeline.start()
    const search = async () => (await query.search({ q: 'chest', sort: 'name' }, { agent: false, scope: 'all' })).items.map(i => i.name)
    const close = async () => { await pipeline.stop(); await host.close() }
    return { pipeline, query, search, close }
  }
  return { base, builtin, dirs, db, ids, session }
}

describe('search providers that change between runs', () => {
  it('a search plugin that arrives with the restart (none before) gets every asset', async () => {
    const t = await setup([])
    const one = await t.session()
    for (const id of t.ids) one.pipeline.enqueue(id, 'all')
    await one.pipeline.idle()
    expect(await one.search()).toEqual(['blue_chest.glb', 'red_chest.glb']) // substring fallback
    await one.close()
    writePlugin(t.builtin, 'kw', { id: 'bowerbird.search-keyword', version: '0.1.1', manifest: { contributes: { searchProviders: [{ id: 'kw' }] } }, server: SEARCH_SERVER })
    const two = await t.session()
    await two.pipeline.idle()
    expect(await two.search()).toEqual(['blue_chest.glb', 'red_chest.glb'])
    expect(t.db.prepare("SELECT DISTINCT plugin FROM pipeline_stages WHERE stage = 'index'").pluck().all()).toEqual(['bowerbird.search-keyword@0.1.1'])
    await two.close()
  })

  it('a second search plugin added beside an unchanged one gets every asset too', async () => {
    const t = await setup([{ folder: 'a', id: 'studio.a', version: '1.0.0' }])
    const one = await t.session()
    for (const id of t.ids) one.pipeline.enqueue(id, 'all')
    await one.pipeline.idle()
    await one.close()
    writePlugin(t.builtin, 'b', { id: 'studio.b', version: '1.0.0', manifest: { contributes: { searchProviders: [{ id: 'kw' }] } }, server: SEARCH_SERVER })
    const two = await t.session()
    await two.pipeline.idle()
    const bIndex = JSON.parse(fs.readFileSync(path.join(t.base, 'home', 'libraries', 'lib1', 'plugins', 'studio.b', 'index.json'), 'utf8'))
    expect(Object.keys(bIndex.docs).sort()).toEqual([...t.ids].sort())
    expect(t.db.prepare("SELECT DISTINCT plugin FROM pipeline_stages WHERE stage = 'index'").pluck().all()).toEqual(['studio.a@1.0.0,studio.b@1.0.0'])
    await two.close()
  })

  it('clearProviders() empties the indexes and the pipeline feeds every asset again', async () => {
    const t = await setup([{ folder: 'kw', id: 'bowerbird.search-keyword', version: '0.1.1' }])
    const one = await t.session()
    for (const id of t.ids) one.pipeline.enqueue(id, 'all')
    await one.pipeline.idle()
    expect(await one.search()).toEqual(['blue_chest.glb', 'red_chest.glb'])
    await one.query.clearProviders()
    await one.pipeline.idle()
    expect(await one.search()).toEqual(['blue_chest.glb', 'red_chest.glb'])
    await one.close()
  })

  it('feeds every asset to the upgraded plugin after the restart', async () => {
    const base = tmpDir('bb-search-upgrade-')
    const builtin = path.join(base, 'builtin')
    const pluginDir = writePlugin(builtin, 'kw', { id: 'bowerbird.search-keyword', version: '0.1.0', manifest: { contributes: { searchProviders: [{ id: 'kw' }] } }, server: SEARCH_SERVER })
    const { db } = openIndexDb(path.join(base, 'home', 'libraries', 'lib1', 'index.sqlite'))
    const ids = ['red_chest.glb', 'blue_chest.glb', 'sword.png'].map(p => seedAsset(db, { path: p, format: 'unknown' }))
    const cfg = machine()

    const session = async () => {
      const host = createPluginHostImpl({ builtinDirs: [builtin], installDir: path.join(base, 'home', 'plugins'), machineConfig: cfg.get, saveMachineConfig: cfg.save, log: silentLogger, events: createEventBus() })
      await host.discover()
      const lib = fakeLibrary(base, libraryJson())
      const plugins = await host.forLibrary(lib)
      const query = createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger })
      const pipeline = createPipelineImpl({ db, library: lib, plugins, query, deps: new FakeDeps(db), events: createEventBus(), log: silentLogger, cleanIntervalMs: 0 })
      pipeline.start()
      return { host, query, pipeline }
    }
    const search = async (q: { search: ReturnType<typeof createQueryEngine>['search'] }) =>
      (await q.search({ q: 'chest', sort: 'name' }, { agent: false, scope: 'all' })).items.map(i => i.name)

    // Run 1 (v0.1.0): everything is indexed.
    const one = await session()
    for (const id of ids) one.pipeline.enqueue(id, 'all')
    await one.pipeline.idle()
    expect(await search(one.query)).toEqual(['blue_chest.glb', 'red_chest.glb'])
    await one.pipeline.stop()
    await one.host.close()

    // The plugin is upgraded while the server is down; its index starts empty.
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'))
    pkg.version = '0.1.1'
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify(pkg, null, 2))

    // Run 2: nothing else changed, yet keyword search must work again.
    const two = await session()
    await two.pipeline.idle()
    expect(await search(two.query)).toEqual(['blue_chest.glb', 'red_chest.glb'])
    expect(db.prepare("SELECT DISTINCT plugin FROM pipeline_stages WHERE stage = 'index'").pluck().all()).toEqual(['bowerbird.search-keyword@0.1.1'])
    await two.pipeline.stop()
    await two.host.close()
    db.close()
  })
})
