/**
 * Integration with the Forge test plugin (fixtures/plugins/forge, community.forge): path install, enable in a library,
 * creation through the pipeline with the pick page route, one shared production record, and the simulated
 * missing-tool / unavailable failures counted as consecutive failures. Needs the fixture built
 * (`pnpm --filter @bowerbird-fixtures/plugin-forge build`); skipped otherwise.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RouteRequest } from '@bowerbird/plugin-sdk'
import type { JobInfo } from '@bowerbird/schema'
import { openMemoryIndexDb } from '../../index/db.js'
import { createQueryEngine } from '../../index/query.js'
import { createEventBus } from '../../events.js'
import { silentLogger } from '../../log.js'
import type { LibraryPlugins } from '../../contracts.js'
import { createPipelineImpl, type PipelineImpl } from '../../pipeline/pipeline.js'
import { FakeDeps } from '../../pipeline/__tests__/fakes.js'
import { createPluginHostImpl, type PluginHostImpl } from '../host.js'
import { fakeLibrary, libraryJson, machine, tmpDir } from './helpers.js'

const FORGE = path.resolve(import.meta.dirname, '../../../../../fixtures/plugins/forge')
const built = fs.existsSync(path.join(FORGE, 'dist', 'server.js'))

describe.skipIf(!built)('Forge test plugin (integration)', () => {
  const ctx = { actor: 'user:lin', isLocal: true }
  let host: PluginHostImpl
  let cfg: ReturnType<typeof machine>
  let lib: ReturnType<typeof fakeLibrary>
  let lp: LibraryPlugins
  let pipe: PipelineImpl
  let deps: FakeDeps
  const prevStep = process.env.BB_FORGE_STEP_MS

  beforeAll(async () => {
    process.env.BB_FORGE_STEP_MS = '0'
    const base = tmpDir('bb-forge-')
    cfg = machine()
    host = createPluginHostImpl({ builtinDirs: [], installDir: path.join(base, 'home', 'plugins'), machineConfig: cfg.get, saveMachineConfig: cfg.save, log: silentLogger, events: createEventBus() })
    await host.discover()
    lib = fakeLibrary(base, libraryJson())
    lp = await host.forLibrary(lib)
    const db = openMemoryIndexDb()
    deps = new FakeDeps(db)
    pipe = createPipelineImpl({ db, library: lib, plugins: lp, query: createQueryEngine({ db, plugins: lp, thumbnailUrl: () => null, log: silentLogger }), deps, events: createEventBus(), log: silentLogger, cleanIntervalMs: 0 })
    pipe.start()
  })
  afterAll(async () => {
    await pipe?.stop()
    await host?.close()
    if (prevStep === undefined) delete process.env.BB_FORGE_STEP_MS
    else process.env.BB_FORGE_STEP_MS = prevStep
  })

  async function waitFor(id: string, pred: (j: JobInfo) => boolean): Promise<JobInfo> {
    for (let i = 0; i < 400; i++) {
      const j = pipe.job(id)!
      if (pred(j)) return j
      await new Promise(r => setTimeout(r, 5))
    }
    throw new Error(`job ${id} never reached the state: ${JSON.stringify(pipe.job(id))}`)
  }

  it('installs from its folder and enables in a library', async () => {
    const info = await host.install(FORGE)
    expect(info).toMatchObject({ id: 'community.forge', source: 'path', status: 'disabled', hasWeb: true, version: '0.4.0' })
    expect(info.contributes).toEqual(expect.arrayContaining(['creators', 'ui']))
    expect(host.webEntry('community.forge')).toBe(path.join(FORGE, 'dist', 'web.js'))
    const enabled = await host.setEnabled('community.forge', true, lib)
    expect(enabled.status).toBe('enabled')
    expect(lp.creatorInfo().map(c => c.id)).toEqual(['community.forge:image', 'community.forge:model'])
    expect(lp.routes().map(r => `${r.route.method} ${r.route.path}`)).toContain('POST pick')
    expect(host.machineSettings('community.forge')).toEqual({ simulate: 'none' })
  })

  it('creates through the pipeline: progress, pick page, outputs sharing one batch', async () => {
    const job = await pipe.startCreate('community.forge:image', { params: { prompt: '红色的卡通宝箱', count: 2, seed: 7 }, inputs: [], folder: 'ai' }, ctx)
    const waiting = await waitFor(job.id, j => !!j.action)
    expect(waiting.action).toMatchObject({ page: 'pick' })
    const pick = lp.routes().find(r => r.route.path === 'pick')!.route
    const req: RouteRequest = { method: 'POST', path: 'pick', params: {}, query: {}, headers: {}, body: { job: job.id, keep: [0, 1] }, actor: 'user:lin', isLocal: true, library: null }
    const res = await pick.handler(req)
    expect(res.status).toBe(200)
    await pipe.idle()
    const done = pipe.job(job.id)!
    expect(done.status).toBe('done')
    expect(done.outputs).toHaveLength(2)
    expect(deps.registered).toHaveLength(2)
    expect(deps.registered[0]!.req.provenance).toMatchObject({ method: 'community.forge/image', prompt: '红色的卡通宝箱' })
    expect(deps.registered[0]!.ctx).toMatchObject({ actor: 'user:lin', pluginId: 'community.forge', pluginVersion: '0.4.0', batch: expect.stringMatching(/^bat_/) })
    expect(deps.registered[1]!.ctx.batch).toBe(deps.registered[0]!.ctx.batch)
  })

  it('simulated failures fail the job and are counted as consecutive failures (not disabled)', async () => {
    await host.setMachineSettings('community.forge', { simulate: 'missing-tool' })
    for (let i = 0; i < 3; i++) {
      const j = await pipe.startCreate('community.forge:image', { params: { prompt: 'x' }, inputs: [] }, ctx)
      await pipe.idle()
      expect(pipe.job(j.id)).toMatchObject({ status: 'failed', error: '缺少外部工具 forge-cli', retryable: true })
    }
    const info = host.list(lib).find(p => p.id === 'community.forge')!
    expect(info.status).toBe('enabled')
    expect(info.consecutiveFailures).toEqual({ count: 3, reason: '缺少外部工具 forge-cli' })

    await host.setMachineSettings('community.forge', { simulate: 'unavailable' })
    const j = await pipe.startCreate('community.forge:image', { params: { prompt: 'x' }, inputs: [] }, ctx)
    await pipe.idle()
    expect(pipe.job(j.id)).toMatchObject({ status: 'failed', error: '服务没有响应（503）' })
    expect(host.list(lib).find(p => p.id === 'community.forge')!.consecutiveFailures).toEqual({ count: 4, reason: '服务没有响应（503）' })
    expect(pipe.overview().failed.filter(f => f.kind === 'create')).toHaveLength(4)
  })

  it('disables and uninstalls without deleting the folder', async () => {
    await host.setEnabled('community.forge', false, lib)
    expect(lp.creatorInfo()).toEqual([])
    await host.remove('community.forge')
    expect(host.list(lib).map(p => p.id)).toEqual([])
    expect(fs.existsSync(path.join(FORGE, 'package.json'))).toBe(true)
  })
})
