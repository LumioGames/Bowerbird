import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginPackageJson, RESERVED_PLUGIN_PATHS, SUPPORTED_API_VERSIONS, type PluginManifest } from '@bowerbird/schema'
import type { AssetFile, FileRef, FormatHandler, IdSet, ProbeResult, ScoredHit, SearchDoc, SearchProvider, ServerPlugin, ThumbnailSet } from '../server.js'
import { createTestContext, type TestContext, type TestContextOptions } from './context.js'
import { settleWithin, type Settled } from './limits.js'

export interface LoadedPlugin {
  dir: string
  manifest: PluginManifest
  packageName: string
  version: string
  ctx: TestContext
  plugin: ServerPlugin | null
  /** The server entry that was imported (built file or TypeScript source). */
  entry: string | null
}

export interface LoadOptions extends TestContextOptions {
  /**
   * Which server entry to import: the built file named in the manifest (`dist`), the TypeScript source next to it
   * (`src`: `./dist/server.js` → `src/server.ts`, so tests run without a build — needs a TypeScript-aware loader
   * such as Vitest), or `auto` (default): the source under Vitest when it exists, else the built file, else the source.
   */
  source?: 'auto' | 'src' | 'dist'
}

/** `./dist/server.js` → `<dir>/src/server.ts`. */
export function sourceEntryFor(dir: string, built: string): string {
  const rel = built.replace(/^\.\//, '').replace(/^dist\//, 'src/').replace(/\.m?js$/, '.ts')
  return path.resolve(dir, rel)
}

function pickEntry(dir: string, built: string, source: LoadOptions['source']): string {
  const dist = path.resolve(dir, built), src = sourceEntryFor(dir, built)
  if (source === 'dist') return dist
  if (source === 'src') return src
  const underVitest = !!process.env.VITEST
  if (underVitest && fs.existsSync(src)) return src
  if (fs.existsSync(dist)) return dist
  return src
}

/** Read and validate a plugin's package.json manifest; import and activate its server entry with a test context. */
export async function loadPluginForTest(dir: string, opts: LoadOptions = {}): Promise<LoadedPlugin> {
  const pkg = PluginPackageJson.parse(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')))
  const manifest = pkg.bowerbird
  if (!SUPPORTED_API_VERSIONS.includes(manifest.apiVersion)) throw new Error(`unsupported apiVersion ${manifest.apiVersion}`)
  const { source, ...ctxOpts } = opts
  const ctx = createTestContext({ pluginId: manifest.id, pluginVersion: pkg.version, ...ctxOpts })
  let plugin: ServerPlugin | null = null
  let entry: string | null = null
  if (manifest.server) {
    entry = pickEntry(dir, manifest.server, source)
    if (!fs.existsSync(entry)) throw new Error(`server entry not found: ${entry}`)
    const mod = await import(pathToFileURL(entry).href)
    plugin = (mod.default ?? mod.plugin) as ServerPlugin
    if (!plugin || typeof plugin.activate !== 'function') throw new Error('server entry must default-export { activate }')
    await plugin.activate(ctx)
  }
  return { dir, manifest, packageName: pkg.name, version: pkg.version, ctx, plugin, entry }
}

const HEAD_BYTES = 64 * 1024

export function fileRefFor(absPath: string, libraryPath = path.basename(absPath)): FileRef {
  const st = fs.statSync(absPath)
  const bundle = st.isDirectory()
  let head = new Uint8Array()
  if (!bundle) {
    const fd = fs.openSync(absPath, 'r')
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, st.size))
    fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    head = new Uint8Array(buf)
  }
  const name = path.basename(absPath)
  return { absPath, path: libraryPath, name, ext: bundle ? '' : path.extname(name).toLowerCase(), size: bundle ? 0 : st.size, bundle, head }
}

