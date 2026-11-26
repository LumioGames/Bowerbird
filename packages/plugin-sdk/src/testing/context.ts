import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  Action, AuthProvider, CacheWriter, Creator, Enricher, ExecOptions, ExecResult, FormatHandler, LibraryReader, Logger,
  PluginContext, Route, SearchProvider, SettingsReader, Source, Template, Validator, VersionStore
} from '../server.js'

export interface Registrations {
  formats: FormatHandler[]
  searchProviders: SearchProvider[]
  enrichers: Enricher[]
  sources: Source[]
  creators: Creator[]
  validators: Validator[]
  templates: Template[]
  actions: Action[]
  versionStores: VersionStore[]
  auth: AuthProvider[]
  routes: Route[]
}

export interface TestContext extends PluginContext {
  readonly registered: Registrations
  readonly logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }>
}

export interface TestContextOptions {
  pluginId?: string
  pluginVersion?: string
  settings?: Record<string, unknown>
  library?: Partial<LibraryReader>
  dataDir?: string
  /**
   * External tools: off by default (the built-in plugins have none — builtin-plugins.md「外部依赖：无」), so a
   * stray `exec` fails the test. `true` runs real tools; a function stands in for them.
   */
  exec?: boolean | PluginContext['exec']
}

/** Thrown by `ctx.exec` in a test context that did not opt in. */
export class ExecNotAllowedError extends Error {
  readonly code = 'EXEC_NOT_ALLOWED'
  constructor(tool: string) { super(`external tool "${tool}" called in a test context without { exec: true }`); this.name = 'ExecNotAllowedError' }
}

/** A PluginContext for unit and contract tests: records registrations, keeps cache in memory, no `exec` unless allowed. */
export function createTestContext(opts: TestContextOptions = {}): TestContext {
  const registered: Registrations = {
    formats: [], searchProviders: [], enrichers: [], sources: [], creators: [], validators: [], templates: [],
    actions: [], versionStores: [], auth: [], routes: []
  }
  const logs: TestContext['logs'] = []
  const log: Logger = {
    debug: (msg, data) => logs.push({ level: 'debug', msg, data }),
    info: (msg, data) => logs.push({ level: 'info', msg, data }),
    warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
    error: (msg, data) => logs.push({ level: 'error', msg, data })
  }
  const mem = new Map<string, Uint8Array>()
  const cache: CacheWriter = {
    async put(id, stage, name, data) { const k = `${stage}/${id}/${name}`; mem.set(k, data); return k },
    async get(id, stage, name) { return mem.get(`${stage}/${id}/${name}`) ?? null }
  }
  const values = { ...(opts.settings ?? {}) }
  const settings: SettingsReader = { get: <T>(k: string) => values[k] as T | undefined, all: () => ({ ...values }) }
  const notImplemented = async () => { throw new Error('not available in the test context') }
  const library: LibraryReader = {
    id: 'test', name: 'test', root: os.tmpdir(),
    get: async () => null, getByPath: async () => null, search: notImplemented, record: async () => null,
    filePath: async () => null, issues: async () => [],
    ...(opts.library ?? {})
  } as LibraryReader
  const base = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bb-plugin-test-'))
  const dataDir = path.join(base, 'data')
  const tmpDir = path.join(base, 'tmp')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  return {
    pluginId: opts.pluginId ?? 'test.plugin',
    pluginVersion: opts.pluginVersion ?? '0.0.0',
    library, cache, settings, log, dataDir, tmpDir, registered, logs,
    events: { on: () => () => {} },
    exec: typeof opts.exec === 'function' ? opts.exec
      : opts.exec ? (tool, args, o) => runTool(tool, args, o)
        : async tool => { throw new ExecNotAllowedError(tool) },
    register: {
      format: i => { registered.formats.push(i) },
      searchProvider: i => { registered.searchProviders.push(i) },
      enricher: i => { registered.enrichers.push(i) },
      source: i => { registered.sources.push(i) },
      creator: i => { registered.creators.push(i) },
      validator: i => { registered.validators.push(i) },
      template: i => { registered.templates.push(i) },
      action: i => { registered.actions.push(i) },
      versionStore: i => { registered.versionStores.push(i) },
      auth: i => { registered.auth.push(i) },
      route: i => { registered.routes.push(i) }
    }
  }
}

/** `exec` as the kernel implements it: collects stdout bytes and stderr text; ENOENT when the tool is missing. */
export function runTool(tool: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { cwd: opts.cwd, signal: opts.signal })
    const out: Buffer[] = []
    let err = ''
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.on('error', e => { if (timer) clearTimeout(timer); reject(e) })
    child.on('close', code => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout: new Uint8Array(Buffer.concat(out)), stderr: err }) })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}
