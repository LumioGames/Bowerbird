/**
 * Image viewer (builtin-plugins.md「图片 · 查看器」, prototype viewers.js `imageViewer`): zoom and pan, fit / 1:1,
 * pixel zoom without smoothing, backgrounds, R/G/B/A channels, colour picker, dominant colours, tiling,
 * animated-image playback, and for sheets with a grid the view switch and dimension lines.
 */
import * as React from 'react'
import { ChevronLeft, ChevronRight, CircleAlert, Download, LayoutGrid, Pause, Play, RefreshCw } from 'lucide-react'
import { useShell, useUnsupportedToast, type ViewerProps } from '@bowerbird/plugin-sdk/web'
import { dominantColors, type Swatch } from '../shared/palette.js'
import { cellRect, dimensionLines, drawnExtent, formatMetres, padded, viewsOf, type NRect, type ViewGridLike, type ViewName } from '../shared/grid.js'
import { exceedsBrowserLimit, fitSize, pixelAt, viewForRect, zoomAt, type View } from './lib/pixels.js'
import { useT } from './i18n.js'
import { mimeOf, openFrames, type FrameSource } from './frames.js'
import { EmptyState, Grow, IconBtn, Num, Sep, Seg, TextBtn, ViewerFrame, downloadUrl, useSize } from './kit.js'

type Channel = 'rgb' | 'r' | 'g' | 'b' | 'a'
type Bg = 'well' | 'checker' | 'black' | 'white' | string

