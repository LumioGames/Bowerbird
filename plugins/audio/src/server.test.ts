import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { assetFileFor, fileRefFor, makeWav, sampleDir } from '@bowerbird/plugin-sdk/testing'
import { FLAC_B64, MP3_B64, OGG_OPUS_B64, OGG_VORBIS_B64, fromB64 } from './__tests__/samples.js'
import { detectAudio, pcmToFloat } from './decode.js'
import { analyse, type PeaksJson } from './shared/analysis.js'
import { audioBadge, barHeights, rateText, waveformSvg } from './shared/wave.js'
import { audioFormat, PEAK_BUCKETS } from './server.js'

const files = sampleDir('bb-audio-')
afterAll(() => files.cleanup())

function sine(freq: number, amp: number, seconds: number, rate: number): Float32Array {
  const a = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(2 * Math.PI * freq * i / rate)
  return a
}

describe('detectAudio', () => {
  it('knows every supported container by its header', () => {
    expect(detectAudio(makeWav())).toBe('wav')
    expect(detectAudio(fromB64(MP3_B64))).toBe('mp3')
    expect(detectAudio(fromB64(OGG_VORBIS_B64))).toBe('ogg-vorbis')
    expect(detectAudio(fromB64(OGG_OPUS_B64))).toBe('ogg-opus')
    expect(detectAudio(fromB64(FLAC_B64))).toBe('flac')
    expect(detectAudio(new TextEncoder().encode('just some text, really'))).toBeNull()
  })
})

describe('WAV decoding', () => {
  it('converts 8, 16, 24, 32-bit integer and float samples to -1..1', () => {
    const src = [new Float32Array([0, 0.5, -0.5, 0.25])]
    for (const [bits, float] of [[8, false], [16, false], [24, false], [32, false], [32, true], [64, true]] as const) {
      const wav = makeWav({ samples: src, bitDepth: bits, float, sampleRate: 8000 })
      const out = pcmToFloat(wav.subarray(44), { format: float ? 3 : 1, channels: 1, bits })
      for (let i = 0; i < 4; i++) expect(out[0]![i]).toBeCloseTo(src[0]![i]!, bits === 8 ? 1 : 3)
    }
  })
})

describe('loudness and peaks (BS.1770)', () => {
  it('measures a full-scale 1 kHz sine on one channel at -3.01 LUFS', () => {
    const r = analyse([sine(1000, 1, 3, 48000)], 48000)
    expect(r.loudness!).toBeCloseTo(-3.0, 1)
    expect(r.peak!).toBeCloseTo(0, 1)
  })
  it('adds channels and follows the level', () => {
    const s = sine(1000, 0.5, 3, 44100)
    expect(analyse([s, s], 44100).loudness!).toBeCloseTo(-6.0, 1)
    expect(analyse([s], 44100).loudness!).toBeCloseTo(-9.0, 1)
  })
  it('gates out silence and measures short effects as one block', () => {
    expect(analyse([new Float32Array(48000)], 48000).loudness).toBeNull()
    const short = analyse([sine(1000, 0.5, 0.2, 48000)], 48000)
    expect(short.loudness!).toBeCloseTo(-9.0, 0)
  })
  it('finds clipped runs and merges close ones', () => {
    const s = sine(200, 0.4, 1, 8000)
    for (const at of [0.1, 0.102, 0.5]) for (let k = 0; k < 6; k++) s[Math.round(at * 8000) + k] = 1
    const r = analyse([s], 8000)
    expect(r.clips).toEqual([0.1, 0.5])
  })
  it('buckets min / max over all channels', () => {
    const r = analyse([new Float32Array([0, 0.5, -0.25, 0]), new Float32Array([0, -0.75, 0, 0])], 8000, 10)
    expect(r.length).toBe(1)
    expect(r.max[0]).toBe(0.5)
    expect(r.min[0]).toBe(-0.75)
  })
})

