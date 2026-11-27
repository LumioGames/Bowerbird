/**
 * The processing pipeline and the job queue (pipeline-and-cache.md, ADR-008/016/025/042).
 *
 * A process job is one stage of one asset. Stages of an asset run in order (identify → probe → derive → thumbnail →
 * summary → enrich → validate → index), one at a time; a stage nobody handles is `skipped`. Formats whose thumbnails
 * are rendered by a browser park the thumbnail and summary jobs in `waiting-renderer` until a page claims them.
 * Failures retry three times with growing delays, then stay `failed` and raise a pipeline-failed issue. Create jobs
 * run a creator plugin; its outputs go through the kernel's registration and share one batch of provenance (ADR-070).
 */
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { v7 as uuidv7 } from 'uuid'
import {
  PIPELINE_STAGES, THUMB_VARIANTS, type AssetSummary, type CacheCleanResponse, type CacheResponse, type CheckView, type Guid,
  type JobAction, type JobInfo, type JobsResponse, type PipelineStage, type ProvenanceInput, type RenderTask, type StageStats,
  type ThumbVariant
} from '@bowerbird/schema'
import type { Action, AssetFile, AssetInfo, CreateRequest, JobContext, ProbeResult, RegisterRequest } from '@bowerbird/plugin-sdk'
import {
  CoreError, type CallContext, type CreatorEntry, type LoadedFormat, type Pipeline, type PipelineOptions, type StoredThumb
} from '../contracts.js'
import { CacheStore, cacheKey, directCacheIo, extFor, type CacheIo, type KeyOwner } from './cache.js'
import type { LibraryPluginsExtras } from '../plugins/library-plugins.js'
import { onProvidersCleared } from '../query/refeed.js'
import { JOB_LIST_INDEXES, PIPELINE_DDL, PRIORITY, stageIndex, stageOrderSql, toJobInfo, type JobRow } from './jobs.js'

export interface PipelineExtraOptions {
  /** Delays before the 1st, 2nd and 3rd automatic retry (ms). */
  retryDelays?: number[]
  /** How long a browser may hold a render task before another one gets it (ms). */
  renderLeaseMs?: number
  /** Periodic cache cleanup interval (ms); 0 disables it. Default one day. */
  cleanIntervalMs?: number
  /** The window a manifest `rateLimit` counts calls in (ms); one minute (tests shorten it). */
  rateWindowMs?: number
  /** Successful stages are announced at most once per this interval (ms), with the latest one; default 500. */
  completionEventMs?: number
}

/** The pipeline plus what the library service needs beyond the frozen interface. */
export interface PipelineImpl extends Pipeline {
  /** Server-made summary text (format plugin's summarize), if cached. */
  summaryText(assetId: Guid): Promise<string | null>
  /**
   * The agent summary image (api-and-agent.md「Agent 摘要」, K9): the summary render (`turnaround`: the model's
   * four-angle sheet, the video's key-frame strip — both come from the format's renderSummary), else `thumb`.
   * Never `scrub` (the image plugin keeps the hover animation there).
   */
  summaryImage(assetId: Guid): { variant: ThumbVariant; path: string } | null
  /** Run a plugin action on a selection as an `action` job (K11; plugin-system.md「动作」). */
  startAction(actionId: string, req: { ids: Guid[]; params?: unknown }, ctx: CallContext): Promise<JobInfo>
  yieldToScan(on: boolean): void
}

/** Optional LibraryHandle extension: the library module's writer for cache files inside the library (P2-13). */
export interface CacheFilesHandle { cacheFiles?: CacheIo }

const DEFAULT_RETRY_DELAYS = [2_000, 15_000, 60_000]
const MAX_RETRIES = 3
const DAY = 86_400_000
/** A manual cleanup still spares unknown files this young: they may belong to content synced but not scanned yet. */
const MANUAL_GRACE_MS = 10 * 60_000
const RATE_WINDOW_MS = 5 * 60_000
const RENDER_PARTS: readonly ThumbVariant[] = ['thumb', 'poster', 'scrub', 'turnaround', 'preview']

type Outcome =
  | { status: 'done' | 'skipped'; plugin?: string | null; refs?: string[] | null }
  | { status: 'waiting-renderer'; plugin?: string | null; refs?: string[] | null }
  | { status: 'gone' }

interface AssetRow {
  id: string; name: string; hash: string; format: string; plugin: string | null; ext: string; missing: number; auxiliary: number
  thumb_state: string; thumb_manual: number; aspect: number | null; badge: string | null
}

interface Enqueued { id: Guid; stages: PipelineStage[]; priority: number }

function errMessage(e: unknown): string { return e instanceof Error ? e.message : String(e) }
const now = (): string => new Date().toISOString()

const BACKLOG_REASONS = new Set(['scan', 'initialize', 'rebuild', 'backlog', 'stale', 'cache'])

