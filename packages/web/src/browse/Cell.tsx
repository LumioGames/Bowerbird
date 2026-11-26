import * as React from 'react'
import type { AssetSummary, HitSnippet } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { AssetThumb, thumbKind } from '../components/AssetThumb'
import { InfoBadge, IssueMark, ReviewMark, StageMark } from '../components/marks'
import { t } from '../lib/i18n'
import { markVisible } from '../lib/live'
import { keyboardContextMenu } from '../lib/shortcuts'
import { usePluginRegistry, PluginSlot } from '../plugins/registry'
import { badgeText } from '../plugins/text'

/**
 * One grid cell (design-system AssetCell): thumbnail with the three groups of corner marks (top-left stage,
 * top-right review, bottom-left issue) and the plugin's info at the bottom right; the name; with a query word, the
 * excerpt it matched outside the name (提示词 / 描述 / 正文) with the hit marked. A bundle is drawn as a stack.
 * Hover belongs to the format plugin's GridCell (video scrubs, a model turns after ~0.5 s, audio stays silent);
 * on touch there is no hover — a long press opens quick look (ADR-032).
 */
export function highlight(text: string, q: string): React.ReactNode {
  const words = q.toLowerCase().split(/\s+/).filter(w => w && !w.includes(':'))
  if (!words.length) return text
  const lower = text.toLowerCase()
  const marks: Array<[number, number]> = []
  for (const w of words) { let i = lower.indexOf(w); while (i >= 0) { marks.push([i, i + w.length]); i = lower.indexOf(w, i + w.length) } }
  return renderRanges(text, marks)
}

export function renderRanges(text: string, ranges: ReadonlyArray<readonly [number, number]>): React.ReactNode {
  if (!ranges.length) return text
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: React.ReactNode[] = []
  let at = 0
  sorted.forEach(([s, e], i) => {
    if (s < at) return
    if (s > at) out.push(text.slice(at, s))
    out.push(<mark key={i}>{text.slice(s, e)}</mark>)
    at = e
  })
  if (at < text.length) out.push(text.slice(at))
  return out
}

const HIT_LABEL: Record<HitSnippet['field'], string> = { prompt: 'hit.prompt', description: 'hit.description', text: 'hit.text', tags: 'hit.tags', path: 'hit.path', name: 'hit.name' }

export function HitLine({ hit }: { hit: HitSnippet }) {
  return (
    <div className="bb-hit mt-0.5 max-w-full truncate text-[11px] leading-[15px] text-ink-3">
      <span className="mr-1 font-semibold text-ink-3">{t(HIT_LABEL[hit.field])}</span>{renderRanges(hit.text, hit.ranges)}
    </div>
  )
}

export interface CellProps {
  asset: AssetSummary
  style: React.CSSProperties
  thumbHeight?: number
  selected: boolean
  focused: boolean
  query: string
  fit: 'cover' | 'contain'
  renaming: boolean
  onRenameDone: (name: string | null) => void
  onPointerSelect: (e: React.MouseEvent, id: string) => void
  onOpen: (id: string) => void
  onContext: (e: React.MouseEvent, id: string) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onLongPress: (id: string, el: HTMLElement) => void
  arrive?: boolean
}

