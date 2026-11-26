/**
 * The shared plugin contract (engineering.md「插件契约」), run with the same suite over every built-in plugin and
 * the Forge test plugin. Samples are written here (sharp-drawn images, hand-written WAV / MP4 / WebM / GLB /
 * documents); a second table runs the real files of the 星落镇 sample library (read only).
 *
 * Plugins whose implementation is not there yet fail here on purpose (e.g. a manifest that declares a format no
 * handler registers) — they are never skipped.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assetFileFor, identify, fileRefFor, loadPluginForTest, makeFlac, makeGlb, makeGltfWithBin, makeMp4, makeWav, makeWebm, runFormatContract, runHostileContract,
  runRegistrationContract, runSearchProviderContract, sampleDir, SAMPLE_HTML, SAMPLE_JSON, SAMPLE_MARKDOWN, SAMPLE_TEXT, type FormatSample, type LoadedPlugin
} from '@bowerbird/plugin-sdk/testing'
import { FLAC_B64, MP3_B64, OGG_OPUS_B64, OGG_VORBIS_B64, fromB64 } from '../../plugins/audio/src/__tests__/samples.js'
import { asciiFbx, png, sampleBinaryFbx } from '../../plugins/model/src/__tests__/builders.js'
import {
  fbxBackwardsEnd, fbxDeepAscii, fbxHugeArray, fbxNestedBackwards, fbxZlibBomb, gltfChildCycle, gltfChildFanout, gltfIbmBomb
} from '../../plugins/model/src/__tests__/hostile.js'
import { probeIsolated } from '../../plugins/model/src/__tests__/isolated.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const XINGLUO = path.join(ROOT, 'fixtures/xingluo')
// sharp is a dependency of the image plugin, not of the repository root.
const sharp = createRequire(path.join(ROOT, 'plugins/image/package.json'))('sharp') as typeof import('sharp')

const files = sampleDir('bb-contract-')
afterAll(() => files.cleanup())
const S: Record<string, string> = {}

beforeAll(async () => {
  const solid = (w: number, h: number, alpha = 1) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 180, g: 90, b: 40, alpha } } })
  S.png = files.write('sprite.png', await solid(96, 64, 0.5).png().toBuffer())
  S.jpg = files.write('photo.jpg', await solid(800, 600).jpeg().toBuffer())
  S.wide = files.write('panorama.png', await solid(3000, 1000).png().toBuffer())
  S.webp = files.write('render.webp', await solid(300, 300).webp().toBuffer())
  S.avif = files.write('icon.avif', await solid(32, 32).avif().toBuffer())
  const W = 24, H = 24, raw = Buffer.alloc(W * H * 4 * 4)
  for (let f = 0; f < 4; f++) for (let i = 0; i < W * H; i++) raw.set([f * 60, 120, 200, 255], (f * W * H + i) * 4)
  S.gif = files.write('smoke.gif', await sharp(raw, { raw: { width: W, height: H * 4, channels: 4, pageHeight: H } }).gif({ delay: [80, 80, 80, 80] }).toBuffer())
  S.svg = files.write('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><circle cx="50" cy="50" r="40" fill="#e8a33a"/></svg>')
  S.fakePng = files.write('not_really.png', 'plain text pretending to be a picture')
  S.mp4 = files.write('clip.mp4', makeMp4({ width: 1280, height: 720, fps: 30, duration: 3.2, audio: true }))
  S.mov = files.write('prores.mov', makeMp4({ quicktime: true, codec: 'ap4h', width: 1920, height: 1080, fps: 24, duration: 1 }))
  S.webm = files.write('recording.webm', makeWebm({ duration: 2.5, withDuration: false, withDefaultDuration: false, unknownSizes: true }))
  S.fakeMp4 = files.write('broken.mp4', 'not a video')
  S.wav = files.write('click.wav', makeWav({ sampleRate: 44100, frames: 8820 }))
  S.wavFloat = files.write('pad.wav', makeWav({ sampleRate: 48000, frames: 48000 * 3, channels: 2, bitDepth: 32, float: true }))
  S.mp3 = files.write('coin.mp3', fromB64(MP3_B64))
  S.ogg = files.write('theme.ogg', fromB64(OGG_VORBIS_B64))
  S.opus = files.write('voice.ogg', fromB64(OGG_OPUS_B64))
  S.flac = files.write('hit.flac', fromB64(FLAC_B64))
  S.fakeWav = files.write('noise.wav', 'RIFF but not really')
  S.glb = files.write('chest.glb', makeGlb())
  const gltf = makeGltfWithBin('chest.bin')
  S.gltf = files.write('chest.gltf', gltf.gltf)
  S.bin = files.write('chest.bin', gltf.bin)
  S.fbxAscii = files.write('hero_walk.fbx', asciiFbx([
    { name: 'Body', size: [60, 140, 30], texture: 'hero_basecolor.png' },
    { name: 'Hat', size: [30, 10, 30], texture: 'hat.png', embed: png(8, 4) }
  ], { animation: 'walk', limbs: 3 }))
  S.fbxBinary = files.write('hero_bin.fbx', sampleBinaryFbx(png(16, 32)))
  S.md = files.write('chest.md', SAMPLE_MARKDOWN)
  S.html = files.write('shop.html', SAMPLE_HTML)
  S.txt = files.write('changelog.txt', SAMPLE_TEXT)
  S.json = files.write('export_presets.json', SAMPLE_JSON)
  files.write('shop_v2/index.html', SAMPLE_HTML)
  files.write('shop_v2/shop.js', 'document.title = "x"')
  S.bundle = path.join(files.dir, 'shop_v2')
  S.binaryTxt = files.write('dump.txt', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 1]))
})

interface PluginCase {
  dir: string
  /** Format samples (built from the files written above). */
  samples?: () => FormatSample[]
  /** Search provider contract. */
  search?: { shortTerms: boolean }
  /** Registrations the plugin must make, by extension point. */
  registers: Record<string, string[]>
}

