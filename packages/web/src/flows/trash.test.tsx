import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DialogHost } from '../overlays/dialogs'
import { setApiFetch } from '../lib/api'
import { setRuntime } from '../shell/runtime'
import { clearUndo, undoLast } from '../lib/undo'
import { trashAssets } from './actions'

/**
 * 移入回收站 (P1-3): the confirmation only says「没有其他资产依赖它」when it knows; the deletion goes without force,
 * and what the server still finds referenced is asked about again before force is sent.
 */
beforeAll(() => { (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } })
afterEach(() => { cleanup(); setApiFetch(null); setRuntime(null) })

const A = '0192f3a4-7c1e-7b52-9d06-4e8a51c0d206'
const REF = '0192f3a4-7c1e-7b52-9d06-4e8a51c0d205'
const summary = (id: string, name: string) => ({
  id, name, path: `props/chest/${name}`, format: 'image', plugin: 'bowerbird.image', stage: 'runtime', review: 'approved', tags: [], autoTags: [],
  description: null, flags: [], thumbnail: null, thumbState: 'ready', aspect: 1, badge: null, issueLevel: null, issueCount: 0, size: 1,
  modified: '', created: '', createdBy: 'user:lin', bundle: false, auxiliary: false, memberCount: 0, cellText: null, missingPlugin: null
})
const detail = (incoming: unknown[]) => ({ ...summary(A, 'chest_basecolor.png'), relations: { outgoing: [], incoming } })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function setup(handle: (method: string, url: string) => Response) {
  const calls: string[] = []
  setApiFetch(async (input, init) => { const u = String(input); const m = init?.method ?? 'GET'; calls.push(`${m} ${u}`); return handle(m, u) })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setRuntime({ lib: 'L', info: undefined, qc, go: () => {}, navigate: (() => {}) as never, currentFolder: () => null })
  render(<QueryClientProvider client={qc}><DialogHost /></QueryClientProvider>)
  return { calls }
}

