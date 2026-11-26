/**
 * Server-side audio decoding without external tools (builtin-plugins.md: 外部依赖 无): WAV is parsed here;
 * MP3, Ogg Vorbis / Opus and FLAC go through WebAssembly decoders from npm. Files are read and decoded in chunks
 * so long tracks do not have to sit in memory as PCM.
 */
import fs from 'node:fs/promises'

export type AudioKind = 'wav' | 'mp3' | 'ogg-vorbis' | 'ogg-opus' | 'flac'

export interface StreamInfo {
  kind: AudioKind
  /** Display name: PCM, PCM 浮点, MP3, Vorbis, Opus, FLAC. */
  codec: string
  sampleRate: number
  channels: number
  bitDepth: number | null
}

/** Stream parameters a real file can have; anything else is treated as not audio (untrusted headers). */
export const LIMITS = {
  minSampleRate: 1000,
  maxSampleRate: 768_000,
  maxChannels: 32,
  /** Longest stream analysed (6 hours). */
  maxSeconds: 6 * 3600,
  /** Decoded frames per input byte beyond which a compressed stream counts as a decompression bomb. */
  maxFramesPerByte: 1000,
  /** Every stream may decode this long before the ratio check applies (so silence still works). */
  ratioGraceSeconds: 120
} as const

export function validStream(sampleRate: number, channels: number): boolean {
  return Number.isInteger(sampleRate) && sampleRate >= LIMITS.minSampleRate && sampleRate <= LIMITS.maxSampleRate &&
    Number.isInteger(channels) && channels >= 1 && channels <= LIMITS.maxChannels
}

function ascii(b: Uint8Array, o: number, n: number): string { let s = ''; for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]!); return s }

/** Size of an ID3v2 tag at the start (0 if none). */
export function id3Size(h: Uint8Array): number {
  if (h.length < 10 || ascii(h, 0, 3) !== 'ID3') return 0
  const size = ((h[6]! & 0x7f) << 21) | ((h[7]! & 0x7f) << 14) | ((h[8]! & 0x7f) << 7) | (h[9]! & 0x7f)
  return 10 + size + (h[5]! & 0x10 ? 10 : 0)
}

/** An MPEG audio frame header (layer I–III) at `o`. */
function mpegFrameAt(h: Uint8Array, o: number): boolean {
  if (o + 4 > h.length) return false
  const b1 = h[o + 1]!, b2 = h[o + 2]!
  return h[o] === 0xff && (b1 & 0xe0) === 0xe0 && ((b1 >> 3) & 3) !== 1 && ((b1 >> 1) & 3) !== 0 && (b2 >> 4) !== 15 && ((b2 >> 2) & 3) !== 3
}

/** Channels of the first MPEG frame (the decoder always returns two). */
export function mp3Channels(head: Uint8Array): number {
  const skip = id3Size(head)
  for (let o = skip; o < Math.min(head.length - 4, skip + 8192); o++) if (mpegFrameAt(head, o)) return ((head[o + 3]! >> 6) & 3) === 3 ? 1 : 2
  return 2
}

/** Which decoder reads this file, from its first bytes. */
/** The WAV `fmt ` chunk if it sits in `head`; `undefined` when it is further in, null when it is malformed. */
function wavFmtIn(head: Uint8Array): Omit<WavFormat, 'dataStart' | 'dataSize'> | null | undefined {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  let pos = 12
  for (let guard = 0; pos + 8 <= head.length && guard < 64; guard++) {
    const id = ascii(head, pos, 4), len = dv.getUint32(pos + 4, true)
    if (id === 'fmt ') return pos + 8 + 16 <= head.length ? parseFmt(head.subarray(pos + 8, pos + 8 + Math.min(len, 40))) : undefined
    if (id === 'data') return null
    pos += 8 + len + (len & 1)
  }
  return undefined
}

function parseFmt(b: Uint8Array): Omit<WavFormat, 'dataStart' | 'dataSize'> | null {
  if (b.length < 16) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let format = dv.getUint16(0, true)
  if (format === WAVE_FORMAT.EXTENSIBLE && b.length >= 26) format = dv.getUint16(24, true)
  const f = { format, channels: dv.getUint16(2, true), sampleRate: dv.getUint32(4, true), bits: dv.getUint16(14, true) }
  return validStream(f.sampleRate, f.channels) && wavSupported(f) ? f : null
}

