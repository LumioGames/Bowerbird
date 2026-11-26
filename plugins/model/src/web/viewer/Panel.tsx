/**
 * 「查看选项」panel (prototype renderPanel): what is set once per session — environment, light, camera and
 * display, structure, animation — and what is only read (information, textures with size and use).
 */
import * as React from 'react'
import {
  cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, useShell, useUnsupportedToast
} from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { BUILTIN_ENVS, envGradient, envName } from '../three/env'
import type { ModelAnalysis } from '../three/analyze'
import type { TextureEntry } from '../three/load'
import type { ViewState, ToneMap, Background } from './engine'
import { Icon } from '../icons'
import { Row, Section, Seg, SliderRow, SwitchField } from './ui'
import { fmtSize } from '../lib/measure'
import { useT, type Key, type T } from '../i18n'

export interface HdrAsset { id: string; name: string }

type Patch = (p: Partial<ViewState>) => void

function EnvTile({ on, label, onClick, children, title }: { on: boolean; label: string; onClick?: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title ?? label}
      className={cn('grid min-w-0 justify-items-center gap-1 text-[11px] leading-[14px]', on ? 'text-ink-1' : 'text-ink-2')}>
      <i className={cn('grid h-8 w-full place-items-center rounded-sm shadow-[inset_0_0_0_1px_var(--line-hairline)] transition-transform duration-press active:scale-[0.94]',
        on && 'outline-2 outline-offset-2 outline-accent-ring')}>{children}</i>
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

const clampEl = (v: number) => Math.min(90, Math.max(4, v))

/** The key light's direction: drag on the disc, or the arrow keys (← → azimuth, ↑ ↓ elevation, 5° a step). */
function Dial({ az, el, disabled, onChange }: { az: number; el: number; disabled: boolean; onChange(az: number, el: number): void }) {
  const tr = useT()
  const ref = React.useRef<HTMLDivElement>(null)
  const set = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    const x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2)
    const m = Math.min(1, Math.hypot(x, y))
    onChange(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360, Math.max(4, (1 - m) * 90))
  }
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 5
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const d = moves[e.key]
    if (!d || disabled) return
    e.preventDefault()
    onChange((az + d[0] + 360) % 360, clampEl(el + d[1]))
  }
  const rr = (1 - el / 90) * 26, a = (az * Math.PI) / 180
  return (
    <div ref={ref} role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
      aria-label={tr('lightDir')} aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(az) % 360}
      aria-valuetext={tr('lightDirValue', { az: Math.round(az), el: Math.round(el) })} title={tr('dragLight')}
      className={cn('relative size-16 shrink-0 touch-none rounded-full shadow-[inset_0_0_0_1px_var(--line-control)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring',
        disabled && 'opacity-40')}
      style={{ background: 'radial-gradient(circle, var(--fill-hover), var(--fill-rest))' }}
      onKeyDown={key}
      onPointerDown={e => {
        if (disabled) return
        e.preventDefault()
        const el2 = e.currentTarget
        try { el2.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
        set(e)
        const mv = (ev: PointerEvent) => set(ev)
        const up = () => { el2.removeEventListener('pointermove', mv); el2.removeEventListener('pointerup', up) }
        el2.addEventListener('pointermove', mv); el2.addEventListener('pointerup', up)
      }}>
      <i className="absolute inset-[22px] rounded-full shadow-[inset_0_0_0_1px_var(--line-hairline)]" />
      <i className="absolute top-1/2 left-1/2 -m-1.5 size-3 rounded-full bg-warning-fill shadow-[0_0_0_3px_var(--warning-soft)]"
        style={{ transform: `translate(${(Math.sin(a) * rr).toFixed(1)}px,${(Math.cos(a) * rr).toFixed(1)}px)` }} />
    </div>
  )
}

function TexThumb({ t }: { t: TextureEntry }) {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    const img = t.texture?.image as CanvasImageSource & { width?: number; height?: number } | undefined
    if (!img || !img.width) return
    try {
      const c = document.createElement('canvas'); c.width = c.height = 44
      c.getContext('2d')!.drawImage(img, 0, 0, 44, 44)
      setUrl(c.toDataURL())
    } catch { /* tainted or not drawable */ }
  }, [t.texture])
  return (
    <span className="grid size-[22px] shrink-0 place-items-center overflow-hidden rounded-xs bg-fill-rest text-ink-2">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <Icon name={t.missing ? 'unlink' : 'image'} size={12} />}
    </span>
  )
}

