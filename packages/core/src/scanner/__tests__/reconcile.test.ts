/** Reconciliation rules R1–R12 (sync-and-integrity.md「对账规则」), one or more integration tests each. */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveReview } from '@bowerbird/schema'
import { cleanupTmp, ctx, makeLib, type TestLib } from '../../service/__tests__/harness.js'

let libs: TestLib[] = []
async function lib(o?: Parameters<typeof makeLib>[0]): Promise<TestLib> { const t = await makeLib(o); libs.push(t); return t }
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const PNG = (s: string) => Buffer.from(`PNG:${s}`)

describe('R1 new file without sidecar, new content → seen (ADR-067)', () => {
  it('generates a GUID in the index only, applies folder defaults, and writes the .bmeta once there is information', async () => {
    const t = await lib()
    fs.mkdirSync(t.abs('props/chest'), { recursive: true })
    await t.svc.patchFolder({ path: 'props', defaults: { stage: 'runtime', review: 'exempt', tags: ['道具'] } }, ctx)
    t.write('props/chest/chest.png', PNG('chest'))
    t.write('loose.png', PNG('loose'))
    await t.scan()
    // only seen: nothing written beside the files
    expect(t.exists('props/chest/chest.png.bmeta')).toBe(false)
    expect(t.exists('loose.png.bmeta')).toBe(false)
    const seen = t.rowByPath('props/chest/chest.png')!
    expect(seen.sidecar).toBe(0)
    expect(seen.stage).toBe('runtime')
    expect(seen.modified_by).toBeNull()
    expect(t.pipeline.calls.some(c => c.id === seen.id && c.stages === 'all')).toBe(true)
    // a rescan keeps the same GUID while the index lives
    await t.scan()
    expect(t.idOf('props/chest/chest.png')).toBe(seen.id)
    // saying something about it writes the .bmeta, with the same GUID and the folder defaults
    await t.keep('props/chest/chest.png', 'loose.png')
    const m = t.sidecar('props/chest/chest.png')
    expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
    expect(m.stage).toBe('runtime')
    expect(m.tags).toEqual(['道具'])
    expect(m.review?.status).toBe('exempt')
    expect(m.id).toBe(seen.id)
    expect(m.versions?.[0]?.by).toBe('system:scanner')
    expect(m.created.by).toBe('system:scanner')
    expect(t.rowByPath('props/chest/chest.png')!.sidecar).toBe(1)
    const loose = t.sidecar('loose.png')
    expect(loose.stage).toBe('production')
    expect(effectiveReview(loose)).toBe('pending')
    const row = t.rowByPath('props/chest/chest.png')!
    expect(row.id).toBe(m.id)
    expect(row.stage).toBe('runtime')
    expect(row.review).toBe('exempt')
    expect(t.issues()).toEqual([])
    // defaults apply once: changing the folder later does not touch existing assets
    await t.svc.patchFolder({ path: 'props', defaults: { stage: 'reference' } }, ctx)
    await t.scan()
    expect(t.sidecar('props/chest/chest.png').stage).toBe('runtime')
  })

  it('does not claim ignored files and hashes only when size or mtime changed', async () => {
    const t = await lib()
    t.write('.hidden.png', PNG('h'))
    t.write('tmp/x.part', 'partial')
    t.write('ok.png', PNG('ok'))
    await t.scan()
    expect(t.exists('.hidden.png.bmeta')).toBe(false)
    expect(t.exists('tmp/x.part.bmeta')).toBe(false)
    expect(t.svc.store.file('ok.png')?.hash).toMatch(/^sha256:/)
    // poison the cached hash: an unchanged file must not be re-hashed
    t.svc.store.setFile('ok.png', fs.statSync(t.abs('ok.png')).size, Math.floor(fs.statSync(t.abs('ok.png')).mtimeMs), 'sha256:cafe')
    await t.scan()
    expect(t.svc.store.file('ok.png')?.hash).toBe('sha256:cafe')
  })
})

