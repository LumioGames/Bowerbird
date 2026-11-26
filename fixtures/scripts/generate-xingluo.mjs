#!/usr/bin/env node
// Generates fixtures/xingluo/ — the sample library「星落镇」— from the prototype's data (design/prototype/data.js,
// pages.js trash seeds, viewers.js documents). Every file is produced here: images drawn with sharp from the
// prototype's SVG drawings, models built with three.js and written as GLB / ASCII FBX, audio synthesised, video
// encoded with the local ffmpeg, documents written as text. Output is deterministic (fixed seeds and timestamps).
//
//   node scripts/generate-xingluo.mjs [--out <dir>] [--skip-verify]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  serializeBmeta, serializeFolderMeta, serializeRecord, serializeJson, Bmeta, FolderMeta, LibraryJson, TagsJson,
  ProductionRecord, TrashInfo, SmartViewFile
} from '@bowerbird/schema'
import { loadPrototype, artSvg } from './lib/proto.mjs'
import { svgToPng, svgToLargePng, svgToJpeg, svgFramesToGif, svgToRgb, svgToRaw } from './lib/images.mjs'
import * as M from './lib/models.mjs'
import * as A from './lib/media.mjs'
import * as C from './lib/content.mjs'
import { DAY, contentHash, fakeHash, uuidv7, iso, writeFile, rmrf, ensureDir } from './lib/util.mjs'
import { verifyLibrary, printReport } from './verify-xingluo.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const argOut = process.argv.indexOf('--out')
const OUT = path.resolve(argOut > 0 ? process.argv[argOut + 1] : path.join(here, '../xingluo'))
const ENRICHER = 'bowerbird.enrich-vision@1.2.0'

const { B, D, trash: TRASH_SEED, NOW } = loadPrototype()
const byPath = new Map(D.assets.map(a => [a.path, a]))
const byName = n => D.assets.find(a => a.name === n)
const P = p => byPath.get(p)

/* ───────────── times ───────────── */

/** '11 月 18 日 14:02' (Beijing time in the prototype) → UTC ms. */
function bjText(s) {
  const m = /(\d+) 月 (\d+) 日 (\d+):(\d+)/.exec(s)
  return Date.UTC(2026, Number(m[1]) - 1, Number(m[2]), Number(m[3]) - 8, Number(m[4]))
}
/** Assets an Agent registered minutes ago: created = modified (data.js gives them a modified time only). */
const JUST_ADDED = new Set(['props/lantern/lantern_concept.png', 'characters/npc/npc_guard.glb', 'characters/npc/npc_merchant.glb'])

/* ───────────── what each file is made of ───────────── */

const LANTERN_TINT = [['#e0559a', '#ffcf5a'], ['#f07bb4', '#ffe08a'], ['#c9d6e2', '#f2e6c8'], ['#a5672f', '#7a4a1f']]
const POTION_BASE = [['#33241a', '#3a1630'], ['#a9682f', '#e0559a'], ['#7d4a1f', '#b03a78'], ['#e3b648', '#f2c4dc'], ['#b88a26', '#c98aa8']]
const LANTERN_BASE = [['#33241a', '#2b2418'], ['#a9682f', '#c9a24a'], ['#7d4a1f', '#8a6a2a'], ['#e3b648', '#f2e6c8'], ['#b88a26', '#d8c89a']]

function img(a, w, h, extra = {}) { return { kind: 'png', art: a.art, a: { ...a, ...extra.a }, w, h, alpha: !!a.alpha, ...extra } }
function sizeOf(a) { return [a.w, a.h] }

/** Large images keep the drawing simple: rendered small and scaled up. */
function spec(a) {
  const p = a.path
  if (a.kind === 'image') {
    if (p.endsWith('.hdr')) return { kind: 'hdr' }
    if (p.endsWith('.gif')) return { kind: 'gif' }
    if (p === 'environments/world_map_16k.png') return { kind: 'large', w: 16384, h: 9216, factor: 8 }
    if (p.startsWith('references/3d-render/')) {
      // data.js says 2400×2400 but draws each with its own aspect; the long edge stays 2400
      const ar = a.ar || 1
      return img(a, ar >= 1 ? 2400 : Math.round(2400 * ar), ar >= 1 ? Math.round(2400 / ar) : 2400)
    }
    if (p === 'props/lantern/lantern_concept.png') return img(a, 1536, 1536, { recolor: LANTERN_TINT })
    if (p === 'props/potion/potion_normal.png') return img(a, 1024, 1024, { transform: 'rotate(180 80 80)' })
    if (p === 'ui/icons/icon_coin.png') return img(a, 256, 256, { transform: 'translate(8 8) scale(0.9)' })
    return img(a, ...sizeOf(a))
  }
  return { kind: a.kind }
}

