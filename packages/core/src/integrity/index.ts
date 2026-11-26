/**
 * Integrity problems (sync-and-integrity.md「完整性问题」).
 *
 * Two kinds of issues:
 * - derived ones are recomputed from the index state whenever an asset (or its neighbourhood) changes, so they
 *   disappear exactly when their cause disappears and survive an index rebuild: missing-file, broken-reference,
 *   stale-upstream, thumbnail-stale, duplicate-content;
 * - event ones are raised by whoever sees the cause (scanner, pipeline, service) and resolved by them or by a human:
 *   duplicate-guid, metadata-conflict, orphan-sidecar, pipeline-failed, plugin-missing.
 * Issue ids are derived from the cause, so the same cause keeps the same id.
 */
import { ISSUE_LEVEL_OF, versionNumberOf, type Bmeta, type IssueType } from '@bowerbird/schema'
import type { CoreLogger, EventBus } from '../contracts.js'
import { FLAG, ISSUE_RANK } from '../index/ddl.js'
import type { AssetRow, IndexStore, IssueRow, RelationRow } from '../index/store.js'
import { isSafeRelPath } from '../library/paths.js'

/** Kernel namespace in `fields` holding a pending identity decision (R9): the copy knows its original. */
export const IDENTITY_FIELD = 'bowerbird.identity'
export interface IdentityNote { copiedFrom: string; at: string; confirmed: boolean; reason?: string; originalPath?: string; copyPath?: string }
export function identityOf(meta: Bmeta): IdentityNote | null {
  const v = meta.fields?.[IDENTITY_FIELD] as IdentityNote | undefined
  return v && typeof v.copiedFrom === 'string' ? v : null
}

/** Long loops give the event loop back this often (assets per slice). */
const YIELD_EVERY = 500
const yieldLoop = () => new Promise<void>(r => setImmediate(r))

export const DERIVED_TYPES: ReadonlySet<IssueType> = new Set(['missing-file', 'broken-reference', 'stale-upstream', 'thumbnail-stale', 'duplicate-content', 'plugin-missing', 'duplicate-guid'])

/** Derived issues are recomputed from the index; the slot-name conflict is a derived metadata-conflict. */
export function isDerived(r: { type: string; id: string }): boolean {
  return DERIVED_TYPES.has(r.type as IssueType) || r.id.startsWith('metadata-conflict:slot:')
}

export interface IssueDraft {
  id: string
  type: IssueType
  assetId: string | null
  relation?: { type: string; to: string; slot?: string }
  path?: string
  details?: Record<string, unknown>
}

export const issueId = {
  missingFile: (asset: string) => `missing-file:${asset}`,
  broken: (from: string, type: string, to: string, slot: string) => `broken-reference:${from}:${type}:${to}${slot ? ':' + slot : ''}`,
  stale: (from: string, type: string, to: string, slot: string) => `stale-upstream:${from}:${type}:${to}${slot ? ':' + slot : ''}`,
  thumbStale: (asset: string) => `thumbnail-stale:${asset}`,
  dupContent: (asset: string, other: string) => `duplicate-content:${asset}:${other}`,
  dupGuid: (copy: string) => `duplicate-guid:${copy}`,
  conflict: (path: string) => `metadata-conflict:${path}`,
  slotConflict: (asset: string) => `metadata-conflict:slot:${asset}`,
  orphan: (path: string) => `orphan-sidecar:${path}`,
  pipeline: (asset: string, stage: string) => `pipeline-failed:${asset}:${stage}`,
  plugin: (plugin: string) => `plugin-missing:${plugin}`,
  pluginAsset: (plugin: string, asset: string) => `plugin-missing:${plugin}:${asset}`
}

export interface IntegrityOptions {
  store: IndexStore
  events: EventBus
  library: string
  log: CoreLogger
  /** Issue ids people chose to ignore (library settings `ignoredIssues`). */
  ignored: () => ReadonlySet<string>
  /** mtime of a manual thumbnail file (thumbnail-stale). */
  thumbMtime: (name: string) => Promise<number | null>
  /** Whether a relation type records the counterpart's version (source + plugin types that say so). */
  tracksVersion: (type: string) => boolean
  /** A declared plugin this machine lacks would read this asset (ADR-012, ADR-044). */
  missingPlugin?: (row: AssetRow) => { id: string; range: string; displayName?: string } | null
}

