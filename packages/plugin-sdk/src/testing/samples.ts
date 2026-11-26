/**
 * Minimal sample files written by hand, for plugin tests that must not depend on external tools or on a
 * generated sample library: PCM WAV, MP4 / MOV and WebM container skeletons (headers only, no real frames),
 * a one-triangle GLB, and a few text documents. Each builder returns the file bytes.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* ───────────── WAV ───────────── */

export interface WavOptions {
  sampleRate?: number
  channels?: number
  /** 8, 16, 24 or 32 (int), or 32 / 64 with `float: true`. */
  bitDepth?: number
  float?: boolean
  /** Samples per channel; or give `samples` directly. */
  frames?: number
  /** Per-channel samples in -1..1; generated as a 440 Hz sine at -6 dBFS when absent. */
  samples?: Float32Array[]
}

export function makeWav(o: WavOptions = {}): Uint8Array {
  const sampleRate = o.sampleRate ?? 48000, bitDepth = o.bitDepth ?? 16, float = o.float ?? false
  const channels = o.samples?.length ?? o.channels ?? 1
  const frames = o.samples?.[0]?.length ?? o.frames ?? sampleRate / 10
  const data = o.samples ?? Array.from({ length: channels }, () => {
    const a = new Float32Array(frames)
    for (let i = 0; i < frames; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sampleRate)
    return a
  })
  const bps = bitDepth / 8, blockAlign = channels * bps, dataLen = frames * blockAlign
  const buf = new Uint8Array(44 + dataLen)
  const dv = new DataView(buf.buffer)
  const tag = (o2: number, s: string) => { for (let i = 0; i < 4; i++) buf[o2 + i] = s.charCodeAt(i) }
  tag(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); tag(8, 'WAVE')
  tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, float ? 3 : 1, true); dv.setUint16(22, channels, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * blockAlign, true); dv.setUint16(32, blockAlign, true); dv.setUint16(34, bitDepth, true)
  tag(36, 'data'); dv.setUint32(40, dataLen, true)
  let p = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c]![i]!))
      if (float && bitDepth === 32) dv.setFloat32(p, v, true)
      else if (float && bitDepth === 64) dv.setFloat64(p, v, true)
      else if (bitDepth === 8) dv.setUint8(p, Math.round(v * 127) + 128)
      else if (bitDepth === 16) dv.setInt16(p, Math.round(v * 32767), true)
      else if (bitDepth === 24) { const n = Math.round(v * 8388607); dv.setUint8(p, n & 255); dv.setUint8(p + 1, (n >> 8) & 255); dv.setUint8(p + 2, (n >> 16) & 255) }
      else if (bitDepth === 32) dv.setInt32(p, Math.round(v * 2147483647), true)
      p += bps
    }
  }
  return buf
}

/* ───────────── FLAC ───────────── */

export interface FlacOptions {
  /** Number of frames (default 4). */
  frames?: number
  /** Samples per frame, 16..65535 (default 4096). */
  blockSize?: number
  /** Every sample's value in -1..1 (CONSTANT subframes: a few bytes per frame however long it is). */
  constant?: number
  /** 44100 or 48000 (default 44100). */
  sampleRate?: 44100 | 48000
}

function crc8(b: Uint8Array): number {
  let c = 0
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff }
  return c
}
function crc16(b: Uint8Array): number {
  let c = 0
  for (const x of b) { c ^= x << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff }
  return c
}
function utf8Int(n: number): number[] {
  if (n < 0x80) return [n]
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 63)]
  return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)]
}

/**
 * A mono 16-bit FLAC made of CONSTANT subframes. Short ones are ordinary files; many long frames make a
 * "decompression bomb" (hours of audio from kilobytes) for hostile-input tests.
 */
