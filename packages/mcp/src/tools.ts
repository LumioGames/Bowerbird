/**
 * The MCP server: one tool `bb_<name>` per capability of capabilities.ts that is offered to agents (ADR-071). No
 * tool removes anything (ADR-009). Each call connects as a command does (ADR-069): the given server, a running
 * one, or — when the caller can open the library itself — the library in this process.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createApiClient, type ApiClient } from '@bowerbird/schema'
import { CAPABILITIES, inputSchema, type CapContext } from './capabilities.js'
import { connect, libraryRootOf, type Connection } from './connect.js'
import { errorText, resolveLibrary } from './resolve.js'

/** Tool names, in table order. */
export const TOOL_NAMES = CAPABILITIES.filter(c => c.mcp !== false).map(c => `bb_${c.name}`)

export interface McpOptions {
  /** Server origin, e.g. `http://127.0.0.1:7420`; absent = find a running one, else `openLocal`. */
  baseUrl?: string
  /** `BOWERBIRD_HOME`, where a running server announces itself (with `openLocal`, ADR-069). */
  home?: string
  /** Open the library in this process when no server runs (supplied by the command line). */
  openLocal?: () => Promise<Connection>
  /** Also look for a server at this address (one that does not announce itself in server.json). */
  defaultUrl?: string
  /** Library id; default: the server's default library. */
  library?: string
  /** `agent:<name>` (a bare name gets the `agent:` prefix). */
  actor?: string
  fetch?: typeof fetch
  /** Where relative local paths start (default the process's working directory). */
  cwd?: string
}

/** `agent:<name>`; non-ASCII names are percent-encoded for the header (the server decodes them). */
export function agentActor(name: string | undefined): string {
  const raw = (name ?? '').trim() || 'agent:unnamed'
  const actor = /^(agent|user):/.test(raw) ? raw : `agent:${raw}`
  return encodeActorHeader(actor)
}

export function encodeActorHeader(actor: string): string {
  const i = actor.indexOf(':')
  const kind = actor.slice(0, i)
  const name = actor.slice(i + 1)
  return /^[\x21-\x24\x26-\x7e][\x20-\x24\x26-\x7e]*$/.test(name) ? actor : `${kind}:${encodeURIComponent(name)}`
}

/** A capability context for one call on one connection. */
export function capContext(o: { baseUrl: string; actor?: string; library?: string; fetch?: typeof fetch; cwd?: string; surface: 'cli' | 'mcp' }): CapContext & { client: ApiClient } {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis)
  const actorHeader = o.actor ? encodeActorHeader(o.actor) : undefined
  const client = createApiClient({ baseUrl: o.baseUrl, actor: actorHeader, fetch: f })
  let lib: Promise<string> | null = null
  return {
    client, baseUrl: o.baseUrl, fetch: f, actorHeader, actor: o.actor, cwd: o.cwd ?? process.cwd(), surface: o.surface,
    library: () => { lib ??= resolveLibrary(client, o.library).catch(e => { lib = null; throw e }); return lib }
  }
}

/** Build the MCP server with every agent tool; connect it to any transport. */
export function createMcpServer(opts: McpOptions): McpServer {
  const actor = decodeURIComponentSafe(agentActor(opts.actor))
  const server = new McpServer({ name: 'bowerbird', version: '0.1.0' }, {
    instructions: 'Bowerbird 游戏资产库。登记之前先搜索（bb_search）、查看（bb_get）；起新标签之前先看 bb_vocabulary。说出资产应有的信息用 bb_apply：同样的内容重跑不会多写，dryRun 先看会改什么。每个结果都带物料阶段（reference / production / runtime）和校验状态（pending / approved / rejected / exempt）。Agent 不能删除资产。'
  })
  for (const cap of CAPABILITIES) {
    if (cap.mcp === false) continue
    server.registerTool(`bb_${cap.name}`, { title: cap.title, description: cap.summary, inputSchema: inputSchema(cap) }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      let conn: Connection | null = null
      try {
        const root = libraryRootOf(opts.cwd ?? process.cwd())
        conn = await connect({
          ...(opts.baseUrl ? { server: opts.baseUrl } : {}), home: opts.home ?? '', ...(opts.fetch ? { fetch: opts.fetch } : {}),
          ...(opts.openLocal ? { openLocal: opts.openLocal } : {}), ...(opts.defaultUrl ? { defaultUrl: opts.defaultUrl } : {}),
          want: { ...(opts.library ? { library: opts.library } : {}), ...(root ? { root } : {}) }
        })
        const library = conn.library ?? opts.library
        const ctx = capContext({ baseUrl: conn.baseUrl, actor, ...(library ? { library } : {}), ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.cwd ? { cwd: opts.cwd } : {}), surface: 'mcp' })
        const r = await cap.run(ctx, args ?? {})
        const content: CallToolResult['content'] = [{ type: 'text', text: r.text }]
        for (const img of r.images ?? []) content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
        return { content, ...(r.failed ? { isError: true } : {}) }
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `错误：${errorText(e)}` }] }
      } finally {
        await conn?.close().catch(() => {})
      }
    })
  }
  return server
}

function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s) } catch { return s } }