/** An AssetFile over a real file; slots resolve to sibling files of the same name unless `slots` maps them. */
export function assetFileFor(absPath: string, extra: Partial<AssetFile> & { slots?: Record<string, string> } = {}): AssetFile {
  const ref = fileRefFor(absPath)
  const { slots: slotMap, ...rest } = extra
  const slots = slotMap ?? {}
  return {
    ...ref,
    id: '00000000-0000-7000-8000-000000000000',
    hash: 'sha256:00',
    stage: 'production',
    tech: {},
    views: null,
    relations: [],
    designObject: null,
    read: async () => new Uint8Array(fs.readFileSync(absPath)),
    readSlot: async (slot: string) => {
      const p = slots[slot] ?? path.join(path.dirname(absPath), slot)
      return fs.existsSync(p) && fs.statSync(p).isFile() ? new Uint8Array(fs.readFileSync(p)) : null
    },
    ...rest
  }
}

/* ───────────── format contract ───────────── */

export interface FormatSample {
  /** Absolute path of the sample file (or bundle folder). */
  file: string
  /** Expected format id; null = no handler of this plugin should claim it. */
  format: string | null
  /** Tech keys that must be present after probe. */
  techKeys?: string[]
  /** Tech values that must match (numbers within 1 %, strings and booleans exactly). */
  tech?: Record<string, number | string | boolean>
  /** Expected grid badge. */
  badge?: string | RegExp
  /** Slot names the probe must report. */
  references?: string[]
  /** The probe's searchable text must match. */
  text?: string | RegExp
  /** The summary text must match. */
  summary?: string | RegExp
  /** Server thumbnail variants that must be present (for `thumbnail: server`). */
  thumbnails?: Array<keyof ThumbnailSet>
  /** Exact long edge of `thumb` / `preview` in pixels (both are also checked against 512 / 2048 always). */
  thumbEdge?: number
  previewEdge?: number
  /** Extra AssetFile fields (views, designObject…) for this sample. */
  asset?: Partial<AssetFile>
}

export interface FormatSampleResult {
  file: string
  handler: string | null
  probe: ProbeResult | null
  thumbnails: Partial<Record<keyof ThumbnailSet, number>>
  /** Bytes of `thumb` (0 when none). */
  thumbnailBytes: number
  summary: string | null
}

/** Pixel size from a WebP header (VP8, VP8L or VP8X), or null. */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (!isWebp(b) || b.length < 30) return null
  const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (tag === 'VP8X') return { width: 1 + (b[24]! | b[25]! << 8 | b[26]! << 16), height: 1 + (b[27]! | b[28]! << 8 | b[29]! << 16) }
  if (tag === 'VP8L') { const bits = dv.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 } }
  if (tag === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
  return null
}

/** Largest long edge of each image variant (pipeline-and-cache.md「规格」). */
export const VARIANT_EDGES: Readonly<Partial<Record<keyof ThumbnailSet, number>>> = { thumb: 512, preview: 2048, poster: 1024 }

export function isWebp(b: Uint8Array): boolean {
  return b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
}

function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg) }
const matches = (v: string, want: string | RegExp) => (typeof want === 'string' ? v === want : want.test(v))

