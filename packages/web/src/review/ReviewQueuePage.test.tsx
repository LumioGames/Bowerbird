import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { BowerbirdApiError } from '@bowerbird/schema'

vi.mock('../lib/api', async () => ({ api: (await import('../pages/shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))
vi.mock('../components/PageFrame', async () => await import('../pages/shared/test/components'))
vi.mock('../components/EmptyState', async () => await import('../pages/shared/test/components'))
vi.mock('../components/marks', async () => await import('../pages/shared/test/components'))
vi.mock('../components/AssetThumb', async () => await import('../pages/shared/test/components'))

import { QUEUE_PAGE, ReviewQueuePage } from './ReviewQueuePage'
import { toast } from '../overlays/toast'
import { renderRoutes } from '../pages/shared/test/harness'
import { detail, fakeApi, gid, lineage, resetFakeApi, summary } from '../pages/shared/test/fake'
import { heldWhy, splitQueue } from './queue'

const P1 = detail({ id: gid(1), name: 'lantern_concept.png', autoTags: ['黄铜', '暖光'] })
const P2 = detail({ id: gid(2), name: 'chest.glb', format: 'model' })
const H1 = summary({ id: gid(3), name: 'hero_idle.fbx', flags: ['missing'] })
const all = [P1, P2]
const page = [{ path: '/libraries/:lib/review', element: <ReviewQueuePage /> }]
const key = (k: string, o: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...o })) })

beforeEach(() => {
  fakeApi.search.mockResolvedValue({ items: [P1, P2, H1], total: 3, cursor: null })
  fakeApi.assets.get.mockImplementation(async (_l: string, id: string) => all.find(x => x.id === id))
  fakeApi.assets.lineage.mockImplementation(async (_l: string, id: string) => lineage(id, [], []))
  fakeApi.assets.review.mockImplementation(async (_l: string, id: string) => all.find(x => x.id === id))
  fakeApi.folders.tree.mockResolvedValue({ root: { path: '', name: '', count: 0, modified: null, effectiveDefaults: { from: {} }, children: [] } })
  fakeApi.libraries.vocabulary.mockResolvedValue({ stages: [], reviews: [], formats: [], relationTypes: [], tags: [], methods: [], actors: [], templates: [], designObjects: [] })
})
afterEach(() => { cleanup(); resetFakeApi(); vi.mocked(toast).mockReset() })

describe('review queue rules', () => {
  it('keeps assets that cannot be reviewed out of the queue, with the reason', () => {
    expect(heldWhy(H1)).toBe('missing')
    expect(heldWhy(summary({ id: gid(9), name: 'x', flags: ['processing'] }))).toBe('processing')
    expect(heldWhy(summary({ id: gid(9), name: 'x', format: 'unknown' }))).toBe('unviewable')
    expect(heldWhy(summary({ id: gid(9), name: 'x', missingPlugin: { id: 'community.spine' } }))).toBe('plugin')
    // the sample's hero_run.skel: unknown format because its plugin is missing →「缺少插件」, not「无法显示」
    expect(heldWhy(summary({ id: gid(9), name: 'hero_run.skel', format: 'unknown', missingPlugin: { id: 'community.spine' } }))).toBe('plugin')
    expect(heldWhy(summary({ id: gid(9), name: 'x', issueLevel: 'error' }))).toBe('error')
    const s = splitQueue([P1, P2, H1], P2.id)
    expect(s.queue.map(a => a.id)).toEqual([P2.id, P1.id])
    expect(s.held).toEqual([{ asset: H1, why: 'missing' }])
  })
})

describe('review queue page', () => {
  it('reads the pending list a page at a time with the cursor — past the first page the queue goes on (P2)', async () => {
    const P3 = detail({ id: gid(4), name: 'npc_guard.glb', format: 'model' })
    all.push(P3)
    try {
      fakeApi.search.mockReset()
      fakeApi.search.mockImplementation(async (_l: string, q: { cursor?: string }) => (q.cursor === 'c2'
        ? { items: [P3], total: 3, cursor: null }
        : { items: [P1, P2], total: 3, cursor: 'c2' }))
      renderRoutes(page, ['/libraries/lib1/review'])
      await screen.findByText('lantern_concept.png', { selector: 'b' })
      expect(screen.getByText('1 / 3')).toBeTruthy()
      expect(fakeApi.search.mock.calls[0]![1]).toMatchObject({ limit: QUEUE_PAGE })
      await waitFor(() => expect(fakeApi.search).toHaveBeenCalledWith('lib1', expect.objectContaining({ cursor: 'c2' })))
      key('ArrowRight')
      await screen.findByText('chest.glb', { selector: 'b' })
      key('ArrowRight')
      await screen.findByText('npc_guard.glb', { selector: 'b' })
      expect(screen.getByText('3 / 3')).toBeTruthy()
    } finally { all.pop() }
  })

  it('stops an empty rejection, sends the comment with ↵ and the content hash, then moves on', async () => {
    renderRoutes(page, ['/libraries/lib1/review'])
    await screen.findByText('lantern_concept.png', { selector: 'b' })
    expect(screen.getByText('另有 1 个暂时审不了')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '打回…' }))
    const box = await screen.findByPlaceholderText('哪里需要改（必填）')
    fireEvent.click(screen.getByRole('button', { name: /^打回/ }))
    expect(fakeApi.assets.review).not.toHaveBeenCalled()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(box, { target: { value: '灯罩太暗' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(fakeApi.assets.review).toHaveBeenCalledWith('lib1', P1.id, { status: 'rejected', note: '灯罩太暗', expectHash: P1.hash }))
    await screen.findByText('chest.glb', { selector: 'b' })
    expect(screen.getByText('lantern_concept.png 已打回')).toBeTruthy()
  })

  it('→ skips without a verdict; Ctrl+Enter approves; the round ends with the tally and「再审跳过的」', async () => {
    renderRoutes(page, ['/libraries/lib1/review'])
    await screen.findByText('lantern_concept.png', { selector: 'b' })
    key('ArrowRight')
    await screen.findByText('chest.glb', { selector: 'b' })
    expect(fakeApi.assets.review).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: /^通过/ }).hasAttribute('disabled')).toBe(false))
    key('Enter', { ctrlKey: true, metaKey: true })
    await waitFor(() => expect(fakeApi.assets.review).toHaveBeenCalledWith('lib1', P2.id, { status: 'approved', note: undefined, expectHash: P2.hash }))
    await screen.findByText('这一轮审完了')
    expect(screen.getByText('通过 1 · 打回 0 · 跳过 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '再审跳过的 1 个' }))
    await screen.findByText('lantern_concept.png', { selector: 'b' })
  })

  it('something reviewed by someone else meanwhile is skipped with a toast (ADR-038)', async () => {
    fakeApi.assets.review.mockRejectedValueOnce(new BowerbirdApiError(409, 'conflict', 'already reviewed'))
    renderRoutes(page, ['/libraries/lib1/review'])
    await screen.findByText('lantern_concept.png', { selector: 'b' })
    await waitFor(() => expect(screen.getByRole('button', { name: /^通过/ }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /^通过/ }))
    await screen.findByText('chest.glb', { selector: 'b' })
    expect(toast).toHaveBeenCalledWith({ kind: 'info', title: 'lantern_concept.png 已经有人审过了，跳到下一个' })
  })

  it('undo puts the verdict back and returns to that asset', async () => {
    renderRoutes(page, ['/libraries/lib1/review'])
    await screen.findByText('lantern_concept.png', { selector: 'b' })
    await waitFor(() => expect(screen.getByRole('button', { name: /^通过/ }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /^通过/ }))
    await screen.findByText('lantern_concept.png 已通过')
    fireEvent.click(screen.getByRole('button', { name: /^撤销/ }))
    await screen.findByText('lantern_concept.png', { selector: 'b' })
    expect(fakeApi.assets.review).toHaveBeenLastCalledWith('lib1', P1.id, { status: 'pending', note: undefined, expectHash: undefined })
  })

  it('nothing pending', async () => {
    fakeApi.search.mockResolvedValue({ items: [], total: 0, cursor: null })
    renderRoutes(page, ['/libraries/lib1/review'])
    await screen.findByText('没有待审的资产')
    expect(screen.getByText('新登记的资产会出现在这里。')).toBeTruthy()
  })
})
