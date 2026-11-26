import type { OnboardingState } from './store'

/**
 * The hints and the rules that pick one (onboarding.md, ADR-064). Pure: the host reads the page and hands the facts
 * in. Anchors are CSS selectors on marks the pages carry (`data-onboard`, `data-view`, `data-section`, …); a page
 * that has nothing to point at simply has no matching element, so no route table is needed.
 */
export type Side = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  id: string
  selector: string
  /** Where the bubble goes first, if it fits. */
  side: Side
  title: string
  text: string
  /** The step needs a selected asset (the inspector shows it): select the first one when none is. */
  needsSelection?: boolean
}

/** The browse page's five steps (onboarding.md「浏览页导览」). */
export const TOUR: readonly TourStep[] = [
  { id: 'views', selector: '[data-view="pending"]', side: 'right', title: 'ob.tour.views.title', text: 'ob.tour.views.text' },
  { id: 'cells', selector: '[data-asset-cell]', side: 'bottom', title: 'ob.tour.cells.title', text: 'ob.tour.cells.text' },
  { id: 'find', selector: '[data-onboard="search"]', side: 'bottom', title: 'ob.tour.find.title', text: 'ob.tour.find.text' },
  { id: 'inspector', selector: '[data-section="insp.tags"]', side: 'left', title: 'ob.tour.inspect.title', text: 'ob.tour.inspect.text', needsSelection: true },
  { id: 'footer', selector: '[data-onboard="side.settings"]', side: 'top', title: 'ob.tour.footer.title', text: 'ob.tour.footer.text' }
]

export interface PageHint {
  /** Seen key is `page:<id>`; two variants of one place share an id (the versions tab with and without a plugin). */
  id: string
  selector: string
  /** Only while this also matches (e.g. the 查看 tab is the selected one). */
  when?: string
  side: Side
  title: string
  /** Text key; `{n}` comes from the anchor's `data-onboard-n`. */
  text: string
}

/** First visit of each page (onboarding.md「各页提示」), in the order they are looked for. */
export const PAGE_HINTS: readonly PageHint[] = [
  { id: 'detail.view', selector: '[role="tab"][data-value="rel"]', when: '[role="tab"][data-value="view"][aria-selected="true"]', side: 'bottom', title: 'ob.page.view.title', text: 'ob.page.view.text' },
  { id: 'detail.rel', selector: '[data-onboard="graph.center"]', side: 'bottom', title: 'ob.page.rel.title', text: 'ob.page.rel.text' },
  { id: 'detail.ver', selector: '[data-onboard="ver.pick"]', side: 'bottom', title: 'ob.page.ver.title', text: 'ob.page.ver.none' },
  { id: 'detail.ver', selector: '[data-onboard="ver.first"]', side: 'right', title: 'ob.page.ver.title', text: 'ob.page.ver.text' },
  { id: 'detail.rev', selector: '[data-onboard="rev.pass"]', side: 'bottom', title: 'ob.page.rev.title', text: 'ob.page.rev.text' },
  { id: 'compare', selector: '[data-onboard="cmp.modes"]', side: 'bottom', title: 'ob.page.cmp.title', text: 'ob.page.cmp.text' },
  { id: 'queue', selector: '[data-onboard="queue.pass"]', side: 'top', title: 'ob.page.queue.title', text: 'ob.page.queue.text' },
  { id: 'issues', selector: '[data-onboard="issues.fix"]', side: 'left', title: 'ob.page.issues.title', text: 'ob.page.issues.text' },
  { id: 'trash', selector: '[data-onboard="trash.restore"]', side: 'left', title: 'ob.page.trash.title', text: 'ob.page.trash.text' },
  { id: 'tags', selector: '[data-onboard="tags.more"]', side: 'left', title: 'ob.page.tags.title', text: 'ob.page.tags.text' },
  { id: 'settings', selector: '[data-onboard="set.machine"]', side: 'right', title: 'ob.page.set.title', text: 'ob.page.set.text' }
]

/** What the host found on the page this moment. */
export interface Facts {
  state: Pick<OnboardingState, 'off' | 'tourDone'>
  onBrowse: boolean
  /** The grid shows assets and no first registration is running here. */
  tourReady: boolean
  /** A dialog, menu or quick look is open. */
  overlay: boolean
  /** The first unseen page hint whose anchor is on screen. */
  page: PageHint | null
  /** The first on-screen cell of a format with an intro this browser has not shown yet. */
  format: { format: string; assetId: string } | null
  /** A hint was closed here: the next new-file hint waits for another place. */
  cooldown: boolean
}

