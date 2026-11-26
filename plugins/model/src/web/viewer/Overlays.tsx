/**
 * Things manipulated in place on the viewport (prototype model.js「overlays」): the two-way wipe (drag the knob,
 * turn it with the outer handle, double-click the handle to straighten), slanted strips with their channel
 * chips, the animation bar, notes and the loading ring.
 */
import * as React from 'react'
import { cn } from '@bowerbird/plugin-sdk/web'
import { channelName, MAX_STRIPS, type ModelCaps } from '../lib/channels'
import { STRIP_SLOPE } from '../three/materials'
import { ChannelMenu } from './ChannelMenu'
import { Icon } from '../icons'
import { floatPill } from './ui'
import { useT } from '../i18n'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/**
 * A channel chip on the viewport (prototype `.mv-chip`): the chip opens the channel menu. With more than two strips
 * a「移除这一路」button sits at its end — next to the chip, not inside it, so Tab reaches it — shown on hover and
 * whenever the chip or the button has keyboard focus.
 */
const Chip = React.forwardRef<HTMLSpanElement, {
  label: string; value: string; caps: ModelCaps; onPick(key: string): void; onRemove?: () => void; style?: React.CSSProperties
}>(function Chip({ label, value, caps, onPick, onRemove, style }, ref) {
  const tr = useT()
  const shown = 'group-hover:mr-1 group-hover:w-4 group-hover:opacity-100 group-has-[:focus-visible]:mr-1 group-has-[:focus-visible]:w-4 group-has-[:focus-visible]:opacity-100'
  return (
    <span ref={ref} data-chip className={cn('group pointer-events-auto absolute top-1.5 inline-flex h-6 items-center text-xs', floatPill)} style={style}>
      <ChannelMenu value={value} caps={caps} onPick={onPick}>
        <button type="button" className={cn('inline-flex h-full items-center gap-1 whitespace-nowrap rounded-full px-2 outline-none focus-visible:outline-2 focus-visible:outline-accent-ring active:scale-[0.96]',
          onRemove && 'group-hover:pr-1 group-has-[:focus-visible]:pr-1')}>
          {label}
          <Icon name="chevron-down" size={12} className="text-ink-2" />
        </button>
      </ChannelMenu>
      {onRemove && (
        <button type="button" aria-label={tr('removeStrip')} title={tr('removeStrip')} onClick={onRemove}
          className={cn('grid h-4 w-0 shrink-0 place-items-center overflow-hidden rounded-full text-ink-2 opacity-0 outline-none hover:bg-fill-hover hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-accent-ring', shown)}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  )
})

function useDrag(onMove: (dx: number, dy: number, e: PointerEvent) => void, onStart?: () => void) {
  return (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    const x0 = e.clientX, y0 = e.clientY
    onStart?.()
    const mv = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0, ev)
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
}

export function WipeOverlay({ W, H, pw, wipe, caps, onChange, onPick }: {
  W: number; H: number; pw: number
  wipe: { ch: [string, string]; x: number; y: number; ang: number }
  caps: ModelCaps
  onChange(w: { x?: number; y?: number; ang?: number }): void
  onPick(region: 0 | 1, key: string): void
}) {
  const px = wipe.x * W, py = wipe.y * H, a = wipe.ang
  const L = Math.hypot(W, H) * 2
  const start = React.useRef({ x: wipe.x, y: wipe.y })
  const rootRef = React.useRef<HTMLDivElement>(null)
  const tr = useT()
  const move = useDrag((dx, dy) => onChange({ x: clamp(start.current.x + dx / W, 0.02, 0.98), y: clamp(start.current.y + dy / H, 0.05, 0.95) }), () => { start.current = { x: wipe.x, y: wipe.y } })
  const rotate = useDrag((_dx, _dy, ev) => {
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    let an = Math.atan2(ev.clientX - r.left - wipe.x * W, -(ev.clientY - r.top - wipe.y * H))
    if (Math.abs(an) < 0.05) an = 0
    onChange({ ang: clamp(an, -1.3, 1.3) })
  })
  const xt = px + Math.tan(a) * (py - 18)
  const c0 = React.useRef<HTMLSpanElement>(null), c1 = React.useRef<HTMLSpanElement>(null)
  const [w0, setW0] = React.useState(80), [w1, setW1] = React.useState(80)
  React.useLayoutEffect(() => { setW0(c0.current?.offsetWidth ?? 80); setW1(c1.current?.offsetWidth ?? 80) }, [wipe.ch, caps])
  const dx = Math.sin(a) * L / 2, dy = Math.cos(a) * L / 2
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0">
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H}>
        <line x1={px - dx} y1={py + dy} x2={px + dx} y2={py - dy} stroke="white" strokeOpacity={0.9} strokeWidth={1.5} />
      </svg>
      <i onPointerDown={move} className="pointer-events-auto absolute w-4 -ml-2 cursor-ew-resize touch-none"
        style={{ left: px, top: py - L / 2, height: L, transform: `rotate(${a}rad)` }} />
      <i onPointerDown={move} title={tr('dragDivider')}
        className="pointer-events-auto absolute -mt-4 -ml-4 flex size-8 cursor-grab touch-none items-center justify-center rounded-full bg-fill-knob text-[#2a2a30] shadow-popover active:scale-[1.08] active:cursor-grabbing"
        style={{ left: px, top: py }}>
        <Icon name="chevron-left" size={12} className="-mr-0.5" /><Icon name="chevron-right" size={12} className="-ml-0.5" />
      </i>
      <i onPointerDown={rotate} onDoubleClick={() => onChange({ ang: 0 })} title={tr('rotateDivider')}
        className="pointer-events-auto absolute -mt-2.5 -ml-2.5 grid size-5 cursor-grab touch-none place-items-center rounded-full bg-fill-knob text-[#2a2a30] shadow-raise"
        style={{ left: px + Math.sin(a) * 72, top: py - Math.cos(a) * 72 }}>
        <Icon name="refresh-cw" size={12} />
      </i>
      <Chip ref={c0} label={channelName(wipe.ch[0], caps.vcolSets, tr)} value={wipe.ch[0]} caps={caps} onPick={k => onPick(0, k)}
        style={{ left: clamp(xt - 12 - w0, 8, W - pw - w0 - 8) }} />
      <Chip ref={c1} label={channelName(wipe.ch[1], caps.vcolSets, tr)} value={wipe.ch[1]} caps={caps} onPick={k => onPick(1, k)}
        style={{ left: clamp(xt + 12, 8, W - pw - w1 - 8) }} />
    </div>
  )
}