export function makeFlac(o: FlacOptions = {}): Uint8Array {
  const frames = o.frames ?? 4, bs = o.blockSize ?? 4096, rate = o.sampleRate ?? 44100
  const value = Math.round(Math.max(-1, Math.min(1, o.constant ?? 0)) * 32767)
  const total = frames * bs
  const info = new Uint8Array(34)
  const di = new DataView(info.buffer)
  di.setUint16(0, bs); di.setUint16(2, bs)
  // sample rate (20) | channels-1 (3) | bps-1 (5) | total samples (36)
  info[10] = (rate >> 12) & 0xff; info[11] = (rate >> 4) & 0xff
  info[12] = ((rate & 0x0f) << 4) | (0 << 1) | ((15 >> 4) & 1)
  info[13] = ((15 & 0x0f) << 4) | Math.floor(total / 2 ** 32) & 0x0f
  di.setUint32(14, total >>> 0)
  const parts: Uint8Array[] = [text('fLaC'), bytes(0x80, 0, 0, 34), info]
  for (let f = 0; f < frames; f++) {
    const head = new Uint8Array([0xff, 0xf8, 0x70 | (rate === 48000 ? 0x0a : 0x09), 0x08, ...utf8Int(f), (bs - 1) >> 8, (bs - 1) & 0xff])
    const withCrc = concat([head, bytes(crc8(head))])
    const body = concat([withCrc, bytes(0x00, (value >> 8) & 0xff, value & 0xff)])
    const c = crc16(body)
    parts.push(body, bytes(c >> 8, c & 0xff))
  }
  return concat(parts)
}

/* ───────────── MP4 / MOV ───────────── */

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const bytes = (...ns: number[]) => new Uint8Array(ns)
function u32be(n: number): Uint8Array { return bytes((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255) }
function u16be(n: number): Uint8Array { return bytes((n >>> 8) & 255, n & 255) }
const ascii4 = (s: string) => new TextEncoder().encode(s.padEnd(4, ' ').slice(0, 4))
const zeros = (n: number) => new Uint8Array(n)
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload)
  return concat([u32be(8 + body.length), ascii4(type), body])
}
const MATRIX = concat([u32be(0x00010000), zeros(12), u32be(0x00010000), zeros(12), u32be(0x40000000)])

export interface Mp4Options {
  width?: number
  height?: number
  fps?: number
  duration?: number
  /** Sample entry code: `avc1`, `hvc1`, `ap4h` (ProRes 4444)… */
  codec?: string
  audio?: boolean
  /** QuickTime brand (`qt  `) instead of `isom`. */
  quicktime?: boolean
  /** Put `moov` after `mdat` (not fast-start). */
  moovLast?: boolean
}

export function makeMp4(o: Mp4Options = {}): Uint8Array {
  const w = o.width ?? 320, h = o.height ?? 180, fps = o.fps ?? 30, dur = o.duration ?? 2
  const timescale = fps * 1000, frames = Math.round(dur * fps)
  const ftyp = o.quicktime
    ? box('ftyp', ascii4('qt  '), u32be(0x200), ascii4('qt  '))
    : box('ftyp', ascii4('isom'), u32be(0x200), ascii4('isom'), ascii4('iso2'), ascii4('avc1'), ascii4('mp41'))
  const mvhd = box('mvhd', zeros(4), zeros(8), u32be(1000), u32be(Math.round(dur * 1000)), u32be(0x00010000), u16be(0x0100), zeros(10), MATRIX, zeros(24), u32be(o.audio ? 3 : 2))
  const track = (id: number, handler: 'vide' | 'soun', entry: Uint8Array, ts: number, count: number, delta: number) => box('trak',
    box('tkhd', bytes(0, 0, 0, 3), zeros(8), u32be(id), zeros(4), u32be(Math.round(dur * 1000)), zeros(8), zeros(4), u16be(handler === 'soun' ? 0x0100 : 0), zeros(2), MATRIX,
      u32be(handler === 'vide' ? w << 16 : 0), u32be(handler === 'vide' ? h << 16 : 0)),
    box('mdia',
      box('mdhd', zeros(4), zeros(8), u32be(ts), u32be(count * delta), u16be(0x55c4), zeros(2)),
      box('hdlr', zeros(4), zeros(4), ascii4(handler), zeros(12), new TextEncoder().encode('Handler\0')),
      box('minf',
        handler === 'vide' ? box('vmhd', bytes(0, 0, 0, 1), zeros(8)) : box('smhd', zeros(8)),
        box('dinf', box('dref', zeros(4), u32be(1), box('url ', bytes(0, 0, 0, 1)))),
        box('stbl',
          box('stsd', zeros(4), u32be(1), entry),
          box('stts', zeros(4), u32be(1), u32be(count), u32be(delta)),
          box('stsc', zeros(4), u32be(0)),
          box('stsz', zeros(4), u32be(0), u32be(0)),
          box('stco', zeros(4), u32be(0))))))
  const visual = box(o.codec ?? 'avc1', zeros(6), u16be(1), zeros(16), u16be(w), u16be(h), u32be(0x00480000), u32be(0x00480000), zeros(4), u16be(1), zeros(32), u16be(0x18), bytes(0xff, 0xff))
  const sound = box('mp4a', zeros(6), u16be(1), zeros(8), u16be(2), u16be(16), zeros(4), u32be(48000 << 16))
  const moov = box('moov', mvhd, track(1, 'vide', visual, timescale, frames, 1000), ...(o.audio ? [track(2, 'soun', sound, 48000, Math.round(dur * 48000 / 1024), 1024)] : []))
  const mdat = box('mdat', zeros(16))
  return o.moovLast ? concat([ftyp, mdat, moov]) : concat([ftyp, moov, mdat])
}

