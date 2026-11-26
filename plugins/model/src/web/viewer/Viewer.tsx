/**
 * The 3D model viewer (builtin-plugins.md「查看器功能」, prototype model.js). Tool bar: what changes every few
 * seconds while checking (split mode, channel, projection, framing, turntable, size, output, options). On the
 * viewport: what is manipulated in place (orbit, view cube, wipe divider, strip channels, animation). The
 * 「查看选项」panel: what is set once per session and what is only read.
 * Quick look and the shell's side-by-side compare get the compact form: turntable, no chrome.
 */
import * as React from 'react'
import * as THREE from 'three'
import {
  Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, useShell, type ViewerProps
} from '@bowerbird/plugin-sdk/web'
import { getHub, canvasToBlob, pixelRatio } from '../three/hub'
import { loadModel, ModelLoadError, type LoadedModel } from '../three/load'
import { analyze, type ModelAnalysis } from '../three/analyze'
import { ModelStage } from '../three/stage'
import { builtinEnv, builtinEnvTexture, envGradient, envName, hdrEnvironment, BUILTIN_ENVS } from '../three/env'
import { ViewerEngine, initialState, PANEL_W, type ViewState, type SplitMode } from './engine'
import { channelName, initialStrips, initialWipe, nextStrip, parseChannel, NO_CAPS } from '../lib/channels'
import { ChannelMenu } from './ChannelMenu'
import { WipeOverlay, StripsOverlay, Timeline, Note, LoadingRing, type TimelineHandle } from './Overlays'
import { Panel, type HdrAsset } from './Panel'
import { ShotDialog } from './ShotDialog'
import { drawGizmo, drawSize } from './frame-overlays'
import { ensureStyles } from './styles'
import { describeFailure, NoWebGLError } from '../failure'
import { useT } from '../i18n'
import { IconButton, Seg } from './ui'
import { Icon } from '../icons'
import { loadSettings, modelSettings } from '../settings'

type LoadState =
  | { phase: 'loading'; loaded: number; total: number | null; ring: boolean; parsing: boolean }
  | { phase: 'ready' }
  | { phase: 'error'; error: unknown }

interface Loaded { model: LoadedModel; analysis: ModelAnalysis; stage: ModelStage }

/**
 * Why the model is not shown, in the shell's language. Retry only where another try can differ (a fetch, or a
 * decode that may have been cut short); a Draco mesh or a browser without WebGL gives the same answer again.
 */
function Failure({ error, url, name, onRetry }: { error: unknown; url: string; name: string; onRetry(): void }) {
  const tr = useT()
  const { title, detail, raw } = describeFailure(error, tr)
  const noWebgl = error instanceof NoWebGLError
  const unsupported = error instanceof ModelLoadError && error.kind === 'unsupported'
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div role="alert" className="grid max-w-sm justify-items-center gap-2 text-center">
        <div className="grid size-10 place-items-center rounded-full bg-fill-rest text-ink-2"><Icon name={noWebgl || unsupported ? 'circle-alert' : 'triangle-alert'} size={24} /></div>
        <h3 className="text-sm font-medium text-ink-1">{title}</h3>
        {detail && <p className={cn('text-xs text-ink-2', raw ? 'font-mono break-all' : 'text-pretty')}>{detail}</p>}
        {!noWebgl && (
          <div className="mt-2 flex gap-2">
            {!unsupported && <Button size="sm" onClick={onRetry}><Icon name="refresh-cw" size={14} />{tr('retry')}</Button>}
            <Button size="sm" variant={unsupported ? 'secondary' : 'outline'} asChild><a href={url} download={name}><Icon name="download" size={14} />{tr('download')}</a></Button>
          </div>
        )}
      </div>
    </div>
  )
}

const STORE_PANEL = 'viewer.panel'
const STORE_SECTIONS = 'viewer.sections'

