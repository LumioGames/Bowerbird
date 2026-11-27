/**
 * bb — the local commands (init, serve, plugin, mcp) and one command per capability of the shared table
 * (@bowerbird/mcp capabilities.ts, ADR-071): search, get, trace, add, apply, tag, retarget, export, health, resolve,
 * changes, rescan, rm, untrack, create, action, vocabulary. Every command takes `--json`.
 * A capability talks to the server named by `--server` / BOWERBIRD_URL; else to a server running on this machine;
 * else it opens the library itself for the length of the command (ADR-069).
 */
import fs from 'node:fs'
import path from 'node:path'
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander'
import { BowerbirdApiError, DEFAULT_HOST, DEFAULT_PORT, type PluginInfo } from '@bowerbird/schema'
import type { Hub, HubOptions } from '@bowerbird/core'
import type { RunningServer, ServerOptions } from '@bowerbird/server'
import {
  CAPABILITIES, capContext, connect, errorText, libraryRootOf, writeServerFile, type ArgSpec, type Capability, type Connection, type McpOptions
} from '@bowerbird/mcp'
import { bowerbirdHome, locateAssets, type Located } from './locate.js'

export interface CliIO {
  out(text: string): void
  err(text: string): void
  env: NodeJS.ProcessEnv
  cwd: string
  fetch?: typeof fetch
  createHub(opts: HubOptions): Promise<Hub>
  startServer(opts: ServerOptions): Promise<RunningServer>
  runMcpServer(opts: McpOptions): Promise<void>
  /** Built-in plugin and web shell locations (default: found from this package's location). */
  locate?: () => Located
  /** Keep `serve` running until a signal (default true); tests turn it off. */
  installSignalHandlers?: boolean
  /** Where to look for a server that does not announce itself (default http://127.0.0.1:7420; null = do not look). */
  defaultUrl?: string | null
  /** Called with the running server (tests close it). */
  onServe?: (s: { server: RunningServer; hub: Hub; forget: () => void }) => void
}

interface Globals { json?: boolean; server?: string; library?: string }


