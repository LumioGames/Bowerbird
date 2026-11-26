/**
 * Image compare (builtin-plugins.md「对比视图」, prototype compare.js `FMT.image`): side by side, wipe, overlay
 * with opacity, and the pixel difference. Sizes that differ align by proportion or by original pixels; a slice
 * against the picture it was cut from crops that picture to the record's `rect` (ADR-036).
 * One pan / zoom drives every layer, so the two sides move together. The wipe divider is the shell's.
 */
import * as React from 'react'
import { Focus, Minus, Plus } from 'lucide-react'
import { Slider, type CompareProps, type CompareSide } from '@bowerbird/plugin-sdk/web'
import { alignBoxes, sameSize, shownSizes, sizeOf, type Align, type PxRect, type Size } from './lib/rules.js'
import { diffPercent, diffPixels, zoomAt, type View } from './lib/pixels.js'
import { Float, IconBtn, Key, Num, Seg, SideLabel, useSize } from './kit.js'
import { useT } from './i18n.js'

function sideText(s: CompareSide, current: string): string {
  if (s.version) return `v${s.version.n}${s.version.current ? ` · ${current}` : ''}`
  return s.asset.name
}

function useNatural(side: CompareSide): [Size | null, (s: Size) => void] {
  const [n, setN] = React.useState<Size | null>(() => sizeOf(side.asset))
  React.useEffect(() => { setN(sizeOf(side.asset)) }, [side.source.url, side.asset])
  return [n, setN]
}

/** One image placed in `box` (centred in its pane), cropped to `rect` when given. */
function Layer(props: { url: string; nat: Size | null; rect: PxRect | null; box: Size; view: View; onNatural(s: Size): void; style?: React.CSSProperties; className?: string }) {
  const { box, rect, nat, view } = props
  const k = rect ? box.w / rect[2] : 1
  const img: React.CSSProperties = rect && nat
    ? { position: 'absolute', left: -rect[0] * k, top: -rect[1] * k, width: nat.w * k, height: nat.h * k, maxWidth: 'none' }
    : { display: 'block', width: '100%', height: '100%' }
  return (
    <div className={'absolute inset-0 ' + (props.className ?? '')} style={props.style}>
      <div
        className="absolute left-1/2 top-1/2 will-change-transform"
        style={{ width: box.w, height: box.h, marginLeft: -box.w / 2, marginTop: -box.h / 2, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
      >
        <div className="relative size-full overflow-hidden">
          <img src={props.url} alt="" draggable={false} style={img} onLoad={e => props.onNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        </div>
      </div>
    </div>
  )
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('image failed to load'))
    im.src = url
  })
}

