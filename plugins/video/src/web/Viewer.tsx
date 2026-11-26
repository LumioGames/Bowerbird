/**
 * Video viewer (builtin-plugins.md「视频 · 查看器」, prototype viewers.js `videoViewer`): play / pause, loop, speed,
 * volume, frame stepping with frame number and timecode, in / out loop, a timeline with a thumbnail strip, and
 * the「更多」menu: set the current frame as the thumbnail, or save it as an image asset (with a source relation
 * to the video and a `render` production record).
 */
import * as React from 'react'
import { ChevronLeft, ChevronRight, Download, Ellipsis, Image as ImageIcon, Pause, Play, RefreshCw, TriangleAlert, Volume2 } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Slider, useShell, type ViewerProps
} from '@bowerbird/plugin-sdk/web'
import { frameAt, frameCount, frameFileName, loopNext, sampleTimes, spriteIndex, stepFrame, timecode, SCRUB_FRAMES } from './lib/time.js'
import { frameCanvas, toBlob } from './render.js'
import { EmptyState, Grow, IconBtn, Num, Sep, Seg, TextBtn, ViewerFrame, clamp, downloadUrl } from './kit.js'
import { useScrubSprite, SpriteTile } from './sprite.js'
import { useT } from './i18n.js'

type Speed = '0.5' | '1' | '2'

function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i) }

