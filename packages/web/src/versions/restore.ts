import type { AssetDetail, VersionView } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { confirm } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { errText } from '../pages/shared/text'
import { guardedUndo } from '../pages/shared/undo'

/**
 * 恢复为当前版本… (versioning.md「恢复」): the old content is written back as a NEW version, the history keeps every
 * record. The confirm says which version it becomes, that review goes back to pending, and how many downstream
 * assets will be told the upstream changed — only those made from other content than the restored one (E-18).
 * Undo restores the previous content as one more version (E-19).
 */

/** Downstream (incoming source relations) whose recorded upstream content differs from the version being restored. */
export function downstreamToFlag(asset: Pick<AssetDetail, 'relations'>, restoredHash: string): number {
  const seen = new Set<string>()
  for (const r of asset.relations.incoming) {
    if (r.type !== 'source' || r.broken) continue
    if (r.toHash && r.toHash === restoredHash) continue
    seen.add(r.from)
  }
  return seen.size
}

export interface RestorePlan { n: number; next: number; current: number; pending: boolean; downstream: number }
export function restorePlan(asset: Pick<AssetDetail, 'relations' | 'review'>, versions: Pick<VersionView, 'n' | 'hash' | 'current'>[], n: number): RestorePlan {
  const cur = versions.find(v => v.current) ?? versions[versions.length - 1]!
  const target = versions.find(v => v.n === n)!
  return { n, next: versions.length + 1, current: cur.n, pending: asset.review !== 'exempt', downstream: downstreamToFlag(asset, target.hash) }
}

export function restoreText(p: RestorePlan): string {
  return [
    t('ver.restoreText', { m: p.next, n: p.n, k: p.current }),
    p.pending ? t('ver.restorePending') : '',
    p.downstream ? t('ver.restoreDown', { d: p.downstream }) : ''
  ].join('')
}

/** Ask, restore, toast with undo. Resolves the new version number, or null when cancelled / failed. */
export async function confirmRestore(lib: string, asset: AssetDetail, versions: VersionView[], n: number, after?: () => void): Promise<number | null> {
  const plan = restorePlan(asset, versions, n)
  const ok = await confirm({ title: t('ver.restoreTitle', { n }), body: restoreText(plan), confirmLabel: t('ver.restoreConfirm') })
  if (!ok) return null
  const target = versions.find(v => v.n === n)!
  const prev = versions.find(v => v.current) ?? versions[versions.length - 1]!
  try {
    const res = await api.assets.restoreVersion(lib, asset.id, target.hash)
    after?.()
    toast({
      kind: 'success',
      title: t('ver.restored', { name: asset.name, n, m: res.version }),
      undo: guardedUndo(async () => { await api.assets.restoreVersion(lib, asset.id, prev.hash); after?.() })
    })
    return res.version
  } catch (e) {
    toast({ kind: 'error', title: errText(e) })
    return null
  }
}
