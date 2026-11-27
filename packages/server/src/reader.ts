/**
 * Read-only library view handed to plugin routes (`RouteRequest.library`), built from the public LibraryService
 * methods so the server needs no kernel internals.
 */
import type { CallContext, LibraryPlugins, LibraryService } from '@bowerbird/core'
import { REVIEW_STATUSES, baseOf, dirOf } from '@bowerbird/schema'
import { isCoreError } from './errors.js'

type PluginRoute = ReturnType<LibraryPlugins['routes']>[number]['route']
export type RouteRequest = Parameters<PluginRoute['handler']>[0]
export type RouteResponse = Awaited<ReturnType<PluginRoute['handler']>>
export type LibraryReader = NonNullable<RouteRequest['library']>
export type AuthProvider = ReturnType<LibraryPlugins['auth']>[number]['provider']
export type IncomingRequest = Parameters<AuthProvider['check']>[0]

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try { return await p } catch (e) { if (isCoreError(e) && e.code === 'not_found') return null; throw e }
}

export function libraryReader(svc: LibraryService, ctx: CallContext, info: { name: string; root: string }): LibraryReader {
  return {
    id: svc.id,
    name: info.name,
    root: info.root,
    get: id => orNull(svc.get(id, ctx)),
    async getByPath(p) {
      const folder = dirOf(p)
      let cursor: string | null | undefined = null
      do {
        // Every review status explicitly: a lookup by path must not be narrowed by the agent search scope.
        const res = await svc.search({ filter: { folder, folderExact: true, includeAuxiliary: true, review: [...REVIEW_STATUSES] }, sort: 'name', limit: 1000, cursor }, ctx)
        const hit = res.items.find(i => i.path === p || (i.path === p.replace(/\/$/, '') && baseOf(i.path) === baseOf(p)))
        if (hit) return orNull(svc.get(hit.id, ctx))
        cursor = res.cursor
      } while (cursor)
      return null
    },
    search: q => svc.search(q, ctx),
    filePath: async id => (await orNull(svc.file(id)))?.absPath ?? null,
    issues: async assetId => (await svc.issues(assetId ? { assetId } : {})).issues
  }
}