async function renderImage(a, s) {
  const svg = artSvg(s.art, s.a, s.w, s.h, { recolor: s.recolor, transform: s.transform })
  return svgToPng(svg, { alpha: s.alpha })
}

const files = new Map() // path → Buffer (null: missing on purpose)

async function makeFiles() {
  const chest = id => P('props/chest/' + id).id
  for (const a of D.assets) {
    const p = a.path, s = spec(a)
    if (p === 'characters/hero/hero_idle.fbx') { files.set(p, null); continue }
    if (p === 'ui/shop/btn_buy (1).png') continue // copied below
    let buf
    switch (s.kind) {
      case 'png': buf = await renderImage(a, s); break
      case 'large': buf = await svgToLargePng(artSvg(a.art, a, s.w / s.factor, s.h / s.factor), s.w, s.h, s.factor); break
      case 'gif': {
        const frames = []
        for (let f = 0; f < a.frames; f++) frames.push(artSvg('smoke', { ...a, frame: f }, a.w, a.h))
        buf = await svgFramesToGif(frames, { delayMs: Math.round(1000 / a.fps) })
        break
      }
      case 'hdr': buf = A.hdrEnvironment(p.includes('sky_noon')
        ? { width: a.w, height: a.h, sky: ['#5f9fe8', '#d6ecff'], ground: a.sky[1], sun: { u: 0.32, v: 0.2, size: 0.02, color: [1, 0.96, 0.88], intensity: 80 } }
        : { width: a.w, height: a.h, sky: ['#2a2f4a', a.sky[0]], ground: a.sky[1], sun: { u: 0.7, v: 0.46, size: 0.025, color: [1, 0.62, 0.32], intensity: 24 } }); break
      case 'model': buf = await model(a); break
      case 'audio': buf = audio(a); break
      case 'video': buf = await video(a); break
      case 'doc': buf = doc(a, chest); break
      case 'unknown': buf = unknown(a); break
      default: throw new Error('no generator for ' + p)
    }
    files.set(p, buf)
  }
  files.set('ui/shop/btn_buy (1).png', files.get('ui/shop/btn_buy.png'))
  // content duplicate (duplicate-content, pages.js x-dup): the HUD kept a byte-identical copy of the shop panel
  files.set('ui/hud/panel_bg.png', files.get('ui/shop/panel_bg.png'))
}

async function model(a) {
  switch (a.path) {
    case 'props/chest/chest.glb':
      return M.writeGlb(M.buildChest({ target: a.tris }), { vcol: true, textures: { wood: { baseColor: 'chest_basecolor.png', normal: 'chest_normal.png', orm: 'chest_orm.png' } } })
    case 'props/potion/potion.glb':
      return M.writeGlb(M.buildBottle({ target: a.tris }), { textures: { liquid: { baseColor: 'potion_basecolor.png' }, glass: { normal: 'potion_normal.png' } } })
    case 'props/weapon/sword_iron.glb': return M.writeGlb(M.buildSword({ target: a.tris }))
    case 'characters/hero/hero.glb': return M.writeGlb(M.buildHero({ target: a.tris }), { vcol: true })
    case 'characters/hero/hero_walk.fbx':
      return M.writeFbxAscii(M.buildHero({ target: a.tris, name: 'hero_walk', clips: ['walk'] }), { stamp: a.modified })
    case 'characters/npc/npc_guard.glb': return M.writeGlb(M.buildHero({ name: 'npc_guard', tint: { cloth: '#5a6b7a', hair: '#2a2a2a' }, clips: ['idle'] }))
    case 'characters/npc/npc_merchant.glb': return M.writeGlb(M.buildHero({ name: 'npc_merchant', tint: { cloth: '#b5533f', hair: '#3b3b4a' }, clips: ['idle'] }))
  }
  throw new Error('no model for ' + a.path)
}

