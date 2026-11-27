import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { AssetDetail, PluginInfo, RenderTask } from '@bowerbird/schema'
import type { FormatView, WebPlugin } from '@bowerbird/plugin-sdk/web'
import { createFileSource, mergeRegistry, PluginRegistryProvider, PluginSlot, usePluginRegistry, type LoadedWebPlugin } from './registry'
import { runOneRender, partsOf, renderFailure } from './render-worker'
import { routePath } from './shell-api'

afterEach(cleanup)

const info = (id: string, o: Partial<PluginInfo> = {}): PluginInfo => ({
  id, packageName: id, version: '1.0.0', displayName: id, builtin: false, status: 'enabled', contributes: [], formats: [], hasWeb: true,
  settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'npm', ...o
})
const Viewer = () => null
const view = (extra: Partial<FormatView> = {}): FormatView => ({ Viewer, ...extra })

describe('plugin registry: loading and slots', () => {
  it('merges formats (first plugin wins) and every slot with its plugin id', () => {
    const a: LoadedWebPlugin = { info: info('bowerbird.model'), module: { formats: { model: view() }, ui: { inspectorSections: [{ id: 'mesh', title: '网格', Component: () => null }] } } }
    const b: LoadedWebPlugin = { info: info('community.forge'), module: { formats: { model: view() }, ui: { toolbarItems: [{ id: 'quota', title: '额度' }], pages: [{ id: 'pick', title: '挑选', Component: () => null }], inspectorSections: [{ id: 'mesh', title: 'Forge', Component: () => null }] } } }
    const r = mergeRegistry([a, b])
    expect(r.formatView('model')!.pluginId).toBe('bowerbird.model')
    expect(r.formatView('image')).toBeNull()
    expect(r.ui.toolbarItems).toMatchObject([{ id: 'quota', pluginId: 'community.forge' }])
    expect(r.ui.pages).toMatchObject([{ id: 'pick', pluginId: 'community.forge' }])
    expect(r.ui.inspectorSections.map(s => s.id)).toEqual(['mesh', 'community.forge:mesh'])
  })

  it('loads only enabled plugins with a web part; one that fails to load does not stop the others', async () => {
    const loader = vi.fn(async (p: PluginInfo): Promise<LoadedWebPlugin> => {
      if (p.id === 'broken') throw new Error('404')
      return { info: p, module: { ui: { sidebarSections: [{ id: 's', title: p.id, Component: () => null }] } } as WebPlugin }
    })
    function Probe() { const r = usePluginRegistry(); return <div data-testid="r">{r.ready ? r.ui.sidebarSections.map(s => s.title).join(',') + '|' + (r.failed ?? []).map(f => f.id).join(',') : 'loading'}</div> }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <PluginRegistryProvider loader={loader} plugins={[info('a'), info('broken'), info('off', { status: 'disabled' }), info('noweb', { hasWeb: false })]}>
        <Probe />
      </PluginRegistryProvider>
    )
    await waitFor(() => expect(screen.getByTestId('r').textContent).toBe('a|broken'))
    expect(loader).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('a plugin component that crashes shows its reason; the rest keeps working', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => { throw new Error('kaputt') }
    render(<div><PluginSlot pluginId="community.forge" component={Boom} props={{}} /><span>still here</span></div>)
    expect(screen.getByRole('alert').textContent).toContain('kaputt')
    expect(screen.getByText('still here')).toBeTruthy()
    err.mockRestore()
  })
})

