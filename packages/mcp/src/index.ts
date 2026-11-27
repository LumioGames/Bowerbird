/**
 * @bowerbird/mcp — the capability table shared by the MCP tools and the `bb` command line (ADR-071), the MCP server
 * built from it, and how a call connects (ADR-069). Depends on schema and the official SDK only; never on core.
 * `runMcpServer` serves over stdio (`bb mcp`).
 */
import type { Readable, Writable } from 'node:stream'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer, type McpOptions } from './tools.js'

export { createMcpServer, capContext, agentActor, encodeActorHeader, TOOL_NAMES, type McpOptions } from './tools.js'
export * from './capabilities.js'
export * from './connect.js'
export * from './format.js'
export * from './resolve.js'

export interface StdioOptions {
  /** Streams to serve on (default process.stdin / process.stdout; tests pass their own). */
  stdin?: Readable
  stdout?: Writable
}

/**
 * Serve the tools on stdin/stdout until the client disconnects. When stdin ends, requests already received are
 * still answered before the server stops (a client that writes its calls and closes its end gets its replies).
 */
export async function runMcpServer(opts: McpOptions & StdioOptions): Promise<void> {
  const { stdin = process.stdin, stdout = process.stdout, ...mcp } = opts
  const server = createMcpServer(mcp)
  const transport = new StdioServerTransport(stdin, stdout)
  const closed = new Promise<void>(resolve => { transport.onclose = () => resolve() })

  // Count requests in and answers out, so the end of input waits for the answers still owed. The counting is set
  // up before any input can flow: the receive hook goes in when the protocol starts the transport.
  let owed = 0
  let ended = false
  let settle: (() => void) | null = null
  const startTransport = transport.start.bind(transport)
  transport.start = async () => {
    const receive = transport.onmessage
    transport.onmessage = (msg: JSONRPCMessage) => {
      if ('method' in msg && 'id' in msg) owed++
      receive?.(msg)
    }
    await startTransport()
  }
  const send = transport.send.bind(transport)
  transport.send = async (msg: JSONRPCMessage) => {
    await send(msg)
    if ('id' in msg && ('result' in msg || 'error' in msg) && --owed <= 0 && ended) settle?.()
  }
  stdin.once('end', () => {
    ended = true
    void (async () => {
      // let messages already read reach their handlers, then wait for what they owe
      await new Promise(resolve => setImmediate(resolve))
      if (owed > 0) await new Promise<void>(resolve => { settle = resolve })
      await server.close()
    })()
  })
  await server.connect(transport)
  await closed
}