export const Cell = React.memo(function Cell(p: CellProps) {
  const a = p.asset
  const reg = usePluginRegistry()
  const fv = reg.formatView(a.format)
  const kind = thumbKind(a)
  const [hover, setHover] = React.useState<{ active: boolean; x: number }>({ active: false, x: 0 })
  const touch = React.useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null })
  const thumbRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (kind !== 'render') return
    markVisible(a.id, true)
    return () => markVisible(a.id, false)
  }, [a.id, kind])

  const useGridCell = !!fv?.view.GridCell && (kind === 'ready' || kind === 'doc' || kind === 'none')
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !useGridCell) return
    const r = thumbRef.current!.getBoundingClientRect()
    setHover({ active: true, x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) })
  }
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    const el = e.currentTarget as HTMLElement
    touch.current.timer = setTimeout(() => { touch.current.timer = null; p.onLongPress(a.id, el) }, 500)
  }
  const cancelTouch = () => { if (touch.current.timer) { clearTimeout(touch.current.timer); touch.current.timer = null } }

  return (
    <div
      data-asset-cell={a.id}
      role="option"
      aria-selected={p.selected}
      tabIndex={p.focused ? 0 : -1}
      draggable={!p.renaming}
      onClick={e => p.onPointerSelect(e, a.id)}
      onDoubleClick={() => p.onOpen(a.id)}
      onContextMenu={e => p.onContext(e, a.id)}
      onKeyDown={e => { keyboardContextMenu(e) }}
      onDragStart={e => p.onDragStart(e, a.id)}
      onPointerDown={onDown}
      onPointerUp={cancelTouch}
      onPointerCancel={cancelTouch}
      className={cn(
        'group/cell absolute flex cursor-default select-none flex-col items-center gap-1 rounded-md p-1.5 outline-none transition-[background-color,transform] duration-fade ease-out-bb active:scale-[0.985]',
        p.selected ? 'bg-accent-soft' : 'hover:bg-fill-rest'
      )}
      style={p.style}
    >
      <div
        ref={thumbRef}
        data-thumb-box
        onPointerMove={onMove}
        onPointerLeave={() => setHover(h => (h.active ? { active: false, x: h.x } : h))}
        className={cn(
          'relative w-full shrink-0 rounded-sm bg-surface-well',
          a.bundle ? 'bb-bundle-stack' : 'overflow-hidden',
          p.selected && 'outline-2 outline-offset-1 outline-accent-ring',
          'group-focus-visible/cell:outline-2 group-focus-visible/cell:outline-offset-2 group-focus-visible/cell:outline-accent-ring'
        )}
        style={{ height: p.thumbHeight ?? undefined, aspectRatio: p.thumbHeight == null ? '1' : undefined }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
          {useGridCell
            ? <PluginSlot pluginId={fv!.pluginId} component={fv!.view.GridCell!} props={{ asset: a, size: p.thumbHeight ?? 168, hover, thumbnail: a.thumbnail }}
                fallback={() => <AssetThumb asset={a} fit={p.fit} />} />
            : <AssetThumb asset={a} fit={p.fit} arrive={p.arrive} />}
        </div>
        <div className="pointer-events-none absolute top-1 left-1 flex gap-0.5"><StageMark stage={a.stage} corner /></div>
        <div className="pointer-events-none absolute top-1 right-1 flex gap-0.5"><ReviewMark review={a.review} corner /></div>
        {(a.issueLevel === 'error' || a.issueLevel === 'warning') && (
          <div className="pointer-events-none absolute bottom-1 left-0 flex gap-0.5"><IssueMark level={a.issueLevel} count={a.issueCount} flags={a.flags} /></div>
        )}
        {a.badge && (kind === 'ready' || kind === 'missing' || kind === 'doc') && (
          <div className="pointer-events-none absolute right-1 bottom-1 flex gap-0.5"><InfoBadge text={badgeText(reg, a)} /></div>
        )}
      </div>
      {p.renaming
        ? <RenameInput name={a.name} onDone={p.onRenameDone} />
        : (
          <div title={a.path}
            className={cn('bb-hit max-w-full truncate rounded-xs px-1.5 py-px text-[12px] leading-4',
              p.selected ? 'bg-accent-fill text-accent-on' : a.flags.includes('missing') ? 'text-ink-3 line-through' : 'text-ink-1')}>
            {p.query ? highlight(a.name, p.query) : a.name}
          </div>
        )}
      {p.query && a.hit && a.hit.field !== 'name' && <HitLine hit={a.hit} />}
    </div>
  )
})

export function RenameInput({ name, onDone, className }: { name: string; onDone: (name: string | null) => void; className?: string }) {
  const [v, setV] = React.useState(name)
  const ref = React.useRef<HTMLInputElement | null>(null)
  const done = React.useRef(false)
  React.useEffect(() => { const i = name.lastIndexOf('.'); ref.current?.focus(); ref.current?.setSelectionRange(0, i > 0 ? i : name.length) }, [name])
  const finish = (val: string | null) => { if (done.current) return; done.current = true; onDone(val) }
  return (
    <input
      ref={ref}
      value={v}
      aria-label={t('insp.name')}
      onChange={e => setV(e.target.value)}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') finish(v.trim() || null); if (e.key === 'Escape') finish(null) }}
      onBlur={() => finish(v.trim() || null)}
      className={cn('h-[18px] w-full rounded-xs border-0 bg-surface-well px-1 text-center text-[12px] text-ink-1 outline-2 outline-accent-ring', className)}
    />
  )
}
