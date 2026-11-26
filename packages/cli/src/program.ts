/**
 * bb — init, serve, search, get, trace, add, tag, export, health, rescan, rm, plugin, mcp (api-and-agent.md「命令行」).
 * Every command takes `--json`. All but init/serve/plugin/mcp talk to a running server over the HTTP API
 * (`--server` / BOWERBIRD_URL, default http://127.0.0.1:7420; library `--library` or the server's default).
 */
import fs from 'node:fs'
import path from 'node:path'
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander'
import {
  BowerbirdApiError, DEFAULT_HOST, DEFAULT_PORT, ISSUE_LEVELS, ISSUE_TYPES, ON_CONFLICT, SORT_KEYS, STAGES, createApiClient,
  parseQueryText, type ApiClient, type PluginInfo, type RegisterResponse
} from '@bowerbird/schema'
import type { Hub, HubOptions } from '@bowerbird/core'
import type { RunningServer, ServerOptions } from '@bowerbird/server'
import {
  detailText, downloadExport, encodeActorHeader, errorText, fileForUpload, issuesText, lineageText,
  localAccess, newTagsText, overviewNote, registerText, relativeToRoot, resolveAssetId, resolveLibrary, searchText, summaryLine,
  type McpOptions
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
  /** Called with the running server (tests close it). */
  onServe?: (s: { server: RunningServer; hub: Hub }) => void
}

interface Globals { json?: boolean; server?: string; library?: string }

