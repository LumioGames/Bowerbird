import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiClient, type ApiClient } from '@bowerbird/schema'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = path.join(REPO, 'packages/cli/dist/index.js')

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}

function copyDir(src: string, dst: string, filter: (p: string) => boolean = () => true): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name)
    if (!filter(s)) continue
    if (e.isDirectory()) copyDir(s, d, filter)
    else fs.copyFileSync(s, d)
  }
}

/** `none`: `bb serve` with no folder and nothing registered (the first-run page). */
export type LibrarySource = 'xingluo' | 'empty' | 'first-open' | 'none' | { dir: string }

export interface Bowerbird {
  url: string
  /** Library id of the opened library. */
  lib: string
  root: string
  home: string
  api: ApiClient
  /** API client acting as an agent (for「别人的改动」, agent scope). */
  agent(name?: string): ApiClient
  stop(): Promise<void>
  /** Stop the server process only (connection-failure state), keep files. */
  kill(): Promise<void>
}

/**
 * Start `bb serve` on a temp copy of a fixture library with its own BOWERBIRD_HOME. `fsHome` is the home folder the
 * server process sees (`HOME`): where the folder chooser starts.
 */
export async function startBowerbird(opts: { library?: LibrarySource; host?: string; plugins?: string[]; fsHome?: string } = {}): Promise<Bowerbird> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-'))
  const home = path.join(base, 'home')
  const root = path.join(base, 'library')
  const src = opts.library ?? 'xingluo'
  if (src === 'xingluo') {
    // copy-library.mjs --rebase-trash shifts trash dates to today so the 7-day retention does not purge them
    execFileSync(process.execPath, [path.join(REPO, 'fixtures/scripts/copy-library.mjs'), root, '--rebase-trash'], { stdio: 'ignore' })
  }
  else if (src === 'empty') fs.mkdirSync(root, { recursive: true })
  else if (src === 'first-open') {
    copyDir(path.join(REPO, 'fixtures/xingluo'), root, p => !p.endsWith('.bmeta') && !p.includes(`${path.sep}.bowerbird`))
  } else if (src !== 'none') copyDir(src.dir, root)
  const port = await freePort()
  const host = opts.host ?? '127.0.0.1'
  const args = [CLI, 'serve', ...(src === 'none' ? [] : [root]), '--port', String(port), '--host', host]
  const env = { ...process.env, BOWERBIRD_HOME: home, BOWERBIRD_LOG_LEVEL: 'warn', ...(opts.fsHome ? { HOME: opts.fsHome, USERPROFILE: opts.fsHome } : {}) }
  const child: ChildProcess = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
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
      const h = await api.health()
      const libs = await api.libraries.list()
      const ref = libs.libraries.find(l => path.resolve(l.root) === path.resolve(root)) ?? libs.libraries[0]
      if (h.status && (ref || src === 'none')) { lib = ref?.id ?? ''; break }
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`bb serve did not become ready:\n${log}`)
    await new Promise(r => setTimeout(r, 250))
  }
  for (const p of opts.plugins ?? []) { await api.plugins.install(p); await api.plugins.enable((await api.plugins.list()).plugins.find(x => x.installPath && path.resolve(x.installPath) === path.resolve(p))?.id ?? p, lib) }
  const kill = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) } }
  return {
    url, lib, root, home, api,
    agent: (name = 'concept-artist') => createApiClient({ baseUrl: url, headers: { origin: url }, actor: `agent:${name}` }),
    kill,
    stop: async () => { await kill(); fs.rmSync(base, { recursive: true, force: true }) }
  }
}

/** Wait until the pipeline has nothing queued (thumbnails generated server-side). */
export async function waitIdle(bb: Bowerbird, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const j = await bb.api.jobs.overview(bb.lib)
    const queued = j.stages.reduce((n, s) => n + s.queued + s.running, 0)
    if (queued === 0 && !j.scan.running) return
    if (Date.now() > end) throw new Error('pipeline did not go idle')
    await new Promise(r => setTimeout(r, 300))
  }
}
