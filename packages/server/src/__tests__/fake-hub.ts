/**
 * A minimal recording fake of Hub / LibraryService / PluginHost for route-layer tests. Every LibraryService call
 * is recorded; behaviour is overridable per test. Data shapes follow @bowerbird/schema so responses validate.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEventBus, silentLogger, CoreError, type CallContext, type Hub, type LibraryService } from '@bowerbird/core'
import type { AssetDetail, AssetSummary, LibraryInfo, PluginInfo } from '@bowerbird/schema'

export const LIB = '01936b2a-0000-7000-8000-00000000a001'
export const ID1 = '01936b2a-0000-7000-8000-000000000001'
export const ID2 = '01936b2a-0000-7000-8000-000000000002'

export function summary(over: Partial<AssetSummary> = {}): AssetSummary {
  return {
    id: ID1, name: 'chest.png', path: 'props/chest.png', format: 'image', plugin: 'bowerbird.image', stage: 'production',
    review: 'pending', tags: ['宝箱'], autoTags: [], description: null, flags: [], thumbnail: null, thumbState: 'ready',
    aspect: 1, badge: '1024×1024', issueLevel: null, issueCount: 0, size: 10, modified: '2026-11-25T00:00:00.000Z',
    created: '2026-11-25T00:00:00.000Z', createdBy: 'user:unnamed', bundle: false, auxiliary: false, memberCount: 0,
    cellText: null, missingPlugin: null, ...over
  }
}

export function detail(over: Partial<AssetDetail> = {}): AssetDetail {
  return {
    ...summary(),
    hash: 'sha256:00', descriptionFull: null, auto: null, fields: {}, reviewVerdict: null, versions: [], views: null,
    thumbnailManual: false, origin: null, modifiedBy: null, tech: {}, analysis: {}, unresolvedRefs: [], checks: [],
    relations: { outgoing: [], incoming: [] }, issues: [], record: null, bundleFiles: null, targetSize: null, stages: [],
    ...over
  }
}

export interface Call { method: string; args: unknown[] }

export interface FakeOptions {
  /** Overrides for LibraryService methods. */
  svc?: Partial<Record<keyof LibraryService, (...args: any[]) => unknown>>
  plugins?: Partial<PluginInfo>[]
  webEntry?: (id: string) => string | null
  routes?: Array<{ pluginId: string; route: { method: string; path: string; handler: (r: any) => Promise<any> } }>
  auth?: Array<{ pluginId: string; provider: { id: string; check: (r: any) => Promise<any> } }>
  /** Plugin settings schemas by plugin id (default: an empty object schema). */
  schemas?: Record<string, Record<string, unknown>>
  /** More libraries on the same fake hub, each a fake of its own (multi-library and access-control tests). */
  extra?: FakeHub[]
  /** Library id of this fake (default LIB). */
  libraryId?: string
  /** Delay `hub.library()` until this resolves (SSE: client gone while the library opens). */
  openGate?: () => Promise<void>
}

export const LIB2 = '01936b2a-0000-7000-8000-00000000a002'

export interface FakeHub {
  hub: Hub
  svc: LibraryService
  calls: Call[]
  /** Last call of a method. */
  last(method: string): Call | undefined
  tmp: string
  events: ReturnType<typeof createEventBus>
  errors: Array<{ msg: string; data?: Record<string, unknown> }>
  cleanup(): void
}

