/**
 * The ten MCP tools (api-and-agent.md「MCP 工具」), each a thin wrapper over the HTTP API. No delete tool:
 * deleting goes through the web UI or the command line (ADR-009).
 */
import fs from 'node:fs'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  BowerbirdApiError, Filter, ISSUE_LEVELS, ISSUE_TYPES, ON_CONFLICT, SORT_KEYS, STAGES, VIEW_NAMES, createApiClient,
  parseQueryText, type ApiClient, type AssetDetail, type RegisterResponse
} from '@bowerbird/schema'
import {
  creatorsText, detailText, exportPlanText, issuesText, jobText, lineageText, newTagsText,
  overviewNote, registerText, searchText, summaryLine, vocabularyText
} from './format.js'
import {
  ALL_REVIEW, downloadExport, errorText, fileForUpload, localAccess, localPathOf, relativeToRoot, resolveAssetId, resolveLibrary
} from './resolve.js'

export const TOOL_NAMES = [
  'bb_search', 'bb_get', 'bb_trace', 'bb_register', 'bb_update', 'bb_fetch', 'bb_creators', 'bb_create', 'bb_vocabulary', 'bb_health'
] as const

export interface McpOptions {
  /** Server origin, e.g. `http://127.0.0.1:7420`. */
  baseUrl: string
  /** Library id; default: the server's default library. */
  library?: string
  /** `agent:<name>` (a bare name gets the `agent:` prefix). */
  actor?: string
  fetch?: typeof fetch
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

const RelationInputZ = z.object({
  type: z.string().describe('source | uses | belongs, or a plugin relation type'),
  to: z.string().describe('GUID of the other asset'),
  slot: z.string().optional().describe('position name written in the file (e.g. a texture file name)'),
  note: z.string().optional(),
  record: z.string().optional().describe('existing production record id (source relations)')
})
const RelationRefZ = z.object({ type: z.string(), to: z.string(), slot: z.string().optional() })
const RecordZ = z.object({
  method: z.string().describe('ai-generate | manual | slice | render | export | convert | copy | other | <pluginId>/<name>'),
  tool: z.string().optional(),
  prompt: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional().describe('conventional keys: model, seed, negativePrompt; slices put their rect here'),
  inputs: z.array(z.object({ id: z.string(), role: z.string().optional() })).optional().describe('input assets with roles, e.g. reference, mask, turnaround'),
  note: z.string().optional()
})
const ViewsZ = z.object({
  rows: z.number().int().min(1).max(8),
  cols: z.number().int().min(1).max(8),
  cells: z.array(z.enum(VIEW_NAMES).nullable()).describe('left→right, top→bottom; rows×cols entries')
})

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] } }

/**
 * Runs the steps of a multi-step tool; after a failure `failed()` answers with what already took effect,
 * the step that failed with its error, and how many steps did not run.
 */
class Steps {
  private failure: { label: string; error: unknown } | null = null
  constructor(private readonly done: string[]) {}
  async run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try { return await fn() } catch (e) { this.failure = { label, error: e }; return null }
  }
  failed(notRun = 0): CallToolResult {
    const lines = this.done.length ? ['done before the failure:', ...this.done.map(l => '  ' + l)] : ['nothing took effect']
    lines.push(`failed: ${this.failure?.label ?? '?'} — ${errorText(this.failure?.error)}`)
    if (notRun > 0) lines.push(`not run: ${notRun} remaining step${notRun > 1 ? 's' : ''}`)
    return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] }
  }
}
function fail(e: unknown): CallToolResult { return { isError: true, content: [{ type: 'text', text: `error ${errorText(e)}` }] } }

export interface ToolContext { client: ApiClient; library: () => Promise<string>; baseUrl: string; fetch: typeof fetch; actor: string }

export function createToolContext(opts: McpOptions): ToolContext {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const actor = agentActor(opts.actor)
  const client = createApiClient({ baseUrl: opts.baseUrl, actor, fetch: f })
  let lib: Promise<string> | null = null
  return {
    client, baseUrl: opts.baseUrl, fetch: f, actor,
    library: () => {
      lib ??= resolveLibrary(client, opts.library).catch(e => { lib = null; throw e })
      return lib
    }
  }
}

