/**
 * Audio compare (builtin-plugins.md「音频 · 对比视图」, prototype compare.js `FMT.audio`): two waveforms stacked
 * on one time axis; click either one to hear it from that point, and switching A / B keeps the position.
 */
import * as React from 'react'
import { ArrowUpDown, Pause, Play, Volume2 } from 'lucide-react'
import { cn, type CompareProps, type CompareSide } from '@bowerbird/plugin-sdk/web'
import { timecode } from '../shared/wave.js'
import { useAudioData, Wave } from './data.js'
import { Grow, IconBtn, Key, Num, Seg, TextBtn, clamp } from './kit.js'
import { useT } from './i18n.js'

type Ear = 'a' | 'b'
const label = (s: CompareSide, current: string) => (s.version ? `v${s.version.n}${s.version.current ? ` · ${current}` : ''}` : s.asset.name)

export function AudioCompare({ left, right }: CompareProps) {
  const tr = useT()
  const da0 = Number(left.asset.tech.duration) || 0, db0 = Number(right.asset.tech.duration) || 0
  const [durs, setDurs] = React.useState({ a: da0, b: db0 })
  const T = Math.max(durs.a, durs.b, 0.001)
  const [ear, setEar] = React.useState<Ear>('a')
  const [t, setT] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const refs = { a: React.useRef<HTMLAudioElement>(null), b: React.useRef<HTMLAudioElement>(null) }
  const clock = React.useRef({ t: 0, last: 0 })
  const rowsRef = React.useRef<HTMLDivElement>(null)

  const sound = React.useCallback((which: Ear, at: number, play: boolean) => {
    for (const k of ['a', 'b'] as const) {
      const el = refs[k].current
      if (!el) continue
      if (k === which && play && at < durs[k]) { el.currentTime = at; el.play().catch(() => {}) } else el.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durs])

  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    clock.current.last = performance.now()
    const tick = (now: number) => {
      const c = clock.current
      c.t += (now - c.last) / 1000
      c.last = now
      if (c.t >= T) { c.t = T; setT(T); setPlaying(false); sound(ear, T, false); return }
      setT(c.t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, T, ear, sound])

  const start = () => { if (clock.current.t >= T - 0.01) clock.current.t = 0; setT(clock.current.t); sound(ear, clock.current.t, true); setPlaying(true) }
  const stop = () => { setPlaying(false); sound(ear, clock.current.t, false) }
  const toggle = () => (playing ? stop() : start())
  const listen = (k: Ear) => { if (k === ear) return; setEar(k); sound(k, clock.current.t, playing) }

  const seekOn = (k: Ear, clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    clock.current.t = clamp((clientX - r.left) / r.width, 0, 1) * T
    setT(clock.current.t)
    if (k !== ear) setEar(k)
    sound(k, clock.current.t, playing)
  }

  const row = (k: Ear, side: CompareSide) => (
    <Row key={k} k={k} side={side} on={ear === k} T={T} t={t} dur={durs[k]} onListen={() => listen(k)} onSeek={(x, el) => seekOn(k, x, el)} />
  )

  return (
    <div
      data-plugin="bowerbird.audio"
      className="flex size-full min-h-0 select-none flex-col outline-none"
      tabIndex={0}
      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle() } }}
    >
      <audio ref={refs.a} src={left.source.url} preload="auto" onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDurs(s => ({ ...s, a: d })) }} />
      <audio ref={refs.b} src={right.source.url} preload="auto" onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDurs(s => ({ ...s, b: d })) }} />
      <div className="relative flex min-h-0 flex-1 items-center bg-surface-canvas px-5 py-6">
        <div ref={rowsRef} className="relative grid flex-1 gap-3">
          {row('a', left)}
          {row('b', right)}
        </div>
      </div>
      <div className="flex h-11 flex-none items-center gap-2 bg-surface-panel pl-2 pr-3 shadow-[inset_0_1px_0_var(--line-hairline)]">
        <IconBtn label={playing ? tr('pause') : tr('play')} title={playing ? tr('pauseKey') : tr('playKey')} onClick={toggle}>{playing ? <Pause /> : <Play />}</IconBtn>
        <Num>{timecode(t)} / {timecode(T)}</Num>
        <Grow />
        <Seg<Ear> label={tr('listening')} value={ear} onChange={listen} items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
        <TextBtn title={tr('flipTitle')} onClick={() => listen(ear === 'a' ? 'b' : 'a')}><ArrowUpDown />{tr('flip')}</TextBtn>
      </div>
    </div>
  )
}

function Row(props: { k: Ear; side: CompareSide; on: boolean; T: number; t: number; dur: number; onListen(): void; onSeek(clientX: number, el: HTMLElement): void }) {
  const { peaks } = useAudioData(props.side.asset, props.side.source)
  const tr = useT()
  const held = React.useRef(false)
  const width = props.dur / props.T
  return (
    <div className="flex h-[120px] items-stretch gap-3">
      <button
        type="button"
        title={tr('listen', { k: props.k.toUpperCase() })}
        onClick={props.onListen}
        className={cn('group flex w-[152px] flex-none flex-col items-start justify-center gap-1 rounded-md px-3 py-2 text-left text-ink-2 transition-colors duration-fade hover:bg-fill-hover', props.on ? 'bg-accent-soft' : 'bg-fill-rest')}
      >
        <Key>{props.k.toUpperCase()}</Key>
        <span className="max-w-full truncate font-semibold text-ink-1">{label(props.side, tr('current'))}</span>
        <small className="text-xs tabular-nums">{timecode(props.dur)}</small>
        <Volume2 className={cn('size-3 text-accent-ink transition-opacity duration-fade', props.on ? 'opacity-100' : 'opacity-0')} />
      </button>
      <div
        className="relative min-w-0 flex-1 cursor-pointer touch-none rounded-md bg-surface-well"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); held.current = true; props.onSeek(e.clientX, e.currentTarget) }}
        onPointerMove={e => { if (held.current) props.onSeek(e.clientX, e.currentTarget) }}
        onPointerUp={() => { held.current = false }}
        onPointerCancel={() => { held.current = false }}
      >
        <div className="relative h-full overflow-hidden" style={{ width: `${width * 100}%` }}>
          <Wave
            peaks={peaks}
            bars={Math.max(24, Math.round(160 * width))}
            progress={props.dur ? props.t / props.dur : 0}
            className="block size-full"
            restClass={props.on ? 'fill-ink-2' : 'fill-ink-3'}
            playedClass={props.on ? 'fill-accent-fill' : 'fill-ink-2'}
          />
        </div>
        <div className="pointer-events-none absolute -bottom-2 -top-2 -ml-px w-0.5 rounded-[1px] bg-ink-1" style={{ left: `${props.t / props.T * 100}%` }} />
      </div>
    </div>
  )
}
