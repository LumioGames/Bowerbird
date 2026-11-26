/**
 * WebM / Matroska (EBML) walker: duration, picture size, frame rate, video codec and whether there is sound.
 * Handles live recordings (MediaRecorder) whose Segment and Clusters have unknown sizes and no Duration:
 * the duration is then measured from the last block, the frame rate from the first blocks. No decoding.
 */
import { ascii, type RandomAccess } from './reader.js'
import type { VideoInfo } from './types.js'

export const EBML_ID = {
  EBML: 0x1a45dfa3, DocType: 0x4282, Segment: 0x18538067,
  SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675, Cues: 0x1c53bb6b,
  Tags: 0x1254c367, Chapters: 0x1043a770, Attachments: 0x1941a469, Void: 0xec, CRC32: 0xbf,
  TimestampScale: 0x2ad7b1, Duration: 0x4489,
  TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, DefaultDuration: 0x23e383,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1
} as const

/** Elements that may follow a Cluster at Segment level: they end a Cluster of unknown size. */
const SEGMENT_LEVEL = new Set<number>([EBML_ID.SeekHead, EBML_ID.Info, EBML_ID.Tracks, EBML_ID.Cluster, EBML_ID.Cues, EBML_ID.Tags, EBML_ID.Chapters, EBML_ID.Attachments])

export const WEBM_CODECS: Readonly<Record<string, string>> = {
  V_VP8: 'VP8', V_VP9: 'VP9', V_AV1: 'AV1', 'V_MPEG4/ISO/AVC': 'H.264', 'V_MPEGH/ISO/HEVC': 'HEVC', V_PRORES: 'ProRes',
  V_THEORA: 'Theora', 'V_MPEG4/ISO/ASP': 'MPEG-4', V_MJPEG: 'Motion JPEG'
}

interface Header { id: number; size: number | null; hlen: number }

/** Largest metadata element (EBML header, Info, Tracks) read into memory; a bigger claim is refused. */
export const MAX_EBML_ELEMENT = 16 * 1024 * 1024
/** Read an element body that must fit in memory. */
async function body(r: RandomAccess, at: number, size: number, what: string): Promise<Uint8Array> {
  if (size > MAX_EBML_ELEMENT) throw new Error(`${what} element too large`)
  return r.read(at, size)
}

/** Element header at `off`: id (with marker bits), data size (null = unknown) and header length. */
export function parseHeader(b: Uint8Array): Header | null {
  const first = b[0]
  if (first === undefined || first === 0) return null
  let idLen = 1
  while (idLen <= 4 && !(first & (0x80 >> (idLen - 1)))) idLen++
  if (idLen > 4 || b.length < idLen + 1) return null
  let id = 0
  for (let i = 0; i < idLen; i++) id = id * 256 + b[i]!
  const s0 = b[idLen]!
  if (s0 === 0) return null
  let sLen = 1
  while (!(s0 & (0x80 >> (sLen - 1)))) sLen++
  if (b.length < idLen + sLen) return null
  let size = s0 & (0xff >> sLen), allOnes = size === (0xff >> sLen)
  for (let i = 1; i < sLen; i++) { const v = b[idLen + i]!; size = size * 256 + v; if (v !== 0xff) allOnes = false }
  return { id, size: allOnes ? null : size, hlen: idLen + sLen }
}

async function headerAt(r: RandomAccess, off: number): Promise<Header | null> {
  if (off >= r.size) return null
  return parseHeader(await r.read(off, 12))
}

function uint(b: Uint8Array): number { let v = 0; for (const x of b) v = v * 256 + x; return v }
function float(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return b.length === 4 ? dv.getFloat32(0) : b.length === 8 ? dv.getFloat64(0) : NaN
}
function str(b: Uint8Array): string { return ascii(b, 0, b.length).replace(/\0+$/, '') }

