/** Second review round: plugin setting scopes, reserved fields, ADR-046 on every write path, watch state, loopback, version commits, version store folders. */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupTmp, ctx, agent, fakeVersionStore, makeLib, type TestLib } from './harness.js'
import { isLoopbackHost } from '../net.js'

let libs: TestLib[] = []
async function lib(o?: Parameters<typeof makeLib>[0]): Promise<TestLib> { const t = await makeLib(o); libs.push(t); return t }
afterEach(async () => { vi.restoreAllMocks(); for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const bytes = (s: string) => new Uint8Array(Buffer.from(s))
/** Upload a file and give it some information, so it has its .bmeta (ADR-067). */
async function up(t: TestLib, p: string, content = p) {
  const i = p.lastIndexOf('/')
  const id = (await t.svc.register({ fields: { folder: i < 0 ? '' : p.slice(0, i) }, file: { name: p.slice(i + 1), data: bytes(content) } }, ctx)).asset!.id
  await t.keep(p)
  return id
}
const raw = (t: TestLib, rel: string) => fs.readFileSync(t.abs(rel + '.bmeta'), 'utf8')
/** An outside edit: same asset, a tag added, written in another tool's formatting. */
function editOutside(t: TestLib, rel: string, tag: string) {
  const m = t.sidecar(rel)
  fs.writeFileSync(t.abs(rel + '.bmeta'), JSON.stringify({ ...m, tags: [...(m.tags ?? []), tag] }))
}

describe('1. plugin settings in library.json are library-scoped only', () => {
  it('refuses machine-scoped and undeclared keys (credentials never enter the library)', async () => {
    const t = await lib()
    await t.svc.setPluginLibrarySettings('test.model', { environment: 'studio' }, ctx)
    expect((await t.svc.fs.readLibraryJson())?.settings.plugins).toEqual({ 'test.model': { environment: 'studio' } })
    await expect(t.svc.setPluginLibrarySettings('test.model', { apiKey: 'sk-secret' }, ctx)).rejects.toMatchObject({ code: 'validation_failed', details: { keys: ['apiKey'] } })
    await expect(t.svc.setPluginLibrarySettings('test.model', { maxPixelRatio: 2 }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(t.svc.setPluginLibrarySettings('test.model', { nope: 1 }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(t.svc.setPluginLibrarySettings('test.image', { anything: 1 }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(t.svc.patchLibrary({ settings: { plugins: { 'test.model': { apiKey: 'sk-secret' } } } }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    expect(fs.readFileSync(t.abs('.bowerbird/library.json'), 'utf8')).not.toContain('sk-secret')
  })
})

describe('2. kernel-reserved field namespaces', () => {
  it('refuses PATCH fields under bowerbird.*', async () => {
    const t = await lib()
    const id = await up(t, 'a.png', 'a')
    for (const ns of ['bowerbird.identity', 'bowerbird.bundle', 'bowerbird']) {
      await expect(t.svc.patch(id, { fields: { [ns]: { x: 1 } } }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    }
    await t.svc.patch(id, { fields: { 'studio.prop': { rarity: 'rare' } } }, ctx)
    expect(t.sidecar('a.png').fields?.['studio.prop']).toEqual({ rarity: 'rare' })
  })
})

describe('3. ADR-046 on every write path', () => {
  it('takes in outside edits first and never overwrites an unreadable sidecar', async () => {
    const t = await lib()
    // replace content
    const a = await up(t, 'a.png', 'a')
    editOutside(t, 'a.png', 'outside')
    await t.svc.replaceContent(a, { name: 'a.png', data: bytes('a v2') }, undefined, ctx)
    expect(t.sidecar('a.png').tags).toEqual(['outside'])
    fs.writeFileSync(t.abs('a.png.bmeta'), '{ broken')
    await expect(t.svc.replaceContent(a, { name: 'a.png', data: bytes('a v3') }, undefined, ctx)).rejects.toMatchObject({ code: 'conflict' })
    expect(t.read('a.png')).toBe('a v2')
    expect(raw(t, 'a.png')).toBe('{ broken')

    // AI enrich and probe on an unreadable sidecar: nothing written
    await t.svc.deps.applyEnrich(a, 'test.ai', { tags: ['ai'] })
    await t.svc.deps.applyProbe(a, 'test.image', { tech: {}, auxiliary: true, references: [] })
    expect(raw(t, 'a.png')).toBe('{ broken')

    // tag rename skips the unreadable one and renames the rest on top of their outside edits
    const b = await up(t, 'b.png', 'b')
    await t.svc.patch(b, { tags: { add: ['旧名'] } }, ctx)
    editOutside(t, 'b.png', 'outside-b')
    await t.svc.patchTags({ rename: { from: '旧名', to: '新名' } }, ctx)
    expect(t.sidecar('b.png').tags).toEqual(['新名', 'outside-b'])
    expect(raw(t, 'a.png')).toBe('{ broken')

    // AI enrich keeps an outside edit
    editOutside(t, 'b.png', 'outside-b2')
    await t.svc.deps.applyEnrich(b, 'test.ai', { tags: ['木质'] })
    expect(t.sidecar('b.png').tags).toEqual(['新名', 'outside-b', 'outside-b2'])
    expect(t.sidecar('b.png').auto?.tags).toEqual(['木质'])

    // slot pairing keeps an outside edit
    const m = await up(t, 'm/model.gltf', '{}')
    await up(t, 'm/tex.png', 'tex')
    editOutside(t, 'm/model.gltf', 'outside-m')
    await t.svc.deps.applyProbe(m, 'test.model', { tech: {}, references: ['tex.png'] })
    expect(t.sidecar('m/model.gltf')).toMatchObject({ tags: ['outside-m'], relations: [{ type: 'uses', slot: 'tex.png' }] })

    // mark as copy keeps an outside edit of the newer one
    const x = await up(t, 'x.png', 'same')
    await new Promise(r => setTimeout(r, 5))
    await up(t, 'y.png', 'same')
    editOutside(t, 'y.png', 'outside-y')
    const dup = t.issues('duplicate-content')[0]!
    await t.svc.resolveIssue(dup.id, { action: 'mark-copy' }, ctx)
    expect(t.sidecar('y.png')).toMatchObject({ tags: ['outside-y'], relations: [{ type: 'source', to: x }] })

    // a bundle re-points relations of an outside referrer without losing its outside edit
    const page = await up(t, 'site/index.html', '<html>')
    const ref = await up(t, 'ref.png', 'ref')
    await t.svc.addRelation(ref, { type: 'uses', to: page }, ctx)
    editOutside(t, 'ref.png', 'outside-ref')
    const bundle = await t.svc.makeBundle('site', undefined, ctx)
    expect(t.sidecar('ref.png')).toMatchObject({ tags: ['outside-ref'], relations: [{ type: 'uses', to: bundle.id, slot: 'index.html' }] })

    // the last line of defence: a raced write is refused, not applied over the outside edit
    const c = await up(t, 'c.png', 'c')
    editOutside(t, 'c.png', 'raced')
    const stale = t.svc.store.meta(t.row(c)!)
    await expect(t.svc.core.writeMeta('c.png', { ...stale, description: '过期的写入' })).rejects.toMatchObject({ code: 'conflict' })
    expect(t.sidecar('c.png').tags).toEqual(['raced'])
  })

  it('relocating and swapping identities start from the sidecar as it is on disk', async () => {
    const t = await lib()
    const h = await up(t, 'art/hero.fbx', 'v1')
    t.rm('art/hero.fbx')
    await t.scan()
    editOutside(t, 'art/hero.fbx', 'outside-h')
    t.write('art/hero_new.fbx', 'v2')
    const issue = t.issues('missing-file')[0]!
    await t.svc.resolveIssue(issue.id, { action: 'relocate', params: { path: 'art/hero_new.fbx', moveBack: true } }, ctx)
    expect(t.sidecar('art/hero.fbx')).toMatchObject({ id: h, tags: ['outside-h'] })

    t.write('x.png', 'x')
    await t.scan()
    await t.keep('x.png')
    t.cp('x.png', 'x (1).png'); t.cp('x.png.bmeta', 'x (1).png.bmeta')
    await t.scan()
    editOutside(t, 'x.png', 'outside-x')
    const dupId = t.issues('duplicate-guid')[0]!.id
    await t.svc.resolveIssue(dupId, { action: 'swap' }, ctx)
    expect(t.sidecar('x (1).png').tags).toEqual(['outside-x'])
  })
})

describe('4. watch state while running', () => {
  it('reports when the folder limit is passed later', async () => {
    const t = await lib({ watch: false, stableMs: 200 })
    t.write('a/x.png', 'x', -100)
    await t.scan()
    const sc = t.svc.scanner as unknown as { o: { watchMode: string; maxWatchDirs: number } }
    sc.o.watchMode = 'per-directory'
    sc.o.maxWatchDirs = 3
    expect(await t.svc.scanner.startWatching()).toMatchObject({ enabled: true, dirs: 2 })
    await new Promise(r => setTimeout(r, 400))
    for (const d of ['b', 'c', 'd']) fs.mkdirSync(t.abs(d))
    const end = Date.now() + 8000
    while (Date.now() < end && t.svc.scanner.watchState.enabled) await new Promise(r => setTimeout(r, 50))
    expect(t.svc.scanner.watchState).toMatchObject({ enabled: false, mode: 'off' })
    expect(t.svc.scanner.watchState.reason).toContain('定时扫描')
    expect(((await t.svc.info(ctx)) as unknown as { watch: { enabled: boolean } }).watch.enabled).toBe(false)
  }, 20_000)

  it('does not swallow a refused watch (ENOSPC): watching stops and says why', async () => {
    const t = await lib({ watch: false })
    t.write('a/x.png', 'x', -100)
    t.write('b/y.png', 'y', -100)
    await t.scan()
    ;(t.svc.scanner as unknown as { o: { watchMode: string } }).o.watchMode = 'per-directory'
    const real = fs.watch
    let n = 0
    vi.spyOn(fs, 'watch').mockImplementation(((...args: Parameters<typeof fs.watch>) => {
      if (++n > 2) { const e = new Error('ENOSPC: System limit for number of file watchers reached') as NodeJS.ErrnoException; e.code = 'ENOSPC'; throw e }
      return real(...args)
    }) as typeof fs.watch)
    const state = await t.svc.scanner.startWatching()
    expect(state).toMatchObject({ enabled: false, mode: 'off' })
    expect(state.reason).toContain('ENOSPC')
    expect(t.svc.scanner.watchState.reason).toContain('ENOSPC')
  })
})

describe('5. loopback like the server', () => {
  it('treats all of 127.0.0.0/8, ::1 and ::ffff:127.x as this machine only', () => {
    for (const h of ['127.0.0.1', '127.0.0.2', '127.255.0.9', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) expect(isLoopbackHost(h), h).toBe(true)
    for (const h of ['0.0.0.0', '::', '192.168.1.2', '::ffff:10.0.0.1', 'example.com']) expect(isLoopbackHost(h), h).toBe(false)
  })
})

describe('6. version commits for every metadata write', () => {
  it('commits the sidecar after each of the operations versioning.md lists', async () => {
    const holder: { store?: ReturnType<typeof fakeVersionStore> } = {}
    const t = await lib({ plugins: { get versionStore() { return holder.store ?? null } } as never })
    holder.store = fakeVersionStore(t.root)
    const committer = (t.svc as unknown as { committer: { flush(): Promise<void> } }).committer
    const seen: string[][] = []
    const orig = holder.store.commit
    holder.store.commit = async (c, meta) => { seen.push(c.paths); return orig(c, meta) }
    const committed = async (fn: () => Promise<unknown>, expectPath: string) => {
      await committer.flush()
      seen.length = 0
      await fn()
      await committer.flush()
      expect(seen.flat(), expectPath).toContain(expectPath)
    }
    const up2 = await up(t, 'u.png', 'up')
    const down = await up(t, 'd.png', 'down')
    await t.svc.addRelation(down, { type: 'source', to: up2 }, ctx)
    await t.svc.replaceContent(up2, { name: 'u.png', data: bytes('up v2') }, undefined, ctx)
    await committed(() => t.svc.acknowledgeUpstream(down, up2, ctx), 'd.png.bmeta')
    await t.svc.deps.applyEnrich(down, 'test.ai', { tags: ['ai1', 'ai2'] })
    await committed(() => t.svc.acceptAutoTags(down, ['ai1'], ctx), 'd.png.bmeta')
    await committed(() => t.svc.dismissAutoTags(down, ['ai2'], ctx), 'd.png.bmeta')
    await committed(() => t.svc.setManualThumbnail(down, bytes('webp'), ctx), 'd.png.bmeta')
    await committed(() => t.svc.clearManualThumbnail(down, ctx), 'd.png.bmeta')
    await committed(() => t.svc.patchTags({ rename: { from: 'ai1', to: 'ai-one' } }, ctx), 'd.png.bmeta')
    await committed(() => t.svc.deps.applyEnrich(down, 'test.ai', { description: 'AI 说明' }), 'd.png.bmeta')
    const m = await up(t, 'm/model.gltf', '{}')
    await up(t, 'm/tex.png', 'tex')
    await committed(() => t.svc.deps.applyProbe(m, 'test.model', { tech: {}, references: ['tex.png'] }), 'm/model.gltf.bmeta')
    t.write('loose.png', 'loose')
    await committed(() => t.svc.register({ fields: { path: 'loose.png', tags: ['x'] } }, agent), 'loose.png.bmeta')
    await committed(() => t.svc.retarget({ from: up2, to: m, dryRun: false }, agent), 'd.png.bmeta')
    fs.mkdirSync(t.abs('f'), { recursive: true })
    await committed(() => t.svc.patchFolder({ path: 'f', label: '文件夹' }, ctx), 'f/_folder.bmeta')
    const p = await up(t, 'p.png', 'same')
    await new Promise(r => setTimeout(r, 5))
    await up(t, 'q.png', 'same')
    await committed(() => t.svc.resolveIssue(t.issues('duplicate-content')[0]!.id, { action: 'mark-copy' }, ctx), 'q.png.bmeta')
    void p
    expect(seen.flat().some(x => x.endsWith('.bmeta.bmeta'))).toBe(false)
  })
})

describe('7. version store folders and conflicts', () => {
  it('skips the version store’s own folders and says when several version plugins are enabled', async () => {
    const holder: { store?: ReturnType<typeof fakeVersionStore> } = {}
    const t = await lib({ plugins: { get versionStore() { return holder.store ?? null }, versionIgnore: ['vcs-data/'], versionConflicts: ['community.git'] } as never })
    holder.store = fakeVersionStore(t.root)
    await t.svc.setPluginEnabled('community.spine', true, ctx) // any plugin reload re-reads the version store
    t.write('vcs-data/objects/ab', 'packed')
    t.write('art/a.png', 'a')
    await t.scan()
    expect(t.rowByPath('vcs-data/objects/ab')).toBeUndefined()
    expect(t.rowByPath('art/a.png')).toBeDefined()
    const issue = t.issues().find(i => i.id === 'plugin-missing:version-store')!
    expect(issue).toBeDefined()
    expect(JSON.parse(issue.details_json)).toMatchObject({ kind: 'version-store-conflict', used: '测试版本', conflicts: ['community.git'] })
    expect(JSON.parse(issue.details_json).message).toBe('同时启用了多个版本插件，只用「测试版本」，community.git 不生效。停用多余的版本插件后这条提示会消失。')
  })
})

describe('export plan: files of a bundle carry their path inside it', () => {
  it('fills `inner` for a bundle and for a dependency inside a bundle, never for plain files', async () => {
    const t = await lib()
    await up(t, 'ui/shop/index.html', '<html>')
    await up(t, 'ui/shop/assets/style.css', 'body{}')
    const bundle = await t.svc.makeBundle('ui/shop', undefined, ctx)
    const page = await up(t, 'ui/page.png', 'page')
    await t.svc.addRelation(page, { type: 'uses', to: bundle.id, slot: 'assets/style.css' }, ctx)
    const own = await t.svc.exportPlan({ ids: [bundle.id], withDeps: false, layout: 'keep' })
    expect(own.files.map(f => [f.path, f.inner])).toEqual([['ui/shop/assets/style.css', 'assets/style.css'], ['ui/shop/index.html', 'index.html']])
    const withDeps = await t.svc.exportPlan({ ids: [page], withDeps: true, layout: 'keep' })
    expect(withDeps.files).toEqual([
      { path: 'ui/page.png', size: 4, assetId: page, dependency: false },
      { path: 'ui/assets/style.css', size: 6, assetId: bundle.id, dependency: true, inner: 'assets/style.css' }
    ])
  })
})
