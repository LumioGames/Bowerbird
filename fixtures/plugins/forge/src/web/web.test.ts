/**
 * Smoke test of Forge's web part: every slot is declared, and the components render the prototype's copy
 * (server-side rendering through a fake shell; interaction is covered by the end-to-end tests).
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShellContext, type ShellApi } from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { messageProblems } from '@bowerbird/plugin-sdk/testing'
import plugin from './index.js'
import { messages, runNote, runTitle } from './api.js'

function shell(locale: ShellApi['locale'] = 'zh-CN'): ShellApi {
  return {
    library: { id: 'lib', name: '星落镇', isLocal: true, versionStore: null, hasCreators: true },
    api: { plugins: { routeUrl: (_: string, p: string) => `/api/v1/plugins/community.forge/${p}` } } as unknown as ShellApi['api'],
    actor: 'user:mo', theme: 'dark', locale,
    storage: { get: () => undefined, set: () => {} },
    toast: () => {}, confirm: async () => true, navigate: () => {}, pickAsset: async () => null,
    fileSource: () => { throw new Error('not used') }, onJob: () => () => {}
  }
}
const render = (el: React.ReactElement, s = shell()) => renderToStaticMarkup(React.createElement(ShellContext.Provider, { value: s }, el))

const forgeAsset = {
  id: '0192f3a4-7c1e-7b52-9d06-000000000001', name: 'forge_1234_1.png', path: 'props/lantern/forge_1234_1.png',
  record: {
    id: 'rec_x', method: 'community.forge/image', plugin: 'community.forge@0.4.0', tool: 'Forge 0.4.0', prompt: '提灯的原画：黄铜骨架',
    params: { model: 'forge-xl 2.1', seed: 7730, size: '1536×1536' }, inputs: [{ id: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d210', hash: 'sha256:00', role: '参考图' }],
    by: 'user:mo', at: '2026-11-25T04:00:00Z'
  }
} as unknown as AssetDetail

describe('community.forge web', () => {
  const ui = plugin.ui!
  it('fills every slot of the prototype', () => {
    expect(ui.detailTabs!.map(t => [t.id, t.title])).toEqual([['forge', 'Forge']])
    expect(ui.toolbarItems![0]).toMatchObject({ id: 'forge-quota', icon: 'wand-sparkles' })
    expect(ui.sidebarSections!.map(s => s.id)).toEqual(['forge-runs'])
    expect(ui.pages!.map(p => p.id)).toEqual(['pick'])
    expect(ui.settingsPages!.map(p => p.id)).toEqual(['forge'])
  })

  it('the detail tab only shows on what Forge made, with the run settings and「用同样的设置再生成…」', () => {
    const tab = ui.detailTabs![0]!
    expect(tab.appliesTo!(forgeAsset)).toBe(true)
    expect(tab.appliesTo!({ ...forgeAsset, record: { ...forgeAsset.record!, plugin: undefined } } as AssetDetail)).toBe(false)
    expect(tab.appliesTo!({ ...forgeAsset, record: null } as AssetDetail)).toBe(false)
    const html = render(React.createElement(tab.Component, { asset: forgeAsset }))
    for (const s of ['Forge 的这次生成', '方式', 'community.forge/image', '发起', 'user:mo', '参数', 'model forge-xl 2.1 · seed 7730 · size 1536×1536', '参考图', '提灯的原画：黄铜骨架', '用同样的设置再生成…']) expect(html).toContain(s)
    expect(render(React.createElement(tab.Component, { asset: forgeAsset }), shell('en'))).toContain('Generate again with these settings…')
  })

  it('quota popover, side bar and settings page render their copy', () => {
    const pop = ui.toolbarItems![0]!.Popover!
    expect(render(React.createElement(pop, { close() {} }))).toContain('Forge 本月额度')
    expect(render(React.createElement(pop, { close() {} }))).toContain('Forge 设置')
    expect(render(React.createElement(ui.sidebarSections![0]!.Component))).toContain('还没有生成过')
    const settings = render(React.createElement(ui.settingsPages![0]!.Component))
    for (const s of ['服务地址', '访问密钥', '默认模型', '产出放到', '外部工具', '随资产库', '只在本机', '测试：模拟故障']) expect(settings).toContain(s)
  })

  it('has every string in every shell language (LOCALES), and shows them in Japanese and Korean', () => {
    expect(messageProblems(messages)).toEqual([])
    const tab = ui.detailTabs![0]!
    expect(render(React.createElement(tab.Component, { asset: forgeAsset }), shell('ja'))).toContain('同じ設定でもう一度生成…')
    expect(render(React.createElement(ui.settingsPages![0]!.Component), shell('ko'))).toContain('액세스 키')
    expect(runTitle(shell('ja'), { creator: 'image', params: { count: 4 } })).toBe('AI 画像生成 · 4 枚')
    expect(runNote(shell('ko'), { state: 'failed', progress: 0, message: '服务没有响应（503）', error: '服务没有响应（503）', errorCode: 'E503' })).toBe('서비스가 응답하지 않아요(503)')
  })
})
