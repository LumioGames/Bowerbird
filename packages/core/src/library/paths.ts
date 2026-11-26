import path from 'node:path'
import { CoreError } from '../contracts.js'

/**
 * Normalize a library-relative path to POSIX form without leading/trailing slashes.
 * Rejects absolute paths and `..` segments (a path may never escape the library root).
 */
export function normRel(p: string | undefined | null): string {
  if (p == null) return ''
  let s = String(p).replace(/\\/g, '/').trim()
  s = s.replace(/\/+/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  if (s === '.' || s === '') return ''
  const parts = s.split('/')
  for (const part of parts) {
    if (part === '..' || part === '.' || part === '') throw new CoreError('validation_failed', `路径不合法：${p}`, { path: p })
  }
  if (/^[a-zA-Z]:/.test(s)) throw new CoreError('validation_failed', `路径不合法：${p}`, { path: p })
  return s
}

/**
 * A slot name (or any path written out under a slot name) must be relative: no leading `/`, no drive letter,
 * no `..` segment, `/` as the only separator (ADR-048).
 */
export function isSafeRelPath(s: unknown): s is string {
  if (typeof s !== 'string' || !s || s.includes('\\') || s.includes('\0')) return false
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return false
  return !s.split('/').some(seg => seg === '..')
}

/** Validate a single file or folder name (no separators). */
export function checkName(name: string): string {
  const n = name.trim()
  if (!n || n === '.' || n === '..' || /[\\/]/.test(n) || n.includes('\0')) {
    throw new CoreError('validation_failed', `名称不合法：${name}`, { name })
  }
  return n
}

/** Whether `child` is `parent` itself or inside it ('' = root contains everything). */
export function isUnder(child: string, parent: string): boolean {
  if (parent === '') return true
  return child === parent || child.startsWith(parent + '/')
}

/** Absolute → library-relative POSIX (null when outside the root). */
export function relOf(root: string, abs: string): string | null {
  const r = path.relative(root, abs)
  if (r.startsWith('..') || path.isAbsolute(r)) return null
  return r.split(path.sep).join('/')
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.fbx': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.pdf': 'application/pdf'
}

export function mimeOf(name: string): string {
  const i = name.lastIndexOf('.')
  const ext = i > 0 ? name.slice(i).toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}
