/**
 * A thin typed HTTP client over the Bowerbird API. Used by the web shell, the CLI and the MCP server,
 * so every client calls the same endpoints the same way (ADR-011). Uses global `fetch`, `FormData`, `Blob`.
 */
import type { z } from 'zod'
import { ACTOR_HEADER, API_BASE } from './primitives.js'
import type { ErrorCode } from './api.js'
import type * as A from './api.js'
import type { AssetDetail, IssuesQuery } from './index.js'
import type { RegisterFields, SearchRequest, LineageQuery, BatchRequest, ExportRequest } from './api.js'

type In<T extends z.ZodTypeAny> = z.input<T>
type Out<T extends z.ZodTypeAny> = z.output<T>

export class BowerbirdApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode | 'network', message: string, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'BowerbirdApiError'
  }
}

export interface ClientOptions {
  /** Origin of the server, e.g. `http://127.0.0.1:7420`; '' for same-origin (the web shell). */
  baseUrl?: string
  /** Actor sent with every request (`X-Bowerbird-Actor`). May be a function to read the latest value. */
  actor?: string | (() => string | undefined)
  fetch?: typeof fetch
  /** Extra headers (e.g. `Origin` for Node clients). */
  headers?: Record<string, string>
}

export type FileLike = Blob | { data: Uint8Array | ArrayBuffer; name: string; type?: string }

function enc(s: string): string { return encodeURIComponent(s) }

