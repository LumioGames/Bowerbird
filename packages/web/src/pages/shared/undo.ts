import { t } from '../../lib/i18n'
import { toast } from '../../overlays/toast'
import { errText } from './text'

/**
 * The undo handed to a toast (or the session undo stack): when it fails it says so —「没有撤销：{原因}」— instead of
 * failing silently. Resolves either way, so ⌘Z and the toast button never leave an unhandled rejection behind.
 */
export function guardedUndo(fn: () => unknown): () => Promise<void> {
  return async () => {
    try { await fn() } catch (e) { toast({ kind: 'error', title: t('undo.failed', { reason: errText(e) }) }) }
  }
}
