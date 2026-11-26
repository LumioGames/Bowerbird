import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Action, Creator, JobContext } from '@bowerbird/plugin-sdk'
import type { JobInfo } from '@bowerbird/schema'
import { openMemoryIndexDb } from '../../index/db.js'
import { createQueryEngine } from '../../index/query.js'
import { createEventBus } from '../../events.js'
import { silentLogger } from '../../log.js'
import type { IndexDb, LibraryPlugins } from '../../contracts.js'
import { createPipeline } from '../index.js'
import { createPipelineImpl, type PipelineImpl } from '../pipeline.js'
import { cacheKey } from '../cache.js'
import { seedRelation, seedTrash } from '../../query/__tests__/seed.js'
import { FakeDeps, fakeHandle, gid, pluginsWith, seedAsset, tmp, type FormatDef } from './fakes.js'

const webp = (s: string): Uint8Array => new TextEncoder().encode(`WEBP:${s}`)

interface Rig { db: IndexDb; deps: FakeDeps; pipe: PipelineImpl; base: string; events: ReturnType<typeof createEventBus>; plugins: LibraryPlugins & { invoked: string[] } }

const rigs: PipelineImpl[] = []
const rigDbs = new Map<PipelineImpl, IndexDb>()
afterEach(async () => {
  for (const p of rigs.splice(0)) {
    await p.stop()
    // The in-memory queue counters must agree with the jobs table after whatever the test did.
    const db = rigDbs.get(p)
    if (!db) continue
    p.retry({}) // writes any pending work
    const ov = p.overview()
    for (const s of ov.stages) {
      const n = (status: string) => db.prepare("SELECT COUNT(*) FROM jobs WHERE kind = 'process' AND stage = ? AND status = ?").pluck().get(s.stage, status) as number
      expect({ stage: s.stage, q: s.queued, r: s.running, d: s.done, f: s.failed, k: s.skipped }).toEqual({ stage: s.stage, q: n('queued'), r: n('running'), d: n('done'), f: n('failed'), k: n('skipped') })
    }
    expect(ov.waitingRender).toBe(db.prepare("SELECT COUNT(DISTINCT asset_id) FROM jobs WHERE kind = 'process' AND status = 'waiting-renderer'").pluck().get())
    const busy = (db.prepare("SELECT COUNT(DISTINCT asset_id) FROM jobs WHERE kind = 'process' AND status IN ('queued', 'running')").pluck().get() as number)
      + (db.prepare("SELECT COUNT(*) FROM jobs WHERE kind IN ('create', 'action') AND status IN ('queued', 'running')").pluck().get() as number)
    expect(ov.busy).toBe(busy)
  }
  rigDbs.clear()
})

function rig(defs: FormatDef[], o: { db?: IndexDb; base?: string; deps?: FakeDeps; plugins?: LibraryPlugins & { invoked: string[] }; concurrency?: number; retryDelays?: number[] } = {}): Rig {
  const db = o.db ?? openMemoryIndexDb()
  const base = o.base ?? tmp()
  const deps = o.deps ?? new FakeDeps(db)
  const plugins = o.plugins ?? pluginsWith(defs)
  const events = createEventBus()
  const query = createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger })
  const pipe = createPipelineImpl({ db, library: fakeHandle(base), plugins, query, deps, events, log: silentLogger, concurrency: o.concurrency ?? 2, retryDelays: o.retryDelays ?? [5, 10, 20], cleanIntervalMs: 0 })
  rigs.push(pipe)
  rigDbs.set(pipe, db)
  return { db, deps, pipe, base, events, plugins }
}

function jobsOf(db: IndexDb, assetId: string): Record<string, string> {
  const rows = db.prepare("SELECT stage, status FROM jobs WHERE kind = 'process' AND asset_id = ?").all(assetId) as Array<{ stage: string; status: string }>
  return Object.fromEntries(rows.map(r => [r.stage, r.status]))
}

const imageFormat = (handler: FormatDef['handler'] = {}): FormatDef => ({
  id: 'image', ext: ['.png'], thumbnail: 'server',
  handler: { probe: async () => ({ tech: { width: 64 } }), thumbnail: async () => ({ thumb: webp('t'), preview: webp('p'), aspect: 2 }), ...handler }
})

