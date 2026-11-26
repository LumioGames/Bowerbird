import * as React from 'react'

/**
 * Small live stores the thumbnails read: which assets this page is rendering right now (ADR-025:「正在生成缩略图」),
 * processing progress per asset (from the job list), and which cells are on screen (the render worker asks for
 * those first). Plain subscribe/snapshot stores so a cell only re-renders when its own value changes.
 */
function store<T>(initial: T) {
  let value = initial
  const ls = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => { value = v; ls.forEach(l => l()) },
    sub: (l: () => void) => { ls.add(l); return () => { ls.delete(l) } }
  }
}

const rendering = store<ReadonlySet<string>>(new Set())
export function setRendering(id: string, on: boolean): void {
  const next = new Set(rendering.get())
  if (on) next.add(id); else next.delete(id)
  rendering.set(next)
}
export function useIsRendering(id: string): boolean {
  return React.useSyncExternalStore(rendering.sub, () => rendering.get().has(id), () => false)
}

const progress = store<ReadonlyMap<string, number>>(new Map())
/** Replace the progress map (0..1 per asset id) from the latest job overview. */
export function setProgressMap(m: ReadonlyMap<string, number>): void { progress.set(m) }
export function useProgress(id: string): number | null {
  return React.useSyncExternalStore(progress.sub, () => progress.get().get(id) ?? null, () => null)
}

/** Asset ids whose cells are in view and still wait for a browser-rendered thumbnail. */
const visible = new Set<string>()
export function markVisible(id: string, on: boolean): void { if (on) visible.add(id); else visible.delete(id) }
export function visibleWaiting(): string[] { return [...visible] }
