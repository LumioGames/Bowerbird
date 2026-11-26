/**
 * Audio viewer (builtin-plugins.md「音频 · 查看器」, prototype viewers.js `audioViewer`): waveform or spectrum,
 * click to seek, drag to select a region that loops, play / pause / loop / volume, loudness and peak readouts,
 * and clipping positions marked on the waveform.
 */
import * as React from 'react'
import { Pause, Play, TriangleAlert, Volume2 } from 'lucide-react'
import { Slider, type ViewerProps } from '@bowerbird/plugin-sdk/web'
import { signed, timecode } from '../shared/wave.js'
import { mixdown, spectrogram } from './lib/spectrum.js'
import { selectionFrom } from './lib/rules.js'
import { useAudioData, Wave } from './data.js'
import { Grow, IconBtn, Num, Sep, Seg, TextBtn, ViewerFrame, clamp, useSize } from './kit.js'
import { useT } from './i18n.js'

type Display = 'wave' | 'spec'

export function AudioViewer({ asset, source, mode = 'detail' }: ViewerProps) {
  const compact = mode === 'quicklook' || mode === 'compare'
  const tr = useT()
  const data = useAudioData(asset, source)
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const box = useSize(boxRef)
  const [dur, setDur] = React.useState(Number(asset.tech.duration) || 0)
  const [t, setT] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [loop, setLoop] = React.useState(false)
  const [volume, setVolume] = React.useState(80)
  const [sel, setSel] = React.useState<{ a: number; b: number } | null>(null)
  const [display, setDisplay] = React.useState<Display>('wave')

  const current = !source.version
  const loudness = current && typeof asset.tech.loudness === 'number' ? asset.tech.loudness : data.peaks?.loudness ?? null
  const peak = current && typeof asset.tech.peak === 'number' ? asset.tech.peak : data.peaks?.peak ?? null
  const analysis = asset.analysis['bowerbird.audio'] as { clips?: number[] } | undefined
  const clips = (current ? analysis?.clips : undefined) ?? data.peaks?.clips ?? []
  React.useEffect(() => { if (data.peaks?.duration) setDur(d => d || data.peaks!.duration) }, [data.peaks])

  React.useEffect(() => { const a = audioRef.current; if (a) a.volume = volume / 100 }, [volume])

  // Clock and loop points while playing.
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const a = audioRef.current
      if (!a) return
      const end = sel ? sel.b : dur
      if (a.currentTime >= end - 0.005) {
        if (loop || sel) a.currentTime = sel ? sel.a : 0
        else { a.pause(); a.currentTime = end; setT(end); setPlaying(false); return }
      }
      setT(a.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, sel, loop, dur])

  const start = React.useCallback((from?: number) => {
    const a = audioRef.current
    if (!a) return
    const end = sel ? sel.b : dur
    let at = from ?? a.currentTime
    if (at >= end - 0.01 || (sel && at < sel.a)) at = sel ? sel.a : 0
    a.currentTime = at
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [sel, dur])
  const stop = () => { audioRef.current?.pause(); setPlaying(false) }
  const toggle = () => (playing ? stop() : start())

  const autoplay = React.useRef(compact)
  const onLoaded = () => {
    const a = audioRef.current!
    if (Number.isFinite(a.duration) && a.duration > 0) setDur(a.duration)
    a.volume = volume / 100
    if (autoplay.current) { autoplay.current = false; start(0) }
  }

  // Press: click seeks, drag selects (6 px).
  const press = React.useRef<number | null>(null)
  const timeAt = (clientX: number) => { const r = boxRef.current!.getBoundingClientRect(); return clamp((clientX - r.left) / r.width, 0, 1) * dur }
  const handlers: React.HTMLAttributes<HTMLDivElement> = {
    onPointerDown: e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); press.current = timeAt(e.clientX) },
    onPointerMove: e => { if (press.current === null) return; const s = selectionFrom(press.current, timeAt(e.clientX), dur, box.w); if (s) setSel(s) },
    onPointerUp: e => {
      const t0 = press.current
      if (t0 === null) return
      press.current = null
      const s = selectionFrom(t0, timeAt(e.clientX), dur, box.w)
      const a = audioRef.current
      if (!s) { setSel(null); if (a) a.currentTime = t0; setT(t0); if (playing) start(t0) }
      else { setSel(s); if (a) a.currentTime = s.a; setT(s.a); if (playing) start(s.a) }
    },
    onPointerCancel: () => { press.current = null }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (compact) return
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); toggle() }
  }

  const bar = (
    <>
      <IconBtn label={playing ? tr('pause') : tr('play')} title={playing ? tr('pauseKey') : tr('playKey')} onClick={toggle}>{playing ? <Pause /> : <Play />}</IconBtn>
      <Num>{timecode(t)} / {timecode(dur)}</Num>
      <Sep />
      <TextBtn pressed={loop} onClick={() => setLoop(l => !l)}>{tr('loop')}</TextBtn>
      <Volume2 className="size-4 text-ink-2" aria-hidden />
      <Slider aria-label={tr('volume')} className="w-16" min={0} max={100} value={[volume]} onValueChange={v => setVolume(v[0] ?? 0)} />
      <Sep />
      <Seg<Display> label={tr('display')} value={display} onChange={setDisplay} items={[{ value: 'wave', label: tr('wave') }, { value: 'spec', label: tr('spectrum') }]} />
      <Grow />
      {loudness !== null ? <Num>{signed(loudness)} LUFS</Num> : null}
      {peak !== null ? <Num>{tr('peak', { v: signed(peak) })}</Num> : null}
      {clips.length ? (
        <span className="inline-flex flex-none items-center gap-1 text-xs text-danger-ink"><TriangleAlert className="size-3" /><span>{tr('clips', { n: clips.length })}</span></span>
      ) : null}
    </>
  )

  const p = dur ? t / dur : 0
  return (
    <ViewerFrame plugin="bowerbird.audio" mode={mode} bar={bar} rootProps={{ tabIndex: compact ? undefined : 0, onKeyDown }} stageClassName="grid place-items-center">
      <audio ref={audioRef} src={source.url} preload="auto" onLoadedMetadata={onLoaded} onPause={() => setPlaying(false)} />
      <div ref={boxRef} className="relative h-[min(60%,240px)] w-[calc(100%-48px)] cursor-default touch-none" {...handlers}>
        {display === 'wave'
          ? <Wave peaks={data.peaks} bars={220} progress={p} className="absolute inset-0 size-full" />
          : <SpectrumCanvas decode={data.decode} width={box.w} />}
        {clips.map(c => (
          <i key={c} title={tr('clip')} className="pointer-events-none absolute -bottom-2.5 -top-2.5 -ml-px w-0.5 bg-danger-ink before:absolute before:-left-1 before:top-0 before:border-[5px] before:border-transparent before:border-t-danger-ink before:content-['']" style={{ left: `${(dur ? c / dur : 0) * 100}%` }} />
        ))}
        {sel ? (
          <div className="pointer-events-none absolute -bottom-3 -top-3 rounded-[2px] bg-accent-soft shadow-[inset_2px_0_0_var(--accent-ring),inset_-2px_0_0_var(--accent-ring)]"
            style={{ left: `${sel.a / dur * 100}%`, width: `${(sel.b - sel.a) / dur * 100}%` }} />
        ) : null}
        <div className="pointer-events-none absolute -bottom-3 -top-3 -ml-px w-0.5 rounded-[1px] bg-ink-1" style={{ left: `${p * 100}%` }} />
      </div>
    </ViewerFrame>
  )
}

/** Spectrum view: decoded in the browser, drawn in the accent colour with intensity as opacity. */
function SpectrumCanvas({ decode, width }: { decode: () => Promise<AudioBuffer>; width: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const cols = Math.max(64, Math.min(800, Math.round(width / 2) || 440))
  React.useEffect(() => {
    let gone = false
    decode().then(buf => {
      const c = ref.current
      if (gone || !c) return
      const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
      const sp = spectrogram(mixdown(chans), buf.sampleRate, cols, 96)
      c.width = sp.cols; c.height = sp.rows
      const x = c.getContext('2d')!
      const color = getComputedStyle(c).getPropertyValue('--accent-ink').trim() || '#7aa7ff'
      x.clearRect(0, 0, c.width, c.height)
      x.fillStyle = color
      for (let r = 0; r < sp.rows; r++) for (let k = 0; k < sp.cols; k++) {
        const v = sp.data[r * sp.cols + k]!
        if (v < 0.02) continue
        x.globalAlpha = Math.pow(v, 1.6)
        x.fillRect(k, r, 1, 1)
      }
    }).catch(() => {})
    return () => { gone = true }
  }, [decode, cols])
  return <canvas ref={ref} className="absolute inset-0 size-full" />
}
