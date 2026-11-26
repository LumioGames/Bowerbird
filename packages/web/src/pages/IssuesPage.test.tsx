import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ConfirmOptions } from '@bowerbird/plugin-sdk/web'

vi.mock('../lib/api', async () => ({ api: (await import('./shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))
vi.mock('../components/PageFrame', async () => await import('./shared/test/components'))
vi.mock('../components/AssetThumb', async () => await import('./shared/test/components'))

import { IssuesPage, relinkPath } from './IssuesPage'
import { setConfirmImpl } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { renderRoutes } from './shared/test/harness'
import { fakeApi, gid, issue, libraryInfo, resetFakeApi, summary } from './shared/test/fake'
import { assetCount, groupIssues, issueText, levelCounts } from './issues/model'

const potion = summary({ id: gid(1), name: 'potion.glb', path: 'props/potion/potion.glb', issueLevel: 'error' })
const icon = summary({ id: gid(2), name: 'chest_icon.png', issueLevel: 'warning' })
const iconB = summary({ id: gid(3), name: 'chest_icon_small.png', issueLevel: 'warning' })
const issues = [
  issue({ id: 'i1', type: 'broken-reference', level: 'error', assetId: potion.id, relation: { type: 'uses', to: gid(9), slot: 'potion_basecolor.png' }, details: { toName: 'potion_basecolor.png', inTrash: true } }),
  issue({ id: 'i2', type: 'stale-upstream', level: 'warning', assetId: icon.id, relation: { type: 'source', to: gid(4) }, details: { toName: 'chest.glb', fromVersion: 1, toVersion: 2 } }),
  issue({ id: 'i3', type: 'stale-upstream', level: 'warning', assetId: iconB.id, relation: { type: 'source', to: gid(4) }, details: { toName: 'chest.glb', fromVersion: 1, toVersion: 2 } }),
  issue({ id: 'i4', type: 'orphan-sidecar', level: 'warning', path: 'props/weapon/axe_old.png.bmeta' }),
  issue({ id: 'i5', type: 'thumbnail-stale', level: 'info', assetId: icon.id, details: { thumbAt: '2026-11-21T08:00:00Z', contentAt: '2026-11-22T08:00:00Z' } })
]
const assets = { [potion.id]: potion, [icon.id]: icon, [iconB.id]: iconB }
const page = [{ path: '/libraries/:lib/issues', element: <IssuesPage /> }]

beforeEach(() => {
  fakeApi.issues.list.mockResolvedValue({ issues, assets, assetCount: 4, total: issues.length })
  fakeApi.trash.list.mockResolvedValue({ items: [], trashDays: 7 })
  fakeApi.libraries.get.mockResolvedValue(libraryInfo())
})
afterEach(() => { cleanup(); resetFakeApi(); vi.mocked(toast).mockReset() })

describe('integrity model', () => {
  it('groups by 错误 → 警告 → 提示, then by type; counts levels and assets the same way as the side bar', () => {
    const g = groupIssues(issues)
    expect(g.map(x => x.level)).toEqual(['error', 'warning', 'info'])
    expect(g[1]!.types.map(x => [x.type, x.issues.length])).toEqual([['stale-upstream', 2], ['orphan-sidecar', 1]])
    expect(groupIssues(issues, 'warning').map(x => x.level)).toEqual(['warning'])
    expect(levelCounts(issues)).toEqual({ error: 1, warning: 3, info: 1 })
    expect(assetCount(issues)).toBe(4)
  })
  it('writes each row in plain words', () => {
    expect(issueText(issues[0]!, assets, true)).toBe('引用 potion_basecolor.png，但它已不在资产库（在回收站里）')
    expect(issueText(issues[1]!, assets, false)).toBe('上游 chest.glb 从 v1 更新到了 v2，这张图还是按 v1 做的')
    expect(issueText(issues[3]!, assets, false)).toBe('只有元数据文件，找不到 axe_old.png 本身')
    // the conflicting copy by file name (copy.md「冲突副本：{文件}」); the server reports its library path
    const conflict = issue({ id: 'i6', type: 'metadata-conflict', level: 'error', path: 'ui/shop/shop_prototype.html', details: { conflictPath: "ui/shop/shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta" } })
    // same-named duplicates name the other by its path
    const bg = summary({ id: gid(7), name: 'panel_bg.png', path: 'ui/hud/panel_bg.png' })
    const dup = issue({ id: 'i7', type: 'duplicate-content', level: 'info', assetId: bg.id, details: { otherId: gid(8), otherName: 'panel_bg.png', otherPath: 'ui/shop/panel_bg.png' } })
    expect(issueText(dup, { ...assets, [bg.id]: bg }, false)).toBe('和 ui/shop/panel_bg.png 的内容完全相同')
    expect(issueText(issue({ id: 'i8', type: 'duplicate-content', level: 'info', assetId: bg.id, details: { otherName: 'btn_buy.png', otherPath: 'ui/shop/btn_buy.png' } }), { [bg.id]: bg }, false)).toBe('和 btn_buy.png 的内容完全相同')
    expect(issueText(conflict, assets, false)).toBe("云盘同步留下了冲突副本：shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta，两份的标签不一样")
  })
})

describe('integrity page', () => {
  it('shows「N 个资产 · M 条问题」, the levels, and filters by level', async () => {
    renderRoutes(page, ['/libraries/lib1/issues'])
    await screen.findByText('4 个资产 · 5 条问题')
    expect(document.querySelectorAll('[data-level]')).toHaveLength(3)
    fireEvent.click(screen.getByRole('radio', { name: '提示 1' }))
    await waitFor(() => expect(document.querySelectorAll('[data-level]')).toHaveLength(1))
    expect(screen.getByText('手动缩略图过时')).toBeTruthy()
  })

  it('handles all problems of one type at once after a confirm', async () => {
    let asked: ConfirmOptions | null = null
    setConfirmImpl(async o => { asked = o; return true })
    fakeApi.issues.resolveMany.mockResolvedValue({ resolved: ['i2', 'i3'], failed: [] })
    renderRoutes(page, ['/libraries/lib1/issues'])
    const group = (await screen.findByText('上游已更新', { selector: 'b' })).closest('[data-type]') as HTMLElement
    fireEvent.click(within(group).getByRole('button', { name: '全部确认已复核' }))
    await waitFor(() => expect(fakeApi.issues.resolveMany).toHaveBeenCalledWith('lib1', { action: 'acknowledge', type: 'stale-upstream', ids: ['i2', 'i3'] }))
    expect(asked!.title).toBe('对 2 条「上游已更新」执行“全部确认已复核”？')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '已处理 2 条' }))
  })

  it('row buttons resolve one problem; 重新指定… opens that relation in the graph', async () => {
    fakeApi.issues.resolve.mockResolvedValue({ resolved: ['i1'], failed: [] })
    renderRoutes(page, ['/libraries/lib1/issues'])
    const row = (await screen.findByText('potion.glb')).closest('[data-issue]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '从回收站恢复 potion_basecolor.png' }))
    await waitFor(() => expect(fakeApi.issues.resolve).toHaveBeenCalledWith('lib1', 'i1', { action: 'restore-target', params: undefined }))
    fireEvent.click(within(row).getByRole('button', { name: '重新指定…' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(relinkPath('lib1', potion.id, { type: 'uses', to: gid(9), slot: 'potion_basecolor.png' })))
    expect(screen.getByTestId('loc').textContent).toContain('?tab=rel&relType=uses&relTo=')
  })

  it('?issue=<id> (from the inspector) marks that row and opens its dialog', async () => {
    fakeApi.issues.candidates.mockResolvedValue({ candidates: [{ path: 'props/weapon/axe.png', size: 1, sameContent: false, similarity: 0.6, reason: '名字相近' }] })
    renderRoutes(page, ['/libraries/lib1/issues?issue=i4'])
    const dlg = await screen.findByRole('dialog')
    expect(dlg.textContent).toContain('重新定位 axe_old.png')
    const row = document.querySelector('[data-issue="i4"]') as HTMLElement
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.className).toContain('w2-it__row--focus')
    expect(document.querySelector('[data-issue="i2"]')!.getAttribute('aria-current')).toBeNull()
  })

  it('empty: 资产库没有问题', async () => {
    fakeApi.issues.list.mockResolvedValue({ issues: [], assets: {}, assetCount: 0, total: 0 })
    renderRoutes(page, ['/libraries/lib1/issues'])
    await screen.findByText('资产库没有问题')
  })
})