describe('R2 / R6 new file with the content of a missing asset → reclaim', () => {
  it('R6: file moved without its sidecar → the sidecar follows, GUID and relations stay', async () => {
    const t = await lib()
    t.write('a/tex.png', PNG('tex'))
    t.write('a/model.png', PNG('model'))
    await t.scan()
    const tex = t.idOf('a/tex.png')
    const model = t.idOf('a/model.png')
    await t.svc.addRelation(model, { type: 'uses', to: tex }, ctx)
    t.mv('a/tex.png', 'b/tex_renamed.png')
    await t.scan()
    expect(t.exists('a/tex.png.bmeta')).toBe(false)
    expect(t.sidecar('b/tex_renamed.png').id).toBe(tex)
    expect(t.row(tex)?.path).toBe('b/tex_renamed.png')
    expect(t.row(tex)?.missing).toBe(0)
    expect(t.sidecar('a/model.png').relations?.[0]?.to).toBe(tex)
    expect(t.issues()).toEqual([])
  })

  it('R2: a missing asset is found again when a file with the same content appears', async () => {
    const t = await lib()
    t.write('a/x.png', PNG('x'))
    await t.scan()
    const [id] = await t.keep('a/x.png')
    t.rm('a/x.png')
    await t.scan()
    expect(t.row(id)?.missing).toBe(1)
    expect(t.issues('missing-file').map(i => i.asset_id)).toEqual([id])
    t.write('c/again.png', PNG('x'))
    await t.scan()
    expect(t.sidecar('c/again.png').id).toBe(id)
    expect(t.exists('a/x.png.bmeta')).toBe(false)
    expect(t.row(id)?.missing).toBe(0)
    expect(t.issues('missing-file')).toEqual([])
  })
})

describe('R3 new file with the content of a present asset → new asset + duplicate-content', () => {
  it('claims it and raises duplicate-content on the newer one; ignore is remembered', async () => {
    const t = await lib()
    t.write('a.png', PNG('same'))
    await t.scan()
    const a = t.idOf('a.png')
    await new Promise(r => setTimeout(r, 5))
    t.write('b.png', PNG('same'))
    await t.scan()
    const b = t.idOf('b.png')
    expect(b).not.toBe(a)
    const dup = t.issues('duplicate-content')
    expect(dup).toHaveLength(1)
    expect(dup[0]!.asset_id).toBe(b)
    expect(JSON.parse(dup[0]!.details_json).otherId).toBe(a)
    expect(t.row(b)?.issue_level).toBe(1)
    await t.svc.resolveIssue(dup[0]!.id, { action: 'ignore' }, ctx)
    expect(t.issues('duplicate-content')).toEqual([])
    expect((await t.svc.fs.readLibraryJson())?.settings.ignoredIssues).toContain(dup[0]!.id)
    await t.scan()
    await t.svc.core.integrity.refreshAll()
    expect(t.issues('duplicate-content')).toEqual([])
  })
})

describe('R4 content changed', () => {
  it('updates the hash, appends a version, review goes back to pending, downstream is marked', async () => {
    const t = await lib()
    t.write('up.png', PNG('v1'))
    t.write('down.png', PNG('down'))
    t.write('user.png', PNG('user'))
    await t.scan()
    const up = t.idOf('up.png')
    const down = t.idOf('down.png')
    const user = t.idOf('user.png')
    await t.svc.addRelation(down, { type: 'source', to: up }, ctx)
    await t.svc.addRelation(user, { type: 'uses', to: up }, ctx)
    await t.svc.review(up, { status: 'approved' }, ctx)
    expect(t.row(up)?.review).toBe('approved')
    const before = t.sidecar('up.png')
    t.pipeline.calls.length = 0
    t.write('up.png', PNG('version two, longer'))
    await t.scan()
    const after = t.sidecar('up.png')
    expect(after.id).toBe(up)
    expect(after.hash).not.toBe(before.hash)
    expect(after.versions).toHaveLength(2)
    expect(after.versions?.[1]?.by).toBe('system:scanner')
    expect(effectiveReview(after)).toBe('pending')
    expect(t.row(up)?.review).toBe('pending')
    const stale = t.issues('stale-upstream')
    expect(stale.map(i => i.asset_id)).toEqual([down])
    expect(JSON.parse(stale[0]!.details_json)).toMatchObject({ fromVersion: 1, toVersion: 2 })
    expect(t.row(down)!.flags & 1).toBe(1)
    expect(t.pipeline.calls.some(c => c.id === up && c.stages === 'all')).toBe(true)
    expect(t.pipeline.calls.some(c => c.id === user && Array.isArray(c.stages) && c.stages.includes('thumbnail'))).toBe(true)
  })
})

