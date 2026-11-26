/** LibraryService: bundles, slot pairing, export, versions, folders, tags, views, issues, thumbnails, batch. */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTmp, ctx, fakeVersionStore, makeLib, tmpDir, type TestLib } from './harness.js'
import { SUMMARY_IMAGE_MISSING } from '../service.js'

let libs: TestLib[] = []
async function lib(o?: Parameters<typeof makeLib>[0]): Promise<TestLib> { const t = await makeLib(o); libs.push(t); return t }
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const bytes = (s: string) => new Uint8Array(Buffer.from(s))
async function up(t: TestLib, p: string, content = p) {
  const i = p.lastIndexOf('/')
  return (await t.svc.register({ fields: { folder: i < 0 ? '' : p.slice(0, i) }, file: { name: p.slice(i + 1), data: bytes(content) } }, ctx)).asset!.id
}
const probe = (t: TestLib, id: string, references: string[], extra: Record<string, unknown> = {}) =>
  t.svc.deps.applyProbe(id, 'test.model', { tech: { triangles: 2480 }, references, ...extra })

describe('bundles (ADR-041)', () => {
  it('turns a folder into one asset; relations into it point at the bundle with the inner path as slot', async () => {
    const t = await lib()
    const page = await up(t, 'ui/shop/index.html', '<html>')
    const css = await up(t, 'ui/shop/assets/style.css', 'body{}')
    const mock = await up(t, 'ui/mock.png', 'mock')
    await t.svc.addRelation(mock, { type: 'source', to: page }, ctx)
    await t.svc.addRelation(mock, { type: 'uses', to: css }, ctx)
    await t.svc.patch(page, { tags: { add: ['商店'] } }, ctx)
    const b = await t.svc.makeBundle('ui/shop', undefined, ctx)
    expect(b.bundle).toBe(true)
    expect(b.path).toBe('ui/shop')
    expect(b.tags).toEqual(['商店'])
    expect(t.sidecar('ui/shop').bundle).toBe(true)
    expect(t.exists('ui/shop/index.html.bmeta')).toBe(false)
    expect(t.row(page)).toBeUndefined()
    // the inner records went to the trash (with info.json), not deleted (ADR-047)
    const trashed = fs.readdirSync(t.abs('.bowerbird/trash')).map(d => JSON.parse(fs.readFileSync(t.abs(`.bowerbird/trash/${d}/info.json`), 'utf8')))
    expect(trashed.map(i => i.name).sort()).toEqual(['index.html.bmeta', 'style.css.bmeta'])
    expect(b.hash).toBe(await t.svc.fs.hash('ui/shop'))
    expect(b.bundleFiles).toEqual([{ path: 'assets/style.css', size: 6, entry: false }, { path: 'index.html', size: 6, entry: true }])
    const rels = t.sidecar('ui/mock.png').relations!
    expect(rels).toEqual([
      { type: 'source', to: b.id, toHash: b.hash, slot: 'index.html' },
      { type: 'uses', to: b.id, slot: 'assets/style.css' }
    ])
    expect(t.issues('broken-reference')).toEqual([])
    expect((await t.svc.slotFile(mock, 'assets/style.css'))?.absPath).toBe(t.abs('ui/shop/assets/style.css'))
    expect((await t.svc.file(b.id)).name).toBe('index.html')
    expect((await t.svc.bundleFile(b.id, 'assets/style.css'))?.size).toBe(6)
    expect(await t.svc.bundleFile(b.id, '../mock.png')).toBeNull()
    // the scanner treats it as one asset and notices content changes inside
    t.write('ui/shop/new.js', 'x')
    await t.scan('ui/shop/assets')
    await t.scan('ui/shop/new.js')
    expect(t.exists('ui/shop/new.js.bmeta')).toBe(false)
    await t.scan()
    expect(t.rowByPath('ui/shop/new.js')).toBeUndefined()
    expect(t.row(b.id)!.hash).not.toBe(b.hash)
    expect(t.sidecar('ui/shop').versions).toHaveLength(2)
    // and moves it as one
    // the mockup was made from the old content: it is now stale (R12)
    expect(t.issues().map(i => [i.type, i.asset_id])).toEqual([['stale-upstream', mock]])
    const moved = await t.svc.move(b.id, { folder: 'archive' }, ctx)
    expect(moved.path).toBe('archive/shop')
    expect(t.exists('archive/shop/index.html')).toBe(true)
    await t.scan()
    expect(t.issues().map(i => i.type)).toEqual(['stale-upstream'])
  })
})

