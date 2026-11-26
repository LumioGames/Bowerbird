import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t, useLocale } from '../lib/i18n'
import { overlayOpen } from '../lib/shortcuts'
import { isQuickLookOpen } from '../overlays/quicklook'
import { registering } from '../flows/library'
import { usePluginRegistry, type PluginRegistry } from '../plugins/registry'
import { formatName } from '../plugins/text'
import { openAssetDetail } from '../detail/nav'
import { libPath } from '../shell/runtime'
import { Coach } from './Coach'
import { choose, nextStep, PAGE_HINTS, placeOf, TOUR, type Facts, type PageHint, type Side } from './model'
import { finishTour, formatKey, getOnboarding, hasSeen, markSeen, pageKey, useOnboarding, type OnboardingState } from './store'

/**
 * Shows at most one onboarding hint (onboarding.md, ADR-064): the browse-page tour, the first-visit hint of the page
 * on screen, or the hint for a kind of file the grid shows for the first time. It looks at the page a few times a
 * second for the marks the hints point at, and stops looking once nothing is left to show; nothing is shown while
 * hints are off or a dialog, menu or quick look is open. Mounted once by the shell frame.
 */
const POLL_MS = 250
/** A tour step whose anchor stays away this long is skipped (side bar folded, inspector closed). */
const STEP_WAIT_MS = 1500
/** …longer for the step that first selects an asset: the inspector has to load it. */
const SELECT_WAIT_MS = 4000

/** The anchor of the hint on screen: a toast passing over it does not take the hint away. */
let shownAnchor: Element | null = null

/** Still somewhere in the window. */
function inWindow(el: Element): boolean {
  if (!el.isConnected) return false
  const r = el.getBoundingClientRect()
  return r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
}
/** On screen and not covered (the centre of it is what the pointer would hit). */
export function onScreen(el: Element): boolean {
  if (!inWindow(el)) return false
  if (el === shownAnchor) return true
  const r = el.getBoundingClientRect()
  const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2))
  const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 16)))
  // the topmost thing there, not counting our own bubble (it may sit over the next step's anchor)
  const hit = document.elementsFromPoint(x, y).find(e => !e.closest('[data-onboard-bubble]'))
  return !!hit && (hit === el || el.contains(hit))
}
/** Visible matches in reading order (top, then left); `keep` filters before the (costlier) visibility test. */
function visibleAll(selector: string, keep?: (el: HTMLElement) => boolean): HTMLElement[] {
  const out: Array<{ el: HTMLElement; top: number; left: number }> = []
  document.querySelectorAll<HTMLElement>(selector).forEach(el => {
    if (keep && !keep(el)) return
    if (el.closest('[data-onboard-bubble]') || !onScreen(el)) return
    const r = el.getBoundingClientRect()
    out.push({ el, top: Math.round(r.top), left: Math.round(r.left) })
  })
  out.sort((a, b) => a.top - b.top || a.left - b.left)
  return out.map(o => o.el)
}
const firstVisible = (selector: string) => visibleAll(selector)[0] ?? null
/** A tour step can be shown now: its anchor is on screen, or it is the step that selects an asset first. */
const stepPresent = (st: (typeof TOUR)[number]) => !!firstVisible(st.selector) || !!st.needsSelection

function introOf(reg: PluginRegistry, format: string, locale: string): string | null {
  const fv = reg.formatView(format)
  if (!fv?.view.intro) return null
  try { const s = fv.view.intro(locale as never); return s && s.trim() ? s : null } catch { return null }
}

/** Nothing could ever show again (until「重新看导览」): the tour is over and every hint there is has been seen. */
export function allSeen(s: Pick<OnboardingState, 'tourDone' | 'seen'>, introFormats: readonly string[]): boolean {
  return s.tourDone && PAGE_HINTS.every(h => s.seen.includes(pageKey(h.id))) && introFormats.every(f => s.seen.includes(formatKey(f)))
}

interface Shown {
  key: string
  kind: 'tour' | 'page' | 'format'
  anchor: HTMLElement
  side: Side
  title: string
  text: string
  hint?: PageHint
  format?: string
  assetId?: string
}

/** The tour's「跳过」for the browse page's `Esc` (after its own: filter panel, selection). */
let skipHandler: (() => boolean) | null = null
export function skipTourByEscape(): boolean { return skipHandler?.() ?? false }

