import { describe, expect, it } from 'vitest'
import { fft, mixdown, spectrogram } from './spectrum.js'
import { barHeights, normalise, signed, timecode } from '../../shared/wave.js'
import { analyse } from '../../shared/analysis.js'
import { audioCompareModes, REASON_AUDIO, selectionFrom } from './rules.js'

describe('fft', () => {
  it('finds a pure tone in its bin', () => {
    const n = 64, re = new Float64Array(n), im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.cos(2 * Math.PI * 8 * i / n)
    fft(re, im)
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]!))
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(8)
    expect(mags[8]).toBeCloseTo(n / 2, 6)
  })
})

describe('spectrogram', () => {
  it('puts a 1 kHz tone on the row covering 1 kHz', () => {
    const rate = 16000, s = new Float32Array(rate)
    for (let i = 0; i < s.length; i++) s[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / rate)
    const sp = spectrogram(s, rate, 8, 32)
    const col = 4, column = Array.from({ length: 32 }, (_, r) => sp.data[r * 8 + col]!)
    const top = column.indexOf(Math.max(...column))
    // row r covers 20·(8000/20)^((31-r)/32) … 20·(8000/20)^((32-r)/32) Hz
    const lo = 20 * 400 ** ((31 - top) / 32), hi = 20 * 400 ** ((32 - top) / 32)
    expect(lo).toBeLessThanOrEqual(1000 * 1.2)
    expect(hi).toBeGreaterThanOrEqual(1000 / 1.2)
    expect(column[top]).toBeGreaterThan(0.7)
  })
  it('mixes channels down', () => {
    expect(Array.from(mixdown([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5])
  })
})

describe('waveform peaks for the viewer', () => {
  it('draws bars from browser-side analysis like the server peaks', () => {
    const s = new Float32Array(8000).map((_, i) => (i < 4000 ? 0.8 : 0.2) * Math.sin(i / 3))
    const r = analyse([s], 8000, 100)
    const bars = barHeights(r, 2)
    expect(bars[0]).toBeCloseTo(0.8, 1)
    expect(bars[1]).toBeCloseTo(0.2, 1)
    expect(normalise([0.5, 0.25])).toEqual([1, 0.5])
  })
  it('formats readouts', () => {
    expect(signed(-16.2)).toBe('−16.2')
    expect(timecode(0.8)).toBe('00:00.80')
  })
})

describe('compare and selection rules', () => {
  it('only lines up two waveforms', () => {
    const m = audioCompareModes({ format: 'audio' } as never, { format: 'audio' } as never)!
    expect(m.find(x => x.mode === 'side')!.available).toBe(true)
    expect(m.find(x => x.mode === 'wipe')).toEqual({ mode: 'wipe', available: false, reason: REASON_AUDIO })
    expect(audioCompareModes({ format: 'audio' } as never, { format: 'video' } as never)).toBeNull()
  })
  it('tells a click from a drag (6 px) and orders the selection', () => {
    expect(selectionFrom(1, 1.004, 2, 1000)).toBeNull()
    expect(selectionFrom(1.5, 0.5, 2, 1000)).toEqual({ a: 0.5, b: 1.5 })
  })
})
