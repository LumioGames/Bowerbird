import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useNavigationType } from 'react-router'
import type { CreatorInfo, JobInfo, LibraryInfo, SortKey } from '@bowerbird/schema'
import {
  Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, Progress, Slider,
  ToggleGroup, ToggleGroupItem
} from '@bowerbird/plugin-sdk/web'
import { Crumbs, Toolbar, ToolbarButton, ToolbarGrow, ToolbarSep } from '../components/Toolbar'
import { Icon } from '../components/Icon'
import { cut, useFit } from '../components/fit'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { getLocale, t } from '../lib/i18n'
import { kbd } from '../lib/platform'
import { setPrefs, usePrefs } from '../lib/prefs'
import { setProgressMap } from '../lib/live'
import { MenuEntries, type MenuEntry } from '../overlays/menu'
import { toast, toastError } from '../overlays/toast'
import { usePluginRegistry, PluginSlot } from '../plugins/registry'
import { pluginText } from '../plugins/text'
import { libPath } from '../shell/runtime'
import { pickAndUpload } from '../flows/upload'
import { startCreator } from '../flows/creators'
import { noteOwnScan } from '../shell/scan-findings'
import { SearchBox, type SearchPatch } from './SearchBox'
import type { BrowseState } from './query'
import type { CompletionSource } from './complete'

/**
 * The browse tool bar (pages.md 外壳「顶栏」): side bar switch, back / forward, the path (middle levels give way
 * first), thumbnail size, layout, sort (相关度 only with a query word), filter, search, 开始校验 (only in 待审),
 * plugin buttons, 上传 / 新建 (with creator plugins), rescan, background work (one number: assets being processed
 * plus creation jobs, ADR-042 follow-ups), inspector switch.
 */
const SORTS: SortKey[] = ['relevance', 'name', 'modified', 'created', 'size', 'format']
/** The steps a crowded bar takes, in order (components/fit.ts): each folds what it names and everything before it. */
const FOLD = { sort: 1, words: 2, size: 3, search: 4, path: 5 } as const

let maxIdx = 0
function useHistoryButtons() {
  const type = useNavigationType()
  const loc = useLocation()
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
  React.useMemo(() => { if (type === 'PUSH' || type === 'REPLACE') maxIdx = type === 'PUSH' ? idx : Math.max(maxIdx, idx); else maxIdx = Math.max(maxIdx, idx) }, [loc.key, type, idx])
  return { canBack: idx > 0, canForward: idx < maxIdx }
}

