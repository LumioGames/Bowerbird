import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEventBus } from '../../events.js'
import { silentLogger } from '../../log.js'
import { createPluginHost } from '../index.js'
import { createPluginHostImpl, type PluginHostImpl } from '../host.js'
import { KERNEL_VERSION } from '../manifest.js'
import { fakeLibrary, fileRef, formatServer, libraryJson, machine, tmpDir, writePlugin } from './helpers.js'

function majorMinor(v: string): string { return v.split('.').slice(0, 2).join('.') }

describe('PluginHost discovery and manifests', () => {
  let base: string
  let builtin: string
  let installDir: string
  beforeEach(() => {
    base = tmpDir()
    builtin = path.join(base, 'builtin')
    installDir = path.join(base, 'home', 'plugins')
    fs.mkdirSync(installDir, { recursive: true })
  })

  function host(cfg = machine(), extra: Partial<Parameters<typeof createPluginHostImpl>[0]> = {}): PluginHostImpl {
    return createPluginHostImpl({ builtinDirs: [builtin], installDir, machineConfig: cfg.get, saveMachineConfig: cfg.save, log: silentLogger, events: createEventBus(), ...extra })
  }

  it('discovers built-in plugins, validates manifests and apiVersion', async () => {
    writePlugin(builtin, 'image', { id: 'bowerbird.image', displayName: '图片', manifest: { contributes: { formats: [{ id: 'image', displayName: '图片', extensions: ['.png'] }] } }, server: formatServer('image') })
    writePlugin(builtin, 'future', { id: 'bowerbird.future', apiVersion: 2 })
    writePlugin(builtin, 'ancient', { id: 'bowerbird.ancient', apiVersion: 0 })
    writePlugin(builtin, 'broken', { id: 'Bad Id!' })
    fs.mkdirSync(path.join(builtin, 'not-a-plugin'))
    fs.writeFileSync(path.join(builtin, 'not-a-plugin', 'package.json'), '{"name":"x"}')
    const h = host()
    await h.discover()
    const list = h.list()
    expect(list.map(p => p.id).sort()).toEqual(['Bad Id!', 'bowerbird.ancient', 'bowerbird.future', 'bowerbird.image'])
    const byId = Object.fromEntries(list.map(p => [p.id, p]))
    expect(byId['bowerbird.image']).toMatchObject({ status: 'enabled', builtin: true, source: 'builtin', version: '1.0.0', contributes: ['formats'], formats: [{ id: 'image', displayName: '图片', extensions: ['.png'] }], hasWeb: false })
    expect(byId['bowerbird.future']).toMatchObject({ status: 'failed', reason: `这个插件需要更新版本的 Bowerbird（2.x），现在是 ${majorMinor(KERNEL_VERSION)}` })
    expect(byId['bowerbird.ancient']!.status).toBe('failed')
    expect(byId['bowerbird.ancient']!.reason).toContain('旧版本')
    expect(byId['Bad Id!']!.status).toBe('failed')
    expect(byId['Bad Id!']!.reason).toMatch(/^清单不合法/)
  })

  it('the factory exported for the hub builds the same host', async () => {
    writePlugin(builtin, 'doc', { id: 'bowerbird.doc' })
    const cfg = machine()
    const h = createPluginHost({ builtinDirs: [builtin], installDir, machineConfig: cfg.get, saveMachineConfig: cfg.save, log: silentLogger, events: createEventBus() })
    await h.discover()
    expect(h.list().map(p => p.id)).toEqual(['bowerbird.doc'])
  })

  it('status per library: built-ins always enabled, third-party only when declared, declared-and-absent is missing', async () => {
    writePlugin(builtin, 'image', { id: 'bowerbird.image' })
    const third = writePlugin(base, 'ext/spine', { id: 'community.spine', version: '1.4.2', manifest: { contributes: { formats: [{ id: 'spine', displayName: 'Spine', extensions: ['.skel'] }] } } })
    const other = writePlugin(base, 'ext/other', { id: 'community.other' })
    const cfg = machine({ installed: [{ id: 'community.spine', spec: third, source: 'path' }, { id: 'community.other', spec: other, source: 'path' }] })
    const h = host(cfg)
    await h.discover()
    const lib = fakeLibrary(base, libraryJson({ 'community.spine': '^1.4', 'community.ghost': '^2.0' }))
    const list = Object.fromEntries(h.list(lib).map(p => [p.id, p]))
    expect(list['bowerbird.image']!.status).toBe('enabled')
    expect(list['community.spine']).toMatchObject({ status: 'enabled', required: '^1.4', source: 'path', installPath: third })
    expect(list['community.other']!.status).toBe('disabled')
    expect(list['community.ghost']).toMatchObject({ status: 'missing', required: '^2.0', version: null })
    // Without a library, third-party plugins are listed as not enabled.
    expect(h.list().find(p => p.id === 'community.spine')!.status).toBe('disabled')
  })
})

