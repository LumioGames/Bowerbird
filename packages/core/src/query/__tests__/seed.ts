/** Test helpers: write index rows the way line core-A does (columns of ddl.ts), and a minimal LibraryPlugins fake. */
import type { CreatorEntry, IndexDb, LibraryPlugins, LoadedFormat } from '../../contracts.js'
import type { SearchProvider } from '@bowerbird/plugin-sdk'
import { baseOf, dirOf, splitName } from '@bowerbird/schema'

let counter = 0
/** Deterministic GUID-shaped ids. */
export function gid(n?: number): string {
  const v = n ?? ++counter
  return `00000000-0000-7000-8000-${v.toString(16).padStart(12, '0')}`
}

export interface SeedAsset {
  id?: string
  path: string
  format?: string
  plugin?: string | null
  hash?: string
  size?: number
  stage?: 'reference' | 'production' | 'runtime'
  review?: 'pending' | 'approved' | 'rejected' | 'exempt'
  bundle?: boolean
  auxiliary?: boolean
  missing?: boolean
  created?: string
  createdBy?: string
  modified?: string
  description?: string | null
  autoDescription?: string | null
  method?: string | null
  batch?: string | null
  /** Last actor who changed its information; default: the creator (null with `sidecar: false`). */
  modifiedBy?: string | null
  /** Has a .bmeta (default true). */
  sidecar?: boolean
  thumbState?: string
  thumbKey?: string | null
  aspect?: number | null
  badge?: string | null
  cellTitle?: string | null
  cellExcerpt?: string | null
  flags?: number
  issueLevel?: number
  issueCount?: number
  memberCount?: number
  missingPlugin?: { id: string; range?: string } | null
  tags?: string[]
  aiTags?: string[]
  tech?: Record<string, number | string | boolean>
}

export function seedAsset(db: IndexDb, a: SeedAsset): string {
  const id = a.id ?? gid()
  const name = baseOf(a.path)
  const { base, ext } = splitName(name)
  const created = a.created ?? '2026-11-01T00:00:00.000Z'
  db.prepare(`INSERT INTO assets (id, path, folder, name, stem, ext, format, plugin, hash, size, stage, review, bundle, auxiliary, missing,
      created_at, created_by, modified_at, modified_by, sidecar, description, auto_description, method, batch, thumb_state, thumb_key, aspect, badge,
      cell_title, cell_excerpt, flags, issue_level, issue_count, member_count, missing_plugin, meta_json)
    VALUES (@id, @path, @folder, @name, @stem, @ext, @format, @plugin, @hash, @size, @stage, @review, @bundle, @auxiliary, @missing,
      @created, @createdBy, @modified, @modifiedBy, @sidecar, @description, @autoDescription, @method, @batch, @thumbState, @thumbKey, @aspect, @badge,
      @cellTitle, @cellExcerpt, @flags, @issueLevel, @issueCount, @memberCount, @missingPlugin, @meta)`).run({
    id, path: a.path, folder: dirOf(a.path), name, stem: a.bundle ? name : base, ext: a.bundle ? '' : ext.toLowerCase(),
    format: a.format ?? 'unknown', plugin: a.plugin ?? null, hash: a.hash ?? `sha256:${id.replace(/-/g, '')}`, size: a.size ?? 100,
    stage: a.stage ?? 'production', review: a.review ?? 'pending', bundle: a.bundle ? 1 : 0, auxiliary: a.auxiliary ? 1 : 0,
    missing: a.missing ? 1 : 0, created, createdBy: a.createdBy ?? 'user:lin', modified: a.modified ?? created,
    modifiedBy: a.modifiedBy !== undefined ? a.modifiedBy : a.sidecar === false ? null : (a.createdBy ?? 'user:lin'), sidecar: a.sidecar === false ? 0 : 1,
    description: a.description ?? null, autoDescription: a.autoDescription ?? null, method: a.method ?? null, batch: a.batch ?? null,
    thumbState: a.thumbState ?? 'pending', thumbKey: a.thumbKey ?? null, aspect: a.aspect ?? null, badge: a.badge ?? null,
    cellTitle: a.cellTitle ?? null, cellExcerpt: a.cellExcerpt ?? null, flags: a.flags ?? 0, issueLevel: a.issueLevel ?? 0,
    issueCount: a.issueCount ?? 0, memberCount: a.memberCount ?? 0, missingPlugin: a.missingPlugin ? JSON.stringify(a.missingPlugin) : null,
    meta: JSON.stringify({
      bb: 1, id, hash: a.hash ?? 'sha256:00', stage: a.stage ?? 'production', tags: a.tags ?? [],
      ...(a.aiTags ? { auto: { tags: a.aiTags } } : {}), created: { at: created, by: a.createdBy ?? 'user:lin' }
    })
  })
  const tag = db.prepare('INSERT OR IGNORE INTO tags (asset_id, tag, ai) VALUES (?, ?, ?)')
  for (const t of a.tags ?? []) tag.run(id, t, 0)
  for (const t of a.aiTags ?? []) tag.run(id, t, 1)
  const tech = db.prepare('INSERT INTO tech (asset_id, key, num, txt) VALUES (?, ?, ?, ?)')
  for (const [k, v] of Object.entries(a.tech ?? {})) {
    if (typeof v === 'number') tech.run(id, k, v, null)
    else if (typeof v === 'boolean') tech.run(id, k, v ? 1 : 0, String(v))
    else tech.run(id, k, null, v)
  }
  return id
}