export function BrowseToolbar(p: {
  lib: string
  info: LibraryInfo | undefined
  state: BrowseState
  crumbs: Array<{ label: string; to?: string }>
  sort: { sort: SortKey; order: 'asc' | 'desc' }
  filterOpen: boolean
  onFilterOpen: (v: boolean) => void
  onSort: (sort: SortKey, order: 'asc' | 'desc') => void
  onSearch: (patch: SearchPatch) => void
  source: CompletionSource
  searchRef: React.Ref<HTMLInputElement>
  currentFolder: string | null
  /** The asset the review queue starts from (the focused one). */
  startId?: string | null
}) {
  const navigate = useNavigate()
  const prefs = usePrefs()
  const reg = usePluginRegistry()
  const { canBack, canForward } = useHistoryButtons()
  const hasText = !!p.state.text.trim()
  const pendingView = p.state.loc.type === 'view' && p.state.loc.id === 'pending'
  const creators = useQuery({ queryKey: qk.creators(p.lib), queryFn: () => api.creators.list(p.lib), enabled: !!p.info?.hasCreators, staleTime: 60_000 })

  const sortEntries: MenuEntry[] = SORTS.map(k => ({
    id: k,
    label: t('sort.' + k),
    check: p.sort.sort === k,
    disabled: k === 'relevance' && !hasText,
    hint: k === 'relevance' && !hasText ? t('sort.relevanceHint') : undefined,
    onSelect: () => p.onSort(k, p.sort.sort === k && k !== 'relevance' ? (p.sort.order === 'asc' ? 'desc' : 'asc') : k === 'name' || k === 'format' ? 'asc' : 'desc')
  }))

  /* out of room (a narrow window, a longer language): the search box shrinks first (flex), then step by step the sort
     and the buttons with words fold into their icons, the size slider into a button, the search box may get narrower,
     and last the path's middle levels give way (the current level keeps its full name) */
  const fit = useFit<HTMLDivElement>(FOLD.path, el => cut(el), [p.crumbs.map(c => c.label), getLocale(), pendingView, p.sort.sort, reg.ui.toolbarItems.length, creators.data?.creators.length ?? 0])
  const fold = (step: number) => fit.level >= step
  const sortLabel = t('sort.' + p.sort.sort)

  return (
    <Toolbar label={t('bar.top')} ref={fit.ref}>
      <ToolbarButton icon="panel-left" label={t('bar.side')} shortcut={kbd('mod+\\')} pressed={!prefs.sideClosed} onClick={() => setPrefs({ sideClosed: !prefs.sideClosed })} />
      <ToolbarButton icon="chevron-left" label={t('bar.back')} disabled={!canBack} onClick={() => navigate(-1)} />
      <ToolbarButton icon="chevron-right" label={t('bar.forward')} disabled={!canForward} onClick={() => navigate(1)} />
      <Crumbs parts={p.crumbs.map(c => c.label)} fixed={!fold(FOLD.path)} onPick={i => { const to = p.crumbs[i]?.to; if (to != null) navigate(to) }} />
      <ToolbarGrow />
      {fold(FOLD.size)
        ? (
          <Popover>
            <PopoverTrigger asChild><ToolbarButton icon="maximize-2" label={t('bar.size')} /></PopoverTrigger>
            <PopoverContent align="center" className="w-[200px] min-w-0">
              <Slider min={96} max={320} value={[prefs.cellSize]} onValueChange={v => setPrefs({ cellSize: v[0]! })} aria-label={t('bar.size')} />
            </PopoverContent>
          </Popover>
        )
        : <Slider className="w-[88px]" min={96} max={320} value={[prefs.cellSize]} onValueChange={v => setPrefs({ cellSize: v[0]! })} aria-label={t('bar.size')} title={t('bar.size')} />}
      <ToggleGroup type="single" value={prefs.layout} onValueChange={v => v && setPrefs({ layout: v as typeof prefs.layout })} aria-label={t('bar.layout')}>
        {([['masonry', 'layout-dashboard'], ['grid', 'layout-grid'], ['list', 'list']] as const).map(([v, icon]) => (
          <ToggleGroupItem key={v} value={v} aria-label={t('layout.' + v)} title={t('layout.' + v)}><Icon name={icon} /></ToggleGroupItem>
        ))}
      </ToggleGroup>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button className={fold(FOLD.sort) ? 'px-2' : 'pr-2 pl-3'} title={fold(FOLD.sort) ? `${t('bar.sort')} · ${sortLabel}` : t('bar.sort')}>
            {fold(FOLD.sort) ? <><Icon name="arrow-up-down" /><span className="sr-only">{sortLabel}</span></> : sortLabel}
            <Icon name={p.sort.order === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} className="text-ink-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent><MenuEntries kind="dropdown" entries={sortEntries} close={() => {}} /></DropdownMenuContent>
      </DropdownMenu>
      <ToolbarButton icon="list-filter" label={t('bar.filter')} pressed={p.filterOpen} onClick={() => p.onFilterOpen(!p.filterOpen)} />
      <SearchBox state={p.state} onCommit={p.onSearch} source={p.source} inputRef={p.searchRef} narrow={fold(FOLD.search)} />
      <ToolbarSep />
      {pendingView && (
        <Button size={fold(FOLD.words) ? 'icon' : 'default'} title={fold(FOLD.words) ? t('bar.review') : undefined} onClick={() => {
          const sp = new URLSearchParams()
          if (p.startId) sp.set('start', p.startId)
          if (p.currentFolder) sp.set('folder', p.currentFolder)
          navigate(libPath(p.lib, '/review' + (sp.toString() ? '?' + sp.toString() : '')))
        }}><Icon name="badge-check" /><Words folded={fold(FOLD.words)}>{t('bar.review')}</Words></Button>
      )}
      {reg.ui.toolbarItems.map(it => <PluginToolbarItem key={it.pluginId + it.id} item={it} />)}
      <NewButton lib={p.lib} hasCreators={!!p.info?.hasCreators} creators={creators.data?.creators ?? []} folder={p.currentFolder} folded={fold(FOLD.words)} />
      <ToolbarButton icon="refresh-cw" label={t('bar.rescan')} onClick={async () => { try { noteOwnScan(); await api.libraries.rescan(p.lib); toast({ title: t('bar.rescanStarted') }) } catch (e) { toastError(e) } }} />
      <JobsButton lib={p.lib} />
      <ToolbarButton icon="panel-right" label={t('bar.inspector')} shortcut={kbd('mod+I')} pressed={!prefs.inspClosed} onClick={() => setPrefs({ inspClosed: !prefs.inspClosed })} />
    </Toolbar>
  )
}