export function detectAudio(head: Uint8Array): AudioKind | null {
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return wavFmtIn(head) === null ? null : 'wav'
  if (head.length >= 4 && ascii(head, 0, 4) === 'fLaC') return 'flac'
  if (head.length >= 4 && ascii(head, 0, 4) === 'OggS') {
    const t = ascii(head, 0, Math.min(head.length, 512))
    if (t.includes('\x01vorbis')) return 'ogg-vorbis'
    if (t.includes('OpusHead')) return 'ogg-opus'
    return null
  }
  const skip = id3Size(head)
  if (skip && skip + 4 <= head.length && ascii(head, skip, 4) === 'fLaC') return 'flac'
  if (skip) return skip < head.length ? (mpegFrameAt(head, skip) ? 'mp3' : null) : 'mp3'
  // A bare MPEG stream: two consecutive frame headers are enough.
  for (let o = 0; o < Math.min(head.length - 4, 4096); o++) if (mpegFrameAt(head, o)) return 'mp3'
  return null
}

/* ───────────── WAV ───────────── */

interface WavFormat { format: number; channels: number; sampleRate: number; bits: number; dataStart: number; dataSize: number }

const WAVE_FORMAT = { PCM: 1, FLOAT: 3, EXTENSIBLE: 0xfffe } as const

async function readWavFormat(fh: fs.FileHandle, size: number): Promise<WavFormat> {
  const read = async (pos: number, n: number) => { const b = new Uint8Array(n); const { bytesRead } = await fh.read(b, 0, n, pos); return b.subarray(0, bytesRead) }
  let pos = 12, fmt: Omit<WavFormat, 'dataStart' | 'dataSize'> | null = null
  for (let guard = 0; pos + 8 <= size && guard < 4096; guard++) {
    const h = await read(pos, 8)
    if (h.length < 8) break
    const id = ascii(h, 0, 4), len = new DataView(h.buffer, h.byteOffset).getUint32(4, true)
    if (id === 'fmt ') {
      fmt = parseFmt(await read(pos + 8, Math.min(len, 40)))
      if (!fmt) throw new Error('WAV fmt chunk is not a stream this plugin reads')
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt chunk')
      const dataStart = pos + 8
      const dataSize = len === 0 || len === 0xffffffff || dataStart + len > size ? size - dataStart : len
      return { ...fmt, dataStart, dataSize }
    }
    pos += 8 + len + (len & 1)
  }
  throw new Error('WAV without data chunk')
}

function wavSupported(f: Pick<WavFormat, 'format' | 'bits'>): boolean {
  if (f.format === WAVE_FORMAT.PCM) return [8, 16, 24, 32].includes(f.bits)
  if (f.format === WAVE_FORMAT.FLOAT) return f.bits === 32 || f.bits === 64
  return false
}

/** Convert interleaved PCM bytes to one Float32Array per channel. */
export function pcmToFloat(b: Uint8Array, f: Pick<WavFormat, 'format' | 'channels' | 'bits'>): Float32Array[] {
  const bps = f.bits / 8, frame = bps * f.channels, n = Math.floor(b.length / frame)
  const out = Array.from({ length: f.channels }, () => new Float32Array(n))
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < f.channels; c++) {
      const p = i * frame + c * bps
      let v: number
      if (f.format === WAVE_FORMAT.FLOAT) v = f.bits === 32 ? dv.getFloat32(p, true) : dv.getFloat64(p, true)
      else if (f.bits === 8) v = (b[p]! - 128) / 128
      else if (f.bits === 16) v = dv.getInt16(p, true) / 32768
      else if (f.bits === 24) v = ((b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16)) << 8 >> 8) / 8388608
      else v = dv.getInt32(p, true) / 2147483648
      out[c]![i] = v
    }
  }
  return out
}

/* ───────────── decoding ───────────── */

export type ChunkSink = (channels: Float32Array[], sampleRate: number) => void

const CHUNK = 1 << 20
/** First read of a compressed stream (grows to CHUNK when the stream behaves). */
const MIN_CHUNK = 1 << 10

interface Wasm { ready: Promise<void>; decode(d: Uint8Array): unknown; flush?(): Promise<unknown>; free(): void }
interface Decoded { channelData: Float32Array[]; samplesDecoded: number; sampleRate: number; bitDepth?: number }

async function wasmDecoder(kind: Exclude<AudioKind, 'wav'>): Promise<Wasm> {
  if (kind === 'mp3') { const { MPEGDecoder } = await import('mpg123-decoder'); return new MPEGDecoder() as unknown as Wasm }
  if (kind === 'flac') { const { FLACDecoder } = await import('@wasm-audio-decoders/flac'); return new FLACDecoder() as unknown as Wasm }
  if (kind === 'ogg-vorbis') { const { OggVorbisDecoder } = await import('@wasm-audio-decoders/ogg-vorbis'); return new OggVorbisDecoder() as unknown as Wasm }
  const { OggOpusDecoder } = await import('ogg-opus-decoder')
  return new OggOpusDecoder() as unknown as Wasm
}

