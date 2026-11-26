// Audio synthesis (WAV written by hand), Ogg / video encoding through the local ffmpeg, and Radiance HDR files.
// ffmpeg is only needed to regenerate fixtures; the outputs are committed. `-fflags +bitexact` keeps muxers from
// writing version strings, random stream serials and creation times.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rng } from './util.mjs'

/* ───────────── WAV ───────────── */

/** 16-bit PCM WAV from float samples in [-1, 1] (values outside are clipped, on purpose where asked). */
export function wav(samples, { sampleRate = 44100, channels = 1 } = {}) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return buf
}

const TAU = Math.PI * 2

/** chest_open.wav — 0.8 s: a wooden creak, the lid knocking open, then a short shimmer. */
export function chestOpen(sr = 44100) {
  const n = Math.round(0.8 * sr), out = new Float32Array(n), r = rng(17)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    let s = 0
    if (t < 0.42) { // creak: a gritty, rising, pulsed tone
      const f = 140 + 220 * t + 30 * Math.sin(TAU * 7 * t)
      ph += TAU * f / sr
      const pulse = 0.5 + 0.5 * Math.sin(TAU * 38 * t)
      s += 0.38 * Math.sign(Math.sin(ph)) * pulse * Math.min(1, t / 0.03) * (1 - t / 0.42) + 0.06 * (r() * 2 - 1)
    }
    if (t >= 0.4 && t < 0.62) { const k = t - 0.4; s += 0.75 * Math.sin(TAU * 95 * k) * Math.exp(-k * 28) + 0.25 * (r() * 2 - 1) * Math.exp(-k * 60) }
    if (t >= 0.45) { const k = t - 0.45; s += 0.16 * Math.exp(-k * 6) * (Math.sin(TAU * 1568 * k) + 0.7 * Math.sin(TAU * 2093 * k) + 0.5 * Math.sin(TAU * 2637 * k + 1)) * Math.min(1, k / 0.02) }
    out[i] = s * Math.min(1, (0.8 - t) / 0.02)
  }
  return wav(out, { sampleRate: sr })
}

/** ui_click.wav — 0.2 s click. */
export function uiClick(sr = 44100) {
  const n = Math.round(0.2 * sr), out = new Float32Array(n), r = rng(5)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    out[i] = 0.55 * Math.sin(TAU * 2200 * t) * Math.exp(-t * 90) + 0.3 * (r() * 2 - 1) * Math.exp(-t * 400) + 0.2 * Math.sin(TAU * 660 * t) * Math.exp(-t * 40)
  }
  return wav(out, { sampleRate: sr })
}

/** coin_pickup.wav — 0.4 s two-note ping, deliberately driven past full scale so it clips (the audio viewer marks clipping). */
export function coinPickup(sr = 44100) {
  const n = Math.round(0.4 * sr), out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = t < 0.08 ? 988 : 1319
    const k = t < 0.08 ? t : t - 0.08
    out[i] = 1.7 * (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t)) * Math.exp(-k * 9) * Math.min(1, k / 0.004)
  }
  return wav(out, { sampleRate: sr })
}

/** lantern_light.wav — 1.2 s: a match strike and a soft warm hum. */
export function lanternLight(sr = 44100) {
  const n = Math.round(1.2 * sr), out = new Float32Array(n), r = rng(7)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    let s = 0
    if (t < 0.25) s += 0.5 * (r() * 2 - 1) * Math.exp(-t * 14)
    if (t > 0.15) { const k = t - 0.15; s += 0.25 * Math.min(1, k / 0.3) * (Math.sin(TAU * 110 * k) + 0.5 * Math.sin(TAU * 220 * k) + 0.2 * Math.sin(TAU * 330 * k)) * (0.9 + 0.1 * Math.sin(TAU * 3 * k)) }
    out[i] = s * Math.min(1, (1.2 - t) / 0.1)
  }
  return wav(out, { sampleRate: sr })
}

/** theme_town — 2:14 of a simple deterministic tune (pentatonic melody over a bass and pad), mono 22.05 kHz. */
export function themeTown(sr = 22050, seconds = 134) {
  const n = Math.round(seconds * sr), out = new Float32Array(n), r = rng(4)
  const scale = [0, 2, 4, 7, 9, 12, 14, 16]
  const bpm = 96, beat = 60 / bpm, eighth = beat / 2
  const chords = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]]
  const steps = Math.ceil(seconds / eighth)
  const melody = []
  let deg = 2
  for (let i = 0; i < steps; i++) { if (r() < 0.7) deg = Math.max(0, Math.min(scale.length - 1, deg + Math.round((r() - 0.5) * 3))); melody.push(r() < 0.18 ? null : scale[deg]) }
  const hz = semi => 261.63 * Math.pow(2, semi / 12)
  for (let i = 0; i < n; i++) {
    const t = i / sr, step = Math.floor(t / eighth), inStep = t - step * eighth
    const bar = Math.floor(t / (beat * 4)) % chords.length, ch = chords[bar]
    let s = 0
    const m = melody[step]
    if (m != null) s += 0.22 * Math.sin(TAU * hz(m + 12) * t) * Math.exp(-inStep * 5)
    for (const c of ch) s += 0.05 * Math.sin(TAU * hz(c) * t)
    const inBeat = t % beat
    s += 0.18 * Math.sin(TAU * hz(ch[0] - 24) * t) * Math.exp(-inBeat * 4)
    const fade = Math.min(1, t / 2, (seconds - t) / 4)
    out[i] = s * fade
  }
  return { samples: out, sampleRate: sr }
}