const PLUGINS: Record<string, PluginCase> = {
  'bowerbird.image': {
    dir: 'plugins/image',
    registers: { formats: ['image'] },
    samples: () => [
      { file: S.png!, format: 'image', tech: { width: 96, height: 64, hasAlpha: true, frames: 1 }, techKeys: ['channels', 'colorSpace'], badge: '96×64', thumbnails: ['thumb', 'preview'], summary: /^图片 96×64/ },
      { file: S.jpg!, format: 'image', tech: { width: 800, height: 600, dpi: 72 }, badge: '800×600', thumbEdge: 512, previewEdge: 800 },
      { file: S.wide!, format: 'image', badge: '3000×1000', thumbEdge: 512, previewEdge: 2048 },
      { file: S.webp!, format: 'image', badge: '300×300' },
      { file: S.avif!, format: 'image', badge: '32×32' },
      { file: S.gif!, format: 'image', tech: { frames: 4 }, thumbnails: ['thumb', 'preview', 'scrub'], summary: /动图，4 帧/ },
      { file: S.svg!, format: 'image', tech: { width: 200, height: 100 } },
      { file: S.png!, format: 'image', asset: { views: { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] } }, summary: /格子 2 行 2 列/ },
      { file: S.fakePng!, format: null }
    ]
  },
  'bowerbird.video': {
    dir: 'plugins/video',
    registers: { formats: ['video'] },
    samples: () => [
      { file: S.mp4!, format: 'video', tech: { duration: 3.2, width: 1280, height: 720, frameRate: 30, codec: 'H.264', hasAudio: true }, badge: '0:03', summary: /1280×720，30 fps，编码 H\.264/ },
      { file: S.mov!, format: 'video', tech: { codec: 'ProRes 4444', frameRate: 24 }, badge: '0:01' },
      { file: S.webm!, format: 'video', tech: { codec: 'VP9', frameRate: 30 }, techKeys: ['duration'], badge: '0:03' },
      { file: S.fakeMp4!, format: null }
    ]
  },
  'bowerbird.audio': {
    dir: 'plugins/audio',
    registers: { formats: ['audio'] },
    samples: () => [
      { file: S.wav!, format: 'audio', tech: { duration: 0.2, channels: 1, sampleRate: 44100, bitDepth: 16, codec: 'PCM' }, techKeys: ['loudness', 'peak'], badge: '0.2 秒', thumbnails: ['thumb', 'peaks'], thumbEdge: 512 },
      { file: S.wavFloat!, format: 'audio', tech: { channels: 2, bitDepth: 32, codec: 'PCM 浮点' }, badge: '3.0 秒' },
      { file: S.mp3!, format: 'audio', tech: { codec: 'MP3', channels: 1 }, thumbnails: ['thumb', 'peaks'] },
      { file: S.ogg!, format: 'audio', tech: { codec: 'Vorbis' } },
      { file: S.opus!, format: 'audio', tech: { codec: 'Opus' } },
      { file: S.flac!, format: 'audio', tech: { codec: 'FLAC', bitDepth: 16 } },
      { file: S.fakeWav!, format: null }
    ]
  },
  'bowerbird.model': {
    dir: 'plugins/model',
    registers: { formats: ['model', 'gltf-buffer'], validators: ['size-vs-design'] },
    samples: () => [
      { file: S.glb!, format: 'model', tech: { triangles: 1, vertices: 3, meshes: 1, materials: 1 }, techKeys: ['boundsX', 'boundsY', 'boundsZ'] },
      { file: S.gltf!, format: 'model', tech: { triangles: 1 }, references: ['chest.bin'] },
      { file: S.bin!, format: 'gltf-buffer' },
      { file: S.fbxAscii!, format: 'model', tech: { triangles: 24, vertices: 16, meshes: 2, materials: 2, bones: 3, animations: 1, hasUV: true }, references: ['hero_basecolor.png', 'hat.png'], badge: '24 面', summary: /walk/ },
      { file: S.fbxBinary!, format: 'model', tech: { triangles: 12, vertices: 8, meshes: 1, materials: 2, bones: 2, animations: 1, vertexColorSets: 2 }, references: ['hero_skin.png', 'hero_cloth.png'], badge: '12 面' }
    ]
  },
  'bowerbird.doc': {
    dir: 'plugins/doc',
    registers: { formats: ['doc'] },
    samples: () => [
      { file: S.md!, format: 'doc', tech: { title: '宝箱', targetWidth: 1.26, targetHeight: 0.95, targetDepth: 0.87 }, techKeys: ['words', 'lines'], text: '新手村第一个可以打开的容器', summary: /^标题：宝箱\n目标尺寸：1\.26 × 0\.95 × 0\.87 m/ },
      { file: S.html!, format: 'doc', tech: { title: '商店界面原型' }, text: '杂货铺' },
      { file: S.txt!, format: 'doc', tech: { title: 'changelog.txt', lines: 2 } },
      { file: S.json!, format: 'doc', tech: { title: 'export_presets.json', valid: true } },
      { file: S.bundle!, format: 'doc', tech: { title: '商店界面原型' } },
      { file: S.binaryTxt!, format: null }
    ]
  },
  'bowerbird.search-keyword': {
    dir: 'plugins/search-keyword',
    registers: { searchProviders: ['keyword'] },
    search: { shortTerms: true }
  },
  'community.forge': {
    dir: 'fixtures/plugins/forge',
    registers: { creators: ['image', 'model'] }
  }
}

