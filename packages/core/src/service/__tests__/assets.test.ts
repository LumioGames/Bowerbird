/** LibraryService: registration, edits, copy / move / delete semantics, review, provenance, relations. */
import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { effectiveReview } from '@bowerbird/schema'
import { cleanupTmp, ctx, agent, remote, makeLib, type TestLib } from './harness.js'

let libs: TestLib[] = []
async function lib(o?: Parameters<typeof makeLib>[0]): Promise<TestLib> { const t = await makeLib(o); libs.push(t); return t }
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const bytes = (s: string) => new Uint8Array(Buffer.from(s))
async function up(t: TestLib, path: string, content = path) {
  const i = path.lastIndexOf('/')
  const r = await t.svc.register({ fields: { folder: i < 0 ? '' : path.slice(0, i) }, file: { name: path.slice(i + 1), data: bytes(content) } }, ctx)
  return r.asset!.id
}

describe('register', () => {
  it('uploads into a folder with its defaults, its provenance, source relations and tag governance', async () => {
    const t = await lib()
    const concept = await up(t, 'props/chest_concept.png', 'concept')
    await t.svc.patch(concept, { tags: { add: ['宝箱'] } }, ctx)
    fs.mkdirSync(t.abs('props/gen'), { recursive: true })
    await t.svc.patchFolder({ path: 'props', defaults: { stage: 'runtime', tags: ['道具'] } }, ctx)
    const r = await t.svc.register({
      fields: {
        folder: 'props/gen', tags: ['宝箱s', '全新'], description: '四视图',
        provenance: { method: 'ai-generate', prompt: '卡通宝箱四视图', params: { seed: 7 } },
        relations: [{ type: 'source', to: concept, role: 'reference' }],
        views: { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] }
      },
      file: { name: 'chest_turnaround.png', data: bytes('turn') }
    }, agent)
    const a = r.asset!
    expect(a.path).toBe('props/gen/chest_turnaround.png')
    expect(a.stage).toBe('runtime')
    expect(a.tags).toEqual(['道具', '宝箱s', '全新'])
    expect(a.createdBy).toBe('agent:bot')
    const m = t.sidecar('props/gen/chest_turnaround.png')
    expect(m.views?.cells).toEqual(['front', 'side', 'back', 'top'])
    expect(m.relations).toEqual([{ type: 'source', to: concept, toHash: t.row(concept)!.hash, role: 'reference' }])
    expect(m.provenance).toMatchObject({ method: 'ai-generate', prompt: '卡通宝箱四视图', params: { seed: 7 }, by: 'agent:bot' })
    expect(m.provenance?.plugin).toBeUndefined()
    expect(a.provenance?.method).toBe('ai-generate')
    expect(r.newTags.find(n => n.tag === '宝箱s')?.similar).toEqual(['宝箱'])
    expect(r.newTags.map(n => n.tag)).toEqual(['宝箱s', '全新'])
    expect(t.logs.some(l => l.msg === 'write' && l.data?.op === 'asset.register' && l.data?.actor === 'agent:bot')).toBe(true)
  })

  it('handles name conflicts: error, skip, keep-both, replace', async () => {
    const t = await lib()
    const first = await up(t, 'a/x.png', 'one')
    const again = { fields: { folder: 'a' }, file: { name: 'x.png', data: bytes('two') } }
    await expect(t.svc.register(again, ctx)).rejects.toMatchObject({ code: 'conflict' })
    expect((await t.svc.register({ ...again, fields: { folder: 'a', onConflict: 'skip' } }, ctx))).toMatchObject({ asset: null, skipped: true })
    const both = await t.svc.register({ ...again, fields: { folder: 'a', onConflict: 'keep-both' } }, ctx)
    expect(both.asset?.name).toBe('x_1.png')
    const rep = await t.svc.register({ ...again, fields: { folder: 'a', onConflict: 'replace' } }, ctx)
    expect(rep.asset?.id).toBe(first)
    expect(rep.asset?.versions).toHaveLength(2)
    expect((await t.svc.precheck('a', ['x.png', 'y.png'])).conflicts.map(c => c.name)).toEqual(['x.png'])
  })

  it('registers a file already in the library (also after the scanner claimed it)', async () => {
    const t = await lib()
    t.write('in/place.png', 'p')
    const r = await t.svc.register({ fields: { path: 'in/place.png', tags: ['现成'] } }, ctx)
    expect(r.asset?.path).toBe('in/place.png')
    t.write('in/scanned.png', 's')
    await t.scan()
    const id = t.idOf('in/scanned.png')
    const r2 = await t.svc.register({ fields: { path: 'in/scanned.png', tags: ['补登'] } }, ctx)
    expect(r2.asset?.id).toBe(id)
    expect(r2.asset?.tags).toEqual(['补登'])
    await expect(t.svc.register({ fields: { path: 'nope.png' } }, ctx)).rejects.toMatchObject({ code: 'not_found' })
    // a file that came with its own sidecar keeps its GUID
    t.write('in/brought.png', 'b')
    const own = { ...t.sidecar('in/scanned.png'), id: '0192f3a7-5c1e-7b3a-9d2f-4a6c8e0b1d99', tags: ['自带'] }
    t.setSidecar('in/brought.png', own)
    const r3 = await t.svc.register({ fields: { path: 'in/brought.png', tags: ['补登'] } }, ctx)
    expect(r3.asset?.id).toBe(own.id)
    expect(r3.asset?.tags).toEqual(['自带', '补登'])
    // uploading onto a name whose sidecar is still there counts as a conflict
    t.setSidecar('in/orphan.png', { ...own, id: '0192f3a7-5c1e-7b3a-9d2f-4a6c8e0b1d98' })
    await expect(t.svc.register({ fields: { folder: 'in' }, file: { name: 'orphan.png', data: bytes('o') } }, ctx)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('gives every output of a plugin run the run\'s provenance, batch id and inputs (ADR-070)', async () => {
    const t = await lib()
    const input = await up(t, 'in.png', 'in')
    const run = { actor: 'user:lin', pluginId: 'forge', pluginVersion: '0.1.0', batch: 'bat_run1', provenance: { method: 'forge/gen', params: { steps: 4 } }, inputs: [{ id: input, role: 'ref' }] }
    const first = await t.svc.deps.register({ file: { kind: 'bytes', name: 'o1.png', data: bytes('o1') }, folder: 'out', provenance: { method: 'forge/gen', prompt: '一只鸟' } }, run)
    await t.svc.deps.register({ file: { kind: 'bytes', name: 'o2.png', data: bytes('o2') }, folder: 'out' }, run)
    expect(t.sidecar('out/o1.png').provenance).toMatchObject({ method: 'forge/gen', prompt: '一只鸟', plugin: 'forge@0.1.0', batch: 'bat_run1', by: 'user:lin' })
    expect(t.sidecar('out/o2.png').provenance).toMatchObject({ method: 'forge/gen', params: { steps: 4 }, plugin: 'forge@0.1.0', batch: 'bat_run1' })
    for (const p of ['out/o1.png', 'out/o2.png']) expect(t.sidecar(p).relations).toEqual([{ type: 'source', to: input, toHash: t.row(input)!.hash, role: 'ref' }])
    const batch = await t.svc.search({ filter: { batch: 'bat_run1' } }, ctx)
    expect(batch.items.map(i => i.name).sort()).toEqual(['o1.png', 'o2.png'])
    expect(first.info.createdBy).toBe('user:lin')
  })
})

describe('patch', () => {
  it('applies tag additions and removals on the current value (ADR-038) and reports new tags', async () => {
    const t = await lib()
    const id = await up(t, 'a.png')
    await t.svc.patch(id, { tags: { add: ['甲', '乙'] } }, ctx)
    const r = await t.svc.patch(id, { tags: { add: ['丙'], remove: ['甲'] }, description: '说明。第二句', stage: 'runtime', fields: { 'team.x': { rarity: 'common' } } }, ctx)
    expect(r.asset.tags).toEqual(['乙', '丙'])
    expect(r.asset.description).toBe('说明。')
    expect(r.asset.descriptionFull).toBe('说明。第二句')
    expect(r.asset.stage).toBe('runtime')
    expect(r.newTags.map(n => n.tag)).toEqual(['丙'])
    const m = t.sidecar('a.png')
    expect(m.fields).toEqual({ 'team.x': { rarity: 'common' } })
    expect(m.modified?.by).toBe('user:tester')
    expect(t.pipeline.calls.some(c => c.id === id && Array.isArray(c.stages) && c.stages.includes('index'))).toBe(true)
  })
})

describe('copy', () => {
  it('implements every copy rule', async () => {
    const t = await lib()
    const dep = await up(t, 'props/tex.png', 'tex')
    const design = await up(t, 'props/chest.md', '# chest')
    const orig = await up(t, 'props/chest.png', 'chest')
    const user = await up(t, 'ui/shop.png', 'shop')
    await t.svc.addRelation(orig, { type: 'uses', to: dep, slot: 'tex.png' }, ctx)
    await t.svc.addRelation(orig, { type: 'belongs', to: design }, ctx)
    await t.svc.addRelation(orig, { type: 'source', to: design }, ctx)
    await t.svc.addRelation(user, { type: 'uses', to: orig }, ctx)
    await t.svc.review(orig, { status: 'approved' }, ctx)
    await t.svc.replaceContent(orig, { name: 'chest.png', data: bytes('chest v2') }, '改了', ctx)
    await t.svc.review(orig, { status: 'approved' }, ctx)

    const c = await t.svc.copy(orig, {}, ctx)
    const copy = c.asset
    // name: original name + _1 in the same folder
    expect(c.name).toBe('chest_1.png')
    expect(copy.path).toBe('props/chest_1.png')
    // a new GUID
    expect(copy.id).not.toBe(orig)
    // takes along what the original depends on
    const rels = t.sidecar('props/chest_1.png').relations!
    expect(rels).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'uses', to: dep, slot: 'tex.png' }),
      expect.objectContaining({ type: 'belongs', to: design }),
      expect.objectContaining({ type: 'source', to: design })
    ]))
    // plus a source relation to the original, and the provenance `copy` (ADR-070)
    const toOrig = rels.find(r => r.type === 'source' && r.to === orig)!
    expect(toOrig.toHash).toBe(t.row(orig)!.hash)
    expect(t.sidecar('props/chest_1.png').provenance).toMatchObject({ method: 'copy', by: 'user:tester' })
    // who depends on the original stays with the original
    expect(t.sidecar('ui/shop.png').relations).toEqual([expect.objectContaining({ to: orig })])
    expect(copy.relations.incoming).toEqual([])
    // versions start over, review pending
    expect(copy.versions).toHaveLength(1)
    expect(copy.versions[0]!.by).toBe('user:tester')
    expect(copy.review).toBe('pending')
    expect(t.row(orig)!.review).toBe('approved')
    // message
    expect(c.originalReferenced).toBe(true)
    expect(c.message).toBe('已复制为 chest_1.png，原来的引用仍指向原件')
    // no duplicate-content issue for a marked copy
    expect(t.issues('duplicate-content')).toEqual([])
    // next copy: _2; an unreferenced original says only the name
    const c2 = await t.svc.copy(orig, {}, ctx)
    expect(c2.name).toBe('chest_2.png')
    const c3 = await t.svc.copy(dep, { folder: 'other' }, ctx)
    expect(c3.asset.path).toBe('other/tex_1.png')
    expect(c3.originalReferenced).toBe(true)
    const lone = await up(t, 'lone.png', 'lone')
    const c4 = await t.svc.copy(lone, {}, ctx)
    expect(c4.message).toBe('已复制为 lone_1.png')
    expect(c4.originalReferenced).toBe(false)
  })
})

