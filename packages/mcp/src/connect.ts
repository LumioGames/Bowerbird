/**
 * Where a command talks to (ADR-069): the server it is told about; else a server that is running on this machine;
 * else the library itself, opened in this process for the length of the command (the caller supplies how — this
 * package never depends on the kernel). A running server announces itself in `<BOWERBIRD_HOME>/server.json`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { BowerbirdApiError } from '@bowerbird/schema'

export interface Connection {
  /** Server origin, e.g. `http://127.0.0.1:7420`. */
  baseUrl: string
  /** The library was opened by this process (no server ran). */
  local: boolean
  /** Id of the wanted library on that server, when the command asked for one. */
  library?: string
  close(): Promise<void>
}

/** The library a command is about: named, or the folder it runs in. */
export interface WantedLibrary { library?: string; root?: string }

export interface ConnectOptions {
  /** The server the user named (`--server` / `BOWERBIRD_URL`): used as it is, never replaced. */
  server?: string
  /** `BOWERBIRD_HOME`: where a running server writes `server.json`. */
  home: string
  fetch?: typeof fetch
  /** Open the library in this process when no server runs; absent = say that no server runs. */
  openLocal?: () => Promise<Connection>
  /** Also try the default address (a server started without writing server.json, e.g. in a container). */
  defaultUrl?: string
  /**
   * A server found on this machine is used only when it serves this library; otherwise the command opens the
   * library itself — it never writes into another library a server happens to have open.
   */
  want?: WantedLibrary
}

/** The library folder holding `cwd` (a parent with `.bowerbird/library.json`), or undefined. */
export function libraryRootOf(cwd: string): string | undefined {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.bowerbird', 'library.json'))) return dir
    if (path.dirname(dir) === dir) return undefined
  }
}

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }

/** Whether a found server serves the wanted library, and its id there. */
async function serves(url: string, f: typeof fetch, want: WantedLibrary | undefined): Promise<{ ok: boolean; library?: string }> {
  if (!want?.library && !want?.root) return { ok: true }
  try {
    const res = await f(`${url}/api/v1/libraries`)
    if (!res.ok) return { ok: false }
    const body = await res.json() as { libraries?: Array<{ id: string; name: string; root: string }> }
    const libs = body.libraries ?? []
    const hit = want.library ? libs.find(l => l.id === want.library || l.name === want.library) : libs.find(l => real(l.root) === real(want.root!))
    return hit ? { ok: true, library: hit.id } : { ok: false }
  } catch { return { ok: false } }
}

export const SERVER_FILE = 'server.json'

/** What `bb serve` writes while it runs. */
export interface ServerFile { pid: number; url: string; at: string }

export function writeServerFile(home: string, info: Omit<ServerFile, 'at'>): () => void {
  const file = path.join(home, SERVER_FILE)
  fs.mkdirSync(home, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...info, at: new Date().toISOString() }, null, 2) + '\n')
  fs.renameSync(tmp, file)
  return () => {
    try {
      const now = JSON.parse(fs.readFileSync(file, 'utf8')) as ServerFile
      if (now.pid === info.pid) fs.rmSync(file, { force: true })
    } catch { /* gone already */ }
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

async function answers(url: string, f: typeof fetch, timeoutMs: number): Promise<boolean> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await f(`${url.replace(/\/+$/, '')}/api/v1/health`, { signal: ctl.signal })
    return res.ok
  } catch { return false } finally { clearTimeout(t) }
}

/** The server named in server.json, when its process still runs and it answers. */
export async function runningServer(home: string, f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string | null> {
  let info: ServerFile | null = null
  try { info = JSON.parse(fs.readFileSync(path.join(home, SERVER_FILE), 'utf8')) as ServerFile } catch { return null }
  if (!info?.url || !alive(info.pid)) return null
  return (await answers(info.url, f, 2000)) ? info.url : null
}

export async function connect(o: ConnectOptions): Promise<Connection> {
  const none = async () => {}
  if (o.server) return { baseUrl: o.server.replace(/\/+$/, ''), local: false, close: none }
  const f = o.fetch ?? globalThis.fetch.bind(globalThis)
  const candidates: string[] = []
  const found = await runningServer(o.home, f)
  if (found) candidates.push(found)
  if (o.defaultUrl && !candidates.includes(o.defaultUrl) && (await answers(o.defaultUrl, f, 500))) candidates.push(o.defaultUrl)
  for (const url of candidates) {
    const s = await serves(url, f, o.want)
    if (s.ok) return { baseUrl: url, local: false, ...(s.library ? { library: s.library } : {}), close: none }
  }
  if (o.openLocal) return o.openLocal()
  throw new BowerbirdApiError(0, 'network', candidates.length ? '在运行的 Bowerbird 服务没有打开这个资产库' : '没有在运行的 Bowerbird 服务')
}