describe('PluginHost activation for a library', () => {
  let base: string
  let builtin: string
  let installDir: string
  beforeEach(() => {
    base = tmpDir()
    builtin = path.join(base, 'builtin')
    installDir = path.join(base, 'home', 'plugins')
  })

  function host(cfg = machine(), events = createEventBus(), extra: Partial<Parameters<typeof createPluginHostImpl>[0]> = {}): PluginHostImpl {
    return createPluginHostImpl({ builtinDirs: [builtin], installDir, machineConfig: cfg.get, saveMachineConfig: cfg.save, log: silentLogger, events, ...extra })
  }

  it('identifies by extension then file head; the highest manifest priority wins', async () => {
    writePlugin(builtin, 'model', { id: 'bowerbird.model', manifest: { contributes: { formats: [{ id: 'model', displayName: '模型', extensions: ['.glb'], priority: 100, thumbnail: 'browser' }, { id: 'gltf-buffer', displayName: 'glTF 数据', extensions: ['.bin'], priority: 10, thumbnail: 'none' }] } }, server: `
      export default { activate(ctx) {
        ctx.register.format({ id: 'model', async match(f) { return new TextDecoder().decode(f.head).startsWith('glTF') ? { format: 'model' } : null } })
        ctx.register.format({ id: 'gltf-buffer', async match() { return { format: 'gltf-buffer' } } })
      } }` })
    writePlugin(builtin, 'raw', { id: 'bowerbird.raw', manifest: { contributes: { formats: [{ id: 'raw-bin', displayName: 'Raw', extensions: ['.bin'], priority: 50 }] } }, server: formatServer('raw-bin', 'RAW') })
    const h = host()
    await h.discover()
    const lp = await h.forLibrary(fakeLibrary(base, libraryJson()))
    expect(await lp.identify(fileRef('chest.glb', 'glTF....'))).toEqual({ pluginId: 'bowerbird.model', pluginVersion: '1.0.0', format: 'model', thumbnail: 'browser' })
    expect(await lp.identify(fileRef('fake.glb', 'PK..'))).toBeNull()
    expect(await lp.identify(fileRef('data.bin', 'RAW...'))).toMatchObject({ pluginId: 'bowerbird.raw', format: 'raw-bin', thumbnail: 'server' })
    expect(await lp.identify(fileRef('chest.bin', '\0\0'))).toMatchObject({ pluginId: 'bowerbird.model', format: 'gltf-buffer', thumbnail: 'none' })
    expect(await lp.identify(fileRef('readme.xyz', ''))).toBeNull()
    expect(lp.format('model')!.handler).not.toBeNull()
    expect(lp.formats().map(f => f.contribution.id)).toEqual(['model', 'gltf-buffer', 'raw-bin'])
    expect(lp.enabled().map(p => p.id)).toEqual(['bowerbird.model', 'bowerbird.raw'])
  })

  it('hands bundles (no extension) to every format handler; the one that claims it wins', async () => {
    writePlugin(builtin, 'doc', { id: 'bowerbird.doc', manifest: { contributes: { formats: [{ id: 'doc', displayName: '文档', extensions: ['.md', '.html'], priority: 10 }] } }, server: `
      export default { activate(ctx) { ctx.register.format({ id: 'doc', async match(f) { return f.ext === '' && f.name.endsWith('_proto') ? { format: 'doc' } : f.ext === '.md' ? { format: 'doc' } : null } }) } }` })
    writePlugin(builtin, 'image', { id: 'bowerbird.image', manifest: { contributes: { formats: [{ id: 'image', displayName: '图片', extensions: ['.png'], priority: 50 }] } }, server: formatServer('image', 'PNG') })
    const h = host()
    await h.discover()
    const lp = await h.forLibrary(fakeLibrary(base, libraryJson()))
    expect(await lp.identify({ ...fileRef('shop_proto'), ext: '', bundle: true })).toMatchObject({ pluginId: 'bowerbird.doc', format: 'doc' })
    expect(await lp.identify({ ...fileRef('menu_proto'), ext: '', bundle: false })).toMatchObject({ pluginId: 'bowerbird.doc' })
    expect(await lp.identify({ ...fileRef('random'), ext: '', bundle: true })).toBeNull()
  })

  it('isolates a throwing match() and counts consecutive failures without disabling', async () => {
    writePlugin(builtin, 'img', { id: 'bowerbird.image', manifest: { contributes: { formats: [{ id: 'image', displayName: '图片', extensions: ['.png'] }] } }, server: formatServer('image', 'PNG') })
    const events = createEventBus()
    const h = host(machine(), events)
    await h.discover()
    const lib = fakeLibrary(base, libraryJson())
    const lp = await h.forLibrary(lib)
    for (let i = 0; i < 3; i++) expect(await lp.identify(fileRef('x.png', 'THROW'))).toBeNull()
    const info = h.list(lib).find(p => p.id === 'bowerbird.image')!
    expect(info.status).toBe('enabled')
    expect(info.consecutiveFailures).toEqual({ count: 3, reason: 'bad header' })
    expect(events.history.some(e => e.type === 'plugin.updated' && (e.data as { id: string }).id === 'bowerbird.image')).toBe(true)
    await expect(lp.invoke('bowerbird.image', 'probe', async () => { throw new Error('nope') })).rejects.toThrow('nope')
    expect(h.list(lib).find(p => p.id === 'bowerbird.image')!.consecutiveFailures!.count).toBe(4)
    // A success resets the counter.
    expect(await lp.identify(fileRef('x.png', 'PNG'))).toMatchObject({ format: 'image' })
    expect(h.list(lib).find(p => p.id === 'bowerbird.image')!.consecutiveFailures).toBeNull()
  })

  it('counts consecutive failures per kind of work: a success of another kind (e.g. its page polling a route) does not clear them', async () => {
    writePlugin(builtin, 'gen', { id: 'community.gen', server: 'export default { activate() {} }' })
    const h = host()
    await h.discover()
    const lib = fakeLibrary(base, libraryJson())
    const lp = await h.forLibrary(lib)
    const fail = (label: string, why: string) => lp.invoke('community.gen', label, async () => { throw new Error(why) }).catch(() => {})
    const ok = (label: string) => lp.invoke('community.gen', label, async () => 1)
    const warning = () => h.list(lib).find(p => p.id === 'community.gen')!.consecutiveFailures
    for (let i = 0; i < 3; i++) await fail('create:image', '服务没有响应（503）')
    expect(warning()).toEqual({ count: 3, reason: '服务没有响应（503）' })
    // The plugin's own page keeps polling its routes, the queue keeps probing files: the warning stays.
    await ok('route GET runs')
    await ok('route GET quota')
    await ok('probe')
    await ok('action:slice')
    expect(warning()).toEqual({ count: 3, reason: '服务没有响应（503）' })
    // Only a creation that succeeds clears it.
    await ok('create:model')
    expect(warning()).toBeNull()
    // Same for the other kinds: route failures are cleared by a route success, not by a creation.
    for (let i = 0; i < 3; i++) await fail('route GET runs', 'boom')
    await ok('create:image')
    expect(warning()).toEqual({ count: 3, reason: 'boom' })
    await ok('route GET runs')
    expect(warning()).toBeNull()
    // Processing failures are not cleared by a route either; the worst kind is reported.
    for (let i = 0; i < 4; i++) await fail('probe', '读不了')
    for (let i = 0; i < 3; i++) await fail('action:slice', '动作失败')
    await ok('route GET quota')
    expect(warning()).toEqual({ count: 4, reason: '读不了' })
    await ok('thumbnail')
    expect(warning()).toEqual({ count: 3, reason: '动作失败' })
  })

  it('enabling a plugin whose activate() throws reports it failed with the reason, also in the library-less listing', async () => {
    const dir = writePlugin(base, 'ext/broken', { id: 'community.broken', version: '0.1.0', displayName: 'Broken', server: 'export default { activate() { throw new Error("初始化失败：找不到配置文件 broken.toml") } }' })
    const cfg = machine()
    const h = host(cfg)
    await h.discover()
    await h.install(dir)
    const lib = fakeLibrary(base, libraryJson())
    const lp = await h.forLibrary(lib)
    // The way LibraryService.setPluginEnabled does it: library.json first, then reload.
    await lib.updateLibraryJson(j => { j.plugins['community.broken'] = '^0.1.0' })
    await lp.reload()
    for (const info of [h.list().find(p => p.id === 'community.broken')!, h.list(lib).find(p => p.id === 'community.broken')!]) {
      expect(info.status).toBe('failed')
      expect(info.reason).toContain('初始化失败：找不到配置文件 broken.toml')
    }
    // Disabled again: no longer failed in this library.
    await lib.updateLibraryJson(j => { delete j.plugins['community.broken'] })
    await lp.reload()
    expect(h.list().find(p => p.id === 'community.broken')!.status).toBe('disabled')
  })

  it('a plugin whose activate() throws is failed in that library; the others still load', async () => {
    writePlugin(builtin, 'ok', { id: 'bowerbird.ok', manifest: { contributes: { formats: [{ id: 'ok', displayName: 'ok', extensions: ['.ok'] }] } }, server: formatServer('ok') })
    writePlugin(builtin, 'bad', { id: 'bowerbird.bad', server: 'export default { activate() { throw new Error("cannot start") } }' })
    writePlugin(builtin, 'noentry', { id: 'bowerbird.noentry', manifest: { server: './dist/server.js' } })
    writePlugin(builtin, 'noexport', { id: 'bowerbird.noexport', server: 'export const x = 1' })
    const h = host()
    await h.discover()
    const lib = fakeLibrary(base, libraryJson())
    const lp = await h.forLibrary(lib)
    const list = Object.fromEntries(h.list(lib).map(p => [p.id, p]))
    expect(list['bowerbird.bad']).toMatchObject({ status: 'failed', reason: '启动失败：cannot start' })
    expect(list['bowerbird.noentry']!.status).toBe('failed')
    expect(list['bowerbird.noentry']!.reason).toContain('找不到服务端入口')
    expect(list['bowerbird.noexport']!.reason).toContain('activate')
    expect(list['bowerbird.ok']!.status).toBe('enabled')
    expect(lp.enabled().map(p => p.id)).toEqual(['bowerbird.ok'])
  })

  it('binds a plugin context to the library: settings, data and temp dirs, change events, routes, creators', async () => {
    writePlugin(builtin, 'ctx', {
      id: 'bowerbird.ctx',
      manifest: {
        contributes: {
          creators: [{ id: 'gen' }],
          relationTypes: [{ id: 'variant', name: '变体', inverseName: '原型' }],
          settings: { type: 'object', properties: { env: { type: 'string', scope: 'library', default: 'studio' }, ratio: { type: 'number', scope: 'machine', default: 2 }, key: { type: 'string' } } }
        }
      },
      server: `
      export let seen = null
      export default { activate(ctx) {
        globalThis.__bbCtx = ctx
        globalThis.__bbChanges = []
        ctx.events.on('asset.changed', c => globalThis.__bbChanges.push(c.id))
        ctx.register.route({ method: 'GET', path: 'tile/:x', handler: async () => ({ body: { ok: true } }) })
        ctx.register.route({ method: 'GET', path: 'settings/x', handler: async () => ({}) })
        ctx.register.creator({ id: 'gen', displayName: '生成', params: { type: 'object' }, inputs: [{ role: 'reference', formats: ['image'], required: false }], run: async () => {} })
      } }`
    })
    const cfg = machine({ plugins: { 'bowerbird.ctx': { ratio: 3 } } })
    const h = host(cfg)
    await h.discover()
    const lib = fakeLibrary(base, libraryJson({}, { settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7, plugins: { 'bowerbird.ctx': { env: 'night' } } } }))
    const lp = await h.forLibrary(lib)
    const ctx = (globalThis as Record<string, unknown>).__bbCtx as import('@bowerbird/plugin-sdk').PluginContext
    expect(ctx.pluginId).toBe('bowerbird.ctx')
    expect(ctx.settings.get('env')).toBe('night')
    expect(ctx.settings.get('ratio')).toBe(3)
    expect(ctx.settings.get('key')).toBeUndefined()
    expect(ctx.settings.all()).toEqual({ env: 'night', ratio: 3 })
    expect(ctx.dataDir).toBe(path.join(lib.paths.dataDir, 'plugins', 'bowerbird.ctx'))
    expect(ctx.tmpDir).toBe(path.join(lib.paths.tmpDir, 'bowerbird.ctx'))
    expect(fs.existsSync(ctx.dataDir) && fs.existsSync(ctx.tmpDir)).toBe(true)
    expect(ctx.library).toBe(lib.reader)
    // Without the service's cacheFor(), the plugin id travels as a `<pluginId>/<name>` prefix through LibraryHandle.cache.
    await ctx.cache.put('a1', 'derive', 'x.bin', new Uint8Array([7]))
    expect(Array.from((await lib.cache.get('a1', 'derive', 'bowerbird.ctx/x.bin'))!)).toEqual([7])
    expect(Array.from((await ctx.cache.get('a1', 'derive', 'x.bin'))!)).toEqual([7])
    lp.emitChange({ id: 'a1', fields: ['tags'], by: 'user:lin', at: 'now' })
    expect((globalThis as Record<string, unknown>).__bbChanges).toEqual(['a1'])
    // Routes are listed with their plugin; kernel-reserved paths are refused.
    expect(lp.routes().map(r => [r.pluginId, r.route.path])).toEqual([['bowerbird.ctx', 'tile/:x']])
    expect(lp.creatorInfo()).toEqual([{ id: 'bowerbird.ctx:gen', pluginId: 'bowerbird.ctx', pluginName: 'bowerbird.ctx', displayName: '生成', params: { type: 'object' }, inputs: [{ role: 'reference', formats: ['image'], required: false }] }])
    expect(lp.relationTypes().map(r => [r.id, r.plugin])).toEqual([['source', null], ['reference', null], ['uses', null], ['belongs', null], ['variant', 'bowerbird.ctx']])
    // Machine settings: only machine-scoped keys.
    expect(h.machineSettings('bowerbird.ctx')).toEqual({ ratio: 3 })
    await expect(h.setMachineSettings('bowerbird.ctx', { env: 'x' })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(h.setMachineSettings('bowerbird.ctx', { nope: 1 })).rejects.toMatchObject({ code: 'validation_failed' })
    await h.setMachineSettings('bowerbird.ctx', { ratio: 1.5, key: 'secret' })
    expect(cfg.get().plugins['bowerbird.ctx']).toEqual({ ratio: 1.5, key: 'secret' })
    expect(ctx.settings.get('ratio')).toBe(1.5)
    expect(h.settingsSchema('bowerbird.ctx')).toMatchObject({ type: 'object' })
  })

  it('reports missing external tools: declared ones at activation, others when exec fails', async () => {
    writePlugin(builtin, 'tools', {
      id: 'bowerbird.tools', manifest: { requires: { tools: ['definitely-not-a-tool-xyz', 'node'] } },
      server: 'export default { activate(ctx) { globalThis.__bbExec = ctx.exec } }'
    })
    const h = host()
    await h.discover()
    const lib = fakeLibrary(base, libraryJson())
    await h.forLibrary(lib)
    expect(h.list(lib)[0]!.missingTools).toEqual(['definitely-not-a-tool-xyz'])
    const exec = (globalThis as Record<string, unknown>).__bbExec as import('@bowerbird/plugin-sdk').PluginContext['exec']
    await expect(exec('another-missing-tool-abc', [])).rejects.toMatchObject({ code: 'ENOENT', message: '需要外部工具 another-missing-tool-abc，这台电脑上没找到' })
    expect(h.list(lib)[0]!.missingTools).toEqual(['definitely-not-a-tool-xyz', 'another-missing-tool-abc'])
    const r = await exec('node', ['-e', 'process.stdout.write("hi")'])
    expect(new TextDecoder().decode(r.stdout)).toBe('hi')
    expect(r.code).toBe(0)
  })

  it('installs from a path, enables and disables through library.json, writes pluginFormats, uninstalls', async () => {
    writePlugin(builtin, 'image', { id: 'bowerbird.image' })
    const src = writePlugin(base, 'src/spine', {
      id: 'community.spine', version: '1.4.0', displayName: 'Spine', web: true,
      manifest: { contributes: { formats: [{ id: 'spine', displayName: 'Spine', extensions: ['.skel', '.atlas'] }] } },
      server: formatServer('spine', '', "ctx.register.route({ method: 'GET', path: 'ping', handler: async () => ({ body: 'pong' }) })\n    globalThis.__bbSpineDeactivated = 0") .replace('activate(ctx) {', 'deactivate() { globalThis.__bbSpineDeactivated++ },\n  activate(ctx) {')
    })
    const cfg = machine()
    const events = createEventBus()
    const h = host(cfg, events)
    await h.discover()
    const lib = fakeLibrary(base, libraryJson())
    const lp = await h.forLibrary(lib)
    expect(lp.missingPluginFor('.skel')).toBeNull()

    const info = await h.install(src)
    expect(info).toMatchObject({ id: 'community.spine', source: 'path', status: 'disabled', installPath: src, hasWeb: true })
    expect(cfg.get().installed).toEqual([{ id: 'community.spine', spec: src, source: 'path' }])
    expect(h.webEntry('community.spine')).toBe(path.join(src, 'web.js'))
    expect(h.webEntry('bowerbird.image')).toBeNull()
    expect(await lp.identify(fileRef('hero.skel'))).toBeNull()

    const enabled = await h.setEnabled('community.spine', true, lib)
    expect(enabled.status).toBe('enabled')
    expect(lib.json.plugins).toEqual({ 'community.spine': '^1.4.0' })
    expect(lib.json.pluginFormats).toEqual({ '.skel': 'community.spine', '.atlas': 'community.spine' })
    expect(await lp.identify(fileRef('hero.skel'))).toMatchObject({ pluginId: 'community.spine', format: 'spine' })
    expect(lp.routes().map(r => `${r.pluginId}/${r.route.path}`)).toEqual(['community.spine/ping'])
    expect(events.history.filter(e => e.type === 'plugin.updated').map(e => (e.data as { status: string }).status)).toContain('enabled')

    await h.setEnabled('community.spine', false, 'lib1')
    expect(lib.json.plugins).toEqual({})
    expect(lib.json.pluginFormats).toEqual({ '.skel': 'community.spine', '.atlas': 'community.spine' })
    expect((globalThis as Record<string, unknown>).__bbSpineDeactivated).toBe(1)
    expect(lp.routes()).toEqual([])

    await expect(h.setEnabled('bowerbird.image', false, lib)).rejects.toMatchObject({ code: 'unsupported' })
    await expect(h.remove('bowerbird.image')).rejects.toMatchObject({ code: 'unsupported' })

    await h.remove('community.spine')
    expect(cfg.get().installed).toEqual([])
    expect(h.list(lib).map(p => p.id)).toEqual(['bowerbird.image'])
    expect(fs.existsSync(src)).toBe(true) // path installs are never deleted
    await expect(h.remove('community.spine')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reload() after library.json changed (LibraryService.setPluginEnabled) activates, records pluginFormats, deactivates', async () => {
    const src = writePlugin(base, 'src/spine2', {
      id: 'community.spine', version: '2.0.0',
      manifest: { contributes: { formats: [{ id: 'spine', displayName: 'Spine', extensions: ['.skel'] }] } }, server: formatServer('spine')
    })
    const cfg = machine({ installed: [{ id: 'community.spine', spec: src, source: 'path' }] })
    const h = host(cfg)
    await h.discover()
    const lib = fakeLibrary(base, libraryJson({}, { pluginFormats: { '.skel': 'community.oldspine' } }))
    const lp = await h.forLibrary(lib)
    expect(lp.enabled()).toEqual([])
    await lib.updateLibraryJson(j => { j.plugins['community.spine'] = '^2.0.0' })
    await lp.reload()
    expect(lp.enabled().map(p => p.id)).toEqual(['community.spine'])
    expect(lib.json.pluginFormats).toEqual({ '.skel': 'community.spine' })
    expect(await lp.identify(fileRef('a.skel'))).toMatchObject({ pluginId: 'community.spine' })
    await lib.updateLibraryJson(j => { delete j.plugins['community.spine'] })
    await lp.reload()
    expect(lp.enabled()).toEqual([])
    expect(h.list(lib).find(p => p.id === 'community.spine')!.status).toBe('disabled')
  })

  it('refuses a path install inside a registered library and does not load such a plugin (ADR-012)', async () => {
    const libRoot = path.join(base, 'libs', 'star')
    const inside = writePlugin(path.join(libRoot, 'tools'), 'evil', { id: 'community.evil', server: 'export default { activate() { globalThis.__bbEvil = true } }' })
    const cfg = machine({ libraries: [{ id: 'lib-star', root: libRoot }] })
    const h = host(cfg)
    await h.discover()
    await expect(h.install(inside)).rejects.toMatchObject({ code: 'validation_failed' })
    expect(cfg.get().installed).toEqual([])
    // Also when it got into the config some other way (or the library was registered later).
    await cfg.save({ installed: [{ id: 'community.evil', spec: inside, source: 'path' }] })
    await h.discover()
    const lib = fakeLibrary(base, libraryJson({ 'community.evil': '^1.0.0' }))
    await h.forLibrary(lib)
    const info = h.list(lib).find(p => p.id === 'community.evil')!
    expect(info.status).toBe('failed')
    expect(info.reason).toContain('资产库')
    expect((globalThis as Record<string, unknown>).__bbEvil).toBeUndefined()
    // The library a handle was opened for counts too.
    const own = writePlugin(path.join(lib.paths.root, 'plugins'), 'p', { id: 'community.own' })
    await expect(h.install(own)).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('declared-and-missing plugins: missingPluginFor answers from pluginFormats (ADR-044)', async () => {
    const h = host()
    await h.discover()
    const lib = fakeLibrary(base, libraryJson({ 'community.spine': '^1.4' }, { pluginFormats: { '.skel': 'community.spine', '.old': 'community.gone' } }))
    const lp = await h.forLibrary(lib)
    expect(lp.missingPluginFor('.skel')).toEqual({ id: 'community.spine', range: '^1.4' })
    expect(lp.missingPluginFor('.SKEL')).toEqual({ id: 'community.spine', range: '^1.4' })
    expect(lp.missingPluginFor('.old')).toBeNull() // not declared any more (disabled)
    expect(lp.missingPluginFor('.png')).toBeNull()
  })

  it('installs from npm through the runner, updates with re-import, uninstalls', async () => {
    const calls: string[][] = []
    let version = '2.0.0'
    const npm = async (args: string[]): Promise<void> => {
      calls.push(args)
      const nm = path.join(installDir, 'node_modules')
      if (args[0] === 'install') {
        writePlugin(path.join(nm, '@studio'), 'bowerbird-checks', {
          id: 'studio.checks', name: '@studio/bowerbird-checks', version,
          manifest: { contributes: { formats: [{ id: 'chk', displayName: 'chk', extensions: ['.chk'] }] } },
          server: formatServer('chk', '', `globalThis.__bbChecksVersion = ${JSON.stringify(version)}`)
        })
      } else if (args[0] === 'uninstall') fs.rmSync(path.join(nm, '@studio', 'bowerbird-checks'), { recursive: true, force: true })
    }
    const cfg = machine()
    const h = host(cfg, createEventBus(), { npm })
    await h.discover()
    const lib = fakeLibrary(base, libraryJson({ 'studio.checks': '^2.0.0' }))
    await h.forLibrary(lib)
    expect(h.list(lib).find(p => p.id === 'studio.checks')!.status).toBe('missing')

    const info = await h.install('@studio/bowerbird-checks@^2')
    expect(calls[0]).toEqual(['install', '--prefix', installDir, '--no-audit', '--no-fund', '@studio/bowerbird-checks@^2'])
    expect(info).toMatchObject({ id: 'studio.checks', source: 'npm', packageName: '@studio/bowerbird-checks', version: '2.0.0' })
    expect(cfg.get().installed).toEqual([{ id: 'studio.checks', spec: '@studio/bowerbird-checks', source: 'npm' }])
    // Declared in the library → activated right away.
    expect(h.list(lib).find(p => p.id === 'studio.checks')!.status).toBe('enabled')
    expect((globalThis as Record<string, unknown>).__bbChecksVersion).toBe('2.0.0')

    version = '2.1.0'
    await new Promise(r => setTimeout(r, 20))
    const updated = await h.update('studio.checks')
    expect(calls[1]).toEqual(['install', '--prefix', installDir, '--no-audit', '--no-fund', '@studio/bowerbird-checks@latest'])
    expect(updated.version).toBe('2.1.0')
    expect((globalThis as Record<string, unknown>).__bbChecksVersion).toBe('2.1.0')

    await h.remove('studio.checks')
    expect(calls[2]).toEqual(['uninstall', '--prefix', installDir, '@studio/bowerbird-checks'])
    expect(cfg.get().installed).toEqual([])
    expect(h.list(lib).find(p => p.id === 'studio.checks')!.status).toBe('missing')
  })

  it('refuses to install an invalid plugin and rolls the npm install back', async () => {
    const bad = writePlugin(base, 'bad', { id: 'community.bad', apiVersion: 9 })
    const calls: string[][] = []
    const h = host(machine(), createEventBus(), {
      npm: async args => {
        calls.push(args)
        if (args[0] === 'install') writePlugin(path.join(installDir, 'node_modules'), 'pkg-bad', { id: 'community.bad2', name: 'pkg-bad', manifest: { displayName: 42 } })
      }
    })
    await h.discover()
    await expect(h.install(bad)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(h.install(path.join(base, 'nowhere'))).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(h.install('pkg-bad')).rejects.toMatchObject({ code: 'validation_failed' })
    expect(calls.map(c => c[0])).toEqual(['install', 'uninstall'])
  })

  it('installing another plugin leaves running ones alone; updating a path plugin loads its new code', async () => {
    writePlugin(builtin, 'counter', { id: 'bowerbird.counter', server: 'export default { activate() { globalThis.__bbCounter = (globalThis.__bbCounter ?? 0) + 1 } }' })
    const dev = writePlugin(base, 'dev/mine', { id: 'studio.mine', server: 'export default { activate() { globalThis.__bbMine = "v1" } }' })
    const h = host()
    await h.discover()
    const lib = fakeLibrary(base, libraryJson({ 'studio.mine': '^1.0.0' }))
    await h.forLibrary(lib)
    expect((globalThis as Record<string, unknown>).__bbCounter).toBe(1)
    await h.install(dev)
    expect((globalThis as Record<string, unknown>).__bbMine).toBe('v1')
    expect((globalThis as Record<string, unknown>).__bbCounter).toBe(1)
    await new Promise(r => setTimeout(r, 20))
    fs.writeFileSync(path.join(dev, 'server.js'), 'export default { activate() { globalThis.__bbMine = "v2" } }')
    await h.update('studio.mine')
    expect((globalThis as Record<string, unknown>).__bbMine).toBe('v2')
    expect((globalThis as Record<string, unknown>).__bbCounter).toBe(1)
  })

  it('reports the version store with its ignore folders and the other version plugins enabled at the same time', async () => {
    const vs = (id: string, ignore?: string[]) => writePlugin(builtin, id, {
      id, manifest: { contributes: { versionStore: { id: 'vs', displayName: id.toUpperCase(), ...(ignore ? { ignore } : {}) } } },
      server: `export default { activate(ctx) { ctx.register.versionStore({ id: 'vs', init: async () => {}, status: async () => ({ ready: true, dirty: false }), commit: async () => ({ id: '1', at: '', actor: '', message: '' }), history: async () => [], read: async () => new ReadableStream(), has: async () => false }) } }`
    })
    vs('studio.lore', ['.lore/'])
    vs('studio.gitlfs', ['.git/', 'lfs-cache/'])
    const h = host()
    await h.discover()
    const lp = await h.forLibrary(fakeLibrary(base, libraryJson()))
    expect(lp.versionStore()).toMatchObject({ pluginId: 'studio.gitlfs', displayName: 'STUDIO.GITLFS', conflicts: ['studio.lore'] })
    expect(lp.versionStore()!.ignore).toEqual(['.git/', 'lfs-cache/'])
  })

  it('exposes the machine config, manifest rate limits and change notices to the pipeline', async () => {
    writePlugin(builtin, 'img', { id: 'bowerbird.image' })
    const ai = writePlugin(base, 'ext/ai', { id: 'studio.ai', manifest: { rateLimit: 30 } })
    const cfg = machine({ concurrency: 3, installed: [{ id: 'studio.ai', spec: ai, source: 'path' }] })
    const h = host(cfg)
    await h.discover()
    const lib = fakeLibrary(base, libraryJson())
    const lp = (await h.forLibrary(lib)) as unknown as import('../library-plugins.js').LibraryPluginsExtras
    expect(lp.machineConfig().concurrency).toBe(3)
    expect(lp.rateLimit('studio.ai')).toBeNull() // not enabled yet
    const changes: Array<{ started: string[]; stopped: string[] }> = []
    lp.onChange(c => changes.push(c))
    await h.setEnabled('studio.ai', true, lib)
    expect(lp.rateLimit('studio.ai')).toBe(30)
    expect(lp.rateLimit('bowerbird.image')).toBeNull()
    await h.setEnabled('studio.ai', false, lib)
    expect(changes).toEqual([{ started: ['studio.ai'], stopped: [] }, { started: [], stopped: ['studio.ai'] }])
  })

  it('a plugin folder that a library registered later now contains is failed and stopped (ADR-012)', async () => {
    const libRoot = path.join(base, 'later-lib')
    const dir = writePlugin(path.join(libRoot, 'tools'), 'p', { id: 'studio.p', server: 'export default { activate() { globalThis.__bbLater = (globalThis.__bbLater ?? 0) + 1 }, deactivate() { globalThis.__bbLaterStopped = true } }' })
    const cfg = machine()
    const h = host(cfg)
    await h.discover()
    await h.install(dir)
    const lib = fakeLibrary(base, libraryJson({ 'studio.p': '^1.0.0' }))
    const lp = await h.forLibrary(lib)
    expect(lp.enabled().map(p => p.id)).toContain('studio.p')
    // The folder becomes (part of) a registered library.
    await cfg.save({ libraries: [{ id: 'later', root: libRoot }] })
    const info = h.list(lib).find(p => p.id === 'studio.p')!
    expect(info.status).toBe('failed')
    expect(info.reason).toContain('资产库')
    for (let i = 0; i < 50 && lp.enabled().some(p => p.id === 'studio.p'); i++) await new Promise(r => setTimeout(r, 5))
    expect(lp.enabled().map(p => p.id)).not.toContain('studio.p')
    expect((globalThis as Record<string, unknown>).__bbLaterStopped).toBe(true)
  })

  it('close() deactivates every plugin', async () => {
    writePlugin(builtin, 'p', { id: 'bowerbird.p', server: 'export default { activate() {}, deactivate() { globalThis.__bbClosed = (globalThis.__bbClosed ?? 0) + 1 } }' })
    const h = host()
    await h.discover()
    await h.forLibrary(fakeLibrary(base, libraryJson()))
    await h.close()
    expect((globalThis as Record<string, unknown>).__bbClosed).toBe(1)
  })
})