function audio(a) {
  switch (a.name) {
    case 'chest_open.wav': return A.chestOpen()
    case 'ui_click.wav': return A.uiClick()
    case 'coin_pickup.wav': return A.coinPickup()
    case 'theme_town.ogg': { const t = A.themeTown(); return A.encodeOgg(A.wav(t.samples, { sampleRate: t.sampleRate })) }
  }
  throw new Error('no audio for ' + a.name)
}

async function video(a) {
  if (a.name === 'chest_open_preview.mp4') {
    // 3 s at 30 fps: the closed chest shakes, opens, and the warm light pulses; the open sound starts at 1 s
    const W = 640, H = 360, fps = 30, frames = []
    const WOOD = { top: '#cf9150', front: '#a5672f', side: '#74441b', brass: '#f0c35a', brassDk: '#b3861f', lock: '#ffe394', line: '#3a2410' }
    for (let i = 0; i < fps * 3; i++) {
      const t = i / fps
      const shake = t > 0.55 && t < 1 ? Math.sin(t * 90) * 1.2 : 0
      const open = Math.max(0, Math.min(1, (t - 1) / 0.25))
      const glow = open * (0.75 + 0.25 * Math.sin((t - 1.25) * 6))
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 284 160"><rect width="284" height="160" fill="#1b2230"/><rect y="118" width="284" height="42" fill="#141a25"/>` +
        `<g transform="translate(${62 + shake} 0)"><g opacity="${(1 - open).toFixed(3)}">${B.demo.chest(WOOD, false)}</g><g opacity="${open.toFixed(3)}">${B.demo.chest(WOOD, true)}</g>` +
        `<ellipse cx="84" cy="60" rx="70" ry="60" fill="#ffd96b" opacity="${(glow * 0.18).toFixed(3)}"/></g></svg>`
      frames.push(await svgToRgb(svg))
    }
    const sr = 44100, pad = Buffer.alloc(sr * 2), snd = A.chestOpen(sr)
    const pcm = Buffer.concat([pad, snd.subarray(44), Buffer.alloc((3 * sr - sr - (snd.length - 44) / 2) * 2)])
    const wavBuf = A.wav(Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32767), { sampleRate: sr })
    return A.encodeMp4Vp9(frames, { width: W, height: H, fps, audioWav: wavBuf })
  }
  if (a.name === 'intro_cutscene.mov') {
    // 1 s of a slow pan across the village at dusk, ProRes 4444 with alpha: browsers cannot decode it
    const W = 480, H = 270, fps = 24, frames = []
    for (let i = 0; i < fps; i++) {
      const svg = artSvg('env', { hue: 30, vb: [240, 135] }, W, H, { transform: `translate(${(-i * 0.6).toFixed(2)} 0) scale(1.1)` })
      const { data } = await svgToRaw(svg, { alpha: true })
      frames.push(data)
    }
    return A.encodeProRes4444(frames, { width: W, height: H, fps })
  }
  throw new Error('no video for ' + a.name)
}

function doc(a, chest) {
  switch (a.path) {
    case 'props/chest/chest.md': return Buffer.from(C.chestMd({ conceptId: chest('chest_concept.png'), turnaroundId: chest('chest_turnaround.png') }))
    case 'docs/art_style_guide.md': return Buffer.from(C.ART_STYLE_GUIDE)
    case 'docs/naming_rules.md': return Buffer.from(C.NAMING_RULES)
    case 'docs/changelog.txt': return Buffer.from(C.CHANGELOG)
    case 'docs/export_presets.json': return Buffer.from(C.EXPORT_PRESETS)
    case 'ui/shop/shop_prototype.html': return Buffer.from(C.shopPrototypeHtml())
    case 'ui/shop_v2/index.html': return Buffer.from(C.shopV2().html)
  }
  throw new Error('no document for ' + a.path)
}

function unknown(a) {
  switch (a.path) {
    case 'props/chest/chest_high.blend': return C.fakeBlend()
    case 'environments/rock_01.obj': return Buffer.from(M.rockObj())
    case 'characters/hero/hero_run.skel': return C.fakeSkel()
    case 'ui/shop_v2/shop.css': return Buffer.from(C.shopV2().css)
    case 'ui/shop_v2/shop.js': return Buffer.from(C.shopV2().js)
  }
  throw new Error('no file for ' + a.path)
}

