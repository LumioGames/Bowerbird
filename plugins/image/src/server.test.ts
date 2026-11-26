import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assetFileFor, fileRefFor } from '@bowerbird/plugin-sdk/testing'
import { detectImage, looksLikeSvg } from './detect.js'
import { dominantColors } from './shared/palette.js'
import { imageFormat, PREVIEW_EDGE, THUMB_EDGE } from './server.js'

let dir: string
const f = (n: string) => path.join(dir, n)

async function rgbaSolid(w: number, h: number, c: { r: number; g: number; b: number; alpha: number }) {
  return sharp({ create: { width: w, height: h, channels: 4, background: c } })
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-image-'))
  await (await rgbaSolid(64, 32, { r: 200, g: 40, b: 40, alpha: 0.5 })).png().toFile(f('alpha.png'))
  await (await rgbaSolid(2000, 1000, { r: 20, g: 120, b: 220, alpha: 1 })).jpeg().toFile(f('wide.jpg'))
  await (await rgbaSolid(4000, 1000, { r: 20, g: 120, b: 220, alpha: 1 })).webp().toFile(f('huge.webp'))
  await (await rgbaSolid(16, 16, { r: 0, g: 0, b: 0, alpha: 1 })).avif().toFile(f('tiny.avif'))
  const W = 40, H = 30, raw = Buffer.alloc(W * H * 4 * 3)
  for (let fr = 0; fr < 3; fr++) for (let i = 0; i < W * H; i++) { const o = (fr * W * H + i) * 4; raw[o] = fr * 100; raw[o + 1] = 50; raw[o + 2] = 200; raw[o + 3] = 255 }
  await sharp(raw, { raw: { width: W, height: H * 3, channels: 4, pageHeight: H } }).gif({ delay: [80, 80, 80], loop: 0 }).toFile(f('anim.gif'))
  fs.writeFileSync(f('logo.svg'), '<?xml version="1.0"?>\n<!-- a logo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#ff0000"/></svg>')
  fs.writeFileSync(f('fake.png'), 'this is not an image')
  // Two-colour sheet for the palette: 3/4 red, 1/4 blue.
  const px = Buffer.alloc(40 * 40 * 4)
  for (let i = 0; i < 40 * 40; i++) { const blue = i % 40 >= 30; px[i * 4] = blue ? 0 : 255; px[i * 4 + 2] = blue ? 255 : 0; px[i * 4 + 3] = 255 }
  await sharp(px, { raw: { width: 40, height: 40, channels: 4 } }).png().toFile(f('two.png'))
})
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('detectImage', () => {
  it('recognises every claimed format by its magic number', () => {
    expect(detectImage(fileRefFor(f('alpha.png')).head)).toBe('png')
    expect(detectImage(fileRefFor(f('wide.jpg')).head)).toBe('jpeg')
    expect(detectImage(fileRefFor(f('huge.webp')).head)).toBe('webp')
    expect(detectImage(fileRefFor(f('tiny.avif')).head)).toBe('avif')
    expect(detectImage(fileRefFor(f('anim.gif')).head)).toBe('gif')
    expect(detectImage(fileRefFor(f('logo.svg')).head)).toBe('svg')
    expect(detectImage(fileRefFor(f('fake.png')).head)).toBeNull()
  })
  it('does not take an MP4 for AVIF', () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31])
    expect(detectImage(mp4)).toBeNull()
  })
  it('reads SVG after a BOM, declaration, comment and doctype', () => {
    const t = new TextEncoder()
    expect(looksLikeSvg(t.encode('﻿<?xml version="1.0"?><!DOCTYPE svg><!-- x --><svg viewBox="0 0 1 1"/>'))).toBe(true)
    expect(looksLikeSvg(t.encode('<html><svg/></html>'))).toBe(false)
  })
})

