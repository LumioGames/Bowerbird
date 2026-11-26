/**
 * Model · model (pages.md「对比页」): side by side — two viewports sharing one camera, so they turn together — or
 * wiped — both in one viewport, split where the shell's divider is (`split`). View presets 透视 / 正 / 侧 / 背 / 顶.
 * The technical table below is the shell's (techLabels).
 */
import * as React from 'react'
import * as THREE from 'three'
import type { CompareProps } from '@bowerbird/plugin-sdk/web'
import { getHub, pixelRatio } from '../three/hub'
import { builtinEnv, envGradient } from '../three/env'
import { modelSettings } from '../settings'
import { Centered, FailureNote, SideLabel, useModel, useOrbitLoop, ViewBar, VIEWS3, type ViewKey3 } from './common'

export function ModelCompare({ left, right, mode, split }: CompareProps) {
  const a = useModel(left), b = useModel(right)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ W: 1, H: 1 })
  const [view, setView] = React.useState<ViewKey3 | null>('persp')
  const ready = a.state === 'ready' && b.state === 'ready'
  const bounds = React.useMemo(() => {
    if (a.state !== 'ready' || b.state !== 'ready') return null
    const box = a.p.info.bounds.clone().union(b.p.info.bounds)
    return { radius: Math.max(a.p.info.radius, b.p.info.radius), center: box.getCenter(new THREE.Vector3()) }
  }, [a, b])
  const ortho = view !== null && view !== 'persp'

  React.useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ W: r.width, H: r.height }) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const loop = useOrbitLoop(canvasRef, bounds, (orbit, persp, oc) => {
    const hub = getHub()
    if (!hub || a.state !== 'ready' || b.state !== 'ready' || !canvasRef.current) return
    const dpr = pixelRatio(modelSettings().maxPixelRatio)
    const W = size.W, H = size.H, wd = Math.round(W * dpr), hd = Math.round(H * dpr)
    const cam = ortho ? oc : persp
    for (const s of [a.p.stage, b.p.stage]) s.setDisplay({ ground: !ortho })
    hub.draw(canvasRef.current, wd, hd, r => {
      r.toneMapping = THREE.ACESFilmicToneMapping
      r.toneMappingExposure = 1
      if (mode === 'side') {
        const hw = Math.floor(wd / 2)
        orbit.place(cam, (W / 2) / H, 35); cam.updateProjectionMatrix()
        r.setViewport(0, 0, hw, hd); r.setScissor(0, 0, hw, hd)
        a.p.stage.render(r, cam, ['full'], { kind: 'none' }, hw, hd)
        r.setViewport(hw, 0, wd - hw, hd); r.setScissor(hw, 0, wd - hw, hd)
        b.p.stage.render(r, cam, ['full'], { kind: 'none' }, wd - hw, hd)
      } else {
        const x = Math.round(split * wd)
        orbit.place(cam, W / H, 35); cam.updateProjectionMatrix()
        r.setViewport(0, 0, wd, hd)
        r.setScissor(0, 0, Math.max(1, x), hd)
        a.p.stage.render(r, cam, ['full'], { kind: 'none' }, wd, hd)
        r.setScissor(x, 0, Math.max(1, wd - x), hd)
        b.p.stage.render(r, cam, ['full'], { kind: 'none' }, wd, hd)
      }
    })
  }, [size, mode, split, ortho, ready])

  const pick = (k: ViewKey3) => {
    const o = loop.orbit.current
    if (!o) return
    setView(k)
    const v = VIEWS3[k]
    if (k === 'persp') o.setGoal(0.62, 1.12)
    else o.setGoal(v.th ?? o.th, v.ph)
    loop.invalidate()
  }

  const err = a.state === 'error' ? { error: a.error } : b.state === 'error' ? { error: b.error } : null
  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden" style={{ background: envGradient(builtinEnv('studio')!) }}>
      <canvas ref={canvasRef} className="absolute inset-0 block size-full cursor-grab touch-none active:cursor-grabbing" {...loop.handlers}
        onPointerMove={e => { loop.handlers.onPointerMove(e); if (loop.orbit.current?.drag && view !== null && view !== 'persp') setView(null) }}
        onDoubleClick={() => pick('persp')} />
      {mode === 'side' && (
        <>
          <i className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line-hairline" />
          <SideLabel side={left} className="left-2" />
          <SideLabel side={right} className="left-[calc(50%+8px)]" />
        </>
      )}
      {!ready && !err && <Centered><span className="bbm-num">…</span></Centered>}
      {err && <Centered><FailureNote error={err.error} /></Centered>}
      {ready && <ViewBar keys={['persp', 'front', 'side', 'back', 'top']} value={view} onPick={pick} className="left-1/2 -translate-x-1/2" />}
    </div>
  )
}