export function buildProgram(io: CliIO, state: { exitCode: number } = { exitCode: 0 }, mode: { json?: boolean } = {}): Command {
  const program = new Command()
  program
    .name('bb')
    .description('Bowerbird 游戏资产管理器的命令行')
    .version('0.1.0', '-v, --version')
    .option('--json', '以 JSON 输出')
    .option('--server <url>', '服务地址（默认 BOWERBIRD_URL 或 http://127.0.0.1:7420）')
    .option('--library <id>', '资产库标识（默认是服务的默认资产库）')
    .showHelpAfterError()
    .exitOverride()
    // With --json, argument errors are reported as JSON on stdout by run(); commander's own text stays quiet.
    .configureOutput({
      writeOut: s => io.out(s.replace(/\n$/, '')),
      writeErr: s => { if (!mode.json) io.err(s.replace(/\n$/, '')) },
      outputError: (s, write) => { if (!mode.json) write(s) }
    })

  const globals = (cmd: Command): Globals => cmd.optsWithGlobals() as Globals
  const print = (cmd: Command, data: unknown, text: string | (() => string)) => {
    if (globals(cmd).json) io.out(JSON.stringify(data, null, 2))
    else io.out(typeof text === 'function' ? text() : text)
  }
  let localTurn: Promise<void> = Promise.resolve()
  const locate = () => (io.locate ?? locateAssets)()
  const home = () => bowerbirdHome(io.env)
  const defaultUrl = () => (io.defaultUrl === undefined ? `http://${DEFAULT_HOST}:${DEFAULT_PORT}` : io.defaultUrl)
  const hubFor = async (extra: Partial<HubOptions> = {}) => {
    const { pluginsDir } = locate()
    return io.createHub({ home: home(), builtinPluginDirs: pluginsDir ? [pluginsDir] : [], watch: false, ...extra })
  }
  const abs = (p: string) => path.resolve(io.cwd, p.replace(/^~(?=$|[\\/])/, io.env.HOME ?? '~'))
  // A bare name is a person: `lin` → `user:lin` (the server only takes user:/agent: actors).
  const actor = (): string | undefined => {
    const given = io.env.BOWERBIRD_ACTOR?.trim()
    return given ? (/^(user|agent):/.test(given) ? given : `user:${given}`) : undefined
  }

  /**
   * No server runs: open the library in this process for one command (ADR-069) — the one named by `--library`, the
   * one whose folder holds the working directory, or the machine's default. The start-up scan runs first; thumbnails
   * and other processing wait for the next server.
   */
  const openLocal = (g: Globals) => async (): Promise<Connection> => {
    // one library opened by this process at a time (MCP calls may come in together): the next waits for the close
    const prev = localTurn
    let done!: () => void
    localTurn = new Promise<void>(r => { done = r })
    await prev
    try {
      const conn = await openLocalOnce(g)
      return { ...conn, close: async () => { try { await conn.close() } finally { done() } } }
    } catch (e) { done(); throw e }
  }
  const openLocalOnce = async (g: Globals): Promise<Connection> => {
    // another process holds the library (a command finishing, a server starting): wait a little before giving up
    for (let waited = 0; ; waited += 250) {
      const hub = await hubFor({ processing: false })
      try {
        const id = await pickLibrary(hub, g.library, io.cwd)
        const svc = await hub.library(id)
        await svc.ready?.()
        const server = await io.startServer({ hub, host: '127.0.0.1', port: 0, defaultLibrary: id, print: () => undefined })
        // the library is named on every call: a list of libraries would open every library of this machine
        return { baseUrl: server.url, local: true, library: id, close: async () => { await server.close().catch(() => undefined); await hub.close() } }
      } catch (e) {
        await hub.close().catch(() => undefined)
        if ((e as { code?: string }).code !== 'conflict' || !/另一个 Bowerbird 进程/.test(String((e as Error).message)) || waited >= 10_000) throw e
        await new Promise(r => setTimeout(r, 250))
      }
    }
  }

  const connectFor = (g: Globals) => {
    const root = libraryRootOf(io.cwd)
    return connect({
      ...(g.server ?? io.env.BOWERBIRD_URL ? { server: g.server ?? io.env.BOWERBIRD_URL } : {}),
      home: home(), ...(io.fetch ? { fetch: io.fetch } : {}),
      ...(defaultUrl() ? { defaultUrl: defaultUrl()! } : {}),
      // a server found on this machine counts only when it has this library open
      want: { ...(g.library ? { library: g.library } : {}), ...(root ? { root } : {}) },
      openLocal: openLocal(g)
    })
  }

  /* ───────────── init / serve (local, no server needed) ───────────── */

  program.command('init')
    .description('把一个文件夹初始化为资产库')
    .argument('<dir>', '文件夹')
    .option('--name <name>', '资产库名称（默认用文件夹名）')
    .action(async (dir: string, opts: { name?: string }, cmd: Command) => {
      const root = abs(dir)
      await fs.promises.mkdir(root, { recursive: true })
      const hub = await hubFor()
      try {
        const ref = await hub.initLibrary(root, opts.name)
        print(cmd, ref, `已初始化资产库「${ref.name}」：${ref.root}`)
      } finally { await hub.close() }
    })

  program.command('serve')
    .description('启动服务；给出的目录登记为资产库，并作为这次打开的库')
    .argument('[dir]', '资产库文件夹')
    .option('--host <host>', `监听地址（默认 ${DEFAULT_HOST}；0.0.0.0 允许局域网访问）`)
    .option('--port <port>', `端口（默认 ${DEFAULT_PORT}）`, v => parsePort(v))
    .option('--name <name>', '新登记的资产库名称')
    .action(async (dir: string | undefined, opts: { host?: string; port?: number; name?: string }, cmd: Command) => {
      const located = locate()
      let address = { host: opts.host ?? DEFAULT_HOST, port: opts.port ?? DEFAULT_PORT }
      const overrides: HubOptions['overrides'] = {}
      if (opts.host) overrides.host = opts.host
      if (opts.port !== undefined) overrides.port = opts.port
      const hub = await io.createHub({
        home: home(),
        builtinPluginDirs: located.pluginsDir ? [located.pluginsDir] : [],
        address: () => address,
        ...(Object.keys(overrides).length ? { overrides } : {})
      })
      let server: RunningServer | null = null
      try {
        const cfg = hub.config()
        const host = opts.host ?? cfg.host ?? DEFAULT_HOST
        const port = opts.port ?? cfg.port ?? DEFAULT_PORT
        let library: Awaited<ReturnType<Hub['addLibrary']>> | null = null
        if (dir) {
          const root = abs(dir)
          await fs.promises.mkdir(root, { recursive: true })
          library = await hub.addLibrary(root, opts.name)
        }
        server = await io.startServer({
          hub, host, port, webDir: located.webDir ?? undefined, defaultLibrary: library?.id,
          print: t => io.err(t)
        })
        address = { host, port: server.port }
        // commands on this machine find this server (ADR-069)
        const forget = writeServerFile(home(), { pid: process.pid, url: server.url })
        const running = server
        print(cmd, { url: server.url, lanUrl: server.lanUrl, library, webDir: located.webDir, pluginsDir: located.pluginsDir }, () => [
          `Bowerbird 已启动：${running.url}`,
          ...(library ? [`资产库「${library.name}」：${library.root}`] : []),
          ...(located.webDir ? [] : ['没有找到构建好的网页外壳，只提供接口（先运行 pnpm build）']),
          ...(located.pluginsDir ? [] : ['没有找到内置插件目录'])
        ].join('\n'))
        io.onServe?.({ server, hub, forget })
        if (io.installSignalHandlers !== false) {
          const stop = async () => {
            try { forget(); await running.close(); await hub.close() } finally { process.exit(0) }
          }
          process.once('SIGINT', () => { void stop() })
          process.once('SIGTERM', () => { void stop() })
        }
      } catch (e) {
        await server?.close().catch(() => undefined)
        await hub.close().catch(() => undefined)
        throw e
      }
    })

  /* ───────────── one command per capability (ADR-071) ───────────── */

  for (const cap of CAPABILITIES) addCapability(program, cap, async (cmd: Command, args: Record<string, unknown>) => {
    const g = globals(cmd)
    const conn = await connectFor(g)
    try {
      // the id the server knows (a --library given by name is resolved by connect / pickLibrary)
      const library = conn.library ?? g.library
      const ctx = capContext({ baseUrl: conn.baseUrl, actor: actor(), ...(library ? { library } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), cwd: io.cwd, surface: 'cli' })
      const r = await cap.run(ctx, args)
      print(cmd, r.data, r.text)
      if (r.failed) state.exitCode = 1
    } finally { await conn.close() }
  }, io.cwd)

  /* ───────────── plugins (local, no server needed) ───────────── */

  const plugin = program.command('plugin').description('插件管理（直接操作这台电脑上安装的插件）')
  const pluginLine = (p: { id: string; version: string | null; status: string; source: string; displayName: string }) =>
    `${p.id} ${p.version ?? '-'} ${p.status} ${p.source} ${p.displayName}`
  const restartNote = '正在运行的服务重启后生效。'
  plugin.command('list').description('已安装的插件').action(async (_o: unknown, cmd: Command) => {
    const hub = await hubFor()
    try {
      await hub.plugins.discover()
      const list = hub.plugins.list()
      print(cmd, list, () => list.map(pluginLine).join('\n') || '没有插件')
    } finally { await hub.close() }
  })
  plugin.command('add').description('安装插件：npm 包名或本机路径（只安装来源可信的插件）').argument('<spec>')
    .action(async (spec: string, _o: unknown, cmd: Command) => {
      const hub = await hubFor()
      try {
        const local = /^[.~/]|^[a-zA-Z]:[\\/]/.test(spec) ? abs(spec) : spec
        const info = await hub.plugins.install(local)
        print(cmd, info, `已安装 ${pluginLine(info)}\n${restartNote}`)
      } finally { await hub.close() }
    })
  plugin.command('update').description('更新插件（不给标识时更新全部非内置插件）').argument('[id]')
    .action(async (id: string | undefined, _o: unknown, cmd: Command) => {
      const hub = await hubFor()
      try {
        await hub.plugins.discover()
        const ids = id ? [id] : hub.plugins.list().filter(p => !p.builtin && p.status !== 'missing').map(p => p.id)
        const updated: PluginInfo[] = []
        for (const i of ids) updated.push(await hub.plugins.update(i))
        print(cmd, updated, () => (updated.length ? updated.map(p => `已更新 ${pluginLine(p)}`).join('\n') + `\n${restartNote}` : '没有可更新的插件'))
      } finally { await hub.close() }
    })
  plugin.command('remove').description('卸载插件').argument('<id>')
    .action(async (id: string, _o: unknown, cmd: Command) => {
      const hub = await hubFor()
      try {
        await hub.plugins.remove(id)
        print(cmd, { removed: id }, `已卸载 ${id}\n${restartNote}`)
      } finally { await hub.close() }
    })

  /* ───────────── MCP ───────────── */

  program.command('mcp')
    .description('启动 MCP 服务（标准输入输出），供 Agent 使用；工具与命令行的命令出自同一份定义，没有删除工具')
    .option('--name <name>', 'Agent 名称，执行者记为 agent:<名称>（默认 BOWERBIRD_AGENT）')
    .action(async (opts: { name?: string }, cmd: Command) => {
      const g = globals(cmd)
      const server = g.server ?? io.env.BOWERBIRD_URL
      await io.runMcpServer({
        ...(server ? { baseUrl: server } : { home: home(), openLocal: openLocal(g), ...(defaultUrl() ? { defaultUrl: defaultUrl()! } : {}) }),
        ...(g.library ? { library: g.library } : {}),
        // The raw name: the MCP server prefixes and encodes it once (agentActor).
        actor: opts.name ?? io.env.BOWERBIRD_AGENT ?? '',
        ...(io.fetch ? { fetch: io.fetch } : {}),
        cwd: io.cwd
      })
    })

  return program
}

