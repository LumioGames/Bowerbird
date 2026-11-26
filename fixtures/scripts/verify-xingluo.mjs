#!/usr/bin/env node
// Checks a generated sample library (default fixtures/xingluo/) against the disk-format schema and lists every
// integrity problem it contains. The problems the sample library is built to show are listed in EXPECTED; anything
// else — or an expected problem that went missing — is an error.
//
//   node scripts/verify-xingluo.mjs [<library dir>] [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Bmeta, FolderMeta, LibraryJson, TagsJson, ProductionRecord, TrashInfo, SmartViewFile, FOLDER_META_NAME, SIDECAR_SUFFIX
} from '@bowerbird/schema'
import { contentHash, walk } from './lib/util.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(here, '../..')

/** The problems「星落镇」contains on purpose (prototype data.js `issue`, pages.js EXTRA). key = `${type} ${path}`. */
export const EXPECTED = [
  { type: 'missing-file', path: 'characters/hero/hero_idle.fbx', why: '只有 .bmeta，文件缺失' },
  { type: 'broken-reference', path: 'props/potion/potion.glb', why: '基础色 potion_basecolor.png 在回收站' },
  { type: 'stale-upstream', path: 'props/chest/chest_icon.png', why: '来源 chest.glb 在 11 月 24 日改过' },
  { type: 'duplicate-guid', path: 'ui/shop/btn_buy (1).png', why: '连同 .bmeta 一起复制，与 btn_buy.png 同一个 GUID' },
  { type: 'metadata-conflict', path: 'ui/shop/shop_prototype.html', why: "云盘冲突副本 shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta" },
  { type: 'duplicate-content', path: 'ui/hud/panel_bg.png', why: '与 ui/shop/panel_bg.png 内容完全相同' },
  { type: 'duplicate-content', path: 'ui/shop/btn_buy (1).png', why: '与 btn_buy.png 内容相同（复制品）。这是磁盘上的原始状态；内核扫描时按重复身份的复制语义给它加来源关系，之后不再列为内容重复（ADR-037）' },
  { type: 'plugin-missing', path: 'characters/hero/hero_run.skel', why: '.skel 归 community.spine，本机未安装' }
]

/** Cloud-drive conflicted copies: Dropbox「name (x's conflicted copy 2026-11-24).bmeta」, Google Drive / OneDrive variants. */
export const CONFLICT_RE = /^(.*) \((?:[^()]*conflicted copy[^()]*|[^()]*冲突[^()]*|Conflict[^()]*)\)\.bmeta$/

function readJson(abs) { return JSON.parse(fs.readFileSync(abs, 'utf8')) }

/** Format extensions the declared built-in plugins claim (read from plugins/*\/package.json). */
function builtinExtensions() {
  const exts = new Set()
  const dir = path.join(REPO, 'plugins')
  if (!fs.existsSync(dir)) return exts
  for (const p of fs.readdirSync(dir)) {
    const pkg = path.join(dir, p, 'package.json')
    if (!fs.existsSync(pkg)) continue
    for (const f of readJson(pkg).bowerbird?.contributes?.formats ?? []) for (const e of f.extensions) exts.add(e)
  }
  return exts
}

function ignored(rel) {
  const parts = rel.split('/')
  if (parts[0] === '.bowerbird') return true
  if (parts.some(p => p.startsWith('.'))) return true
  const base = parts[parts.length - 1]
  return base.endsWith(SIDECAR_SUFFIX) || base === 'Thumbs.db' || base === 'desktop.ini' || base.startsWith('~$') || /\.(tmp|part|crdownload)$/.test(base)
}

