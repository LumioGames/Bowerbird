/**
 * The Fastify application: every endpoint of `ENDPOINTS` (schema/api.ts) wired to Hub / LibraryService /
 * PluginHost, plus plugin routes, plugin web modules, SSE and the static web shell (api-and-agent.md).
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import yazl from 'yazl'
import {
  API_BASE, ENDPOINTS, Guid, RESERVED_PLUGIN_PATHS, THUMB_VARIANTS, ThumbVariant,
  AssetPatch, BatchRequest, BundleRequest, CacheCleanRequest, ConfigPatchRequest, ContentReplaceFields, CopyRequest,
  CreateRunRequest, ExportRequest, FolderCreateRequest, FolderDeleteRequest, FolderPatchRequest, IssueBatchResolveRequest,
  IssueResolveRequest, IssuesQuery, JobsRetryRequest, LibraryAddRequest, LibraryPatchRequest, LibraryTagRequest,
  LineageQuery, MoveRequest, PluginInstallRequest, PluginSettingsPut, PluginToggleRequest, PrecheckRequest, RecordInput,
  RecordNoteRequest, RegisterFields, RelationAckRequest, RelationInput, RelationRef, RelationReplaceRequest,
  RenderResultFields, RescanRequest, RetargetRequest, ReviewRequest, SearchRequest, TagNamesRequest, TagsPatchRequest,
  TrashRestoreRequest, ViewPutRequest, ActionRunRequest,
  type EndpointName, type LibraryInfo, type MachineConfig, type PluginInfo, type ScanProgress
} from '@bowerbird/schema'
import type { CallContext, Hub, LibraryService } from '@bowerbird/core'
import { HttpError, notFound, onlyGiven, parse, toHttpError } from './errors.js'
import { checkRequestOrigin, isLocalRequest, originError, parseActor, sameBundleSubresource, type OriginPolicy } from './security.js'
import { maskSecrets, restoreSecrets, writeOnlyKeys } from './secrets.js'
import { SENT, contentDisposition, safeJoin, sendFile, sendStream, thumbnailMime, webAssetMime, withCharset, type Sent } from './files.js'
import { jsonField, isMultipart, readMultipart } from './multipart.js'
import { createSseHub, type SseHub } from './sse.js'
import { libraryReader, type IncomingRequest, type RouteRequest, type RouteResponse } from './reader.js'
import { assertNewFolder, listFolders } from './folders.js'

export interface AppOptions {
  hub: Hub
  /** Listen host (decides which Host headers are accepted). */
  host: string
  webDir?: string
  allowedOrigins?: string[]
  /** Library opened by this process (`bb serve <dir>`); defaults to the hub's default library. */
  defaultLibrary?: string
  /** SSE heartbeat interval (tests use a short one). */
  heartbeatMs?: number
  /** Disconnect an SSE client that lets more than this much pile up unread (default 1 MiB). */
  sseMaxBufferBytes?: number
  version?: string
}

declare module 'fastify' {
  interface FastifyRequest { bb: CallContext }
  interface FastifyInstance { sse: SseHub }
}

/** @deprecated `LibraryService.setPluginEnabled` is in the contracts now; kept for callers of the old export. */
export type PluginToggleCapable = Pick<LibraryService, 'setPluginEnabled'>

type Handler = (request: FastifyRequest, reply: FastifyReply, ctx: CallContext) => Promise<unknown>

const IDLE_SCAN: ScanProgress = { running: false, phase: 'idle', done: 0, total: 0 }
const LIBRARY_HEADER = 'x-bowerbird-library'
const HEALTH_URL = `${API_BASE}/health`

/** `'POST L/assets/:id'` → method + Fastify url under /api/v1. */
export function endpointRoute(name: EndpointName): { method: string; url: string } {
  const [method, p] = ENDPOINTS[name].split(' ') as [string, string]
  return { method, url: API_BASE + p.replace(/^L/, '/libraries/:library') }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch { return '0.0.0' }
}

