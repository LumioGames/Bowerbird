import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionInfo, AssetSummary, CreatorInfo } from '@bowerbird/schema'
import { assetMenuEntries } from './asset-actions'
import { actionsFor } from '../flows/creators'
import { setApiFetch } from '../lib/api'
import { tidy, type MenuEntry } from './menu'
import { planToast, TOAST_MS, UNDO_TOAST_MS } from './toast'
import { clearUndo, pushUndo, undoDepth, undoLast } from '../lib/undo'

const asset = (o: Partial<AssetSummary> = {}): AssetSummary => ({
  id: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d201', name: 'chest.glb', path: 'props/chest/chest.glb', format: 'model', plugin: 'bowerbird.model',
  stage: 'runtime', review: 'pending', tags: [], autoTags: [], description: null, flags: [], thumbnail: null, thumbState: 'ready', aspect: 1,
  badge: null, issueLevel: null, issueCount: 0, size: 1, modified: '', created: '', createdBy: 'user:lin', bundle: false, auxiliary: false,
  memberCount: 0, cellText: null, missingPlugin: null, ...o
})

type Item = Extract<MenuEntry, { id: string }>
const items = (es: MenuEntry[]) => tidy(es).filter((e): e is Item => typeof e === 'object' && 'id' in e)
const byId = (es: MenuEntry[], id: string) => items(es).find(e => e.id === id)

describe('asset menu (copy.md 操作名称表)', () => {
  it('fixed order, local actions on the computer running Bowerbird, trash last and in danger colour', () => {
    const es = assetMenuEntries({ assets: [asset()], isLocal: true, context: 'grid', creators: [], mac: true }, () => {})
    expect(items(es).map(e => e.id)).toEqual(['open', 'quicklook', 'compare', 'openDefault', 'reveal', 'stage', 'copy', 'move', 'rename', 'replace', 'relate', 'export', 'trash'])
    expect(byId(es, 'trash')!.danger).toBe(true)
    expect(byId(es, 'openDefault')!.kbd).toBe('⌘O')
    expect(byId(es, 'reveal')!.kbd).toBe('⌥⌘R')
    expect(byId(es, 'copy')!.kbd).toBe('⌘D')
    expect(byId(es, 'compare')!.disabled).toBe(true)
  })

  it('from another computer: only「下载源文件」instead of the two local actions (ADR-023)', () => {
    const es = assetMenuEntries({ assets: [asset()], isLocal: false, context: 'grid', creators: [] }, () => {})
    expect(byId(es, 'openDefault')).toBeUndefined()
    expect(byId(es, 'reveal')).toBeUndefined()
    expect(byId(es, 'download')!.label).toBe('下载源文件')
  })

  it('a missing file greys out the source-file actions and replace', () => {
    const es = assetMenuEntries({ assets: [asset({ flags: ['missing'] })], isLocal: true, context: 'grid', creators: [] }, () => {})
    expect(byId(es, 'openDefault')!.disabled).toBe(true)
    expect(byId(es, 'reveal')!.disabled).toBe(true)
    expect(byId(es, 'replace')!.disabled).toBe(true)
    const remote = assetMenuEntries({ assets: [asset({ flags: ['missing'] })], isLocal: false, context: 'grid', creators: [] }, () => {})
    expect(byId(remote, 'download')!.disabled).toBe(true)
  })

  it('two selected: a header, compare enabled, single-asset actions off', () => {
    const two = [asset(), asset({ id: '0192f3a4-7c1e-7b52-9d06-4e8a51c0d202', stage: 'production' })]
    const es = assetMenuEntries({ assets: two, isLocal: true, context: 'grid', creators: [] }, () => {})
    expect(tidy(es)[0]).toEqual({ header: '已选 2 个资产' })
    expect(byId(es, 'compare')!.disabled).toBe(false)
    for (const id of ['open', 'openDefault', 'copy', 'rename', 'replace', 'relate']) expect(byId(es, id)!.disabled).toBe(true)
    expect(byId(es, 'stage')!.hint).toBe('混合')
  })

  it('stage is a sub menu with the current value on its row and a check on it', () => {
    const run = vi.fn()
    const es = assetMenuEntries({ assets: [asset()], isLocal: true, context: 'grid', creators: [] }, run)
    const st = byId(es, 'stage')!
    expect(st.hint).toBe('运行时')
    const sub = st.sub!.filter((e): e is Item => typeof e === 'object' && 'id' in e)
    expect(sub.map(s => s.check)).toEqual([false, false, true])
    sub[0]!.onSelect!()
    expect(run).toHaveBeenCalledWith('stage:reference')
  })

  it('the detail page leaves out「打开」', () => {
    const es = assetMenuEntries({ assets: [asset()], isLocal: true, context: 'detail', creators: [] }, () => {})
    expect(byId(es, 'open')).toBeUndefined()
  })

  it('a creation way appears when the selection fills its required inputs', () => {
    const forge: CreatorInfo = { id: 'forge.model', pluginId: 'community.forge', pluginName: 'Forge', displayName: '生成模型', params: {}, inputs: [{ role: '四视图', formats: ['image'], required: true }] }
    const forImage = assetMenuEntries({ assets: [asset({ format: 'image' })], isLocal: true, context: 'grid', creators: [forge] }, () => {})
    expect(byId(forImage, 'creator:forge.model')).toMatchObject({ label: '生成模型…', hint: 'Forge' })
    const forModel = assetMenuEntries({ assets: [asset()], isLocal: true, context: 'grid', creators: [forge] }, () => {})
    expect(byId(forModel, 'creator:forge.model')).toBeUndefined()
  })
})

