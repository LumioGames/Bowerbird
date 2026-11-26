import * as React from 'react'

/**
 * Per-browser interface state (web-shell.md「前端状态」): layout, thumbnail size, panel widths, list columns.
 * Kept in localStorage; every read survives private mode (falls back to the default).
 */
export interface Prefs {
  layout: 'masonry' | 'grid' | 'list'
  cellSize: number
  sideWidth: number
  inspWidth: number
  sideClosed: boolean
  inspClosed: boolean
  listColumns: string[]
}

export const DEFAULT_PREFS: Prefs = {
  layout: 'grid',
  cellSize: 168,
  sideWidth: 232,
  inspWidth: 320,
  sideClosed: false,
  inspClosed: false,
  listColumns: ['name', 'format', 'stage', 'review', 'tags', 'size', 'modified', 'tech']
}

const KEY = 'bowerbird.prefs'
const listeners = new Set<() => void>()
let cache: Prefs | null = null

function read(): Prefs {
  if (cache) return cache
  try { cache = { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) } } catch { cache = { ...DEFAULT_PREFS } }
  return cache
}
export function getPrefs(): Prefs { return read() }
export function setPrefs(patch: Partial<Prefs>): void {
  cache = { ...read(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* private mode */ }
  listeners.forEach(l => l())
}
export function usePrefs(): Prefs {
  return React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, read, read)
}
/** Test helper: forget the cached copy. */
export function resetPrefsCache(): void { cache = null }
