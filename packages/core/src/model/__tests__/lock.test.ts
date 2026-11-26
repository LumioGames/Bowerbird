import { describe, expect, it } from 'vitest'
import { Lock } from '../lock.js'

const tick = () => new Promise<void>(r => setImmediate(r))

describe('library lock', () => {
  it('lets nested calls of the same write through and serializes others', async () => {
    const lock = new Lock()
    const order: string[] = []
    const a = lock.run(async () => {
      order.push('a1')
      await lock.run(async () => { order.push('a-nested') })
      await tick()
      order.push('a2')
    })
    const b = lock.run(async () => { order.push('b') })
    await Promise.all([a, b])
    expect(order).toEqual(['a1', 'a-nested', 'a2', 'b'])
  })

  it('a task forked inside a write that calls run after the write ended must queue (no inherited pass)', async () => {
    const lock = new Lock()
    const order: string[] = []
    let forked!: Promise<void>
    let release!: () => void
    const blocker = new Promise<void>(r => { release = r })
    await lock.run(async () => {
      // e.g. enqueue → setImmediate → pipeline job → deps write
      forked = new Promise<void>(resolve => setTimeout(() => {
        void lock.run(async () => { order.push('forked') }).then(resolve)
      }, 5))
    })
    // another write takes the lock before the forked task runs
    const other = lock.run(async () => { order.push('other-start'); await blocker; order.push('other-end') })
    await new Promise(r => setTimeout(r, 20))
    expect(order).toEqual(['other-start'])
    release()
    await Promise.all([other, forked])
    expect(order).toEqual(['other-start', 'other-end', 'forked'])
  })

  it('detached work never counts as holding the lock, even while the write is still running', async () => {
    const lock = new Lock()
    const order: string[] = []
    let inner!: Promise<void>
    await lock.run(async () => {
      lock.detached(() => { inner = lock.run(async () => { order.push('detached') }) })
      await tick()
      await tick()
      order.push('write-end')
    })
    await inner
    expect(order).toEqual(['write-end', 'detached'])
  })
})
