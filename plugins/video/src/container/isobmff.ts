/**
 * MP4 / MOV (ISO base media file format, QuickTime) walker: duration, picture size, frame rate, video codec and
 * whether there is a sound track — read from `moov` only, wherever it sits in the file. No decoding.
 */
import { ascii, u16, u32, u64, type RandomAccess } from './reader.js'
import type { VideoInfo } from './types.js'

interface Box { type: string; start: number; header: number; end: number }

/** Largest `moov` read into memory (real files stay far below; a bigger claim is refused, not allocated). */
export const MAX_MOOV = 64 * 1024 * 1024

/** Top-level boxes, read header by header (works for files with `moov` at the end). */
async function topBoxes(r: RandomAccess): Promise<Box[]> {
  const out: Box[] = []
  let off = 0
  while (off + 8 <= r.size && out.length < 4096) {
    const h = await r.read(off, 16)
    if (h.length < 8) break
    let size = u32(h, 0), header = 8
    const type = ascii(h, 4, 4)
    if (size === 1) { if (h.length < 16) break; size = u64(h, 8); header = 16 } else if (size === 0) size = r.size - off
    if (size < header || !/^[\x20-\x7e]{4}$/.test(type)) break
    out.push({ type, start: off, header, end: Math.min(r.size, off + size) })
    off += size
  }
  return out
}

/** Children of a box held in memory. */
function children(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = []
  let off = from
  while (off + 8 <= to) {
    let size = u32(b, off), header = 8
    const type = ascii(b, off + 4, 4)
    if (size === 1) { size = u64(b, off + 8); header = 16 } else if (size === 0) size = to - off
    if (size < header || off + size > to) break
    out.push({ type, start: off, header, end: off + size })
    off += size
  }
  return out
}
const child = (b: Uint8Array, box: Box, type: string, skip = 0) => children(b, box.start + box.header + skip, box.end).find(c => c.type === type)

/** Display names of video sample-entry codes (the error text and the summary use them). */
export const MP4_CODECS: Readonly<Record<string, string>> = {
  avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', dvh1: 'HEVC', dvhe: 'HEVC', av01: 'AV1', vp09: 'VP9', vp08: 'VP8',
  mp4v: 'MPEG-4', s263: 'H.263', h263: 'H.263', jpeg: 'Motion JPEG', mjpa: 'Motion JPEG', mjpb: 'Motion JPEG',
  apco: 'ProRes 422 Proxy', apcs: 'ProRes 422 LT', apcn: 'ProRes 422', apch: 'ProRes 422 HQ', ap4h: 'ProRes 4444', ap4x: 'ProRes 4444 XQ',
  'dvc ': 'DV', dvcp: 'DV', dv5n: 'DV', cvid: 'Cinepak', 'raw ': 'Uncompressed'
}

interface Track { handler: string; timescale: number; duration: number; width: number; height: number; codecTag: string | null; samples: number; sampleSpan: number; singleDelta: number | null; defaultDelta: number | null }

function readTrack(b: Uint8Array, trak: Box): Track {
  const t: Track = { handler: '', timescale: 0, duration: 0, width: 0, height: 0, codecTag: null, samples: 0, sampleSpan: 0, singleDelta: null, defaultDelta: null }
  const tkhd = child(b, trak, 'tkhd')
  if (tkhd) {
    const p = tkhd.start + tkhd.header, v = b[p]!
    const at = p + (v === 1 ? 88 : 76)
    if (at + 8 <= tkhd.end) { t.width = Math.round(u32(b, at) / 65536); t.height = Math.round(u32(b, at + 4) / 65536) }
  }
  const mdia = child(b, trak, 'mdia')
  if (!mdia) return t
  const mdhd = child(b, mdia, 'mdhd')
  if (mdhd) {
    const p = mdhd.start + mdhd.header, v = b[p]!
    if (v === 1) { t.timescale = u32(b, p + 20); t.duration = u64(b, p + 24) } else { t.timescale = u32(b, p + 12); t.duration = u32(b, p + 16) }
  }
  const hdlr = child(b, mdia, 'hdlr')
  if (hdlr) t.handler = ascii(b, hdlr.start + hdlr.header + 8, 4)
  const minf = child(b, mdia, 'minf'), stbl = minf && child(b, minf, 'stbl')
  if (!stbl) return t
  const stsd = child(b, stbl, 'stsd')
  if (stsd) {
    const entries = children(b, stsd.start + stsd.header + 8, stsd.end)
    const e = entries[0]
    if (e) {
      t.codecTag = ascii(b, e.start + 4, 4)
      if (t.handler === 'vide' && e.start + 36 <= e.end) {
        const sw = u16(b, e.start + 32), sh = u16(b, e.start + 34)
        if (!t.width || !t.height) { t.width = sw; t.height = sh }
      }
    }
  }
  const stts = child(b, stbl, 'stts')
  if (stts) {
    const p = stts.start + stts.header, n = u32(b, p + 4)
    for (let i = 0; i < n && p + 8 + i * 8 + 8 <= stts.end; i++) {
      const count = u32(b, p + 8 + i * 8), delta = u32(b, p + 12 + i * 8)
      t.samples += count; t.sampleSpan += count * delta
      if (n === 1) t.singleDelta = delta
    }
  }
  return t
}

