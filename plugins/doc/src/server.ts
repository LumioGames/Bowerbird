/**
 * bowerbird.doc — server part (builtin-plugins.md「文档」): Markdown, HTML (single files and bundles with an
 * `index.html`), TXT and JSON. Probe gives `title` (first heading or file name), `words`, `lines`, the full text
 * for search, the opening lines for text grid cells, and — from Markdown front matter `size:` — the design
 * object's target size `targetWidth / targetHeight / targetDepth` in metres. No image thumbnails (`none`).
 * Uses only @bowerbird/plugin-sdk and @bowerbird/schema (engineering.md hard rule 2).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseTargetSize } from '@bowerbird/schema'
import { defineServerPlugin, type AssetFile, type FileRef, type FormatHandler, type ProbeResult } from '@bowerbird/plugin-sdk'
import {
  countLines, countWords, decodeText, excerptOf, kindOfName, looksLikeText, markdownImageRefs, openingLines,
  parseFrontMatter, plainText, titleOf, type DocKind
} from './shared/text.js'

export const FORMAT_ID = 'doc'
/** Searchable text kept per document (the index does not need whole novels). */
export const MAX_TEXT = 512 * 1024
/** Bundle entry files, in order of preference (ADR-043: bundles run from `index.html`). */
export const BUNDLE_ENTRIES = ['index.html', 'index.htm']
/** Bytes of a document read for probe and summary; larger files are read up to here (`tech.truncated`). */
export const MAX_READ = 8 * 1024 * 1024

/**
 * Absolute path of the bundle's entry file: a regular file, or a link that resolves to one inside the bundle
 * (lstat first — a link pointing outside the folder is refused).
 */
export async function bundleEntry(dir: string): Promise<string | null> {
  let root: string
  try { root = await fs.realpath(dir) } catch { return null }
  for (const e of BUNDLE_ENTRIES) {
    const p = path.join(dir, e)
    try {
      const st = await fs.lstat(p)
      if (st.isFile()) return p
      if (!st.isSymbolicLink()) continue
      const real = await fs.realpath(p)
      const rel = path.relative(root, real)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
      if ((await fs.stat(real)).isFile()) return real
    } catch { /* next */ }
  }
  return null
}

/** The first `MAX_READ` bytes of a file, and whether there was more. */
async function readCapped(file: string): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const fh = await fs.open(file, 'r')
  try {
    const size = (await fh.stat()).size
    const n = Math.min(size, MAX_READ)
    const bytes = new Uint8Array(n)
    let off = 0
    while (off < n) { const { bytesRead } = await fh.read(bytes, off, n - off, off); if (!bytesRead) break; off += bytesRead }
    return { bytes: bytes.subarray(0, off), truncated: size > MAX_READ }
  } finally {
    await fh.close()
  }
}

interface Loaded { kind: DocKind; src: string; name: string; truncated: boolean }

async function load(asset: AssetFile): Promise<Loaded> {
  if (asset.bundle) {
    const entry = await bundleEntry(asset.absPath)
    if (!entry) throw new Error(`${asset.name} has no index.html inside the bundle`)
    const { bytes, truncated } = await readCapped(entry)
    return { kind: 'html', src: decodeText(bytes), name: asset.name, truncated }
  }
  const kind = kindOfName(asset.name)
  if (!kind) throw new Error(`${asset.name} is not a document this plugin reads`)
  const { bytes, truncated } = await readCapped(asset.absPath)
  return { kind, src: decodeText(bytes), name: asset.name, truncated }
}

/** Target size from Markdown front matter `size: 1.26 × 0.95 × 0.87 m` (宽 × 高 × 深, ADR-020). */
export function targetSizeOf(kind: DocKind, src: string): { w: number; h: number; d: number } | null {
  if (kind !== 'markdown') return null
  const f = parseFrontMatter(src).fields.find(x => x.key === 'size')
  return f ? parseTargetSize(f.value) : null
}

/**
 * Searchable text with the opening lines first and the title last: the kernel shows the start of `text` as the
 * text cell's excerpt under the title (`cell_excerpt`), so the title must not open it — it stays searchable.
 */
export function searchText(plain: string, title: string): string {
  const lines = plain.split('\n')
  while (lines.length && !lines[0]!.trim()) lines.shift()
  if (lines[0]?.trim() === title) lines.shift()
  const body = lines.join('\n').trim()
  return body.includes(title) ? body : body ? `${body}\n${title}` : title
}

export function probeText(kind: DocKind, src: string, name: string, truncated = false): ProbeResult {
  const title = titleOf(kind, src, name)
  const text = plainText(kind, src)
  const tech: ProbeResult['tech'] = { title, words: countWords(text), lines: countLines(src) }
  const size = targetSizeOf(kind, src)
  if (size) { tech.targetWidth = size.w; tech.targetHeight = size.h; tech.targetDepth = size.d }
  // JSON: parsed once, only to say whether it is valid (a cut-off file cannot be judged).
  if (kind === 'json' && !truncated) {
    try { JSON.parse(src); tech.valid = true } catch { tech.valid = false }
  }
  if (truncated) tech.truncated = true
  const result: ProbeResult = {
    tech,
    // TXT / JSON titles are the file name, which the index already has.
    text: (kind === 'markdown' || kind === 'html' ? searchText(text, title) : text).slice(0, MAX_TEXT),
    // The grid cell shows the title and the opening lines (AssetSummary.cellText).
    analysis: { title, excerpt: excerptOf(kind, src, title), kind }
  }
  if (kind === 'markdown') {
    const refs = markdownImageRefs(src)
    if (refs.length) result.references = refs
  }
  return result
}

export function summaryText(kind: DocKind, src: string, name: string): string {
  const title = titleOf(kind, src, name)
  const lines = [`标题：${title}`]
  const size = targetSizeOf(kind, src)
  if (size) lines.push(`目标尺寸：${size.w} × ${size.h} × ${size.d} m（宽 × 高 × 深）`)
  const body = openingLines(kind, src, title, 10)
  if (body.length) lines.push('', ...body)
  return lines.join('\n')
}

export const docFormat: FormatHandler = {
  id: FORMAT_ID,

  async match(file: FileRef) {
    if (file.bundle) return (await bundleEntry(file.absPath)) ? { format: FORMAT_ID, confidence: 0.9 } : null
    if (!kindOfName(file.name)) return null
    return looksLikeText(file.head) ? { format: FORMAT_ID, confidence: 1 } : null
  },

  async probe(asset) {
    const { kind, src, name, truncated } = await load(asset)
    return probeText(kind, src, name, truncated)
  },

  async summarize(asset) {
    const { kind, src, name } = await load(asset)
    return { text: summaryText(kind, src, name) }
  }
}

export default defineServerPlugin({
  activate(ctx) {
    ctx.register.format(docFormat)
  }
})