describe('trash and restore', () => {
  it('refuses to delete a referenced asset without force, then breaks and heals the references', async () => {
    const t = await lib()
    const tex = await up(t, 'tex.png', 'tex')
    const model = await up(t, 'model.png', 'model')
    await t.svc.addRelation(model, { type: 'uses', to: tex, slot: 'tex.png' }, ctx)
    await expect(t.svc.trash(tex, { force: false }, ctx)).rejects.toMatchObject({ code: 'referenced', details: { referrers: [model] } })
    const r = await t.svc.trash(tex, { force: true }, ctx)
    expect(r.referrers).toEqual([model])
    expect(t.exists('tex.png')).toBe(false)
    expect(t.exists('tex.png.bmeta')).toBe(false)
    expect(fs.existsSync(`${t.root}/.bowerbird/trash/${r.trashId}/tex.png`)).toBe(true)
    expect(JSON.parse(fs.readFileSync(`${t.root}/.bowerbird/trash/${r.trashId}/info.json`, 'utf8'))).toMatchObject({ assetId: tex, originalPath: 'tex.png', deletedBy: 'user:tester' })
    const broken = t.issues('broken-reference')
    expect(broken.map(i => i.asset_id)).toEqual([model])
    expect(JSON.parse(broken[0]!.details_json)).toMatchObject({ inTrash: true, toName: 'tex.png' })
    const d = await t.svc.get(model, ctx)
    expect(d.relations.outgoing[0]).toMatchObject({ broken: true, targetInTrash: true, targetName: 'tex.png' })
    const list = await t.svc.trashList()
    expect(list.items[0]).toMatchObject({ assetId: tex, referencedBy: 1, daysLeft: 7 })
    // restore: same GUID, broken link gone
    const back = await t.svc.restore(r.trashId, false, ctx)
    expect(back.asset.id).toBe(tex)
    expect(back.renamedTo).toBeNull()
    expect(t.sidecar('tex.png').id).toBe(tex)
    expect(t.issues('broken-reference')).toEqual([])
    expect((await t.svc.trashList()).items).toEqual([])
  })

  it('restores into an occupied place only with rename (→ _1)', async () => {
    const t = await lib()
    const a = await up(t, 'x.png', 'a')
    const { trashId } = await t.svc.trash(a, { force: false }, ctx)
    await up(t, 'x.png', 'b')
    await expect(t.svc.restore(trashId, false, ctx)).rejects.toMatchObject({ code: 'conflict', details: { suggested: 'x_1.png' } })
    const r = await t.svc.restore(trashId, true, ctx)
    expect(r.renamedTo).toBe('x_1.png')
    expect(t.idOf('x_1.png')).toBe(a)
    // it was only seen: it comes back without a .bmeta (ADR-067)
    expect(t.exists('x_1.png.bmeta')).toBe(false)
    // one with information comes back with it
    await t.keep('x_1.png')
    const again = await t.svc.trash(a, { force: false }, ctx)
    await t.svc.restore(again.trashId, true, ctx)
    expect(t.sidecar('x_1.png').id).toBe(a)
  })

  it('purges entries after trashDays and on request', async () => {
    let now = Date.now()
    const t = await lib({ now: () => now })
    const a = await up(t, 'a.png', 'a')
    const b = await up(t, 'b.png', 'b')
    const ta = await t.svc.trash(a, { force: false }, ctx)
    await t.svc.trash(b, { force: false }, ctx)
    now += 6 * 86_400_000
    expect((await t.svc.trashList()).items).toHaveLength(2)
    expect((await t.svc.trashList()).items[0]!.daysLeft).toBe(1)
    await t.svc.purge(ta.trashId, ctx)
    expect(fs.existsSync(`${t.root}/.bowerbird/trash/${ta.trashId}`)).toBe(false)
    now += 2 * 86_400_000
    expect((await t.svc.trashList()).items).toEqual([])
    await t.svc.patchLibrary({ settings: { trashDays: 30 } }, ctx)
    expect((await t.svc.trashList()).trashDays).toBe(30)
  })

  it('trashes a folder as one batch', async () => {
    const t = await lib()
    await up(t, 'f/a.png', 'a')
    await up(t, 'f/sub/b.png', 'b')
    const r = await t.svc.trashFolder('f', ctx)
    expect(r.trashed).toBe(2)
    expect(t.exists('f')).toBe(false)
    const items = (await t.svc.trashList()).items
    expect(new Set(items.map(i => i.batch))).toEqual(new Set([r.batch]))
  })
})

