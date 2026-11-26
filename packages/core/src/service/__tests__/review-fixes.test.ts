/** Kernel review findings (P0–P2, K*): ADR-046 / 047 / 048 and the lock, restore, actions, config fixes. */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Action } from '@bowerbird/plugin-sdk'
import { cleanupTmp, ctx, agent, fakeVersionStore, makeLib, tmpDir, type TestLib } from './harness.js'

let libs: TestLib[] = []
async function lib(o?: Parameters<typeof makeLib>[0]): Promise<TestLib> { const t = await makeLib(o); libs.push(t); return t }
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const bytes = (s: string) => new Uint8Array(Buffer.from(s))
async function up(t: TestLib, p: string, content = p) {
  const i = p.lastIndexOf('/')
  return (await t.svc.register({ fields: { folder: i < 0 ? '' : p.slice(0, i) }, file: { name: p.slice(i + 1), data: bytes(content) } }, ctx)).asset!.id
}
const trashInfos = (t: TestLib) => {
  const dir = t.abs('.bowerbird/trash')
  return fs.existsSync(dir) ? fs.readdirSync(dir).map(id => JSON.parse(fs.readFileSync(path.join(dir, id, 'info.json'), 'utf8'))) : []
}

describe('P0 / P1-1 folder delete (ADR-047)', () => {
  it('refuses the root, .bowerbird and ignored folders', async () => {
    const t = await lib()
    fs.writeFileSync(t.abs('.bbignore'), 'build/\n')
    t.svc.fs.reloadIgnore()
    fs.mkdirSync(t.abs('build'), { recursive: true })
    fs.writeFileSync(t.abs('build/out.bin'), 'x')
    for (const p of ['', '.bowerbird', '.bowerbird/trash', 'build', '.git']) {
      if (p === '.git') fs.mkdirSync(t.abs('.git'), { recursive: true })
      await expect(t.svc.trashFolder(p, ctx)).rejects.toMatchObject({ code: expect.stringMatching(/validation_failed|not_found/) })
    }
    expect(fs.existsSync(t.abs('.bowerbird/library.json'))).toBe(true)
    expect(fs.existsSync(t.abs('build/out.bin'))).toBe(true)
  })

  it('moves only assets and _folder.bmeta to the trash; ignored and unregistered files stay', async () => {
    const t = await lib()
    const a = await up(t, 'f/a.png', 'a')
    await up(t, 'f/sub/b.png', 'b')
    await t.svc.patchFolder({ path: 'f', label: '文件夹', defaults: { stage: 'runtime' } }, ctx)
    fs.writeFileSync(t.abs('f/.DS_Store'), 'junk')
    fs.writeFileSync(t.abs('f/sub/unregistered.png'), 'not scanned yet')
    const r = await t.svc.trashFolder('f', ctx)
    expect(r.trashed).toBe(2)
    expect(fs.existsSync(t.abs('f/.DS_Store'))).toBe(true)
    expect(fs.existsSync(t.abs('f/sub/unregistered.png'))).toBe(true)
    expect(fs.existsSync(t.abs('f/_folder.bmeta'))).toBe(false)
    const infos = trashInfos(t)
    expect(infos).toHaveLength(3)
    expect(infos.every(i => i.batch === r.batch)).toBe(true)
    expect(infos.find(i => i.name === '_folder.bmeta')?.originalPath).toBe('f/_folder.bmeta')
    // the folder settings come back with an asset of the batch
    const item = (await t.svc.trashList()).items.find(i => i.assetId === a)!
    expect((await t.svc.trashList()).items.map(i => i.name).sort()).toEqual(['a.png', 'b.png'])
    await t.svc.restore(item.id, true, ctx)
    expect((await t.svc.fs.readFolderMeta('f'))?.label).toBe('文件夹')
  })

  it('removes the folder when nothing else is left', async () => {
    const t = await lib()
    await up(t, 'g/x.png', 'x')
    await t.svc.trashFolder('g', ctx)
    expect(fs.existsSync(t.abs('g'))).toBe(false)
  })

  it('refuses when assets inside are referenced from outside, unless forced', async () => {
    const t = await lib()
    const inner = await up(t, 'f/tex.png', 'tex')
    const innerUser = await up(t, 'f/model.png', 'model')
    const outside = await up(t, 'other.png', 'other')
    await t.svc.addRelation(innerUser, { type: 'uses', to: inner }, ctx)
    await t.svc.addRelation(outside, { type: 'uses', to: inner }, ctx)
    await expect(t.svc.trashFolder('f', ctx)).rejects.toMatchObject({ code: 'referenced', details: { referrers: [outside] } })
    expect(t.row(inner)).toBeDefined()
    const r = await t.svc.trashFolder('f', ctx, { force: true })
    expect(r.trashed).toBe(2)
    expect(t.issues('broken-reference').map(i => i.asset_id)).toEqual([outside])
  })

  it('an unreferenced folder needs no force (references inside the folder do not count)', async () => {
    const t = await lib()
    const a = await up(t, 'h/a.png', 'a')
    const b = await up(t, 'h/b.png', 'b')
    await t.svc.addRelation(b, { type: 'uses', to: a }, ctx)
    expect((await t.svc.trashFolder('h', ctx)).trashed).toBe(2)
  })
})

