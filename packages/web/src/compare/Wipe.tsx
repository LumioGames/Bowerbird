import * as React from 'react'
import { cn } from '@bowerbird/plugin-sdk/web'
import { t } from '../lib/i18n'
import { Icon } from '../components/Icon'

export const WIPE_MIN = 0.02
export const WIPE_MAX = 0.98
export const WIPE_STEP = 0.02
export const WIPE_STEP_BIG = 0.1
export const clampWipe = (v: number) => Math.max(WIPE_MIN, Math.min(WIPE_MAX, v))

/** ← / → nudge; Shift for a bigger step. Returns the new position, or null when the key is not one of them. */
export function nudge(v: number, key: string, shift: boolean): number | null {
  const d = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  if (!d) return null
  return clampWipe(Math.round((v + d * (shift ? WIPE_STEP_BIG : WIPE_STEP)) * 1000) / 1000)
}

/**
 * The wipe divider — one shell control for every format (components.md 卷帘分界线): drag the line or its knob,
 * ← / → while the knob has focus (Shift: bigger steps), double-click to centre, A / B tags on both sides. Dragging
 * anywhere else on the stage still belongs to the format (pan an image, turn a model). Plugins only draw at `split`.
 */
export function WipeDivider({ value, onChange }: { value: number; onChange(v: number): void }) {
  const root = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const [anim, setAnim] = React.useState(false)
  const move = (clientX: number) => {
    const r = root.current?.getBoundingClientRect()
    if (!r || !r.width) return
    onChange(clampWipe((clientX - r.left) / r.width))
  }
  const down = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    setAnim(false); setDragging(true)
    const mv = (ev: PointerEvent) => move(ev.clientX)
    const up = () => { setDragging(false); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  return (
    <div ref={root} className={cn('w2-cw', dragging && 'dragging', anim && 'anim')} style={{ ['--x' as string]: `${value * 100}%` }}>
      <i className="w2-cw__hit" onPointerDown={down} onDoubleClick={() => { setAnim(true); onChange(0.5) }} />
      <i className="w2-cw__line" />
      <button type="button" className="w2-cw__knob" role="slider" aria-label={t('cmp.divider')} title={t('cmp.dividerTip')}
        aria-valuemin={Math.round(WIPE_MIN * 100)} aria-valuemax={Math.round(WIPE_MAX * 100)} aria-valuenow={Math.round(value * 100)} aria-orientation="horizontal"
        onPointerDown={down}
        onDoubleClick={e => { e.stopPropagation(); setAnim(true); onChange(0.5) }}
        onKeyDown={e => { const v = nudge(value, e.key, e.shiftKey); if (v === null) return; e.preventDefault(); e.stopPropagation(); setAnim(false); onChange(v) }}>
        <Icon name="chevron-left" size={12} /><Icon name="chevron-right" size={12} />
      </button>
      <span className="w2-cw__tag w2-cw__tag--a w2-floating">A</span>
      <span className="w2-cw__tag w2-cw__tag--b w2-floating">B</span>
    </div>
  )
}