describe('plugin actions in the asset menu (plugin-system.md「动作」)', () => {
  const variant: ActionInfo = { id: 'community.forge:variant', pluginId: 'community.forge', pluginName: 'Forge', title: '生成变体（Forge）' }
  const withForm: ActionInfo = { ...variant, id: 'community.forge:tint', title: '改色', params: { type: 'object', properties: { hue: { type: 'number' } } } }

  it('after the table\'s items and before 移入回收站; a form-first action ends in「…」; choosing one runs it', () => {
    const run = vi.fn()
    const es = assetMenuEntries({ assets: [asset({ format: 'image' })], isLocal: true, context: 'grid', creators: [], actions: [variant, withForm] }, run)
    const ids = items(es).map(e => e.id)
    expect(ids.slice(-4)).toEqual(['export', 'action:community.forge:variant', 'action:community.forge:tint', 'trash'])
    expect(byId(es, 'action:community.forge:variant')).toMatchObject({ label: '生成变体（Forge）', hint: 'Forge' })
    expect(byId(es, 'action:community.forge:tint')!.label).toBe('改色…')
    const tidied = tidy(es)
    expect(tidied[tidied.length - 2]).toBe('sep')
    byId(es, 'action:community.forge:variant')!.onSelect!()
    expect(run).toHaveBeenCalledWith('action:community.forge:variant')
  })

  it('no actions: the menu is unchanged', () => {
    const es = assetMenuEntries({ assets: [asset()], isLocal: true, context: 'grid', creators: [], actions: [] }, () => {})
    expect(items(es).map(e => e.id)).toEqual(['open', 'quicklook', 'compare', 'openDefault', 'reveal', 'stage', 'copy', 'move', 'rename', 'replace', 'relate', 'export', 'trash'])
  })

  it('actionsFor asks the server for the selection; a server without actions (unsupported) gives none', async () => {
    const seen: string[] = []
    setApiFetch(async input => { seen.push(String(input)); return new Response(JSON.stringify({ actions: [variant] }), { status: 200, headers: { 'content-type': 'application/json' } }) })
    expect(await actionsFor('L1', ['a', 'b'])).toEqual([variant])
    expect(decodeURIComponent(seen[0]!)).toContain('/api/v1/libraries/L1/actions?ids=a,b')
    setApiFetch(async () => new Response(JSON.stringify({ error: { code: 'unsupported', message: '不支持' } }), { status: 501, headers: { 'content-type': 'application/json' } }))
    expect(await actionsFor('L1', ['a'])).toEqual([])
    setApiFetch(async () => new Response(JSON.stringify({ error: { code: 'internal', message: '坏了' } }), { status: 500, headers: { 'content-type': 'application/json' } }))
    await expect(actionsFor('L1', ['a'])).rejects.toThrow('坏了')
    expect(await actionsFor('L1', [])).toEqual([])
    setApiFetch(null)
  })
})

describe('menu separators', () => {
  it('drops leading, trailing and doubled separators', () => {
    expect(tidy(['sep', { id: 'a', label: 'a' }, 'sep', 'sep', { id: 'b', label: 'b' }, 'sep'])).toEqual([{ id: 'a', label: 'a' }, 'sep', { id: 'b', label: 'b' }])
  })
})

describe('toasts (ADR-021)', () => {
  afterEach(() => clearUndo())
  it('a plain toast fades after a few seconds; one with 撤销 stays longer', () => {
    expect(planToast({ title: 'x' }, () => {}).duration).toBe(TOAST_MS)
    expect(planToast({ title: 'x', undo: () => {} }, () => {}).duration).toBe(UNDO_TOAST_MS)
    expect(UNDO_TOAST_MS).toBeGreaterThan(TOAST_MS)
    expect(planToast({ title: 'x', durationMs: 1000 }, () => {}).duration).toBe(1000)
  })

  it('「撤销」runs the undo once, whether from the toast or from ⌘Z', async () => {
    const undo = vi.fn()
    const dismiss = vi.fn()
    const p = planToast({ title: '已复制为 chest_1.glb', undo }, dismiss)
    expect(p.action!.label).toBe('撤销')
    pushUndo(p.undo!)
    await undoLast()
    expect(undo).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledOnce()
    p.action!.onClick()
    await Promise.resolve()
    expect(undo).toHaveBeenCalledOnce()
  })

  it('a failed undo stays on the stack (⌘Z can try again) and reports the failure', async () => {
    let fail = true
    const undo = vi.fn(async () => { if (fail) throw new Error('连接断开') })
    const dismiss = vi.fn()
    const p = planToast({ title: 'x', undo }, dismiss)
    pushUndo(p.undo!)
    await expect(undoLast()).rejects.toThrow('连接断开')
    expect(undoDepth()).toBe(1)
    expect(dismiss).not.toHaveBeenCalled()
    fail = false
    await undoLast()
    expect(undo).toHaveBeenCalledTimes(2)
    expect(undoDepth()).toBe(0)
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('the toast button takes its undo off the stack', async () => {
    const undo = vi.fn()
    const p = planToast({ title: 'x', undo }, () => {})
    pushUndo(p.undo!)
    p.action!.onClick()
    await Promise.resolve()
    expect(undo).toHaveBeenCalledOnce()
    expect(undoDepth()).toBe(0)
  })

  it('a custom action is an action, not an undo', () => {
    const onClick = vi.fn()
    const p = planToast({ title: '已切换到 像素小队', action: { label: '切回', onClick } }, () => {})
    expect(p.undo).toBeUndefined()
    expect(p.action!.label).toBe('切回')
  })
})