export function OnboardingHost({ lib }: { lib: string }) {
  const state = useOnboarding()
  const loc = useLocation()
  const navigate = useNavigate()
  const reg = usePluginRegistry()
  const locale = useLocale()
  const plugins = useQuery({ queryKey: qk.plugins(), queryFn: () => api.plugins.list() })
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
  const onBrowse = loc.pathname.replace(/\/+$/, '') === libPath(lib)
  const place = placeOf(loc.pathname, loc.search)

  const [step, setStep] = React.useState(0)
  const [cooldown, setCooldown] = React.useState<string | null>(null)
  const [shown, setShown] = React.useState<Shown | null>(null)
  /** Since when the current step's anchor has been away (null while it is on screen). */
  const missingSince = React.useRef<number | null>(null)
  /** The person pressed a tour button from the keyboard: the next bubble takes the focus over. */
  const [refocus, setRefocus] = React.useState(false)
  /** What the bubble says, for screen readers (a live region that stays mounted, so the change is announced). */
  const [said, setSaid] = React.useState('')

  // 「重新看导览」starts over; the next new-file hint waits until the place changes.
  React.useEffect(() => { setStep(0); setCooldown(null); missingSince.current = null }, [state.rev])
  React.useEffect(() => { setCooldown(c => (c !== null && c !== place ? null : c)) }, [place])
  React.useEffect(() => { missingSince.current = null }, [step])
  React.useEffect(() => { shownAnchor = shown?.anchor ?? null; setSaid(shown ? `${shown.title}。${shown.text}` : '') }, [shown])
  React.useEffect(() => () => { shownAnchor = null }, [])

  const formatTitle = React.useCallback((format: string) => {
    for (const p of plugins.data?.plugins ?? []) {
      const f = p.formats.find(x => x.id === format)
      if (f) return formatName({ ...f, plugin: p.id })
    }
    return format
  }, [plugins.data])
  /** Formats of the enabled plugins that have a new-file sentence. */
  const introFormats = React.useMemo(() => {
    if (!reg.ready) return null
    return (plugins.data?.plugins ?? []).flatMap(p => p.formats.map(f => f.id)).filter(f => !!introOf(reg, f, locale))
  }, [plugins.data, reg, locale])
  const done = !!introFormats && allSeen(state, introFormats)

  /* look at the page */
  const evaluate = React.useCallback(() => {
    const s = getOnboarding()
    const overlay = overlayOpen() || isQuickLookOpen()
    const tourReady = onBrowse && !s.tourDone && !registering(lib) && info.data?.state !== 'uninitialized' && !!firstVisible('[data-asset-cell]')
    let page: PageHint | null = null
    if (!s.off) {
      for (const h of PAGE_HINTS) {
        if (hasSeen(pageKey(h.id), s)) continue
        if (h.when && !document.querySelector(h.when)) continue
        if (firstVisible(h.selector)) { page = h; break }
      }
    }
    let format: Facts['format'] = null
    if (!s.off && onBrowse && s.tourDone && cooldown === null) {
      const el = visibleAll('[data-asset-cell][data-format]', c => !hasSeen(formatKey(c.dataset.format!), s) && !!introOf(reg, c.dataset.format!, locale))[0]
      if (el) format = { format: el.dataset.format!, assetId: el.dataset.assetCell! }
    }
    const choice = choose({ state: s, onBrowse, tourReady, overlay, page, format, cooldown: cooldown !== null })

    let next: Shown | null = null
    if (choice?.kind === 'tour') {
      // the current step; one whose anchor stays away long enough gives way to the next one that is there
      const cur = TOUR[step]
      const el = cur ? firstVisible(cur.selector) : null
      if (cur && el) {
        missingSince.current = null
        next = { key: `tour:${cur.id}`, kind: 'tour', anchor: el, side: cur.side, title: t(cur.title), text: t(cur.text) }
      } else if (cur) {
        const now = Date.now()
        missingSince.current ??= now
        if (now - missingSince.current > (cur.needsSelection ? SELECT_WAIT_MS : STEP_WAIT_MS)) {
          const n = nextStep(step + 1, stepPresent)
          if (n === null) { finishTour(); setCooldown(place) } else setStep(n)
        }
      }
    } else {
      // the wait counts only while the tour is what would show (not while away from the page or under a dialog)
      missingSince.current = null
      if (choice?.kind === 'page') {
        const h = choice.hint
        const el = firstVisible(h.selector)!
        next = { key: `page:${h.id}:${h.selector}`, kind: 'page', anchor: el, side: h.side, title: t(h.title), text: t(h.text, { n: el.dataset.onboardN ?? '' }), hint: h }
      } else if (choice?.kind === 'format') {
        const el = document.querySelector<HTMLElement>(`[data-asset-cell="${CSS.escape(choice.assetId)}"]`)
        if (el) next = { key: `format:${choice.format}`, kind: 'format', anchor: el, side: 'bottom', title: formatTitle(choice.format), text: introOf(reg, choice.format, locale) ?? '', format: choice.format, assetId: choice.assetId }
      }
    }
    setShown(prev => {
      if (!next) return null
      // keep the same element while it is still there, so the bubble does not jump between equal matches
      if (prev && prev.key === next.key && inWindow(prev.anchor)) return prev.title === next.title && prev.text === next.text ? prev : { ...prev, title: next.title, text: next.text }
      return next
    })
  }, [onBrowse, lib, info.data?.state, reg, locale, cooldown, step, place, formatTitle])

  React.useEffect(() => {
    if (state.off || done) { setShown(null); return }
    evaluate()
    const id = window.setInterval(evaluate, POLL_MS)
    return () => window.clearInterval(id)
  }, [evaluate, state.off, done, state.tourDone, state.seen.length, loc.key])

  /* a tour step that needs a selected asset selects the first one (the inspector then shows it) */
  React.useEffect(() => {
    if (!onBrowse || state.off || state.tourDone || !TOUR[step]?.needsSelection) return
    if (document.querySelector('[data-asset-cell][aria-selected="true"]')) return
    const first = firstVisible('[data-asset-cell]')
    const id = first?.dataset.assetCell
    if (!id) return
    const sp = new URLSearchParams(loc.search)
    sp.set('select', id)
    navigate({ pathname: loc.pathname, search: `?${sp}` }, { replace: true })
  }, [step, onBrowse, state.off, state.tourDone]) // eslint-disable-line react-hooks/exhaustive-deps

  /* tour buttons */
  const fromKeyboard = () => !!document.activeElement?.closest('[data-onboard-bubble]') && document.activeElement !== document.body
  const endTour = React.useCallback(() => { finishTour(); setCooldown(place); setShown(null); setRefocus(false) }, [place])
  const advance = React.useCallback(() => {
    const n = nextStep(step + 1, stepPresent)
    if (n === null) { endTour(); return }
    setRefocus(fromKeyboard())
    setStep(n)
    setShown(null)
  }, [step, endTour])

  // Esc on the browse page, once the page has nothing of its own to close
  React.useEffect(() => {
    skipHandler = () => { if (shown?.kind !== 'tour') return false; endTour(); return true }
    return () => { skipHandler = null }
  }, [shown, endTour])

  /*
   * Pressing the button a page hint points at counts as seeing it. Pointer down, not click: some of them open a menu
   * on pointer down, and the menu would hide the hint (and this listener) before the click arrives. Click still covers
   * the keyboard (Enter / Space on the button).
   */
  React.useEffect(() => {
    if (shown?.kind !== 'page') return
    const on = (e: Event) => { if (shown.anchor.contains(e.target as Node)) markSeen(pageKey(shown.hint!.id)) }
    document.addEventListener('pointerdown', on, true)
    document.addEventListener('click', on, true)
    return () => { document.removeEventListener('pointerdown', on, true); document.removeEventListener('click', on, true) }
  }, [shown])

  const live = <div role="status" aria-live="polite" className="sr-only" data-onboard-live>{said}</div>
  if (!shown || state.off) return live

  const gotIt = () => {
    if (shown.kind === 'page') markSeen(pageKey(shown.hint!.id))
    else if (shown.kind === 'format') { markSeen(formatKey(shown.format!)); setCooldown(place) }
    setShown(null)
  }

  let buttons: React.ReactNode
  if (shown.kind === 'tour') {
    const last = nextStep(step + 1, stepPresent) === null
    buttons = <>
      <span className="text-[12px] leading-4 text-ink-3 tabular-nums">{t('ob.tour.count', { n: step + 1, total: TOUR.length })}</span>
      <span className="grow" />
      <Button variant="ghost" size="sm" onClick={endTour}>{t('ob.skip')}</Button>
      <Button variant="primary" size="sm" data-primary onClick={last ? endTour : advance}>{t(last ? 'ob.done' : 'ob.next')}</Button>
    </>
  } else if (shown.kind === 'page') {
    buttons = <><span className="grow" /><Button variant="primary" size="sm" data-primary onClick={gotIt}>{t('ob.gotIt')}</Button></>
  } else {
    buttons = <>
      <span className="grow" />
      <Button variant="ghost" size="sm" onClick={gotIt}>{t('ob.gotIt')}</Button>
      <Button variant="primary" size="sm" data-primary onClick={() => { markSeen(formatKey(shown.format!)); setCooldown(place); setShown(null); openAssetDetail(navigate, lib, shown.assetId!) }}>{t('ob.open')}</Button>
    </>
  }

  return (
    <>
      {live}
      <Coach anchor={shown.anchor} side={shown.side} title={shown.title} text={shown.text} showKey={shown.key} focusPrimary={refocus && shown.kind === 'tour'}
        onKeyDown={e => { if (e.key === 'Escape' && shown.kind === 'tour') { e.preventDefault(); endTour() } }}>
        {buttons}
      </Coach>
    </>
  )
}