export type Choice = { kind: 'tour' } | { kind: 'page'; hint: PageHint } | { kind: 'format'; format: string; assetId: string } | null

/** One bubble at a time: the tour, then this page's hint, then a new-file hint (onboarding.md「先后」). */
export function choose(f: Facts): Choice {
  if (f.state.off || f.overlay) return null
  if (f.onBrowse && !f.state.tourDone) return f.tourReady ? { kind: 'tour' } : null
  if (f.page) return { kind: 'page', hint: f.page }
  if (f.onBrowse && f.format && !f.cooldown) return { kind: 'format', ...f.format }
  return null
}

/**
 * Where the browse page "is" for the new-file cooldown: path and query without the one-shot `select`.
 * Moving to another folder, view, smart folder or query — or leaving the page — is another place.
 */
export function placeOf(pathname: string, search: string): string {
  const sp = new URLSearchParams(search)
  sp.delete('select')
  sp.sort()
  const q = sp.toString()
  return pathname.replace(/\/+$/, '') + (q ? `?${q}` : '')
}

/** The tour step to show at or after `from` whose anchor is present; null when none is left. */
export function nextStep(from: number, present: (step: TourStep) => boolean): number | null {
  for (let i = Math.max(0, from); i < TOUR.length; i++) if (present(TOUR[i]!)) return i
  return null
}

/* ───────────── placement ───────────── */

export interface Box { left: number; top: number; width: number; height: number }
export interface Placement {
  side: Side
  /** Bubble's top-left corner. */
  x: number
  y: number
  /** Hand's top-left corner (the hand points at the anchor from the bubble's side). */
  hx: number
  hy: number
}

export const HAND = 26
const GAP = 3
const MARGIN = 8
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/** Between lo and hi; lo wins when the window is too small for both. */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function at(side: Side, a: Box, w: number, h: number, vw: number, vh: number): Placement & { room: number; fits: boolean } {
  const cx = a.left + a.width / 2, cy = a.top + a.height / 2
  const right = a.left + a.width, bottom = a.top + a.height
  const reach = GAP + HAND + 2
  switch (side) {
    case 'bottom': {
      const y = bottom + reach
      return { side, x: clamp(cx - w / 2, MARGIN, vw - w - MARGIN), y, hx: clamp(cx - HAND / 2, MARGIN, vw - HAND - MARGIN), hy: bottom + GAP, room: vh - MARGIN - y - h, fits: y + h <= vh - MARGIN }
    }
    case 'top': {
      const y = a.top - reach - h
      return { side, x: clamp(cx - w / 2, MARGIN, vw - w - MARGIN), y, hx: clamp(cx - HAND / 2, MARGIN, vw - HAND - MARGIN), hy: a.top - GAP - HAND, room: y - MARGIN, fits: y >= MARGIN }
    }
    case 'right': {
      const x = right + reach
      return { side, x, y: clamp(cy - h / 2, MARGIN, vh - h - MARGIN), hx: right + GAP, hy: clamp(cy - HAND / 2, MARGIN, vh - HAND - MARGIN), room: vw - MARGIN - x - w, fits: x + w <= vw - MARGIN }
    }
    case 'left': {
      const x = a.left - reach - w
      return { side, x, y: clamp(cy - h / 2, MARGIN, vh - h - MARGIN), hx: a.left - GAP - HAND, hy: clamp(cy - HAND / 2, MARGIN, vh - HAND - MARGIN), room: x - MARGIN, fits: x >= MARGIN }
    }
  }
}

/**
 * Put the bubble beside the anchor: the preferred side if it fits, else its opposite, else the other two, else the
 * side with the most room (kept inside the window). The hand sits between bubble and anchor.
 */
export function place(anchor: Box, bubble: { width: number; height: number }, view: { width: number; height: number }, prefer: Side): Placement {
  const order: Side[] = [prefer, OPPOSITE[prefer], ...(['bottom', 'top', 'right', 'left'] as Side[]).filter(s => s !== prefer && s !== OPPOSITE[prefer])]
  const tries = order.map(s => at(s, anchor, bubble.width, bubble.height, view.width, view.height))
  const best = tries.find(p => p.fits) ?? tries.reduce((a, b) => (b.room > a.room ? b : a))
  const x = clamp(best.x, MARGIN, view.width - bubble.width - MARGIN)
  const y = clamp(best.y, MARGIN, view.height - bubble.height - MARGIN)
  return { side: best.side, x, y, hx: best.hx, hy: best.hy }
}
