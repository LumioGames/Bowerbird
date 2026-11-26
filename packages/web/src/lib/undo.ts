/**
 * Session undo (web-shell.md「撤销」): operations done while this page is open can be undone with ⌘Z / Ctrl+Z,
 * even after their toast is gone. Owned by line web-1 (keyboard wiring lives in shell/).
 * Undoing twice is a no-op; `dismiss` lets the toast that offered the undo go away when ⌘Z is used instead.
 */
export interface UndoEntry {
  label: string
  undo: () => void | Promise<void>
  /** Called after the entry was undone through the stack (e.g. hide its toast). */
  dismiss?: () => void
}
const stack: UndoEntry[] = []
const MAX = 50
export function pushUndo(entry: UndoEntry): void { stack.push(entry); if (stack.length > MAX) stack.shift() }
/** Undo the newest entry. If its undo fails the entry stays on the stack (⌘Z can try again) and the error is thrown. */
export async function undoLast(): Promise<UndoEntry | null> {
  const e = stack.pop()
  if (!e) return null
  try { await e.undo() } catch (err) { stack.push(e); throw err }
  e.dismiss?.()
  return e
}
export function dropUndo(entry: UndoEntry): void { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1) }
/** Run one specific entry (its toast's「撤销」button) and take it off the stack. */
export async function runUndo(entry: UndoEntry): Promise<void> {
  dropUndo(entry)
  try { await entry.undo() } catch (err) { stack.push(entry); throw err }
}
export function undoDepth(): number { return stack.length }
/** Test helper. */
export function clearUndo(): void { stack.length = 0 }
