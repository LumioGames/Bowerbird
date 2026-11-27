/**
 * Every capability the command line and the MCP server offer, defined once (ADR-071): name, parameters, the text it
 * answers with. `bb <name>` and the MCP tool `bb_<name>` are both generated from this table, so the two never
 * differ in what they can do, what they take or what they say. Writes of information are wanted states (ADR-068).
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  BowerbirdApiError, Filter, ISSUE_LEVELS, ISSUE_TYPES, ON_CONFLICT, SORT_KEYS, STAGES, VIEW_NAMES, WHEN_VALUES, parseQueryText,
  type ApiClient, type ApplyItem, type ApplyResponse, type AssetDetail, type LibraryInfo, type ProvenanceInput, type RegisterResponse, type RelationInput
} from '@bowerbird/schema'
import {
  actionsText, applyText, creatorsText, detailText, exportPlanText, issuesText, jobText, lineageText, newTagsText, overviewNote,
  registerText, searchText, summaryLine, vocabularyText
} from './format.js'
import { ALL_REVIEW, downloadExport, errorText, fileForUpload, isFilesystemRef, localPathOf, relativeToRoot, resolveAssetId } from './resolve.js'

/* ───────────── the table's own types ───────────── */

export type ArgKind = 'string' | 'strings' | 'number' | 'boolean' | 'json' | 'enum'

export interface ArgSpec {
  /** Key in the arguments object (camelCase); the command line spells it kebab-case (`onConflict` → `--on-conflict`). */
  name: string
  kind: ArgKind
  description: string
  /** Command line only: given without a flag, one value or the rest of them. */
  positional?: 'one' | 'many'
  required?: boolean
  choices?: readonly string[]
  /** Flag name on the command line when it reads better than the key (`tags` → `--tag`). */
  flag?: string
  /** Validation of a JSON value (MCP input schema; command line parses JSON first). */
  schema?: z.ZodTypeAny
  /** Offered on one side only (e.g. reading a manifest file is a command-line convenience). */
  only?: 'cli' | 'mcp'
}

export interface CapContext {
  client: ApiClient
  /** Library id (the given one, the server's default, or the only one). */
  library(): Promise<string>
  baseUrl: string
  fetch: typeof fetch
  /** `X-Bowerbird-Actor` value (encoded) and the actor as written (decoded), if one was given. */
  actorHeader: string | undefined
  actor: string | undefined
  /** Where relative local paths start. */
  cwd: string
  surface: 'cli' | 'mcp'
}

export interface CapResult {
  text: string
  /** What `--json` prints. */
  data: unknown
  images?: Array<{ data: string; mimeType: string }>
  /** Something did not work although the call itself went through (exit code 1, MCP isError). */
  failed?: boolean
}

export interface Capability {
  name: string
  title: string
  summary: string
  args: ArgSpec[]
  /** Offered as an MCP tool (default true). Agents get no tool that removes things (ADR-009). */
  mcp?: boolean
  /** Command line: unknown `-x` tokens are part of a positional value (search: `-tag:废弃`). */
  allowUnknownOptions?: boolean
  run(ctx: CapContext, args: Record<string, unknown>): Promise<CapResult>
}

/* ───────────── helpers ───────────── */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown): boolean => v === true

async function access(ctx: CapContext, lib: string): Promise<{ info: LibraryInfo; local: boolean }> {
  const info = await ctx.client.libraries.get(lib)
  return { info, local: info.isLocal && fs.existsSync(info.root) }
}

const ref = (ctx: CapContext, lib: string, r: string) => resolveAssetId(ctx.client, lib, r, ctx.cwd)
const absLocal = (ctx: CapContext, p: string) => path.resolve(ctx.cwd, p.replace(/^~(?=$|[\\/])/, process.env.HOME ?? '~'))

/** `k=v` pairs → an object; values that read as JSON (numbers, true/false, quoted strings, arrays) are taken as such. */
export function keyValues(list: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const kv of list) {
    const i = kv.indexOf('=')
    if (i <= 0) throw new BowerbirdApiError(400, 'validation_failed', `参数要写成 名=值：${kv}`)
    const v = kv.slice(i + 1)
    let val: unknown = v
    try { val = JSON.parse(v) } catch { /* plain text */ }
    out[kv.slice(0, i)] = val
  }
  return out
}