const loaded: Record<string, Promise<LoadedPlugin>> = {}
const load = (id: string) => (loaded[id] ??= loadPluginForTest(path.join(ROOT, PLUGINS[id]!.dir)))

afterAll(async () => {
  for (const p of Object.values(loaded)) {
    const l = await p.catch(() => null)
    await l?.plugin?.deactivate?.()
  }
})

describe.each(Object.keys(PLUGINS))('plugin contract: %s', id => {
  const c = PLUGINS[id]!

  it('loads, and the manifest agrees with what activate() registers', async () => {
    const l = await load(id)
    expect(l.manifest.id).toBe(id)
    const report = runRegistrationContract(l)
    for (const [point, ids] of Object.entries(c.registers)) expect(report[point] ?? []).toEqual(expect.arrayContaining(ids))
  })

  if (c.samples) {
    it('format contract: identify, probe, thumbnails, summary', async () => {
      const results = await runFormatContract(await load(id), c.samples!())
      expect(results.length).toBe(c.samples!().length)
    }, 60_000)
  }

  if (c.search) {
    it('search provider contract', async () => {
      const l = await load(id)
      const provider = l.ctx.registered.searchProviders[0]
      expect(provider, 'no search provider registered').toBeDefined()
      const hits = await runSearchProviderContract(provider!, c.search)
      expect(hits.length).toBeGreaterThan(0)
    })
  }
})

