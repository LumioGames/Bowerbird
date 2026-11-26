/**
 * Frames of an animated image for the viewer's playback controls (GIF, animated WebP / AVIF).
 * Uses the browser's ImageDecoder where it exists; GIF also decodes in JavaScript (gifuct-js) elsewhere.
 * Returns null when the image has one frame or the browser cannot step through it.
 */
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js'

export interface FrameSource {
  count: number
  width: number
  height: number
  /** Draw frame `i` onto `ctx` (canvas of width × height); resolves with the frame duration in ms. */
  draw(i: number, ctx: CanvasRenderingContext2D): Promise<number>
  close(): void
}

export function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return ({ gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

export async function openFrames(data: ArrayBuffer, mime: string): Promise<FrameSource | null> {
  if (typeof ImageDecoder !== 'undefined') {
    try {
      if (await ImageDecoder.isTypeSupported(mime)) return await decoderFrames(data, mime)
    } catch { /* fall through to the JS decoder */ }
  }
  if (mime === 'image/gif') return gifFrames(data)
  return null
}

async function decoderFrames(data: ArrayBuffer, mime: string): Promise<FrameSource | null> {
  const dec = new ImageDecoder({ data, type: mime })
  await dec.tracks.ready
  const track = dec.tracks.selectedTrack
  if (!track || track.frameCount <= 1) { dec.close(); return null }
  const first = await dec.decode({ frameIndex: 0 })
  const width = first.image.displayWidth, height = first.image.displayHeight
  first.image.close()
  return {
    count: track.frameCount,
    width,
    height,
    async draw(i, ctx) {
      const r = await dec.decode({ frameIndex: i })
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(r.image, 0, 0, width, height)
      const ms = r.image.duration ? r.image.duration / 1000 : 100
      r.image.close()
      return ms || 100
    },
    close: () => dec.close()
  }
}

/** GIF frames composited in order (disposal 2 restores the background, 3 the previous picture). */
function gifFrames(data: ArrayBuffer): FrameSource | null {
  const gif = parseGIF(data)
  const frames = decompressFrames(gif, true) as ParsedFrame[]
  if (frames.length <= 1) return null
  const width = gif.lsd.width, height = gif.lsd.height
  const comp = document.createElement('canvas'); comp.width = width; comp.height = height
  const cctx = comp.getContext('2d', { willReadFrequently: true })!
  const patch = document.createElement('canvas')
  const pctx = patch.getContext('2d')!
  let at = -1
  let saved: ImageData | null = null
  function apply(k: number) {
    const prev = frames[k - 1]
    if (prev) {
      if (prev.disposalType === 2) cctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height)
      else if (prev.disposalType === 3 && saved) cctx.putImageData(saved, 0, 0)
    }
    const f = frames[k]!
    saved = f.disposalType === 3 ? cctx.getImageData(0, 0, width, height) : null
    patch.width = f.dims.width; patch.height = f.dims.height
    pctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0)
    cctx.drawImage(patch, f.dims.left, f.dims.top)
  }
  return {
    count: frames.length,
    width,
    height,
    async draw(i, ctx) {
      if (i < at) { cctx.clearRect(0, 0, width, height); at = -1; saved = null }
      while (at < i) { at++; apply(at) }
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(comp, 0, 0)
      return frames[i]!.delay || 100
    },
    close() {}
  }
}
