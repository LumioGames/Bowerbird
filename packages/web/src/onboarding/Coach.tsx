import * as React from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { HAND, place, type Side } from './model'

/**
 * The one look every hint has (onboarding.md「提示的样子」): a bubble (small title, one sentence, buttons), a hand
 * between bubble and anchor pointing at it and tapping, and a soft accent ring around the anchor. Fixed to the
 * window and following the anchor every frame (it moves when the page scrolls or a panel is dragged). It is not a
 * dialog and takes the focus only from a previous bubble's buttons, so the page's own keys keep working; the host's
 * live region announces the sentence.
 */
export function Coach(p: {
  anchor: HTMLElement
  side: Side
  title: string
  text: string
  /** Buttons (and the step counter) at the bottom of the bubble. */
  children: React.ReactNode
  /** Identity of what is shown: a new key plays the entrance again. */
  showKey: string
  /** Move the focus to the bubble's main button (the person was already on the previous bubble's buttons). */
  focusPrimary?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
  const bubble = React.useRef<HTMLDivElement | null>(null)
  const hand = React.useRef<HTMLDivElement | null>(null)
  const ring = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      const b = bubble.current, h = hand.current, r = ring.current
      if (b && h && r) {
        const a = p.anchor.getBoundingClientRect()
        const pl = place({ left: a.left, top: a.top, width: a.width, height: a.height }, { width: b.offsetWidth, height: b.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, p.side)
        const key = `${a.left},${a.top},${a.width},${a.height},${pl.x},${pl.y},${pl.side}`
        if (key !== last) {
          last = key
          b.style.transform = `translate(${Math.round(pl.x)}px, ${Math.round(pl.y)}px)`
          h.style.transform = `translate(${Math.round(pl.hx)}px, ${Math.round(pl.hy)}px)`
          h.dataset.side = pl.side
          b.dataset.side = pl.side
          r.style.transform = `translate(${Math.round(a.left - 3)}px, ${Math.round(a.top - 3)}px)`
          r.style.width = `${Math.round(a.width + 6)}px`
          r.style.height = `${Math.round(a.height + 6)}px`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [p.anchor, p.side, p.showKey])

  React.useEffect(() => {
    if (p.focusPrimary) bubble.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true })
  }, [p.showKey, p.focusPrimary])

  return createPortal(
    <>
      <div ref={ring} className="bb-coach-ring" aria-hidden data-onboard-ring />
      <div ref={hand} className="bb-coach-hand" aria-hidden style={{ width: HAND, height: HAND }}>
        <span className="bb-coach-dir"><span className="bb-coach-tap"><Icon name="pointer" size={24} /></span></span>
      </div>
      <div
        key={p.showKey}
        ref={bubble}
        role="region"
        aria-label={p.title}
        data-onboard-bubble={p.showKey}
        onKeyDown={p.onKeyDown}
        className="bb-coach fixed top-0 left-0 z-[40] w-[280px] max-w-[calc(100vw-16px)] rounded-md bg-surface-raised p-3 text-ink-1 shadow-popover"
      >
        <div className="text-[12px] leading-4 font-semibold text-ink-1">{p.title}</div>
        <p className="mt-1 text-[13px] leading-[19px] text-ink-2">{p.text}</p>
        <div className="mt-2.5 flex items-center gap-1.5">{p.children}</div>
      </div>
    </>,
    document.body
  )
}