export function verifyLibrary(root) {
  const errors = [], issues = [], notes = []
  const err = (where, msg) => errors.push(`${where}: ${msg}`)
  const issue = (type, p, detail) => issues.push({ type, path: p, detail })
  const parse = (schema, abs, rel) => {
    try { return schema.parse(readJson(abs)) } catch (e) { err(rel, 'does not match the schema: ' + (e.issues ? JSON.stringify(e.issues.slice(0, 3)) : e.message)); return null }
  }

  // library-level data
  const libAbs = path.join(root, '.bowerbird/library.json')
  if (!fs.existsSync(libAbs)) { err('.bowerbird/library.json', 'missing'); return { root, errors, issues, notes, stats: {} } }
  const lib = parse(LibraryJson, libAbs, '.bowerbird/library.json')
  const tagsAbs = path.join(root, '.bowerbird/tags.json')
  if (fs.existsSync(tagsAbs)) parse(TagsJson, tagsAbs, '.bowerbird/tags.json')
  const viewsDir = path.join(root, '.bowerbird/views')
  const views = fs.existsSync(viewsDir) ? fs.readdirSync(viewsDir).filter(f => f.endsWith('.json')).sort() : []
  for (const v of views) { const sv = parse(SmartViewFile, path.join(viewsDir, v), '.bowerbird/views/' + v); if (sv && sv.name + '.json' !== v) err('.bowerbird/views/' + v, `name「${sv.name}」does not match the file name`) }

  const records = new Map()
  const recDir = path.join(root, '.bowerbird/records')
  if (fs.existsSync(recDir)) for (const rel of walk(recDir)) {
    const r = parse(ProductionRecord, path.join(recDir, rel), '.bowerbird/records/' + rel)
    if (!r) continue
    if (rel !== `${r.at.slice(0, 4)}/${r.id}.json`) err('.bowerbird/records/' + rel, 'must be records/<year>/<id>.json')
    if (!/^rec_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.id)) err('.bowerbird/records/' + rel, 'id is not rec_<uuidv7>')
    records.set(r.id, r)
  }

  // sidecars and asset files
  const assets = new Map() // path → bmeta
  const all = [...walk(root)]
  const fileSet = new Set(all)
  for (const rel of all) {
    if (rel.startsWith('.bowerbird/')) continue
    const base = rel.split('/').pop()
    if (base === FOLDER_META_NAME) { parse(FolderMeta, path.join(root, rel), rel); continue }
    if (!base.endsWith(SIDECAR_SUFFIX)) continue
    const m = parse(Bmeta, path.join(root, rel), rel)
    if (!m) continue
    const conflict = CONFLICT_RE.exec(base)
    if (conflict) {
      const of = rel.slice(0, rel.length - base.length) + conflict[1]
      issue('metadata-conflict', of, `冲突副本 ${base}`)
      continue
    }
    assets.set(rel.slice(0, -SIDECAR_SUFFIX.length), m)
  }

  // trash
  const trash = new Map() // assetId → info
  const trashDir = path.join(root, '.bowerbird/trash')
  if (fs.existsSync(trashDir)) for (const id of fs.readdirSync(trashDir).sort()) {
    const info = parse(TrashInfo, path.join(trashDir, id, 'info.json'), `.bowerbird/trash/${id}/info.json`)
    if (!info) continue
    if (info.id !== id) err(`.bowerbird/trash/${id}`, 'info.json id differs from the folder name')
    const f = path.join(trashDir, id, info.name)
    const meta = parse(Bmeta, f + SIDECAR_SUFFIX, `.bowerbird/trash/${id}/${info.name}.bmeta`)
    if (!fs.existsSync(f) && !info.recordOnly) err(`.bowerbird/trash/${id}`, 'file missing')
    if (meta && meta.id !== info.assetId) err(`.bowerbird/trash/${id}`, 'assetId differs from the .bmeta id')
    if (meta && fs.existsSync(f) && contentHash(fs.readFileSync(f)) !== meta.hash) err(`.bowerbird/trash/${id}`, 'hash differs from the file')
    trash.set(info.assetId, info)
  }

  // GUIDs. Which of two is the original: earlier creation, then the name without a copy suffix, then path order
  // (the kernel uses file creation time when it has no index; see the hand-back note on copy-like names)
  const copyLike = p => / \(\d+\)\.|\bcopy\b| - Copy|副本/.test(p.split('/').pop())
  const order = (a, b) => (assets.get(a)?.created.at ?? '').localeCompare(assets.get(b)?.created.at ?? '') || (copyLike(a) - copyLike(b)) || (a < b ? -1 : a > b ? 1 : 0)
  const byId = new Map()
  for (const p of [...assets.keys()].sort(order)) {
    const m = assets.get(p)
    if (byId.has(m.id)) issue('duplicate-guid', p, `与 ${byId.get(m.id)} 同一个 GUID ${m.id}`)
    else byId.set(m.id, p)
  }
  const hashOf = new Map() // current hash by path

  for (const [p, m] of assets) {
    const abs = path.join(root, p)
    if (!fs.existsSync(abs)) { issue('missing-file', p, '只有 .bmeta，找不到文件'); continue }
    const h = contentHash(fs.readFileSync(abs))
    hashOf.set(p, h)
    if (h !== m.hash) err(p, `hash ${m.hash.slice(0, 19)}… differs from the file (${h.slice(0, 19)}…)`)
    const v = m.versions ?? []
    if (!v.length) err(p, 'no version records')
    else if (v[v.length - 1].hash !== m.hash) err(p, 'last version is not the current hash')
    if (m.created.at > (m.modified?.at ?? m.created.at)) err(p, 'created after modified')
    if (v.length && v[0].at !== m.created.at) err(p, 'first version is not the creation time')
    if (m.review?.at && m.modified && m.review.at > m.modified.at) err(p, 'review later than modified')
    const judged = v.find(x => x.hash === m.review?.hash)
    if (m.review?.at && judged && m.review.at < judged.at) err(p, 'review older than the content it judged')
    if (m.origin && !records.has(m.origin)) err(p, `origin ${m.origin} has no record file`)
  }

  // relations
  const currentHashById = id => { const p = byId.get(id); return p ? (hashOf.get(p) ?? assets.get(p).hash) : null }
  for (const [p, m] of assets) {
    for (const r of m.relations ?? []) {
      const toPath = byId.get(r.to)
      if (!toPath) {
        issue('broken-reference', p, `${r.type}${r.slot ? ' · ' + r.slot : ''} → ${r.to}${trash.has(r.to) ? `（在回收站：${trash.get(r.to).name}）` : ''}`)
        continue
      }
      if (r.type === 'source') {
        if (!r.toHash) err(p, 'source relation without toHash')
        else if (r.toHash !== currentHashById(r.to)) issue('stale-upstream', p, `来源 ${toPath} 已更新`)
        if (r.record && !records.has(r.record)) err(p, `record ${r.record} has no file`)
      } else if (r.toHash || r.record) err(p, `${r.type} relation carries toHash/record`)
    }
  }
  for (const [id, r] of records) for (const inp of r.inputs ?? []) {
    const ip = byId.get(inp.id)
    if (!ip) { err('record ' + id, `input ${inp.id} is not in the library`); continue }
    const known = (assets.get(ip).versions ?? []).some(v => v.hash === inp.hash)
    if (!known) err('record ' + id, `input hash of ${ip} is none of its versions`)
  }

  // content duplicates among live assets (by different GUID or same)
  const byHash = new Map()
  for (const p of [...hashOf.keys()].sort(order)) { const h = hashOf.get(p); if (!byHash.has(h)) byHash.set(h, []); byHash.get(h).push(p) }
  for (const ps of byHash.values()) if (ps.length > 1) for (const p of ps.slice(1)) issue('duplicate-content', p, `与 ${ps[0]} 内容完全相同`)

  // files nobody's sidecar covers, and formats
  const builtin = builtinExtensions()
  const declared = lib?.pluginFormats ?? {}
  for (const rel of all) {
    if (ignored(rel)) continue
    if (!assets.has(rel)) issue('unclaimed', rel, '没有 .bmeta（扫描时按 R1/R3 认领）')
    const ext = path.extname(rel).toLowerCase()
    if (builtin.size && !builtin.has(ext)) {
      if (declared[ext] && !(lib.plugins?.[declared[ext]] && builtin.has(ext))) issue('plugin-missing', rel, `${ext} 归 ${declared[ext]} ${lib.plugins?.[declared[ext]] ?? ''}`.trim())
      else notes.push(`unknown format: ${rel}`)
    }
  }
  void fileSet

  // compare with the expectation
  const key = x => `${x.type} ${x.path}`
  const expected = new Set(EXPECTED.map(key))
  for (const i of issues) {
    i.expected = expected.has(key(i))
    if (!i.expected && i.type !== 'unclaimed') err(i.path, `unexpected ${i.type}: ${i.detail}`)
    if (i.type === 'unclaimed') err(i.path, 'file without .bmeta')
  }
  const isFixture = path.basename(root) === 'xingluo' || process.env.BB_VERIFY_EXPECT === '1'
  if (isFixture) for (const e of EXPECTED) if (!issues.some(i => key(i) === key(e))) err(e.path, `expected ${e.type} not found (${e.why})`)

  let bytes = 0
  for (const rel of all) bytes += fs.statSync(path.join(root, rel)).size
  return { root, errors, issues, notes, stats: { assets: assets.size, records: records.size, trash: trash.size, views: views.length, files: all.length, bytes } }
}

export function printReport(r) {
  const mb = (r.stats.bytes / 1048576).toFixed(1)
  console.log(`\n${r.root}\n  ${r.stats.assets} assets · ${r.stats.records} records · ${r.stats.trash} in trash · ${r.stats.views} smart folders · ${r.stats.files} files · ${mb} MB`)
  console.log('  problems (问题清单):')
  for (const i of r.issues) console.log(`    ${i.expected ? '✓' : '✗'} ${i.type.padEnd(18)} ${i.path} — ${i.detail}`)
  for (const n of r.notes) console.log('    · ' + n)
  if (r.errors.length) { console.log(`  ${r.errors.length} error(s):`); for (const e of r.errors) console.log('    ✗ ' + e) }
  else console.log('  OK: every .bmeta matches the schema, hashes match the files, every problem is an expected one')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? path.join(here, '../xingluo')
  const r = verifyLibrary(path.resolve(dir))
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2))
  else printReport(r)
  process.exit(r.errors.length ? 1 : 0)
}
