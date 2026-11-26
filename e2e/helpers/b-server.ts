import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { createApiClient } from '@bowerbird/schema'
import { REPO, freePort, waitIdle, type Bowerbird } from './server'

/**
 * Line e2e-b: start `bb serve` like helpers/server.ts `startBowerbird`, through helpers/b-launch.mjs so the built
 * web shell (packages/web/dist) is served. See b-launch.mjs for why (packages/cli/src/locate.ts picks packages/web).
 */
export async function startBB(opts: { library?: 'xingluo' | 'empty'; idle?: boolean; /** null: no --host (the saved config decides; default 127.0.0.1) */ host?: string | null } = {}): Promise<Bowerbird> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-b-'))
  const home = path.join(base, 'home')
  const root = path.join(base, 'library')
  if ((opts.library ?? 'xingluo') === 'xingluo') execFileSync(process.execPath, [path.join(REPO, 'fixtures/scripts/copy-library.mjs'), root, '--rebase-trash'], { stdio: 'ignore' })
  else fs.mkdirSync(root, { recursive: true })
  const port = await freePort()
  const host = opts.host === undefined ? '127.0.0.1' : opts.host
  const child: ChildProcess = spawn(process.execPath, [path.join(REPO, 'e2e/helpers/b-launch.mjs'), 'serve', root, '--port', String(port), ...(host ? ['--host', host] : [])], {
    env: { ...process.env, BOWERBIRD_HOME: home, BOWERBIRD_LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout?.on('data', d => { log += d })
  child.stderr?.on('data', d => { log += d })
  const url = `http://127.0.0.1:${port}`
  const api = createApiClient({ baseUrl: url, headers: { origin: url } })
  const deadline = Date.now() + 60_000
  let lib = ''
  for (;;) {
    if (child.exitCode !== null) throw new Error(`bb serve exited (${child.exitCode}):\n${log}`)
    try {
      const libs = await api.libraries.list()
      const ref = libs.libraries.find(l => path.resolve(l.root) === path.resolve(root)) ?? libs.libraries[0]
      if (ref) { lib = ref.id; break }
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`bb serve did not become ready:\n${log}`)
    await new Promise(r => setTimeout(r, 200))
  }
  const kill = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) } }
  const bb: Bowerbird = {
    url, lib, root, home, api,
    agent: (name = 'concept-artist') => createApiClient({ baseUrl: url, headers: { origin: url }, actor: `agent:${name}` }),
    kill,
    stop: async () => { await kill(); fs.rmSync(base, { recursive: true, force: true }) }
  }
  if (opts.idle !== false) await waitReady(bb, (opts.library ?? 'xingluo') === 'xingluo' ? XINGLUO_ASSETS : 0)
  return bb
}

/** Assets of the「星落镇」sample (fixtures/README.md). */
export const XINGLUO_ASSETS = 72

/**
 * The first scan has registered everything, the index is ready and the pipeline has nothing queued. (A fresh
 * server reports index ready + scan done after a first quick pass with only a couple of assets indexed, then
 * scans again; so wait for the asset count too.)
 */
export async function waitReady(bb: Bowerbird, assets = 0, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const h = await bb.api.health()
    const l = h.libraries.find(x => x.id === bb.lib)
    const total = assets ? ((await bb.api.search(bb.lib, { limit: 1 } as never)) as { total: number }).total : 0
    if (l && l.index === 'ready' && !l.scan.running && l.scan.finishedAt && total >= assets) break
    if (Date.now() > end) throw new Error('library did not become ready')
    await new Promise(r => setTimeout(r, 200))
  }
  await waitIdle(bb, timeoutMs)
}

const ids = new WeakMap<Bowerbird, Map<string, string>>()
/** Asset id by library path (search over everything once, cached per server). */
export async function idOf(bb: Bowerbird, p: string): Promise<string> {
  let m = ids.get(bb)
  if (!m || !m.has(p)) {
    m = new Map()
    let cursor: string | undefined
    do {
      const r = await bb.api.search(bb.lib, { limit: 200, ...(cursor ? { cursor } : {}) } as never) as { items: Array<{ id: string; path: string }>; cursor?: string | null }
      for (const it of r.items) m.set(it.path, it.id)
      cursor = r.cursor ?? undefined
      if (!r.items.length) break
    } while (cursor)
    ids.set(bb, m)
  }
  const id = m.get(p)
  if (!id) throw new Error(`no asset at ${p}`)
  return id
}

export const libPath = (bb: Bowerbird, sub = '') => `${bb.url}/libraries/${encodeURIComponent(bb.lib)}${sub}`

/** Open the detail page of the asset at `p` (fresh navigation, no trail). */
export async function openDetail(page: Page, bb: Bowerbird, p: string, tab?: string): Promise<string> {
  const id = await idOf(bb, p)
  await page.goto(libPath(bb, `/asset/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`))
  await expect(page.locator('.w2-dh b')).toHaveText(path.basename(p))
  return id
}

/** The tab list of the detail page. */
export const detailTabs = (page: Page) => page.getByRole('tablist', { name: '详情' })

/** Toast region text (bottom right). */
export const toasts = (page: Page) => page.locator('[data-sonner-toaster], .bb-toasts, [role="status"], [role="region"][aria-label*="通知"]')

/** Delay matching API calls (loading states); returns a release function. */
export async function holdRoute(page: Page, pattern: string | RegExp, method?: string): Promise<() => void> {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  await page.route(pattern, async route => {
    if (method && route.request().method() !== method) return route.fallback()
    await gate
    await route.fallback()
  })
  return release
}

/** Fail matching API calls with a 500 until `heal()` is called. */
export async function failRoute(page: Page, pattern: string | RegExp, method?: string): Promise<() => void> {
  let broken = true
  await page.route(pattern, async route => {
    if (!broken || (method && route.request().method() !== method)) return route.fallback()
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: '服务出错了' } }) })
  })
  return () => { broken = false }
}
