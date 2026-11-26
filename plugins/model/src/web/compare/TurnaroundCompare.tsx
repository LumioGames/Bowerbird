/**
 * A model against an image (builtin-plugins.md「模型对照四视图」, ADR-019, prototype compare.js overlayMI / FMT.mi).
 *
 * Wipe (default) and overlay: the model is rendered orthographically for 正 / 侧 / 背 / 顶 and placed on that view's
 * cell of the sheet — bottom edges and centres aligned, the same height (or width). The drawing's extent is
 * boxed with a dashed line, the model's with a solid one, and their width-to-height deviation is given;
 * over 5 % it is marked. Size lines on the sheet come from the design object's size at the front view's
 * scale; the readout compares the model with the target. Numbers are for people to look at, never a verdict.
 *
 * Side by side: the model in its own viewport beside the picture; with a grid, picking a view frames that cell.
 * An image without a grid can only be side by side (compareModes says why).
 */
import * as React from 'react'
import * as THREE from 'three'
import { cn, Dialog, DialogPortal, type CompareProps, type CompareSide } from '@bowerbird/plugin-sdk/web'
import { getHub, pixelRatio } from '../three/hub'
import { builtinEnv, envGradient } from '../three/env'
import { modelSettings } from '../settings'
import {
  aspectDeviation, axisName, cellPaper, impliedSizes, measureRaster, orthoFit, sheetViews, trimCell, VIEW_AXES, VIEW_DIR, viewLabel, VIEW_ORDER,
  type FitBy, type Rect, type SheetView, type ViewKey
} from '../lib/turnaround'
import { sizeMatches } from '../../shared/size'
import { hasViewCells, MODEL_FORMAT } from '../lib/compare-modes'
import { Centered, FailureNote, SideLabel, useModel, useOrbitLoop, ViewBar, VIEWS3, ZoomControl, type ViewKey3 } from './common'
import { Seg } from '../viewer/ui'
import { useT } from '../i18n'

const STUDIO = envGradient(builtinEnv('studio')!)

/** The picture with its natural size and, once rasterised, the drawn extent of each grid cell. */
function useSheet(side: CompareSide, withGrid: boolean) {
  const [img, setImg] = React.useState<{ el: HTMLImageElement; w: number; h: number } | null>(null)
  const [trims, setTrims] = React.useState<Partial<Record<ViewKey, Rect | null>>>({})
  const [papers, setPapers] = React.useState<Partial<Record<ViewKey, string>>>({})
  const [error, setError] = React.useState(false)
  const tr = useT()
  const url = side.source.url
  const viewsKey = JSON.stringify(side.asset.views)
  React.useEffect(() => {
    let live = true
    const el = new Image()
    el.decoding = 'async'
    el.onload = () => {
      if (!live) return
      setImg({ el, w: el.naturalWidth, h: el.naturalHeight })
      if (!withGrid) return
      try {
        // the image viewer's raster and rule (measureRaster, trimCell), so both measure the same figure
        const { w, h } = measureRaster(el.naturalWidth, el.naturalHeight)
        const c = document.createElement('canvas'); c.width = w; c.height = h
        const ctx = c.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(el, 0, 0, w, h)
        const data = ctx.getImageData(0, 0, w, h).data
        const views = sheetViews(side.asset.views)
        const out: Partial<Record<ViewKey, Rect | null>> = {}, paper: Partial<Record<ViewKey, string>> = {}
        for (const k of VIEW_ORDER) {
          const v = views?.[k]
          if (!v) continue
          out[k] = trimCell(data, w, h, v.cell)
          const p = cellPaper(data, w, h, v.cell)
          if (p) paper[k] = p
        }
        setTrims(out)
        setPapers(paper)
      } catch { /* tainted canvas: keep the inset cells */ }
    }
    el.onerror = () => { if (live) setError(true) }
    el.src = url
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, withGrid, viewsKey])
  return { img, views: sheetViews(withGrid ? side.asset.views : null, trims, tr), papers, error }
}

/** Content rendered into `container` (a portal through the SDK's dialog portal, which needs no dialog content). */
function InSlot({ container, children }: { container: HTMLElement; children: React.ReactElement }) {
  return <Dialog open modal={false}><DialogPortal container={container}>{children}</DialogPortal></Dialog>
}

