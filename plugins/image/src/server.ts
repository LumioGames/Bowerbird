/**
 * bowerbird.image — server part (builtin-plugins.md「图片」): identify by magic number, probe tech info and the
 * dominant colours, server thumbnails (`thumb` 512, `preview` 2048, WebP; SVG rasterised; animated images keep
 * their first frame, plus a small animated copy for hover under `scrub`), and the Agent summary text.
 * Uses only @bowerbird/plugin-sdk and @bowerbird/schema (engineering.md hard rule 2).
 */
import sharp, { type Sharp, type SharpOptions } from 'sharp'
import { defineServerPlugin, type AssetFile, type FileRef, type FormatHandler, type ProbeResult, type ThumbnailSet } from '@bowerbird/plugin-sdk'
import { detectImage, type ImageKind } from './detect.js'
import { dominantColors, type Swatch } from './shared/palette.js'
import { describeGrid, type ViewGridLike } from './shared/grid.js'

export const FORMAT_ID = 'image'
/** Long edges (pipeline-and-cache.md「规格」). */
export const THUMB_EDGE = 512
export const PREVIEW_EDGE = 2048
/** Long edge of the animated hover copy. */
export const HOVER_EDGE = 256

/** sharp's default pixel limit (16383 × 16383): a decompression bomb is refused before it is decoded. */
export const PIXEL_LIMIT = 0x3fff * 0x3fff
const BASE: SharpOptions = { failOn: 'error', limitInputPixels: PIXEL_LIMIT }

export interface ImageInfo {
  kind: ImageKind
  width: number
  height: number
  channels: number
  hasAlpha: boolean
  colorSpace: string
  frames: number
  dpi: number | null
}

export function badgeOf(w: number, h: number): string { return `${w}×${h}` }

async function readInfo(buf: Uint8Array, kind: ImageKind): Promise<ImageInfo> {
  const m = await sharp(buf, BASE).metadata()
  const width = m.autoOrient?.width ?? m.width ?? 0
  const height = m.autoOrient?.height ?? m.height ?? 0
  if (!width || !height) throw new Error('image has no size')
  return {
    kind,
    width,
    height,
    channels: m.channels ?? (m.hasAlpha ? 4 : 3),
    hasAlpha: !!m.hasAlpha,
    colorSpace: m.space ?? 'srgb',
    frames: Math.max(1, m.pages ?? 1),
    dpi: m.density ? Math.round(m.density) : null
  }
}

/** SVG renders at a density that gives `edge` pixels on the long side. */
function svgDensity(info: ImageInfo, edge: number): number {
  const long = Math.max(info.width, info.height)
  return Math.min(10000, Math.max(1, 72 * edge / long))
}

function open(buf: Uint8Array, info: ImageInfo, edge: number, extra: SharpOptions = {}): Sharp {
  const opts: SharpOptions = { ...BASE, ...extra }
  if (info.kind === 'svg') opts.density = svgDensity(info, edge)
  return sharp(buf, opts).rotate()
}

/** Small RGBA sample for colour analysis. */
async function sample(buf: Uint8Array, info: ImageInfo): Promise<Uint8Array> {
  const { data } = await open(buf, info, 96).resize(96, 96, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export interface ImageAnalysis {
  palette: Swatch[]
  /** Some pixels are actually transparent (not only an alpha channel). */
  transparent: boolean
}

export async function analyse(buf: Uint8Array, info: ImageInfo): Promise<ImageAnalysis> {
  const px = await sample(buf, info)
  let transparent = false
  if (info.hasAlpha) for (let i = 3; i < px.length; i += 4) if (px[i]! < 250) { transparent = true; break }
  return { palette: dominantColors(px), transparent }
}

const SPACE_NAMES: Record<string, string> = { srgb: 'sRGB', rgb: 'RGB', rgb16: 'RGB 16 位', 'b-w': '灰度', grey16: '灰度 16 位', cmyk: 'CMYK', lab: 'Lab', scrgb: 'scRGB' }
export function spaceName(space: string): string { return SPACE_NAMES[space] ?? space }

export function summaryText(info: ImageInfo, a: ImageAnalysis, views: AssetFile['views']): string {
  const parts = [`图片 ${badgeOf(info.width, info.height)}，${spaceName(info.colorSpace)}，${a.transparent ? '带透明' : '不透明'}`]
  if (a.palette.length) parts.push(`主色 ${a.palette.map(s => s.hex).join('、')}`)
  let text = parts.join('；') + '。'
  if (info.frames > 1) text += `动图，${info.frames} 帧。`
  if (views) text += `四视图，格子 ${describeGrid(views as ViewGridLike)}。`
  return text
}

async function infoOf(asset: AssetFile): Promise<{ buf: Uint8Array; info: ImageInfo }> {
  const buf = await asset.read()
  const kind = detectImage(buf.subarray(0, 4096))
  if (!kind) throw new Error(`${asset.name} is not an image this plugin reads`)
  return { buf, info: await readInfo(buf, kind) }
}

export const imageFormat: FormatHandler = {
  id: FORMAT_ID,

  async match(file: FileRef) {
    if (file.bundle) return null
    return detectImage(file.head) ? { format: FORMAT_ID, confidence: 1 } : null
  },

  async probe(asset): Promise<ProbeResult> {
    const { buf, info } = await infoOf(asset)
    const a = await analyse(buf, info)
    const tech: ProbeResult['tech'] = {
      width: info.width,
      height: info.height,
      channels: info.channels,
      hasAlpha: info.hasAlpha,
      colorSpace: info.colorSpace,
      frames: info.frames
    }
    if (info.dpi !== null) tech.dpi = info.dpi
    return {
      tech,
      badge: badgeOf(info.width, info.height),
      analysis: { palette: a.palette, dominant: a.palette[0]?.hex ?? null, transparent: a.transparent },
      aspect: info.width / info.height
    }
  },

  async thumbnail(asset): Promise<ThumbnailSet> {
    const { buf, info } = await infoOf(asset)
    // Decode once at preview size; the thumbnail is scaled from those pixels.
    const base = await open(buf, info, PREVIEW_EDGE)
      .resize(PREVIEW_EDGE, PREVIEW_EDGE, { fit: 'inside', withoutEnlargement: info.kind !== 'svg' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const raw = { raw: { width: base.info.width, height: base.info.height, channels: base.info.channels } }
    const preview = await sharp(base.data, raw).webp({ quality: 86, effort: 4 }).toBuffer()
    const thumb = await sharp(base.data, raw)
      .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true })
    const set: ThumbnailSet = { thumb: new Uint8Array(thumb.data), preview: new Uint8Array(preview), aspect: thumb.info.width / thumb.info.height }
    if (info.frames > 1) {
      // Animated: `thumb` is the first frame; a small animated copy plays on hover in the grid (stored as `scrub`).
      const hover = await sharp(buf, { ...BASE, animated: true })
        .resize(HOVER_EDGE, HOVER_EDGE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72, effort: 4, loop: 0 })
        .toBuffer()
      set.scrub = new Uint8Array(hover)
    }
    return set
  },

  async summarize(asset) {
    const { buf, info } = await infoOf(asset)
    return { text: summaryText(info, await analyse(buf, info), asset.views) }
  }
}

export default defineServerPlugin({
  activate(ctx) {
    ctx.register.format(imageFormat)
  }
})
