/**
 * Job queue at the size of a 100 000-asset first open (~800 000 process jobs): overview() — called by `/jobs` and the
 * toolbar's background-work indicator — stays under 50 ms, and its counts stay exact while jobs move.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PIPELINE_STAGES } from '@bowerbird/schema'
import { openIndexDb } from '../../index/db.js'
import { createQueryEngine } from '../../index/query.js'
import { createEventBus } from '../../events.js'
import { silentLogger } from '../../log.js'
import type { IndexDb } from '../../contracts.js'
import { createPipelineImpl, type PipelineImpl } from '../pipeline.js'
import { FakeDeps, fakeHandle, pluginsWith } from './fakes.js'

const ASSETS = 100_000
const OVERVIEW_MS = 50

function gid(n: number): string { return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}` }

describe(`job queue benchmark (${ASSETS.toLocaleString()} assets × 8 stages)`, () => {
  let dir: string
  let db: IndexDb
  let pipe: PipelineImpl

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-jobs-bench-'))
    db = openIndexDb(path.join(dir, 'index.sqlite')).db
    const asset = db.prepare(`INSERT INTO assets (id, path, folder, name, stem, ext, format, hash, stage, review, created_at, created_by, modified_at, meta_json)
      VALUES (?, ?, '', ?, ?, '.png', 'image', ?, 'production', 'pending', 'x', 'user:a', 'x', '{}')`)
    const job = db.prepare(`INSERT INTO jobs (id, kind, asset_id, stage, status, priority, attempts, error, created_at, updated_at)
      VALUES (?, 'process', ?, ?, ?, 0, ?, ?, ?, ?)`)
    const t = performance.now()
    db.transaction(() => {
      for (let i = 0; i < ASSETS; i++) {
        const id = gid(i + 1)
        asset.run(id, `a${i}.png`, `a${i}.png`, `a${i}`, `sha256:${i.toString(16)}`)
        PIPELINE_STAGES.forEach((stage, s) => {
          // a first open in progress: early assets done, a few failed or waiting for a browser, the rest queued
          const status = i < 20_000 ? (s === 3 && i % 10 === 0 ? 'waiting-renderer' : 'done') : i < 20_500 && s === 1 ? 'failed' : 'queued'
          const at = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()
          job.run(`j${i}-${s}`, id, stage, status, status === 'failed' ? 4 : 0, status === 'failed' ? '读取超时' : null, at, at)
        })
      }
    })()
    console.log(`[bench] ${ASSETS * 8} jobs written in ${(performance.now() - t).toFixed(0)} ms`)
    const plugins = pluginsWith([{ id: 'image', ext: ['.png'], handler: { probe: async () => ({ tech: {} }) } }])
    const t2 = performance.now()
    pipe = createPipelineImpl({ db, library: fakeHandle(dir), plugins, query: createQueryEngine({ db, plugins, thumbnailUrl: () => null, log: silentLogger }), deps: new FakeDeps(db), events: createEventBus(), log: silentLogger, cleanIntervalMs: 0 })
    console.log(`[bench] pipeline created (queue counters built) in ${(performance.now() - t2).toFixed(0)} ms`)
  }, 300_000)

  afterAll(async () => {
    await pipe.stop()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function exact(): { stages: Record<string, Record<string, number>>; busy: number; waiting: number } {
    const stages: Record<string, Record<string, number>> = {}
    for (const r of db.prepare("SELECT stage, status, COUNT(*) AS n FROM jobs WHERE kind = 'process' GROUP BY stage, status").all() as Array<{ stage: string; status: string; n: number }>) {
      (stages[r.stage] ??= {})[r.status] = r.n
    }
    const busy = db.prepare("SELECT COUNT(DISTINCT asset_id) FROM jobs WHERE kind = 'process' AND status IN ('queued', 'running')").pluck().get() as number
    const waiting = db.prepare("SELECT COUNT(DISTINCT asset_id) FROM jobs WHERE kind = 'process' AND status = 'waiting-renderer'").pluck().get() as number
    return { stages, busy, waiting }
  }

  function check(): void {
    const ov = pipe.overview()
    const e = exact()
    for (const s of ov.stages) {
      const x = e.stages[s.stage] ?? {}
      expect({ q: s.queued, r: s.running, d: s.done, f: s.failed, k: s.skipped }).toEqual({ q: x.queued ?? 0, r: x.running ?? 0, d: x.done ?? 0, f: x.failed ?? 0, k: x.skipped ?? 0 })
    }
    expect(ov.busy).toBe(e.busy)
    expect(ov.waitingRender).toBe(e.waiting)
  }

  it('overview() stays under 50 ms', () => {
    pipe.overview()
    const runs: number[] = []
    for (let i = 0; i < 5; i++) { const t = performance.now(); pipe.overview(); runs.push(performance.now() - t) }
    const ms = runs.sort((a, b) => a - b)[2]!
    console.log(`[bench] overview() with ${ASSETS * 8} jobs: ${ms.toFixed(1)} ms (target ${OVERVIEW_MS})`)
    expect(ms).toBeLessThan(OVERVIEW_MS)
    const ov = pipe.overview()
    expect(ov.failed.length).toBeLessThanOrEqual(200)
    expect(ov.busy).toBe(80_000)
    check()
  })

  it('enqueue returns at once and overview() stays fast with a first open\'s whole backlog not yet written', () => {
    // New assets (a first open): they have no jobs yet.
    const add = db.prepare(`INSERT INTO assets (id, path, folder, name, stem, ext, format, hash, stage, review, created_at, created_by, modified_at, meta_json)
      VALUES (?, ?, '', ?, ?, '.png', 'image', ?, 'production', 'pending', 'x', 'user:a', 'x', '{}')`)
    db.transaction(() => { for (let i = 0; i < ASSETS; i++) add.run(gid(ASSETS + i + 1), `n${i}.png`, `n${i}.png`, `n${i}`, `sha256:f${i.toString(16)}`) })()
    const t = performance.now()
    for (let i = 0; i < ASSETS; i++) pipe.enqueue(gid(ASSETS + i + 1), 'all', { reason: 'scan' })
    const enqueueMs = performance.now() - t
    const t2 = performance.now()
    const ov = pipe.overview()
    const ms = performance.now() - t2
    console.log(`[bench] enqueue of ${ASSETS} assets: ${enqueueMs.toFixed(0)} ms; overview() with them pending: ${ms.toFixed(1)} ms`)
    expect(enqueueMs).toBeLessThan(2000) // 100 000 calls: ~20 ms idle, a few hundred under a loaded CI machine
    expect(ms).toBeLessThan(OVERVIEW_MS * 2)
    expect(ov.stages.find(s => s.stage === 'identify')!.queued).toBeGreaterThanOrEqual(ASSETS)
    const t3 = performance.now()
    pipe.retry({}) // writes the whole backlog at once (the pump does it 500 assets per turn)
    const flushMs = performance.now() - t3
    console.log(`[bench] writing ${ASSETS * 8} new jobs: ${flushMs.toFixed(0)} ms (${(flushMs / (ASSETS / 500)).toFixed(1)} ms per pump turn of 500 assets)`)
    // ~15 ms per turn on an idle machine; the margin keeps a loaded CI machine from flaking.
    expect(flushMs / (ASSETS / 500)).toBeLessThan(OVERVIEW_MS * 3)
  })

  it('counts stay exact while jobs move (enqueue, retry, cancel, forget, run)', async () => {
    pipe.enqueue(gid(5), 'all')
    pipe.retry({ failed: true })
    pipe.cancel('j30000-2')
    pipe.forget(gid(30001))
    db.prepare("DELETE FROM assets WHERE id = ?").run(gid(30002))
    check()
    // Let the queue run a little with the real scheduler.
    pipe.start()
    await new Promise(r => setTimeout(r, 300))
    await pipe.stop()
    check()
    const t = performance.now()
    pipe.overview()
    console.log(`[bench] overview() after the queue ran: ${(performance.now() - t).toFixed(1)} ms`)
  })
})
