/** Kernel bugs found by the e2e line: batch move with skip, and scans that said `done` before their own retry. */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScanProgress } from '@bowerbird/schema'
import { createHubWith } from '../../hub.js'
import { silentLogger } from '../../log.js'
import { cleanupTmp, ctx, fakePipeline, fakePluginHost, fakePlugins, fakeQuery, makeLib, tmpDir, type TestLib } from './harness.js'

let libs: TestLib[] = []
async function lib(o?: Parameters<typeof makeLib>[0]): Promise<TestLib> { const t = await makeLib(o); libs.push(t); return t }
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const bytes = (s: string) => new Uint8Array(Buffer.from(s))
async function up(t: TestLib, p: string, content = p) {
  const i = p.lastIndexOf('/')
  return (await t.svc.register({ fields: { folder: i < 0 ? '' : p.slice(0, i) }, file: { name: p.slice(i + 1), data: bytes(content) } }, ctx)).asset!.id
}

describe('batch move with skip', () => {
  it('does not count an asset skipped because of a name clash as updated (nor as failed)', async () => {
    const t = await lib()
    const clash = await up(t, 'a/x.png', 'ax')
    const free = await up(t, 'a/y.png', 'ay')
    await up(t, 'b/x.png', 'bx')
    const r = await t.svc.batch({ ids: [clash, free], patch: { move: { folder: 'b', onConflict: 'skip' } } }, ctx)
    expect(r).toEqual({ updated: [free], failed: [] })
    expect(t.row(clash)?.path).toBe('a/x.png')
    expect(t.row(free)?.path).toBe('b/y.png')
    // an asset already in the target folder is not moved either
    const r2 = await t.svc.batch({ ids: [free], patch: { move: { folder: 'b' } } }, ctx)
    expect(r2).toEqual({ updated: [], failed: [] })
    // other changes in the same batch still count
    const r3 = await t.svc.batch({ ids: [clash], patch: { tags: { add: ['t'] }, move: { folder: 'b', onConflict: 'skip' } } }, ctx)
    expect(r3).toEqual({ updated: [clash], failed: [] })
    expect(t.row(clash)?.path).toBe('a/x.png')
  })
})

describe('scan progress with files still being written', () => {
  it('stays running until the retry for unstable files has run, then says done', async () => {
    const t = await lib({ stableMs: 800 })
    const history = (t.hub.events as unknown as { history: Array<{ library: string; type: string; data: unknown }> }).history
    history.length = 0
    t.write('fresh/new.png', 'just copied', 0) // mtime: now, inside the stability window
    await t.svc.scanner.scan('full')
    // the first pass is over, the retry is pending: not done, not finished
    expect(t.rowByPath('fresh/new.png')).toBeUndefined()
    expect(t.svc.scanner.progress.running).toBe(true)
    expect(t.svc.scanner.progress.phase).not.toBe('done')
    expect(t.svc.scanner.progress.finishedAt).toBeUndefined()
    expect(((await t.svc.info(ctx)).scan as ScanProgress).running).toBe(true)
    await t.svc.scanner.idle()
    expect(t.rowByPath('fresh/new.png')).toBeDefined()
    expect(t.svc.scanner.progress).toMatchObject({ running: false, phase: 'done' })
    // the first `done` anyone was told about came after the file was registered
    const mine = history.filter(e => e.library === t.id)
    const firstDone = mine.findIndex(e => e.type === 'scan.progress' && (e.data as ScanProgress).phase === 'done')
    const created = mine.findIndex(e => e.type === 'asset.created')
    expect(created).toBeGreaterThanOrEqual(0)
    expect(firstDone).toBeGreaterThan(created)
  }, 20_000)

  it('first open of a freshly copied folder: registering until the retry has run, never `done` with 0 files', async () => {
    const t = await lib({ files: { 'a.png': 'a', 'sub/b.png': 'b' }, stableMs: 800 })
    expect((await t.svc.info(ctx)).state).toBe('uninitialized')
    const history = (t.hub.events as unknown as { history: Array<{ library: string; type: string; data: unknown }> }).history
    history.length = 0
    t.write('a.png', 'a', 0) // just copied
    t.write('sub/b.png', 'b', 0)
    await t.svc.initialize(ctx)
    await new Promise(r => setTimeout(r, 300))
    expect(t.svc.store.count()).toBe(0)
    expect(((await t.svc.info(ctx)).scan as ScanProgress).running).toBe(true)
    await t.svc.scanner.idle()
    expect(t.svc.store.count()).toBe(2)
    await new Promise(r => setImmediate(r)) // the service clears its flag right after the scan settles
    expect(t.svc.registering).toBe(false)
    const progress = history.filter(e => e.library === t.id && e.type === 'scan.progress').map(e => e.data as ScanProgress)
    expect(progress.at(-1)).toMatchObject({ running: false, phase: 'done' })
    // every earlier report: still running, and the reconcile step of both passes says registering
    for (const p of progress.slice(0, -1)) {
      expect(p.running).toBe(true)
      expect(['walking', 'hashing', 'registering']).toContain(p.phase)
    }
    expect(new Set(progress.map(p => p.startedAt)).size).toBe(1)
  }, 20_000)

  it('a file whose mtime is in the future is registered once it has stayed unchanged for a window (the scan ends)', async () => {
    const t = await lib({ stableMs: 300 })
    t.write('future/clock.png', 'from a skewed clock', 3600)
    await t.svc.scanner.scan('full')
    expect(t.svc.scanner.progress.running).toBe(true)
    const end = Date.now() + 5000
    await Promise.race([t.svc.scanner.idle(), new Promise(r => setTimeout(r, Math.max(0, end - Date.now())))])
    expect(t.svc.scanner.progress).toMatchObject({ running: false, phase: 'done' })
    expect(t.rowByPath('future/clock.png')).toBeDefined()
  }, 20_000)

  it('stopping the scan cancels a pending retry and says stopped', async () => {
    const t = await lib({ stableMs: 800 })
    t.write('fresh/new.png', 'just copied', 0)
    await t.svc.scanner.scan('full')
    expect(t.svc.scanner.progress.running).toBe(true)
    await t.svc.stopScan()
    expect(t.svc.scanner.progress).toMatchObject({ running: false, phase: 'stopped' })
    await new Promise(r => setTimeout(r, 1200))
    expect(t.rowByPath('fresh/new.png')).toBeUndefined()
  }, 20_000)
})

