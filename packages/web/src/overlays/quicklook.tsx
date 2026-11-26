import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@bowerbird/plugin-sdk/web'
import { Icon } from '../components/Icon'
import { AssetThumb, DocCard } from '../components/AssetThumb'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { fmtSize } from '../lib/format'
import { createFileSource, PluginSlot, usePluginRegistry } from '../plugins/registry'
import { browseContext, hasRuntime, rt } from '../shell/runtime'
import { openAssetDetail } from '../detail/nav'
import { findSummary } from '../flows/cache'
import { badgeText } from '../plugins/text'

/**
 * Quick look (space): a floating viewer over the page; ← → step through `ids`; Esc / Space closes and returns focus.
 * Opens from the thumbnail rect and returns to it (design-system Motion). Audio plays here, never on hover.
 * Owner: line web-1. Used by browse (web-1) and the relation graph (web-2).
 */
export interface QuickLookOptions {
  ids: string[]
  index: number
  /** Element the panel grows from / returns to. */
  origin?: HTMLElement | null
  /** Called when ← → moves (graph keeps its own highlight in sync). */
  onIndexChange?: (index: number) => void
  onClose?: () => void
  /** Element to return to for a given id after stepping (defaults to the grid cell `[data-asset-cell=id]`). */
  originFor?: (id: string) => HTMLElement | null
}
let impl: ((o: QuickLookOptions) => void) | null = null
export function openQuickLook(o: QuickLookOptions): void { impl?.(o) }
export function setQuickLookImpl(fn: (o: QuickLookOptions) => void): void { impl = fn }
let closeImpl: (() => void) | null = null
export function closeQuickLook(): void { closeImpl?.() }
let openFlag = false
export function isQuickLookOpen(): boolean { return openFlag }

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="slider"]'
/** A control inside the viewer that uses Space / Enter / arrows itself. */
function isControl(el: HTMLElement): boolean {
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable) return true
  const role = el.getAttribute('role')
  return !!role && /^(slider|button|tab|switch|checkbox|radio|menuitem|option|spinbutton|textbox|combobox)$/.test(role)
}

function rectOf(el: HTMLElement | null | undefined): DOMRect | null {
  const thumb = el?.querySelector<HTMLElement>('[data-thumb]') ?? el
  return thumb ? thumb.getBoundingClientRect() : null
}

