import * as React from 'react'

/**
 * Progressive fitting for a bar that runs out of room (a narrow window, a longer language). `level` is how many steps
 * of giving way are in force — 0 = everything at full size; the bar decides what each step folds (a label into its
 * icon, a control into a popover, a second row). `deficit(el)` says how many pixels the bar is short: what it cuts that
 * it should not (a name ending in「…」, its own overflow). While it is short and steps are left, one more step is taken;
 * once the bar is back to the width a step needed, that step is undone. Measured before paint, again on every resize,
 * and from the start whenever `content` (what the bar shows: labels, language) changes. `ref` goes on the bar.
 */
export function useFit<T extends HTMLElement>(max: number, deficit: (el: T) => number, content: unknown): { ref: (el: T | null) => void; level: number } {
  const [el, setEl] = React.useState<T | null>(null)
  const elRef = React.useRef<T | null>(null)
  elRef.current = el
  const [level, setLevel] = React.useState(0)
  const levelRef = React.useRef(0)
  levelRef.current = level
  /** need[l]: the width the bar needed at level l when it was found short there. */
  const need = React.useRef<number[]>([])
  const deficitRef = React.useRef(deficit)
  deficitRef.current = deficit
  const skip = React.useRef(false)

  const check = React.useCallback(() => {
    const node = elRef.current
    if (!node?.isConnected) return
    if (skip.current) { skip.current = false; return }
    const w = node.clientWidth
    if (!w) return
    const d = deficitRef.current(node)
    const l = levelRef.current
    if (d > 0 && l < max) { need.current[l] = w + d; levelRef.current = l + 1; setLevel(l + 1) }
    else if (d <= 0 && l > 0 && w >= (need.current[l - 1] ?? Infinity)) { levelRef.current = l - 1; setLevel(l - 1) }
  }, [max])

  const contentKey = JSON.stringify(content)
  const seen = React.useRef(contentKey)
  React.useLayoutEffect(() => {
    if (seen.current === contentKey) return
    seen.current = contentKey
    need.current = []
    if (levelRef.current !== 0) { skip.current = true; levelRef.current = 0; setLevel(0) }
  }, [contentKey])
  React.useLayoutEffect(() => { check() })
  // the bar and what is in it (a name arriving later, a font finishing loading) can change size without a render here
  React.useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => check())
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    return () => ro.disconnect()
  }, [el, check, level, contentKey])
  React.useEffect(() => { void document.fonts?.ready.then(() => check()) }, [check])
  return { ref: setEl, level }
}

/** How much an element's content is cut (its scroll width past its box), in pixels. */
export function cut(el: Element | null | undefined): number {
  return el instanceof HTMLElement ? Math.max(0, el.scrollWidth - el.clientWidth) : 0
}