export function TurnaroundCompare({ left, right, mode, split, toolbar }: CompareProps) {
  const modelFirst = left.asset.format === MODEL_FORMAT
  const M = modelFirst ? left : right, P = modelFirst ? right : left
  const withGrid = hasViewCells(P.asset.views)
  const model = useModel(M)
  const sheet = useSheet(P, withGrid)
  const target = M.asset.targetSize ?? P.asset.targetSize ?? null
  const keys = VIEW_ORDER.filter(k => sheet.views?.[k])
  const [view, setView] = React.useState<ViewKey>(keys[0] ?? 'front')
  React.useEffect(() => { if (keys.length && !keys.includes(view)) setView(keys[0]!) }, [keys.join(), view]) // eslint-disable-line react-hooks/exhaustive-deps
  const tr = useT()
  if (model.state === 'error') return <div className="absolute inset-0 bg-surface-well"><Centered><FailureNote error={model.error} /></Centered></div>
  if (sheet.error) return <div className="absolute inset-0 bg-surface-well"><Centered><span role="alert">{tr('imageUnreadable')}</span></Centered></div>
  if (mode !== 'side' && withGrid) {
    return <Overlay M={M} P={P} modelFirst={modelFirst} mode={mode === 'overlay' ? 'overlay' : 'wipe'} split={split} model={model}
      sheet={sheet} keys={keys} view={view} setView={setView} target={target} toolbar={toolbar ?? null} />
  }
  return <SideBySide M={M} P={P} modelFirst={modelFirst} model={model} sheet={sheet} keys={keys} view={view} setView={setView} />
}

/* ───────────── wipe / overlay ───────────── */