export function seedRelation(db: IndexDb, from: string, type: string, to: string, extra: { slot?: string; role?: string } = {}): void {
  db.prepare('INSERT INTO relations (from_id, type, to_id, slot, role) VALUES (?, ?, ?, ?, ?)').run(from, type, to, extra.slot ?? '', extra.role ?? null)
}

export function seedIssue(db: IndexDb, assetId: string, type: string, level: string): void {
  db.prepare("INSERT INTO issues (id, type, level, asset_id, found_at) VALUES (?, ?, ?, ?, '2026-11-01T00:00:00Z')").run(`${type}:${assetId}`, type, level, assetId)
}


export function seedTrash(db: IndexDb, t: { assetId: string; name: string; originalPath: string; deletedAt?: string; stage?: string; tags?: string[]; format?: string }): void {
  const meta = { bb: 1, id: t.assetId, hash: 'sha256:01', stage: t.stage ?? 'production', tags: t.tags ?? [], created: { at: '2026-10-01T00:00:00Z', by: 'user:lin' } }
  db.prepare(`INSERT INTO trash (id, asset_id, name, original_path, deleted_at, deleted_by, size, format, info_json, meta_json)
    VALUES (?, ?, ?, ?, ?, 'user:lin', 10, ?, '{}', ?)`).run(`t_${t.assetId}`, t.assetId, t.name, t.originalPath, t.deletedAt ?? '2026-11-20T00:00:00Z', t.format ?? 'unknown', JSON.stringify(meta))
}

/** LibraryPlugins with only what the query engine and simple pipeline tests need. */
export function fakePlugins(over: Partial<LibraryPlugins> & { providers?: Array<{ pluginId: string; provider: SearchProvider }>; formatsList?: LoadedFormat[]; creatorsList?: CreatorEntry[] } = {}): LibraryPlugins & { invoked: string[] } {
  const invoked: string[] = []
  const base: LibraryPlugins = {
    enabled: () => [],
    identify: async () => null,
    format: id => (over.formatsList ?? []).find(f => f.contribution.id === id) ?? null,
    formats: () => over.formatsList ?? [],
    missingPluginFor: () => null,
    searchProviders: () => over.providers ?? [],
    enrichers: () => [],
    validators: () => [],
    templates: () => [],
    actions: () => [],
    creators: () => over.creatorsList ?? [],
    creatorInfo: () => [],
    relationTypes: () => [],
    versionStore: () => null,
    auth: () => [],
    routes: () => [],
    invoke: async (pluginId, label, fn) => { invoked.push(`${pluginId}:${label}`); return fn() },
    emitChange: () => {},
    reload: async () => {}
  }
  return Object.assign(base, over, { invoked })
}
