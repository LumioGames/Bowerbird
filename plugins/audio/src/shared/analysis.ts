/**
 * Streaming audio analysis (builtin-plugins.md「音频」): waveform peaks, sample peak, clipping positions and
 * integrated loudness (ITU-R BS.1770 / EBU R128: K-weighting, 400 ms blocks with 75 % overlap, absolute gate
 * −70 LUFS, relative gate −10 LU). Pure; the server feeds decoded chunks, the viewer can do the same in the browser.
 */

export interface PeaksJson {
  version: 1
  /** Seconds. */
  duration: number
  sampleRate: number
  channels: number
  /** Number of buckets in `min` / `max`. */
  length: number
  /** Per bucket, over all channels, in -1..1. */
  min: number[]
  max: number[]
  /** Start of each clipped run, in seconds. */
  clips: number[]
  /** Sample peak in dBFS (null for silence). */
  peak: number | null
  /** Integrated loudness in LUFS (null when everything is below the gate). */
  loudness: number | null
}

export interface AnalysisResult extends PeaksJson {
  frames: number
  /** Sample peak, linear 0..1+. */
  peakLinear: number
}

/** A run of at least this many samples at or above full scale counts as clipping. */
export const CLIP_LEVEL = 0.999
export const CLIP_RUN = 3
/** Clip events closer than this (seconds) are one position. */
export const CLIP_MERGE = 0.01
export const MAX_CLIPS = 500
/** Samples per fine block before bucketing. */
const BLOCK = 256

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/**
 * K-weighting filters for any sample rate, with the parameters that reproduce the BS.1770 coefficients exactly
 * at 48 kHz (the same derivation as libebur128).
 */
export function kWeighting(fs: number): [Biquad, Biquad] {
  // Stage 1: high shelf (+4 dB above ~1.7 kHz, the head's acoustic effect).
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196
  const K = Math.tan(Math.PI * f0 / fs), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416
  const a0 = 1 + K / Q + K * K
  const shelf: Biquad = {
    b0: (Vh + Vb * K / Q + K * K) / a0,
    b1: 2 * (K * K - Vh) / a0,
    b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
  // Stage 2: high pass at 38 Hz (RLB weighting).
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773
  const K1 = Math.tan(Math.PI * f1 / fs), d = 1 + K1 / Q1 + K1 * K1
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: 2 * (K1 * K1 - 1) / d, a2: (1 - K1 / Q1 + K1 * K1) / d }
  return [shelf, hp]
}

/** Channel weights (BS.1770): 1.0 front, 1.41 surround, LFE ignored in 5.1. */
function weights(channels: number): number[] {
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41]
  return Array.from({ length: channels }, (_, i) => (i < 3 ? 1 : 1.41))
}

export class AudioAnalyzer {
  readonly sampleRate: number
  readonly channels: number
  private frames = 0
  private mins = new Float32Array(1024)
  private maxs = new Float32Array(1024)
  private blocks = 0
  private blockFill = 0
  private bMin = Infinity
  private bMax = -Infinity
  private peak = 0
  private clipRun = 0
  private clips: number[] = []
  private lastClip = -Infinity
  // loudness
  private filters: Array<[Biquad, Biquad]>
  private state: Float64Array[]
  private w: number[]
  private hop: number
  private hopFill = 0
  private hopSum: Float64Array
  private totalSum: Float64Array
  /** Mean squares per 100 ms sub-block, channel-interleaved, grown by doubling (no per-hop arrays). */
  private sub = new Float64Array(0)
  private subCount = 0

  constructor(sampleRate: number, channels: number) {
    if (!Number.isInteger(sampleRate) || sampleRate < 1000 || sampleRate > 768_000) throw new RangeError(`sample rate ${sampleRate} out of range`)
    if (!Number.isInteger(channels) || channels < 1 || channels > 32) throw new RangeError(`channel count ${channels} out of range`)
    this.sampleRate = sampleRate
    this.channels = channels
    const k = kWeighting(sampleRate)
    this.filters = Array.from({ length: channels }, () => k)
    this.state = Array.from({ length: channels }, () => new Float64Array(8))
    this.w = weights(channels)
    this.hop = Math.max(1, Math.round(sampleRate * 0.1))
    this.hopSum = new Float64Array(channels)
    this.totalSum = new Float64Array(channels)
  }

  /** Feed one chunk: one Float32Array per channel, all the same length. */
  push(data: Float32Array[]): void {
    const n = data[0]?.length ?? 0
    const ch = Math.min(this.channels, data.length)
    for (let i = 0; i < n; i++) {
      let lo = Infinity, hi = -Infinity, clipped = false
      for (let c = 0; c < ch; c++) {
        const x = data[c]![i]!
        if (x < lo) lo = x
        if (x > hi) hi = x
        const ax = x < 0 ? -x : x
        if (ax > this.peak) this.peak = ax
        if (ax >= CLIP_LEVEL) clipped = true
        // K-weighted energy (direct form I, two stages)
        const [s1, s2] = this.filters[c]!, st = this.state[c]!
        const y1 = s1.b0 * x + s1.b1 * st[0]! + s1.b2 * st[1]! - s1.a1 * st[2]! - s1.a2 * st[3]!
        st[1] = st[0]!; st[0] = x; st[3] = st[2]!; st[2] = y1
        const y2 = s2.b0 * y1 + s2.b1 * st[4]! + s2.b2 * st[5]! - s2.a1 * st[6]! - s2.a2 * st[7]!
        st[5] = st[4]!; st[4] = y1; st[7] = st[6]!; st[6] = y2
        this.hopSum[c]! += y2 * y2
      }
      if (clipped) {
        this.clipRun++
        if (this.clipRun === CLIP_RUN) {
          const t = (this.frames - CLIP_RUN + 1) / this.sampleRate
          if (t - this.lastClip > CLIP_MERGE && this.clips.length < MAX_CLIPS) this.clips.push(Math.round(t * 1000) / 1000)
          this.lastClip = t
        }
      } else this.clipRun = 0
      if (lo < this.bMin) this.bMin = lo
      if (hi > this.bMax) this.bMax = hi
      this.frames++
      if (++this.blockFill === BLOCK) this.flushBlock()
      if (++this.hopFill === this.hop) {
        const need = (this.subCount + 1) * this.channels
        if (need > this.sub.length) { const g = new Float64Array(Math.max(need, this.sub.length * 2, 64 * this.channels)); g.set(this.sub); this.sub = g }
        const at = this.subCount * this.channels
        for (let c = 0; c < this.channels; c++) { this.sub[at + c] = this.hopSum[c]! / this.hop; this.totalSum[c]! += this.hopSum[c]!; this.hopSum[c] = 0 }
        this.subCount++
        this.hopFill = 0
      }
    }
  }

