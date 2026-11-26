import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { CompareProps, FormatView } from '@bowerbird/plugin-sdk/web'

vi.mock('../lib/api', async () => ({ api: (await import('../pages/shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))
vi.mock('../components/EmptyState', async () => await import('../pages/shared/test/components'))
vi.mock('../components/marks', async () => await import('../pages/shared/test/components'))
vi.mock('../components/AssetThumb', async () => await import('../pages/shared/test/components'))

import * as React from 'react'
import { ComparePage } from './ComparePage'
import { PluginRegistryContext, type PluginRegistry } from '../plugins/registry'
import { toast } from '../overlays/toast'
import { renderRoutes } from '../pages/shared/test/harness'
import { detail, fakeApi, gid, libraryInfo, resetFakeApi, version } from '../pages/shared/test/fake'

const A = detail({ id: gid(1), name: 'chest_basecolor.png', tech: { width: 1024, height: 1024 }, size: 612_000 })
const B = detail({ id: gid(2), name: 'chest_basecolor_dark.png', tech: { width: 1024, height: 512 }, size: 598_000 })
const M = detail({ id: gid(3), name: 'chest.glb', format: 'model', plugin: 'bowerbird.model' })

function StubCompare(p: CompareProps) { return <div data-testid="cmp" data-mode={p.mode} data-split={p.split} data-left={p.left.asset.name} /> }
const image: FormatView = {
  Viewer: () => <div data-testid="viewer" />,
  Compare: StubCompare,
  compareModes: (l, r) => (l.format === 'image' && r.format === 'image' ? [
    { mode: 'side', available: true }, { mode: 'wipe', available: true, default: true }, { mode: 'overlay', available: true },
    { mode: 'diff', available: false, reason: '两张图的比例不一样，差异看不出东西' }
  ] : null),
  techLabels: { width: '宽', height: '高' }
}
const model: FormatView = { Viewer: () => <div data-testid="viewer" /> }
const reg: PluginRegistry = {
  plugins: [], ready: true,
  formatView: f => (f === 'image' ? { pluginId: 'bowerbird.image', view: image } : f === 'model' ? { pluginId: 'bowerbird.model', view: model } : null),
  ui: { inspectorSections: [], detailTabs: [], toolbarItems: [], sidebarSections: [], pages: [], settingsPages: [] }
}
const page = [{ path: '/libraries/:lib/compare', element: <PluginRegistryContext.Provider value={reg}><ComparePage /></PluginRegistryContext.Provider> }]
const open = (q: string) => renderRoutes(page, [`/libraries/lib1/compare?${q}`])
const split = () => Number(screen.getByTestId('cmp').dataset.split)

beforeEach(() => {
  fakeApi.libraries.get.mockResolvedValue(libraryInfo())
  fakeApi.assets.get.mockImplementation(async (_l: string, id: string) => [A, B, M].find(x => x.id === id))
  fakeApi.assets.versions.mockImplementation(async () => ({ versions: [version(1, { current: true })], store: null }))
})
afterEach(() => { cleanup(); resetFakeApi(); vi.mocked(toast).mockReset() })

describe('compare page', () => {
  it('opens in the pair\'s default mode and says why an unavailable mode cannot be used, without greying it', async () => {
    open(`a=${A.id}&b=${B.id}`)
    await waitFor(() => expect(screen.getByTestId('cmp').dataset.mode).toBe('wipe'))
    const diff = screen.getByRole('radio', { name: /差异/ })
    expect(diff.getAttribute('aria-disabled')).toBe('true')
    expect((diff as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(diff)
    expect(toast).toHaveBeenCalledWith({ title: '两张图的比例不一样，差异看不出东西' })
    expect(screen.getByTestId('cmp').dataset.mode).toBe('wipe')
  })

  it('two formats nobody claims together: side by side only, the others explain', async () => {
    open(`a=${A.id}&b=${M.id}`)
    await screen.findAllByTestId('viewer')
    expect(screen.getAllByTestId('viewer')).toHaveLength(2)
    fireEvent.click(screen.getByRole('radio', { name: /卷帘/ }))
    expect(toast).toHaveBeenCalledWith({ title: '两侧格式不同，只能并排' })
  })

  it('the wipe divider: ← → nudge (Shift for bigger steps), double-click centres, position kept across modes and sides', async () => {
    open(`a=${A.id}&b=${B.id}`)
    const knob = await screen.findByRole('slider', { name: '分界线' })
    expect(split()).toBe(0.5)
    // without focus on the knob, arrows do not move it (they belong to whatever has focus)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true })
    expect(split()).toBe(0.5)
    fireEvent.keyDown(knob, { key: 'ArrowRight' })
    expect(split()).toBeCloseTo(0.52)
    fireEvent.keyDown(knob, { key: 'ArrowLeft', shiftKey: true })
    expect(split()).toBeCloseTo(0.42)
    fireEvent.doubleClick(knob)
    expect(split()).toBe(0.5)
    fireEvent.keyDown(knob, { key: 'ArrowRight', shiftKey: true })
    expect(split()).toBeCloseTo(0.6)
    fireEvent.click(screen.getByRole('radio', { name: /并排/ }))
    await waitFor(() => expect(screen.getByTestId('cmp').dataset.mode).toBe('side'))
    expect(screen.queryByRole('slider', { name: '分界线' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /卷帘/ }))
    await waitFor(() => expect(screen.getByTestId('cmp').dataset.mode).toBe('wipe'))
    expect(split()).toBeCloseTo(0.6)
    fireEvent.click(screen.getByRole('button', { name: '交换两侧' }))
    await waitFor(() => expect(screen.getByTestId('cmp').dataset.left).toBe(B.name))
    expect(split()).toBeCloseTo(0.6)
    for (let i = 0; i < 40; i++) fireEvent.keyDown(screen.getByRole('slider', { name: '分界线' }), { key: 'ArrowRight', shiftKey: true })
    expect(split()).toBe(0.98)
  })

  it('the table says how the change reads and highlights different values', async () => {
    open(`a=${A.id}&b=${B.id}`)
    await screen.findByText('差值：B 相对 A')
    const hB = document.querySelector('[data-row="height"][data-side="b"]')!
    expect(hB.className).toContain('w2-ct__v--d')
    expect(hB.textContent).toBe('512−512 · −50%')
    expect(document.querySelector('[data-row="width"][data-side="a"]')!.className).not.toContain('w2-ct__v--d')
  })

  it('two versions of one asset: new minus old, and restore needs a version plugin', async () => {
    const vs = [version(1, { size: 1_080_000 }), version(2, { size: 1_200_000, current: true })]
    fakeApi.assets.versions.mockResolvedValue({ versions: vs, store: { id: 'bowerbird.version-lore', displayName: 'Lore' } })
    fakeApi.libraries.get.mockResolvedValue(libraryInfo({ versionStore: { id: 'bowerbird.version-lore', displayName: 'Lore' } }))
    open(`a=${A.id}&b=${A.id}&av=1&bv=2`)
    await screen.findByText('差值：新减旧')
    expect(document.querySelector('[data-row="size"][data-side="b"]')!.textContent).toContain('+120 KB')
    await screen.findByRole('button', { name: /把 v1 恢复为当前版本…/ })
  })
})

describe('compare page: 技术信息 table', () => {
  it('starts open for most pairs, closed for a model against an image (compare.js infoMi); the list button toggles it', async () => {
    open(`a=${A.id}&b=${B.id}`)
    await screen.findByRole('table', { name: '技术信息' })
    cleanup()
    open(`a=${M.id}&b=${A.id}`)
    const btn = await screen.findByRole('button', { name: '技术信息' })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('table', { name: '技术信息' })).toBeNull()
    fireEvent.click(btn)
    await screen.findByRole('table', { name: '技术信息' })
  })
})

describe('compare page: the plugin\'s Compare view runs in its own slot (P1-1)', () => {
  it('a Compare view that throws shows the reason and both originals to download; the bar stays usable', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom: FormatView = { ...image, Compare: (): React.ReactElement => { throw new Error('画不出来') } }
    const r: PluginRegistry = { ...reg, formatView: f => (f === 'image' ? { pluginId: 'bowerbird.image', view: boom } : reg.formatView(f)) }
    renderRoutes([{ path: '/libraries/:lib/compare', element: <PluginRegistryContext.Provider value={r}><ComparePage /></PluginRegistryContext.Provider> }], [`/libraries/lib1/compare?a=${A.id}&b=${B.id}`])
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('bowerbird.image · 画不出来')
    expect(screen.getByRole('button', { name: '下载 chest_basecolor.png' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载 chest_basecolor_dark.png' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '交换两侧' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain(`a=${B.id}&b=${A.id}`))
    quiet.mockRestore()
  })
})