describe('move and rename', () => {
  it('moves file and sidecar together; conflicts are refused unless told otherwise', async () => {
    const t = await lib()
    const a = await up(t, 'a/x.png', 'x')
    const b = await up(t, 'b/x.png', 'other')
    await t.svc.addRelation(b, { type: 'uses', to: a }, ctx)
    await expect(t.svc.move(a, { folder: 'b' }, ctx)).rejects.toMatchObject({ code: 'conflict' })
    const moved = await t.svc.move(a, { folder: 'b', onConflict: 'keep-both' }, ctx)
    expect(moved.path).toBe('b/x_1.png')
    const renamed = await t.svc.move(a, { name: 'y.png' }, ctx)
    expect(renamed.path).toBe('b/y.png')
    expect(t.sidecar('b/y.png').id).toBe(a)
    expect(t.exists('a/x.png')).toBe(false)
    expect(t.sidecar('b/x.png').relations?.[0]?.to).toBe(a)
    await t.scan()
    expect(t.issues()).toEqual([])
  })
})

describe('review', () => {
  it('needs a note to reject, binds to the content hash and detects concurrent reviews (ADR-038)', async () => {
    const t = await lib()
    const id = await up(t, 'a.png', 'a')
    await expect(t.svc.review(id, { status: 'rejected' }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    const hash = t.row(id)!.hash
    const d = await t.svc.review(id, { status: 'rejected', note: '比例不对', expectHash: hash }, ctx)
    expect(d.review).toBe('rejected')
    expect(d.reviewVerdict).toMatchObject({ status: 'rejected', hash, by: 'user:tester', note: '比例不对' })
    await expect(t.svc.review(id, { status: 'approved', expectHash: hash }, { actor: 'user:other', isLocal: true })).rejects.toMatchObject({ code: 'conflict' })
    await expect(t.svc.review(id, { status: 'approved', expectHash: 'sha256:00' }, ctx)).rejects.toMatchObject({ code: 'conflict' })
    await t.svc.replaceContent(id, { name: 'a.png', data: bytes('a2') }, undefined, ctx)
    expect(effectiveReview(t.sidecar('a.png'))).toBe('pending')
    expect(t.row(id)!.review).toBe('pending')
    await t.svc.review(id, { status: 'exempt' }, ctx)
    await t.svc.replaceContent(id, { name: 'a.png', data: bytes('a3') }, undefined, ctx)
    expect(t.row(id)!.review).toBe('exempt')
  })
})

describe('provenance (ADR-070)', () => {
  it('is the asset\'s own information: set, corrected and cleared like a tag', async () => {
    const t = await lib()
    const inp = await up(t, 'in.png', 'in')
    const id = await up(t, 'out.png', 'out')
    await t.svc.patch(id, { provenance: { method: 'manual', tool: 'Blender 4.2', prompt: 'test' } }, ctx)
    expect(t.sidecar('out.png').provenance).toMatchObject({ method: 'manual', tool: 'Blender 4.2', prompt: 'test', by: 'user:tester' })
    // a wrong prompt is corrected in place: nothing of the old one stays
    await t.svc.apply({ items: [{ id, provenance: { method: 'manual', tool: 'Blender 4.2', prompt: '木箱', note: '修正提示词' }, relations: { add: [{ type: 'source', to: inp, role: 'reference' }] } }] }, agent)
    const m = t.sidecar('out.png')
    expect(m.provenance).toMatchObject({ prompt: '木箱', note: '修正提示词', by: 'agent:bot' })
    expect(m.relations).toEqual([{ type: 'source', to: inp, toHash: t.row(inp)!.hash, role: 'reference' }])
    expect(fs.readFileSync(t.abs('out.png.bmeta'), 'utf8')).not.toContain('"prompt": "test"')
    expect((await t.svc.get(id, ctx)).provenance?.prompt).toBe('木箱')
    expect((await t.svc.lineage(id, { direction: 'up', types: ['source', 'reference'], depth: 5 })).provenance[id]?.prompt).toBe('木箱')
    await t.svc.patch(id, { provenance: null }, ctx)
    expect(t.sidecar('out.png').provenance).toBeUndefined()
    expect(fs.existsSync(t.abs('.bowerbird/records'))).toBe(false)
  })

  it('converts the records of an older library into provenance and sets the records folder aside', async () => {
    const t = await lib()
    const inp = await up(t, 'in.png', 'in')
    const a = await up(t, 'a.png', 'a')
    const b = await up(t, 'b.png', 'b')
    await t.keep('in.png', 'a.png', 'b.png')
    const rec = {
      bb: 1, id: 'rec_0192f3a7-0000-7000-8000-000000000001', method: 'slice', tool: 'cutter', prompt: '切图',
      params: { rect: { [a]: [0, 0, 8, 8], [b]: [8, 0, 8, 8] } }, inputs: [{ id: inp, hash: t.row(inp)!.hash, role: 'atlas' }],
      by: 'agent:old', at: '2026-11-01T00:00:00.000Z', notes: [{ at: '2026-11-02T00:00:00.000Z', by: 'user:lin', text: '跨格了' }]
    }
    fs.mkdirSync(t.abs('.bowerbird/records/2026'), { recursive: true })
    fs.writeFileSync(t.abs(`.bowerbird/records/2026/${rec.id}.json`), JSON.stringify(rec))
    for (const p of ['a.png', 'b.png']) t.setSidecar(p, { ...t.sidecar(p), origin: rec.id, relations: [{ type: 'source', to: inp, toHash: t.row(inp)!.hash, record: rec.id }] })
    await t.scan()
    const ma = t.sidecar('a.png') as Record<string, unknown>
    expect(ma.origin).toBeUndefined()
    expect(t.sidecar('a.png').provenance).toMatchObject({ method: 'slice', tool: 'cutter', prompt: '切图', params: { rect: [0, 0, 8, 8] }, by: 'agent:old', note: '跨格了', batch: `bat_${rec.id.slice(4)}` })
    expect(t.sidecar('b.png').provenance?.params).toEqual({ rect: [8, 0, 8, 8] })
    expect(t.sidecar('a.png').relations).toEqual([{ type: 'source', to: inp, toHash: t.row(inp)!.hash, role: 'atlas' }])
    expect(fs.existsSync(t.abs('.bowerbird/records'))).toBe(false)
    expect(fs.readdirSync(t.abs('.bowerbird')).some(n => n.startsWith('records-converted-'))).toBe(true)
    expect(t.row(a)!.method).toBe('slice')
  })
})

describe('relations', () => {
  it('rejects source cycles with the path, replaces with the new hash, retargets in bulk', async () => {
    const t = await lib()
    const a = await up(t, 'a.png', 'a')
    const b = await up(t, 'b.png', 'b')
    const c = await up(t, 'c.png', 'c')
    const d = await up(t, 'd.png', 'd')
    await t.svc.addRelation(b, { type: 'source', to: a }, ctx)
    await t.svc.addRelation(c, { type: 'source', to: b }, ctx)
    const err = await t.svc.addRelation(a, { type: 'source', to: c }, ctx).catch(e => e)
    expect(err.code).toBe('cycle')
    expect(err.details.path.map((p: { name: string }) => p.name)).toEqual(['a.png', 'c.png', 'b.png', 'a.png'])
    await expect(t.svc.addRelation(b, { type: 'source', to: a }, ctx)).rejects.toMatchObject({ code: 'conflict' })
    // uses / belongs are not cycle-checked
    await t.svc.addRelation(a, { type: 'uses', to: c }, ctx)
    // replace: source toHash = the new target's current hash
    await t.svc.replaceContent(d, { name: 'd.png', data: bytes('d2') }, undefined, ctx)
    const r = await t.svc.replaceRelation(c, { type: 'source', to: b, newTo: d }, ctx)
    expect(r.relations.outgoing[0]).toMatchObject({ to: d, toHash: t.row(d)!.hash, stale: false })
    await t.svc.addRelation(d, { type: 'source', to: b }, ctx)
    // c → d → b → a: pointing b at c would close the loop
    await expect(t.svc.replaceRelation(b, { type: 'source', to: a, newTo: c }, ctx)).rejects.toMatchObject({ code: 'cycle' })
    await t.svc.removeRelation(d, { type: 'source', to: b }, ctx)
    // retarget: preview first, then apply
    const pre = await t.svc.retarget({ from: c, to: b, dryRun: true }, agent)
    expect(pre).toMatchObject({ applied: false, affected: [{ assetId: a, type: 'uses' }] })
    expect(t.sidecar('a.png').relations?.find(x => x.type === 'uses')?.to).toBe(c)
    const done = await t.svc.retarget({ from: c, to: b, dryRun: false }, agent)
    expect(done.applied).toBe(true)
    expect(t.sidecar('a.png').relations?.find(x => x.type === 'uses')?.to).toBe(b)
    await t.svc.removeRelation(a, { type: 'uses', to: b }, ctx)
    expect(t.sidecar('a.png').relations).toBeUndefined()
    const lin = await t.svc.lineage(c, { direction: 'up', types: ['source'], depth: 5 })
    expect(lin.nodes.map(n => n.id).sort()).toEqual([c, d].sort())
    const down = await t.svc.lineage(a, { direction: 'down', types: ['source'], depth: 5 })
    expect(down.edges).toEqual([expect.objectContaining({ from: b, to: a, type: 'source' })])
  })
})

describe('local-only actions', () => {
  it('open and reveal answer not_local to other machines', async () => {
    const t = await lib()
    const id = await up(t, 'a.png', 'a')
    await expect(t.svc.open(id, remote)).rejects.toMatchObject({ code: 'not_local' })
    await expect(t.svc.reveal(id, remote)).rejects.toMatchObject({ code: 'not_local' })
    await t.svc.open(id, ctx)
    await expect(t.svc.exportToDir({ ids: [id], withDeps: false, layout: 'keep', dir: '/tmp/x' }, remote)).rejects.toMatchObject({ code: 'not_local' })
  })
})