export function ImageCompare({ left, right, mode, split }: CompareProps) {
  const t = useT()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const paneRef = React.useRef<HTMLDivElement>(null)
  const pane = useSize(paneRef, mode)
  const [natA, setNatA] = useNatural(left)
  const [natB, setNatB] = useNatural(right)
  const [align, setAlign] = React.useState<Align>('fit')
  const [opacity, setOpacity] = React.useState(0.5)
  const [view, setView] = React.useState<View>({ z: 1, x: 0, y: 0 })

  const { crop } = shownSizes(left.asset, right.asset)
  const rectA = crop && crop.crop === 'left' ? crop.rect : null
  const rectB = crop && crop.crop === 'right' ? crop.rect : null
  const sa: Size | null = rectA ? { w: rectA[2], h: rectA[3] } : natA
  const sb: Size | null = rectB ? { w: rectB[2], h: rectB[3] } : natB
  const differentSizes = !!sa && !!sb && !sameSize(sa, sb)
  const effectiveAlign: Align = differentSizes ? align : 'fit'
  const boxes = sa && sb && pane.w > 0 ? alignBoxes(pane.w, pane.h, sa, sb, effectiveAlign) : null

  // Wheel zoom and drag pan, shared by both sides.
  const viewRef = React.useRef(view); viewRef.current = view
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const p = (e.target as HTMLElement).closest('[data-pane]') as HTMLElement | null
      if (!p) return
      e.preventDefault()
      const r = p.getBoundingClientRect()
      setView(zoomAt(viewRef.current, viewRef.current.z * Math.exp(-e.deltaY * 0.0018), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, 0.25, 16))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const drag = React.useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const panHandlers: React.HTMLAttributes<HTMLDivElement> = {
    onPointerDown: e => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, [data-float]')) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { x: e.clientX, y: e.clientY, sx: view.x, sy: view.y }
    },
    onPointerMove: e => { const d = drag.current; if (d) setView({ z: view.z, x: d.sx + e.clientX - d.x, y: d.sy + e.clientY - d.y }) },
    onPointerUp: () => { drag.current = null },
    onPointerCancel: () => { drag.current = null },
    onDoubleClick: e => { if (!(e.target as HTMLElement).closest('[data-float]')) setView({ z: 1, x: 0, y: 0 }) }
  }

  const zoomCtl = (
    <Float className="bottom-2 right-2 h-auto gap-0.5 rounded-md p-[3px]" >
      <span data-float className="contents">
        <IconBtn label={t('zoomOut')} className="size-6" onClick={() => setView(v => zoomAt(v, v.z * 0.8, 0, 0, 0.25, 16))}><Minus /></IconBtn>
        <Num className="w-10 text-center text-ink-1">{Math.round(view.z * 100)}%</Num>
        <IconBtn label={t('zoomIn')} className="size-6" onClick={() => setView(v => zoomAt(v, v.z * 1.25, 0, 0, 0.25, 16))}><Plus /></IconBtn>
        <IconBtn label={t('fit')} title={t('fitDbl')} className="size-6" onClick={() => setView({ z: 1, x: 0, y: 0 })}><Focus /></IconBtn>
      </span>
    </Float>
  )
  const alignCtl = differentSizes ? (
    <Float className="bottom-2 left-2">
      <span data-float className="contents">
        <span className="text-ink-2">{t('align')}</span>
        <Seg<Align> label={t('alignAria')} value={align} onChange={setAlign} items={[{ value: 'fit', label: t('alignFit') }, { value: 'px', label: t('alignPx') }]} />
      </span>
    </Float>
  ) : null

  const layerA = (box: Size) => <Layer url={left.source.url} nat={natA} rect={rectA} box={box} view={view} onNatural={s => setNatA(s)} />
  const layerB = (box: Size, style?: React.CSSProperties) => <Layer url={right.source.url} nat={natB} rect={rectB} box={box} view={view} onNatural={s => setNatB(s)} style={style} />

  let body: React.ReactNode
  if (mode === 'side') {
    body = (
      <div className="relative flex min-h-0 flex-1 gap-px bg-line-hairline">
        {[left, right].map((s, i) => (
          <SidePane key={s.label} index={i} side={s} sizeA={sa} sizeB={sb} align={effectiveAlign}>
            {(box: Size) => (i === 0 ? layerA(box) : layerB(box))}
          </SidePane>
        ))}
        {alignCtl}
        {zoomCtl}
      </div>
    )
  } else if (mode === 'diff') {
    body = (
      <div ref={paneRef} data-pane className="relative min-h-0 flex-1 overflow-hidden bg-surface-well">
        {boxes ? <DiffLayer left={left} right={right} rectA={rectA} rectB={rectB} sa={sa!} sb={sb!} boxes={boxes} view={view} /> : null}
        {alignCtl}
        {zoomCtl}
      </div>
    )
  } else {
    const W = pane.w
    body = (
      <div ref={paneRef} data-pane className="relative min-h-0 flex-1 overflow-hidden bg-surface-well">
        {boxes ? layerA(boxes[0]) : null}
        {boxes ? layerB(boxes[1], mode === 'wipe' ? { clipPath: `inset(0 0 0 ${Math.round(split * W)}px)` } : { opacity }) : null}
        {mode === 'overlay' ? (
          <Float className="bottom-3 left-1/2 -translate-x-1/2 pl-1.5 pr-3">
            <span data-float className="contents">
              <Key>A</Key>
              <Slider className="w-[200px]" aria-label={t('opacityAria')} min={0} max={100} value={[Math.round(opacity * 100)]} onValueChange={v => setOpacity((v[0] ?? 50) / 100)} />
              <Key>B</Key>
              <Num className="w-[34px] text-right">{Math.round(opacity * 100)}%</Num>
            </span>
          </Float>
        ) : null}
        {alignCtl}
        {zoomCtl}
      </div>
    )
  }

  return (
    <div ref={rootRef} data-plugin="bowerbird.image" className="relative flex size-full min-h-0 touch-none select-none flex-col" {...panHandlers}>
      {body}
    </div>
  )
}

