/**
 * Scanner and reconciliation (sync-and-integrity.md「扫描器」「对账规则」R1–R12).
 *
 * A scan walks one or more scopes, hashes only files whose size or mtime changed (files table), sorts the disk
 * into three states (asset with sidecar, file without sidecar, sidecar without file) and reconciles them with the
 * index. R11/R12 (broken / stale relations) and R3 (duplicate content) are derived by integrity afterwards.
 */
import path from 'node:path'
import {
  FOLDER_META_NAME, IGNORE_FILE, LIBRARY_DIR, SCANNER_ACTOR, SIDECAR_SUFFIX, dirOf, joinPath, serializeBmeta,
  type Bmeta, type Guid, type ScanProgress
} from '@bowerbird/schema'
/**
 * What a scan keeps per sidecar. `same`: the sidecar was still the one the index holds (same mtime and the exact size
 * of what we would write) — the stat seen then, so reconciliation can skip reading it again if it has not moved since.
 */
type SideInfo = { ok: true; id: Guid; same?: { mtimeMs: number; size: number } } | { ok: false; error: string }
import { canonicalMetaJson, parkedPath, PARKED_PREFIX, type AssetRow } from '../index/store.js'
import { IDENTITY_FIELD, issueId, type IdentityNote } from '../integrity/index.js'
import { isUnder, relOf } from '../library/paths.js'
import { nowIso, type LibraryCore } from '../model/core.js'
import { LibraryWatcher, type WatchMode, type WatchState } from './watch.js'

export interface Scope { folder: string; recursive: boolean }

interface FileInfo { path: string; isDir: boolean; size: number; mtimeMs: number; birthtimeMs: number; hash: string }

export interface ScannerOptions {
  /** A file must keep its size and mtime this long before it is processed (default 2000 ms). */
  stableMs?: number
  /** Minutes between periodic full scans (MachineConfig.scanIntervalMinutes). */
  intervalMinutes?: () => number
  /** Before the first registration, the library has no library.json: report phase `registering`. */
  registering?: () => boolean
  /** Called after each scan with the ids it touched (pipeline, events). */
  onScanned?: (touched: Set<Guid>) => void
  /** Hook run at the start of a full scan (load records and trash into the index). */
  beforeFull?: () => Promise<void>
  /** Hook run after a full scan (plugin-missing, trash expiry). */
  afterFull?: () => Promise<void>
  /**
   * A full scan starts working (true) and stops (false) — not while it only waits to look again at files still being
   * written. The pipeline yields meanwhile (pipeline-and-cache.md「扫描时让路」).
   */
  onFullBusy?: (busy: boolean) => void
  /**
   * Whether the folder is really there (an unmounted NAS must not turn every asset into「文件缺失」).
   * A scan is skipped when this says no.
   */
  canScan?: () => Promise<boolean>
  /** How to watch the folder (default auto: native recursive on macOS / Windows, per directory elsewhere). */
  watchMode?: WatchMode
  /** Per-directory watching stops beyond this many directories (default 20 000). */
  maxWatchDirs?: number
}

const CHUNK = 100
/** `BOWERBIRD_SCAN_MEMTRACE=1`: log memory at each step of a scan (finding peaks on large libraries). */
const MEMTRACE = process.env.BOWERBIRD_SCAN_MEMTRACE === '1'
const mb = (n: number) => Math.round(n / 1048576)
const yieldNow = () => new Promise<void>(r => setImmediate(r))

export class Scanner {
  progress: ScanProgress = { running: false, phase: 'idle', done: 0, total: 0 }
  private pending: Scope[] = []
  private loop: Promise<void> | null = null
  private stopFlag = false
  private watcher: LibraryWatcher | null = null
  /** Whether the folder is being watched, and why not (library info). */
  watchState: WatchState = { enabled: false, mode: 'off', reason: '还没有开始监听' }
  private timer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  /** What the pending retry for files still being written will scan, and its waiters (idle()). */
  private retryScopes: Scope[] = []
  private retryWait: { promise: Promise<void>; resolve: () => void } | null = null
  /** A file the pending retry waits for (progress.current meanwhile). */
  private waitingOn: string | undefined
  /** Files skipped as still being written, with the stat seen then (see settled()). */
  private unstableSeen = new Map<string, { size: number; mtimeMs: number; at: number }>()
  private debounce: NodeJS.Timeout | null = null
  private watchScopes = new Map<string, boolean>()
  private lastEmit = 0
  private closed = false

  constructor(private readonly core: LibraryCore, private readonly o: ScannerOptions = {}) {
    // with the memory trace on, also sample every 2 s (what happens after the scan: pipeline, plugins)
    if (MEMTRACE) { const t = setInterval(() => this.mem('tick'), 2000); t.unref?.() }
  }

  private get stableMs(): number { return this.o.stableMs ?? 2000 }

