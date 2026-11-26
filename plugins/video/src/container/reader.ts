/**
 * Random access over a file or a byte array, with a small read-ahead window so container walkers can read
 * many short headers without one system call each.
 */
export interface RandomAccess {
  readonly size: number
  /** Up to `length` bytes at `offset` (fewer at the end of the file). */
  read(offset: number, length: number): Promise<Uint8Array>
}

export function bytesReader(bytes: Uint8Array): RandomAccess {
  return {
    size: bytes.length,
    async read(offset, length) { return bytes.subarray(Math.max(0, offset), Math.min(bytes.length, offset + length)) }
  }
}

/** Wraps a reader with a read-ahead window (default 64 KiB). */
export function buffered(inner: RandomAccess, window = 64 * 1024): RandomAccess {
  let start = -1
  let buf: Uint8Array = new Uint8Array(0)
  return {
    size: inner.size,
    async read(offset, length) {
      if (length > window) return inner.read(offset, length)
      if (start < 0 || offset < start || offset + length > start + buf.length) {
        start = offset
        buf = await inner.read(offset, Math.max(window, length))
      }
      return buf.subarray(offset - start, Math.min(buf.length, offset - start + length))
    }
  }
}

export const u16 = (b: Uint8Array, o: number) => (b[o]! << 8 | b[o + 1]!) >>> 0
export const u32 = (b: Uint8Array, o: number) => (b[o]! * 0x1000000) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!)
export const u64 = (b: Uint8Array, o: number) => u32(b, o) * 0x100000000 + u32(b, o + 4)
export function ascii(b: Uint8Array, o: number, n: number): string {
  let s = ''
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]!)
  return s
}
