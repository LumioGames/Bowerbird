/**
 * Content-addressed cache (pipeline-and-cache.md「缓存」, ADR-008/025):
 *   key  = sha256(content hash + referenced assets' hashes + plugin id@version + stage parameter version)
 *   path = cache/<stage>/<key[0:2]>/<key>.<ext>
 * Files are written once and never modified; a change of content, references or plugin version gives a new key.
 * `cache_files` records which files belong to current assets; cleanup removes the rest.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Guid, PipelineStage } from '@bowerbird/schema'
import type { IndexDb, StoredThumb } from '../contracts.js'

/** Bump a stage's number when its outputs change shape (forces regeneration everywhere). */
export const STAGE_PARAM_VERSION: Readonly<Record<PipelineStage, number>> = {
  identify: 1, probe: 1, derive: 1, thumbnail: 1, summary: 1, enrich: 1, validate: 1, index: 1
}

export interface KeyInput {
  hash: string
  refs: readonly string[]
  plugin: string
  version: string
  stage: PipelineStage
  /** Output variant within the stage (thumb, preview, text, a derivative name…). */
  variant: string
}

export function cacheKey(i: KeyInput): string {
  const refs = [...i.refs].sort().join(',')
  return createHash('sha256')
    .update([i.hash, refs, `${i.plugin}@${i.version}`, `${i.stage}:${i.variant}@${STAGE_PARAM_VERSION[i.stage]}`].join('\n'))
    .digest('hex')
}

const MIME_EXT: Record<string, string> = {
  'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'model/gltf-binary': 'glb', 'application/json': 'json', 'text/plain': 'txt', 'text/html': 'html'
}

/** File extension of a stored variant. */
export function extFor(variant: string, mime?: string): string {
  if (variant === 'peaks' || variant === 'text') return 'json'
  if (['thumb', 'preview', 'poster', 'scrub', 'turnaround'].includes(variant)) return 'webp'
  if (mime && MIME_EXT[mime]) return MIME_EXT[mime]!
  const m = /\.([a-z0-9]{1,8})$/i.exec(variant)
  return m ? m[1]!.toLowerCase() : 'bin'
}

export function relPathFor(stage: string, key: string, ext: string): string {
  return `${stage}/${key.slice(0, 2)}/${key}.${ext}`
}

const STAGE_ALT = '(?:identify|probe|derive|thumbnail|summary|enrich|validate|index)'
/** The pipeline's own files: `<stage>/<key[0:2]>/<key>.<ext>` (and their temp files while being written). */
const OWN_FILE_RE = new RegExp(`^(${STAGE_ALT})/([0-9a-f]{2})/([0-9a-f]{64})\\.[a-z0-9]{1,8}$`)
const OWN_TMP_RE = new RegExp(`^${STAGE_ALT}/[0-9a-f]{2}/[0-9a-f]{64}\\.[a-z0-9]{1,8}\\.tmp-[0-9a-z]+$`)
/** Plugins' own cache files (LibraryHandle.cache, core-A): `<stage>/plugins/<pluginId>/<assetId>-<hash8>/<name>`. */
const PLUGIN_FILE_RE = new RegExp(`^${STAGE_ALT}/plugins/[^/]+/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{8})/`)
const TMP_RE = /(\.tmp-[0-9a-z]+|\.tmp)$/
/** Temp files are only judged once they are this old (a writer may still be busy). */
const TMP_GRACE_MS = 3_600_000

export interface CleanResult { removedBytes: number; removedFiles: number }

/** Where an unregistered file with a key belongs, when the key is one a current asset would have. */
export interface KeyOwner { assetId: Guid; stage: string; variant: string }

/**
 * Writing and removing cache files. Inside the library folder the library service may supply its own writer
 * (LibraryHandle extension `cacheFiles`, so every write into the library goes through the library module); outside it,
 * or without that extension, plain atomic file writes.
 */
export interface CacheIo {
  write(absPath: string, data: Uint8Array): Promise<void>
  remove(absPath: string): Promise<void>
}