/** Real files of the sample library: which built-in plugin claims each, and what it must read. */
const REAL: Array<[string, string | null, Partial<FormatSample>]> = [
  ['environments/world_map_16k.png', 'bowerbird.image', { format: 'image', tech: { width: 16384, height: 9216 }, badge: '16384×9216' }],
  ['props/chest/chest_turnaround.png', 'bowerbird.image', { format: 'image', badge: '2048×2048' }],
  ['vfx/vfx_smoke.gif', 'bowerbird.image', { format: 'image', tech: { frames: 24 }, thumbnails: ['scrub'] }],
  ['environments/intro_cutscene.mov', 'bowerbird.video', { format: 'video', tech: { codec: 'ProRes 4444' } }],
  ['props/chest/chest_open_preview.mp4', 'bowerbird.video', { format: 'video', tech: { codec: 'VP9', hasAudio: true } }],
  ['audio/music/theme_town.ogg', 'bowerbird.audio', { format: 'audio', tech: { codec: 'Vorbis', channels: 2 }, badge: '2:14' }],
  ['props/chest/chest_open.wav', 'bowerbird.audio', { format: 'audio', badge: '0.8 秒' }],
  ['audio/sfx/ui_click.wav', 'bowerbird.audio', { format: 'audio', badge: '0.2 秒' }],
  ['props/chest/chest.md', 'bowerbird.doc', { format: 'doc', tech: { title: '宝箱', targetWidth: 1.26, targetHeight: 0.95, targetDepth: 0.87 } }],
  ['docs/export_presets.json', 'bowerbird.doc', { format: 'doc', tech: { valid: true } }],
  ['docs/changelog.txt', 'bowerbird.doc', { format: 'doc' }],
  ['ui/shop/shop_prototype.html', 'bowerbird.doc', { format: 'doc' }],
  ['ui/shop_v2', 'bowerbird.doc', { format: 'doc' }],
  ['props/chest/chest.glb', 'bowerbird.model', { format: 'model' }],
  ['characters/hero/hero_walk.fbx', 'bowerbird.model', { format: 'model' }],
  ['environments/sky_noon.hdr', null, {}],
  ['environments/rock_01.obj', null, {}],
  ['props/chest/chest_high.blend', null, {}],
  ['characters/hero/hero_run.skel', null, {}]
]
const FORMAT_PLUGINS = Object.keys(PLUGINS).filter(id => PLUGINS[id]!.samples)

describe('sample library 星落镇 (real files)', () => {
  it.each(REAL)('%s → %s', async (rel, pluginId, sample) => {
    const file = path.join(XINGLUO, rel)
    expect(fs.existsSync(file), `missing fixture ${rel}`).toBe(true)
    const ref = fileRefFor(file)
    // Only the expected plugin claims it (no other built-in format plugin does).
    for (const other of FORMAT_PLUGINS.filter(p => p !== pluginId)) {
      const h = await identify(await load(other), ref)
      expect(h?.id ?? null, `${rel} is also claimed by ${other}`).toBeNull()
    }
    if (pluginId) await runFormatContract(await load(pluginId), [{ file, format: sample.format ?? null, ...sample }])
  }, 60_000)
})

/**
 * bowerbird.model on files that lie about themselves (review P1-1 … P1-3): each is claimed by its header, and the
 * probe (with the size check) must refuse it or read it within bounds — never hang. Runs in a worker with a time
 * limit, so a regression fails instead of blocking the run. Generators: plugins/model/src/__tests__/hostile.ts.
 */
