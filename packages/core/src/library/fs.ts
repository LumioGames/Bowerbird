import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  Bmeta, FOLDER_META_NAME, FolderMeta, LIBRARY_DIR, LibraryJson, ProductionRecord, SIDECAR_SUFFIX, SmartViewFile, TagsJson,
  TrashInfo, FORMAT_VERSION, serializeBmeta, serializeFolderMeta, serializeJson, serializeRecord, joinPath
} from '@bowerbird/schema'
import type { LibraryFs, SidecarBroken, SidecarRead } from '../contracts.js'
import { bundleEntries, bundleStat, hashBundle, hashFile } from './hash.js'
import { IgnoreRules } from './ignore.js'
import { normRel } from './paths.js'

export interface LibraryFsOptions {
  /** Called with the library-relative path of everything this module writes (expected-change registry). */
  onWrite?: (rel: string) => void
}

function isErr(e: unknown, code: string): boolean { return !!e && typeof e === 'object' && (e as { code?: string }).code === code }

/**
 * The only module that writes into a library folder (engineering.md「代码约定」).
 * Every metadata file goes through temp file + rename.
 */
export class LocalLibraryFs implements LibraryFs {
  readonly root: string
  readonly metaDir: string
  private readonly rules: IgnoreRules
  private readonly onWrite: (rel: string) => void

  constructor(root: string, opts: LibraryFsOptions = {}) {
    this.root = path.resolve(root)
    this.metaDir = path.join(this.root, LIBRARY_DIR)
    this.rules = new IgnoreRules(this.root)
    this.onWrite = opts.onWrite ?? (() => {})
  }

  /* ───────────── paths & ignore ───────────── */

  absolute(rel: string): string {
    const r = normRel(rel)
    return r ? path.join(this.root, ...r.split('/')) : this.root
  }
  ignored(rel: string, isDir: boolean): boolean { return this.rules.ignored(rel, isDir) }
  builtinIgnored(rel: string, isDir: boolean): boolean { return this.rules.builtinIgnored(rel, isDir) }
  reloadIgnore(): void { this.rules.reload() }
  /** Folders a plugin asks the scanner to skip (a version store's data, versioning.md). */
  setExtraIgnores(patterns: string[]): void { this.rules.setExtra(patterns) }
  private metaAbs(...parts: string[]): string { return path.join(this.metaDir, ...parts) }

  /* ───────────── atomic writes ───────────── */

  async writeAbsAtomic(abs: string, data: string | Uint8Array): Promise<void> {
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`)
    try {
      await fsp.writeFile(tmp, data)
      await fsp.rename(tmp, abs)
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
  }

  /** Atomic write of any library-relative file (content uploads, metadata). */
  async writeFile(rel: string, data: string | Uint8Array): Promise<void> {
    const r = normRel(rel)
    this.onWrite(r)
    await this.writeAbsAtomic(this.absolute(r), data)
  }

  /** Copy an outside file (upload temp) into the library atomically. */
  async copyIn(absSrc: string, rel: string): Promise<void> {
    const r = normRel(rel)
    const abs = this.absolute(r)
    this.onWrite(r)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`)
    try {
      await fsp.copyFile(absSrc, tmp)
      await fsp.rename(tmp, abs)
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
  }

  /* ───────────── library-level JSON ───────────── */

  /** Raw library.json object (any `bb`), or null. Used to detect newer formats (read-only). */
  async readLibraryJsonRaw(): Promise<Record<string, unknown> | null> {
    try {
      const v = JSON.parse(await fsp.readFile(this.metaAbs('library.json'), 'utf8'))
      return v && typeof v === 'object' ? v as Record<string, unknown> : null
    } catch { return null }
  }

  async readLibraryJson(): Promise<LibraryJson | null> {
    const raw = await this.readLibraryJsonRaw()
    if (!raw) return null
    const p = LibraryJson.safeParse(raw)
    return p.success ? p.data : null
  }

  async writeLibraryJson(lib: LibraryJson): Promise<void> {
    this.onWrite(`${LIBRARY_DIR}/library.json`)
    await this.writeAbsAtomic(this.metaAbs('library.json'), serializeJson(lib))
  }

  async readTags(): Promise<TagsJson> {
    try {
      const p = TagsJson.safeParse(JSON.parse(await fsp.readFile(this.metaAbs('tags.json'), 'utf8')))
      if (p.success) return p.data
    } catch { /* missing or broken */ }
    return { bb: FORMAT_VERSION, groups: [], tags: {} }
  }

  async writeTags(tags: TagsJson): Promise<void> {
    this.onWrite(`${LIBRARY_DIR}/tags.json`)
    await this.writeAbsAtomic(this.metaAbs('tags.json'), serializeJson(tags))
  }

