/**
 * community.forge — the test-only creator plugin (replaces the prototype's plugin-demo.js).
 *
 * Two creation ways (ADR-016): 「AI 生图」 and 「生成模型」. A run reports progress, writes several candidates into
 * this plugin's temp dir (never the library), then stops at「{方式}完成，挑出要留下的」with a follow-up action that
 * opens the plugin page `pick` (ADR-042). `POST pick` registers the chosen ones through `job.register`; every output
 * carries the run's provenance (method `community.forge/<creator>`, params with model / seed / negativePrompt; the
 * kernel adds the run's batch id, ADR-070) and a source relation to each input with its role. What is not picked
 * stays in the temp dir.
 *
 * One action on a selection (plugin-system.md「动作」, right-click menu): 「生成变体（Forge）」on a single image makes a
 * recoloured copy next to it, registered with a source relation to the original (role「原图」) and the provenance
 * `community.forge/variant`. Its form has one parameter, how far the hue turns.
 *
 * The AI is fake and local. The machine-only setting `simulate` reproduces the two trouble states of the prototype:
 * `missing-tool` (「缺少外部工具 forge-cli」) and `unavailable` (「服务没有响应（503）」).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Action, AssetInfo, CreateRequest, Creator, JobContext, PluginContext, RegisterRequest, RouteRequest, RouteResponse } from '@bowerbird/plugin-sdk'
import { candidateGlb, candidatePng, modelPreviewPng, prng, tintedPng } from './draw.js'

export const PLUGIN_ID = 'community.forge'
export const PLUGIN_NAME = 'Forge'
export const TOOL = 'forge-cli'
export const QUOTA = 1000
const USED_AT_START = 312

export type Simulate = 'none' | 'missing-tool' | 'unavailable'
export type RunState = 'running' | 'pick' | 'done' | 'failed' | 'cancelled'

export interface Candidate { file: string; preview: string; name: string; mime: string }

export interface ForgeRun {
  job: string
  creator: 'image' | 'model'
  creatorName: string
  title: string
  state: RunState
  progress: number
  message: string
  params: Record<string, unknown>
  inputs: Array<{ role: string; id: string; name: string }>
  folder: string
  by: string
  startedAt: string
  candidates: Candidate[]
  registered: Array<{ id: string; name: string; path: string }>
  error?: string
  /** The simulated failures' codes (`ENOENT`, `E503`), so the web part can say them in the UI language. */
  errorCode?: string
}

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: Error): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
/** A run waiting in「挑选」: `choose` hands over the selection, `done` settles once the chosen ones are registered. */
interface Pending { choose(keep: number[]): void; done: Deferred<ForgeRun['registered']> }

export interface ForgeOptions {
  /** Delay between progress steps (prototype: 260 ms). Tests use 0. */
  stepMs?: number
  /** Clock for output names. */
  now?: () => number
}

/* ───────────── creation ways (prototype plugin-demo.js CREATORS) ───────────── */

export const IMAGE_PARAMS = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', title: '提示词', minLength: 1, 'x-widget': 'textarea' },
    negativePrompt: { type: 'string', title: '不想要的', default: '' },
    model: { type: 'string', title: '模型', enum: ['forge-xl 2.1', 'forge-lite 1.3'], default: 'forge-xl 2.1', 'x-widget': 'segmented' },
    count: { type: 'integer', title: '数量', enum: [1, 2, 4], default: 4, 'x-widget': 'segmented' },
    size: { type: 'string', title: '尺寸', enum: ['1024×1024', '1536×1536', '1920×1080'], default: '1536×1536', 'x-widget': 'segmented' },
    seed: { type: 'integer', title: '种子', minimum: 0, 'x-placeholder': '随机' }
  }
} as const

export const MODEL_PARAMS = {
  type: 'object',
  properties: {
    model: { type: 'string', title: '模型', enum: ['forge-3d 0.9'], default: 'forge-3d 0.9', 'x-widget': 'segmented' },
    maxTriangles: { type: 'integer', title: '面数上限', minimum: 100, default: 5000 },
    textureSize: { type: 'integer', title: '贴图', enum: [1024, 2048], default: 1024, 'x-widget': 'segmented' },
    count: { type: 'integer', title: '数量', enum: [1, 2], default: 2, 'x-widget': 'segmented' },
    seed: { type: 'integer', title: '种子', minimum: 0, 'x-placeholder': '随机' }
  }
} as const