function PluginToolbarItem({ item }: { item: ReturnType<typeof usePluginRegistry>['ui']['toolbarItems'][number] }) {
  const IconC = typeof item.icon === 'function' ? item.icon : null
  const body = (
    <>
      {IconC ? <IconC className="size-4" /> : <Icon name={(item.icon as string) || 'puzzle'} />}
      {item.Label && <span className="text-[12px] tabular-nums text-ink-2"><PluginSlot pluginId={item.pluginId} component={item.Label} props={{}} /></span>}
    </>
  )
  if (!item.Popover) return <Button variant="ghost" size={item.Label ? 'default' : 'icon'} title={item.title} aria-label={item.title} onClick={() => item.onClick?.()}>{body}</Button>
  const Pop = item.Popover
  return <PluginPopoverButton item={item} body={body} Pop={Pop} />
}

function PluginPopoverButton({ item, body, Pop }: { item: { pluginId: string; title: string; Label?: unknown }; body: React.ReactNode; Pop: React.ComponentType<{ close(): void }> }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="ghost" size={item.Label ? 'default' : 'icon'} title={item.title} aria-label={item.title}>{body}</Button></PopoverTrigger>
      <PopoverContent align="end"><PluginSlot pluginId={item.pluginId} component={Pop} props={{ close: () => setOpen(false) }} /></PopoverContent>
    </Popover>
  )
}

/** A button's words; folded, they stay for assistive technology and the tooltip while the button shows its icon. */
function Words({ folded, children }: { folded: boolean; children: string }) {
  return folded ? <span className="sr-only">{children}</span> : <>{children}</>
}

