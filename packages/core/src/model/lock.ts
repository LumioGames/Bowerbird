import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Re-entrant async mutex for one library: every write (service, scanner reconcile, pipeline deps) runs inside it,
 * so the index and the folder never see interleaved half-done writes.
 *
 * Re-entrancy is by token: each holder gets a fresh token object kept in AsyncLocalStorage, and a nested `run`
 * passes straight through only while that token is the current holder. Async work forked inside a write (timers,
 * setImmediate, promises left running) inherits the token, but once the write releases the lock the token is dead and
 * such work queues like any other caller. Work started through `detached()` carries no token at all.
 */
export class Lock {
  private tail: Promise<void> = Promise.resolve()
  private holder: object | null = null
  private readonly als = new AsyncLocalStorage<object>()

  /** Whether the current async context holds the lock. */
  get held(): boolean { const t = this.als.getStore(); return !!t && t === this.holder }

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.held) return fn()
    const prev = this.tail
    let release!: () => void
    this.tail = new Promise<void>(r => { release = r })
    return prev.then(() => {
      const token = {}
      this.holder = token
      return this.als.run(token, fn)
    }).finally(() => {
      this.holder = null
      release()
    })
  }

  /** Run `fn` outside any lock context (for work that is handed to other modules and runs later). */
  detached<T>(fn: () => T): T { return this.als.exit(fn) }
}