const collect = (v: string, prev: string[] = []) => [...prev, ...v.split(',').map(s => s.trim()).filter(Boolean)]

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
  const serverUrl = (g: Globals) => (g.server ?? io.env.BOWERBIRD_URL ?? `http://${DEFAULT_HOST}:${DEFAULT_PORT}`).replace(/\/+$/, '')
  const api = (cmd: Command): { client: ApiClient; lib: () => Promise<string>; base: string } => {
    const g = globals(cmd)
    const base = serverUrl(g)
    // A bare name is a person: `lin` → `user:lin` (the server only takes user:/agent: actors).
    const given = io.env.BOWERBIRD_ACTOR?.trim()
    const actor = given ? encodeActorHeader(/^(user|agent):/.test(given) ? given : `user:${given}`) : undefined
    const client = createApiClient({ baseUrl: base, actor, fetch: io.fetch })
    let lib: Promise<string> | null = null
    return { client, base, lib: () => (lib ??= resolveLibrary(client, g.library)) }
  }
  const locate = () => (io.locate ?? locateAssets)()
  const hubFor = async (extra: Partial<HubOptions> = {}) => {
    const { pluginsDir } = locate()
    return io.createHub({ home: bowerbirdHome(io.env), builtinPluginDirs: pluginsDir ? [pluginsDir] : [], watch: false, ...extra })
  }
  const abs = (p: string) => path.resolve(io.cwd, p.replace(/^~(?=$|[\\/])/, io.env.HOME ?? '~'))

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
        home: bowerbirdHome(io.env),
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
        const running = server
        print(cmd, { url: server.url, lanUrl: server.lanUrl, library, webDir: located.webDir, pluginsDir: located.pluginsDir }, () => [
          `Bowerbird 已启动：${running.url}`,
          ...(library ? [`资产库「${library.name}」：${library.root}`] : []),
          ...(located.webDir ? [] : ['没有找到构建好的网页外壳，只提供接口（先运行 pnpm build）']),
          ...(located.pluginsDir ? [] : ['没有找到内置插件目录'])
        ].join('\n'))
        io.onServe?.({ server, hub })
        if (io.installSignalHandlers !== false) {
          const stop = async () => {
            try { await running.close(); await hub.close() } finally { process.exit(0) }
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

  /* ───────────── over the HTTP API ───────────── */

  program.command('search')
    .description('搜索，支持文本语法，例如 stage:runtime format:model tag:宝箱 tris:<5000 红色宝箱')
    .argument('[query...]', '查询')
    // `-tag:废弃` is part of the query, not an option.
    .allowUnknownOption()
    .option('--limit <n>', '返回条数（默认 50）', v => parseIntOpt(v, 'limit'))
    .addOption(new Option('--sort <key>', '排序').choices([...SORT_KEYS]))
    .option('--cursor <cursor>', '下一页游标')
    .action(async (query: string[], opts: { limit?: number; sort?: (typeof SORT_KEYS)[number]; cursor?: string }, cmd: Command) => {
      const { client, lib } = api(cmd)
      const parsed = parseQueryText(query.join(' '))
      const res = await client.search(await lib(), {
        ...(parsed.q ? { q: parsed.q } : {}),
        ...(Object.keys(parsed.filter).length ? { filter: parsed.filter } : {}),
        ...(opts.sort ? { sort: opts.sort } : {}),
        limit: opts.limit ?? 50,
        ...(opts.cursor ? { cursor: opts.cursor } : {})
      })
      print(cmd, res, () => searchText(res))
    })

  program.command('get')
    .description('详情')
    .argument('<ref>', 'GUID 或路径')
    .action(async (ref: string, _opts: unknown, cmd: Command) => {
      const { client, lib } = api(cmd)
      const l = await lib()
      const id = await resolveAssetId(client, l, ref, io.cwd)
      const [asset, summary] = await Promise.all([client.assets.get(l, id), client.assets.summary(l, id).catch(() => null)])
      print(cmd, { asset, summary }, () => `${detailText(asset, summary)}\n${overviewNote(summary)}`)
    })

  program.command('trace')
    .description('追溯')
    .argument('<ref>', 'GUID 或路径')
    .addOption(new Option('--direction <dir>', '方向').choices(['up', 'down', 'both']).default('up'))
    .option('--types <types>', '关系类型，逗号分隔（默认 source）', collect)
    .option('--depth <n>', '最大层数（默认 5）', v => parseIntOpt(v, 'depth'))
    .action(async (ref: string, opts: { direction: 'up' | 'down' | 'both'; types?: string[]; depth?: number }, cmd: Command) => {
      const { client, lib } = api(cmd)
      const l = await lib()
      const id = await resolveAssetId(client, l, ref, io.cwd)
      const res = await client.assets.lineage(l, id, { direction: opts.direction, types: opts.types, depth: opts.depth })
      print(cmd, res, () => lineageText(res))
    })

  program.command('add')
    .description('登记资产：上传文件（资产库里已有的文件就地登记），可带标签、阶段、来源、提示词')
    .argument('<files...>', '文件')
    .option('--folder <folder>', '目标文件夹（资产库内的相对路径）')
    .addOption(new Option('--stage <stage>', '物料阶段').choices([...STAGES]))
    .option('--tag <tag>', '标签，可重复或用逗号分隔', collect)
    .option('--description <text>', '描述')
    .option('--source <ref>', '来源资产（GUID 或路径），可重复', collect)
    .option('--prompt <text>', '提示词（写入生产记录）')
    .option('--method <method>', '生产方式，例如 ai-generate、manual、slice（有提示词时默认 ai-generate）')
    .option('--tool <tool>', '工具（写入生产记录）')
    .addOption(new Option('--on-conflict <mode>', '同名时的处理').choices([...ON_CONFLICT]))
    .action(async (files: string[], opts: { folder?: string; stage?: (typeof STAGES)[number]; tag?: string[]; description?: string; source?: string[]; prompt?: string; method?: string; tool?: string; onConflict?: (typeof ON_CONFLICT)[number] }, cmd: Command) => {
      const { client, lib } = api(cmd)
      const l = await lib()
      const sources = await Promise.all((opts.source ?? []).map(s => resolveAssetId(client, l, s, io.cwd)))
      const fields = {
        ...(opts.stage ? { stage: opts.stage } : {}),
        ...(opts.tag?.length ? { tags: opts.tag } : {}),
        ...(opts.description ? { description: opts.description } : {}),
        ...(sources.length ? { relations: sources.map(to => ({ type: 'source', to })) } : {}),
        ...(opts.onConflict ? { onConflict: opts.onConflict } : {})
      }
      let record: string | { method: string; tool?: string; prompt?: string; inputs?: Array<{ id: string }> } | undefined
      if (opts.prompt || opts.method || opts.tool) {
        record = {
          method: opts.method ?? (opts.prompt ? 'ai-generate' : 'manual'),
          ...(opts.tool ? { tool: opts.tool } : {}),
          ...(opts.prompt ? { prompt: opts.prompt } : {}),
          ...(sources.length ? { inputs: sources.map(id => ({ id })) } : {})
        }
        if (files.length > 1) record = (await client.records.create(l, record)).id
      }
      const access = await localAccess(client, l)
      const registered: Array<{ file: string; result: RegisterResponse }> = []
      let failed: { file: string; error: { code: string; message: string; details?: Record<string, unknown> }; notRun: string[] } | null = null
      for (const [i, file] of files.entries()) {
        try {
          const p = abs(file)
          const inLib = access.local ? relativeToRoot(access.info.root, p) : null
          const result = inLib
            ? await client.assets.register(l, { ...fields, ...(record ? { record } : {}), path: inLib })
            : await client.assets.register(l, { ...fields, ...(record ? { record } : {}), ...(opts.folder !== undefined ? { folder: opts.folder } : {}) }, await fileForUpload(p))
          registered.push({ file, result })
        } catch (e) {
          // Stop at the first failure and say what is already in the library.
          const err = e instanceof BowerbirdApiError ? { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } : { code: 'internal', message: (e as Error)?.message ?? String(e) }
          failed = { file, error: err, notRun: files.slice(i + 1) }
          break
        }
      }
      const f = failed
      print(cmd, { registered, failed: f, ...(typeof record === 'string' ? { recordId: record } : {}) }, () => [
        ...registered.map(r => registerText(r.result, r.file)),
        ...(f ? [
          `没有登记 ${f.file}：${f.error.message}`,
          ...(f.notRun.length ? [`没有处理：${f.notRun.join('、')}`] : []),
          ...(registered.length ? [`已登记的 ${registered.length} 个保留在资产库里`] : [])
        ] : [])
      ].join('\n'))
      if (f) state.exitCode = 1
    })

  program.command('tag')
    .description('增删标签')
    .argument('<refs...>', 'GUID 或路径')
    .option('--add <tag>', '添加的标签，可重复或用逗号分隔', collect)
    .option('--remove <tag>', '移除的标签，可重复或用逗号分隔', collect)
    .action(async (refs: string[], opts: { add?: string[]; remove?: string[] }, cmd: Command) => {
      if (!opts.add?.length && !opts.remove?.length) throw new BowerbirdApiError(400, 'validation_failed', '用 --add 或 --remove 给出标签')
      const { client, lib } = api(cmd)
      const l = await lib()
      const out: Array<Awaited<ReturnType<ApiClient['assets']['patch']>>> = []
      for (const ref of refs) {
        const id = await resolveAssetId(client, l, ref, io.cwd)
        out.push(await client.assets.patch(l, id, { tags: { ...(opts.add?.length ? { add: opts.add } : {}), ...(opts.remove?.length ? { remove: opts.remove } : {}) } }))
      }
      print(cmd, out, () => out.flatMap(r => [summaryLine(r.asset), ...newTagsText(r.newTags)]).join('\n'))
    })

  program.command('export')
    .description('导出到目录，可连同依赖一起导出（依赖按文件里写的名字写出）')
    .argument('<refs...>', 'GUID 或路径')
    .requiredOption('--to <dir>', '目标目录')
    .option('--with-deps', '连同依赖一起导出')
    .option('--flat', '不保留文件夹结构')
    .action(async (refs: string[], opts: { to: string; withDeps?: boolean; flat?: boolean }, cmd: Command) => {
      const { client, lib } = api(cmd)
      const l = await lib()
      const ids = await Promise.all(refs.map(r => resolveAssetId(client, l, r, io.cwd)))
      const dir = abs(opts.to)
      const req = { ids, withDeps: !!opts.withDeps, layout: opts.flat ? 'flat' as const : 'keep' as const }
      const access = await localAccess(client, l)
      if (access.local) {
        const res = await (await client.exports.run(l, { ...req, dir })).json() as { written: number; dir: string; bytes: number }
        print(cmd, res, `已导出 ${res.written} 个文件（${res.bytes} 字节）到 ${res.dir}`)
      } else {
        const res = await downloadExport(client, l, req, dir)
        print(cmd, { written: res.written, dir, bytes: res.bytes, files: res.plan.files }, `已下载 ${res.written} 个文件（${res.bytes} 字节）到 ${dir}`)
      }
    })

  program.command('health')
    .description('列出完整性问题')
    .option('--type <type>', `问题类型，可重复：${ISSUE_TYPES.join(' ')}`, collect)
    .option('--level <level>', `级别，可重复：${ISSUE_LEVELS.join(' ')}`, collect)
    .action(async (opts: { type?: string[]; level?: string[] }, cmd: Command) => {
      for (const t of opts.type ?? []) if (!(ISSUE_TYPES as readonly string[]).includes(t)) throw new BowerbirdApiError(400, 'validation_failed', `没有这种问题类型：${t}`)
      for (const t of opts.level ?? []) if (!(ISSUE_LEVELS as readonly string[]).includes(t)) throw new BowerbirdApiError(400, 'validation_failed', `没有这个级别：${t}`)
      const { client, lib } = api(cmd)
      const res = await client.issues.list(await lib(), { type: opts.type as never, level: opts.level as never })
      print(cmd, res, () => issuesText(res))
    })

  program.command('rescan')
    .description('触发扫描')
    .argument('[path]', '只扫描这个文件夹（资产库内的相对路径）')
    .action(async (p: string | undefined, _opts: unknown, cmd: Command) => {
      const { client, lib } = api(cmd)
      await client.libraries.rescan(await lib(), p ? { path: p } : {})
      print(cmd, { started: true, path: p ?? null }, `已开始扫描${p ? ` ${p}` : ''}`)
    })

  program.command('rm')
    .description('移入回收站（被引用时需要 --force）')
    .argument('<refs...>', 'GUID 或路径')
    .option('--force', '被引用时也移入回收站')
    .action(async (refs: string[], opts: { force?: boolean }, cmd: Command) => {
      const { client, lib } = api(cmd)
      const l = await lib()
      const done: Array<{ id: string; trashId: string; referrers: string[] }> = []
      const failed: Array<{ ref: string; code: string; message: string; details?: Record<string, unknown> }> = []
      for (const ref of refs) {
        try {
          const id = await resolveAssetId(client, l, ref, io.cwd)
          const r = await client.assets.remove(l, id, !!opts.force)
          done.push({ id, ...r })
        } catch (e) {
          if (!(e instanceof BowerbirdApiError)) throw e
          failed.push({ ref, code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) })
        }
      }
      print(cmd, { trashed: done, failed }, () => [
        ...done.map(d => `已移入回收站 ${d.id}${d.referrers.length ? `（仍被 ${d.referrers.length} 个资产引用）` : ''}`),
        ...failed.map(f => `没有删除 ${f.ref}：${f.message}${f.code === 'referenced' ? '（确认要删除请加 --force）' : ''}`)
      ].join('\n'))
      if (failed.length) state.exitCode = 1
    })

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
    .description('启动 MCP 服务（标准输入输出），供 Agent 使用；没有删除工具')
    .option('--name <name>', 'Agent 名称，执行者记为 agent:<名称>（默认 BOWERBIRD_AGENT）')
    .action(async (opts: { name?: string }, cmd: Command) => {
      const g = globals(cmd)
      await io.runMcpServer({
        baseUrl: serverUrl(g),
        ...(g.library ? { library: g.library } : {}),
        // The raw name: the MCP server prefixes and encodes it once (agentActor).
        actor: opts.name ?? io.env.BOWERBIRD_AGENT ?? '',
        ...(io.fetch ? { fetch: io.fetch } : {})
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