export const directCacheIo: CacheIo = {
  async write(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid.toString(36)}${Math.random().toString(36).slice(2, 8)}`
    await fsp.writeFile(tmp, data)
    await fsp.rename(tmp, file)
  },
  async remove(file) { await fsp.unlink(file) }
}

type Walked = { rel: string; abs: string; size: number; mtimeMs: number }

export class CacheStore {
  constructor(private readonly db: IndexDb, readonly dir: string, private readonly io: CacheIo = directCacheIo) {}

  abs(rel: string): string { return path.join(this.dir, ...rel.split('/')) }

  /** A file for this key exists on disk (written here or synced from another machine). */
  onDisk(stage: string, key: string, ext: string): { relPath: string; bytes: number } | null {
    const relPath = relPathFor(stage, key, ext)
    try { const st = fs.statSync(this.abs(relPath)); return st.isFile() ? { relPath, bytes: st.size } : null } catch { return null }
  }

  register(assetId: Guid, stage: string, variant: string, key: string, relPath: string, bytes: number): void {
    this.db.prepare(`INSERT INTO cache_files (key, asset_id, stage, variant, rel_path, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, stage, variant) DO UPDATE SET key = excluded.key, rel_path = excluded.rel_path, bytes = excluded.bytes, created_at = excluded.created_at`)
      .run(key, assetId, stage, variant, relPath, bytes, new Date().toISOString())
  }

  /** Write (once) and register. The row goes in first so a concurrent cleanup never removes a file being written. */
  async write(assetId: Guid, stage: string, variant: string, key: string, ext: string, data: Uint8Array): Promise<StoredThumb> {
    const relPath = relPathFor(stage, key, ext)
    this.register(assetId, stage, variant, key, relPath, data.byteLength)
    const file = this.abs(relPath)
    if (!fs.existsSync(file)) await this.io.write(file, data)
    return { key, relPath, bytes: data.byteLength }
  }

  /** Keep only these variants' rows for (asset, stage). */
  retain(assetId: Guid, stage: string, variants: readonly string[]): void {
    this.db.prepare('DELETE FROM cache_files WHERE asset_id = ? AND stage = ? AND variant NOT IN (SELECT value FROM json_each(?))')
      .run(assetId, stage, JSON.stringify(variants))
  }

  row(assetId: Guid, stage: string, variant: string): { key: string; rel_path: string; bytes: number } | null {
    return (this.db.prepare('SELECT key, rel_path, bytes FROM cache_files WHERE asset_id = ? AND stage = ? AND variant = ?').get(assetId, stage, variant) as { key: string; rel_path: string; bytes: number } | undefined) ?? null
  }

  async read(assetId: Guid, stage: string, variant: string): Promise<Uint8Array | null> {
    const r = this.row(assetId, stage, variant)
    if (!r) return null
    try { return new Uint8Array(await fsp.readFile(this.abs(r.rel_path))) } catch { return null }
  }

  /** Absolute path of a variant, preferring the given stage order (default thumbnail, summary, derive). */
  file(assetId: Guid, variant: string, stage?: string): string | null {
    const r = (stage
      ? this.db.prepare('SELECT rel_path FROM cache_files WHERE asset_id = ? AND variant = ? AND stage = ?').get(assetId, variant, stage)
      : this.db.prepare(`SELECT rel_path FROM cache_files WHERE asset_id = ? AND variant = ?
          ORDER BY CASE stage WHEN 'thumbnail' THEN 0 WHEN 'summary' THEN 1 ELSE 2 END LIMIT 1`).get(assetId, variant)) as { rel_path: string } | undefined
    if (!r) return null
    const abs = this.abs(r.rel_path)
    return fs.existsSync(abs) ? abs : null
  }

  private async walk(): Promise<Walked[]> {
    const out: Walked[] = []
    const visit = async (dir: string, rel: string): Promise<void> => {
      let entries: fs.Dirent[]
      try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const abs = path.join(dir, e.name)
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await visit(abs, r)
        else if (e.isFile()) { try { const st = await fsp.stat(abs); out.push({ rel: r, abs, size: st.size, mtimeMs: st.mtimeMs }) } catch { /* vanished */ } }
      }
    }
    await visit(this.dir, '')
    return out
  }

  async stats(): Promise<{ bytes: number; files: number }> {
    const files = await this.walk()
    return { bytes: files.reduce((s, f) => s + f.size, 0), files: files.length }
  }

  private async drop(f: Walked, tally: CleanResult, removedDirs: Set<string>): Promise<void> {
    try {
      await this.io.remove(f.abs)
      tally.removedBytes += f.size
      tally.removedFiles++
      removedDirs.add(path.dirname(f.abs))
    } catch { /* gone already */ }
  }

  /** Remove now-empty folders left behind, up to (not including) the stage folder. */
  private async prune(dirs: Set<string>): Promise<void> {
    const root = path.resolve(this.dir)
    for (const start of dirs) {
      let d = path.resolve(start)
      while (d.startsWith(root + path.sep)) {
        const rel = path.relative(root, d).split(path.sep)
        if (rel.length < 2) break // never the stage folder itself
        try { await fsp.rmdir(d) } catch { break }
        d = path.dirname(d)
      }
    }
  }

  /**
   * Remove cache files no current asset can use (pipeline-and-cache.md「清理」). Only the pipeline's own layout and the
   * plugin layout are looked at; anything else in the folder is left alone.
   * - registered here (`cache_files`) for an asset that exists or sits in the trash → kept;
   * - registered for an asset that is gone → removed;
   * - not registered (e.g. synced from another machine): kept and adopted when `owners` says the key is one a current
   *   asset would compute; otherwise removed once older than `graceMs` (it may belong to content not scanned yet);
   * - plugin files: kept while their asset exists with the same content hash prefix, or is in the trash.
   */
  async clean(graceMs: number, owners: (keys: Set<string>) => Promise<Map<string, KeyOwner>>): Promise<CleanResult & { adopted: KeyOwner[] }> {
    const orphanRows = this.db.prepare('SELECT rel_path FROM cache_files WHERE asset_id NOT IN (SELECT id FROM assets) AND asset_id NOT IN (SELECT asset_id FROM trash)').pluck().all() as string[]
    this.db.prepare('DELETE FROM cache_files WHERE asset_id NOT IN (SELECT id FROM assets) AND asset_id NOT IN (SELECT asset_id FROM trash)').run()
    const orphans = new Set(orphanRows)
    const live = new Set(this.db.prepare('SELECT rel_path FROM cache_files').pluck().all() as string[])
    let hashes: Map<string, string> | null = null
    let trashed: Set<string> | null = null
    const pluginFileLive = (assetId: string, hash8: string): boolean => {
      if (!hashes) {
        hashes = new Map((this.db.prepare('SELECT id, hash FROM assets').all() as Array<{ id: string; hash: string }>)
          .map(r => [r.id, (r.hash.includes(':') ? r.hash.slice(r.hash.indexOf(':') + 1) : r.hash).slice(0, 8)]))
        trashed = new Set(this.db.prepare('SELECT asset_id FROM trash').pluck().all() as string[])
      }
      return hashes.get(assetId) === hash8 || trashed!.has(assetId)
    }
    const now = Date.now()
    // File times can be a fraction of a millisecond ahead of Date.now(): no grace means no age check at all.
    const old = (f: Walked, grace: number): boolean => grace <= 0 || now - f.mtimeMs >= grace
    const tally: CleanResult = { removedBytes: 0, removedFiles: 0 }
    const dirs = new Set<string>()
    const candidates = new Map<string, Walked & { stage: string }>()
    for (const f of await this.walk()) {
      if (live.has(f.rel)) continue
      if (orphans.has(f.rel)) { await this.drop(f, tally, dirs); continue }
      const own = OWN_FILE_RE.exec(f.rel)
      if (own) { candidates.set(own[3]!, { ...f, stage: own[1]! }); continue }
      if (OWN_TMP_RE.test(f.rel)) { if (old(f, Math.max(graceMs, TMP_GRACE_MS))) await this.drop(f, tally, dirs); continue }
      const pm = PLUGIN_FILE_RE.exec(f.rel)
      if (pm) {
        if (TMP_RE.test(f.rel)) { if (old(f, Math.max(graceMs, TMP_GRACE_MS))) await this.drop(f, tally, dirs); continue }
        if (pluginFileLive(pm[1]!, pm[2]!)) continue
        if (old(f, graceMs)) await this.drop(f, tally, dirs)
        continue
      }
      // Not Bowerbird's: never touched.
    }
    const adopted: KeyOwner[] = []
    if (candidates.size) {
      const known = await owners(new Set(candidates.keys()))
      for (const [key, f] of candidates) {
        const owner = known.get(key)
        if (owner && owner.stage === f.stage) {
          this.register(owner.assetId, owner.stage, owner.variant, key, f.rel, f.size)
          adopted.push(owner)
        } else if (old(f, graceMs)) await this.drop(f, tally, dirs)
      }
    }
    await this.prune(dirs)
    return { ...tally, adopted }
  }

  /**
   * 「清空缓存」: remove every file registered here and every file in Bowerbird's own layouts (pipeline and plugin
   * files); nothing else in the folder is touched.
   */
  async clear(): Promise<CleanResult> {
    const live = new Set(this.db.prepare('SELECT rel_path FROM cache_files').pluck().all() as string[])
    const tally: CleanResult = { removedBytes: 0, removedFiles: 0 }
    const dirs = new Set<string>()
    for (const f of await this.walk()) {
      if (live.has(f.rel) || OWN_FILE_RE.test(f.rel) || OWN_TMP_RE.test(f.rel) || PLUGIN_FILE_RE.test(f.rel)) await this.drop(f, tally, dirs)
    }
    this.db.prepare('DELETE FROM cache_files').run()
    await this.prune(dirs)
    return tally
  }
}