/** Children of an element held in memory. */
function* kids(b: Uint8Array, from = 0, to = b.length): Generator<{ id: number; data: Uint8Array }> {
  let off = from
  while (off < to) {
    const h = parseHeader(b.subarray(off, Math.min(to, off + 12)))
    if (!h || h.size === null) return
    const start = off + h.hlen, end = start + h.size
    if (end > to) return
    yield { id: h.id, data: b.subarray(start, end) }
    off = end
  }
}

interface TrackEntry { number: number; type: number; codec: string; defaultDuration: number | null; width: number; height: number }

function parseTracks(b: Uint8Array): TrackEntry[] {
  const out: TrackEntry[] = []
  for (const t of kids(b)) {
    if (t.id !== EBML_ID.TrackEntry) continue
    const e: TrackEntry = { number: 0, type: 0, codec: '', defaultDuration: null, width: 0, height: 0 }
    for (const c of kids(t.data)) {
      if (c.id === EBML_ID.TrackNumber) e.number = uint(c.data)
      else if (c.id === EBML_ID.TrackType) e.type = uint(c.data)
      else if (c.id === EBML_ID.CodecID) e.codec = str(c.data)
      else if (c.id === EBML_ID.DefaultDuration) e.defaultDuration = uint(c.data)
      else if (c.id === EBML_ID.Video) for (const v of kids(c.data)) {
        if (v.id === EBML_ID.PixelWidth) e.width = uint(v.data)
        else if (v.id === EBML_ID.PixelHeight) e.height = uint(v.data)
      }
    }
    out.push(e)
  }
  return out
}

/** Track number and relative timestamp at the start of a (Simple)Block body. */
function blockHead(b: Uint8Array): { track: number; rel: number } | null {
  const f = b[0]
  if (f === undefined || f === 0) return null
  let n = 1
  while (!(f & (0x80 >> (n - 1)))) n++
  if (b.length < n + 2) return null
  let track = f & (0xff >> n)
  for (let i = 1; i < n; i++) track = track * 256 + b[i]!
  const rel = (b[n]! << 8 | b[n + 1]!) << 16 >> 16
  return { track, rel }
}

interface ClusterScan { end: number; timestamp: number; maxT: number; blocks: Array<{ track: number; t: number }> }
/** Blocks kept per scan for the frame-rate estimate; beyond that only the latest timestamp is tracked. */
const KEEP_BLOCKS = 120

/** Walk one Cluster's children (sizes known or not): its timestamp and its blocks' absolute timestamps. */
async function scanCluster(r: RandomAccess, dataStart: number, limit: number, wantBlocks: boolean): Promise<ClusterScan> {
  const res: ClusterScan = { end: limit, timestamp: 0, maxT: 0, blocks: [] }
  const add = (b: { track: number; rel: number } | null) => {
    if (!b) return
    const t = res.timestamp + b.rel
    if (t > res.maxT) res.maxT = t
    if (res.blocks.length < KEEP_BLOCKS) res.blocks.push({ track: b.track, t })
  }
  let off = dataStart
  while (off < limit) {
    const h = await headerAt(r, off)
    if (!h || h.size === null || SEGMENT_LEVEL.has(h.id)) { res.end = off; return res }
    const body = off + h.hlen
    if (h.id === EBML_ID.Timestamp) { if (h.size <= 8) { res.timestamp = uint(await r.read(body, h.size)); if (res.timestamp > res.maxT) res.maxT = res.timestamp } }
    else if (wantBlocks && h.id === EBML_ID.SimpleBlock) add(blockHead(await r.read(body, 8)))
    else if (wantBlocks && h.id === EBML_ID.BlockGroup) {
      // The Block is (almost always) the group's first child; only its first bytes are needed.
      const inner = await r.read(body, Math.min(h.size, 32))
      const h2 = parseHeader(inner)
      if (h2 && h2.id === EBML_ID.Block) add(blockHead(inner.subarray(h2.hlen)))
    }
    off = body + h.size
  }
  res.end = Math.min(off, limit)
  return res
}