function rank(level: string): number { return level === 'error' ? ISSUE_RANK.error : level === 'warning' ? ISSUE_RANK.warning : level === 'info' ? ISSUE_RANK.info : 0 }

export class Integrity {
  constructor(private readonly o: IntegrityOptions) {}

  private get db() { return this.o.store.db }

  private insert(d: IssueDraft, foundAt = new Date().toISOString()): void {
    this.o.store.prep(`INSERT INTO issues (id, type, level, asset_id, rel_type, rel_to, rel_slot, path, details_json, found_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET type=excluded.type, level=excluded.level, asset_id=excluded.asset_id, rel_type=excluded.rel_type,
        rel_to=excluded.rel_to, rel_slot=excluded.rel_slot, path=excluded.path, details_json=excluded.details_json`)
      .run(d.id, d.type, ISSUE_LEVEL_OF[d.type], d.assetId, d.relation?.type ?? null, d.relation?.to ?? null, d.relation?.slot ?? null,
        d.path ?? null, JSON.stringify(d.details ?? {}), foundAt)
  }

  /** Raise an event issue (no-op if already there, details refreshed). Returns true when it is new. */
  raise(d: IssueDraft): boolean {
    if (this.o.ignored().has(d.id)) return false
    const existed = this.o.store.issue(d.id)
    this.insert(d, existed?.found_at)
    if (!existed) {
      this.o.events.emit(this.o.library, 'issue.created', { id: d.id, type: d.type, assetId: d.assetId })
      if (d.assetId) this.updateAssetState(d.assetId)
    }
    return !existed
  }

  /** Resolve an issue by id (any kind). */
  resolve(id: string): boolean {
    const row = this.o.store.issue(id)
    if (!row) return false
    this.o.store.prep('DELETE FROM issues WHERE id = ?').run(id)
    this.o.events.emit(this.o.library, 'issue.resolved', { id, type: row.type, assetId: row.asset_id })
    if (row.asset_id) this.updateAssetState(row.asset_id)
    return true
  }

  /** Resolve every issue matching a predicate (e.g. all metadata-conflicts of one path). */
  resolveWhere(pred: (r: IssueRow) => boolean): string[] {
    const out: string[] = []
    for (const r of this.o.store.allIssues()) if (pred(r)) { this.resolve(r.id); out.push(r.id) }
    return out
  }

  /** An asset left the index (trash / purge): drop its issues. */
  removeAsset(id: string): void {
    for (const r of this.o.store.prep('SELECT * FROM issues WHERE asset_id = ?').all(id) as IssueRow[]) {
      this.o.store.prep('DELETE FROM issues WHERE id = ?').run(r.id)
      this.o.events.emit(this.o.library, 'issue.resolved', { id: r.id, type: r.type, assetId: r.asset_id })
    }
  }

  /** Assets whose derived state may depend on these ids: referrers, duplicate-content partners, same-hash peers. */
  async expand(ids: Iterable<string>): Promise<Set<string>> {
    const out = new Set<string>()
    const referrers = this.o.store.prep('SELECT DISTINCT from_id FROM relations WHERE to_id = ?')
    const partners = this.o.store.prep('SELECT asset_id FROM issues WHERE rel_to = ? AND asset_id IS NOT NULL')
    const peers = this.o.store.prep('SELECT b.id FROM assets a JOIN assets b ON b.hash = a.hash AND b.id != a.id WHERE a.id = ?')
    let n = 0
    for (const id of ids) {
      out.add(id)
      for (const r of referrers.all(id) as Array<{ from_id: string }>) out.add(r.from_id)
      for (const r of partners.all(id) as Array<{ asset_id: string }>) out.add(r.asset_id)
      for (const p of peers.all(id) as Array<{ id: string }>) out.add(p.id)
      if (++n % YIELD_EVERY === 0) await yieldLoop()
    }
    return out
  }

  /**
   * Recompute derived issues and flags for these assets and everything that depends on them. Large sets (a full
   * scan, a rebuild) go in slices that give the event loop back, so the server keeps answering meanwhile.
   */
  async refresh(ids: Iterable<string>, opts: { expand?: boolean } = {}): Promise<void> {
    const list = ids instanceof Set ? ids : new Set(ids)
    // touching most of the library: expanding is pointless, everything gets recomputed anyway
    const many = list.size > 2000 && list.size * 2 > this.o.store.count()
    const set = many ? new Set(this.o.store.allIds()) : opts.expand === false ? list : await this.expand(list)
    let n = 0
    for (const id of set) {
      await this.refreshOne(id)
      if (++n % YIELD_EVERY === 0) await yieldLoop()
    }
  }