function Overlay({ M, P, modelFirst, mode, split, model, sheet, keys, view, setView, target, toolbar }: {
  M: CompareSide; P: CompareSide; modelFirst: boolean; mode: 'wipe' | 'overlay'; split: number
  model: ReturnType<typeof useModel>; sheet: ReturnType<typeof useSheet>
  keys: ViewKey[]; view: ViewKey; setView(k: ViewKey): void; target: { w: number; h: number; d: number } | null
  toolbar: HTMLElement | null
}) {
  const tr = useT()
  const paneRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [size, setSize] = React.useState({ W: 0, H: 0 })
  const [vz, setVz] = React.useState({ z: 1, x: 0, y: 0 })
  const [fitBy, setFitBy] = React.useState<FitBy>('h')
  const [opacity, setOpacity] = React.useState(0.5)
  React.useEffect(() => { setVz({ z: 1, x: 0, y: 0 }) }, [view])
  React.useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ W: r.width, H: r.height }) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const v: SheetView | undefined = sheet.views?.[view]
  const img = sheet.img
  const { W, H } = size
  // where the sheet sits: the view's drawn extent fills 56 % of the pane, times the zoom
  const layout = React.useMemo(() => {
    if (!v || !img || W < 10 || H < 10) return null
    const o = v.drawn, ar = img.h / img.w
    const sw = Math.min((W * 0.56) / o.w, (H * 0.56) / (o.h * ar)) * vz.z, sh = sw * ar
    const left = W / 2 + vz.x - (o.x + o.w / 2) * sw, top = H / 2 + vz.y - (o.y + o.h / 2) * sh
    const R = { x: left + o.x * sw, y: top + o.y * sh, w: o.w * sw, h: o.h * sh }
    // only this view's cell of the sheet is shown: the neighbouring views never show through
    const C = { x: left + v.cell.x * sw, y: top + v.cell.y * sh, w: v.cell.w * sw, h: v.cell.h * sh }
    return { left, top, sw, sh, R, C }
  }, [v, img, W, H, vz])
  // the shell's spot in the compare bar for this view's options (CompareProps.toolbar); none → they stay on the stage
  const barSlot = toolbar

  const fit = React.useMemo(() => {
    if (!layout || model.state !== 'ready') return null
    const info = model.p.info
    const { dir, up } = VIEW_DIR[view]
    const c = info.center, d = info.radius * 4
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, info.radius * 20)
    cam.position.set(c.x + dir[0] * d, c.y + dir[1] * d, c.z + dir[2] * d)
    cam.up.set(...up); cam.lookAt(c); cam.updateMatrixWorld(true)
    const inv = cam.matrixWorldInverse
    let nx = Infinity, xx = -Infinity, ny = Infinity, xy = -Infinity
    const b = info.bounds
    for (let k = 0; k < 8; k++) {
      const p = new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).applyMatrix4(inv)
      nx = Math.min(nx, p.x); xx = Math.max(xx, p.x); ny = Math.min(ny, p.y); xy = Math.max(xy, p.y)
    }
    const f = orthoFit(layout.R, { nx, xx, ny, xy }, W, H, fitBy)
    cam.left = f.left; cam.right = f.right; cam.top = f.top; cam.bottom = f.bottom
    cam.updateProjectionMatrix()
    return { cam, f }
  }, [layout, model, view, W, H, fitBy])

  React.useEffect(() => {
    const hub = getHub()
    if (!hub || !fit || model.state !== 'ready' || !canvasRef.current) return
    const dpr = pixelRatio(modelSettings().maxPixelRatio)
    const stage = model.p.stage
    stage.setDisplay({ ground: false })
    hub.draw(canvasRef.current, Math.round(W * dpr), Math.round(H * dpr), r => {
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1
      stage.render(r, fit.cam, ['full'], { kind: 'none' }, Math.round(W * dpr), Math.round(H * dpr))
    })
  }, [fit, model, W, H])

  /* pan and zoom move the sheet and the model together */
  const zoomAt = (z2: number, px: number, py: number) => setVz(s => {
    const z = Math.max(0.3, Math.min(8, z2))
    const cx = px + (W / 2 + s.x - px) * (z / s.z), cy = py + (H / 2 + s.y - py) * (z / s.z)
    return { z, x: cx - W / 2, y: cy - H / 2 }
  })
  React.useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('[data-float]')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(vz.z * Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button || (e.target as Element).closest('[data-float]')) return
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    const x0 = e.clientX, y0 = e.clientY, s0 = vz
    const mv = (ev: PointerEvent) => setVz({ ...s0, x: s0.x + ev.clientX - x0, y: s0.y + ev.clientY - y0 })
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }

  const x = split * W
  const clip = modelFirst ? `inset(0 ${Math.max(0, W - x)}px 0 0)` : `inset(0 0 0 ${x}px)`
  const R = layout?.R
  const mr = fit?.f.modelRect
  const implied = img ? impliedSizes(sheet.views, img.w, img.h, target)?.[view] : undefined
  const drawnAspect = v && img ? (v.drawn.w * img.w) / (v.drawn.h * img.h) : 1
  const dev = fit ? aspectDeviation(fit.f.model.w / fit.f.model.h, drawnAspect, tr) : null
  const [ah, av] = VIEW_AXES[view]
  const sizeOk = fit && target ? sizeMatches(fit.f.model.w, target[ah]) && sizeMatches(fit.f.model.h, target[av]) : null
  const mk = modelFirst ? 'A' : 'B', pk = modelFirst ? 'B' : 'A'

  return (
    <div ref={paneRef} className="absolute inset-0 cursor-grab touch-none overflow-hidden bg-surface-well active:cursor-grabbing" onPointerDown={onPointerDown}
      style={{ background: sheet.papers[view] }}
      onDoubleClick={e => { if (!(e.target as Element).closest('[data-float]')) setVz({ z: 1, x: 0, y: 0 }) }}>
      {img && layout && (
        <div className="pointer-events-none absolute overflow-hidden" style={{ left: layout.C.x, top: layout.C.y, width: layout.C.w, height: layout.C.h }}>
          <img src={img.el.src} alt="" draggable={false} className="absolute max-w-none"
            style={{ left: layout.left - layout.C.x, top: layout.top - layout.C.y, width: layout.sw, height: layout.sh }} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0" style={{ background: mode === 'wipe' ? STUDIO : undefined, clipPath: mode === 'wipe' ? clip : undefined, opacity: mode === 'overlay' ? opacity : 1 }}>
        <canvas ref={canvasRef} className="absolute inset-0 block size-full" />
      </div>
      {R && mr && (
        <svg className="pointer-events-none absolute inset-0 z-[1] size-full overflow-visible">
          <rect x={R.x} y={R.y} width={R.w} height={R.h} fill="none" stroke="#e8a33a" strokeWidth={1.5} strokeDasharray="5 4" />
          <rect x={mr.x} y={mr.y} width={mr.w} height={mr.h} fill="none" stroke="var(--accent-fill)" strokeWidth={1.5} />
          {implied && (
            <path fill="none" stroke="#e8a33a" strokeWidth={1.2}
              d={`M${R.x} ${R.y + R.h + 14}H${R.x + R.w}M${R.x} ${R.y + R.h + 10}v8M${R.x + R.w} ${R.y + R.h + 10}v8M${R.x + R.w + 14} ${R.y}V${R.y + R.h}M${R.x + R.w + 10} ${R.y}h8M${R.x + R.w + 10} ${R.y + R.h}h8`} />
          )}
        </svg>
      )}
      {R && implied && implied.map((d, i) => (
        <span key={i} title={tr('impliedTitle', { axis: axisName(d.axis, tr), measured: d.measured.toFixed(2), target: d.target.toFixed(2) })}
          className={cn('absolute z-[1] inline-flex items-baseline gap-1.5 rounded-xs px-1.5 font-mono text-[11px] leading-4 whitespace-nowrap',
            d.ok ? 'bg-material-mark text-ink-1' : 'bg-warning-fill text-warning-on', i === 0 ? '-translate-x-1/2 translate-y-1' : 'translate-x-2 -translate-y-1/2')}
          style={i === 0 ? { left: R.x + R.w / 2, top: R.y + R.h + 14 } : { left: R.x + R.w + 14, top: R.y + R.h / 2 }}>
          {axisName(d.axis, tr)} {d.measured.toFixed(2)} m{!d.ok && <small className="text-[10px] opacity-85">{tr('shouldBe', { v: d.target.toFixed(2) })}</small>}
        </span>
      ))}
      {dev && fit && (
        <div data-float className="absolute bottom-14 left-3 z-[3] grid gap-1 rounded-md bg-material-popover px-3 py-[7px] text-xs text-ink-1 shadow-popover backdrop-popover">
          <div className="flex items-center gap-1.5">
            <span className="w-10 text-ink-2">{tr('aspect')}</span>
            <span className="inline-flex items-center gap-1 text-ink-2"><i className="w-3 border-t-2 border-dashed border-[#e8a33a]" />{tr('sheet')}</span>
            <b className="bbm-num mr-1 font-semibold">{drawnAspect.toFixed(2)}</b>
            <span className="inline-flex items-center gap-1 text-ink-2"><i className="w-3 border-t-2 border-accent-fill" />{tr('model')}</span>
            <b className="bbm-num mr-1 font-semibold">{(fit.f.model.w / fit.f.model.h).toFixed(2)}</b>
            <span className={cn('rounded-full px-1.5 py-px font-semibold tabular-nums', dev.bad ? 'bg-warning-soft text-warning-ink' : 'bg-[color-mix(in_srgb,var(--stage-runtime)_22%,transparent)]')}>{dev.label}</span>
          </div>
          {target && (
            <div className="flex items-center gap-1.5">
              <span className="w-10 text-ink-2">{tr('size')}</span>
              <span className="inline-flex items-center gap-1 text-ink-2"><i className="w-3 border-t-2 border-accent-fill" />{tr('model')}</span>
              <b className="bbm-num mr-1 font-semibold">{fit.f.model.w.toFixed(2)} × {fit.f.model.h.toFixed(2)} m</b>
              <span className="text-ink-2">{tr('target')}</span>
              <b className="bbm-num mr-1 font-semibold">{target[ah].toFixed(2)} × {target[av].toFixed(2)} m</b>
              <span className={cn('rounded-full px-1.5 py-px font-semibold', sizeOk ? 'bg-[color-mix(in_srgb,var(--stage-runtime)_22%,transparent)]' : 'bg-warning-soft text-warning-ink')}>{tr(sizeOk ? 'same' : 'mismatch')}</span>
            </div>
          )}
        </div>
      )}
      {barSlot
        ? (
          <InSlot container={barSlot}>
            {/* data-float: React events from the portal still reach the stage, which must not start a pan for them */}
            <span data-float className="inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-ink-2">
              {/* a narrow window keeps the bar's room for the two asset pickers: the group's own name says it */}
              <span className="max-xl:hidden">{tr('align')}</span>
              <Seg<FitBy> size="sm" label={tr('alignMode')} value={fitBy} onChange={setFitBy} items={[{ value: 'h', label: tr('byHeight') }, { value: 'w', label: tr('byWidth') }]} />
            </span>
          </InSlot>
        )
        : (
          <div data-float className="absolute top-3 right-3 z-[3] flex items-center gap-2 rounded-md bg-material-popover px-2 py-1 text-xs text-ink-2 shadow-popover backdrop-popover">
            {tr('align')}
            <Seg<FitBy> size="sm" label={tr('alignMode')} value={fitBy} onChange={setFitBy} items={[{ value: 'h', label: tr('byHeight') }, { value: 'w', label: tr('byWidth') }]} />
          </div>
        )}
      <div data-float>
        <ViewBar keys={keys as ViewKey3[]} value={view} onPick={k => setView(k as ViewKey)} className="left-3" />
        {mode === 'overlay' && (
          <div className="absolute bottom-3 left-1/2 z-[3] flex -translate-x-1/2 items-center gap-2 rounded-full bg-material-popover px-2 py-1 shadow-popover backdrop-popover">
            <i className="grid size-4 place-items-center rounded-full bg-fill-thumb text-[10px] font-semibold not-italic">{pk}</i>
            <input type="range" min={0} max={100} value={Math.round(opacity * 100)} aria-label={tr('modelOpacity')} className="w-40 accent-[var(--accent-fill)]"
              onChange={e => setOpacity(Number(e.target.value) / 100)} />
            <i className="grid size-4 place-items-center rounded-full bg-fill-thumb text-[10px] font-semibold not-italic">{mk}</i>
            <span className="bbm-num w-9 text-right text-[11px] text-ink-2">{Math.round(opacity * 100)}%</span>
          </div>
        )}
        <ZoomControl zoom={vz.z} onZoom={f => zoomAt(vz.z * f, W / 2, H / 2)} onFit={() => setVz({ z: 1, x: 0, y: 0 })} />
      </div>
      {model.state === 'loading' && <Centered><span className="bbm-num">…</span></Centered>}
      <span className="sr-only">{M.asset.name} · {P.asset.name} · {viewLabel(view, tr)}</span>
    </div>
  )
}

/* ───────────── side by side ───────────── */

function SideBySide({ M, P, modelFirst, model, sheet, keys, view, setView }: {
  M: CompareSide; P: CompareSide; modelFirst: boolean
  model: ReturnType<typeof useModel>; sheet: ReturnType<typeof useSheet>
  keys: ViewKey[]; view: ViewKey; setView(k: ViewKey): void
}) {
  const tr = useT()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const mpane = React.useRef<HTMLDivElement>(null)
  const ipane = React.useRef<HTMLDivElement>(null)
  const [msize, setMsize] = React.useState({ W: 1, H: 1 })
  const [isize, setIsize] = React.useState({ W: 1, H: 1 })
  const [v3, setV3] = React.useState<ViewKey3 | null>('persp')
  const [link, setLink] = React.useState(true)
  const [mark, setMark] = React.useState<ViewKey | null>(null)
  const [vs, setVs] = React.useState({ z: 1, x: 0, y: 0 })
  React.useEffect(() => {
    const obs = [[mpane, setMsize], [ipane, setIsize]] as const
    const ros = obs.map(([ref, set]) => {
      const ro = new ResizeObserver(() => { const r = ref.current!.getBoundingClientRect(); set({ W: r.width, H: r.height }) })
      if (ref.current) ro.observe(ref.current)
      return ro
    })
    return () => ros.forEach(r => r.disconnect())
  }, [])
  const ready = model.state === 'ready'
  const bounds = React.useMemo(() => (model.state === 'ready' ? { radius: model.p.info.radius, center: model.p.info.center } : null), [model])
  const ortho = v3 !== null && v3 !== 'persp'
  const loop = useOrbitLoop(canvasRef, bounds, (orbit, persp, oc) => {
    const hub = getHub()
    if (!hub || model.state !== 'ready' || !canvasRef.current) return
    const dpr = pixelRatio(modelSettings().maxPixelRatio)
    const cam = ortho ? oc : persp
    orbit.place(cam, msize.W / msize.H, 35); cam.updateProjectionMatrix()
    model.p.stage.setDisplay({ ground: !ortho })
    const wd = Math.round(msize.W * dpr), hd = Math.round(msize.H * dpr)
    hub.draw(canvasRef.current, wd, hd, r => {
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1
      model.p.stage.render(r, cam, ['full'], { kind: 'none' }, wd, hd)
    })
  }, [msize, ortho, ready])

  // the picture: fitted in its pane; a linked view zooms to its cell
  const img = sheet.img
  const fitted = React.useMemo(() => {
    if (!img) return null
    const s = Math.min(isize.W / img.w, isize.H / img.h)
    return { w: img.w * s, h: img.h * s }
  }, [img, isize])
  const frameCell = React.useCallback((k: ViewKey | null) => {
    const c = k ? sheet.views?.[k]?.cell : null
    setMark(c ? k : null)
    if (!c || !fitted) { setVs({ z: 1, x: 0, y: 0 }); return }
    const z = Math.max(0.25, Math.min(16, Math.min((isize.W * 0.86) / (c.w * fitted.w), (isize.H * 0.86) / (c.h * fitted.h))))
    setVs({ z, x: -((c.x + c.w / 2) - 0.5) * fitted.w * z, y: -((c.y + c.h / 2) - 0.5) * fitted.h * z })
  }, [sheet.views, fitted, isize])
  const pick = (k: ViewKey3) => {
    const o = loop.orbit.current
    if (!o) return
    setV3(k)
    const v = VIEWS3[k]
    if (k === 'persp') { o.setGoal(0.62, 1.12); frameCell(null) }
    else {
      o.setGoal(v.th ?? o.th, v.ph)
      if (sheet.views?.[k as ViewKey]) setView(k as ViewKey)
      if (link) frameCell(k as ViewKey)
    }
    loop.invalidate()
  }
  React.useEffect(() => { if (keys.length && ready) { pick(view as ViewKey3) } }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const el = ipane.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2
      setVs(s => { const z = Math.max(0.25, Math.min(16, s.z * Math.exp(-e.deltaY * 0.0018))); return { z, x: px - (px - s.x) * (z / s.z), y: py - (py - s.y) * (z / s.z) } })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])
  const onImgDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button || (e.target as Element).closest('[data-float]')) return
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    const x0 = e.clientX, y0 = e.clientY, s0 = vs
    const mv = (ev: PointerEvent) => setVs({ ...s0, x: s0.x + ev.clientX - x0, y: s0.y + ev.clientY - y0 })
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up)
  }
  const cell = mark ? sheet.views?.[mark]?.cell : null

  const modelPane = (
    <div ref={mpane} key="m" className="relative min-w-0 flex-1 overflow-hidden" style={{ background: STUDIO }}>
      <canvas ref={canvasRef} className="absolute inset-0 block size-full cursor-grab touch-none active:cursor-grabbing" {...loop.handlers}
        onPointerMove={e => { loop.handlers.onPointerMove(e); if (loop.orbit.current?.drag && v3 !== null && v3 !== 'persp') setV3(null) }}
        onDoubleClick={() => pick('persp')} />
      <SideLabel side={M} className="left-2" />
      {ready && <ViewBar keys={['persp', ...keys] as ViewKey3[]} value={v3} onPick={pick} link={keys.length ? { on: link, toggle: () => { setLink(!link); if (!link && v3 && v3 !== 'persp') frameCell(v3 as ViewKey) } } : undefined} className="left-1/2 -translate-x-1/2" />}
      {model.state === 'loading' && <Centered><span className="bbm-num">…</span></Centered>}
    </div>
  )
  const imagePane = (
    <div ref={ipane} key="i" className="relative min-w-0 flex-1 cursor-grab touch-none overflow-hidden bg-surface-well active:cursor-grabbing" onPointerDown={onImgDown}
      onDoubleClick={() => setVs({ z: 1, x: 0, y: 0 })}>
      {img && fitted && (
        <div className="absolute top-1/2 left-1/2 transition-transform duration-snappy ease-settle" style={{ width: fitted.w, height: fitted.h, marginLeft: -fitted.w / 2, marginTop: -fitted.h / 2, transform: `translate(${vs.x}px, ${vs.y}px) scale(${vs.z})` }}>
          <img src={img.el.src} alt="" draggable={false} className="pointer-events-none block size-full" />
          {cell && mark && (
            <i className="pointer-events-none absolute border-2 border-accent-fill" style={{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, width: `${cell.w * 100}%`, height: `${cell.h * 100}%` }}>
              <b className="absolute top-0 left-0 bg-accent-fill px-1 text-[10px] font-semibold text-accent-on not-italic" style={{ transform: `scale(${1 / vs.z})`, transformOrigin: '0 0' }}>{viewLabel(mark, tr)}</b>
            </i>
          )}
        </div>
      )}
      <SideLabel side={P} className="left-2" />
      <div data-float><ZoomControl zoom={vs.z} onZoom={f => setVs(s => ({ z: Math.max(0.25, Math.min(16, s.z * f)), x: s.x * f, y: s.y * f }))} onFit={() => setVs({ z: 1, x: 0, y: 0 })} /></div>
    </div>
  )
  return (
    <div className="absolute inset-0 flex gap-px bg-line-hairline">
      {modelFirst ? [modelPane, imagePane] : [imagePane, modelPane]}
    </div>
  )
}
