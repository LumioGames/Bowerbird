import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { createTestContext } from '@bowerbird/plugin-sdk/testing'
import type { AssetInfo, CreateRequest, JobContext, RegisterRequest } from '@bowerbird/plugin-sdk'
import type { JobAction } from '@bowerbird/schema'
import { activateForge, PLUGIN_ID, VARIANT_PARAMS } from './forge.js'

function asset(id: string, path: string): AssetInfo {
  return { id, name: path.split('/').pop()!, path } as unknown as AssetInfo
}
const TURNAROUND = asset('0192f3a4-7c1e-7b52-9d06-4e8a51c0d203', 'props/chest/chest_turnaround.png')
const DESIGN = asset('0192f3a4-7c1e-7b52-9d06-4e8a51c0d201', 'props/chest/chest.md')

interface FakeJob extends JobContext {
  calls: Array<{ value: number; message?: string; action?: JobAction }>
  registered: RegisterRequest[]
  abort(): void
  waitFor(pred: (c: FakeJob['calls'][number]) => boolean): Promise<void>
}

/** A JobContext like the kernel's: records progress; register returns an AssetInfo. */
function fakeJob(id = 'job-1'): FakeJob {
  const ac = new AbortController()
  const calls: FakeJob['calls'] = []
  const registered: RegisterRequest[] = []
  const waiters: Array<{ pred: (c: FakeJob['calls'][number]) => boolean; resolve(): void }> = []
  return {
    id, calls, registered, signal: ac.signal, abort: () => ac.abort(),
    progress(value, message, action) {
      const c = { value, message, action }
      calls.push(c)
      for (const w of waiters.splice(0)) if (w.pred(c)) w.resolve(); else waiters.push(w)
    },
    async register(req) {
      registered.push(req)
      const name = req.name ?? 'x'
      return asset(`0192f3a4-7c1e-7b52-9d06-${String(registered.length).padStart(12, '0')}`, `${req.folder ? req.folder + '/' : ''}${name}`)
    },
    waitFor(pred) {
      if (calls.some(pred)) return Promise.resolve()
      return new Promise(resolve => waiters.push({ pred, resolve }))
    }
  }
}

function setup(settings: Record<string, unknown> = {}) {
  const ctx = createTestContext({ pluginId: PLUGIN_ID, pluginVersion: '0.4.0', settings })
  const forge = activateForge(ctx, { stepMs: 0, now: () => Date.UTC(2026, 10, 25, 4, 0, 0, 1234) })
  return { ctx, forge }
}

const request = (params: Record<string, unknown>, inputs: CreateRequest['inputs'] = [], folder?: string): CreateRequest =>
  ({ params, inputs, folder, actor: 'user:mo' })

const isPick = (c: { action?: JobAction }) => c.action?.page === 'pick'

