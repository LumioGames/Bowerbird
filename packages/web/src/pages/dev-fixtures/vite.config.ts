/**
 * DEV ONLY (line web-2): `npx vite --config packages/web/src/pages/dev-fixtures/vite.config.ts` serves the shell with a
 * read-mostly fake API built from the sample library fixtures/xingluo (.bmeta files with their provenance, trash, tags), so the
 * detail page, graph, compare and the full pages can be looked at before the real server is merged. The shared
 * components that are still placeholders are swapped for the test stand-ins. Never imported by the app build.
 */
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import base from '../../../vite.config'

const REPO = path.resolve(__dirname, '../../../../..')
const LIB_DIR = path.join(REPO, 'fixtures/xingluo')
const LIB = 'xingluo'
const FORMATS: Record<string, string> = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', glb: 'model', gltf: 'model', fbx: 'model', mp4: 'video', mov: 'video', webm: 'video', wav: 'audio', ogg: 'audio', mp3: 'audio', md: 'doc', txt: 'doc', json: 'doc', html: 'doc' }

type Json = Record<string, any>
function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    if (f === '.bowerbird') continue
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (f.endsWith('.bmeta') && f !== '_folder.bmeta') out.push(p)
  }
  return out
}

function load() {
  const metas = walk(LIB_DIR).map(p => ({ rel: path.relative(LIB_DIR, p).slice(0, -6), m: JSON.parse(fs.readFileSync(p, 'utf8')) as Json }))
  /* a sample library written before ADR-070 still has .bowerbird/records: read them the way the kernel converts them
     (each output gets the record's content as its provenance, outputs of one record share a batch, inputs give roles) */
  const records: Record<string, Json> = {}
  const recDir = path.join(LIB_DIR, '.bowerbird/records')
  if (fs.existsSync(recDir)) for (const y of fs.readdirSync(recDir)) for (const f of fs.readdirSync(path.join(recDir, y))) { const r = JSON.parse(fs.readFileSync(path.join(recDir, y, f), 'utf8')); records[r.id] = r }
  const recOf = (m: Json): string | undefined => m.origin ?? (m.relations ?? []).find((r: Json) => r.type === 'source' && r.record)?.record
  const outputs = new Map<string, number>()
  for (const x of metas) { const r = recOf(x.m); if (r) outputs.set(r, (outputs.get(r) ?? 0) + 1) }
  for (const x of metas) {
    const rid = recOf(x.m), rec = rid ? records[rid] : undefined
    for (const r of x.m.relations ?? []) { const role = rec?.inputs?.find((i: Json) => i.id === r.to)?.role; if (role && !r.role) r.role = role; delete r.record }
    if (rec && !x.m.provenance) {
      const rect = rec.params?.rect
      const params = rect && typeof rect === 'object' && !Array.isArray(rect) ? { ...rec.params, rect: rect[x.m.id] } : rec.params
      x.m.provenance = { method: rec.method, tool: rec.tool, plugin: rec.plugin, prompt: rec.prompt, params, ...((outputs.get(rid!) ?? 0) > 1 ? { batch: `bat_${rid!.slice(4)}` } : {}), by: rec.by, at: rec.at, note: rec.note }
    }
    delete x.m.origin
  }
  const trashDir = path.join(LIB_DIR, '.bowerbird/trash')
  const trash = fs.existsSync(trashDir) ? fs.readdirSync(trashDir).map(id => JSON.parse(fs.readFileSync(path.join(trashDir, id, 'info.json'), 'utf8'))) : []
  const tagsJson = JSON.parse(fs.readFileSync(path.join(LIB_DIR, '.bowerbird/tags.json'), 'utf8'))
  const byId = new Map<string, { rel: string; m: Json }>(metas.map(x => [x.m.id, x]))
  const exists = (rel: string) => fs.existsSync(path.join(LIB_DIR, rel))
  const size = (rel: string) => (exists(rel) ? fs.statSync(path.join(LIB_DIR, rel)).size : 0)
  const review = (m: Json) => (m.review?.status === 'exempt' ? 'exempt' : !m.review || m.review.hash !== m.hash ? 'pending' : m.review.status)
  const summary = (id: string): Json | null => {
    const x = byId.get(id); if (!x) return null
    const { rel, m } = x
    const name = path.basename(rel), ext = name.split('.').pop()!.toLowerCase(), format = FORMATS[ext] ?? 'unknown'
    const flags: string[] = []
    if (!exists(rel)) flags.push('missing')
    if ((m.relations ?? []).some((r: Json) => !byId.has(r.to))) flags.push('broken')
    if ((m.relations ?? []).some((r: Json) => r.type === 'source' && r.toHash && byId.get(r.to)?.m.hash !== r.toHash)) flags.push('stale')
    const members = metas.filter(o => (o.m.relations ?? []).some((r: Json) => r.type === 'belongs' && r.to === id)).length
    return {
      id, name, path: rel, format, plugin: format === 'unknown' ? null : `bowerbird.${format}`, stage: m.stage, review: review(m), tags: m.tags ?? [], autoTags: (m.auto?.tags ?? []).filter((t: string) => !(m.tags ?? []).includes(t)),
      description: m.description ?? null, flags, thumbnail: format === 'image' && exists(rel) ? `/api/v1/libraries/${LIB}/assets/${id}/file` : null, thumbState: 'ready', aspect: 1, badge: null,
      issueLevel: flags.includes('broken') || flags.includes('missing') ? 'error' : flags.includes('stale') ? 'warning' : null, issueCount: flags.length, size: size(rel),
      modified: m.modified?.at ?? m.created.at, created: m.created.at, createdBy: m.created.by, bundle: !!m.bundle, auxiliary: !!m.auxiliary, memberCount: members,
      cellText: format === 'doc' ? { title: name } : null, metaPath: rel + '.bmeta', missingPlugin: ext === 'skel' ? { id: 'community.spine', range: '^1.4.0', displayName: 'Spine' } : null
    }
  }
  const relView = (r: Json, from: string, other: string) => {
    const t = byId.get(r.to)
    const stale = r.type === 'source' && !!t && !!r.toHash && t.m.hash !== r.toHash
    const vs: Json[] = t?.m.versions ?? []
    return {
      type: r.type, from, to: r.to, target: summary(other), targetName: path.basename(byId.get(other)?.rel ?? r.to), targetInTrash: trash.some(x => x.assetId === r.to), slot: r.slot, note: r.note, toHash: r.toHash, role: r.role,
      broken: !t, stale, staleFrom: stale ? vs.findIndex(v => v.hash === r.toHash) + 1 || 1 : undefined, staleTo: stale ? vs.length : undefined
    }
  }
  const detail = (id: string): Json | null => {
    const s = summary(id); if (!s) return null
    const m = byId.get(id)!.m
    const outgoing = (m.relations ?? []).map((r: Json) => relView(r, id, r.to))
    const incoming = metas.flatMap(o => (o.m.relations ?? []).filter((r: Json) => r.to === id).map((r: Json) => relView(r, o.m.id, o.m.id)))
    return {
      ...s, hash: m.hash, descriptionFull: m.description ?? null, auto: m.auto ?? null, fields: m.fields ?? {}, reviewVerdict: m.review ?? null,
      versions: m.versions ?? [{ hash: m.hash, size: s.size, at: m.created.at, by: m.created.by }], views: m.views ?? null, thumbnailManual: false, provenance: m.provenance ?? null,
      modifiedBy: m.modified?.by ?? null, tech: {}, analysis: {}, unresolvedRefs: [], checks: [], relations: { outgoing, incoming }, issues: [],
      bundleFiles: null, targetSize: null, stages: []
    }
  }
  const lineage = (center: string, dir: string, depth: number) => {
    const nodes = new Map<string, Json>(), edges: Json[] = [], missing: Json[] = [], prov: Json = {}
    let frontier = [center]
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: string[] = []
      for (const id of frontier) {
        const pairs = dir === 'up'
          ? (byId.get(id)?.m.relations ?? []).filter((r: Json) => r.type === 'source' || r.type === 'reference').map((r: Json) => ({ from: id, to: r.to, r }))
          : metas.flatMap(o => (o.m.relations ?? []).filter((r: Json) => (r.type === 'source' || r.type === 'reference') && r.to === id).map((r: Json) => ({ from: o.m.id, to: id, r })))
        for (const p of pairs) {
          const other = dir === 'up' ? p.to : p.from
          const t = byId.get(p.to)
          edges.push({ type: p.r.type, from: p.from, to: p.to, slot: p.r.slot, note: p.r.note, broken: !t, stale: p.r.type === 'source' && !!t && !!p.r.toHash && t.m.hash !== p.r.toHash, role: p.r.role })
          if (!byId.has(other)) { missing.push({ id: other, name: null, inTrash: trash.some(x => x.assetId === other) }); continue }
          if (!nodes.has(other)) { nodes.set(other, summary(other)!); next.push(other) }
        }
      }
      frontier = next
    }
    for (const id of [center, ...nodes.keys()]) { const pv = byId.get(id)?.m.provenance; if (pv) prov[id] = pv }
    return { center, nodes: [...nodes.values()], missing, edges, provenance: prov }
  }
  return { metas, byId, trash, tagsJson, summary, detail, lineage, exists }
}

