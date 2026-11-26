/**
 * zlib in the browser with the output capped (review P1-2): an FBX array declares how many bytes it holds, so
 * decompression stops as soon as it would produce more. Input is fed in small pieces to fflate's streaming
 * decoder, so a decompression bomb costs at most one piece's worth of work past the cap.
 */
import { Unzlib } from 'three/addons/libs/fflate.module.js'

const STEP = 1024

export function inflateBounded(data: Uint8Array, max: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, max))
  let n = 0
  const z = new Unzlib(chunk => {
    if (n + chunk.length > out.length) throw new RangeError('inflated data larger than the array declares')
    out.set(chunk, n)
    n += chunk.length
  })
  for (let i = 0; i < data.length; i += STEP) z.push(data.subarray(i, Math.min(data.length, i + STEP)), i + STEP >= data.length)
  return out.subarray(0, n)
}
