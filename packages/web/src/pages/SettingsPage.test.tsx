import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ConfirmOptions } from '@bowerbird/plugin-sdk/web'
import type { PluginInfo } from '@bowerbird/schema'

vi.mock('../lib/api', async () => ({ api: (await import('./shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))
vi.mock('../components/PageFrame', async () => await import('./shared/test/components'))
vi.mock('../components/Banner', async () => await import('./shared/test/components'))

import * as React from 'react'
import { SettingsPage } from './SettingsPage'
import { PluginRegistryContext, type PluginRegistry } from '../plugins/registry'
import { setConfirmImpl } from '../overlays/dialogs'
import { renderRoutes } from './shared/test/harness'
import { fakeApi, libraryInfo, resetFakeApi } from './shared/test/fake'
import { schemaProps, validateProp } from './settings/plugins'

const config = { host: '127.0.0.1', port: 7420, libraries: [], cacheDirs: {}, scanIntervalMinutes: 10, allowedOrigins: [], plugins: {}, installed: [] }
const plugin = (o: Partial<PluginInfo>): PluginInfo => ({
  id: 'bowerbird.image', packageName: '@bowerbird/plugin-image', version: '1.0.0', displayName: '图片', builtin: true, status: 'enabled', contributes: ['formats'],
  formats: [{ id: 'image', displayName: '图片', extensions: ['.png'] }], hasWeb: true, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'builtin', ...o
})
const page = [{ path: '/libraries/:lib/settings/:section', element: <SettingsPage /> }]

beforeEach(() => {
  fakeApi.libraries.get.mockResolvedValue(libraryInfo({ requiredPlugins: [{ id: 'community.spine', range: '^1.4', installed: false, enabled: false }] }))
  fakeApi.config.get.mockResolvedValue({ config, dataDir: '/data', restartRequired: false })
  fakeApi.config.patch.mockResolvedValue({ config: { ...config, host: '0.0.0.0' }, dataDir: '/data', restartRequired: true })
  fakeApi.plugins.machineSettings.mockResolvedValue({ values: {}, schema: null })
  fakeApi.plugins.librarySettings.mockResolvedValue({ values: {}, schema: null })
  fakeApi.libraries.cache.mockResolvedValue({ bytes: 1.8e9, files: 10, dir: '/lib/.bowerbird/cache', inLibrary: true })
  fakeApi.plugins.list.mockResolvedValue({ plugins: [
    plugin({}),
    plugin({ id: 'community.forge', packageName: '@community/forge', displayName: 'Forge', builtin: false, source: 'npm', contributes: ['creators'], formats: [], missingTools: ['forge-cli'],
      consecutiveFailures: { count: 3, reason: '服务没有响应（503）' }, settings: { type: 'object', required: ['quota'], properties: { quota: { type: 'integer', title: '本月额度', minimum: 1, scope: 'library' }, apiKey: { type: 'string', title: 'API Key', format: 'password', scope: 'library' } } } }),
    plugin({ id: 'community.psd', packageName: '@community/psd', displayName: 'PSD 分层', builtin: false, status: 'failed', reason: '这个插件需要更新版本的 Bowerbird（2.x），现在是 1.4', source: 'npm' })
  ] })
})
afterEach(() => { cleanup(); resetFakeApi() })

describe('settings · this machine', () => {
  it('opening to the local network asks first and is a danger action; cancelling changes nothing', async () => {
    let asked: ConfirmOptions | null = null
    setConfirmImpl(async o => { asked = o; return false })
    renderRoutes(page, ['/libraries/lib1/settings/machine'])
    fireEvent.click(await screen.findByRole('radio', { name: '允许局域网' }))
    await waitFor(() => expect(asked).not.toBeNull())
    expect(asked).toMatchObject({ title: '允许局域网里的其他电脑访问？', confirmLabel: '允许局域网访问', danger: true })
    expect(fakeApi.config.patch).not.toHaveBeenCalled()
  })

  it('confirmed: only the host is sent, then the standing warning shows the address', async () => {
    setConfirmImpl(async () => true)
    renderRoutes(page, ['/libraries/lib1/settings/machine'])
    fireEvent.click(await screen.findByRole('radio', { name: '允许局域网' }))
    await waitFor(() => expect(fakeApi.config.patch).toHaveBeenCalledWith({ host: '0.0.0.0' }))
    fakeApi.config.get.mockResolvedValue({ config: { ...config, host: '0.0.0.0' }, dataDir: '/data', restartRequired: false })
    await screen.findByText('任何能访问这个地址的人，都能读写整个资产库')
  })

  it('the port is validated before saving', async () => {
    renderRoutes(page, ['/libraries/lib1/settings/machine'])
    const port = await screen.findByRole('textbox', { name: '端口' })
    fireEvent.change(port, { target: { value: '99999' } })
    fireEvent.blur(port)
    await screen.findByText('填 1 到 65535 之间的整数')
    expect(fakeApi.config.patch).not.toHaveBeenCalled()
  })
})

describe('settings · library', () => {
  it('saves only the changed field and shows a save failure under the row', async () => {
    fakeApi.libraries.patch.mockRejectedValueOnce(new Error('磁盘只读'))
    renderRoutes(page, ['/libraries/lib1/settings/library'])
    const days = await screen.findByRole('textbox', { name: '回收站保留天数' })
    fireEvent.change(days, { target: { value: '0' } })
    fireEvent.blur(days)
    await screen.findByText('填 1 到 3650 之间的整数')
    fireEvent.change(days, { target: { value: '14' } })
    fireEvent.blur(days)
    await waitFor(() => expect(fakeApi.libraries.patch).toHaveBeenCalledWith('lib1', { settings: { trashDays: 14 } }))
    await screen.findByText('没有保存：磁盘只读')
    expect(screen.getByRole('button', { name: /Spine|community\.spine/ }).className).toContain('warn')
  })
})

describe('settings · plugins', () => {
  it('lists states, reasons and warnings; built-ins have no switch; the plugin id opens its settings', async () => {
    renderRoutes(page, ['/libraries/lib1/settings/plugins?focus=community.spine'])
    await screen.findByText('插件在本机以完全信任的方式运行，能读写资产库里的所有文件。只安装来源可信的插件。')
    expect(screen.getByText('这个插件需要更新版本的 Bowerbird（2.x），现在是 1.4')).toBeTruthy()
    expect(screen.getByText('需要外部工具 forge-cli，这台电脑上没找到')).toBeTruthy()
    expect(screen.getByText('最近 3 次创建都失败了：服务没有响应（503）')).toBeTruthy()
    expect(screen.getByText('资产库需要，本机未安装')).toBeTruthy()
    expect(document.querySelector('[data-plugin="community.spine"]')!.className).toContain('w2-pl--focus')
    expect(screen.queryByRole('switch', { name: '启用 图片' })).toBeNull()
    expect(screen.getByRole('switch', { name: '启用 Forge' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/libraries/lib1/settings/community.forge'))
  })

  it('a plugin section is the plugin id; items say where they are kept, credentials only on this machine', async () => {
    fakeApi.plugins.machineSettings.mockResolvedValue({ values: {}, schema: null })
    fakeApi.plugins.librarySettings.mockResolvedValue({ values: { quota: 200 }, schema: null })
    renderRoutes(page, ['/libraries/lib1/settings/community.forge'])
    await screen.findByText('本月额度')
    const props = schemaProps(plugin({}).settings ?? { properties: { apiKey: { type: 'string', format: 'password', scope: 'library' } } })
    expect(props[0]).toMatchObject({ key: 'apiKey', scope: 'machine', secret: true })
    expect(screen.getByText('随资产库')).toBeTruthy()
    expect(screen.getByText('只在本机')).toBeTruthy()
    expect(validateProp({ key: 'q', title: 'q', type: 'integer', scope: 'library', secret: false, required: true, minimum: 1 }, '0')).toBe('不能小于 1')
    expect(validateProp({ key: 'q', title: 'q', type: 'integer', scope: 'library', secret: false, required: true }, '')).toBe('必填')
  })

  it('任务 says how many assets wait for a browser to render (waitingRender)', async () => {
    fakeApi.jobs.overview.mockResolvedValue({ stages: [], waitingRender: 5, busy: 0, scan: { running: false, phase: 'idle', done: 0, total: 0, finishedAt: '2026-11-25T04:00:00Z' }, failed: [], creates: [], processing: [] })
    renderRoutes(page, ['/libraries/lib1/settings/tasks'])
    const row = await screen.findByText('等浏览器渲染')
    expect(row.closest('[data-stage]')!.textContent).toContain('5 个')
  })

  it('a plugin settings page that throws stays inside its card (PluginSlot); the form and navigation keep working (P1-1)', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = (): React.ReactElement => { throw new Error('设置页崩了') }
    const reg: PluginRegistry = {
      plugins: [], ready: true, formatView: () => null,
      ui: { inspectorSections: [], detailTabs: [], toolbarItems: [], sidebarSections: [], pages: [], settingsPages: [{ pluginId: 'community.forge', id: 'forge', title: 'Forge 账户', Component: Boom }] as never }
    }
    renderRoutes([{ path: '/libraries/:lib/settings/:section', element: <PluginRegistryContext.Provider value={reg}><SettingsPage /></PluginRegistryContext.Provider> }], ['/libraries/lib1/settings/community.forge'])
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('community.forge · 设置页崩了')
    expect(screen.getByText('本月额度')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '本机' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/libraries/lib1/settings/machine'))
    quiet.mockRestore()
  })
})
