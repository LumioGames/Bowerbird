import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ConfirmOptions } from '@bowerbird/plugin-sdk/web'
import { BowerbirdApiError } from '@bowerbird/schema'

vi.mock('../lib/api', async () => ({ api: (await import('../pages/shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))

import { setConfirmImpl } from '../overlays/dialogs'
import { setPickAssetImpl, type PickAssetOptions } from '../shell/picker'
import { toast } from '../overlays/toast'
import { fakeApi, gid, resetFakeApi, summary } from '../pages/shared/test/fake'
import { removeRelation, restoreTarget, slotLabel, swapRelation } from './actions'
import { isOwn } from '../flows/own'
import { relationProblem } from './RelationDialog'

const glb = gid(4), base = gid(10)
const dark = summary({ id: gid(11), name: 'chest_basecolor_dark.png' })
const rel = { type: 'uses', from: glb, to: base, slot: 'chest_basecolor.png', note: '基础色' }
const qc = new QueryClient()

afterEach(() => { resetFakeApi(); vi.mocked(toast).mockReset(); setPickAssetImpl(async () => null) })

describe('更换对方… (ADR-018)', () => {
  it('picks the new asset, confirms「更换 {位置} 的对方」, replaces, and the toast undoes it', async () => {
    let picked: PickAssetOptions | null = null
    let asked: ConfirmOptions | null = null
    setPickAssetImpl(async o => { picked = o; return dark })
    setConfirmImpl(async o => { asked = o; return true })
    fakeApi.relations.replace.mockResolvedValue({})

    await expect(swapRelation(qc, 'lib1', rel, { name: 'chest_basecolor.png' })).resolves.toBe(true)
    expect(picked!.title).toBe('更换 基础色 的对方')
    expect(picked!.exclude).toEqual([glb, base])
    expect(asked!.title).toBe('更换 基础色 的对方')
    expect(String(asked!.body)).toContain('位置 chest_basecolor.png · 现在是 chest_basecolor.png')
    expect(fakeApi.relations.replace).toHaveBeenCalledWith('lib1', glb, { type: 'uses', to: base, slot: 'chest_basecolor.png', newTo: dark.id })

    const t = vi.mocked(toast).mock.calls[0]![0]
    expect(t.title).toBe('基础色 换成了 chest_basecolor_dark.png')
    await t.undo!()
    expect(fakeApi.relations.replace).toHaveBeenLastCalledWith('lib1', glb, { type: 'uses', to: dark.id, slot: 'chest_basecolor.png', newTo: base })
  })

  it('stops when the picker or the confirm is cancelled', async () => {
    setPickAssetImpl(async () => null)
    await expect(swapRelation(qc, 'lib1', rel, { name: null })).resolves.toBe(false)
    setPickAssetImpl(async () => dark)
    setConfirmImpl(async () => false)
    await expect(swapRelation(qc, 'lib1', rel, { name: null })).resolves.toBe(false)
    expect(fakeApi.relations.replace).not.toHaveBeenCalled()
  })

  it('names a relation by its note, else its slot, else its type', () => {
    expect(slotLabel(rel)).toBe('基础色')
    expect(slotLabel({ type: 'uses', slot: 'chest.bin' })).toBe('chest.bin')
    expect(slotLabel({ type: 'source' })).toBe('来源')
  })
})

describe('删除这条关系', () => {
  it('removes it and the undo puts back the same type, slot, note and record', async () => {
    fakeApi.relations.remove.mockResolvedValue({})
    fakeApi.relations.add.mockResolvedValue({})
    await removeRelation(qc, 'lib1', { ...rel, record: 'rec_1' })
    expect(fakeApi.relations.remove).toHaveBeenCalledWith('lib1', glb, { type: 'uses', to: base, slot: 'chest_basecolor.png' })
    const t = vi.mocked(toast).mock.calls[0]![0]
    expect(t.title).toBe('已删除这条关系')
    await t.undo!()
    expect(fakeApi.relations.add).toHaveBeenCalledWith('lib1', glb, { type: 'uses', to: base, slot: 'chest_basecolor.png', note: '基础色', record: 'rec_1' })
  })

  it('an undo that fails says so (「没有撤销：…」) instead of failing silently', async () => {
    fakeApi.relations.remove.mockResolvedValue({})
    fakeApi.relations.add.mockRejectedValue(new Error('关系的对方不存在'))
    await removeRelation(qc, 'lib1', rel)
    const t = vi.mocked(toast).mock.calls[0]![0]
    await expect(t.undo!()).resolves.toBeUndefined()
    expect(toast).toHaveBeenLastCalledWith({ kind: 'error', title: '没有撤销：关系的对方不存在' })
  })
})

describe('从回收站恢复 (relation panel)', () => {
  const item = { id: 't1', assetId: base, name: 'chest_basecolor.png', folder: 'props/chest' }
  it('tries rename: false first; a taken place asks「恢复 {名称}？」naming the new file, then renames', async () => {
    let asked: ConfirmOptions | null = null
    setConfirmImpl(async o => { asked = o; return true })
    fakeApi.trash.list.mockResolvedValue({ items: [item], trashDays: 7 })
    fakeApi.trash.restore.mockRejectedValueOnce(new BowerbirdApiError(409, 'conflict', 'taken')).mockResolvedValueOnce({ asset: {}, renamedTo: 'chest_basecolor_1.png' })
    await expect(restoreTarget(qc, 'lib1', rel, 'chest_basecolor.png')).resolves.toBe(true)
    expect(fakeApi.trash.restore.mock.calls).toEqual([['lib1', 't1', false], ['lib1', 't1', true]])
    expect(isOwn(base)).toBe(true) // no「有 N 个新资产」for this page's own restore
    expect(asked!.title).toBe('恢复 chest_basecolor.png？')
    expect(String(asked!.body)).toBe('props/chest 里已经有一个同名文件。恢复后它会改名为 chest_basecolor_1.png，两个文件都保留。')
    expect(asked!.confirmLabel).toBe('恢复并改名')
  })
  it('cancelling the question restores nothing', async () => {
    setConfirmImpl(async () => false)
    fakeApi.trash.list.mockResolvedValue({ items: [item], trashDays: 7 })
    fakeApi.trash.restore.mockRejectedValueOnce(new BowerbirdApiError(409, 'conflict', 'taken'))
    await expect(restoreTarget(qc, 'lib1', rel, 'chest_basecolor.png')).resolves.toBe(false)
    expect(fakeApi.trash.restore).toHaveBeenCalledTimes(1)
  })
})

describe('建立关系 — problems are stopped and explained', () => {
  const a = { id: gid(2), name: 'chest_turnaround.png' }
  const b = { id: gid(4), name: 'chest.glb', format: 'model' }
  const sourceEdges = [{ from: gid(4), to: gid(3) }, { from: gid(3), to: gid(2) }]
  const names = { [gid(2)]: 'chest_turnaround.png', [gid(3)]: 'chest_high.blend', [gid(4)]: 'chest.glb' }
  it('a loop of source relations', () => {
    expect(relationProblem(a, 'source', b, { sourceEdges, names })).toEqual({
      text: '会形成循环：chest.glb 本来就来自 chest_turnaround.png',
      chain: ['chest_turnaround.png', 'chest_high.blend', 'chest.glb']
    })
    /* uses relations are not loop-checked */
    expect(relationProblem(a, 'uses', b, { sourceEdges, names })).toBeNull()
  })
  it('itself, a duplicate, and belonging to something that is not a document', () => {
    expect(relationProblem(a, 'uses', { ...a, format: 'image' }, {})?.text).toBe('不能和自己建立关系')
    expect(relationProblem(a, 'uses', b, { existing: [{ type: 'uses', from: a.id, to: b.id }] })?.text).toBe('已经有这条关系')
    expect(relationProblem(a, 'belongs', b, {})?.text).toBe('归属的对方要是一份说明文档')
  })
})