/* ───────────── records (data.js RECS) ───────────── */

const METHOD = { 'AI 生成': 'ai-generate', '手工': 'manual', '导出': 'export', '渲染': 'render', '切图': 'slice' }
/** data.js params strings, split into keys (model / seed / negativePrompt are the conventional ones). */
const PARAMS = {
  rec_concept: { seed: 4211, size: '1536×1536', steps: 30 },
  rec_turn: { seed: 1907, size: '2048×2048', steps: 28, template: '四视图' },
  rec_export: { scale: 1, animationBakeFps: 30, textureSize: 1024 },
  rec_icon: { channel: 'full', environment: 'studio', projection: 'perspective', fov: 35, size: '256×256' },
  rec_lantern: { seed: 7730, size: '1536×1536', steps: 30 },
  rec_slice: { count: 12, scale: 2, trim: true }
}
/** Which asset each record took in, with the role (data.js EDGES carry the record on the source relation). */
const INPUT_ROLE = {
  rec_turn: '参考图', rec_blend: '四视图', rec_export: '源文件', rec_icon: '模型', rec_mockup: '原型稿', rec_slice: '效果图',
  rec_potion: '原画', rec_hero: '原画'
}

/* ───────────── build ───────────── */

const hashes = new Map() // path → current hash
const sizes = new Map()
const recIds = new Map() // proto record key → rec_<uuidv7>
const records = []
const bmetas = new Map() // path → bmeta object

function versionsFor(a) {
  const real = files.get(a.path)
  const size = real ? real.length : a.bytes
  const hash = real ? contentHash(real) : fakeHash(a.path + ':current')
  if (a.versions) {
    const last = a.versions[a.versions.length - 1]
    return a.versions.map((v, i) => i === a.versions.length - 1
      ? { hash, size, at: iso(v.at), by: v.by, note: v.note }
      : { hash: fakeHash(`${a.path}:v${v.v}`), size: Math.round(size * v.size / last.size), at: iso(v.at), by: v.by, note: v.note })
  }
  const at = JUST_ADDED.has(a.path) ? a.modified : a.created
  return [{ hash, size, at: iso(at), by: a.by, note: '入库' }]
}

function buildRecords() {
  for (const [key, r] of Object.entries(D.RECS)) {
    const at = key === 'rec_lantern' ? P('props/lantern/lantern_concept.png').modified : bjText(r.at)
    recIds.set(key, 'rec_' + uuidv7(at, 'xingluo:' + key))
  }
  for (const [key, r] of Object.entries(D.RECS)) {
    const at = key === 'rec_lantern' ? P('props/lantern/lantern_concept.png').modified : bjText(r.at)
    const edges = D.EDGES.filter(e => e.type === 'source' && e.rec === key)
    const inputs = []
    for (const e of edges) if (!inputs.some(x => x.id === e.to)) {
      const to = D.byId(e.to)
      inputs.push({ id: to.id, hash: e.rec === 'rec_icon' ? bmetas.get(to.path).versions[0].hash : hashes.get(to.path), role: INPUT_ROLE[key] })
    }
    const params = { ...(PARAMS[key] ?? {}) }
    if (key === 'rec_slice') {
      // where each cut-out sits on the mockup (ADR-036 `rect`); one record has 12 outputs, so it is keyed by output GUID
      params.rect = Object.fromEntries(Object.entries(C.SLICE_RECTS).map(([n, r]) => [P('ui/shop/' + n).id, r]))
    }
    const rec = {
      bb: 1, id: recIds.get(key), method: METHOD[r.method], tool: r.tool, prompt: r.prompt,
      params: Object.keys(params).length ? params : undefined, inputs: inputs.length ? inputs : undefined,
      by: r.by, at: iso(at)
    }
    records.push(ProductionRecord.parse(rec))
  }
}

/**
 * Latest verdict (ADR-024). data.js stamps it 5 h after `modified`, but before the version table moves `modified`
 * to the last content change; we take the final one, so a verdict is never older than the content it judged.
 * chest_concept.png keeps its logged time (data.js META: 待审 → 通过, 11 月 18 日 20:02).
 */