describe('P1-2 slot names are relative paths (ADR-048)', () => {
  it('rejects bad slots on register / add / replace', async () => {
    const t = await lib()
    const a = await up(t, 'a.png', 'a')
    const m = await up(t, 'm.gltf', '{}')
    for (const slot of ['../x.png', '/etc/passwd', 'a/../../x', 'C:/x.png', 'a\\..\\x']) {
      await expect(t.svc.addRelation(m, { type: 'uses', to: a, slot }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
      await expect(t.svc.register({ fields: { relations: [{ type: 'uses', to: a, slot }] }, file: { name: `r${slot.length}.gltf`, data: bytes(slot) } }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    }
    await t.svc.addRelation(m, { type: 'uses', to: a, slot: 'textures/a.png' }, ctx)
  })

  it('a bad slot read from disk is kept but never used to fetch or export, and is reported', async () => {
    const t = await lib()
    const a = await up(t, 'props/a.png', 'secret?')
    const m = await up(t, 'props/m.gltf', '{}')
    t.setSidecar('props/m.gltf', { ...t.sidecar('props/m.gltf'), relations: [{ type: 'uses', to: a, slot: '../../../escape.png' }, { type: 'uses', to: a, slot: 'ok.png' }] })
    await t.scan()
    expect(t.sidecar('props/m.gltf').relations).toHaveLength(2)
    const c = t.issues('metadata-conflict')
    expect(c.map(i => i.asset_id)).toEqual([m])
    expect(JSON.parse(c[0]!.details_json)).toMatchObject({ kind: 'slot', slots: ['../../../escape.png'] })
    expect(await t.svc.slotFile(m, '../../../escape.png')).toBeNull()
    expect(await t.svc.slotFile(m, 'ok.png')).not.toBeNull()
    const plan = await t.svc.exportPlan({ ids: [m], withDeps: true, layout: 'keep' })
    expect(plan.files.map(f => f.path)).toEqual(['props/m.gltf', 'props/ok.png'])
    const out = path.join(tmpDir('exp'), 'deep', 'out')
    const res = await t.svc.exportToDir({ ids: [m], withDeps: true, layout: 'flat', dir: out }, ctx)
    expect(res.written).toBe(2)
    expect(fs.existsSync(path.join(out, '..', '..', 'escape.png'))).toBe(false)
    for (const [p] of await t.svc.exportFiles({ ids: [m], withDeps: true, layout: 'keep' })) expect(p.split('/')).not.toContain('..')
    // keep-local drops the bad slot name (the relation stays)
    await t.svc.resolveIssue(c[0]!.id, { action: 'keep-local' }, ctx)
    expect(t.sidecar('props/m.gltf').relations).toEqual([{ type: 'uses', to: a }, { type: 'uses', to: a, slot: 'ok.png' }])
    expect(t.issues('metadata-conflict')).toEqual([])
  })
})

describe('P1-4 relocation while a scan is running', () => {
  it('does not wait on the scan loop from inside the lock', async () => {
    const t = await lib()
    fs.writeFileSync(t.abs('ghost.png.bmeta'), 'not json')
    t.write('target.png', 'target')
    for (let i = 0; i < 400; i++) t.write(`bulk/f${i}.png`, `bulk ${i}`)
    await t.scan()
    const issue = t.issues('orphan-sidecar')[0]!
    t.svc.store.db.prepare('DELETE FROM files').run()
    const scan = t.svc.scanner.scan('full')
    await new Promise(r => setTimeout(r, 5))
    const res = await Promise.race([
      t.svc.resolveIssue(issue.id, { action: 'trash' }, ctx).then(() => 'done'),
      new Promise(r => setTimeout(() => r('timeout'), 10_000))
    ])
    expect(res).toBe('done')
    await scan
    // relocating an orphan sidecar onto a file while scanning
    fs.writeFileSync(t.abs('ghost2.png.bmeta'), 'broken')
    await t.scan()
    const o2 = t.issues('orphan-sidecar')[0]!
    t.write('free.png', 'free file')
    const scan2 = t.svc.scanner.scan('full')
    const res2 = await Promise.race([
      t.svc.resolveIssue(o2.id, { action: 'relocate', params: { path: 'free.png' } }, ctx).then(() => 'done'),
      new Promise(r => setTimeout(() => r('timeout'), 10_000))
    ])
    expect(res2).toBe('done')
    await scan2
  }, 30_000)
})

describe('P2-1 stale sidecar guard (ADR-046)', () => {
  it('takes in an external edit before applying an API edit, and refuses on an unreadable one', async () => {
    const t = await lib()
    const id = await up(t, 'a.png', 'a')
    await t.svc.patch(id, { tags: { add: ['api1'] } }, ctx)
    const ext = { ...t.sidecar('a.png'), tags: ['api1', 'external'], description: '外部改的' }
    t.setSidecar('a.png', JSON.stringify(ext, null, 2) + '\n\n')
    const r = await t.svc.patch(id, { tags: { add: ['api2'] } }, ctx)
    expect(r.asset.tags).toEqual(['api1', 'external', 'api2'])
    expect(t.sidecar('a.png').description).toBe('外部改的')
    t.setSidecar('a.png', '{ broken')
    await expect(t.svc.patch(id, { tags: { add: ['api3'] } }, ctx)).rejects.toMatchObject({ code: 'conflict' })
    expect(t.issues('metadata-conflict').map(i => i.asset_id)).toEqual([id])
    expect(fs.readFileSync(t.abs('a.png.bmeta'), 'utf8')).toBe('{ broken')
  })
})

describe('P2-3 / P2-4 replacing never deletes; every trash move has info.json', () => {
  it('move with replace: an unregistered file is a conflict, a registered one goes to the trash', async () => {
    const t = await lib()
    const a = await up(t, 'a/x.png', 'a')
    fs.mkdirSync(t.abs('b'), { recursive: true })
    fs.writeFileSync(t.abs('b/x.png'), 'unregistered')
    await expect(t.svc.move(a, { folder: 'b', onConflict: 'replace' }, ctx)).rejects.toMatchObject({ code: 'conflict' })
    expect(fs.readFileSync(t.abs('b/x.png'), 'utf8')).toBe('unregistered')
    const c = await up(t, 'c/x.png', 'c')
    const user = await up(t, 'u.png', 'u')
    await t.svc.addRelation(user, { type: 'uses', to: c }, ctx)
    await expect(t.svc.move(a, { folder: 'c', onConflict: 'replace' }, ctx)).rejects.toMatchObject({ code: 'referenced' })
    await t.svc.removeRelation(user, { type: 'uses', to: c }, ctx)
    await t.svc.move(a, { folder: 'c', onConflict: 'replace' }, ctx)
    expect(t.sidecar('c/x.png').id).toBe(a)
    expect(trashInfos(t).map(i => i.assetId)).toEqual([c])
  })

  it('upload with replace onto an unregistered file is a conflict', async () => {
    const t = await lib()
    fs.writeFileSync(t.abs('loose.png'), 'unregistered')
    await expect(t.svc.register({ fields: { onConflict: 'replace' }, file: { name: 'loose.png', data: bytes('new') } }, ctx)).rejects.toMatchObject({ code: 'conflict' })
    expect(fs.readFileSync(t.abs('loose.png'), 'utf8')).toBe('unregistered')
  })

  it('relocating onto a registered file moves that one’s record to the trash instead of deleting it', async () => {
    const t = await lib()
    const id = await up(t, 'art/hero.fbx', 'v1')
    t.rm('art/hero.fbx')
    await t.scan()
    const other = await up(t, 'art/new/hero_final.fbx', 'v2')
    const issue = t.issues('missing-file')[0]!
    await t.svc.resolveIssue(issue.id, { action: 'relocate', params: { path: 'art/new/hero_final.fbx' } }, ctx)
    expect(t.sidecar('art/new/hero_final.fbx').id).toBe(id)
    const info = trashInfos(t).find(i => i.assetId === other)
    expect(info).toMatchObject({ recordOnly: true, originalPath: 'art/new/hero_final.fbx' })
  })

  it('orphan sidecars and conflict copies go to the trash with info.json and show in the trash list', async () => {
    const t = await lib()
    fs.writeFileSync(t.abs('ghost.png.bmeta'), 'not json')
    t.write('shop.html', '<html>')
    await t.scan()
    const theirs = { ...t.sidecar('shop.html'), tags: ['v2'] }
    fs.writeFileSync(t.abs('shop.html (1).bmeta'), JSON.stringify(theirs, null, 2))
    await t.scan()
    for (const i of [...t.issues('orphan-sidecar'), ...t.issues('metadata-conflict')]) {
      await t.svc.resolveIssue(i.id, { action: i.type === 'orphan-sidecar' ? 'trash' : 'keep-local' }, ctx)
    }
    const names = trashInfos(t).map(i => i.name).sort()
    expect(names).toEqual(['ghost.png.bmeta', 'shop.html (1).bmeta'])
    expect((await t.svc.trashList()).items.map(i => i.name).sort()).toEqual(names)
    // restoring a conflict copy brings the file back (and the conflict with it)
    const item = (await t.svc.trashList()).items.find(i => i.name === 'shop.html (1).bmeta')!
    await t.svc.restore(item.id, true, ctx)
    expect(fs.existsSync(t.abs('shop.html (1).bmeta'))).toBe(true)
    expect(t.issues('metadata-conflict')).toHaveLength(1)
  })
})

describe('P2-5 an asset whose path is taken by another stays as missing', () => {
  it('keeps the vanished asset as missing-file with its last path', async () => {
    const t = await lib()
    const a = await up(t, 'a.png', 'a')
    const b = await up(t, 'b.png', 'b')
    const user = await up(t, 'u.png', 'u')
    await t.svc.addRelation(user, { type: 'uses', to: a }, ctx)
    t.rm('a.png'); t.rm('a.png.bmeta')
    t.mv('b.png', 'a.png'); t.mv('b.png.bmeta', 'a.png.bmeta')
    await t.scan()
    expect(t.row(b)?.path).toBe('a.png')
    expect(t.row(a)?.missing).toBe(1)
    const issue = t.issues('missing-file').find(i => i.asset_id === a)!
    expect(JSON.parse(issue.details_json)).toMatchObject({ originalPath: 'a.png', name: 'a.png' })
    expect(t.issues('broken-reference')).toEqual([])
    const d = await t.svc.get(a, ctx)
    expect(d.name).toBe('a.png')
    // the internal parked index path never reaches the interface
    expect(d.path).toBe('a.png')
    expect((await t.svc.search({ filter: { ids: [a] } }, ctx)).items[0]?.path).toBe('a.png')
    expect((await t.svc.issues({ assetId: a })).assets[a]?.path).toBe('a.png')
    // confirm-deleted keeps the original path in the trash record
    await t.svc.resolveIssue(issue.id, { action: 'confirm-deleted' }, ctx)
    expect(trashInfos(t).find(i => i.assetId === a)?.originalPath).toBe('a.png')
  })
})

describe('P2-6 duplicate identity survives an index rebuild', () => {
  it('is kept in the copy’s sidecar until confirmed', async () => {
    const t = await lib()
    t.write('x.png', 'x')
    await t.scan()
    const id = t.idOf('x.png')
    t.cp('x.png', 'x (1).png'); t.cp('x.png.bmeta', 'x (1).png.bmeta')
    await t.scan()
    const copy = t.sidecar('x (1).png')
    expect(copy.fields?.['bowerbird.identity']).toMatchObject({ copiedFrom: id, confirmed: false })
    await t.reopen({ dropIndex: true })
    await t.svc.scanner.idle()
    const dup = t.issues('duplicate-guid')
    expect(dup.map(i => i.asset_id)).toEqual([copy.id])
    expect(JSON.parse(dup[0]!.details_json)).toMatchObject({ otherId: id })
    await t.svc.resolveIssue(dup[0]!.id, { action: 'confirm' }, ctx)
    expect(t.sidecar('x (1).png').fields?.['bowerbird.identity']).toBeUndefined()
    await t.reopen({ dropIndex: true })
    await t.svc.scanner.idle()
    expect(t.issues('duplicate-guid')).toEqual([])
  })
})

describe('P2-7 copy targets', () => {
  it('refuses .bowerbird and ignored folders', async () => {
    const t = await lib()
    const a = await up(t, 'a.png', 'a')
    await expect(t.svc.copy(a, { folder: '.bowerbird' }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(t.svc.copy(a, { folder: '.bowerbird/trash' }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(t.svc.copy(a, { folder: '.hidden' }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
  })
})

describe('P2-11 / K1 / K3 / K10 probe results', () => {
  it('keeps slot relations when the plugin reports no references; embedded names are not「未找到」', async () => {
    const t = await lib()
    const m = await up(t, 'p/m.gltf', '{}')
    const tex = await up(t, 'p/textures/chest orm.png', 'orm')
    const other = await up(t, 'p/elsewhere/chest orm.png', 'other orm')
    await t.svc.deps.applyProbe(m, 'test.model', { tech: {}, references: ['textures/chest%20orm.png', 'embedded0.png', 'gone.png'], embedded: ['embedded0.png'] })
    expect(t.sidecar('p/m.gltf').relations).toEqual([{ type: 'uses', to: tex, slot: 'textures/chest%20orm.png' }])
    void other
    expect((await t.svc.get(m, ctx)).unresolvedRefs).toEqual(['gone.png'])
    await t.svc.deps.applyProbe(m, 'test.model', { tech: { triangles: 1 } })
    expect(t.sidecar('p/m.gltf').relations).toHaveLength(1)
  })

  it('takes the document excerpt from analysis and puts the title into the search doc', async () => {
    const t = await lib()
    const d = await up(t, 'chest.md', '# 宝箱\n正文')
    await t.svc.deps.applyProbe(d, 'test.doc', { tech: { title: '宝箱' }, analysis: { excerpt: '新手村第一个可以打开的容器。' }, text: '# 宝箱\n正文' })
    const row = t.row(d)!
    expect(row.cell_title).toBe('宝箱')
    expect(row.cell_excerpt).toBe('新手村第一个可以打开的容器。')
    expect((await t.svc.deps.searchDoc(d))?.text).toContain('宝箱')
  })
})

describe('P2-14 version commits', () => {
  it('records every actor of the window and old paths of a folder move', async () => {
    const holder: { store?: ReturnType<typeof fakeVersionStore> } = {}
    const t = await lib({ plugins: { get versionStore() { return holder.store ?? null } } as never })
    holder.store = fakeVersionStore(t.root)
    const committer = (t.svc as unknown as { committer: { flush(): Promise<void> } }).committer
    await committer.flush()
    const commits: Array<{ paths: string[]; actor: string; message: string }> = []
    const orig = holder.store.commit
    holder.store.commit = async (c, meta) => { commits.push({ paths: c.paths, actor: meta.actor, message: meta.message }); return orig(c, meta) }
    await up(t, 'f/a.png', 'a')
    await t.svc.patch(t.idOf('f/a.png'), { tags: { add: ['x'] } }, agent)
    await committer.flush()
    expect(commits[0]!.message).toContain('user:tester')
    expect(commits[0]!.message).toContain('agent:bot')
    await t.svc.patchFolder({ path: 'f', rename: 'g' }, ctx)
    await committer.flush()
    expect(commits[1]!.paths).toEqual(expect.arrayContaining(['f/a.png', 'g/a.png']))
  })
})

describe('P2-16 retarget is all or nothing', () => {
  it('validates every change first and applies none when one would close a loop', async () => {
    const t = await lib()
    const from = await up(t, 'from.png', 'f')
    const to = await up(t, 'to.png', 't')
    const r1 = await up(t, 'r1.png', '1')
    const r2 = await up(t, 'r2.png', '2')
    await t.svc.addRelation(r1, { type: 'source', to: from }, ctx)
    await t.svc.addRelation(r2, { type: 'source', to: from }, ctx)
    await t.svc.addRelation(to, { type: 'source', to: r2 }, ctx)
    await expect(t.svc.retarget({ from, to, dryRun: false }, agent)).rejects.toMatchObject({ code: 'cycle' })
    expect(t.sidecar('r1.png').relations?.[0]?.to).toBe(from)
    expect(t.sidecar('r2.png').relations?.[0]?.to).toBe(from)
  })
})

describe('restore renames by default', () => {
  it('renames to _1 when rename is omitted, answers conflict only for rename=false', async () => {
    const t = await lib()
    const a = await up(t, 'x.png', 'a')
    const { trashId } = await t.svc.trash(a, { force: false }, ctx)
    await up(t, 'x.png', 'b')
    await expect(t.svc.restore(trashId, false, ctx)).rejects.toMatchObject({ code: 'conflict' })
    const r = await t.svc.restore(trashId, undefined as unknown as boolean, ctx)
    expect(r.renamedTo).toBe('x_1.png')
  })
})

describe('K11 plugin actions', () => {
  it('lists the actions that apply and starts a run as a pipeline action job', async () => {
    const action: Action = {
      id: 'slice', title: '切图',
      appliesTo: sel => sel.length > 0 && sel.every(a => a.name.endsWith('.png')),
      run: async () => ({})
    }
    const t = await lib({ plugins: { actions: [{ pluginId: 'test.slicer', action }] } as never })
    const png = await up(t, 'mock.png', 'mock')
    const md = await up(t, 'doc.md', '# x')
    expect((await t.svc.actions!([png])).map(a => [a.id, a.title, a.pluginId])).toEqual([['test.slicer:slice', '切图', 'test.slicer']])
    expect(await t.svc.actions!([png, md])).toEqual([])
    const job = await t.svc.runAction!('test.slicer:slice', { ids: [png], params: { rect: [0, 0, 1, 1] } }, agent)
    expect(job).toMatchObject({ kind: 'action', actionId: 'test.slicer:slice' })
    // one job system: the run is the pipeline's
    expect(t.pipeline.actionRuns).toEqual([{ actionId: 'test.slicer:slice', ids: [png], params: { rect: [0, 0, 1, 1] }, actor: 'agent:bot' }])
    await expect(t.svc.runAction!('test.slicer:slice', { ids: [md] }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(t.svc.runAction!('nope:x', { ids: [png] }, ctx)).rejects.toMatchObject({ code: 'not_found' })
    expect(t.pipeline.actionRuns).toHaveLength(1)
  })
})

describe('core-B integration points', () => {
  it('summary image comes from pipeline.summaryImage with its cache key; scrub is never used', async () => {
    const t = await lib()
    const id = await up(t, 'm.gltf', '{}')
    await t.svc.deps.applyIdentify(id, { pluginId: 'test.model', pluginVersion: '2.0.0', format: 'model', thumbnail: 'browser' })
    t.pipeline.summaryImages.set(id, { variant: 'turnaround', path: path.join(t.svc.paths.cacheDir, 'summary', 'ab', 'abcdef0123.webp') })
    const s = await t.svc.summary(id)
    expect(s.image).toBe(`/api/v1/libraries/${t.id}/assets/${id}/thumbnail?variant=turnaround&v=abcdef0123`)
    expect(s.imageMissingReason).toBeUndefined()
  })

  it('cache files inside the library are written and removed through the library module, only in the cache dir', async () => {
    const t = await lib()
    const io = (t.svc.handle as unknown as { cacheFiles: { write(p: string, d: Uint8Array): Promise<void>; remove(p: string): Promise<void> } }).cacheFiles
    const f = path.join(t.svc.paths.cacheDir, 'thumbnail', 'ab', 'abcd.webp')
    await io.write(f, new Uint8Array([1, 2]))
    expect(fs.readFileSync(f)).toEqual(Buffer.from([1, 2]))
    await io.remove(f)
    expect(fs.existsSync(f)).toBe(false)
    await expect(io.write(t.abs('outside.png'), new Uint8Array([1]))).rejects.toThrow()
    expect(fs.existsSync(t.abs('outside.png'))).toBe(false)
  })
})

describe('K6 machine config is read-modify-write', () => {
  it('keeps changes another process made to config.json', async () => {
    const t = await lib()
    const file = path.join(t.home, 'config.json')
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'))
    disk.installed = [{ id: 'community.spine', spec: 'bowerbird-spine', source: 'npm' }]
    fs.writeFileSync(file, JSON.stringify(disk, null, 2))
    await t.hub.patchConfig({ scanIntervalMinutes: 3 })
    await t.hub.addLibrary(path.join(tmpDir('cfg'), 'Another'))
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(after.installed).toEqual(disk.installed)
    expect(after.scanIntervalMinutes).toBe(3)
    expect(after.libraries).toHaveLength(2)
    expect(t.hub.config().installed).toEqual(disk.installed)
  })
})