describe('pipeline stages', () => {
  it('runs the eight stages in order; unhandled stages are skipped; enrich is idle without enrichers', async () => {
    const { db, deps, pipe } = rig([imageFormat()])
    const id = seedAsset(db, { path: 'a.png', hash: 'sha256:aa' })
    pipe.start()
    pipe.enqueue(id, 'all')
    await pipe.idle()
    expect(jobsOf(db, id)).toEqual({ identify: 'done', probe: 'done', derive: 'skipped', thumbnail: 'done', summary: 'skipped', enrich: 'skipped', validate: 'skipped', index: 'skipped' })
    expect(deps.fns(id).filter(f => f !== 'assetFile')).toEqual(['applyIdentify', 'applyProbe', 'applyThumbnails'])
    expect(deps.processing.filter(p => p.id === id).map(p => p.processing)).toEqual([true, false])
    const ov = pipe.overview()
    expect(ov.stages.map(s => s.stage)).toEqual(['identify', 'probe', 'derive', 'thumbnail', 'summary', 'enrich', 'validate', 'index'])
    expect(ov.stages.find(s => s.stage === 'enrich')!.idle).toBe(true)
    expect(ov.stages.find(s => s.stage === 'thumbnail')).toMatchObject({ idle: false, done: 1, queued: 0 })
    expect(ov.stages.find(s => s.stage === 'identify')!.rate).toBeGreaterThan(0)
    expect(ov.scan).toMatchObject({ running: false, phase: 'idle' })
    expect(ov.busy).toBe(0)
  })

  it('writes server thumbnails into the content-addressed cache', async () => {
    const { db, deps, pipe, base } = rig([imageFormat()])
    const tex = seedAsset(db, { path: 'tex.png', hash: 'sha256:7e' })
    const id = seedAsset(db, { path: 'a.png', hash: 'sha256:aa' })
    seedRelation(db, id, 'uses', tex)
    pipe.start()
    pipe.enqueue(id, 'all')
    await pipe.idle()
    const key = cacheKey({ hash: 'sha256:aa', refs: ['sha256:7e'], plugin: 'bowerbird.image', version: '1.0.0', stage: 'thumbnail', variant: 'thumb' })
    const expected = path.join(base, 'library', '.bowerbird', 'cache', 'thumbnail', key.slice(0, 2), `${key}.webp`)
    expect(pipe.thumbnailFile(id, 'thumb')).toBe(expected)
    expect(fs.readFileSync(expected, 'utf8')).toBe('WEBP:t')
    expect(pipe.thumbnailFile(id, 'preview')).toMatch(/\.webp$/)
    expect(pipe.thumbnailFile(id, 'poster')).toBeNull()
    expect(deps.thumbs.find(t => t.id === id)).toMatchObject({ id, aspect: 2, stored: { thumb: { key, relPath: `thumbnail/${key.slice(0, 2)}/${key}.webp`, bytes: 6 } } })
    const rows = db.prepare('SELECT variant, key FROM cache_files WHERE asset_id = ? ORDER BY variant').all(id)
    expect(rows).toEqual([{ variant: 'preview', key: expect.any(String) }, { variant: 'thumb', key }])
  })

  it('unknown formats get no thumbnail; validators and search providers run when present', async () => {
    const validated: string[] = []
    const indexed: string[] = []
    const plugins = pluginsWith([imageFormat()], {
      validators: () => [{ pluginId: 'p.val', validator: { id: 'size', appliesTo: a => a.format === 'image', check: async f => { validated.push(f.id); return [{ rule: 'size', verdict: 'warn', message: '太大', values: { w: 1 } }] } } }],
      searchProviders: () => [{ pluginId: 'p.kw', provider: { id: 'kw', index: async docs => { indexed.push(...docs.map(d => d.id)) }, remove: async () => {}, query: async () => [] } }]
    })
    const { db, deps, pipe } = rig([], { plugins })
    const img = seedAsset(db, { path: 'a.png' })
    const odd = seedAsset(db, { path: 'b.xyz' })
    pipe.start()
    pipe.enqueue(img, 'all')
    pipe.enqueue(odd, 'all')
    await pipe.idle()
    expect(validated).toEqual([img])
    expect(deps.checks).toEqual([{ id: img, checks: [{ validator: 'size', rule: 'size', verdict: 'warn', message: '太大', values: { w: 1 } }] }])
    expect(indexed.sort()).toEqual([img, odd].sort())
    expect(jobsOf(db, odd)).toMatchObject({ identify: 'done', probe: 'skipped', thumbnail: 'skipped', validate: 'skipped', index: 'done' })
    expect(deps.calls.filter(c => c.fn === 'setThumbState' && c.id === odd).map(c => c.args)).toEqual([['none']])
  })

  it('retries a failing stage three times with growing delays, then fails and raises the issue', async () => {
    const times: number[] = []
    const { db, deps, pipe, events } = rig([imageFormat({ probe: async () => { times.push(Date.now()); throw new Error('读取超时') } })], { retryDelays: [20, 60, 120] })
    const id = seedAsset(db, { path: 'a.png' })
    pipe.start()
    pipe.enqueue(id, 'all')
    await pipe.idle()
    expect(times).toHaveLength(4)
    const gaps = times.slice(1).map((t, i) => t - times[i]!)
    expect(gaps[0]).toBeGreaterThanOrEqual(18)
    expect(gaps[1]).toBeGreaterThanOrEqual(55)
    expect(gaps[2]).toBeGreaterThanOrEqual(110)
    const job = db.prepare("SELECT * FROM jobs WHERE asset_id = ? AND stage = 'probe'").get(id) as { status: string; attempts: number; error: string; retryable: number }
    expect(job).toMatchObject({ status: 'failed', attempts: 4, error: '读取超时', retryable: 1 })
    expect(deps.issues).toEqual([{ id, stage: 'probe', error: '读取超时' }])
    // Other stages are independent of the failure.
    expect(jobsOf(db, id)).toMatchObject({ thumbnail: 'done', index: 'skipped' })
    expect(deps.processing.at(-1)).toMatchObject({ id, processing: false, failed: true, stage: 'probe', error: '读取超时' })
    const failedEvents = events.history.filter(e => e.type === 'job.updated' && (e.data as JobInfo).status === 'failed')
    expect(failedEvents).toHaveLength(1)
    const ov = pipe.overview()
    expect(ov.failed).toHaveLength(1)
    expect(ov.failed[0]).toMatchObject({ kind: 'process', stage: 'probe', assetId: id, assetName: 'a.png', error: '读取超时', retryable: true, attempts: 4 })
    expect(ov.stages.find(s => s.stage === 'probe')!.failed).toBe(1)
  })

  it('recovers after a transient failure and clears the issue after a manual retry', async () => {
    let fail = 5
    const { db, deps, pipe } = rig([imageFormat({ probe: async () => { if (fail-- > 0) throw new Error('flaky'); return { tech: {} } } })], { retryDelays: [1, 1, 1] })
    const id = seedAsset(db, { path: 'a.png' })
    pipe.start()
    pipe.enqueue(id, ['identify', 'probe'])
    await pipe.idle()
    expect(jobsOf(db, id).probe).toBe('failed')
    pipe.retry({ failed: true })
    await pipe.idle()
    expect(jobsOf(db, id).probe).toBe('done')
    expect(deps.issues).toEqual([{ id, stage: 'probe', error: 'flaky' }, { id, stage: 'probe', error: null }])
  })

  it('a plugin throwing anything never stops the pipeline', async () => {
    const { db, pipe } = rig([imageFormat({ thumbnail: async () => { throw 'not even an Error' } })], { retryDelays: [0, 0, 0] })
    const a = seedAsset(db, { path: 'a.png' })
    const b = seedAsset(db, { path: 'b.png' })
    pipe.start()
    pipe.enqueue(a, 'all')
    pipe.enqueue(b, 'all')
    await pipe.idle()
    expect(jobsOf(db, a).thumbnail).toBe('failed')
    expect(jobsOf(db, b)).toMatchObject({ thumbnail: 'failed', probe: 'done', index: 'skipped' })
  })

  it('completed work is announced with throttled job.updated events, the last one after the queue drained', async () => {
    const db = openMemoryIndexDb()
    const events = createEventBus()
    const plugins = pluginsWith([imageFormat({ probe: async () => { await new Promise(r => setTimeout(r, 2)); return { tech: {} } } })])
    const pipe = createPipelineImpl({ db, library: fakeHandle(tmp()), plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps: new FakeDeps(db), events, log: silentLogger, cleanIntervalMs: 0, concurrency: 2, completionEventMs: 40 })
    rigs.push(pipe)
    rigDbs.set(pipe, db)
    const seen: Array<{ status: string; busy: number }> = []
    events.on('lib1', (type, data) => { if (type === 'job.updated') seen.push({ status: (data as JobInfo).status, busy: pipe.overview().busy }) })
    const ids = Array.from({ length: 30 }, (_, i) => seedAsset(db, { path: `ev${i}.png` }))
    pipe.start()
    for (const id of ids) pipe.enqueue(id, 'all')
    await pipe.idle()
    await new Promise(r => setTimeout(r, 120))
    const completions = seen.filter(e => e.status === 'done' || e.status === 'skipped')
    // 30 assets × 8 stages finished, announced in a few coalesced events rather than 240.
    expect(completions.length).toBeGreaterThan(0)
    expect(completions.length).toBeLessThan(60)
    // The shell refreshes its task count on the event: the last one comes when nothing is left.
    expect(seen.at(-1)).toMatchObject({ busy: 0 })
  })

  it('respects concurrency and runs one stage of an asset at a time', async () => {
    let active = 0
    let peak = 0
    const perAsset = new Map<string, number>()
    const slowProbe = async (f: { id: string }) => {
      active++; peak = Math.max(peak, active)
      perAsset.set(f.id, (perAsset.get(f.id) ?? 0) + 1)
      if (perAsset.get(f.id)! > 1) throw new Error('two stages of one asset at once')
      await new Promise(r => setTimeout(r, 10))
      perAsset.set(f.id, perAsset.get(f.id)! - 1)
      active--
      return { tech: {} }
    }
    const { db, pipe } = rig([imageFormat({ probe: slowProbe as never, thumbnail: slowProbe as never })], { concurrency: 3 })
    const ids = Array.from({ length: 8 }, (_, i) => seedAsset(db, { path: `a${i}.png` }))
    pipe.start()
    for (const id of ids) pipe.enqueue(id, 'all')
    await pipe.idle()
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
    for (const id of ids) expect(jobsOf(db, id).probe).toBe('done')
  })

  it('priority: visible assets first, then recent, then backlog', async () => {
    const order: string[] = []
    const { db, pipe } = rig([imageFormat({ probe: async f => { order.push(f.name); return { tech: {} } } })], { concurrency: 1 })
    const backlog = seedAsset(db, { path: 'backlog.png' })
    const recent = seedAsset(db, { path: 'recent.png' })
    const visible = seedAsset(db, { path: 'visible.png' })
    pipe.enqueue(backlog, ['probe'], { reason: 'scan' })
    pipe.enqueue(visible, ['probe'], { reason: 'scan' })
    pipe.enqueue(recent, ['probe'])
    pipe.markVisible([visible])
    pipe.start()
    await pipe.idle()
    expect(order).toEqual(['visible.png', 'recent.png', 'backlog.png'])
  })

  it('forget() drops queued work of an asset; a vanished asset ends its jobs', async () => {
    const { db, pipe } = rig([imageFormat()])
    const a = seedAsset(db, { path: 'a.png' })
    pipe.enqueue(a, 'all')
    expect(pipe.overview().busy).toBe(1)
    pipe.forget(a)
    expect(jobsOf(db, a)).toEqual({})
    const b = seedAsset(db, { path: 'b.png' })
    pipe.enqueue(b, 'all')
    db.prepare('DELETE FROM assets WHERE id = ?').run(b)
    pipe.start()
    await pipe.idle()
    expect(jobsOf(db, b)).toEqual({})
  })

  it('resumes after a restart: running jobs go back to the queue', async () => {
    const db = openMemoryIndexDb()
    const base = tmp()
    const a = seedAsset(db, { path: 'a.png' })
    db.prepare("INSERT INTO jobs (id, kind, asset_id, stage, status, created_at, updated_at) VALUES ('j1', 'process', ?, 'probe', 'running', 'x', 'x')").run(a)
    db.prepare("INSERT INTO jobs (id, kind, creator, status, created_at, updated_at) VALUES ('c1', 'create', 'x:y', 'running', 'x', 'x')").run()
    const { pipe } = rig([imageFormat()], { db, base })
    pipe.start()
    await pipe.idle()
    expect(jobsOf(db, a).probe).toBe('done')
    expect(pipe.job('c1')).toMatchObject({ status: 'failed', error: '服务重启，任务中断', retryable: true })
  })
})

