import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

/** Streaming SHA-256 of one file → `sha256:<hex>`. */
export async function hashFile(abs: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(fs.createReadStream(abs), h)
  return 'sha256:' + h.digest('hex')
}

export function hashBytes(data: Uint8Array | string): string {
  return 'sha256:' + createHash('sha256').update(data).digest('hex')
}

export interface BundleEntry { rel: string; abs: string; size: number; mtimeMs: number }

/**
 * Files inside a bundle folder (recursively), skipping entries the ignore check rejects
 * (dot files, Thumbs.db … so OS junk never changes the fingerprint). `rel` is relative to the bundle root.
 */
export async function bundleEntries(absDir: string, skip: (rel: string, isDir: boolean) => boolean): Promise<BundleEntry[]> {
  const out: BundleEntry[] = []
  async function walk(dir: string, prefix: string): Promise<void> {
    let ents: fs.Dirent[]
    try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (skip(rel, true)) continue
        await walk(abs, rel)
      } else if (e.isFile()) {
        if (skip(rel, false)) continue
        const st = await fsp.stat(abs)
        out.push({ rel, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) })
      }
    }
  }
  await walk(absDir, '')
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

/** Directory fingerprint: sha256 over sorted `relativePath + ' ' + fileHash` lines (data-model.md「身份与内容指纹」). */
export async function hashBundle(absDir: string, skip: (rel: string, isDir: boolean) => boolean): Promise<string> {
  const entries = await bundleEntries(absDir, skip)
  const lines: string[] = []
  for (const e of entries) lines.push(`${e.rel} ${await hashFile(e.abs)}`)
  return hashBytes(lines.join('\n'))
}

/** Aggregate stat of a bundle: total size, newest mtime (scan shortcut). */
export async function bundleStat(absDir: string, skip: (rel: string, isDir: boolean) => boolean): Promise<{ size: number; mtimeMs: number; files: number }> {
  const entries = await bundleEntries(absDir, skip)
  let size = 0
  let mtimeMs = 0
  for (const e of entries) { size += e.size; if (e.mtimeMs > mtimeMs) mtimeMs = e.mtimeMs }
  return { size, mtimeMs, files: entries.length }
}