function api(): Plugin {
  const db = load()
  const send = (res: any, body: unknown, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
  const info = () => {
    const lj = JSON.parse(fs.readFileSync(path.join(LIB_DIR, '.bowerbird/library.json'), 'utf8'))
    return { id: LIB, name: lj.name, root: LIB_DIR, state: 'ready', formatVersion: 1, settings: lj.settings, requiredPlugins: Object.entries(lj.plugins).map(([id, range]) => ({ id, range, installed: !id.startsWith('community.'), enabled: !id.startsWith('community.') })),
      stats: { assets: db.metas.length, bytes: 0, issues: 3, issueAssets: 3 }, counts: { all: db.metas.length, untagged: 0, pending: 0, issues: 3, trash: db.trash.length }, isLocal: true, versionStore: null, hasCreators: false, firstOpen: null,
      scan: { running: false, phase: 'done', done: 0, total: 0, finishedAt: new Date(Date.now() - 180000).toISOString() }, lanOpen: false, address: 'http://127.0.0.1:7420' }
  }
  const all = () => db.metas.map(x => db.summary(x.m.id)!)
  const issues = () => {
    const out: Json[] = []
    for (const x of db.metas) {
      const s = db.summary(x.m.id)!
      for (const r of x.m.relations ?? []) {
        if (!db.byId.has(r.to)) out.push({ id: `br:${x.m.id}:${r.to}`, type: 'broken-reference', level: 'error', assetId: x.m.id, relation: { type: r.type, to: r.to, slot: r.slot }, details: { toName: r.slot ?? r.to, inTrash: db.trash.some(t => t.assetId === r.to) }, foundAt: new Date(Date.now() - 2 * 86400000).toISOString() })
        else if (r.type === 'source' && r.toHash && db.byId.get(r.to)!.m.hash !== r.toHash) out.push({ id: `st:${x.m.id}:${r.to}`, type: 'stale-upstream', level: 'warning', assetId: x.m.id, relation: { type: r.type, to: r.to }, details: { toName: path.basename(db.byId.get(r.to)!.rel), fromVersion: 1, toVersion: 2 }, foundAt: new Date(Date.now() - 4 * 86400000).toISOString() })
      }
      if (s.flags.includes('missing')) out.push({ id: `mf:${x.m.id}`, type: 'missing-file', level: 'error', assetId: x.m.id, path: x.rel, details: {}, foundAt: new Date(Date.now() - 7 * 86400000).toISOString() })
      if (s.missingPlugin) out.push({ id: `pm:${x.m.id}`, type: 'plugin-missing', level: 'warning', assetId: x.m.id, details: { plugin: 'community.spine', range: '^1.4.0', displayName: 'Spine' }, foundAt: new Date().toISOString() })
    }
    out.push({ id: 'dup1', type: 'duplicate-content', level: 'info', assetId: db.metas[3]!.m.id, details: { otherName: 'ui/hud/panel_bg.png' }, foundAt: new Date(Date.now() - 5 * 86400000).toISOString() })
    const assets: Json = {}
    for (const i of out) if (i.assetId) assets[i.assetId] = db.summary(i.assetId)
    return { issues: out, assets, assetCount: Object.keys(assets).length, total: out.length }
  }
  const plugin = (id: string, name: string, exts: string[], o: Json = {}) => ({ id, packageName: `@bowerbird/plugin-${id.split('.')[1]}`, version: '0.1.0', displayName: name, builtin: true, status: 'enabled', contributes: ['formats'], formats: exts.length ? [{ id: id.split('.')[1], displayName: name, extensions: exts }] : [], hasWeb: true, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'builtin', ...o })
  const plugins = [plugin('bowerbird.image', '图片', ['.png', '.jpg', '.webp']), plugin('bowerbird.model', '3D 模型', ['.glb', '.gltf', '.fbx']), plugin('bowerbird.doc', '文档', ['.md', '.json']),
    plugin('community.forge', 'Forge', [], { builtin: false, source: 'npm', packageName: '@community/forge', version: '0.4.0', contributes: ['creators'], missingTools: ['forge-cli'], consecutiveFailures: { count: 3, reason: '服务没有响应（503）' }, settings: { type: 'object', properties: { quota: { type: 'integer', title: '本月额度', minimum: 1, scope: 'library' }, apiKey: { type: 'string', title: 'API Key', format: 'password' } } } }),
    plugin('community.psd', 'PSD 分层', [], { builtin: false, source: 'npm', status: 'failed', reason: '这个插件需要更新版本的 Bowerbird（2.x），现在是 1.4' })]
  return {
    name: 'bb-dev-fixtures',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x')
        if (!url.pathname.startsWith('/api/v1')) return next()
        const p = url.pathname.slice(7)
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
          const L = `/libraries/${LIB}`
          const m = (re: RegExp) => re.exec(p)
          let x: RegExpExecArray | null
          if (p === '/libraries') return send(res, { libraries: [info()], defaultId: LIB })
          if (p === L && req.method === 'GET') return send(res, info())
          if (p === L) return send(res, info())
          if (p === '/config') return send(res, { config: { host: '127.0.0.1', port: 7420, libraries: [], cacheDirs: {}, scanIntervalMinutes: 10, allowedOrigins: [], plugins: {}, installed: [] }, dataDir: '~/.bowerbird', restartRequired: req.method !== 'GET' })
          if (p === '/plugins') return send(res, { plugins })
          if ((x = m(/^\/plugins\/([^/]+)\/settings$/))) return send(res, { values: {}, schema: null })
          if (p === `${L}/plugins/community.forge/settings`) return send(res, { values: { quota: 200 }, schema: null })
          if (p === `${L}/search`) {
            const q = JSON.parse(body || '{}'), f = q.filter ?? {}
            let items = all()
            if (f.review) items = items.filter(a => f.review.includes(a.review))
            if (f.relation) items = items.filter(a => (db.byId.get(a.id)!.m.relations ?? []).some((r: Json) => r.type === f.relation.type && r.to === f.relation.to))
            if (f.folder) items = items.filter(a => a.path.startsWith(f.folder + '/'))
            if (f.format) items = items.filter(a => f.format.includes(a.format))
            if (f.batch) items = items.filter(a => db.byId.get(a.id)!.m.provenance?.batch === f.batch)
            return send(res, { items, total: items.length, cursor: null })
          }
          if ((x = m(/^\/libraries\/[^/]+\/assets\/([^/]+)$/))) { const d = db.detail(x[1]!); return d ? send(res, d) : send(res, { error: { code: 'not_found', message: 'not found' } }, 404) }
          if ((x = m(/^\/libraries\/[^/]+\/assets\/([^/]+)\/versions$/))) { const d = db.detail(x[1]!)!; return send(res, { versions: d.versions.map((v: Json, i: number, a: Json[]) => ({ ...v, n: i + 1, current: i === a.length - 1, hasContent: i === a.length - 1 })), store: null }) }
          if ((x = m(/^\/libraries\/[^/]+\/assets\/([^/]+)\/lineage$/))) return send(res, db.lineage(x[1]!, url.searchParams.get('direction') ?? 'up', Number(url.searchParams.get('depth') ?? 5)))
          if ((x = m(/^\/libraries\/[^/]+\/assets\/([^/]+)\/file$/))) { const r = db.byId.get(x[1]!); if (!r || !db.exists(r.rel)) { res.statusCode = 404; return res.end() } return fs.createReadStream(path.join(LIB_DIR, r.rel)).pipe(res) }
          if (p === `${L}/issues`) return send(res, issues())
          if ((x = m(/^\/libraries\/[^/]+\/issues\/([^/]+)\/candidates$/))) return send(res, { candidates: [{ path: 'characters/hero/_old/hero_idle.fbx', size: 1, sameContent: false, similarity: 0.9, reason: '同名 · 内容改过，可能是重新导出的' }, { path: 'characters/hero/export/hero_idle_v2.fbx', size: 1, sameContent: false, similarity: 0.6, reason: '名字相近 · 2 天前出现' }] })
          if (p === `${L}/trash`) {
            const now = Date.now()
            return send(res, { trashDays: 7, items: db.trash.map(t => ({ id: t.id, assetId: t.assetId, name: t.name, originalPath: t.originalPath, folder: path.dirname(t.originalPath), format: FORMATS[t.name.split('.').pop()!] ?? 'unknown', stage: 'runtime', review: 'approved', size: 1, thumbnail: null, deletedAt: t.deletedAt, deletedBy: t.deletedBy, daysLeft: Math.max(0, 7 - Math.floor((now - Date.parse(t.deletedAt)) / 86400000)), referencedBy: 1, recordOnly: false })) })
          }
          if (p === `${L}/tags`) {
            const counts = new Map<string, number>(), ai = new Map<string, number>()
            for (const x2 of db.metas) { for (const t of x2.m.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1); for (const t of x2.m.auto?.tags ?? []) if (!(x2.m.tags ?? []).includes(t)) ai.set(t, (ai.get(t) ?? 0) + 1) }
            const names = new Set([...counts.keys(), ...ai.keys()])
            return send(res, { groups: db.tagsJson.groups, tags: [...names].map(n => ({ name: n, count: counts.get(n) ?? 0, aiCount: ai.get(n) ?? 0, ...(db.tagsJson.tags[n] ?? {}) })) })
          }
          if (p === `${L}/jobs`) {
            const st = (stage: string, queued: number, rate: number, idle = false) => ({ stage, queued, running: 0, done: 10, failed: 0, skipped: 0, rate, idle })
            return send(res, { stages: [st('identify', 0, 0), st('probe', 2, 42), st('derive', 0, 0), st('thumbnail', 3, 18), st('summary', 1, 30), st('enrich', 0, 0, true), st('validate', 0, 0), st('index', 0, 0)], waitingRender: 2, busy: 3,
              scan: info().scan, creates: [], processing: [],
              failed: [{ id: 'j1', kind: 'process', stage: 'thumbnail', assetName: 'theme_town.ogg', status: 'failed', error: '读取超时', retryable: true, attempts: 1, outputs: [], createdAt: '', updatedAt: '' },
                { id: 'j2', kind: 'process', stage: 'thumbnail', assetName: 'intro_cutscene.mov', status: 'failed', error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', retryable: false, attempts: 1, outputs: [], createdAt: '', updatedAt: '' },
                { id: 'j3', kind: 'process', stage: 'identify', assetName: 'hero_run.skel', status: 'failed', error: '需要 Spine 插件', retryable: false, attempts: 1, outputs: [], createdAt: '', updatedAt: '' }] })
          }
          if (p === `${L}/cache`) return send(res, { bytes: 1.8e9, files: 1200, dir: '.bowerbird/cache', inLibrary: true })
          if (p === `${L}/vocabulary`) return send(res, { stages: [], reviews: [], formats: [{ id: 'image', displayName: '图片', plugin: 'bowerbird.image', count: 40 }, { id: 'model', displayName: '模型', plugin: 'bowerbird.model', count: 8 }], relationTypes: [], tags: [], methods: [], actors: [], templates: [], designObjects: [] })
          if (p === `${L}/folders`) return send(res, { root: { path: '', name: '', count: 0, modified: null, effectiveDefaults: { from: {} }, children: ['props', 'characters', 'ui', 'environments'].map(n => ({ path: n, name: n, count: 5, modified: null, effectiveDefaults: { from: {} }, children: [] })) } })
          if (p.endsWith('/events')) { res.setHeader('content-type', 'text/event-stream'); return }
          return send(res, {})
        })
      })
    }
  }
}

const stand = path.resolve(__dirname, '../shared/test/components.tsx')
export default mergeConfig(base, defineConfig({
  root: path.resolve(__dirname, '../../..'),
  plugins: [api()],
  resolve: { alias: [{ find: /^.*\/components\/(PageFrame|Banner|EmptyState|marks|AssetThumb)$/, replacement: stand }] },
  server: { port: 5179, proxy: {} }
}))