export function QuickLookHost() {
  const [o, setO] = React.useState<QuickLookOptions | null>(null)
  const [index, setIndex] = React.useState(0)
  const [phase, setPhase] = React.useState<'from' | 'open' | 'closing'>('from')
  const panel = React.useRef<HTMLDivElement | null>(null)
  const prevFocus = React.useRef<Element | null>(null)

  React.useEffect(() => {
    setQuickLookImpl(opts => { prevFocus.current = document.activeElement; setO(opts); setIndex(Math.max(0, Math.min(opts.index, opts.ids.length - 1))); setPhase('from') })
    return () => setQuickLookImpl(() => {})
  }, [])
  openFlag = !!o && phase !== 'closing'

  const id = o?.ids[index]
  const box = React.useMemo(() => {
    const vw = window.innerWidth, vh = window.innerHeight
    const w = Math.min(vw * 0.64, 900), h = Math.min(vh * 0.82, 680)
    return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
  }, [o])

  const transformFrom = React.useCallback((forId: string | undefined) => {
    if (!o || !forId) return 'scale(0.9)'
    const el = o.originFor?.(forId) ?? (forId === o.ids[o.index] ? o.origin : null) ?? document.querySelector<HTMLElement>(`[data-asset-cell="${CSS.escape(forId)}"]`)
    const r = rectOf(el)
    if (!r || !r.width) return 'scale(0.9)'
    return `translate(${r.left - box.x}px, ${r.top - box.y}px) scale(${r.width / box.w}, ${r.height / box.h})`
  }, [o, box])

  React.useLayoutEffect(() => {
    if (o && phase === 'from') { void panel.current?.offsetWidth; const raf = requestAnimationFrame(() => setPhase('open')); return () => cancelAnimationFrame(raf) }
  }, [o, phase])

  // the options currently shown: a close that finishes after quick look was opened again must not close the new one
  const current = React.useRef<QuickLookOptions | null>(null)
  current.current = o
  const close = React.useCallback(() => {
    if (!o) return
    setPhase('closing')
    const done = o.onClose
    const closing = o
    setTimeout(() => {
      done?.()
      if (current.current !== closing) return
      setO(null); (prevFocus.current as HTMLElement | null)?.focus?.()
    }, 420)
  }, [o])
  React.useEffect(() => { closeImpl = close; return () => { closeImpl = null } }, [close])

  const step = React.useCallback((d: number) => {
    if (!o) return
    const j = index + d
    if (j < 0 || j >= o.ids.length) return
    setIndex(j)
    o.onIndexChange?.(j)
  }, [o, index])

  const openDetail = React.useCallback(() => {
    if (!id || !hasRuntime()) return
    const { navigate, lib } = rt()
    const b = browseContext()
    setO(null)
    openAssetDetail(navigate, lib, id, b ? { fromLabel: b.label, list: b.list() } : {})
  }, [id])

  /* Keys: listened to after the viewer had its turn (bubble phase, not capture) — a plugin viewer's slider, field or
     button keeps its own Space, Enter and arrows; Escape always closes. Focus moves into the panel and stays there. */
  React.useEffect(() => {
    if (!o || phase === 'closing') return
    const on = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inPanel = !!target && !!panel.current?.contains(target)
      if (!inPanel && target?.closest?.('[role="dialog"],[role="alertdialog"],[role="menu"]')) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
      if (e.defaultPrevented) return
      if (inPanel && target !== panel.current && isControl(target!)) return
      if (e.key === ' ') { e.preventDefault(); close() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1) }
      else if (e.key === 'Enter') { e.preventDefault(); openDetail() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [o, phase, close, step, openDetail])
  React.useEffect(() => { if (o && phase === 'open') panel.current?.focus({ preventScroll: true }) }, [o, phase])
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return
    const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => !x.hasAttribute('disabled') && x.offsetParent !== null)
    if (!f.length) { e.preventDefault(); return }
    const first = f[0]!, last = f[f.length - 1]!
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  if (!o || !id) return null
  const open = phase === 'open'
  return (
    <div data-bb-overlay className="fixed inset-0 z-[32]" role="presentation">
      <div className="absolute inset-0 bg-material-scrim transition-opacity duration-fade ease-out-bb" style={{ opacity: open ? 1 : 0 }} onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-modal
        aria-label={t('act.quicklook')}
        tabIndex={-1}
        onKeyDown={trap}
        className="absolute flex origin-top-left flex-col overflow-hidden rounded-xl bg-surface-raised shadow-dialog"
        style={{
          left: box.x, top: box.y, width: box.w, height: box.h,
          transform: open ? 'none' : transformFrom(id),
          opacity: phase === 'closing' ? 0 : open ? 1 : 0.4,
          transition: phase === 'from' ? 'none' : 'transform var(--duration-settle) var(--spring-settle), opacity var(--duration-fade) var(--ease-out)'
        }}
      >
        <QuickLookBody id={id} onOpen={openDetail} onClose={close} />
      </div>
    </div>
  )
}

function QuickLookBody({ id, onOpen, onClose }: { id: string; onOpen: () => void; onClose: () => void }) {
  const lib = hasRuntime() ? rt().lib : ''
  const summary = hasRuntime() ? findSummary(rt().qc, lib, id) : null
  const detail = useQuery({ queryKey: qk.asset(lib, id), queryFn: () => api.assets.get(lib, id), enabled: !!lib })
  const reg = usePluginRegistry()
  const a = detail.data ?? summary
  const fv = a ? reg.formatView(a.format) : null
  const source = React.useMemo(() => (detail.data ? createFileSource(lib, detail.data) : null), [lib, detail.data])
  if (!a) return <div className="grid flex-1 place-items-center text-ink-3"><Icon name="loader" className="bb-spin" /></div>
  return (
    <>
      <div className="grid min-h-0 flex-1 place-items-center bg-surface-well">
        {fv && detail.data && source
          ? <div className="flex size-full min-h-0"><PluginSlot pluginId={fv.pluginId} component={fv.view.Viewer} props={{ asset: detail.data, source, mode: 'quicklook' as const }} /></div>
          : a.cellText && !a.thumbnail
            ? <DocCard large title={a.cellText.title ?? a.name} excerpt={a.cellText.excerpt} />
            : <AssetThumb asset={a} fit="contain" className="bg-transparent" />}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-3 pr-3 pl-4">
        <b className="min-w-0 truncate font-semibold">{a.name}</b>
        <StageMark stage={a.stage} label="short" />
        <ReviewMark review={a.review} label />
        {a.issueLevel && <IssueMark level={a.issueLevel} flags={a.flags} label corner={false} />}
        <span className="flex-1" />
        <small className="text-[12px] tabular-nums text-ink-2">{[badgeText(reg, a), fmtSize(a.size)].filter(Boolean).join(' · ')}</small>
        <Button size="sm" onClick={onOpen} title={`${t('ql.open')} ↵`}>{t('ql.open')}</Button>
        <Button variant="ghost" size="icon" aria-label={t('ql.close')} title={`${t('ql.close')} ${t('common.space')}`} onClick={onClose}><Icon name="x" /></Button>
      </div>
    </>
  )
}