  private mem(step: string): void {
    if (!MEMTRACE) return
    const m = process.memoryUsage()
    this.core.log.info('scan memory', { step, rss: mb(m.rss), heapUsed: mb(m.heapUsed), heapTotal: mb(m.heapTotal), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers) })
  }

  /* ───────────── queue ───────────── */

  /** Queue a scan (full = root, recursive) and resolve when the queue has drained past it. */
  scan(scopes: Scope[] | 'full' = 'full'): Promise<void> {
    if (this.closed) return Promise.resolve()
    const list = scopes === 'full' ? [{ folder: '', recursive: true }] : scopes
    this.pending.push(...list)
    this.stopFlag = false
    if (!this.loop) {
      this.loop = (async () => {
        try {
          while (this.pending.length && !this.closed) {
            const batch = mergeScopes(this.pending.splice(0))
            await this.runScan(batch)
          }
        } finally { this.loop = null }
      })()
    }
    return this.loop
  }

  /** Stop the running scan at the next checkpoint; queued scopes are dropped (the next scan continues). */
  async stop(): Promise<void> {
    this.stopFlag = true
    this.pending = []
    this.cancelRetry()
    if (this.loop) await this.loop.catch(() => {})
    // a scan that was only waiting for its retry ends here
    if (this.progress.running) this.finish('stopped')
  }

  /** Resolves when no scan runs or is queued and no retry for files still being written is pending. */
  async idle(): Promise<void> {
    for (;;) {
      if (this.loop) await this.loop
      else if (this.retryWait) await this.retryWait.promise
      else return
    }
  }

  /* ───────────── watcher & timer ───────────── */

  /**
   * Watch the folder at a cost that does not grow with the number of files (see watch.ts). Events only name a path;
   * it is stat'ed here and scanned with the usual stability window (files changed in the last 2 s wait).
   */
  async startWatching(): Promise<WatchState> {
    if (this.watcher || this.closed) return this.watchState
    const fs = this.core.fs
    this.watcher = new LibraryWatcher({
      root: fs.root,
      ...(this.o.watchMode ? { mode: this.o.watchMode } : {}),
      ...(this.o.maxWatchDirs ? { maxDirs: this.o.maxWatchDirs } : {}),
      skipDir: rel => fs.ignored(rel, true),
      onChange: rel => this.onWatchEvent(rel),
      onError: e => this.core.log.warn('watcher error', { error: String(e) }),
      onState: s => {
        this.watchState = s
        this.core.log.warn('stopped watching the library folder', { reason: s.reason, dirs: s.dirs })
        this.core.emit('library.updated', { fields: ['watch'] })
      }
    })
    this.watchState = await this.watcher.start()
    if (!this.watchState.enabled) this.core.log.warn('not watching the library folder', { reason: this.watchState.reason, dirs: this.watchState.dirs })
    return this.watchState
  }

  private onWatchEvent(relIn: string | null): void {
    if (this.closed) return
    if (relIn === null || relIn === '') { this.queueWatch('', true); return }
    const rel = relIn.replace(/^\/+|\/+$/g, '')
    if (rel === LIBRARY_DIR || rel.startsWith(LIBRARY_DIR + '/')) return
    if (this.core.expected.has(rel)) return
    if (rel === IGNORE_FILE) { this.core.fs.reloadIgnore(); this.queueWatch('', true); return }
    const base = path.posix.basename(rel)
    if (base === FOLDER_META_NAME) return
    if (!rel.endsWith(SIDECAR_SUFFIX) && this.core.fs.ignored(rel, false) && this.core.fs.ignored(rel, true)) return
    // what is it now? a folder (new / moved in) is scanned with everything below; a file or a vanished path
    // through its folder (a vanished folder also needs its own subtree checked)
    void this.core.fs.stat(rel).then(st => {
      if (st?.isDir) { this.queueWatch(rel, true); this.queueWatch(dirOf(rel), false) }
      else if (st) this.queueWatch(dirOf(rel), false)
      else { this.queueWatch(dirOf(rel), false); if (!rel.endsWith(SIDECAR_SUFFIX)) this.queueWatch(rel, true) }
    }).catch(() => this.queueWatch(dirOf(rel), false))
  }

  private queueWatch(folder: string, recursive: boolean): void {
    this.watchScopes.set(folder, (this.watchScopes.get(folder) ?? false) || recursive)
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      const scopes = [...this.watchScopes].map(([f, r]) => ({ folder: f, recursive: r }))
      this.watchScopes.clear()
      void this.scan(scopes).catch(e => this.core.log.error('watch scan failed', { error: String(e) }))
    }, 400)
  }

  startTimer(): void {
    if (this.timer || this.closed) return
    const minutes = Math.max(1, this.o.intervalMinutes?.() ?? 10)
    this.timer = setInterval(() => { void this.scan('full').catch(() => {}) }, minutes * 60_000)
    this.timer.unref?.()
  }

  async close(): Promise<void> {
    this.closed = true
    this.stopFlag = true
    this.cancelRetry()
    for (const t of [this.timer, this.debounce]) if (t) clearTimeout(t)
    this.timer = this.debounce = null
    if (this.watcher) { this.watcher.close(); this.watcher = null }
    if (this.loop) await this.loop.catch(() => {})
  }

  /* ───────────── progress ───────────── */

  private setProgress(p: Partial<ScanProgress>, force = false): void {
    this.progress = { ...this.progress, ...p }
    const t = Date.now()
    if (!force && t - this.lastEmit < 200) return
    this.lastEmit = t
    this.core.emit('scan.progress', { ...this.progress })
  }

  /* ───────────── one scan ───────────── */

  /** A scope at or inside a bundle becomes the bundle's parent folder: bundle internals are never claimed. */
  private async normalizeScopes(scopes: Scope[]): Promise<Scope[]> {
    const out: Scope[] = []
    for (const s of scopes) {
      let bundle: string | null = null
      for (let f = s.folder; f; f = dirOf(f)) {
        if (this.core.store.rowByPath(f)?.bundle || (await this.core.fs.exists(f + SIDECAR_SUFFIX))) bundle = f
      }
      out.push(bundle !== null ? { folder: dirOf(bundle), recursive: false } : s)
    }
    return mergeScopes(out)
  }

  private async runScan(scopesIn: Scope[]): Promise<void> {
    const core = this.core
    const scopes = await this.normalizeScopes(scopesIn)
    const full = scopes.some(s => s.folder === '' && s.recursive)
    if (this.o.canScan && !(await this.o.canScan())) {
      core.log.warn('scan skipped: library folder unavailable', { root: core.fs.root })
      if (this.progress.running) this.finish('stopped')
      return
    }
    const registering = this.o.registering?.() ?? false
    // still running = this pass continues a scan that was waiting for its retry: same start
    const startedAt = this.progress.running && this.progress.startedAt ? this.progress.startedAt : nowIso()
    this.setProgress({ running: true, phase: 'walking', done: 0, total: 0, startedAt, finishedAt: undefined, current: undefined }, true)
    if (full) this.o.onFullBusy?.(true)
    try {
      if (full && this.o.beforeFull) await this.o.beforeFull()

      /* 1. walk */
      const files = new Map<string, boolean>() // path → isDir
      const sidecars = new Set<string>()
      for (const s of scopes) await this.walk(s.folder, s.recursive, files, sidecars)
      if (this.stopFlag) return this.finish('stopped')

      this.mem('walked')
      /* 2. stat + hash (only changed files) */
      this.setProgress({ phase: 'hashing', total: files.size, done: 0 }, true)
      const present = new Map<string, FileInfo>()
      let unstable = false
      let done = 0
      for (const [p, isDir] of files) {
        if (this.stopFlag) return this.finish('stopped')
        const st = await core.fs.contentStat(p)
        done++
        if (!st) continue
        if (this.stableMs > 0 && Date.now() - st.mtimeMs < this.stableMs && !this.settled(p, st)) { unstable = true; this.waitingOn ??= p; continue }
        if (this.unstableSeen.size) this.unstableSeen.delete(p)
        const cached = core.store.file(p)
        let hash = cached && cached.size === st.size && cached.mtime_ms === st.mtimeMs ? cached.hash : null
        if (!hash) {
          this.setProgress({ done, current: p })
          try { hash = await core.fs.hash(p) } catch (e) { core.log.warn('hash failed', { path: p, error: String(e) }); continue }
          core.store.setFile(p, st.size, st.mtimeMs, hash)
        }
        present.set(p, { path: p, isDir, size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, hash })
        if (done % 50 === 0) this.setProgress({ done })
      }
      if (full && this.unstableSeen.size) for (const k of this.unstableSeen.keys()) if (!files.has(k)) this.unstableSeen.delete(k)
      if (unstable) this.retryLater(scopes)

      this.mem('hashed')
      /* 3. reconcile */
      this.setProgress({ phase: registering ? 'registering' : 'reconciling', done: 0, total: new Set([...present.keys(), ...sidecars]).size }, true)
      const touched = await this.reconcile(scopes, present, sidecars, files)
      this.mem('reconciled')
      if (full && this.o.afterFull) await this.o.afterFull()
      this.mem('after-full')
      this.o.onScanned?.(touched)
      this.finish(this.stopFlag ? 'stopped' : 'done')
    } catch (e) {
      core.log.error('scan failed', { error: String((e as Error)?.stack ?? e) })
      this.finish('done')
      throw e
    } finally {
      if (full) this.o.onFullBusy?.(false)
    }
  }

  private finish(phase: 'done' | 'stopped'): void {
    // files still being written (a retry is pending) or another queued scan: this pass is not the end of the
    // scan, so nobody is told `done` yet; it stays running in its current phase until the retry has run
    if (phase === 'done' && !this.closed && (this.retryTimer || this.pending.length)) {
      this.setProgress({ running: true, current: this.waitingOn }, true)
      return
    }
    this.waitingOn = undefined
    this.setProgress({ running: false, phase, finishedAt: nowIso(), current: undefined }, true)
  }

  /**
   * A file inside the stability window by the clock still counts as written once it has kept the same size and
   * mtime for a whole window: an mtime in the future (a skewed clock, a copied date) never leaves the window.
   */
  private settled(p: string, st: { size: number; mtimeMs: number }): boolean {
    const now = Date.now()
    const seen = this.unstableSeen.get(p)
    if (seen && seen.size === st.size && seen.mtimeMs === st.mtimeMs) return now - seen.at >= this.stableMs
    this.unstableSeen.set(p, { size: st.size, mtimeMs: st.mtimeMs, at: now })
    return false
  }

  private retryLater(scopes: Scope[]): void {
    if (this.closed) return
    this.retryScopes.push(...scopes)
    if (!this.retryWait) {
      let resolve!: () => void
      const promise = new Promise<void>(r => { resolve = r })
      this.retryWait = { promise, resolve }
    }
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      const s = mergeScopes(this.retryScopes.splice(0))
      const wait = this.retryWait
      this.retryWait = null
      this.waitingOn = undefined
      void this.scan(s).catch(() => {})
      wait?.resolve() // idle() now waits for the scan loop
    }, this.stableMs + 200)
    this.retryTimer.unref?.()
  }

  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retryScopes = []
    this.waitingOn = undefined
    this.retryWait?.resolve()
    this.retryWait = null
  }

  private async walk(folder: string, recursive: boolean, files: Map<string, boolean>, sidecars: Set<string>): Promise<void> {
    const core = this.core
    if (folder && (core.fs.ignored(folder, true) || isUnder(folder, LIBRARY_DIR))) return
    const st = await core.fs.stat(folder)
    if (!st?.isDir) return
    // the scoped folder itself may be a bundle (rescan of a bundle path): treat the parent level
    const ents = await core.fs.readdir(folder)
    const names = new Set(ents.map(e => e.name))
    const subdirs: string[] = []
    for (const e of ents) {
      const rel = joinPath(folder, e.name)
      if (e.isFile()) {
        if (e.name.endsWith(SIDECAR_SUFFIX)) {
          if (e.name === FOLDER_META_NAME) continue
          const asset = rel.slice(0, -SIDECAR_SUFFIX.length)
          const assetName = e.name.slice(0, -SIDECAR_SUFFIX.length)
          const isDir = ents.some(x => x.name === assetName && x.isDirectory())
          if (!assetName || core.fs.ignored(asset, isDir)) continue
          sidecars.add(asset)
          continue
        }
        if (core.fs.ignored(rel, false)) continue
        files.set(rel, false)
      } else if (e.isDirectory()) {
        if (core.fs.ignored(rel, true)) continue
        if (folder === '' && e.name === LIBRARY_DIR) continue
        const bundle = names.has(e.name + SIDECAR_SUFFIX) || !!core.store.rowByPath(rel)?.bundle
        if (bundle) { files.set(rel, true); continue }
        subdirs.push(rel)
      }
    }
    if (recursive) for (const d of subdirs) await this.walk(d, true, files, sidecars)
  }

  /* ───────────── reconciliation ───────────── */

  private inScope(p: string, scopes: Scope[]): boolean {
    return scopes.some(s => (s.recursive ? isUnder(p, s.folder) : dirOf(p) === s.folder))
  }

  /**
   * What a scan remembers of a sidecar: its GUID, or why it cannot be read. The parsed content is read again where it
   * is used (inside the lock, ADR-046), so a 100 000-asset scan never holds every parsed sidecar at once.
   */
  private async sidecarId(p: string): Promise<SideInfo | null> {
    const core = this.core
    const st = await core.fs.stat(p + SIDECAR_SUFFIX)
    if (!st) return null
    const row = core.store.rowByPath(p)
    if (row && row.meta_mtime_ms === st.mtimeMs) {
      // unchanged since we last read (or wrote) it: same mtime and the exact size of what we would write
      try { if (Buffer.byteLength(serializeBmeta(core.store.meta(row))) === st.size) return { ok: true, id: row.id, same: { mtimeMs: st.mtimeMs, size: st.size } } } catch { /* fall through */ }
    }
    const r = await core.fs.readSidecar(p)
    if (!r) return null
    return r.ok ? { ok: true, id: r.meta.id } : { ok: false, error: r.error }
  }

  /** The parsed sidecar now (rare paths: copies, missing candidates, conflict details). */
  private async metaAt(p: string): Promise<Bmeta | null> {
    const r = await this.core.fs.readSidecar(p)
    return r?.ok ? r.meta : null
  }

  private async reconcile(scopes: Scope[], present: Map<string, FileInfo>, sidecarPaths: Set<string>, walked: Map<string, boolean>): Promise<Set<Guid>> {
    const core = this.core
    const store = core.store
    const touched = new Set<Guid>()
    const enqueueAll = new Set<Guid>()
    const contentChanged = new Set<Guid>()
    const handled = new Set<string>() // file paths already dealt with
    const conflictPaths = new Set<string>()
    const orphanPaths = new Set<string>()
    const fresh: FileInfo[] = []
    this.displaced.clear()

    // sidecars
    const side = new Map<string, SideInfo>()
    let read = 0
    for (const p of sidecarPaths) {
      const r = await this.sidecarId(p)
      if (r) side.set(p, r)
      if (++read % 2000 === 0) { this.setProgress({ current: p }); await yieldNow() }
    }
    this.mem('sidecars-read')
    const byId = new Map<Guid, string[]>()
    for (const [p, r] of side) if (r.ok) { const l = byId.get(r.id); if (l) l.push(p); else byId.set(r.id, [p]) }

    /** Missing-asset candidates: id → its last path, metadata, and where its orphan sidecar is (if any). */
    const missing = new Map<Guid, { path: string; meta: Bmeta; sidecar: string | null }>()
    const raiseCopyConflict = async (id: Guid, w: string, ownerPath: string) => {
      conflictPaths.add(w + SIDECAR_SUFFIX)
      const mine = (await this.metaAt(ownerPath)) ?? store.metaOf(id)
      const other = await this.metaAt(w)
      core.integrity.raise({
        id: issueId.conflict(w + SIDECAR_SUFFIX), type: 'metadata-conflict', assetId: id, path: ownerPath,
        details: {
          kind: 'copy', conflictPath: w + SIDECAR_SUFFIX, sidecarPath: ownerPath + SIDECAR_SUFFIX,
          localTags: mine?.tags ?? [], conflictTags: other?.tags ?? [],
          localModified: mine?.modified ?? mine?.created ?? null, conflictModified: other?.modified ?? other?.created ?? null,
          ...(conflictLabel(w) ? { source: conflictLabel(w) } : {})
        }
      })
      touched.add(id)
    }

    /* A. sidecars that parse: R5, R4, R9, conflict copies, missing candidates (R7) */
    const entries = [...byId]
    let progress = 0
    for (let i = 0; i < entries.length; i += CHUNK) {
      await core.lock.run(async () => {
        for (const [id, paths] of entries.slice(i, i + CHUNK)) {
          paths.sort()
          const row = store.row(id)
          const withFile = paths.filter(p => present.has(p))
          const without = paths.filter(p => !walked.has(p))
          for (const p of paths) if (walked.has(p) && !present.has(p)) handled.add(p) // unstable: next round

          // is the indexed location outside this scan still holding the asset?
          let outsideHolder = false
          if (row && !row.missing && !this.inScope(row.path, scopes)) {
            const r = await core.fs.readSidecar(row.path)
            outsideHolder = !!r && r.ok && r.meta.id === id && !!(await core.fs.stat(row.path))
          }
          let original: string | null = null
          let reason: 'index' | 'name' | 'created' | 'path' = 'index'
          let copies: string[] = []
          if (withFile.length) {
            if (outsideHolder) copies = withFile
            else {
              if (row && withFile.includes(row.path)) original = row.path
              else ({ path: original, reason } = this.pickOriginal(withFile, present))
              copies = withFile.filter(p => p !== original)
            }
          }
          if (original) {
            handled.add(original)
            const f = present.get(original)!
            // the usual case of a rescan: one sidecar, in place, nothing changed → no need to read it again
            if (!(paths.length === 1 && (await this.unchanged(original, f, row, side.get(original))))) {
              const res = await this.syncAsset(original, id, f, row)
              if (res.changed) touched.add(id)
              if (res.added) enqueueAll.add(id)
              if (res.content) { enqueueAll.add(id); contentChanged.add(id) }
            }
          }
          const ownerPath = original ?? row?.path ?? ''
          for (const c of copies) {
            handled.add(c)
            const copyId = await this.duplicateIdentity(c, id, present.get(c)!, ownerPath, reason)
            touched.add(copyId)
            enqueueAll.add(copyId)
          }
          if (withFile.length || outsideHolder) {
            for (const w of without) await raiseCopyConflict(id, w, ownerPath)
          } else if (without.length) {
            const primary = row && without.includes(row.path) ? row.path : without[0]!
            const pm = await this.metaAt(primary)
            if (pm) missing.set(id, { path: primary, meta: pm, sidecar: primary })
            for (const w of without) if (w !== primary) await raiseCopyConflict(id, w, primary)
          }
          progress++
        }
      })
      this.setProgress({ done: progress })
      await yieldNow()
    }

    await core.lock.run(async () => {
      /* B. sidecars that cannot be read (R10) and orphans */
      for (const [p, r] of side) {
        if (r.ok) continue
        const row = store.rowByPath(p)
        const sc = p + SIDECAR_SUFFIX
        if (walked.has(p)) {
          handled.add(p)
          conflictPaths.add(sc)
          core.integrity.raise({ id: issueId.conflict(sc), type: 'metadata-conflict', assetId: row?.id ?? null, path: p, details: { kind: 'broken', conflictPath: sc, error: r.error } })
          if (row) touched.add(row.id)
        } else if (row) {
          conflictPaths.add(sc)
          core.integrity.raise({ id: issueId.conflict(sc), type: 'metadata-conflict', assetId: row.id, path: p, details: { kind: 'broken', conflictPath: sc, error: r.error } })
          if (!row.missing) missing.set(row.id, { path: p, meta: store.meta(row), sidecar: null })
        } else {
          // an unreadable cloud conflict copy (`x.png (… conflicted copy …)`, `x.png (1)`, `x.png 2`, `x.png-MACHINE`)
          const owner = conflictOwner(p, q => !!store.rowByPath(q) || (side.get(q)?.ok ?? false))
          const ownerSide = owner ? side.get(owner) : undefined
          const ownerRow = owner ? store.rowByPath(owner) ?? (ownerSide?.ok ? store.row(ownerSide.id) : undefined) : undefined
          if (owner && ownerRow) {
            conflictPaths.add(sc)
            core.integrity.raise({ id: issueId.conflict(sc), type: 'metadata-conflict', assetId: ownerRow.id, path: owner, details: { kind: 'broken', conflictPath: sc, sidecarPath: owner + SIDECAR_SUFFIX, error: r.error } })
            touched.add(ownerRow.id)
          } else {
            orphanPaths.add(sc)
            core.integrity.raise({ id: issueId.orphan(sc), type: 'orphan-sidecar', assetId: null, path: sc, details: { error: r.error } })
          }
        }
      }

      /* C. files without a sidecar: R8 when the index knows the path, else new */
      for (const [p, f] of present) {
        if (handled.has(p) || side.has(p)) continue
        const row = store.rowByPath(p)
        if (row && !byId.has(row.id)) {
          const meta = store.meta(row)
          if (await core.fs.exists(p + SIDECAR_SUFFIX)) continue // a sidecar appeared meanwhile: next scan
          await core.fs.writeSidecar(p, meta)
          core.log.info('sidecar restored from index', { path: p, id: row.id })
          const res = await this.syncAsset(p, row.id, f, row)
          touched.add(row.id)
          if (res.content) { enqueueAll.add(row.id); contentChanged.add(row.id) }
          core.emit('asset.updated', { id: row.id, fields: ['metadata'], by: SCANNER_ACTOR })
          continue
        }
        fresh.push(f)
      }

      /* D. indexed assets in scope that vanished entirely (file and sidecar) */
      const lightRows = function* (): Generator<{ id: string; path: string; missing: number }> {
        for (const s of scopes) {
          const q = s.folder === '' && s.recursive ? store.db.prepare('SELECT id, path, missing FROM assets').iterate()
            : s.recursive ? store.db.prepare('SELECT id, path, missing FROM assets WHERE path = ? OR substr(path, 1, ?) = ?').iterate(s.folder, s.folder.length + 1, s.folder + '/')
            : store.db.prepare('SELECT id, path, missing FROM assets WHERE folder = ?').iterate(s.folder)
          yield* q as Iterable<{ id: string; path: string; missing: number }>
        }
      }
      for (const r of lightRows()) {
        if (r.missing || r.path.includes('\u0000') || r.path.startsWith(PARKED_PREFIX) || !this.inScope(r.path, scopes)) continue
        if (walked.has(r.path) || side.has(r.path) || byId.has(r.id) || missing.has(r.id)) continue
        const row = store.row(r.id)
        if (row) missing.set(r.id, { path: r.path, meta: store.meta(row), sidecar: null })
      }
    })

    this.mem('step-A-D')
    /* E. new files: R2 / R6 (take over a missing asset with the same content), else R1 / R3 (claim) */
    fresh.sort((a, b) => (a.path < b.path ? -1 : 1))
    const pool = new Map<string, Array<{ id: Guid; path: string; meta: Bmeta; sidecar: string | null }>>()
    const addPool = (id: Guid, v: { path: string; meta: Bmeta; sidecar: string | null }) => {
      const l = pool.get(v.meta.hash) ?? []
      l.push({ id, ...v })
      pool.set(v.meta.hash, l)
    }
    for (const [id, v] of missing) addPool(id, v)
    for (const row of store.db.prepare('SELECT * FROM assets WHERE missing = 1').all() as AssetRow[]) {
      if (missing.has(row.id) || present.has(row.path)) continue
      const sc = await core.fs.readSidecar(row.path)
      addPool(row.id, { path: row.path, meta: store.meta(row), sidecar: sc && sc.ok && sc.meta.id === row.id ? row.path : null })
    }
    let n = 0
    for (let i = 0; i < fresh.length; i += CHUNK) {
      if (this.stopFlag) break
      const chunk = fresh.slice(i, i + CHUNK)
      await core.lock.run(async () => {
        for (const f of chunk) {
          if (this.stopFlag) break
          if (await core.fs.stat(f.path + SIDECAR_SUFFIX)) continue // registered meanwhile
          const known = store.rowByPath(f.path)
          if (known && !known.missing) continue
          const hit = pool.get(f.hash)?.shift()
          if (hit) {
            await this.reclaim(hit.id, hit.meta, hit.sidecar, f)
            missing.delete(hit.id)
            touched.add(hit.id)
          } else {
            const meta = await core.claim(f.path, { hash: f.hash, size: f.size, isDir: f.isDir }, {
              by: SCANNER_ACTOR, at: nowIso(), versionAt: new Date(f.mtimeMs).toISOString()
            })
            touched.add(meta.id)
            enqueueAll.add(meta.id)
            core.emit('asset.created', { id: meta.id, path: f.path, by: SCANNER_ACTOR })
          }
          n++
        }
      })
      this.setProgress({ done: progress + n, current: chunk[chunk.length - 1]?.path })
      await yieldNow()
    }

    await core.lock.run(async () => {
      /* F. R7: still missing after matching → mark missing, keep relations */
      if (!this.stopFlag) {
        for (const [id, v] of missing) {
          if (v.path.includes('\u0000')) continue
          const row = store.row(id)
          if (row && row.missing && row.path === v.path) continue
          const occupant = store.rowByPath(v.path)
          if (occupant && occupant.id !== id) {
            if (!row) store.upsertAsset({ meta: v.meta, path: parkedPath(id, v.path), size: v.meta.versions?.at(-1)?.size ?? 0, mtimeMs: 0, metaMtimeMs: 0, missing: true })
            store.park(id, v.path)
            touched.add(id)
            core.hooks.forget(id)
            core.emit('asset.updated', { id, fields: ['missing'], by: SCANNER_ACTOR })
            continue
          }
          store.upsertAsset({ meta: v.meta, path: v.path, size: row?.size ?? v.meta.versions?.at(-1)?.size ?? 0, mtimeMs: 0, metaMtimeMs: row?.meta_mtime_ms ?? 0, missing: true })
          core.hooks.forget(id)
          touched.add(id)
          core.log.info('asset missing', { id, path: v.path })
          core.emit('asset.updated', { id, fields: ['missing'], by: SCANNER_ACTOR })
        }
      }
      // assets pushed off their index path that found no new place: file and sidecar are gone and the path now
      // belongs to another asset → they stay as「文件缺失」under a parked index path, never vanish (P2-5)
      for (const id of this.displaced) {
        const row = store.row(id)
        if (!row || !row.path.includes('\u0000')) continue
        store.park(id, row.path.slice(0, row.path.indexOf('\u0000')))
        core.hooks.forget(id)
        touched.add(id)
        core.log.info('asset missing (its path now belongs to another asset)', { id })
        core.emit('asset.updated', { id, fields: ['missing'], by: SCANNER_ACTOR })
      }

      /* resolve scan-raised issues whose cause is gone (within scope) */
      for (const r of store.allIssues()) {
        if (r.type !== 'metadata-conflict' && r.type !== 'orphan-sidecar') continue
        const p = String((JSON.parse(r.details_json) as { conflictPath?: string }).conflictPath ?? r.path ?? '')
        const assetPath = p.endsWith(SIDECAR_SUFFIX) ? p.slice(0, -SIDECAR_SUFFIX.length) : p
        if (!this.inScope(assetPath, scopes)) continue
        if (conflictPaths.has(p) || orphanPaths.has(p)) continue
        core.integrity.resolve(r.id)
        if (r.asset_id) touched.add(r.asset_id)
      }

      /* files table: forget paths that are gone */
      for (const s of scopes) {
        const it = (s.folder === '' ? store.db.prepare('SELECT path FROM files') : store.db.prepare('SELECT path FROM files WHERE substr(path, 1, ?) = ?'))
          .pluck().iterate(...(s.folder === '' ? [] : [s.folder.length + 1, s.folder + '/'])) as Iterable<string>
        const gone: string[] = []
        for (const fp of it) {
          if (!s.recursive && dirOf(fp) !== s.folder) continue
          if (!walked.has(fp)) gone.push(fp)
        }
        for (const fp of gone) store.deleteFile(fp)
      }

      /* downstream effects of content changes (R4) */
      for (const id of contentChanged) this.downstream(id)
      await core.integrity.refresh(touched)
    })

    this.mem('step-F-refresh')
    // hand work to the pipeline in slices, giving the event loop back in between (a rebuild queues 100 000 assets)
    let queued = 0
    const exists = store.db.prepare('SELECT 1 FROM assets WHERE id = ?')
    for (const id of enqueueAll) {
      if (exists.get(id)) core.hooks.enqueue(id, 'all', { reason: 'scan' })
      if (++queued % 2000 === 0) await yieldNow()
    }
    this.mem('enqueued')
    if (touched.size && (core.hooks.wantsChanges?.() ?? true)) {
      const pathOf = store.db.prepare('SELECT path FROM assets WHERE id = ?').pluck()
      core.hooks.changed([...touched].map(id => pathOf.get(id) as string | undefined).filter((p): p is string => !!p), SCANNER_ACTOR, 'scan')
    }
    return touched
  }

  /** Ids pushed off their index path during this reconcile (path now held by another asset). */
  private readonly displaced = new Set<Guid>()

  /** Make room for `id` at `p` in the index: another asset still recorded there moves to a temporary path. */
  private freePath(p: string, id: Guid): void {
    const occupant = this.core.store.rowByPath(p)
    if (occupant && occupant.id !== id) {
      this.core.store.updatePath(occupant.id, `${occupant.path}\u0000${occupant.id}`)
      this.displaced.add(occupant.id)
    }
  }

  /**
   * R9 original without an index record (ADR-045): a name that is another one's name plus a copy suffix is the copy;
   * then earlier creation time; then path order.
   */
  private pickOriginal(paths: string[], present: Map<string, FileInfo>): { path: string; reason: 'name' | 'created' | 'path' } {
    const names = new Set(paths.map(p => p.slice(p.lastIndexOf('/') + 1)))
    const notCopies = paths.filter(p => { const s = stripCopySuffix(p.slice(p.lastIndexOf('/') + 1)); return !(s && names.has(s)) })
    const pool = notCopies.length ? notCopies : paths
    const sorted = this.byCreation(pool, present)
    const reason = notCopies.length === 1 && paths.length > 1 ? 'name' : present.get(sorted[0]!)!.birthtimeMs !== present.get(sorted[1] ?? sorted[0]!)!.birthtimeMs ? 'created' : 'path'
    return { path: sorted[0]!, reason }
  }

  private byCreation(paths: string[], present: Map<string, FileInfo>): string[] {
    return [...paths].sort((a, b) => {
      const ta = present.get(a)!.birthtimeMs
      const tb = present.get(b)!.birthtimeMs
      if (ta !== tb) return ta - tb
      return a < b ? -1 : a > b ? 1 : 0
    })
  }

  /**
   * Inside the lock: the asset at `p` is exactly what the index holds — same path, same content hash, and its sidecar
   * still the one the snapshot found matching the index (same mtime and size as then, ADR-046's check). Then there is
   * nothing to reconcile and the sidecar is not read again; only a changed file stat is noted (what syncAsset would do).
   */
  private async unchanged(p: string, f: FileInfo, row: AssetRow | undefined, side: SideInfo | undefined): Promise<boolean> {
    if (!row || row.missing || row.path !== p || row.hash !== f.hash || !side?.ok || !side.same) return false
    if (row.meta_mtime_ms !== side.same.mtimeMs) return false
    const sc = await this.core.fs.stat(p + SIDECAR_SUFFIX)
    if (!sc || sc.mtimeMs !== side.same.mtimeMs || sc.size !== side.same.size) return false
    if (row.size !== f.size || row.mtime_ms !== f.mtimeMs) this.core.store.setStat(row.id, { size: f.size, mtimeMs: f.mtimeMs })
    return true
  }

  /**
   * An asset whose sidecar and file are both present: R4 (content changed), R5 (moved together), external
   * metadata edits, first sight (rebuild / existing library), file back after missing.
   */
  private async syncAsset(p: string, expectId: Guid, f: FileInfo, row: AssetRow | undefined): Promise<{ added: boolean; content: boolean; changed: boolean }> {
    const core = this.core
    const store = core.store
    // the snapshot was read outside the lock: take what is on disk now (ADR-046)
    const now = await core.fs.readSidecar(p)
    if (!now) return { added: false, content: false, changed: false }
    if (!now.ok) {
      core.integrity.raise({ id: issueId.conflict(p + SIDECAR_SUFFIX), type: 'metadata-conflict', assetId: row?.id ?? null, path: p, details: { kind: 'broken', conflictPath: p + SIDECAR_SUFFIX, error: now.error } })
      return { added: false, content: false, changed: false }
    }
    if (now.meta.id !== expectId) return { added: false, content: false, changed: false }
    let m = now.meta
    let content = false
    if (f.hash !== m.hash) {
      // R4: content changed outside Bowerbird
      const at = new Date(f.mtimeMs).toISOString()
      m = { ...m, hash: f.hash, versions: [...(m.versions ?? []), { hash: f.hash, size: f.size, at, by: SCANNER_ACTOR }], modified: { at, by: SCANNER_ACTOR } }
      await core.fs.writeSidecar(p, m)
      content = true
    }
    // R5: moved together with its sidecar — only the path changes
    const moved = !!row && row.path !== p
    this.freePath(p, m.id)
    const unchanged = !!row && !moved && !content && !row.missing && row.meta_json === canonicalMetaJson(m)
    if (unchanged) {
      const sc = await core.fs.stat(p + SIDECAR_SUFFIX)
      if (sc && sc.mtimeMs !== row!.meta_mtime_ms) store.setStat(row!.id, { metaMtimeMs: sc.mtimeMs })
      if (row!.size !== f.size || row!.mtime_ms !== f.mtimeMs) store.setStat(row!.id, { size: f.size, mtimeMs: f.mtimeMs })
      return { added: false, content: false, changed: false }
    }
    const fields: string[] = []
    if (row) {
      const old = store.meta(row)
      if (moved) fields.push('path')
      if (content) fields.push('content')
      if (row.missing) fields.push('missing')
      for (const k of ['tags', 'description', 'stage', 'review', 'relations', 'auto', 'fields', 'views', 'auxiliary', 'thumbnail'] as const) {
        if (JSON.stringify(old[k] ?? null) !== JSON.stringify(m[k] ?? null)) fields.push(k)
      }
    }
    await core.indexMeta(p, m, { missing: false })
    store.setFile(p, f.size, f.mtimeMs, f.hash)
    if (!row) {
      core.emit('asset.created', { id: m.id, path: p, by: SCANNER_ACTOR })
      return { added: true, content: false, changed: true }
    }
    if (fields.length) core.emit('asset.updated', { id: m.id, fields, by: SCANNER_ACTOR, ...(content ? { version: m.versions?.length } : {}) })
    if (moved) core.log.info('asset moved', { id: m.id, from: row.path, to: p })
    return { added: false, content: content || !!row.missing, changed: true }
  }

  /** R9: a second sidecar with the same GUID → the copy gets a new GUID and the copy semantics. */
  private async duplicateIdentity(p: string, expectId: Guid, f: FileInfo, originalPath: string, reason: string): Promise<Guid> {
    const core = this.core
    const again = await core.fs.readSidecar(p)
    if (!again?.ok || again.meta.id !== expectId) return expectId // changed meanwhile: the next scan decides
    const meta = again.meta
    const at = nowIso()
    const rec = await core.copyRecord({ id: meta.id, hash: meta.hash }, SCANNER_ACTOR, at)
    const base = core.copyMeta(meta, { hash: f.hash, size: f.size, by: SCANNER_ACTOR, at, recordId: rec.id })
    // the pending decision lives in the copy's sidecar, so the issue survives an index rebuild (P2-6)
    const note: IdentityNote = { copiedFrom: meta.id, at, confirmed: false, reason, originalPath, copyPath: p }
    const copy: Bmeta = { ...base, fields: { ...(base.fields ?? {}), [IDENTITY_FIELD]: note as unknown as Record<string, unknown> } }
    this.freePath(p, copy.id)
    await core.writeMeta(p, copy, { checked: true }) // re-read just above
    core.emit('asset.created', { id: copy.id, path: p, by: SCANNER_ACTOR })
    core.log.info('duplicate identity: copy got a new GUID', { original: meta.id, copy: copy.id, path: p })
    return copy.id
  }

  /** R2 / R6: a new file with the content of a missing asset takes over its sidecar; GUID and relations stay. */
  private async reclaim(id: Guid, meta: Bmeta, sidecar: string | null, f: FileInfo): Promise<void> {
    const core = this.core
    const row = core.store.row(id)
    if (sidecar && (await core.fs.stat(sidecar + SIDECAR_SUFFIX))) {
      await core.fs.move(sidecar + SIDECAR_SUFFIX, f.path + SIDECAR_SUFFIX)
    } else {
      await core.fs.writeSidecar(f.path, meta)
    }
    const moved = await core.fs.readSidecar(f.path)
    const cur = moved?.ok && moved.meta.id === id ? moved.meta : meta
    const m = (cur.bundle ?? false) === f.isDir ? cur : { ...cur, bundle: f.isDir || undefined }
    if (m !== cur) await core.fs.writeSidecar(f.path, m)
    this.freePath(f.path, id)
    await core.indexMeta(f.path, m, { missing: false })
    core.store.setFile(f.path, f.size, f.mtimeMs, f.hash)
    core.log.info('missing asset found again', { id, from: row?.path ?? sidecar, to: f.path })
    core.emit('asset.updated', { id, fields: ['path', 'missing'], by: SCANNER_ACTOR })
  }

  /** R4 downstream: source referrers become stale (integrity), uses referrers redo thumbnails, members re-validate. */
  private downstream(id: Guid): void {
    const core = this.core
    for (const r of core.store.incoming(id)) {
      if (r.type === 'uses') core.hooks.enqueue(r.from_id, ['thumbnail', 'summary'], { reason: 'dependency changed' })
      if (r.type === 'belongs') core.hooks.enqueue(r.from_id, ['validate'], { reason: 'design object changed' })
    }
  }
}

