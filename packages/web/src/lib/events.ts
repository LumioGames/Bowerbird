import * as React from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { EVENT_TYPES, type EventType } from '@bowerbird/schema'
import { api } from './api'

type Handler = (type: EventType, data: unknown) => void
const handlers = new Set<Handler>()
/** Subscribe to the current library's server events (new-asset pill, replaced banner, job progress…). */
export function onLibraryEvent(h: Handler): () => void { handlers.add(h); return () => handlers.delete(h) }
/** Deliver one event to subscribers (the SSE stream, development fixtures and tests call this). */
export function emitLibraryEvent(type: EventType, data: unknown): void { handlers.forEach(h => { try { h(type, data) } catch { /* isolate */ } }) }

/** Minimal EventSource surface, so development fixtures can stand in for the server stream. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void
  close(): void
}
let makeSource: (url: string) => EventSourceLike = url => new EventSource(url) as unknown as EventSourceLike
export function setEventSourceFactory(f: (url: string) => EventSourceLike): void { makeSource = f }

/**
 * Default cache invalidation per event type (web-shell.md「前端状态」: events drive partial invalidation, no polling).
 * The browse grid's own pages (`browse`) are only marked stale here: the browse page patches the rows it shows,
 * and new assets wait behind「有 N 个新资产 · 显示」instead of jumping into the grid (F-03).
 */
/** What `invalidateFor` needs: a query client, or the batcher below. */
export type Invalidator = Pick<QueryClient, 'invalidateQueries'>

/**
 * Invalidations from a burst of events (a scan registering hundreds of files) are merged: each distinct query key is
 * invalidated once per `delayMs`.
 */
export function createInvalidationBatcher(qc: Invalidator, delayMs = 100): Invalidator & { flush(): void; dispose(): void } {
  const pending = new Map<string, Parameters<QueryClient['invalidateQueries']>[0]>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    const all = [...pending.values()]
    pending.clear()
    for (const f of all) void qc.invalidateQueries(f)
  }
  return {
    invalidateQueries(filters?: Parameters<QueryClient['invalidateQueries']>[0]) {
      pending.set(JSON.stringify(filters ?? null), filters)
      if (!timer) timer = setTimeout(flush, delayMs)
      return Promise.resolve()
    },
    flush,
    dispose() { if (timer) clearTimeout(timer); timer = null; pending.clear() }
  } as Invalidator & { flush(): void; dispose(): void }
}

export function invalidateFor(qc: Invalidator, lib: string, type: EventType, data: any): void {
  const p = (k: unknown[]) => qc.invalidateQueries({ queryKey: ['lib', lib, ...k] })
  const staleBrowse = () => qc.invalidateQueries({ queryKey: ['lib', lib, 'browse'], refetchType: 'none' })
  const facets = () => p(['browse-facets'])
  switch (type) {
    case 'asset.created': p(['search']); p(['folders']); p(['info']); p(['views']); p(['vocabulary']); p(['jobs']); staleBrowse(); facets(); break
    case 'asset.removed': p(['search']); p(['folders']); p(['info']); p(['views']); p(['vocabulary']); p(['asset', data?.id]); staleBrowse(); facets(); break
    case 'asset.updated': p(['asset', data?.id]); p(['search']); p(['info']); p(['jobs']); staleBrowse(); facets(); if (data?.fields?.includes('tags')) { p(['tags']); p(['vocabulary']) } if (data?.fields?.includes('path')) p(['folders']); break
    // the pipeline does not announce finished stages as job.updated: thumbnails and updates move the 后台处理 count
    case 'asset.thumbnail': p(['search']); p(['asset', data?.id]); p(['jobs']); staleBrowse(); break
    case 'relation.updated': p(['asset', data?.from]); if (data?.to) p(['asset', data.to]); p(['search']); staleBrowse(); break
    case 'tags.updated': p(['tags']); p(['vocabulary']); p(['browse']); break
    case 'folder.updated': p(['folders']); p(['browse']); break
    case 'view.updated': p(['views']); break
    case 'trash.updated': p(['trash']); p(['info']); p(['views']); staleBrowse(); break
    case 'library.updated': p(['info']); break
    case 'plugin.updated': qc.invalidateQueries({ queryKey: ['plugins'] }); p(['info']); p(['creators']); p(['vocabulary']); p(['browse']); break
    case 'job.updated': p(['jobs']); break
    case 'issue.created': case 'issue.resolved': p(['issues']); p(['info']); p(['views']); if (data?.assetId) p(['asset', data.assetId]); p(['search']); staleBrowse(); facets(); break
    case 'scan.progress':
      p(['info'])
      // a scan that ends may have registered, moved or lost many assets: folder counts, views and facets follow
      if (!data?.running) { p(['folders']); p(['views']); p(['vocabulary']); staleBrowse(); facets() }
      break
  }
}

/** Open the SSE stream for a library while mounted. */
export function useLibraryEvents(lib: string): void {
  const qc = useQueryClient()
  React.useEffect(() => {
    let es: EventSourceLike
    try { es = makeSource(api.libraries.eventsUrl(lib)) } catch { return }
    const batch = createInvalidationBatcher(qc)
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, ev => {
        let data: unknown = null
        try { data = JSON.parse((ev as MessageEvent).data) } catch { /* ignore */ }
        invalidateFor(batch, lib, type, data)
        emitLibraryEvent(type, data)
      })
    }
    // The server drops slow clients; after a reconnect, whatever was missed is fetched again.
    let opened = false
    es.addEventListener('open', () => {
      if (opened) void qc.invalidateQueries({ queryKey: ['lib', lib] })
      opened = true
    })
    return () => { batch.dispose(); es.close() }
  }, [lib, qc])
}