describe('R5 file and sidecar moved together → only the path changes', () => {
  it('keeps GUID and relations without raising anything', async () => {
    const t = await lib()
    t.write('a/x.png', PNG('x'))
    t.write('a/y.png', PNG('y'))
    await t.scan()
    const x = t.idOf('a/x.png')
    const y = t.idOf('a/y.png')
    await t.svc.addRelation(y, { type: 'source', to: x }, ctx)
    t.mv('a/x.png', 'b/x2.png')
    t.mv('a/x.png.bmeta', 'b/x2.png.bmeta')
    await t.scan()
    expect(t.row(x)?.path).toBe('b/x2.png')
    expect(t.sidecar('b/x2.png').id).toBe(x)
    expect(t.issues()).toEqual([])
    // swapping two names keeps both identities
    t.mv('a/y.png', 'tmp.png'); t.mv('a/y.png.bmeta', 'tmp.png.bmeta')
    t.mv('b/x2.png', 'a/y.png'); t.mv('b/x2.png.bmeta', 'a/y.png.bmeta')
    t.mv('tmp.png', 'b/x2.png'); t.mv('tmp.png.bmeta', 'b/x2.png.bmeta')
    await t.scan()
    expect(t.row(x)?.path).toBe('a/y.png')
    expect(t.row(y)?.path).toBe('b/x2.png')
  })
})

describe('R7 file gone, sidecar kept → missing', () => {
  it('marks the asset missing, keeps its relations and does not break references to it', async () => {
    const t = await lib()
    t.write('tex.png', PNG('t'))
    t.write('model.png', PNG('m'))
    await t.scan()
    const tex = t.idOf('tex.png')
    const model = t.idOf('model.png')
    await t.svc.addRelation(model, { type: 'uses', to: tex }, ctx)
    await t.svc.addRelation(tex, { type: 'belongs', to: model }, ctx)
    t.rm('tex.png')
    await t.scan()
    const row = t.row(tex)!
    expect(row.missing).toBe(1)
    expect(row.flags & 4).toBe(4)
    expect(t.exists('tex.png.bmeta')).toBe(true)
    expect(t.sidecar('tex.png').relations).toHaveLength(1)
    expect(t.issues('missing-file').map(i => i.asset_id)).toEqual([tex])
    expect(t.issues('broken-reference')).toEqual([])
    // file comes back at the same place → issue disappears
    t.write('tex.png', PNG('t'))
    await t.scan()
    expect(t.row(tex)?.missing).toBe(0)
    expect(t.issues('missing-file')).toEqual([])
  })

  it('a file that was only seen just leaves the index when it goes (ADR-067)', async () => {
    const t = await lib()
    t.write('seen.png', PNG('s'))
    await t.scan()
    const id = t.idOf('seen.png')
    t.rm('seen.png')
    await t.scan()
    expect(t.row(id)).toBeUndefined()
    expect(t.issues()).toEqual([])
  })

  it('confirm-deleted moves only the record to the trash', async () => {
    const t = await lib()
    t.write('gone.png', PNG('g'))
    await t.scan()
    const [id] = await t.keep('gone.png')
    t.rm('gone.png')
    await t.scan()
    const issue = t.issues('missing-file')[0]!
    await t.svc.resolveIssue(issue.id, { action: 'confirm-deleted' }, ctx)
    expect(t.row(id)).toBeUndefined()
    const { items } = await t.svc.trashList()
    expect(items[0]).toMatchObject({ assetId: id, recordOnly: true })
  })
})

describe('R8 sidecar gone, file still here → restore from the index copy', () => {
  it('writes the sidecar back with the same GUID and metadata', async () => {
    const t = await lib()
    t.write('a.png', PNG('a'))
    await t.scan()
    const id = t.idOf('a.png')
    await t.svc.patch(id, { tags: { add: ['宝箱'] }, description: '一级宝箱' }, ctx)
    t.rm('a.png.bmeta')
    await t.scan()
    const m = t.sidecar('a.png')
    expect(m.id).toBe(id)
    expect(m.tags).toEqual(['宝箱'])
    expect(m.description).toBe('一级宝箱')
    expect(t.issues()).toEqual([])
  })
})