/** The handler that claims a file, the way the kernel picks it: extension pre-filter (all handlers for bundles), priority, match(). */
export async function identify(loaded: Pick<LoadedPlugin, 'manifest' | 'ctx'>, ref: FileRef): Promise<FormatHandler | null> {
  const declared = [...(loaded.manifest.contributes.formats ?? [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  const handlers = loaded.ctx.registered.formats
  const candidates = declared.filter(f => ref.bundle || f.extensions.includes(ref.ext)).map(f => handlers.find(h => h.id === f.id)).filter(Boolean) as FormatHandler[]
  for (const h of candidates) {
    const m = await h.match(ref)
    if (!m) continue
    assert(m.format === h.id, `match() of ${h.id} returned format ${m.format}`)
    if (m.confidence !== undefined) assert(m.confidence >= 0 && m.confidence <= 1, `match() of ${h.id} returned confidence ${m.confidence} outside 0..1`)
    return h
  }
  return null
}

function checkThumbnails(name: string, set: ThumbnailSet, expect: Array<keyof ThumbnailSet> = [], edges: { thumb?: number; preview?: number } = {}): Partial<Record<keyof ThumbnailSet, number>> {
  assert(set.thumb && isWebp(set.thumb), `${name}: thumbnail.thumb must be WebP`)
  assert(typeof set.aspect === 'number' && set.aspect > 0 && Number.isFinite(set.aspect), `${name}: thumbnail.aspect must be > 0`)
  const out: Partial<Record<keyof ThumbnailSet, number>> = {}
  for (const k of ['thumb', 'preview', 'poster', 'scrub', 'turnaround'] as const) {
    const b = set[k]
    if (!b) continue
    assert(isWebp(b), `${name}: thumbnail.${k} must be WebP`)
    const max = VARIANT_EDGES[k], size = webpSize(b)
    if (max) {
      assert(size, `${name}: thumbnail.${k} has an unreadable WebP header`)
      const edge = Math.max(size.width, size.height)
      assert(edge <= max, `${name}: thumbnail.${k} long edge ${edge} exceeds ${max}`)
      const want = k === 'thumb' ? edges.thumb : k === 'preview' ? edges.preview : undefined
      if (want !== undefined) assert(edge === want, `${name}: thumbnail.${k} long edge is ${edge}, expected ${want}`)
    }
    out[k] = b.length
  }
  if (set.peaks) {
    let ok = false
    try { JSON.parse(new TextDecoder().decode(set.peaks)); ok = true } catch { /* below */ }
    assert(ok, `${name}: thumbnail.peaks must be JSON`)
    out.peaks = set.peaks.length
  }
  for (const k of expect) assert(set[k], `${name}: thumbnail.${k} missing`)
  return out
}

/**
 * The shared format contract (engineering.md「插件契约」): manifest and registrations agree; every sample is
 * identified by the right handler; probe returns well-formed tech info; server thumbnails are WebP with an aspect
 * (peaks JSON); browser- and none-thumbnail formats do not implement `thumbnail()`; summaries are text.
 * Throws on the first violation.
 */
export async function runFormatContract(loaded: LoadedPlugin, samples: FormatSample[]): Promise<FormatSampleResult[]> {
  const declared = loaded.manifest.contributes.formats ?? []
  const handlers = loaded.ctx.registered.formats
  for (const h of handlers) assert(declared.some(f => f.id === h.id), `handler ${h.id} not declared in manifest contributes.formats`)
  for (const f of declared) assert(handlers.some(h => h.id === f.id) || !loaded.manifest.server, `format ${f.id} declared but no handler registered`)
  const results: FormatSampleResult[] = []
  for (const s of samples) {
    const ref = fileRefFor(s.file)
    const handler = await identify(loaded, ref)
    if (s.format === null) {
      assert(!handler, `${ref.name} should not be claimed, but ${handler?.id} did`)
      results.push({ file: s.file, handler: null, probe: null, thumbnails: {}, thumbnailBytes: 0, summary: null })
      continue
    }
    assert(handler, `${ref.name}: no handler claimed it (expected ${s.format})`)
    assert(handler.id === s.format, `${ref.name}: claimed by ${handler.id}, expected ${s.format}`)
    const af = assetFileFor(s.file, s.asset)
    let probe: ProbeResult | null = null
    if (handler.probe) {
      probe = await handler.probe(af)
      assert(probe && typeof probe.tech === 'object', `${ref.name}: probe must return { tech }`)
      for (const [k, v] of Object.entries(probe.tech)) {
        assert(['number', 'string', 'boolean'].includes(typeof v), `${ref.name}: tech.${k} must be number|string|boolean`)
        if (typeof v === 'number') assert(Number.isFinite(v), `${ref.name}: tech.${k} must be finite`)
      }
      for (const k of s.techKeys ?? []) assert(k in probe.tech, `${ref.name}: tech.${k} missing`)
      for (const [k, want] of Object.entries(s.tech ?? {})) {
        const got = probe.tech[k]
        if (typeof want === 'number') assert(typeof got === 'number' && Math.abs(got - want) <= Math.max(1e-6, Math.abs(want) * 0.01), `${ref.name}: tech.${k} is ${got}, expected ${want}`)
        else assert(got === want, `${ref.name}: tech.${k} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
      }
      if (probe.references) assert(Array.isArray(probe.references) && probe.references.every(r => typeof r === 'string' && r.length > 0), `${ref.name}: references must be non-empty strings`)
      for (const r of s.references ?? []) assert(probe.references?.includes(r), `${ref.name}: reference ${r} missing`)
      if (probe.badge !== undefined) assert(typeof probe.badge === 'string', `${ref.name}: badge must be a string`)
      if (s.badge !== undefined) assert(probe.badge !== undefined && matches(probe.badge, s.badge), `${ref.name}: badge is ${JSON.stringify(probe.badge)}, expected ${String(s.badge)}`)
      if (probe.text !== undefined) assert(typeof probe.text === 'string', `${ref.name}: text must be a string`)
      if (s.text !== undefined) assert(probe.text !== undefined && (typeof s.text === 'string' ? probe.text.includes(s.text) : s.text.test(probe.text)), `${ref.name}: text does not match ${String(s.text)}`)
      if (probe.aspect !== undefined) assert(probe.aspect > 0 && Number.isFinite(probe.aspect), `${ref.name}: aspect must be > 0`)
      if (probe.analysis !== undefined) {
        let json = ''
        try { json = JSON.stringify(probe.analysis) } catch { /* below */ }
        assert(json && json.startsWith('{'), `${ref.name}: analysis must be a JSON object`)
      }
      af.tech = probe.tech
    }
    let thumbnails: Partial<Record<keyof ThumbnailSet, number>> = {}
    const fmt = declared.find(f => f.id === handler.id)!
    if (fmt.thumbnail === 'server') {
      assert(handler.thumbnail, `${handler.id}: thumbnail 'server' declared but thumbnail() missing`)
      thumbnails = checkThumbnails(ref.name, await handler.thumbnail(af), s.thumbnails, { thumb: s.thumbEdge, preview: s.previewEdge })
    } else {
      assert(!handler.thumbnail, `${handler.id}: thumbnail '${fmt.thumbnail}' declared but implements server thumbnail()`)
    }
    let summary: string | null = null
    if (handler.summarize) {
      const t = await handler.summarize(af)
      assert(typeof t.text === 'string' && t.text.length > 0, `${ref.name}: summary text empty`)
      summary = t.text
    }
    if (s.summary !== undefined) assert(summary !== null && (typeof s.summary === 'string' ? summary.includes(s.summary) : s.summary.test(summary)), `${ref.name}: summary does not match ${String(s.summary)}`)
    results.push({ file: s.file, handler: handler.id, probe, thumbnails, thumbnailBytes: thumbnails.thumb ?? 0, summary })
  }
  return results
}

/* ───────────── hostile input ───────────── */

export interface HostileOutcome {
  file: string
  handler: string | null
  /** Per stage: settled with a value (ok) or a clean rejection, and how long it took. */
  stages: Partial<Record<'match' | 'probe' | 'thumbnail' | 'summarize', Settled<unknown>>>
}

/**
 * Malformed and malicious files (truncated, oversized length fields, impossible parameters, decompression bombs,
 * deep nesting): identification and every stage of the claiming handler must settle — return or reject
 * cleanly — within `ms` each. Throws TimeLimitError on the first that does not. Rejections are fine.
 */
export async function runHostileContract(loaded: LoadedPlugin, files: string[], ms = 5000): Promise<HostileOutcome[]> {
  const out: HostileOutcome[] = []
  for (const file of files) {
    const ref = fileRefFor(file)
    const res: HostileOutcome = { file, handler: null, stages: {} }
    const m = await settleWithin(ms, () => identify(loaded, ref), `${ref.name}: match`)
    res.stages.match = m
    const handler = m.ok ? m.value : null
    if (handler) {
      res.handler = handler.id
      const af = assetFileFor(file)
      for (const stage of ['probe', 'thumbnail', 'summarize'] as const) {
        const fn = handler[stage] as ((a: typeof af) => Promise<unknown>) | undefined
        if (fn) res.stages[stage] = await settleWithin(ms, () => fn.call(handler, af), `${ref.name}: ${stage}`)
      }
    }
    out.push(res)
  }
  return out
}

/* ───────────── registrations ───────────── */

const RUNTIME_POINTS = [
  ['formats', 'formats'], ['searchProviders', 'searchProviders'], ['enrichers', 'enrichers'], ['sources', 'sources'],
  ['creators', 'creators'], ['validators', 'validators'], ['templates', 'templates'], ['actions', 'actions'], ['auth', 'auth']
] as const

export interface RegistrationReport { [point: string]: string[] }

/**
 * Manifest and `activate()` agree (plugin-system.md「清单」: the kernel decides from the manifest only): every
 * declared extension point is registered with the same ids, nothing undeclared is registered, ids are unique,
 * and routes stay off the kernel's reserved paths. Returns the registered ids per extension point.
 */
export function runRegistrationContract(loaded: LoadedPlugin): RegistrationReport {
  const c = loaded.manifest.contributes as Record<string, Array<{ id: string }> | undefined>
  const report: RegistrationReport = {}
  for (const [key, reg] of RUNTIME_POINTS) {
    const declared = (c[key] ?? []).map(x => x.id)
    const got = (loaded.ctx.registered[reg] as Array<{ id: string }>).map(x => x.id)
    assert(new Set(got).size === got.length, `${key}: duplicate registration ids ${got.join(', ')}`)
    for (const id of declared) assert(got.includes(id), `${key}: ${id} declared in the manifest but not registered by activate()`)
    for (const id of got) assert(declared.includes(id), `${key}: ${id} registered but not declared in the manifest`)
    if (got.length) report[key] = got
  }
  for (const cr of loaded.ctx.registered.creators) {
    assert(typeof cr.run === 'function' && typeof cr.displayName === 'string' && cr.displayName, `creator ${cr.id}: needs displayName and run()`)
    assert(cr.params && typeof cr.params === 'object', `creator ${cr.id}: params must be a JSON Schema object`)
    assert(Array.isArray(cr.inputs) && cr.inputs.every(i => typeof i.role === 'string' && typeof i.required === 'boolean'), `creator ${cr.id}: inputs must list { role, required }`)
  }
  for (const v of loaded.ctx.registered.validators) assert(typeof v.appliesTo === 'function' && typeof v.check === 'function', `validator ${v.id}: needs appliesTo() and check()`)
  for (const r of loaded.ctx.registered.routes) {
    const first = r.path.replace(/^\//, '').split('/')[0] ?? ''
    assert(!(RESERVED_PLUGIN_PATHS as readonly string[]).includes(first), `route ${r.path}: '${first}' is reserved by the kernel`)
  }
  if (loaded.ctx.registered.routes.length) report.routes = loaded.ctx.registered.routes.map(r => `${r.method} ${r.path}`)
  return report
}

/* ───────────── search providers ───────────── */

export function idSetOf(ids: Iterable<string>): IdSet {
  const s = new Set(ids)
  return { has: id => s.has(id), get size() { return s.size }, [Symbol.iterator]: () => s[Symbol.iterator]() }
}

const SID = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
function sdoc(n: number, over: Partial<SearchDoc>): SearchDoc {
  const name = over.name ?? `asset_${n}.png`
  return {
    id: SID(n), name, stem: name.replace(/\.[^.]+$/, ''), path: `${over.folder ?? 'misc'}/${name}`, folder: 'misc',
    tags: [], autoTags: [], description: '', autoDescription: '', prompts: [], text: '', format: 'image', ...over
  }
}

/** Sample documents of the search contract, by role. */
export const SEARCH_CONTRACT_DOCS = {
  name: sdoc(1, { name: 'treasure_chest.glb', format: 'model' }),
  tag: sdoc(2, { tags: ['宝箱', 'treasure'] }),
  description: sdoc(3, { description: '一个红色的卡通宝箱，黄铜包边' }),
  prompt: sdoc(4, { prompts: ['low poly treasure chest with warm light'] }),
  body: sdoc(5, { name: 'notes.md', format: 'doc', text: 'The treasure room is behind the waterfall.' }),
  folder: sdoc(6, { folder: 'props/treasure', path: 'props/treasure/lid.png', name: 'lid.png' }),
  other: sdoc(7, { name: 'lantern.png', description: '提灯，暖光' })
}

export interface SearchContractOptions {
  /** Whether terms under three characters must match by substring (keyword search: yes). */
  shortTerms?: boolean
}

/**
 * The shared search-provider contract (plugin-system.md「搜索」): index → query finds what it should, scores are
 * sorted, `limit` and `candidates` are honoured, snippets have valid highlight ranges, updates replace,
 * `remove` and `clear` forget. Uses `SEARCH_CONTRACT_DOCS`. Returns the hits of the main query.
 */
export async function runSearchProviderContract(provider: SearchProvider, opts: SearchContractOptions = {}): Promise<ScoredHit[]> {
  const D = SEARCH_CONTRACT_DOCS
  const all = Object.values(D)
  await provider.clear?.()
  await provider.index(all)
  const hits = await provider.query('treasure', { limit: 50 })
  const got = hits.map(h => h.id)
  for (const d of [D.name, D.tag, D.prompt, D.body, D.folder]) assert(got.includes(d.id), `query 'treasure' misses ${d.name} (${d.id})`)
  assert(!got.includes(D.other.id), `query 'treasure' returned an unrelated document`)
  assert(new Set(got).size === got.length, 'query returned duplicate ids')
  for (let i = 1; i < hits.length; i++) assert(hits[i - 1]!.score >= hits[i]!.score, 'hits must be sorted by score, best first')
  assert(got.indexOf(D.name.id) < got.indexOf(D.body.id), 'a name hit must rank above a body-text hit')
  for (const h of hits) {
    assert(typeof h.score === 'number' && Number.isFinite(h.score), `hit ${h.id}: score must be a finite number`)
    if (!h.snippet) continue
    assert(['prompt', 'description', 'text', 'tags', 'path', 'name'].includes(h.snippet.field), `hit ${h.id}: bad snippet field ${h.snippet.field}`)
    for (const [a, b] of h.snippet.ranges) assert(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a < b && b <= h.snippet.text.length, `hit ${h.id}: bad highlight range [${a}, ${b}]`)
  }
  // Highlights cover exactly the query word (case and width folded), never a neighbour.
  const foldText = (x: string) => x.normalize('NFKC').toLowerCase()
  for (const h of hits) for (const [a, b] of h.snippet?.ranges ?? []) assert(foldText(h.snippet!.text.slice(a, b)) === 'treasure', `hit ${h.id}: highlight "${h.snippet!.text.slice(a, b)}" is not the query word`)
  // A full file name (with extension) finds that asset first.
  const byName = await provider.query(D.name.name, { limit: 5 })
  assert(byName[0]?.id === D.name.id, `query '${D.name.name}' must return ${D.name.name} first`)
  const prompt = hits.find(h => h.id === D.prompt.id)
  assert(prompt?.snippet?.field === 'prompt', 'a hit only in a prompt must come with a prompt snippet')
  assert((await provider.query('卡通宝箱', { limit: 10 })).some(h => h.id === D.description.id), 'Chinese text must be found inside a description')
  if (opts.shortTerms) {
    const short = (await provider.query('宝箱', { limit: 10 })).map(h => h.id)
    assert(short.includes(D.tag.id) && short.includes(D.description.id), 'a two-character term must match by substring')
  }
  assert((await provider.query('treasure', { limit: 2 })).length === 2, 'limit must be honoured')
  const only = (await provider.query('treasure', { limit: 50, candidates: idSetOf([D.body.id, D.other.id]) })).map(h => h.id)
  assert(only.length === 1 && only[0] === D.body.id, 'query must return only hits inside the candidate set')
  assert((await provider.query('treasure', { limit: 50, candidates: idSetOf([]) })).length === 0, 'an empty candidate set returns nothing')
  assert((await provider.query('zzqxjv', { limit: 10 })).length === 0, 'a query with no match returns nothing')
  await provider.index([{ ...D.body, text: 'Nothing of value here.' }])
  assert(!(await provider.query('treasure', { limit: 50 })).some(h => h.id === D.body.id), 're-indexing a document must replace its old text')
  await provider.remove([D.name.id])
  assert(!(await provider.query('treasure', { limit: 50 })).some(h => h.id === D.name.id), 'remove() must drop the document')
  if (provider.clear) {
    await provider.clear()
    assert((await provider.query('treasure', { limit: 50 })).length === 0, 'clear() must drop everything')
  }
  return hits
}
