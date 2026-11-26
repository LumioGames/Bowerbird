import { createApiClient, BowerbirdApiError } from '@bowerbird/schema'
import { currentActor } from './actor'
import { getLocale, t } from './i18n'

/**
 * The shell talks only to the public HTTP API, same as agents (ADR-011).
 * `setApiFetch` swaps the transport (development fixtures, tests); production never calls it.
 */
let transport: typeof fetch | null = null
export function setApiFetch(f: typeof fetch | null): void { transport = f }
/** A stand-in transport is installed (development fixtures, tests): XHR uploads go through it instead. */
export function hasApiTransport(): boolean { return transport != null }
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return (transport ?? globalThis.fetch.bind(globalThis))(input, init)
}

export const api = createApiClient({ baseUrl: '', actor: currentActor, fetch: apiFetch as typeof fetch })
export type { ApiClient } from '@bowerbird/schema'
export { BowerbirdApiError }

/**
 * The server writes its messages in Chinese. In Chinese they are shown as they are; other languages get one sentence
 * per error code (`err.code.<code>`, ADR-061), or the server's text when there is none.
 */
export function serverMessage(e: BowerbirdApiError): string {
  if (getLocale() === 'zh-CN') return e.message
  const key = `err.code.${e.code}`
  const s = t(key)
  return s === key ? e.message : s
}

/** A user-facing sentence for a failed request (network → the offline sentence). */
export function errorText(e: unknown): string {
  if (e instanceof BowerbirdApiError) return e.code === 'network' ? t('err.network') : serverMessage(e)
  return e instanceof Error ? e.message : String(e)
}