  private flushBlock(): void {
    if (this.blocks === this.mins.length) {
      const grow = (a: Float32Array) => { const b = new Float32Array(a.length * 2); b.set(a); return b }
      this.mins = grow(this.mins); this.maxs = grow(this.maxs)
    }
    this.mins[this.blocks] = this.bMin === Infinity ? 0 : this.bMin
    this.maxs[this.blocks] = this.bMax === -Infinity ? 0 : this.bMax
    this.blocks++
    this.blockFill = 0; this.bMin = Infinity; this.bMax = -Infinity
  }

  /** Integrated loudness (LUFS) or null. Clips shorter than one 400 ms block are measured as a single block. */
  loudness(): number | null {
    const C = this.channels
    const blockLoudness = (z: Float64Array) => { let s = 0; for (let c = 0; c < C; c++) s += this.w[c]! * z[c]!; return s > 0 ? -0.691 + 10 * Math.log10(s) : -Infinity }
    // 400 ms blocks (4 sub-blocks) with 75 % overlap, kept as one typed array.
    const nb = Math.max(0, this.subCount - 3)
    if (!nb) {
      if (!this.frames) return null
      const z = new Float64Array(C)
      for (let c = 0; c < C; c++) z[c] = (this.totalSum[c]! + this.hopSum[c]!) / this.frames
      const l = blockLoudness(z)
      return l > -70 ? round1(l) : null
    }
    const zs = new Float64Array(nb * C), lk = new Float64Array(nb), z = new Float64Array(C)
    for (let j = 0; j < nb; j++) {
      for (let c = 0; c < C; c++) {
        let v = 0
        for (let k = 0; k < 4; k++) v += this.sub[(j + k) * C + c]! / 4
        zs[j * C + c] = v; z[c] = v
      }
      lk[j] = blockLoudness(z)
    }
    const meanOver = (keep: (j: number) => boolean): number => {
      const m = new Float64Array(C)
      let n = 0
      for (let j = 0; j < nb; j++) if (keep(j)) { n++; for (let c = 0; c < C; c++) m[c]! += zs[j * C + c]! }
      if (!n) return -Infinity
      for (let c = 0; c < C; c++) m[c]! /= n
      return blockLoudness(m)
    }
    const abs = meanOver(j => lk[j]! > -70)
    if (abs === -Infinity) return null
    const gate = abs - 10
    const rel = meanOver(j => lk[j]! > -70 && lk[j]! > gate)
    return rel === -Infinity ? null : round1(rel)
  }

  finish(buckets = 2000): AnalysisResult {
    if (this.blockFill) this.flushBlock()
    const n = Math.max(0, Math.min(buckets, this.blocks))
    const min: number[] = [], max: number[] = []
    for (let k = 0; k < n; k++) {
      const a = Math.floor(k * this.blocks / n), b = Math.max(a + 1, Math.floor((k + 1) * this.blocks / n))
      let lo = Infinity, hi = -Infinity
      for (let i = a; i < b; i++) { if (this.mins[i]! < lo) lo = this.mins[i]!; if (this.maxs[i]! > hi) hi = this.maxs[i]! }
      min.push(round4(lo)); max.push(round4(hi))
    }
    return {
      version: 1,
      duration: this.frames / this.sampleRate,
      sampleRate: this.sampleRate,
      channels: this.channels,
      length: n,
      min,
      max,
      clips: this.clips.slice(),
      peak: this.peak > 0 ? round1(20 * Math.log10(this.peak)) : null,
      loudness: this.loudness(),
      frames: this.frames,
      peakLinear: this.peak
    }
  }
}

function round1(v: number): number { return Math.round(v * 10) / 10 }
function round4(v: number): number { return Math.round(v * 10000) / 10000 }

/** Peaks JSON as stored in the `peaks` thumbnail variant (no internal fields). */
export function toPeaksJson(r: AnalysisResult): PeaksJson {
  const { frames: _f, peakLinear: _p, ...json } = r
  return json
}

/** Analyse whole channels at once (browser fallback when no `peaks` variant exists yet). */
export function analyse(channels: Float32Array[], sampleRate: number, buckets = 2000): AnalysisResult {
  const a = new AudioAnalyzer(sampleRate, channels.length || 1)
  const step = 1 << 16
  const n = channels[0]?.length ?? 0
  for (let i = 0; i < n; i += step) a.push(channels.map(c => c.subarray(i, Math.min(n, i + step))))
  return a.finish(buckets)
}
