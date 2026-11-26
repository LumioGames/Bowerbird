import * as React from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import type { AssetDetail } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { t, useLocale } from '../lib/i18n'
import { useLibraryId } from '../lib/library'
import { isMe } from '../lib/actor'
import { onLibraryEvent } from '../lib/events'
import { isMac } from '../lib/platform'
import { Icon } from '../components/Icon'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { EmptyState } from '../components/EmptyState'
import { cut, useFit } from '../components/fit'
import { AssetActionsMenu } from '../overlays/asset-actions'
import { useInspectorTarget } from '../shell/inspector-target'
import { usePluginRegistry } from '../plugins/registry'
import { Btn, Num, Skeleton } from '../pages/shared/ui'
import { Menu } from '../pages/shared/menu'
import { overlayOpen, toggleInspector, typing, useInspectorOpen } from '../pages/shared/bridge'
import { baseName, errText, folderOf } from '../pages/shared/text'
import { useAsset } from '../pages/shared/queries'
import { RelationGraph, type FocusRel } from '../graph/RelationGraph'
import { VersionsTab } from '../versions/VersionsTab'
import { ReviewTab } from '../review/ReviewTab'
import { ViewerHost } from './ViewerHost'
import { PluginView, safeApplies } from './PluginView'
import { ReplacedBanner, StaleBanner } from './banners'
import { ObjectOverview } from './ObjectOverview'
import { assetPath, backDelta, closeTarget, crumbs, getDetailList, stepTo, type DetailState } from './nav'
import { markFormatSeen } from '../onboarding/store'

export interface DetailTab { id: string; title: string; count?: number; plugin?: string }

const PANEL_ID = 'w2-detail-panel'
/** The steps a crowded detail bar takes, in order (components/fit.ts). */
const DFOLD = { marks: 1, pos: 2, tight: 3, wrap: 4, wrapFold: 5 } as const
const tabDomId = (tab: string) => `w2-detail-tab-${tab.replace(/[^\w-]/g, '_')}`

/** Tabs (pages.md 详情页): 查看 / 关系 / 版本 / 校验; a design object adds 总览 first and 查看 becomes 文档; plugin tabs follow. */
export function tabsFor(asset: Pick<AssetDetail, 'memberCount' | 'relations' | 'versions'>, pluginTabs: Array<{ id: string; title: string; pluginId: string }> = []): DetailTab[] {
  const obj = asset.memberCount > 0
  const rel = asset.relations.outgoing.length + asset.relations.incoming.length
  const base: DetailTab[] = [
    ...(obj ? [{ id: 'obj', title: t('detail.tab.obj'), count: asset.memberCount }] : []),
    { id: 'view', title: t(obj ? 'detail.tab.doc' : 'detail.tab.view') },
    { id: 'rel', title: t('detail.tab.rel'), count: rel },
    { id: 'ver', title: t('detail.tab.ver'), count: asset.versions.length },
    { id: 'rev', title: t('detail.tab.rev') }
  ]
  return [...base, ...pluginTabs.map(p => ({ id: `plug:${p.pluginId}:${p.id}`, title: p.title, plugin: p.pluginId }))]
}

/**
 * 详情页 `/libraries/:lib/asset/:id?tab=` (pages.md 详情页): tool bar with back + the way here (folded to「…」past
 * two steps), tabs, previous / next, 更多操作 and the inspector switch; the tab panes; 上游已更新 banner;
 * 被别人替换 banner (F-03). The inspector shows this asset.
 */