  /** Full recomputation (after a full scan or rebuild). */
  async refreshAll(): Promise<void> {
    const ids = this.o.store.allIds()
    const live = new Set(ids)
    // derived issues of assets that no longer exist
    for (const r of this.o.store.allIssues()) {
      if (isDerived(r) && r.asset_id && !live.has(r.asset_id)) this.resolve(r.id)
    }
    let n = 0
    for (const id of ids) {
      await this.refreshOne(id)
      if (++n % YIELD_EVERY === 0) await yieldLoop()
    }
  }

  private async refreshOne(id: string): Promise<void> {
    const store = this.o.store
    const row = store.row(id)
    if (!row) {
      for (const r of store.issuesOf(id)) if (isDerived(r)) this.resolve(r.id)
      return
    }
    const meta = store.meta(row)
    const ignored = this.o.ignored()
    const want: IssueDraft[] = []
    let anyBroken = false
    let anyStale = false

    const originalPath = store.originalPath(id)
    if (row.missing) want.push({ id: issueId.missingFile(id), type: 'missing-file', assetId: id, path: originalPath ?? row.path, details: { name: row.name, ...(originalPath ? { originalPath, pathTaken: true } : {}) } })
    const identity = identityOf(meta)
    if (identity && identity.confirmed === false) {
      const orig = store.row(identity.copiedFrom)
      const rec = meta.relations?.find(r => r.type === 'source' && r.to === identity.copiedFrom)?.record
      want.push({
        id: issueId.dupGuid(id), type: 'duplicate-guid', assetId: id, path: row.path,
        details: {
          otherId: identity.copiedFrom, otherPath: orig?.path ?? identity.originalPath ?? null, originalPath: orig?.path ?? identity.originalPath ?? null,
          copyPath: row.path, reason: identity.reason ?? 'index', referencedBy: store.referrers(identity.copiedFrom).length, ...(rec ? { recordId: rec } : {})
        }
      })
    }
    const badSlots = (meta.relations ?? []).filter(r => r.slot !== undefined && !isSafeRelPath(r.slot)).map(r => String(r.slot))
    if (badSlots.length) want.push({ id: issueId.slotConflict(id), type: 'metadata-conflict', assetId: id, path: row.path, details: { kind: 'slot', slots: badSlots } })
    const mp = this.o.missingPlugin?.(row)
    if (mp) want.push({ id: issueId.pluginAsset(mp.id, id), type: 'plugin-missing', assetId: id, path: row.path, details: { plugin: mp.id, range: mp.range, ...(mp.displayName ? { displayName: mp.displayName } : {}) } })

    for (const rel of store.outgoing(id)) {
      const target = rel.to_id === id ? row : store.row(rel.to_id)
      const broken = !target
      const stale = !!target && this.o.tracksVersion(rel.type) && !!rel.to_hash && rel.to_hash !== target.hash
      if (broken !== !!rel.broken || stale !== !!rel.stale) store.setRelationState(rel, broken, stale)
      if (broken) {
        anyBroken = true
        want.push(this.brokenDraft(id, rel))
      }
      if (stale && target) {
        anyStale = true
        const tmeta = store.meta(target)
        const versions = tmeta.versions ?? []
        want.push({
          id: issueId.stale(id, rel.type, rel.to_id, rel.slot), type: 'stale-upstream', assetId: id,
          relation: { type: rel.type, to: rel.to_id, ...(rel.slot ? { slot: rel.slot } : {}) },
          details: {
            toName: target.name,
            fromVersion: versionNumberOf(versions, rel.to_hash!) ?? null,
            toVersion: versionNumberOf(versions, target.hash) ?? versions.length,
            modifiedBy: tmeta.versions?.[tmeta.versions.length - 1]?.by ?? null,
            modifiedAt: tmeta.versions?.[tmeta.versions.length - 1]?.at ?? null
          }
        })
      }
    }

    if (meta.thumbnail) {
      const t = await this.o.thumbMtime(meta.thumbnail)
      const last = meta.versions?.[meta.versions.length - 1]?.at
      if (t !== null && last && Date.parse(last) > t) {
        want.push({ id: issueId.thumbStale(id), type: 'thumbnail-stale', assetId: id, details: { thumbnailAt: new Date(t).toISOString(), contentAt: last } })
      }
    }

    if (!row.missing) {
      const peers = store.rowsByHash(row.hash).filter(p => !p.missing)
      if (peers.length > 1) {
        const original = peers[0]!
        if (original.id !== id && !this.markedCopy(meta, original, peers)) {
          want.push({ id: issueId.dupContent(id, original.id), type: 'duplicate-content', assetId: id, relation: undefined, details: { otherId: original.id, otherName: original.name, otherPath: original.path } })
        }
      }
    }

    // diff against existing derived issues
    const have = store.issuesOf(id).filter(r => isDerived(r))
    const wantIds = new Set<string>()
    for (const d of want) {
      if (ignored.has(d.id)) continue
      wantIds.add(d.id)
      const existed = have.find(h => h.id === d.id)
      // duplicate-content uses rel_to to remember the partner (dependency expansion)
      const draft = d.type === 'duplicate-content' ? { ...d, relation: { type: 'duplicate', to: String(d.details?.otherId) } } : d
      this.insert(draft, existed?.found_at)
      if (!existed) this.o.events.emit(this.o.library, 'issue.created', { id: d.id, type: d.type, assetId: id })
    }
    for (const h of have) {
      if (wantIds.has(h.id)) continue
      this.o.store.prep('DELETE FROM issues WHERE id = ?').run(h.id)
      this.o.events.emit(this.o.library, 'issue.resolved', { id: h.id, type: h.type, assetId: id })
    }

    const memberCount = (this.o.store.prep("SELECT COUNT(DISTINCT r.from_id) n FROM relations r JOIN assets a ON a.id = r.from_id WHERE r.to_id = ? AND r.type = 'belongs' AND r.from_id != ?").get(id, id) as { n: number }).n
    const keep = row.flags & (FLAG.processing | FLAG.failed)
    const flags = keep | (anyStale ? FLAG.stale : 0) | (anyBroken ? FLAG.broken : 0) | (row.missing ? FLAG.missing : 0)
    this.updateAssetState(id, flags, memberCount)
  }