/* ───────────── ffmpeg ───────────── */

export function hasFfmpeg() { return spawnSync('ffmpeg', ['-hide_banner', '-version']).status === 0 }

function ffmpeg(args, input) {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { input, maxBuffer: 1 << 30 })
  if (res.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' ') + '\n' + res.stderr?.toString())
}

function tmpFile(ext) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-fixtures-')), 'out' + ext) }

/** Ogg Vorbis at a low bitrate (ffmpeg's built-in Vorbis encoder; libvorbis is not required). */
export function encodeOgg(wavBuf) {
  const out = tmpFile('.ogg')
  ffmpeg(['-f', 'wav', '-i', 'pipe:0', '-c:a', 'vorbis', '-strict', 'experimental', '-ac', '2', '-q:a', '1',
    '-fflags', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1', out], wavBuf)
  return fs.readFileSync(out)
}

/**
 * VP9 in MP4 (Playwright's Chromium has no H.264), single-threaded for repeatable output, with an Opus track
 * when `audioWav` is given.
 */
export function encodeMp4Vp9(frames, { width, height, fps, audioWav }) {
  const out = tmpFile('.mp4')
  const args = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0']
  let wavPath = null
  if (audioWav) { wavPath = tmpFile('.wav'); fs.writeFileSync(wavPath, audioWav); args.push('-i', wavPath) }
  args.push('-map', '0:v')
  if (audioWav) args.push('-map', '1:a', '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000')
  args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '38', '-deadline', 'good', '-cpu-used', '4',
    '-threads', '1', '-row-mt', '0', '-g', String(fps),
    '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1', out)
  ffmpeg(args, Buffer.concat(frames))
  return fs.readFileSync(out)
}

/** ProRes 4444 with alpha in a QuickTime file: decodable by ffmpeg, not by browsers (demonstrates a processing failure). */
export function encodeProRes4444(frames, { width, height, fps }) {
  const out = tmpFile('.mov')
  ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-threads', '1',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', out], Buffer.concat(frames))
  return fs.readFileSync(out)
}

export function probe(file) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,duration,codec_type,profile:format=duration,format_name', '-of', 'json', file])
  return JSON.parse(res.stdout.toString())
}

/* ───────────── Radiance HDR (RGBE, new-style RLE) ───────────── */

function rgbe(r, g, b) {
  const v = Math.max(r, g, b)
  if (v < 1e-32) return [0, 0, 0, 0]
  const e = Math.ceil(Math.log2(v))
  let s = Math.pow(2, -e) * 256
  if (v * s >= 256) { s /= 2; return [Math.floor(r * s), Math.floor(g * s), Math.floor(b * s), e + 129] }
  return [Math.floor(r * s), Math.floor(g * s), Math.floor(b * s), e + 128]
}

function rleChannel(bytes) {
  const out = []
  let i = 0
  const n = bytes.length
  while (i < n) {
    // look for a run of at least 3
    let run = 1
    while (i + run < n && run < 127 && bytes[i + run] === bytes[i]) run++
    if (run >= 3) { out.push(128 + run, bytes[i]); i += run; continue }
    // literal: until the next run of 3 (max 128)
    let j = i, lit = []
    while (j < n && lit.length < 128) {
      if (j + 2 < n && bytes[j] === bytes[j + 1] && bytes[j] === bytes[j + 2]) break
      lit.push(bytes[j]); j++
    }
    out.push(lit.length, ...lit); i = j
  }
  return out
}

/**
 * Equirectangular HDR environment: sky gradient over ground colour, a sun disc much brighter than 1.0,
 * written as Radiance RGBE with run-length encoded scanlines.
 */
export function hdrEnvironment({ width, height, sky, ground, sun }) {
  const parse = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.pow(v / 255, 2.2)) }
  const top = parse(sky[0]), horizon = parse(sky[1] ?? sky[0]), gnd = parse(ground)
  const parts = [Buffer.from(`#?RADIANCE\n# Bowerbird fixtures generator (original content, MIT licensed)\nFORMAT=32-bit_rle_rgbe\nEXPOSURE=1.0\n\n-Y ${height} +X ${width}\n`, 'latin1')]
  const sunX = sun.u * width, sunY = sun.v * height, sunR = sun.size * height
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1)
    let base
    if (v < 0.5) { const k = Math.pow(v / 0.5, 1.6); base = top.map((c, i) => (c * (1 - k) + horizon[i] * k) * 1.6) }
    else { const k = Math.min(1, (v - 0.5) / 0.08); base = gnd.map((c, i) => (horizon[i] * (1 - k) + c * k) * 0.9) }
    const row = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)]
    const dy = Math.abs(y - sunY)
    for (let x = 0; x < width; x++) {
      let c = base
      if (dy < sunR * 4) {
        const d = Math.hypot(x - sunX, y - sunY)
        if (d < sunR) c = sun.color.map(s => s * sun.intensity)
        else if (d < sunR * 4) { const k = Math.pow(1 - (d - sunR) / (sunR * 3), 3); c = base.map((b, i) => b + sun.color[i] * sun.intensity * 0.04 * k) }
      }
      const e = rgbe(c[0], c[1], c[2])
      row[0][x] = e[0]; row[1][x] = e[1]; row[2][x] = e[2]; row[3][x] = e[3]
    }
    const line = [2, 2, (width >> 8) & 255, width & 255]
    for (const ch of row) line.push(...rleChannel(ch))
    parts.push(Buffer.from(line))
  }
  return Buffer.concat(parts)
}
