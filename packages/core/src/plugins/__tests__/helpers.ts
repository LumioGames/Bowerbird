/** Test helpers for the plugin host: plugin packages written into temp folders, a fake library handle. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MachineConfig, type LibraryJson } from '@bowerbird/schema'
import type { FileRef, LibraryReader } from '@bowerbird/plugin-sdk'
import type { LibraryHandle, LibraryPaths } from '../../contracts.js'

export function tmpDir(prefix = 'bb-plugins-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export interface PluginSpec {
  id: string
  name?: string
  version?: string
  displayName?: string
  apiVersion?: number
  /** Raw `bowerbird` field overrides (merged over the defaults). */
  manifest?: Record<string, unknown>
  /** server.js source (ESM). Omit for a manifest-only plugin. */
  server?: string
  /** Write a built web module file. */
  web?: boolean
}

/** Write a plugin package (package.json + server.js) into `parent/<folder>`; returns its folder. */
export function writePlugin(parent: string, folder: string, spec: PluginSpec): string {
  const dir = path.join(parent, folder)
  fs.mkdirSync(dir, { recursive: true })
  const bowerbird = {
    id: spec.id,
    displayName: spec.displayName ?? spec.id,
    apiVersion: spec.apiVersion ?? 1,
    ...(spec.server !== undefined ? { server: './server.js' } : {}),
    ...(spec.web ? { web: './web.js' } : {}),
    ...(spec.manifest ?? {})
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: spec.name ?? `test-${spec.id}`, version: spec.version ?? '1.0.0', type: 'module', bowerbird }, null, 2))
  if (spec.server !== undefined) fs.writeFileSync(path.join(dir, 'server.js'), spec.server)
  if (spec.web) fs.writeFileSync(path.join(dir, 'web.js'), 'export default {}\n')
  return dir
}

export function fileRef(name: string, head = ''): FileRef {
  const i = name.lastIndexOf('.')
  return { absPath: `/lib/${name}`, path: name, name, ext: i > 0 ? name.slice(i).toLowerCase() : '', size: head.length, bundle: false, head: new TextEncoder().encode(head) }
}

export function libraryJson(plugins: Record<string, string> = {}, extra: Partial<LibraryJson> = {}): LibraryJson {
  return {
    bb: 1, id: '00000000-0000-7000-8000-00000000aaaa', name: 'test', created: '2026-11-01T00:00:00Z', plugins,
    settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 }, ...extra
  }
}

export function fakeLibrary(base: string, json: LibraryJson, id = 'lib1'): LibraryHandle & { json: LibraryJson; writes: number } {
  const root = path.join(base, 'library')
  const paths: LibraryPaths = {
    root, metaDir: path.join(root, '.bowerbird'), cacheDir: path.join(root, '.bowerbird', 'cache'),
    dataDir: path.join(base, 'home', 'libraries', id), indexPath: path.join(base, 'home', 'libraries', id, 'index.sqlite'),
    tmpDir: path.join(base, 'home', 'tmp')
  }
  const reader: LibraryReader = {
    id, name: 'test', root, get: async () => null, getByPath: async () => null,
    search: async () => ({ items: [], total: 0, cursor: null }), record: async () => null, filePath: async () => null, issues: async () => []
  }
  const mem = new Map<string, Uint8Array>()
  const handle = {
    id, name: 'test', paths, json, writes: 0, reader,
    libraryJson: () => handle.json,
    async updateLibraryJson(mut: (lib: LibraryJson) => void) { const copy = structuredClone(handle.json); mut(copy); handle.json = copy; handle.writes++ },
    async register() { throw new Error('not used') },
    cache: {
      async put(assetId: string, stage: string, name: string, data: Uint8Array) { mem.set(`${assetId}/${stage}/${name}`, data); return `${stage}/${name}` },
      async get(assetId: string, stage: string, name: string) { return mem.get(`${assetId}/${stage}/${name}`) ?? null }
    }
  }
  return handle as unknown as LibraryHandle & { json: LibraryJson; writes: number }
}

export function machine(initial: Partial<MachineConfig> = {}): { get: () => MachineConfig; save: (p: Partial<MachineConfig>) => Promise<void> } {
  let cfg = MachineConfig.parse(initial)
  return { get: () => cfg, save: async p => { cfg = { ...cfg, ...p } } }
}

/** A format plugin claiming `ext` when the file head starts with `magic` (empty magic = always). */
export function formatServer(format: string, magic = '', extra = ''): string {
  return `export default {
  activate(ctx) {
    ctx.register.format({
      id: ${JSON.stringify(format)},
      async match(file) {
        const head = new TextDecoder().decode(file.head)
        if (head === 'THROW') throw new Error('bad header')
        return head.startsWith(${JSON.stringify(magic)}) ? { format: ${JSON.stringify(format)} } : null
      },
      async probe() { return { tech: { v: 1 } } }
    })
    ${extra}
  }
}
`
}