const detail = (o: Partial<AssetDetail> = {}): AssetDetail => ({
  id: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d201', name: 'chest.glb', path: 'props/chest/chest.glb', format: 'model', plugin: 'bowerbird.model', stage: 'runtime',
  review: 'pending', tags: [], autoTags: [], description: null, flags: [], thumbnail: null, thumbState: 'render', aspect: 1, badge: null, issueLevel: null,
  issueCount: 0, size: 1, modified: '', created: '', createdBy: 'user:lin', bundle: false, auxiliary: false, memberCount: 0, cellText: null, missingPlugin: null,
  hash: 'sha256:22', descriptionFull: null, auto: null, fields: {}, reviewVerdict: null,
  versions: [{ hash: 'sha256:11', size: 1, at: '', by: 'user:lin' }, { hash: 'sha256:22', size: 1, at: '', by: 'user:lin' }],
  views: null, thumbnailManual: false, provenance: null, modifiedBy: null, tech: {}, analysis: {}, unresolvedRefs: [], checks: [],
  relations: {
    outgoing: [
      { type: 'uses', from: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d201', to: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d202', target: null, targetName: 'chest_basecolor_dark.png', targetInTrash: false, slot: 'chest_basecolor.png', broken: false, stale: false },
      { type: 'uses', from: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d201', to: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d203', target: null, targetName: 'gone.png', targetInTrash: true, slot: 'chest_normal.png', broken: true, stale: false }
    ],
    incoming: []
  },
  issues: [], bundleFiles: null, targetSize: null, stages: [], ...o
})

describe('FileSource: slot names resolve through the .bmeta relations (ADR-018)', () => {
  it('a slot filled by a relation reads the related asset; an unfilled or broken one is null', async () => {
    const s = createFileSource('xingluo', detail())
    expect(s.url).toBe('/api/v1/libraries/xingluo/assets/0192f3a4-7c1e-7b52-9d06-4e8a51c0d201/file')
    expect(s.version).toBeNull()
    expect(s.slotUrl('chest_basecolor.png')).toBe('/api/v1/libraries/xingluo/assets/0192f3a4-7c1e-7b52-9d06-4e8a51c0d201/slots/chest_basecolor.png')
    expect(s.slotUrl('chest_normal.png')).toBeNull()
    expect(s.slotUrl('chest_orm.png')).toBeNull()
    expect(await s.fetchSlot('chest_orm.png')).toBeNull()
    expect(s.bundleUrl('img/coin.png')).toBe('/api/v1/libraries/xingluo/assets/0192f3a4-7c1e-7b52-9d06-4e8a51c0d201/bundle/img/coin.png')
  })

  it('a past version reads that version and says which', () => {
    const s = createFileSource('xingluo', detail(), 'sha256:11')
    expect(s.url).toBe('/api/v1/libraries/xingluo/assets/0192f3a4-7c1e-7b52-9d06-4e8a51c0d201/versions/sha256%3A11/file')
    expect(s.version).toEqual({ n: 1, hash: 'sha256:11' })
    expect(createFileSource('xingluo', detail(), 'sha256:22').version).toBeNull()
  })
})