describe('community.forge', () => {
  it('registers two creation ways and its routes', () => {
    const { ctx } = setup()
    expect(ctx.registered.creators.map(c => [c.id, c.displayName])).toEqual([['image', 'AI 生图'], ['model', '生成模型']])
    const model = ctx.registered.creators[1]!
    expect(model.inputs).toEqual([{ role: '四视图', formats: ['image'], views: true, required: true }, { role: '设计对象', formats: ['doc'], required: false }])
    expect((ctx.registered.creators[0]!.params as { required: string[] }).required).toEqual(['prompt'])
    expect(ctx.registered.routes.map(r => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['POST pick', 'GET quota', 'GET runs', 'GET runs/:job', 'GET runs/:job/candidates/:index', 'GET status'])
    )
  })

  it('AI 生图: progress, candidates in the temp dir, waits for「挑选…」, registers the picked ones, each with the run\'s provenance', async () => {
    const { ctx, forge } = setup()
    const job = fakeJob('job-img')
    const done = forge.imageCreator.run(request({ prompt: '提灯的原画', negativePrompt: '文字', count: 4, size: '1024×1024', seed: 7730 }, [{ role: '参考图', asset: TURNAROUND }]), job)
    await job.waitFor(isPick)

    // progress climbs, then stops at the follow-up action (ADR-042)
    const values = job.calls.map(c => c.value)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(job.calls.some(c => c.message === '生成中 49%')).toBe(true)
    const last = job.calls[job.calls.length - 1]!
    expect(last).toEqual({ value: 1, message: 'AI 生图完成，挑出要留下的', action: { label: '挑选…', page: 'pick', params: { job: 'job-img' } } })

    // four candidates in this plugin's temp dir, nothing registered yet
    const run = forge.runs.get('job-img')!
    expect(run.state).toBe('pick')
    expect(run.candidates).toHaveLength(4)
    for (const c of run.candidates) {
      expect(c.file.startsWith(ctx.tmpDir)).toBe(true)
      expect(fs.readFileSync(c.file).subarray(1, 4).toString()).toBe('PNG')
    }
    expect(job.registered).toHaveLength(0)
    const cand = await forge.routes.candidate({ params: { job: 'job-img', index: '2' } } as never)
    expect(cand.headers?.['content-type']).toBe('image/png')

    // pick 1 and 3 through the plugin route
    const res = await forge.routes.pick({ body: { job: 'job-img', keep: [2, 0] } } as never)
    expect(res.status).toBe(200)
    await done
    expect(job.registered).toHaveLength(2)
    const [a, b] = job.registered
    expect(a!.provenance).toEqual({
      method: 'community.forge/image', tool: 'Forge 0.4.0', prompt: '提灯的原画',
      params: { model: 'forge-xl 2.1', seed: 7730, negativePrompt: '文字', size: '1024×1024', count: 4 }
    })
    expect(b!.provenance).toEqual(a!.provenance) // same run: the kernel adds one batch id to both
    expect(a!.file).toEqual({ kind: 'path', path: run.candidates[0]!.file, name: a!.name })
    expect(b!.file).toMatchObject({ path: run.candidates[2]!.file })
    expect([a!.name, b!.name]).toEqual(['forge_1234_1.png', 'forge_1234_2.png'])
    expect(a!.folder).toBe('props/chest')
    expect(a!.relations).toEqual([{ type: 'source', to: TURNAROUND.id, role: '参考图' }])
    expect(a!.onConflict).toBe('keep-both')
    expect(run.state).toBe('done')
    expect(job.calls[job.calls.length - 1]!.message).toBe('已登记 2 个')
    // not picked: still only on this computer
    expect(fs.existsSync(run.candidates[1]!.file)).toBe(true)
    // a second pick is refused
    expect((await forge.routes.pick({ body: { job: 'job-img', keep: [1] } } as never)).status).toBe(409)
  })

  it('生成模型: needs a 四视图, writes GLB candidates, the inputs are source relations with their roles', async () => {
    const { forge } = setup()
    await expect(forge.modelCreator.run(request({}), fakeJob('no-input'))).rejects.toThrow('先选一个四视图')

    const job = fakeJob('job-model')
    const done = forge.modelCreator.run(request({ count: 2, seed: 5 }, [{ role: '四视图', asset: TURNAROUND }, { role: '设计对象', asset: DESIGN }]), job)
    await job.waitFor(isPick)
    expect(job.calls[job.calls.length - 1]!.message).toBe('生成模型完成，挑出要留下的')
    const run = forge.runs.get('job-model')!
    for (const c of run.candidates) {
      const head = fs.readFileSync(c.file)
      expect(head.readUInt32LE(0)).toBe(0x46546c67) // 'glTF'
      expect(head.readUInt32LE(8)).toBe(head.length)
      expect(fs.readFileSync(c.preview).subarray(1, 4).toString()).toBe('PNG')
    }
    expect((await forge.routes.pick({ body: { job: 'job-model', keep: [] } } as never)).status).toBe(400)
    await forge.routes.pick({ body: { job: 'job-model', keep: [1] } } as never)
    await done
    expect(job.registered).toHaveLength(1)
    const r = job.registered[0]!
    expect(r.name).toBe('chest_forge.glb')
    expect(r.provenance).toMatchObject({
      method: 'community.forge/model', params: { model: 'forge-3d 0.9', seed: 5, maxTriangles: 5000, textureSize: 1024, count: 2 }
    })
    expect(r.relations).toEqual([{ type: 'source', to: TURNAROUND.id, role: '四视图' }, { type: 'source', to: DESIGN.id, role: '设计对象' }])
    expect(r.provenance && 'prompt' in r.provenance).toBe(false)
  })

  it('one candidate is registered without asking', async () => {
    const { forge } = setup()
    const job = fakeJob('job-one')
    await forge.imageCreator.run(request({ prompt: '一枚金币', count: 1 }), job)
    expect(job.calls.some(isPick)).toBe(false)
    expect(job.registered).toHaveLength(1)
    expect(job.registered[0]!.folder).toBe('ai-generated')
    expect((job.registered[0]!.provenance as { params: { seed: number } }).params.seed).toEqual(expect.any(Number))
  })

  it('cancel while generating or while waiting to pick: nothing is registered', async () => {
    const { ctx } = setup()
    const forge = activateForge(ctx, { stepMs: 5 })
    const running = fakeJob('job-cancel-1')
    const p1 = forge.imageCreator.run(request({ prompt: 'x', count: 4 }), running)
    await running.waitFor(c => c.value > 0.2)
    running.abort()
    await expect(p1).resolves.toBeUndefined()
    expect(forge.runs.get('job-cancel-1')!.state).toBe('cancelled')
    expect(running.registered).toHaveLength(0)

    const picking = fakeJob('job-cancel-2')
    const p2 = forge.imageCreator.run(request({ prompt: 'x', count: 2 }), picking)
    await picking.waitFor(isPick)
    picking.abort()
    await expect(p2).resolves.toBeUndefined()
    expect(picking.registered).toHaveLength(0)
    expect((await forge.routes.pick({ body: { job: 'job-cancel-2', keep: [0] } } as never)).status).toBe(409)
  })

  it('cancel while registering the picked candidates: registering stops, what is in stays listed', async () => {
    const { forge } = setup()
    const job = fakeJob('job-cancel-3')
    const register = job.register.bind(job)
    job.register = async req => { const info = await register(req); job.abort(); return info }
    const done = forge.imageCreator.run(request({ prompt: '三枚金币', count: 3, seed: 1 }), job)
    await job.waitFor(isPick)
    const res = await forge.routes.pick({ body: { job: 'job-cancel-3', keep: [0, 1, 2] } } as never)
    expect(res.status).toBe(409)
    expect((res.body as { error: { message: string; details: { registered: unknown[] } } }).error).toMatchObject({ message: '已取消', details: { registered: [{ name: 'forge_1234_1.png' }] } })
    await expect(done).resolves.toBeUndefined()
    expect(job.registered).toHaveLength(1)
    const run = forge.runs.get('job-cancel-3')!
    expect(run.state).toBe('cancelled')
    expect(run.registered.map(r => r.name)).toEqual(['forge_1234_1.png'])
  })

  it('simulate missing-tool:「缺少外部工具 forge-cli」', async () => {
    const { forge } = setup({ simulate: 'missing-tool' })
    const job = fakeJob('job-tool')
    await expect(forge.imageCreator.run(request({ prompt: 'x' }), job)).rejects.toThrow('缺少外部工具 forge-cli')
    // shaped like ctx.exec's ENOENT so the kernel lists the tool under「缺少外部工具」
    await expect(forge.imageCreator.run(request({ prompt: 'x' }), fakeJob('job-tool-2'))).rejects.toMatchObject({ code: 'ENOENT', tool: 'forge-cli' })
    expect(job.registered).toHaveLength(0)
    expect(forge.runs.get('job-tool')!.state).toBe('failed')
    expect((await forge.routes.status()).body).toMatchObject({ tool: null, simulate: 'missing-tool' })
  })

  it('simulate unavailable: every run fails with「服务没有响应（503）」', async () => {
    const { forge } = setup({ simulate: 'unavailable' })
    for (const id of ['a', 'b', 'c']) {
      const job = fakeJob('job-503-' + id)
      await expect(forge.modelCreator.run(request({}, [{ role: '四视图', asset: TURNAROUND }]), job)).rejects.toThrow('服务没有响应（503）')
      expect(job.registered).toHaveLength(0)
    }
    expect((await forge.routes.status()).body).toMatchObject({ failures: 3 })
  })

  it('quota: starts at 312 of 1000 this month and counts every generated candidate', async () => {
    const { forge } = setup()
    expect((await forge.routes.quota()).body).toEqual({ used: 312, quota: 1000, month: '2026-11' })
    const job = fakeJob('job-q')
    const done = forge.imageCreator.run(request({ prompt: 'x', count: 2 }), job)
    await job.waitFor(isPick)
    expect((await forge.routes.quota()).body).toMatchObject({ used: 314 })
    await forge.routes.pick({ body: { job: 'job-q', keep: [0] } } as never)
    await done
    const runs = (await forge.routes.runs()).body as { runs: Array<{ job: string; state: string; candidates: unknown[] }> }
    expect(runs.runs[0]).toMatchObject({ job: 'job-q', state: 'done' })
    expect(runs.runs[0]!.candidates).toHaveLength(2)
  })
})