  /** Saved queries; file name is derived from the view name. */
  async listViews(): Promise<Array<{ file: string; view: SmartViewFile }>> {
    const dir = this.metaAbs('views')
    let names: string[] = []
    try { names = await fsp.readdir(dir) } catch { return [] }
    const out: Array<{ file: string; view: SmartViewFile }> = []
    for (const n of names.sort()) {
      if (!n.endsWith('.json')) continue
      try {
        const p = SmartViewFile.safeParse(JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8')))
        if (p.success) out.push({ file: n, view: p.data })
      } catch { /* skip broken */ }
    }
    return out
  }

  static viewFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 120) + '.json'
  }

  async writeView(view: SmartViewFile): Promise<string> {
    const file = LocalLibraryFs.viewFileName(view.name)
    this.onWrite(`${LIBRARY_DIR}/views/${file}`)
    await this.writeAbsAtomic(this.metaAbs('views', file), serializeJson(view))
    return file
  }

  async deleteViewFile(file: string): Promise<void> {
    await fsp.rm(this.metaAbs('views', path.basename(file)), { force: true })
  }

  /* ───────────── sidecars ───────────── */

  async readSidecarAbs(abs: string): Promise<SidecarRead | SidecarBroken | null> {
    let raw: string
    let mtimeMs = 0
    try {
      raw = await fsp.readFile(abs, 'utf8')
      mtimeMs = Math.floor((await fsp.stat(abs)).mtimeMs)
    } catch (e) {
      if (isErr(e, 'ENOENT') || isErr(e, 'ENOTDIR')) return null
      return { ok: false, error: String((e as Error).message ?? e), raw: null, mtimeMs }
    }
    let json: unknown
    try { json = JSON.parse(raw) } catch (e) { return { ok: false, error: `JSON: ${(e as Error).message}`, raw, mtimeMs } }
    const p = Bmeta.safeParse(json)
    if (!p.success) return { ok: false, error: p.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), raw, mtimeMs }
    return { ok: true, meta: p.data, raw, mtimeMs }
  }

  readSidecar(assetPath: string): Promise<SidecarRead | SidecarBroken | null> {
    return this.readSidecarAbs(this.absolute(normRel(assetPath) + SIDECAR_SUFFIX))
  }

  async writeSidecar(assetPath: string, meta: Bmeta): Promise<void> {
    const rel = normRel(assetPath) + SIDECAR_SUFFIX
    this.onWrite(rel)
    await this.writeAbsAtomic(this.absolute(rel), serializeBmeta(meta))
  }

  async removeSidecar(assetPath: string): Promise<void> {
    const rel = normRel(assetPath) + SIDECAR_SUFFIX
    this.onWrite(rel)
    await fsp.rm(this.absolute(rel), { force: true })
  }

  /* ───────────── folder settings ───────────── */

  async readFolderMeta(folder: string): Promise<FolderMeta | null> {
    const abs = this.absolute(joinPath(normRel(folder), FOLDER_META_NAME))
    try {
      const p = FolderMeta.safeParse(JSON.parse(await fsp.readFile(abs, 'utf8')))
      return p.success ? p.data : null
    } catch { return null }
  }

  async writeFolderMeta(folder: string, meta: FolderMeta | null): Promise<void> {
    const rel = joinPath(normRel(folder), FOLDER_META_NAME)
    this.onWrite(rel)
    if (!meta) { await fsp.rm(this.absolute(rel), { force: true }); return }
    await this.writeAbsAtomic(this.absolute(rel), serializeFolderMeta(meta as Record<string, unknown>))
  }

  /* ───────────── production records ───────────── */

  private static yearOfRecordId(id: string): string | null {
    const m = /^rec_([0-9a-f]{8})-([0-9a-f]{4})-7/.exec(id)
    if (!m) return null
    const ms = parseInt(m[1]! + m[2]!, 16)
    const y = new Date(ms).getUTCFullYear()
    return Number.isFinite(y) ? String(y) : null
  }

  async readRecord(id: string): Promise<ProductionRecord | null> {
    if (!/^rec_[\w-]+$/.test(id)) return null
    const tryRead = async (year: string): Promise<ProductionRecord | null> => {
      try {
        const p = ProductionRecord.safeParse(JSON.parse(await fsp.readFile(this.metaAbs('records', year, `${id}.json`), 'utf8')))
        return p.success ? p.data : null
      } catch { return null }
    }
    const y = LocalLibraryFs.yearOfRecordId(id)
    if (y) { const r = await tryRead(y); if (r) return r }
    let years: string[] = []
    try { years = await fsp.readdir(this.metaAbs('records')) } catch { return null }
    for (const yy of years) { if (yy === y) continue; const r = await tryRead(yy); if (r) return r }
    return null
  }

  async writeRecord(rec: ProductionRecord): Promise<void> {
    const year = /^\d{4}/.exec(rec.at)?.[0] ?? LocalLibraryFs.yearOfRecordId(rec.id) ?? String(new Date().getUTCFullYear())
    this.onWrite(`${LIBRARY_DIR}/records/${year}/${rec.id}.json`)
    await this.writeAbsAtomic(this.metaAbs('records', year, `${rec.id}.json`), serializeRecord(rec as Record<string, unknown>))
  }

  async listRecords(): Promise<ProductionRecord[]> {
    const out: ProductionRecord[] = []
    let years: string[] = []
    try { years = await fsp.readdir(this.metaAbs('records')) } catch { return out }
    for (const y of years) {
      let names: string[] = []
      try { names = await fsp.readdir(this.metaAbs('records', y)) } catch { continue }
      for (const n of names) {
        if (!n.endsWith('.json')) continue
        try {
          const p = ProductionRecord.safeParse(JSON.parse(await fsp.readFile(this.metaAbs('records', y, n), 'utf8')))
          if (p.success) out.push(p.data)
        } catch { /* skip */ }
      }
    }
    return out
  }

  /* ───────────── hashing & stat ───────────── */

  /** Inside a bundle only the built-in rules apply (OS junk never changes the fingerprint). */
  private bundleSkip = (rel: string, isDir: boolean): boolean => this.rules.builtinIgnored(rel, isDir)

  async hash(rel: string): Promise<string> {
    const abs = this.absolute(rel)
    const st = await fsp.stat(abs)
    return st.isDirectory() ? hashBundle(abs, this.bundleSkip) : hashFile(abs)
  }

  async stat(rel: string): Promise<{ size: number; mtimeMs: number; isDir: boolean } | null> {
    try {
      const st = await fsp.stat(this.absolute(rel))
      if (st.isDirectory()) return { size: 0, mtimeMs: Math.floor(st.mtimeMs), isDir: true }
      return { size: st.size, mtimeMs: Math.floor(st.mtimeMs), isDir: false }
    } catch { return null }
  }

  /** Stat used by the scan shortcut: bundles aggregate their files. */
  async contentStat(rel: string): Promise<{ size: number; mtimeMs: number; isDir: boolean; birthtimeMs: number } | null> {
    try {
      const abs = this.absolute(rel)
      const st = await fsp.stat(abs)
      const birthtimeMs = Math.floor(st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs)
      if (st.isDirectory()) {
        const b = await bundleStat(abs, this.bundleSkip)
        return { size: b.size, mtimeMs: b.mtimeMs, isDir: true, birthtimeMs }
      }
      return { size: st.size, mtimeMs: Math.floor(st.mtimeMs), isDir: false, birthtimeMs }
    } catch { return null }
  }

  async bundleFiles(rel: string): Promise<Array<{ path: string; size: number }>> {
    return (await bundleEntries(this.absolute(rel), this.bundleSkip)).map(e => ({ path: e.rel, size: e.size }))
  }

  /* ───────────── generic file operations (all library-relative) ───────────── */

  async exists(rel: string): Promise<boolean> {
    try { await fsp.lstat(this.absolute(rel)); return true } catch { return false }
  }

  async readFile(rel: string): Promise<Uint8Array> { return fsp.readFile(this.absolute(rel)) }

  /** The first bytes of a file (format detection): never a buffer larger than the file itself. */
  async readHead(rel: string, max = 65536): Promise<Uint8Array> {
    const fh = await fsp.open(this.absolute(rel), 'r')
    try {
      const size = (await fh.stat()).size
      const buf = Buffer.allocUnsafe(Math.max(0, Math.min(max, size)))
      if (!buf.length) return new Uint8Array()
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
      return buf.subarray(0, bytesRead)
    } finally { await fh.close() }
  }

  async mkdir(rel: string): Promise<void> {
    const r = normRel(rel)
    this.onWrite(r)
    await fsp.mkdir(this.absolute(r), { recursive: true })
  }

  /** Rename within the library (creates the target's parent). */
  async move(fromRel: string, toRel: string): Promise<void> {
    const f = normRel(fromRel)
    const t = normRel(toRel)
    this.onWrite(f)
    this.onWrite(t)
    await fsp.mkdir(path.dirname(this.absolute(t)), { recursive: true })
    await fsp.rename(this.absolute(f), this.absolute(t))
  }

  /** Copy a file or a folder (bundle) within the library. */
  async copy(fromRel: string, toRel: string): Promise<void> {
    const t = normRel(toRel)
    this.onWrite(t)
    const src = this.absolute(fromRel)
    const dst = this.absolute(t)
    await fsp.mkdir(path.dirname(dst), { recursive: true })
    const st = await fsp.stat(src)
    if (st.isDirectory()) await fsp.cp(src, dst, { recursive: true, errorOnExist: true, force: false })
    else await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL)
  }

  async remove(rel: string): Promise<void> {
    const r = normRel(rel)
    if (!r) throw new Error('refusing to remove the library root')
    this.onWrite(r)
    await fsp.rm(this.absolute(r), { recursive: true, force: true })
  }

  /** Remove a directory only when it is empty (never removes content). Returns whether it is gone. */
  async removeEmptyDir(rel: string): Promise<boolean> {
    const r = normRel(rel)
    if (!r) return false
    try {
      this.onWrite(r)
      await fsp.rmdir(this.absolute(r))
      return true
    } catch { return false }
  }

  /**
   * Write a cache file once (content-addressed: an existing file is never overwritten). The cache dir may live
   * outside the library (machine config override), so this takes an absolute path inside a cache dir.
   */
  async writeCacheOnce(abs: string, data: Uint8Array): Promise<string> {
    if (fs.existsSync(abs)) return abs
    await this.writeAbsAtomic(abs, data)
    return abs
  }

  private insideCache(abs: string, cacheDir: string): string {
    const a = path.resolve(abs)
    const c = path.resolve(cacheDir)
    if (a !== c && !a.startsWith(c + path.sep)) throw new Error(`not a cache file: ${abs}`)
    return a
  }

  /** The pipeline's cache writes (LibraryHandle `cacheFiles`): atomic, only inside the cache dir. */
  async writeCacheFile(abs: string, data: Uint8Array, cacheDir: string): Promise<void> {
    const a = this.insideCache(abs, cacheDir)
    const rel = path.relative(this.root, a)
    if (!rel.startsWith('..')) this.onWrite(rel.split(path.sep).join('/'))
    await this.writeAbsAtomic(a, data)
  }

  /** The pipeline's cache cleanup: remove one cache file (only inside the cache dir). */
  async removeCacheFile(abs: string, cacheDir: string): Promise<void> {
    const a = this.insideCache(abs, cacheDir)
    await fsp.unlink(a)
  }

  async readdir(rel: string): Promise<fs.Dirent[]> {
    try { return await fsp.readdir(this.absolute(rel), { withFileTypes: true }) } catch { return [] }
  }

  /* ───────────── trash ───────────── */

  trashAbs(trashId: string, ...parts: string[]): string { return this.metaAbs('trash', path.basename(trashId), ...parts) }

  /** Move an absolute path inside the library into the trash entry folder. */
  async moveIntoTrash(rel: string, trashId: string, name: string): Promise<void> {
    const r = normRel(rel)
    this.onWrite(r)
    const dst = this.trashAbs(trashId, name)
    await fsp.mkdir(path.dirname(dst), { recursive: true })
    await fsp.rename(this.absolute(r), dst)
  }

  async moveOutOfTrash(trashId: string, name: string, rel: string): Promise<void> {
    const r = normRel(rel)
    this.onWrite(r)
    const dst = this.absolute(r)
    await fsp.mkdir(path.dirname(dst), { recursive: true })
    await fsp.rename(this.trashAbs(trashId, name), dst)
  }

  async trashEntryExists(trashId: string, name: string): Promise<boolean> {
    try { await fsp.lstat(this.trashAbs(trashId, name)); return true } catch { return false }
  }

  async writeTrashInfo(info: TrashInfo): Promise<void> {
    await this.writeAbsAtomic(this.trashAbs(info.id, 'info.json'), serializeJson(info))
  }

  async readTrashInfo(trashId: string): Promise<TrashInfo | null> {
    try {
      const p = TrashInfo.safeParse(JSON.parse(await fsp.readFile(this.trashAbs(trashId, 'info.json'), 'utf8')))
      return p.success ? p.data : null
    } catch { return null }
  }

  async listTrashIds(): Promise<string[]> {
    try { return (await fsp.readdir(this.metaAbs('trash'), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name) } catch { return [] }
  }

  async purgeTrashEntry(trashId: string): Promise<void> {
    await fsp.rm(this.trashAbs(trashId), { recursive: true, force: true })
  }

  /* ───────────── manual thumbnails ───────────── */

  thumbAbs(name: string): string { return this.metaAbs('thumbs', path.basename(name)) }

  async writeThumb(name: string, data: Uint8Array): Promise<void> {
    this.onWrite(`${LIBRARY_DIR}/thumbs/${name}`)
    await this.writeAbsAtomic(this.thumbAbs(name), data)
  }

  async removeThumb(name: string): Promise<void> { await fsp.rm(this.thumbAbs(name), { force: true }) }

  async thumbMtime(name: string): Promise<number | null> {
    try { return Math.floor((await fsp.stat(this.thumbAbs(name))).mtimeMs) } catch { return null }
  }
}