describe('browser render worker (ADR-025)', () => {
  const model: FormatDef = { id: 'model', ext: ['.glb'], thumbnail: 'browser', handler: { probe: async () => ({ tech: { triangles: 10 }, references: ['albedo.png'], text: 'chest', badge: '10 面' }), summarize: async () => ({ text: '10 个三角面' }) } }

  it('parks thumbnail and summary in waiting-renderer; visible assets are handed out first; tasks are leased', async () => {
    const { db, deps, pipe } = rig([model])
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:a1' })
    const b = seedAsset(db, { path: 'b.glb', hash: 'sha256:b1' })
    pipe.start()
    pipe.enqueue(a, 'all')
    pipe.enqueue(b, 'all')
    await pipe.idle()
    expect(jobsOf(db, a)).toMatchObject({ thumbnail: 'waiting-renderer', summary: 'waiting-renderer', index: 'skipped' })
    expect(deps.calls.filter(c => c.fn === 'setThumbState' && c.id === a).map(c => c.args)).toEqual([['render']])
    expect(pipe.overview().waitingRender).toBe(2)
    expect(await pipe.summaryText(a)).toBe('10 个三角面')

    const t1 = await pipe.renderNext([b])
    expect(t1).toMatchObject({ assetId: b, kind: 'thumbnail', format: 'model', plugin: 'bowerbird.model', asset: { id: b } })
    const t2 = await pipe.renderNext([b])
    expect(t2).toMatchObject({ assetId: b, kind: 'summary' })
    const t3 = await pipe.renderNext([b])
    expect(t3).toMatchObject({ assetId: a, kind: 'thumbnail' })
  })

  it('stores submitted parts, merges browser tech, and resolves the summary with the turnaround', async () => {
    const { db, deps, pipe } = rig([model])
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:a1' })
    pipe.start()
    pipe.enqueue(a, 'all')
    await pipe.idle()
    const task = (await pipe.renderNext([]))!
    expect(task.kind).toBe('thumbnail')
    await pipe.renderSubmit(task.job, { thumb: webp('thumb'), turnaround: webp('turn') }, { aspect: 1.25, tech: { triangles: 2480, bones: 12 } })
    expect(jobsOf(db, a)).toMatchObject({ thumbnail: 'done', summary: 'done' })
    expect(deps.thumbs.at(-1)).toMatchObject({ id: a, aspect: 1.25, stored: { thumb: { bytes: 10 }, turnaround: { bytes: 9 } } })
    expect(fs.readFileSync(pipe.thumbnailFile(a, 'thumb')!, 'utf8')).toBe('WEBP:thumb')
    expect(pipe.thumbnailFile(a, 'turnaround')).toContain(`${path.sep}summary${path.sep}`)
    const probe = deps.probes.at(-1)!
    expect(probe.probe).toMatchObject({ tech: { triangles: 2480, bones: 12 }, references: ['albedo.png'], text: 'chest', badge: '10 面' })
    expect(pipe.overview().waitingRender).toBe(0)
    expect(await pipe.renderNext([])).toBeNull()
    await expect(pipe.renderSubmit(task.job, {}, {})).rejects.toMatchObject({ code: 'conflict' })
    await expect(pipe.renderSubmit('nope', {}, {})).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a browser-side failure: not retryable fails at once; retryable retries three times with growing delays (P2-15)', async () => {
    const { db, deps, pipe } = rig([model], { retryDelays: [20, 40, 60] })
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:a1' })
    const b = seedAsset(db, { path: 'b.glb', hash: 'sha256:b1' })
    pipe.start()
    pipe.enqueue(a, ['identify', 'thumbnail'])
    pipe.enqueue(b, ['identify', 'thumbnail'])
    await pipe.idle()
    const ta = (await pipe.renderNext([a]))!
    await pipe.renderSubmit(ta.job, {}, { error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', retryable: false })
    expect(pipe.job(ta.job)).toMatchObject({ status: 'failed', retryable: false, error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', attempts: 1 })
    expect(deps.calls.filter(c => c.fn === 'setThumbState' && c.id === a).map(c => c.args![0])).toEqual(['render', 'failed'])

    const handedOut: number[] = []
    let jb = ''
    const nextThumb = async () => {
      for (let w = 0; w < 200; w++) {
        const t = await pipe.renderNext([b])
        if (t?.kind === 'thumbnail') return t
        await new Promise(r => setTimeout(r, 5))
      }
      return null
    }
    for (let i = 0; i < 4; i++) {
      const t = await nextThumb()
      expect(t?.assetId).toBe(b)
      jb = t!.job
      handedOut.push(Date.now())
      await pipe.renderSubmit(jb, {}, { error: '读取超时', retryable: true })
      if (i < 3) {
        expect(pipe.job(jb)).toMatchObject({ status: 'waiting-renderer', attempts: i + 1, error: '读取超时' })
        expect((await pipe.renderNext([b]))?.kind).not.toBe('thumbnail') // backing off
      }
    }
    const gaps = handedOut.slice(1).map((x, i) => x - handedOut[i]!)
    expect(gaps[0]).toBeGreaterThanOrEqual(18)
    expect(gaps[2]).toBeGreaterThanOrEqual(55)
    expect(pipe.job(jb)).toMatchObject({ status: 'failed', attempts: 4, retryable: true })
    expect(deps.issues.map(i => [i.id, i.stage])).toEqual([[a, 'thumbnail'], [b, 'thumbnail']])
    pipe.retry({ failed: true })
    await pipe.idle()
    expect(pipe.job(ta.job)!.status).toBe('failed')
    expect(pipe.job(jb)!.status).toBe('waiting-renderer')
    pipe.retry({ jobIds: [ta.job] })
    await pipe.idle()
    expect(pipe.job(ta.job)!.status).toBe('waiting-renderer')
  })

  it('a render of content that changed after the task was handed out is discarded and the task re-queued (P2-8)', async () => {
    const { db, deps, pipe } = rig([model])
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:a1' })
    pipe.start()
    pipe.enqueue(a, ['identify', 'thumbnail'])
    await pipe.idle()
    const t1 = (await pipe.renderNext([]))!
    db.prepare("UPDATE assets SET hash = 'sha256:a2' WHERE id = ?").run(a)
    await pipe.renderSubmit(t1.job, { thumb: webp('old content') }, {})
    expect(deps.thumbs).toHaveLength(0)
    expect(pipe.thumbnailFile(a, 'thumb')).toBeNull()
    await pipe.idle()
    expect(jobsOf(db, a).thumbnail).toBe('waiting-renderer')
    const t2 = (await pipe.renderNext([]))!
    await pipe.renderSubmit(t2.job, { thumb: webp('new content') }, {})
    expect(deps.thumbs.at(-1)!.stored.thumb!.key).toBe(cacheKey({ hash: 'sha256:a2', refs: [], plugin: 'bowerbird.model', version: '1.0.0', stage: 'thumbnail', variant: 'thumb' }))

    // References changed in between: discarded as well.
    const tex = seedAsset(db, { path: 'tex.png', hash: 'sha256:7e' })
    pipe.enqueue(a, ['thumbnail'])
    await pipe.idle()
    const t3 = (await pipe.renderNext([]))!
    seedRelation(db, a, 'uses', tex)
    const before = deps.thumbs.length
    await pipe.renderSubmit(t3.job, { thumb: webp('stale refs') }, {})
    expect(deps.thumbs).toHaveLength(before)
    // The job was re-queued meanwhile: a late submit is dropped without an error.
    await pipe.idle()
    const t4 = (await pipe.renderNext([]))!
    pipe.enqueue(a, ['thumbnail'])
    pipe.overview()
    await expect(pipe.renderSubmit(t4.job, { thumb: webp('late') }, {})).resolves.toBeUndefined()
    expect(deps.thumbs).toHaveLength(before)
  })

  it('browser tech that changes a value re-runs validate (size check against the design object, K2)', async () => {
    const checked: number[] = []
    const plugins = pluginsWith([model], {
      validators: () => [{ pluginId: 'bowerbird.model', validator: { id: 'size', appliesTo: x => x.format === 'model', check: async () => { checked.push(Date.now()); return [] } } }]
    })
    const { db, pipe } = rig([], { plugins })
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:f1' })
    pipe.start()
    pipe.enqueue(a, 'all')
    await pipe.idle()
    expect(checked).toHaveLength(1)
    const t = (await pipe.renderNext([]))!
    expect(t.kind).toBe('thumbnail')
    await pipe.renderSubmit(t.job, { thumb: webp('t') }, { tech: { triangles: 10, boundsX: 1.2, boundsY: 0.9, boundsZ: 0.8 } })
    await pipe.idle()
    expect(checked).toHaveLength(2)
    // Same values again (summary task): no extra validation.
    const s = (await pipe.renderNext([]))!
    await pipe.renderSubmit(s.job, { turnaround: webp('t4') }, { tech: { boundsX: 1.2 } })
    await pipe.idle()
    expect(checked).toHaveLength(2)
  })

  it('the agent summary image: turnaround (also the video key-frame strip) before thumb, never scrub (K9)', async () => {
    const { db, pipe } = rig([model])
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:a1' })
    pipe.start()
    pipe.enqueue(a, ['identify', 'thumbnail', 'summary'])
    await pipe.idle()
    const t = (await pipe.renderNext([]))!
    await pipe.renderSubmit(t.job, { thumb: webp('t'), scrub: webp('s') }, {})
    expect(pipe.summaryImage(a)).toMatchObject({ variant: 'thumb' })
    const s = (await pipe.renderNext([]))!
    expect(s.kind).toBe('summary')
    await pipe.renderSubmit(s.job, { turnaround: webp('strip') }, {})
    expect(pipe.summaryImage(a)).toMatchObject({ variant: 'turnaround' })
    expect(fs.readFileSync(pipe.summaryImage(a)!.path, 'utf8')).toBe('WEBP:strip')
  })

  it('a render that arrives through sync while the task waits is adopted, not rendered again (ADR-025)', async () => {
    const { db, deps, pipe, base } = rig([model])
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:a1' })
    pipe.start()
    pipe.enqueue(a, ['identify', 'thumbnail'])
    await pipe.idle()
    expect(jobsOf(db, a).thumbnail).toBe('waiting-renderer')
    const key = cacheKey({ hash: 'sha256:a1', refs: [], plugin: 'bowerbird.model', version: '1.0.0', stage: 'thumbnail', variant: 'thumb' })
    const file = path.join(base, 'library', '.bowerbird', 'cache', 'thumbnail', key.slice(0, 2), `${key}.webp`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'synced')
    expect((await pipe.renderNext([a]))?.kind).not.toBe('thumbnail')
    expect(jobsOf(db, a).thumbnail).toBe('skipped')
    expect(deps.thumbs.at(-1)!.stored.thumb!.key).toBe(key)
    expect(db.prepare('SELECT thumb_state FROM assets WHERE id = ?').pluck().get(a)).toBe('ready')
  })

  it('a render already in the synced cache needs no browser', async () => {
    const { db, deps, pipe, base } = rig([model])
    const a = seedAsset(db, { path: 'a.glb', hash: 'sha256:a1' })
    const key = cacheKey({ hash: 'sha256:a1', refs: [], plugin: 'bowerbird.model', version: '1.0.0', stage: 'thumbnail', variant: 'thumb' })
    const file = path.join(base, 'library', '.bowerbird', 'cache', 'thumbnail', key.slice(0, 2), `${key}.webp`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'rendered elsewhere')
    pipe.start()
    pipe.enqueue(a, ['identify', 'thumbnail'])
    await pipe.idle()
    expect(jobsOf(db, a).thumbnail).toBe('skipped')
    expect(deps.thumbs.at(-1)!.stored.thumb!.key).toBe(key)
    expect(pipe.thumbnailFile(a, 'thumb')).toBe(file)
  })
})

describe('cache keys and stale work', () => {
  it('the key changes with the plugin version and the referenced assets; start() re-queues what changed', async () => {
    const k = (o: Partial<Parameters<typeof cacheKey>[0]>) => cacheKey({ hash: 'sha256:aa', refs: ['sha256:01', 'sha256:02'], plugin: 'p', version: '1.0.0', stage: 'thumbnail', variant: 'thumb', ...o })
    expect(k({})).toMatch(/^[0-9a-f]{64}$/)
    expect(k({ refs: ['sha256:02', 'sha256:01'] })).toBe(k({}))
    expect(k({ version: '1.0.1' })).not.toBe(k({}))
    expect(k({ refs: ['sha256:01', 'sha256:03'] })).not.toBe(k({}))
    expect(k({ hash: 'sha256:bb' })).not.toBe(k({}))
    expect(k({ variant: 'preview' })).not.toBe(k({}))

    const db = openMemoryIndexDb()
    const base = tmp()
    const thumbCalls: string[] = []
    const fmt = (version: string): FormatDef => ({ ...imageFormat({ thumbnail: async f => { thumbCalls.push(`${f.name}@${version}`); return { thumb: webp(version) } } }), version })
    const tex = seedAsset(db, { path: 'tex.png', hash: 'sha256:01' })
    const a = seedAsset(db, { path: 'a.png', hash: 'sha256:aa' })
    seedRelation(db, a, 'uses', tex)
    const first = rig([fmt('1.0.0')], { db, base })
    first.pipe.start()
    first.pipe.enqueue(tex, 'all')
    first.pipe.enqueue(a, 'all')
    await first.pipe.idle()
    const oldKey = (db.prepare("SELECT key FROM cache_files WHERE asset_id = ? AND variant = 'thumb'").pluck().get(a)) as string
    await first.pipe.stop()
    expect(thumbCalls.sort()).toEqual(['a.png@1.0.0', 'tex.png@1.0.0'])

    // Nothing changed: a restart queues nothing.
    const same = rig([fmt('1.0.0')], { db, base })
    same.pipe.start()
    await same.pipe.idle()
    expect(thumbCalls).toHaveLength(2)
    await same.pipe.stop()

    // Plugin updated: every stage it ran is re-done, and the new key gives a new file.
    const updated = rig([fmt('1.1.0')], { db, base })
    updated.pipe.start()
    await updated.pipe.idle()
    expect(thumbCalls.slice(2).sort()).toEqual(['a.png@1.1.0', 'tex.png@1.1.0'])
    const newKey = (db.prepare("SELECT key FROM cache_files WHERE asset_id = ? AND variant = 'thumb'").pluck().get(a)) as string
    expect(newKey).not.toBe(oldKey)
    await updated.pipe.stop()

    // The referenced texture changed while the server was down: only thumbnail/summary/derive of the referrer.
    db.prepare("UPDATE assets SET hash = 'sha256:02' WHERE id = ?").run(tex)
    db.prepare("UPDATE pipeline_stages SET hash = 'sha256:02' WHERE asset_id = ?").run(tex)
    const refChanged = rig([fmt('1.1.0')], { db, base })
    refChanged.pipe.start()
    await refChanged.pipe.idle()
    expect(thumbCalls.slice(4)).toEqual(['a.png@1.1.0'])
    expect((db.prepare("SELECT key FROM cache_files WHERE asset_id = ? AND variant = 'thumb'").pluck().get(a)) as string).toBe(cacheKey({ hash: 'sha256:aa', refs: ['sha256:02'], plugin: 'bowerbird.image', version: '1.1.0', stage: 'thumbnail', variant: 'thumb' }))
  })

  it('cleans files no asset points to (trash keeps its own) and can clear everything; foreign files are never touched (P2-9, P2-10)', async () => {
    const { db, deps, pipe, base } = rig([imageFormat()])
    const keep = seedAsset(db, { path: 'keep.png', hash: 'sha256:01' })
    const trashed = seedAsset(db, { path: 'trashed.png', hash: 'sha256:02' })
    const gone = seedAsset(db, { path: 'gone.png', hash: 'sha256:03' })
    pipe.start()
    for (const id of [keep, trashed, gone]) pipe.enqueue(id, 'all')
    await pipe.idle()
    const cacheDir = path.join(base, 'library', '.bowerbird', 'cache')
    const put = (rel: string, ageMs = 0): string => {
      const f = path.join(cacheDir, rel)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, 'x')
      if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(f, t, t) }
      return f
    }
    const k = (hash: string, variant = 'thumb') => cacheKey({ hash, refs: [], plugin: 'bowerbird.image', version: '1.0.0', stage: 'thumbnail', variant })
    const at = (key: string) => `thumbnail/${key.slice(0, 2)}/${key}.webp`
    // An old render of a previous content (old enough to judge), an unknown one just synced (too young), foreign files.
    const oldContent = put(at(k('sha256:00')), 2 * 3_600_000)
    const youngUnknown = put(at(k('sha256:99')))
    const foreign = [put('README.txt', 2 * 3_600_000), put('thumbnail/custom/x.png', 2 * 3_600_000), put('mine/notes.md', 2 * 3_600_000)]
    // Synced from another machine for keep's current content, not registered here: kept and adopted.
    const syncedPoster = put(at(k('sha256:01', 'poster')), 2 * 3_600_000)
    db.prepare('DELETE FROM assets WHERE id IN (?, ?)').run(trashed, gone)
    seedTrash(db, { assetId: trashed, name: 'trashed.png', originalPath: 'trashed.png' })
    const goneThumb = pipe.thumbnailFile(gone, 'thumb')!
    const before = await pipe.cacheStats()
    expect(before).toMatchObject({ files: 12, dir: cacheDir, inLibrary: true })
    const r = await pipe.cleanCache(false)
    expect(r.removedFiles).toBe(3) // gone's thumb + preview, the old content
    expect(fs.existsSync(goneThumb)).toBe(false)
    expect(fs.existsSync(oldContent)).toBe(false)
    expect(fs.existsSync(youngUnknown)).toBe(true)
    expect(foreign.every(f => fs.existsSync(f))).toBe(true)
    expect(fs.existsSync(syncedPoster)).toBe(true)
    expect(pipe.thumbnailFile(keep, 'poster')).toBe(syncedPoster)
    expect(pipe.thumbnailFile(keep, 'thumb')).not.toBeNull()
    expect(pipe.thumbnailFile(trashed, 'thumb')).not.toBeNull()

    const all = await pipe.cleanCache(true)
    expect(all.removedFiles).toBe(6) // keep ×3 (thumb, preview, synced poster), trashed ×2, the young unknown
    expect(foreign.every(f => fs.existsSync(f))).toBe(true)
    expect([syncedPoster, youngUnknown].some(f => fs.existsSync(f))).toBe(false)
    expect(deps.calls.filter(c => c.fn === 'setThumbState' && c.id === keep).map(c => c.args)).toEqual([['pending']])
    await pipe.idle()
    expect(pipe.thumbnailFile(keep, 'thumb')).not.toBeNull()
  })

  it('writes and removes cache files through the library handle when it offers that (P2-13)', async () => {
    const db = openMemoryIndexDb()
    const base = tmp()
    const handle = fakeHandle(base)
    const io: string[] = []
    Object.assign(handle, {
      cacheFiles: {
        async write(abs: string, data: Uint8Array) { io.push(`w ${path.basename(abs)}`); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, data) },
        async remove(abs: string) { io.push(`rm ${path.basename(abs)}`); fs.rmSync(abs, { force: true }) }
      }
    })
    const plugins = pluginsWith([imageFormat()])
    const pipe = createPipelineImpl({ db, library: handle, plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps: new FakeDeps(db), events: createEventBus(), log: silentLogger, cleanIntervalMs: 0 })
    rigs.push(pipe)
    const a = seedAsset(db, { path: 'a.png', hash: 'sha256:aa' })
    pipe.start()
    pipe.enqueue(a, 'all')
    await pipe.idle()
    expect(io.filter(x => x.startsWith('w '))).toHaveLength(2)
    db.prepare('DELETE FROM assets WHERE id = ?').run(a)
    await pipe.cleanCache(false)
    expect(io.filter(x => x.startsWith('rm '))).toHaveLength(2)
  })

  it('cleanup keeps plugins\' own cache files of current content, removes stale and orphaned ones', async () => {
    const { db, pipe, base } = rig([imageFormat()])
    const a = seedAsset(db, { path: 'a.png', hash: 'sha256:abcdef0123' })
    const t = seedAsset(db, { path: 't.png', hash: 'sha256:1111111111' })
    db.prepare('DELETE FROM assets WHERE id = ?').run(t)
    seedTrash(db, { assetId: t, name: 't.png', originalPath: 't.png' })
    const cacheDir = path.join(base, 'library', '.bowerbird', 'cache')
    const write = (rel: string): string => {
      const f = path.join(cacheDir, rel)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, 'x')
      const t = new Date(Date.now() - 2 * 3_600_000)
      fs.utimesSync(f, t, t)
      return f
    }
    const current = write(`derive/plugins/bowerbird.image/${a}-abcdef01/frames.bin`)
    const stale = write(`derive/plugins/bowerbird.image/${a}-99999999/frames.bin`)
    const inTrash = write(`derive/plugins/bowerbird.image/${t}-11111111/frames.bin`)
    const orphan = write('derive/plugins/bowerbird.image/00000000-0000-7000-8000-00000000dead-12345678/frames.bin')
    const r = await pipe.cleanCache(false)
    expect(r.removedFiles).toBe(2)
    expect([current, stale, inTrash, orphan].map(f => fs.existsSync(f))).toEqual([true, false, true, false])
  })
})