describe('community.forge action「生成变体（Forge）」(plugin-system.md「动作」)', () => {
  const IMG = { ...asset('0192f3a4-7c1e-7b52-9d06-4e8a51c0d210', 'props/chest/chest_basecolor.png'), format: 'image', stage: 'production', flags: [] } as unknown as AssetInfo
  const actx = () => ({ actor: 'user:mo', log: { debug() {}, info() {}, warn() {}, error() {} }, signal: new AbortController().signal })

  async function withImage() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-variant-'))
    const file = path.join(dir, 'chest_basecolor.png')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toFile(file)
    const ctx = createTestContext({ pluginId: PLUGIN_ID, pluginVersion: '0.4.0', library: { filePath: async id => (id === IMG.id ? file : null) } })
    const forge = activateForge(ctx, { stepMs: 0 })
    return { ctx, forge, file }
  }

  it('is registered with a hue form and applies to exactly one image that is on disk', async () => {
    const { ctx } = await withImage()
    const a = ctx.registered.actions[0]!
    expect(ctx.registered.actions.map(x => [x.id, x.title])).toEqual([['variant', '生成变体（Forge）']])
    expect(a.params).toEqual(VARIANT_PARAMS)
    expect(a.appliesTo([IMG])).toBe(true)
    expect(a.appliesTo([IMG, IMG])).toBe(false)
    expect(a.appliesTo([{ ...IMG, format: 'model' } as AssetInfo])).toBe(false)
    expect(a.appliesTo([{ ...IMG, flags: ['missing'] } as unknown as AssetInfo])).toBe(false)
    expect(a.appliesTo([])).toBe(false)
  })

  it('makes a recoloured copy next to the original: source relation with role 原图, provenance community.forge/variant', async () => {
    const { forge, file } = await withImage()
    const r = await forge.variantAction.run([IMG], { hue: 90 }, actx())
    expect(r.assets).toHaveLength(1)
    const out = r.assets![0]!
    expect(out).toMatchObject({
      name: 'chest_basecolor_variant.png', folder: 'props/chest', stage: 'production', onConflict: 'keep-both',
      relations: [{ type: 'source', to: IMG.id, role: '原图' }],
      provenance: { method: 'community.forge/variant', tool: 'Forge 0.4.0', params: { hue: 90 } }
    })
    expect(out.file.kind).toBe('path')
    const made = (out.file as { path: string }).path
    expect(made.startsWith(path.dirname(file))).toBe(false)
    const [src, dst] = await Promise.all([sharp(file).raw().toBuffer({ resolveWithObject: true }), sharp(made).raw().toBuffer({ resolveWithObject: true })])
    expect([dst.info.width, dst.info.height]).toEqual([src.info.width, src.info.height])
    expect(Buffer.compare(src.data, dst.data)).not.toBe(0)
    expect(r.message).toBe('已生成 chest_basecolor_variant.png')
  })

  it('defaults the hue to 180; refuses a selection it does not apply to or a file that is gone', async () => {
    const { forge } = await withImage()
    const r = await forge.variantAction.run([IMG], undefined, actx())
    expect(r.assets![0]!.provenance).toMatchObject({ params: { hue: 180 } })
    await expect(forge.variantAction.run([IMG, IMG], {}, actx())).rejects.toThrow('只能对一张图片生成变体')
    const gone = { ...IMG, id: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d299' } as AssetInfo
    await expect(forge.variantAction.run([gone], {}, actx())).rejects.toThrow('找不到')
  })
})

