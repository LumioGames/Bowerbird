/**
 * Video compare (builtin-plugins.md「视频 · 对比视图」, prototype compare.js `FMT.video`): side by side or wipe;
 * both play and scrub together on one clock, with the end of each marked on the shared timeline.
 * The wipe divider is the shell's (`split`).
 */
import * as React from 'react'
import { Pause, Play } from 'lucide-react'
import type { AssetDetail, CompareModeSupport } from '@bowerbird/schema'
import type { CompareProps, CompareSide } from '@bowerbird/plugin-sdk/web'
import { timecode } from './lib/time.js'
import { IconBtn, Num, SideLabel, clamp, useSize } from './kit.js'
import { t as pageT, useT } from './i18n.js'

/** prototype compare.js `WHY.video`. */
export const REASON_VIDEO = '视频只能并排或卷帘'

export function videoCompareModes(left: AssetDetail, right: AssetDetail): CompareModeSupport[] | null {
  if (left.format !== 'video' || right.format !== 'video') return null
  return [
    { mode: 'side', available: true, default: true },
    { mode: 'wipe', available: true },
    { mode: 'overlay', available: false, reason: pageT('reasonVideo') },
    { mode: 'diff', available: false, reason: pageT('reasonVideo') }
  ]
}

const label = (s: CompareSide, current: string) => (s.version ? `v${s.version.n}${s.version.current ? ` · ${current}` : ''}` : s.asset.name)
/** Keep a video within this many seconds of the shared clock. */
const DRIFT = 0.08

export function VideoCompare({ left, right, mode, split }: CompareProps) {
  const tr = useT()
  const va = React.useRef<HTMLVideoElement>(null), vb = React.useRef<HTMLVideoElement>(null)
  const paneRef = React.useRef<HTMLDivElement>(null)
  const pane = useSize(paneRef, mode)
  const [da, setDa] = React.useState(Number(left.asset.tech.duration) || 0)
  const [db, setDb] = React.useState(Number(right.asset.tech.duration) || 0)
  const T = Math.max(da, db, 0.001)
  const [t, setT] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const clock = React.useRef({ t: 0, last: 0 })

  const sync = React.useCallback((time: number, play: boolean) => {
    for (const [ref, d] of [[va, da], [vb, db]] as const) {
      const v = ref.current
      if (!v) continue
      const want = Math.min(time, Math.max(0, d - 0.001))
      if (Math.abs(v.currentTime - want) > DRIFT) v.currentTime = want
      if (play && time < d) { if (v.paused) v.play().catch(() => {}) } else if (!v.paused) v.pause()
    }
  }, [da, db])

  React.useEffect(() => {
    if (!playing) { sync(clock.current.t, false); return }
    let raf = 0
    clock.current.last = performance.now()
    const tick = (now: number) => {
      const c = clock.current
      c.t += (now - c.last) / 1000
      c.last = now
      if (c.t >= T) c.t = 0
      sync(c.t, true)
      setT(c.t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, T, sync])

  const toggle = () => setPlaying(p => !p)
  const seek = (time: number) => { clock.current.t = clamp(time, 0, T); setT(clock.current.t); sync(clock.current.t, playing) }

  const tlRef = React.useRef<HTMLDivElement>(null)
  const held = React.useRef(false)
  const seekFrom = (x: number) => { const r = tlRef.current!.getBoundingClientRect(); seek(clamp((x - r.left) / r.width, 0, 1) * T) }

  const video = (side: CompareSide, ref: React.RefObject<HTMLVideoElement | null>, setD: (d: number) => void, style?: React.CSSProperties) => (
    <video
      ref={ref}
      src={side.source.url}
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 size-full object-contain p-4"
      style={style}
      onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setD(d) }}
    />
  )

  return (
    <div
      data-plugin="bowerbird.video"
      className="flex size-full min-h-0 select-none flex-col outline-none"
      tabIndex={0}
      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle() } }}
    >
      <div className="relative flex min-h-0 flex-1 gap-px bg-line-hairline">
        {mode === 'side' ? (
          <>
            <div className="relative min-w-0 flex-1 overflow-hidden bg-surface-well" onClick={toggle}>
              {video(left, va, setDa)}
              <SideLabel k="A" text={label(left, tr('current'))} />
            </div>
            <div className="relative min-w-0 flex-1 overflow-hidden bg-surface-well" onClick={toggle}>
              {video(right, vb, setDb)}
              <SideLabel k="B" text={label(right, tr('current'))} />
            </div>
          </>
        ) : (
          <div ref={paneRef} className="relative min-w-0 flex-1 overflow-hidden bg-surface-well" onClick={toggle}>
            {video(left, va, setDa)}
            {video(right, vb, setDb, { clipPath: `inset(0 0 0 ${Math.round(split * pane.w)}px)` })}
          </div>
        )}
      </div>
      <div className="flex h-11 flex-none items-center gap-2 bg-surface-panel pl-2 pr-3 shadow-[inset_0_1px_0_var(--line-hairline)]">
        <IconBtn label={playing ? tr('pause') : tr('play')} title={playing ? tr('pauseKey') : tr('playKey')} onClick={toggle}>{playing ? <Pause /> : <Play />}</IconBtn>
        <Num>{timecode(t)}</Num>
        <div
          ref={tlRef}
          className="relative mx-2 h-[22px] flex-1 cursor-pointer touch-none rounded-sm bg-fill-rest"
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); held.current = true; seekFrom(e.clientX) }}
          onPointerMove={e => { if (held.current) seekFrom(e.clientX) }}
          onPointerUp={() => { held.current = false }}
          onPointerCancel={() => { held.current = false }}
        >
          {([['A', da], ['B', db]] as const).filter(([, d]) => d < T - 1e-3).map(([k, d]) => (
            <div key={k} title={tr('ends', { k })} className="absolute inset-y-[3px] -ml-px w-0.5 bg-ink-3" style={{ left: `${d / T * 100}%` }}>
              <span className="absolute -top-px left-[5px] font-mono text-[10px] font-semibold leading-[14px] text-ink-3">{k}</span>
            </div>
          ))}
          <div className="absolute -inset-y-[3px] -ml-px w-0.5 rounded-[1px] bg-accent-fill" style={{ left: `${t / T * 100}%` }} />
        </div>
        <Num>{timecode(da)} · {timecode(db)}</Num>
      </div>
    </div>
  )
}