function q(request: FastifyRequest): Record<string, string | string[] | undefined> {
  return (request.query ?? {}) as Record<string, string | string[] | undefined>
}
function one(v: string | string[] | undefined): string | undefined { return Array.isArray(v) ? v[0] : v }
function list(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined
  const arr = (Array.isArray(v) ? v : [v]).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean)
  return arr
}
function flag(v: string | string[] | undefined): boolean {
  const s = one(v)
  return s === '1' || s === 'true' || s === 'yes'
}
function param(request: FastifyRequest, name: string): string {
  return ((request.params ?? {}) as Record<string, string>)[name] ?? ''
}
function guidParam(request: FastifyRequest, name = 'id'): string {
  return parse(Guid, param(request, name), name)
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { hub } = opts
  const log = hub.log.child('server')
  const version = opts.version ?? readVersion()
  const policy: OriginPolicy = {
    listenHost: opts.host,
    allowedOrigins: () => [...(opts.allowedOrigins ?? []), ...(safeConfig(hub)?.allowedOrigins ?? [])]
  }
  const defaultLibraryId = (): string | null => opts.defaultLibrary ?? hub.defaultLibraryId()

  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024 * 1024,
    forceCloseConnections: true,
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 4096 }
  })
  const sse = createSseHub({ heartbeatMs: opts.heartbeatMs, maxBufferBytes: opts.sseMaxBufferBytes })
  app.decorate('sse', sse)
  app.decorateRequest('bb', null as unknown as CallContext)

  await app.register(multipart, {
    limits: { fileSize: Number.MAX_SAFE_INTEGER, fieldSize: 16 * 1024 * 1024, files: 32, parts: 256 }
  })
  // Plugin routes may take any body; kernel routes validate what they get (non-JSON fails validation).
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  /* ───────────── request gate: host/origin, actor, access control ───────────── */

  app.addHook('onRequest', async (request, reply) => {
    const routeUrl = request.routeOptions.url ?? ''
    const params = (request.params ?? {}) as Record<string, string>
    const bundleRead = (request.method === 'GET' || request.method === 'HEAD') && routeUrl === endpointRoute('bundleFile').url
      && sameBundleSubresource(request.headers, { apiBase: API_BASE, library: params.library ?? '', asset: params.id ?? '' })
    const verdict = checkRequestOrigin(request.headers, policy, { allowNullOrigin: bundleRead })
    if (!verdict.ok) throw originError(verdict.reason)
    if (verdict.cors) {
      reply.header('Access-Control-Allow-Origin', verdict.cors)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Expose-Headers', 'Content-Range, Content-Disposition, Content-Length, Accept-Ranges')
    }
    const isLocal = isLocalRequest(request.raw.socket?.remoteAddress, request.headers)
    let actor = parseActor(request.headers['x-bowerbird-actor'])
    const ac = new AbortController()
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) ac.abort() })
    if (request.url.startsWith(API_BASE + '/') && !request.url.startsWith(HEALTH_URL) && request.method !== 'OPTIONS') {
      actor = await accessControl(request, actor, isLocal)
    }
    request.bb = { actor, isLocal, signal: ac.signal }
  })

  /**
   * Access control extension point (ADR-023). Library endpoints are checked by the `auth` plugins of the library in
   * the path (an unknown library is 404, never waved through). Everything else — plugin install/update/remove and
   * settings, `/config`, `POST /libraries`, plugin routes — is checked by the auth plugins of EVERY library on this
   * machine that can declare plugins; `?library=` / `X-Bowerbird-Library` cannot pick a more lenient gate.
   * Any refusal refuses (`forbidden`); the actor is the first name a provider gives. Phase one ships no provider.
   */
  async function accessControl(request: FastifyRequest, actor: string, isLocal: boolean): Promise<string> {
    const libParam = ((request.params ?? {}) as Record<string, string>).library
    const gates: LibraryService[] = libParam ? [await hub.library(libParam)] : await allGates()
    const incoming: IncomingRequest = {
      method: request.method, url: request.url, headers: request.headers,
      remoteAddress: request.raw.socket?.remoteAddress ?? '', isLocal
    }
    let named: string | null = null
    for (const svc of gates) {
      const plugins = svc.plugins()
      for (const { pluginId, provider } of plugins.auth()) {
        const decision = await plugins.invoke(pluginId, 'auth.check', () => provider.check(incoming))
        if (!decision.allow) throw new HttpError(decision.status ?? 403, 'forbidden', decision.message ?? '请求被拒绝', { reason: 'auth', plugin: pluginId })
        if (decision.actor && !named) named = decision.actor
      }
    }
    return named ?? actor
  }

  /** Every registered library that has a library.json (only those can declare an auth plugin), opened. */
  async function allGates(): Promise<LibraryService[]> {
    const out: LibraryService[] = []
    for (const ref of hub.libraries()) {
      if (ref.state !== 'ready' && ref.state !== 'read-only') continue
      try { out.push(await hub.library(ref.id)) } catch (e) {
        // A library that cannot open has no active plugins to ask; note it and go on.
        log.warn('library not opened for access control', { library: ref.id, error: (e as Error)?.message })
      }
    }
    return out
  }

  function libraryIdOf(request: FastifyRequest): string | null {
    const fromPath = ((request.params ?? {}) as Record<string, string>).library
    if (fromPath) return fromPath
    const fromQuery = one(q(request).library)
    const fromHeader = one(request.headers[LIBRARY_HEADER] as string | string[] | undefined)
    return fromQuery || fromHeader || defaultLibraryId()
  }

  /* ───────────── errors ───────────── */

  app.setErrorHandler((err, request, reply) => {
    const mapped = toHttpError(err)
    if (mapped.unexpected) log.error('request failed', { method: request.method, url: request.url.split('?')[0], error: (err as Error)?.message, stack: (err as Error)?.stack })
    if (reply.sent || reply.raw.headersSent) { reply.raw.destroy(); return }
    void reply.code(mapped.status).header('Content-Type', 'application/json; charset=utf-8').send(mapped.body)
  })

  /* ───────────── helpers ───────────── */

  function on(name: EndpointName, handler: Handler): void {
    const { method, url } = endpointRoute(name)
    app.route({
      method: method as 'GET',
      url,
      handler: async (request, reply) => {
        const out = await handler(request, reply, request.bb)
        if (out === SENT || reply.sent || reply.raw.headersSent) return reply
        if (out === undefined) return reply.code(204).send()
        return reply.send(out)
      }
    })
  }

  const lib = (request: FastifyRequest) => hub.library(param(request, 'library'))
  const body = (request: FastifyRequest) => request.body ?? {}

  async function resolveLibrary(request: FastifyRequest, explicit?: string): Promise<LibraryService | null> {
    const id = explicit || libraryIdOf(request)
    return id ? hub.library(id) : null
  }

  /* ───────────── health, libraries, config ───────────── */

  on('health', async () => {
    const h = await hub.health()
    const libraries = await Promise.all(h.libraries.map(async l => {
      // the hub reports scan progress per library; do not ask the pipeline for its whole overview just for that
      const scan: ScanProgress = l.scan ?? IDLE_SCAN
      return { id: l.id, state: l.state, index: l.index, scan }
    }))
    return { status: h.status, version, libraries }
  })

  on('libraries', async () => ({ libraries: hub.libraries(), defaultId: defaultLibraryId() }))
  on('libraryAdd', async (request, reply, ctx) => {
    const req = parse(LibraryAddRequest, body(request))
    if (req.create) assertNewFolder(req.root)
    const ref = await hub.addLibrary(req.root, req.name)
    reply.code(201)
    return maskInfo(await (await hub.library(ref.id)).info(ctx))
  })
  on('library', async (request, _r, ctx) => maskInfo(await (await lib(request)).info(ctx)))
  on('libraryPatch', async (request, _r, ctx) => {
    const req = onlyGiven(parse(LibraryPatchRequest, body(request)), body(request))
    const svc = await lib(request)
    if (req.settings?.plugins) {
      const current = (await svc.info(ctx)).settings?.plugins ?? {}
      req.settings.plugins = Object.fromEntries(Object.entries(req.settings.plugins).map(([id, v]) => [id, restoreSecrets(v, current[id], secretKeys(id))]))
    }
    return maskInfo(await svc.patchLibrary(req, ctx))
  })
  on('libraryInit', async (request, _r, ctx) => {
    const svc = await lib(request)
    await background(svc.initialize(ctx), 'initialize')
    return maskInfo(await svc.info(ctx))
  })
  on('libraryReveal', async (request, _r, ctx) => {
    if (!ctx.isLocal) throw new HttpError(403, 'not_local', '这个操作只在服务所在的电脑上执行，只接受那台电脑发来的请求')
    await (await lib(request)).reveal(null, ctx)
  })
  on('rescanStop', async request => { await (await lib(request)).stopScan() })
  // the folder chooser browses this computer's disk: only for a browser on this computer; others type the path
  on('fsFolders', async (request, _r, ctx) => {
    if (!ctx.isLocal) throw new HttpError(403, 'not_local', '浏览文件夹只在服务所在的电脑上可用；从其他电脑请直接输入路径')
    return listFolders(one(q(request).path))
  })
  on('config', async () => configResponse())
  on('configPatch', async request => {
    const patch = onlyGiven(parse(ConfigPatchRequest, body(request)), body(request))
    if (patch.plugins) {
      const current = hub.config().plugins ?? {}
      patch.plugins = Object.fromEntries(Object.entries(patch.plugins).map(([id, v]) => [id, restoreSecrets(v, current[id], secretKeys(id))]))
    }
    const res = await hub.patchConfig(patch)
    return { ...res, config: maskConfig(res.config) }
  })

  function configResponse() {
    return { config: maskConfig(hub.config()), dataDir: hub.home, restartRequired: hub.restartPending?.() ?? false }
  }

  /** `writeOnly` keys of a plugin's settings; null when the plugin is unknown (then every value is masked). */
  function secretKeys(pluginId: string): string[] | null {
    try { return writeOnlyKeys(hub.plugins.settingsSchema(pluginId)) } catch { return null }
  }
  function maskConfig(config: MachineConfig): MachineConfig {
    const plugins = Object.fromEntries(Object.entries(config.plugins ?? {}).map(([id, v]) => [id, maskSecrets(v, secretKeys(id))]))
    return { ...config, plugins }
  }
  function maskInfo(info: LibraryInfo): LibraryInfo {
    const plugins = info.settings?.plugins
    if (!plugins) return info
    return { ...info, settings: { ...info.settings!, plugins: Object.fromEntries(Object.entries(plugins).map(([id, v]) => [id, maskSecrets(v, secretKeys(id))])) } }
  }

  /**
   * Long operations (first-open registration, rescans) answer once started: errors in the first moments are
   * reported to the caller, later ones only logged; progress arrives as `scan.progress` events.
   */
  async function background(p: Promise<void>, label: string, graceMs = 300): Promise<void> {
    let settled = false
    const guarded = p.then(() => { settled = true }, e => { settled = true; throw e })
    const timer = new Promise<'timeout'>(r => { const t = setTimeout(() => r('timeout'), graceMs); t.unref?.() })
    const result = await Promise.race([guarded.then(() => 'done' as const), timer])
    if (result === 'timeout' && !settled) {
      guarded.catch(e => log.error(`${label} failed`, { error: (e as Error)?.message }))
    }
  }

  /* ───────────── plugins (global) ───────────── */

  async function pluginList(request: FastifyRequest, ctx: CallContext, libraryId?: string): Promise<{ plugins: PluginInfo[] }> {
    const all = hub.plugins.list()
    let svc: LibraryService | null = null
    try { svc = await resolveLibrary(request, libraryId) } catch { svc = null }
    if (!svc) return { plugins: all }
    let enabled: Set<string>
    let required: Array<{ id: string; range: string; installed: boolean }> = []
    try {
      enabled = new Set(svc.plugins().enabled().map(p => p.id))
      required = (await svc.info(ctx)).requiredPlugins
    } catch { return { plugins: all } }
    const out = all.map(p => {
      if (p.status === 'failed' || p.status === 'missing') return p
      return { ...p, status: enabled.has(p.id) ? 'enabled' as const : 'disabled' as const }
    })
    for (const r of required) {
      if (!r.installed && !out.some(p => p.id === r.id)) {
        out.push({
          id: r.id, packageName: r.id, version: null, displayName: r.id, builtin: false, status: 'missing', required: r.range,
          contributes: [], formats: [], hasWeb: false, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'npm'
        })
      }
    }
    return { plugins: out }
  }

  on('plugins', async (request, _r, ctx) => pluginList(request, ctx))
  on('pluginInstall', async (request, reply, ctx) => {
    const req = parse(PluginInstallRequest, body(request))
    await hub.plugins.install(req.spec)
    reply.code(201)
    return pluginList(request, ctx)
  })
  on('pluginUpdate', async (request, _r, ctx) => {
    await hub.plugins.update(param(request, 'id'))
    return pluginList(request, ctx)
  })
  on('pluginRemove', async request => { await hub.plugins.remove(param(request, 'id')) })
  for (const [name, enabled] of [['pluginEnable', true], ['pluginDisable', false]] as const) {
    on(name, async (request, _r, ctx) => {
      const req = parse(PluginToggleRequest, body(request))
      const svc = await resolveLibrary(request, req.library)
      if (!svc) throw notFound('还没有资产库')
      if (!svc.setPluginEnabled) throw new HttpError(501, 'unsupported', '这个版本的内核还不能启用或禁用插件')
      await svc.setPluginEnabled(param(request, 'id'), enabled, ctx)
      return pluginList(request, ctx, svc.id)
    })
  }
  on('pluginSettings', async request => {
    const id = param(request, 'id')
    return { values: maskSecrets(hub.plugins.machineSettings(id), secretKeys(id)), schema: hub.plugins.settingsSchema(id) }
  })
  on('pluginSettingsPut', async request => {
    const id = param(request, 'id')
    const req = parse(PluginSettingsPut, body(request))
    const keys = secretKeys(id)
    await hub.plugins.setMachineSettings(id, restoreSecrets(req.values, hub.plugins.machineSettings(id), keys))
    return { values: maskSecrets(hub.plugins.machineSettings(id), keys), schema: hub.plugins.settingsSchema(id) }
  })
  on('pluginWeb', async (request, reply) => {
    const id = param(request, 'id')
    const entry = hub.plugins.webEntry(id)
    if (!entry || !fs.existsSync(entry)) throw notFound('这个插件没有网页模块')
    if (fs.existsSync(entry + '.map')) reply.header('SourceMap', `${path.basename(entry)}.map`)
    return sendFile(request, reply, { absPath: entry, name: path.basename(entry), mime: 'text/javascript' }, { cacheControl: 'no-cache' })
  })

  /* ───────────── library-scoped: scan, vocabulary, cache ───────────── */

  on('rescan', async (request, reply, ctx) => {
    const req = parse(RescanRequest, body(request))
    const svc = await lib(request)
    await background(svc.rescan(req.path, ctx), 'rescan')
    reply.code(202)
    return { started: true }
  })
  on('vocabulary', async request => (await lib(request)).vocabulary())
  on('cache', async request => (await lib(request)).cache())
  on('cacheClean', async request => {
    const req = parse(CacheCleanRequest, body(request))
    return (await lib(request)).cleanCache(!!req.all)
  })

  /* ───────────── assets ───────────── */

  on('search', async (request, _r, ctx) => {
    const req = parse(SearchRequest, body(request))
    return (await lib(request)).search(req, ctx)
  })
  on('asset', async (request, _r, ctx) => (await lib(request)).get(guidParam(request), ctx))
  on('precheck', async request => {
    const req = parse(PrecheckRequest, body(request))
    return (await lib(request)).precheck(req.folder, req.names)
  })
  on('register', async (request, reply, ctx) => {
    const svc = await lib(request)
    if (isMultipart(request)) {
      const mp = await readMultipart(request, svc.paths.tmpDir)
      try {
        const fields = parse(RegisterFields, jsonField(mp.fields, 'meta'), 'meta')
        const up = mp.file('file') ?? mp.files.find(f => f.field !== 'meta')
        if (!up && !fields.path) throw new HttpError(400, 'validation_failed', '请求内容不合法：需要上传文件，或给出资产库内的路径 path')
        const res = await svc.register({ fields, ...(up ? { file: { name: up.filename, tmpPath: up.tmpPath } } : {}) }, ctx)
        reply.code(res.skipped ? 200 : 201)
        return res
      } finally { await mp.cleanup() }
    }
    const fields = parse(RegisterFields, body(request))
    if (!fields.path) throw new HttpError(400, 'validation_failed', '请求内容不合法：需要上传文件，或给出资产库内的路径 path')
    const res = await svc.register({ fields }, ctx)
    reply.code(res.skipped ? 200 : 201)
    return res
  })
  on('patch', async (request, _r, ctx) => {
    const req = parse(AssetPatch, body(request))
    return (await lib(request)).patch(guidParam(request), req, ctx)
  })
  on('remove', async (request, _r, ctx) => (await lib(request)).trash(guidParam(request), { force: flag(q(request).force) }, ctx))
  on('content', async (request, _r, ctx) => {
    const id = guidParam(request)
    const svc = await lib(request)
    const mp = await readMultipart(request, svc.paths.tmpDir)
    try {
      const fields = parse(ContentReplaceFields, jsonField(mp.fields, 'meta'), 'meta')
      const up = mp.file('file') ?? mp.files.find(f => f.field !== 'meta')
      if (!up) throw new HttpError(400, 'validation_failed', '请求内容不合法：需要上传文件')
      return await svc.replaceContent(id, { name: up.filename, tmpPath: up.tmpPath }, fields.note, ctx)
    } finally { await mp.cleanup() }
  })
  on('move', async (request, _r, ctx) => {
    const req = parse(MoveRequest, body(request))
    return (await lib(request)).move(guidParam(request), req, ctx)
  })
  on('copy', async (request, reply, ctx) => {
    const req = parse(CopyRequest, body(request))
    reply.code(201)
    return (await lib(request)).copy(guidParam(request), req, ctx)
  })
  on('review', async (request, _r, ctx) => {
    const req = parse(ReviewRequest, body(request))
    return (await lib(request)).review(guidParam(request), req, ctx)
  })
  on('tagsAccept', async (request, _r, ctx) => {
    const req = parse(TagNamesRequest, body(request))
    return (await lib(request)).acceptAutoTags(guidParam(request), req.tags, ctx)
  })
  on('tagsDismiss', async (request, _r, ctx) => {
    const req = parse(TagNamesRequest, body(request))
    return (await lib(request)).dismissAutoTags(guidParam(request), req.tags, ctx)
  })
  on('file', async (request, reply) => {
    const f = await (await lib(request)).file(guidParam(request))
    return sendFile(request, reply, f, { download: flag(q(request).download) })
  })
  for (const name of ['open', 'reveal'] as const) {
    on(name, async (request, _r, ctx) => {
      const id = guidParam(request)
      if (!ctx.isLocal) throw new HttpError(403, 'not_local', '这个操作只在服务所在的电脑上执行，只接受那台电脑发来的请求')
      const svc = await lib(request)
      await (name === 'open' ? svc.open(id, ctx) : svc.reveal(id, ctx))
    })
  }
  on('thumbnail', async (request, reply) => {
    const id = guidParam(request)
    const variant = parse(ThumbVariant, one(q(request).variant) ?? 'thumb', 'variant')
    const abs = await (await lib(request)).thumbnailFile(id, variant)
    if (!abs) throw notFound('还没有缩略图')
    const keyed = one(q(request).v) !== undefined
    return sendFile(request, reply, { absPath: abs, name: `${id}-${variant}${path.extname(abs)}`, mime: thumbnailMime(abs) },
      { cacheControl: keyed ? 'public, max-age=31536000, immutable' : 'no-cache' })
  })
  on('thumbnailPut', async (request, _r, ctx) => {
    const id = guidParam(request)
    const svc = await lib(request)
    const mp = await readMultipart(request, svc.paths.tmpDir)
    try {
      const part = mp.file('image') ?? mp.files[0]
      if (!part) throw new HttpError(400, 'validation_failed', '请求内容不合法：需要图片 image')
      const bytes = await mp.bytes(part.field)
      return await svc.setManualThumbnail(id, bytes!, ctx)
    } finally { await mp.cleanup() }
  })
  on('thumbnailDelete', async (request, _r, ctx) => (await lib(request)).clearManualThumbnail(guidParam(request), ctx))
  on('summary', async request => (await lib(request)).summary(guidParam(request)))
  on('lineage', async request => {
    const qs = q(request)
    const lq = parse(LineageQuery, {
      direction: one(qs.direction),
      types: list(qs.types),
      depth: one(qs.depth) !== undefined ? Number(one(qs.depth)) : undefined
    }, 'query')
    return (await lib(request)).lineage(guidParam(request), lq)
  })
  on('versions', async request => (await lib(request)).versions(guidParam(request)))
  on('versionFile', async (request, reply) => {
    const v = await (await lib(request)).versionFile(guidParam(request), param(request, 'hash'))
    return sendStream(reply, Readable.fromWeb(v.stream as import('node:stream/web').ReadableStream), v, flag(q(request).download))
  })
  on('versionRestore', async (request, _r, ctx) => (await lib(request)).restoreVersion(guidParam(request), param(request, 'hash'), ctx))
  on('slotFile', async (request, reply) => {
    const f = await (await lib(request)).slotFile(guidParam(request), param(request, 'slot'))
    if (!f) throw notFound('这个位置名没有对应的资产')
    return sendFile(request, reply, f, { download: flag(q(request).download) })
  })
  on('bundleFile', async (request, reply) => {
    const inner = param(request, '*')
    // `\` counts as a separator too (Windows paths): no `..` / `.` segment in either spelling.
    if (!inner || inner.split(/[\\/]/).some(s => s === '..' || s === '.') || inner.includes('\0')) throw notFound('包内没有这个文件')
    const f = await (await lib(request)).bundleFile(guidParam(request), inner)
    if (!f) throw notFound('包内没有这个文件')
    // Full Referer on the page's own sub-resource requests, so the Origin: null exception can check it (ADR-043).
    return sendFile(request, reply, f, { referrerPolicy: 'no-referrer-when-downgrade' })
  })
  on('batch', async (request, _r, ctx) => {
    const req = parse(BatchRequest, body(request))
    return (await lib(request)).batch(req, ctx)
  })

  /* ───────────── relations & records ───────────── */

  on('relationAdd', async (request, _r, ctx) => {
    const req = parse(RelationInput, body(request))
    return (await lib(request)).addRelation(guidParam(request), req, ctx)
  })
  on('relationDelete', async (request, _r, ctx) => {
    const req = parse(RelationRef, body(request))
    return (await lib(request)).removeRelation(guidParam(request), req, ctx)
  })
  on('relationReplace', async (request, _r, ctx) => {
    const req = parse(RelationReplaceRequest, body(request))
    return (await lib(request)).replaceRelation(guidParam(request), req, ctx)
  })
  on('relationAck', async (request, _r, ctx) => {
    const req = parse(RelationAckRequest, body(request))
    return (await lib(request)).acknowledgeUpstream(guidParam(request), req.to, ctx)
  })
  on('retarget', async (request, _r, ctx) => {
    const req = parse(RetargetRequest, body(request))
    return (await lib(request)).retarget(req, ctx)
  })
  on('recordCreate', async (request, reply, ctx) => {
    const req = parse(RecordInput, body(request))
    const record = await (await lib(request)).createRecord(req, ctx)
    reply.code(201)
    return { id: record.id, record }
  })
  on('record', async request => (await lib(request)).record(param(request, 'id')))
  on('recordNote', async (request, _r, ctx) => {
    const req = parse(RecordNoteRequest, body(request))
    return (await lib(request)).addRecordNote(param(request, 'id'), req.text, ctx)
  })

  /* ───────────── folders, tags, views ───────────── */

  on('folders', async request => ({ root: await (await lib(request)).folders() }))
  on('folderCreate', async (request, reply, ctx) => {
    const req = parse(FolderCreateRequest, body(request))
    const svc = await lib(request)
    await svc.createFolder(req.path, ctx)
    reply.code(201)
    return { root: await svc.folders() }
  })
  on('folderPatch', async (request, _r, ctx) => {
    const req = parse(FolderPatchRequest, body(request))
    const svc = await lib(request)
    await svc.patchFolder(req, ctx)
    return { root: await svc.folders() }
  })
  on('folderDelete', async (request, _r, ctx) => {
    const req = parse(FolderDeleteRequest, body(request))
    return (await lib(request)).trashFolder(req.path, ctx, { force: req.force === true })
  })
  on('folderBundle', async (request, reply, ctx) => {
    const req = parse(BundleRequest, body(request))
    reply.code(201)
    return (await lib(request)).makeBundle(req.path, req.entry, ctx)
  })
  on('tags', async request => (await lib(request)).tags())
  on('tagsPatch', async (request, _r, ctx) => {
    const req = parse(TagsPatchRequest, body(request))
    return (await lib(request)).patchTags(req, ctx)
  })
  for (const [name, accept] of [['libraryTagAccept', true], ['libraryTagDismiss', false]] as const) {
    on(name, async (request, _r, ctx) => {
      const req = parse(LibraryTagRequest, body(request))
      if (!req.all && !req.tag) throw new HttpError(400, 'validation_failed', '请求内容不合法：需要 tag，或 all: true')
      const svc = await lib(request)
      const tag = req.all ? null : req.tag!
      return accept ? svc.acceptTagEverywhere(tag, ctx) : svc.dismissTagEverywhere(tag, ctx)
    })
  }
  on('views', async request => ({ views: await (await lib(request)).views() }))
  on('viewPut', async (request, _r, ctx) => {
    const req = parse(ViewPutRequest, body(request))
    return { views: await (await lib(request)).putView(param(request, 'name'), req.query, req.rename, ctx) }
  })
  on('viewDelete', async (request, _r, ctx) => ({ views: await (await lib(request)).deleteView(param(request, 'name'), ctx) }))

  /* ───────────── issues & trash ───────────── */

  on('issues', async request => {
    const qs = q(request)
    const iq = parse(IssuesQuery, { type: list(qs.type), level: list(qs.level), assetId: one(qs.assetId) }, 'query')
    return (await lib(request)).issues(iq)
  })
  on('issueResolve', async (request, _r, ctx) => {
    const req = parse(IssueResolveRequest, body(request))
    return (await lib(request)).resolveIssue(param(request, 'id'), req, ctx)
  })
  on('issuesResolve', async (request, _r, ctx) => {
    const req = parse(IssueBatchResolveRequest, body(request))
    return (await lib(request)).resolveIssues(req, ctx)
  })
  on('issueCandidates', async request => (await lib(request)).relocateCandidates(param(request, 'id')))
  on('trash', async request => (await lib(request)).trashList())
  on('trashRestore', async (request, _r, ctx) => {
    const req = parse(TrashRestoreRequest, body(request))
    return (await lib(request)).restore(param(request, 'id'), req.rename, ctx)
  })
  on('trashDelete', async (request, _r, ctx) => { await (await lib(request)).purge(param(request, 'id'), ctx) })
  on('trashEmpty', async (request, _r, ctx) => { await (await lib(request)).emptyTrash(ctx) })

  /* ───────────── creators & jobs ───────────── */

  on('actions', async request => {
    const ids = (list(q(request).ids) ?? []).map(id => parse(Guid, id, 'ids'))
    const svc = await lib(request)
    if (!svc.actions) throw new HttpError(501, 'unsupported', '这个版本的内核还不支持插件动作')
    return { actions: await svc.actions(ids) }
  })
  on('actionRun', async (request, reply, ctx) => {
    const req = parse(ActionRunRequest, body(request))
    const svc = await lib(request)
    if (!svc.runAction) throw new HttpError(501, 'unsupported', '这个版本的内核还不支持插件动作')
    const job = await svc.runAction(param(request, 'id'), { ids: req.ids, ...(req.params !== undefined ? { params: req.params } : {}) }, ctx)
    reply.code(202)
    return job
  })
  on('creators', async request => ({ creators: await (await lib(request)).creators() }))
  on('createRun', async (request, reply, ctx) => {
    const req = parse(CreateRunRequest, body(request))
    reply.code(202)
    return (await lib(request)).startCreate(param(request, 'id'), req, ctx)
  })
  on('jobs', async request => (await lib(request)).jobs())
  on('job', async request => (await lib(request)).job(param(request, 'id')))
  on('jobCancel', async (request, _r, ctx) => { await (await lib(request)).cancelJob(param(request, 'id'), ctx) })
  on('jobsRetry', async (request, _r, ctx) => {
    const req = parse(JobsRetryRequest, body(request))
    await (await lib(request)).retryJobs(req, ctx)
  })

  /* ───────────── export ───────────── */

  on('exportPlan', async request => {
    const req = parse(ExportRequest, body(request))
    return (await lib(request)).exportPlan(req)
  })
  /**
   * JSON as before (zip download, or `dir` on this machine), or a plain HTML form POST
   * (`application/x-www-form-urlencoded`: ids, withDeps, layout, name) so the browser streams the zip straight to
   * disk instead of holding it in memory. A form only downloads: copying into a folder on the server stays a JSON
   * request (a cross-site form can never send JSON without a preflight). Host/Origin checks and the access-control
   * gate apply to both, like every request.
   */
  on('export', async (request, reply, ctx) => {
    const form = isFormRequest(request)
    const fields = form ? new URLSearchParams(bodyText(request)) : null
    const req = parse(ExportRequest, fields ? exportFromForm(fields) : body(request), form ? 'form' : 'body')
    const svc = await lib(request)
    if (req.dir !== undefined) {
      if (form) throw new HttpError(400, 'validation_failed', '请求内容不合法：表单只用来下载压缩包，导出到目录请用 JSON 请求')
      if (!ctx.isLocal) throw new HttpError(403, 'not_local', '导出到目录只在服务所在的电脑上执行；从其他电脑请下载压缩包')
      if (!path.isAbsolute(req.dir)) throw new HttpError(400, 'validation_failed', '请求内容不合法：dir 必须是绝对路径')
      return svc.exportToDir({ ...req, dir: req.dir }, ctx)
    }
    const files = await svc.exportFiles(req)
    return sendZip(reply, files, zipName(fields?.get('name') ?? one(q(request).name)))
  })

  /* ───────────── render worker ───────────── */

  on('renderNext', async request => {
    const visible = (list(q(request).visible) ?? []).filter(v => Guid.safeParse(v).success)
    return { task: await (await lib(request)).renderNext(visible) }
  })
  on('renderPut', async request => {
    const svc = await lib(request)
    const mp = await readMultipart(request, svc.paths.tmpDir)
    try {
      const meta = jsonField(mp.fields, 'meta') as Record<string, unknown>
      if (mp.fields.tech !== undefined && meta.tech === undefined) meta.tech = jsonField(mp.fields, 'tech')
      const fields = parse(RenderResultFields, meta, 'meta')
      const parts: Partial<Record<ThumbVariant, Uint8Array>> = {}
      for (const v of THUMB_VARIANTS) {
        const bytes = await mp.bytes(v)
        if (bytes) parts[v] = bytes
      }
      await svc.renderSubmit(param(request, 'job'), parts, fields)
    } finally { await mp.cleanup() }
  })

  /* ───────────── library-scoped plugin settings ───────────── */

  on('libraryPluginSettings', async request => {
    const id = param(request, 'id')
    return { values: maskSecrets(await (await lib(request)).pluginLibrarySettings(id), secretKeys(id)), schema: hub.plugins.settingsSchema(id) }
  })
  on('libraryPluginSettingsPut', async (request, _r, ctx) => {
    const id = param(request, 'id')
    const req = parse(PluginSettingsPut, body(request))
    const svc = await lib(request)
    const keys = secretKeys(id)
    await svc.setPluginLibrarySettings(id, restoreSecrets(req.values, await svc.pluginLibrarySettings(id), keys), ctx)
    return { values: maskSecrets(await svc.pluginLibrarySettings(id), keys), schema: hub.plugins.settingsSchema(id) }
  })

  /* ───────────── events ───────────── */

  on('events', async (request, reply) => {
    const svc = await lib(request)
    sse.open(request, reply, hub.events, svc.id)
    return SENT
  })

  /* ───────────── plugin routes: /api/v1/plugins/{id}/… ───────────── */

  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: `${API_BASE}/plugins/:id/*`,
    handler: async (request, reply) => {
      const pluginId = param(request, 'id')
      const rest = param(request, '*').replace(/^\/+|\/+$/g, '')
      const firstSeg = rest.split('/')[0] ?? ''
      if ((RESERVED_PLUGIN_PATHS as readonly string[]).includes(firstSeg)) throw notFound()
      const ctx = request.bb
      let svc: LibraryService | null = null
      try { svc = await resolveLibrary(request) } catch (e) { if (one(q(request).library) || request.headers[LIBRARY_HEADER]) throw e }
      if (svc) {
        const plugins = svc.plugins()
        for (const { pluginId: pid, route } of plugins.routes()) {
          if (pid !== pluginId || route.method !== request.method) continue
          const params = matchRoutePath(route.path, rest)
          if (!params) continue
          if ((RESERVED_PLUGIN_PATHS as readonly string[]).includes(route.path.replace(/^\/+/, '').split('/')[0] ?? '')) continue
          const info = await svc.info(ctx)
          const rr: RouteRequest = {
            method: request.method,
            path: rest,
            params,
            query: Object.fromEntries(Object.entries(q(request)).filter((e): e is [string, string | string[]] => e[1] !== undefined)),
            headers: request.headers,
            body: request.body instanceof Buffer ? new Uint8Array(request.body) : request.body,
            actor: ctx.actor,
            isLocal: ctx.isLocal,
            library: libraryReader(svc, ctx, { name: info.name, root: info.root })
          }
          const res = await plugins.invoke(pluginId, `route ${route.method} ${route.path}`, () => route.handler(rr))
          sendRouteResponse(reply, res)
          return reply
        }
      }
      // Files next to the plugin's web entry (chunks, source maps, styles) — relative imports of the module.
      if (request.method === 'GET') {
        const entry = hub.plugins.webEntry(pluginId)
        if (entry) {
          const abs = safeJoin(path.dirname(entry), rest)
          const mime = abs ? webAssetMime(abs) : null
          if (abs && mime && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            await sendFile(request, reply, { absPath: abs, name: path.basename(abs), mime }, { cacheControl: 'no-cache' })
            return reply
          }
        }
      }
      throw notFound('插件没有登记这个接口')
    }
  })

  /* ───────────── CORS preflight for explicitly allowed origins ───────────── */

  app.options('*', async (request, reply) => {
    const origin = request.headers.origin
    if (!origin || !reply.getHeader('Access-Control-Allow-Origin')) throw notFound()
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
    reply.header('Access-Control-Allow-Headers', 'content-type, range, x-bowerbird-actor, x-bowerbird-library')
    reply.header('Access-Control-Max-Age', '600')
    return reply.code(204).send()
  })

  /* ───────────── web shell ───────────── */

  /**
   * Content Security Policy of the shell page: everything (scripts, plugin web modules, images, media, fetch/SSE,
   * frames) must come from this server, data: or blob:. Plugin viewers therefore cannot make the viewer's browser
   * request outside addresses named inside an asset file (defence in depth for untrusted libraries, ADR-012/043).
   */
  const SHELL_CSP = [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "media-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self' data: blob:",
    "worker-src 'self' blob:", "frame-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"
  ].join('; ')

  const webDir = opts.webDir && fs.existsSync(path.join(opts.webDir, 'index.html')) ? path.resolve(opts.webDir) : null
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
      cacheControl: false,
      setHeaders(res, filePath) {
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache')
        if (/\.html$/i.test(filePath)) res.setHeader('Content-Security-Policy', SHELL_CSP)
      }
    })
  }

  // Synchronous on purpose: returning the (thenable) reply from an async handler stacks listeners on the response.
  app.setNotFoundHandler((request, reply) => {
    if (webDir && isShellPage(request)) {
      reply.header('Cache-Control', 'no-cache')
      reply.header('Content-Security-Policy', SHELL_CSP)
      void reply.type('text/html; charset=utf-8').sendFile('index.html')
      return
    }
    void reply.code(404).header('Content-Type', 'application/json; charset=utf-8').send({ error: { code: 'not_found', message: '找不到这个地址' } })
  })

  app.addHook('onClose', async () => { sse.closeAll() })

  return app
}

