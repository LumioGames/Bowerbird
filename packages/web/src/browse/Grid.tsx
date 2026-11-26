import * as React from 'react'
import type { AssetSummary } from '@bowerbird/schema'
import { cn, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@bowerbird/plugin-sdk/web'
import { AssetThumb } from '../components/AssetThumb'
import { Icon } from '../components/Icon'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { t } from '../lib/i18n'
import { extOf, fmtRelative, fmtSize } from '../lib/format'
import { setPrefs } from '../lib/prefs'
import { keyboardContextMenu } from '../lib/shortcuts'
import { Cell, HitLine, highlight, RenameInput } from './Cell'
import { CELL_PAD, cellChrome, fitListColumns, gridCellPos, gridGeom, gridRange, LIST_HEAD_H, LIST_ROW_H, listRange, masonryGeom, masonryVisible } from './layout'
import type { Rect } from './selection'
import { usePluginRegistry } from '../plugins/registry'
import { badgeText } from '../plugins/text'

/**
 * The asset grid in three layouts (web-shell.md 中间：资产网格): masonry, uniform grid, list (columns can be chosen).
 * Virtual scrolling: only the cells in (and just around) the view are mounted, so 100,000 assets scroll at 60 fps.
 * Rows not loaded yet show skeleton cells; reaching them asks for the next page.
 */
export interface GridHandle {
  /** Cell rectangles in viewport coordinates, for the marquee and arrow keys in masonry. */
  rects(): Map<string, Rect>
  cols(): number
  scrollToIndex(i: number): void
}

export interface GridProps {
  items: AssetSummary[]
  total: number
  layout: 'masonry' | 'grid' | 'list'
  size: number
  scroller: HTMLElement | null
  query: string
  selected: ReadonlySet<string>
  focus: string | null
  renaming: string | null
  columns: string[]
  sort: { sort: string; order: 'asc' | 'desc' }
  onSortColumn: (key: string) => void
  onRenameDone: (id: string, name: string | null) => void
  onPointerSelect: (e: React.MouseEvent, id: string) => void
  onOpen: (id: string) => void
  onContext: (e: React.MouseEvent, id: string) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onLongPress: (id: string, el: HTMLElement) => void
  onNeedMore: () => void
  arriveIds?: ReadonlySet<string>
}

function useScrollWindow(scroller: HTMLElement | null, host: React.RefObject<HTMLElement | null>) {
  const [win, setWin] = React.useState({ top: 0, height: 800, width: 800 })
  React.useLayoutEffect(() => {
    if (!scroller) return
    let raf = 0
    const measure = () => {
      raf = 0
      const el = host.current
      if (!el) return
      const sr = scroller.getBoundingClientRect(), hr = el.getBoundingClientRect()
      setWin(w => {
        const next = { top: sr.top - hr.top, height: scroller.clientHeight || 800, width: el.clientWidth || w.width }
        return next.top === w.top && next.height === w.height && next.width === w.width ? w : next
      })
    }
    const on = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    scroller.addEventListener('scroll', on, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null
    ro?.observe(scroller); if (host.current) ro?.observe(host.current)
    return () => { scroller.removeEventListener('scroll', on); ro?.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, [scroller, host])
  return win
}

export const Grid = React.forwardRef<GridHandle, GridProps>(function Grid(p, ref) {
  const host = React.useRef<HTMLDivElement | null>(null)
  const win = useScrollWindow(p.scroller, host)
  const withHit = !!p.query && p.items.some(a => a.hit && a.hit.field !== 'name')
  const width = Math.max(1, win.width)
  const loaded = p.items.length

  const grid = React.useMemo(() => gridGeom(width, p.size, p.total, withHit), [width, p.size, p.total, withHit])
  const masonry = React.useMemo(() => (p.layout === 'masonry' ? masonryGeom(width, p.size, p.items.map(a => a.aspect), withHit) : null), [p.layout, width, p.size, p.items, withHit])

  let indices: number[] = []
  let height = 0
  if (p.layout === 'grid') {
    const r = gridRange(grid, p.total, win.top, win.height)
    for (let i = r.start; i < r.end; i++) indices.push(i)
    height = grid.height
  } else if (p.layout === 'masonry') {
    indices = masonryVisible(masonry!, win.top, win.height)
    height = masonry!.height + (loaded < p.total ? 200 : 0)
  } else {
    const r = listRange(p.total, Math.max(0, win.top - LIST_HEAD_H), win.height)
    for (let i = r.start; i < r.end; i++) indices.push(i)
    height = LIST_HEAD_H + p.total * LIST_ROW_H
  }

  // Ask for more when the window reaches what is loaded.
  const lastVisible = indices.length ? indices[indices.length - 1]! : -1
  const nearEnd = p.layout === 'masonry' ? masonry!.height - (win.top + win.height) < 1200 : lastVisible >= loaded - 1 - (p.layout === 'grid' ? grid.cols * 4 : 20)
  React.useEffect(() => { if (loaded < p.total && nearEnd) p.onNeedMore() })

  React.useImperativeHandle(ref, () => ({
    rects() {
      const out = new Map<string, Rect>()
      host.current?.querySelectorAll<HTMLElement>('[data-asset-cell]').forEach(el => {
        const r = el.getBoundingClientRect()
        out.set(el.dataset.assetCell!, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      })
      return out
    },
    cols() { return p.layout === 'list' ? 1 : p.layout === 'grid' ? grid.cols : masonry?.cols ?? 1 },
    scrollToIndex(i: number) {
      const s = p.scroller, el = host.current
      if (!s || !el) return
      let top = 0, h = 0
      if (p.layout === 'grid') { const c = gridCellPos(grid, i); top = c.top; h = c.height }
      else if (p.layout === 'masonry' && masonry && i * 4 < masonry.pos.length) { top = masonry.pos[i * 4 + 1]!; h = masonry.pos[i * 4 + 3]! }
      else { top = LIST_HEAD_H + i * LIST_ROW_H; h = LIST_ROW_H }
      const base = el.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop
      const y = base + top, margin = 72
      if (y - margin < s.scrollTop) s.scrollTop = y - margin
      else if (y + h + 32 > s.scrollTop + s.clientHeight) s.scrollTop = y + h + 32 - s.clientHeight
    }
  }), [p.layout, p.scroller, grid, masonry])

  if (p.layout === 'list') return <ListView {...p} host={host} indices={indices} height={height} width={win.width} />

  const fit = p.layout === 'masonry' ? 'cover' : 'contain'
  return (
    <div ref={host} role="listbox" aria-multiselectable aria-label={t('grid.label')} className="relative" style={{ height }}>
      {indices.map(i => {
        const a = p.items[i]
        let style: React.CSSProperties, thumbH: number | undefined
        if (p.layout === 'grid') {
          const c = gridCellPos(grid, i)
          style = { left: c.left, top: c.top, width: c.width, height: c.height }
          thumbH = c.width - CELL_PAD * 2
        } else {
          const m = masonry!
          style = { left: m.pos[i * 4], top: m.pos[i * 4 + 1], width: m.pos[i * 4 + 2], height: m.pos[i * 4 + 3] }
          thumbH = m.pos[i * 4 + 3]! - cellChrome(withHit)
        }
        if (!a) return <SkeletonCell key={`sk${i}`} style={style} thumbH={thumbH} />
        return (
          <Cell key={a.id} asset={a} style={style} thumbHeight={thumbH} fit={fit}
            selected={p.selected.has(a.id)} focused={p.focus === a.id} query={p.query} renaming={p.renaming === a.id}
            onRenameDone={name => p.onRenameDone(a.id, name)} onPointerSelect={p.onPointerSelect} onOpen={p.onOpen}
            onContext={p.onContext} onDragStart={p.onDragStart} onLongPress={p.onLongPress} arrive={p.arriveIds?.has(a.id)} />
        )
      })}
    </div>
  )
})

function SkeletonCell({ style, thumbH }: { style: React.CSSProperties; thumbH?: number }) {
  return (
    <div className="absolute flex flex-col items-center gap-1 p-1.5" style={style} aria-hidden>
      <div className="w-full animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-sm bg-fill-rest" style={{ height: thumbH }} />
      <div className="my-[3px] h-2.5 w-[56%] rounded-xs bg-fill-rest" />
    </div>
  )
}

/** Loading skeleton for the whole grid (first page on its way). */
export function GridSkeleton({ size }: { size: number }) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }} aria-busy>
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="flex flex-col items-center gap-1 p-1.5">
          <div className="aspect-square w-full animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-sm bg-fill-rest" />
          <div className="my-[3px] h-2.5 w-[56%] rounded-xs bg-fill-rest" />
        </div>
      ))}
    </div>
  )
}

