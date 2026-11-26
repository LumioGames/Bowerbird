import type { NavigateFunction } from 'react-router'

/**
 * Detail page navigation (web-shell.md 浏览路径): moving from one asset to another inside the detail page pushes a
 * history entry and records the way here in `location.state.trail` — each step is the asset and the tab it was
 * left on. Tab changes and previous/next replace the current entry, so one history step = one trail step, and the
 * back button, ⌘[ / Ctrl+[ and browser back all land on the previous asset at the tab it was left on.
 *
 * The browse page (web-1) opens the detail page with `openAssetDetail` so Esc can return to the exact browse URL,
 * and hands over the result list for previous / next with `setDetailList`.
 */
export interface TrailStep { id: string; tab: string; name?: string }
export interface DetailState {
  trail?: TrailStep[]
  /** Browse URL (path + search) the detail page was opened from, and its title for the first crumb. */
  from?: string
  fromLabel?: string
}

export const assetPath = (lib: string, id: string, tab?: string | null) =>
  `/libraries/${encodeURIComponent(lib)}/asset/${encodeURIComponent(id)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`

/** Open an asset from outside the detail page (browse grid, inspector, pages). */
export function openAssetDetail(navigate: NavigateFunction, lib: string, id: string, o: { tab?: string; from?: string; fromLabel?: string; list?: string[] } = {}): void {
  if (o.list) setDetailList(o.list)
  const from = o.from ?? (typeof location !== 'undefined' ? location.pathname + location.search : undefined)
  navigate(assetPath(lib, id, o.tab), { state: { from, fromLabel: o.fromLabel, trail: [] } satisfies DetailState })
}

/** From inside the detail page (graph node, related asset): push one step. */
export function stepTo(navigate: NavigateFunction, lib: string, cur: { id: string; tab: string; name?: string; state: DetailState }, id: string, tab: string): void {
  const trail = [...(cur.state.trail ?? []), { id: cur.id, tab: cur.tab, name: cur.name }].slice(-20)
  navigate(assetPath(lib, id, tab), { state: { ...cur.state, trail } satisfies DetailState })
}

/** Which crumbs show: with more than two steps, the earlier ones fold into「…」(pages.md 详情页). */
export function crumbs(trail: TrailStep[]): { shown: number[]; hidden: number[] } {
  const all = trail.map((_, i) => i)
  if (trail.length > 2) return { hidden: all.slice(0, -1), shown: all.slice(-1) }
  return { hidden: [], shown: all }
}

/** History delta to reach trail step `k` (−1 = the previous asset). */
export function backDelta(trail: TrailStep[], k = trail.length - 1): number { return -(trail.length - k) }

/**
 * Where Esc / the first crumb goes: straight to the page the detail page was opened from (its exact URL), else the
 * library. Not a history step count — the trail keeps only the last 20 steps, so counting back could stop half way.
 */
export function closeTarget(lib: string, state: DetailState): { to: string } {
  return { to: state.from ?? `/libraries/${encodeURIComponent(lib)}` }
}

/* previous / next: the browse result list, kept in memory (a list of 100k ids does not belong in history state) */
let list: string[] = []
export function setDetailList(ids: string[]): void { list = ids.slice() }
export function getDetailList(): string[] { return list }
