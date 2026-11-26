import * as React from 'react'

/** Rows mounted around the view: what is visible, plus this many on each side. */
export const OVERSCAN = 8
/** Height assumed for the view before it can be measured (and in tests, where nothing has a size). */
const FALLBACK_VIEW = 900

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/** The slice of a fixed-height list that is in view of `scroller`, given the list's top relative to the scroller. */
export function windowOf(count: number, rowHeight: number, listTop: number, viewHeight: number, overscan = OVERSCAN): { start: number; end: number } {
  const h = viewHeight > 0 ? viewHeight : FALLBACK_VIEW
  const first = Math.floor(-listTop / rowHeight)
  const last = Math.ceil((h - listTop) / rowHeight)
  const start = Math.max(0, Math.min(count, first - overscan))
  const end = Math.max(start, Math.min(count, last + overscan))
  return { start, end }
}

/**
 * Virtual rows for web-2's long lists (回收站, 完整性): only the rows in and around the view of the page's scroll
 * container are mounted; spacers keep the scroll height. Several lists can share one scroller (完整性 groups rows by
 * type) — each measures where it starts. Rows must be `rowHeight` tall. The spacers span every grid column, so the
 * rows may be `display: contents` cells of a CSS grid.
 */
export function VirtualRows({ count, rowHeight, children, overscan = OVERSCAN, scrollToIndex = null }: {
  count: number; rowHeight: number; children(i: number): React.ReactNode; overscan?: number
  /** Bring this row into the middle of the view (once per value), e.g. the issue a link points at. */
  scrollToIndex?: number | null
}) {
  const anchor = React.useRef<HTMLDivElement>(null)
  const [win, setWin] = React.useState(() => windowOf(count, rowHeight, 0, 0, overscan))
  const measure = React.useCallback(() => {
    const a = anchor.current
    if (!a) return
    const s = scrollParent(a)
    const top = s ? a.getBoundingClientRect().top - s.getBoundingClientRect().top : a.getBoundingClientRect().top
    const next = windowOf(count, rowHeight, top, s ? s.clientHeight : window.innerHeight, overscan)
    setWin(w => (w.start === next.start && w.end === next.end ? w : next))
  }, [count, rowHeight, overscan])
  React.useLayoutEffect(() => {
    measure()
    const s = scrollParent(anchor.current)
    const target: HTMLElement | Window = s ?? window
    target.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' && s ? new ResizeObserver(measure) : null
    if (ro && s) ro.observe(s)
    return () => { target.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [measure])
  const scrolled = React.useRef<number | null>(null)
  React.useLayoutEffect(() => {
    if (scrollToIndex == null || scrolled.current === scrollToIndex) return
    const a = anchor.current, sc = scrollParent(anchor.current)
    if (!a || !sc) return
    scrolled.current = scrollToIndex
    const rowTop = a.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + scrollToIndex * rowHeight
    sc.scrollTop = Math.max(0, rowTop - Math.max(0, (sc.clientHeight - rowHeight) / 2))
    measure()
  }, [scrollToIndex, rowHeight, measure])
  const { start, end } = win
  const rows: React.ReactNode[] = []
  for (let i = start; i < Math.min(end, count); i++) rows.push(<React.Fragment key={i}>{children(i)}</React.Fragment>)
  return (
    <>
      <div ref={anchor} aria-hidden data-virtual-pad="before" style={{ height: start * rowHeight, gridColumn: '1 / -1' }} />
      {rows}
      <div aria-hidden data-virtual-pad="after" style={{ height: Math.max(0, count - Math.min(end, count)) * rowHeight, gridColumn: '1 / -1' }} />
    </>
  )
}