export function createFakeHub(opts: FakeOptions = {}): FakeHub {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-server-test-'))
  const root = path.join(tmp, 'lib')
  fs.mkdirSync(path.join(root, 'props'), { recursive: true })
  const assetFile = path.join(root, 'props', 'chest.png')
  fs.writeFileSync(assetFile, '0123456789')
  const calls: Call[] = []
  const events = createEventBus()
  const errors: FakeHub['errors'] = []
  const log = { ...silentLogger, error: (msg: string, data?: Record<string, unknown>) => { errors.push({ msg, data }) }, child: () => log }

  const libId = opts.libraryId ?? LIB
  const info = (ctx: CallContext): LibraryInfo => ({
    id: libId, name: '星落', root, state: 'ready', formatVersion: 1, settings: null, requiredPlugins: [],
    stats: { assets: 1, bytes: 10, issues: 0, issueAssets: 0 }, counts: { all: 1, untagged: 0, pending: 1, issues: 0, trash: 0 },
    isLocal: ctx.isLocal, versionStore: null, hasCreators: false, firstOpen: null,
    scan: { running: false, phase: 'idle', done: 0, total: 0 }, lanOpen: false, address: 'http://127.0.0.1:7420'
  })

  const plugins = {
    enabled: () => [{ id: 'bowerbird.image', version: '0.1.0', displayName: '图片' }],
    routes: () => opts.routes ?? [],
    auth: () => opts.auth ?? [],
    invoke: async <T>(_id: string, _label: string, fn: () => Promise<T>) => fn()
  }

  const defaults: Partial<Record<keyof LibraryService, (...args: any[]) => unknown>> = {
    info: async (ctx: CallContext) => info(ctx),
    patchLibrary: async (_p: unknown, ctx: CallContext) => info(ctx),
    initialize: async () => undefined,
    rescan: async () => undefined,
    stopScan: async () => undefined,
    vocabulary: async () => ({ stages: [], reviews: [], formats: [], relationTypes: [], tags: [], methods: [], actors: [], templates: [], designObjects: [] }),
    search: async () => ({ items: [summary()], total: 1, cursor: null }),
    get: async (id: string) => { if (id !== ID1 && id !== ID2) throw new CoreError('not_found', '资产不存在'); return detail({ id }) },
    precheck: async () => ({ conflicts: [] }),
    register: async () => ({ asset: detail(), skipped: false, recordId: null, newTags: [] }),
    patch: async (id: string) => ({ asset: detail({ id }), newTags: [] }),
    trash: async () => ({ trashId: 'trash_1', referrers: [] }),
    replaceContent: async (id: string) => detail({ id }),
    move: async (id: string) => detail({ id }),
    copy: async () => ({ asset: detail({ id: ID2 }), name: 'chest_1.png', originalReferenced: false, message: '已复制为 chest_1.png' }),
    review: async (id: string) => detail({ id }),
    acceptAutoTags: async (id: string) => detail({ id }),
    dismissAutoTags: async (id: string) => detail({ id }),
    file: async () => ({ absPath: assetFile, size: 10, name: '宝箱 chest.png', mime: 'image/png' }),
    slotFile: async (_id: string, slot: string) => slot === 'tex.png' ? { absPath: assetFile, size: 10, name: 'tex.png', mime: 'image/png' } : null,
    bundleFile: async (_id: string, inner: string) => inner === 'index.html' ? { absPath: assetFile, size: 10, name: 'index.html', mime: 'text/html' } : null,
    open: async () => undefined,
    reveal: async () => undefined,
    thumbnailFile: async (_id: string, variant: string) => variant === 'thumb' ? assetFile.replace(/\.png$/, '.png') : null,
    setManualThumbnail: async (id: string) => detail({ id, thumbnailManual: true }),
    clearManualThumbnail: async (id: string) => detail({ id }),
    summary: async () => ({ text: '图片 1024×1024', image: null, imageMissingReason: '概览图还没有渲染，有人打开页面后才会生成' }),
    lineage: async (id: string) => ({ center: id, nodes: [summary({ id })], missing: [], edges: [], records: {} }),
    versions: async () => ({ versions: [], store: null }),
    versionFile: async () => { throw new CoreError('unsupported', '需要版本插件才能读取旧版本') },
    restoreVersion: async () => { throw new CoreError('unsupported', '需要版本插件') },
    batch: async () => ({ updated: [ID1], failed: [] }),
    addRelation: async (id: string) => detail({ id }),
    removeRelation: async (id: string) => detail({ id }),
    replaceRelation: async (id: string) => detail({ id }),
    acknowledgeUpstream: async (id: string) => detail({ id }),
    retarget: async (req: { dryRun: boolean }) => ({ affected: [], applied: !req.dryRun }),
    createRecord: async (input: { method: string }, ctx: CallContext) => ({ id: 'rec_1', method: input.method, by: ctx.actor, at: '2026-11-25T00:00:00.000Z' }),
    record: async (id: string) => { if (id !== 'rec_1') throw new CoreError('not_found', '没有这条生产记录'); return { record: { id, method: 'manual', by: 'user:unnamed', at: '2026-11-25T00:00:00.000Z' }, outputs: [] } },
    addRecordNote: async (id: string) => ({ record: { id, method: 'manual', by: 'user:unnamed', at: '2026-11-25T00:00:00.000Z' }, outputs: [] }),
    folders: async () => ({ path: '', name: '星落', count: 1, modified: null, effectiveDefaults: { from: {} }, children: [] }),
    createFolder: async () => undefined,
    patchFolder: async () => undefined,
    trashFolder: async () => ({ trashed: 0, batch: null }),
    makeBundle: async () => detail({ bundle: true }),
    tags: async () => ({ tags: [], groups: [] }),
    patchTags: async () => ({ affected: 0 }),
    acceptTagEverywhere: async () => ({ affected: 1 }),
    dismissTagEverywhere: async () => ({ affected: 1 }),
    views: async () => [],
    putView: async () => [],
    deleteView: async () => [],
    issues: async () => ({ issues: [], assets: {}, assetCount: 0, total: 0 }),
    resolveIssue: async (id: string) => ({ resolved: [id], failed: [] }),
    resolveIssues: async () => ({ resolved: [], failed: [] }),
    relocateCandidates: async () => ({ candidates: [] }),
    trashList: async () => ({ items: [], trashDays: 7 }),
    restore: async () => ({ asset: summary(), renamedTo: null }),
    purge: async () => undefined,
    emptyTrash: async () => undefined,
    actions: async (ids: string[]) => ids.length ? [{ id: 'acme.tools:trim', pluginId: 'acme.tools', pluginName: 'Acme 工具', title: '裁掉透明边' }] : [],
    runAction: async (id: string, req: { ids: string[] }, ctx: CallContext) => {
      if (id !== 'acme.tools:trim') throw new CoreError('not_found', `没有这个动作：${id}`)
      return { id: 'job_a1', kind: 'action', status: 'queued', attempts: 0, outputs: [], createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z', by: ctx.actor, message: `${req.ids.length} 个资产` }
    },
    creators: async () => [],
    startCreate: async () => { throw new CoreError('not_found', '没有这个创建方式') },
    jobs: async () => ({ stages: [], waitingRender: 0, busy: 0, scan: { running: false, phase: 'idle', done: 0, total: 0 }, failed: [], creates: [], processing: [] }),
    job: async (id: string) => { throw new CoreError('not_found', `没有任务 ${id}`) },
    cancelJob: async () => undefined,
    retryJobs: async () => undefined,
    exportPlan: async () => ({ files: [{ path: 'chest.png', size: 10, assetId: ID1, dependency: false }], bytes: 10, dependencies: 0, duplicateNames: false }),
    exportToDir: async (req: { dir: string }) => ({ written: 1, dir: req.dir, bytes: 10 }),
    exportFiles: async () => [['props/chest.png', assetFile]],
    renderNext: async () => null,
    renderSubmit: async () => undefined,
    cache: async () => ({ bytes: 0, files: 0, dir: path.join(root, '.bowerbird/cache'), inLibrary: true }),
    cleanCache: async () => ({ removedBytes: 0, removedFiles: 0 }),
    pluginLibrarySettings: async () => ({ defaultEnvironment: 'studio' }),
    setPluginLibrarySettings: async () => undefined,
    close: async () => undefined
  }
  const impl = { ...defaults, ...(opts.svc ?? {}) }
  const svc = new Proxy({} as LibraryService, {
    get(_t, prop: string) {
      if (prop === 'id') return libId
      if (prop === 'paths') return { root, metaDir: path.join(root, '.bowerbird'), cacheDir: path.join(root, '.bowerbird/cache'), dataDir: path.join(tmp, 'data'), indexPath: path.join(tmp, 'data/index.sqlite'), tmpDir: path.join(tmp, 'tmp') }
      if (prop === 'plugins') return () => plugins
      if (prop === 'then') return undefined
      const f = impl[prop as keyof LibraryService]
      if (!f) return undefined
      return (...args: unknown[]) => { calls.push({ method: prop, args }); return f(...args) }
    }
  })

  const pluginInfos: PluginInfo[] = (opts.plugins ?? [{ id: 'bowerbird.image' }, { id: 'community.spine', status: 'enabled', builtin: false }]).map(p => ({
    id: 'x', packageName: p.id ?? 'x', version: '0.1.0', displayName: p.id ?? 'x', builtin: true, status: 'enabled', contributes: [], formats: [],
    hasWeb: false, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'builtin', ...p
  }) as PluginInfo)

  const machineSettings: Record<string, Record<string, unknown>> = {}
  const hub: Hub = {
    home: tmp,
    events,
    log,
    plugins: {
      discover: async () => undefined,
      list: () => pluginInfos,
      forLibrary: async () => { throw new Error('not used') },
      install: async (spec: string) => { calls.push({ method: 'plugins.install', args: [spec] }); return pluginInfos[0]! },
      update: async (id: string) => { calls.push({ method: 'plugins.update', args: [id] }); return pluginInfos[0]! },
      remove: async (id: string) => { calls.push({ method: 'plugins.remove', args: [id] }) },
      webEntry: (id: string) => opts.webEntry?.(id) ?? null,
      machineSettings: (id: string) => ({ ...(machineSettings[id] ?? {}) }),
      // like core: merge, null deletes
      setMachineSettings: async (id: string, values: Record<string, unknown>) => {
        calls.push({ method: 'plugins.setMachineSettings', args: [id, values] })
        const next = { ...(machineSettings[id] ?? {}) }
        for (const [k, v] of Object.entries(values)) { if (v === null || v === undefined) delete next[k]; else next[k] = v }
        machineSettings[id] = next
      },
      // like core: an unknown plugin is not_found
      settingsSchema: (id: string) => {
        if (opts.schemas?.[id]) return opts.schemas[id]!
        if (pluginInfos.some(p => p.id === id)) return { type: 'object', properties: {} }
        throw new CoreError('not_found', `没有找到插件 ${id}`)
      },
      close: async () => undefined
    },
    config: () => ({ host: '127.0.0.1', port: 7420, libraries: [{ id: libId, root }], cacheDirs: {}, scanIntervalMinutes: 10, allowedOrigins: [], plugins: JSON.parse(JSON.stringify(machineSettings)), installed: [] }),
    patchConfig: async patch => ({ config: { ...hub.config(), ...patch } as ReturnType<Hub['config']>, dataDir: tmp, restartRequired: 'port' in patch }),
    libraries: () => [{ id: libId, name: '星落', root, state: 'ready' }, ...(opts.extra ?? []).flatMap(e => e.hub.libraries())],
    defaultLibraryId: () => libId,
    addLibrary: async (r: string, name?: string) => { calls.push({ method: 'hub.addLibrary', args: [r, name] }); return { id: LIB, name: name ?? '星落', root: r, state: 'ready' } },
    library: async (id: string) => {
      calls.push({ method: 'hub.library', args: [id] })
      if (opts.openGate) await opts.openGate()
      if (id === libId) return svc
      const other = (opts.extra ?? []).find(e => e.svc.id === id)
      if (other) return other.svc
      throw new CoreError('not_found', `没有资产库 ${id}`)
    },
    initLibrary: async (r: string) => ({ id: LIB, name: '星落', root: r, state: 'ready' }),
    health: async () => ({ status: 'ok', libraries: [{ id: LIB, state: 'ready', index: 'ready' }] }),
    close: async () => undefined
  }
  return {
    hub, svc, calls, tmp, events, errors,
    last: m => [...calls].reverse().find(c => c.method === m),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true })
  }
}