/**
 * Whether a GET that matched no file is a page of the shell (it gets index.html; the shell routes it). The API and
 * the shell's asset folder never fall back. A last segment with a dot (plugin ids such as `community.forge`, names
 * like `v1.2`) is a page when the browser navigates to it; asked for as an image, script or style, it is a missing
 * file (404).
 */
export function isShellPage(request: Pick<FastifyRequest, 'method' | 'url' | 'headers'>): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const url = request.url.split('?')[0] ?? '/'
  if (url === '/api' || url.startsWith('/api/') || url === '/assets' || url.startsWith('/assets/')) return false
  const last = url.split('/').pop() ?? ''
  if (!last.includes('.')) return true
  const dest = String(request.headers['sec-fetch-dest'] ?? '').toLowerCase()
  if (dest) return dest === 'document' || dest === 'iframe' || dest === 'frame'
  return /\btext\/html\b/i.test(String(request.headers.accept ?? ''))
}

/** Match a plugin route path (`:name` params, trailing `*`) against the request path after `/plugins/{id}/`. */
export function matchRoutePath(pattern: string, actual: string): Record<string, string> | null {
  const p = pattern.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const a = actual.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!
    if (seg === '*') { params['*'] = a.slice(i).map(safeDecode).join('/'); return params }
    const got = a[i]
    if (got === undefined) return null
    if (seg.startsWith(':')) params[seg.slice(1)] = safeDecode(got)
    else if (seg !== got) return null
  }
  return a.length === p.length ? params : null
}