export function VideoViewer({ asset, source, mode = 'detail' }: ViewerProps) {
  const shell = useShell()
  const tr = useT()
  const compact = mode === 'quicklook' || mode === 'compare'
  const ref = React.useRef<HTMLVideoElement>(null)
  const fps = Number(asset.tech.frameRate) > 0 ? Number(asset.tech.frameRate) : 30
  const codec = typeof asset.tech.codec === 'string' ? asset.tech.codec : null
  const [dur, setDur] = React.useState(Number(asset.tech.duration) || 0)
  const [t, setT] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [loop, setLoop] = React.useState(true)
  const [speed, setSpeed] = React.useState<Speed>('1')
  const [volume, setVolume] = React.useState(80)
  const [range, setRange] = React.useState<{ a: number; b: number } | null>(null)
  const [error, setError] = React.useState<'decode' | 'load' | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  const a = range?.a ?? 0, b = range?.b ?? dur

  const sprite = useScrubSprite(asset, source.version ? null : asset.id)

  // Drive the clock from the element while playing (rAF gives a smooth play head and precise loop points).
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = ref.current
      if (!v) return
      const next = loopNext(v.currentTime, a, b, loop)
      if (next.t !== v.currentTime) {
        v.currentTime = next.t
        if (next.stop) { v.pause(); setPlaying(false) }
      }
      setT(next.t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, a, b, loop])

  React.useEffect(() => { const v = ref.current; if (v) v.playbackRate = Number(speed) }, [speed])
  React.useEffect(() => { const v = ref.current; if (v) v.volume = volume / 100 }, [volume])

  const play = React.useCallback(() => {
    const v = ref.current
    if (!v) return
    if (v.currentTime >= b - 0.01 || v.currentTime < a) v.currentTime = a
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [a, b])
  const pause = () => { ref.current?.pause(); setPlaying(false) }
  const toggle = () => (playing ? pause() : play())
  const seekTo = (time: number) => { const v = ref.current; if (!v) return; v.currentTime = clamp(time, 0, dur || v.duration || 0); setT(v.currentTime) }
  const step = (d: number) => { pause(); seekTo(stepFrame(ref.current?.currentTime ?? t, fps, dur, d)) }

  // Quick look plays at once (prototype: compact viewers start playing).
  const autoplay = React.useRef(compact)
  const onLoaded = () => {
    const v = ref.current!
    if (!v.videoWidth) return setError('decode')
    if (Number.isFinite(v.duration) && v.duration > 0) setDur(v.duration)
    v.volume = volume / 100
    v.playbackRate = Number(speed)
    if (autoplay.current) { autoplay.current = false; play() }
  }
  const onError = () => {
    const c = ref.current?.error?.code
    setError(c === 3 || c === 4 ? 'decode' : 'load')
  }

  const frame = frameAt(t, fps)
  const total = frameCount(dur || 0, fps)

  async function currentFrame(edge: number): Promise<HTMLCanvasElement | null> {
    const v = ref.current
    if (!v || !v.videoWidth) return null
    pause()
    return frameCanvas(v, edge)
  }
  async function setAsThumbnail() {
    const c = await currentFrame(1024)
    if (!c) return
    try {
      await shell.api.assets.putThumbnail(shell.library.id, asset.id, await toBlob(c, 'image/webp', 0.86))
      shell.toast({ title: tr('thumbDone', { n: frame }), kind: 'success' })
    } catch (e) {
      shell.toast({ title: tr('thumbFailed'), description: e instanceof Error ? e.message : String(e), kind: 'error' })
    }
  }
  async function saveFrame() {
    const c = await currentFrame(Number.MAX_SAFE_INTEGER)
    if (!c) return
    const name = frameFileName(asset.name, frame)
    const belongs = asset.relations.outgoing.filter(r => r.type === 'belongs' && !r.broken).map(r => ({ type: 'belongs', to: r.to }))
    try {
      const res = await shell.api.assets.register(shell.library.id, {
        folder: dirOf(asset.path),
        name,
        stage: asset.stage,
        tags: asset.tags,
        relations: [{ type: 'source', to: asset.id }, ...belongs],
        record: { method: 'render', tool: 'Bowerbird 视频查看器', params: { frame, time: Math.round(t * 1000) / 1000, width: c.width, height: c.height }, inputs: [{ id: asset.id, role: '视频' }] },
        onConflict: 'keep-both'
      }, await toBlob(c, 'image/png'))
      const saved = res.asset
      shell.toast({
        title: tr('frameSaved', { name: saved?.name ?? name }),
        kind: 'success',
        action: saved ? { label: tr('open'), onClick: () => shell.navigate({ to: 'asset', id: saved.id }) } : undefined
      })
    } catch (e) {
      shell.toast({ title: tr('frameFailed'), description: e instanceof Error ? e.message : String(e), kind: 'error' })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (compact) return
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); toggle() }
  }

  // Timeline: click / drag to seek.
  const tlRef = React.useRef<HTMLDivElement>(null)
  const held = React.useRef(false)
  const seekFromPointer = (clientX: number) => {
    const r = tlRef.current!.getBoundingClientRect()
    seekTo(clamp((clientX - r.left) / r.width, 0, 1) * dur)
  }

  if (error === 'decode') {
    const w = Number(asset.tech.width), h = Number(asset.tech.height)
    return (
      <ViewerFrame plugin="bowerbird.video" mode={mode}>
        <EmptyState icon={<TriangleAlert />} title={tr('undecodable')} text={[codec ?? tr('unknownCodec'), w && h ? `${w} × ${h}` : ''].filter(Boolean).join(' · ')} actions={[
          { label: tr('retry'), icon: <RefreshCw />, primary: true, onClick: () => { setError(null); setAttempt(n => n + 1) } },
          { label: tr('download'), icon: <Download />, onClick: () => downloadUrl(source.url, asset.name) }
        ]} />
      </ViewerFrame>
    )
  }
  if (error === 'load') {
    return (
      <ViewerFrame plugin="bowerbird.video" mode={mode}>
        <EmptyState icon={<TriangleAlert />} title={tr('viewerError')} text="bowerbird.video" actions={[
          { label: tr('download'), icon: <Download />, primary: true, onClick: () => downloadUrl(source.url, asset.name) },
          { label: tr('retry'), icon: <RefreshCw />, onClick: () => { setError(null); setAttempt(n => n + 1) } }
        ]} />
      </ViewerFrame>
    )
  }

  const bar = (
    <>
      <IconBtn label={playing ? tr('pause') : tr('play')} title={playing ? tr('pauseKey') : tr('playKey')} onClick={toggle}>{playing ? <Pause /> : <Play />}</IconBtn>
      <IconBtn label={tr('prevFrame')} onClick={() => step(-1)}><ChevronLeft /></IconBtn>
      <IconBtn label={tr('nextFrame')} onClick={() => step(1)}><ChevronRight /></IconBtn>
      <Num>{timecode(t)}{'  ·  '}{tr('frame', { i: frame, n: total })}</Num>
      <Sep />
      <TextBtn pressed={loop} onClick={() => setLoop(l => !l)}>{tr('loop')}</TextBtn>
      <Seg<Speed> label={tr('speed')} value={speed} onChange={setSpeed} items={[{ value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]} />
      <Volume2 className="size-4 text-ink-2" aria-hidden />
      <Slider aria-label={tr('volume')} className="w-16" min={0} max={100} value={[volume]} onValueChange={v => setVolume(v[0] ?? 0)} />
      <Sep />
      <TextBtn title={tr('inTitle')} onClick={() => setRange({ a: Math.min(t, b - 0.1), b })}>{tr('in')}</TextBtn>
      <TextBtn title={tr('outTitle')} onClick={() => setRange({ a, b: Math.max(t, a + 0.1) })}>{tr('out')}</TextBtn>
      <Grow />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <span><IconBtn label={tr('more')}><Ellipsis /></IconBtn></span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { void setAsThumbnail() }}><ImageIcon />{tr('setThumb')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void saveFrame() }}><Download />{tr('saveFrame')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  const foot = compact ? null : (
    <div
      ref={tlRef}
      className="relative h-10 cursor-default touch-none overflow-hidden rounded-sm bg-surface-well"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); held.current = true; seekFromPointer(e.clientX) }}
      onPointerMove={e => { if (held.current) seekFromPointer(e.clientX) }}
      onPointerUp={() => { held.current = false }}
      onPointerCancel={() => { held.current = false }}
    >
      {sprite ? (
        <div className="pointer-events-none absolute inset-0 flex opacity-60">
          {sampleTimes(1, 10).map((x, i) => <SpriteTile key={i} sprite={sprite} index={spriteIndex(x, SCRUB_FRAMES)} className="h-full min-w-0 flex-1 object-cover" />)}
        </div>
      ) : null}
      {range ? (
        <div className="pointer-events-none absolute inset-y-0 bg-accent-soft shadow-[inset_2px_0_0_var(--accent-ring),inset_-2px_0_0_var(--accent-ring)]"
          style={{ left: `${a / (dur || 1) * 100}%`, width: `${(b - a) / (dur || 1) * 100}%` }} />
      ) : null}
      <div className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 rounded-[1px] bg-ink-1 shadow-[0_0_0_1px_var(--surface-well)]" style={{ left: `${t / (dur || 1) * 100}%` }} />
    </div>
  )

  return (
    <ViewerFrame plugin="bowerbird.video" mode={mode} bar={bar} foot={foot} rootProps={{ tabIndex: compact ? undefined : 0, onKeyDown }}>
      <video
        key={attempt}
        ref={ref}
        src={source.url}
        className="absolute inset-0 size-full object-contain p-4"
        playsInline
        preload="auto"
        onLoadedData={onLoaded}
        onError={onError}
        onSeeked={e => setT(e.currentTarget.currentTime)}
        onPause={() => setPlaying(false)}
        onEnded={() => { if (loop) play(); else setPlaying(false) }}
        onClick={toggle}
      />
    </ViewerFrame>
  )
}