describe('移入回收站', () => {
  it('nothing depends on it (known): says so, deletes without force', async () => {
    const { calls } = setup((m, u) => (m === 'GET' ? json(200, detail([])) : json(200, { trashId: 't1', referrers: [] })))
    let done: Promise<void>
    await act(async () => { done = trashAssets([A]) })
    await screen.findByText('没有其他资产依赖它。回收站保留 7 天，期间可以恢复。')
    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await act(async () => { await done })
    const del = calls.filter(c => c.startsWith('DELETE'))
    expect(del).toHaveLength(1)
    expect(del[0]).not.toContain('force')
  })

  it('cannot read who depends on it: does not claim「没有依赖」; the server says referenced → asks again → force', async () => {
    const { calls } = setup((m, u) => {
      if (m === 'GET') return json(500, { error: { code: 'internal', message: '坏了' } })
      if (u.includes('force=true')) return json(200, { trashId: 't1', referrers: [REF] })
      return json(409, { error: { code: 'referenced', message: '该资产被 1 个资产引用', details: { referrers: [REF] } } })
    })
    let done: Promise<void>
    await act(async () => { done = trashAssets([A]) })
    const first = await screen.findByRole('alertdialog')
    expect(first.textContent).not.toContain('没有其他资产依赖它')
    expect(first.textContent).toContain('回收站保留 7 天')
    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await waitFor(() => expect(calls.filter(c => c.startsWith('DELETE'))).toHaveLength(1))
    // asked again before anything is forced
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    expect(calls.some(c => c.includes('force=true'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await act(async () => { await done })
    expect(calls.filter(c => c.startsWith('DELETE')).map(c => c.includes('force=true'))).toEqual([false, true])
  })

  it('folder (ADR-047): first without force; referenced → the question comes back with the referrers → force', async () => {
    const bodies: string[] = []
    setApiFetch(async (input, init) => {
      const u = String(input), m = init?.method ?? 'GET'
      if (m === 'DELETE' && u.endsWith('/folders')) {
        bodies.push(String(init?.body))
        return JSON.parse(String(init?.body)).force ? json(200, { trashed: 3, batch: 'b1' }) : json(409, { error: { code: 'referenced', message: 'x', details: { referrers: [REF] } } })
      }
      if (m === 'GET' && u.includes(REF)) return json(200, { ...summary(REF, 'chest.glb'), relations: { outgoing: [], incoming: [] } })
      return json(200, {})
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    setRuntime({ lib: 'L', info: undefined, qc, go: () => {}, navigate: (() => {}) as never, currentFolder: () => null })
    render(<QueryClientProvider client={qc}><DialogHost /></QueryClientProvider>)
    const { trashFolder } = await import('./folders')
    let done: Promise<void>
    await act(async () => { done = trashFolder({ path: 'props/potion', name: 'potion', count: 3, children: [] } as never) })
    expect((await screen.findByRole('alertdialog')).textContent).toContain('里面有 3 个资产')
    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await screen.findByText(/有 1 个资产依赖它/)
    expect(screen.getByText('chest.glb')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await act(async () => { await done })
    expect(bodies.map(b => !!JSON.parse(b).force)).toEqual([false, true])
  })

  it('撤销 restores without auto-rename; a place taken meanwhile is asked about (copy.md 恢复到被占用的位置)', async () => {
    clearUndo()
    const entry = { id: 't1', assetId: A, name: 'chest_basecolor.png', originalPath: 'props/chest/chest_basecolor.png', folder: 'props/chest', format: 'image', stage: 'runtime', review: 'approved', size: 1, thumbnail: null, deletedAt: '2026-11-26T00:00:00Z', deletedBy: 'user:lin', daysLeft: 7, referencedBy: 0, recordOnly: false }
    const bodies: string[] = []
    setApiFetch(async (input, init) => {
      const u = String(input), m = init?.method ?? 'GET'
      if (m === 'GET' && u.endsWith('/trash')) return json(200, { items: [entry], trashDays: 7 })
      if (m === 'GET') return json(200, detail([]))
      if (m === 'DELETE') return json(200, { trashId: 't1', referrers: [] })
      if (m === 'POST' && u.endsWith('/trash/t1/restore')) {
        bodies.push(String(init?.body))
        return JSON.parse(String(init?.body)).rename === false
          ? json(409, { error: { code: 'conflict', message: 'taken', details: { name: 'chest_basecolor_1.png' } } })
          : json(200, { asset: summary(A, 'chest_basecolor_1.png'), renamedTo: 'chest_basecolor_1.png' })
      }
      return json(200, {})
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    setRuntime({ lib: 'L', info: undefined, qc, go: () => {}, navigate: (() => {}) as never, currentFolder: () => null })
    render(<QueryClientProvider client={qc}><DialogHost /></QueryClientProvider>)
    let done: Promise<void>
    await act(async () => { done = trashAssets([A]) })
    fireEvent.click(await screen.findByRole('button', { name: '移入回收站' }))
    await act(async () => { await done })
    let undone: Promise<unknown>
    await act(async () => { undone = undoLast() })
    const ask = await screen.findByRole('alertdialog')
    expect(ask.textContent).toContain('恢复 chest_basecolor.png？')
    expect(ask.textContent).toContain('props/chest 里已经有一个同名文件。恢复后它会改名为 chest_basecolor_1.png，两个文件都保留。')
    fireEvent.click(screen.getByRole('button', { name: '恢复并改名' }))
    await act(async () => { await undone })
    expect(bodies.map(b => JSON.parse(b).rename)).toEqual([false, false, true])
  })

  it('declining the second question deletes nothing', async () => {
    const { calls } = setup((m) => (m === 'GET' ? json(500, {}) : json(409, { error: { code: 'referenced', message: 'x', details: { referrers: [REF] } } })))
    let done: Promise<void>
    await act(async () => { done = trashAssets([A]) })
    fireEvent.click(await screen.findByRole('button', { name: '移入回收站' }))
    await waitFor(() => expect(calls.filter(c => c.startsWith('DELETE'))).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    await act(async () => { await done })
    expect(calls.filter(c => c.startsWith('DELETE'))).toHaveLength(1)
  })
})
