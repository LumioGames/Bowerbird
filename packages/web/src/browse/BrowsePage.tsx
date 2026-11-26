import * as React from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import type { FolderNode, SearchResponse } from '@bowerbird/schema'
import { BowerbirdApiError } from '@bowerbird/schema'
import { Button } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { isMac } from '../lib/platform'
import { usePrefs } from '../lib/prefs'
import { useShortcut } from '../lib/shortcuts'
import { onLibraryEvent } from '../lib/events'
import { isMe } from '../lib/actor'
import { useLibraryId } from '../lib/library'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { useInspectorTarget } from '../shell/inspector-target'
import { libPath, setBrowseContext } from '../shell/runtime'
import { DRAG_TYPE } from '../shell/drag'
import { AssetContextMenu } from '../overlays/asset-actions'
import { isQuickLookOpen } from '../overlays/quicklook'
import { findSummary, putSummaries, removeAssets } from '../flows/cache'
import * as A from '../flows/actions'
import { filesFromDrop, pickAndUpload, uploadFiles, uploadsRunning } from '../flows/upload'
import { isOwn } from '../flows/own'
import { registering } from '../flows/library'
import { saveSmart, saveSmartEdit } from '../flows/folders'
import { BrowseToolbar } from './BrowseToolbar'
import { FilterPanel } from './FilterPanel'
import { Grid, GridSkeleton, type GridHandle } from './Grid'
import {
  buildQuery, chipsOf, effectiveSort, EMPTY_STATE, hasConditions, paramsFromState, removeChip, smartQueryOf, stateFromParams, type BrowseState
} from './query'
import { clickMode, marquee, moveFocus, NO_SELECTION, select, selectAll, type Selection } from './selection'

/**
 * Browse page: grid / masonry / list, toolbar, filter panel, search, selection (design/docs/pages.md「浏览页」).
 * The query lives in the address (browse/query.ts). The grid pages come from the search endpoint, 200 then 500 at a
 * time; what others add waits behind「有 N 个新资产 · 显示」(F-03), what changes is patched in place.
 */
const FIRST_PAGE = 200
const NEXT_PAGE = 500

function locKey(s: BrowseState): string { return JSON.stringify(s.loc) }