/** Channel isolation as colour matrices (the channel copied to RGB; A shown opaque). */
const MATRIX: Record<Exclude<Channel, 'rgb'>, string> = {
  r: '1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 1 0',
  g: '0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0',
  b: '0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 1 0',
  a: '0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1'
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
/** Checkerboard behind transparent pixels (design system `.bg-checker`). */
export const CHECKER = 'conic-gradient(var(--checker-b) 25%, var(--checker-a) 0 50%, var(--checker-b) 0 75%, var(--checker-a) 0) 0 0 / 24px 24px'

interface Readout { x: number; y: number; hex: string; alpha: number }

export function ImageViewer({ asset, source, mode = 'detail' }: ViewerProps) {
  const shell = useShell()
  const t = useT()
  const unsupported = useUnsupportedToast()
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const stageRef = React.useRef<HTMLDivElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const size = useSize(stageRef)
  const compact = mode === 'quicklook' || mode === 'compare'

  const techW = Number(asset.tech.width) || 0, techH = Number(asset.tech.height) || 0
  const tooLarge = techW > 0 && techH > 0 && exceedsBrowserLimit(techW, techH)
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const [view, setView] = React.useState<View>({ z: 1, x: 0, y: 0 })
  const [animate, setAnimate] = React.useState(false)
  const [bg, setBg] = React.useState<Bg>(asset.tech.hasAlpha === true ? 'checker' : 'well')
  const [custom, setCustom] = React.useState('#3b6ea8')
  const [channel, setChannel] = React.useState<Channel>('rgb')
  const [tile, setTile] = React.useState(false)
  const [cell, setCell] = React.useState<'all' | ViewName>('all')
  const [readout, setReadout] = React.useState<Readout | null>(null)
  const [palette, setPalette] = React.useState<Swatch[]>([])
  const [extents, setExtents] = React.useState<Partial<Record<ViewName, NRect>>>({})

  // Animated images: step through frames on a canvas.
  const animatedHint = Number(asset.tech.frames) > 1
  const [frames, setFrames] = React.useState<FrameSource | null>(null)
  const [frame, setFrame] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)

  const grid = (asset.views ?? null) as ViewGridLike | null
  const views = viewsOf(grid)
  const target = asset.targetSize

  const url = source.url
  React.useEffect(() => { setNatural(null); setFailed(false); setPalette([]); setExtents({}); setFrames(null); setFrame(0) }, [url, attempt])

  // Decode animation frames when the image is animated.
  React.useEffect(() => {
    if (!animatedHint || tooLarge) return
    let gone = false, opened: FrameSource | null = null
    const ctl = new AbortController()
    source.fetch(ctl.signal)
      .then(buf => openFrames(buf, mimeOf(asset.name)))
      .then(fs => { if (gone) { fs?.close(); return } opened = fs; setFrames(fs); if (fs && compact) setPlaying(true) })
      .catch(() => { /* fall back to the plain <img> */ })
    return () => { gone = true; ctl.abort(); opened?.close() }
  }, [url, attempt, animatedHint, tooLarge, asset.name, compact, source])

  // Draw the current frame; advance while playing.
  React.useEffect(() => {
    const cv = canvasRef.current
    if (!frames || !cv) return
    let gone = false, timer: ReturnType<typeof setTimeout> | undefined
    const ctx = cv.getContext('2d')!
    frames.draw(frame, ctx).then(ms => {
      if (gone) return
      if (!natural) setNatural({ w: frames.width, h: frames.height })
      if (playing) timer = setTimeout(() => setFrame(f => (f + 1) % frames.count), Math.max(20, ms))
    }).catch(() => {})
    return () => { gone = true; if (timer) clearTimeout(timer) }
  }, [frames, frame, playing, natural])

  const nat = natural ?? (techW && techH ? { w: techW, h: techH } : null)
  const base = nat && size.w > 0 ? fitSize(size.w, size.h, nat) : { w: 0, h: 0 }
  const box = tile ? { w: base.w * 3, h: base.h * 3 } : base
  const pixelScale = nat && base.w ? (box.w / (tile ? 3 : 1)) * view.z / nat.w : 1
  const zoomPct = Math.round(pixelScale * 100)
  const zMax = nat && base.w ? Math.max(8, 32 * nat.w / base.w) : 40

  const apply = React.useCallback((v: View, anim = false) => { setAnimate(anim); setView(v) }, [])
  const fit = () => apply({ z: tile ? 0.53 : 1, x: 0, y: 0 }, true)

  // After load: palette and, for grid sheets, where each view's drawing sits.
  const onLoaded = React.useCallback((el: HTMLImageElement) => {
    const w = el.naturalWidth || techW, h = el.naturalHeight || techH
    if (!w || !h) return
    setNatural({ w, h })
    try {
      const k = Math.min(1, 480 / Math.max(w, h)), sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k))
      const c = document.createElement('canvas'); c.width = sw; c.height = sh
      const x = c.getContext('2d', { willReadFrequently: true })!
      x.drawImage(el, 0, 0, sw, sh)
      const px = x.getImageData(0, 0, sw, sh).data
      setPalette(dominantColors(px, { stride: Math.max(1, Math.floor(sw * sh / 20000)) }))
      if (grid) {
        const out: Partial<Record<ViewName, NRect>> = {}
        for (const v of viewsOf(grid)) { const r = cellRect(grid, v)!; out[v] = drawnExtent(px, sw, sh, r) ?? padded(r) }
        setExtents(out)
      }
    } catch { /* tainted or too large: no palette */ }
  }, [grid, techW, techH])

  // Wheel zoom about the pointer (non-passive so the page does not scroll).
  const viewRef = React.useRef(view); viewRef.current = view
  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const v = viewRef.current
      apply(zoomAt(v, v.z * Math.exp(-e.deltaY * 0.0018), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, 0.1, zMax))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [apply, zMax])

  const drag = React.useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const [grabbing, setGrabbing] = React.useState(false)
  const pick = React.useRef(0)
  const sample = React.useMemo(() => {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas'); c.width = 1; c.height = 1
    return c.getContext('2d', { willReadFrequently: true })
  }, [])

  function readAt(clientX: number, clientY: number) {
    const src = (frames ? canvasRef.current : imgRef.current) as CanvasImageSource | null
    const holder = (frames ? canvasRef.current : imgRef.current)?.parentElement
    if (!src || !holder || !nat || !sample) return setReadout(null)
    const rect = (tile ? holder.parentElement ?? holder : holder).getBoundingClientRect()
    const p = pixelAt(clientX, clientY, rect, nat, tile)
    if (!p) return setReadout(null)
    try {
      sample.clearRect(0, 0, 1, 1)
      sample.drawImage(src, p.x, p.y, 1, 1, 0, 0, 1, 1)
      const d = sample.getImageData(0, 0, 1, 1).data
      setReadout({ x: p.x, y: p.y, hex: '#' + hex2(d[0]) + hex2(d[1]) + hex2(d[2]), alpha: d[3] })
    } catch { setReadout(null) }
  }

  const stageProps: React.HTMLAttributes<HTMLDivElement> = {
    onPointerDown: e => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { x: e.clientX, y: e.clientY, sx: view.x, sy: view.y }
      setGrabbing(true)
    },
    onPointerMove: e => {
      const d = drag.current
      if (d) apply({ z: view.z, x: d.sx + e.clientX - d.x, y: d.sy + e.clientY - d.y })
      const cx = e.clientX, cy = e.clientY
      cancelAnimationFrame(pick.current)
      pick.current = requestAnimationFrame(() => readAt(cx, cy))
    },
    onPointerUp: () => { drag.current = null; setGrabbing(false) },
    onPointerCancel: () => { drag.current = null; setGrabbing(false) },
    onPointerLeave: () => { cancelAnimationFrame(pick.current); setReadout(null) },
    onDoubleClick: () => apply({ z: view.z > 1.01 ? 1 : 2, x: 0, y: 0 }, true)
  }

  const copy = (hex: string) => {
    navigator.clipboard?.writeText(hex).catch(() => {})
    shell.toast({ title: t('copied', { hex }), kind: 'success' })
  }

  const step = (d: number) => {
    if (!frames) return unsupported()
    setPlaying(false)
    setFrame(f => (f + d + frames.count) % frames.count)
  }
  const togglePlay = () => { if (!frames) return unsupported(); setPlaying(p => !p) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (compact || !animatedHint) return
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); togglePlay() }
  }

  // the viewer's error state (prototype viewers.js「error」): larger than a browser can show, or the file did not load
  if (tooLarge || failed) {
    return (
      <ViewerFrame plugin="bowerbird.image" mode={mode}>
        <EmptyState icon={<CircleAlert />} title={t('viewerError')}
          text={tooLarge ? `bowerbird.image · ${t('tooLarge', { w: techW, h: techH })}` : 'bowerbird.image'} actions={[
          { label: t('download'), icon: <Download />, primary: true, onClick: () => downloadUrl(source.url, asset.name) },
          { label: t('retry'), icon: <RefreshCw />, onClick: () => setAttempt(a => a + 1) }
        ]} />
      </ViewerFrame>
    )
  }

  const bgStyle: React.CSSProperties | undefined = bg === 'checker' ? { background: CHECKER } : bg === 'black' ? { background: '#000' } : bg === 'white' ? { background: '#fff' } : bg.startsWith('#') ? { background: bg } : undefined
  const filter = channel === 'rgb' ? undefined : `url(#${uid}-${channel})`
  const pixelated = pixelScale > 1.0001
  const imgStyle: React.CSSProperties = { display: 'block', width: '100%', height: '100%', filter, imageRendering: pixelated ? 'pixelated' : undefined }
  const one = frames
    ? <canvas ref={canvasRef} width={frames.width} height={frames.height} style={imgStyle} />
    : <img ref={imgRef} src={url} alt="" draggable={false} style={imgStyle} onLoad={e => onLoaded(e.currentTarget)} onError={() => setFailed(true)} />

  // Screen rectangle of the (untiled) image, for the dimension-line overlay.
  const shown = { w: box.w * view.z, h: box.h * view.z }
  const left = size.w / 2 + view.x - shown.w / 2, top = size.h / 2 + view.y - shown.h / 2
  const showDims = !!grid && !!target && !tile && views.length > 0 && base.w > 0

  const bar = (
    <>
      {animatedHint ? (
        <>
          <IconBtn label={playing ? t('pause') : t('play')} title={playing ? t('pauseKey') : t('playKey')} onClick={togglePlay}>{playing ? <Pause /> : <Play />}</IconBtn>
          <IconBtn label={t('prevFrame')} onClick={() => step(-1)}><ChevronLeft /></IconBtn>
          <IconBtn label={t('nextFrame')} onClick={() => step(1)}><ChevronRight /></IconBtn>
          <Num>{t('frameOf', { i: frames ? frame + 1 : 1, n: frames?.count ?? Number(asset.tech.frames) })}</Num>
          <Sep />
        </>
      ) : null}
      {views.length ? (
        <>
          <Seg
            label={t('views')}
            value={cell}
            items={[{ value: 'all' as const, label: t('whole') }, ...views.map(v => ({ value: v, label: t(`view.${v}`) }))]}
            onChange={v => {
              setCell(v)
              if (v === 'all' || !grid) return apply({ z: 1, x: 0, y: 0 }, !showDims)
              apply(viewForRect(cellRect(grid, v)!, base), !showDims)
            }}
          />
          <Sep />
        </>
      ) : null}
      <TextBtn title={t('fitTitle')} onClick={fit}>{t('fit')}</TextBtn>
      <TextBtn title={t('oneTitle')} onClick={() => { if (nat && base.w) apply({ z: nat.w / base.w, x: 0, y: 0 }, true) }}>1:1</TextBtn>
      <Num className="w-11">{zoomPct}%</Num>
      <Sep />
      {(['checker', 'black', 'white'] as const).map(k => (
        <button
          key={k}
          type="button"
          aria-pressed={bg === k}
          aria-label={t('bgAria', { name: t(`bg.${k}`) })}
          title={t(`bg.${k}`)}
          onClick={() => setBg(k)}
          className={'size-[18px] flex-none rounded-full shadow-[inset_0_0_0_1px_var(--line-control)] outline-offset-2 transition-transform duration-press active:scale-90 aria-pressed:outline-2 aria-pressed:outline-accent-ring ' + (k === 'checker' ? 'checkerboard [background-size:8px_8px]' : k === 'black' ? 'bg-black' : 'bg-white')}
        />
      ))}
      <label title={t('customColor')} className={'relative grid size-[18px] flex-none place-items-center rounded-full bg-fill-rest text-[13px] leading-none text-ink-2 shadow-[inset_0_0_0_1px_var(--line-control)] outline-offset-2 ' + (bg.startsWith('#') ? 'outline-2 outline-accent-ring' : '')}>
        +
        <input type="color" aria-label={t('customColorAria')} value={custom} className="absolute inset-0 size-full cursor-default opacity-0" onChange={e => { setCustom(e.target.value); setBg(e.target.value) }} />
      </label>
      <Sep />
      <Seg<Channel> label={t('channels')} value={channel} onChange={setChannel} items={[{ value: 'rgb', label: 'RGB' }, { value: 'r', label: 'R' }, { value: 'g', label: 'G' }, { value: 'b', label: 'B' }, { value: 'a', label: 'A', title: t('alpha') }]} />
      <Sep />
      <TextBtn pressed={tile} onClick={() => { const t = !tile; setTile(t); apply({ z: t ? 0.53 : 1, x: 0, y: 0 }) }}><LayoutGrid />{t('tile')}</TextBtn>
      <Grow />
      <span className="flex flex-none gap-1">
        {palette.map(s => (
          <button key={s.hex} type="button" title={s.hex} aria-label={t('copyAria', { hex: s.hex })} onClick={() => copy(s.hex)}
            className="size-[18px] rounded-xs shadow-[inset_0_0_0_1px_var(--line-hairline)] transition-transform duration-press hover:scale-110 active:scale-95"
            style={{ background: s.hex }} />
        ))}
      </span>
    </>
  )

  return (
    <ViewerFrame
      plugin="bowerbird.image"
      mode={mode}
      bar={bar}
      stageRef={stageRef}
      stageClassName={grabbing ? 'cursor-grabbing' : undefined}
      stageStyle={bgStyle}
      stageProps={stageProps}
      rootProps={{ tabIndex: compact ? undefined : 0, onKeyDown }}
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          {(Object.keys(MATRIX) as Array<keyof typeof MATRIX>).map(k => (
            <filter key={k} id={`${uid}-${k}`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={MATRIX[k]} /></filter>
          ))}
        </defs>
      </svg>
      {box.w > 0 || !nat ? (
        <div
          className="absolute left-1/2 top-1/2 will-change-transform"
          style={{
            width: box.w || undefined, height: box.h || undefined, marginLeft: -box.w / 2, marginTop: -box.h / 2,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
            transition: animate ? 'transform var(--duration-settle) var(--spring-settle)' : undefined,
            visibility: nat ? undefined : 'hidden'
          }}
        >
          {tile ? <div className="grid size-full grid-cols-3">{Array.from({ length: 9 }, (_, i) => <div key={i} className="size-full">{i === 4 ? one : frames ? <TileCopy from={canvasRef} frame={frame} style={imgStyle} /> : <img src={url} alt="" draggable={false} style={imgStyle} />}</div>)}</div> : <div className="size-full">{one}</div>}
        </div>
      ) : null}
      {showDims ? (
        <DimensionOverlay views={views} extents={extents} grid={grid!} size={target!} rect={{ left, top, w: shown.w, h: shown.h }} />
      ) : null}
      {readout ? (
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-sm bg-material-popover px-2 py-1 font-mono text-[11px] tabular-nums text-ink-1 shadow-popover backdrop-popover">
          <i className="size-3 rounded-[3px] shadow-[inset_0_0_0_1px_var(--line-control)]" style={{ background: readout.hex, opacity: readout.alpha / 255 }} />
          <span>x {readout.x}</span><span>y {readout.y}</span><span>{readout.hex}</span>
          {readout.alpha < 255 ? <span>α {Math.round(readout.alpha / 2.55)}%</span> : null}
        </div>
      ) : null}
    </ViewerFrame>
  )
}