describe('imageFormat', () => {
  it('claims images and refuses a text file named .png', async () => {
    expect(await imageFormat.match(fileRefFor(f('alpha.png')))).toEqual({ format: 'image', confidence: 1 })
    expect(await imageFormat.match(fileRefFor(f('fake.png')))).toBeNull()
  })

  it('probes size, channels, alpha, colour space and the badge', async () => {
    const p = await imageFormat.probe!(assetFileFor(f('alpha.png')))
    expect(p.tech).toMatchObject({ width: 64, height: 32, channels: 4, hasAlpha: true, colorSpace: 'srgb', frames: 1 })
    expect(p.badge).toBe('64×32')
    expect(p.aspect).toBe(2)
    expect(p.analysis).toMatchObject({ transparent: true })
    const j = await imageFormat.probe!(assetFileFor(f('wide.jpg')))
    expect(j.tech).toMatchObject({ width: 2000, height: 1000, hasAlpha: false, dpi: 72 })
  })

  it('reports dominant colours in the analysis', async () => {
    const p = await imageFormat.probe!(assetFileFor(f('two.png')))
    const palette = (p.analysis as { palette: Array<{ hex: string; share: number }> }).palette
    expect(palette[0]!.hex).toBe('#FF0000')
    expect(palette[1]!.hex).toBe('#0000FF')
    expect(palette[0]!.share).toBeGreaterThan(palette[1]!.share)
  })

  it('counts frames of animated images and stores a small animated copy for hover', async () => {
    const af = assetFileFor(f('anim.gif'))
    const p = await imageFormat.probe!(af)
    expect(p.tech.frames).toBe(3)
    const set = await imageFormat.thumbnail!(af)
    expect(set.scrub).toBeDefined()
    const m = await sharp(set.scrub!).metadata()
    expect(m.format).toBe('webp')
    expect(m.pages).toBe(3)
    expect((await sharp(set.thumb!).metadata()).pages ?? 1).toBe(1)
  })

  it('makes WebP thumbnails with the long edge at 512 and previews at 2048, never upscaling rasters', async () => {
    const wide = await imageFormat.thumbnail!(assetFileFor(f('wide.jpg')))
    const mt = await sharp(wide.thumb!).metadata()
    expect([mt.format, mt.width, mt.height]).toEqual(['webp', THUMB_EDGE, 256])
    const mp = await sharp(wide.preview!).metadata()
    expect([mp.width, mp.height]).toEqual([2000, 1000])
    expect(wide.aspect).toBe(2)
    const huge = await imageFormat.thumbnail!(assetFileFor(f('huge.webp')))
    expect((await sharp(huge.preview!).metadata()).width).toBe(PREVIEW_EDGE)
    const tiny = await imageFormat.thumbnail!(assetFileFor(f('tiny.avif')))
    expect((await sharp(tiny.thumb!).metadata()).width).toBe(16)
    expect(wide.scrub).toBeUndefined()
  })

  it('rasterises SVG at the thumbnail size', async () => {
    const af = assetFileFor(f('logo.svg'))
    const p = await imageFormat.probe!(af)
    expect(p.tech).toMatchObject({ width: 300, height: 150 })
    const set = await imageFormat.thumbnail!(af)
    const m = await sharp(set.thumb!).metadata()
    expect([m.width, m.height]).toEqual([512, 256])
    expect((await sharp(set.preview!).metadata()).width).toBe(2048)
  })

  it('summarises size, colour space, transparency, dominant colours and the grid', async () => {
    const t = await imageFormat.summarize!(assetFileFor(f('alpha.png')))
    expect(t.text).toMatch(/^图片 64×32，sRGB，带透明；主色 #/)
    const sheet = await imageFormat.summarize!(assetFileFor(f('wide.jpg'), { views: { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] } }))
    expect(sheet.text).toContain('不透明')
    expect(sheet.text).toContain('四视图，格子 2 行 2 列 · 正面 侧面 / 背面 顶面')
    expect((await imageFormat.summarize!(assetFileFor(f('anim.gif')))).text).toContain('动图，3 帧')
  })
})

describe('dominantColors', () => {
  it('ignores transparent pixels and merges near colours', () => {
    const px = new Uint8Array(4 * 10)
    for (let i = 0; i < 10; i++) { px[i * 4] = i < 6 ? 250 : 0; px[i * 4 + 1] = i < 6 ? (i % 2 ? 250 : 242) : 0; px[i * 4 + 3] = i === 9 ? 0 : 255 }
    const s = dominantColors(px)
    expect(s.map(x => x.hex)).toEqual(['#FFFF00', '#000000'])
    expect(s[0]!.share).toBeCloseTo(6 / 9, 2)
    expect(dominantColors(new Uint8Array(8))).toEqual([])
  })
})