describe('browser render worker (ADR-025)', () => {
  const task = (kind: 'thumbnail' | 'summary' = 'thumbnail'): RenderTask => ({ job: 'j1', assetId: detail().id, kind, format: 'model', plugin: 'bowerbird.model', asset: detail() })
  const deps = (v: FormatView | null, t: RenderTask | null = task()) => {
    const submit = vi.fn(async (_job: string, _parts: unknown, _fields: unknown) => {})
    const rendering: Array<[string, boolean]> = []
    return {
      submit, rendering,
      d: { next: vi.fn(async () => t), submit, viewFor: () => v, fileSource: () => createFileSource('x', detail()), visible: () => ['v1'], idle: async () => {}, sleep: async () => {}, onRendering: (id: string, on: boolean) => { rendering.push([id, on]) } }
    }
  }

  it('asks for the visible ones first, renders with the plugin, hands back the parts', async () => {
    const thumb = new Blob(['t'])
    const { d, submit, rendering } = deps(view({ renderThumbnail: async () => ({ thumb, aspect: 1.5, tech: { triangles: 2480 } }) }))
    expect(await runOneRender(d)).toBe(true)
    expect(d.next).toHaveBeenCalledWith(['v1'])
    expect(submit).toHaveBeenCalledWith('j1', { thumb }, { aspect: 1.5, tech: { triangles: 2480 } })
    expect(rendering).toEqual([[detail().id, true], [detail().id, false]])
  })

  it('a failure is reported with its reason', async () => {
    const { d, submit } = deps(view({ renderThumbnail: async () => { throw Object.assign(new Error('这台电脑的浏览器放不了这种视频（ProRes 4444）'), { retryable: false }) } }))
    await runOneRender(d)
    expect(submit).toHaveBeenCalledWith('j1', {}, { error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', retryable: false })
  })

  it('a plugin error class (the video plugin\'s RenderError) and a plain object both pass message and retryable through', async () => {
    class RenderError extends Error { readonly retryable: boolean; constructor(m: string, r: boolean) { super(m); this.name = 'RenderError'; this.retryable = r } }
    const a = deps(view({ renderThumbnail: async () => { throw new RenderError('这台电脑的浏览器放不了这种视频（ProRes 4444）', false) } }))
    await runOneRender(a.d)
    expect(a.submit).toHaveBeenCalledWith('j1', {}, { error: '这台电脑的浏览器放不了这种视频（ProRes 4444）', retryable: false })
    const b = deps(view({ renderSummary: async () => { throw { message: '读取超时', retryable: true } } }), task('summary'))
    await runOneRender(b.d)
    expect(b.submit).toHaveBeenCalledWith('j1', {}, { error: '读取超时', retryable: true })
  })

  it('renderFailure: missing or odd fields fall back to a retryable failure with the text', () => {
    expect(renderFailure(new Error('坏了'))).toEqual({ error: '坏了', retryable: true })
    expect(renderFailure('解码失败')).toEqual({ error: '解码失败', retryable: true })
    expect(renderFailure({ message: 'x', retryable: 'no' })).toEqual({ error: 'x', retryable: true })
    expect(renderFailure({ message: '', retryable: false })).toEqual({ error: '处理失败', retryable: false })
    expect(renderFailure(undefined)).toEqual({ error: '处理失败', retryable: true })
  })

  it('no plugin for the format: says so; nothing to do: returns false', async () => {
    const a = deps(null)
    await runOneRender(a.d)
    expect(a.submit.mock.calls[0]![2]).toMatchObject({ retryable: true })
    const b = deps(view(), null)
    expect(await runOneRender(b.d)).toBe(false)
  })

  it('a thumbnail task brings the summary along: both parts in one submit', async () => {
    const thumb = new Blob(['t']), sum = new Blob(['s'])
    const { d, submit } = deps(view({ renderThumbnail: async () => ({ thumb }), renderSummary: async () => sum }))
    await runOneRender(d)
    expect(submit).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledWith('j1', { thumb, turnaround: sum }, {})
  })

  it('summary images go back as the turnaround part', async () => {
    const img = new Blob(['s'])
    const { d, submit } = deps(view({ renderSummary: async () => img }), task('summary'))
    await runOneRender(d)
    expect(submit).toHaveBeenCalledWith('j1', { turnaround: img }, {})
    expect(partsOf({ thumb: img, aspect: 2 })).toEqual({ thumb: img })
  })
})

describe('ShellApi.navigate', () => {
  it('maps routes to addresses', () => {
    expect(routePath('xingluo', { to: 'asset', id: 'abc', tab: 'relations' })).toBe('/libraries/xingluo/asset/abc?tab=rel')
    expect(routePath('xingluo', { to: 'asset', id: 'abc', tab: 'versions' })).toBe('/libraries/xingluo/asset/abc?tab=ver')
    expect(routePath('xingluo', { to: 'asset', id: 'abc', tab: 'rev' })).toBe('/libraries/xingluo/asset/abc?tab=rev')
    expect(routePath('xingluo', { to: 'asset', id: 'abc', tab: 'forge' })).toBe('/libraries/xingluo/asset/abc?tab=forge')
    expect(routePath('xingluo', { to: 'compare', left: 'a', right: 'b' })).toBe('/libraries/xingluo/compare?a=a&b=b')
    expect(routePath('xingluo', { to: 'plugin-page', plugin: 'community.forge', page: 'pick', params: { job: 'j1' } })).toBe('/libraries/xingluo/plugins/community.forge/pick?job=j1')
    expect(routePath('xingluo', { to: 'browse', folder: 'props/chest' })).toBe('/libraries/xingluo?folder=props%2Fchest')
    expect(routePath('xingluo', { to: 'settings', section: 'tasks' })).toBe('/libraries/xingluo/settings/tasks')
  })
})