export async function probeEbml(r: RandomAccess): Promise<VideoInfo> {
  const eh = await headerAt(r, 0)
  if (!eh || eh.id !== EBML_ID.EBML || eh.size === null) throw new Error('not an EBML file')
  let docType = 'matroska'
  if (eh.size > 4096) throw new Error('EBML header element too large')
  for (const c of kids(await r.read(eh.hlen, eh.size))) if (c.id === EBML_ID.DocType) docType = str(c.data)
  let off = eh.hlen + eh.size
  let seg: Header | null = null
  while (off < r.size) {
    seg = await headerAt(r, off)
    if (!seg) break
    if (seg.id === EBML_ID.Segment) break
    if (seg.size === null) throw new Error('unexpected element of unknown size before Segment')
    off += seg.hlen + seg.size
    seg = null
  }
  if (!seg) throw new Error('no Segment element')
  const segStart = off + seg.hlen
  const segEnd = seg.size === null ? r.size : Math.min(r.size, segStart + seg.size)

  let scale = 1_000_000
  let durationTicks: number | null = null
  let tracks: TrackEntry[] | null = null
  const early: Array<{ track: number; t: number }> = []
  let last: { start: number; hlen: number; size: number | null } | null = null
  let clustersSeen = 0
  let p = segStart
  while (p < segEnd) {
    const h = await headerAt(r, p)
    if (!h) break
    if (h.id === EBML_ID.Info && h.size !== null) {
      for (const c of kids(await body(r, p + h.hlen, h.size, 'Info'))) {
        if (c.id === EBML_ID.TimestampScale) scale = uint(c.data) || scale
        else if (c.id === EBML_ID.Duration) { const d = float(c.data); if (Number.isFinite(d) && d > 0) durationTicks = d }
      }
    } else if (h.id === EBML_ID.Tracks && h.size !== null) {
      tracks = parseTracks(await body(r, p + h.hlen, h.size, 'Tracks'))
    } else if (h.id === EBML_ID.Cluster) {
      const video = tracks?.find(t => t.type === 1)
      const needFps = !!video && !video.defaultDuration && early.length < 60
      if (tracks && durationTicks !== null && !needFps) break
      last = { start: p, hlen: h.hlen, size: h.size }
      clustersSeen++
      if (h.size === null || needFps) {
        const scan = await scanCluster(r, p + h.hlen, h.size === null ? segEnd : p + h.hlen + h.size, needFps)
        if (needFps && video) for (const b of scan.blocks) if (b.track === video.number && early.length < 60) early.push(b)
        p = h.size === null ? scan.end : p + h.hlen + h.size
        continue
      }
    }
    if (h.size === null) break
    p += h.hlen + h.size
  }
  if (!tracks) throw new Error('no Tracks element')
  const video = tracks.find(t => t.type === 1)
  const audio = tracks.find(t => t.type === 2)

  // Frame duration in ticks: declared, or measured from the first blocks.
  let frameTicks: number | null = video?.defaultDuration ? video.defaultDuration / scale : null
  if (!frameTicks && early.length > 1) {
    const ts = [...new Set(early.map(b => b.t))].sort((a, b) => a - b)
    if (ts.length > 1) frameTicks = (ts[ts.length - 1]! - ts[0]!) / (ts.length - 1)
  }
  if (durationTicks === null && last && clustersSeen > 0) {
    const end = last.size === null ? segEnd : last.start + last.hlen + last.size
    const scan = await scanCluster(r, last.start + last.hlen, end, true)
    durationTicks = scan.maxT + (frameTicks ?? 0)
  }
  const fps = frameTicks && frameTicks > 0 ? 1e9 / (frameTicks * scale) : null
  return {
    container: docType === 'webm' ? 'webm' : 'mkv',
    duration: durationTicks !== null ? durationTicks * scale / 1e9 : null,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    frameRate: fps ? Math.round(fps * 1000) / 1000 : null,
    codec: video ? WEBM_CODECS[video.codec] ?? video.codec : null,
    codecTag: video?.codec ?? null,
    hasVideo: !!video,
    hasAudio: !!audio
  }
}