describe('R9 two sidecars with the same GUID → the copy gets a new identity', () => {
  it('keeps the indexed one as original and applies the copy semantics to the other', async () => {
    const t = await lib()
    t.write('dep.png', PNG('dep'))
    t.write('chest.png', PNG('chest'))
    t.write('user.png', PNG('user'))
    await t.scan()
    const dep = t.idOf('dep.png')
    const chest = t.idOf('chest.png')
    const user = t.idOf('user.png')
    await t.svc.addRelation(chest, { type: 'uses', to: dep }, ctx)
    await t.svc.addRelation(user, { type: 'uses', to: chest }, ctx)
    t.cp('chest.png', 'copies/chest.png')
    t.cp('chest.png.bmeta', 'copies/chest.png.bmeta')
    await t.scan()
    expect(t.sidecar('chest.png').id).toBe(chest)
    const copy = t.sidecar('copies/chest.png')
    expect(copy.id).not.toBe(chest)
    expect(copy.relations?.find(r => r.type === 'uses')?.to).toBe(dep)
    const src = copy.relations?.find(r => r.type === 'source')
    expect(src?.to).toBe(chest)
    expect(copy.provenance?.method).toBe('copy')
    expect(copy.versions).toHaveLength(1)
    expect(copy.review).toBeUndefined()
    expect(t.sidecar('user.png').relations?.[0]?.to).toBe(chest)
    const dupIssues = t.issues('duplicate-guid')
    expect(dupIssues.map(i => i.asset_id)).toEqual([copy.id])
    expect(JSON.parse(dupIssues[0]!.details_json).otherId).toBe(chest)
    // duplicate-content does not apply: the copy is marked as a copy of the original
    expect(t.issues('duplicate-content')).toEqual([])
    // swap: the other one was the original
    await t.svc.resolveIssue(dupIssues[0]!.id, { action: 'swap' }, ctx)
    expect(t.row(chest)?.path).toBe('copies/chest.png')
    expect(t.row(copy.id)?.path).toBe('chest.png')
    expect(t.sidecar('copies/chest.png').id).toBe(chest)
    expect(t.issues('duplicate-guid')).toEqual([])
  })

  it('without an index record the earlier / first path is the original (first open)', async () => {
    const t = await lib()
    t.write('a/x.png', PNG('x'))
    await t.scan()
    const [id] = await t.keep('a/x.png')
    t.cp('a/x.png', 'b/x.png')
    t.cp('a/x.png.bmeta', 'b/x.png.bmeta')
    await t.reopen({ dropIndex: true })
    await t.svc.scanner.idle()
    const ids = [t.sidecar('a/x.png').id, t.sidecar('b/x.png').id]
    expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(2)
    expect(t.issues('duplicate-guid')).toHaveLength(1)
  })
})

describe('R9 without an index: copy-like names lose the tie (ADR-045)', () => {
  it('judges `btn (1).png`, `btn copy.png`, `btn_2.png`, `btn 副本.png` as copies of `btn.png`', async () => {
    for (const copyName of ['btn (1).png', 'btn copy.png', 'btn - Copy.png', 'btn 副本.png', 'btn_2.png']) {
      const t = await lib()
      t.write('ui/btn.png', PNG('btn'))
      await t.scan()
      const [id] = await t.keep('ui/btn.png')
      t.cp('ui/btn.png', `ui/${copyName}`)
      t.cp('ui/btn.png.bmeta', `ui/${copyName}.bmeta`)
      // the copy looks older than the original (cp / git / cloud sync do not keep creation times)
      await t.reopen({ dropIndex: true })
      await t.svc.scanner.idle()
      expect(t.sidecar('ui/btn.png').id).toBe(id)
      expect(t.sidecar(`ui/${copyName}`).id).not.toBe(id)
      expect(t.issues('duplicate-guid').map(i => t.row(i.asset_id!)?.path)).toEqual([`ui/${copyName}`])
      expect(JSON.parse(t.issues('duplicate-guid')[0]!.details_json)).toMatchObject({ reason: 'name', otherId: id, originalPath: 'ui/btn.png' })
    }
  })
})

describe('R10 cloud-drive conflict copies by name', () => {
  it('attaches unreadable conflict copies of Dropbox, Google Drive, iCloud and OneDrive to their asset', async () => {
    const t = await lib()
    t.write('a/p.html', '<p>')
    await t.scan()
    const id = t.idOf('a/p.html')
    const names = ["a/p.html (lin's conflicted copy 2026-11-24).bmeta", 'a/p.html (1).bmeta', 'a/p.html 2.bmeta', 'a/p.html-LIN-MACBOOK.bmeta']
    for (const n of names) fs.writeFileSync(t.abs(n), '{ broken')
    await t.scan()
    const c = t.issues('metadata-conflict')
    expect(c.map(i => [i.asset_id, JSON.parse(i.details_json).conflictPath]).sort()).toEqual(names.map(n => [id, n]).sort())
    expect(t.issues('orphan-sidecar')).toEqual([])
    for (const i of c) await t.svc.resolveIssue(i.id, { action: 'keep-local' }, ctx)
    for (const n of names) expect(t.exists(n)).toBe(false)
    expect(t.issues()).toEqual([])
  })
})