/** Build the MCP server with all ten tools; connect it to any transport. */
export function createMcpServer(opts: McpOptions): McpServer {
  const ctx = createToolContext(opts)
  const { client } = ctx
  const server = new McpServer({ name: 'bowerbird', version: '0.1.0' }, {
    instructions: 'Bowerbird game asset library. Search (bb_search) and look (bb_get) before registering; check bb_vocabulary for existing tags before inventing new ones. Every result shows stage (reference/production/runtime) and review (pending/approved/rejected/exempt). Deleting is not available to agents.'
  })

  const run = (fn: () => Promise<CallToolResult>) => fn().catch(fail)

  server.registerTool('bb_search', {
    title: 'Search assets',
    description: 'Search the asset library. `query` accepts the text syntax, e.g. "stage:runtime format:model tag:宝箱 -tag:废弃 tris:<5000 folder:props/ review:approved is:issue 红色宝箱". `filter` takes the structured filter (merged over the parsed one). Each line: id path format stage review [issues] [flags] [tags] [badge].',
    inputSchema: {
      query: z.string().optional(),
      filter: Filter.optional(),
      sort: z.enum(SORT_KEYS).optional(),
      limit: z.number().int().min(1).max(200).optional().describe('default 20'),
      cursor: z.string().optional()
    }
  }, args => run(async () => {
    const lib = await ctx.library()
    const parsed = args.query ? parseQueryText(args.query) : { q: '', filter: {} }
    const filter = { ...parsed.filter, ...(args.filter ?? {}) }
    const res = await client.search(lib, {
      ...(parsed.q ? { q: parsed.q } : {}),
      ...(Object.keys(filter).length ? { filter } : {}),
      ...(args.sort ? { sort: args.sort } : {}),
      limit: args.limit ?? 20,
      ...(args.cursor ? { cursor: args.cursor } : {})
    })
    return text(searchText(res))
  }))

  server.registerTool('bb_get', {
    title: 'Asset details',
    description: 'Details of one asset (GUID or library path): tech info, relations both ways, issues, production record, and the agent summary. Set `image: true` to also get the overview image (thumbnail / contact sheet / waveform) when it has been rendered.',
    inputSchema: { id: z.string().describe('GUID or library-relative path'), image: z.boolean().optional() }
  }, args => run(async () => {
    const lib = await ctx.library()
    const id = await resolveAssetId(client, lib, args.id)
    const [detail, summary] = await Promise.all([client.assets.get(lib, id), client.assets.summary(lib, id).catch(() => null)])
    let img: { data: string; mimeType: string } | null = null
    if (args.image && summary?.image) img = await fetchImage(ctx, summary.image)
    // exactly one sentence about the overview image
    const note = overviewNote(summary, !!(args.image && summary?.image && !img))
    const content: CallToolResult['content'] = [{ type: 'text', text: `${detailText(detail, summary)}\n${note}` }]
    if (img) content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
    return { content }
  }))

  server.registerTool('bb_trace', {
    title: 'Trace lineage',
    description: 'Walk relations from an asset: up = where it came from, down = what was made from it. Source edges carry their production record (method, tool, prompt, actor).',
    inputSchema: {
      id: z.string(),
      direction: z.enum(['up', 'down', 'both']).optional().describe('default up'),
      types: z.array(z.string()).optional().describe('relation types, default ["source"]'),
      depth: z.number().int().min(1).max(50).optional().describe('default 5')
    }
  }, args => run(async () => {
    const lib = await ctx.library()
    const id = await resolveAssetId(client, lib, args.id)
    const l = await client.assets.lineage(lib, id, { direction: args.direction, types: args.types, depth: args.depth })
    return text(lineageText(l))
  }))

  server.registerTool('bb_register', {
    title: 'Register assets',
    description: 'Register new assets in one step: upload local files (or name a file already in the library with `path`), set stage/tags/description, add relations (source/uses/belongs), attach a production record (method, tool, prompt, params, inputs with roles), and the turnaround grid (`views`). Several files share one production record. Files already inside the library folder on the server machine are registered in place. Same name in the target folder → error unless `onConflict` is replace | keep-both | skip. The answer lists tags new to the library with similar existing ones.',
    inputSchema: {
      files: z.array(z.string()).optional().describe('local file paths to upload'),
      path: z.string().optional().describe('library-relative path of a file already in the library'),
      folder: z.string().optional().describe('target folder, library-relative ("" = root)'),
      name: z.string().optional().describe('file name to write (single file)'),
      stage: z.enum(STAGES).optional(),
      tags: z.array(z.string()).optional(),
      description: z.string().optional(),
      review: z.enum(['pending', 'exempt']).optional(),
      relations: z.array(RelationInputZ).optional(),
      record: z.union([RecordZ, z.string()]).optional().describe('production record, or an existing record id'),
      views: ViewsZ.optional(),
      onConflict: z.enum(ON_CONFLICT).optional()
    }
  }, args => run(async () => {
    const lib = await ctx.library()
    const files = args.files ?? []
    if (!files.length && !args.path) throw new BowerbirdApiError(400, 'validation_failed', 'give `files` (local paths) or `path` (a file already in the library)')
    const base = {
      ...(args.stage ? { stage: args.stage } : {}), ...(args.tags ? { tags: args.tags } : {}),
      ...(args.description ? { description: args.description } : {}), ...(args.review ? { review: args.review } : {}),
      ...(args.relations ? { relations: args.relations } : {}), ...(args.views ? { views: args.views } : {}),
      ...(args.onConflict ? { onConflict: args.onConflict } : {})
    }
    let record = args.record
    const count = files.length + (args.path ? 1 : 0)
    const out: string[] = []
    const steps = new Steps(out)
    if (record && typeof record === 'object' && count > 1) {
      const rec = record
      const created = await steps.run('create production record', () => client.records.create(lib, rec))
      if (!created) return steps.failed()
      record = created.id
      out.push(`record ${created.id}`)
    }
    const withRecord = record ? { ...base, record } : base
    if (args.path) {
      const p = args.path
      const res = await steps.run(`register ${p}`, () => client.assets.register(lib, { ...withRecord, path: p }))
      if (!res) return steps.failed(count - 1)
      out.push(registerText(res, p))
    }
    let access: Awaited<ReturnType<typeof localAccess>> | null = null
    for (const [i, file] of files.entries()) {
      const res = await steps.run(`register ${file}`, async (): Promise<RegisterResponse> => {
        access ??= await localAccess(client, lib)
        const abs = path.resolve(file)
        const inLib = access.local ? relativeToRoot(access.info.root, abs) : null
        if (inLib) return client.assets.register(lib, { ...withRecord, path: inLib })
        return client.assets.register(lib, { ...withRecord, ...(args.folder !== undefined ? { folder: args.folder } : {}), ...(args.name && files.length === 1 ? { name: args.name } : {}) }, await fileForUpload(abs))
      })
      if (!res) return steps.failed(files.length - i - 1)
      out.push(registerText(res, file))
    }
    return text(out.join('\n'))
  }))

  server.registerTool('bb_update', {
    title: 'Update an asset',
    description: 'Change tags (add/remove/set), description or stage; add, replace or remove relations. `retarget` moves every relation pointing at `from` to `to` (all assets): it previews by default and only applies with `apply: true`. Deleting is not possible here.',
    inputSchema: {
      id: z.string().optional().describe('GUID or library path (not needed for retarget alone)'),
      tags: z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional(), set: z.array(z.string()).optional() }).optional(),
      description: z.string().optional(),
      stage: z.enum(STAGES).optional(),
      relations: z.object({
        add: z.array(RelationInputZ).optional(),
        remove: z.array(RelationRefZ).optional(),
        replace: z.array(RelationRefZ.extend({ newTo: z.string() })).optional().describe('swap the other end of one relation')
      }).optional(),
      retarget: z.object({ from: z.string(), to: z.string(), types: z.array(z.string()).optional(), apply: z.boolean().optional() }).optional()
    }
  }, args => run(async () => {
    const lib = await ctx.library()
    const out: string[] = []
    const steps = new Steps(out)
    const needsId = args.tags || args.description !== undefined || args.stage || args.relations
    // Planned steps in order; on a failure the answer lists what took effect and what did not run.
    const plan: Array<{ label: string; run: (id: string) => Promise<string[]> }> = []
    if (args.tags || args.description !== undefined || args.stage) {
      const patch = { ...(args.tags ? { tags: args.tags } : {}), ...(args.description !== undefined ? { description: args.description } : {}), ...(args.stage ? { stage: args.stage } : {}) }
      plan.push({ label: `patch ${Object.keys(patch).join(', ')}`, run: async id => { const r = await client.assets.patch(lib, id, patch); return [`patched ${Object.keys(patch).join(', ')} → ${summaryLine(r.asset)}`, ...newTagsText(r.newTags)] } })
    }
    for (const rel of args.relations?.add ?? []) plan.push({ label: `add ${rel.type} → ${rel.to}`, run: async id => { await client.relations.add(lib, id, rel); return [`added ${rel.type}${rel.slot ? `(${rel.slot})` : ''} → ${rel.to}`] } })
    for (const rel of args.relations?.replace ?? []) plan.push({ label: `replace ${rel.type} ${rel.to} → ${rel.newTo}`, run: async id => { await client.relations.replace(lib, id, rel); return [`replaced ${rel.type} ${rel.to} → ${rel.newTo}`] } })
    for (const rel of args.relations?.remove ?? []) plan.push({ label: `remove ${rel.type} → ${rel.to}`, run: async id => { await client.relations.remove(lib, id, rel); return [`removed ${rel.type} → ${rel.to}`] } })
    if (needsId) {
      if (!args.id) throw new BowerbirdApiError(400, 'validation_failed', '`id` is required for tag, description, stage and relation changes')
      const ref = args.id
      const id = await steps.run(`find ${ref}`, () => resolveAssetId(client, lib, ref))
      if (!id) return steps.failed(plan.length + (args.retarget ? 1 : 0))
      out.push(`asset ${id}`)
      for (const [i, step] of plan.entries()) {
        const lines = await steps.run(step.label, () => step.run(id))
        if (!lines) return steps.failed(plan.length - i - 1 + (args.retarget ? 1 : 0))
        out.push(...lines)
      }
    }
    if (args.retarget) {
      const rt = args.retarget
      const apply = !!rt.apply
      const r = await steps.run(apply ? 'retarget' : 'retarget preview', () => client.relations.retarget(lib, { from: rt.from, to: rt.to, types: rt.types, dryRun: !apply }))
      if (!r) return steps.failed()
      out.push(`${r.applied ? 'retargeted' : 'preview (not applied; call again with apply: true)'}: ${r.affected.length} relations`)
      for (const a of r.affected) out.push(`  ${a.assetId} ${a.assetName} ${a.type}${a.slot ? `(${a.slot})` : ''}`)
    }
    if (!out.length) out.push('nothing to change')
    return text(out.join('\n'))
  }))

  server.registerTool('bb_fetch', {
    title: 'Get asset files',
    description: 'Get an asset\'s file. On the server\'s machine this returns the local path (library root + path); otherwise a download URL. With `to`, copies the asset (and with `withDeps`, its dependencies such as textures, written under the names the model file uses) into that directory.',
    inputSchema: {
      id: z.string(),
      withDeps: z.boolean().optional(),
      to: z.string().optional().describe('directory to export into'),
      layout: z.enum(['keep', 'flat']).optional().describe('keep folder structure (default) or flat')
    }
  }, args => run(async () => {
    const lib = await ctx.library()
    const id = await resolveAssetId(client, lib, args.id)
    const access = await localAccess(client, lib)
    const req = { ids: [id], withDeps: !!args.withDeps, layout: args.layout ?? 'keep' as const }
    if (args.to) {
      const dir = path.resolve(args.to)
      if (access.local) {
        const res = await (await client.exports.run(lib, { ...req, dir })).json() as { written: number; dir: string; bytes: number }
        return text(`exported ${res.written} files (${res.bytes} bytes) to ${res.dir}`)
      }
      const r = await downloadExport(client, lib, req, dir)
      return text(`downloaded ${r.written} files (${r.bytes} bytes) to ${dir}\n${exportPlanText(r.plan)}`)
    }
    const asset = await client.assets.get(lib, id)
    const lines: string[] = []
    const where = (a: Pick<AssetDetail, 'id' | 'path'>) => {
      const p = localPathOf(access.info, a)
      return access.local && fs.existsSync(p) ? p : new URL(client.assets.fileUrl(lib, a.id, true), ctx.baseUrl).href
    }
    lines.push(`${access.local ? 'path' : 'url'}: ${where(asset)}`)
    if (args.withDeps) {
      const plan = await client.exports.plan(lib, req)
      const deps = plan.files.filter(f => f.dependency)
      const ids = [...new Set(deps.map(d => d.assetId))]
      const found = ids.length ? (await client.search(lib, { filter: { ids, includeAuxiliary: true, review: [...ALL_REVIEW] }, limit: Math.min(1000, ids.length) })).items : []
      const byId = new Map(found.map(s => [s.id, s]))
      for (const f of deps) {
        const s = byId.get(f.assetId)
        lines.push(`dep ${f.path} ← ${f.assetId}: ${s ? where(s) : new URL(client.assets.fileUrl(lib, f.assetId, true), ctx.baseUrl).href}`)
      }
      if (deps.some(f => f.fromFile)) lines.push('note: some dependencies are stored under other names; use `to` to write them under the names the model file expects')
    }
    return text(lines.join('\n'))
  }))

  server.registerTool('bb_creators', {
    title: 'List creators',
    description: 'Creation methods offered by enabled creator plugins: id, name, parameter form fields and accepted input assets with roles.',
    inputSchema: {}
  }, () => run(async () => {
    const lib = await ctx.library()
    return text(creatorsText((await client.creators.list(lib)).creators))
  }))

  server.registerTool('bb_create', {
    title: 'Run a creator',
    description: 'Start a creation run (`creator`, `params`, `inputs` with roles), or check a running one with `job`. Outputs are registered as assets by the kernel; the job lists them when done.',
    inputSchema: {
      creator: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      inputs: z.array(z.object({ role: z.string(), id: z.string() })).optional(),
      folder: z.string().optional(),
      job: z.string().optional().describe('job id to check instead of starting')
    }
  }, args => run(async () => {
    const lib = await ctx.library()
    if (args.job) return text(jobText(await client.jobs.get(lib, args.job)))
    if (!args.creator) throw new BowerbirdApiError(400, 'validation_failed', 'give `creator` to start a run, or `job` to check one')
    const inputs = await Promise.all((args.inputs ?? []).map(async i => ({ role: i.role, id: await resolveAssetId(client, lib, i.id) })))
    const job = await client.creators.run(lib, args.creator, { params: args.params ?? {}, inputs, ...(args.folder !== undefined ? { folder: args.folder } : {}) })
    return text(`${jobText(job)}\ncheck progress with bb_create { job: "${job.id}" }`)
  }))

  server.registerTool('bb_vocabulary', {
    title: 'Vocabulary',
    description: 'Stages, review states, formats, relation types, tags with usage counts, production methods and design objects. Look here before inventing a new tag.',
    inputSchema: {}
  }, () => run(async () => text(vocabularyText(await client.libraries.vocabulary(await ctx.library())))))

  server.registerTool('bb_health', {
    title: 'Integrity issues',
    description: 'Integrity issues: broken references, missing files, duplicate ids, stale upstream, failed processing, missing plugins.',
    inputSchema: {
      type: z.array(z.enum(ISSUE_TYPES)).optional(),
      level: z.array(z.enum(ISSUE_LEVELS)).optional(),
      id: z.string().optional().describe('only issues of this asset (GUID or path)')
    }
  }, args => run(async () => {
    const lib = await ctx.library()
    const assetId = args.id ? await resolveAssetId(client, lib, args.id) : undefined
    return text(issuesText(await client.issues.list(lib, { type: args.type, level: args.level, assetId })))
  }))

  return server
}

async function fetchImage(ctx: ToolContext, url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const abs = new URL(url, ctx.baseUrl).href
    const res = await ctx.fetch(abs, { headers: { 'x-bowerbird-actor': ctx.actor } })
    if (!res.ok) return null
    const mimeType = (res.headers.get('content-type') ?? 'image/png').split(';')[0]!.trim()
    if (!mimeType.startsWith('image/')) return null
    return { data: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType }
  } catch { return null }
}
