import * as React from 'react'
import { isMac } from './platform'

/**
 * Keyboard shortcuts (web-shell.md「键盘操作」, copy.md 快捷键表). Single keys are only Space and Delete;
 * everything else carries ⌘ on Mac / Ctrl on Windows (`mod`). Arrows, Enter and Esc move, open and close.
 * Spec syntax: `mod+shift+alt+<key>`; key names follow KeyboardEvent.key (`ArrowLeft`, `Enter`, `Delete`, ` `),
 * with aliases `space`, `esc`, `del` (Delete or Backspace).
 */
export interface KeyLike { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

export function matchShortcut(e: KeyLike, spec: string, mac = isMac): boolean {
  const parts = spec.toLowerCase().split('+')
  const key = parts.pop()!
  const want = { mod: parts.includes('mod'), alt: parts.includes('alt'), shift: parts.includes('shift') }
  const mod = mac ? e.metaKey : e.ctrlKey
  const other = mac ? e.ctrlKey : e.metaKey
  if (mod !== want.mod || other) return false
  if (e.altKey !== want.alt) return false
  // Shift is only checked when asked for, or for letter keys (⌘Z must not fire on ⇧⌘Z).
  if (want.shift !== e.shiftKey && (want.shift || key.length === 1)) return false
  const k = e.key.toLowerCase()
  switch (key) {
    case 'space': return e.key === ' ' || e.code === 'Space'
    case 'esc': return k === 'escape'
    case 'del': return k === 'delete' || k === 'backspace'
    case 'enter': return k === 'enter'
    default:
      // With ⌥ held, Mac reports a composed character in `key`; fall back to the physical code.
      if (key.length === 1 && /[a-z]/.test(key) && e.code) return k === key || e.code.toLowerCase() === 'key' + key
      return k === key
  }
}

/** True while the person types in a field: single-key shortcuts must not fire there. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true
  return el.isContentEditable === true
}

const ACTIVATING_ROLES = /^(button|link|menuitem|menuitemcheckbox|menuitemradio|tab|option|switch|checkbox|radio|slider|spinbutton|treeitem|combobox|gridcell|row)$/

/**
 * Space and Enter belong to a focused control (a button, a link, a tab, a switch, a tree row…): they press it, so
 * page shortcuts on those keys (quick look, open) stand down. Grid cells are the exception — Space and Enter on a
 * focused asset are quick look and open.
 */
export function isActivationTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.closest?.('[data-asset-cell]') === el) return false
  if (/^(BUTTON|SUMMARY|A)$/.test(el.tagName) && (el.tagName !== 'A' || el.hasAttribute('href'))) return true
  const role = el.getAttribute('role')
  return !!role && ACTIVATING_ROLES.test(role)
}

/**
 * Shift+F10 or the context-menu key on a focused element opens its right-click menu (the keyboard way to the same
 * menu): a `contextmenu` event at the element, which the menu trigger listens for. Returns whether it did.
 */
export function keyboardContextMenu(e: { key: string; shiftKey: boolean; currentTarget: EventTarget; preventDefault(): void; stopPropagation(): void }): boolean {
  if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return false
  const el = e.currentTarget as HTMLElement
  e.preventDefault(); e.stopPropagation()
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + Math.min(24, r.width / 2), clientY: r.top + r.height / 2, button: 2 }))
  return true
}

/** Something modal is open (dialog, menu, popover): page-level keys stand down. */
export function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[data-bb-overlay]')
}

export interface ShortcutOptions {
  /** Fire inside text fields too (⌘F, ⌘Z are page-wide; Space and arrows are not). */
  inInput?: boolean
  /** Fire while a dialog or menu is open. */
  inOverlay?: boolean
  enabled?: boolean
}

/** Bind a shortcut while mounted. Return `false` from the handler to let the event through. */
export function useShortcut(spec: string | string[], handler: (e: KeyboardEvent) => void | boolean, opts: ShortcutOptions = {}): void {
  const ref = React.useRef(handler)
  ref.current = handler
  const specs = Array.isArray(spec) ? spec : [spec]
  const key = specs.join('|')
  const { inInput = false, inOverlay = false, enabled = true } = opts
  React.useEffect(() => {
    if (!enabled) return
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (!specs.some(s => matchShortcut(e, s))) return
      if (!inInput && isTypingTarget(e.target)) return
      if ((e.key === ' ' || e.key === 'Enter') && !e.metaKey && !e.ctrlKey && !e.altKey && isActivationTarget(e.target)) return
      if (!inOverlay && overlayOpen()) return
      if (ref.current(e) === false) return
      e.preventDefault()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, inInput, inOverlay, enabled])
}