describe('R10 unreadable sidecar or cloud conflict copy → metadata-conflict', () => {
  it('keeps the last valid metadata from the index until a human decides', async () => {
    const t = await lib()
    t.write('a.png', PNG('a'))
    await t.scan()
    const id = t.idOf('a.png')
    await t.svc.patch(id, { tags: { add: ['好'] } }, ctx)
    t.setSidecar('a.png', '{ "bb": 1, "id": "broken')
    await t.scan()
    expect(t.row(id)?.meta_json).toContain('好')
    const c = t.issues('metadata-conflict')
    expect(c).toHaveLength(1)
    expect(c[0]!.asset_id).toBe(id)
    expect(t.row(id)?.issue_level).toBe(3)
    // keep-local: the broken file goes to the trash, the index copy is written back
    await t.svc.resolveIssue(c[0]!.id, { action: 'keep-local' }, ctx)
    expect(t.sidecar('a.png').tags).toEqual(['好'])
    expect(t.issues('metadata-conflict')).toEqual([])
  })

  it('treats a sidecar copy with the same GUID as a conflict copy, not an asset', async () => {
    const t = await lib()
    t.write('shop.html', '<html>')
    await t.scan()
    const [id] = await t.keep('shop.html')
    const theirs = { ...t.sidecar('shop.html'), tags: ['商店', 'v2'] }
    fs.writeFileSync(t.abs('shop.html (lin 的 MacBook 冲突).bmeta'), JSON.stringify(theirs, null, 2))
    await t.scan()
    const c = t.issues('metadata-conflict')
    expect(c).toHaveLength(1)
    expect(c[0]!.asset_id).toBe(id)
    expect(JSON.parse(c[0]!.details_json)).toMatchObject({ kind: 'copy', conflictPath: 'shop.html (lin 的 MacBook 冲突).bmeta' })
    expect(t.svc.store.count()).toBe(1)
    await t.svc.resolveIssue(c[0]!.id, { action: 'keep-conflict' }, ctx)
    expect(t.sidecar('shop.html').tags).toEqual(['商店', 'v2'])
    expect(t.exists('shop.html (lin 的 MacBook 冲突).bmeta')).toBe(false)
    expect(t.issues('metadata-conflict')).toEqual([])
    await t.scan()
    expect(t.issues('metadata-conflict')).toEqual([])
  })

  it('reports an unreadable sidecar without a file as orphan-sidecar', async () => {
    const t = await lib()
    fs.writeFileSync(t.abs('ghost.png.bmeta'), 'not json')
    await t.scan()
    const o = t.issues('orphan-sidecar')
    expect(o).toHaveLength(1)
    await t.svc.resolveIssue(o[0]!.id, { action: 'trash' }, ctx)
    expect(t.exists('ghost.png.bmeta')).toBe(false)
    expect(t.issues('orphan-sidecar')).toEqual([])
  })
})

describe('R11 relation to a GUID that does not exist → broken-reference', () => {
  it('keeps the relation and raises the issue; it disappears when the cause is gone', async () => {
    const t = await lib()
    t.write('a.png', PNG('a'))
    await t.scan()
    const [id] = await t.keep('a.png')
    const ghost = '0192f3a7-0000-7000-8000-000000000000'
    t.setSidecar('a.png', { ...t.sidecar('a.png'), relations: [{ type: 'uses', to: ghost, slot: 'tex.png' }] })
    await t.scan()
    expect(t.sidecar('a.png').relations).toHaveLength(1)
    const b = t.issues('broken-reference')
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ asset_id: id, rel_to: ghost })
    expect(t.row(id)!.flags & 2).toBe(2)
    await t.svc.resolveIssue(b[0]!.id, { action: 'remove-relation' }, ctx)
    expect(t.sidecar('a.png').relations ?? []).toEqual([])
    expect(t.issues('broken-reference')).toEqual([])
    expect(t.row(id)!.flags & 2).toBe(0)
  })
})

describe('R12 source toHash differs from the upstream hash → stale-upstream', () => {
  it('stays until acknowledged', async () => {
    const t = await lib()
    t.write('up.png', PNG('up'))
    t.write('down.png', PNG('down'))
    await t.scan()
    const up = t.idOf('up.png')
    const [down] = await t.keep('down.png')
    t.setSidecar('down.png', { ...t.sidecar('down.png'), relations: [{ type: 'source', to: up, toHash: 'sha256:0000' }] })
    await t.scan()
    const s = t.issues('stale-upstream')
    expect(s.map(i => i.asset_id)).toEqual([down])
    await t.scan()
    expect(t.issues('stale-upstream')).toHaveLength(1)
    await t.svc.acknowledgeUpstream(down, up, ctx)
    expect(t.sidecar('down.png').relations?.[0]?.toHash).toBe(t.row(up)!.hash)
    expect(t.issues('stale-upstream')).toEqual([])
  })
})