/* ── list layout: a table whose columns can be chosen ── */
export const LIST_COLUMNS = [
  { id: 'name', sort: 'name', width: 'minmax(160px,1fr)', min: 160 },
  { id: 'format', sort: 'format', width: '64px', min: 64 },
  { id: 'stage', sort: '', width: '84px', min: 84 },
  { id: 'review', sort: '', width: '96px', min: 96 },
  { id: 'tags', sort: '', width: '18%', min: 0.18 },
  { id: 'size', sort: 'size', width: '76px', min: 76 },
  { id: 'modified', sort: 'modified', width: '88px', min: 88 },
  { id: 'tech', sort: '', width: '88px', min: 88 }
] as const
/** Least width of a list column in px (a fraction below 1 is a share of the list's width). */
function columnMin(id: string, width: number): number {
  const m = LIST_COLUMNS.find(c => c.id === id)?.min ?? 0
  return m < 1 ? m * width : m
}
/** The column-chooser column at the end of each row. */
const CHOOSER_W = 28

function ListView(p: GridProps & { host: React.RefObject<HTMLDivElement | null>; indices: number[]; height: number; width: number }) {
  const shown = fitListColumns(['name', ...p.columns.filter(c => c !== 'name')], p.width, columnMin, CHOOSER_W)
  const cols = LIST_COLUMNS.filter(c => shown.includes(c.id))
  const template = cols.map(c => c.width).join(' ')
  const reg = usePluginRegistry()
  return (
    <div ref={p.host} role="grid" aria-label={t('grid.label')} className="relative" style={{ height: p.height }}>
      <div role="row" className="sticky top-12 z-[3] grid h-7 items-center bg-surface-canvas shadow-[inset_0_-1px_0_var(--line-hairline)]" style={{ gridTemplateColumns: template + ' 28px' }}>
        {cols.map(c => (
          <div key={c.id} role="columnheader" aria-sort={c.sort && p.sort.sort === c.sort ? (p.sort.order === 'asc' ? 'ascending' : 'descending') : undefined}
            className="truncate px-2 text-[11px] leading-[14px] font-semibold tracking-[0.04em] whitespace-nowrap text-ink-3 select-none">
            {c.sort
              ? <button type="button" onClick={() => p.onSortColumn(c.sort)} className="cursor-default border-0 bg-transparent p-0 font-[inherit] tracking-[inherit] text-inherit outline-none hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-accent-ring">
                  {t('col.' + c.id)}
                  {p.sort.sort === c.sort && <Icon name={p.sort.order === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} className="ml-0.5 inline align-[-2px]" />}
                </button>
              : t('col.' + c.id)}
          </div>
        ))}
        <div role="columnheader" aria-label={t('col.choose')}>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t('col.choose')} title={t('col.choose')} className="grid size-6 cursor-default place-items-center rounded-xs border-0 bg-transparent text-ink-3 hover:bg-fill-hover hover:text-ink-1"><Icon name="columns-3" size={12} /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('col.choose')}</DropdownMenuLabel>
            {LIST_COLUMNS.filter(c => c.id !== 'name').map(c => (
              <DropdownMenuCheckboxItem key={c.id} checked={p.columns.includes(c.id)} onSelect={e => e.preventDefault()}
                onCheckedChange={on => setPrefs({ listColumns: on ? [...p.columns, c.id] : p.columns.filter(x => x !== c.id) })}>
                {t('col.' + c.id)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
      {p.indices.map(i => {
        const a = p.items[i]
        const top = LIST_HEAD_H + i * LIST_ROW_H
        if (!a) return <div key={`sk${i}`} role="row" aria-busy className="absolute inset-x-0 flex h-9 items-center gap-2 px-2" style={{ top }}><span role="gridcell" className="flex items-center gap-2"><i className="size-[26px] rounded-xs bg-fill-rest" /><span className="h-2.5 w-[120px] animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-xs bg-fill-rest" /></span></div>
        const sel = p.selected.has(a.id)
        const missing = a.flags.includes('missing')
        return (
          <div key={a.id} role="row" data-asset-cell={a.id} aria-selected={sel} tabIndex={p.focus === a.id ? 0 : -1} draggable
            onClick={e => p.onPointerSelect(e, a.id)} onDoubleClick={() => p.onOpen(a.id)} onContextMenu={e => p.onContext(e, a.id)} onKeyDown={e => { keyboardContextMenu(e) }} onDragStart={e => p.onDragStart(e, a.id)}
            className={cn('absolute inset-x-0 grid h-9 cursor-default select-none items-center rounded-sm text-[12px] leading-4 tabular-nums text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-accent-ring', sel ? 'bg-accent-soft' : 'hover:bg-fill-rest')}
            style={{ top, gridTemplateColumns: template + ' 28px' }}>
            {cols.map(c => {
              switch (c.id) {
                case 'name': return (
                  <div key="name" role="gridcell" className={cn('flex min-w-0 items-center gap-2 px-2 text-[13px]', missing ? 'text-ink-3 line-through' : 'text-ink-1')}>
                    <span data-thumb className="size-[26px] shrink-0 overflow-hidden rounded-xs"><AssetThumb asset={a} fit="cover" /></span>
                    {p.renaming === a.id
                      ? <RenameInput name={a.name} onDone={n => p.onRenameDone(a.id, n)} className="text-left" />
                      : <span className="bb-hit min-w-0 truncate">{p.query ? highlight(a.name, p.query) : a.name}{p.query && a.hit && a.hit.field !== 'name' && <HitLine hit={a.hit} />}</span>}
                  </div>
                )
                case 'format': return <div key="format" role="gridcell" className="truncate px-2">{extOf(a.name)}</div>
                case 'stage': return <div key="stage" role="gridcell" className="px-2"><StageMark stage={a.stage} label="short" /></div>
                case 'review': return <div key="review" role="gridcell" className="flex items-center gap-2 px-2"><ReviewMark review={a.review} label />{(a.issueLevel === 'error' || a.issueLevel === 'warning') && <IssueMark level={a.issueLevel} flags={a.flags} corner={false} />}</div>
                case 'tags': return (
                  <div key="tags" role="gridcell" className="flex min-w-0 items-center gap-1 overflow-hidden px-2">
                    {a.tags.slice(0, 2).map(tg => <span key={tg} className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-fill-rest px-1.5 text-[11px] text-ink-1">{tg}</span>)}
                    {a.tags.length > 2 && <span className="text-ink-3">+{a.tags.length - 2}</span>}
                  </div>
                )
                case 'size': return <div key="size" role="gridcell" className="truncate px-2">{fmtSize(a.size)}</div>
                case 'modified': return <div key="modified" role="gridcell" className="truncate px-2">{fmtRelative(a.modified)}</div>
                case 'tech': return <div key="tech" role="gridcell" className="truncate px-2">{badgeText(reg, a) ?? ''}</div>
              }
              return null
            })}
            <i role="gridcell" />
          </div>
        )
      })}
    </div>
  )
}
