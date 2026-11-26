/**
 * Error model (api-and-agent.md「错误模型」): `{ error: { code, message, details? } }`.
 * CoreError codes map to the HTTP status of ERROR_CODES; anything unexpected is `internal` and logged.
 */
import { ERROR_CODES, type ErrorCode } from '@bowerbird/schema'

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface ErrorBody { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } }

/** Duck-typed so a CoreError from another module instance still maps (bundled CLI, tests). */
export function isCoreError(e: unknown): e is Error & { code: ErrorCode; details?: Record<string, unknown> } {
  return e instanceof Error && e.name === 'CoreError' && typeof (e as { code?: unknown }).code === 'string'
    && Object.prototype.hasOwnProperty.call(ERROR_CODES, (e as unknown as { code: string }).code)
}

export function toHttpError(e: unknown): { status: number; body: ErrorBody; unexpected: boolean } {
  if (e instanceof HttpError) return { status: e.status, body: body(e.code, e.message, e.details), unexpected: false }
  if (isCoreError(e)) return { status: ERROR_CODES[e.code], body: body(e.code, e.message, e.details), unexpected: e.code === 'internal' }
  const fe = e as { statusCode?: number; code?: string; message?: string; validation?: unknown }
  if (typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    if (fe.statusCode === 404) return { status: 404, body: body('not_found', '找不到这个地址'), unexpected: false }
    return { status: 400, body: body('validation_failed', `请求内容不合法：${fe.message ?? ''}`.trim(), fe.code ? { reason: fe.code } : undefined), unexpected: false }
  }
  return { status: 500, body: body('internal', '服务内部错误，详情见运行日志'), unexpected: true }
}

function body(code: ErrorCode, message: string, details?: Record<string, unknown>): ErrorBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } }
}

/** Validate with a schema from @bowerbird/schema; failures become `validation_failed` (400). */
export interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } }
}

export function parse<T>(schema: SafeParser<T>, value: unknown, where = 'body'): T {
  const r = schema.safeParse(value)
  if (r.success) return r.data
  const issues = r.error.issues.map(i => ({ path: [where, ...i.path.map(String)].join('.'), message: i.message }))
  const firstIssue = issues[0]
  throw new HttpError(400, 'validation_failed', `请求内容不合法：${firstIssue ? `${firstIssue.path} ${firstIssue.message}` : where}`, { issues })
}

export function notFound(message = '找不到这个资源'): HttpError { return new HttpError(404, 'not_found', message) }

/**
 * Keep only what the client sent. `LibrarySettings.partial()` and `MachineConfig.partial()` still apply their
 * defaults in zod 4, so a patch `{ port: 7421 }` would otherwise come out with `libraries: []` and wipe the config.
 */
export function onlyGiven<T>(parsed: T, raw: unknown): T {
  if (!isPlain(parsed) || !isPlain(raw)) return parsed
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed)) if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = onlyGiven(v, raw[k])
  return out as T
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