  private brokenDraft(id: string, rel: RelationRow): IssueDraft {
    const trash = this.o.store.trashByAsset(rel.to_id)
    return {
      id: issueId.broken(id, rel.type, rel.to_id, rel.slot), type: 'broken-reference', assetId: id,
      relation: { type: rel.type, to: rel.to_id, ...(rel.slot ? { slot: rel.slot } : {}) },
      details: { toName: trash?.name ?? null, inTrash: !!trash, trashId: trash?.id ?? null }
    }
  }

  /** ADR-037: a pair stops being a duplicate once one is marked as a copy of the other (source relation). */
  private markedCopy(meta: Bmeta, original: AssetRow, peers: AssetRow[]): boolean {
    const peerIds = new Set(peers.map(p => p.id))
    if (meta.relations?.some(r => r.type === 'source' && peerIds.has(r.to))) return true
    const om = this.o.store.meta(original)
    return !!om.relations?.some(r => r.type === 'source' && r.to === meta.id)
  }

  /** Recompute issue level / count (and optionally flags, member count); emit when it changed. */
  updateAssetState(id: string, flags?: number, memberCount?: number): void {
    const row = this.o.store.row(id)
    if (!row) return
    const issues = this.o.store.issuesOf(id)
    let level = 0
    for (const i of issues) level = Math.max(level, rank(i.level))
    const f = flags ?? row.flags
    const m = memberCount ?? row.member_count
    if (row.issue_level === level && row.issue_count === issues.length && row.flags === f && row.member_count === m) return
    this.o.store.prep('UPDATE assets SET issue_level=?, issue_count=?, flags=?, member_count=?, seq=seq+1 WHERE id=?').run(level, issues.length, f, m, id)
    this.o.events.emit(this.o.library, 'asset.updated', { id, fields: ['issues'] })
  }

  /** Set or clear the pipeline flags (processing / failed). */
  setPipelineFlags(id: string, processing: boolean, failed: boolean): boolean {
    const row = this.o.store.row(id)
    if (!row) return false
    const f = (row.flags & ~(FLAG.processing | FLAG.failed)) | (processing ? FLAG.processing : 0) | (failed ? FLAG.failed : 0)
    if (f === row.flags) return false
    this.o.store.prep('UPDATE assets SET flags=?, seq=seq+1 WHERE id=?').run(f, id)
    return true
  }
}
