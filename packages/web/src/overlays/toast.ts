import { toast as sonner } from 'sonner'
import type { ToastOptions } from '@bowerbird/plugin-sdk/web'
import { pushUndo, runUndo, type UndoEntry } from '../lib/undo'
import { t } from '../lib/i18n'
import { errorText } from '../lib/api'

/**
 * General toast (ADR-021): bottom-right, stacked (≤ 4), stays while hovered; with「撤销」it stays longer and the
 * undo is also pushed to the session undo stack (⌘Z works after the toast is gone; using ⌘Z hides the toast).
 * A custom action (「查看」「挑选…」「切回」) is an action, not an undo.
 * Owner: line web-1 (visual polish of the Toaster lives in plugin-sdk/src/web/ui/sonner.tsx).
 */
export const TOAST_MS = 4000
export const UNDO_TOAST_MS = 8000

export interface ToastPlan {
  duration: number
  action?: { label: string; onClick: () => void }
  undo?: UndoEntry
}

/** Pure part, for tests: how long the toast stays and what its button does. */
export function planToast(opts: ToastOptions, dismiss: () => void): ToastPlan {
  const duration = opts.durationMs ?? (opts.undo ? UNDO_TOAST_MS : TOAST_MS)
  if (opts.undo) {
    let done = false
    const entry: UndoEntry = {
      label: opts.title,
      undo: async () => { if (done) return; done = true; try { await opts.undo!() } catch (e) { done = false; throw e } },
      dismiss
    }
    return { duration, undo: entry, action: { label: t('common.undo'), onClick: () => { runUndo(entry).catch(e => toastError(e)) } } }
  }
  return opts.action ? { duration, action: { label: opts.action.label, onClick: opts.action.onClick } } : { duration }
}

let seq = 0
export function toast(opts: ToastOptions): void {
  const id = `bb-${++seq}`
  const plan = planToast(opts, () => sonner.dismiss(id))
  if (plan.undo) pushUndo(plan.undo)
  const fn = opts.kind === 'error' ? sonner.error : opts.kind === 'warning' ? sonner.warning : opts.kind === 'success' ? sonner.success : sonner
  fn(opts.title, { id, description: opts.description, duration: plan.duration, action: plan.action })
}

/** Shorthand for an error from a failed request. */
export function toastError(e: unknown): void {
  if ((e as Error)?.name === 'AbortError') return
  toast({ title: t('err.generic', { message: errorText(e) }), kind: 'error' })
}