/* ───────────── WebM ───────────── */

function vintSize(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len)
      let v = n
      for (let i = len - 1; i >= 0; i--) { out[i] = v & 255; v = Math.floor(v / 256) }
      out[0]! |= 0x80 >> (len - 1)
      return out
    }
  }
  throw new Error('size too large')
}
const UNKNOWN_SIZE = bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)
function idBytes(id: number): Uint8Array { const out: number[] = []; let v = id; while (v > 0) { out.unshift(v & 255); v = Math.floor(v / 256) } return new Uint8Array(out) }
function el(id: number, ...payload: Uint8Array[]): Uint8Array { const body = concat(payload); return concat([idBytes(id), vintSize(body.length), body]) }
function elUnknown(id: number, ...payload: Uint8Array[]): Uint8Array { return concat([idBytes(id), UNKNOWN_SIZE, ...payload]) }
function uintBytes(n: number): Uint8Array { const out: number[] = []; let v = n; do { out.unshift(v & 255); v = Math.floor(v / 256) } while (v > 0); return new Uint8Array(out) }
function f64(n: number): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n); return b }
const text = (s: string) => new TextEncoder().encode(s)

export interface WebmOptions {
  width?: number
  height?: number
  fps?: number
  duration?: number
  /** Matroska codec id, default `V_VP9`. */
  codec?: string
  audio?: boolean
  /** Write Info/Duration (true) or leave it out like a live recording (false). Default true. */
  withDuration?: boolean
  /** Write TrackEntry/DefaultDuration. Default true. */
  withDefaultDuration?: boolean
  /** Segment and Clusters of unknown size, as MediaRecorder writes them. Default false. */
  unknownSizes?: boolean
  /** Frames per cluster (default one second's worth). */
  framesPerCluster?: number
}

