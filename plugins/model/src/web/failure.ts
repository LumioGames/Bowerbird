/**
 * What to say when a model cannot be shown or rendered, in the shell's language, and whether trying again can
 * help. The viewer shows `describeFailure`; the render worker gets `toRenderFailure` thrown at it (the shell's
 * convention: an error with `message` and `retryable`, submitted as `RenderResultFields.error` / `retryable`).
 * Only a failed fetch is retryable: a file that does not decode, a Draco mesh, or a browser without WebGL give the
 * same answer next time, so the pipeline must not retry them forever.
 */
import { ModelLoadError } from './three/load'
import type { T } from './i18n'

/** The browser has no usable WebGL (disabled, blocked, or no GPU). */
export class NoWebGLError extends Error {
  readonly retryable = false
  constructor() { super('WebGL is not available'); this.name = 'NoWebGLError' }
}

/** `raw`: the detail is the loader's own message (shown in monospace), not one of ours. */
export interface FailureText { title: string; detail: string | null; raw?: boolean }

export function describeFailure(e: unknown, tr: T): FailureText {
  if (e instanceof NoWebGLError) return { title: tr('noWebgl'), detail: tr('noWebglHint') }
  if (e instanceof ModelLoadError) {
    switch (e.reason) {
      case 'draco': return { title: tr('draco'), detail: null }
      case 'ktx2': return { title: tr('ktx2'), detail: null }
      case 'missing': return { title: tr('loadFailed'), detail: tr('missingNote', { name: e.names.join(tr('listSep')) }) }
      case 'fbxArrays': return { title: tr('decodeFailed'), detail: tr('fbxArrays') }
      case 'notModel': return { title: tr('decodeFailed'), detail: tr('notModel', { name: e.names[0] ?? '' }) }
      case 'network': return { title: tr('loadFailed'), detail: e.message || null, raw: true }
      default: return { title: e.kind === 'unsupported' ? tr('unsupportedModel') : tr('decodeFailed'), detail: e.message || null, raw: true }
    }
  }
  return { title: tr('decodeFailed'), detail: (e as Error)?.message ?? String(e), raw: true }
}

/** The error the render worker receives: one sentence (title, then detail) and whether to retry. */
export class RenderFailure extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); this.name = 'RenderFailure' }
}

export function toRenderFailure(e: unknown, tr: T): RenderFailure {
  const { title, detail } = describeFailure(e, tr)
  const retryable = e instanceof NoWebGLError ? false : e instanceof ModelLoadError ? e.retryable : true
  const message = e instanceof ModelLoadError || e instanceof NoWebGLError ? (detail ? `${title}: ${detail}` : title) : (detail ?? title)
  return new RenderFailure(message, retryable)
}