function reviewFor(a, hash) {
  if (a.review === 'exempt') return { status: 'exempt' }
  if (a.review === 'pending') return { status: 'pending' }
  const at = a.path === 'props/chest/chest_concept.png' ? bjText('11 月 18 日 20:02') : (a.trashedAt ? a.reviewAt : a.modified + 5 * 3600_000)
  return { status: a.review, hash, by: a.reviewBy, at: iso(Math.min(at, NOW - 60_000)), note: a.reviewNote || '' }
}

function bmetaFor(a, extra = {}) {
  const versions = versionsFor(a)
  const hash = versions[versions.length - 1].hash
  const created = { at: versions[0].at, by: versions[0].by }
  const review = reviewFor(a, hash)
  // the latest write: content change, metadata edit (data.js `modified`) or the review verdict
  let modified = { at: versions[versions.length - 1].at, by: versions[versions.length - 1].by }
  if (a.modified > Date.parse(modified.at)) modified = { at: iso(a.modified), by: a.by }
  if (review.at && review.at > modified.at) modified = { at: review.at, by: review.by }
  const m = {
    bb: 1, id: a.id, hash, stage: a.stage, tags: a.tags.slice(),
    description: a.desc || undefined,
    auto: (a.aiTags?.length || a.aiDesc) ? {
      tags: a.aiTags?.length ? a.aiTags.slice() : undefined, description: a.aiDesc || undefined, by: ENRICHER,
      // chest.glb's AI tag came on 11 月 22 日, before the 11 月 24 日 content change
      hash: a.path === 'props/chest/chest.glb' ? versions[0].hash : hash
    } : undefined,
    relations: undefined, review, versions,
    views: a.grid ? { rows: a.grid.rows, cols: a.grid.cols, cells: a.grid.cells.slice() } : undefined,
    origin: undefined, created, modified, ...extra
  }
  return m
}

function relationsFor(a) {
  const out = []
  for (const e of D.EDGES.filter(x => x.from === a.id)) {
    if (e.type === 'source') {
      const to = D.byId(e.to)
      // chest_icon.png was rendered from chest.glb v1; chest.glb changed since → stale upstream (R12)
      const toHash = a.path === 'props/chest/chest_icon.png' ? bmetas.get(to.path).versions[0].hash : hashes.get(to.path)
      out.push({ type: 'source', to: to.id, toHash, record: recIds.get(e.rec) })
    } else if (e.type === 'uses') {
      // the potion's base colour is in the trash: the relation keeps the trashed GUID (broken reference, R11)
      const to = e.to ? D.byId(e.to).id : TRASH.find(t => t.name === e.toName).id
      out.push({ type: 'uses', to, slot: e.slot, note: e.note })
    } else out.push({ type: e.type, to: D.byId(e.to).id })
  }
  return out.length ? out : undefined
}

const TRASH = TRASH_SEED

