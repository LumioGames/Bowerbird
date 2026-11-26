import { afterAll, describe, expect, it } from 'vitest'
import { assetFileFor, fileRefFor } from '@bowerbird/plugin-sdk/testing'
import { makeMp4, makeWebm, sampleDir } from '@bowerbird/plugin-sdk/testing'
import { bytesReader, formatDuration, probeContainer, sniff } from './container/index.js'
import { parseHeader } from './container/ebml.js'
import { niceRate } from './container/isobmff.js'
import { summaryOf, videoFormat } from './server.js'

const files = sampleDir('bb-video-')
afterAll(() => files.cleanup())

describe('sniff', () => {
  it('knows MP4, MOV and WebM and refuses still images in ftyp boxes', () => {
    expect(sniff(makeMp4())).toBe('isobmff')
    expect(sniff(makeMp4({ quicktime: true }))).toBe('isobmff')
    expect(sniff(makeWebm())).toBe('ebml')
    const avif = new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0])
    expect(sniff(avif)).toBeNull()
    expect(sniff(new TextEncoder().encode('hello world, not a video'))).toBeNull()
  })
})

describe('ISO BMFF', () => {
  it('reads duration, size, frame rate, codec and sound', async () => {
    const info = await probeContainer(bytesReader(makeMp4({ width: 1280, height: 720, fps: 30, duration: 3.2, audio: true })))
    expect(info).toMatchObject({ container: 'mp4', width: 1280, height: 720, frameRate: 30, codec: 'H.264', codecTag: 'avc1', hasAudio: true, hasVideo: true })
    expect(info.duration).toBeCloseTo(3.2, 3)
  })
  it('finds moov after mdat and names QuickTime codecs', async () => {
    const info = await probeContainer(bytesReader(makeMp4({ quicktime: true, codec: 'ap4h', moovLast: true, fps: 24 })))
    expect(info).toMatchObject({ container: 'mov', codec: 'ProRes 4444', frameRate: 24, hasAudio: false })
  })
  it('snaps NTSC frame rates', () => {
    expect(niceRate(30000 / 1001)).toBe(29.97)
    expect(niceRate(24000 / 1001)).toBe(23.976)
    expect(niceRate(25.0004)).toBe(25)
    expect(niceRate(12.5)).toBe(12.5)
  })
})

describe('EBML', () => {
  it('parses element headers with known and unknown sizes', () => {
    expect(parseHeader(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))).toEqual({ id: 0x1a45dfa3, size: 31, hlen: 5 })
    expect(parseHeader(new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toEqual({ id: 0x18538067, size: null, hlen: 12 })
  })
  it('reads a WebM with Duration and DefaultDuration', async () => {
    const info = await probeContainer(bytesReader(makeWebm({ width: 640, height: 360, fps: 25, duration: 2, audio: true })))
    expect(info).toMatchObject({ container: 'webm', width: 640, height: 360, frameRate: 25, codec: 'VP9', hasAudio: true })
    expect(info.duration).toBeCloseTo(2, 3)
  })
  it('measures a live recording without Duration, DefaultDuration or sizes', async () => {
    const info = await probeContainer(bytesReader(makeWebm({ fps: 30, duration: 2.5, withDuration: false, withDefaultDuration: false, unknownSizes: true, codec: 'V_VP8' })))
    expect(info.codec).toBe('VP8')
    expect(info.frameRate).toBeCloseTo(30, 0)
    expect(info.duration).toBeCloseTo(2.5, 1)
  })
  it('measures the duration of sized clusters from the last block', async () => {
    const info = await probeContainer(bytesReader(makeWebm({ fps: 10, duration: 4, withDuration: false })))
    expect(info.duration).toBeCloseTo(4, 1)
    expect(info.frameRate).toBe(10)
  })
})

describe('videoFormat', () => {
  it('claims containers by their header, probes from disk and writes the badge', async () => {
    const mp4 = files.write('clip.mp4', makeMp4({ duration: 3.2, fps: 30, audio: true }))
    expect(await videoFormat.match(fileRefFor(mp4))).toEqual({ format: 'video', confidence: 1 })
    expect(await videoFormat.match(fileRefFor(files.write('fake.mp4', 'nope')))).toBeNull()
    const p = await videoFormat.probe!(assetFileFor(mp4))
    expect(p.tech).toMatchObject({ duration: 3.2, width: 320, height: 180, frameRate: 30, codec: 'H.264', hasAudio: true })
    expect(p.badge).toBe('0:03')
    expect(p.aspect).toBeCloseTo(16 / 9, 5)
    const webm = files.write('rec.webm', makeWebm({ duration: 75 }))
    expect((await videoFormat.probe!(assetFileFor(webm))).badge).toBe('1:15')
  })
  it('summarises duration, resolution, frame rate and codec', async () => {
    const mov = files.write('prores.mov', makeMp4({ quicktime: true, codec: 'ap4h', width: 3840, height: 2160, fps: 24, duration: 1.5 }))
    const t = await videoFormat.summarize!(assetFileFor(mov))
    expect(t.text).toBe('视频 0:02（1.5 秒），3840×2160，24 fps，编码 ProRes 4444，无声音。')
    expect(summaryOf({ container: 'mp4', duration: null, width: 0, height: 0, frameRate: null, codec: null, codecTag: null, hasVideo: true, hasAudio: false })).toBe('视频，时长未知，编码未知，无声音。')
  })
})

describe('formatDuration', () => {
  it('writes m:ss and h:mm:ss', () => {
    expect(formatDuration(3.2)).toBe('0:03')
    expect(formatDuration(0.3)).toBe('0:01')
    expect(formatDuration(134)).toBe('2:14')
    expect(formatDuration(3723)).toBe('1:02:03')
  })
})
