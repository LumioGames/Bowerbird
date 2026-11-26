/**
 * Test-only fakes for web-2's tests: a stand-in API client (every method a vi.fn) and builders for the data the
 * pages read. Shapes follow packages/schema; values follow the prototype's sample library (design/prototype/data.js).
 * Not imported by any production module.
 */
import { vi } from 'vitest'
import type { AssetDetail, AssetSummary, Issue, LibraryInfo, Lineage, RelationView, TrashItem, VersionView } from '@bowerbird/schema'

const fn = () => vi.fn()
export const fakeApi = {
  libraries: { get: fn(), patch: fn(), vocabulary: fn(), cache: fn(), cleanCache: fn(), rescan: fn(), stopScan: fn(), eventsUrl: (l: string) => `/api/v1/libraries/${l}/events` },
  config: { get: fn(), patch: fn() },
  plugins: { list: fn(), install: fn(), update: fn(), enable: fn(), disable: fn(), machineSettings: fn(), putMachineSettings: fn(), librarySettings: fn(), putLibrarySettings: fn(), webUrl: (id: string) => `/api/v1/plugins/${id}/web` },
  search: fn(),
  assets: {
    get: fn(), review: fn(), versions: fn(), lineage: fn(), restoreVersion: fn(), replaceContent: fn(), acceptTags: fn(), dismissTags: fn(), remove: fn(), batch: fn(),
    fileUrl: (l: string, id: string, d = false) => `/api/v1/libraries/${l}/assets/${id}/file${d ? '?download=1' : ''}`,
    versionFileUrl: (l: string, id: string, h: string) => `/api/v1/libraries/${l}/assets/${id}/versions/${h}/file`,
    slotUrl: (l: string, id: string, s: string) => `/api/v1/libraries/${l}/assets/${id}/slots/${s}`,
    bundleFileUrl: (l: string, id: string, i: string) => `/api/v1/libraries/${l}/assets/${id}/bundle/${i}`,
    thumbnailUrl: (l: string, id: string) => `/api/v1/libraries/${l}/assets/${id}/thumbnail`
  },
  relations: { add: fn(), remove: fn(), replace: fn(), acknowledge: fn(), retarget: fn() },
  records: { create: fn(), get: fn(), addNote: fn() },
  folders: { tree: fn() },
  tags: { list: fn(), patch: fn(), accept: fn(), dismiss: fn() },
  issues: { list: fn(), resolve: fn(), resolveMany: fn(), candidates: fn() },
  trash: { list: fn(), restore: fn(), purge: fn(), empty: fn() },
  jobs: { overview: fn(), cancel: fn(), retry: fn() }
}

/** Reset every vi.fn in the fake client. */
export function resetFakeApi(): void {
  for (const group of Object.values(fakeApi)) {
    if (typeof group === 'function') { (group as ReturnType<typeof vi.fn>).mockReset(); continue }
    for (const v of Object.values(group)) if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
}

let n = 0
export const gid = (k: number | string) => `0192f3a4-7c1e-7b52-9d06-${String(typeof k === 'number' ? k : (n += 1)).padStart(12, '0')}`
export const hash = (k: string | number) => `sha256:${String(k).replace(/[^0-9a-f]/g, '').padEnd(8, '0')}`

export function summary(o: Partial<AssetSummary> & { id: string; name: string }): AssetSummary {
  return {
    path: `props/chest/${o.name}`, format: 'image', plugin: 'bowerbird.image', stage: 'runtime', review: 'pending', tags: [], autoTags: [],
    description: null, flags: [], thumbnail: null, thumbState: 'ready', aspect: 1, badge: null, issueLevel: null, issueCount: 0, size: 1000,
    modified: '2026-11-24T08:00:00.000Z', created: '2026-11-20T08:00:00.000Z', createdBy: 'user:lin', bundle: false, auxiliary: false,
    memberCount: 0, cellText: null, missingPlugin: null, ...o
  }
}

export function detail(o: Partial<AssetDetail> & { id: string; name: string }): AssetDetail {
  const s = summary(o)
  return {
    ...s, hash: hash(o.id.slice(-4)), descriptionFull: null, auto: null, fields: {}, reviewVerdict: null,
    versions: [{ hash: hash(o.id.slice(-4)), size: s.size, at: '2026-11-24T08:00:00.000Z', by: 'user:lin' }],
    views: null, thumbnailManual: false, origin: null, modifiedBy: null, tech: {}, analysis: {}, unresolvedRefs: [], checks: [],
    relations: { outgoing: [], incoming: [] }, issues: [], record: null, bundleFiles: null, targetSize: null, stages: [],
    ...o
  } as AssetDetail
}

export function relation(o: Partial<RelationView> & { type: string; from: string; to: string }): RelationView {
  return { target: null, targetName: null, targetInTrash: false, broken: false, stale: false, ...o }
}

export function lineage(center: string, nodes: AssetSummary[], edges: Lineage['edges'], o: Partial<Lineage> = {}): Lineage {
  return { center, nodes, missing: [], edges, records: {}, ...o }
}

export function version(n: number, o: Partial<VersionView> = {}): VersionView {
  return { hash: hash(`${n}a`), size: 1000 * n, at: `2026-11-2${n}T08:00:00.000Z`, by: 'user:lin', note: `v${n}`, n, current: false, hasContent: true, ...o }
}

export function issue(o: Partial<Issue> & { id: string; type: Issue['type']; level: Issue['level'] }): Issue {
  return { assetId: null, details: {}, foundAt: '2026-11-24T08:00:00.000Z', ...o }
}

export function trashItem(o: Partial<TrashItem> & { id: string; name: string }): TrashItem {
  return {
    assetId: gid(o.id), originalPath: `props/chest/${o.name}`, folder: 'props/chest', format: 'image', stage: 'runtime', review: 'approved', size: 1000,
    thumbnail: null, deletedAt: '2026-11-22T08:00:00.000Z', deletedBy: 'user:mo', daysLeft: 4, referencedBy: 0, recordOnly: false, ...o
  }
}

export function libraryInfo(o: Partial<LibraryInfo> = {}): LibraryInfo {
  return {
    id: 'lib1', name: '星落镇', root: '/data/xingluo', state: 'ready', formatVersion: 1,
    settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 },
    requiredPlugins: [], stats: { assets: 10, bytes: 1000, issues: 0, issueAssets: 0 },
    counts: { all: 10, untagged: 0, pending: 3, issues: 0, trash: 0 }, isLocal: true, versionStore: null, hasCreators: false, firstOpen: null,
    scan: { running: false, phase: 'idle', done: 0, total: 0 }, lanOpen: false, address: 'http://127.0.0.1:7420', ...o
  }
}
