/**
 * Multipart intake: file parts stream to the machine-local temp dir (`~/.bowerbird/tmp/uploads/`) and are handed
 * to the kernel as `tmpPath`; text parts (e.g. `meta` JSON) are collected. Leftover temp files are removed after
 * the request, whatever the kernel did with them.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { FastifyRequest } from 'fastify'
import { HttpError } from './errors.js'

export interface UploadedFile { field: string; filename: string; mimetype: string; tmpPath: string; size: number }

export interface MultipartBody {
  fields: Record<string, string>
  files: UploadedFile[]
  file(field: string): UploadedFile | undefined
  /** Read a file part fully (small parts: thumbnails, render results). */
  bytes(field: string): Promise<Uint8Array | undefined>
  cleanup(): Promise<void>
}

function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\-一-鿿]/g, '_').slice(-80) || 'file'
}

export function isMultipart(request: FastifyRequest): boolean {
  return /^multipart\/form-data/i.test(request.headers['content-type'] ?? '')
}

export async function readMultipart(request: FastifyRequest, tmpRoot: string): Promise<MultipartBody> {
  if (!isMultipart(request)) throw new HttpError(400, 'validation_failed', '请求内容不合法：需要 multipart/form-data')
  const dir = path.join(tmpRoot, 'uploads')
  await fs.promises.mkdir(dir, { recursive: true })
  const fields: Record<string, string> = {}
  const files: UploadedFile[] = []
  const cleanup = async () => {
    await Promise.all(files.map(f => fs.promises.rm(f.tmpPath, { force: true }).catch(() => undefined)))
  }
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const tmpPath = path.join(dir, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName(part.filename)}`)
        const entry: UploadedFile = { field: part.fieldname, filename: part.filename || part.fieldname, mimetype: part.mimetype, tmpPath, size: 0 }
        files.push(entry)
        await pipeline(part.file, fs.createWriteStream(tmpPath))
        if (part.file.truncated) throw new HttpError(400, 'validation_failed', '上传的文件太大')
        entry.size = (await fs.promises.stat(tmpPath)).size
        // A JSON part sent as a Blob (some clients) counts as a field.
        if (part.fieldname === 'meta' && !(part.fieldname in fields)) {
          fields.meta = await fs.promises.readFile(tmpPath, 'utf8')
        }
      } else {
        fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value)
      }
    }
  } catch (e) {
    await cleanup()
    throw e
  }
  return {
    fields,
    files,
    file: field => files.find(f => f.field === field),
    async bytes(field) {
      const f = files.find(x => x.field === field)
      return f ? new Uint8Array(await fs.promises.readFile(f.tmpPath)) : undefined
    },
    cleanup
  }
}

/** Parse a JSON text field; absent = `{}`. */
export function jsonField(fields: Record<string, string>, name: string): unknown {
  const raw = fields[name]
  if (raw === undefined || raw.trim() === '') return {}
  try { return JSON.parse(raw) } catch {
    throw new HttpError(400, 'validation_failed', `请求内容不合法：${name} 不是合法的 JSON`)
  }
}