function parsePort(v: string): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new InvalidArgumentError(`端口不对：${v}`)
  return n
}
function parseIntOpt(v: string, name: string): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError(`--${name} 需要正整数：${v}`)
  return n
}

const kebab = (s: string) => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
const camel = (s: string) => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
const collect = (v: string, prev: string[] = []) => [...prev, ...v.split(',').map(x => x.trim()).filter(Boolean)]

/** A JSON value on the command line: inline, or `@<file>` to read it from a file. */
function jsonArg(cwd: string) {
  return (v: string): unknown => {
    const text = v.startsWith('@') ? fs.readFileSync(path.resolve(cwd, v.slice(1)), 'utf8') : v
    try { return JSON.parse(text) } catch { throw new InvalidArgumentError(`不是合法的 JSON：${v.length > 60 ? v.slice(0, 59) + '…' : v}`) }
  }
}

/** The command-line form of one capability: positional arguments, then flags, all from its ArgSpec list. */
function addCapability(program: Command, cap: Capability, run: (cmd: Command, args: Record<string, unknown>) => Promise<void>, cwd: string): void {
  const cmd = program.command(cap.name).description(cap.summary)
  if (cap.allowUnknownOptions) cmd.allowUnknownOption()
  const specs = cap.args.filter(a => a.only !== 'mcp')
  const positional = specs.filter(a => a.positional)
  for (const a of positional) {
    const n = a.name
    cmd.argument(a.positional === 'many' ? (a.required ? `<${n}...>` : `[${n}...]`) : (a.required ? `<${n}>` : `[${n}]`), a.description)
  }
  for (const a of specs.filter(x => !x.positional)) cmd.addOption(optionOf(a, cwd))
  cmd.action(async (...xs: unknown[]) => {
    const c = xs[xs.length - 1] as Command
    const opts = c.opts() as Record<string, unknown>
    const args: Record<string, unknown> = {}
    positional.forEach((a, i) => { const v = xs[i]; if (v !== undefined && !(Array.isArray(v) && !v.length)) args[a.name] = v })
    for (const a of specs.filter(x => !x.positional)) {
      const v = opts[camel(a.flag ?? kebab(a.name))]
      if (v !== undefined) args[a.name] = v
    }
    await run(c, args)
  })
}

