import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ConfirmOptions } from '@bowerbird/plugin-sdk/web'
import { BowerbirdApiError } from '@bowerbird/schema'

vi.mock('../lib/api', async () => ({ api: (await import('./shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))
vi.mock('../components/PageFrame', async () => await import('./shared/test/components'))
vi.mock('../components/marks', async () => await import('./shared/test/components'))

import { TrashPage, isSoon, renamedName } from './TrashPage'
import { isOwn } from '../flows/own'
import { setConfirmImpl } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { renderRoutes } from './shared/test/harness'
import { fakeApi, resetFakeApi, summary, gid, trashItem } from './shared/test/fake'

const items = [
  trashItem({ id: 't1', name: 'potion_basecolor.png', folder: 'props/potion', daysLeft: 4 }),
  trashItem({ id: 't2', name: 'chest_v0.glb', format: 'model', daysLeft: 1, deletedBy: 'agent:modeler', referencedBy: 2 }),
  trashItem({ id: 't3', name: 'moodboard_old.jpg', stage: 'reference', review: 'exempt', daysLeft: 0 })
]
const page = [{ path: '/libraries/:lib/trash', element: <TrashPage /> }]
const row = (name: string) => screen.getByText(name).closest('[data-trash]') as HTMLElement

beforeEach(() => { fakeApi.trash.list.mockResolvedValue({ items, trashDays: 7 }) })
afterEach(() => { cleanup(); resetFakeApi(); vi.mocked(toast).mockReset() })

describe('trash page', () => {
  it('shows days left, in the warning colour when one day or less is left', async () => {
    renderRoutes(page, ['/libraries/lib1/trash'])
    await screen.findByText('potion_basecolor.png')
    expect(screen.getByText('保留 7 天，到期自动清除')).toBeTruthy()
    const left = (name: string) => row(name).querySelector('[data-days-left]')!
    expect(left('potion_basecolor.png').textContent).toBe('4 天')
    expect(left('potion_basecolor.png').className).not.toContain('w2-tr__soon')
    expect(left('chest_v0.glb').className).toContain('w2-tr__soon')
    expect(left('moodboard_old.jpg').className).toContain('w2-tr__soon')
    expect([isSoon(2), isSoon(1), isSoon(0)]).toEqual([false, true, true])
  })

  it('restoring into a taken place asks first and names the new file', async () => {
    let asked: ConfirmOptions | null = null
    setConfirmImpl(async o => { asked = o; return true })
    fakeApi.trash.restore.mockRejectedValueOnce(new BowerbirdApiError(409, 'conflict', 'taken'))
    fakeApi.trash.restore.mockResolvedValueOnce({ asset: summary({ id: gid(1), name: 'potion_basecolor_1.png' }), renamedTo: 'potion_basecolor_1.png' })
    renderRoutes(page, ['/libraries/lib1/trash'])
    await screen.findByText('potion_basecolor.png')
    fireEvent.click(within(row('potion_basecolor.png')).getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(fakeApi.trash.restore).toHaveBeenLastCalledWith('lib1', 't1', true))
    // the first try passes rename: false explicitly — omitting it now renames on the server without asking
    expect(fakeApi.trash.restore.mock.calls[0]).toEqual(['lib1', 't1', false])
    // this page's own restore: its asset.created event does not raise「有 N 个新资产」
    expect(isOwn(items[0]!.assetId)).toBe(true)
    expect(asked!.title).toBe('恢复 potion_basecolor.png？')
    expect(asked!.body).toBe('props/potion 里已经有一个同名文件。恢复后它会改名为 potion_basecolor_1.png，两个文件都保留。')
    expect(asked!.confirmLabel).toBe('恢复并改名')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'potion_basecolor_1.png 已恢复到 props/potion' }))
    expect(renamedName('chest.png')).toBe('chest_1.png')
  })

  it('purging several asks once, warns about references, and is a danger action', async () => {
    let asked: ConfirmOptions | null = null
    setConfirmImpl(async o => { asked = o; return true })
    fakeApi.trash.purge.mockResolvedValue(undefined)
    renderRoutes(page, ['/libraries/lib1/trash'])
    await screen.findByText('potion_basecolor.png')
    fireEvent.click(within(row('potion_basecolor.png')).getByRole('checkbox'))
    fireEvent.click(within(row('chest_v0.glb')).getByRole('checkbox'))
    await screen.findByText('已选 2 个')
    fireEvent.click(screen.getAllByRole('button', { name: '彻底删除…' })[0]!)
    await waitFor(() => expect(fakeApi.trash.purge).toHaveBeenCalledTimes(2))
    expect(asked).toMatchObject({ title: '彻底删除 2 个资产？', danger: true, confirmLabel: '彻底删除' })
    expect(String(asked!.body)).toContain('还有资产引用它')
  })

  it('empty trash', async () => {
    fakeApi.trash.list.mockResolvedValue({ items: [], trashDays: 7 })
    renderRoutes(page, ['/libraries/lib1/trash'])
    await screen.findByText('回收站是空的')
    expect(screen.getByText('删除的资产会在这里保留 7 天，期间可以恢复。')).toBeTruthy()
  })
})
