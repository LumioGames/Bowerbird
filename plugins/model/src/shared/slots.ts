/**
 * Slot names (ADR-018): the names written inside a model file — external texture URIs, `.bin` names and the
 * names of images packed in the file — are only "a place called X". Which asset fills it is recorded in the
 * .bmeta. The server probe and the browser loader must spell a slot exactly the same way, so both use these.
 * Pure: no Node or DOM APIs.
 */

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/ktx2': '.ktx2',
  'image/avif': '.avif',
  'image/gif': '.gif'
}

function hasExt(name: string): boolean { return /\.[a-z0-9]{2,5}$/i.test(name) }

function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

/** Slot name of an external URI written in a glTF (`textures/a%20b.png` → `textures/a b.png`); null for data URIs. */
export function uriSlot(uri: string | undefined | null): string | null {
  if (!uri) return null
  if (/^data:/i.test(uri) || /^blob:/i.test(uri)) return null
  let s = safeDecode(uri.trim())
  while (s.startsWith('./')) s = s.slice(2)
  return s || null
}

/**
 * Slot name of an image packed in a GLB / glTF bufferView: its `name` from the file, with the extension of its
 * MIME type added when the name has none (Blender writes `chest_basecolor` for `chest_basecolor.png`).
 * Unnamed packed images have no name in the file, so they have no slot.
 */
export function embeddedImageSlot(image: { name?: unknown; mimeType?: unknown }): string | null {
  const name = typeof image.name === 'string' ? image.name.trim() : ''
  if (!name) return null
  if (hasExt(name)) return name
  const ext = typeof image.mimeType === 'string' ? MIME_EXT[image.mimeType.toLowerCase()] : undefined
  return ext ? name + ext : name
}

/** Last path segment, for both `/` and `\` (FBX files often carry absolute Windows paths). */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

/** Slot name of a texture file named in an FBX (`C:\art\hero_basecolor.png` → `hero_basecolor.png`). */
export function fbxSlot(fileName: string | undefined | null): string | null {
  if (!fileName) return null
  const b = baseName(fileName.trim())
  return b || null
}

/**
 * The names to try for a URL a loader asks for, most specific first: as written, without `./`, the base name.
 * The viewer looks each one up with `FileSource.slotUrl`.
 */
export function slotCandidates(requested: string): string[] {
  const out: string[] = []
  const add = (s: string | null) => { if (s && !out.includes(s)) out.push(s) }
  const s = uriSlot(requested)
  add(s)
  if (s) add(baseName(s))
  return out
}

/** Image-like extension (a missing texture is replaced by a checker instead of failing the whole model). */
export function isImageName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif|bmp|tga|ktx2|dds|tiff?|exr|hdr)$/i.test(name)
}
