import * as React from 'react'

/**
 * What this browser has already been shown (onboarding.md「记在哪里」, ADR-064): whether hints are off, whether the
 * browse-page tour is over (finished or skipped), and which page and new-file hints were seen (`page:<id>`,
 * `format:<format id>`). One record per browser, not per library. Every read survives private mode and a broken value.
 */
export interface OnboardingState {
  off: boolean
  tourDone: boolean
  seen: string[]
  /** Bumped by「重新看导览」: the host starts the tour again from the first step. */
  rev: number
}

export const ONBOARDING_KEY = 'bowerbird.onboarding'
const EMPTY: OnboardingState = { off: false, tourDone: false, seen: [], rev: 0 }

/** Parse what is stored; anything unexpected falls back to the default for that field. */
export function parseOnboarding(raw: string | null): OnboardingState {
  if (!raw) return { ...EMPTY }
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { ...EMPTY } }
  if (!v || typeof v !== 'object') return { ...EMPTY }
  const o = v as Record<string, unknown>
  return {
    off: o.off === true,
    tourDone: o.tourDone === true,
    seen: Array.isArray(o.seen) ? [...new Set(o.seen.filter((x): x is string => typeof x === 'string'))] : [],
    rev: typeof o.rev === 'number' && Number.isFinite(o.rev) ? o.rev : 0
  }
}

const listeners = new Set<() => void>()
let cache: OnboardingState | null = null

function read(): OnboardingState {
  if (cache) return cache
  let raw: string | null = null
  try { raw = localStorage.getItem(ONBOARDING_KEY) } catch { /* private mode */ }
  cache = parseOnboarding(raw)
  return cache
}
function write(next: OnboardingState): void {
  cache = next
  try { localStorage.setItem(ONBOARDING_KEY, JSON.stringify(next)) } catch { /* private mode: kept for this page only */ }
  listeners.forEach(l => l())
}

// another tab of this browser changed it (e.g.「关掉提示」there): read it again, so writes here do not undo that
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === ONBOARDING_KEY || e.key === null) { cache = null; listeners.forEach(l => l()) } })
}

export function getOnboarding(): OnboardingState { return read() }
export function useOnboarding(): OnboardingState {
  return React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, read, read)
}

export const pageKey = (id: string) => `page:${id}`
export const formatKey = (format: string) => `format:${format}`

export function hasSeen(key: string, s: OnboardingState = read()): boolean { return s.seen.includes(key) }
export function markSeen(key: string): void {
  const s = read()
  if (!s.seen.includes(key)) write({ ...s, seen: [...s.seen, key] })
}
/** The person opened a file of this format: its new-file hint has nothing more to say. */
export function markFormatSeen(format: string | null | undefined): void {
  if (format && format !== 'unknown') markSeen(formatKey(format))
}
export function finishTour(): void { const s = read(); if (!s.tourDone) write({ ...s, tourDone: true }) }
export function setHintsOff(off: boolean): void { const s = read(); if (s.off !== off) write({ ...s, off }) }
/**「重新看导览」: forget everything that was seen and turn hints on again. */
export function replayOnboarding(): void { write({ off: false, tourDone: false, seen: [], rev: read().rev + 1 }) }

/** Test helper: forget the cached copy. */
export function resetOnboardingCache(): void { cache = null }