/** A texture's name: the file or image name, else its place in the file. */
export function textureName(t: TextureEntry, tr: T): string {
  return t.label ?? (t.embedded ? tr('imageN', { n: t.index + 1 }) : tr('textureGeneric'))
}

/** What a texture is used for (「基础色」「遮蔽 · 粗糙 · 金属」), or its name when the file does not say. */
export function textureUse(t: TextureEntry, tr: T): string {
  return t.roles.length ? t.roles.map(r => tr(`role.${r}` as Key)).join(' · ') : textureName(t, tr)
}

export function Panel({ st, set, asset, analysis, textures, clips, hdrs, loadHdrs, sections, toggleSection, open }: {
  st: ViewState
  set: Patch
  asset: AssetDetail
  analysis: ModelAnalysis
  textures: TextureEntry[]
  clips: Array<{ name: string; duration: number }>
  hdrs: HdrAsset[] | null
  loadHdrs(): void
  sections: Record<string, boolean>
  toggleSection(id: string): void
  open: boolean
}) {
  const shell = useShell()
  const tr = useT()
  const unsupported = useUnsupportedToast()
  const libEnv = st.env.startsWith('asset:') ? hdrs?.find(h => 'asset:' + h.id === st.env) ?? null : null
  const tech = analysis.tech
  const rel = (slot: string | null) => (slot ? asset.relations.outgoing.find(r => r.slot === slot && !r.broken)?.to ?? null : null)
  const ev = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + ' EV'
  const vcol = analysis.caps.vcolSets
  const vcolText = vcol === 0 ? tr('none') : vcol > 1 ? tr('vcolSets', { n: vcol }) : 'R G B A'
  const yn = (v: unknown) => tr(v ? 'yes' : 'no')
  const kv: Array<[string, string]> = [
    [tr('tech.triangles'), Number(tech.triangles).toLocaleString('en-US')],
    [tr('tech.vertices'), Number(tech.vertices).toLocaleString('en-US')],
    [tr('tech.meshes'), String(tech.meshes)],
    [tr('tech.bones'), String(tech.bones)],
    [tr('tech.animations'), clips.length ? clips.map(c => c.name).join(tr('listSep')) : tr('none')],
    [tr('bounds'), fmtSize(analysis.size.x, analysis.size.y, analysis.size.z)],
    [tr('uvNormals'), `${yn(tech.hasUV)} · ${yn(tech.hasNormals)}`],
    [tr('tech.hasVertexColors'), vcolText]
  ]
  const hidden = new Set(st.hiddenMeshes), hiddenMats = new Set(st.hiddenMats)
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])

  return (
    <div data-closed={!open || undefined} inert={!open} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
      className={cn('absolute top-2 right-2 bottom-2 w-[264px] overflow-x-hidden overflow-y-auto rounded-lg bg-material-popover text-ink-1 shadow-popover backdrop-popover [scrollbar-width:thin]',
        'origin-top-right transition-[transform,opacity] duration-settle ease-settle',
        !open && 'pointer-events-none translate-x-6 scale-[0.98] opacity-0')}>
      <Section title={tr('secEnv')} open={sections.env ?? true} onToggle={() => toggleSection('env')}>
        <div className="grid grid-cols-5 gap-1.5">
          {BUILTIN_ENVS.map(e => (
            <EnvTile key={e.id} on={st.env === e.id} label={envName(e, tr)} onClick={() => set({ env: e.id })}>
              <span className="size-full rounded-sm" style={{ background: envGradient(e) }} />
            </EnvTile>
          ))}
          <DropdownMenu modal={false} onOpenChange={o => { if (o) loadHdrs() }}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-pressed={!!libEnv} title={libEnv ? libEnv.name : tr('library')}
                className={cn('grid min-w-0 justify-items-center gap-1 text-[11px] leading-[14px]', libEnv ? 'text-ink-1' : 'text-ink-2')}>
                <i className={cn('grid h-8 w-full place-items-center rounded-sm bg-fill-rest text-ink-1 shadow-[inset_0_0_0_1px_var(--line-hairline)]', libEnv && 'outline-2 outline-offset-2 outline-accent-ring')}>
                  <Icon name={libEnv ? 'check' : 'folder-search'} size={12} />
                </i>
                <span className="max-w-full truncate">{libEnv ? libEnv.name.replace(/\.hdr$/i, '') : tr('library')}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 min-w-48 overflow-y-auto">
              {hdrs === null && <DropdownMenuItem disabled>…</DropdownMenuItem>}
              {hdrs?.length === 0 && <DropdownMenuItem disabled>{tr('noHdr')}</DropdownMenuItem>}
              {hdrs?.map(h => (
                <DropdownMenuItem key={h.id} onSelect={() => set({ env: 'asset:' + h.id })}>
                  <Icon name="globe" size={14} />{h.name}{st.env === 'asset:' + h.id && <Icon name="check" size={14} className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <SliderRow label={tr('rotate')} name={tr('rotateEnv')} value={st.envRot} min={0} max={360} format={v => `${Math.round(v)}°`} onChange={v => set({ envRot: v })} />
        <SliderRow label={tr('exposure')} value={st.exp} min={-3} max={3} step={0.1} format={ev} onChange={v => set({ exp: Math.round(v * 10) / 10 })} />
        <Row label={tr('tone')}>
          <Seg<ToneMap> size="sm" label={tr('toneMapping')} value={st.tone} onChange={v => set({ tone: v })}
            items={[{ value: 'aces', label: 'ACES' }, { value: 'agx', label: 'AgX' }, { value: 'neutral', label: tr('toneNeutral') }, { value: 'none', label: tr('none') }]} />
        </Row>
        <Row label={tr('background')}>
          <Seg<Background> size="sm" label={tr('background')} value={st.bg} onChange={v => set({ bg: v })}
            items={[{ value: 'env', label: tr('bgEnv') }, { value: 'color', label: tr('bgColor') }, { value: 'none', label: tr('bgNone') }]} />
          {st.bg === 'color' && (
            <label className="relative inline-grid size-[18px] place-items-center rounded-full shadow-[inset_0_0_0_1px_var(--line-control)]" style={{ background: st.bgColor }} title={tr('color')}>
              <input type="color" value={st.bgColor} aria-label={tr('bgColorPick')} onChange={e => set({ bgColor: e.target.value })} className="absolute inset-0 size-full cursor-pointer opacity-0" />
            </label>
          )}
        </Row>
      </Section>

      <Section title={tr('secLight')} open={sections.light ?? true} onToggle={() => toggleSection('light')}>
        <Row label={tr('keyLight')}>
          <SwitchField name={tr('keyLight')} checked={st.light} onChange={v => set({ light: v })} />
          <span className="flex-1" />
          <SwitchField name={tr('shadow')} label={tr('shadow')} checked={st.shadow} onChange={v => set({ shadow: v })} />
        </Row>
        <div className="flex min-h-[76px] items-center gap-3 text-xs text-ink-2">
          <Dial az={st.az} el={st.el} disabled={!st.light} onChange={(az, el) => set({ az, el })} />
          <span className="bbm-num text-[11px]">{tr('lightDirValue', { az: Math.round(st.az), el: Math.round(st.el) })}</span>
        </div>
      </Section>

      <Section title={tr('secCamera')} open={sections.cam ?? false} onToggle={() => toggleSection('cam')}>
        <SliderRow label={tr('fov')} value={st.fov} min={15} max={90} disabled={st.ortho} format={v => `${Math.round(v)}°`} onChange={v => set({ fov: Math.round(v) })} />
        <Row label={tr('ground')}>
          <SwitchField name={tr('ground')} checked={st.ground} onChange={v => set({ ground: v })} />
          <span className="flex-1" />
          <SwitchField name={tr('grid')} label={tr('grid')} checked={st.grid} onChange={v => set({ grid: v })} />
        </Row>
        <Row label={tr('dims')}><SwitchField name={tr('dims')} checked={st.dims} onChange={v => set({ dims: v })} /></Row>
      </Section>

      <Section title={tr('secStructure')} open={sections.struct ?? false} onToggle={() => toggleSection('struct')}>
        <div className="grid grid-cols-[minmax(0,1fr)]">
          {analysis.meshes.map(m => {
            const off = hidden.has(m.id), solo = st.solo?.kind === 'mesh' && st.solo.id === m.id
            const name = m.name ?? tr('meshN', { n: m.index + 1 })
            return (
              <div key={m.id} className={cn('-mx-1 flex min-h-[26px] cursor-default items-center gap-1.5 rounded-sm px-1 text-xs hover:bg-fill-rest', solo && 'bg-accent-soft')}
                onClick={() => set({ solo: solo ? null : { kind: 'mesh', id: m.id } })}>
                <button type="button" aria-label={tr(off ? 'showName' : 'hideName', { name })} title={tr(off ? 'show' : 'hide')}
                  onClick={e => { e.stopPropagation(); set({ hiddenMeshes: toggleIn(st.hiddenMeshes, m.id) }) }}
                  className="grid size-5 place-items-center rounded-xs text-ink-2 hover:bg-fill-hover hover:text-ink-1">
                  <Icon name={off ? 'eye-off' : 'eye'} size={12} />
                </button>
                <span title={tr('solo')} className={cn('min-w-0 truncate', off && 'text-ink-2 line-through')}>{name}</span>
                <small className="ml-auto text-[11px] text-ink-2 tabular-nums">{m.triangles.toLocaleString('en-US')}</small>
              </div>
            )
          })}
          {analysis.materials.map((m, i) => {
            const off = hiddenMats.has(m.id), solo = st.solo?.kind === 'material' && st.solo.id === m.id
            const name = m.name ?? tr('materialN', { n: m.index + 1 })
            return (
              <div key={m.id} className={cn('-mx-1 flex min-h-[26px] cursor-default items-center gap-1.5 rounded-sm px-1 text-xs hover:bg-fill-rest', solo && 'bg-accent-soft')}
                onClick={() => set({ solo: solo ? null : { kind: 'material', id: m.id } })}>
                <button type="button" aria-label={tr(off ? 'showName' : 'hideName', { name })} title={tr(off ? 'show' : 'hide')}
                  onClick={e => { e.stopPropagation(); set({ hiddenMats: toggleIn(st.hiddenMats, m.id) }) }}
                  className="grid size-5 place-items-center rounded-xs text-ink-2 hover:bg-fill-hover hover:text-ink-1">
                  <Icon name={off ? 'eye-off' : 'eye'} size={12} />
                </button>
                <span title={tr('solo')} className={cn('inline-flex min-w-0 items-center gap-1.5 truncate', off && 'text-ink-2 line-through')}><Icon name="layers" size={12} />{name}</span>
                {i === 0 && <small className="ml-auto text-[11px] text-ink-2">{tr('materialsCount', { n: analysis.materials.length })}</small>}
              </div>
            )
          })}
        </div>
        <Row label={tr('skeleton')}>
          <SwitchField name={tr('skeleton')} checked={st.skel} onChange={v => (analysis.bones ? set({ skel: v }) : unsupported())} />
        </Row>
      </Section>

      {clips.length > 0 && (
        <Section title={tr('secAnimation')} open={sections.anim ?? true} onToggle={() => toggleSection('anim')}>
          <div className="grid grid-cols-[minmax(0,1fr)]">
            {clips.map((c, i) => (
              <div key={i} onClick={() => set({ clip: i })}
                className={cn('-mx-1 flex min-h-[26px] cursor-default items-center gap-1.5 rounded-sm px-1 text-xs hover:bg-fill-rest', i === st.clip && 'bg-accent-soft')}>
                <span className="inline-flex min-w-0 items-center gap-1.5 truncate"><Icon name="play" size={12} />{c.name}</span>
                <small className="ml-auto text-[11px] text-ink-2 tabular-nums">{tr('seconds', { s: c.duration.toFixed(1) })}</small>
              </div>
            ))}
          </div>
          <Row label={tr('speed')}>
            <Seg size="sm" label={tr('speed')} value={String(st.speed)} onChange={v => set({ speed: Number(v) })}
              items={[{ value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]} />
          </Row>
        </Section>
      )}

      <Section title={tr('secInfo')} open={sections.info ?? false} onToggle={() => toggleSection('info')}>
        <dl className="grid grid-cols-[fit-content(96px)_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          {kv.map(([k, v]) => <React.Fragment key={k}><dt className="min-w-16 text-ink-2">{k}</dt><dd className="min-w-0 truncate tabular-nums">{v}</dd></React.Fragment>)}
        </dl>
        {textures.length > 0 && (
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)]">
            {textures.map((t, i) => {
              const target = rel(t.slot)
              return (
                <div key={i} title={t.slot ?? textureName(t, tr)}
                  onClick={() => { if (target) shell.navigate({ to: 'asset', id: target }) }}
                  className={cn('-mx-1 flex min-h-[26px] items-center gap-1.5 rounded-sm px-1 text-xs hover:bg-fill-rest', target ? 'cursor-pointer' : 'cursor-default')}>
                  <TexThumb t={t} />
                  <span className="min-w-0 truncate">{textureUse(t, tr)}</span>
                  <small className={cn('ml-auto shrink-0 text-[11px] tabular-nums', t.missing ? 'text-danger-ink' : 'text-ink-2')}>
                    {t.missing ? tr('missing') : t.width ? `${t.width}×${t.height}` : '—'}
                  </small>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}