const RelationZ = z.object({
  type: z.string().describe('source（照着做） | reference（参考，对方变了不提醒） | uses | belongs，或插件的关系类型'),
  to: z.string().describe('对方：GUID 或资产库内的路径'),
  slot: z.string().optional().describe('文件里写的位置名，例如贴图文件名'),
  role: z.string().optional().describe('对方在制作中的角色，例如 参考图、蒙版、四视图（source / reference）'),
  note: z.string().optional()
})
const ProvenanceZ = z.object({
  method: z.string().describe('ai-generate | manual | slice | render | export | convert | copy | other | <插件标识>/<名字>'),
  tool: z.string().optional(),
  prompt: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional().describe('约定的键：model、seed、negativePrompt；切图写 rect: [x, y, w, h]'),
  batch: z.string().optional().describe('同一批产出共用的批次号'),
  note: z.string().optional()
})
const ApplyItemZ = z.object({
  id: z.string().optional().describe('GUID，或者用 path'),
  path: z.string().optional().describe('资产库内的路径（或这台电脑上资产库里的文件路径）'),
  stage: z.enum(STAGES).optional(),
  tags: z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() }).optional().describe('有哪些标签、没有哪些标签'),
  description: z.string().nullable().optional(),
  review: z.enum(['pending', 'exempt']).optional(),
  provenance: ProvenanceZ.nullable().optional().describe('怎么做出来的；null 清除'),
  relations: z.object({ add: z.array(RelationZ).optional(), remove: z.array(z.object({ type: z.string(), to: z.string(), slot: z.string().optional() })).optional() }).optional(),
  views: z.object({ rows: z.number().int().min(1).max(8), cols: z.number().int().min(1).max(8), cells: z.array(z.enum(VIEW_NAMES).nullable()) }).nullable().optional(),
  fields: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()).optional(),
  auxiliary: z.boolean().optional()
})

/** Command-line spellings in a manifest: `to` may be a path, `path` may be a local file inside the library. */
async function normalizeItems(ctx: CapContext, lib: string, raw: unknown[]): Promise<{ items: ApplyItem[]; errors: Map<number, string> }> {
  let acc: { info: LibraryInfo; local: boolean } | null = null
  const items: ApplyItem[] = []
  const errors = new Map<number, string>()
  const resolveTo = async (to: string) => ref(ctx, lib, to)
  for (const [i, r] of raw.entries()) {
    try {
      const parsed = ApplyItemZ.safeParse(r)
      if (!parsed.success) throw new BowerbirdApiError(400, 'validation_failed', `第 ${i + 1} 项不合法：${parsed.error.issues.map(x => `${x.path.join('.')} ${x.message}`).join('；')}`)
      const it = parsed.data as ApplyItem & { id?: string }
      const out: ApplyItem = { ...it }
      if (it.id && !/^[0-9a-f]{8}-/.test(it.id)) { out.id = await resolveTo(it.id) }
      if (it.path && isFilesystemRef(it.path)) {
        acc ??= await access(ctx, lib)
        const rel = relativeToRoot(acc.info.root, absLocal(ctx, it.path))
        if (rel === null) throw new BowerbirdApiError(404, 'not_found', `${it.path} 不在资产库「${acc.info.name}」里`)
        out.path = rel
      }
      if (it.relations) {
        out.relations = {
          ...(it.relations.add ? { add: await Promise.all(it.relations.add.map(async x => ({ ...x, to: await resolveTo(x.to) }))) } : {}),
          ...(it.relations.remove ? { remove: await Promise.all(it.relations.remove.map(async x => ({ ...x, to: await resolveTo(x.to) }))) } : {})
        }
      }
      items.push(out)
    } catch (e) {
      errors.set(i, errorText(e))
      items.push({ id: '00000000-0000-7000-8000-000000000000', fields: {} }) // placeholder, answered with the error
    }
  }
  return { items, errors }
}

/** Send items in slices the server takes in one request; answers come back in the items' order. */
async function applyAll(ctx: CapContext, lib: string, items: ApplyItem[], errors: Map<number, string>, dryRun: boolean): Promise<ApplyResponse> {
  const results: ApplyResponse['results'] = []
  const newTags: ApplyResponse['newTags'] = []
  const todo = items.map((it, index) => ({ it, index })).filter(x => !errors.has(x.index))
  for (let i = 0; i < todo.length; i += 1000) {
    const slice = todo.slice(i, i + 1000)
    const r = await ctx.client.assets.apply(lib, { items: slice.map(x => x.it), ...(dryRun ? { dryRun: true } : {}) })
    for (const x of r.results) results.push({ ...x, index: slice[x.index]!.index })
    for (const t of r.newTags) if (!newTags.some(n => n.tag === t.tag)) newTags.push(t)
  }
  for (const [index, message] of errors) results.push({ index, id: null, path: null, changed: false, changes: [], error: { code: 'validation_failed', message } })
  results.sort((a, b) => a.index - b.index)
  return { results, dryRun, newTags }
}

function readManifest(ctx: CapContext, file: string): unknown[] {
  const text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(absLocal(ctx, file), 'utf8')
  const t = text.trim()
  if (!t) return []
  if (t.startsWith('[')) return JSON.parse(t) as unknown[]
  return t.split(/\r?\n/).map((l, i) => {
    const s = l.trim()
    if (!s) return null
    try { return JSON.parse(s) } catch { throw new BowerbirdApiError(400, 'validation_failed', `清单第 ${i + 1} 行不是 JSON：${clip(s)}`) }
  }).filter(x => x !== null)
}
const clip = (s: string) => (s.length > 60 ? s.slice(0, 59) + '…' : s)