describe('slot pairing (ADR-018)', () => {
  it('pairs by file name the first time, never overwrites, pairs new names, drops vanished ones', async () => {
    const t = await lib()
    const model = await up(t, 'props/chest.gltf', '{}')
    const base = await up(t, 'props/textures/chest_basecolor.png', 'base')
    const normal = await up(t, 'props/chest_normal.png', 'normal')
    const other = await up(t, 'props/alt/chest_basecolor_v2.png', 'alt')
    await up(t, 'elsewhere/chest_orm.png', 'orm-outside')
    // 1. first probe: names found in the same folder or below are paired automatically
    await probe(t, model, ['chest_basecolor.png', 'chest_normal.png', 'chest_orm.png', 'chest.bin'])
    let m = t.sidecar('props/chest.gltf')
    expect(m.relations).toEqual([
      { type: 'uses', to: base, slot: 'chest_basecolor.png' },
      { type: 'uses', to: normal, slot: 'chest_normal.png' }
    ])
    let d = await t.svc.get(model, ctx)
    expect(d.unresolvedRefs).toEqual(['chest_orm.png', 'chest.bin'])
    expect(d.tech.triangles).toBe(2480)
    // 2. an existing slot relation is never overwritten, even after being replaced
    await t.svc.replaceRelation(model, { type: 'uses', to: base, slot: 'chest_basecolor.png', newTo: other }, ctx)
    await probe(t, model, ['chest_basecolor.png', 'chest_normal.png', 'chest_orm.png', 'chest.bin'])
    m = t.sidecar('props/chest.gltf')
    expect(m.relations?.find(r => r.slot === 'chest_basecolor.png')?.to).toBe(other)
    // 3. a name that newly appears is paired (here: the file was added later → also paired without re-probe)
    const orm = await up(t, 'props/chest_orm.png', 'orm')
    m = t.sidecar('props/chest.gltf')
    expect(m.relations?.find(r => r.slot === 'chest_orm.png')?.to).toBe(orm)
    d = await t.svc.get(model, ctx)
    expect(d.unresolvedRefs).toEqual(['chest.bin'])
    const bin = await up(t, 'props/chest_extra.bin', 'bin')
    await probe(t, model, ['chest_basecolor.png', 'chest_normal.png', 'chest_orm.png', 'chest_extra.bin'])
    m = t.sidecar('props/chest.gltf')
    expect(m.relations?.find(r => r.slot === 'chest_extra.bin')?.to).toBe(bin)
    // 4. names no longer in the file lose their relation
    await probe(t, model, ['chest_basecolor.png', 'chest_extra.bin'])
    m = t.sidecar('props/chest.gltf')
    expect(m.relations?.map(r => r.slot)).toEqual(['chest_basecolor.png', 'chest_extra.bin'])
    // a broken slot relation stays (R11) and is not re-paired by name
    await t.svc.trash(bin, { force: true }, ctx)
    await up(t, 'props/sub/chest_extra.bin', 'other bin')
    await probe(t, model, ['chest_basecolor.png', 'chest_extra.bin'])
    m = t.sidecar('props/chest.gltf')
    expect(m.relations?.find(r => r.slot === 'chest_extra.bin')?.to).toBe(bin)
    expect(t.issues('broken-reference').map(i => i.asset_id)).toEqual([model])
    // readSlot goes through the relation
    const af = await t.svc.deps.assetFile(model)
    expect(Buffer.from((await af!.readSlot('chest_basecolor.png'))!).toString()).toBe('alt')
    expect(await af!.readSlot('chest_extra.bin')).toBeNull()
    expect(await t.svc.deps.referencedHashes(model)).toHaveLength(2)
  })

  it('sets the auxiliary flag from the probe and stores tech, badge, text', async () => {
    const t = await lib()
    const bin = await up(t, 'm/a.bin', 'bin')
    await t.svc.deps.applyProbe(bin, 'test.model', { tech: { bytes: 3, embedded: true, codec: 'x' }, auxiliary: true, badge: '3 B', text: '正文 内容' })
    expect(t.sidecar('m/a.bin').auxiliary).toBe(true)
    const d = await t.svc.get(bin, ctx)
    expect(d.auxiliary).toBe(true)
    expect(d.badge).toBe('3 B')
    expect(d.tech).toEqual({ bytes: 3, embedded: true, codec: 'x' })
    expect((await t.svc.deps.searchDoc(bin))?.text).toBe('正文 内容')
  })
})

