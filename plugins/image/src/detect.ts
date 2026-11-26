/**
 * Magic-number checks for the image formats this plugin claims (builtin-plugins.md「图片」).
 * Pure: works on the first bytes of a file (`FileRef.head`).
 */
export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg'

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = ''
  for (let i = at; i < at + len && i < b.length; i++) s += String.fromCharCode(b[i]!)
  return s
}

/** ISO BMFF brands that mean AVIF (still or sequence). */
const AVIF_BRANDS = new Set(['avif', 'avis'])

export function detectImage(head: Uint8Array): ImageKind | null {
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 3) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a) return 'png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg'
  if (head.length >= 6 && (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a')) return 'gif'
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp'
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {
    const size = (head[0]! << 24 | head[1]! << 16 | head[2]! << 8 | head[3]!) >>> 0
    const end = Math.min(head.length, Math.max(16, size))
    if (AVIF_BRANDS.has(ascii(head, 8, 4))) return 'avif'
    for (let at = 16; at + 4 <= end; at += 4) if (AVIF_BRANDS.has(ascii(head, at, 4))) return 'avif'
    return null
  }
  if (looksLikeSvg(head)) return 'svg'
  return null
}

/** SVG is text: skip a BOM, XML declaration, comments and a doctype; the first element must be `<svg`. */
export function looksLikeSvg(head: Uint8Array): boolean {
  let text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, Math.min(head.length, 4096)))
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let rest = text.trimStart()
  for (let guard = 0; guard < 32; guard++) {
    if (rest.startsWith('<?')) { const e = rest.indexOf('?>'); if (e < 0) return false; rest = rest.slice(e + 2).trimStart(); continue }
    if (rest.startsWith('<!--')) { const e = rest.indexOf('-->'); if (e < 0) return false; rest = rest.slice(e + 3).trimStart(); continue }
    if (/^<!doctype/i.test(rest)) { const e = rest.indexOf('>'); if (e < 0) return false; rest = rest.slice(e + 1).trimStart(); continue }
    break
  }
  return /^<svg[\s>/]/i.test(rest) || /^<[a-z][\w.-]*:svg[\s>/]/i.test(rest)
}
