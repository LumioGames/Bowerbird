/**
 * `GET /libraries/{library}/events` — server-sent events of one library (api-and-agent.md「事件流」).
 * Each message is `event: <type>` + `data: <JSON>`; a comment line every `heartbeatMs` keeps proxies from
 * closing the stream; the subscription is dropped when the client goes away or the server closes.
 *
 * A client that went away while the library was still opening gets no subscription at all, and a client that
 * stops reading is disconnected once more than `maxBufferBytes` wait in its send buffer (it reconnects and
 * reloads; events are hints to refetch, not a log).
 */
import { EVENT_TYPES, type EventType } from '@bowerbird/schema'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EventBus } from '@bowerbird/core'

const KNOWN = new Set<string>(EVENT_TYPES)

export interface SseHub {
  open(request: FastifyRequest, reply: FastifyReply, events: EventBus, libraryId: string): void
  /** End every open stream (server shutdown). */
  closeAll(): void
  readonly size: number
}

export interface SseOptions { heartbeatMs?: number; maxBufferBytes?: number }

export function connectionGone(request: FastifyRequest, reply: FastifyReply): boolean {
  const res = reply.raw
  const sock = request.raw.socket
  return res.destroyed || res.writableEnded || request.raw.destroyed || !sock || sock.destroyed || !sock.writable
}

export function createSseHub(opts: SseOptions = {}): SseHub {
  const heartbeatMs = opts.heartbeatMs ?? 15_000
  const maxBuffer = opts.maxBufferBytes ?? 1024 * 1024
  const open = new Set<() => void>()
  return {
    get size() { return open.size },
    open(request, reply, events, libraryId) {
      reply.hijack()
      const res = reply.raw
      if (connectionGone(request, reply)) { res.destroy(); return }
      const headers: Record<string, string | number | string[]> = {}
      for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string | number | string[]
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      let closed = false
      let timer: ReturnType<typeof setInterval> | null = null
      let off: (() => void) | null = null
      const close = (slow = false) => {
        if (closed) return
        closed = true
        if (timer) clearInterval(timer)
        off?.()
        open.delete(closeFn)
        if (slow) res.destroy() // ending would wait for a buffer the client never drains
        else if (!res.writableEnded) res.end()
      }
      const closeFn = () => close()
      const write = (chunk: string) => {
        if (closed || res.writableEnded || res.destroyed) return
        if (!res.write(chunk) && res.writableLength > maxBuffer) close(true)
      }
      open.add(closeFn)
      // Not request.raw 'close': it fires once the (empty) request body is read.
      res.on('close', closeFn)
      res.on('error', closeFn)
      write('retry: 3000\n: connected\n\n')
      if (closed) return
      off = events.on(libraryId, (type: EventType, data: unknown) => {
        if (KNOWN.has(type)) write(`event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`)
      })
      timer = setInterval(() => write(': ping\n\n'), heartbeatMs)
      timer.unref?.()
    },
    closeAll() { for (const c of [...open]) c() }
  }
}