describe('export', () => {
  it('writes dependencies under their slot names and notes replaced counterparts', async () => {
    const t = await lib()
    const model = await up(t, 'props/chest.gltf', '{"model":1}')
    const base = await up(t, 'props/tex/chest_basecolor.png', 'base')
    const alt = await up(t, 'props/alt/new_base.png', 'alt!')
    const normal = await up(t, 'props/chest_normal.png', 'normal')
    const other = await up(t, 'other/chest.gltf', '{"model":2}')
    await probe(t, model, ['chest_basecolor.png', 'chest_normal.png'])
    await probe(t, other, [])
    await t.svc.addRelation(other, { type: 'uses', to: normal, slot: 'chest_normal.png' }, ctx)
    await t.svc.replaceRelation(model, { type: 'uses', to: base, slot: 'chest_basecolor.png', newTo: alt }, ctx)
    const plan = await t.svc.exportPlan({ ids: [model], withDeps: true, layout: 'keep' })
    expect(plan.files).toEqual([
      { path: 'props/chest.gltf', size: 11, assetId: model, dependency: false },
      { path: 'props/chest_basecolor.png', size: 4, assetId: alt, dependency: true, fromFile: 'new_base.png' },
      { path: 'props/chest_normal.png', size: 6, assetId: normal, dependency: true }
    ])
    expect(plan.dependencies).toBe(2)
    expect(plan.bytes).toBe(21)
    const flat = await t.svc.exportPlan({ ids: [model, other], withDeps: true, layout: 'flat' })
    expect(flat.duplicateNames).toBe(true)
    expect(flat.files.map(f => f.path)).toEqual(['chest.gltf', 'chest_basecolor.png', 'chest_normal.png', 'chest_1.gltf'])
    const out = path.join(tmpDir('export'), 'out')
    const res = await t.svc.exportToDir({ ids: [model], withDeps: true, layout: 'flat', dir: out }, ctx)
    expect(res.written).toBe(3)
    expect(fs.readFileSync(path.join(out, 'chest_basecolor.png'), 'utf8')).toBe('alt!')
    expect((await t.svc.exportFiles({ ids: [model], withDeps: false, layout: 'keep' }))).toEqual([['props/chest.gltf', t.abs('props/chest.gltf')]])
  })
})