async function main() {
  if (!A.hasFfmpeg()) throw new Error('ffmpeg is required to generate the sample libraries (they are not kept in the repository; only the tests need them)')
  console.log('generating', path.relative(process.cwd(), OUT) || '.')
  rmrf(OUT)
  ensureDir(OUT)
  await makeFiles()
  for (const [p, buf] of files) if (buf) { hashes.set(p, contentHash(buf)); sizes.set(p, buf.length) }

  // first pass: version records (record inputs read chest.glb v1)
  for (const a of D.assets) if (a.path !== 'ui/shop/btn_buy (1).png') bmetas.set(a.path, bmetaFor(a))
  buildRecords()
  const recOf = new Map()
  for (const e of D.EDGES) if (e.type === 'source' && e.rec) recOf.set(e.from, recIds.get(e.rec))
  for (const a of D.assets) {
    if (a.path === 'ui/shop/btn_buy (1).png') continue
    const m = bmetas.get(a.path)
    m.relations = relationsFor(a)
    // ADR-027: an asset records the production record that made it (also when it has no input, e.g. lantern_concept)
    const origin = recOf.get(a.id) ?? (a.origin ? recIds.get(a.origin) : undefined)
    if (origin) m.origin = origin
  }
  // duplicate identity (R9): the copy was made together with its .bmeta — same GUID, same content
  bmetas.set('ui/shop/btn_buy (1).png', structuredClone(bmetas.get('ui/shop/btn_buy.png')))
  // the HUD's copy of the panel: its own asset, same bytes (duplicate-content)
  const hudAt = Date.UTC(2026, 10, 22, 3, 10)
  bmetas.set('ui/hud/panel_bg.png', {
    bb: 1, id: uuidv7(hudAt, 'xingluo:ui/hud/panel_bg.png'), hash: hashes.get('ui/hud/panel_bg.png'), stage: 'runtime', tags: ['切图'],
    review: { status: 'pending' }, versions: [{ hash: hashes.get('ui/hud/panel_bg.png'), size: sizes.get('ui/hud/panel_bg.png'), at: iso(hudAt), by: 'user:mo', note: '入库' }],
    created: { at: iso(hudAt), by: 'user:mo' }, modified: { at: iso(hudAt), by: 'user:mo' }
  })

  // write asset files and sidecars
  for (const [p, buf] of files) if (buf) writeFile(path.join(OUT, p), buf)
  for (const [p, m] of bmetas) writeFile(path.join(OUT, p + '.bmeta'), serializeBmeta(Bmeta.parse(m)))

  // metadata conflict (R10): a cloud-drive conflicted copy next to the sidecar, its tags differ (pages.js x-conflict)
  const sp = structuredClone(bmetas.get('ui/shop/shop_prototype.html'))
  sp.tags = [...sp.tags, 'v2']
  sp.modified = { at: iso(Date.UTC(2026, 10, 24, 2, 30)), by: 'user:lin' }
  writeFile(path.join(OUT, "ui/shop/shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta"), serializeBmeta(Bmeta.parse(sp)))

  // production records
  for (const r of records) writeFile(path.join(OUT, '.bowerbird/records', r.at.slice(0, 4), r.id + '.json'), serializeRecord(r))

  writeFolders()
  writeLibraryData()
  await writeTrash()

  // empty folders in the prototype's tree (git keeps them through a dot-file, which the scanner ignores)
  for (const f of ['references/photography', 'references/illustration']) writeFile(path.join(OUT, f, '.gitkeep'), '')

  if (!process.argv.includes('--skip-verify')) {
    const report = verifyLibrary(OUT)
    printReport(report)
    if (report.errors.length) process.exit(1)
  }
}

function writeFolders() {
  const fm = D.folderMeta, fd = D.folderDefaults
  const folders = new Set([...Object.keys(fm), ...Object.keys(fd)])
  for (const f of [...folders].sort()) {
    const meta = { bb: 1 }
    if (fm[f]?.label) meta.label = fm[f].label
    if (fm[f]?.icon) meta.icon = fm[f].icon
    if (fm[f]?.note) meta.description = fm[f].note
    if (fd[f]) meta.defaults = { stage: fd[f].stage, review: fd[f].exempt ? 'exempt' : 'pending', tags: fd[f].tags.slice() }
    writeFile(path.join(OUT, f, '_folder.bmeta'), serializeFolderMeta(FolderMeta.parse(meta)))
  }
}

