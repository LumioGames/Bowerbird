/**
 * Spectrogram for the audio viewer's「频谱」view: short-time FFT of the mono mix, Hann window, magnitudes in dB
 * mapped to 0..1, rows on a logarithmic frequency axis (20 Hz to Nyquist). Pure.
 */

/** In-place radix-2 FFT (re, im of length 2^k). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]!, ai = im[i + k]!
        const br = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci
        const bi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr
        re[i + k] = ar + br; im[i + k] = ai + bi
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}

/** Mono mix of channels. */
export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!
  const n = channels[0]?.length ?? 0, out = new Float32Array(n)
  for (const c of channels) for (let i = 0; i < n; i++) out[i]! += c[i]! / channels.length
  return out
}

export interface Spectrogram { cols: number; rows: number; /** row-major from the top (high frequencies first), 0..1 */ data: Float32Array }

export function spectrogram(samples: Float32Array, sampleRate: number, cols: number, rows: number, fftSize = 1024, floorDb = -100): Spectrogram {
  const data = new Float32Array(cols * rows)
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  const win = new Float64Array(fftSize)
  for (let i = 0; i < fftSize; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
  const nyq = sampleRate / 2, fMin = Math.min(20, nyq / 2)
  // Bin range of each row on a log axis (row 0 = highest band).
  const ranges: Array<[number, number]> = []
  for (let r = 0; r < rows; r++) {
    const f0 = fMin * (nyq / fMin) ** ((rows - 1 - r) / rows), f1 = fMin * (nyq / fMin) ** ((rows - r) / rows)
    const b0 = Math.max(1, Math.floor(f0 / nyq * fftSize / 2)), b1 = Math.max(b0 + 1, Math.ceil(f1 / nyq * fftSize / 2))
    ranges.push([b0, Math.min(fftSize / 2, b1)])
  }
  const norm = fftSize / 4
  for (let c = 0; c < cols; c++) {
    const centre = Math.floor((c + 0.5) / cols * samples.length), start = centre - fftSize / 2
    for (let i = 0; i < fftSize; i++) { const s = samples[start + i]; re[i] = (s ?? 0) * win[i]!; im[i] = 0 }
    fft(re, im)
    for (let r = 0; r < rows; r++) {
      const [b0, b1] = ranges[r]!
      let m = 0
      for (let b = b0; b < b1; b++) m = Math.max(m, Math.hypot(re[b]!, im[b]!) / norm)
      const db = m > 0 ? 20 * Math.log10(m) : floorDb
      data[r * cols + c] = Math.min(1, Math.max(0, (db - floorDb) / -floorDb))
    }
  }
  return { cols, rows, data }
}
