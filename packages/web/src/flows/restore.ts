import type { TrashItem } from '@bowerbird/schema'
import { BowerbirdApiError } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { confirm } from '../overlays/dialogs'
import { renamedName } from '../pages/shared/text'
import { markOwn } from './own'

/**
 * Restore one trash entry to where it was, the way the trash page does (copy.md「恢复到被占用的位置」): first without
 * renaming (`rename: false` — leaving it out means rename automatically); when the place has been taken meanwhile the
 * server answers `conflict` and the person is asked「恢复 {名称}？」…「恢复后它会改名为 {名称_1}」before it is restored
 * under the new name. Resolves to the name it came back with, or null when the person chose not to restore it; other
 * errors are thrown. Restoring keeps the GUID, so the asset is marked as this page's own doing before the event.
 */
export async function restoreAsking(lib: string, it: Pick<TrashItem, 'id' | 'assetId' | 'name' | 'folder'>): Promise<{ name: string } | null> {
  markOwn(it.assetId)
  try {
    const r = await api.trash.restore(lib, it.id, false)
    return { name: r.renamedTo ?? it.name }
  } catch (e) {
    if (!(e instanceof BowerbirdApiError) || e.code !== 'conflict') throw e
    const newName = (e.details?.name as string | undefined) ?? renamedName(it.name)
    const ok = await confirm({ title: t('trash.taken.title', { name: it.name }), body: t('trash.taken.text', { folder: it.folder || '/', name: newName }), confirmLabel: t('trash.taken.confirm') })
    if (!ok) return null
    const r = await api.trash.restore(lib, it.id, true)
    return { name: r.renamedTo ?? newName }
  }
}

const isConflict = (e: unknown) => e instanceof BowerbirdApiError && e.code === 'conflict'

/**
 * Restore several entries (undoing a deletion): all at once without renaming, then one question at a time for those
 * whose place is taken (restoreAsking). Resolves to how many came back and the first error, if any.
 */
export async function restoreAllAsking(lib: string, items: ReadonlyArray<Pick<TrashItem, 'id' | 'assetId' | 'name' | 'folder'>>): Promise<{ restored: number; error: unknown }> {
  let restored = 0
  let error: unknown = null
  const taken: typeof items[number][] = []
  await Promise.all(items.map(async it => {
    markOwn(it.assetId)
    try { await api.trash.restore(lib, it.id, false); restored++ } catch (e) { if (isConflict(e)) taken.push(it); else error ??= e }
  }))
  for (const it of taken) {
    try { if (await restoreAsking(lib, it)) restored++ } catch (e) { error ??= e }
  }
  return { restored, error }
}