/** A tile copy of the current animation frame. */
function TileCopy({ from, frame, style }: { from: React.RefObject<HTMLCanvasElement | null>; frame: number; style: React.CSSProperties }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const src = from.current, dst = ref.current
    if (!src || !dst) return
    const id = requestAnimationFrame(() => {
      dst.width = src.width; dst.height = src.height
      dst.getContext('2d')?.drawImage(src, 0, 0)
    })
    return () => cancelAnimationFrame(id)
  }, [from, frame])
  return <canvas ref={ref} style={style} />
}

/**
 * Dimension lines on a sheet with a grid (builtin-plugins.md「尺寸线」): per view, a horizontal line under the
 * drawing and a vertical one on its right, labelled with the design object's target size. Overlay only.
 */
function DimensionOverlay(props: {
  views: ViewName[]
  extents: Partial<Record<ViewName, NRect>>
  grid: ViewGridLike
  size: { w: number; h: number; d: number }
  rect: { left: number; top: number; w: number; h: number }
}) {
  const { rect } = props
  const t = useT()
  const label = (l: { axis: 'w' | 'h' | 'd'; metres: number }) => `${t(`axis.${l.axis}`)} ${formatMetres(l.metres)} m`
  const items = props.views.map(v => {
    const e = props.extents[v] ?? padded(cellRect(props.grid, v)!)
    const R = { x: rect.left + e[0] * rect.w, y: rect.top + e[1] * rect.h, w: e[2] * rect.w, h: e[3] * rect.h }
    const [hl, vl] = dimensionLines(v, props.size)
    return { v, R, hl, vl }
  })
  const off = 10
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible text-accent-ink" aria-hidden>
        {items.map(({ v, R }) => {
          const y = R.y + R.h + off, x = R.x + R.w + off
          return (
            <path key={v} fill="none" stroke="currentColor" strokeWidth={1.25}
              d={`M${R.x} ${y}H${R.x + R.w}M${R.x} ${y - 4}v8M${R.x + R.w} ${y - 4}v8M${x} ${R.y}V${R.y + R.h}M${x - 4} ${R.y}h8M${x - 4} ${R.y + R.h}h8`} />
          )
        })}
      </svg>
      {items.flatMap(({ v, R, hl, vl }) => [
        <span key={v + 'h'} className="pointer-events-none absolute -translate-x-1/2 rounded-xs bg-material-popover px-1.5 text-[11px] leading-4 tabular-nums whitespace-nowrap text-ink-1 shadow-popover" style={{ left: R.x + R.w / 2, top: R.y + R.h + off + 4 }}>{label(hl)}</span>,
        <span key={v + 'v'} className="pointer-events-none absolute -translate-y-1/2 rounded-xs bg-material-popover px-1.5 text-[11px] leading-4 tabular-nums whitespace-nowrap text-ink-1 shadow-popover" style={{ left: R.x + R.w + off + 6, top: R.y + R.h / 2 }}>{label(vl)}</span>
      ])}
    </>
  )
}