describe('undo of deleting a broken relation', () => {
  it('puts back a relation whose target is in the trash (still broken); a target that exists nowhere is refused', async () => {
    const t = await lib()
    const tex = await up(t, 'tex.png', 'tex')
    const model = await up(t, 'model.png', 'model')
    const texHash = t.row(tex)!.hash
    await t.svc.addRelation(model, { type: 'source', to: tex, note: 'from the paint-over' }, ctx)
    const r = await t.svc.trash(tex, { force: true }, ctx)
    expect(t.issues('broken-reference').map(i => i.asset_id)).toEqual([model])
    await t.svc.removeRelation(model, { type: 'source', to: tex }, ctx)
    expect(t.issues('broken-reference')).toEqual([])
    // the toast's 撤销: the same relation again
    const d = await t.svc.addRelation(model, { type: 'source', to: tex, note: 'from the paint-over' }, ctx)
    expect(d.relations.outgoing).toEqual([expect.objectContaining({ type: 'source', to: tex, broken: true, targetInTrash: true, targetName: 'tex.png' })])
    expect(t.sidecar('model.png').relations).toEqual([{ type: 'source', to: tex, toHash: texHash, note: 'from the paint-over' }])
    expect(t.issues('broken-reference').map(i => i.asset_id)).toEqual([model])
    // restoring the target heals it, as before the delete
    await t.svc.restore(r.trashId, false, ctx)
    expect(t.issues('broken-reference')).toEqual([])
    expect((await t.svc.get(model, ctx)).relations.outgoing[0]).toMatchObject({ to: tex, broken: false })
    // a GUID that is neither indexed nor in the trash
    await expect(t.svc.addRelation(model, { type: 'uses', to: '00000000-0000-4000-8000-000000000000' }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
  })
})

describe('listen address changed while started with --host', () => {
  const factories = () => {
    const plugins = fakePlugins()
    return { createPluginHost: () => fakePluginHost(plugins), createQueryEngine: fakeQuery, createPipeline: () => fakePipeline() }
  }

  it('saves the new host, answers with the saved config and says a restart is needed; the flags only apply to this run', async () => {
    const base = tmpDir('hub-host')
    const home = path.join(base, 'home')
    const hub = await createHubWith({ home, builtinPluginDirs: [], watch: false, log: silentLogger, overrides: { host: '127.0.0.1', port: 0 } }, factories(), { stableMs: 0 })
    try {
      const lib = await hub.addLibrary(path.join(base, 'Lib'))
      // the machine config is what is saved, not this run's flags
      expect(hub.config()).toMatchObject({ host: '127.0.0.1', port: 7420 })
      const r = await hub.patchConfig({ host: '0.0.0.0' })
      expect(r.config.host).toBe('0.0.0.0')
      expect(r.restartRequired).toBe(true)
      expect(hub.restartPending()).toBe(true) // a page reloaded now still says so (GET /config)
      expect(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).host).toBe('0.0.0.0')
      expect(hub.config().host).toBe('0.0.0.0')
      // this run still listens where the flag said
      expect((await (await hub.library(lib.id)).info(ctx)).lanOpen).toBe(false)
      // an unrelated change needs no restart (this run's port 0 is not a pending change)
      expect((await hub.patchConfig({ scanIntervalMinutes: 30 })).restartRequired).toBe(false)
      // back to what this run listens on: nothing to restart for
      const back = await hub.patchConfig({ host: '127.0.0.1' })
      expect(back).toMatchObject({ config: { host: '127.0.0.1' }, restartRequired: false })
      // this run's own `--port 0` is not a pending change
      expect(hub.restartPending()).toBe(false)
    } finally { await hub.close() }
  })
})