export function createPipelineImpl(opts: PipelineOptions & PipelineExtraOptions): PipelineImpl {
  const { db, library, plugins, query, deps, events } = opts
  const log = opts.log.child('pipeline')
  /** Optional extras of the host's LibraryPlugins (machine config, rate limits, change notices); fakes may lack them. */
  const extras = plugins as typeof plugins & Partial<LibraryPluginsExtras>
  /** Local compute concurrency: the option, else the machine config's `concurrency`, else cores − 1 (read live). */
  const concurrencyNow = (): number => {
    let configured: number | undefined
    try { configured = extras.machineConfig?.().concurrency } catch { configured = undefined }
    return Math.max(1, opts.concurrency ?? configured ?? Math.max(1, os.cpus().length - 1))
  }
  const retryDelays = opts.retryDelays ?? DEFAULT_RETRY_DELAYS
  const leaseMs = opts.renderLeaseMs ?? 120_000
  const cleanInterval = opts.cleanIntervalMs ?? DAY
  const rateWindowMs = opts.rateWindowMs ?? 60_000
  const completionEventMs = opts.completionEventMs ?? 500
  const relCache = path.relative(library.paths.root, library.paths.cacheDir)
  const cacheInLibrary = !relCache.startsWith('..') && !path.isAbsolute(relCache)
  const handleIo = (library as typeof library & CacheFilesHandle).cacheFiles
  const cache = new CacheStore(db, library.paths.cacheDir, cacheInLibrary && handleIo ? handleIo : directCacheIo)
  db.exec(PIPELINE_DDL)
  db.exec(JOB_LIST_INDEXES)
  /** Prepared statements, reused: the queue runs a few statements per job, hundreds of thousands of times. */
  const statements = new Map<string, Database.Statement>()
  const prep = (sql: string): Database.Statement => {
    let st = statements.get(sql)
    if (!st) {
      if (statements.size > 400) statements.clear()
      st = db.prepare(sql)
      statements.set(sql, st)
    }
    return st.reader ? st.pluck(false) : st // pluck() is sticky on a statement: every use starts from rows
  }

  /*
   * Queue counters for overview(), kept in memory at every write to `jobs` (all writes are below): jobs per
   * (kind, stage, status), and per asset its queued/running and waiting-for-a-browser process jobs. overview() then
   * never scans the jobs table (~8 rows per asset after a first open). Rebuilt from the table at start and when
   * another connection committed.
   */
  const jobCounts = new Map<string, number>()
  const activeByAsset = new Map<string, number>()
  const waitingByAsset = new Map<string, number>()
  let countersVersion = -1
  type Counted = { kind: string; stage: string | null; status: string; asset_id: string | null }
  function adjust(m: Map<string, number>, k: string, d: number): void {
    const v = (m.get(k) ?? 0) + d
    if (v > 0) m.set(k, v)
    else m.delete(k)
  }
  function bump(r: Counted, d: number): void {
    const k = `${r.kind}|${r.stage ?? ''}|${r.status}`
    jobCounts.set(k, (jobCounts.get(k) ?? 0) + d)
    if (r.kind !== 'process' || !r.asset_id) return
    if (r.status === 'queued' || r.status === 'running') adjust(activeByAsset, r.asset_id, d)
    else if (r.status === 'waiting-renderer') adjust(waitingByAsset, r.asset_id, d)
  }
  function rebuildCounters(): void {
    jobCounts.clear(); activeByAsset.clear(); waitingByAsset.clear()
    for (const r of db.prepare('SELECT kind, stage, status, COUNT(*) AS n FROM jobs GROUP BY 1, 2, 3').all() as Array<Counted & { n: number }>) {
      jobCounts.set(`${r.kind}|${r.stage ?? ''}|${r.status}`, r.n)
    }
    for (const r of db.prepare("SELECT asset_id, status, COUNT(*) AS n FROM jobs WHERE kind = 'process' AND asset_id IS NOT NULL AND status IN ('queued', 'running', 'waiting-renderer') GROUP BY 1, 2").all() as Array<{ asset_id: string; status: string; n: number }>) {
      adjust(r.status === 'waiting-renderer' ? waitingByAsset : activeByAsset, r.asset_id, r.n)
    }
    countersVersion = db.pragma('data_version', { simple: true }) as number
  }
  /** Delete jobs, keeping the counters (RETURNING gives what went). */
  function deleteJobs(sql: string, ...params: unknown[]): void {
    for (const r of prep(`${sql} RETURNING kind, stage, status, asset_id`).all(...params) as Counted[]) bump(r, -1)
  }
  rebuildCounters()

  let started = false
  let stopped = false
  let pumpScheduled = false
  /**
   * A full scan of the library is running (yieldToScan): the backlog waits, so the scan does not share the event loop,
   * the thread pool and the write lock with a whole library's worth of processing; what a browser shows still runs,
   * one job at a time (pipeline-and-cache.md「扫描时让路」).
   */
  let scanYield = false
  let wakeTimer: NodeJS.Timeout | null = null
  let cleanTimer: NodeJS.Timeout | null = null
  let offScan: (() => void) | null = null
  /** Enqueued work not yet written to the jobs table (written in chunks by the pump). */
  let pending: Enqueued[] = []
  /** Stage tallies of `pending`, so overview() never has to write the backlog first. */
  const pendingStages = new Map<PipelineStage, number>()
  /** Pending items per asset (an asset is enqueued again and again during a scan). */
  const pendingAssets = new Map<string, number>()
  function addPending(items: Enqueued[]): void {
    for (const it of items) {
      pending.push(it)
      pendingAssets.set(it.id, (pendingAssets.get(it.id) ?? 0) + 1)
      for (const st of it.stages) pendingStages.set(st, (pendingStages.get(st) ?? 0) + 1)
    }
  }
  function takePending(n: number): Enqueued[] {
    const items = pending.splice(0, Math.min(n, pending.length))
    for (const it of items) {
      const left = (pendingAssets.get(it.id) ?? 0) - 1
      if (left > 0) pendingAssets.set(it.id, left)
      else pendingAssets.delete(it.id)
      for (const st of it.stages) pendingStages.set(st, (pendingStages.get(st) ?? 0) - 1)
    }
    return items
  }
  const running = new Map<string, Promise<void>>()
  const busyAssets = new Set<string>()
  const processing = new Set<string>()
  const cancelledRunning = new Set<string>()
  const creates = new Map<string, { ctl: AbortController; done: Promise<void> }>()
  const completions = new Map<PipelineStage, number[]>()
  /** Background work that may still queue jobs (idle() waits for it). */
  const background = new Set<Promise<unknown>>()
  let shuttingDown = false
  function track(p: Promise<unknown>): void {
    background.add(p)
    void p.finally(() => background.delete(p))
  }

  /* ───────────── small SQL helpers ───────────── */

  const getJob = (id: string): JobRow | null => (prep('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined) ?? null
  const assetRow = (id: string): AssetRow | null =>
    (prep('SELECT id, name, hash, format, plugin, ext, missing, auxiliary, thumb_state, thumb_manual, aspect, badge FROM assets WHERE id = ?').get(id) as AssetRow | undefined) ?? null

  function creatorName(r: JobRow): string | null {
    if (!r.creator) return null
    if (r.kind === 'action') return resolveAction(r.creator)?.action.title ?? null
    return resolveCreator(r.creator)?.creator.displayName ?? null
  }

  function info(r: JobRow): JobInfo {
    const assetName = r.asset_id ? (prep('SELECT name FROM assets WHERE id = ?').pluck().get(r.asset_id) as string | undefined) ?? null : null
    return toJobInfo(r, { assetName, creatorName: creatorName(r) })
  }

  function emitJob(id: string): void {
    const r = getJob(id)
    if (!r) return
    try { events.emit(library.id, 'job.updated', info(r)) } catch (e) { log.warn('event emit failed', { error: errMessage(e) }) }
  }

  /*
   * Stages that simply succeed are announced throttled: at most one job.updated per completionEventMs, carrying the
   * latest finished job, and always one after the last completion, so the shell's task count can refresh when work
   * ends. 800 000 stages of a first open become a couple of events per second instead of one each.
   */
  let completionTimer: NodeJS.Timeout | null = null
  const completedRecently: string[] = []
  function announceCompletion(id: string): void {
    // A stage that ends while stop() waits for running work is not announced: the index closes right after stop(),
    // before the timer would fire.
    if (stopped) return
    completedRecently.push(id)
    if (completedRecently.length > 16) completedRecently.shift()
    if (completionTimer) return
    completionTimer = setTimeout(() => {
      completionTimer = null
      const ids = completedRecently.splice(0)
      // the newest finished job that still exists (a later run may have replaced its row)
      for (let i = ids.length - 1; i >= 0; i--) if (getJob(ids[i]!)) { emitJob(ids[i]!); break }
    }, completionEventMs)
    completionTimer.unref?.()
  }

  function update(id: string, fields: Partial<Record<keyof JobRow, unknown>>): void {
    if (fields.status !== undefined) {
      const cur = prep('SELECT kind, stage, status, asset_id FROM jobs WHERE id = ?').get(id) as Counted | undefined
      if (cur && cur.status !== fields.status) { bump(cur, -1); bump({ ...cur, status: fields.status as string }, 1) }
    }
    const keys = Object.keys(fields)
    prep(`UPDATE jobs SET ${keys.map(k => `${k} = @${k}`).join(', ')}, updated_at = @__at WHERE id = @__id`).run({ ...fields, __at: now(), __id: id })
  }

  async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    try { return await fn() } catch (e) { log.warn(`${label} failed`, { error: errMessage(e) }); return undefined }
  }

  function loadedFormat(a: AssetRow): LoadedFormat | null {
    if (!a.plugin || a.format === 'unknown') return null
    const f = plugins.format(a.format)
    return f && f.pluginId === a.plugin ? f : (plugins.formats().find(x => x.pluginId === a.plugin && x.contribution.id === a.format) ?? null)
  }

  function recordState(assetId: string, stage: PipelineStage, hash: string | null, refs: string[] | null | undefined, plugin: string | null | undefined): void {
    prep(`INSERT INTO pipeline_stages (asset_id, stage, hash, refs, plugin, at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, stage) DO UPDATE SET hash = excluded.hash, refs = excluded.refs, plugin = excluded.plugin, at = excluded.at`)
      .run(assetId, stage, hash, refs ? [...refs].sort().join(',') : null, plugin ?? null, now())
  }

  /* ───────────── queue ───────────── */

  /** Write enqueued work to the jobs table: all of it, or `limit` assets (the pump writes in chunks between I/O). */
  function flush(limit = Infinity): void {
    if (pending.length === 0) return
    const items = takePending(limit)
    const select = prep("SELECT id, stage, status, priority FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? ORDER BY status = 'running'")
    const reuse = prep(`UPDATE jobs SET status = 'queued', priority = MAX(priority, @priority), attempts = 0, run_after = 0, retryable = 1,
        progress = NULL, message = NULL, created_at = CASE WHEN status = 'queued' THEN created_at ELSE @at END, updated_at = @at WHERE id = @id`)
    const insert = prep(`INSERT INTO jobs (id, kind, asset_id, stage, status, priority, attempts, created_at, updated_at, run_after)
        VALUES (?, 'process', ?, ?, 'queued', ?, 0, ?, ?, 0)`)
    const drop = prep('DELETE FROM jobs WHERE id = ?')
    // Priority belongs to the asset: an urgent later stage must not wait behind a backlog earlier stage.
    const level = prep(`UPDATE jobs INDEXED BY jobs_asset SET priority = (SELECT MAX(priority) FROM jobs INDEXED BY jobs_asset WHERE asset_id = @id AND kind = 'process' AND status IN ('queued', 'waiting-renderer'))
        WHERE asset_id = @id AND kind = 'process' AND status IN ('queued', 'waiting-renderer')`)
    db.transaction(() => {
      const at = now()
      const touched = new Set<string>()
      for (const it of items) {
        const existing = select.all(it.id) as Array<{ id: string; stage: string; status: string; priority: number }>
        // An asset with no jobs yet gets all its rows at one priority: nothing to level.
        if (existing.length) touched.add(it.id)
        for (const stage of it.stages) {
          const rows = existing.filter(r => r.stage === stage)
          const reusable = rows.filter(r => r.status !== 'running')
          if (reusable.length) {
            const r0 = reusable[0]!
            reuse.run({ priority: it.priority, at, id: r0.id })
            if (r0.status !== 'queued') { bump({ kind: 'process', stage, status: r0.status, asset_id: it.id }, -1); bump({ kind: 'process', stage, status: 'queued', asset_id: it.id }, 1) }
            for (const extra of reusable.slice(1)) { drop.run(extra.id); bump({ kind: 'process', stage, status: extra.status, asset_id: it.id }, -1) }
          } else {
            insert.run(uuidv7(), it.id, stage, it.priority, at, at)
            bump({ kind: 'process', stage, status: 'queued', asset_id: it.id }, 1)
          }
        }
      }
      for (const id of touched) level.run({ id })
    })()
  }

  /** Next runnable jobs: highest priority first, one stage per asset, never before an earlier stage of that asset. */
  const pickStmt = prep(`SELECT j.* FROM jobs j
    WHERE j.kind = 'process' AND j.status = 'queued' AND j.run_after <= ?
      AND j.asset_id NOT IN (SELECT value FROM json_each(?))
      AND NOT EXISTS (SELECT 1 FROM jobs e INDEXED BY jobs_asset WHERE e.asset_id = j.asset_id AND e.kind = 'process' AND e.status IN ('queued', 'running')
                      AND ${stageOrderSql('e.stage')} < ${stageOrderSql('j.stage')})
    ORDER BY j.priority DESC, j.created_at ASC
    LIMIT ?`)

  function schedulePump(): void {
    if (!started || stopped || pumpScheduled) return
    pumpScheduled = true
    setImmediate(() => { pumpScheduled = false; pump() })
  }

  /** Assets written to the jobs table per pump turn; the next chunk waits for a turn of the event loop. */
  const FLUSH_CHUNK = 500

  function pump(): void {
    if (!started || stopped) return
    flush(FLUSH_CHUNK)
    if (pending.length) schedulePump()
    const free = (scanYield ? 1 : concurrencyNow()) - running.size
    if (free > 0) {
      const rows = pickStmt.all(Date.now(), JSON.stringify([...busyAssets]), free) as JobRow[]
      for (const job of rows) {
        if (busyAssets.has(job.asset_id!)) continue
        if (scanYield && job.priority < PRIORITY.visible) continue
        busyAssets.add(job.asset_id!)
        update(job.id, { status: 'running' })
        const p = runProcess(job)
          .catch(e => log.error('job crashed', { job: job.id, error: errMessage(e) }))
          .finally(() => { running.delete(job.id); busyAssets.delete(job.asset_id!); cancelledRunning.delete(job.id); schedulePump() })
        running.set(job.id, p)
      }
    }
  }

  /** Backoff deadlines of jobs waiting to retry; one timer wakes the queue at the earliest (no table scan per pick). */
  const wakes: number[] = []
  let wakeTimerAt = 0
  function wakeAt(at: number): void { wakes.push(at); armWake() }
  function armWake(): void {
    if (!started || stopped) return
    const t = Date.now()
    for (let i = wakes.length - 1; i >= 0; i--) if (wakes[i]! <= t) wakes.splice(i, 1)
    if (wakes.length === 0) return
    const next = Math.min(...wakes)
    if (wakeTimer && wakeTimerAt <= next) return
    if (wakeTimer) clearTimeout(wakeTimer)
    wakeTimerAt = next
    wakeTimer = setTimeout(() => { wakeTimer = null; pump(); armWake() }, Math.max(1, next - t + 1))
    wakeTimer.unref?.()
  }

  /* ───────────── stages ───────────── */

  async function file(id: string): Promise<AssetFile | null> { return deps.assetFile(id) }

  /*
   * Plugins that call external services declare `rateLimit` (calls per minute): their calls start at most that often.
   * A processing job that would exceed it goes back to the queue until a slot frees up, without holding a slot.
   */
  const callTimes = new Map<string, number[]>()
  class RateLimited extends Error { constructor(readonly waitMs: number) { super('rate limited') } }
  /** Milliseconds until `pluginId` may start another call (0 = now, and the call is counted). */
  function takeCallSlot(pluginId: string): number {
    const limit = extras.rateLimit?.(pluginId) ?? null
    if (!limit) return 0
    const t = Date.now()
    const list = (callTimes.get(pluginId) ?? []).filter(x => t - x < rateWindowMs)
    if (list.length >= limit) { callTimes.set(pluginId, list); return list[0]! + rateWindowMs - t + 1 }
    list.push(t)
    callTimes.set(pluginId, list)
    return 0
  }
  function gate(pluginId: string): void {
    const wait = takeCallSlot(pluginId)
    if (wait > 0) throw new RateLimited(wait)
  }
  async function waitForSlot(pluginId: string, signal: AbortSignal): Promise<void> {
    for (let wait = takeCallSlot(pluginId); wait > 0 && !signal.aborted; wait = takeCallSlot(pluginId)) {
      await new Promise(r => { const t = setTimeout(r, wait); t.unref?.() })
    }
  }

  function applies(fn: () => boolean, label: string): boolean {
    try { return !!fn() } catch (e) { log.warn(`${label} appliesTo threw`, { error: errMessage(e) }); return false }
  }

  /** Cached variants for the current key of (asset, stage); registers files synced from elsewhere. */
  function cached(assetId: string, base: Omit<Parameters<typeof cacheKey>[0], 'variant'>, variants: readonly string[]): Partial<Record<ThumbVariant, StoredThumb>> {
    const found: Partial<Record<ThumbVariant, StoredThumb>> = {}
    for (const variant of variants) {
      const key = cacheKey({ ...base, variant })
      const disk = cache.onDisk(base.stage, key, extFor(variant))
      if (!disk) continue
      cache.register(assetId, base.stage, variant, key, disk.relPath, disk.bytes)
      found[variant as ThumbVariant] = { key, relPath: disk.relPath, bytes: disk.bytes }
    }
    return found
  }

  async function setThumbState(a: AssetRow, state: 'pending' | 'render' | 'ready' | 'none' | 'failed'): Promise<void> {
    if (a.thumb_state !== state) await deps.setThumbState(a.id, state)
  }

  async function execute(assetId: string, stage: PipelineStage): Promise<Outcome> {
    const a = assetRow(assetId)
    if (!a) return { status: 'gone' }
    if (a.missing) return { status: 'skipped' }
    const f = loadedFormat(a)
    const fmtPlugin = f ? `${f.pluginId}@${f.pluginVersion}` : null

    switch (stage) {
      case 'identify': {
        const af = await file(assetId)
        if (!af) return { status: 'gone' }
        const r = await plugins.identify(af)
        await deps.applyIdentify(assetId, r)
        return { status: 'done', plugin: r ? `${r.pluginId}@${r.pluginVersion}` : null }
      }

      case 'probe': {
        if (!f?.handler?.probe) return { status: 'skipped', plugin: fmtPlugin }
        const af = await file(assetId)
        if (!af) return { status: 'gone' }
        const h = f.handler
        gate(f.pluginId)
        const res = await plugins.invoke(f.pluginId, 'probe', () => h.probe!(af))
        await deps.applyProbe(assetId, f.pluginId, res)
        return { status: 'done', plugin: fmtPlugin }
      }

      case 'derive': {
        if (!f?.handler?.derive) return { status: 'skipped', plugin: fmtPlugin }
        const refs = await deps.referencedHashes(assetId)
        const base = { hash: a.hash, refs, plugin: f.pluginId, version: f.pluginVersion, stage }
        const rows = prep("SELECT variant, key FROM cache_files WHERE asset_id = ? AND stage = 'derive'").all(assetId) as Array<{ variant: string; key: string }>
        if (rows.length && rows.every(r => r.key === cacheKey({ ...base, variant: r.variant }) && cache.file(assetId, r.variant))) return { status: 'skipped', plugin: fmtPlugin, refs }
        const af = await file(assetId)
        if (!af) return { status: 'gone' }
        const h = f.handler
        gate(f.pluginId)
        const out = await plugins.invoke(f.pluginId, 'derive', () => h.derive!(af))
        for (const d of out) await cache.write(assetId, 'derive', d.name, cacheKey({ ...base, variant: d.name }), extFor(d.name, d.mime), d.data)
        cache.retain(assetId, 'derive', out.map(d => d.name))
        return { status: 'done', plugin: fmtPlugin, refs }
      }

      case 'thumbnail': {
        if (a.thumb_manual) return { status: 'skipped', plugin: fmtPlugin }
        if (!f || f.contribution.thumbnail === 'none' || (f.contribution.thumbnail === 'server' && !f.handler?.thumbnail)) {
          await setThumbState(a, 'none')
          return { status: 'skipped', plugin: fmtPlugin }
        }
        const refs = await deps.referencedHashes(assetId)
        const base = { hash: a.hash, refs, plugin: f.pluginId, version: f.pluginVersion, stage }
        const hit = cached(assetId, base, f.contribution.thumbnail === 'browser' ? RENDER_PARTS.filter(v => v !== 'turnaround') : THUMB_VARIANTS)
        if (hit.thumb) {
          cache.retain(assetId, 'thumbnail', Object.keys(hit))
          await deps.applyThumbnails(assetId, hit, a.aspect)
          return { status: 'skipped', plugin: fmtPlugin, refs }
        }
        if (f.contribution.thumbnail === 'browser') {
          await setThumbState(a, 'render')
          return { status: 'waiting-renderer', plugin: fmtPlugin, refs }
        }
        const af = await file(assetId)
        if (!af) return { status: 'gone' }
        const h = f.handler!
        gate(f.pluginId)
        const set = await plugins.invoke(f.pluginId, 'thumbnail', () => h.thumbnail!(af))
        const stored: Partial<Record<ThumbVariant, StoredThumb>> = {}
        for (const variant of THUMB_VARIANTS) {
          const data = set[variant]
          if (data && data.byteLength) stored[variant] = await cache.write(assetId, 'thumbnail', variant, cacheKey({ ...base, variant }), extFor(variant), data)
        }
        cache.retain(assetId, 'thumbnail', Object.keys(stored))
        await deps.applyThumbnails(assetId, stored, set.aspect ?? null)
        return { status: 'done', plugin: fmtPlugin, refs }
      }

      case 'summary': {
        if (!f) return { status: 'skipped' }
        const browser = f.contribution.thumbnail === 'browser'
        if (!f.handler?.summarize && !browser) return { status: 'skipped', plugin: fmtPlugin }
        const refs = await deps.referencedHashes(assetId)
        const base = { hash: a.hash, refs, plugin: f.pluginId, version: f.pluginVersion, stage }
        if (f.handler?.summarize) {
          const key = cacheKey({ ...base, variant: 'text' })
          if (!cache.onDisk('summary', key, 'json')) {
            const af = await file(assetId)
            if (!af) return { status: 'gone' }
            const h = f.handler
            gate(f.pluginId)
            const s = await plugins.invoke(f.pluginId, 'summarize', () => h.summarize!(af))
            await cache.write(assetId, 'summary', 'text', key, 'json', new TextEncoder().encode(JSON.stringify({ text: s.text })))
          } else cached(assetId, base, ['text'])
        }
        if (browser) {
          const hit = cached(assetId, base, RENDER_PARTS)
          if (Object.keys(hit).length === 0) return { status: 'waiting-renderer', plugin: fmtPlugin, refs }
        }
        return { status: 'done', plugin: fmtPlugin, refs }
      }

      case 'enrich': {
        const all = plugins.enrichers()
        if (all.length === 0) return { status: 'skipped' }
        const s = query.summaries([assetId])[0]
        if (!s) return { status: 'gone' }
        const use = all.filter(e => applies(() => e.enricher.appliesTo(s), `enricher ${e.enricher.id}`))
        if (use.length === 0) return { status: 'skipped', plugin: stageSet('enrich') }
        const af = await file(assetId)
        if (!af) return { status: 'gone' }
        for (const e of use) gate(e.pluginId)
        for (const e of use) {
          const r = await plugins.invoke(e.pluginId, `enrich:${e.enricher.id}`, () => e.enricher.enrich(af))
          if (r.tags?.length || r.description) await deps.applyEnrich(assetId, e.pluginId, { ...(r.tags ? { tags: r.tags } : {}), ...(r.description ? { description: r.description } : {}) })
        }
        return { status: 'done', plugin: stageSet('enrich') }
      }

      case 'validate': {
        const all = plugins.validators()
        const s = all.length ? query.summaries([assetId])[0] : undefined
        const use = s ? all.filter(v => applies(() => v.validator.appliesTo(s), `validator ${v.validator.id}`)) : []
        if (use.length === 0) {
          if (prep('SELECT 1 FROM checks WHERE asset_id = ? LIMIT 1').get(assetId)) await deps.applyChecks(assetId, [])
          return { status: 'skipped', plugin: stageSet('validate') }
        }
        const af = await file(assetId)
        if (!af) return { status: 'gone' }
        const checks: CheckView[] = []
        for (const v of use) gate(v.pluginId)
        for (const v of use) {
          const results = await plugins.invoke(v.pluginId, `validate:${v.validator.id}`, () => v.validator.check(af))
          for (const r of results) checks.push({ validator: v.validator.id, rule: r.rule, verdict: r.verdict, message: r.message, ...(r.values ? { values: r.values } : {}) })
        }
        await deps.applyChecks(assetId, checks)
        return { status: 'done', plugin: stageSet('validate') }
      }

      case 'index': {
        if (plugins.searchProviders().length === 0) return { status: 'skipped' }
        const doc = await deps.searchDoc(assetId)
        if (!doc) return { status: 'gone' }
        await query.indexDocs([doc])
        return { status: 'done', plugin: stageSet('index') }
      }
    }
  }

  function versionsOf(ids: string[]): string | null {
    const enabled = new Map(plugins.enabled().map(p => [p.id, p.version]))
    const list = [...new Set(ids)].sort().map(id => `${id}@${enabled.get(id) ?? '0.0.0'}`)
    return list.length ? list.join(',') : null
  }

  /** Stages run by every plugin of a kind rather than by the asset's format plugin. */
  const SET_STAGES = ['enrich', 'validate', 'index'] as const
  /**
   * The plugins (id@version, sorted) that a set stage is evaluated against now: all enrichers / validators / search
   * providers, whether or not they applied to the asset. Recorded with the stage, so any change of that set — a plugin
   * added, removed or upgraded, also one that arrived while the server was down — redoes the stage.
   */
  function stageSet(stage: (typeof SET_STAGES)[number]): string | null {
    if (stage === 'enrich') return versionsOf(plugins.enrichers().map(e => e.pluginId))
    if (stage === 'validate') return versionsOf(plugins.validators().map(v => v.pluginId))
    return versionsOf(plugins.searchProviders().map(p => p.pluginId))
  }

  async function markProcessing(assetId: string, stage: PipelineStage): Promise<void> {
    if (processing.has(assetId)) return
    processing.add(assetId)
    const failed = !!prep("SELECT 1 FROM jobs INDEXED BY jobs_asset WHERE asset_id = ? AND kind = 'process' AND status = 'failed' LIMIT 1").get(assetId)
    await safe('setProcessing', () => deps.setProcessing(assetId, { processing: true, failed, stage }))
  }

  async function settleAsset(assetId: string): Promise<void> {
    const left = prep("SELECT COUNT(*) FROM jobs INDEXED BY jobs_asset WHERE asset_id = ? AND kind = 'process' AND status IN ('queued', 'running')").pluck().get(assetId) as number
    if (left > 0 || !processing.has(assetId)) return
    processing.delete(assetId)
    const failedRow = prep("SELECT stage, error FROM jobs INDEXED BY jobs_asset WHERE asset_id = ? AND kind = 'process' AND status = 'failed' ORDER BY updated_at DESC LIMIT 1").get(assetId) as { stage: PipelineStage; error: string | null } | undefined
    await safe('setProcessing', () => deps.setProcessing(assetId, failedRow
      ? { processing: false, failed: true, stage: failedRow.stage, ...(failedRow.error ? { error: failedRow.error } : {}) }
      : { processing: false, failed: false }))
  }

  /**
   * Assets with work not yet written to the table, for overview's busy count. Small backlogs are checked against the
   * assets already busy; a big one (a first open) is counted as is — it is all new assets then.
   */
  function pendingAssetCount(): number {
    if (pendingAssets.size > 2000) return pendingAssets.size
    let n = 0
    for (const id of pendingAssets.keys()) if (!activeByAsset.has(id)) n++
    return n
  }

  function noteCompletion(stage: PipelineStage): void {
    const t = Date.now()
    const list = completions.get(stage) ?? []
    list.push(t)
    while (list.length && t - list[0]! > RATE_WINDOW_MS) list.shift()
    completions.set(stage, list)
  }

  async function runProcess(job: JobRow): Promise<void> {
    const assetId = job.asset_id!
    const stage = job.stage as PipelineStage
    await markProcessing(assetId, stage)
    let outcome: Outcome
    try {
      outcome = await execute(assetId, stage)
    } catch (e) {
      if (e instanceof RateLimited) {
        const at = Date.now() + e.waitMs
        update(job.id, { status: 'queued', run_after: at })
        wakeAt(at)
        await settleAsset(assetId)
        return
      }
      await failProcess(job, errMessage(e))
      await settleAsset(assetId)
      return
    }
    if (outcome.status === 'gone') {
      forgetNow(assetId)
      deleteJobs('DELETE FROM jobs WHERE id = ?', job.id)
      processing.delete(assetId)
      return
    }
    const cancelled = cancelledRunning.has(job.id)
    const status = cancelled ? 'cancelled' : outcome.status
    const hash = assetRow(assetId)?.hash ?? null
    update(job.id, { status, error: status === 'waiting-renderer' ? job.error : null, run_after: 0, plugin: outcome.plugin ?? null, progress: null, params_json: null })
    if (status === 'done' || status === 'skipped') {
      recordState(assetId, stage, hash, outcome.refs, outcome.plugin)
      deleteJobs("DELETE FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? AND stage = ? AND id != ? AND status IN ('done', 'skipped', 'failed', 'cancelled')", assetId, stage, job.id)
      if (job.error) await clearFailure(assetId, stage, job.error)
      if (stage === 'probe' && status === 'done') recheckMembers(assetId)
      noteCompletion(stage)
      if (job.error || job.attempts > 0) emitJob(job.id) // recovered after a failure: right away
      else announceCompletion(job.id)
    } else emitJob(job.id)
    await settleAsset(assetId)
  }

  async function failProcess(job: JobRow, message: string): Promise<void> {
    const assetId = job.asset_id!
    const stage = job.stage as PipelineStage
    const attempts = job.attempts + 1
    if (attempts <= MAX_RETRIES && !cancelledRunning.has(job.id)) {
      const delay = retryDelays[Math.min(attempts - 1, retryDelays.length - 1)] ?? 0
      const at = Date.now() + delay
      update(job.id, { status: 'queued', attempts, error: message, run_after: at })
      wakeAt(at)
      log.info('stage failed; will retry', { asset: assetId, stage, attempt: attempts, delayMs: delay, error: message })
      return
    }
    update(job.id, { status: cancelledRunning.has(job.id) ? 'cancelled' : 'failed', attempts, error: message, retryable: 1 })
    log.warn('stage failed', { asset: assetId, stage, attempts, error: message })
    await raiseFailure(assetId, stage, message)
    if (stage === 'thumbnail') { const a = assetRow(assetId); if (a) await safe('setThumbState', () => setThumbState(a, 'failed')) }
    emitJob(job.id)
  }

  /**
   * Raise the pipeline-failed issue for a stage, unless another stage of the same asset already failed for the same
   * cause (an unplayable video fails its thumbnail and its summary render alike): one cause, one issue.
   */
  async function raiseFailure(assetId: string, stage: PipelineStage, message: string): Promise<void> {
    const same = prep("SELECT stage FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? AND status = 'failed' AND stage != ? AND error = ? LIMIT 1")
      .pluck().get(assetId, stage, message) as string | undefined
    if (same) { log.info('stage failed for the same cause as another; no second issue', { asset: assetId, stage, as: same }); return }
    await safe('pipelineIssue', () => deps.pipelineIssue(assetId, stage, message))
  }

  /** A stage that had failed succeeded: clear its issue; a failure folded into it (same cause) is reported now. */
  async function clearFailure(assetId: string, stage: PipelineStage, previousError: string | null): Promise<void> {
    await safe('pipelineIssue', () => deps.pipelineIssue(assetId, stage, null))
    if (!previousError) return
    const folded = prep("SELECT stage FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? AND status = 'failed' AND stage != ? AND error = ? LIMIT 1")
      .pluck().get(assetId, stage, previousError) as PipelineStage | undefined
    if (folded) await safe('pipelineIssue', () => deps.pipelineIssue(assetId, folded, previousError))
  }

  /**
   * pipeline-and-cache.md「触发条件」: when a design object's content changed (its target size is in the document),
   * the assets that belong to it are checked again.
   */
  function recheckMembers(assetId: string): void {
    const members = prep("SELECT from_id FROM relations WHERE type = 'belongs' AND to_id = ?").pluck().all(assetId) as string[]
    if (members.length === 0) return
    addPending(members.map(id => ({ id, stages: ['validate'] as PipelineStage[], priority: PRIORITY.recent })))
    log.info('design object changed: re-checking its members', { asset: assetId, members: members.length })
  }

  function forgetNow(assetId: string): void {
    deleteJobs("DELETE FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? AND status != 'running'", assetId)
    prep('DELETE FROM pipeline_stages WHERE asset_id = ?').run(assetId)
  }

  /* ───────────── stale work after restarts and plugin changes ───────────── */

  function findStale(): void {
    const enabled = plugins.enabled()
    const current = new Map(enabled.map(p => [p.id, `${p.id}@${p.version}`]))
    const want = new Map<string, Set<PipelineStage>>()
    const add = (id: string, from: PipelineStage, only = false): void => {
      let set = want.get(id)
      if (!set) want.set(id, (set = new Set()))
      for (const s of only ? [from] : PIPELINE_STAGES.slice(stageIndex(from))) set.add(s)
    }
    // A format-driven stage ran with a plugin version that is no longer the enabled one (or the plugin is gone).
    const rows = prep(`SELECT asset_id, stage, plugin FROM pipeline_stages WHERE plugin IS NOT NULL AND stage NOT IN ('enrich', 'validate', 'index')
        AND plugin NOT IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...current.values()])) as Array<{ asset_id: string; stage: PipelineStage; plugin: string }>
    for (const r of rows) {
      for (const p of r.plugin.split(',')) {
        const id = p.slice(0, p.lastIndexOf('@'))
        if (!current.has(id)) add(r.asset_id, 'identify')
        else if (current.get(id) !== p) add(r.asset_id, r.stage)
      }
    }
    // Enrich / validate / index ran against another set of plugins than the enabled one (a search plugin upgraded,
    // added or removed — also while the server was down): redo that stage. Assets processed before without that
    // stage get it as well.
    for (const stage of SET_STAGES) {
      const set = stageSet(stage)
      for (const id of prep('SELECT asset_id FROM pipeline_stages WHERE stage = ? AND plugin IS NOT ?').pluck().all(stage, set) as string[]) add(id, stage, true)
      if (set !== null) {
        for (const id of prep(`SELECT a.id FROM assets a WHERE a.missing = 0 AND EXISTS (SELECT 1 FROM pipeline_stages s WHERE s.asset_id = a.id)
            AND NOT EXISTS (SELECT 1 FROM pipeline_stages s WHERE s.asset_id = a.id AND s.stage = ?)`).pluck().all(stage) as string[]) add(id, stage, true)
      }
    }
    // Unknown files an enabled plugin can now read; files whose plugin is no longer enabled.
    const exts = new Set(plugins.formats().filter(f => f.handler).flatMap(f => f.contribution.extensions))
    for (const r of prep("SELECT id, ext FROM assets WHERE format = 'unknown' AND missing = 0").all() as Array<{ id: string; ext: string }>) {
      if (exts.has(r.ext)) add(r.id, 'identify')
    }
    for (const id of prep('SELECT id FROM assets WHERE plugin IS NOT NULL AND missing = 0 AND plugin NOT IN (SELECT value FROM json_each(?))').pluck().all(JSON.stringify([...current.keys()])) as string[]) add(id, 'identify')
    // Content changed since identification, or never processed at all.
    for (const id of prep(`SELECT s.asset_id FROM pipeline_stages s JOIN assets a ON a.id = s.asset_id
        WHERE s.stage = 'identify' AND a.missing = 0 AND s.hash IS NOT a.hash`).pluck().all() as string[]) add(id, 'identify')
    for (const id of prep(`SELECT a.id FROM assets a WHERE a.missing = 0
        AND NOT EXISTS (SELECT 1 FROM pipeline_stages s WHERE s.asset_id = a.id) AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.asset_id = a.id)`).pluck().all() as string[]) add(id, 'identify')
    for (const [id, stages] of want) addPending([{ id, stages: PIPELINE_STAGES.filter(s => stages.has(s)), priority: PRIORITY.backlog }])
    if (want.size) log.info('re-queued stale work', { assets: want.size })
  }

  /**
   * Referenced assets changed while nobody watched: the cache keys of derive / thumbnail / summary changed. Compared
   * through deps.referencedHashes, the very input of the key (in the background: one call per asset with references).
   */
  async function findStaleReferences(): Promise<void> {
    const rows = prep(`SELECT asset_id, stage, refs FROM pipeline_stages WHERE stage IN ('derive', 'thumbnail', 'summary') AND plugin IS NOT NULL
        AND ((refs IS NOT NULL AND refs != '') OR asset_id IN (SELECT from_id FROM relations WHERE type = 'uses'))`).all() as Array<{ asset_id: string; stage: PipelineStage; refs: string | null }>
    const current = new Map<string, string>()
    let n = 0
    for (const r of rows) {
      if (stopped) return
      if (!current.has(r.asset_id)) {
        current.set(r.asset_id, [...await deps.referencedHashes(r.asset_id)].sort().join(','))
        if (++n % 500 === 0) await new Promise(res => setImmediate(res))
      }
      if (current.get(r.asset_id) !== (r.refs ?? '')) addPending([{ id: r.asset_id, stages: [r.stage], priority: PRIORITY.backlog }])
    }
    schedulePump()
  }

  /** Keys every current asset would have (thumbnail and summary variants, derivatives known here), among `wanted`. */
  async function ownersOf(wanted: Set<string>): Promise<Map<string, KeyOwner>> {
    const out = new Map<string, KeyOwner>()
    const withRefs = new Set(prep("SELECT DISTINCT from_id FROM relations WHERE type = 'uses'").pluck().all() as string[])
    const derived = new Map<string, string[]>()
    for (const r of prep("SELECT asset_id, variant FROM cache_files WHERE stage = 'derive'").all() as Array<{ asset_id: string; variant: string }>) {
      derived.set(r.asset_id, [...(derived.get(r.asset_id) ?? []), r.variant])
    }
    const check = (assetId: string, base: Omit<Parameters<typeof cacheKey>[0], 'variant' | 'stage'>): void => {
      const tryKey = (stage: PipelineStage, variant: string): void => {
        const key = cacheKey({ ...base, stage, variant })
        if (wanted.has(key)) out.set(key, { assetId, stage, variant })
      }
      for (const v of THUMB_VARIANTS) { tryKey('thumbnail', v); tryKey('summary', v) }
      tryKey('summary', 'text')
      for (const v of derived.get(assetId) ?? []) tryKey('derive', v)
    }
    const rows = prep("SELECT id, hash, format, plugin, thumb_state, thumb_manual, aspect, badge, name, ext, missing, auxiliary FROM assets WHERE format != 'unknown'").all() as AssetRow[]
    let n = 0
    for (const a of rows) {
      const f = loadedFormat(a)
      if (!f) continue
      const refs = withRefs.has(a.id) ? await deps.referencedHashes(a.id) : []
      check(a.id, { hash: a.hash, refs, plugin: f.pluginId, version: f.pluginVersion })
      if (++n % 500 === 0) await new Promise(res => setImmediate(res))
    }
    // Trashed assets keep their renders for a restore (their references are gone from the index: none assumed).
    for (const t of prep('SELECT asset_id, format, meta_json FROM trash').all() as Array<{ asset_id: string; format: string; meta_json: string | null }>) {
      let hash: string | undefined
      try { hash = (JSON.parse(t.meta_json ?? '{}') as { hash?: string }).hash } catch { hash = undefined }
      const f = plugins.format(t.format)
      if (hash && f) check(t.asset_id, { hash, refs: [], plugin: f.pluginId, version: f.pluginVersion })
    }
    return out
  }


  /**
   * After plugins were enabled, disabled, installed, updated or removed while running: redo what that affects —
   * stages a changed plugin version ran (findStale), and for a newly arrived enricher, validator or search
   * provider that stage for every asset (so existing assets get enriched, checked, indexed).
   */
  function onPluginsChanged(change: { started: string[]; stopped: string[] }): void {
    log.info('plugins changed: looking for work to redo', { started: change.started, stopped: change.stopped })
    try { findStale() } catch (e) { log.warn('stale scan failed', { error: errMessage(e) }) }
    schedulePump()
  }
  const offPlugins = extras.onChange?.(onPluginsChanged) ?? (() => {})
  // The search providers were emptied (QueryEngine.clearProviders): feed them every asset again.
  const offCleared = onProvidersCleared(db, () => {
    const ids = prep('SELECT id FROM assets WHERE missing = 0').pluck().all() as string[]
    addPending(ids.map(id => ({ id, stages: ['index'] as PipelineStage[], priority: PRIORITY.backlog })))
    log.info('search indexes cleared: re-feeding every asset', { assets: ids.length })
    schedulePump()
  })

  /** Clean the cache; renders adopted from sync complete the render tasks still waiting for them. */
  async function cleanWith(graceMs: number): Promise<CacheCleanResponse> {
    const r = await cache.clean(graceMs, ownersOf)
    for (const assetId of new Set(r.adopted.map(o => o.assetId))) {
      const a = assetRow(assetId)
      if (!a) continue
      for (const job of prep("SELECT * FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? AND status = 'waiting-renderer'").all(assetId) as JobRow[]) {
        await safe('adopt synced render', async () => { await completeFromCache(job, a, await deps.referencedHashes(assetId)) })
      }
    }
    return { removedBytes: r.removedBytes, removedFiles: r.removedFiles }
  }

  /* ───────────── creation jobs ───────────── */

  function resolveCreator(key: string): CreatorEntry | null {
    const all = plugins.creators()
    const exact = all.find(e => `${e.pluginId}:${e.creator.id}` === key)
    if (exact) return exact
    const bare = all.filter(e => e.creator.id === key)
    return bare.length === 1 ? bare[0]! : null
  }

  interface CreateParams { params: unknown; inputs: Array<{ role: string; id: Guid }>; folder?: string }

  /** Provenance a creator run gives its outputs when they say nothing themselves: the creator and its parameters. */
  function defaultProvenance(entry: CreatorEntry, req: CreateRequest): ProvenanceInput {
    const params = req.params && typeof req.params === 'object' && !Array.isArray(req.params) ? (req.params as Record<string, unknown>) : undefined
    return { method: `${entry.pluginId}/${entry.creator.id}`, ...(params && Object.keys(params).length ? { params } : {}) }
  }

  /**
   * Registration for one run (create or action): through the kernel's channel; every output of the run carries the
   * same batch id in its provenance, and the run's inputs as source relations (ADR-070).
   */
  function registrar(jobId: string, owner: { pluginId: string; pluginVersion: string }, actor: string, signal: AbortSignal,
    run: { provenance?: ProvenanceInput; inputs?: Array<{ id: Guid; role: string }> } = {}): (output: RegisterRequest) => Promise<AssetInfo> {
    const batch = `bat_${uuidv7()}`
    let chain: Promise<unknown> = Promise.resolve()
    return (output: RegisterRequest) => {
      // serialized: outputs arrive in the order the plugin registered them
      const next = chain.then(async () => {
        if (signal.aborted) throw new CoreError('conflict', '任务已取消')
        const res = await deps.register(output, {
          actor, pluginId: owner.pluginId, pluginVersion: owner.pluginVersion, batch,
          ...(run.provenance ? { provenance: run.provenance } : {}), ...(run.inputs?.length ? { inputs: run.inputs } : {})
        })
        const row = getJob(jobId)
        const outs = row ? (JSON.parse(row.outputs_json) as string[]) : []
        outs.push(res.info.id)
        update(jobId, { outputs_json: JSON.stringify(outs) })
        emitJob(jobId)
        return res.info
      })
      chain = next.catch(() => {})
      return next
    }
  }

  function launchCreate(jobId: string, entry: CreatorEntry, p: CreateParams, inputs: Array<{ role: string; asset: AssetSummary }>, actor: string): void {
    const ctl = new AbortController()
    const request: CreateRequest = { params: p.params, inputs, ...(p.folder !== undefined ? { folder: p.folder } : {}), actor }
    const register = registrar(jobId, entry, actor, ctl.signal, {
      provenance: defaultProvenance(entry, request),
      inputs: inputs.map(i => ({ id: i.asset.id, role: i.role }))
    })
    const ctx: JobContext = {
      id: jobId,
      signal: ctl.signal,
      progress(value: number, message?: string, action?: JobAction) {
        if (ctl.signal.aborted) return
        const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
        update(jobId, { progress: v, ...(message !== undefined ? { message } : {}), ...(action !== undefined ? { action_json: action ? JSON.stringify(action) : null } : {}) })
        emitJob(jobId)
      },
      register
    }
    const done = waitForSlot(entry.pluginId, ctl.signal)
      .then(() => plugins.invoke(entry.pluginId, `create:${entry.creator.id}`, () => entry.creator.run(request, ctx)))
      .then(() => {
        const row = getJob(jobId)
        if (!row || row.status === 'cancelled') return
        update(jobId, { status: 'done', progress: 1 })
      })
      .catch((e: unknown) => {
        const row = getJob(jobId)
        if (!row || row.status === 'cancelled') return
        if (shuttingDown) update(jobId, { status: 'failed', error: '服务停止，任务中断', retryable: 1 })
        else update(jobId, { status: 'failed', error: errMessage(e), retryable: 1 })
      })
      .finally(() => { creates.delete(jobId); emitJob(jobId) })
    creates.set(jobId, { ctl, done })
  }

  /* ───────────── action jobs (K11) ───────────── */

  function resolveAction(key: string): { pluginId: string; pluginVersion: string; action: Action } | null {
    const versions = new Map(plugins.enabled().map(p => [p.id, p.version]))
    const all = plugins.actions().map(a => ({ ...a, pluginVersion: versions.get(a.pluginId) ?? '0.0.0' }))
    const exact = all.find(e => `${e.pluginId}:${e.action.id}` === key)
    if (exact) return exact
    const bare = all.filter(e => e.action.id === key)
    return bare.length === 1 ? bare[0]! : null
  }

  interface ActionParams { ids: Guid[]; params?: unknown }

  function actionSelection(entry: { action: Action }, ids: Guid[]): AssetSummary[] {
    const found = new Map(query.summaries(ids).map(s => [s.id, s]))
    const missing = ids.find(id => !found.has(id))
    if (missing) throw new CoreError('not_found', `资产不存在：${missing}`, { id: missing })
    const selection = ids.map(id => found.get(id)!)
    let ok = false
    try { ok = !!entry.action.appliesTo(selection) } catch (e) { log.warn('action appliesTo threw', { action: entry.action.id, error: errMessage(e) }) }
    if (!ok) throw new CoreError('validation_failed', `「${entry.action.title}」不适用于所选资产`)
    return selection
  }

  function launchAction(jobId: string, entry: { pluginId: string; pluginVersion: string; action: Action }, p: ActionParams, selection: AssetSummary[], actor: string): void {
    const ctl = new AbortController()
    const register = registrar(jobId, entry, actor, ctl.signal, { provenance: { method: `${entry.pluginId}/${entry.action.id}` } })
    const actionLog = opts.log.child(`plugin.${entry.pluginId}`)
    const done = waitForSlot(entry.pluginId, ctl.signal)
      .then(() => plugins.invoke(entry.pluginId, `action:${entry.action.id}`, () => entry.action.run(selection, p.params ?? null, { actor, log: actionLog, signal: ctl.signal })))
      .then(async result => {
        for (const output of result?.assets ?? []) await register(output)
        const row = getJob(jobId)
        if (!row || row.status === 'cancelled') return
        update(jobId, { status: 'done', progress: 1, ...(result?.message ? { message: result.message } : {}) })
      })
      .catch((e: unknown) => {
        const row = getJob(jobId)
        if (!row || row.status === 'cancelled') return
        update(jobId, { status: 'failed', error: shuttingDown ? '服务停止，任务中断' : errMessage(e), retryable: 1 })
      })
      .finally(() => { creates.delete(jobId); emitJob(jobId) })
    creates.set(jobId, { ctl, done })
  }

  function retryAction(r: JobRow): void {
    if (r.status === 'running' || r.status === 'queued') return
    const entry = r.creator ? resolveAction(r.creator) : null
    if (!entry) { update(r.id, { status: 'failed', error: '动作所在的插件已不可用', retryable: 0 }); emitJob(r.id); return }
    let p: ActionParams
    try { p = JSON.parse(r.params_json ?? '{}') as ActionParams } catch { p = { ids: [] } }
    let selection: AssetSummary[]
    try { selection = actionSelection(entry, p.ids ?? []) }
    catch (e) { update(r.id, { status: 'failed', error: errMessage(e), retryable: 0 }); emitJob(r.id); return }
    update(r.id, { status: 'running', attempts: r.attempts + 1, error: null, progress: 0, message: null })
    launchAction(r.id, entry, p, selection, r.by ?? 'user:unnamed')
    emitJob(r.id)
  }

  /* ───────────── render worker ───────────── */

  const refsKey = (refs: readonly string[]): string => [...refs].sort().join(',')
  /** The plugin (id@version) a render is made for: part of its cache key. */
  const renderPlugin = (a: AssetRow): string => { const f = loadedFormat(a); return `${f?.pluginId ?? a.plugin ?? 'unknown'}@${f?.pluginVersion ?? '0.0.0'}` }

  /** A render that is already in the cache for the current key (synced from another machine): use it, no browser. */
  async function completeFromCache(job: JobRow, a: AssetRow, refs: string[]): Promise<boolean> {
    const f = loadedFormat(a)
    if (!f) return false
    const stage = job.stage as PipelineStage
    const base = { hash: a.hash, refs, plugin: f.pluginId, version: f.pluginVersion, stage }
    const plugin = `${f.pluginId}@${f.pluginVersion}`
    if (stage === 'thumbnail') {
      const hit = cached(a.id, base, RENDER_PARTS.filter(v => v !== 'turnaround'))
      if (!hit.thumb) return false
      cache.retain(a.id, 'thumbnail', Object.keys(hit))
      await deps.applyThumbnails(a.id, hit, a.aspect)
    } else {
      const hit = cached(a.id, base, RENDER_PARTS)
      if (Object.keys(hit).length === 0) return false
    }
    update(job.id, { status: 'skipped', run_after: 0, params_json: null, plugin })
    recordState(a.id, stage, a.hash, refs, plugin)
    emitJob(job.id)
    log.info('render taken from the synced cache', { asset: a.id, stage })
    return true
  }

  /** Merge tech read in the browser into the index (FBX's full info); true when a value changed. */
  async function mergeTech(a: AssetRow, pluginId: string, extra: Record<string, number | string | boolean>): Promise<boolean> {
    const tech: Record<string, number | string | boolean> = {}
    for (const r of prep('SELECT key, num, txt FROM tech WHERE asset_id = ?').all(a.id) as Array<{ key: string; num: number | null; txt: string | null }>) {
      if ((r.txt === 'true' || r.txt === 'false') && (r.num === 1 || r.num === 0)) tech[r.key] = r.txt === 'true'
      else if (r.num != null) tech[r.key] = r.num
      else if (r.txt != null) tech[r.key] = r.txt
    }
    const probe = prep('SELECT refs_json, text FROM probe WHERE asset_id = ?').get(a.id) as { refs_json: string | null; text: string | null } | undefined
    const analysis = prep('SELECT json FROM analysis WHERE asset_id = ? AND plugin = ?').pluck().get(a.id, pluginId) as string | undefined
    const parse = <T>(raw: string | null | undefined): T | undefined => { try { return raw ? (JSON.parse(raw) as T) : undefined } catch { return undefined } }
    const refs = parse<string[]>(probe?.refs_json)
    const an = parse<Record<string, unknown>>(analysis)
    const result: ProbeResult = {
      tech: { ...tech, ...extra },
      ...(a.badge ? { badge: a.badge } : {}),
      ...(an ? { analysis: an } : {}),
      ...(refs ? { references: refs } : {}),
      ...(probe?.text ? { text: probe.text } : {}),
      auxiliary: a.auxiliary !== 0,
      ...(a.aspect != null ? { aspect: a.aspect } : {})
    }
    const changed = Object.entries(extra).some(([k, v]) => tech[k] !== v)
    if (changed) await deps.applyProbe(a.id, pluginId, result)
    return changed
  }

  /* ───────────── the Pipeline ───────────── */

  const pipeline: PipelineImpl = {
    start() {
      if (started) return
      started = true
      stopped = false
      shuttingDown = false
      prep("UPDATE jobs SET status = 'queued', updated_at = ? WHERE kind = 'process' AND status = 'running'").run(now())
      prep("UPDATE jobs SET run_after = 0 WHERE kind = 'process' AND status = 'queued' AND run_after > 0").run()
      prep("UPDATE jobs SET run_after = 0 WHERE status = 'waiting-renderer'").run()
      prep("UPDATE jobs SET status = 'failed', error = '服务重启，任务中断', retryable = 1, updated_at = ? WHERE kind IN ('create', 'action') AND status IN ('queued', 'running')").run(now())
      rebuildCounters()
      try { findStale() } catch (e) { log.error('stale scan failed', { error: errMessage(e) }) }
      track(findStaleReferences().catch(e => log.warn('reference check failed', { error: errMessage(e) })))
      if (cleanInterval > 0) {
        const clean = (): void => { void cleanWith(DAY).catch(e => log.warn('cache cleanup failed', { error: errMessage(e) })) }
        cleanTimer = setInterval(clean, cleanInterval)
        cleanTimer.unref?.()
        // The first cleanup runs once the start-up scan has finished (the index then knows every asset).
        offScan?.()
        offScan = events.on(library.id, (type, data) => {
          const d = data as { running?: boolean; phase?: string }
          if (type !== 'scan.progress' || d.running || d.phase !== 'done') return
          offScan?.()
          offScan = null
          clean()
        })
      }
      schedulePump()
    },

    async stop() {
      stopped = true
      shuttingDown = true
      if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null }
      if (cleanTimer) { clearInterval(cleanTimer); cleanTimer = null }
      if (completionTimer) { clearTimeout(completionTimer); completionTimer = null }
      offScan?.()
      offScan = null
      offPlugins()
      offCleared()
      for (const c of creates.values()) c.ctl.abort()
      const all = [...running.values(), ...[...creates.values()].map(c => c.done)]
      await Promise.race([Promise.allSettled(all), new Promise(r => setTimeout(r, 10_000).unref?.())])
      started = false
    },

    enqueue(id, stages, o = {}) {
      const list = stages === 'all' ? [...PIPELINE_STAGES] : PIPELINE_STAGES.filter(s => stages.includes(s))
      if (list.length === 0) return
      const priority = o.priority ?? (o.reason && BACKLOG_REASONS.has(o.reason) ? PRIORITY.backlog : PRIORITY.recent)
      addPending([{ id, stages: list, priority }])
      schedulePump()
    },

    forget(id) {
      const keep = pending.filter(it => it.id !== id)
      if (keep.length !== pending.length) { const all = takePending(pending.length); addPending(all.filter(it => it.id !== id)) }
      forgetNow(id)
      processing.delete(id)
    },

    yieldToScan(on) {
      if (scanYield === on) return
      scanYield = on
      if (!on) schedulePump()
    },

    markVisible(ids) {
      if (!ids.length) return
      const visible = new Set(ids)
      for (const it of pending) if (visible.has(it.id)) it.priority = Math.max(it.priority, PRIORITY.visible)
      prep("UPDATE jobs SET priority = MAX(priority, ?) WHERE asset_id IN (SELECT value FROM json_each(?)) AND status IN ('queued', 'waiting-renderer')")
        .run(PRIORITY.visible, JSON.stringify(ids))
      schedulePump()
    },

    overview(): JobsResponse {
      // Never writes the backlog first (that can be 800 000 rows right after a first open): pending work is added
      // from its tallies — queued per stage, and every pending asset counted as busy.
      // Another connection committed (it would have bypassed the counters): recount.
      if ((db.pragma('data_version', { simple: true }) as number) !== countersVersion) rebuildCounters()
      const count = (kind: string, stage: string, status: string): number => Math.max(0, jobCounts.get(`${kind}|${stage}|${status}`) ?? 0)
      const formats = plugins.formats()
      const handles: Record<PipelineStage, boolean> = {
        identify: formats.some(f => f.handler),
        probe: formats.some(f => f.handler?.probe),
        derive: formats.some(f => f.handler?.derive),
        thumbnail: formats.some(f => f.contribution.thumbnail === 'browser' || f.handler?.thumbnail),
        summary: formats.some(f => f.contribution.thumbnail === 'browser' || f.handler?.summarize),
        enrich: plugins.enrichers().length > 0,
        validate: plugins.validators().length > 0,
        index: plugins.searchProviders().length > 0
      }
      const t = Date.now()
      const stages: StageStats[] = PIPELINE_STAGES.map(stage => {
        const n = (status: string): number => count('process', stage, status)
        const recent = (completions.get(stage) ?? []).filter(x => t - x <= RATE_WINDOW_MS).length
        return { stage, queued: n('queued') + Math.max(0, pendingStages.get(stage) ?? 0), running: n('running'), done: n('done'), failed: n('failed'), skipped: n('skipped'), rate: recent / (RATE_WINDOW_MS / 60_000), idle: !handles[stage] }
      })
      const waitingRender = waitingByAsset.size
      const busyAssetCount = activeByAsset.size
      const runningCreates = ['create', 'action'].reduce((sum, k) => sum + count(k, '', 'queued') + count(k, '', 'running'), 0)
      const rows = (sql: string): JobInfo[] => (prep(sql).all() as JobRow[]).map(info)
      return {
        stages,
        waitingRender,
        busy: busyAssetCount + pendingAssetCount() + runningCreates,
        scan: { running: false, phase: 'idle', done: 0, total: 0 },
        failed: rows("SELECT * FROM jobs INDEXED BY q_jobs_failed WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 200"),
        creates: rows("SELECT * FROM jobs INDEXED BY q_jobs_runs WHERE kind IN ('create', 'action') ORDER BY created_at DESC LIMIT 50"),
        processing: rows("SELECT * FROM jobs WHERE kind = 'process' AND status = 'running' ORDER BY updated_at DESC LIMIT 100")
      }
    },

    job(id) {
      const r = getJob(id)
      return r ? info(r) : null
    },

    cancel(id) {
      const r = getJob(id)
      if (!r) throw new CoreError('not_found', '没有这个任务')
      if (r.kind === 'create' || r.kind === 'action') {
        if (r.status === 'queued' || r.status === 'running') {
          update(id, { status: 'cancelled' })
          creates.get(id)?.ctl.abort()
          emitJob(id)
        }
        return
      }
      if (r.status === 'running') { cancelledRunning.add(id); return }
      if (r.status === 'queued' || r.status === 'waiting-renderer' || r.status === 'failed') {
        update(id, { status: 'cancelled' })
        emitJob(id)
        if (r.asset_id) void settleAsset(r.asset_id)
      }
    },

    retry(req) {
      flush()
      const requeue = (rows: JobRow[]): void => {
        const at = now()
        for (const r of rows) {
          if (r.kind === 'create') { retryCreate(r); continue }
          if (r.kind === 'action') { retryAction(r); continue }
          if (r.status === 'running' || r.status === 'queued') continue
          prep("UPDATE jobs SET status = 'queued', attempts = 0, run_after = 0, priority = MAX(priority, ?), created_at = ?, updated_at = ? WHERE id = ?")
            .run(PRIORITY.recent, at, at, r.id)
          bump(r, -1)
          bump({ ...r, status: 'queued' }, 1)
          emitJob(r.id)
        }
      }
      if (req.jobIds?.length) {
        requeue(prep('SELECT * FROM jobs WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(req.jobIds)) as JobRow[])
      }
      if (req.assetIds?.length) {
        for (const id of req.assetIds) {
          if (req.stage) addPending([{ id, stages: [req.stage], priority: PRIORITY.recent }])
          else if (req.failed) {
            requeue(prep("SELECT * FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? AND status = 'failed'").all(id) as JobRow[])
          } else addPending([{ id, stages: [...PIPELINE_STAGES], priority: PRIORITY.recent }])
        }
      } else if (req.failed || (req.stage && !req.jobIds?.length)) {
        // Bulk retry of failed jobs (only those a retry can help).
        const rows = prep(`SELECT * FROM jobs WHERE status = 'failed' AND retryable = 1 ${req.stage ? 'AND stage = ?' : ''}`).all(...(req.stage ? [req.stage] : [])) as JobRow[]
        requeue(rows)
      }
      schedulePump()
    },

    async startCreate(creatorId: string, req: { params: unknown; inputs: Array<{ role: string; id: Guid }>; folder?: string }, ctx: CallContext): Promise<JobInfo> {
      const entry = resolveCreator(creatorId)
      if (!entry) throw new CoreError('not_found', `没有这个创建方式：${creatorId}`)
      const inputs = resolveInputs(entry, req.inputs ?? [])
      const id = uuidv7()
      const at = now()
      prep(`INSERT INTO jobs (id, kind, creator, plugin, status, priority, attempts, progress, params_json, by, created_at, updated_at, run_after)
        VALUES (?, 'create', ?, ?, 'running', ?, 0, 0, ?, ?, ?, ?, 0)`)
        .run(id, `${entry.pluginId}:${entry.creator.id}`, entry.pluginId, PRIORITY.visible, JSON.stringify({ params: req.params ?? null, inputs: req.inputs ?? [], ...(req.folder !== undefined ? { folder: req.folder } : {}) }), ctx.actor, at, at)
      bump({ kind: 'create', stage: null, status: 'running', asset_id: null }, 1)
      log.info('write', { op: 'create.start', job: id, creator: creatorId, by: ctx.actor })
      launchCreate(id, entry, { params: req.params, inputs: req.inputs ?? [], ...(req.folder !== undefined ? { folder: req.folder } : {}) }, inputs, ctx.actor)
      emitJob(id)
      return info(getJob(id)!)
    },

    async startAction(actionId: string, req: { ids: Guid[]; params?: unknown }, ctx: CallContext): Promise<JobInfo> {
      const entry = resolveAction(actionId)
      if (!entry) throw new CoreError('not_found', `没有这个动作：${actionId}`)
      const ids = [...new Set(req.ids ?? [])]
      const selection = actionSelection(entry, ids)
      const id = uuidv7()
      const at = now()
      const p: ActionParams = { ids, ...(req.params !== undefined ? { params: req.params } : {}) }
      prep(`INSERT INTO jobs (id, kind, creator, plugin, status, priority, attempts, progress, params_json, by, created_at, updated_at, run_after)
        VALUES (?, 'action', ?, ?, 'running', ?, 0, 0, ?, ?, ?, ?, 0)`)
        .run(id, `${entry.pluginId}:${entry.action.id}`, entry.pluginId, PRIORITY.visible, JSON.stringify(p), ctx.actor, at, at)
      bump({ kind: 'action', stage: null, status: 'running', asset_id: null }, 1)
      log.info('write', { op: 'action.start', job: id, action: actionId, by: ctx.actor, assets: ids.length })
      launchAction(id, entry, p, selection, ctx.actor)
      emitJob(id)
      return info(getJob(id)!)
    },

    async renderNext(visible: Guid[]): Promise<RenderTask | null> {
      for (let tries = 0; tries < 20; tries++) {
        const t = Date.now()
        const order = "ORDER BY (j.stage = 'thumbnail') DESC, j.priority DESC, j.created_at ASC, j.id ASC LIMIT 1"
        const base = "SELECT j.* FROM jobs j WHERE j.kind = 'process' AND j.status = 'waiting-renderer' AND j.run_after <= ?"
        const row = ((visible?.length ? prep(`${base} AND j.asset_id IN (SELECT value FROM json_each(?)) ${order}`).get(t, JSON.stringify(visible)) : undefined)
          ?? prep(`${base} ${order}`).get(t)) as JobRow | undefined
        if (!row) return null
        // Lease before any await so two pages never take the same task; remember what is being rendered (P2-8).
        update(row.id, { run_after: t + leaseMs })
        const a = assetRow(row.asset_id!)
        if (!a) { deleteJobs('DELETE FROM jobs WHERE id = ?', row.id); continue }
        const refs = await deps.referencedHashes(a.id)
        if (await completeFromCache(row, a, refs)) continue
        update(row.id, { params_json: JSON.stringify({ lease: { hash: a.hash, refs: refsKey(refs), plugin: renderPlugin(a) } }) })
        const detail = await deps.assetDetail(row.asset_id!)
        if (!detail) { deleteJobs('DELETE FROM jobs WHERE id = ?', row.id); continue }
        const f = loadedFormat(a)
        return { job: row.id, assetId: a.id, kind: row.stage === 'summary' ? 'summary' : 'thumbnail', format: a.format, plugin: f?.pluginId ?? a.plugin ?? '', asset: detail }
      }
      return null
    },

    async renderSubmit(jobId, parts, fields) {
      const row = getJob(jobId)
      if (!row || row.kind !== 'process' || !row.asset_id) throw new CoreError('not_found', '没有这个渲染任务')
      // Re-queued while the browser rendered (content or references changed): this result is for old content.
      if (row.status === 'queued' || row.status === 'running') { log.info('render result dropped: task re-queued', { job: jobId }); return }
      if (row.status !== 'waiting-renderer') throw new CoreError('conflict', '这个渲染任务已经完成或取消')
      const a = assetRow(row.asset_id)
      if (!a) { deleteJobs('DELETE FROM jobs WHERE id = ?', jobId); throw new CoreError('not_found', '资产已经不在了') }
      const stage = row.stage as PipelineStage
      const f = loadedFormat(a)
      const pluginId = f?.pluginId ?? a.plugin ?? 'unknown'
      const version = f?.pluginVersion ?? '0.0.0'
      const refs = await deps.referencedHashes(a.id)
      let lease: { hash?: string; refs?: string; plugin?: string | null } | undefined
      try { lease = (JSON.parse(row.params_json ?? '{}') as { lease?: typeof lease }).lease } catch { lease = undefined }
      if (!lease) { log.info('render result dropped: no lease (task handed out again)', { job: jobId }); return }
      if (lease.hash !== a.hash || lease.refs !== refsKey(refs) || lease.plugin !== renderPlugin(a)) {
        // The content, its references or the plugin changed after the task was handed out: never store this render
        // under the new content's key; render again (P2-8).
        update(jobId, { params_json: null, run_after: 0 })
        addPending([{ id: a.id, stages: [stage], priority: PRIORITY.recent }])
        schedulePump()
        log.info('render result dropped: content changed since the task was handed out', { job: jobId, asset: a.id })
        return
      }
      if (fields.error) {
        const retryable = fields.retryable !== false
        const attempts = row.attempts + 1
        if (retryable && attempts <= MAX_RETRIES) {
          // Retry automatically, with growing intervals, like any other stage (P2-15).
          const delay = retryDelays[Math.min(attempts - 1, retryDelays.length - 1)] ?? 0
          update(jobId, { attempts, error: fields.error, retryable: 1, run_after: Date.now() + delay, params_json: null })
          const wake = setTimeout(() => emitJob(jobId), delay + 1)
          wake.unref?.()
          log.info('render failed; will retry', { job: jobId, attempt: attempts, delayMs: delay, error: fields.error })
          return
        }
        update(jobId, { status: 'failed', attempts, error: fields.error, retryable: retryable ? 1 : 0, run_after: 0, params_json: null })
        await raiseFailure(a.id, stage, fields.error)
        if (stage === 'thumbnail') await safe('setThumbState', () => setThumbState(a, 'failed'))
        emitJob(jobId)
        return
      }
      const stored: Partial<Record<ThumbVariant, StoredThumb>> = {}
      const thumbStage: string[] = []
      for (const [variant, data] of Object.entries(parts) as Array<[ThumbVariant, Uint8Array | undefined]>) {
        if (!data || !data.byteLength || !(THUMB_VARIANTS as readonly string[]).includes(variant)) continue
        // The four-angle sheet is the agent summary image: it lives in the summary stage whichever task delivered it.
        const target: PipelineStage = stage === 'thumbnail' && variant !== 'turnaround' ? 'thumbnail' : 'summary'
        stored[variant] = await cache.write(a.id, target, variant, cacheKey({ hash: a.hash, refs, plugin: pluginId, version, stage: target, variant }), extFor(variant), data)
        if (target === 'thumbnail') thumbStage.push(variant)
      }
      const plugin = `${pluginId}@${version}`
      if (stage === 'thumbnail') {
        cache.retain(a.id, 'thumbnail', thumbStage)
        await deps.applyThumbnails(a.id, stored, fields.aspect ?? null)
      }
      // Tech read in the browser (FBX's full info, bounding box): a changed value re-runs the checks (K2).
      if (fields.tech && Object.keys(fields.tech).length && (await mergeTech(a, pluginId, fields.tech))) {
        addPending([{ id: a.id, stages: ['validate'], priority: PRIORITY.recent }])
        schedulePump()
      }
      update(jobId, { status: 'done', error: null, plugin, run_after: 0, params_json: null })
      recordState(a.id, stage, a.hash, refs, plugin)
      if (row.error) await clearFailure(a.id, stage, row.error)
      noteCompletion(stage)
      emitJob(jobId)
      if (stage === 'thumbnail' && stored.turnaround) {
        for (const s of prep("SELECT id FROM jobs INDEXED BY jobs_asset WHERE kind = 'process' AND asset_id = ? AND stage = 'summary' AND status = 'waiting-renderer'").pluck().all(a.id) as string[]) {
          update(s, { status: 'done', plugin, run_after: 0 })
          recordState(a.id, 'summary', a.hash, refs, plugin)
          emitJob(s)
        }
      }
      log.info('write', { op: 'render.submit', asset: a.id, stage, parts: Object.keys(stored) })
    },

    thumbnailFile(id, variant) { return cache.file(id, variant) },

    async cacheStats(): Promise<CacheResponse> {
      const { bytes, files } = await cache.stats()
      const rel = path.relative(library.paths.root, library.paths.cacheDir)
      return { bytes, files, dir: library.paths.cacheDir, inLibrary: !rel.startsWith('..') && !path.isAbsolute(rel) }
    },

    async cleanCache(all: boolean): Promise<CacheCleanResponse> {
      flush()
      if (!all) {
        const r = await cleanWith(MANUAL_GRACE_MS)
        log.info('write', { op: 'cache.clean', ...r })
        return r
      }
      const r = await cache.clear()
      prep("DELETE FROM pipeline_stages WHERE stage IN ('derive', 'thumbnail', 'summary')").run()
      for (const row of prep("SELECT id, thumb_manual, thumb_state FROM assets WHERE missing = 0").all() as Array<{ id: string; thumb_manual: number; thumb_state: string }>) {
        if (!row.thumb_manual && row.thumb_state !== 'none') await safe('setThumbState', () => deps.setThumbState(row.id, 'pending'))
        addPending([{ id: row.id, stages: ['derive', 'thumbnail', 'summary'], priority: PRIORITY.backlog }])
      }
      schedulePump()
      log.info('write', { op: 'cache.clear', ...r })
      return r
    },

    async idle() {
      for (;;) {
        flush()
        const busyNow = running.size > 0 || creates.size > 0 || pending.length > 0 || background.size > 0
        if (!busyNow && (!started || !prep("SELECT 1 FROM jobs WHERE status IN ('queued', 'running') LIMIT 1").get())) return
        await new Promise(r => setTimeout(r, 5))
      }
    },

    summaryImage(assetId) {
      for (const variant of ['turnaround', 'thumb'] as const) {
        const p = cache.file(assetId, variant, variant === 'turnaround' ? 'summary' : 'thumbnail')
        if (p) return { variant, path: p }
      }
      return null
    },

    async summaryText(assetId) {
      const data = await cache.read(assetId, 'summary', 'text')
      if (!data) return null
      try { return (JSON.parse(new TextDecoder().decode(data)) as { text?: string }).text ?? null } catch { return null }
    }
  }

  function resolveInputs(entry: CreatorEntry, given: Array<{ role: string; id: Guid }>): Array<{ role: string; asset: AssetSummary }> {
    for (const spec of entry.creator.inputs ?? []) {
      if (spec.required && !given.some(i => i.role === spec.role)) throw new CoreError('validation_failed', `缺少输入：${spec.role}`, { role: spec.role })
    }
    const summaries = new Map(query.summaries(given.map(i => i.id)).map(s => [s.id, s]))
    return given.map(i => {
      const asset = summaries.get(i.id)
      if (!asset) throw new CoreError('not_found', `输入的资产不存在：${i.id}`, { id: i.id })
      return { role: i.role, asset }
    })
  }

  function retryCreate(r: JobRow): void {
    if (r.status === 'running' || r.status === 'queued') return
    const entry = r.creator ? resolveCreator(r.creator) : null
    if (!entry) { update(r.id, { status: 'failed', error: '创建插件已不可用', retryable: 0 }); emitJob(r.id); return }
    let p: CreateParams
    try { p = JSON.parse(r.params_json ?? '{}') as CreateParams } catch { p = { params: null, inputs: [] } }
    let inputs: Array<{ role: string; asset: AssetSummary }>
    try { inputs = resolveInputs(entry, p.inputs ?? []) }
    catch (e) { update(r.id, { status: 'failed', error: errMessage(e), retryable: 0 }); emitJob(r.id); return }
    update(r.id, { status: 'running', attempts: r.attempts + 1, error: null, progress: 0, message: null, action_json: null })
    launchCreate(r.id, entry, p, inputs, r.by ?? 'user:unnamed')
    emitJob(r.id)
  }

  return pipeline
}