function SidePane(props: { index: number; side: CompareSide; sizeA: Size | null; sizeB: Size | null; align: Align; children: (box: Size) => React.ReactNode }) {
  const t = useT()
  const ref = React.useRef<HTMLDivElement>(null)
  const size = useSize(ref)
  const boxes = props.sizeA && props.sizeB && size.w > 0 ? alignBoxes(size.w, size.h, props.sizeA, props.sizeB, props.align) : null
  return (
    <div ref={ref} data-pane className="relative min-w-0 flex-1 overflow-hidden bg-surface-well">
      {boxes ? props.children(boxes[props.index]!) : null}
      <SideLabel k={props.side.label} text={sideText(props.side, t('current'))} />
    </div>
  )
}

/** The difference image: both sides drawn into the same box, compared per channel, marked over a dim copy of A. */
function DiffLayer(props: { left: CompareSide; right: CompareSide; rectA: PxRect | null; rectB: PxRect | null; sa: Size; sb: Size; boxes: [Size, Size]; view: View }) {
  const t = useT()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [label, setLabel] = React.useState(t('computing'))
  const [none, setNone] = React.useState(false)
  const { boxes, view } = props
  const uw = Math.max(boxes[0].w, boxes[1].w), uh = Math.max(boxes[0].h, boxes[1].h)
  const key = `${props.left.source.url}|${props.right.source.url}|${Math.round(boxes[0].w)}x${Math.round(boxes[0].h)}|${Math.round(boxes[1].w)}x${Math.round(boxes[1].h)}|${props.rectA}|${props.rectB}`
  React.useEffect(() => {
    let gone = false
    setLabel(t('computing'))
    Promise.all([loadImage(props.left.source.url), loadImage(props.right.source.url)]).then(([ia, ib]) => {
      if (gone) return
      const s = Math.min(1, 800 / Math.max(uw, uh)), cw = Math.max(2, Math.round(uw * s)), ch = Math.max(2, Math.round(uh * s))
      const draw = (im: HTMLImageElement, rect: PxRect | null, box: Size) => {
        const c = document.createElement('canvas'); c.width = cw; c.height = ch
        const x = c.getContext('2d', { willReadFrequently: true })!
        const w = Math.round(box.w * s), h = Math.round(box.h * s), dx = Math.round((cw - w) / 2), dy = Math.round((ch - h) / 2)
        if (rect) x.drawImage(im, rect[0], rect[1], rect[2], rect[3], dx, dy, w, h)
        else x.drawImage(im, dx, dy, w, h)
        return x.getImageData(0, 0, cw, ch).data
      }
      const r = diffPixels(draw(ia, props.rectA, boxes[0]), draw(ib, props.rectB, boxes[1]))
      const cv = canvasRef.current
      if (!cv) return
      cv.width = cw; cv.height = ch
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.image), cw, ch), 0, 0)
      const p = diffPercent(r)
      setLabel(p ? t('diffShare', { p }) : t('diffNone')); setNone(!p)
    }).catch(() => { if (!gone) setLabel(t('diffFailed')) })
    return () => { gone = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <>
      <div className="absolute left-1/2 top-1/2 will-change-transform" style={{ width: uw, height: uh, marginLeft: -uw / 2, marginTop: -uh / 2, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <canvas ref={canvasRef} className="block size-full" style={{ imageRendering: view.z > 1.5 ? 'pixelated' : undefined }} />
      </div>
      <Float className="right-2 top-2">
        <i className="size-2.5 rounded-[3px]" style={{ background: none ? 'var(--stage-runtime)' : 'rgb(255 56 150)' }} />
        <span>{label}</span>
      </Float>
    </>
  )
}