export function StripsOverlay({ W, H, pw, strips, caps, onPick, onRemove, onAdd }: {
  W: number; H: number; pw: number; strips: string[]; caps: ModelCaps
  onPick(i: number, key: string): void; onRemove(i: number): void; onAdd(): void
}) {
  const tr = useT()
  const n = strips.length
  const refs = React.useRef<Array<HTMLSpanElement | null>>([])
  const [widths, setWidths] = React.useState<number[]>([])
  React.useLayoutEffect(() => { setWidths(refs.current.slice(0, n).map(r => r?.offsetWidth ?? 80)) }, [strips, caps, n])
  const shift = (y: number) => (y - H / 2) * STRIP_SLOPE
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H}>
        {Array.from({ length: n - 1 }, (_, k) => {
          const x = ((k + 1) * W) / n
          return <line key={k} x1={x - shift(0)} y1={0} x2={x - shift(H)} y2={H} stroke="white" strokeOpacity={0.9} strokeWidth={1.5} />
        })}
      </svg>
      {strips.map((c, i) => {
        const w = widths[i] ?? 80
        const xc = ((i + 0.5) * W) / n - shift(18)
        return (
          <Chip key={i} ref={el => { refs.current[i] = el }} label={channelName(c, caps.vcolSets, tr)} value={c} caps={caps} onPick={k => onPick(i, k)}
            style={{ left: clamp(xc - w / 2, 8, W - w - 8) }} onRemove={n > 2 ? () => onRemove(i) : undefined} />
        )
      })}
      {n < MAX_STRIPS && (
        <button type="button" aria-label={tr('addStrip')} title={tr('addStrip')} onClick={onAdd}
          className={cn('pointer-events-auto absolute top-1.5 grid size-6 place-items-center active:scale-[0.96]', floatPill)}
          style={{ left: clamp(W - shift(18) + 4, 8, W - pw - 36) }}>
          <Icon name="plus" size={12} />
        </button>
      )}
    </div>
  )
}