export const VARIANT_PARAMS = {
  type: 'object',
  properties: {
    hue: { type: 'integer', title: '色相', enum: [90, 180, 270], default: 180, 'x-widget': 'segmented' }
  }
} as const

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(abortError())
  const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
  const onAbort = () => { clearTimeout(t); reject(abortError()) }
  signal.addEventListener('abort', onAbort, { once: true })
})
function abortError(): Error { const e = new Error('已取消'); e.name = 'AbortError'; return e }
function isAbort(e: unknown): boolean { return e instanceof Error && e.name === 'AbortError' }

function str(v: unknown, d = ''): string { return typeof v === 'string' ? v : d }
function int(v: unknown, d: number): number { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? Math.floor(n) : d }
function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i) }
function stemOf(name: string): string { const i = name.lastIndexOf('.'); return i <= 0 ? name : name.slice(0, i) }

/** The Forge plugin bound to one plugin context. Returned for tests; `activate` only needs the side effects. */
export function createForge(ctx: PluginContext, opts: ForgeOptions = {}) {
  const stepMs = opts.stepMs ?? Number(process.env.BB_FORGE_STEP_MS ?? 260)
  const now = opts.now ?? Date.now
  const runs = new Map<string, ForgeRun>()
  const pending = new Map<string, Pending>()
  const quotaFile = path.join(ctx.dataDir, 'quota.json')

  function quota(): { used: number; quota: number; month: string } {
    const month = new Date(now()).toISOString().slice(0, 7)
    try {
      const q = JSON.parse(fs.readFileSync(quotaFile, 'utf8')) as { used: number; month: string }
      if (q.month === month) return { used: q.used, quota: QUOTA, month }
    } catch { /* first use this month */ }
    return { used: USED_AT_START, quota: QUOTA, month }
  }
  function spend(n: number): void {
    const q = quota()
    fs.mkdirSync(ctx.dataDir, { recursive: true })
    fs.writeFileSync(quotaFile, JSON.stringify({ used: Math.min(QUOTA, q.used + n), month: q.month }))
  }

  function simulate(): Simulate {
    const v = ctx.settings.get<string>('simulate')
    return v === 'missing-tool' || v === 'unavailable' ? v : 'none'
  }

  function saveRun(run: ForgeRun): void {
    const dir = path.join(ctx.tmpDir, run.job)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2))
  }

  function report(job: JobContext, run: ForgeRun, value: number, message: string, action?: Parameters<JobContext['progress']>[2]): void {
    run.progress = value
    run.message = message
    job.progress(value, message, action)
  }

  async function makeCandidates(run: ForgeRun, n: number, seed: number): Promise<Candidate[]> {
    const dir = path.join(ctx.tmpDir, run.job)
    fs.mkdirSync(dir, { recursive: true })
    const out: Candidate[] = []
    for (let i = 0; i < n; i++) {
      if (run.creator === 'image') {
        const [w, h] = str(run.params.size, '1536×1536').split('×').map(Number) as [number, number]
        const png = await candidatePng(seed + i * 7919, w, h)
        const file = path.join(dir, `candidate_${i + 1}.png`)
        fs.writeFileSync(file, png)
        out.push({ file, preview: file, name: `candidate_${i + 1}.png`, mime: 'image/png' })
      } else {
        const m = candidateGlb(seed + i * 7919, `forge_${i + 1}`)
        const file = path.join(dir, `candidate_${i + 1}.glb`)
        const preview = path.join(dir, `candidate_${i + 1}.preview.png`)
        fs.writeFileSync(file, m.glb)
        fs.writeFileSync(preview, await modelPreviewPng(m.colors, m.lid))
        out.push({ file, preview, name: `candidate_${i + 1}.glb`, mime: 'model/gltf-binary' })
      }
    }
    return out
  }

  /** Register the chosen candidates through the kernel: each with the run's provenance (one batch, ADR-070). */
  async function keep(run: ForgeRun, job: JobContext, picked: number[]): Promise<ForgeRun['registered']> {
    const seedBase = int(run.params.seed, 0)
    const params: Record<string, unknown> = run.creator === 'image'
      ? { model: run.params.model, seed: seedBase, ...(str(run.params.negativePrompt) ? { negativePrompt: run.params.negativePrompt } : {}), size: run.params.size, count: run.params.count }
      : { model: run.params.model, seed: seedBase, maxTriangles: run.params.maxTriangles, textureSize: run.params.textureSize, count: run.params.count }
    const provenance = {
      method: `${PLUGIN_ID}/${run.creator}`,
      tool: `${PLUGIN_NAME} ${ctx.pluginVersion}`,
      ...(run.creator === 'image' ? { prompt: str(run.params.prompt) } : {}),
      params
    }
    const stamp = String(now()).slice(-4)
    const model = run.inputs.find(i => i.role === '四视图')
    const stem = run.creator === 'model' ? `${(model ? stemOf(model.name) : 'forge').replace(/_turnaround$/, '')}_forge` : `forge_${stamp}`
    const ext = run.creator === 'model' ? '.glb' : '.png'
    const out: ForgeRun['registered'] = []
    for (const [n, i] of [...picked].sort((a, b) => a - b).entries()) {
      // Cancelled part-way: stop registering; what is already registered stays (and is listed on the run).
      if (job.signal.aborted) { run.registered = out; throw abortError() }
      const c = run.candidates[i]!
      const name = stem + (picked.length > 1 || run.creator === 'image' ? `_${n + 1}` : '') + ext
      const req: RegisterRequest = {
        file: { kind: 'path', path: c.file, name },
        name,
        folder: run.folder,
        stage: 'production',
        relations: run.inputs.map(x => ({ type: 'source', to: x.id, role: x.role })),
        onConflict: 'keep-both',
        provenance
      }
      const info = await job.register(req)
      out.push({ id: info.id, name: info.name, path: info.path })
    }
    return out
  }

  function creatorFor(id: 'image' | 'model', displayName: string, params: Record<string, unknown>, inputs: Creator['inputs']): Creator {
    return {
      id, displayName, params, inputs,
      async run(request: CreateRequest, job: JobContext): Promise<void> {
        const p = { ...(request.params as Record<string, unknown> | null ?? {}) }
        const props = (params as { properties: Record<string, { default?: unknown }> }).properties
        for (const [k, s] of Object.entries(props)) if (p[k] === undefined && s.default !== undefined) p[k] = s.default
        if (id === 'image' && !str(p.model)) p.model = ctx.settings.get<string>('defaultModel') ?? 'forge-xl 2.1'
        if (id === 'image' && !str(p.prompt).trim()) throw new Error('提示词不能为空')
        const required = inputs.filter(i => i.required).find(i => !request.inputs.some(x => x.role === i.role))
        if (required) throw new Error('先选一个' + required.role)
        const seed = Number.isFinite(Number(p.seed)) && p.seed !== '' && p.seed != null ? int(p.seed, 0) : 1000 + Math.floor(prng(job.id.length * 131 + now() % 100000)() * 9000)
        p.seed = seed
        const count = Math.max(1, Math.min(id === 'image' ? 4 : 2, int(p.count, id === 'image' ? 4 : 2)))
        p.count = count
        const first = request.inputs.find(i => i.role === '四视图' || i.role === '参考图')
        const run: ForgeRun = {
          job: job.id, creator: id, creatorName: displayName, title: `${displayName} · ${count} ${id === 'model' ? '个' : '张'}`,
          state: 'running', progress: 0, message: '排队中', params: p,
          inputs: request.inputs.map(i => ({ role: i.role, id: i.asset.id, name: i.asset.name })),
          // the folder chosen in the form; else next to the input (prototype target()); else the library setting
          folder: request.folder ?? (first ? dirOf(first.asset.path) : (str(ctx.settings.get<string>('outputFolder')) || 'ai-generated')),
          by: request.actor, startedAt: new Date(now()).toISOString(), candidates: [], registered: []
        }
        runs.set(job.id, run)
        const fail = (why: string, code?: string): Error => {
          run.state = 'failed'; run.error = why; run.message = why
          if (code) run.errorCode = code
          saveRun(run)
          const e = new Error(why) as Error & { code?: string; tool?: string }
          if (code) e.code = code
          // like ctx.exec's own ENOENT: the kernel lists the tool under「缺少外部工具」in the plugin settings
          if (code === 'ENOENT') e.tool = TOOL
          return e
        }
        const sim = simulate()
        if (sim === 'missing-tool') throw fail(`缺少外部工具 ${TOOL}`, 'ENOENT')
        try {
          report(job, run, 0, '排队中')
          if (sim === 'unavailable') { await sleep(stepMs * 3.5, job.signal); throw fail('服务没有响应（503）', 'E503') }
          const step = id === 'model' ? 4 : 7
          for (let pct = step; pct < 100; pct += step) {
            await sleep(stepMs, job.signal)
            report(job, run, pct / 100, `生成中 ${pct}%`)
          }
          await sleep(stepMs, job.signal)
          run.candidates = await makeCandidates(run, count, seed)
          spend(count)
          saveRun(run)
          let picked: number[]
          if (count === 1) picked = [0]
          else {
            run.state = 'pick'
            report(job, run, 1, `${displayName}完成，挑出要留下的`, { label: '挑选…', page: 'pick', params: { job: job.id } })
            saveRun(run)
            picked = await waitForPick(run, job.signal)
          }
          run.state = 'running'
          run.registered = await keep(run, job, picked)
          run.state = 'done'
          report(job, run, 1, `已登记 ${run.registered.length} 个`)
          saveRun(run)
          settle(job.id, run.registered)
        } catch (e) {
          if (isAbort(e) || job.signal.aborted) {
            run.state = 'cancelled'; run.message = '已取消'
            saveRun(run)
            settle(job.id, null, abortError())
            return
          }
          if (run.state !== 'failed') { run.state = 'failed'; run.error = e instanceof Error ? e.message : String(e); saveRun(run) }
          settle(job.id, null, e instanceof Error ? e : new Error(String(e)))
          throw e
        }
      }
    }
  }

  function settle(job: string, value: ForgeRun['registered'] | null, error?: Error): void {
    const p = pending.get(job)
    pending.delete(job)
    if (!p) return
    if (value) p.done.resolve(value); else p.done.reject(error ?? new Error('failed'))
  }

  function waitForPick(run: ForgeRun, signal: AbortSignal): Promise<number[]> {
    const selection = deferred<number[]>(), done = deferred<ForgeRun['registered']>()
    done.promise.catch(() => {})
    pending.set(run.job, { choose: selection.resolve, done })
    const onAbort = () => selection.reject(abortError())
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    return selection.promise.finally(() => signal.removeEventListener('abort', onAbort))
  }

  /** `POST pick` { job, keep: number[] } → registers the chosen candidates, returns them. */
  async function pick(job: string, keepIdx: unknown): Promise<RouteResponse> {
    const run = runs.get(job)
    const p = pending.get(job)
    if (!run || !p || run.state !== 'pick') return { status: 409, body: { error: { code: 'conflict', message: '这次生成不在等待挑选' } } }
    const idx = Array.isArray(keepIdx) ? [...new Set(keepIdx.map(Number))] : []
    if (!idx.length || idx.some(i => !Number.isInteger(i) || i < 0 || i >= run.candidates.length)) {
      return { status: 400, body: { error: { code: 'validation_failed', message: '至少选一个' } } }
    }
    p.choose(idx)
    try {
      const registered = await p.done.promise
      return { status: 200, body: { job, registered } }
    } catch (e) {
      // cancelled while registering: say so, with what was registered before the cancel
      if (isAbort(e)) return { status: 409, body: { error: { code: 'conflict', message: '已取消', details: { registered: run.registered } } } }
      return { status: 500, body: { error: { code: 'internal', message: e instanceof Error ? e.message : String(e) } } }
    }
  }

  function publicRun(r: ForgeRun) {
    return {
      job: r.job, creator: r.creator, creatorName: r.creatorName, title: r.title, state: r.state, progress: r.progress, message: r.message,
      params: r.params, inputs: r.inputs, folder: r.folder, by: r.by, startedAt: r.startedAt, error: r.error, errorCode: r.errorCode,
      candidates: r.candidates.map((c, i) => ({ index: i, name: c.name, kind: r.creator, preview: `runs/${r.job}/candidates/${i}` })),
      registered: r.registered
    }
  }

  const imageCreator = creatorFor('image', 'AI 生图', IMAGE_PARAMS as unknown as Record<string, unknown>, [{ role: '参考图', formats: ['image'], required: false }])
  const modelCreator = creatorFor('model', '生成模型', MODEL_PARAMS as unknown as Record<string, unknown>, [
    { role: '四视图', formats: ['image'], views: true, required: true },
    { role: '设计对象', formats: ['doc'], required: false }
  ])

  /** 「生成变体（Forge）」: one image in, one recoloured image out next to it (registered by the kernel). */
  const variantAction: Action = {
    id: 'variant',
    title: '生成变体（Forge）',
    params: VARIANT_PARAMS as unknown as Record<string, unknown>,
    appliesTo: (sel: AssetInfo[]) => sel.length === 1 && sel[0]!.format === 'image' && !(sel[0]!.flags ?? []).includes('missing'),
    async run(sel, params, actx) {
      const src = sel[0]
      if (!src || sel.length !== 1 || src.format !== 'image') throw new Error('只能对一张图片生成变体')
      const abs = await ctx.library.filePath(src.id)
      if (!abs || !fs.existsSync(abs)) throw new Error(`找不到 ${src.name} 的文件`)
      const hue = int((params as { hue?: unknown } | null)?.hue, 180)
      const png = await tintedPng(fs.readFileSync(abs), hue)
      if (actx.signal.aborted) throw abortError()
      const dir = path.join(ctx.tmpDir, 'variants')
      fs.mkdirSync(dir, { recursive: true })
      const name = `${stemOf(src.name)}_variant.png`
      const file = path.join(dir, `${src.id}-${hue}.png`)
      fs.writeFileSync(file, png)
      return {
        assets: [{
          file: { kind: 'path', path: file, name },
          name,
          folder: dirOf(src.path),
          stage: src.stage,
          relations: [{ type: 'source', to: src.id, role: '原图' }],
          onConflict: 'keep-both',
          provenance: { method: `${PLUGIN_ID}/variant`, tool: `${PLUGIN_NAME} ${ctx.pluginVersion}`, params: { hue } }
        }],
        message: `已生成 ${name}`
      }
    }
  }

  const routes = {
    pick: async (req: RouteRequest): Promise<RouteResponse> => {
      const body = (req.body ?? {}) as { job?: unknown; keep?: unknown }
      return pick(String(body.job ?? ''), body.keep)
    },
    quota: async (): Promise<RouteResponse> => ({ body: quota() }),
    runs: async (): Promise<RouteResponse> => ({ body: { runs: [...runs.values()].reverse().map(publicRun) } }),
    run: async (req: RouteRequest): Promise<RouteResponse> => {
      const r = runs.get(req.params.job ?? '')
      return r ? { body: publicRun(r) } : { status: 404, body: { error: { code: 'not_found', message: '没有这次生成' } } }
    },
    candidate: async (req: RouteRequest): Promise<RouteResponse> => {
      const r = runs.get(req.params.job ?? '')
      const c = r?.candidates[Number(req.params.index)]
      if (!c || !fs.existsSync(c.preview)) return { status: 404, body: { error: { code: 'not_found', message: '候选已被清理' } } }
      return { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' }, body: new Uint8Array(fs.readFileSync(c.preview)) }
    },
    status: async (): Promise<RouteResponse> => {
      const sim = simulate()
      return { body: { tool: sim === 'missing-tool' ? null : `${TOOL} 2.3.0`, simulate: sim, failures: [...runs.values()].filter(r => r.state === 'failed').length } }
    }
  }

  return { runs, imageCreator, modelCreator, variantAction, routes, quota, pick }
}

/** Register everything with the kernel. */
export function activateForge(ctx: PluginContext, opts: ForgeOptions = {}) {
  const forge = createForge(ctx, opts)
  ctx.register.creator(forge.imageCreator)
  ctx.register.creator(forge.modelCreator)
  ctx.register.action(forge.variantAction)
  ctx.register.route({ method: 'POST', path: 'pick', handler: forge.routes.pick })
  ctx.register.route({ method: 'GET', path: 'quota', handler: forge.routes.quota })
  ctx.register.route({ method: 'GET', path: 'runs', handler: forge.routes.runs })
  ctx.register.route({ method: 'GET', path: 'runs/:job', handler: forge.routes.run })
  ctx.register.route({ method: 'GET', path: 'runs/:job/candidates/:index', handler: forge.routes.candidate })
  ctx.register.route({ method: 'GET', path: 'status', handler: forge.routes.status })
  ctx.log.info('Forge ready (fake generation, no network)', { simulate: ctx.settings.get('simulate') ?? 'none' })
  return forge
}
