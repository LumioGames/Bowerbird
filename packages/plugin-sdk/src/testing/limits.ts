/**
 * Time limits for tests that feed plugins hostile input (malformed, truncated, oversized, pathological text).
 * `runWithin` interrupts synchronous code — including a backtracking regular expression — through a `vm`
 * timeout; `settleWithin` bounds a promise (it cannot interrupt code that blocks the event loop).
 */
import vm from 'node:vm'

export class TimeLimitError extends Error {
  constructor(ms: number, what = 'call') { super(`${what} did not finish within ${ms} ms`); this.name = 'TimeLimitError' }
}

/** Run a synchronous function, aborting it after `ms` milliseconds. */
export function runWithin<T>(ms: number, fn: () => T, what?: string): T {
  try {
    return vm.runInNewContext('f()', { f: fn }, { timeout: ms }) as T
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new TimeLimitError(ms, what)
    throw e
  }
}

export type Settled<T> = { ok: true; value: T; ms: number } | { ok: false; error: unknown; ms: number }

/** Await a promise for at most `ms`; resolves with the value or the rejection, rejects with TimeLimitError on timeout. */
export async function settleWithin<T>(ms: number, run: () => Promise<T>, what?: string): Promise<Settled<T>> {
  const t0 = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeLimitError(ms, what)), ms) })
  try {
    const value = await Promise.race([run(), limit])
    return { ok: true, value, ms: performance.now() - t0 }
  } catch (error) {
    if (error instanceof TimeLimitError) throw error
    return { ok: false, error, ms: performance.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}
