import * as React from 'react'

/**
 * Contracts between web-2's pages and the shell frame (web-1) that the frozen shell signatures do not cover yet.
 * They are plain window events so both sides can wire them without importing each other:
 *  - `bb:inspector-toggle` (no detail): the detail page's「检查器」button / ⌘I asks the shell to show or hide the inspector.
 *  - `bb:inspector-state` ({ open: boolean }): the shell announces whether the inspector is open (button pressed state).
 * Until the shell listens, the button simply has no effect.
 */
export const INSPECTOR_TOGGLE = 'bb:inspector-toggle'
export const INSPECTOR_STATE = 'bb:inspector-state'

let inspectorOpen = true
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener(INSPECTOR_STATE, e => {
    inspectorOpen = !!(e as CustomEvent<{ open: boolean }>).detail?.open
    listeners.forEach(l => l())
  })
}
export function toggleInspector(): void { window.dispatchEvent(new CustomEvent(INSPECTOR_TOGGLE)) }
export function useInspectorOpen(): boolean {
  return React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => inspectorOpen)
}

/** True while a dialog / alert dialog / menu is open, so page-level Esc and arrow keys leave it alone. */
export function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
}

/** True when the key event comes from a text field (shortcuts must not fire while typing). */
export function typing(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}