function safeDecode(s: string): string { try { return decodeURIComponent(s) } catch { return s } }

function sendRouteResponse(reply: FastifyReply, res: RouteResponse | undefined): Sent {
  reply.code(res?.status ?? 200)
  for (const [k, v] of Object.entries(res?.headers ?? {})) reply.header(k, v)
  const b = res?.body
  if (b === undefined || b === null) { reply.send(); return SENT }
  if (b instanceof Uint8Array) {
    if (!reply.hasHeader('content-type')) reply.header('Content-Type', 'application/octet-stream')
    reply.send(Buffer.from(b.buffer, b.byteOffset, b.byteLength))
    return SENT
  }
  if (typeof b === 'string') {
    if (!reply.hasHeader('content-type')) reply.header('Content-Type', 'text/plain; charset=utf-8')
    reply.send(b)
    return SENT
  }
  reply.header('Content-Type', withCharset(String(reply.getHeader('content-type') ?? 'application/json'))).send(JSON.stringify(b))
  return SENT
}

const STORED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.mov', '.webm', '.mkv', '.mp3', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.glb', '.fbx', '.zip', '.7z', '.gz', '.ktx2', '.basis', '.psd'])

function isFormRequest(request: FastifyRequest): boolean {
  return /^application\/x-www-form-urlencoded\b/i.test(String(request.headers['content-type'] ?? ''))
}

