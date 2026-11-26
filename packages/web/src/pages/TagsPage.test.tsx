import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { TagInfo } from '@bowerbird/schema'

vi.mock('../lib/api', async () => ({ api: (await import('./shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))
vi.mock('../components/PageFrame', async () => await import('./shared/test/components'))

import { TagsPage } from './TagsPage'
import { toast } from '../overlays/toast'
import { renderRoutes } from './shared/test/harness'
import { fakeApi, resetFakeApi } from './shared/test/fake'

const tag = (o: Partial<TagInfo> & { name: string }): TagInfo => ({ count: 2, aiCount: 0, ...o } as TagInfo)
const page = [{ path: '/libraries/:lib/tags', element: <TagsPage /> }]
const dt = () => ({ effectAllowed: '', dropEffect: '', setData() {}, getData: () => '' })
async function drag(name: string, group: string) {
  const row = await screen.findByText(name, { selector: 'b' })
  fireEvent.dragStart(row.closest('[data-tag]')!, { dataTransfer: dt() })
  const target = document.querySelector(`section[data-group="${group}"]`)!
  fireEvent.dragOver(target, { dataTransfer: dt() })
  fireEvent.drop(target, { dataTransfer: dt() })
}

beforeEach(() => {
  fakeApi.tags.list.mockResolvedValue({ tags: [tag({ name: '动画' }), tag({ name: '岩石', group: '对象', color: '#e8a33a' })], groups: ['对象', '用途'] })
  fakeApi.tags.patch.mockResolvedValue({ affected: 0 })
})
afterEach(() => { cleanup(); resetFakeApi(); vi.mocked(toast).mockReset() })

describe('tags page: groups', () => {
  it('dragging an ungrouped tag into a group sets it; undo takes it out again with group ""', async () => {
    renderRoutes(page, ['/libraries/lib1/tags'])
    await drag('动画', '用途')
    await waitFor(() => expect(fakeApi.tags.patch).toHaveBeenCalledWith('lib1', { define: { name: '动画', group: '用途', color: undefined, aliases: undefined } }))
    const t = vi.mocked(toast).mock.calls[0]![0]
    expect(t.title).toBe('「动画」移到了用途')
    await t.undo!()
    // an omitted group means "leave it" on the server, so「未分组」has to be sent as ''
    expect(fakeApi.tags.patch).toHaveBeenLastCalledWith('lib1', { define: { name: '动画', group: '', color: undefined, aliases: undefined } })
  })

  it('dragging a grouped tag to 未分组 sends group ""', async () => {
    renderRoutes(page, ['/libraries/lib1/tags'])
    await drag('岩石', '')
    await waitFor(() => expect(fakeApi.tags.patch).toHaveBeenCalledWith('lib1', { define: { name: '岩石', group: '', color: '#e8a33a', aliases: undefined } }))
    expect(vi.mocked(toast).mock.calls[0]![0].title).toBe('「岩石」移到了未分组')
  })
})
