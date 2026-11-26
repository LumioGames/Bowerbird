/**
 * @bowerbird/server — the single HTTP API (`/api/v1`), SSE events, plugin routes, static web shell.
 * Default listen address is 127.0.0.1:7420 (api-and-agent.md「安全」); listening beyond loopback prints the LAN warning.
 */
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import type { Hub } from '@bowerbird/core'
import { buildApp } from './app.js'
import { isLoopbackHost, lanAddress, lanWarning } from './security.js'

export { buildApp, endpointRoute, matchRoutePath, type AppOptions, type PluginToggleCapable } from './app.js'
export {
  checkRequestOrigin, hostAllowed, isLocalRequest, isLoopbackAddress, isLoopbackHost, lanAddress, lanWarning,
  normalizeOrigin, parseActor, parseHostHeader
} from './security.js'
export { HttpError, toHttpError } from './errors.js'
export { parseRange, contentDisposition } from './files.js'
export { SECRET_PLACEHOLDER, isSecretPlaceholder, maskSecrets, restoreSecrets, writeOnlyKeys } from './secrets.js'
export { sameBundleSubresource } from './security.js'

export interface ServerOptions {
  hub: Hub
  host: string
  port: number
  /** Directory of the built web shell (packages/web/dist); omitted = API only. */
  webDir?: string
  /** Extra allowed origins (CORS off by default). */
  allowedOrigins?: string[]
  /** Library opened by this process (`bb serve <dir>`); defaults to the hub's default library. */
  defaultLibrary?: string
  /** Where startup notices go (default: stderr). */
  print?: (text: string) => void
  /** SSE heartbeat interval in ms (default 15 s). */
  heartbeatMs?: number
  /** Disconnect an SSE client that lets more than this many bytes pile up unread (default 1 MiB). */
  sseMaxBufferBytes?: number
}

export interface RunningServer {
  /** URL for clients on this machine. */
  url: string
  host: string
  port: number
  /** Listening beyond loopback (the LAN warning was printed). */
  lanOpen: boolean
  /** Address other machines use when `lanOpen`. */
  lanUrl: string | null
  app: FastifyInstance
  close(): Promise<void>
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const app = await buildApp({
    hub: opts.hub, host: opts.host, webDir: opts.webDir, allowedOrigins: opts.allowedOrigins,
    defaultLibrary: opts.defaultLibrary, heartbeatMs: opts.heartbeatMs, sseMaxBufferBytes: opts.sseMaxBufferBytes
  })
  await app.listen({ host: opts.host, port: opts.port })
  const addr = app.server.address() as AddressInfo
  const port = addr.port
  const lanOpen = !isLoopbackHost(opts.host)
  const h = opts.host.replace(/^\[|\]$/g, '')
  const localHost = lanOpen && (h === '0.0.0.0' || h === '::' || h === '') ? '127.0.0.1' : h.includes(':') ? `[${h}]` : h
  const url = `http://${localHost}:${port}`
  const lanUrl = lanOpen ? lanAddress(opts.host, port) : null
  if (lanOpen) (opts.print ?? (t => process.stderr.write(t + '\n')))(lanWarning(lanUrl!))
  let closed = false
  return {
    url, host: opts.host, port, lanOpen, lanUrl, app,
    async close() {
      if (closed) return
      closed = true
      app.sse.closeAll()
      await app.close()
    }
  }
}
