import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScanFindings, createScanSummary, noteOwnScan } from './scan-findings'

describe('「扫描完成 · 新增 {n} 个 · 发现 {m} 条问题」(ADR-040)', () => {
  const run = (s: ReturnType<typeof createScanSummary>, events: Array<[string, unknown]>) => {
    s.handle('scan.progress', { running: true })
    for (const [t, d] of events) s.handle(t as never, d)
    s.handle('scan.progress', { running: false })
  }

  it('counts what arrived during the scan and reports at its end', () => {
    const show = vi.fn()
    const s = createScanSummary({ show })
    s.handle('asset.created', { id: 'before' })
    run(s, [['asset.created', { id: 'a' }], ['asset.created', { id: 'b' }], ['issue.created', { id: 'i', type: 'missing-file' }], ['asset.updated', {}]])
    expect(show).toHaveBeenCalledWith({ added: 2, issues: 1, own: false })
  })

  it('a background scan that changed nothing says nothing; one this browser asked for always answers', () => {
    const show = vi.fn()
    let t = 1000
    const s = createScanSummary({ show, now: () => t })
    run(s, [])
    expect(show).not.toHaveBeenCalled()
    noteOwnScan(t)
    t += 200
    run(s, [])
    expect(show).toHaveBeenCalledWith({ added: 0, issues: 0, own: true })
  })

  it('registering a first-opened folder stays quiet (it has its own panel)', () => {
    const show = vi.fn()
    const s = createScanSummary({ show, quiet: () => true })
    run(s, [['asset.created', { id: 'a' }]])
    expect(show).not.toHaveBeenCalled()
  })
})

afterEach(() => { vi.useRealTimers() })

const missing = (assetId: string) => ({ id: `missing-file:${assetId}`, type: 'missing-file', assetId })

describe('「扫描发现 {名称} 不见了」(copy.md 完整性)', () => {
  it('a missing-file issue from a scan shows one toast with the asset name', async () => {
    vi.useFakeTimers()
    const show = vi.fn()
    const f = createScanFindings({ nameOf: id => (id === 'a' ? 'chest_normal.png' : null), show, delayMs: 100 })
    f.handle('issue.created', missing('a'))
    expect(show).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(show).toHaveBeenCalledWith(['chest_normal.png'])
  })

  it('findings of one scan share a toast; other issue types and repeats do not count', async () => {
    vi.useFakeTimers()
    const show = vi.fn()
    const f = createScanFindings({ nameOf: async id => `${id}.png`, show, delayMs: 100 })
    f.handle('issue.created', missing('a'))
    f.handle('issue.created', { id: 'broken-reference:x', type: 'broken-reference', assetId: 'x' })
    f.handle('asset.updated', { id: 'b', fields: ['missing'] })
    f.handle('issue.created', missing('b'))
    f.handle('issue.created', missing('a'))
    await vi.advanceTimersByTimeAsync(100)
    expect(show).toHaveBeenCalledOnce()
    expect(show).toHaveBeenCalledWith(['a.png', 'b.png'])
  })

  it('the same file going missing again after it was resolved is reported again; an unknown name is skipped', async () => {
    vi.useFakeTimers()
    const show = vi.fn()
    const f = createScanFindings({ nameOf: id => (id === 'gone' ? Promise.reject(new Error('404')) : 'a.png'), show, delayMs: 10 })
    f.handle('issue.created', missing('a'))
    await vi.advanceTimersByTimeAsync(10)
    f.handle('issue.resolved', missing('a'))
    f.handle('issue.created', missing('a'))
    f.handle('issue.created', missing('gone'))
    await vi.advanceTimersByTimeAsync(10)
    expect(show.mock.calls).toEqual([[['a.png']], [['a.png']]])
    f.dispose()
  })
})