export interface TimelineHandle { setTime(t: number): void }

export const Timeline = React.forwardRef<TimelineHandle, {
  pw: number
  clips: Array<{ name: string; duration: number }>
  clip: number
  playing: boolean
  loop: boolean
  onPlay(): void
  onLoop(): void
  onClip(i: number): void
  onSeek(t: number): void
  ClipMenu: React.ComponentType<{ children: React.ReactElement }>
}>(function Timeline({ pw, clips, clip, playing, loop, onPlay, onLoop, onSeek, ClipMenu }, ref) {
  const tr = useT()
  const slider = React.useRef<HTMLInputElement>(null)
  const label = React.useRef<HTMLSpanElement>(null)
  const dur = clips[clip]?.duration ?? 0
  React.useImperativeHandle(ref, () => ({
    setTime(t: number) {
      if (slider.current && document.activeElement !== slider.current) slider.current.value = String(dur > 0 ? Math.round((t / dur) * 1000) : 0)
      if (label.current) label.current.textContent = `${t.toFixed(2)} / ${dur.toFixed(2)}`
    }
  }), [dur])
  return (
    <div className={cn('pointer-events-auto absolute bottom-3 flex -translate-x-1/2 items-center gap-2 py-1 pr-2 pl-1', floatPill)}
      style={{ left: `calc(50% - ${pw / 2}px)`, width: `min(420px, calc(100% - ${pw}px - 32px))` }}>
      <button type="button" aria-label={playing ? tr('pause') : tr('play')} title={tr('playKey')} onClick={onPlay}
        className="grid size-7 shrink-0 place-items-center rounded-full text-ink-1 hover:bg-fill-hover">
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <ClipMenu>
        <button type="button" className="inline-flex shrink-0 items-center gap-1 px-1 font-mono text-xs text-ink-1">
          {clips[clip]?.name ?? ''}<Icon name="chevron-down" size={12} className="text-ink-2" />
        </button>
      </ClipMenu>
      <input ref={slider} type="range" min={0} max={1000} defaultValue={0} aria-label={tr('timeline')}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--accent-fill)]"
        onInput={e => onSeek((Number((e.target as HTMLInputElement).value) / 1000) * dur)} />
      <span ref={label} className="w-[76px] shrink-0 whitespace-nowrap text-right font-mono text-[11px] tabular-nums text-ink-2">{`0.00 / ${dur.toFixed(2)}`}</span>
      <button type="button" aria-label={tr('loop')} title={tr('loop')} aria-pressed={loop} onClick={onLoop}
        className={cn('grid size-6 shrink-0 place-items-center rounded-md hover:bg-fill-hover', loop ? 'text-accent-ink' : 'text-ink-2')}>
        <Icon name="repeat" size={12} />
      </button>
    </div>
  )
})

export function Note({ pw, children, error }: { pw: number; children: React.ReactNode; error?: boolean }) {
  return (
    <div className={cn('pointer-events-auto absolute top-2 flex h-7 -translate-x-1/2 items-center gap-2 text-xs whitespace-nowrap', floatPill, error ? 'pr-1 pl-3' : 'px-3')}
      style={{ left: `calc(50% - ${pw / 2}px)` }}>
      {children}
    </div>
  )
}

export function LoadingRing({ pw, loaded, total }: { pw: number; loaded: number; total: number | null }) {
  const k = total ? Math.min(1, loaded / total) : null
  const mb = (n: number) => (n / 1e6).toFixed(1)
  return (
    <div className="pointer-events-none absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 justify-items-center gap-2" style={{ left: `calc(50% - ${pw / 2}px)` }}>
      <svg viewBox="0 0 40 40" className={cn('size-10 -rotate-90', k === null && 'bbm-spin')}>
        <circle cx="20" cy="20" r="16" fill="none" strokeWidth="3" stroke="var(--fill-press)" />
        <circle cx="20" cy="20" r="16" fill="none" strokeWidth="3" stroke="var(--ink-1)" strokeLinecap="round" strokeDasharray="100.5"
          strokeDashoffset={k === null ? 75 : (100.5 * (1 - k)).toFixed(1)} />
      </svg>
      {total ? <span className="bbm-num text-[11px] text-ink-2">{mb(Math.min(loaded, total))} / {mb(total)} MB</span> : null}
    </div>
  )
}
