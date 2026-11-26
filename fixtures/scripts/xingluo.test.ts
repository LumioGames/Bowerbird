/**
 * Assertions over the committed sample library「星落镇」(fixtures/xingluo), the upload batch and the helper scripts.
 * Set BB_FIXTURES_REGEN=1 to also regenerate everything into a temp dir and compare byte for byte (needs ffmpeg;
 * sharp / librsvg / ffmpeg versions must match the ones that produced the committed files).
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { Bmeta, parseTargetSize, BUILTIN_METHODS } from '@bowerbird/schema'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
// @ts-expect-error — plain ESM scripts without type declarations
import { verifyLibrary, EXPECTED } from './verify-xingluo.mjs'
// @ts-expect-error — plain ESM script
import { makeFirstOpen } from './make-first-open.mjs'
// @ts-expect-error — plain ESM script
import { copyLibrary, FIXTURE_NOW } from './copy-library.mjs'
// @ts-expect-error — plain ESM script
import { walk } from './lib/util.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(here, '../xingluo')
const BATCH = path.resolve(here, '../upload-batch')
const read = (p: string) => fs.readFileSync(path.join(LIB, p))
const meta = (p: string) => Bmeta.parse(JSON.parse(read(p + '.bmeta').toString('utf8')))
const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `bb-fixtures-${name}-`))
const glbJson = (buf: Buffer) => JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'))

describe('「星落镇」sample library', () => {
  const report = verifyLibrary(LIB)

  it('verifies clean: schema, hashes, records, relations — only the expected problems', () => {
    expect(report.errors).toEqual([])
    const found = report.issues.map((i: { type: string; path: string }) => `${i.type} ${i.path}`).sort()
    expect(found).toEqual(EXPECTED.map((e: { type: string; path: string }) => `${e.type} ${e.path}`).sort())
    expect(report.stats.assets).toBe(72)
    expect(report.stats.records).toBe(10)
    expect(report.stats.trash).toBe(4)
    expect(report.stats.bytes).toBeLessThan(40 * 1024 * 1024)
  })

  it('keeps the prototype GUIDs and states', () => {
    expect(meta('props/chest/chest.glb').id).toBe('0192f3a4-7c1e-7b52-9d06-4e8a51c0d205')
    expect(meta('props/chest/chest.glb').review).toEqual({ status: 'pending' })
    expect(meta('characters/hero/hero.glb').review).toMatchObject({ status: 'rejected', by: 'user:lin', note: '左肩甲穿模，手腕权重要重刷' })
    expect(meta('props/chest/chest_concept.png').review).toMatchObject({ status: 'approved', note: '包边颜色可以，按这个出四视图' })
    expect(meta('props/chest/chest.md').review).toEqual({ status: 'exempt' })
    expect(meta('props/chest/chest_turnaround.png').views).toEqual({ rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] })
    expect(meta('props/chest/chest_concept.png').auto).toMatchObject({ tags: ['木质', '黄铜', '卡通'] })
    const glb = meta('props/chest/chest.glb')
    expect(glb.versions!.map(v => v.note)).toEqual(['初版', '修正包边比例'])
    expect(glb.description).toContain('新手村第一个能打开的宝箱')
  })

  it('上游已更新: chest_icon.png points at chest.glb version 1', () => {
    const icon = meta('props/chest/chest_icon.png'), glb = meta('props/chest/chest.glb')
    const src = icon.relations!.find(r => r.type === 'source')!
    expect(src.to).toBe(glb.id)
    expect(src.toHash).toBe(glb.versions![0]!.hash)
    expect(src.toHash).not.toBe(glb.hash)
  })

  it('断链: potion.glb uses potion_basecolor.png, which is in the trash with the same GUID', () => {
    const rel = meta('props/potion/potion.glb').relations!.find(r => r.slot === 'potion_basecolor.png')!
    const trashDir = path.join(LIB, '.bowerbird/trash')
    const infos = fs.readdirSync(trashDir).map(id => JSON.parse(fs.readFileSync(path.join(trashDir, id, 'info.json'), 'utf8')))
    expect(infos.find(i => i.assetId === rel.to)).toMatchObject({ name: 'potion_basecolor.png', originalPath: 'props/potion/potion_basecolor.png', deletedBy: 'user:mo' })
    expect(infos.map(i => i.name).sort()).toEqual(['btn_close.png', 'chest_v0.glb', 'moodboard_old.jpg', 'potion_basecolor.png'])
  })

  it('重复身份 and 内容重复: a copy with its .bmeta, and a byte-identical pair', () => {
    expect(read('ui/shop/btn_buy (1).png.bmeta').equals(read('ui/shop/btn_buy.png.bmeta'))).toBe(true)
    expect(read('ui/hud/panel_bg.png').equals(read('ui/shop/panel_bg.png'))).toBe(true)
    expect(meta('ui/hud/panel_bg.png').id).not.toBe(meta('ui/shop/panel_bg.png').id)
  })

  it('元数据冲突: a cloud-drive conflicted copy whose tags differ', () => {
    const copy = JSON.parse(read("ui/shop/shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta").toString('utf8'))
    expect(copy.id).toBe(meta('ui/shop/shop_prototype.html').id)
    expect(copy.tags).toEqual([...meta('ui/shop/shop_prototype.html').tags!, 'v2'])
  })

  it('文件缺失 and 缺少插件', () => {
    expect(fs.existsSync(path.join(LIB, 'characters/hero/hero_idle.fbx'))).toBe(false)
    expect(meta('characters/hero/hero_idle.fbx').id).toBe('0192f3a4-7c1e-7b52-9d06-4e8a51c0d225')
    const lib = JSON.parse(read('.bowerbird/library.json').toString('utf8'))
    expect(lib.name).toBe('星落镇')
    expect(lib.plugins).toMatchObject({ 'bowerbird.image': '^0.1.0', 'bowerbird.model': '^0.1.0', 'bowerbird.search-keyword': '^0.1.0', 'community.spine': '^1.4.0' })
    expect(Object.keys(lib.plugins)).toHaveLength(7)
    expect(lib.pluginFormats['.skel']).toBe('community.spine')
    expect(lib.settings).toEqual({ defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 })
    expect(fs.existsSync(path.join(LIB, '.bowerbird/cache'))).toBe(false)
  })

  it('production records: built-in methods, prompts copied, inputs with roles; lantern_concept has an origin without inputs', () => {
    const recDir = path.join(LIB, '.bowerbird/records/2026')
    const recs = fs.readdirSync(recDir).map(f => JSON.parse(fs.readFileSync(path.join(recDir, f), 'utf8')))
    for (const r of recs) expect(BUILTIN_METHODS).toContain(r.method)
    const lantern = meta('props/lantern/lantern_concept.png')
    const rec = recs.find(r => r.id === lantern.origin)!
    expect(rec).toMatchObject({ method: 'ai-generate', tool: 'concept-gen 2.1', by: 'agent:concept-artist', params: { seed: 7730 } })
    expect(rec.prompt).toContain('提灯的原画')
    expect(rec.inputs).toBeUndefined()
    const slice = recs.find(r => r.method === 'slice')!
    expect(Object.keys(slice.params.rect)).toHaveLength(12)
    const turn = recs.find(r => r.params?.template === '四视图')!
    expect(turn.inputs).toEqual([{ id: meta('props/chest/chest_concept.png').id, hash: meta('props/chest/chest_concept.png').hash, role: '参考图' }])
    // the most recent asset is the one the Agent just registered
    const all = [...walk(LIB)].filter((p: string) => p.endsWith('.bmeta') && !p.includes('_folder') && !p.includes('conflicted') && !p.startsWith('.bowerbird'))
    const latest = all.map((p: string) => [p, JSON.parse(fs.readFileSync(path.join(LIB, p), 'utf8')).created.at]).sort((a: string[], b: string[]) => (a[1]! < b[1]! ? 1 : -1))[0]
    expect(latest[0]).toBe('props/lantern/lantern_concept.png.bmeta')
  })

  it('chest.md: target size in front matter, bb://<GUID> references that exist', () => {
    const md = read('props/chest/chest.md').toString('utf8')
    const fm = /^---\n([\s\S]*?)\n---/.exec(md)![1]!
    expect(parseTargetSize(/size:\s*(.+)/.exec(fm)![1]!)).toEqual({ w: 1.26, h: 0.95, d: 0.87 })
    const refs = [...md.matchAll(/bb:\/\/([0-9a-f-]{36})/g)].map(m => m[1])
    expect(refs).toEqual([meta('props/chest/chest_concept.png').id, meta('props/chest/chest_turnaround.png').id])
  })

  it('images have the sizes the prototype shows; the GIF is animated; HDRs are Radiance files', async () => {
    const sizes: Record<string, [number, number]> = {
      'props/chest/chest_concept.png': [1536, 1536], 'props/chest/chest_turnaround.png': [2048, 2048], 'props/chest/chest_basecolor.png': [1024, 1024],
      'props/chest/chest_icon.png': [256, 256], 'ui/hud/hud_health.png': [512, 64], 'environments/env_village.png': [3840, 2160],
      'environments/world_map_16k.png': [16384, 9216], 'ui/shop/shop_mockup.png': [1920, 1080], 'ui/shop_v2/coin.png': [64, 64], 'ui/shop_v2/slot.png': [128, 128]
    }
    for (const [p, [w, h]] of Object.entries(sizes)) {
      const m = await sharp(read(p), { limitInputPixels: false }).metadata()
      expect([p, m.width, m.height]).toEqual([p, w, h])
    }
    expect((await sharp(read('props/chest/chest_icon.png')).metadata()).hasAlpha).toBe(true)
    const gif = await sharp(read('vfx/vfx_smoke.gif'), { animated: true }).metadata()
    expect([gif.width, gif.pageHeight, gif.pages]).toEqual([512, 512, 24])
    for (const p of ['environments/sky_noon.hdr', 'environments/forest_dusk.hdr']) {
      const head = read(p).subarray(0, 200).toString('latin1')
      expect(head.startsWith('#?RADIANCE')).toBe(true)
      expect(head).toContain('-Y 2048 +X 4096')
    }
  })

  it('models: chest.glb names its textures by slot (external URIs) and has vertex colours; hero_walk.fbx loads in three', () => {
    const chest = glbJson(read('props/chest/chest.glb'))
    const slots = meta('props/chest/chest.glb').relations!.filter(r => r.slot).map(r => r.slot).sort()
    expect(chest.images.map((i: { uri: string }) => i.uri).sort()).toEqual(slots)
    expect(chest.meshes.some((m: { primitives: Array<{ attributes: Record<string, number> }> }) => 'COLOR_0' in m.primitives[0]!.attributes)).toBe(true)
    expect(chest.animations.map((a: { name: string }) => a.name)).toEqual(['open'])
    const tris = (j: { accessors: Array<{ count: number }>; meshes: Array<{ primitives: Array<{ indices: number }> }> }) =>
      j.meshes.reduce((n, m) => n + j.accessors[m.primitives[0]!.indices]!.count / 3, 0)
    expect(tris(chest)).toBe(2480)
    expect(tris(glbJson(read('props/potion/potion.glb')))).toBe(1120)
    expect(tris(glbJson(read('props/weapon/sword_iron.glb')))).toBe(3860)
    expect(tris(glbJson(read('characters/hero/hero.glb')))).toBe(8912)
    expect(glbJson(read('props/potion/potion.glb')).images.map((i: { uri: string }) => i.uri).sort()).toEqual(['potion_basecolor.png', 'potion_normal.png'])

    const fbx = read('characters/hero/hero_walk.fbx')
    const obj = new FBXLoader().parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.length) as ArrayBuffer, '')
    let n = 0
    const materials = new Set<string>()
    obj.traverse(o => {
      const mesh = o as unknown as { isMesh?: boolean; geometry: { index: { count: number } | null; attributes: { position: { count: number } } }; material: { type: string; roughnessMap?: unknown } }
      if (mesh.isMesh) { n += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3; materials.add(mesh.material.type) }
    })
    expect(n).toBe(8912)
    expect(obj.animations.map(a => a.name)).toEqual(['walk'])
    expect([...materials]).toEqual(['MeshPhongMaterial']) // base colour only: no roughness / metalness / occlusion
  })

  it('audio and video: one sound clips, the preview is VP9 + Opus in MP4, the cut-scene is ProRes 4444', () => {
    const peak = (p: string) => { const b = read(p); let m = 0; for (let i = 44; i < b.length; i += 2) m = Math.max(m, Math.abs(b.readInt16LE(i))); return m }
    expect(peak('audio/sfx/coin_pickup.wav')).toBe(32767)
    expect(peak('audio/sfx/ui_click.wav')).toBeLessThan(32767)
    expect(peak('props/chest/chest_open.wav')).toBeLessThan(32767)
    expect(read('props/chest/chest_open.wav').readUInt32LE(40) / 2 / 44100).toBeCloseTo(0.8, 3)
    const ogg = read('audio/music/theme_town.ogg')
    expect(ogg.subarray(0, 4).toString('latin1')).toBe('OggS')
    expect(ogg.includes(Buffer.from('vorbis'))).toBe(true)
    const mp4 = read('props/chest/chest_open_preview.mp4')
    expect(mp4.includes(Buffer.from('vp09'))).toBe(true)
    expect(mp4.includes(Buffer.from('Opus'))).toBe(true)
    expect(mp4.includes(Buffer.from('avc1'))).toBe(false)
    expect(read('environments/intro_cutscene.mov').includes(Buffer.from('ap4h'))).toBe(true)
  })

  it('the verifier is not vacuous: a changed file and a dangling relation are errors', () => {
    const dir = tmp('broken')
    copyLibrary(dir, { force: true })
    fs.appendFileSync(path.join(dir, 'docs/changelog.txt'), 'x')
    const p = path.join(dir, 'props/chest/chest_icon.png.bmeta')
    const m = JSON.parse(fs.readFileSync(p, 'utf8'))
    m.relations.push({ type: 'uses', to: '0192f3a4-7c1e-7b52-9d06-ffffffffffff' })
    fs.writeFileSync(p, JSON.stringify(m))
    const r = verifyLibrary(dir)
    expect(r.errors.some((e: string) => e.startsWith('docs/changelog.txt: hash'))).toBe(true)
    expect(r.errors.some((e: string) => e.includes('unexpected broken-reference'))).toBe(true)
  })
})

describe('helper scripts', () => {
  it('make-first-open copies only the asset files', () => {
    const dir = tmp('first-open')
    const r = makeFirstOpen(dir, { force: true })
    const files = [...walk(dir)] as string[]
    expect(r.files).toBe(files.length)
    expect(files.some(f => f.endsWith('.bmeta') || f.startsWith('.bowerbird'))).toBe(false)
    expect(files).toContain('props/chest/chest.glb')
    expect(files).not.toContain('characters/hero/hero_idle.fbx')
    expect(files.length).toBe(71)
  })

  it('copy-library --rebase-trash keeps each trashed item as old as it was on 2026-11-25', () => {
    const dir = tmp('copy')
    const now = Date.UTC(2027, 2, 1)
    copyLibrary(dir, { force: true, rebaseTrash: true, now })
    const trashDir = path.join(dir, '.bowerbird/trash')
    const ages = fs.readdirSync(trashDir).map(id => {
      const before = JSON.parse(fs.readFileSync(path.join(LIB, '.bowerbird/trash', id, 'info.json'), 'utf8')).deletedAt
      const after = JSON.parse(fs.readFileSync(path.join(trashDir, id, 'info.json'), 'utf8')).deletedAt
      return [FIXTURE_NOW - Date.parse(before), now - Date.parse(after)]
    })
    for (const [a, b] of ages) expect(b).toBe(a)
  })

  it('generate-100k is deterministic, all contents differ, and the sidecars verify', () => {
    const a = tmp('perf-a'), b = tmp('perf-b')
    for (const d of [a, b]) {
      const r = spawnSync(process.execPath, [path.join(here, 'generate-100k.mjs'), d, '--count', '400', '--with-sidecars', '--force'])
      expect(r.status, r.stderr.toString()).toBe(0)
    }
    const files = [...walk(a)] as string[]
    expect(files.filter(f => !f.endsWith('.bmeta') && !f.startsWith('.bowerbird'))).toHaveLength(400)
    const hashes = new Set<string>()
    for (const f of files) {
      const x = fs.readFileSync(path.join(a, f))
      expect(x.equals(fs.readFileSync(path.join(b, f)))).toBe(true)
      if (!f.endsWith('.bmeta') && !f.startsWith('.bowerbird')) hashes.add(crypto.createHash('sha256').update(x).digest('hex'))
    }
    expect(hashes.size).toBe(400)
    const r = verifyLibrary(a)
    expect(r.errors.filter((e: string) => !e.includes('unknown format'))).toEqual([])
    expect(r.issues).toEqual([])
  })
})

describe('upload batch', () => {
  it('has the prototype batch with its same-name files', () => {
    const files = [...walk(BATCH)].sort()
    expect(files).toEqual([
      'export/hud/icon_lantern.png', 'export/ui/icon_lantern.png', 'export/v2/lantern_basecolor.png',
      'lantern.glb', 'lantern.md', 'lantern_basecolor.png', 'lantern_concept.png', 'lantern_light.wav', 'lantern_normal.png'
    ])
    const ui = fs.readFileSync(path.join(BATCH, 'export/ui/icon_lantern.png')), hud = fs.readFileSync(path.join(BATCH, 'export/hud/icon_lantern.png'))
    expect(ui.equals(hud)).toBe(false)
    expect(glbJson(fs.readFileSync(path.join(BATCH, 'lantern.glb'))).images.map((i: { uri: string }) => i.uri).sort()).toEqual(['lantern_basecolor.png', 'lantern_normal.png'])
    // lantern_concept.png also exists in the library (same name → replace / keep both / skip)
    expect(fs.existsSync(path.join(LIB, 'props/lantern/lantern_concept.png'))).toBe(true)
  })
})

describe.runIf(process.env.BB_FIXTURES_REGEN === '1')('regeneration', () => {
  it('the generators reproduce the committed files byte for byte', () => {
    const out = tmp('regen'), batch = tmp('regen-batch')
    const g = spawnSync(process.execPath, [path.join(here, 'generate-xingluo.mjs'), '--out', out], { encoding: 'utf8' })
    expect(g.status, g.stderr).toBe(0)
    const u = spawnSync(process.execPath, [path.join(here, 'generate-upload-batch.mjs'), '--out', batch], { encoding: 'utf8' })
    expect(u.status, u.stderr).toBe(0)
    for (const [root, mine] of [[LIB, out], [BATCH, batch]] as const) {
      const committed = [...walk(root)] as string[], fresh = [...walk(mine)] as string[]
      expect(fresh).toEqual(committed)
      for (const f of committed) expect([f, fs.readFileSync(path.join(mine, f)).equals(fs.readFileSync(path.join(root, f)))]).toEqual([f, true])
    }
  }, 180_000)
})