/** Frame rate snapped to the common NTSC rates when it is within rounding of them. */
export function niceRate(fps: number): number {
  for (const r of [23.976, 29.97, 47.952, 59.94, 119.88]) if (Math.abs(fps - r) < 0.0002 * r) return r
  if (Math.abs(fps - Math.round(fps)) < 0.01) return Math.round(fps)
  return Math.round(fps * 1000) / 1000
}

export async function probeIsoBmff(r: RandomAccess): Promise<VideoInfo> {
  const top = await topBoxes(r)
  const ftyp = top.find(b => b.type === 'ftyp')
  let brand = ''
  if (ftyp) brand = ascii(await r.read(ftyp.start + ftyp.header, 4), 0, 4)
  const moovBox = top.find(b => b.type === 'moov')
  if (!moovBox) throw new Error('no moov box: not a complete MP4 / MOV file')
  if (moovBox.end - moovBox.start > MAX_MOOV) throw new Error('moov box too large')
  const b = await r.read(moovBox.start, moovBox.end - moovBox.start)
  const moov: Box = { ...moovBox, start: 0, end: b.length }
  let duration: number | null = null
  const mvhd = child(b, moov, 'mvhd')
  if (mvhd) {
    const p = mvhd.start + mvhd.header, v = b[p]!
    const ts = v === 1 ? u32(b, p + 20) : u32(b, p + 12), du = v === 1 ? u64(b, p + 24) : u32(b, p + 16)
    if (ts > 0 && du > 0 && du !== 0xffffffff) duration = du / ts
  }
  // Fragmented files: the movie extends header carries the total duration; trex the default frame duration.
  const mvex = child(b, moov, 'mvex')
  const trexDelta = new Map<number, number>()
  if (mvex) {
    for (const c of children(b, mvex.start + mvex.header, mvex.end)) {
      const p = c.start + c.header
      if (c.type === 'mehd' && duration === null && mvhd) {
        const ts = b[mvhd.start + mvhd.header]! === 1 ? u32(b, mvhd.start + mvhd.header + 20) : u32(b, mvhd.start + mvhd.header + 12)
        const du = b[p]! === 1 ? u64(b, p + 4) : u32(b, p + 4)
        if (ts > 0 && du > 0) duration = du / ts
      }
      if (c.type === 'trex') trexDelta.set(u32(b, p + 4), u32(b, p + 12))
    }
  }
  const tracks = children(b, moov.start + moov.header, moov.end).filter(c => c.type === 'trak').map(t => readTrack(b, t))
  const video = tracks.find(t => t.handler === 'vide')
  const sound = tracks.find(t => t.handler === 'soun')
  if (video && trexDelta.size === 1) video.defaultDelta = [...trexDelta.values()][0]!
  let frameRate: number | null = null
  if (video && video.timescale > 0) {
    if (video.singleDelta) frameRate = video.timescale / video.singleDelta
    else if (video.samples > 1 && video.sampleSpan > 0) frameRate = video.samples / (video.sampleSpan / video.timescale)
    else if (video.defaultDelta) frameRate = video.timescale / video.defaultDelta
    if (duration === null && video.duration > 0) duration = video.duration / video.timescale
  }
  return {
    container: !ftyp || brand === 'qt  ' ? 'mov' : 'mp4',
    duration,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    frameRate: frameRate ? niceRate(frameRate) : null,
    codec: video?.codecTag ? MP4_CODECS[video.codecTag] ?? video.codecTag.trim() : null,
    codecTag: video?.codecTag?.trim() ?? null,
    hasVideo: !!video,
    hasAudio: !!sound
  }
}