function bodyText(request: FastifyRequest): string {
  const b = request.body
  if (b instanceof Buffer) return b.toString('utf8')
  return typeof b === 'string' ? b : ''
}

/** Form fields → ExportRequest input: `ids` repeated or comma-separated; checkboxes send `on`. */
function exportFromForm(f: URLSearchParams): Record<string, unknown> {
  const ids = f.getAll('ids').flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean)
  const flag = (v: string | null) => v === null ? undefined : ['1', 'true', 'on', 'yes'].includes(v.toLowerCase())
  const out: Record<string, unknown> = { ids }
  const withDeps = flag(f.get('withDeps'))
  if (withDeps !== undefined) out.withDeps = withDeps
  if (f.get('layout')) out.layout = f.get('layout')
  if (f.has('dir')) out.dir = f.get('dir')
  return out
}

/** The download's file name: a base name only, `.zip` added, default `bowerbird-export.zip`. */
export function zipName(requested: string | null | undefined): string {
  const base = (requested ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!base || base === '.' || base === '..') return 'bowerbird-export.zip'
  return /\.zip$/i.test(base) ? base : `${base}.zip`
}

/** Streams the archive as yazl writes it (chunked, no length up front): nothing is held in memory or on disk. */
function sendZip(reply: FastifyReply, files: Array<[string, string]>, name: string): Sent {
  const zip = new yazl.ZipFile()
  for (const [archivePath, absPath] of files) {
    zip.addFile(absPath, archivePath.replace(/^\/+/, ''), { compress: !STORED_EXT.has(path.extname(absPath).toLowerCase()) })
  }
  zip.end()
  reply.header('Content-Type', 'application/zip')
  reply.header('Content-Disposition', contentDisposition(name, true))
  reply.header('Cache-Control', 'no-store')
  const out = zip.outputStream as unknown as Readable
  zip.on('error', (e: Error) => out.destroy(e))
  reply.send(out)
  return SENT
}

function safeConfig(hub: Hub): { allowedOrigins?: string[] } | null {
  try { return hub.config() } catch { return null }
}