const MALFORMED_MODELS: Array<[string, () => Uint8Array | string, 'ok' | 'error']> = [
  ['fbx-backwards-end.fbx', fbxBackwardsEnd, 'error'],
  ['fbx-nested-backwards.fbx', fbxNestedBackwards, 'error'],
  ['fbx-zlib-bomb.fbx', () => fbxZlibBomb(64), 'ok'],
  ['fbx-huge-array.fbx', fbxHugeArray, 'ok'],
  ['fbx-deep.fbx', () => fbxDeepAscii(), 'error'],
  ['gltf-child-cycle.glb', gltfChildCycle, 'ok'],
  ['gltf-child-fanout.glb', () => gltfChildFanout(), 'ok'],
  ['gltf-ibm-bomb.glb', gltfIbmBomb, 'ok']
]

describe('bowerbird.model: malformed files fail fast', () => {
  it.each(MALFORMED_MODELS)('%s → %s', async (name, make, outcome) => {
    const file = files.write(name, make())
    const handler = await identify(await load('bowerbird.model'), fileRefFor(file))
    expect(handler?.id).toBe('model')
    const r = await probeIsolated(file, 5000)
    expect(r.status).toBe(outcome)
  }, 20_000)
})

describe('bowerbird.model: size-vs-design runs', () => {
  it('passes when the bounds match the design object, fails axis by axis when they do not', async () => {
    const l = await load('bowerbird.model')
    const v = l.ctx.registered.validators.find(x => x.id === 'size-vs-design')!
    expect(v.appliesTo({ format: 'model' } as never)).toBe(true)
    const id = '00000000-0000-7000-8000-0000000000d0'
    const [match] = await v.check(assetFileFor(S.glb!, { designObject: { id, targetSize: { w: 1, h: 1, d: 1 } } }))
    expect(match).toMatchObject({ rule: 'size-vs-design', verdict: 'pass', message: '尺寸与设计对象：模型 1.00 × 1.00 × 1.00 m · 目标 1.00 × 1.00 × 1.00 m' })
    const [off] = await v.check(assetFileFor(S.glb!, { designObject: { id, targetSize: { w: 1.2, h: 1, d: 1 } } }))
    expect(off).toMatchObject({ verdict: 'fail', message: '尺寸与设计对象：模型 1.00 × 1.00 × 1.00 m · 目标 1.20 × 1.00 × 1.00 m · 宽 1.00 m，应为 1.20' })
    expect(await v.check(assetFileFor(S.glb!))).toEqual([])
  })
})

/* ───────────── hostile input (P2-9) ───────────── */

const H = sampleDir('bb-contract-hostile-')
afterAll(() => H.cleanup())
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
/** `head`, then zeros up to `size` (sparse: cheap to make, huge to read). */
function sparse(name: string, head: Uint8Array | number[], size: number): string {
  const p = H.write(name, new Uint8Array(head))
  fs.truncateSync(p, size)
  return p
}
function pngChunk(type: string, data: Uint8Array): number[] {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data])
  return [...u32(data.length), ...body, ...u32(zlib.crc32(body))]
}
/** 1-bit PNG of w × h zero pixels: a few hundred kilobytes, hundreds of megapixels. */
function pngBomb(w: number, h: number): Uint8Array {
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 1, 0, 0, 0, 0])
  const idat = zlib.deflateSync(new Uint8Array((Math.ceil(w / 8) + 1) * h), { level: 9 })
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...pngChunk('IHDR', ihdr), ...pngChunk('IDAT', idat), ...pngChunk('IEND', new Uint8Array())])
}
/** A WAV header claiming `rate` / `channels`, followed by `bytes` of silence. */
function wavHeader(rate: number, channels: number, bytes: number): Uint8Array {
  const h = makeWav({ sampleRate: 8000, frames: 1 }).slice(0, 44)
  const dv = new DataView(h.buffer)
  dv.setUint16(22, channels, true); dv.setUint32(24, rate, true); dv.setUint16(32, Math.max(1, channels) * 2, true); dv.setUint32(40, bytes, true); dv.setUint32(4, 36 + bytes, true)
  return h
}