/** 上传, or with creator plugins the 新建 menu:「上传文件…」first, then each plugin's creation ways (ADR-016). */
function NewButton({ hasCreators, creators, folder, folded }: { lib: string; hasCreators: boolean; creators: CreatorInfo[]; folder: string | null; folded: boolean }) {
  if (!hasCreators || !creators.length) return <Button variant="primary" size={folded ? 'icon' : 'default'} title={folded ? t('bar.upload') : undefined} onClick={() => pickAndUpload(folder)}><Icon name="upload" /><Words folded={folded}>{t('bar.upload')}</Words></Button>
  const byPlugin = new Map<string, CreatorInfo[]>()
  for (const c of creators) byPlugin.set(c.pluginName, [...(byPlugin.get(c.pluginName) ?? []), c])
  const entries: MenuEntry[] = [{ id: 'upload', icon: 'upload', label: t('bar.uploadFiles'), onSelect: () => pickAndUpload(folder) }]
  for (const [plugin, list] of byPlugin) entries.push('sep', { header: pluginText(list[0]!.pluginId, plugin) }, ...list.map(c => ({ id: c.id, icon: 'sparkles', label: `${pluginText(c.pluginId, c.displayName)}…`, onSelect: () => void startCreator(c) })))
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button variant="primary" className={folded ? 'px-2' : undefined} title={folded ? t('bar.new') : undefined}><Icon name="plus" /><Words folded={folded}>{t('bar.new')}</Words><Icon name="chevron-down" size={12} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><MenuEntries kind="dropdown" entries={entries} close={() => {}} /></DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One number: assets being processed + running creation jobs + assets waiting for a browser to render them; the
 * popover lists them with cancel and follow-ups. No polling: `job.updated` events refresh it (lib/events.ts).
 */
function JobsButton({ lib }: { lib: string }) {
  const navigate = useNavigate()
  const jobs = useQuery({ queryKey: qk.jobs(lib), queryFn: () => api.jobs.overview(lib) })
  const d = jobs.data
  React.useEffect(() => {
    const m = new Map<string, number>()
    for (const j of d?.processing ?? []) if (j.assetId && j.progress != null) m.set(j.assetId, j.progress)
    setProgressMap(m)
  }, [d])
  const waiting = d?.waitingRender ?? 0
  const busy = (d?.busy ?? 0) + waiting
  const creates = (d?.creates ?? []).filter(j => j.status === 'running' || j.status === 'queued' || !!j.action)
  const processing = d?.processing ?? []
  const cancel = async (j: JobInfo) => { try { await api.jobs.cancel(lib, j.id); toast({ title: t('jobs.cancelled', { name: pluginText(j.pluginId, j.creatorName) ?? '' }) }); void jobs.refetch() } catch (e) { toastError(e) } }
  const follow = (j: JobInfo) => { if (!j.action || !j.pluginId) return; const qs = new URLSearchParams(j.action.params ?? {}).toString(); navigate(libPath(lib, `/plugins/${encodeURIComponent(j.pluginId)}/${encodeURIComponent(j.action.page)}${qs ? '?' + qs : ''}`)) }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" title={t('bar.jobs')} aria-label={t('bar.jobs')} className="tabular-nums">
          <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--fill-press)" strokeWidth="2.5" />
            {busy > 0 && <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="37.7" strokeDashoffset="14" className="origin-center animate-[bb-spin_1.6s_linear_infinite]" />}
          </svg>
          {busy}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px]">
        <h5 className="m-0 mb-2 text-[13px] leading-[18px] font-semibold">{t('jobs.title')}</h5>
        <div className="max-h-[320px] overflow-auto">
          {creates.map(j => (
            <div key={j.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-0.5 py-1 text-[12px] text-ink-2">
              <b className="truncate font-normal text-ink-1">{pluginText(j.pluginId, j.creatorName) ?? j.creator ?? j.actionId}</b>
              <span className="truncate">{pluginText(j.pluginId, j.message) ?? t('jobs.queued')}</span>
              {j.action
                ? <Button size="sm" variant="primary" onClick={() => follow(j)}>{pluginText(j.pluginId, j.action.label)}</Button>
                : <Button size="sm" variant="ghost" onClick={() => void cancel(j)}>{t('jobs.cancel')}</Button>}
              {!j.action && <Progress className="col-span-3" value={(j.progress ?? 0) * 100} />}
            </div>
          ))}
          {processing.slice(0, 30).map(j => (
            <div key={j.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 py-1 text-[12px] text-ink-2">
              <b className="truncate font-normal text-ink-1">{j.assetName ?? j.assetId}</b>
              <span>{j.message ?? (j.stage ? t('stagejob.' + j.stage) : t('jobs.processing'))}</span>
              <Progress className="col-span-2" value={(j.progress ?? 0.4) * 100} />
            </div>
          ))}
          {waiting > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1 text-[12px] text-ink-2">
              <b className="truncate font-normal text-ink-1">{t('jobs.waitingRender')}</b><span className="tabular-nums">{waiting}</span>
            </div>
          )}
          {!creates.length && !processing.length && !waiting && <p className="my-1 text-[12px] text-ink-2">{t('jobs.none')}</p>}
        </div>
        <Button size="sm" className={cn('mt-2 w-full')} onClick={() => navigate(libPath(lib, '/settings/tasks'))}>{t('jobs.all')}<Icon name="chevron-right" size={12} /></Button>
      </PopoverContent>
    </Popover>
  )
}