describe('action jobs (K11) and slots', () => {
  const ctx = { actor: 'user:lin', isLocal: true }

  it('runs a plugin action on a selection as an action job; outputs registered by the kernel, sharing one record', async () => {
    const seen: string[][] = []
    const action: Action = {
      id: 'slice', title: '切图',
      appliesTo: sel => sel.every(a => a.format === 'image'),
      run: async (sel, params) => {
        seen.push(sel.map(a => a.name))
        expect(params).toEqual({ grid: 2 })
        return {
          message: '切出 2 张',
          assets: [
            { file: { kind: 'bytes', data: new Uint8Array([1]), name: 'a_1.png' }, record: { method: 'slice', params: { rect: [0, 0, 1, 1] } } },
            { file: { kind: 'bytes', data: new Uint8Array([2]), name: 'a_2.png' } }
          ]
        }
      }
    }
    const plugins = pluginsWith([imageFormat()], { actions: () => [{ pluginId: 'studio.tools', action }] })
    const { db, deps, pipe, events } = rig([], { plugins })
    const a = seedAsset(db, { path: 'a.png', format: 'image', plugin: 'bowerbird.image' })
    const doc = seedAsset(db, { path: 'b.md', format: 'doc' })
    pipe.start()
    const job = await pipe.startAction('studio.tools:slice', { ids: [a], params: { grid: 2 } }, ctx)
    expect(job).toMatchObject({ kind: 'action', actionId: 'studio.tools:slice', creatorName: '切图', pluginId: 'studio.tools', by: 'user:lin' })
    await pipe.idle()
    const done = pipe.job(job.id)!
    expect(done).toMatchObject({ status: 'done', message: '切出 2 张', progress: 1 })
    expect(done.outputs).toHaveLength(2)
    expect(seen).toEqual([['a.png']])
    expect(deps.registered[0]!.req.record).toMatchObject({ method: 'slice' })
    expect(deps.registered[1]!.req.record).toBe('rec_1')
    expect(deps.registered[1]!.ctx).toMatchObject({ actor: 'user:lin', pluginId: 'studio.tools', recordId: 'rec_1' })
    expect(pipe.overview().creates.map(c => c.id)).toContain(job.id)
    expect(events.history.some(e => e.type === 'job.updated' && (e.data as JobInfo).kind === 'action')).toBe(true)
    // Bare id when unique; not applicable or unknown selections are refused.
    await expect(pipe.startAction('slice', { ids: [doc] }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(pipe.startAction('nope', { ids: [a] }, ctx)).rejects.toMatchObject({ code: 'not_found' })
    await expect(pipe.startAction('slice', { ids: [gid(99999)] }, ctx)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a failing action fails its job (retryable by hand); cancel aborts the signal', async () => {
    let n = 0
    let aborted = false
    const action: Action = {
      id: 'x', title: 'X', appliesTo: () => true,
      run: async (_s, _p, c) => {
        if (n++ === 0) throw new Error('工具崩溃')
        await new Promise<void>(r => c.signal.addEventListener('abort', () => { aborted = true; r() }))
        return {}
      }
    }
    const plugins = pluginsWith([], { actions: () => [{ pluginId: 'p', action }] })
    const { db, pipe } = rig([], { plugins })
    const a = seedAsset(db, { path: 'a.png' })
    pipe.start()
    const j = await pipe.startAction('p:x', { ids: [a] }, ctx)
    await pipe.idle()
    expect(pipe.job(j.id)).toMatchObject({ status: 'failed', error: '工具崩溃', retryable: true })
    pipe.retry({ jobIds: [j.id] })
    await new Promise(r => setTimeout(r, 5))
    expect(pipe.job(j.id)!.status).toBe('running')
    pipe.cancel(j.id)
    await pipe.idle()
    expect(aborted).toBe(true)
    expect(pipe.job(j.id)!.status).toBe('cancelled')
  })

  it('a creation waiting for the user (Forge「挑选」) never takes a processing slot (K7)', async () => {
    let release!: () => void
    const waiting = new Promise<void>(r => { release = r })
    const creator: Creator = { id: 'gen', displayName: 'Gen', params: {}, inputs: [], run: async (_r, job) => { job.progress(0.9, '挑选', { label: '挑选…', page: 'pick' }); await waiting } }
    const plugins = pluginsWith([imageFormat()], { creatorsList: [{ pluginId: 'f', pluginName: 'F', pluginVersion: '1', creator }] })
    const { db, pipe } = rig([], { plugins, concurrency: 1 })
    pipe.start()
    const j = await pipe.startCreate('f:gen', { params: {}, inputs: [] }, ctx)
    const ids = [seedAsset(db, { path: 'a.png' }), seedAsset(db, { path: 'b.png' })]
    for (const id of ids) pipe.enqueue(id, 'all')
    for (let i = 0; i < 200 && ids.some(id => jobsOf(db, id).index !== 'skipped'); i++) await new Promise(r => setTimeout(r, 5))
    for (const id of ids) expect(jobsOf(db, id)).toMatchObject({ thumbnail: 'done', index: 'skipped' })
    expect(pipe.job(j.id)!.status).toBe('running')
    release()
    await pipe.idle()
    expect(pipe.job(j.id)!.status).toBe('done')
  })
})

describe('machine config, rate limits, plugin changes, scheduled cleanup', () => {
  it('takes its concurrency from the machine config', async () => {
    let active = 0
    let peak = 0
    const slow = async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active--; return { tech: {} } }
    const plugins = pluginsWith([imageFormat({ probe: slow as never })], { machineConfig: () => ({ concurrency: 1 }) as never } as never)
    const db = openMemoryIndexDb()
    const pipe = createPipelineImpl({ db, library: fakeHandle(tmp()), plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps: new FakeDeps(db), events: createEventBus(), log: silentLogger, cleanIntervalMs: 0 })
    rigs.push(pipe)
    rigDbs.set(pipe, db)
    for (let i = 0; i < 4; i++) pipe.enqueue(seedAsset(db, { path: `c${i}.png` }), ['identify', 'probe'])
    pipe.start()
    await pipe.idle()
    expect(peak).toBe(1)
  })

  it('starts calls of a plugin with a manifest rateLimit at most that often; waiting jobs do not fail', async () => {
    const calls: number[] = []
    const plugins = pluginsWith([imageFormat()], {
      enrichers: () => [{ pluginId: 'ai.tagger', enricher: { id: 'tags', appliesTo: () => true, enrich: async () => { calls.push(Date.now()); return { tags: ['x'] } } } }],
      rateLimit: (id: string) => (id === 'ai.tagger' ? 2 : null)
    } as never)
    const db = openMemoryIndexDb()
    const deps = new FakeDeps(db)
    const pipe = createPipelineImpl({ db, library: fakeHandle(tmp()), plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps, events: createEventBus(), log: silentLogger, cleanIntervalMs: 0, rateWindowMs: 300, concurrency: 4 })
    rigs.push(pipe)
    rigDbs.set(pipe, db)
    const ids = Array.from({ length: 5 }, (_, i) => seedAsset(db, { path: `r${i}.png` }))
    for (const id of ids) pipe.enqueue(id, ['identify', 'enrich'])
    pipe.start()
    await pipe.idle()
    expect(calls).toHaveLength(5)
    // never more than 2 starts in any 300 ms window
    for (let i = 2; i < calls.length; i++) expect(calls[i]! - calls[i - 2]!).toBeGreaterThanOrEqual(290)
    for (const id of ids) expect(jobsOf(db, id).enrich).toBe('done')
    expect(deps.issues).toEqual([])
  })

  it('a creation of a rate-limited plugin waits for its slot', async () => {
    const starts: number[] = []
    const creator: Creator = { id: 'gen', displayName: 'Gen', params: {}, inputs: [], run: async () => { starts.push(Date.now()) } }
    const plugins = pluginsWith([], { creatorsList: [{ pluginId: 'ai.gen', pluginName: 'Gen', pluginVersion: '1', creator }], rateLimit: () => 1 } as never)
    const db = openMemoryIndexDb()
    const pipe = createPipelineImpl({ db, library: fakeHandle(tmp()), plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps: new FakeDeps(db), events: createEventBus(), log: silentLogger, cleanIntervalMs: 0, rateWindowMs: 200 })
    rigs.push(pipe)
    rigDbs.set(pipe, db)
    pipe.start()
    await pipe.startCreate('ai.gen:gen', { params: {}, inputs: [] }, { actor: 'user:lin', isLocal: true })
    await pipe.startCreate('ai.gen:gen', { params: {}, inputs: [] }, { actor: 'user:lin', isLocal: true })
    await pipe.idle()
    expect(starts).toHaveLength(2)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(190)
  })

  it('a newly enabled enricher, validator or search provider is run for existing assets; a plugin update redoes its stages', async () => {
    let listener: ((c: { started: string[]; stopped: string[] }) => void) | null = null
    let withEnricher = false
    let version = '1.0.0'
    const enriched: string[] = []
    const formats = (): FormatDef[] => [{ ...imageFormat(), version }]
    const base = pluginsWith(formats())
    const plugins = Object.assign(base, {
      enrichers: () => (withEnricher ? [{ pluginId: 'ai.tagger', enricher: { id: 't', appliesTo: () => true, enrich: async (f: { id: string }) => { enriched.push(f.id); return {} } } }] : []),
      enabled: () => [{ id: 'bowerbird.image', version, displayName: 'img' }, ...(withEnricher ? [{ id: 'ai.tagger', version: '1.0.0', displayName: 'AI' }] : [])],
      formats: () => pluginsWith(formats()).formats(),
      format: (id: string) => pluginsWith(formats()).format(id),
      identify: (f: Parameters<LibraryPlugins['identify']>[0]) => pluginsWith(formats()).identify(f),
      onChange: (l: typeof listener) => { listener = l; return () => { listener = null } }
    })
    const { db, pipe } = rig([], { plugins })
    const ids = [seedAsset(db, { path: 'e1.png' }), seedAsset(db, { path: 'e2.png' })]
    pipe.start()
    for (const id of ids) pipe.enqueue(id, 'all')
    await pipe.idle()
    expect(enriched).toEqual([])
    withEnricher = true
    listener!({ started: ['ai.tagger'], stopped: [] })
    await pipe.idle()
    expect(enriched.sort()).toEqual([...ids].sort())
    // The format plugin is updated while running: the stages it ran are redone.
    const before = db.prepare("SELECT COUNT(*) FROM pipeline_stages WHERE plugin = 'bowerbird.image@1.0.0'").pluck().get() as number
    expect(before).toBeGreaterThan(0)
    version = '1.1.0'
    listener!({ started: ['bowerbird.image'], stopped: ['bowerbird.image'] })
    await pipe.idle()
    expect(db.prepare("SELECT COUNT(*) FROM pipeline_stages WHERE plugin = 'bowerbird.image@1.0.0'").pluck().get()).toBe(0)
  })

  it('a browser error without `retryable` counts as retryable (retried automatically)', async () => {
    const model: FormatDef = { id: 'model', ext: ['.glb'], thumbnail: 'browser' }
    const { db, pipe } = rig([model])
    const a = seedAsset(db, { path: 'a.glb' })
    pipe.start()
    pipe.enqueue(a, ['identify', 'thumbnail'])
    await pipe.idle()
    let t = await pipe.renderNext([a])
    while (t && t.kind !== 'thumbnail') t = await pipe.renderNext([a])
    await pipe.renderSubmit(t!.job, {}, { error: '没有 WebGL' })
    expect(pipe.job(t!.job)).toMatchObject({ status: 'waiting-renderer', attempts: 1, error: '没有 WebGL', retryable: true })
  })

  it('cleans the cache once the start-up scan is done, then daily', async () => {
    const db = openMemoryIndexDb()
    const base = tmp()
    const events = createEventBus()
    const plugins = pluginsWith([imageFormat()])
    const pipe = createPipelineImpl({ db, library: fakeHandle(base), plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps: new FakeDeps(db), events, log: silentLogger, cleanIntervalMs: 86_400_000 })
    rigs.push(pipe)
    rigDbs.set(pipe, db)
    const k = cacheKey({ hash: 'sha256:dead', refs: [], plugin: 'p', version: '1', stage: 'thumbnail', variant: 'thumb' })
    const stale = path.join(base, 'library', '.bowerbird', 'cache', 'thumbnail', k.slice(0, 2), `${k}.webp`)
    fs.mkdirSync(path.dirname(stale), { recursive: true })
    fs.writeFileSync(stale, 'x')
    const old = new Date(Date.now() - 3 * 86_400_000)
    fs.utimesSync(stale, old, old)
    pipe.start()
    events.emit('lib1', 'scan.progress', { running: true, phase: 'walking', done: 0, total: 0 })
    await new Promise(r => setTimeout(r, 30))
    expect(fs.existsSync(stale)).toBe(true)
    events.emit('lib1', 'scan.progress', { running: false, phase: 'done', done: 0, total: 0 })
    for (let i = 0; i < 100 && fs.existsSync(stale); i++) await new Promise(r => setTimeout(r, 10))
    expect(fs.existsSync(stale)).toBe(false)
  })
})

describe('design objects and folded failures (e2e-b findings)', () => {
  it('a design object whose content changed re-checks the assets that belong to it', async () => {
    const checked: string[] = []
    const plugins = pluginsWith([
      { id: 'doc', ext: ['.md'], thumbnail: 'none', handler: { probe: async () => ({ tech: { targetW: 1.26 } }) } },
      { id: 'model', ext: ['.glb'], thumbnail: 'none', handler: { probe: async () => ({ tech: {} }) } }
    ], {
      validators: () => [{ pluginId: 'bowerbird.model', validator: { id: 'size', appliesTo: a => a.format === 'model', check: async f => { checked.push(f.name); return [] } } }]
    })
    const { db, pipe } = rig([], { plugins })
    const doc = seedAsset(db, { path: 'chest/chest.md', hash: 'sha256:d1' })
    const glb = seedAsset(db, { path: 'chest/chest.glb' })
    const other = seedAsset(db, { path: 'other.glb' })
    seedRelation(db, glb, 'belongs', doc)
    pipe.start()
    for (const id of [doc, glb, other]) pipe.enqueue(id, 'all')
    await pipe.idle()
    expect(checked.sort()).toEqual(['chest.glb', 'other.glb'])
    // The document is replaced (new target size in its front matter): the kernel re-queues it like any content change.
    db.prepare("UPDATE assets SET hash = 'sha256:d2' WHERE id = ?").run(doc)
    pipe.enqueue(doc, 'all')
    await pipe.idle()
    expect(checked.sort()).toEqual(['chest.glb', 'chest.glb', 'other.glb'])
  })

  it('a stage failing for the same cause as an earlier one of the same asset raises no second issue', async () => {
    const video: FormatDef = { id: 'video', ext: ['.mov'], thumbnail: 'browser' }
    const { db, deps, pipe } = rig([video])
    const mov = seedAsset(db, { path: 'intro_cutscene.mov' })
    pipe.start()
    pipe.enqueue(mov, ['identify', 'thumbnail', 'summary'])
    await pipe.idle()
    const why = '这台电脑的浏览器放不了这种视频（ProRes 4444）'
    const thumb = (await pipe.renderNext([mov]))!
    expect(thumb.kind).toBe('thumbnail')
    await pipe.renderSubmit(thumb.job, {}, { error: why, retryable: false })
    const summary = (await pipe.renderNext([mov]))!
    expect(summary.kind).toBe('summary')
    await pipe.renderSubmit(summary.job, {}, { error: why, retryable: false })
    expect(pipe.job(summary.job)).toMatchObject({ status: 'failed', error: why })
    expect(deps.issues.filter(i => i.error)).toEqual([{ id: mov, stage: 'thumbnail', error: why }])
    // A different cause on another asset or stage is reported on its own.
    const other = seedAsset(db, { path: 'b.mov' })
    pipe.enqueue(other, ['identify', 'thumbnail', 'summary'])
    await pipe.idle()
    const t2 = (await pipe.renderNext([other]))!
    await pipe.renderSubmit(t2.job, {}, { error: why, retryable: false })
    const s2 = (await pipe.renderNext([other]))!
    await pipe.renderSubmit(s2.job, {}, { error: '解码器崩溃', retryable: false })
    expect(deps.issues.filter(i => i.id === other && i.error).map(i => i.stage)).toEqual(['thumbnail', 'summary'])
    // When the first failure goes away, the one folded into it is reported then.
    pipe.retry({ jobIds: [thumb.job] })
    await pipe.idle()
    const again = (await pipe.renderNext([mov]))!
    expect(again.job).toBe(thumb.job)
    await pipe.renderSubmit(again.job, { thumb: webp('ok') }, {})
    expect(deps.issues.filter(i => i.id === mov)).toEqual([
      { id: mov, stage: 'thumbnail', error: why },
      { id: mov, stage: 'thumbnail', error: null },
      { id: mov, stage: 'summary', error: why }
    ])
  })
})

describe('creation jobs (ADR-016, ADR-042)', () => {
  function creatorRig(run: Creator['run'], inputs: Creator['inputs'] = []) {
    const creator: Creator = { id: 'image', displayName: 'AI 生图', params: { type: 'object' }, inputs, run }
    const plugins = pluginsWith([], { creatorsList: [{ pluginId: 'community.forge', pluginName: 'Forge', pluginVersion: '0.4.0', creator }] })
    return rig([], { plugins })
  }
  const ctx = { actor: 'agent:painter', isLocal: true }

  it('reports progress with a follow-up action and registers several outputs under one record', async () => {
    let gate!: () => void
    const wait = new Promise<void>(r => { gate = r })
    const { db, deps, pipe, events } = creatorRig(async (req, job) => {
      job.progress(0.5, '生成中', { label: '挑选…', page: 'pick', params: { job: job.id } })
      await wait
      const a = await job.register({ file: { kind: 'bytes', data: new Uint8Array([1]), name: 'forge_1.png' }, record: { method: 'community.forge/image', prompt: 'a red chest' }, tags: ['AI'] })
      const b = await job.register({ file: { kind: 'bytes', data: new Uint8Array([2]), name: 'forge_2.png' } })
      expect(a.id).not.toBe(b.id)
      expect(req.actor).toBe('agent:painter')
      expect(req.inputs.map(i => [i.role, i.asset.name])).toEqual([['reference', 'ref.png']])
    }, [{ role: 'reference', formats: ['image'], required: true }])
    const ref = seedAsset(db, { path: 'ref.png' })
    pipe.start()
    const job = await pipe.startCreate('community.forge:image', { params: { prompt: 'a red chest', seed: 7 }, inputs: [{ role: 'reference', id: ref }], folder: 'gen' }, ctx)
    expect(job).toMatchObject({ kind: 'create', status: 'running', creator: 'community.forge:image', creatorName: 'AI 生图', pluginId: 'community.forge', by: 'agent:painter' })
    await new Promise(r => setTimeout(r, 5))
    expect(pipe.job(job.id)).toMatchObject({ progress: 0.5, message: '生成中', action: { label: '挑选…', page: 'pick', params: { job: job.id } } })
    gate()
    await pipe.idle()
    const done = pipe.job(job.id)!
    expect(done).toMatchObject({ status: 'done', progress: 1 })
    expect(done.outputs).toHaveLength(2)
    expect(deps.registered).toHaveLength(2)
    expect(deps.registered[0]!.ctx).toEqual({ actor: 'agent:painter', pluginId: 'community.forge', pluginVersion: '0.4.0' })
    expect(deps.registered[0]!.req.record).toMatchObject({ method: 'community.forge/image', prompt: 'a red chest', inputs: [{ id: ref, role: 'reference' }] })
    expect(deps.registered[1]!.ctx.recordId).toBe('rec_1')
    expect(deps.registered[1]!.req.record).toBe('rec_1')
    expect(deps.records).toBe(1)
    expect(events.history.filter(e => e.type === 'job.updated' && (e.data as JobInfo).id === job.id).length).toBeGreaterThanOrEqual(4)
    expect(pipe.overview().creates.map(c => c.id)).toEqual([job.id])
  })

  it('a run without outputs writes no record; a run without record input gets the default record', async () => {
    const empty = creatorRig(async job => { void job })
    empty.pipe.start()
    const j = await empty.pipe.startCreate('image', { params: {}, inputs: [] }, ctx)
    await empty.pipe.idle()
    expect(empty.pipe.job(j.id)!.status).toBe('done')
    expect(empty.deps.registered).toHaveLength(0)
    expect(empty.deps.records).toBe(0)

    const plain = creatorRig(async (_req, job) => { await job.register({ file: { kind: 'bytes', data: new Uint8Array([1]), name: 'x.png' } }) })
    plain.pipe.start()
    await plain.pipe.startCreate('community.forge:image', { params: { seed: 1 }, inputs: [] }, ctx)
    await plain.pipe.idle()
    expect(plain.deps.registered[0]!.req.record).toEqual({ method: 'community.forge/image', params: { seed: 1 } })
  })

  it('cancels through the abort signal; later registrations are refused', async () => {
    let registerAfterCancel: Promise<unknown> | null = null
    const { deps, pipe } = creatorRig(async (_req, job: JobContext) => {
      await new Promise<void>(resolve => job.signal.addEventListener('abort', () => resolve()))
      registerAfterCancel = job.register({ file: { kind: 'bytes', data: new Uint8Array([1]), name: 'late.png' } })
      await registerAfterCancel.catch(() => {})
    })
    pipe.start()
    const j = await pipe.startCreate('community.forge:image', { params: {}, inputs: [] }, ctx)
    pipe.cancel(j.id)
    await pipe.idle()
    expect(pipe.job(j.id)!.status).toBe('cancelled')
    await expect(registerAfterCancel).rejects.toMatchObject({ code: 'conflict' })
    expect(deps.registered).toHaveLength(0)
  })

  it('a failing run is failed (not retried automatically); a manual retry runs it again', async () => {
    let n = 0
    const { pipe } = creatorRig(async () => { if (n++ === 0) throw new Error('服务没有响应（503）') })
    pipe.start()
    const j = await pipe.startCreate('community.forge:image', { params: { a: 1 }, inputs: [] }, ctx)
    await pipe.idle()
    expect(pipe.job(j.id)).toMatchObject({ status: 'failed', error: '服务没有响应（503）', retryable: true })
    expect(pipe.overview().failed.map(f => f.id)).toContain(j.id)
    pipe.retry({ jobIds: [j.id] })
    await pipe.idle()
    expect(pipe.job(j.id)).toMatchObject({ status: 'done', attempts: 1 })
    expect(n).toBe(2)
  })

  it('validates the creator and its inputs', async () => {
    const { pipe } = creatorRig(async () => {}, [{ role: 'reference', required: true }])
    await expect(pipe.startCreate('nope', { params: {}, inputs: [] }, ctx)).rejects.toMatchObject({ code: 'not_found' })
    await expect(pipe.startCreate('community.forge:image', { params: {}, inputs: [] }, ctx)).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(pipe.startCreate('community.forge:image', { params: {}, inputs: [{ role: 'reference', id: '00000000-0000-7000-8000-0000000fffff' }] }, ctx)).rejects.toMatchObject({ code: 'not_found' })
    expect(() => pipe.cancel('missing')).toThrow()
  })

  it('the factory exported for the hub builds a working pipeline', async () => {
    const db = openMemoryIndexDb()
    const plugins = pluginsWith([imageFormat()])
    const p = createPipeline({ db, library: fakeHandle(tmp()), plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps: new FakeDeps(db), events: createEventBus(), log: silentLogger })
    const id = seedAsset(db, { path: 'x.png' })
    p.start()
    p.enqueue(id, 'all')
    await p.idle()
    expect(jobsOf(db, id).thumbnail).toBe('done')
    await p.stop()
  })
})