function optionOf(a: ArgSpec, cwd: string): Option {
  const flag = a.flag ?? kebab(a.name)
  let o: Option
  switch (a.kind) {
    case 'boolean': o = new Option(`--${flag}`, a.description); break
    case 'number': o = new Option(`--${flag} <n>`, a.description).argParser(v => parseIntOpt(v, flag)); break
    case 'strings': o = new Option(`--${flag} <value>`, a.description + '（可重复或用逗号分隔）').argParser(collect); break
    case 'json': o = new Option(`--${flag} <json>`, a.description + '（@文件 从文件读）').argParser(jsonArg(cwd)); break
    case 'enum': o = new Option(`--${flag} <value>`, a.description).choices([...(a.choices ?? [])]); break
    default: o = new Option(`--${flag} <value>`, a.description)
  }
  if (a.required) o.makeOptionMandatory()
  return o
}

/** The library a command opens itself (ADR-069): the named one, the one holding `cwd`, or the machine's default. */
async function pickLibrary(hub: Hub, given: string | undefined, cwd: string): Promise<string> {
  const libs = hub.libraries()
  if (given) {
    const hit = libs.find(l => l.id === given || l.name === given)
    if (!hit) throw new BowerbirdApiError(404, 'not_found', `这台电脑上没有登记资产库：${given}`)
    return hit.id
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.bowerbird', 'library.json'))) {
      const known = libs.find(l => path.resolve(l.root) === dir)
      return known ? known.id : (await hub.addLibrary(dir)).id
    }
    if (path.dirname(dir) === dir) break
  }
  const id = hub.defaultLibraryId() ?? (libs.length === 1 ? libs[0]!.id : null)
  if (!id) throw new BowerbirdApiError(404, 'not_found', libs.length ? '没有在运行的服务，也不知道要打开哪个资产库：在资产库文件夹里运行，或用 --library 指定' : '没有在运行的服务，这台电脑上也还没有登记资产库：先运行 bb init <文件夹>')
  return id
}

/** Run the CLI; returns the exit code (serve keeps the process alive through its open server). */
export async function run(argv: string[], io: CliIO): Promise<number> {
  const state = { exitCode: 0 }
  const json = argv.includes('--json')
  const program = buildProgram(io, state, { json })
  try {
    await program.parseAsync(argv, { from: 'user' })
    return state.exitCode
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.code === 'commander.helpDisplayed' || e.code === 'commander.version' || e.code === 'commander.help') return 0
      if (json) io.out(JSON.stringify({ error: { code: 'validation_failed', message: e.message.replace(/^error:\s*/, ''), details: { reason: e.code } } }, null, 2))
      return e.exitCode || 1
    }
    if (json) {
      const err = e instanceof BowerbirdApiError
        ? { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }
        : { error: { code: 'internal', message: (e as Error)?.message ?? String(e) } }
      io.out(JSON.stringify(err, null, 2))
    } else {
      io.err(`错误：${errorText(e)}`)
    }
    return 1
  }
}