export function createApiClient(opts: ClientOptions = {}) {
  const base = (opts.baseUrl ?? '') + API_BASE
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis)

  function headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(opts.headers ?? {}), ...(extra ?? {}) }
    const actor = typeof opts.actor === 'function' ? opts.actor() : opts.actor
    if (actor) h[ACTOR_HEADER] = actor
    return h
  }

  async function raw(method: string, path: string, init: { query?: Record<string, unknown>; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<Response> {
    let url = base + path
    if (init.query) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(init.query)) {
        if (v === undefined || v === null) continue
        if (Array.isArray(v)) v.forEach(x => qs.append(k, String(x)))
        else qs.set(k, String(v))
      }
      const s = qs.toString()
      if (s) url += '?' + s
    }
    const h = headers(init.body !== undefined ? { 'content-type': 'application/json' } : undefined)
    let res: Response
    try {
      res = await f(url, { method, headers: h, body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined), signal: init.signal })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      throw new BowerbirdApiError(0, 'network', (e as Error).message)
    }
    if (!res.ok) {
      let body: { error?: { code?: ErrorCode; message?: string; details?: Record<string, unknown> } } = {}
      try { body = await res.json() } catch { /* not JSON */ }
      throw new BowerbirdApiError(res.status, body.error?.code ?? 'internal', body.error?.message ?? res.statusText, body.error?.details)
    }
    return res
  }

  async function json<T>(method: string, path: string, init?: Parameters<typeof raw>[2]): Promise<T> {
    const res = await raw(method, path, init)
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  function toBlob(file: FileLike): { blob: Blob; name?: string } {
    if (file instanceof Blob) return { blob: file, name: (file as File).name }
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data)
    return { blob: new Blob([data as BlobPart], { type: file.type ?? 'application/octet-stream' }), name: file.name }
  }

  const L = (lib: string) => `/libraries/${enc(lib)}`

  return {
    raw, json,
    url: (path: string) => base + path,
    health: () => json<Out<typeof A.HealthResponse>>('GET', '/health'),

    libraries: {
      list: () => json<Out<typeof A.LibrariesResponse>>('GET', '/libraries'),
      add: (body: In<typeof A.LibraryAddRequest>) => json<Out<typeof A.LibraryResponse>>('POST', '/libraries', { body }),
      get: (lib: string) => json<Out<typeof A.LibraryResponse>>('GET', L(lib)),
      patch: (lib: string, body: In<typeof A.LibraryPatchRequest>) => json<Out<typeof A.LibraryResponse>>('PATCH', L(lib), { body }),
      init: (lib: string) => json<Out<typeof A.LibraryResponse>>('POST', `${L(lib)}/init`, { body: {} }),
      /** Answers 202 once the scan has started; follow progress through `scan.progress` events or `libraries.get().scan`. */
      rescan: (lib: string, body: In<typeof A.RescanRequest> = {}) => json<unknown>('POST', `${L(lib)}/rescan`, { body }),
      stopScan: (lib: string) => json<void>('POST', `${L(lib)}/rescan/stop`, { body: {} }),
      /** Show the library root in the file manager (server machine only; `not_local` otherwise). */
      reveal: (lib: string) => json<void>('POST', `${L(lib)}/reveal`, { body: {} }),
      vocabulary: (lib: string) => json<Out<typeof A.VocabularyResponse>>('GET', `${L(lib)}/vocabulary`),
      cache: (lib: string) => json<Out<typeof A.CacheResponse>>('GET', `${L(lib)}/cache`),
      cleanCache: (lib: string, body: In<typeof A.CacheCleanRequest> = {}) => json<Out<typeof A.CacheCleanResponse>>('POST', `${L(lib)}/cache/clean`, { body }),
      eventsUrl: (lib: string) => `${base}${L(lib)}/events`
    },

    fs: {
      /** Folders of the server's computer (folder chooser; local requests only, `not_local` otherwise). Default: home. */
      folders: (path?: string, signal?: AbortSignal) => json<Out<typeof A.FsFoldersResponse>>('GET', '/fs/folders', { query: { path }, signal })
    },

    config: {
      get: () => json<Out<typeof A.ConfigResponse>>('GET', '/config'),
      patch: (body: In<typeof A.ConfigPatchRequest>) => json<Out<typeof A.ConfigResponse>>('PATCH', '/config', { body })
    },

    plugins: {
      list: () => json<Out<typeof A.PluginsResponse>>('GET', '/plugins'),
      install: (spec: string) => json<Out<typeof A.PluginsResponse>>('POST', '/plugins', { body: { spec } }),
      update: (id: string) => json<Out<typeof A.PluginsResponse>>('POST', `/plugins/${enc(id)}/update`, { body: {} }),
      remove: (id: string) => json<void>('DELETE', `/plugins/${enc(id)}`),
      enable: (id: string, library?: string) => json<Out<typeof A.PluginsResponse>>('POST', `/plugins/${enc(id)}/enable`, { body: { library } }),
      disable: (id: string, library?: string) => json<Out<typeof A.PluginsResponse>>('POST', `/plugins/${enc(id)}/disable`, { body: { library } }),
      machineSettings: (id: string) => json<Out<typeof A.PluginSettingsResponse>>('GET', `/plugins/${enc(id)}/settings`),
      putMachineSettings: (id: string, values: Record<string, unknown>) => json<Out<typeof A.PluginSettingsResponse>>('PUT', `/plugins/${enc(id)}/settings`, { body: { values } }),
      librarySettings: (lib: string, id: string) => json<Out<typeof A.PluginSettingsResponse>>('GET', `${L(lib)}/plugins/${enc(id)}/settings`),
      putLibrarySettings: (lib: string, id: string, values: Record<string, unknown>) => json<Out<typeof A.PluginSettingsResponse>>('PUT', `${L(lib)}/plugins/${enc(id)}/settings`, { body: { values } }),
      webUrl: (id: string) => `${base}/plugins/${enc(id)}/web`,
      routeUrl: (id: string, path: string) => `${base}/plugins/${enc(id)}/${path.replace(/^\//, '')}`
    },

    search: (lib: string, body: In<typeof SearchRequest>, signal?: AbortSignal) => json<Out<typeof A.SearchResponse>>('POST', `${L(lib)}/search`, { body, signal }),

    assets: {
      get: (lib: string, id: string) => json<AssetDetail>('GET', `${L(lib)}/assets/${enc(id)}`),
      precheck: (lib: string, body: In<typeof A.PrecheckRequest>) => json<Out<typeof A.PrecheckResponse>>('POST', `${L(lib)}/assets/precheck`, { body }),
      /** Upload a file (or register an in-library `fields.path` when `file` is omitted). */
      register: (lib: string, fields: In<typeof RegisterFields>, file?: FileLike, signal?: AbortSignal) => {
        const form = new FormData()
        form.append('meta', JSON.stringify(fields))
        if (file) { const b = toBlob(file); form.append('file', b.blob, b.name ?? fields.name ?? 'file') }
        return json<Out<typeof A.RegisterResponse>>('POST', `${L(lib)}/assets`, { form, signal })
      },
      /** Say what assets should have; only differences are written (ADR-068). */
      apply: (lib: string, body: In<typeof A.ApplyRequest>) => json<Out<typeof A.ApplyResponse>>('POST', `${L(lib)}/assets/apply`, { body }),
      patch: (lib: string, id: string, body: In<typeof A.AssetPatch>) => json<Out<typeof A.AssetPatchResponse>>('PATCH', `${L(lib)}/assets/${enc(id)}`, { body }),
      /** 移出资产库：its .bmeta to the trash, the file stays (ADR-067). */
      untrack: (lib: string, id: string) => json<Out<typeof A.UntrackResponse>>('POST', `${L(lib)}/assets/${enc(id)}/untrack`, { body: {} }),
      remove: (lib: string, id: string, force = false) => json<Out<typeof A.DeleteResponse>>('DELETE', `${L(lib)}/assets/${enc(id)}`, { query: { force: force || undefined } }),
      replaceContent: (lib: string, id: string, file: FileLike, note?: string) => {
        const form = new FormData()
        form.append('meta', JSON.stringify({ note }))
        const b = toBlob(file); form.append('file', b.blob, b.name ?? 'file')
        return json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/content`, { form })
      },
      move: (lib: string, id: string, body: In<typeof A.MoveRequest>) => json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/move`, { body }),
      copy: (lib: string, id: string, body: In<typeof A.CopyRequest> = {}) => json<Out<typeof A.CopyResponse>>('POST', `${L(lib)}/assets/${enc(id)}/copy`, { body }),
      review: (lib: string, id: string, body: In<typeof A.ReviewRequest>) => json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/review`, { body }),
      acceptTags: (lib: string, id: string, tags: string[]) => json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/tags/accept`, { body: { tags } }),
      dismissTags: (lib: string, id: string, tags: string[]) => json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/tags/dismiss`, { body: { tags } }),
      fileUrl: (lib: string, id: string, download = false) => `${base}${L(lib)}/assets/${enc(id)}/file${download ? '?download=1' : ''}`,
      slotUrl: (lib: string, id: string, slot: string) => `${base}${L(lib)}/assets/${enc(id)}/slots/${enc(slot)}`,
      bundleFileUrl: (lib: string, id: string, inner: string) => `${base}${L(lib)}/assets/${enc(id)}/bundle/${inner.split('/').map(enc).join('/')}`,
      open: (lib: string, id: string) => json<void>('POST', `${L(lib)}/assets/${enc(id)}/open`, { body: {} }),
      reveal: (lib: string, id: string) => json<void>('POST', `${L(lib)}/assets/${enc(id)}/reveal`, { body: {} }),
      thumbnailUrl: (lib: string, id: string, variant = 'thumb') => `${base}${L(lib)}/assets/${enc(id)}/thumbnail?variant=${variant}`,
      putThumbnail: (lib: string, id: string, image: Blob) => {
        const form = new FormData(); form.append('image', image, 'thumbnail.webp')
        return json<AssetDetail>('PUT', `${L(lib)}/assets/${enc(id)}/thumbnail`, { form })
      },
      clearThumbnail: (lib: string, id: string) => json<AssetDetail>('DELETE', `${L(lib)}/assets/${enc(id)}/thumbnail`),
      summary: (lib: string, id: string) => json<Out<typeof A.SummaryResponse>>('GET', `${L(lib)}/assets/${enc(id)}/summary`),
      lineage: (lib: string, id: string, q: Partial<In<typeof LineageQuery>> = {}) => json<Out<typeof A.LineageResponse>>('GET', `${L(lib)}/assets/${enc(id)}/lineage`, { query: { direction: q.direction, types: q.types?.join(','), depth: q.depth } }),
      versions: (lib: string, id: string) => json<Out<typeof A.VersionsResponse>>('GET', `${L(lib)}/assets/${enc(id)}/versions`),
      versionFileUrl: (lib: string, id: string, hash: string) => `${base}${L(lib)}/assets/${enc(id)}/versions/${enc(hash)}/file`,
      restoreVersion: (lib: string, id: string, hash: string) => json<Out<typeof A.RestoreResponse>>('POST', `${L(lib)}/assets/${enc(id)}/versions/${enc(hash)}/restore`, { body: {} }),
      batch: (lib: string, body: In<typeof BatchRequest>) => json<Out<typeof A.BatchResponse>>('POST', `${L(lib)}/assets/batch`, { body })
    },

    relations: {
      add: (lib: string, id: string, body: In<typeof A.RelationInput>) => json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/relations`, { body }),
      remove: (lib: string, id: string, body: In<typeof A.RelationRef>) => json<AssetDetail>('DELETE', `${L(lib)}/assets/${enc(id)}/relations`, { body }),
      replace: (lib: string, id: string, body: In<typeof A.RelationReplaceRequest>) => json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/relations/replace`, { body }),
      acknowledge: (lib: string, id: string, to: string) => json<AssetDetail>('POST', `${L(lib)}/assets/${enc(id)}/relations/acknowledge`, { body: { to } }),
      retarget: (lib: string, body: In<typeof A.RetargetRequest>) => json<Out<typeof A.RetargetResponse>>('POST', `${L(lib)}/relations/retarget`, { body })
    },

    folders: {
      tree: (lib: string) => json<Out<typeof A.FoldersResponse>>('GET', `${L(lib)}/folders`),
      create: (lib: string, path: string) => json<Out<typeof A.FoldersResponse>>('POST', `${L(lib)}/folders`, { body: { path } }),
      patch: (lib: string, body: In<typeof A.FolderPatchRequest>) => json<Out<typeof A.FoldersResponse>>('PATCH', `${L(lib)}/folders`, { body }),
      remove: (lib: string, path: string, force = false) => json<Out<typeof A.FolderDeleteResponse>>('DELETE', `${L(lib)}/folders`, { body: { path, force: force || undefined } }),
      bundle: (lib: string, body: In<typeof A.BundleRequest>) => json<AssetDetail>('POST', `${L(lib)}/folders/bundle`, { body })
    },

    tags: {
      list: (lib: string) => json<Out<typeof A.TagsResponse>>('GET', `${L(lib)}/tags`),
      patch: (lib: string, body: In<typeof A.TagsPatchRequest>) => json<Out<typeof A.TagsPatchResponse>>('PATCH', `${L(lib)}/tags`, { body }),
      accept: (lib: string, body: In<typeof A.LibraryTagRequest>) => json<Out<typeof A.TagsPatchResponse>>('POST', `${L(lib)}/tags/accept`, { body }),
      dismiss: (lib: string, body: In<typeof A.LibraryTagRequest>) => json<Out<typeof A.TagsPatchResponse>>('POST', `${L(lib)}/tags/dismiss`, { body })
    },

    views: {
      list: (lib: string) => json<Out<typeof A.ViewsResponse>>('GET', `${L(lib)}/views`),
      put: (lib: string, name: string, body: In<typeof A.ViewPutRequest>) => json<Out<typeof A.ViewsResponse>>('PUT', `${L(lib)}/views/${enc(name)}`, { body }),
      remove: (lib: string, name: string) => json<Out<typeof A.ViewsResponse>>('DELETE', `${L(lib)}/views/${enc(name)}`)
    },

    issues: {
      list: (lib: string, q: In<typeof IssuesQuery> = {}) => json<Out<typeof A.IssuesResponse>>('GET', `${L(lib)}/issues`, { query: { type: q.type?.join(','), level: q.level?.join(','), assetId: q.assetId } }),
      resolve: (lib: string, id: string, body: In<typeof A.IssueResolveRequest>) => json<Out<typeof A.IssueResolveResponse>>('POST', `${L(lib)}/issues/${enc(id)}/resolve`, { body }),
      resolveMany: (lib: string, body: In<typeof A.IssueBatchResolveRequest>) => json<Out<typeof A.IssueResolveResponse>>('POST', `${L(lib)}/issues/resolve`, { body }),
      candidates: (lib: string, id: string) => json<Out<typeof A.RelocateCandidates>>('GET', `${L(lib)}/issues/${enc(id)}/candidates`)
    },

    trash: {
      list: (lib: string) => json<Out<typeof A.TrashResponse>>('GET', `${L(lib)}/trash`),
      restore: (lib: string, id: string, rename?: boolean) => json<Out<typeof A.TrashRestoreResponse>>('POST', `${L(lib)}/trash/${enc(id)}/restore`, { body: rename === undefined ? {} : { rename } }),
      purge: (lib: string, id: string) => json<void>('DELETE', `${L(lib)}/trash/${enc(id)}`),
      empty: (lib: string) => json<void>('DELETE', `${L(lib)}/trash`)
    },

    actions: {
      forSelection: (lib: string, ids: string[]) => json<Out<typeof A.ActionsResponse>>('GET', `${L(lib)}/actions`, { query: { ids: ids.join(',') } }),
      run: (lib: string, id: string, body: In<typeof A.ActionRunRequest>) => json<Out<typeof A.JobResponse>>('POST', `${L(lib)}/actions/${enc(id)}/runs`, { body })
    },

    creators: {
      list: (lib: string) => json<Out<typeof A.CreatorsResponse>>('GET', `${L(lib)}/creators`),
      run: (lib: string, id: string, body: In<typeof A.CreateRunRequest>) => json<Out<typeof A.JobResponse>>('POST', `${L(lib)}/creators/${enc(id)}/runs`, { body })
    },

    jobs: {
      overview: (lib: string) => json<Out<typeof A.JobsResponse>>('GET', `${L(lib)}/jobs`),
      get: (lib: string, id: string) => json<Out<typeof A.JobResponse>>('GET', `${L(lib)}/jobs/${enc(id)}`),
      cancel: (lib: string, id: string) => json<void>('DELETE', `${L(lib)}/jobs/${enc(id)}`),
      retry: (lib: string, body: In<typeof A.JobsRetryRequest>) => json<void>('POST', `${L(lib)}/jobs/retry`, { body })
    },

    exports: {
      plan: (lib: string, body: In<typeof ExportRequest>) => json<Out<typeof A.ExportPlan>>('POST', `${L(lib)}/export/plan`, { body }),
      /** With `dir`: copies on the server machine. Without: returns the zip response (caller streams/saves it). */
      run: (lib: string, body: In<typeof ExportRequest>) => raw('POST', `${L(lib)}/export`, { body })
    },

    render: {
      next: (lib: string, visible: string[] = []) => json<Out<typeof A.RenderNextResponse>>('GET', `${L(lib)}/render/next`, { query: { visible: visible.join(',') || undefined } }),
      submit: (lib: string, job: string, parts: Partial<Record<'thumb' | 'poster' | 'scrub' | 'turnaround' | 'preview', Blob>>, fields: In<typeof A.RenderResultFields> = {}) => {
        const form = new FormData()
        form.append('meta', JSON.stringify(fields))
        for (const [k, v] of Object.entries(parts)) if (v) form.append(k, v, `${k}.webp`)
        return json<void>('PUT', `${L(lib)}/render/${enc(job)}`, { form })
      }
    }
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
