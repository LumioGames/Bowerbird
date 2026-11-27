import * as React from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { AssetDetail, AssetSummary, Provenance } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { t } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { AssetThumb } from '../components/AssetThumb'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { AssetContextMenu } from '../overlays/asset-actions'
import { openQuickLook } from '../overlays/quicklook'
import { Btn, Grow, Num, Skeleton } from '../pages/shared/ui'
import { PointMenu, type MenuEntry } from '../pages/shared/menu'
import { dayTime } from '../pages/shared/text'
import { overlayOpen, typing } from '../pages/shared/bridge'
import { useLineage } from '../pages/shared/queries'
import { comparePath } from '../detail/banners'
import { buildGraph, cyclePath, methodLabel, readingOrder, type GEdge, type GNode, type Graph, type GraphOpts, type RelRef } from './build'
import { EdgePanel, ProvenanceBody } from './panels'
import { addRelation } from './actions'
import { openRelationDialog } from './RelationDialog'
import { linkMenu, type PointAt } from './link-menu'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
type Panel = { edge: string } | { rec: Provenance; of: string } | null
interface View { z: number; tx: number; ty: number }
interface LinkDrag { from: GNode; x: number; y: number; over: string | null }

/** Where the integrity page's「重新指定…」lands: the relation to open (web-shell.md 关系图). */
export interface FocusRel { type: string; to: string; slot?: string }

/**
 * 关系页签 (pages.md 关系页签, components.md 关系图): pan / zoom canvas, hover highlights, edges by type, slot names,
 * missing placeholders, stale warnings, groups, provenance and relation panels, drag a link between nodes, select two to
 * compare, space quick look, version timeline only with a version plugin (ADR-024).
 */
