/**
 * Hostile containers: length fields that claim more than is sensible are refused before anything that size is
 * allocated; truncated and garbage files settle quickly.
 */
import fs from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { assetFileFor, makeMp4, makeWebm, sampleDir, settleWithin } from '@bowerbird/plugin-sdk/testing'
import { MAX_MOOV } from './container/isobmff.js'
import { MAX_EBML_ELEMENT } from './container/ebml.js'
import { videoFormat } from './server.js'

const files = sampleDir('bb-video-hostile-')
afterAll(() => files.cleanup())

/** A sparse file: `head` then zeros up to `size` bytes (cheap to create, huge to read). */
function sparse(name: string, head: Uint8Array, size: number): string {
  const p = files.write(name, head)
  fs.truncateSync(p, size)
  return p
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

describe('ISO BMFF', () => {
  it('refuses a moov box larger than the limit without reading it', async () => {
    const ftyp = makeMp4().subarray(0, 32)
    const size = MAX_MOOV + 1024
    const p = sparse('big_moov.mp4', new Uint8Array([...ftyp, ...u32(size), 0x6d, 0x6f, 0x6f, 0x76]), 32 + size)
    const r = await settleWithin(2000, () => videoFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(false)
    expect(String((r as { error: unknown }).error)).toMatch(/moov/)
  })
  it('settles on truncated files and garbage after ftyp', async () => {
    const full = makeMp4({ audio: true })
    for (const [name, data] of [['half.mp4', full.slice(0, full.length >> 1)], ['ftyp_only.mp4', full.slice(0, 32)], ['junk.mp4', new Uint8Array([...full.slice(0, 32), ...new Uint8Array(4096).fill(0xff)])]] as const) {
      const r = await settleWithin(2000, () => videoFormat.probe!(assetFileFor(files.write(name, data))))
      expect(r.ok).toBe(false)
    }
  })
  it('does not loop on boxes of size 0 / 1 / 8 inside moov', async () => {
    const moov = new Uint8Array([0, 0, 0, 40, 0x6d, 0x6f, 0x6f, 0x76, 0, 0, 0, 8, 0x74, 0x72, 0x61, 0x6b, 0, 0, 0, 1, 0x74, 0x72, 0x61, 0x6b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x74, 0x72, 0x61, 0x6b])
    const p = files.write('odd_boxes.mp4', new Uint8Array([...makeMp4().subarray(0, 32), ...moov]))
    const r = await settleWithin(2000, () => videoFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(false)
  })
})

describe('EBML', () => {
  const header = makeWebm().subarray(0, 40)
  it('refuses Info / Tracks elements larger than the limit', async () => {
    const ebml = makeWebm()
    const headerLen = ebml.indexOf(0x18) // Segment id starts after the EBML header
    const size = MAX_EBML_ELEMENT + 1024
    // Segment (unknown size) → Tracks with an 8-byte size field
    const seg = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x16, 0x54, 0xae, 0x6b, 0x01, 0, 0, 0, ...u32(size)]
    const p = sparse('big_tracks.webm', new Uint8Array([...ebml.subarray(0, headerLen), ...seg]), headerLen + seg.length + size)
    const r = await settleWithin(2000, () => videoFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(false)
    expect(String((r as { error: unknown }).error)).toMatch(/too large/)
    expect(header.length).toBe(40)
  })
  it('settles on truncated and garbage WebM', async () => {
    const full = makeWebm({ duration: 3 })
    for (const [name, data] of [['cut.webm', full.slice(0, 60)], ['cut2.webm', full.slice(0, full.length - 7)], ['junk.webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Uint8Array(4096).fill(0x01)])]] as const) {
      const r = await settleWithin(2000, () => videoFormat.probe!(assetFileFor(files.write(name, data))))
      expect(r.ms).toBeLessThan(2000)
    }
  })
})