function writeLibraryData() {
  const created = Date.UTC(2026, 9, 20, 2, 0)
  const lib = {
    bb: 1, id: uuidv7(created, 'xingluo:library'), name: '星落镇', created: iso(created),
    plugins: {
      'bowerbird.image': '^0.1.0', 'bowerbird.video': '^0.1.0', 'bowerbird.audio': '^0.1.0', 'bowerbird.model': '^0.1.0',
      'bowerbird.doc': '^0.1.0', 'bowerbird.search-keyword': '^0.1.0', 'community.spine': '^1.4.0'
    },
    // ADR-044: written when community.spine was enabled on some machine; this one lacks it → hero_run.skel「缺少插件」
    pluginFormats: { '.skel': 'community.spine', '.atlas': 'community.spine' },
    settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 }
  }
  writeFile(path.join(OUT, '.bowerbird/library.json'), serializeJson(LibraryJson.parse(lib)))

  // tag definitions (pages.js TAGS): groups, colours, aliases
  const TAGS = [
    ['宝箱', '对象', '#e8a33a', ['chest']], ['药水', '对象', '#e0559a', ['potion']], ['主角', '对象', '#4f8ff0', []], ['NPC', '对象', '#6cbf43', []],
    ['原画', '用途', '#8f78d0', ['concept']], ['四视图', '用途', '#8f78d0', ['turnaround']], ['贴图', '用途', '#8f78d0', ['texture']],
    ['Icon', '用途', '#8f78d0', []], ['切图', '用途', '#8f78d0', []], ['音效', '用途', '#8f78d0', ['sfx']]
  ]
  const tags = { bb: 1, groups: ['对象', '用途'], tags: Object.fromEntries(TAGS.map(([n, g, c, al]) => [n, { group: g, color: c, ...(al.length ? { aliases: al } : {}) }])) }
  writeFile(path.join(OUT, '.bowerbird/tags.json'), serializeJson(TagsJson.parse(tags)))

  // smart folders (data.js smart). Relative time stays as text syntax in `q`, which the kernel parses (search.md「文本语法」)
  const views = [
    { bb: 1, name: '本周新增', query: { q: 'created:week' } },
    { bb: 1, name: '运行时模型', query: { filter: { stage: ['runtime'], format: ['model'] } } },
    { bb: 1, name: 'AI 生成待审', query: { filter: { review: ['pending'], method: ['ai-generate'] } } }
  ]
  for (const v of views) writeFile(path.join(OUT, '.bowerbird/views', v.name + '.json'), serializeJson(SmartViewFile.parse(v)))
}

async function writeTrash() {
  for (const a of TRASH) {
    // data.js only stamps verdicts on its own table; give the trashed ones the same rule (+5 h, the other person)
    a.reviewBy = a.by === 'user:lin' ? 'user:mo' : 'user:lin'
    a.reviewAt = Math.min(a.modified + 5 * 3600_000, a.trashedAt - 3600_000)
    let buf
    if (a.name === 'potion_basecolor.png') buf = await svgToPng(artSvg('basecolor', a, 1024, 1024, { recolor: POTION_BASE }))
    else if (a.name === 'btn_close.png') buf = await svgToPng(artSvg('ui', { ...a, c: ['#e0503c', '#ff8f7a'] }, 256, 256), { alpha: true })
    else if (a.name === 'moodboard_old.jpg') buf = await svgToJpeg(artSvg('render', a, 2400, 1600))
    else if (a.name === 'chest_v0.glb') buf = M.writeGlb(M.buildChest({ band: 0.18, coinSeg: 16, lidSeg: 12, target: a.tris, name: 'chest_v0' }), { vcol: true, textures: { wood: { baseColor: 'chest_basecolor.png', normal: 'chest_normal.png', orm: 'chest_orm.png' } } })
    files.set('trash:' + a.name, buf)
    const trashId = uuidv7(a.trashedAt, 'xingluo:trash:' + a.name)
    const dir = path.join(OUT, '.bowerbird/trash', trashId)
    const hash = contentHash(buf)
    const at = iso(a.created)
    const meta = {
      bb: 1, id: a.id, hash, stage: a.stage, tags: a.tags.slice(), review: reviewFor(a, hash),
      versions: [{ hash, size: buf.length, at, by: a.by, note: '入库' }],
      created: { at, by: a.by }, modified: a.review === 'exempt' ? { at: iso(Math.min(a.modified, a.trashedAt - 3600_000)), by: a.by } : { at: iso(a.reviewAt), by: a.reviewBy }
    }
    if (a.name === 'chest_v0.glb') meta.relations = [
      ...[['basecolor', '基础色'], ['normal', '法线'], ['orm', 'ORM']].map(([k, note]) => ({ type: 'uses', to: P(`props/chest/chest_${k}.png`).id, slot: `chest_${k}.png`, note })),
      { type: 'belongs', to: P('props/chest/chest.md').id }
    ]
    writeFile(path.join(dir, a.name), buf)
    writeFile(path.join(dir, a.name + '.bmeta'), serializeBmeta(Bmeta.parse(meta)))
    const info = { bb: 1, id: trashId, assetId: a.id, name: a.name, originalPath: a.path, deletedAt: iso(a.trashedAt), deletedBy: a.trashedBy }
    writeFile(path.join(dir, 'info.json'), serializeJson(TrashInfo.parse(info)))
  }
}

await main()