describe('rescan without changes', () => {
  it('does not read unchanged sidecars again; the pipeline yields while a full scan works, not for a folder scan', async () => {
    const t = await lib()
    t.write('a.png', PNG('a'))
    t.write('b.png', PNG('b'))
    t.write('docs/c.md', '# c')
    await t.scan()
    await t.keep('a.png', 'b.png')
    await t.scan()
    const reads = vi.spyOn(t.svc.fs, 'readSidecar')
    t.pipeline.yields.length = 0
    await t.scan()
    expect(reads).not.toHaveBeenCalled()
    expect(t.pipeline.yields).toEqual([true, false])
    // a sidecar edited outside Bowerbird is still read and taken in
    t.setSidecar('a.png', { ...t.sidecar('a.png'), tags: ['外部'] })
    await t.scan()
    expect(reads.mock.calls.map(c => c[0])).toContain('a.png')
    expect(t.svc.store.meta(t.rowByPath('a.png')!).tags).toEqual(['外部'])
    // so is changed content (R4)
    t.write('b.png', PNG('b2'))
    await t.scan()
    expect(t.sidecar('b.png').versions).toHaveLength(2)
    t.pipeline.yields.length = 0
    await t.scan('docs')
    expect(t.pipeline.yields).toEqual([])
    reads.mockRestore()
  })
})

describe('index rebuild', () => {
  it('produces the same index from the folder after the index is dropped', async () => {
    const t = await lib()
    t.write('props/chest.png', PNG('chest'))
    t.write('props/tex.png', PNG('tex'))
    t.write('props/dup.png', PNG('chest'))
    t.write('docs/readme.md', '# hi')
    await t.scan()
    const chest = t.idOf('props/chest.png')
    const tex = t.idOf('props/tex.png')
    const readme = t.idOf('docs/readme.md')
    await t.svc.patch(chest, { tags: { add: ['宝箱', '道具'] }, description: '宝箱。木质' }, ctx)
    await t.svc.addRelation(chest, { type: 'uses', to: tex, slot: 'tex.png' }, ctx)
    await t.svc.addRelation(chest, { type: 'belongs', to: readme }, ctx)
    await t.svc.addRelation(tex, { type: 'source', to: readme }, ctx)
    await t.svc.review(chest, { status: 'approved' }, ctx)
    await t.svc.register({ fields: { folder: 'gen', provenance: { method: 'ai-generate', prompt: '宝箱' }, relations: [{ type: 'source', to: readme, role: 'brief' }] }, file: { name: 'g.png', data: PNG('gen') } }, ctx)
    t.write('docs/readme.md', '# changed content')
    await t.scan()
    const ghostRel = { type: 'uses', to: '0192f3a7-0000-7000-8000-00000000abcd' }
    t.setSidecar('docs/readme.md', { ...t.sidecar('docs/readme.md'), relations: [ghostRel] })
    t.rm('props/tex.png')
    await t.scan()
    await t.svc.trash(t.idOf('gen/g.png'), { force: true }, ctx)

    // a file that was only seen gets a new GUID in a new index (nothing on disk names it, ADR-067): compare it by path
    const snapshot = () => {
      const db = t.svc.store.db
      const seen = db.prepare('SELECT id, path FROM assets WHERE sidecar = 0').all() as Array<{ id: string; path: string }>
      const raw = JSON.stringify({
        assets: db.prepare('SELECT id, path, folder, name, ext, hash, size, stage, review, review_status, bundle, auxiliary, missing, sidecar, created_at, created_by, modified_at, modified_by, description, method, batch, flags, issue_level, issue_count, member_count, meta_json FROM assets ORDER BY path').all(),
        tags: db.prepare('SELECT t.* FROM tags t JOIN assets a ON a.id = t.asset_id ORDER BY a.path, t.tag, t.ai').all(),
        relations: db.prepare('SELECT * FROM relations ORDER BY from_id, type, to_id, slot').all(),
        issues: db.prepare('SELECT id, type, level, asset_id, rel_type, rel_to, rel_slot, path, details_json FROM issues ORDER BY type, path').all(),
        trash: db.prepare('SELECT id, asset_id, name, original_path, deleted_at, deleted_by, info_json FROM trash ORDER BY id').all()
      })
      return JSON.parse(seen.reduce((acc, r) => acc.split(r.id).join(`seen:${r.path}`), raw)) as Record<string, unknown[]>
    }
    const before = snapshot()
    expect((before.issues as unknown[]).length).toBeGreaterThan(0)
    await t.reopen({ dropIndex: true })
    await t.svc.scanner.idle()
    const after = snapshot()
    expect(after.assets).toEqual(before.assets)
    expect(after.tags).toEqual(before.tags)
    expect(after.relations).toEqual(before.relations)
    expect(after.issues).toEqual(before.issues)
    expect(after.trash).toEqual(before.trash)
    expect((before.assets as Array<{ path: string; sidecar: number }>).filter(a => !a.sidecar).map(a => a.path)).toEqual(['props/dup.png'])
  })
})

