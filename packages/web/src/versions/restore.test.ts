import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmOptions } from '@bowerbird/plugin-sdk/web'

vi.mock('../lib/api', async () => ({ api: (await import('../pages/shared/test/fake')).fakeApi }))
vi.mock('../overlays/toast', () => ({ toast: vi.fn() }))

import { setConfirmImpl } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { detail, fakeApi, gid, relation, resetFakeApi, version } from '../pages/shared/test/fake'
import { confirmRestore, downstreamToFlag, restorePlan, restoreText } from './restore'

const versions = [version(1), version(2), version(3, { current: true })]
const glb = detail({ id: gid(4), name: 'chest.glb', review: 'approved', relations: {
  outgoing: [],
  incoming: [
    relation({ type: 'source', from: gid(5), to: gid(4), toHash: versions[2]!.hash }),   /* icon made from v3 */
    relation({ type: 'source', from: gid(6), to: gid(4), toHash: versions[0]!.hash }),   /* preview made from v1 */
    relation({ type: 'uses', from: gid(7), to: gid(4) })                                  /* not a source: never counted */
  ]
} })

afterEach(() => { resetFakeApi(); vi.mocked(toast).mockReset() })

describe('恢复为当前版本…', () => {
  it('counts only downstream made from other content than the restored one (E-18)', () => {
    expect(downstreamToFlag(glb, versions[0]!.hash)).toBe(1)
    expect(downstreamToFlag(glb, versions[1]!.hash)).toBe(2)
  })

  it('says which version it becomes, that review goes back to pending, and the downstream count', () => {
    const p = restorePlan(glb, versions, 1)
    expect(p).toEqual({ n: 1, next: 4, current: 3, pending: true, downstream: 1 })
    expect(restoreText(p)).toBe('会新增一条记录 v4，内容与 v1 相同；v3 仍保留在历史里。校验回到待审。下游 1 个资产会提示上游已更新。')
    expect(restoreText(restorePlan({ ...glb, review: 'exempt', relations: { outgoing: [], incoming: [] } }, versions, 2))).toBe('会新增一条记录 v4，内容与 v2 相同；v3 仍保留在历史里。')
  })

  it('restores after the confirm and undoes by restoring the previous content as one more version (E-19)', async () => {
    let asked: ConfirmOptions | null = null
    setConfirmImpl(async o => { asked = o; return true })
    fakeApi.assets.restoreVersion.mockResolvedValue({ asset: glb, version: 4, staleDownstream: 1 })
    const after = vi.fn()
    await expect(confirmRestore('lib1', glb, versions, 1, after)).resolves.toBe(4)
    expect(asked!.title).toBe('把 v1 恢复为当前版本？')
    expect(asked!.confirmLabel).toBe('恢复为当前版本')
    expect(fakeApi.assets.restoreVersion).toHaveBeenCalledWith('lib1', glb.id, versions[0]!.hash)
    const t = vi.mocked(toast).mock.calls[0]![0]
    expect(t.title).toBe('chest.glb 已恢复为 v1 的内容，记为 v4')
    await t.undo!()
    expect(fakeApi.assets.restoreVersion).toHaveBeenLastCalledWith('lib1', glb.id, versions[2]!.hash)
    expect(after).toHaveBeenCalledTimes(2)
  })

  it('does nothing when cancelled', async () => {
    setConfirmImpl(async () => false)
    await expect(confirmRestore('lib1', glb, versions, 2)).resolves.toBeNull()
    expect(fakeApi.assets.restoreVersion).not.toHaveBeenCalled()
  })
})