export function BrowsePage() {
  const lib = useLibraryId()
  const [sp, setSp] = useSearchParams()
  const qc = useQueryClient()
  const prefs = usePrefs()
  const spKey = sp.toString()
  const state = React.useMemo(() => stateFromParams(new URLSearchParams(spKey)), [spKey])
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
  const views = useQuery({ queryKey: qk.views(lib), queryFn: () => api.views.list(lib) })
  const vocab = useQuery({ queryKey: qk.vocabulary(lib), queryFn: () => api.libraries.vocabulary(lib), staleTime: 60_000 })
  const folders = useQuery({ queryKey: qk.folders(lib), queryFn: () => api.folders.tree(lib) })
  const smart = state.loc.type === 'smart' ? views.data?.views.find(v => v.name === (state.loc as { name: string }).name) ?? null : null
  const resolveBelongs = React.useCallback((name: string) => {
    const o = vocab.data?.designObjects.find(d => d.id === name || d.name === name || d.name.replace(/\.[^.]+$/, '') === name || d.title === name)
    return o?.id ?? null
  }, [vocab.data])
  const query = React.useMemo(() => buildQuery(state, smart, resolveBelongs), [state, smart, resolveBelongs])
  const sort = effectiveSort(state, smart)
  const lk = locKey(state)

  /* ── the pages ── */
  const prevLoc = React.useRef(lk)
  const pages = useInfiniteQuery({
    queryKey: qk.browse(lib, query),
    queryFn: ({ pageParam, signal }) => api.search(lib, { ...query, limit: pageParam ? NEXT_PAGE : FIRST_PAGE, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SearchResponse) => last.cursor ?? undefined,
    placeholderData: prev => (prevLoc.current === lk ? prev : undefined),
    enabled: state.loc.type !== 'smart' || !!views.data
  })
  React.useEffect(() => { prevLoc.current = lk }, [lk])
  const items = React.useMemo(() => pages.data?.pages.flatMap(p => p.items) ?? [], [pages.data])
  const total = Math.max(items.length, pages.data?.pages[0]?.total ?? 0)
  const order = React.useMemo(() => items.map(a => a.id), [items])
  const fetchMore = React.useCallback(() => { if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage() }, [pages])

  /* ── state in the address ── */
  const update = React.useCallback((next: BrowseState, push = false) => setSp(paramsFromState(next), { replace: !push }), [setSp])
  // Edits that arrive from timers (the search box's typing delay) merge onto the newest state, not the one they saw.
  const stateRef = React.useRef(state)
  stateRef.current = state
  const [filterOpen, setFilterOpen] = React.useState(() => !!state.editSmart)
  React.useEffect(() => { if (state.editSmart) setFilterOpen(true) }, [state.editSmart])

  /* ── selection ── */
  const [sel, setSel] = React.useState<Selection>(NO_SELECTION)
  const selSet = React.useMemo(() => new Set(sel.ids), [sel.ids])
  React.useEffect(() => { setSel(NO_SELECTION) }, [lk])
  const selectParam = sp.get('select')
  React.useEffect(() => {
    if (!selectParam) return
    setSel({ ids: [selectParam], anchor: selectParam, focus: selectParam })
    const next = new URLSearchParams(spKey); next.delete('select'); setSp(next, { replace: true })
  }, [selectParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadedIds = React.useMemo(() => new Set(order), [order])
  const outOfView = sel.ids.length > 0 && !pages.hasNextPage && !pages.isFetching && sel.ids.some(id => !loadedIds.has(id))
  useInspectorTarget(
    sel.ids.length
      ? { kind: 'assets', ids: sel.ids, outOfView }
      : state.loc.type === 'folder' ? { kind: 'folder', path: state.loc.path }
      : state.loc.type === 'smart' ? { kind: 'view', name: state.loc.name }
      : { kind: 'view', name: state.loc.type === 'view' ? state.loc.id : 'all' },
    [sel.ids.join(','), outOfView, lk]
  )

  /* ── live changes from others (F-03) ── */
  // The pill is for what others add after this page has shown its results. While the library is being scanned
  // (first registration, the start-up scan) or nothing is on screen yet, new assets have no place to jump around
  // in: they flow straight into the grid, and the end of the scan refreshes it once more.
  const shownRef = React.useRef(0)
  shownRef.current = items.length
  const scanningRef = React.useRef(false)
  const infoScanning = !!info.data?.scan?.running
  React.useEffect(() => { if (infoScanning) scanningRef.current = true }, [infoScanning])
  const [incoming, setIncoming] = React.useState<string[]>([])
  const [arrive, setArrive] = React.useState<ReadonlySet<string>>(new Set())
  React.useEffect(() => { setIncoming([]) }, [lk])
  React.useEffect(() => {
    let batch = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let flowTimer: ReturnType<typeof setTimeout> | null = null
    const flowIn = () => { if (!flowTimer) flowTimer = setTimeout(() => { flowTimer = null; void qc.invalidateQueries({ queryKey: ['lib', lib, 'browse'] }) }, 300) }
    const flush = async () => {
      timer = null
      const ids = [...batch]; batch = new Set()
      const shown = ids.filter(id => findSummary(qc, lib, id))
      if (!shown.length) return
      if (shown.length > 30) { void qc.invalidateQueries({ queryKey: ['lib', lib, 'browse'] }); return }
      const fresh = (await Promise.all(shown.map(id => api.assets.get(lib, id).catch(() => null)))).filter((a): a is NonNullable<typeof a> => !!a)
      for (const d of fresh) qc.setQueryData(qk.asset(lib, d.id), d)
      putSummaries(qc, lib, fresh)
    }
    const touch = (id: string | null | undefined) => { if (!id) return; batch.add(id); if (!timer) timer = setTimeout(() => void flush(), 300) }
    const off = onLibraryEvent((type, raw) => {
      const d = raw as Record<string, any> | null
      if (!d) return
      switch (type) {
        case 'asset.created': {
          const id = d.id as string
          const mine = () => isOwn(id) || (uploadsRunning() && isMe(d.by))
          // registering this folder's existing files (first open) is this browser's own doing: the grid refreshes
          // when it ends (ClaimPanel), nothing waits behind the pill
          if (mine() || registering(lib)) return
          if (shownRef.current === 0 || scanningRef.current) { flowIn(); return }
          setTimeout(() => { if (!mine() && !scanningRef.current) setIncoming(xs => (xs.includes(id) ? xs : [...xs, id])) }, 1500)
          break
        }
        case 'scan.progress': {
          const was = scanningRef.current
          scanningRef.current = !!d.running
          if (was && !d.running) flowIn()
          break
        }
        case 'asset.removed': removeAssets(qc, lib, [d.id]); break
        case 'asset.thumbnail': setArrive(s => new Set(s).add(d.id)); touch(d.id); break
        case 'asset.updated': touch(d.id); break
        case 'relation.updated': touch(d.from); touch(d.to); break
        case 'issue.created': case 'issue.resolved': touch(d.assetId); break
      }
    })
    return () => { off(); if (timer) clearTimeout(timer); if (flowTimer) clearTimeout(flowTimer) }
  }, [lib, qc])
  const showIncoming = () => { setIncoming([]); void qc.invalidateQueries({ queryKey: ['lib', lib, 'browse'] }); scroller?.scrollTo({ top: 0 }) }

  /* ── rename in place ── */
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const gridRef = React.useRef<GridHandle | null>(null)
  React.useEffect(() => A.onRenameRequest(id => {
    const i = order.indexOf(id)
    if (i < 0) return false
    gridRef.current?.scrollToIndex(i)
    setRenaming(id)
    return true
  }), [order])

  /* ── scrolling container, marquee, drop zone ── */
  const [scroller, setScroller] = React.useState<HTMLDivElement | null>(null)
  const [box, setBox] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const marqueeActive = React.useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !scroller) return
    const target = e.target as HTMLElement
    if (target.closest('[data-asset-cell],[data-filter-panel],button,input,textarea,a,[role="columnheader"]')) return
    const sr = scroller.getBoundingClientRect()
    const x0 = e.clientX, y0 = e.clientY
    const base = e.metaKey || e.ctrlKey || e.shiftKey ? sel.ids : []
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return
      moved = true; marqueeActive.current = true
      const l = Math.min(x0, ev.clientX), tp = Math.min(y0, ev.clientY), w = Math.abs(ev.clientX - x0), h = Math.abs(ev.clientY - y0)
      setBox({ left: l - sr.left, top: tp - sr.top + scroller.scrollTop, width: w, height: h })
      const rects = gridRef.current?.rects() ?? new Map()
      const ids = marquee(base, { left: l, top: tp, right: l + w, bottom: tp + h }, [...rects].map(([id, rect]) => ({ id, rect })))
      setSel(s => ({ ids, anchor: s.anchor ?? ids[0] ?? null, focus: ids[ids.length - 1] ?? s.focus }))
    }
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up)
      setBox(null)
      if (!moved && !e.metaKey && !e.ctrlKey && !e.shiftKey) setSel(NO_SELECTION)
      setTimeout(() => { marqueeActive.current = false }, 0)
    }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  const [dropping, setDropping] = React.useState(false)
  const dropTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentFolder = state.loc.type === 'folder' ? state.loc.path : ''
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault(); setDropping(true)
    if (dropTimer.current) clearTimeout(dropTimer.current)
    dropTimer.current = setTimeout(() => setDropping(false), 160)
  }
  const onDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault(); setDropping(false)
    const files = await filesFromDrop(e.dataTransfer)
    if (files.length) void uploadFiles(files, currentFolder)
  }

  /* ── grid callbacks ── */
  const onPointerSelect = React.useCallback((e: React.MouseEvent, id: string) => {
    if (marqueeActive.current) return
    setSel(s => select(s, order, id, clickMode(e, isMac)))
  }, [order])
  const onOpen = React.useCallback((id: string) => A.openAsset(id), [])
  const onContext = React.useCallback((_e: React.MouseEvent, id: string) => { setSel(s => (s.ids.includes(id) ? { ...s, focus: id } : { ids: [id], anchor: id, focus: id })) }, [])
  const onDragStart = React.useCallback((e: React.DragEvent, id: string) => {
    let ids = sel.ids
    if (!ids.includes(id)) { ids = [id]; setSel({ ids, anchor: id, focus: id }) }
    e.dataTransfer.setData(DRAG_TYPE, ids.join(','))
    e.dataTransfer.setData('text/plain', ids.map(x => findSummary(qc, lib, x)?.name ?? x).join('\n'))
    e.dataTransfer.effectAllowed = 'move'
  }, [sel.ids, qc, lib])
  const quick = React.useCallback((id: string, el?: HTMLElement | null) => {
    const i = order.indexOf(id)
    if (i < 0) return
    A.quickLook(order, i, el ?? null, j => { const nid = order[j]!; setSel({ ids: [nid], anchor: nid, focus: nid }); gridRef.current?.scrollToIndex(j) })
  }, [order])
  const onLongPress = React.useCallback((id: string, el: HTMLElement) => quick(id, el), [quick])
  const onRenameDone = React.useCallback((id: string, name: string | null) => { setRenaming(null); if (name) void A.renameAsset(id, name) }, [])

  /* ── keyboard (copy.md 快捷键): single keys only Space and Delete ── */
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const focusId = sel.focus ?? sel.ids[0] ?? null
  const isLocal = !!info.data?.isLocal
  // quick look is asked about when the key arrives (a value read at render would stay stale after it closes)
  useShortcut('mod+f', () => { searchRef.current?.focus(); searchRef.current?.select() }, { inInput: true })
  useShortcut(['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], e => {
    if (isQuickLookOpen()) return false
    const dir = e.key.replace('Arrow', '').toLowerCase() as 'left' | 'right' | 'up' | 'down'
    const layout = prefs.layout === 'masonry' ? { rects: gridRef.current?.rects() ?? new Map() } : { cols: gridRef.current?.cols() ?? 1 }
    const next = moveFocus(order, focusId, dir, layout)
    if (!next) return
    setSel({ ids: [next], anchor: next, focus: next })
    gridRef.current?.scrollToIndex(order.indexOf(next))
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-asset-cell="${CSS.escape(next)}"]`)?.focus({ preventScroll: true }))
  })
  useShortcut('space', () => { if (isQuickLookOpen()) return false; if (focusId) quick(focusId) })
  useShortcut('enter', () => { if (isQuickLookOpen()) return false; if (focusId) A.openAsset(focusId) })
  useShortcut('del', () => { if (sel.ids.length) void A.trashAssets(sel.ids) })
  useShortcut('mod+a', () => setSel(s => selectAll(order, s)))
  useShortcut('mod+d', () => { if (sel.ids.length === 1) void A.copyAsset(sel.ids[0]!, id => setSel({ ids: [id], anchor: id, focus: id })) })
  useShortcut('mod+o', () => { if (isLocal && sel.ids.length === 1) void A.openWithDefault(sel.ids[0]!) })
  useShortcut('mod+alt+r', () => { if (isLocal && sel.ids.length) void A.revealInFolder(sel.ids) })
  useShortcut('esc', () => { if (filterOpen) setFilterOpen(false); else if (sel.ids.length) setSel(NO_SELECTION); else return false })

  /* ── crumbs ── */
  const libName = info.data?.name ?? ''
  const crumbs: Array<{ label: string; to?: string }> = [{ label: libName, to: libPath(lib) }]
  if (state.loc.type === 'folder' && state.loc.path) {
    const parts = state.loc.path.split('/')
    parts.forEach((p, i) => crumbs.push({ label: p, to: libPath(lib, '?folder=' + encodeURIComponent(parts.slice(0, i + 1).join('/'))) }))
  } else if (state.loc.type === 'view') crumbs.push({ label: t('view.' + state.loc.id) })
  else if (state.loc.type === 'smart') crumbs.push({ label: state.loc.name })
  else if (state.editSmart) crumbs.push({ label: state.editSmart })

  /* 「打开」hands the detail page this result list and where to come back to (web-2 detail/nav.ts); the detail page's
     first crumb names the place as the prototype does — its last level (「chest」, 「全部」, a smart folder's name) */
  const orderRef = React.useRef(order)
  orderRef.current = order
  const crumbLabel = crumbs.length > 1 ? crumbs[crumbs.length - 1]!.label : t('view.all')
  React.useEffect(() => { setBrowseContext({ list: () => orderRef.current, label: crumbLabel }); return () => setBrowseContext(null) }, [crumbLabel])

  /* ── facets for the filter panel ── */
  const facets = useQuery({
    queryKey: qk.facets(lib, query),
    queryFn: ({ signal }) => api.search(lib, { ...query, limit: 1, facets: true }, signal),
    enabled: filterOpen,
    placeholderData: prev => prev
  })

  const folderPaths = React.useMemo(() => { const out: string[] = []; const walk = (n?: FolderNode) => { if (!n) return; if (n.path) out.push(n.path); n.children.forEach(walk) }; walk(folders.data?.root); return out }, [folders.data])
  const source = React.useMemo(() => ({ vocabulary: vocab.data ?? null, folders: folderPaths }), [vocab.data, folderPaths])
  const conditions = hasConditions(state)
  const suggestedName = [...chipsOf(state).map(c => c.value), state.text.trim()].filter(Boolean).join(' · ')

  /* ── body ── */
  let body: React.ReactNode
  const offline = pages.isError && pages.error instanceof BowerbirdApiError && pages.error.code === 'network'
  if (pages.isError && !pages.data) {
    body = <EmptyState className="min-h-[calc(100vh-160px)]" icon="unlink" title={offline ? t('empty.offline') : t('page.error')} body={offline ? <span className="font-mono">{location.host}</span> : undefined}
      action={<Button variant="primary" onClick={() => void pages.refetch()}><Icon name="refresh-cw" />{t('empty.retry')}</Button>} />
  } else if (!pages.data) {
    body = <GridSkeleton size={prefs.cellSize} />
  } else if (!total) {
    const libEmpty = (info.data?.counts.all ?? 1) === 0 && state.loc.type === 'all' && !conditions
    body = libEmpty
      ? <EmptyState className="min-h-[calc(100vh-160px)]" icon="upload" title={t('empty.library')} action={<Button variant="primary" onClick={() => pickAndUpload('')}><Icon name="upload" />{t('empty.libraryAction')}</Button>} />
      : conditions
        ? <EmptyState className="min-h-[calc(100vh-160px)]" icon="search" title={t('empty.search')} action={<>
            <Button onClick={() => { const cs = chipsOf(state); if (cs.length) update({ ...state, ...removeChip(state, cs[cs.length - 1]!) }); else update({ ...state, text: '' }) }}>{t('empty.searchLast')}</Button>
            <Button variant="ghost" onClick={() => update({ ...EMPTY_STATE, loc: state.loc })}>{t('empty.searchClear')}</Button>
          </>} />
        : state.loc.type === 'folder'
          ? <EmptyState className="min-h-[calc(100vh-160px)]" icon="folder-open" title={t('empty.folder')} action={<Button onClick={() => pickAndUpload(currentFolder)}><Icon name="upload" />{t('empty.folderAction')}</Button>} />
          : <EmptyState className="min-h-[calc(100vh-160px)]" icon="search" title={t('empty.search')} />
  } else {
    body = (
      <Grid ref={gridRef} items={items} total={total} layout={prefs.layout} size={prefs.cellSize} scroller={scroller} query={state.text}
        selected={selSet} focus={sel.focus} renaming={renaming} columns={prefs.listColumns} sort={sort}
        onSortColumn={k => update({ ...state, sort: k as typeof sort.sort, order: sort.sort === k ? (sort.order === 'asc' ? 'desc' : 'asc') : k === 'name' || k === 'format' ? 'asc' : 'desc' })}
        onRenameDone={onRenameDone} onPointerSelect={onPointerSelect} onOpen={onOpen} onContext={onContext} onDragStart={onDragStart}
        onLongPress={onLongPress} onNeedMore={fetchMore} arriveIds={arrive} />
    )
  }

  return (
    <>
      <BrowseToolbar lib={lib} info={info.data} state={state} crumbs={crumbs} sort={sort} filterOpen={filterOpen} onFilterOpen={setFilterOpen}
        onSort={(s, o) => update({ ...state, sort: s, order: o })}
        onSearch={patch => update({ ...stateRef.current, ...patch })}
        source={source} searchRef={searchRef} currentFolder={state.loc.type === 'folder' ? state.loc.path : ''} startId={focusId} />
      <AssetContextMenu ids={sel.ids} context="grid">
        <div
          ref={setScroller}
          className="bb-scroll-thin absolute inset-0 overflow-x-hidden overflow-y-auto pt-12"
          onPointerDown={onPointerDown}
          onContextMenu={e => { if (!(e.target as HTMLElement).closest('[data-asset-cell]')) e.preventDefault() }}
          onDragOver={onDragOver}
          onDrop={e => void onDrop(e)}
        >
          {filterOpen && (
            <FilterPanel state={state} facets={facets.data?.facets} vocabulary={vocab.data} total={pages.data ? total : null}
              onChange={patch => update({ ...state, ...patch })}
              onClear={() => update({ ...EMPTY_STATE, loc: state.loc, ...(state.editSmart ? { editSmart: state.editSmart } : {}) })}
              onSaveSmart={() => void saveSmart(smartQueryOf(state, smart), suggestedName || t('view.all'), views.data?.views ?? [])}
              onSaveEdit={state.editSmart ? () => void saveSmartEdit(state.editSmart!, smartQueryOf(state, smart)) : undefined} />
          )}
          <div className="relative min-h-full px-5 pt-3 pb-12">
            {incoming.length > 0 && (
              <button type="button" onClick={showIncoming}
                className="sticky top-14 z-[4] mx-auto mb-2 flex h-7 cursor-default items-center gap-1.5 rounded-full border-0 bg-accent-fill px-3 text-[12px] font-semibold text-accent-on shadow-popover hover:brightness-105 animate-[bb-rise_var(--duration-settle)_var(--spring-settle)_both]">
                <Icon name="arrow-up" size={12} />{t('grid.newAssets', { n: incoming.length })}
              </button>
            )}
            {body}
          </div>
          {box && <div className="pointer-events-none absolute z-[4] rounded-[2px] bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent-ring)]" style={box} />}
        </div>
      </AssetContextMenu>
      {dropping && (
        <div className="pointer-events-none absolute inset-2 top-14 z-[34] grid place-items-center rounded-xl bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent-ring)] animate-[bb-fade_var(--duration-fade)_var(--ease-out)_both]">
          <div className="flex items-center gap-2 rounded-lg bg-surface-raised px-4 py-2 text-[15px] font-semibold shadow-popover">
            <Icon name="upload" />{t('drop.upload', { target: currentFolder || libName })}
          </div>
        </div>
      )}
    </>
  )
}
