#!/usr/bin/env node
// Deterministic generator for the performance library (engineering.md「性能基准」): many small, all-different files —
// images, audio, documents and models — spread over a three-level folder tree, with tags, stages, review states and
// relations. With --with-sidecars it also writes every .bmeta and .bowerbird/ (an already-registered library);
// without, the folder is a first open. Files are kept small on purpose (the disk budget does not allow the 100 GB the
// benchmark describes); the totals are printed at the end.
//
//   node scripts/generate-100k.mjs [<target dir>] [--count 100000] [--with-sidecars] [--force]
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { serializeBmeta, serializeJson } from '@bowerbird/schema'
import { uuidv7, iso, rng } from './lib/util.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const TARGET = path.resolve(args.find((a, i) => !a.startsWith('--') && !['--count'].includes(args[i - 1])) ?? path.join(here, '../perf-100k'))
const COUNT = Number(flag('--count') ?? 100000)
const SIDECARS = args.includes('--with-sidecars')
const BASE_TIME = Date.UTC(2026, 0, 1)

const CATS = [
  ['characters', ['hero', 'npc', 'monster', 'pet']], ['props', ['chest', 'potion', 'weapon', 'lantern', 'furniture']],
  ['environments', ['village', 'forest', 'cave', 'castle']], ['ui', ['shop', 'hud', 'icons', 'menus']],
  ['audio', ['sfx', 'music', 'voice']], ['vfx', ['fire', 'smoke', 'magic']], ['references', ['photo', 'render', 'illustration']], ['docs', ['specs', 'notes']]
]
const TAGS = ['宝箱', '药水', '主角', 'NPC', '原画', '贴图', 'Icon', '切图', '音效', '音乐', '场景', '特效', '参考', '规范', '道具', '武器', '岩石', '木质', '金属', '卡通']
const STAGES = ['reference', 'production', 'runtime']
const REVIEWS = ['pending', 'approved', 'approved', 'approved', 'rejected', 'exempt']
const ACTORS = ['user:mo', 'user:lin', 'agent:concept-artist', 'agent:modeler', 'agent:slicer', 'system:scanner']

/* ───── tiny, unique files ───── */

function crc(buf) { return zlib.crc32(buf) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
/** A small RGB PNG whose pixels encode `i`, so no two files share content. */
function png(i, r) {
  const w = 16 + (i % 4) * 16, h = w
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const c0 = [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)]
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = (c0[0] + x * 4) & 255; raw[o + 1] = (c0[1] + y * 4) & 255; raw[o + 2] = c0[2]
    }
  }
  // the index in the last pixels keeps every file distinct
  const o = raw.length - 9
  raw[o] = i & 255; raw[o + 1] = (i >> 8) & 255; raw[o + 2] = (i >> 16) & 255
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return { data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]), w, h }
}
function wav(i, r) {
  const sr = 22050, n = Math.round(sr * (0.05 + (i % 5) * 0.02)), f = 200 + r() * 2000
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let k = 0; k < n; k++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * k / sr) * Math.exp(-k / n * 4) * 12000), 44 + k * 2)
  buf.writeInt16LE(i & 0x7fff, 44)
  return buf
}
function md(i, name, tags) {
  return Buffer.from(`# ${name}\n\n样例文档 ${i}。标签：${tags.join('、')}。\n\n- 编号：${i}\n- 用途：性能基准\n`)
}
/** A minimal GLB: one triangle-fan pyramid; its apex height encodes `i`. */
function glb(i) {
  const hgt = 0.5 + (i % 1000) / 1000
  const pos = new Float32Array([0, hgt, 0, -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5])
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 3, 2, 1, 4, 3])
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)])
  const json = {
    asset: { version: '2.0', generator: 'Bowerbird perf generator' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'm' + i }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 5, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, hgt, 0.5] }, { bufferView: 1, componentType: 5123, count: 18, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 60 }, { buffer: 0, byteOffset: 60, byteLength: 36 }], buffers: [{ byteLength: 96 }]
  }
  let j = Buffer.from(JSON.stringify(json)); if (j.length % 4) j = Buffer.concat([j, Buffer.alloc(4 - (j.length % 4), 0x20)])
  const total = 12 + 8 + j.length + 8 + bin.length
  const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8); head.writeUInt32LE(j.length, 12); head.writeUInt32LE(0x4e4f534a, 16)
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([head, j, bh, bin])
}

/* ───── layout ───── */

