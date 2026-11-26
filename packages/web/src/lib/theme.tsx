import * as React from 'react'
/** Theme preference per browser: follow system (default), dark or light. Applied as <html data-theme>. */
export type ThemePref = 'system' | 'dark' | 'light'
const KEY = 'bowerbird.theme'
const listeners = new Set<() => void>()
function read(): ThemePref { try { return (localStorage.getItem(KEY) as ThemePref) || 'system' } catch { return 'system' } }
export function applyTheme(pref: ThemePref = read()): void {
  const el = document.documentElement
  if (pref === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', pref)
}
export function setThemePref(pref: ThemePref): void { try { localStorage.setItem(KEY, pref) } catch { /* ignore */ } applyTheme(pref); listeners.forEach(l => l()) }
export function useThemePref(): ThemePref { return React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, read) }
/** Resolved theme for components that need it (sonner, three.js clear colour). */
export function useResolvedTheme(): 'dark' | 'light' {
  const pref = useThemePref()
  const [sys, setSys] = React.useState(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  React.useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: light)')
    const on = () => setSys(m.matches ? 'light' : 'dark')
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return pref === 'system' ? (sys as 'dark' | 'light') : pref
}