describe('first open of a folder with files (ADR-033)', () => {
  it('reports what will be registered, registers on initialize and can stop and resume', async () => {
    const files: Record<string, string> = { 'a.png': 'a', 'sub/b.png': 'b', 'sub/c.skel': 'c', 'sub/deep/d.xyz': 'd', '.DS_Store': 'x' }
    const t = await lib({ files, plugins: { missing: { '.skel': { id: 'community.spine', range: '^1.4.0', displayName: 'Spine' } } } })
    const info = await t.svc.info(ctx)
    expect(info.state).toBe('uninitialized')
    expect(info.firstOpen).toMatchObject({ files: 4, folders: 2 })
    expect(info.firstOpen?.unsupported).toEqual(expect.arrayContaining([
      { ext: '.skel', count: 1, hint: 'Spine（community.spine ^1.4.0）' }, { ext: '.xyz', count: 1 }
    ]))
    await expect(t.svc.register({ fields: { name: 'x.png' }, file: { name: 'x.png', data: PNG('x') } }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await t.svc.initialize(ctx)
    await t.svc.scanner.idle()
    const libJson = JSON.parse(fs.readFileSync(path.join(t.root, '.bowerbird/library.json'), 'utf8'))
    expect(libJson.id).toBe(t.id)
    expect(libJson.plugins).toEqual({ 'test.image': '^1.0.0', 'test.model': '^2.0.0' })
    expect(t.svc.store.count()).toBe(4)
    expect((await t.svc.info(ctx)).state).toBe('ready')
    // stop: a new file is left for the next scan
    t.write('later/e.png', PNG('e'))
    const p = t.svc.scanner.scan('full')
    await t.svc.stopScan()
    await p
    await t.scan()
    expect(t.rowByPath('later/e.png')).toBeDefined()
  })

  it('an empty folder becomes a library right away', async () => {
    const t = await lib()
    expect((await t.svc.info(ctx)).state).toBe('ready')
    expect(t.hub.libraries()[0]?.state).toBe('ready')
  })
})

describe('watcher', () => {
  it('picks up a new file after it stays unchanged for the stability window', async () => {
    const t = await lib({ watch: true, stableMs: 200 })
    await new Promise(r => setTimeout(r, 300))
    t.write('w/new.png', PNG('new'), -10)
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && !t.rowByPath('w/new.png')) await new Promise(r => setTimeout(r, 100))
    await t.svc.scanner.idle()
    expect(t.rowByPath('w/new.png')).toBeDefined()
    expect(t.exists('w/new.png.bmeta')).toBe(false)
  }, 15_000)
})

describe('ignore rules changed afterwards (ADR-067)', () => {
  it('forgets files that were only seen and lets go of assets with a .bmeta: .bmeta to the trash, file stays', async () => {
    const t = await lib()
    t.write('proto/app.js', 'js')
    t.write('proto/shot.png', PNG('shot'))
    t.write('art/hero.png', PNG('hero'))
    await t.scan()
    const [shot] = await t.keep('proto/shot.png')
    const hero = t.idOf('art/hero.png')
    await t.svc.addRelation(hero, { type: 'reference', to: shot! }, ctx)
    const seenJs = t.idOf('proto/app.js')
    fs.writeFileSync(t.abs('.bbignore'), 'proto/\n')
    t.svc.fs.reloadIgnore()
    await t.scan()
    expect(t.row(seenJs)).toBeUndefined()
    expect(t.row(shot!)).toBeUndefined()
    expect(t.exists('proto/shot.png')).toBe(true)
    expect(t.exists('proto/shot.png.bmeta')).toBe(false)
    const { items } = await t.svc.trashList()
    expect(items.map(i => i.originalPath)).toEqual(['proto/shot.png.bmeta'])
    // the reference now points at nothing the library knows: a broken reference, as after a delete
    expect(t.issues('broken-reference').map(i => i.asset_id)).toEqual([hero])
    // restoring is refused while the rule still matches
    await expect(t.svc.restore(items[0]!.id, undefined, ctx)).rejects.toMatchObject({ code: 'conflict' })
    // the rule goes: the .bmeta can come back with the same GUID
    fs.rmSync(t.abs('.bbignore'))
    t.svc.fs.reloadIgnore()
    await t.scan()
    await t.svc.restore(items[0]!.id, undefined, ctx)
    await t.scan()
    expect(t.idOf('proto/shot.png')).toBe(shot)
    expect(t.issues('broken-reference')).toEqual([])
  })

  it('untrack: the .bmeta goes to the trash, the file stays and is only seen again', async () => {
    const t = await lib()
    t.write('a.png', PNG('a'))
    await t.scan()
    const [id] = await t.keep('a.png')
    const r = await t.svc.untrack(id!, ctx)
    expect(r.trashId).toBeTruthy()
    expect(t.exists('a.png')).toBe(true)
    expect(t.exists('a.png.bmeta')).toBe(false)
    await t.scan()
    const again = t.rowByPath('a.png')!
    expect(again.id).not.toBe(id)
    expect(again.sidecar).toBe(0)
  })
})

describe('saying what an asset has (ADR-068)', () => {
  it('writes only the difference; the same request twice writes nothing; a dry run writes nothing at all', async () => {
    const t = await lib()
    t.write('gen/shop.png', PNG('shop'))
    t.write('proto/shop.png', PNG('proto'))
    await t.scan()
    const proto = t.idOf('proto/shop.png')
    const item = {
      path: 'gen/shop.png', stage: 'reference' as const, tags: { add: ['效果图'] },
      provenance: { method: 'ai-generate', tool: 'gpt-image', prompt: '商店界面', params: { model: 'gpt-image-1', size: '1024x1536' } },
      relations: { add: [{ type: 'reference', to: proto, role: 'layout' }] }
    }
    const dry = await t.svc.apply({ items: [item], dryRun: true }, ctx)
    expect(dry.results[0]!.changes.map(c => c.field).sort()).toEqual(['provenance', 'relations', 'stage', 'tags'])
    expect(t.exists('gen/shop.png.bmeta')).toBe(false)
    const first = await t.svc.apply({ items: [item] }, ctx)
    expect(first.results[0]!.changed).toBe(true)
    const m1 = t.sidecar('gen/shop.png')
    expect(m1.provenance).toMatchObject({ method: 'ai-generate', prompt: '商店界面', by: 'user:tester' })
    expect(m1.relations).toEqual([{ type: 'reference', to: proto, toHash: t.row(proto)!.hash, role: 'layout' }])
    // the counterpart is named by a relation now: it gets its .bmeta so the GUID survives a new index
    expect(t.exists('proto/shop.png.bmeta')).toBe(true)
    const again = await t.svc.apply({ items: [item] }, ctx)
    expect(again.results[0]).toMatchObject({ changed: false, changes: [] })
    expect(t.read('gen/shop.png.bmeta')).toBe(JSON.stringify(m1, null, 2) + '\n')
    // a correction: the provenance is simply replaced (no record history, ADR-070)
    await t.svc.apply({ items: [{ path: 'gen/shop.png', provenance: { ...item.provenance, prompt: '商店界面，夜晚' } }] }, ctx)
    expect(t.sidecar('gen/shop.png').provenance?.prompt).toBe('商店界面，夜晚')
    // a reference never reports「上游已更新」
    t.write('proto/shop.png', PNG('proto again'))
    await t.scan()
    expect(t.issues('stale-upstream')).toEqual([])
  })

  it('answers every item on its own: one bad item never stops the others', async () => {
    const t = await lib()
    t.write('a.png', PNG('a'))
    await t.scan()
    const r = await t.svc.apply({ items: [{ path: 'nope.png', tags: { add: ['x'] } }, { path: 'a.png', tags: { add: ['x'] } }] }, ctx)
    expect(r.results[0]!.error?.code).toBe('not_found')
    expect(r.results[1]!.changed).toBe(true)
    expect(r.newTags.map(n => n.tag)).toEqual(['x'])
  })
})

describe('what a path may name (ADR-067)', () => {
  it('a plain folder is not an asset, and a file inside a bundle is part of the bundle', async () => {
    const t = await lib()
    t.write('Textures/a.png', PNG('a'))
    t.write('proto/index.html', '<p>')
    await t.scan()
    const [a] = await t.keep('Textures/a.png')
    const r = await t.svc.apply({ items: [{ path: 'Textures', tags: { add: ['x'] } }] }, ctx)
    expect(r.results[0]!.error?.code).toBe('validation_failed')
    expect(t.exists('Textures.bmeta')).toBe(false)
    await t.scan()
    expect(t.row(a!)?.missing).toBe(0)
    await t.svc.makeBundle('proto', 'index.html', ctx)
    const inner = await t.svc.apply({ items: [{ path: 'proto/index.html', tags: { add: ['x'] } }] }, ctx)
    expect(inner.results[0]!.error?.code).toBe('validation_failed')
    expect(t.exists('proto/index.html.bmeta')).toBe(false)
  })
})
