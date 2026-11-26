/**
 * Hostile images: a decompression bomb (huge dimensions, tiny file) is refused by sharp's default pixel limit
 * instead of being decoded; truncated files settle quickly.
 */
import zlib from 'node:zlib'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { assetFileFor, fileRefFor, sampleDir, settleWithin } from '@bowerbird/plugin-sdk/testing'
import { imageFormat, PIXEL_LIMIT } from './server.js'

const files = sampleDir('bb-image-hostile-')
afterAll(() => files.cleanup())

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  dv.setUint32(8 + data.length, zlib.crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** A 1-bit grey PNG of `w × h` zero pixels: a few hundred kilobytes for hundreds of megapixels. */
function pngBomb(w: number, h: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 1; ihdr[9] = 0
  const row = Math.ceil(w / 8) + 1
  const raw = new Uint8Array(row * h) // filter byte 0 + zero bits
  const idat = zlib.deflateSync(raw, { level: 9 })
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...chunk('IDAT', idat), ...chunk('IEND', new Uint8Array())])
}

describe('pixel limit', () => {
  it('uses sharp\'s default limit (16383 × 16383)', () => {
    expect(PIXEL_LIMIT).toBe(0x3fff * 0x3fff)
  })
  it('refuses a decompression bomb quickly in probe and thumbnail', async () => {
    const p = files.write('bomb.png', pngBomb(20000, 20000))
    expect(await imageFormat.match(fileRefFor(p))).toEqual({ format: 'image', confidence: 1 })
    const r = await settleWithin(5000, () => imageFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(false)
    const t = await settleWithin(5000, () => imageFormat.thumbnail!(assetFileFor(p)))
    expect(t.ok).toBe(false)
  }, 20_000)
  it('settles on truncated files', async () => {
    const good = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#808080' } }).png().toBuffer()
    for (const [name, data] of [['cut.png', good.subarray(0, 60)], ['head.png', good.subarray(0, 8)], ['cut.jpg', (await sharp(good).jpeg().toBuffer()).subarray(0, 200)]] as const) {
      const p = files.write(name, data)
      const r = await settleWithin(3000, () => imageFormat.probe!(assetFileFor(p)))
      expect(r.ms).toBeLessThan(3000)
    }
  })
})

describe('thumbnail sizes', () => {
  it('decodes once and still writes thumb at 512 and preview at 2048 on the long edge', async () => {
    const p = files.write('tall.png', await sharp({ create: { width: 1500, height: 3000, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer())
    const set = await imageFormat.thumbnail!(assetFileFor(p))
    const t = await sharp(set.thumb!).metadata(), v = await sharp(set.preview!).metadata()
    expect([t.width, t.height, t.hasAlpha]).toEqual([256, 512, true])
    expect([v.width, v.height]).toEqual([1024, 2048])
  })
})
