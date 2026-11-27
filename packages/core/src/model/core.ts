/**
 * Shared state and write primitives of one library, used by the scanner and the library service.
 * All writes into the folder go through `fs` (library module); the index is updated right after each write
 * and the paths are registered as expected changes so the watcher does not process them again.
 */
import { v7 as uuidv7 } from 'uuid'
import {
  FORMAT_VERSION, SCANNER_ACTOR, SIDECAR_SUFFIX, baseOf, builtinTracksVersion, dirOf, serializeBmeta, type Bmeta, type EventPayload, type EventType, type Guid,
  type LibraryJson, type PipelineStage, type Provenance, type Relation, type Stage, type ViewGrid
} from '@bowerbird/schema'
import { CoreError, type CoreLogger, type EventBus, type LibraryPlugins } from '../contracts.js'
import type { IndexStore } from '../index/store.js'
import { canonicalMetaJson, uniqTags } from '../index/store.js'
import { issueId, type Integrity } from '../integrity/index.js'
import { effectiveDefaults } from '../library/defaults.js'
import type { LocalLibraryFs } from '../library/fs.js'
import { Lock } from './lock.js'

export const newId = (): Guid => uuidv7()
/** Batch id shared by the outputs of one run (ADR-070). */
export const newBatchId = (): string => `bat_${uuidv7()}`
export const nowIso = (): string => new Date().toISOString()

/** Paths this process wrote recently; the watcher skips their events (sync-and-integrity.md「自身改动」). */
export class ExpectedChanges {
  private readonly map = new Map<string, number>()
  constructor(private readonly ttlMs = 8000) {}
  add(rel: string): void { this.map.set(rel, Date.now() + this.ttlMs) }
  has(rel: string): boolean {
    const t = this.map.get(rel)
    if (t === undefined) return false
    if (t < Date.now()) { this.map.delete(rel); return false }
    return true
  }
  sweep(): void { const n = Date.now(); for (const [k, t] of this.map) if (t < n) this.map.delete(k) }
}

/** What the core needs from the processing side (pipeline, query engine, version store). */
export interface CoreHooks {
  enqueue(id: Guid, stages: PipelineStage[] | 'all', opts?: { priority?: number; reason?: string }): void
  forget(id: Guid): void
  removeDocs(ids: Guid[]): void
  /** Content or metadata of these paths changed (version store commit batching). */
  changed(paths: string[], actor: string, message: string): void
  /** Whether anyone listens to `changed` (a version store): saves collecting paths for nothing. */
  wantsChanges?(): boolean
}

export const noHooks: CoreHooks = { enqueue() {}, forget() {}, removeDocs() {}, changed() {} }

export interface ClaimOptions {
  by: string
  at?: string
  /** Time of the first version record (scanner: file mtime). */
  versionAt?: string
  stage?: Stage
  tags?: string[]
  description?: string
  review?: 'pending' | 'exempt'
  relations?: Relation[]
  views?: ViewGrid
  provenance?: Provenance
  note?: string
  fields?: Bmeta['fields']
  extra?: Partial<Bmeta>
}

export class LibraryCore {
  readonly lock = new Lock()
  readonly expected = new ExpectedChanges()
  lib: LibraryJson | null = null
  hooks: CoreHooks = noHooks
  plugins: LibraryPlugins | null = null
  /** The write operation in progress (set by the service under the lock): actor and name for version commits. */
  op: { actor: string; name: string } | null = null

  constructor(
    readonly id: string,
    readonly fs: LocalLibraryFs,
    readonly store: IndexStore,
    readonly integrity: Integrity,
    readonly events: EventBus,
    readonly log: CoreLogger
  ) {}

  emit<T extends EventType>(type: T, data: EventPayload<T>): void { this.events.emit(this.id, type, data) }

  tracksVersion(type: string): boolean {
    if (builtinTracksVersion(type)) return true
    const t = this.plugins?.relationTypes().find(r => r.id === type)
    return !!t?.tracksVersion
  }

  defaultStage(): Stage { return (this.lib?.settings?.defaultStage as Stage | undefined) ?? 'production' }

