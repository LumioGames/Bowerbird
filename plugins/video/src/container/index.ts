/**
 * Container sniffing and probing for the video plugin. MP4 / MOV and WebM are parsed here; nothing is decoded
 * and no external tool is called (builtin-plugins.md: 外部依赖 无).
 */
import fs from 'node:fs/promises'
import { ascii, buffered, u32, type RandomAccess } from './reader.js'
import { probeIsoBmff } from './isobmff.js'
import { probeEbml } from './ebml.js'
import type { VideoInfo } from './types.js'

export type { VideoInfo } from './types.js'
export { bytesReader, buffered } from './reader.js'
export { formatDuration } from '../shared/duration.js'

/** Brands of still-image files that also start with `ftyp` (not ours). */
const IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1', 'heim', 'heis', 'hevc', 'hevx'])

export function sniff(head: Uint8Array): 'isobmff' | 'ebml' | null {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'ebml'
  if (head.length >= 12) {
    const type = ascii(head, 4, 4)
    if (type === 'ftyp') {
      const major = ascii(head, 8, 4)
      if (IMAGE_BRANDS.has(major)) return null
      return 'isobmff'
    }
    // Old QuickTime files may start with any of these atoms.
    if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(type) && u32(head, 0) >= 8) return 'isobmff'
  }
  return null
}

export async function probeContainer(r: RandomAccess): Promise<VideoInfo> {
  const head = await r.read(0, 64)
  const kind = sniff(head)
  if (kind === 'ebml') return probeEbml(r)
  if (kind === 'isobmff') return probeIsoBmff(r)
  throw new Error('not a video container this plugin reads')
}

/** Probe a file on disk without reading it whole. */
export async function probeFile(absPath: string): Promise<VideoInfo> {
  const fh = await fs.open(absPath, 'r')
  try {
    const size = (await fh.stat()).size
    const r: RandomAccess = buffered({
      size,
      async read(offset, length) {
        const n = Math.max(0, Math.min(length, size - offset))
        const buf = new Uint8Array(n)
        if (n) await fh.read(buf, 0, n, offset)
        return buf
      }
    })
    return await probeContainer(r)
  } finally {
    await fh.close()
  }
}