describe('audioFormat', () => {
  it('probes a WAV file', async () => {
    const p = files.write('chest_open.wav', makeWav({ samples: [sine(1000, 0.5, 0.8, 48000)], sampleRate: 48000 }))
    expect(await audioFormat.match(fileRefFor(p))).toEqual({ format: 'audio', confidence: 1 })
    const r = await audioFormat.probe!(assetFileFor(p))
    expect(r.tech).toMatchObject({ duration: 0.8, channels: 1, sampleRate: 48000, bitDepth: 16, codec: 'PCM', clips: 0 })
    expect(r.tech.peak as number).toBeCloseTo(-6, 0)
    expect(r.tech.loudness as number).toBeCloseTo(-9, 0)
    expect(r.badge).toBe('0.8 秒')
  })

  it.each([
    ['clip.mp3', MP3_B64, { codec: 'MP3', channels: 1, sampleRate: 22050 }, 0.3],
    ['clip.ogg', OGG_VORBIS_B64, { codec: 'Vorbis', channels: 2, sampleRate: 22050 }, 0.3],
    ['voice.ogg', OGG_OPUS_B64, { codec: 'Opus', channels: 1, sampleRate: 48000 }, 0.3],
    ['clip.flac', FLAC_B64, { codec: 'FLAC', channels: 1, sampleRate: 11025, bitDepth: 16 }, 0.2]
  ])('decodes %s with the WebAssembly decoders', async (name, b64, tech, dur) => {
    const p = files.write(name, fromB64(b64))
    const r = await audioFormat.probe!(assetFileFor(p))
    expect(r.tech).toMatchObject(tech)
    expect(r.tech.duration as number).toBeGreaterThan(dur - 0.02)
    expect(r.tech.duration as number).toBeLessThan(dur + 0.1)
    expect(r.tech.peak as number).toBeLessThan(-4)
    if (tech.codec !== 'FLAC') expect(r.tech.bitDepth).toBeUndefined()
  })

  it('writes the peaks JSON and a square waveform WebP', async () => {
    const p = files.write('theme.wav', makeWav({ samples: [sine(220, 0.3, 3, 22050), sine(330, 0.2, 3, 22050)], sampleRate: 22050 }))
    const set = await audioFormat.thumbnail!(assetFileFor(p))
    const m = await sharp(set.thumb!).metadata()
    expect([m.format, m.width, m.height, m.hasAlpha]).toEqual(['webp', 512, 512, true])
    expect(set.aspect).toBe(1)
    const json = JSON.parse(new TextDecoder().decode(set.peaks!)) as PeaksJson
    expect(json).toMatchObject({ version: 1, channels: 2, sampleRate: 22050 })
    expect(json.length).toBeLessThanOrEqual(PEAK_BUCKETS)
    expect(json.min.length).toBe(json.length)
    expect(Math.max(...json.max)).toBeCloseTo(0.3 + 0, 1)
  })

  it('summarises duration, channels, sample rate and loudness', async () => {
    const p = files.write('sfx.wav', makeWav({ samples: [sine(1000, 0.5, 0.8, 48000)], sampleRate: 48000, bitDepth: 24 }))
    const t = await audioFormat.summarize!(assetFileFor(p))
    expect(t.text).toMatch(/^音频 0\.8 秒，单声道，48 kHz，24 位，PCM，响度 -9(\.\d)? LUFS，峰值 -6(\.\d)? dBFS。$/)
  })
})

describe('waveform helpers', () => {
  it('formats badges and rates', () => {
    expect(audioBadge(0.8)).toBe('0.8 秒')
    expect(audioBadge(0.2)).toBe('0.2 秒')
    expect(audioBadge(134)).toBe('2:14')
    expect(audioBadge(3723)).toBe('1:02:03')
    expect(rateText(44100)).toBe('44.1 kHz')
    expect(rateText(48000)).toBe('48 kHz')
  })
  it('turns peaks into bars and an SVG', () => {
    expect(barHeights({ min: [-0.1, -0.5, 0, 0], max: [0.2, 0.1, 0.9, 0] }, 2)).toEqual([0.5, 0.9])
    const svg = waveformSvg({ min: [-0.1, -0.5], max: [0.2, 0.1] }, 160, 4)
    expect(svg.match(/<rect /g)).toHaveLength(4)
  })
})