describe('community.forge manifest', () => {
  it('declares creators, a library-scoped endpoint and a machine-only apiKey', async () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const { PluginPackageJson } = await import('@bowerbird/schema')
    const m = PluginPackageJson.parse(pkg).bowerbird
    expect(m.id).toBe('community.forge')
    expect(pkg.version).toBe('0.4.0')
    expect(m.contributes.creators?.map(c => c.id)).toEqual(['image', 'model'])
    expect(m.contributes.actions?.map(c => c.id)).toEqual(['variant'])
    const props = (m.contributes.settings as { properties: Record<string, { scope: string }> }).properties
    expect(props.endpoint!.scope).toBe('library')
    expect(props.apiKey!.scope).toBe('machine')
    expect(props.simulate!.scope).toBe('machine')
    expect(m.requires.tools).toEqual([])
    void vi
  })
})

describe.runIf(fs.existsSync(new URL('../dist/server.js', import.meta.url)))('community.forge built package', () => {
  it('loads through the plugin test kit: manifest and registrations agree', async () => {
    const { loadPluginForTest } = await import('@bowerbird/plugin-sdk/testing')
    const loaded = await loadPluginForTest(new URL('..', import.meta.url).pathname)
    expect(loaded.manifest.id).toBe('community.forge')
    expect(loaded.ctx.registered.creators.map(c => c.id)).toEqual(loaded.manifest.contributes.creators!.map(c => c.id))
    expect(loaded.ctx.registered.actions.map(c => c.id)).toEqual(loaded.manifest.contributes.actions!.map(c => c.id))
    expect(loaded.ctx.registered.routes.length).toBeGreaterThanOrEqual(2)
  })
})