  /**
   * Index an asset from its metadata, taking sizes and mtimes from disk. `sidecar` says whether a .bmeta holds this
   * meta (default: whether one is on disk); false = the index row is all there is (ADR-067).
   */
  async indexMeta(path: string, meta: Bmeta, opts: { missing?: boolean; knownHash?: boolean; sidecar?: boolean } = {}): Promise<void> {
    const st = await this.fs.contentStat(path)
    const sc = opts.sidecar === false ? null : await this.fs.stat(path + SIDECAR_SUFFIX)
    const missing = opts.missing ?? !st
    const lastSize = meta.versions?.[meta.versions.length - 1]?.size ?? this.store.row(meta.id)?.size ?? 0
    this.store.upsertAsset({ meta, path, size: st && !missing ? st.size : lastSize, mtimeMs: st?.mtimeMs ?? 0, metaMtimeMs: sc?.mtimeMs ?? 0, missing, sidecar: opts.sidecar ?? !!sc })
    if (st && !missing && opts.knownHash !== false) this.store.setFile(path, st.size, st.mtimeMs, meta.hash)
  }

  /**
   * Keep an asset's meta in the index only (ADR-067): a file nobody said anything about, or what the pipeline works
   * out of one (format, auxiliary, slot pairing). Nothing is written into the library folder.
   */
  async indexOnly(path: string, meta: Bmeta): Promise<void> {
    await this.indexMeta(path, meta, { missing: false, sidecar: false })
  }

  /** Whether the asset has a .bmeta on disk (index flag). */
  hasSidecar(id: Guid): boolean { return !!this.store.row(id)?.sidecar }

  /**
   * Write the sidecar and update the index. Unless the caller has just read or placed the file itself (`checked`),
   * the sidecar on disk must still be the one the index knows (ADR-046): an unreadable one is never overwritten
   * (metadata-conflict, `conflict`), a changed one is taken into the index and the write refused with `conflict`
   * so it is redone on top of it. Operations normally call the service's freshRow() first, so this only trips on races.
   */
  async writeMeta(path: string, meta: Bmeta, opts: { missing?: boolean; checked?: boolean } = {}): Promise<void> {
    if (!opts.checked) await this.guardSidecar(path, meta.id)
    await this.fs.writeSidecar(path, meta)
    await this.indexMeta(path, meta, { ...opts, sidecar: true })
    this.hooks.changed([path], this.op?.actor ?? SCANNER_ACTOR, this.op?.name ?? 'scan')
    await this.materializeTargets(meta)
  }

  /**
   * A relation gives its counterpart's GUID a meaning: a counterpart the library only sees gets its .bmeta now, so
   * the GUID the relation names survives an index rebuild (ADR-067).
   */
  async materializeTargets(meta: Bmeta): Promise<void> {
    for (const r of meta.relations ?? []) {
      const t = this.store.row(r.to)
      if (!t || t.sidecar || t.missing || t.id === meta.id) continue
      // stamped with whoever caused it, so「我这次改了什么」lists this new .bmeta too (ADR-072)
      const m = this.store.meta(t)
      await this.writeMeta(t.path, this.op ? { ...m, modified: { at: nowIso(), by: this.op.actor } } : m)
    }
  }

  private async guardSidecar(path: string, id: string): Promise<void> {
    const st = await this.fs.stat(path + SIDECAR_SUFFIX)
    if (!st || st.isDir) return
    const known = this.store.rowByPath(path)
    if (known && known.id === id && st.mtimeMs === known.meta_mtime_ms && st.size === Buffer.byteLength(serializeBmeta(this.store.meta(known)))) return
    const disk = await this.fs.readSidecar(path)
    if (!disk) return
    if (!disk.ok) {
      const sc = path + SIDECAR_SUFFIX
      this.integrity.raise({ id: issueId.conflict(sc), type: 'metadata-conflict', assetId: known?.id ?? null, path, details: { kind: 'broken', conflictPath: sc, error: disk.error } })
      throw new CoreError('conflict', `${baseOf(path)} 的记录文件读不出来，没有覆盖它`, { path: sc })
    }
    if (known && disk.meta.id === known.id && canonicalMetaJson(disk.meta) === known.meta_json) { this.store.setStat(known.id, { metaMtimeMs: st.mtimeMs }); return }
    if (known && disk.meta.id === known.id) await this.indexMeta(path, disk.meta, { knownHash: false })
    throw new CoreError('conflict', `${baseOf(path)} 的记录刚被别处改过，请再试一次`, { path })
  }

