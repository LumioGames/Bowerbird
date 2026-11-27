/** Fakes for pipeline tests: PipelineDeps over the memory index, a LibraryHandle, format plugins. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AssetDetail, CheckView, Guid, PipelineStage, ThumbVariant } from '@bowerbird/schema'
import type { AssetFile, Creator, FormatHandler, ProbeResult, RegisterRequest, SearchDoc } from '@bowerbird/plugin-sdk'
import type { IdentifyResult, IndexDb, LibraryHandle, LibraryPlugins, LoadedFormat, PipelineDeps, StoredThumb } from '../../contracts.js'
import { fakePlugins, gid, seedAsset } from '../../query/__tests__/seed.js'

export type Call = { fn: string; id?: string; args?: unknown[] }

export class FakeDeps implements PipelineDeps {
  calls: Call[] = []
  issues: Array<{ id: string; stage: PipelineStage; error: string | null }> = []
  processing: Array<{ id: string; processing: boolean; failed: boolean; error?: string; stage?: PipelineStage }> = []
  probes: Array<{ id: string; plugin: string; probe: ProbeResult }> = []
  thumbs: Array<{ id: string; stored: Partial<Record<ThumbVariant, StoredThumb>>; aspect: number | null }> = []
  checks: Array<{ id: string; checks: CheckView[] }> = []
  registered: Array<{ req: RegisterRequest; ctx: import('../../contracts.js').PluginRegisterContext }> = []
  constructor(readonly db: IndexDb, readonly contents: Map<string, string> = new Map()) {}

  private row(id: string): { path: string; name: string; ext: string; hash: string; stage: string; size: number } | undefined {
    return this.db.prepare('SELECT path, name, ext, hash, stage, size FROM assets WHERE id = ?').get(id) as never
  }

  async assetFile(id: Guid): Promise<AssetFile | null> {
    this.calls.push({ fn: 'assetFile', id })
    const r = this.row(id)
    if (!r) return null
    const text = this.contents.get(id) ?? ''
    const data = new TextEncoder().encode(text)
    return {
      id, hash: r.hash as never, stage: r.stage as never, tech: {}, views: null, relations: [], absPath: `/lib/${r.path}`, path: r.path,
      name: r.name, ext: r.ext, size: data.length, bundle: false, head: data.slice(0, 64), read: async () => data, readSlot: async () => null
    }
  }
  async applyIdentify(id: Guid, r: IdentifyResult | null): Promise<void> {
    this.calls.push({ fn: 'applyIdentify', id, args: [r] })
    this.db.prepare('UPDATE assets SET format = ?, plugin = ? WHERE id = ?').run(r?.format ?? 'unknown', r?.pluginId ?? null, id)
  }
  async applyProbe(id: Guid, plugin: string, probe: ProbeResult): Promise<void> {
    this.calls.push({ fn: 'applyProbe', id })
    this.probes.push({ id, plugin, probe })
    this.db.prepare('DELETE FROM tech WHERE asset_id = ?').run(id)
    for (const [k, v] of Object.entries(probe.tech)) {
      this.db.prepare('INSERT INTO tech (asset_id, key, num, txt) VALUES (?, ?, ?, ?)').run(id, k, typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null, typeof v === 'number' ? null : String(v))
    }
    this.db.prepare('INSERT INTO probe (asset_id, plugin, refs_json, text) VALUES (?, ?, ?, ?) ON CONFLICT(asset_id) DO UPDATE SET refs_json = excluded.refs_json, text = excluded.text')
      .run(id, plugin, probe.references ? JSON.stringify(probe.references) : null, probe.text ?? null)
    if (probe.badge) this.db.prepare('UPDATE assets SET badge = ? WHERE id = ?').run(probe.badge, id)
  }
  async applyThumbnails(id: Guid, stored: Partial<Record<ThumbVariant, StoredThumb>>, aspect: number | null): Promise<void> {
    this.calls.push({ fn: 'applyThumbnails', id })
    this.thumbs.push({ id, stored, aspect })
    this.db.prepare("UPDATE assets SET thumb_state = ?, thumb_key = ?, aspect = ? WHERE id = ?").run(stored.thumb ? 'ready' : 'none', stored.thumb?.key ?? null, aspect, id)
  }
  async setThumbState(id: Guid, state: 'pending' | 'render' | 'ready' | 'none' | 'failed'): Promise<void> {
    this.calls.push({ fn: 'setThumbState', id, args: [state] })
    this.db.prepare('UPDATE assets SET thumb_state = ? WHERE id = ?').run(state, id)
  }
  async applyChecks(id: Guid, checks: CheckView[]): Promise<void> { this.calls.push({ fn: 'applyChecks', id }); this.checks.push({ id, checks }) }
  async applyEnrich(id: Guid, plugin: string, r: { tags?: string[]; description?: string }): Promise<void> { this.calls.push({ fn: 'applyEnrich', id, args: [plugin, r] }) }
  async searchDoc(id: Guid): Promise<SearchDoc | null> {
    this.calls.push({ fn: 'searchDoc', id })
    const r = this.row(id)
    return r ? { id, name: r.name, stem: r.name, path: r.path, folder: '', tags: [], autoTags: [], description: '', autoDescription: '', prompts: [], text: '', format: 'x' } : null
  }
  async referencedHashes(id: Guid): Promise<string[]> {
    return this.db.prepare("SELECT a2.hash FROM relations r JOIN assets a2 ON a2.id = r.to_id WHERE r.from_id = ? AND r.type = 'uses'").pluck().all(id) as string[]
  }
  async assetDetail(id: Guid): Promise<AssetDetail | null> {
    const r = this.row(id)
    return r ? ({ id, name: r.name, path: r.path } as unknown as AssetDetail) : null
  }
  async setProcessing(id: Guid, state: { processing: boolean; failed: boolean; error?: string; stage?: PipelineStage }): Promise<void> {
    this.processing.push({ id, ...state })
  }
  async pipelineIssue(id: Guid, stage: PipelineStage, error: string | null): Promise<void> { this.issues.push({ id, stage, error }) }
  async register(req: RegisterRequest, ctx: import('../../contracts.js').PluginRegisterContext) {
    this.registered.push({ req, ctx })
    const id = seedAsset(this.db, { path: `out/${req.name ?? (req.file.kind === 'bytes' ? req.file.name : 'out.bin')}`, batch: ctx.batch ?? null })
    const info = { id, name: req.name ?? 'out', path: 'out' } as never
    return { info }
  }

  fns(id?: string): string[] { return this.calls.filter(c => !id || c.id === id).map(c => c.fn) }
}

export function tmp(prefix = 'bb-pipe-'): string { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }

export function fakeHandle(base: string): LibraryHandle {
  const root = path.join(base, 'library')
  fs.mkdirSync(root, { recursive: true })
  return {
    id: 'lib1', name: 'test',
    paths: { root, metaDir: path.join(root, '.bowerbird'), cacheDir: path.join(root, '.bowerbird', 'cache'), dataDir: path.join(base, 'data'), indexPath: '', tmpDir: path.join(base, 'tmp') },
    libraryJson: () => null, updateLibraryJson: async () => {}, reader: {} as never,
    register: async () => { throw new Error('unused') },
    cache: { put: async () => '', get: async () => null }
  }
}

export interface FormatDef {
  pluginId?: string
  version?: string
  id: string
  ext: string[]
  thumbnail?: 'server' | 'browser' | 'none'
  priority?: number
  handler?: Partial<FormatHandler>
}

export function loaded(defs: FormatDef[]): LoadedFormat[] {
  return defs.map(d => ({
    pluginId: d.pluginId ?? `bowerbird.${d.id}`,
    pluginVersion: d.version ?? '1.0.0',
    contribution: { id: d.id, displayName: d.id, extensions: d.ext, priority: d.priority ?? 0, thumbnail: d.thumbnail ?? 'server' },
    handler: { id: d.id, match: async () => ({ format: d.id }), ...(d.handler ?? {}) } as FormatHandler
  }))
}

/** LibraryPlugins over a list of loaded formats; identify by extension. */
export function pluginsWith(defs: FormatDef[], extra: Partial<LibraryPlugins> & { creatorsList?: Array<{ pluginId: string; pluginName: string; pluginVersion: string; creator: Creator }> } = {}): LibraryPlugins & { invoked: string[] } {
  const formats = loaded(defs)
  const enabled = [...new Map(formats.map(f => [f.pluginId, { id: f.pluginId, version: f.pluginVersion, displayName: f.pluginId }])).values()]
  return fakePlugins({
    formatsList: formats,
    enabled: () => [...enabled, ...(extra.creatorsList ?? []).map(c => ({ id: c.pluginId, version: c.pluginVersion, displayName: c.pluginName }))],
    identify: async file => {
      const f = formats.find(x => x.contribution.extensions.includes(file.ext))
      return f ? { pluginId: f.pluginId, pluginVersion: f.pluginVersion, format: f.contribution.id, thumbnail: f.contribution.thumbnail } : null
    },
    ...extra
  })
}

export { gid, seedAsset }