function main() {
  if (fs.existsSync(TARGET) && fs.readdirSync(TARGET).length) {
    if (!args.includes('--force') && path.resolve(TARGET) !== path.resolve(here, '../perf-100k')) throw new Error(`${TARGET} is not empty (use --force)`)
    fs.rmSync(TARGET, { recursive: true, force: true })
  }
  fs.mkdirSync(TARGET, { recursive: true })
  const r = rng(20261125)
  const t0 = process.hrtime.bigint()
  let files = 0, bytes = 0
  const made = new Set()
  const docsByGroup = new Map() // `${cat}/${group}` → id of the group's design document (belongs target)
  const prevInFolder = new Map()
  for (let i = 0; i < COUNT; i++) {
    const [cat, groups] = CATS[i % CATS.length]
    const group = groups[Math.floor(i / CATS.length) % groups.length] + '_' + String(Math.floor(i / 997) % 20).padStart(2, '0')
    const sub = 'set_' + String(Math.floor(i / 61) % 12).padStart(2, '0')
    const folder = `${cat}/${group}/${sub}`
    const kindRoll = cat === 'audio' ? 'wav' : cat === 'docs' ? 'md' : (i % 20 < 11 ? 'png' : i % 20 < 14 ? 'wav' : i % 20 < 17 ? 'md' : 'glb')
    const tags = [TAGS[i % TAGS.length], ...(i % 3 ? [TAGS[(i * 7) % TAGS.length]] : [])].filter((t, k, a) => a.indexOf(t) === k)
    const base = `${group}_${String(i).padStart(6, '0')}`
    let data
    if (kindRoll === 'png') data = png(i, r).data
    else if (kindRoll === 'wav') data = wav(i, r)
    else if (kindRoll === 'md') data = md(i, base, tags)
    else data = glb(i)
    const name = `${base}.${kindRoll}`
    const rel = `${folder}/${name}`
    const abs = path.join(TARGET, rel)
    if (!made.has(folder)) { fs.mkdirSync(path.join(TARGET, folder), { recursive: true }); made.add(folder) }
    fs.writeFileSync(abs, data)
    files++; bytes += data.length
    if (SIDECARS) {
      const at = BASE_TIME + i * 7 * 60_000
      const id = uuidv7(at, 'perf:' + i)
      const hash = 'sha256:' + crypto.createHash('sha256').update(data).digest('hex')
      const stage = cat === 'references' ? 'reference' : STAGES[1 + (i % 2)]
      const status = cat === 'references' || cat === 'docs' ? 'exempt' : REVIEWS[i % REVIEWS.length]
      const by = ACTORS[i % ACTORS.length]
      const relations = []
      const gkey = `${cat}/${group}`
      if (docsByGroup.has(gkey) && kindRoll !== 'md') relations.push({ type: 'belongs', to: docsByGroup.get(gkey) })
      const prev = prevInFolder.get(folder)
      if (prev && i % 4 === 0) relations.push({ type: 'source', to: prev.id, toHash: prev.hash })
      if (prev && kindRoll === 'glb' && prev.kind === 'png') relations.push({ type: 'uses', to: prev.id, note: '基础色' })
      if (kindRoll === 'md' && !docsByGroup.has(gkey)) docsByGroup.set(gkey, id)
      prevInFolder.set(folder, { id, hash, kind: kindRoll, name })
      const meta = {
        bb: 1, id, hash, stage, tags,
        relations: relations.length ? relations : undefined,
        review: status === 'pending' || status === 'exempt' ? { status } : { status, hash, by: 'user:lin', at: iso(at + 3600_000), note: status === 'rejected' ? '比例不对' : '' },
        versions: [{ hash, size: data.length, at: iso(at), by }],
        created: { at: iso(at), by },
        modified: { at: iso(status === 'approved' || status === 'rejected' ? at + 3600_000 : at), by: status === 'approved' || status === 'rejected' ? 'user:lin' : by }
      }
      const sc = serializeBmeta(meta)
      fs.writeFileSync(abs + '.bmeta', sc)
      files++; bytes += Buffer.byteLength(sc)
    }
    if ((i + 1) % 10000 === 0) process.stdout.write(`  ${i + 1} / ${COUNT}\r`)
  }
  if (SIDECARS) {
    const lib = serializeJson({
      bb: 1, id: uuidv7(BASE_TIME, 'perf:library'), name: '性能基准', created: iso(BASE_TIME),
      plugins: { 'bowerbird.image': '^0.1.0', 'bowerbird.audio': '^0.1.0', 'bowerbird.model': '^0.1.0', 'bowerbird.doc': '^0.1.0', 'bowerbird.search-keyword': '^0.1.0' },
      settings: { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 }
    })
    fs.mkdirSync(path.join(TARGET, '.bowerbird'), { recursive: true })
    fs.writeFileSync(path.join(TARGET, '.bowerbird/library.json'), lib)
    files++; bytes += lib.length
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9
  console.log(`perf library: ${TARGET}\n  ${COUNT} assets · ${made.size} folders · ${files} files · ${(bytes / 1048576).toFixed(1)} MB (${bytes} bytes)${SIDECARS ? ' · with .bmeta' : ' · first open (no .bmeta)'} · ${secs.toFixed(1)} s`)
}

main()