  /**
   * A new asset for a file that has no sidecar yet. Folder defaults apply once, here. `indexOnly` (R1 / R3, ADR-067):
   * the file is only seen — its meta stays in the index, no .bmeta is written; otherwise (registration with
   * information) the .bmeta is written.
   */
  async claim(path: string, info: { hash: string; size: number; isDir: boolean }, o: ClaimOptions & { indexOnly?: boolean }): Promise<Bmeta> {
    const meta = await this.newMeta(path, info, o)
    if (o.indexOnly) await this.indexOnly(path, meta)
    else await this.writeMeta(path, meta)
    return meta
  }

  /** The metadata a new asset starts with (folder defaults applied); nothing is written. */
  async newMeta(path: string, info: { hash: string; size: number; isDir: boolean }, o: ClaimOptions): Promise<Bmeta> {
    const at = o.at ?? nowIso()
    const defaults = await effectiveDefaults(this.fs, dirOf(path))
    const stage = o.stage ?? defaults.stage ?? this.defaultStage()
    const tags = uniqTags([...(defaults.tags ?? []), ...(o.tags ?? [])])
    const review = (o.review ?? defaults.review) === 'exempt' ? { status: 'exempt' as const, by: o.by, at } : undefined
    const meta: Bmeta = {
      ...(o.extra ?? {}),
      bb: FORMAT_VERSION,
      id: newId(),
      hash: info.hash,
      stage,
      ...(tags.length ? { tags } : {}),
      ...(o.description ? { description: o.description } : {}),
      ...(o.fields ? { fields: o.fields } : {}),
      ...(o.relations?.length ? { relations: o.relations } : {}),
      ...(review ? { review } : {}),
      versions: [{ hash: info.hash, size: info.size, at: o.versionAt ?? at, by: o.by, ...(o.note ? { note: o.note } : {}) }],
      ...(info.isDir ? { bundle: true } : {}),
      ...(o.views ? { views: o.views } : {}),
      ...(o.provenance ? { provenance: o.provenance } : {}),
      created: { at, by: o.by }
    }
    return meta
  }

  /** A folder settings file changed (version commits). */
  folderMetaChanged(folder: string): void {
    this.hooks.changed([folder ? `${folder}/_folder.bmeta` : '_folder.bmeta'], this.op?.actor ?? SCANNER_ACTOR, this.op?.name ?? 'folder')
  }

  /**
   * Metadata of a copy (sync-and-integrity.md「复制的语义」): new GUID, keeps what the original depends on,
   * adds a source relation to the original, provenance `copy` (ADR-070), versions start over, review pending.
   */
  copyMeta(orig: Bmeta, o: { hash: string; size: number; by: string; at: string; id?: Guid }): Bmeta {
    const relations: Relation[] = (orig.relations ?? []).filter(r => r.to !== orig.id).map(r => ({ ...r }))
    relations.push({ type: 'source', to: orig.id, toHash: orig.hash })
    const meta: Record<string, unknown> = { ...orig }
    for (const k of ['review', 'thumbnail', 'modified', 'versions', 'relations', 'provenance', 'origin']) delete meta[k]
    if (orig.fields?.['bowerbird.identity']) {
      // a pending identity decision belongs to the original's own sidecar, not to its copies
      const fields = { ...orig.fields }
      delete fields['bowerbird.identity']
      if (Object.keys(fields).length) meta.fields = fields
      else delete meta.fields
    }
    return {
      ...(meta as Bmeta),
      id: o.id ?? newId(),
      hash: o.hash,
      relations,
      versions: [{ hash: o.hash, size: o.size, at: o.at, by: o.by }],
      provenance: { method: 'copy', by: o.by, at: o.at },
      created: { at: o.at, by: o.by }
    }
  }
}
