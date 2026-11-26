import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

vi.mock('../lib/api', async () => ({ api: (await import('../pages/shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))
vi.mock('../components/Banner', async () => await import('../pages/shared/test/components'))
vi.mock('../components/EmptyState', async () => await import('../pages/shared/test/components'))
vi.mock('../components/marks', async () => await import('../pages/shared/test/components'))
vi.mock('../components/AssetThumb', async () => await import('../pages/shared/test/components'))

import * as React from 'react'
import { DetailPage } from './DetailPage'
import { PluginRegistryContext, type PluginRegistry } from '../plugins/registry'
import { renderRoutes } from '../pages/shared/test/harness'
import { detail, fakeApi, gid, libraryInfo, lineage, relation, resetFakeApi, version } from '../pages/shared/test/fake'
import { setDetailList } from './nav'

const A = detail({ id: gid(1), name: 'chest.glb', format: 'model' })
const B = detail({ id: gid(2), name: 'chest_basecolor.png' })
const C = detail({ id: gid(3), name: 'chest_icon.png' })
const routes = [{ path: '/libraries/:lib/asset/:id', element: <DetailPage /> }]
const loc = () => screen.getByTestId('loc').textContent
const from = '/libraries/lib1'

beforeEach(() => {
  fakeApi.libraries.get.mockResolvedValue(libraryInfo())
  fakeApi.assets.get.mockImplementation(async (_l: string, id: string) => [A, B, C].find(x => x.id === id))
  fakeApi.assets.versions.mockResolvedValue({ versions: [], store: null })
  fakeApi.assets.lineage.mockImplementation(async (_l: string, id: string) => lineage(id, [], []))
})
afterEach(() => { cleanup(); resetFakeApi(); setDetailList([]) })

describe('detail page: the way back (浏览路径)', () => {
  const entries = [
    from,
    { pathname: `/libraries/lib1/asset/${A.id}`, search: '?tab=rev', state: { from, trail: [] } },
    { pathname: `/libraries/lib1/asset/${B.id}`, search: '?tab=view', state: { from, trail: [{ id: A.id, tab: 'rev', name: A.name }] } }
  ]

  it('the back button returns to the previous asset, on the tab it was left on', async () => {
    renderRoutes(routes, entries)
    await screen.findByText('chest_basecolor.png', { selector: 'b' })
    fireEvent.click(screen.getAllByRole('button', { name: '返回' })[0]!)
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${A.id}?tab=rev`))
    expect(screen.getByRole('tab', { name: '校验' }).getAttribute('aria-selected')).toBe('true')
  })

  it('Ctrl+[ (⌘[ on a Mac) goes back too; Esc closes the detail page to the browse page', async () => {
    renderRoutes(routes, entries)
    await screen.findByText('chest_basecolor.png', { selector: 'b' })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', ctrlKey: true, metaKey: true })) })
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${A.id}?tab=rev`))
    await screen.findByText('chest.glb', { selector: 'b' })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await waitFor(() => expect(loc()).toBe('/libraries/lib1'))
  })

  it('clicking a crumb goes back to that step; more than two steps fold into「…」', async () => {
    const trail = [{ id: A.id, tab: 'rev', name: A.name }, { id: B.id, tab: 'view', name: B.name }, { id: C.id, tab: 'rel', name: C.name }]
    renderRoutes(routes, [from, { pathname: `/libraries/lib1/asset/${A.id}`, state: { from, trail: [] } }, { pathname: `/libraries/lib1/asset/${B.id}`, state: { from, trail: trail.slice(0, 1) } },
      { pathname: `/libraries/lib1/asset/${C.id}`, state: { from, trail: trail.slice(0, 2) } }, { pathname: `/libraries/lib1/asset/${A.id}`, state: { from, trail } }])
    await screen.findByRole('button', { name: '更早的路径' })
    fireEvent.click(await screen.findByRole('button', { name: 'chest_icon.png' }))
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${C.id}`))
  })

  it('switching tabs replaces the entry and keeps the way here', async () => {
    renderRoutes(routes, entries)
    fireEvent.click(await screen.findByRole('tab', { name: /关系/ }))
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${B.id}?tab=rel`))
    expect(JSON.parse(screen.getByTestId('loc').dataset.state!).trail).toHaveLength(1)
  })

  it('shows 总览 first and 文档 instead of 查看 for a design object', async () => {
    const doc = detail({ id: gid(9), name: 'chest.md', format: 'doc', memberCount: 3, relations: { outgoing: [], incoming: [relation({ type: 'belongs', from: A.id, to: gid(9), target: A })] } })
    fakeApi.assets.get.mockResolvedValue(doc)
    fakeApi.search.mockResolvedValue({ items: [A], total: 1, cursor: null })
    renderRoutes(routes, [{ pathname: `/libraries/lib1/asset/${doc.id}`, state: { from, trail: [] } }])
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map(x => x.textContent)).toEqual(['总览3', '文档', '关系1', '版本1', '校验'])
  })

  it('previous / next step through the browse list without adding to the way back', async () => {
    setDetailList([A.id, B.id, C.id])
    renderRoutes(routes, entries)
    await screen.findByText('2 / 3')
    fireEvent.click(screen.getByRole('button', { name: '下一个' }))
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${C.id}?tab=view`))
    expect(JSON.parse(screen.getByTestId('loc').dataset.state!).trail).toHaveLength(1)
  })
})

describe('keyboard and roles (a11y)', () => {
  it('tabs are a tablist with one tab in the tab order and a labelled tabpanel; ← → (and Home / End) switch tabs', async () => {
    renderRoutes(routes, [{ pathname: `/libraries/lib1/asset/${A.id}`, search: '?tab=view', state: { from, trail: [] } }])
    await screen.findByText('chest.glb', { selector: 'b' })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(x => x.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]!.id)
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${A.id}?tab=rel`))
    fireEvent.keyDown(screen.getAllByRole('tab')[1]!, { key: 'End' })
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${A.id}?tab=rev`))
    fireEvent.keyDown(screen.getAllByRole('tab')[3]!, { key: 'ArrowRight' })
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${A.id}?tab=view`))
  })

  it('relation graph nodes can be reached and opened from the keyboard', async () => {
    const withUse = detail({ ...A, relations: { outgoing: [relation({ type: 'uses', from: A.id, to: B.id, target: B, slot: 'chest_basecolor.png' })], incoming: [] } })
    fakeApi.assets.get.mockImplementation(async (_l: string, id: string) => [withUse, B, C].find(x => x.id === id))
    renderRoutes(routes, [{ pathname: `/libraries/lib1/asset/${A.id}`, search: '?tab=rel', state: { from, trail: [] } }])
    const node = await screen.findByRole('button', { name: /^chest_basecolor\.png/ })
    expect(node.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(node, { key: 'Enter' })
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${B.id}?tab=rel`))
  })
})

describe('no made-up history (P1-6)', () => {
  const store = { id: 'bowerbird.version-lore', displayName: 'Lore' }
  const two = detail({ id: gid(1), name: 'chest.glb', format: 'model', versions: [version(1), version(2, { current: true })] as never })

  it('the relation graph shows no version timeline and no「v1 时的关系」even with a version plugin (the lineage has no versions)', async () => {
    fakeApi.libraries.get.mockResolvedValue(libraryInfo({ versionStore: store as never }))
    fakeApi.assets.get.mockImplementation(async () => two)
    renderRoutes(routes, [{ pathname: `/libraries/lib1/asset/${two.id}`, search: '?tab=rel', state: { from, trail: [] } }])
    await screen.findByText('chest.glb', { selector: 'b' })
    await screen.findByRole('button', { name: '建立关系…' })
    expect(screen.queryByRole('group', { name: '版本' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/时的关系/)
  })

  it('the versions tab with a version plugin has no「全部 / 内容 / 标签与关系」filter (nothing records that history)', async () => {
    fakeApi.libraries.get.mockResolvedValue(libraryInfo({ versionStore: store as never }))
    fakeApi.assets.get.mockImplementation(async () => two)
    fakeApi.assets.versions.mockResolvedValue({ versions: [version(1), version(2, { current: true })], store })
    renderRoutes(routes, [{ pathname: `/libraries/lib1/asset/${two.id}`, search: '?tab=ver', state: { from, trail: [] } }])
    await screen.findByText('Lore')
    expect(screen.queryByRole('radiogroup', { name: '显示' })).toBeNull()
    expect(screen.queryByText('标签与关系')).toBeNull()
  })
})

describe('detail page: plugin tabs run in their own slot (P1-1)', () => {
  const Boom = (): React.ReactElement => { throw new Error('渲染崩了') }
  const reg = (tabs: Array<{ id: string; title: string; appliesTo?(a: unknown): boolean; Component: React.ComponentType<{ asset: never }> }>): PluginRegistry => ({
    plugins: [], ready: true, formatView: () => null,
    ui: { inspectorSections: [], detailTabs: tabs.map(x => ({ pluginId: 'community.forge', ...x })) as never, toolbarItems: [], sidebarSections: [], pages: [], settingsPages: [] }
  })
  const withReg = (r: PluginRegistry) => [{ path: '/libraries/:lib/asset/:id', element: <PluginRegistryContext.Provider value={r}><DetailPage /></PluginRegistryContext.Provider> }]

  it('a plugin tab that throws shows the plugin, the reason,「下载原文件」and「重试」; the page bar and other tabs stay', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoutes(withReg(reg([{ id: 'forge', title: 'Forge', Component: Boom }])), [{ pathname: `/libraries/lib1/asset/${A.id}`, search: '?tab=plug:community.forge:forge', state: { from, trail: [] } }])
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('查看器出错了')
    expect(alert.textContent).toContain('community.forge · 渲染崩了')
    expect(screen.getByRole('button', { name: '下载原文件' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    // the shell is still there: the tab bar works
    fireEvent.click(screen.getByRole('tab', { name: '校验' }))
    await waitFor(() => expect(loc()).toBe(`/libraries/lib1/asset/${A.id}?tab=rev`))
    quiet.mockRestore()
  })

  it('a tab whose appliesTo throws is left out instead of taking the page down', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Ok = () => <p>ok</p>
    renderRoutes(withReg(reg([{ id: 'bad', title: '坏的', appliesTo: () => { throw new Error('x') }, Component: Ok }, { id: 'good', title: '好的', Component: Ok }])), [{ pathname: `/libraries/lib1/asset/${A.id}`, state: { from, trail: [] } }])
    await screen.findByText('chest.glb', { selector: 'b' })
    expect(screen.queryByRole('tab', { name: '坏的' })).toBeNull()
    expect(screen.getByRole('tab', { name: '好的' })).toBeTruthy()
    quiet.mockRestore()
  })
})
