/**
 * Shared parts of the compare views: loading a side, the view preset bar, side labels, zoom control, and a
 * small orbit-and-render loop on the page's single WebGL context.
 */
import * as React from 'react'
import * as THREE from 'three'
import { cn, type CompareSide } from '@bowerbird/plugin-sdk/web'
import { prepare, type Prepared } from '../thumbnail'
import { Orbit } from '../three/orbit'
import { Icon } from '../icons'
import { describeFailure } from '../failure'
import { useT, type Key, type T } from '../i18n'

export type LoadResult = { state: 'loading' } | { state: 'ready'; p: Prepared } | { state: 'error'; error: unknown }

/** Load one side's model (current content or a version: the FileSource decides). */
export function useModel(side: CompareSide | null): LoadResult {
  const [r, setR] = React.useState<LoadResult>({ state: 'loading' })
  const url = side?.source.url
  React.useEffect(() => {
    if (!side) return
    const ac = new AbortController()
    let p: Prepared | null = null
    setR({ state: 'loading' })
    prepare(side.source, side.asset.name, ac.signal).then(x => {
      if (ac.signal.aborted) { x.stage.dispose(); return }
      p = x
      x.stage.setDisplay({ ground: true, shadow: true, light: true })
      setR({ state: 'ready', p: x })
    }).catch((e: unknown) => { if (!ac.signal.aborted) setR({ state: 'error', error: e }) })
    return () => { ac.abort(); p?.stage.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])
  return r
}

/** Why a side cannot be shown (the same sentences as the viewer's). */
export function FailureNote({ error }: { error: unknown }) {
  const tr = useT()
  const { title, detail, raw } = describeFailure(error, tr)
  return (
    <span role="alert" className="grid max-w-sm gap-1">
      <b className="font-medium text-ink-1">{title}</b>
      {detail && <span className={cn('text-xs', raw && 'font-mono break-all')}>{detail}</span>}
    </span>
  )
}

/** Side label: A / B with the version (vN · 当前) or the name. */
export function SideLabel({ side, className }: { side: CompareSide; className?: string }) {
  const tr = useT()
  const v = side.version
  const current = ' · ' + tr('current')
  const text = v ? `v${v.n}${v.current ? current : ''}` : side.asset.versions.length > 1 ? `v${side.asset.versions.length}${current}` : side.asset.name
  return (
    <span className={cn('pointer-events-none absolute top-2 z-[3] inline-flex h-6 items-center gap-1.5 rounded-full bg-material-popover px-1 pr-2.5 text-xs text-ink-1 shadow-popover backdrop-popover', className)}>
      <i className="grid size-4 place-items-center rounded-full bg-fill-thumb text-[10px] font-semibold not-italic">{side.label}</i>{text}
    </span>
  )
}

export type ViewKey3 = 'persp' | 'front' | 'side' | 'back' | 'top'
export const VIEWS3: Record<ViewKey3, { th: number | null; ph: number }> = {
  persp: { th: null, ph: 0 },
  front: { th: 0, ph: Math.PI / 2 },
  side: { th: Math.PI / 2, ph: Math.PI / 2 },
  back: { th: Math.PI, ph: Math.PI / 2 },
  top: { th: 0, ph: 0.0015 }
}

/** A preset's button text (透视 / 正 / 侧 / 背 / 顶) and its title (正视图（正交）…). */
export function viewText(k: ViewKey3, tr: T): { label: string; title: string } {
  if (k === 'persp') return { label: tr('persp'), title: tr('persp') }
  return { label: tr(`view.${k}` as Key), title: tr(`view.${k}Ortho` as Key) }
}

export function ViewBar({ keys, value, onPick, link, className }: {
  keys: ViewKey3[]; value: string | null; onPick(k: ViewKey3): void
  link?: { on: boolean; toggle(): void }
  className?: string
}) {
  const tr = useT()
  return (
    <div role="toolbar" aria-label={tr('views')} className={cn('absolute bottom-3 z-[3] flex items-center gap-0.5 rounded-md bg-material-popover p-[3px] shadow-popover backdrop-popover', className)}>
      {keys.map(k => (
        <button key={k} type="button" aria-pressed={value === k} title={viewText(k, tr).title} onClick={() => onPick(k)}
          className={cn('inline-grid h-[26px] min-w-8 place-items-center rounded-sm px-2 text-xs transition-colors duration-fade',
            value === k ? 'bg-fill-thumb text-ink-1 shadow-raise' : 'text-ink-2 hover:bg-fill-hover hover:text-ink-1')}>
          {viewText(k, tr).label}
        </button>
      ))}
      {link && (
        <>
          <i className="mx-[3px] h-4 w-px bg-line-hairline" />
          <button type="button" aria-pressed={link.on} title={tr('linkTitle')} onClick={link.toggle}
            className={cn('inline-grid h-[26px] min-w-8 place-items-center rounded-sm px-2', link.on ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-fill-hover')}>
            <Icon name="link" size={12} />
          </button>
        </>
      )}
    </div>
  )
}

export function ZoomControl({ zoom, onZoom, onFit }: { zoom: number; onZoom(f: number): void; onFit(): void }) {
  const tr = useT()
  const btn = 'grid size-6 place-items-center rounded-md text-ink-2 hover:bg-fill-hover hover:text-ink-1'
  return (
    <div className="absolute right-3 bottom-3 z-[3] flex items-center gap-0.5 rounded-md bg-material-popover p-[3px] shadow-popover backdrop-popover">
      <button type="button" className={btn} aria-label={tr('zoomOut')} onClick={() => onZoom(0.8)}><Icon name="minus" size={12} /></button>
      <span className="bbm-num w-11 text-center text-[11px] text-ink-2">{Math.round(zoom * 100)}%</span>
      <button type="button" className={btn} aria-label={tr('zoomIn')} onClick={() => onZoom(1.25)}><Icon name="plus" size={12} /></button>
      <button type="button" className={btn} aria-label={tr('fit')} title={tr('fitTitle')} onClick={onFit}><Icon name="focus" size={12} /></button>
    </div>
  )
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-2">{children}</div>
}

/**
 * Orbit camera on a canvas with a render callback: drag to turn (Shift / right button pans), wheel to zoom,
 * double-click to go home. Renders only when something moves.
 */
export function useOrbitLoop(canvas: React.RefObject<HTMLCanvasElement | null>, bounds: { radius: number; center: THREE.Vector3 } | null,
  draw: (orbit: Orbit, persp: THREE.PerspectiveCamera, ortho: THREE.OrthographicCamera) => void, deps: unknown[]) {
  const orbitRef = React.useRef<Orbit | null>(null)
  const dirty = React.useRef(true)
  const drawRef = React.useRef(draw)
  drawRef.current = draw
  const cams = React.useMemo(() => ({ persp: new THREE.PerspectiveCamera(35, 1, 0.01, 100), ortho: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100) }), [])
  React.useEffect(() => {
    if (!bounds) return
    const home = bounds.radius / Math.sin((35 * Math.PI) / 360) * 1.15
    orbitRef.current = new Orbit(home, bounds.center)
    dirty.current = true
    let raf = 0, last = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      const o = orbitRef.current!
      if (o.step(dt, false) || dirty.current) { dirty.current = false; drawRef.current(o, cams.persp, cams.ortho) }
    }
    raf = requestAnimationFrame(loop)
    const c = canvas.current
    const wheel = (e: WheelEvent) => { e.preventDefault(); orbitRef.current?.zoom(e.deltaY); dirty.current = true }
    c?.addEventListener('wheel', wheel, { passive: false })
    return () => { cancelAnimationFrame(raf); c?.removeEventListener('wheel', wheel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds])
  React.useEffect(() => { dirty.current = true }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
      orbitRef.current?.begin(e.clientX, e.clientY, e.shiftKey || e.button === 2)
    },
    onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      const o = orbitRef.current
      if (!o?.drag) return
      o.move(e.clientX, e.clientY, cams.persp)
      dirty.current = true
    },
    onPointerUp() { orbitRef.current?.end() },
    onPointerCancel() { orbitRef.current?.end() },
    onContextMenu(e: React.MouseEvent) { e.preventDefault() }
  }
  return { orbit: orbitRef, invalidate: () => { dirty.current = true }, handlers, cams }
}
