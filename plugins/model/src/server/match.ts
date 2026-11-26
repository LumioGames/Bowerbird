/**
 * Which files this plugin claims. Models by their header; `.bin` only when a glTF next to it (or up to two folders
 * above it, never above the library root) names it as a buffer — a `.bin` is otherwise just bytes, and claiming
 * every one would hide unrelated files as「附属文件」. glTF files are read only up to a size limit, and what they
 * name is remembered per file (by size and modification time), so a folder of `.bin` files is cheap.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileRef, MatchResult } from '@bowerbird/plugin-sdk'
import { isGlb, looksLikeGltfJson } from '../shared/gltf.js'
import { isAsciiFbx, isBinaryFbx } from '../shared/fbx.js'
import { uriSlot } from '../shared/slots.js'

export function matchModel(file: FileRef): MatchResult | null {
  if (file.bundle) return null
  const ext = file.ext.toLowerCase()
  if (ext === '.glb') return isGlb(file.head) ? { format: 'model', confidence: 1 } : null
  if (ext === '.gltf') return looksLikeGltfJson(file.head) ? { format: 'model', confidence: 1 } : null
  if (ext === '.fbx') return isBinaryFbx(file.head) || isAsciiFbx(file.head) ? { format: 'model', confidence: 1 } : null
  return null
}

/** Levels of parent folders searched for a glTF that names the `.bin`. */
const UP_LEVELS = 2
/** glTF documents larger than this are not read to look for buffer names. */
export const MAX_GLTF_SCAN_BYTES = 16 * 1024 * 1024
const CACHE_SIZE = 512

/** Buffer URIs of a glTF file, by path, valid while its size and modification time stay the same. */
const named = new Map<string, { size: number; mtimeMs: number; uris: string[] }>()

async function bufferUris(gltfPath: string): Promise<string[]> {
  let st
  try { st = await fs.stat(gltfPath) } catch { return [] }
  if (!st.isFile() || st.size > MAX_GLTF_SCAN_BYTES) return []
  const hit = named.get(gltfPath)
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
    named.delete(gltfPath); named.set(gltfPath, hit)
    return hit.uris
  }
  let uris: string[] = []
  try {
    const json = JSON.parse(await fs.readFile(gltfPath, 'utf8'))
    const buffers = Array.isArray(json?.buffers) ? json.buffers : []
    uris = buffers.map((b: { uri?: unknown }) => (typeof b?.uri === 'string' ? uriSlot(b.uri) : null)).filter((u: string | null): u is string => !!u)
  } catch { /* not readable / not JSON: names nothing */ }
  named.set(gltfPath, { size: st.size, mtimeMs: st.mtimeMs, uris })
  while (named.size > CACHE_SIZE) named.delete(named.keys().next().value as string)
  return uris
}

/** The library root a FileRef lives in: its absolute path minus its library-relative path. */
export function libraryRootOf(file: FileRef): string {
  const abs = path.resolve(file.absPath)
  const rel = path.normalize(file.path).replace(/^[/\\]+/, '')
  if (rel && abs.endsWith(path.sep + rel)) return abs.slice(0, abs.length - rel.length - 1) || path.sep
  return path.dirname(abs)
}

function inside(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
}

export async function matchBuffer(file: FileRef): Promise<MatchResult | null> {
  if (file.bundle || file.ext.toLowerCase() !== '.bin') return null
  const target = path.resolve(file.absPath)
  const root = libraryRootOf(file)
  let dir = path.dirname(target)
  for (let level = 0; level <= UP_LEVELS && inside(dir, root); level++) {
    let names: string[] = []
    try { names = await fs.readdir(dir) } catch { break }
    for (const n of names) {
      if (!n.toLowerCase().endsWith('.gltf')) continue
      for (const uri of await bufferUris(path.join(dir, n))) {
        const resolved = path.resolve(dir, uri)
        if (resolved === target && inside(path.dirname(resolved), root)) return { format: 'gltf-buffer', confidence: 1 }
      }
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}
