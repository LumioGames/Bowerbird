/**
 * CLI and MCP over the REAL kernel and server: with `agentSearchScope = approved`, an agent still finds a pending
 * asset by its path (lookups are not searches), while its searches stay narrowed; and `bb mcp --name 建模` records
 * the actor `agent:建模` (the name is encoded exactly once on the way).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHub, type Hub } from '@bowerbird/core'
import { createApiClient, type ApiClient } from '@bowerbird/schema'
import { startServer, type RunningServer } from '@bowerbird/server'
import { createMcpServer, type McpOptions } from '@bowerbird/mcp'
import { run, type CliIO } from './program.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

let tmp: string
let hub: Hub
let server: RunningServer
let api: ApiClient
let lib: string
let pendingId: string
let approvedId: string

async function bb(args: string[], env: Record<string, string> = {}, extra: Partial<CliIO> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = await run(args, {
    out: t => out.push(t), err: t => err.push(t), env: { BOWERBIRD_URL: server.url, ...env }, cwd: tmp,
    createHub: async () => { throw new Error('not used') }, startServer: async () => { throw new Error('not used') },
    runMcpServer: async () => { throw new Error('not used') }, installSignalHandlers: false, ...extra
  })
  const text = out.join('\n')
  let json: any
  try { json = JSON.parse(text) } catch { json = undefined }
  return { code, out: text, err: err.join('\n'), json }
}

async function mcpClient(opts: McpOptions) {
  const mcp = createMcpServer(opts)
  const client = new Client({ name: 'test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([mcp.connect(a), client.connect(b)])
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ type: string; text?: string }> }
    return { isError: !!r.isError, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') }
  }
  return { client, call }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cli-int-'))
  hub = await createHub({ home: path.join(tmp, 'home'), builtinPluginDirs: [], watch: false })
  lib = (await hub.addLibrary(path.join(tmp, 'lib'), '测试库')).id
  server = await startServer({ hub, host: '127.0.0.1', port: 0, defaultLibrary: lib, print: () => undefined })
  api = createApiClient({ baseUrl: server.url, actor: 'user:lin' })
  pendingId = (await api.assets.register(lib, { folder: 'props' }, { data: PNG, name: 'lid.png' })).asset!.id
  approvedId = (await api.assets.register(lib, { folder: 'props' }, { data: PNG, name: 'chest.png' })).asset!.id
  await api.assets.review(lib, approvedId, { status: 'approved' })
  await api.libraries.patch(lib, { settings: { agentSearchScope: 'approved' } })
})
afterAll(async () => {
  await server?.close()
  await hub?.close()
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
})

describe('agentSearchScope = approved narrows searches, not lookups by path', () => {
  it('the scope is on: an agent search does not list the pending asset', async () => {
    const r = await bb(['search', 'folder:props', '--json'], { BOWERBIRD_ACTOR: 'agent:modeler' })
    expect(r.json.scopedToApproved).toBe(true)
    expect(r.json.items.map((i: { id: string }) => i.id)).toEqual([approvedId])
  })
  it('bb get / bb tag by path find the pending asset for an agent', async () => {
    const g = await bb(['get', 'props/lid.png', '--json'], { BOWERBIRD_ACTOR: 'agent:modeler' })
    expect(g.code).toBe(0)
    expect(g.json.asset).toMatchObject({ id: pendingId, review: 'pending' })
    const t = await bb(['tag', 'props/lid.png', '--add', '盖子', '--json'], { BOWERBIRD_ACTOR: 'agent:modeler' })
    expect(t.code).toBe(0)
    expect(t.json[0].asset.tags).toContain('盖子')
  })
  it('MCP bb_get / bb_update by path find it too; bb_search stays narrowed', async () => {
    const { client, call } = await mcpClient({ baseUrl: server.url, actor: 'modeler' })
    const g = await call('bb_get', { id: 'props/lid.png' })
    expect(g.isError).toBe(false)
    expect(g.text).toContain(pendingId)
    const u = await call('bb_update', { id: 'props/lid.png', description: '宝箱的盖子' })
    expect(u.isError).toBe(false)
    expect((await api.assets.get(lib, pendingId)).descriptionFull).toBe('宝箱的盖子')
    const s = await call('bb_search', { query: 'folder:props' })
    expect(s.text).toContain(approvedId)
    expect(s.text).not.toContain(pendingId)
    await client.close()
  })
})

describe('bb mcp --name 建模', () => {
  it('records the actor agent:建模', async () => {
    const r = await bb(['mcp', '--name', '建模'], {}, {
      runMcpServer: async o => {
        const { client, call } = await mcpClient(o)
        const u = await call('bb_update', { id: approvedId, tags: { add: ['道具'] } })
        expect(u.isError).toBe(false)
        await client.close()
      }
    })
    expect(r.code).toBe(0)
    expect((await api.assets.get(lib, approvedId)).modifiedBy).toBe('agent:建模')
  })
})
