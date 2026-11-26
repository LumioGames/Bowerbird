/**
 * Hostile audio files: impossible headers are not claimed, and nothing a file declares makes the decoder or the
 * analyser allocate per frame or run unbounded. Calls run under time limits.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { assetFileFor, fileRefFor, makeFlac, makeWav, sampleDir, settleWithin } from '@bowerbird/plugin-sdk/testing'
import { AudioAnalyzer } from './shared/analysis.js'
import { detectAudio } from './decode.js'
import { audioFormat } from './server.js'

const files = sampleDir('bb-audio-hostile-')
afterAll(() => files.cleanup())

/** A WAV whose fmt chunk says what we want, followed by `bytes` of data. */
function wavWith(sampleRate: number, channels: number, bytes: number, bits = 16): Uint8Array {
  const w = makeWav({ sampleRate: 8000, channels: 1, frames: 4 })
  const head = w.slice(0, 44)
  const dv = new DataView(head.buffer)
  dv.setUint16(22, channels, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint16(32, channels * bits / 8, true)
  dv.setUint16(34, bits, true)
  dv.setUint32(40, bytes, true)
  dv.setUint32(4, 36 + bytes, true)
  const out = new Uint8Array(44 + bytes)
  out.set(head)
  return out
}

describe('impossible WAV headers', () => {
  it.each([
    ['sample rate 0', 0, 1], ['sample rate 1', 1, 1], ['sample rate 999', 999, 1], ['sample rate 10 MHz', 10_000_000, 1],
    ['no channels', 48000, 0], ['33 channels', 48000, 33]
  ])('%s is not claimed and does not probe', async (_label, rate, ch) => {
    const p = files.write(`bad_${rate}_${ch}.wav`, wavWith(rate, ch, 64 * 1024))
    expect(detectAudio(fileRefFor(p).head)).toBeNull()
    expect(await audioFormat.match(fileRefFor(p))).toBeNull()
    const r = await settleWithin(2000, () => audioFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(false)
  })

  it('a large file at a tiny sample rate is refused quickly (no per-frame arrays)', async () => {
    const p = files.write('huge_rate1.wav', wavWith(1, 1, 32 * 1024 * 1024))
    const r = await settleWithin(3000, () => audioFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(false)
  })

  it('accepts the edges of the allowed range', () => {
    expect(detectAudio(wavWith(1000, 1, 16))).toBe('wav')
    expect(detectAudio(wavWith(768_000, 32, 64))).toBe('wav')
  })

  it('a truncated or chunkless WAV is refused, not hung on', async () => {
    const full = makeWav({ sampleRate: 44100, frames: 44100 })
    for (const [name, bytes] of [['cut.wav', full.slice(0, 30)], ['nodata.wav', full.slice(0, 36)]] as const) {
      const p = files.write(name, bytes)
      const r = await settleWithin(2000, () => audioFormat.probe!(assetFileFor(p)))
      expect(r.ok).toBe(false)
    }
  })
})

describe('the analyser', () => {
  it('refuses impossible stream parameters', () => {
    expect(() => new AudioAnalyzer(1, 1)).toThrow(RangeError)
    expect(() => new AudioAnalyzer(48000, 0)).toThrow(RangeError)
    expect(() => new AudioAnalyzer(48000, 64)).toThrow(RangeError)
  })
  it('keeps loudness state in typed arrays: ten minutes of 8 kHz audio in well under a second of bookkeeping', () => {
    const a = new AudioAnalyzer(8000, 2)
    const chunk = [new Float32Array(8000 * 60).fill(0.25), new Float32Array(8000 * 60).fill(-0.25)]
    const t0 = performance.now()
    for (let m = 0; m < 10; m++) a.push(chunk)
    const r = a.finish()
    expect(r.duration).toBe(600)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('compression bombs', () => {
  it('a FLAC that decodes to hours from a few kilobytes is refused within seconds', async () => {
    // 2 000 frames × 65 535 constant samples ≈ 2.2e8 samples (≈ 83 minutes at 44.1 kHz) from about 30 KB.
    const p = files.write('bomb.flac', makeFlac({ frames: 2000, blockSize: 65535, constant: 0.25 }))
    expect(await audioFormat.match(fileRefFor(p))).toEqual({ format: 'audio', confidence: 1 })
    const r = await settleWithin(8000, () => audioFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(false)
    expect(String((r as { error: unknown }).error)).toMatch(/bomb|too long|decod/i)
  }, 20_000)
  it('an ordinary short FLAC still decodes', async () => {
    const p = files.write('short.flac', makeFlac({ frames: 3, blockSize: 4096, constant: 0.5 }))
    const r = await audioFormat.probe!(assetFileFor(p))
    expect(r.tech).toMatchObject({ codec: 'FLAC', channels: 1, sampleRate: 44100, bitDepth: 16 })
    // The decoder confirms a frame by the next one, so a synthetic stream may lose its last frame.
    expect(r.tech.duration as number).toBeGreaterThanOrEqual(2 * 4096 / 44100 - 1e-3)
    expect(r.tech.duration as number).toBeLessThanOrEqual(3 * 4096 / 44100 + 1e-3)
  })
})