/** Common copy suffixes (ADR-045): ` (1)`, ` copy`, ` copy 2`, ` - Copy`, ` 副本`, `_1` … → the name without it, or null. */
export function stripCopySuffix(name: string): string | null {
  const i = name.lastIndexOf('.')
  const base = i > 0 ? name.slice(0, i) : name
  const ext = i > 0 ? name.slice(i) : ''
  const stripped = base.replace(/(?: \(\d+\)| copy(?: \d+)?| - Copy(?: \(\d+\))?| 副本(?: ?\d+)?|_\d+)$/i, '')
  return stripped !== base && stripped ? stripped + ext : null
}

/** Cloud-drive conflict copy suffixes on a sidecar's asset path: Dropbox, localized, Google Drive, iCloud, OneDrive. */
const CONFLICT_SUFFIXES: ReadonlyArray<[RegExp, string]> = [
  [/ \([^()]*(?:conflicted copy|conflict|冲突)[^()]*\)$/i, 'dropbox'],
  [/ \(\d+\)$/, 'google-drive'],
  [/ \d+$/, 'icloud'],
  [/-[^-\s/]+$/, 'onedrive']
]

/** The asset a conflict copy belongs to (first suffix whose stripped path exists). */
export function conflictOwner(assetPath: string, exists: (p: string) => boolean): string | null {
  for (const [re] of CONFLICT_SUFFIXES) {
    const s = assetPath.replace(re, '')
    if (s !== assetPath && s && exists(s)) return s
  }
  // OneDrive appends `-<machine name>`, and machine names may contain hyphens themselves
  const slash = assetPath.lastIndexOf('/') + 1
  for (let i = assetPath.indexOf('-', slash + 1); i > 0; i = assetPath.indexOf('-', i + 1)) {
    const s = assetPath.slice(0, i)
    if (exists(s)) return s
  }
  return null
}

/** Which cloud drive naming a conflict copy uses (for the UI text only). */
export function conflictLabel(assetPath: string): string | null {
  for (const [re, label] of CONFLICT_SUFFIXES) if (re.test(assetPath)) return label
  return null
}

/** Merge overlapping scopes (a recursive parent covers its children). */
export function mergeScopes(list: Scope[]): Scope[] {
  const rec = list.filter(s => s.recursive).map(s => s.folder)
  const out: Scope[] = []
  const seen = new Set<string>()
  for (const s of [...list].sort((a, b) => a.folder.length - b.folder.length)) {
    const key = `${s.folder}\u0000${s.recursive}`
    if (seen.has(key)) continue
    if (rec.some(r => r !== s.folder && isUnder(s.folder, r))) continue
    if (!s.recursive && rec.includes(s.folder)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}
