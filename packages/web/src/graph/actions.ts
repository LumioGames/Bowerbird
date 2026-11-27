import type { QueryClient } from '@tanstack/react-query'
import type { AssetSummary } from '@bowerbird/schema'
import { BowerbirdApiError } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { confirm } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { pickAsset } from '../shell/picker'
import { errText, renamedName } from '../pages/shared/text'
import type { RelRef } from './build'
import { guardedUndo } from '../pages/shared/undo'
import { markOwn } from '../flows/own'

/**
 * Writes made from the relation graph — the only place relations are replaced (ADR-018). Each completes with a
 * toast; undo puts the previous state back through the same endpoints.
 */

const refresh = (qc: QueryClient, lib: string, ...ids: Array<string | null | undefined>) => {
  for (const id of ids) if (id) void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', id] })
  void qc.invalidateQueries({ queryKey: ['lib', lib, 'issues'] })
  void qc.invalidateQueries({ queryKey: ['lib', lib, 'search'] })
}

/** What the relation is called in the dialogs: its note (「基础色」), else its slot, else the type name. */
export function slotLabel(rel: Pick<RelRef, 'note' | 'slot' | 'type'>): string {
  return rel.note || rel.slot || t(`w2.rel.type.${rel.type === 'source' || rel.type === 'reference' || rel.type === 'uses' || rel.type === 'belongs' ? rel.type : 'other'}`)
}

/**
 * 更换对方…: pick the new asset with the shell picker → confirm「更换 {位置} 的对方」(位置 {slot} · 现在是 {对方}) →
 * replace → toast「{位置} 换成了 {新对方}」with undo. The type and the slot stay (a model shows the new texture).
 */
export async function swapRelation(qc: QueryClient, lib: string, rel: RelRef, current: { name: string | null }): Promise<boolean> {
  const label = slotLabel(rel)
  const picked: AssetSummary | null = await pickAsset({ title: t('rel.swapTitle', { slot: label }), exclude: [rel.from, rel.to], confirmLabel: t('rel.swapConfirm') })
  if (!picked) return false
  const ok = await confirm({
    title: t('rel.swapTitle', { slot: label }),
    body: (rel.slot ? t('rel.swapBody', { slot: rel.slot, cur: current.name ?? t('rel.notFound') }) : t('rel.swapBodyNoSlot', { cur: current.name ?? t('rel.notFound') })) + ` → ${picked.name}`,
    confirmLabel: t('rel.swapConfirm')
  })
  if (!ok) return false
  try {
    await api.relations.replace(lib, rel.from, { type: rel.type, to: rel.to, slot: rel.slot, newTo: picked.id })
    refresh(qc, lib, rel.from, rel.to, picked.id)
    toast({
      kind: 'success',
      title: t('rel.swapped', { slot: label, name: picked.name }),
      undo: guardedUndo(async () => {
        await api.relations.replace(lib, rel.from, { type: rel.type, to: picked.id, slot: rel.slot, newTo: rel.to })
        refresh(qc, lib, rel.from, rel.to, picked.id)
      })
    })
    return true
  } catch (e) { toast({ kind: 'error', title: errText(e) }); return false }
}

/** 删除这条关系 (undo re-adds it with the same type, slot, note and role). */
export async function removeRelation(qc: QueryClient, lib: string, rel: RelRef): Promise<boolean> {
  try {
    await api.relations.remove(lib, rel.from, { type: rel.type, to: rel.to, slot: rel.slot })
    refresh(qc, lib, rel.from, rel.to)
    toast({
      title: t('rel.removed'),
      undo: guardedUndo(async () => { await api.relations.add(lib, rel.from, { type: rel.type, to: rel.to, slot: rel.slot, note: rel.note, role: rel.role }); refresh(qc, lib, rel.from, rel.to) })
    })
    return true
  } catch (e) { toast({ kind: 'error', title: errText(e) }); return false }
}

/** 从回收站恢复: restore the missing counterpart; the relation connects again by itself (same GUID). */
export async function restoreTarget(qc: QueryClient, lib: string, rel: RelRef, name: string): Promise<boolean> {
  try {
    const trash = await api.trash.list(lib)
    const item = trash.items.find(i => i.assetId === rel.to)
    if (!item) { toast({ kind: 'warning', title: t('rel.notInTrash', { name }) }); return false }
    /* this page's own doing: no「有 N 个新资产」for it (the GUID is kept, so it is known before the event comes) */
    markOwn(item.assetId)
    /* rename: false first — when the place is taken, ask the way the trash page does (copy.md「恢复 {名称}？」) */
    try { await api.trash.restore(lib, item.id, false) } catch (e) {
      if (!(e instanceof BowerbirdApiError) || e.code !== 'conflict') throw e
      const newName = (e.details?.name as string | undefined) ?? renamedName(item.name)
      const ok = await confirm({ title: t('trash.taken.title', { name: item.name }), body: t('trash.taken.text', { folder: item.folder || '/', name: newName }), confirmLabel: t('trash.taken.confirm') })
      if (!ok) return false
      await api.trash.restore(lib, item.id, true)
    }
    refresh(qc, lib, rel.from, rel.to)
    void qc.invalidateQueries({ queryKey: ['lib', lib, 'trash'] })
    toast({ kind: 'success', title: t('rel.restored', { name: item.name }) })
    return true
  } catch (e) { toast({ kind: 'error', title: errText(e) }); return false }
}

/** 建立关系 without saying how it was made (引用 / 归属 from the drag menu); undo removes it. */
export async function addRelation(qc: QueryClient, lib: string, from: { id: string; name: string }, type: string, to: { id: string; name: string }): Promise<boolean> {
  try {
    await api.relations.add(lib, from.id, { type, to: to.id })
    refresh(qc, lib, from.id, to.id)
    toast({
      kind: 'success',
      title: t(`rel.made.${type === 'belongs' || type === 'source' || type === 'reference' ? type : 'uses'}`, { a: from.name, b: to.name }),
      undo: guardedUndo(async () => { await api.relations.remove(lib, from.id, { type, to: to.id }); refresh(qc, lib, from.id, to.id) })
    })
    return true
  } catch (e) { toast({ kind: 'error', title: errText(e) }); return false }
}
