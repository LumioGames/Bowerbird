/**
 * Browser-rendered thumbnails for videos (ADR-025, pipeline-and-cache.md「浏览器渲染工作者」): the render worker
 * calls `renderThumbnail` / `renderSummary` with the same decoding the viewer uses.
 *
 * Failure convention (read by the shell's render worker): a thrown `RenderError` carries `retryable`; a codec the
 * browser cannot decode throws with `retryable: false` and the message「这台电脑的浏览器放不了这种视频（{编码}）」,
 * which the worker submits as `RenderResultFields.error` / `retryable`.
 */
import type { AssetDetail } from '@bowerbird/schema'
import type { FileSource, RenderedSet } from '@bowerbird/plugin-sdk/web'
import { t as tr } from './i18n.js'
import { fitEdge, posterTime, sampleTimes, SCRUB_COLS, SCRUB_FRAMES, SCRUB_ROWS, SCRUB_TILE, undecodableMessage } from './lib/time.js'

export class RenderError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'RenderError'
    this.retryable = retryable
  }
}

const LOAD_TIMEOUT = 20_000
const SEEK_TIMEOUT = 10_000

/** A muted, off-screen video element with its first frame decoded. Rejects with RenderError. */
export function openVideo(url: string, codec: string | null, signal?: AbortSignal): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    let done = false
    const finish = (err: RenderError | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      v.onloadeddata = v.onerror = null
      if (err) { v.removeAttribute('src'); v.load(); reject(err) } else resolve(v)
    }
    const timer = setTimeout(() => finish(new RenderError(tr('timeout'), true)), LOAD_TIMEOUT)
    signal?.addEventListener('abort', () => finish(new RenderError(tr('cancelled'), true)))
    v.onloadeddata = () => finish(v.videoWidth > 0 ? null : new RenderError(undecodableMessage(codec), false))
    v.onerror = () => {
      const code = v.error?.code
      // 3 = decode error, 4 = source not supported: retrying on this browser cannot help.
      finish(code === 3 || code === 4 ? new RenderError(undecodableMessage(codec), false) : new RenderError(v.error?.message || tr('readFailed'), true))
    }
    v.src = url
  })
}

/** Seek and wait until the frame at `t` can be drawn. */
export function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.min(Math.max(0, t), Math.max(0, (v.duration || t) - 0.001))
    if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) return resolve()
    const timer = setTimeout(() => { v.onseeked = null; reject(new RenderError(tr('timeout'), true)) }, SEEK_TIMEOUT)
    v.onseeked = () => {
      clearTimeout(timer)
      v.onseeked = null
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback
      if (rvfc && !v.paused) rvfc.call(v, () => resolve())
      else resolve()
    }
    v.currentTime = target
  })
}

export function frameCanvas(v: HTMLVideoElement, edge: number): HTMLCanvasElement {
  const s = fitEdge(v.videoWidth, v.videoHeight, edge)
  const c = document.createElement('canvas')
  c.width = s.w; c.height = s.h
  c.getContext('2d')!.drawImage(v, 0, 0, s.w, s.h)
  return c
}

export function toBlob(c: HTMLCanvasElement, type = 'image/webp', quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new RenderError(tr('encodeFailed'), true))), type, quality))
}

function durationOf(v: HTMLVideoElement, asset: AssetDetail): number {
  const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Number(asset.tech.duration) || 0
  return d
}

const codecOf = (asset: AssetDetail) => (typeof asset.tech.codec === 'string' ? asset.tech.codec : null)

/** `poster` (1024, a tenth in), `thumb` (512, same frame) and the `scrub` sprite (25 frames, 5 × 5). */
export async function renderThumbnail(asset: AssetDetail, source: FileSource): Promise<RenderedSet> {
  const v = await openVideo(source.url, codecOf(asset))
  try {
    const dur = durationOf(v, asset)
    await seek(v, posterTime(dur))
    const poster = frameCanvas(v, 1024)
    const thumb = frameCanvas(v, 512)
    const tw = SCRUB_TILE, th = Math.max(1, Math.round(SCRUB_TILE * v.videoHeight / v.videoWidth))
    const sprite = document.createElement('canvas')
    sprite.width = tw * SCRUB_COLS; sprite.height = th * SCRUB_ROWS
    const sx = sprite.getContext('2d')!
    const times = sampleTimes(dur, SCRUB_FRAMES)
    for (let i = 0; i < times.length; i++) {
      await seek(v, times[i]!)
      sx.drawImage(v, (i % SCRUB_COLS) * tw, Math.floor(i / SCRUB_COLS) * th, tw, th)
    }
    return {
      poster: await toBlob(poster),
      thumb: await toBlob(thumb),
      scrub: await toBlob(sprite, 'image/webp', 0.72),
      aspect: v.videoWidth / v.videoHeight
    }
  } finally {
    v.removeAttribute('src'); v.load()
  }
}

/** Agent overview: a strip of key frames (api-and-agent.md「Agent 摘要」). */
export async function renderSummary(asset: AssetDetail, source: FileSource): Promise<Blob> {
  const v = await openVideo(source.url, codecOf(asset))
  try {
    const n = 6, tw = 256, th = Math.max(1, Math.round(256 * v.videoHeight / v.videoWidth))
    const strip = document.createElement('canvas')
    strip.width = tw * n; strip.height = th
    const x = strip.getContext('2d')!
    const times = sampleTimes(durationOf(v, asset), n)
    for (let i = 0; i < n; i++) { await seek(v, times[i]!); x.drawImage(v, i * tw, 0, tw, th) }
    return await toBlob(strip)
  } finally {
    v.removeAttribute('src'); v.load()
  }
}