async function fetchImage(ctx: CapContext, url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await ctx.fetch(new URL(url, ctx.baseUrl).href, { headers: ctx.actorHeader ? { 'x-bowerbird-actor': ctx.actorHeader } : {} })
    if (!res.ok) return null
    const mimeType = (res.headers.get('content-type') ?? 'image/png').split(';')[0]!.trim()
    if (!mimeType.startsWith('image/')) return null
    return { data: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType }
  } catch { return null }
}

/**
 * Batch id of one multi-file `add` (ADR-074): worked out of what was said — the files and the provenance — so the same
 * command run again names the same batch and writes nothing new (ADR-068).
 */
function batchOf(files: string[], provenance: ProvenanceInput): string {
  const h = createHash('sha256').update(JSON.stringify([[...files].map(f => path.basename(f)).sort(), provenance.method, provenance.tool ?? '', provenance.prompt ?? '', provenance.params ?? {}])).digest('hex')
  return `bat_${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/* ───────────── the capabilities ───────────── */

export const CAPABILITIES: Capability[] = [
  {
    name: 'search', title: '搜索',
    summary: '搜索资产。查询支持文本语法，例如 stage:runtime format:model tag:宝箱 -tag:废弃 tris:<5000 folder:props/ review:approved is:issue editor:agent:me batch:<批次号> 红色宝箱',
    allowUnknownOptions: true,
    args: [
      { name: 'query', kind: 'strings', positional: 'many', description: '查询（文本语法）' },
      { name: 'filter', kind: 'json', schema: Filter, description: '结构化筛选（JSON），盖过文本里的同名条件' },
      { name: 'sort', kind: 'enum', choices: SORT_KEYS, description: '排序' },
      { name: 'limit', kind: 'number', description: '返回条数（默认 50）' },
      { name: 'cursor', kind: 'string', description: '下一页游标' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const parsed = parseQueryText(strs(a.query).join(' '))
      const filter = { ...parsed.filter, ...((a.filter as object | undefined) ?? {}) }
      const res = await ctx.client.search(lib, {
        ...(parsed.q ? { q: parsed.q } : {}), ...(Object.keys(filter).length ? { filter } : {}),
        ...(str(a.sort) ? { sort: a.sort as never } : {}), limit: num(a.limit) ?? 50, ...(str(a.cursor) ? { cursor: str(a.cursor) } : {})
      })
      return { text: searchText(res), data: res }
    }
  },
  {
    name: 'get', title: '详情',
    summary: '一个资产的详情：技术信息、出处、两个方向的关系、问题、Agent 摘要。image 为真时附上概览图（MCP）',
    args: [
      { name: 'ref', kind: 'string', positional: 'one', required: true, description: 'GUID 或路径' },
      { name: 'image', kind: 'boolean', description: '附上概览图（只有 MCP 能显示）' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const id = await ref(ctx, lib, String(a.ref))
      const [asset, summary] = await Promise.all([ctx.client.assets.get(lib, id), ctx.client.assets.summary(lib, id).catch(() => null)])
      const img = bool(a.image) && summary?.image ? await fetchImage(ctx, summary.image) : null
      const note = overviewNote(summary, !!(bool(a.image) && summary?.image && !img))
      return { text: `${detailText(asset, summary)}\n${note}`, data: { asset, summary }, ...(img ? { images: [img] } : {}) }
    }
  },
  {
    name: 'trace', title: '追溯',
    summary: '沿关系追溯：up 看它从哪来，down 看用它做了什么。默认走来源与参考两种关系，每个资产带它的出处',
    args: [
      { name: 'ref', kind: 'string', positional: 'one', required: true, description: 'GUID 或路径' },
      { name: 'direction', kind: 'enum', choices: ['up', 'down', 'both'], description: '方向（默认 up）' },
      { name: 'types', kind: 'strings', description: '关系类型，可重复或用逗号分隔（默认 source,reference）' },
      { name: 'depth', kind: 'number', description: '最大层数（默认 5）' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const id = await ref(ctx, lib, String(a.ref))
      const types = strs(a.types)
      const res = await ctx.client.assets.lineage(lib, id, { ...(str(a.direction) ? { direction: a.direction as never } : {}), ...(types.length ? { types } : {}), ...(num(a.depth) ? { depth: num(a.depth) } : {}) })
      return { text: lineageText(res), data: res }
    }
  },
  {
    name: 'add', title: '登记',
    summary: '登记文件：资产库外的文件上传进来，资产库里已有的文件就地登记；可同时说出阶段、标签、描述、来源与参考、出处。同一次登记的多个文件共用一个批次号。已登记过的文件再登记一次，只写有差别的部分',
    args: [
      { name: 'files', kind: 'strings', positional: 'many', required: true, description: '这台电脑上的文件路径' },
      { name: 'folder', kind: 'string', description: '上传到的文件夹（资产库内的相对路径）' },
      { name: 'name', kind: 'string', description: '写入的文件名（只登记一个文件时）' },
      { name: 'stage', kind: 'enum', choices: STAGES, description: '物料阶段' },
      { name: 'tags', kind: 'strings', flag: 'tag', description: '标签，可重复或用逗号分隔' },
      { name: 'description', kind: 'string', description: '描述' },
      { name: 'review', kind: 'enum', choices: ['pending', 'exempt'], description: 'exempt = 免审' },
      { name: 'source', kind: 'strings', description: '照着它做出来的资产（GUID 或路径），可重复；它变了会提醒' },
      { name: 'reference', kind: 'strings', description: '只是参考过的资产（GUID 或路径），可重复；它变了不提醒' },
      { name: 'role', kind: 'string', description: '来源 / 参考在制作中的角色，例如 参考图、原型稿' },
      { name: 'relations', kind: 'json', schema: z.array(RelationZ), description: '更多关系（JSON 数组）' },
      { name: 'method', kind: 'string', description: '生产方式，例如 ai-generate、manual、slice（有提示词时默认 ai-generate）' },
      { name: 'tool', kind: 'string', description: '工具' },
      { name: 'prompt', kind: 'string', description: '提示词' },
      { name: 'param', kind: 'strings', description: '生产参数 名=值，可重复，例如 model=gpt-image-1 size=1024x1536' },
      { name: 'params', kind: 'json', schema: z.record(z.string(), z.unknown()), description: '生产参数（JSON 对象）' },
      { name: 'note', kind: 'string', description: '出处的备注' },
      { name: 'batch', kind: 'string', description: '批次号（默认：多个文件时自动生成一个）' },
      { name: 'views', kind: 'json', schema: ApplyItemZ.shape.views, description: '四视图的格子（JSON）' },
      { name: 'onConflict', kind: 'enum', choices: ON_CONFLICT, description: '上传时目标文件夹里已有同名文件：replace | keep-both | skip' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const files = strs(a.files)
      const role = str(a.role)
      const relations: RelationInput[] = []
      for (const s of strs(a.source)) relations.push({ type: 'source', to: await ref(ctx, lib, s), ...(role ? { role } : {}) })
      for (const s of strs(a.reference)) relations.push({ type: 'reference', to: await ref(ctx, lib, s), ...(role ? { role } : {}) })
      for (const r of (a.relations as Array<z.infer<typeof RelationZ>> | undefined) ?? []) relations.push({ ...r, to: await ref(ctx, lib, r.to) })
      const params = { ...((a.params as Record<string, unknown> | undefined) ?? {}), ...keyValues(strs(a.param)) }
      let provenance: ProvenanceInput | undefined
      if (str(a.method) || str(a.tool) || str(a.prompt) || Object.keys(params).length || str(a.note)) {
        provenance = {
          method: str(a.method) ?? (str(a.prompt) ? 'ai-generate' : 'manual'),
          ...(str(a.tool) ? { tool: str(a.tool) } : {}), ...(str(a.prompt) ? { prompt: str(a.prompt) } : {}),
          ...(Object.keys(params).length ? { params } : {}), ...(str(a.note) ? { note: str(a.note) } : {})
        }
        const batch = str(a.batch) ?? (files.length > 1 ? batchOf(files, provenance) : undefined)
        if (batch) provenance.batch = batch
      }
      const fields = {
        ...(str(a.stage) ? { stage: a.stage as never } : {}), ...(strs(a.tags).length ? { tags: strs(a.tags) } : {}),
        ...(str(a.description) ? { description: str(a.description) } : {}), ...(str(a.review) ? { review: a.review as never } : {}),
        ...(relations.length ? { relations } : {}), ...(provenance ? { provenance } : {}),
        ...(a.views ? { views: a.views as never } : {}), ...(str(a.onConflict) ? { onConflict: a.onConflict as never } : {})
      }
      const acc = await access(ctx, lib)
      const registered: Array<{ file: string; result: RegisterResponse }> = []
      let failed: { file: string; error: { code: string; message: string; details?: Record<string, unknown> }; notRun: string[] } | null = null
      for (const [i, file] of files.entries()) {
        try {
          const abs = absLocal(ctx, file)
          const inLib = acc.local ? relativeToRoot(acc.info.root, abs) : null
          const result = inLib
            ? await ctx.client.assets.register(lib, { ...fields, path: inLib })
            : await ctx.client.assets.register(lib, { ...fields, ...(typeof a.folder === 'string' ? { folder: a.folder } : {}), ...(str(a.name) && files.length === 1 ? { name: str(a.name) } : {}) }, await fileForUpload(abs))
          registered.push({ file, result })
        } catch (e) {
          // stop at the first failure and say what is already in the library
          const error = e instanceof BowerbirdApiError ? { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } : { code: 'internal', message: (e as Error)?.message ?? String(e) }
          failed = { file, error, notRun: files.slice(i + 1) }
          break
        }
      }
      const f = failed
      const text = [
        ...registered.map(r => registerText(r.result, r.file)),
        ...(provenance?.batch ? [`批次 ${provenance.batch}`] : []),
        ...(f ? [`没有登记 ${f.file}：${f.error.message}`, ...(f.notRun.length ? [`没有处理：${f.notRun.join('、')}`] : []), ...(registered.length ? [`已登记的 ${registered.length} 个留在资产库里`] : [])] : [])
      ].join('\n')
      return { text, data: { registered, failed: f, ...(provenance?.batch ? { batch: provenance.batch } : {}) }, failed: !!f }
    }
  },
  {
    name: 'apply', title: '按结果写入',
    summary: '说出资产应该有的信息（阶段、标签、描述、出处、来源与参考、四视图、自定义字段），只写有差别的部分；同样的清单重跑不会多写。dryRun 只比较不写入。命令行读一份 JSONL 清单（每行一项），也可以读 JSON 数组；- 表示标准输入',
    args: [
      { name: 'file', kind: 'string', positional: 'one', only: 'cli', description: 'JSONL / JSON 清单文件，- 表示标准输入' },
      { name: 'items', kind: 'json', schema: z.array(ApplyItemZ), description: '清单（JSON 数组），每项用 id 或 path 指明资产' },
      { name: 'dryRun', kind: 'boolean', description: '试运行：列出会改什么，不写入' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const raw = [...(str(a.file) ? readManifest(ctx, str(a.file)!) : []), ...((a.items as unknown[] | undefined) ?? [])]
      if (!raw.length) throw new BowerbirdApiError(400, 'validation_failed', '清单是空的：给出清单文件或 items')
      const { items, errors } = await normalizeItems(ctx, lib, raw)
      const res = await applyAll(ctx, lib, items, errors, bool(a.dryRun))
      return { text: applyText(res), data: res, failed: res.results.some(r => r.error) }
    }
  },
  {
    name: 'tag', title: '标签',
    summary: '给资产加上或去掉标签（只写有差别的部分）',
    args: [
      { name: 'refs', kind: 'strings', positional: 'many', required: true, description: 'GUID 或路径' },
      { name: 'add', kind: 'strings', description: '加上的标签，可重复或用逗号分隔' },
      { name: 'remove', kind: 'strings', description: '去掉的标签，可重复或用逗号分隔' }
    ],
    async run(ctx, a) {
      if (!strs(a.add).length && !strs(a.remove).length) throw new BowerbirdApiError(400, 'validation_failed', '用 --add 或 --remove 给出标签')
      const lib = await ctx.library()
      const items: ApplyItem[] = []
      for (const r of strs(a.refs)) items.push({ id: await ref(ctx, lib, r), tags: { ...(strs(a.add).length ? { add: strs(a.add) } : {}), ...(strs(a.remove).length ? { remove: strs(a.remove) } : {}) } })
      const res = await applyAll(ctx, lib, items, new Map(), false)
      return { text: applyText(res), data: res, failed: res.results.some(r => r.error) }
    }
  },
  {
    name: 'retarget', title: '更换关系的对方',
    summary: '把指向一个资产的关系全部换成指向另一个资产。默认只预览，apply 为真才执行',
    args: [
      { name: 'from', kind: 'string', required: true, description: '原来的对方（GUID 或路径）' },
      { name: 'to', kind: 'string', required: true, description: '新的对方（GUID 或路径）' },
      { name: 'types', kind: 'strings', description: '只换这些关系类型' },
      { name: 'apply', kind: 'boolean', description: '执行（默认只预览）' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const [from, to] = await Promise.all([ref(ctx, lib, String(a.from)), ref(ctx, lib, String(a.to))])
      const types = strs(a.types)
      const r = await ctx.client.relations.retarget(lib, { from, to, ...(types.length ? { types } : {}), dryRun: !bool(a.apply) })
      const lines = [`${r.applied ? '已更换' : '预览（没有执行；加上 apply 执行）'}：${r.affected.length} 条关系`]
      for (const x of r.affected) lines.push(`  ${x.assetId} ${x.assetName} ${x.type}${x.slot ? `(${x.slot})` : ''}`)
      return { text: lines.join('\n'), data: r }
    }
  },
  {
    name: 'export', title: '取出文件',
    summary: '资产的文件在哪：在服务所在的电脑上给本地路径，否则给下载地址。给出 to 时把资产（withDeps 时连同依赖，按文件里写的名字）复制到那个目录',
    args: [
      { name: 'refs', kind: 'strings', positional: 'many', required: true, description: 'GUID 或路径' },
      { name: 'to', kind: 'string', description: '复制到的目录' },
      { name: 'withDeps', kind: 'boolean', description: '连同依赖（例如模型的贴图）' },
      { name: 'flat', kind: 'boolean', description: '不保留文件夹结构' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const ids = await Promise.all(strs(a.refs).map(r => ref(ctx, lib, r)))
      const req = { ids, withDeps: bool(a.withDeps), layout: bool(a.flat) ? 'flat' as const : 'keep' as const }
      const acc = await access(ctx, lib)
      if (str(a.to)) {
        const dir = absLocal(ctx, str(a.to)!)
        if (acc.local) {
          const res = await (await ctx.client.exports.run(lib, { ...req, dir })).json() as { written: number; dir: string; bytes: number }
          return { text: `已导出 ${res.written} 个文件（${res.bytes} 字节）到 ${res.dir}`, data: res }
        }
        const r = await downloadExport(ctx.client, lib, req, dir)
        return { text: `已下载 ${r.written} 个文件（${r.bytes} 字节）到 ${dir}\n${exportPlanText(r.plan)}`, data: { written: r.written, dir, bytes: r.bytes, files: r.plan.files } }
      }
      const where = (x: Pick<AssetDetail, 'id' | 'path'>) => {
        const p = localPathOf(acc.info, x)
        return acc.local && fs.existsSync(p) ? p : new URL(ctx.client.assets.fileUrl(lib, x.id, true), ctx.baseUrl).href
      }
      const lines: string[] = []
      const out: Array<{ id: string; at: string; deps?: Array<{ path: string; assetId: string; at: string }> }> = []
      for (const id of ids) {
        const asset = await ctx.client.assets.get(lib, id)
        const entry: (typeof out)[number] = { id, at: where(asset) }
        lines.push(`${acc.local ? '路径' : '地址'}：${entry.at}`)
        if (req.withDeps) {
          const plan = await ctx.client.exports.plan(lib, { ...req, ids: [id] })
          const deps = plan.files.filter(f => f.dependency)
          const depIds = [...new Set(deps.map(d => d.assetId))]
          const found = depIds.length ? (await ctx.client.search(lib, { filter: { ids: depIds, includeAuxiliary: true, review: [...ALL_REVIEW] }, limit: Math.min(1000, depIds.length) })).items : []
          const byId = new Map(found.map(s => [s.id, s]))
          entry.deps = deps.map(f => ({ path: f.path, assetId: f.assetId, at: byId.get(f.assetId) ? where(byId.get(f.assetId)!) : new URL(ctx.client.assets.fileUrl(lib, f.assetId, true), ctx.baseUrl).href }))
          for (const d of entry.deps) lines.push(`  依赖 ${d.path} ← ${d.assetId}：${d.at}`)
          if (deps.some(f => f.fromFile)) lines.push('  提示：有的依赖存放的名字和文件里写的不同；用 to 导出时按文件里写的名字写出')
        }
        out.push(entry)
      }
      return { text: lines.join('\n'), data: out }
    }
  },
  {
    name: 'health', title: '完整性问题',
    summary: '列出完整性问题：断链、文件缺失、重复身份、上游已更新、处理失败、缺少插件等',
    args: [
      { name: 'type', kind: 'strings', choices: ISSUE_TYPES, description: `问题类型，可重复：${ISSUE_TYPES.join(' ')}` },
      { name: 'level', kind: 'strings', choices: ISSUE_LEVELS, description: `级别，可重复：${ISSUE_LEVELS.join(' ')}` },
      { name: 'ref', kind: 'string', description: '只看这个资产的问题（GUID 或路径）' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      for (const t of strs(a.type)) if (!(ISSUE_TYPES as readonly string[]).includes(t)) throw new BowerbirdApiError(400, 'validation_failed', `没有这种问题类型：${t}`)
      for (const t of strs(a.level)) if (!(ISSUE_LEVELS as readonly string[]).includes(t)) throw new BowerbirdApiError(400, 'validation_failed', `没有这个级别：${t}`)
      const assetId = str(a.ref) ? await ref(ctx, lib, str(a.ref)!) : undefined
      const res = await ctx.client.issues.list(lib, { ...(strs(a.type).length ? { type: strs(a.type) as never } : {}), ...(strs(a.level).length ? { level: strs(a.level) as never } : {}), ...(assetId ? { assetId } : {}) })
      return { text: issuesText(res), data: res }
    }
  },
  {
    name: 'resolve', title: '处理问题', mcp: false,
    summary: '对问题执行一种处理：按标识逐条，或对一类问题全部，例如 --type stale-upstream --action acknowledge 把「上游已更新」全部标为已复核',
    args: [
      { name: 'ids', kind: 'strings', positional: 'many', description: '问题标识（bb health 列出的）' },
      { name: 'type', kind: 'enum', choices: ISSUE_TYPES, description: '这一类的全部问题' },
      { name: 'action', kind: 'string', required: true, description: '处理方式，例如 acknowledge、ignore、remove-relation、confirm' },
      { name: 'params', kind: 'json', schema: z.record(z.string(), z.unknown()), description: '处理的参数（JSON）' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const ids = strs(a.ids)
      if (!ids.length && !str(a.type)) throw new BowerbirdApiError(400, 'validation_failed', '给出问题标识，或用 --type 指定一类问题')
      const r = await ctx.client.issues.resolveMany(lib, { action: String(a.action), ...(a.params ? { params: a.params as Record<string, unknown> } : {}), ...(ids.length ? { ids } : { type: a.type as never }) })
      const lines = [`已处理 ${r.resolved.length} 条${r.failed.length ? `，${r.failed.length} 条没有处理` : ''}`, ...r.failed.map(f => `  × ${f.id}：${f.message}`)]
      return { text: lines.join('\n'), data: r, failed: r.failed.length > 0 }
    }
  },
  {
    name: 'changes', title: '我这次改了什么',
    summary: '列出某个执行者最后修改过信息的资产，以及要提交的文件（资产文件与它的 .bmeta）。按最后修改者与时间查，没有元数据文件的资产不在其中',
    args: [
      { name: 'by', kind: 'string', description: '执行者，例如 agent:me；只写 agent 匹配所有 Agent（默认：当前的执行者）' },
      { name: 'since', kind: 'string', description: `从什么时候起：ISO 时间，或 ${WHEN_VALUES.join(' / ')}` },
      { name: 'folder', kind: 'string', description: '只看这个文件夹' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const by = str(a.by) ?? ctx.actor
      if (!by) throw new BowerbirdApiError(400, 'validation_failed', '用 --by 指定执行者（或设置 BOWERBIRD_ACTOR / --name）')
      const since = str(a.since)
      const modified = !since ? undefined : (WHEN_VALUES as readonly string[]).includes(since) ? parseQueryText(`when:${since}`).filter.modified : { after: since }
      const items: import('@bowerbird/schema').AssetSummary[] = []
      let cursor: string | null | undefined = null
      do {
        const res = await ctx.client.search(lib, { filter: { modifiedBy: by, includeAuxiliary: true, review: [...ALL_REVIEW], ...(modified ? { modified } : {}), ...(str(a.folder) ? { folder: str(a.folder) } : {}) }, sort: 'modified', limit: 1000, ...(cursor ? { cursor } : {}) })
        items.push(...res.items)
        cursor = res.items.length ? res.cursor : null
      } while (cursor && items.length < 10_000)
      const files = items.flatMap(s => [s.path, ...(s.metaPath ? [s.metaPath] : [])])
      const text = [`${by} 改过 ${items.length} 个资产${since ? `（${since} 起）` : ''}`, ...items.map(summaryLine), ...(files.length ? ['要提交的文件：', ...files.map(f => '  ' + f)] : [])].join('\n')
      return { text, data: { by, items, files } }
    }
  },
  {
    name: 'rescan', title: '扫描',
    summary: '扫描资产库（或其中一个文件夹），让外部的改动进来',
    args: [{ name: 'path', kind: 'string', positional: 'one', description: '只扫描这个文件夹（资产库内的相对路径）' }],
    async run(ctx, a) {
      const lib = await ctx.library()
      await ctx.client.libraries.rescan(lib, str(a.path) ? { path: str(a.path) } : {})
      return { text: `已开始扫描${str(a.path) ? ` ${str(a.path)}` : ''}`, data: { started: true, path: str(a.path) ?? null } }
    }
  },
  {
    name: 'rm', title: '移入回收站', mcp: false,
    summary: '把资产（文件和 .bmeta）移入回收站；被别的资产引用时需要 --force',
    args: [
      { name: 'refs', kind: 'strings', positional: 'many', required: true, description: 'GUID 或路径' },
      { name: 'force', kind: 'boolean', description: '被引用时也移入回收站' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const done: Array<{ id: string; trashId: string; referrers: string[] }> = []
      const failed: Array<{ ref: string; code: string; message: string; details?: Record<string, unknown> }> = []
      for (const r of strs(a.refs)) {
        try {
          const id = await ref(ctx, lib, r)
          done.push({ id, ...(await ctx.client.assets.remove(lib, id, bool(a.force))) })
        } catch (e) {
          if (!(e instanceof BowerbirdApiError)) throw e
          failed.push({ ref: r, code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) })
        }
      }
      const text = [
        ...done.map(d => `已移入回收站 ${d.id}${d.referrers.length ? `（仍被 ${d.referrers.length} 个资产引用）` : ''}`),
        ...failed.map(f => `没有删除 ${f.ref}：${f.message}${f.code === 'referenced' ? '（确认要删除请加 --force）' : ''}`)
      ].join('\n')
      return { text, data: { trashed: done, failed }, failed: failed.length > 0 }
    }
  },
  {
    name: 'untrack', title: '移出资产库', mcp: false,
    summary: '移出资产库、不动文件：资产的 .bmeta 移入回收站（可以恢复），文件留在原处，之后只是一个被看见的文件。不想再看见它，把它写进 .bbignore',
    args: [{ name: 'refs', kind: 'strings', positional: 'many', required: true, description: 'GUID 或路径' }],
    async run(ctx, a) {
      const lib = await ctx.library()
      const done: Array<{ id: string; trashId: string | null; referrers: string[] }> = []
      const failed: Array<{ ref: string; message: string }> = []
      for (const r of strs(a.refs)) {
        try {
          const id = await ref(ctx, lib, r)
          done.push({ id, ...(await ctx.client.assets.untrack(lib, id)) })
        } catch (e) { failed.push({ ref: r, message: errorText(e) }) }
      }
      const text = [
        ...done.map(d => `已移出 ${d.id}${d.trashId ? '，.bmeta 在回收站' : ''}${d.referrers.length ? `（${d.referrers.length} 个资产的关系现在指向不在的资产）` : ''}`),
        ...failed.map(f => `没有移出 ${f.ref}：${f.message}`)
      ].join('\n')
      return { text, data: { untracked: done, failed }, failed: failed.length > 0 }
    }
  },
  {
    name: 'create', title: '创建',
    summary: '用创建插件生成资产：不给创建方式时列出可用的；给出时发起一次运行；给出 job 时查看那次运行。产出由内核登记，同一次运行的产出共用一个批次号',
    args: [
      { name: 'creator', kind: 'string', positional: 'one', description: '创建方式标识（插件标识:方式）' },
      { name: 'param', kind: 'strings', description: '参数 名=值，可重复' },
      { name: 'params', kind: 'json', schema: z.record(z.string(), z.unknown()), description: '参数（JSON 对象）' },
      { name: 'input', kind: 'strings', description: '输入 角色=资产（GUID 或路径），可重复' },
      { name: 'folder', kind: 'string', description: '产出放到的文件夹' },
      { name: 'job', kind: 'string', description: '查看这次运行（任务标识）' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      if (str(a.job)) { const j = await ctx.client.jobs.get(lib, str(a.job)!); return { text: jobText(j), data: j } }
      if (!str(a.creator)) { const r = await ctx.client.creators.list(lib); return { text: creatorsText(r.creators), data: r.creators } }
      const inputs = await Promise.all(strs(a.input).map(async kv => {
        const i = kv.indexOf('=')
        if (i <= 0) throw new BowerbirdApiError(400, 'validation_failed', `输入要写成 角色=资产：${kv}`)
        return { role: kv.slice(0, i), id: await ref(ctx, lib, kv.slice(i + 1)) }
      }))
      const params = { ...((a.params as Record<string, unknown> | undefined) ?? {}), ...keyValues(strs(a.param)) }
      const job = await ctx.client.creators.run(lib, str(a.creator)!, { params, inputs, ...(typeof a.folder === 'string' ? { folder: a.folder } : {}) })
      return { text: `${jobText(job)}\n查看进度：create --job ${job.id}`, data: job }
    }
  },
  {
    name: 'action', title: '动作',
    summary: '插件对选中资产的动作：不给动作时列出这些资产能用的；给出时发起一次运行（产出由内核登记）',
    args: [
      { name: 'action', kind: 'string', positional: 'one', description: '动作标识（插件标识:动作）' },
      { name: 'refs', kind: 'strings', flag: 'on', required: true, description: '选中的资产（GUID 或路径），可重复' },
      { name: 'param', kind: 'strings', description: '参数 名=值，可重复' },
      { name: 'params', kind: 'json', schema: z.record(z.string(), z.unknown()), description: '参数（JSON 对象）' }
    ],
    async run(ctx, a) {
      const lib = await ctx.library()
      const ids = await Promise.all(strs(a.refs).map(r => ref(ctx, lib, r)))
      if (!str(a.action)) { const r = await ctx.client.actions.forSelection(lib, ids); return { text: actionsText(r.actions), data: r.actions } }
      const params = { ...((a.params as Record<string, unknown> | undefined) ?? {}), ...keyValues(strs(a.param)) }
      const job = await ctx.client.actions.run(lib, str(a.action)!, { ids, ...(Object.keys(params).length ? { params } : {}) })
      return { text: `${jobText(job)}\n查看进度：create --job ${job.id}`, data: job }
    }
  },
  {
    name: 'vocabulary', title: '词汇表',
    summary: '物料阶段、校验状态、格式、关系类型、带使用次数的标签、生产方式、设计对象。起新标签之前先看这里',
    args: [],
    async run(ctx) {
      const v = await ctx.client.libraries.vocabulary(await ctx.library())
      return { text: vocabularyText(v), data: v }
    }
  }
]

export function capability(name: string): Capability | undefined { return CAPABILITIES.find(c => c.name === name) }

/** MCP input schema of a capability (its arguments, minus the command-line-only ones). */
export function inputSchema(cap: Capability): Record<string, z.ZodTypeAny> {
  const out: Record<string, z.ZodTypeAny> = {}
  for (const a of cap.args) {
    if (a.only === 'cli') continue
    let t: z.ZodTypeAny
    switch (a.kind) {
      case 'string': t = z.string(); break
      case 'strings': t = a.choices ? z.array(z.enum(a.choices as [string, ...string[]])) : z.array(z.string()); break
      case 'number': t = z.number().int(); break
      case 'boolean': t = z.boolean(); break
      case 'enum': t = z.enum(a.choices as [string, ...string[]]); break
      case 'json': t = a.schema ?? z.unknown(); break
    }
    out[a.name] = (a.required ? t : t.optional()).describe(a.description)
  }
  return out
}