const CODEC_NAME: Record<AudioKind, string> = { wav: 'PCM', mp3: 'MP3', 'ogg-vorbis': 'Vorbis', 'ogg-opus': 'Opus', flac: 'FLAC' }

/** FLAC STREAMINFO bits per sample (the decoder may not report it). */
function flacBits(head: Uint8Array): number | null {
  const at = ascii(head, 0, 4) === 'fLaC' ? 0 : id3Size(head)
  if (ascii(head, at, 4) !== 'fLaC' || at + 8 + 34 > head.length) return null
  const s = at + 8
  return (((head[s + 12]! & 0x01) << 4) | (head[s + 13]! >> 4)) + 1
}

/**
 * Decode a file in chunks, calling `sink` with each block of PCM. Resolves with the stream info.
 * Throws when the format is not one this plugin reads or the data cannot be decoded.
 */
export async function decodeFile(absPath: string, sink: ChunkSink): Promise<StreamInfo> {
  const fh = await fs.open(absPath, 'r')
  try {
    const size = (await fh.stat()).size
    const head = new Uint8Array(Math.min(size, 64 * 1024))
    await fh.read(head, 0, head.length, 0)
    const kind = detectAudio(head)
    if (!kind) throw new Error('not an audio format this plugin reads')
    if (kind === 'wav') {
      const f = await readWavFormat(fh, size)
      if (!wavSupported(f)) throw new Error(`WAV encoding ${f.format}/${f.bits} bit is not supported`)
      const frame = (f.bits / 8) * f.channels
      if (f.dataSize / frame / f.sampleRate > LIMITS.maxSeconds) throw new Error('audio too long to analyse')
      const step = Math.max(frame, Math.floor(CHUNK / frame) * frame)
      for (let p = 0; p < f.dataSize; p += step) {
        const n = Math.min(step, f.dataSize - p)
        const b = new Uint8Array(n)
        const { bytesRead } = await fh.read(b, 0, n, f.dataStart + p)
        if (!bytesRead) break
        sink(pcmToFloat(b.subarray(0, bytesRead - (bytesRead % frame)), f), f.sampleRate)
      }
      return { kind, codec: f.format === WAVE_FORMAT.FLOAT ? 'PCM 浮点' : 'PCM', sampleRate: f.sampleRate, channels: f.channels, bitDepth: f.bits }
    }
    const dec = await wasmDecoder(kind)
    await dec.ready
    let sampleRate = 0, channels = 0, bitDepth: number | null = null, frames = 0, fed = 0
    const limit = kind === 'mp3' ? mp3Channels(head) : Infinity
    const take = (r: Decoded | null | undefined) => {
      if (!r || !r.samplesDecoded) return
      const data = r.channelData.slice(0, limit)
      if (!validStream(r.sampleRate, data.length)) throw new Error('not a stream this plugin reads')
      sampleRate = r.sampleRate; channels = data.length
      if (r.bitDepth) bitDepth = r.bitDepth
      frames += r.samplesDecoded
      // Decompression bombs: far more audio than the bytes read so far can honestly hold, or simply too long.
      if (frames > sampleRate * LIMITS.maxSeconds) throw new Error('audio too long to analyse')
      if (frames > sampleRate * LIMITS.ratioGraceSeconds && frames > fed * LIMITS.maxFramesPerByte) throw new Error('decoded audio is out of all proportion to the file (decompression bomb)')
      sink(data.map(c => c.subarray(0, r.samplesDecoded)), r.sampleRate)
    }
    try {
      // Small reads first, so one call cannot expand a few kilobytes into gigabytes; grow while the ratio is sane.
      let chunk = MIN_CHUNK
      for (let p = 0; p < size; p += chunk) {
        if (frames > 0 && frames / Math.max(1, fed) < 64) chunk = Math.min(CHUNK, chunk * 2)
        const b = new Uint8Array(Math.min(chunk, size - p))
        const { bytesRead } = await fh.read(b, 0, b.length, p)
        if (!bytesRead) break
        fed += bytesRead
        take(await (dec.decode(b.subarray(0, bytesRead)) as Promise<Decoded> | Decoded))
      }
      if (dec.flush) take(await dec.flush() as Decoded)
    } finally {
      dec.free()
    }
    if (!sampleRate) throw new Error('no audio could be decoded')
    if (kind === 'flac' && !bitDepth) bitDepth = flacBits(head)
    return { kind, codec: CODEC_NAME[kind], sampleRate, channels, bitDepth: kind === 'flac' ? bitDepth : null }
  } finally {
    await fh.close()
  }
}