describe('versions', () => {
  it('without a version plugin: records only, no content', async () => {
    const t = await lib()
    const id = await up(t, 'a.png', 'v1')
    await t.svc.replaceContent(id, { name: 'a.png', data: bytes('v2') }, '第二版', ctx)
    const v = await t.svc.versions(id)
    expect(v.store).toBeNull()
    expect(v.versions.map(x => [x.n, x.current, x.hasContent, x.note ?? null])).toEqual([[1, false, false, null], [2, true, false, '第二版']])
    await expect(t.svc.versionFile(id, v.versions[0]!.hash)).rejects.toMatchObject({ code: 'unsupported' })
    await expect(t.svc.restoreVersion(id, v.versions[0]!.hash, ctx)).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('with a version plugin: reads old content and restores it as a new version', async () => {
    const base = tmpDir('vs')
    const holder: { store?: ReturnType<typeof fakeVersionStore> } = {}
    const t = await lib({ plugins: { get versionStore() { return holder.store ?? null } } as never })
    holder.store = fakeVersionStore(t.root)
    void base
    const id = await up(t, 'a.png', 'v1')
    const down = await up(t, 'down.png', 'down')
    await t.svc.addRelation(down, { type: 'source', to: id }, ctx)
    // commits are batched; flush by hand for the test
    await (t.svc as unknown as { committer: { flush(): Promise<void> } }).committer.flush()
    await t.svc.replaceContent(id, { name: 'a.png', data: bytes('v2 longer') }, undefined, ctx)
    await (t.svc as unknown as { committer: { flush(): Promise<void> } }).committer.flush()
    const v = await t.svc.versions(id)
    expect(v.store).toEqual({ id: 'test.version', displayName: '测试版本' })
    expect(v.versions.map(x => x.hasContent)).toEqual([true, true])
    const old = await t.svc.versionFile(id, v.versions[0]!.hash)
    expect(Buffer.from(await new Response(old.stream).arrayBuffer()).toString()).toBe('v1')
    await t.svc.acknowledgeUpstream(down, id, ctx)
    const r = await t.svc.restoreVersion(id, v.versions[0]!.hash, ctx)
    expect(r.version).toBe(3)
    expect(r.staleDownstream).toBe(1)
    expect(t.read('a.png')).toBe('v1')
    const v3 = (await t.svc.versions(id)).versions[2]!
    expect(v3).toMatchObject({ n: 3, current: true, restoredFrom: 1, note: '恢复为 v1' })
    expect(t.issues('stale-upstream').map(i => i.asset_id)).toEqual([down])
  })
})

describe('folders', () => {
  it('lists the tree with counts, last change, display settings and inherited defaults', async () => {
    const t = await lib()
    await up(t, 'props/chest/a.png')
    await up(t, 'props/chest/b.png')
    await up(t, 'props/c.png')
    await t.svc.createFolder('empty/inner', ctx)
    await expect(t.svc.createFolder('props', ctx)).rejects.toMatchObject({ code: 'conflict' })
    await t.svc.patchFolder({ path: 'props', label: '道具', icon: 'box', description: '道具类', defaults: { stage: 'runtime', tags: ['道具'] } }, ctx)
    await t.svc.patchFolder({ path: 'props/chest', defaults: { review: 'exempt' } }, ctx)
    const root = await t.svc.folders()
    expect(root.count).toBe(3)
    const props = root.children.find(c => c.path === 'props')!
    expect(props).toMatchObject({ label: '道具', icon: 'box', description: '道具类', count: 3 })
    const chest = props.children.find(c => c.path === 'props/chest')!
    expect(chest.count).toBe(2)
    expect(chest.effectiveDefaults).toEqual({ stage: 'runtime', tags: ['道具'], review: 'exempt', from: { stage: 'props', tags: 'props', review: 'props/chest' } })
    expect(chest.modified).not.toBeNull()
    expect(root.children.find(c => c.path === 'empty')?.children[0]?.path).toBe('empty/inner')
    await t.svc.patchFolder({ path: 'props', label: null, defaults: null }, ctx)
    expect((await t.svc.fs.readFolderMeta('props'))).toEqual({ bb: 1, icon: 'box', description: '道具类' })
    // rename and move change the paths of everything inside, GUIDs stay
    const a = t.idOf('props/chest/a.png')
    await t.svc.patchFolder({ path: 'props/chest', rename: 'box' }, ctx)
    expect(t.row(a)!.path).toBe('props/box/a.png')
    await t.svc.patchFolder({ path: 'props/box', moveTo: 'archive' }, ctx)
    expect(t.row(a)!.path).toBe('archive/box/a.png')
    expect(t.sidecar('archive/box/a.png').id).toBe(a)
    await t.scan()
    expect(t.issues()).toEqual([])
  })
})

describe('tags', () => {
  it('renames (old name stays as alias), merges, defines, adopts AI tags library-wide', async () => {
    const t = await lib()
    const a = await up(t, 'a.png')
    const b = await up(t, 'b.png')
    await t.svc.patch(a, { tags: { add: ['宝箱', 'chest'] } }, ctx)
    await t.svc.patch(b, { tags: { add: ['chest'] } }, ctx)
    await t.svc.deps.applyEnrich(b, 'test.ai', { tags: ['木质', '宝箱'], description: 'AI 说明' })
    expect(t.sidecar('b.png').auto).toMatchObject({ tags: ['木质', '宝箱'], description: 'AI 说明', by: 'test.ai' })
    expect((await t.svc.patchTags({ rename: { from: '宝箱', to: '箱子' } }, ctx)).affected).toBe(2)
    expect(t.sidecar('a.png').tags).toEqual(['箱子', 'chest'])
    expect(t.sidecar('b.png').auto?.tags).toEqual(['木质', '箱子'])
    expect((await t.svc.patchTags({ merge: { from: 'chest', into: '箱子' } }, ctx)).affected).toBe(2)
    expect(t.sidecar('a.png').tags).toEqual(['箱子'])
    await t.svc.patchTags({ define: { name: '箱子', group: '道具', color: '#c80' } }, ctx)
    const tags = await t.svc.tags()
    expect(tags.tags.find(x => x.name === '箱子')).toMatchObject({ count: 2, group: '道具', color: '#c80', aliases: ['宝箱', 'chest'] })
    expect(tags.groups).toEqual(['道具'])
    expect(tags.tags.find(x => x.name === '木质')).toMatchObject({ count: 0, aiCount: 1 })
    expect((await t.svc.acceptTagEverywhere('木质', ctx)).affected).toBe(1)
    expect(t.sidecar('b.png').tags).toEqual(['箱子', '木质'])
    expect(t.sidecar('b.png').auto?.tags).toEqual(['箱子'])
    await t.svc.dismissTagEverywhere(null, ctx)
    expect(t.sidecar('b.png').auto?.tags).toBeUndefined()
    // a new tag similar to an alias suggests the tag it belongs to
    const r = await t.svc.patch(a, { tags: { add: ['chests'] } }, ctx)
    expect(r.newTags).toEqual([{ tag: 'chests', similar: expect.arrayContaining(['箱子']) }])
  })
})

describe('smart folders', () => {
  it('has built-in views and saved queries with counts', async () => {
    const t = await lib()
    await up(t, 'a.png')
    const views = await t.svc.putView('AI 生成待审', { filter: { review: ['pending'], method: ['ai-generate'] } }, undefined, ctx)
    expect(views.map(v => [v.name, v.builtin])).toEqual([['all', true], ['untagged', true], ['pending', true], ['issues', true], ['trash', true], ['AI 生成待审', false]])
    expect(views[0]!.count).toBe(1)
    expect(fs.readdirSync(t.abs('.bowerbird/views'))).toEqual(['AI 生成待审.json'])
    await t.svc.putView('AI 生成待审', { filter: { review: ['pending'] } }, '待审 2', ctx)
    expect((await t.svc.views()).map(v => v.name)).toContain('待审 2')
    await expect(t.svc.deleteView('all', ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await t.svc.deleteView('待审 2', ctx)
    expect((await t.svc.views()).filter(v => !v.builtin)).toEqual([])
  })
})

describe('issues', () => {
  it('marks a duplicate as a copy (ADR-037) and lists issues with their assets', async () => {
    const t = await lib()
    const a = await up(t, 'a.png', 'same')
    await new Promise(r => setTimeout(r, 5))
    const b = await up(t, 'b.png', 'same')
    const list = await t.svc.issues({})
    expect(list.total).toBe(1)
    expect(list.issues[0]).toMatchObject({ type: 'duplicate-content', level: 'info', assetId: b, details: { otherId: a } })
    expect(Object.keys(list.assets).sort()).toEqual([a, b].sort())
    const res = await t.svc.resolveIssue(list.issues[0]!.id, { action: 'mark-copy' }, ctx)
    expect(res.resolved).toEqual([list.issues[0]!.id])
    const rel = t.sidecar('b.png').relations?.[0]
    expect(rel).toMatchObject({ type: 'source', to: a })
    expect((await t.svc.record(rel!.record!)).record.method).toBe('copy')
    expect((await t.svc.issues({})).total).toBe(0)
    await expect(t.svc.resolveIssue('nope', { action: 'ignore' }, ctx)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('raises plugin-missing for declared plugins this machine lacks, and pipeline failures', async () => {
    const t = await lib()
    await t.svc.updateLibraryJson(l => { l.plugins['community.spine'] = '^1.4.0' })
    await t.scan()
    expect(t.issues('plugin-missing').map(i => JSON.parse(i.details_json))).toEqual([{ plugin: 'community.spine', range: '^1.4.0' }])
    const id = await up(t, 'v.mov', 'video')
    await t.svc.deps.pipelineIssue(id, 'thumbnail', '解码失败')
    await t.svc.deps.setProcessing(id, { processing: false, failed: true })
    expect((await t.svc.get(id, ctx)).flags).toContain('failed')
    expect(t.issues('pipeline-failed')).toHaveLength(1)
    await t.svc.deps.pipelineIssue(id, 'thumbnail', null)
    expect(t.issues('pipeline-failed')).toEqual([])
  })

  it('suggests relocation candidates and relocates a missing file (new content = new version)', async () => {
    const t = await lib()
    const id = await up(t, 'art/hero_idle.fbx', 'hero idle v1')
    t.rm('art/hero_idle.fbx')
    await t.scan()
    t.write('art/new/hero_idle_final.fbx', 'hero idle v2!')
    await t.scan()
    const issue = t.issues('missing-file')[0]!
    const c = await t.svc.relocateCandidates(issue.id)
    expect(c.candidates[0]).toMatchObject({ path: 'art/new/hero_idle_final.fbx', sameContent: false, reason: '名字相近' })
    // the candidate was registered on its own in the meantime; relocating merges it into the missing asset
    await t.svc.resolveIssue(issue.id, { action: 'relocate', params: { path: 'art/new/hero_idle_final.fbx', moveBack: true } }, ctx)
    expect(t.sidecar('art/hero_idle.fbx').id).toBe(id)
    expect(t.sidecar('art/hero_idle.fbx').versions).toHaveLength(2)
    expect(t.exists('art/new/hero_idle_final.fbx')).toBe(false)
    expect(t.issues()).toEqual([])
  })
})

describe('thumbnails and summary', () => {
  it('manual thumbnail is kept and goes stale when the content changes', async () => {
    const t = await lib()
    const id = await up(t, 'm.gltf', '{}')
    const d = await t.svc.setManualThumbnail(id, bytes('webp'), ctx)
    expect(d.thumbnailManual).toBe(true)
    expect(d.thumbState).toBe('ready')
    expect(await t.svc.thumbnailFile(id, 'thumb')).toBe(t.abs(`.bowerbird/thumbs/${id}.webp`))
    await new Promise(r => setTimeout(r, 10))
    await t.svc.replaceContent(id, { name: 'm.gltf', data: bytes('{"v":2}') }, undefined, ctx)
    const stale = t.issues('thumbnail-stale')
    expect(stale.map(i => i.asset_id)).toEqual([id])
    await t.svc.resolveIssue(stale[0]!.id, { action: 'clear-thumbnail' }, ctx)
    expect(t.sidecar('m.gltf').thumbnail).toBeUndefined()
    expect(fs.existsSync(t.abs(`.bowerbird/thumbs/${id}.webp`))).toBe(false)
    expect(t.issues()).toEqual([])
  })

  it('explains a missing overview image for browser-rendered formats', async () => {
    const t = await lib()
    const id = await up(t, 'm.gltf', '{}')
    await t.svc.deps.applyIdentify(id, { pluginId: 'test.model', pluginVersion: '2.0.0', format: 'model', thumbnail: 'browser' })
    await t.svc.deps.applyProbe(id, 'test.model', { tech: { triangles: 12 } })
    const s = await t.svc.summary(id)
    expect(s.image).toBeNull()
    expect(s.imageMissingReason).toBe(SUMMARY_IMAGE_MISSING)
    expect(s.text).toContain('triangles: 12')
    const unknown = await up(t, 'x.skel', 'skel')
    await t.svc.deps.applyIdentify(unknown, null)
    expect((await t.svc.summary(unknown)).imageMissingReason).toBeUndefined()
  })
})

describe('plugins per library', () => {
  it('enables a plugin (declared ^version, extensions recorded) and refuses to disable a builtin', async () => {
    const t = await lib()
    const skel = await up(t, 'hero_run.skel', 'skel')
    await t.svc.deps.applyIdentify(skel, null)
    t.pipeline.calls.length = 0
    await t.svc.setPluginEnabled('community.spine', true, ctx)
    let libJson = (await t.svc.fs.readLibraryJson())!
    expect(libJson.plugins['community.spine']).toBe('^1.4.2')
    expect(libJson.pluginFormats).toEqual({ '.skel': 'community.spine' })
    expect(t.pipeline.calls.map(c => c.id)).toEqual([skel])
    // the fake machine does not really load it: the library now says it needs a plugin this machine lacks
    expect(t.issues('plugin-missing')).toHaveLength(1)
    await t.svc.setPluginEnabled('community.spine', false, ctx)
    libJson = (await t.svc.fs.readLibraryJson())!
    expect(libJson.plugins['community.spine']).toBeUndefined()
    expect(libJson.pluginFormats).toEqual({ '.skel': 'community.spine' })
    expect(t.issues('plugin-missing')).toEqual([])
    await expect(t.svc.setPluginEnabled('test.image', false, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(t.svc.setPluginEnabled('nope', true, ctx)).rejects.toMatchObject({ code: 'not_found' })
    const ev = (t.hub.events as unknown as { history: Array<{ type: string; data: unknown }> }).history
    expect(ev.some(e => e.type === 'plugin.updated')).toBe(true)
  })

  it('patches only the keys really given (library settings and machine config)', async () => {
    const t = await lib()
    await t.svc.patchLibrary({ settings: { trashDays: 30, defaultStage: undefined, agentSearchScope: undefined } as never }, ctx)
    await t.svc.patchLibrary({ settings: { agentSearchScope: 'approved' } }, ctx)
    expect((await t.svc.fs.readLibraryJson())?.settings).toMatchObject({ trashDays: 30, agentSearchScope: 'approved', defaultStage: 'production' })
    const r = await t.hub.patchConfig({ port: 7500, libraries: [], scanIntervalMinutes: undefined } as never)
    expect(r.restartRequired).toBe(true)
    expect(t.hub.config().libraries.map(l => l.id)).toEqual([t.id])
    expect(t.hub.config().port).toBe(7500)
  })
})

describe('events and the run log', () => {
  it('emits the matching event for each write and logs one write line (ADR-024)', async () => {
    const t = await lib()
    const history = (t.hub.events as unknown as { history: Array<{ library: string; type: string; data: Record<string, unknown> }> }).history
    history.length = 0
    const a = await up(t, 'a.png', 'a')
    const b = await up(t, 'b.png', 'b')
    await t.svc.patch(a, { tags: { add: ['x'] } }, ctx)
    await t.svc.addRelation(b, { type: 'uses', to: a }, ctx)
    await t.svc.trash(a, { force: true }, ctx)
    await t.svc.patchTags({ define: { name: 'x', color: '#fff' } }, ctx)
    await t.svc.createFolder('f', ctx)
    await t.svc.putView('v', {}, undefined, ctx)
    await t.scan()
    const types = history.filter(e => e.library === t.id).map(e => e.type)
    for (const ty of ['asset.created', 'asset.updated', 'relation.updated', 'asset.removed', 'trash.updated', 'issue.created', 'tags.updated', 'folder.updated', 'view.updated', 'scan.progress']) {
      expect(types, ty).toContain(ty)
    }
    expect(history.find(e => e.type === 'asset.updated' && e.data.id === a)?.data).toMatchObject({ fields: ['tags'], by: 'user:tester' })
    expect(history.find(e => e.type === 'scan.progress' && e.data.phase === 'done')).toBeDefined()
    const ops = t.logs.filter(l => l.msg === 'write').map(l => l.data?.op)
    expect(ops).toEqual(expect.arrayContaining(['asset.register', 'asset.patch', 'relation.add', 'asset.trash', 'tags.patch', 'folder.create', 'view.put']))
  })
})

describe('batch, vocabulary, info', () => {
  it('applies one change set to many assets and reports failures one by one', async () => {
    const t = await lib()
    const a = await up(t, 'a.png')
    const b = await up(t, 'b.png')
    const c = await up(t, 'c.png')
    await t.svc.addRelation(c, { type: 'uses', to: b }, ctx)
    const r = await t.svc.batch({ ids: [a, b], patch: { tags: { add: ['批量'] }, stage: 'runtime', review: { status: 'approved' } } }, ctx)
    expect(r).toEqual({ updated: [a, b], failed: [] })
    expect(t.sidecar('a.png')).toMatchObject({ tags: ['批量'], stage: 'runtime', review: { status: 'approved' } })
    const r2 = await t.svc.batch({ ids: [a, b], patch: { trash: true } }, ctx)
    expect(r2.updated).toEqual([a])
    expect(r2.failed).toEqual([{ id: b, code: 'referenced', message: expect.any(String) }])
    const r3 = await t.svc.batch({ query: { filter: { folder: '' } }, patch: { move: { folder: 'moved' } } }, ctx)
    expect(r3.updated.sort()).toEqual([b, c].sort())
  })

  it('vocabulary and library info', async () => {
    const t = await lib()
    const a = await up(t, 'a.png')
    await t.svc.patch(a, { tags: { add: ['宝箱'] } }, ctx)
    const v = await t.svc.vocabulary()
    expect(v.stages.map(s => s.name)).toEqual(['参考素材', '生产物料', '运行时物料'])
    expect(v.relationTypes.map(r => r.id)).toEqual(['source', 'uses', 'belongs'])
    expect(v.tags).toEqual([{ name: '宝箱', count: 1 }])
    expect(v.formats.map(f => f.id)).toEqual(['image', 'model', 'unknown'])
    const info = await t.svc.info(ctx)
    expect(info).toMatchObject({ state: 'ready', formatVersion: 1, stats: { assets: 1 }, isLocal: true, versionStore: null, hasCreators: false, firstOpen: null, lanOpen: false })
    expect(info.requiredPlugins).toEqual([{ id: 'test.image', range: '^1.0.0', installed: true, enabled: true }, { id: 'test.model', range: '^2.0.0', installed: true, enabled: true }])
    const lib2 = await t.svc.patchLibrary({ name: '星落镇', settings: { agentSearchScope: 'approved' } }, ctx)
    expect(lib2.settings?.agentSearchScope).toBe('approved')
    expect((await t.svc.fs.readLibraryJson())?.name).toBe('星落镇')
    const health = await t.hub.health()
    expect(health.libraries[0]).toMatchObject({ id: t.id, state: 'ready', index: 'ready' })
  })
})
