/**
 * File responses: single-range requests (video scrubbing, large models), inline vs attachment, and a sandbox
 * CSP on active content so an HTML/SVG asset opened directly can never run with the shell's origin (ADR-043).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { notFound } from './errors.js'

/** Returned by helpers that already sent the response (never return the thenable reply from inner async code). */
export const SENT: unique symbol = Symbol('sent')
export type Sent = typeof SENT

export interface FileInfo { absPath: string; size?: number; name: string; mime: string }

const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/i

/** `Content-Disposition` with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(name: string, attachment: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file'
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `${attachment ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/**
 * Parse a single `bytes=` range (RFC 9110 §14.1.2). null = ignore Range and send the whole file (absent, another
 * unit, several ranges, or invalid syntax such as `bytes=5-2`); 'unsatisfiable' = 416 (the range starts past the
 * end, or a zero-length suffix).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  if (a === '') {
    const suffix = Number(b)
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(a)
  if (b !== '' && Number(b) < start) return null // last-pos before first-pos: invalid, ignored
  if (start >= size) return 'unsatisfiable'
  return { start, end: b === '' ? size - 1 : Math.min(Number(b), size - 1) }
}

export function withCharset(mime: string): string {
  if (/charset=/i.test(mime)) return mime
  return /^(text\/|application\/(json|javascript|xml))/i.test(mime) ? `${mime}; charset=utf-8` : mime
}

export function securityHeaders(reply: FastifyReply, mime: string): void {
  reply.header('X-Content-Type-Options', 'nosniff')
  if (ACTIVE_TYPES.test(mime)) reply.header('Content-Security-Policy', 'sandbox allow-scripts')
}

export async function sendFile(
  request: FastifyRequest,
  reply: FastifyReply,
  file: FileInfo,
  opts: { download?: boolean; cacheControl?: string; referrerPolicy?: string } = {}
): Promise<Sent> {
  let st: fs.Stats
  try { st = await fs.promises.stat(file.absPath) } catch { throw notFound('文件不存在') }
  if (!st.isFile()) throw notFound('文件不存在')
  const size = st.size
  const range = parseRange(request.headers.range, size)
  reply.header('Accept-Ranges', 'bytes')
  if (range === 'unsatisfiable') {
    reply.header('Content-Range', `bytes */${size}`)
    reply.code(416).header('Content-Type', 'application/json; charset=utf-8')
      .send({ error: { code: 'range_not_satisfiable', message: '请求的范围超出了文件大小' } })
    return SENT
  }
  reply.header('Content-Type', withCharset(file.mime || 'application/octet-stream'))
  reply.header('Content-Disposition', contentDisposition(file.name || path.basename(file.absPath), !!opts.download))
  reply.header('Cache-Control', opts.cacheControl ?? 'no-cache')
  reply.header('Last-Modified', st.mtime.toUTCString())
  if (opts.referrerPolicy) reply.header('Referrer-Policy', opts.referrerPolicy)
  securityHeaders(reply, file.mime)
  if (range) {
    reply.code(206)
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    reply.header('Content-Length', String(range.end - range.start + 1))
    reply.send(fs.createReadStream(file.absPath, { start: range.start, end: range.end }))
    return SENT
  }
  reply.header('Content-Length', String(size))
  reply.send(size === 0 ? '' : fs.createReadStream(file.absPath))
  return SENT
}

/** A stream without a known size (old version content from a version plugin). */
export function sendStream(reply: FastifyReply, stream: Readable, file: { name: string; mime: string }, download: boolean): Sent {
  reply.header('Content-Type', withCharset(file.mime || 'application/octet-stream'))
  reply.header('Content-Disposition', contentDisposition(file.name, download))
  reply.header('Cache-Control', 'no-cache')
  securityHeaders(reply, file.mime)
  reply.send(stream)
  return SENT
}

const IMAGE_TYPES: Record<string, string> = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.json': 'application/json', '.bin': 'application/octet-stream'
}

/** Content type of a cached thumbnail variant by its extension. */
export function thumbnailMime(absPath: string): string {
  return IMAGE_TYPES[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream'
}

const WEB_TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json', '.json': 'application/json',
  '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream'
}

/** Files a plugin web build may ship next to its entry (chunks, source maps, styles, fonts, HDRIs). */
export function webAssetMime(file: string): string | null {
  return WEB_TYPES[path.extname(file).toLowerCase()] ?? null
}

/** Resolve `inner` under `dir`, refusing anything that escapes it. */
export function safeJoin(dir: string, inner: string): string | null {
  if (inner.includes('\0')) return null
  const segments = inner.split('/').filter(Boolean)
  if (segments.some(s => s === '..' || s === '.')) return null
  const full = path.resolve(dir, ...segments)
  const base = path.resolve(dir)
  return full === base || full.startsWith(base + path.sep) ? full : null
}