export function ModelViewer({ asset, source, mode = 'detail' }: ViewerProps) {
  ensureStyles()
  const shell = useShell()
  const tr = useT()
  const trRef = React.useRef(tr)
  trRef.current = tr
  const compact = mode === 'quicklook' || mode === 'compare'
  const [st, setSt] = React.useState<ViewState>(() => ({
    ...initialState(compact, modelSettings().defaultEnvironment),
    panel: !compact && !!shell.storage.get<boolean>(STORE_PANEL)
  }))
  const set = React.useCallback((p: Partial<ViewState>) => setSt(s => ({ ...s, ...p })), [])
  const [load, setLoad] = React.useState<LoadState>({ phase: 'loading', loaded: 0, total: asset.size || null, ring: false, parsing: false })
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [size, setSize] = React.useState({ W: 1, H: 1 })
  const [reload, setReload] = React.useState(0)
  const [sections, setSections] = React.useState<Record<string, boolean>>(() => shell.storage.get(STORE_SECTIONS) ?? {})
  const [hdrs, setHdrs] = React.useState<HdrAsset[] | null>(null)
  const [shotOpen, setShotOpen] = React.useState(false)
  const envTouched = React.useRef(false)
  const failedOnce = React.useRef<string | null>(null)

  const rootRef = React.useRef<HTMLDivElement>(null)
  const viewRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const dimsRef = React.useRef<HTMLDivElement>(null)
  const gizmoRef = React.useRef<SVGSVGElement>(null)
  const timelineRef = React.useRef<TimelineHandle>(null)
  const engineRef = React.useRef<ViewerEngine | null>(null)
  const stRef = React.useRef(st)
  stRef.current = st

  const caps = loaded?.analysis.caps ?? NO_CAPS
  const clips = React.useMemo(() => (loaded?.model.animations ?? []).map((c, i) => ({ name: c.name || tr('clipN', { n: i + 1 }), duration: c.duration })), [loaded, tr])

  /* settings: the library's default environment, unless the person already picked one */
  React.useEffect(() => {
    void loadSettings(shell).then(s => { if (!envTouched.current) setSt(p => ({ ...p, env: s.defaultEnvironment })); engineRef.current?.invalidate() })
  }, [shell])

  /* engine + loading; a new file (or a version) loads from scratch */
  React.useEffect(() => {
    const hub = getHub()
    const canvas = canvasRef.current
    if (!hub || !canvas) { setLoad({ phase: 'error', error: new NoWebGLError() }); return }
    const engine = new ViewerEngine(hub, canvas, stRef.current, {
      compact,
      pixelRatio: () => pixelRatio(modelSettings().maxPixelRatio),
      onFrame: f => {
        const s = stRef.current
        if (dimsRef.current) {
          if (s.dims && !compact) drawSize(dimsRef.current, f.cam as THREE.PerspectiveCamera, f.W, f.H, f.stage.info.bounds, s.fov, trRef.current)
          else dimsRef.current.innerHTML = ''
        }
        if (gizmoRef.current && !compact) drawGizmo(gizmoRef.current, f.cam, trRef.current)
      },
      onTime: (t, playing) => {
        timelineRef.current?.setTime(t)
        if (!playing && stRef.current.play) setSt(s => ({ ...s, play: false }))
      },
      onTurnChange: on => setSt(s => (s.turn === on ? s : { ...s, turn: on }))
    })
    engineRef.current = engine
    const r = viewRef.current?.getBoundingClientRect()
    if (r) engine.resize(r.width, r.height)
    const ac = new AbortController()
    setLoaded(null)
    setLoad({ phase: 'loading', loaded: 0, total: asset.size || null, ring: false, parsing: false })
    const ringTimer = setTimeout(() => setLoad(l => (l.phase === 'loading' ? { ...l, ring: true } : l)), 150)
    let last = 0
    loadModel(source, asset.name, {
      signal: ac.signal,
      sizeHint: asset.size,
      onProgress: (n, total, phase) => {
        const now = performance.now()
        if (phase === 'download' && now - last < 60) return
        last = now
        setLoad(l => (l.phase === 'loading' ? { ...l, loaded: n, total: total ?? l.total, parsing: phase === 'parse' } : l))
      }
    }).then(model => {
      if (ac.signal.aborted) { model.dispose(); return }
      const analysis = analyze(model)
      const stage = new ModelStage(model, analysis)
      engine.attach(stage)
      setLoaded({ model, analysis, stage })
      setLoad({ phase: 'ready' })
      failedOnce.current = null
    }).catch((e: unknown) => {
      if ((e as Error)?.name === 'AbortError' || ac.signal.aborted) return
      const kind = e instanceof ModelLoadError ? e.kind : 'decode'
      if (failedOnce.current === kind) shell.toast({ title: trRef.current(kind === 'load' ? 'retryStillLoad' : 'retryStillDecode'), kind: 'error' })
      failedOnce.current = kind
      setLoad({ phase: 'error', error: e })
    }).finally(() => clearTimeout(ringTimer))
    return () => {
      ac.abort()
      clearTimeout(ringTimer)
      engine.dispose()
      engineRef.current = null
    }
    // the file to show is the source; asset fields only label it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url, reload, compact])

  React.useEffect(() => { engineRef.current?.setState(st) }, [st])

  /* environment: built-in ones at once; an HDR from the library when it has loaded */
  React.useEffect(() => {
    const engine = engineRef.current, hub = getHub()
    if (!engine || !hub || !loaded) return
    if (st.env.startsWith('asset:')) {
      let live = true
      const url = shell.api.assets.fileUrl(shell.library.id, st.env.slice(6))
      hdrEnvironment(hub, url).then(h => { if (live) engine.setEnvironment(h.env, h.background) }).catch(() => {
        if (!live) return
        shell.toast({ title: trRef.current('hdrFailed'), kind: 'error' })
        set({ env: 'studio' })
      })
      return () => { live = false }
    }
    engine.setEnvironment(builtinEnvTexture(hub, st.env), null)
    return undefined
  }, [st.env, loaded, shell, set])

  /* viewport size */
  React.useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ W: r.width, H: r.height })
      engineRef.current?.resize(r.width, r.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const togglePanel = () => { const v = !st.panel; shell.storage.set(STORE_PANEL, v); set({ panel: v }) }
  const toggleSection = (id: string) => setSections(s => {
    const defaults: Record<string, boolean> = { env: true, light: true, cam: false, struct: false, anim: true, info: false }
    const next = { ...s, [id]: !(s[id] ?? defaults[id]) }
    shell.storage.set(STORE_SECTIONS, next)
    return next
  })
  const loadHdrs = () => {
    if (hdrs !== null) return
    shell.api.search(shell.library.id, { filter: { format: ['unknown'] }, sort: 'name', limit: 1000 })
      .then(r => setHdrs(r.items.filter(a => /\.hdr$/i.test(a.name)).map(a => ({ id: a.id, name: a.name }))))
      .catch(() => setHdrs([]))
  }
  React.useEffect(() => { if (st.panel) loadHdrs() /* the tile shows the chosen HDR's name */ }, [st.panel]) // eslint-disable-line react-hooks/exhaustive-deps

  const setMode = (m: SplitMode) => {
    if (m === st.mode) return
    const p: Partial<ViewState> = { mode: m }
    if (m === 'wipe') p.wipe = { ch: initialWipe(st.ch), x: (size.W - (st.panel ? PANEL_W : 0)) / 2 / Math.max(1, size.W), y: 0.5, ang: 0 }
    if (m === 'strips' && st.mode === 'single') p.strips = initialStrips(st.ch)
    set(p)
  }

  /* output */
  const background = React.useCallback((ctx: CanvasRenderingContext2D, px: number) => {
    const s = stRef.current
    if (s.bg === 'color') { ctx.fillStyle = s.bgColor; ctx.fillRect(0, 0, px, px); return }
    if (s.env.startsWith('asset:') && s.bg === 'env') return
    const e = builtinEnv(s.env) ?? BUILTIN_ENVS[0]!
    const g = ctx.createLinearGradient(0, 0, 0, px)
    g.addColorStop(0, e.sky[0]); g.addColorStop(1, e.sky[1])
    ctx.fillStyle = g; ctx.fillRect(0, 0, px, px)
  }, [])
  const shoot = React.useCallback((px: number, transparent: boolean) => engineRef.current!.capture(px, transparent, background), [background])
  const shotParams = React.useCallback(() => {
    const s = stRef.current, e = engineRef.current
    const cam = e?.camera(), target = e?.orbit?.target
    const r3 = (v: THREE.Vector3 | undefined) => (v ? [v.x, v.y, v.z].map(n => Math.round(n * 1000) / 1000) : null)
    const builtin = builtinEnv(s.env)
    const env = s.env.startsWith('asset:') ? hdrs?.find(h => 'asset:' + h.id === s.env)?.name ?? s.env : builtin ? envName(builtin, tr) : s.env
    return {
      channel: channelName(s.mode === 'single' ? s.ch : 'full', caps.vcolSets, tr),
      camera: { projection: s.ortho ? 'orthographic' : 'perspective', fov: s.fov, position: r3(cam?.position), target: r3(target) },
      environment: { name: env, rotation: s.envRot, exposure: s.exp, toneMapping: s.tone }
    }
  }, [caps.vcolSets, hdrs, tr])
  const setThumbnail = async () => {
    const lib = shell.library.id
    try {
      const blob = await canvasToBlob(shoot(512, false), 'image/webp', 0.9)
      let prev: Blob | null = null
      if (asset.thumbnailManual) prev = await fetch(shell.api.assets.thumbnailUrl(lib, asset.id)).then(r => (r.ok ? r.blob() : null)).catch(() => null)
      await shell.api.assets.putThumbnail(lib, asset.id, blob)
      shell.toast({
        title: tr('thumbSet'), kind: 'success',
        undo: async () => { if (prev) await shell.api.assets.putThumbnail(lib, asset.id, prev); else await shell.api.assets.clearThumbnail(lib, asset.id) }
      })
    } catch (e) {
      shell.toast({ title: tr('thumbFailed'), description: (e as Error).message, kind: 'error' })
    }
  }

  /* pointer on the viewport: orbit, pan (Shift or right button), zoom, double-click to frame */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    rootRef.current?.focus({ preventScroll: true })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    engineRef.current?.pointerDown(e.clientX, e.clientY, e.shiftKey || e.button === 2)
  }
  React.useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const wheel = (e: WheelEvent) => { e.preventDefault(); engineRef.current?.wheel(e.deltaY) }
    c.addEventListener('wheel', wheel, { passive: false })
    return () => c.removeEventListener('wheel', wheel)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' && clips.length && !(e.target as HTMLElement).closest('input, textarea')) {
      e.preventDefault(); e.stopPropagation(); set({ play: !st.play })
    }
  }

  const pw = st.panel && !compact ? PANEL_W : 0
  const hdrBg = st.env.startsWith('asset:')
  const viewBg: React.CSSProperties = st.bg === 'color' ? { background: st.bgColor }
    : st.bg === 'env' && !(hdrBg && loaded) ? { background: envGradient(builtinEnv(st.env) ?? BUILTIN_ENVS[0]!) } : {}
  const vcolNote = st.mode === 'single' && parseChannel(st.ch).base === 'vcol' && caps.vcolSets === 0
  const missing = loaded?.model.missing ?? []
  const split = !compact && st.mode !== 'single'

  const ClipMenu = React.useCallback(({ children }: { children: React.ReactElement }) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        {clips.map((c, i) => (
          <DropdownMenuItem key={i} onSelect={() => set({ clip: i })}>
            <span className="inline-grid w-4 place-items-center">{i === stRef.current.clip && <Icon name="check" size={14} />}</span>{c.name} · {tr('seconds', { s: c.duration.toFixed(1) })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ), [clips, set, tr])

  // the animation bar is centred on the stage (left of an open panel) and at most 420 px wide; the scale box sits in the
  // bottom-left corner (about 160 px with its margin): when they would meet, the scale box moves up (styles.ts)
  const timelineW = Math.min(420, size.W - pw - 32)
  const liftScale = clips.length > 0 && (size.W - pw) / 2 - timelineW / 2 < 172
  return (
    <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} className="relative flex size-full flex-col overflow-hidden outline-none">
      {!compact && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line-hairline px-2">
          {/* prototype order (model.js): channel menu, then 单视图 / 卷帘 / 多通道斜切 */}
          <ChannelMenu value={st.ch} caps={caps} onPick={k => set({ ch: k })}>
            <button type="button" title={tr('channel')} aria-hidden={split} tabIndex={split ? -1 : 0}
              className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-1 hover:bg-fill-hover', split && 'invisible')}>
              {channelName(st.ch, caps.vcolSets, tr)}<Icon name="chevron-down" size={12} className="text-ink-2" />
            </button>
          </ChannelMenu>
          <Seg<SplitMode> label={tr('splitMode')} value={st.mode} onChange={setMode}
            items={[{ value: 'single', icon: 'square', title: tr('single') }, { value: 'wipe', icon: 'square-split-horizontal', title: tr('wipe') }, { value: 'strips', icon: 'columns-3', title: tr('strips') }]} />
          <i className="mx-1 h-4 w-px bg-line-hairline" />
          <Seg label={tr('projection')} value={st.ortho ? 'ortho' : 'persp'} onChange={v => set({ ortho: v === 'ortho' })}
            items={[{ value: 'persp', label: tr('persp') }, { value: 'ortho', label: tr('ortho') }]} />
          <IconButton icon="focus" label={tr('frame')} onClick={() => engineRef.current?.frameAll()} />
          <IconButton icon="rotate-3d" label={tr('turntable')} pressed={st.turn} onClick={() => set({ turn: !st.turn })} />
          <IconButton icon="box" label={tr('dimsTitle')} pressed={st.dims} onClick={() => set({ dims: !st.dims })} />
          <span className="flex-1" />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={!loaded} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-ink-1 hover:bg-fill-hover disabled:opacity-40">
                <Icon name="camera" size={12} />{tr('output')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void setThumbnail()}><Icon name="image" size={14} />{tr('setThumb')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShotOpen(true)}><Icon name="image-plus" size={14} />{tr('saveImage')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton icon="sliders-horizontal" label={tr('viewOptions')} pressed={st.panel} onClick={togglePanel} />
        </div>
      )}
      <div ref={viewRef} className={cn('relative min-h-0 flex-1 overflow-hidden', st.bg === 'none' && 'bbm-checker', liftScale && 'bbm-lift-scale')} style={viewBg}>
        <canvas ref={canvasRef} className={cn('absolute inset-0 block size-full cursor-grab touch-none active:cursor-grabbing', load.phase === 'ready' && 'bbm-arrive')}
          onPointerDown={onPointerDown}
          onPointerMove={e => engineRef.current?.pointerMove(e.clientX, e.clientY)}
          onPointerUp={() => engineRef.current?.pointerUp()} onPointerCancel={() => engineRef.current?.pointerUp()}
          onDoubleClick={() => engineRef.current?.frameAll()} onContextMenu={e => e.preventDefault()} />
        <div ref={dimsRef} className={cn('pointer-events-none absolute inset-0', load.phase !== 'ready' && 'hidden')} />
        {loaded && !compact && st.mode === 'wipe' && (
          <WipeOverlay W={size.W} H={size.H} pw={pw} wipe={st.wipe} caps={caps}
            onChange={w => setSt(s => ({ ...s, wipe: { ...s.wipe, ...w } }))}
            onPick={(i, k) => setSt(s => { const ch = [...s.wipe.ch] as [string, string]; ch[i] = k; return { ...s, wipe: { ...s.wipe, ch } } })} />
        )}
        {loaded && !compact && st.mode === 'strips' && (
          <StripsOverlay W={size.W} H={size.H} pw={pw} strips={st.strips} caps={caps}
            onPick={(i, k) => setSt(s => { const strips = [...s.strips]; strips[i] = k; return { ...s, strips } })}
            onRemove={i => setSt(s => ({ ...s, strips: s.strips.filter((_, j) => j !== i) }))}
            onAdd={() => setSt(s => { const n = nextStrip(s.strips, caps) ?? 'full'; return { ...s, strips: [...s.strips, n] } })} />
        )}
        {loaded && !compact && clips.length > 0 && (
          <Timeline ref={timelineRef} pw={pw} clips={clips} clip={st.clip} playing={st.play} loop={st.loop}
            onPlay={() => set({ play: !st.play })} onLoop={() => set({ loop: !st.loop })} onClip={i => set({ clip: i })}
            onSeek={t => { set({ play: false }); engineRef.current?.setTime(t) }} ClipMenu={ClipMenu} />
        )}
        {!compact && missing.length > 0 && (
          <Note pw={pw} error>
            <Icon name="unlink" size={12} className="text-danger-ink" />
            <span>{tr('missingBefore')} <b className="font-mono font-normal">{missing[0]}</b>{missing.length > 1 ? tr('missingMore', { n: missing.length }) : ''}</span>
            <Button size="xs" variant="secondary" className="rounded-full" onClick={() => shell.navigate({ to: 'asset', id: asset.id, tab: 'relations' })}>{tr('viewProblem')}</Button>
          </Note>
        )}
        {!compact && missing.length === 0 && vcolNote && <Note pw={pw}>{tr('noVcol')}</Note>}
        {load.phase === 'loading' && load.ring && <LoadingRing pw={pw} loaded={load.loaded} total={load.parsing ? null : load.total} />}
        {load.phase === 'error' && <Failure error={load.error} url={source.url} name={asset.name} onRetry={() => setReload(n => n + 1)} />}
        {!compact && (
          <svg ref={gizmoRef} viewBox="0 0 72 72" aria-label={tr('viewCube')} role="group"
            className={cn('bbm-gizmo absolute size-[72px] transition-[top,right] duration-snappy ease-settle', load.phase !== 'ready' && 'hidden')}
            style={{ top: split ? 40 : 8, right: 8 + pw }}
            onClick={e => { const g = (e.target as Element).closest('[data-view]'); if (g) { engineRef.current?.setView(g.getAttribute('data-view')!); set({ turn: false }) } }} />
        )}
        {!compact && loaded && (
          <Panel open={st.panel} st={st} set={p => { if (p.env) envTouched.current = true; set(p) }} asset={asset} analysis={loaded.analysis} textures={loaded.model.textures}
            clips={clips} hdrs={hdrs} loadHdrs={loadHdrs} sections={sections} toggleSection={toggleSection} />
        )}
      </div>
      {!compact && loaded && <ShotDialog open={shotOpen} onOpenChange={setShotOpen} asset={asset} shoot={shoot} params={shotParams} />}
    </div>
  )
}