export function makeWebm(o: WebmOptions = {}): Uint8Array {
  const w = o.width ?? 320, h = o.height ?? 180, fps = o.fps ?? 30, dur = o.duration ?? 2
  const frames = Math.round(dur * fps), per = o.framesPerCluster ?? fps
  const header = el(0x1a45dfa3, el(0x4286, uintBytes(1)), el(0x42f7, uintBytes(1)), el(0x42f2, uintBytes(4)), el(0x42f3, uintBytes(8)), el(0x4282, text('webm')), el(0x4287, uintBytes(4)), el(0x4285, uintBytes(2)))
  const info = el(0x1549a966, el(0x2ad7b1, uintBytes(1_000_000)), ...(o.withDuration === false ? [] : [el(0x4489, f64(dur * 1000))]), el(0x4d80, text('bowerbird-test')))
  const video = el(0xae, el(0xd7, uintBytes(1)), el(0x83, uintBytes(1)), el(0x86, text(o.codec ?? 'V_VP9')),
    ...(o.withDefaultDuration === false ? [] : [el(0x23e383, uintBytes(Math.round(1e9 / fps)))]),
    el(0xe0, el(0xb0, uintBytes(w)), el(0xba, uintBytes(h))))
  const audio = o.audio ? [el(0xae, el(0xd7, uintBytes(2)), el(0x83, uintBytes(2)), el(0x86, text('A_OPUS')), el(0xe1, el(0xb5, f64(48000)), el(0x9f, uintBytes(2))))] : []
  const tracks = el(0x1654ae6b, video, ...audio)
  const clusters: Uint8Array[] = []
  for (let start = 0; start < frames; start += per) {
    const ts = Math.round(start * 1000 / fps)
    const blocks: Uint8Array[] = []
    for (let f = start; f < Math.min(frames, start + per); f++) {
      const rel = Math.round(f * 1000 / fps) - ts
      blocks.push(el(0xa3, bytes(0x81, (rel >> 8) & 255, rel & 255, f === start ? 0x80 : 0), zeros(4)))
    }
    const body = [el(0xe7, uintBytes(ts)), ...blocks]
    clusters.push(o.unknownSizes ? elUnknown(0x1f43b675, ...body) : el(0x1f43b675, ...body))
  }
  const segment = o.unknownSizes ? elUnknown(0x18538067, info, tracks, ...clusters) : el(0x18538067, info, tracks, ...clusters)
  return concat([header, segment])
}

/* ───────────── GLB ───────────── */

/** A binary glTF with one triangle (3 vertices, 1 material, no textures), 1 m on each axis. */
export function makeGlb(): Uint8Array {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1])
  const bin = new Uint8Array(pos.buffer)
  const gltf = {
    asset: { version: '2.0', generator: 'bowerbird-test' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }]
  }
  let json: Uint8Array = text(JSON.stringify(gltf))
  const pad = (n: number) => (4 - (n % 4)) % 4
  json = concat([json, new Uint8Array(pad(json.length)).fill(0x20)])
  const binP = concat([bin, zeros(pad(bin.length))])
  const total = 12 + 8 + json.length + 8 + binP.length
  const le = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b }
  return concat([text('glTF'), le(2), le(total), le(json.length), text('JSON'), json, le(binP.length), bytes(0x42, 0x49, 0x4e, 0x00), binP])
}

/** The same triangle as separate `.gltf` JSON referring to `buffer.bin`; returns both files. */
export function makeGltfWithBin(binName = 'buffer.bin'): { gltf: Uint8Array; bin: Uint8Array } {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1])
  const bin = new Uint8Array(pos.buffer.slice(0))
  const gltf = {
    asset: { version: '2.0', generator: 'bowerbird-test' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: binName, byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }]
  }
  return { gltf: text(JSON.stringify(gltf, null, 2)), bin }
}

/* ───────────── documents ───────────── */

export const SAMPLE_MARKDOWN = `---
size: 1.26 × 0.95 × 0.87 m   # 宽 × 高 × 深
---
# 宝箱

新手村第一个可以打开的容器。玩家在这里学会「靠近、交互、获得」。

## 规格

| 项目 | 要求 |
|---|---|
| 三角面 | 不超过 5,000 |

\`\`\`
blender chest_high.blend --export glb
\`\`\`
`
export const SAMPLE_HTML = '<!doctype html>\n<html><head><title>商店界面原型</title></head>\n<body><main><h1>杂货铺</h1><p>货架 4×2</p></main><script>document.title += "!"</script></body></html>\n'
export const SAMPLE_JSON = '{\n  "version": 2,\n  "target": "glb",\n  "textures": { "maxSize": 1024, "channels": ["basecolor", "normal", "orm"] }\n}\n'
export const SAMPLE_TEXT = '2026-11-24  user:lin    chest.glb  修正包边比例\n2026-11-21  agent:modeler  chest.glb  初版\n'

/* ───────────── files ───────────── */

/** A fresh temp folder; `write(name, bytes)` returns the absolute path. */
export function sampleDir(prefix = 'bb-samples-'): { dir: string; write(name: string, data: Uint8Array | string): string; cleanup(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    dir,
    write(name, data) {
      const p = path.join(dir, name)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, data)
      return p
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }) }
  }
}
