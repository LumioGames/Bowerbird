/**
 * File watching that does not grow with the library (sync-and-integrity.md「文件监听」).
 *
 * chokidar 4 opened one `fs.watch` per file on macOS (kqueue: one descriptor each); a 100 000-asset library ran
 * the process out of descriptors. Instead:
 * - macOS and Windows: one native recursive watch on the root (FSEvents / ReadDirectoryChangesW), constant cost;
 * - Linux: one non-recursive watch per directory (inotify watches share one descriptor), and none at all beyond
 *   `maxDirs` directories — the periodic scan covers the library then, and the library info says so.
 * Events only name a path; the scanner stats it and applies its own 2-second stability window.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export type WatchMode = 'auto' | 'native' | 'per-directory' | 'off'

export interface WatchState {
  enabled: boolean
  mode: 'native' | 'per-directory' | 'off'
  /** Why watching is off (shown in the library info). */
  reason?: string
  /** Directories watched (per-directory mode) or counted. */
  dirs?: number
}

export interface WatcherOptions {
  root: string
  mode?: WatchMode
  /** Per-directory mode watches at most this many directories; more → off (default 20 000). */
  maxDirs?: number
  /** Directories never watched (library-relative POSIX; `.bowerbird` is always skipped). */
  skipDir: (rel: string) => boolean
  /** A path changed (library-relative POSIX), or null = something changed, rescan everything. */
  onChange: (rel: string | null) => void
  onError: (e: unknown) => void
  /** The state changed while running (limit reached, the OS refused a watch): the scanner reports it. */
  onState?: (state: WatchState) => void
}

export const DEFAULT_MAX_WATCH_DIRS = 20_000

const toRel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/')

export class LibraryWatcher {
  private native: fs.FSWatcher | null = null
  private readonly perDir = new Map<string, fs.FSWatcher>()
  private closed = false
  /** Watching stopped while running (limit, OS refusal): never silently restart. */
  private degraded = false
  state: WatchState = { enabled: false, mode: 'off', reason: '还没有开始监听' }

  constructor(private readonly o: WatcherOptions) {}

  private get maxDirs(): number { return this.o.maxDirs ?? DEFAULT_MAX_WATCH_DIRS }

  async start(): Promise<WatchState> {
    const mode = this.o.mode ?? 'auto'
    if (mode === 'off') return (this.state = { enabled: false, mode: 'off', reason: '文件监听已关闭，靠定时扫描发现变化' })
    const native = mode === 'native' || (mode === 'auto' && (process.platform === 'darwin' || process.platform === 'win32'))
    if (native) {
      try {
        this.native = fs.watch(this.o.root, { recursive: true, persistent: false }, (_event, filename) => {
          if (this.closed) return
          const name = filename == null ? null : String(filename).split(path.sep).join('/')
          this.o.onChange(name)
        })
        this.native.on('error', e => { this.o.onError(e); this.degrade(`这台机器上的文件监听出错了（${(e as NodeJS.ErrnoException).code ?? (e as Error).message}）`) })
        return (this.state = { enabled: true, mode: 'native' })
      } catch (e) {
        this.o.onError(e)
        return (this.state = { enabled: false, mode: 'off', reason: `这台机器上不能监听这个文件夹（${(e as Error).message}），靠定时扫描发现变化` })
      }
    }
    // per directory: count first, never start more than the limit
    const dirs = await this.listDirs(this.maxDirs + 1)
    if (dirs.length > this.maxDirs) {
      return (this.state = { enabled: false, mode: 'off', dirs: dirs.length, reason: `文件夹超过 ${this.maxDirs} 个，不再逐个监听，靠定时扫描发现变化` })
    }
    for (const d of dirs) { this.watchDir(d); if (this.degraded) return this.state }
    return (this.state = { enabled: true, mode: 'per-directory', dirs: this.perDir.size })
  }

  /** Directories under the root (root included), skipping `.bowerbird` and ignored ones, at most `limit`. */
  private async listDirs(limit: number): Promise<string[]> {
    const out: string[] = ['']
    const queue = ['']
    while (queue.length && out.length < limit) {
      const rel = queue.shift()!
      let ents: fs.Dirent[] = []
      try { ents = await fsp.readdir(path.join(this.o.root, rel), { withFileTypes: true }) } catch { continue }
      for (const e of ents) {
        if (!e.isDirectory()) continue
        const c = rel ? `${rel}/${e.name}` : e.name
        if (c === '.bowerbird' || this.o.skipDir(c)) continue
        out.push(c)
        queue.push(c)
        if (out.length >= limit) break
      }
    }
    return out
  }

  private watchDir(rel: string): void {
    if (this.closed || this.degraded || this.perDir.has(rel)) return
    if (this.perDir.size >= this.maxDirs) {
      // grew past the limit while running: stop watching, the periodic scan takes over
      this.degrade(`文件夹超过 ${this.maxDirs} 个`)
      return
    }
    const abs = path.join(this.o.root, rel)
    try {
      const w = fs.watch(abs, { persistent: false }, (_event, filename) => {
        if (this.closed) return
        const child = filename == null ? null : (rel ? `${rel}/${String(filename)}` : String(filename))
        this.o.onChange(child ?? (rel || null))
        // a new sub directory gets its own watch
        if (child && !child.startsWith('.bowerbird') && !this.o.skipDir(child)) {
          fs.stat(path.join(this.o.root, child), (err, st) => { if (!err && st.isDirectory()) this.watchDir(child) })
        }
      })
      w.on('error', () => { w.close(); this.perDir.delete(rel) })
      this.perDir.set(rel, w)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return // gone already
      // ENOSPC (inotify watch limit), EMFILE… : a folder would silently go unwatched — say so and fall back
      this.o.onError(e)
      this.degrade(`系统不允许监听更多文件夹（${code ?? (e as Error).message}）`)
    }
  }

  /** Stop watching and fall back to the periodic scan, with the reason in the state. */
  private degrade(why: string): void {
    if (this.closed || this.degraded) return
    this.degraded = true
    const dirs = this.perDir.size
    this.closeAll()
    this.state = { enabled: false, mode: 'off', dirs, reason: `${why}，不再监听，靠定时扫描发现变化` }
    this.o.onState?.(this.state)
  }

  private closeAll(): void {
    for (const w of this.perDir.values()) { try { w.close() } catch { /* ignore */ } }
    this.perDir.clear()
    if (this.native) { try { this.native.close() } catch { /* ignore */ } this.native = null }
  }

  close(): void {
    this.closed = true
    this.closeAll()
    this.state = { enabled: false, mode: 'off', reason: '已停止' }
  }

  /** For tests: how many OS watch handles are open. */
  get handles(): number { return this.perDir.size + (this.native ? 1 : 0) }
}

export { toRel }