export function RelationGraph({ lib, asset, onOpenAsset, focusRel }: { lib: string; asset: AssetDetail; onOpenAsset(id: string): void; focusRel?: FocusRel | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [opts, setOpts] = React.useState<GraphOpts>({ down: 2, open: {} })
  /* what each asset was made from: source and reference relations (ADR-073); the lineages carry every node's provenance */
  const up = useLineage(lib, asset.id, { direction: 'up', types: ['source', 'reference'], depth: 50 })
  const down = useLineage(lib, asset.id, { direction: 'down', types: ['source', 'reference'], depth: opts.down + 1 })

  const G: Graph | null = React.useMemo(() => {
    if (!up.data || !down.data) return null
    return buildGraph({ center: asset, up: up.data, down: down.data, relations: asset.relations, provenance: asset.provenance }, opts, t)
  }, [asset, up.data, down.data, opts])

  const names = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const n of [...(up.data?.nodes ?? []), ...(down.data?.nodes ?? [])]) m.set(n.id, n.name)
    for (const r of [...asset.relations.outgoing, ...asset.relations.incoming]) if (r.target) m.set(r.target.id, r.target.name)
    m.set(asset.id, asset.name)
    return m
  }, [up.data, down.data, asset])
  const sourceEdges = React.useMemo(() => [...(up.data?.edges ?? []), ...(down.data?.edges ?? [])].filter(e => e.type === 'source'), [up.data, down.data])

  const viewRef = React.useRef<HTMLDivElement>(null)
  const [view, setView] = React.useState<View>({ z: 1, tx: 0, ty: 0 })
  const [anim, setAnim] = React.useState(false)
  const [panel, setPanel] = React.useState<Panel>(null)
  const [sel, setSel] = React.useState<string[]>([])
  const [hover, setHover] = React.useState<string | null>(null)
  const [kb, setKb] = React.useState<string | null>(null)
  const [link, setLink] = React.useState<LinkDrag | null>(null)
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const fitted = React.useRef<string | null>(null)
  const pan = React.useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)

  const fit = React.useCallback((animate: boolean, withPanel = !!panel) => {
    const el = viewRef.current
    if (!G || !el) return
    const b = G.bounds, W = el.clientWidth - (withPanel ? 300 : 0), H = el.clientHeight
    if (W <= 0 || H <= 0) return
    const bw = b.x1 - b.x0 + 80, bh = b.y1 - b.y0 + 120
    const z = clamp(Math.min(W / bw, H / bh), 0.55, 1)
    let tx = W / 2 - ((b.x0 + b.x1) / 2) * z
    const ty = H / 2 - ((b.y0 + b.y1) / 2) * z
    const c = G.nodes.get(asset.id)!
    if (bw * z > W) tx = Math.min(W * 0.62 - c.x * z, 40 - b.x0 * z)
    setAnim(animate); setView({ z, tx, ty })
  }, [G, asset.id, panel])

  /* fit when the graph opens, and again while parts of it are still arriving (downstream after upstream) — until the
     person pans or zooms */
  const userMoved = React.useRef(false)
  React.useLayoutEffect(() => {
    if (!G) return
    const key = `${asset.id}|${G.order.join(',')}`
    if (fitted.current === key) return
    const sameAsset = fitted.current?.startsWith(`${asset.id}|`)
    if (sameAsset && userMoved.current) return
    if (!sameAsset) userMoved.current = false
    fitted.current = key
    fit(false)
  }, [G, asset.id, fit])
  React.useEffect(() => { setPanel(null); setSel([]); setOpts({ down: 2, open: {} }) }, [asset.id])

  /* opened for one relation (重新指定… on the integrity page): show its panel */
  const focusDone = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!G || !focusRel) return
    const k = `${asset.id}|${focusRel.type}|${focusRel.to}|${focusRel.slot ?? ''}`
    if (focusDone.current === k) return
    const e = G.edges.find(x => x.rel && x.rel.from === asset.id && x.rel.type === focusRel.type && x.rel.to === focusRel.to && (x.rel.slot ?? '') === (focusRel.slot ?? ''))
    if (e) { focusDone.current = k; openPanel({ edge: e.key }) }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const openPanel = (p: Panel) => {
    const wasClosed = !panel
    setPanel(p)
    /* make room: slide the graph left just enough that nothing sits under the panel */
    if (wasClosed && p && 'edge' in p && G && viewRef.current) {
      const e = G.edges.find(x => x.key === p.edge)
      const n = e ? G.nodes.get(e.to) : null
      const fx = n ? n.x + n.w / 2 : G.bounds.x1
      const limit = viewRef.current.clientWidth - 316, right = view.tx + fx * view.z
      if (right > limit) { setAnim(true); setView(v => ({ ...v, tx: v.tx - (right - limit) })) }
    }
  }

  const zoomBy = (f: number) => {
    userMoved.current = true
    const el = viewRef.current
    const W = (el?.clientWidth ?? 0) / 2, H = (el?.clientHeight ?? 0) / 2
    setAnim(true)
    setView(v => { const z = clamp(v.z * f, 0.35, 1.6); return { z, tx: W - ((W - v.tx) * z) / v.z, ty: H - ((H - v.ty) * z) / v.z } })
  }
  const local = (e: { clientX: number; clientY: number }) => { const r = viewRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const toWorld = (p: { x: number; y: number }) => ({ x: (p.x - view.tx) / view.z, y: (p.y - view.ty) / view.z })

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button) return
    const tgt = e.target as HTMLElement
    if (tgt.closest('.w2-rg__panel, .w2-rg__zoom, .w2-rg__legend, .w2-rg__selbar, button, .w2-ge__hit, .w2-gn, [role="menu"]')) return
    const p = local(e)
    pan.current = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, moved: false }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic */ }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (link) {
      const w = toWorld(local(e))
      const over = (document.elementFromPoint?.(e.clientX, e.clientY) as HTMLElement | null)?.closest?.('[data-asset]') as HTMLElement | null
      const id = over?.dataset.asset ?? null
      setLink({ ...link, x: w.x, y: w.y, over: id && id !== link.from.asset?.id ? id : null })
      return
    }
    const d = pan.current
    if (!d) return
    const p = local(e)
    if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 4) d.moved = true
    if (d.moved) { userMoved.current = true; setAnim(false); setView(v => ({ ...v, tx: d.tx + p.x - d.x, ty: d.ty + p.y - d.y })) }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pan.current = null
    if (link) {
      const l = link
      setLink(null)
      const target = l.over ? findAsset(l.over) : null
      if (target && l.from.asset) { const p = local(e); setMenu({ ...p, items: linkItems(l.from.asset, target, p) }) }
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    userMoved.current = true
    setAnim(false)
    if (e.ctrlKey || e.metaKey) {
      const p = local(e)
      setView(v => { const z = clamp(v.z * Math.exp(-e.deltaY * 0.01), 0.35, 1.6); return { z, tx: p.x - ((p.x - v.tx) * z) / v.z, ty: p.y - ((p.y - v.ty) * z) / v.z } })
    } else setView(v => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }))
  }
  React.useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const stop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  function findAsset(id: string): AssetSummary | null {
    if (!G) return null
    for (const n of G.nodes.values()) {
      if (n.asset?.id === id) return n.asset
      const it = n.items?.find(a => a.id === id)
      if (it) return it
    }
    return null
  }
  const existing: RelRef[] = React.useMemo(() => (G?.edges ?? []).map(e => e.rel).filter((r): r is RelRef => !!r), [G])
  const linkItems = (a: AssetSummary, b: AssetSummary, at: PointAt): MenuEntry[] => linkMenu(a, b, at, {
    wouldCycle: (x, y) => !!cyclePath(sourceEdges, x, y),
    existing,
    onSource: (x, y, type) => void openRelationDialog(lib, x, { type, to: y, existing, sourceEdges, names: Object.fromEntries(names) }),
    onAdd: (type, x, y) => void addRelation(qc, lib, x, type, y),
    open: m => setMenu(m)
  })

  /* space: quick look what the pointer rests on (else the centre); ← → inside walk the graph left to right */
  const hoverAsset = (() => { if (!hover || !G) return null; const n = G.nodes.get(hover); return n?.asset?.id ?? (findAsset(hover) ? hover : null) })()
  const keyRef = React.useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (!G || e.defaultPrevented || typing(e) || overlayOpen()) return
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const ids = readingOrder(G)
      const id = hoverAsset ?? asset.id
      const origin = viewRef.current?.querySelector(`[data-asset="${CSS.escape(id)}"] .w2-thumbslot`) as HTMLElement | null
      openQuickLook({ ids, index: Math.max(0, ids.indexOf(id)), origin, onIndexChange: i => setKb(ids[i] ?? null), onClose: () => setKb(null) })
      return
    }
    if (e.key === 'Escape') {
      if (menu) return
      if (panel) { e.preventDefault(); e.stopImmediatePropagation(); setPanel(null); return }
      if (sel.length) { e.preventDefault(); e.stopImmediatePropagation(); setSel([]) }
    }
  }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [])

  if (up.isError || down.isError) return <div className="w2-dcol"><p className="w2-rv__none">{t('common.loadFailed')}</p><Btn onClick={() => { void up.refetch(); void down.refetch() }}>{t('w2.common.retry')}</Btn></div>
  if (!G) return <Skeleton rows={4} />

  const hl = new Set<string>()
  if (hover) {
    hl.add(hover)
    for (const e of G.edges) if (e.from === hover || e.to === hover) { hl.add(e.from); hl.add(e.to) }
  }
  const activeEdge = panel && 'edge' in panel ? panel.edge : null
  const versions = asset.versions
  const toggleSel = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id].slice(-2))
  const markerId = (k: string) => `w2m-${k}`

  /* keyboard (a11y): every node is focusable; ↵ / Space act like a click (Space on an asset is quick look, handled
     above from the hovered = focused node); ← → ↑ ↓ move focus through the assets in reading order */
  const order = readingOrder(G)
  const focusAsset = (from: string, d: number) => {
    const i = order.indexOf(from)
    const next = order[Math.max(0, Math.min(order.length - 1, (i < 0 ? 0 : i) + d))]
    if (next) (viewRef.current?.querySelector(`[data-asset="${CSS.escape(next)}"] [tabindex="0"], [data-asset="${CSS.escape(next)}"][tabindex="0"]`) as HTMLElement | null)?.focus()
  }
  const keys = (n: GNode, activate: () => void, assetId?: string) => ({
    tabIndex: 0,
    role: 'button' as const,
    onFocus: () => setHover(n.key),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || (e.key === ' ' && !assetId)) { e.preventDefault(); activate(); return }
      if (assetId && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
        e.preventDefault()
        focusAsset(assetId, e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)
      }
    }
  })

  const nodeEl = (n: GNode) => {
    const pos: React.CSSProperties = { left: n.x - n.w / 2, top: n.y - n.h / 2, width: n.w, height: n.h }
    const common = { 'data-key': n.key, onPointerEnter: () => setHover(n.key) }
    if (n.kind === 'rec') {
      return (
        <div key={n.key} {...common} {...keys(n, () => openPanel({ rec: n.rec!, of: n.recOf! }))} aria-label={t('rec.title')} className={cn('w2-gn w2-gn--rec', hl.has(n.key) && 'w2-gn--hl')} style={pos} title={t('rec.title')} onClick={() => openPanel({ rec: n.rec!, of: n.recOf! })}>
          <Icon name={n.rec!.method === 'ai-generate' ? 'sparkles' : 'activity'} />
          <div><b>{methodLabel(n.rec!.method, t)}</b><small>{n.rec!.by}</small></div>
        </div>
      )
    }
    if (n.kind === 'missing') {
      return (
        <div key={n.key} {...common} className={cn('w2-gn w2-gn--missing', hl.has(n.key) && 'w2-gn--hl')} style={pos}>
          <div className="w2-gn__thumb"><Icon name="file-question" size={24} /><span className="w2-corner w2-corner--bl"><IssueMark level="error" flags={['broken']} /></span></div>
          <div className="w2-gn__name">{n.name}</div>
          <div className="w2-gn__sub">{t(n.inTrash ? 'graph.inTrash' : 'graph.gone')}</div>
        </div>
      )
    }
    if (n.kind === 'group' || n.kind === 'frame') {
      const items = n.items!
      const pend = items.filter(x => x.review === 'pending').length
      const iss = items.filter(x => x.issueLevel)
      const title = `${n.members ? t('graph.membersShort') : n.rec ? methodLabel(n.rec.method, t) : t('w2.rel.type.source')} · ${items.length}`
      const toggle = () => setOpts(o => ({ ...o, open: { ...o.open, [n.gkey!]: !o.open[n.gkey!] } }))
      if (n.kind === 'group') {
        return (
          <div key={n.key} {...common} {...keys(n, toggle)} aria-label={`${title} · ${t('graph.expand')}`} className={cn('w2-gn w2-gn--group', hl.has(n.key) && 'w2-gn--hl')} style={pos} title={t('graph.expand')} onClick={toggle}>
            <div className="w2-gn__thumb w2-gn__stack">
              {items.slice(0, 4).map(x => <span key={x.id}><AssetThumb asset={x} fit="cover" /></span>)}
              {iss.length > 0 && <span className="w2-corner w2-corner--bl"><IssueMark level={iss[0]!.issueLevel} count={iss.length} /></span>}
              {pend > 0 && <span className="w2-corner w2-corner--br"><ReviewMark review="pending" size="sm" /><Num>{pend}</Num></span>}
            </div>
            <div className="w2-gn__name">{title}</div>
            <div className="w2-gn__sub">{n.rec ? n.rec.by : t('rel.designObject')}</div>
          </div>
        )
      }
      const sorted = items.slice().sort((x, y) => Number(!!y.issueLevel) - Number(!!x.issueLevel) || Number(y.review === 'pending') - Number(x.review === 'pending'))
      return (
        <div key={n.key} {...common} className={cn('w2-gn w2-gn--frame', hl.has(n.key) && 'w2-gn--hl')} style={pos}>
          <div className="w2-gn__fhead">
            <Icon name={n.members ? 'layers' : 'activity'} size={12} /><b>{title}</b>
            {n.rec && n.recOf && <button type="button" className="w2-gn__frec" onClick={() => openPanel({ rec: n.rec!, of: n.recOf! })}>{n.rec.by}</button>}
            <Btn size="sm" variant="ghost" iconOnly icon="minus" aria-label={t('graph.collapse')} title={t('graph.collapse')} onClick={toggle} />
          </div>
          <div className="w2-gn__grid">
            {sorted.map(x => (
              <AssetContextMenu key={x.id} ids={[x.id]} context="graph">
                <div className="w2-gm" data-asset={x.id} title={x.name} tabIndex={0} role="button" aria-label={x.name} onClick={() => onOpenAsset(x.id)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpenAsset(x.id) } }}>
                  <div className="w2-gm__t w2-thumbslot">
                    <AssetThumb asset={x} fit="cover" />
                    <span className="w2-corner w2-corner--tl"><StageMark stage={x.stage} size="sm" /></span>
                    {x.review === 'pending' && <span className="w2-corner w2-corner--tr"><ReviewMark review="pending" size="sm" /></span>}
                    {x.issueLevel && <span className="w2-corner w2-corner--bl"><IssueMark level={x.issueLevel} flags={x.flags} /></span>}
                  </div>
                  <span>{x.name}</span>
                </div>
              </AssetContextMenu>
            ))}
          </div>
        </div>
      )
    }
    const a = n.asset!
    const isSel = sel.includes(a.id)
    const last = n.center ? versions[versions.length - 1] : null
    /* the centre: version · note · day and time without the month (graph.js「v2 · 修正包边比例 · 24 日 16:42」) */
    const sub = n.center ? (last ? `v${versions.length} · ${last.note ?? ''} · ${dayTime(last.at)}` : '') : n.sub ?? ''
    return (
      <AssetContextMenu key={n.key} ids={[a.id]} context="graph">
        <div {...common} data-asset={a.id} data-onboard={n.center ? 'graph.center' : undefined}
          className={cn('w2-gn', n.center && 'w2-gn--center', isSel && 'w2-gn--sel', hl.has(n.key) && 'w2-gn--hl', link?.over === a.id && 'w2-gn--drop', kb === a.id && 'w2-gn--kb')}
          style={pos}
          onClick={e => {
            if ((e.target as HTMLElement).closest('button, [data-port]')) return
            if (e.metaKey || e.ctrlKey || e.shiftKey) { toggleSel(a.id); return }
            if (!n.center) onOpenAsset(a.id)
          }}>
          {/* the focusable part is the picture (the node also holds 选择 and the link port: no nested controls) */}
          <div className="w2-gn__thumb w2-thumbslot" {...keys(n, () => { if (!n.center) onOpenAsset(a.id) }, a.id)} aria-label={sub ? `${a.name} · ${sub}` : a.name}>
            <AssetThumb asset={a} fit="contain" />
            <span className="w2-corner w2-corner--tl"><StageMark stage={a.stage} size="sm" /></span>
            {a.review !== 'exempt' && <span className="w2-corner w2-corner--tr"><ReviewMark review={a.review} size="sm" /></span>}
            {a.issueLevel && <span className="w2-corner w2-corner--bl"><IssueMark level={a.issueLevel} count={a.issueCount} flags={a.flags} /></span>}
          </div>
          <div className="w2-gn__name" title={a.path}>{a.name}</div>
          <div className="w2-gn__sub">{sub}</div>
          <button type="button" className="w2-gn__sel" aria-pressed={isSel} aria-label={t('graph.select')} title={t('graph.selectTip')} onClick={() => toggleSel(a.id)}><Icon name="check" size={12} /></button>
          <i className="w2-gn__port" data-port title={t('graph.portTip')}
            onPointerDown={e => { e.stopPropagation(); e.preventDefault(); const w = toWorld(local(e)); setLink({ from: n, x: w.x, y: w.y, over: null }); try { viewRef.current?.setPointerCapture(e.pointerId) } catch { /* synthetic */ } }} />
          {n.more ? <button type="button" className="w2-gn__more" title={t('graph.more')} onClick={() => setOpts(o => ({ ...o, down: o.down + 1 }))}>+{n.more}</button> : null}
        </div>
      </AssetContextMenu>
    )
  }

  const edgeMarker = (e: GEdge) => e.type === 'belongs' ? undefined : `url(#${markerId(e.broken ? 'broken' : e.stale ? 'stale' : e.type === 'source' || e.type === 'reference' ? 'src' : 'uses')})`
  const edgeClass = (type: string) => (type === 'source' || type === 'reference' || type === 'belongs' ? type : 'uses')
  const linkPath = link ? (() => {
    const a0 = link.from, x1 = a0.x + a0.w / 2, y1 = a0.y, dx = Math.max(30, (link.x - x1) / 2)
    return `M${x1} ${y1} C${x1 + dx} ${y1} ${link.x - dx} ${link.y} ${link.x} ${link.y}`
  })() : null

  return (
    <div className="w2-rg">
      <div className="w2-rg__bar">
        {/* No version timeline and no「v1 时的关系」banner: the lineage endpoint has no version parameter and phase one
            has no version plugin, so there are no past relations to show (ADR-024). They come back only when both exist. */}
        <Grow />
        <Btn size="sm" icon="link" onClick={() => void openRelationDialog(lib, asset, { existing, sourceEdges, names: Object.fromEntries(names) })}>{t('graph.newRelation')}</Btn>
      </div>
      <div ref={viewRef} className={cn('w2-rg__view', pan.current?.moved && 'panning')} data-panel={panel ? '' : undefined} tabIndex={-1}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { pan.current = null; setLink(null) }}
        onPointerLeave={() => { if (!link) setHover(null) }} onWheel={onWheel}>
        <div className={cn('w2-rg__world', anim && 'anim', hover && 'w2-rg--focus')} style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})` }}>
          <svg className="w2-rg__edges" width="1" height="1">
            <defs>
              {([['src', 'var(--ink-2)'], ['stale', 'var(--warning-ink)'], ['broken', 'var(--danger-ink)'], ['uses', 'var(--line-control)']] as const).map(([k, c]) => (
                <marker key={k} id={markerId(k)} viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0.5L8 4L0 7.5z" style={{ fill: c }} /></marker>
              ))}
            </defs>
            {G.edges.map(e => (
              <g key={e.key} data-edge={e.key} data-on={activeEdge === e.key ? '' : undefined}
                className={cn('w2-ge', `w2-ge--${edgeClass(e.type)}`, e.stale && 'w2-ge--stale', e.broken && 'w2-ge--broken', e.spine && 'w2-ge--spine', (hl.has(e.from) && hl.has(e.to) && (e.from === hover || e.to === hover)) && 'w2-ge--hl')}>
                <path className="w2-ge__hit" d={e.d} onClick={() => openPanel({ edge: e.key })} />
                <path className="w2-ge__line" d={e.d} markerEnd={edgeMarker(e)} />
              </g>
            ))}
            {linkPath && <path className="w2-ge--temp" d={linkPath} />}
          </svg>
          {G.order.map(k => nodeEl(G.nodes.get(k)!))}
          {G.edges.map(e => e.stale || e.broken
            ? <button key={`b${e.key}`} type="button" className={cn('w2-ge__badge', e.broken && 'w2-ge__badge--broken')} style={{ left: e.mx, top: e.my }}
                aria-label={t(e.broken ? 'graph.legend.broken' : 'graph.legend.stale')} title={t(e.broken ? 'graph.legend.broken' : 'graph.legend.stale')} onClick={() => openPanel({ edge: e.key })}>
                <Icon name={e.broken ? 'unlink' : 'circle-arrow-up'} size={12} />
              </button>
            : e.rel?.slot && (activeEdge === e.key || e.from === hover || e.to === hover)
              ? <span key={`l${e.key}`} className="w2-ge__label" style={{ left: e.mx, top: e.my }}>{e.rel.slot}</span>
              : null)}
        </div>
        <div className="w2-rg__legend w2-floating">
          {(['source', 'reference', 'uses', 'belongs', 'stale', 'broken'] as const).map(k => (
            <span key={k}><svg width="28" height="8"><path d="M0 4H24" className={`w2-lg w2-lg--${k}`} /></svg>{t(`graph.legend.${k}`)}</span>
          ))}
        </div>
        <div className="w2-rg__zoom w2-floating">
          <Btn size="sm" variant="ghost" iconOnly icon="minus" aria-label={t('graph.zoomOut')} onClick={() => zoomBy(1 / 1.2)} />
          <Num>{Math.round(view.z * 100)}%</Num>
          <Btn size="sm" variant="ghost" iconOnly icon="plus" aria-label={t('graph.zoomIn')} onClick={() => zoomBy(1.2)} />
          <Btn size="sm" variant="ghost" iconOnly icon="focus" aria-label={t('graph.fit')} title={t('graph.fit')} onClick={() => fit(true)} />
        </div>
        {sel.length > 0 && (
          <div className="w2-rg__selbar w2-floating">
            <span>{t('graph.selected', { n: sel.length })}</span>
            <Btn size="sm" variant="primary" icon="git-compare-arrows" disabled={sel.length !== 2} onClick={() => navigate(comparePath(lib, sel[0]!, sel[1]!))}>{t('graph.compare')}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setSel([])}>{t('w2.common.cancel')}</Btn>
          </div>
        )}
        {panel && (
          <aside className="w2-rg__panel" aria-label={t('graph.panel')}>
            <Btn size="sm" variant="ghost" iconOnly icon="x" className="w2-rg-p__x" aria-label={t('w2.common.close')} onClick={() => setPanel(null)} />
            {'rec' in panel
              ? <><h5><Icon name={panel.rec.method === 'ai-generate' ? 'sparkles' : 'activity'} />{t('rec.title')}</h5><ProvenanceBody lib={lib} rec={panel.rec} of={panel.of} names={names} onOpen={onOpenAsset} /></>
              : (() => { const e = G.edges.find(x => x.key === panel.edge); return e ? <EdgePanel key={e.key} lib={lib} edge={e} names={names} onOpen={onOpenAsset} onClose={() => setPanel(null)} /> : null })()}
          </aside>
        )}
        {menu && <PointMenu at={menu} items={menu.items} onClose={() => setMenu(null)} />}
      </div>
    </div>
  )
}