export function DetailPage() {
  const locale = useLocale()
  const lib = useLibraryId()
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state ?? {}) as DetailState
  const trail = state.trail ?? []
  const q = useAsset(lib, id)
  const reg = usePluginRegistry()
  const inspectorOpen = useInspectorOpen()
  useInspectorTarget({ kind: 'assets', ids: id ? [id] : [] }, [id])

  /* someone else replaced the content: keep what is on screen until「显示新版本」 */
  const assetRef = React.useRef<AssetDetail | undefined>(undefined)
  assetRef.current = q.data
  const [replaced, setReplaced] = React.useState<{ by: string; version: number | null; snapshot: AssetDetail } | null>(null)
  React.useEffect(() => { setReplaced(null) }, [id])
  React.useEffect(() => onLibraryEvent((type, data) => {
    const d = data as { id?: string; fields?: string[]; by?: string; version?: number } | null
    if (type !== 'asset.updated' || !d || d.id !== id || !d.fields?.includes('content')) return
    if (!d.by || isMe(d.by)) return
    const snap = assetRef.current
    if (snap) setReplaced(r => ({ by: d.by!, version: d.version ?? null, snapshot: r?.snapshot ?? snap }))
  }), [id])

  const asset = q.data
  React.useEffect(() => { markFormatSeen(asset?.format) }, [asset?.format])
  const pluginTabs = asset ? reg.ui.detailTabs.filter(d => safeApplies(d.pluginId, d.appliesTo, asset)) : []
  const tabs = asset ? tabsFor(asset, pluginTabs) : []
  const wanted = params.get('tab')
  const tab = tabs.find(x => x.id === wanted)?.id ?? tabs[0]?.id ?? 'view'

  const setTab = (next: string) => navigate(assetPath(lib, id, next), { replace: true, state })
  /* tablist keys (WAI-ARIA tabs, automatic activation): ← → move and open the neighbouring tab, Home / End the ends */
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(x => x.id === tab)
    const n = tabs.length
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (j < 0 || !n) return
    e.preventDefault()
    const next = tabs[j]!.id
    setTab(next)
    requestAnimationFrame(() => document.getElementById(tabDomId(next))?.focus())
  }
  const go = (to: string, nextTab?: string) => stepTo(navigate, lib, { id, tab, name: q.data?.name, state }, to, nextTab ?? tab)
  const back = (k?: number) => { if (!trail.length) return close(); navigate(backDelta(trail, k)) }
  const close = () => navigate(closeTarget(lib, state).to)
  const list = getDetailList()
  const pos = list.indexOf(id)
  const step = (d: number) => {
    const nid = list[pos + d]
    if (!nid) return
    navigate(assetPath(lib, nid, tab), { replace: true, state })
  }

  /* out of room (a narrow window, a longer language): the name keeps as much as it can — the crumbs before it give way
     first (CSS), then the marks lose their words, the position goes, the tabs close up, and last the tabs take a row of
     their own under the name (components/fit.ts) */
  const fit = useFit<HTMLDivElement>(DFOLD.wrapFold, el => cut(el) + Math.max(cut(el.querySelector('.w2-dcr')), cut(el.querySelector('.w2-dh b'))), [locale, q.data?.name, trail.length, tabs.map(x => x.title + (x.count ?? '')), q.data?.stage, q.data?.review, q.data?.issueLevel])
  const fold = (step: number) => fit.level >= step
  // on a row of its own the name has room again: the marks and the position come back (unless even that is short)
  const folded = (step: number) => fold(step) && (!fold(DFOLD.wrap) || fold(DFOLD.wrapFold))

  const keyRef = React.useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && e.key === '[') { e.preventDefault(); back(); return }
    if (typing(e) || overlayOpen()) return
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !mod && !e.altKey && !e.shiftKey && tab !== 'ver') {
      if ((e.target as HTMLElement)?.closest?.('[role="tablist"], [role="radiogroup"], .w2-cw')) return
      e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1)
    }
  }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (q.isPending) return <div className="w2-detail"><div className="w2-dbar" /><Skeleton rows={5} /></div>
  if (q.isError || !asset) {
    return (
      <div className="w2-detail">
        <div className="w2-dbar"><Btn variant="ghost" iconOnly icon="chevron-left" aria-label={t('common.back')} onClick={() => back()} /></div>
        <EmptyState icon="file-question" title={t('detail.loadFailed')} body={q.error ? errText(q.error) : ''} action={<Btn icon="refresh-cw" onClick={() => void q.refetch()}>{t('w2.common.retry')}</Btn>} />
      </div>
    )
  }
  const shown = replaced?.snapshot ?? asset
  const { shown: shownCrumbs, hidden } = crumbs(trail)
  const home = state.fromLabel ?? (baseName(folderOf(asset.path)) || t('detail.home'))
  const focusRel: FocusRel | null = params.get('relTo') ? { type: params.get('relType') ?? 'uses', to: params.get('relTo')!, slot: params.get('relSlot') ?? undefined } : null
  const prevStep = trail[trail.length - 1]
  const backTitle = prevStep ? `${t('detail.backTo', { name: prevStep.name ?? '' })}  ${isMac ? '⌘[' : 'Ctrl+['}` : `${t('detail.backTo', { name: home })}  Esc`
  const crumbName = (i: number) => (i < trail.length ? trail[i]!.name ?? null : null)

  return (
    <div className="w2-detail" data-tab={tab}>
      <div className={cn('w2-dbar', folded(DFOLD.tight) && 'w2-dbar--tight', fold(DFOLD.wrap) && 'w2-dbar--wrap')} ref={fit.ref}>
        <Btn variant="ghost" iconOnly icon="chevron-left" aria-label={t('common.back')} title={backTitle} onClick={() => back()} />
        <nav className="w2-dcr" aria-label={t('detail.trail')}>
          <button type="button" className="w2-dcr__c" title={t('detail.toBrowse')} onClick={close}>{home}</button>
          {hidden.length > 0 && <>
            <Icon name="chevron-right" size={12} />
            <Menu trigger={<button type="button" className="w2-dcr__c" aria-label={t('detail.earlier')}>…</button>}
              items={() => hidden.slice().reverse().map(i => ({ icon: 'chevron-left', label: <TrailName lib={lib} id={trail[i]!.id} fallback={crumbName(i)} />, onSelect: () => back(i) }))} />
          </>}
          {shownCrumbs.map(i => (
            <React.Fragment key={i}>
              <Icon name="chevron-right" size={12} />
              <button type="button" className="w2-dcr__c" onClick={() => back(i)}><TrailName lib={lib} id={trail[i]!.id} fallback={crumbName(i)} /></button>
            </React.Fragment>
          ))}
          <Icon name="chevron-right" size={12} />
          <div className="w2-dh">
            <b title={asset.path}>{asset.name}</b>
            {asset.issueLevel && <IssueMark level={asset.issueLevel} count={asset.issueCount} flags={asset.flags} />}
            <StageMark stage={asset.stage} size="sm" label={folded(DFOLD.marks) ? 'none' : 'short'} />
            <ReviewMark review={asset.review} size="sm" label={!folded(DFOLD.marks)} />
          </div>
        </nav>
        <span className="w2-grow" />
        <div className="w2-tabs" role="tablist" aria-label={t('detail.tabs')} onKeyDown={onTabKey}>
          {tabs.map(x => (
            <button key={x.id} type="button" role="tab" id={tabDomId(x.id)} aria-controls={PANEL_ID} tabIndex={x.id === tab ? 0 : -1}
              className={cn('w2-tab', x.plugin && 'w2-tab--plugin')} aria-selected={x.id === tab} data-value={x.id} onClick={() => x.id !== tab && setTab(x.id)}>
              {x.title}{x.count ? <span className="w2-tab__count">{x.count}</span> : null}
            </button>
          ))}
        </div>
        <span className="w2-grow" />
        {pos >= 0 && !folded(DFOLD.pos) && <Num>{pos + 1} / {list.length}</Num>}
        <Btn variant="ghost" iconOnly icon="chevron-left" aria-label={t('detail.prev')} title={`${t('detail.prev')} ←`} disabled={pos <= 0} onClick={() => step(-1)} />
        <Btn variant="ghost" iconOnly icon="chevron-right" aria-label={t('detail.next')} title={`${t('detail.next')} →`} disabled={pos < 0 || pos >= list.length - 1} onClick={() => step(1)} />
        <span className="w2-sep" />
        <AssetActionsMenu ids={[asset.id]} context="detail" trigger={<Btn variant="ghost" iconOnly icon="ellipsis" aria-label={t('detail.more')} title={t('detail.more')} />} />
        <Btn variant="ghost" iconOnly icon="panel-right" aria-pressed={inspectorOpen} aria-label={t('detail.inspector')} title={`${t('detail.inspector')} ${isMac ? '⌘I' : 'Ctrl+I'}`} onClick={toggleInspector} />
      </div>
      <div className="w2-dtop">
        {replaced && <ReplacedBanner by={replaced.by} version={replaced.version} onShow={() => setReplaced(null)} />}
        <StaleBanner lib={lib} asset={asset} />
      </div>
      <div className="w2-dpane" key={tab} id={PANEL_ID} role="tabpanel" aria-labelledby={tabDomId(tab)}>
        {tab === 'view' && <ViewerHost lib={lib} asset={shown} className="w2-vhost" />}
        {tab === 'rel' && <RelationGraph lib={lib} asset={asset} onOpenAsset={nid => go(nid, 'rel')} focusRel={focusRel} />}
        {tab === 'ver' && <VersionsTab lib={lib} asset={asset} />}
        {tab === 'rev' && <ReviewTab lib={lib} asset={asset} />}
        {tab === 'obj' && <ObjectOverview lib={lib} asset={asset} onOpen={nid => go(nid)} />}
        {tab.startsWith('plug:') && <PluginTab lib={lib} asset={asset} tabId={tab} />}
      </div>
    </div>
  )
}

/** A step's name in the trail (fetched lazily; the asset may have been deleted meanwhile). */
function TrailName({ lib, id, fallback }: { lib: string; id: string; fallback: string | null }) {
  const q = useAsset(lib, id)
  return <>{q.data?.name ?? fallback ?? (q.isError ? t('detail.deleted') : '…')}</>
}

/** A plugin's own detail tab, in its PluginSlot (own storage, own error boundary: a crash keeps the page). */
function PluginTab({ lib, asset, tabId }: { lib: string; asset: AssetDetail; tabId: string }) {
  const reg = usePluginRegistry()
  const def = reg.ui.detailTabs.find(d => `plug:${d.pluginId}:${d.id}` === tabId)
  if (!def) return null
  return <div className="w2-dcol"><PluginView key={tabId} lib={lib} pluginId={def.pluginId} component={def.Component} props={{ asset }} assets={[asset]} /></div>
}