const HOSTILE: Record<string, () => Promise<string[]> | string[]> = {
  'bowerbird.image': async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).png().toBuffer()
    return [
      H.write('img_truncated.png', png.subarray(0, 40)),
      H.write('img_header_only.png', png.subarray(0, 8)),
      H.write('img_bomb.png', pngBomb(20000, 20000)),
      H.write('img_empty.png', new Uint8Array()),
      H.write('img_svg_bomb.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1000000" height="1000000"><rect width="10" height="10"/></svg>')
    ]
  },
  'bowerbird.video': () => [
    sparse('vid_big_moov.mp4', [...makeMp4().subarray(0, 32), ...u32(200 * 1024 * 1024), 0x6d, 0x6f, 0x6f, 0x76], 32 + 200 * 1024 * 1024),
    H.write('vid_truncated.mp4', makeMp4({ audio: true }).subarray(0, 200)),
    sparse('vid_big_tracks.webm', [...makeWebm().subarray(0, makeWebm().indexOf(0x18)), 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x16, 0x54, 0xae, 0x6b, 0x01, 0, 0, 0, ...u32(100 * 1024 * 1024)], 100 * 1024 * 1024 + 64),
    H.write('vid_garbage.webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Uint8Array(8192).fill(0x01)])),
    H.write('vid_live_cut.webm', makeWebm({ duration: 3, withDuration: false, unknownSizes: true }).subarray(0, 120))
  ],
  'bowerbird.audio': () => [
    H.write('aud_rate0.wav', wavHeader(0, 1, 0)),
    sparse('aud_rate1_big.wav', wavHeader(1, 1, 64 * 1024 * 1024), 44 + 64 * 1024 * 1024),
    H.write('aud_channels99.wav', wavHeader(48000, 99, 0)),
    H.write('aud_bomb.flac', makeFlac({ frames: 3000, blockSize: 65535, constant: 0.3 })),
    H.write('aud_truncated.wav', makeWav({ frames: 1000 }).subarray(0, 30)),
    H.write('aud_ogg_header_only.ogg', new Uint8Array([...new TextEncoder().encode('OggS'), 0, 2, ...new Array(22).fill(0), 1, 30, 1, ...new TextEncoder().encode('vorbis')]))
  ],
  'bowerbird.doc': () => {
    const evil = path.join(H.dir, 'doc_escape_bundle')
    fs.mkdirSync(evil, { recursive: true })
    const outside = H.write('outside.html', '<title>outside the bundle</title>')
    if (!fs.existsSync(path.join(evil, 'index.html'))) fs.symlinkSync(outside, path.join(evil, 'index.html'))
    return [
      H.write('doc_deep.json', '['.repeat(1_000_000) + ']'.repeat(1_000_000)),
      H.write('doc_regex.md', '---\nsize: 1' + ' '.repeat(100_000) + 'x\n---\n# a' + ' '.repeat(100_000) + 'b\n' + '!['.repeat(100_000) + '\n' + '**'.repeat(100_000)),
      H.write('doc_tags.html', '<'.repeat(500_000) + '<!--'.repeat(100_000) + '<script>'.repeat(10_000)),
      sparse('doc_huge.txt', new TextEncoder().encode('line\n'.repeat(100)), 256 * 1024 * 1024),
      H.write('doc_entities.html', '&#x110000;'.repeat(10_000) + '&#99999999999;'),
      evil
    ]
  },
  'bowerbird.model': () => {
    const glb = makeGlb()
    const big = new Uint8Array(glb)
    new DataView(big.buffer).setUint32(12, 0x7fffffff, true) // JSON chunk length far beyond the file
    return [
      H.write('mdl_truncated.glb', glb.subarray(0, 30)),
      H.write('mdl_bad_json_len.glb', big),
      H.write('mdl_header_only.glb', new Uint8Array([0x67, 0x6c, 0x54, 0x46, ...le32(2), ...le32(12)])),
      H.write('mdl_deep.gltf', '{"asset":{"version":"2.0"},"nodes":' + '['.repeat(200_000) + ']'.repeat(200_000) + '}')
    ]
  }
}

/** Each call (identify, probe, thumbnail, summary) must return or reject within this many milliseconds. */
const HOSTILE_MS = 5000

describe.each(Object.keys(HOSTILE))('hostile input: %s', id => {
  it('every stage settles within the time limit (returns or rejects cleanly)', async () => {
    const outcomes = await runHostileContract(await load(id), await HOSTILE[id]!(), HOSTILE_MS)
    expect(outcomes.length).toBeGreaterThan(0)
  }, 120_000)
})
