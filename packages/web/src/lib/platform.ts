/** Mac uses ⌘, Windows/Linux use Ctrl (web-shell.md「键盘操作」). */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export function modKey(e: KeyboardEvent | React.KeyboardEvent): boolean { return isMac ? e.metaKey : e.ctrlKey }
/** Display a shortcut, e.g. kbd('mod+Z') → ⌘Z / Ctrl+Z, kbd('alt+mod+R') → ⌥⌘R / Alt+Ctrl+R. */
export function kbd(spec: string, mac: boolean = isMac): string {
  const parts = spec.split('+')
  if (mac) return parts.map(p => ({ mod: '⌘', alt: '⌥', shift: '⇧', enter: '↵' } as Record<string, string>)[p] ?? p).join('')
  return parts.map(p => ({ mod: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter' } as Record<string, string>)[p] ?? p).join('+')
}
