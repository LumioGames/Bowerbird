/**
 * Pixel size of an image from its header bytes (PNG, JPEG, WebP, GIF, KTX2), without decoding it.
 * Used to report texture edge lengths of packed and external textures. Pure.
 */

export interface PixelSize { width: number; height: number; mime: string }

function u16be(b: Uint8Array, o: number): number { return (b[o]! << 8) | b[o + 1]! }
function u32be(b: Uint8Array, o: number): number { return ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]! }
function u16le(b: Uint8Array, o: number): number { return b[o]! | (b[o + 1]! << 8) }
function u32le(b: Uint8Array, o: number): number { return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + ((b[o + 3]! << 24) >>> 0) }

export function imageSize(b: Uint8Array): PixelSize | null {
  if (b.length < 12) return null
  // PNG: signature + IHDR
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) {
    return { width: u32be(b, 16), height: u32be(b, 20), mime: 'image/png' }
  }
  // JPEG: walk the markers to the first start-of-frame
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue }
      const m = b[o + 1]!
      if (m === 0xff) { o++; continue }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue }
      const len = u16be(b, o + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: u16be(b, o + 5), width: u16be(b, o + 7), mime: 'image/jpeg' }
      }
      o += 2 + len
    }
    return null
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: u16le(b, 6), height: u16le(b, 8), mime: 'image/gif' }
  // WebP (RIFF....WEBP)
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 && b.length >= 30) {
    const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
    if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, mime: 'image/webp' }
    if (chunk === 'VP8L') {
      const v = u32le(b, 21)
      return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1, mime: 'image/webp' }
    }
    if (chunk === 'VP8X') {
      const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16))
      const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))
      return { width: w, height: h, mime: 'image/webp' }
    }
    return null
  }
  // KTX2: «KTX 20»
  if (b[0] === 0xab && b[1] === 0x4b && b[2] === 0x54 && b[3] === 0x58 && b[4] === 0x20 && b[5] === 0x32 && b.length >= 28) {
    return { width: u32le(b, 20), height: u32le(b, 24), mime: 'image/ktx2' }
  }
  return null
}
