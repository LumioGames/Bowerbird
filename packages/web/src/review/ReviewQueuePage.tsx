import * as React from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import type { AssetDetail, AssetSummary } from '@bowerbird/schema'
import { BowerbirdApiError } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t, useLocale } from '../lib/i18n'
import { useLibraryId } from '../lib/library'
import { isMac } from '../lib/platform'
import { dropUndo, pushUndo, type UndoEntry } from '../lib/undo'
import { Icon } from '../components/Icon'
import { PageFrame } from '../components/PageFrame'
import { EmptyState } from '../components/EmptyState'
import { AssetThumb } from '../components/AssetThumb'
import { StageMark } from '../components/marks'
import { toast } from '../overlays/toast'
import { openQuickLook } from '../overlays/quicklook'
import { useInspectorTarget } from '../shell/inspector-target'
import { Btn, Grow, KV, Kbd, Mono, Num, Skeleton, TextArea, Tag } from '../pages/shared/ui'
import { Menu, type MenuEntry } from '../pages/shared/menu'
import { errText, folderOf, who } from '../pages/shared/text'
import { overlayOpen, typing } from '../pages/shared/bridge'
import { useAsset, useFolders, useInvalidate, useLineage, useSearch, useVocabulary } from '../pages/shared/queries'
import { ViewerHost } from '../detail/ViewerHost'
import { comparePath } from '../detail/banners'
import { openAssetDetail } from '../detail/nav'
import { methodLabel } from '../graph/build'
import { nearestUpstream, previousVerdict, setVerdict } from './actions'
import { checkLabel, checkMessage } from './ReviewTab'
import { emptyTally, scopeFilter, splitQueue, type Scope, type Tally } from './queue'
import { guardedUndo } from '../pages/shared/undo'
import { formatName } from '../plugins/text'
import { usePluginRegistry } from '../plugins/registry'

/** Pending assets read per request, and how close to the end of them the next page is fetched. */
export const QUEUE_PAGE = 200
const QUEUE_AHEAD = 10

type Decision = 'approved' | 'rejected' | 'skipped'
interface Last { k: Decision; id: string; name: string; at: number; entry: UndoEntry }

/**
 * 校验队列 `/review` (pages.md): one at a time — viewer on the left (mode 'review'), upstream, provenance and AI tags on
 * the right; 通过 (⌘↵ / Ctrl+Enter), 打回 (comment required, ↵ sends from the comment box), 跳过 (→); moves on by
 * itself; each verdict carries the content hash it was made on and a verdict made meanwhile by someone else skips
 * the item with a toast (ADR-038); the last one can be undone; scope by folder or format; held-back assets with
 * reasons; round summary; nothing pending; loading; error with retry.
 */
export function ReviewQueuePage() {
  useLocale()
  const lib = useLibraryId()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const inv = useInvalidate(lib)
  const scope: Scope = { folder: params.get('folder') ?? undefined, format: params.get('format') ?? undefined }
  const scopeKey = `${scope.folder ?? ''}|${scope.format ?? ''}`
  const query = { filter: scopeFilter(scope), limit: QUEUE_PAGE, sort: 'modified' as const, order: 'asc' as const }
  const search = useSearch(lib, query)

  /* the queue is a snapshot: events refetch the search, but the order people are working through stays put. It is
     read a page at a time — the next page is fetched with the cursor before the reviewer reaches the end */
  const [snap, setSnap] = React.useState<{ key: string; queue: AssetSummary[]; held: ReturnType<typeof splitQueue>['held']; cursor: string | null; total: number } | null>(null)
  const [more, setMore] = React.useState(false)
  const [i, setI] = React.useState(0)
  const [tally, setTally] = React.useState<Tally>(emptyTally)
  const [last, setLast] = React.useState<Last | null>(null)
  const [rejecting, setRejecting] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [noteBad, setNoteBad] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (!search.data || snap?.key === scopeKey) return
    const s = splitQueue(search.data.items, params.get('start'))
    setSnap({ key: scopeKey, ...s, cursor: search.data.cursor ?? null, total: search.data.total }); setI(0); setTally(emptyTally()); setLast(null); setRejecting(false)
  }, [search.data, scopeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const queue = snap?.queue ?? []
  const held = snap?.held ?? []
  const cur = queue[i]
  /* close to the end of what is loaded: read the next page (same order) and append it */
  React.useEffect(() => {
    if (!snap?.cursor || more || i < snap.queue.length - QUEUE_AHEAD) return
    const key = snap.key, cursor = snap.cursor
    setMore(true)
    api.search(lib, { ...query, cursor })
      .then(r => setSnap(sn => {
        if (!sn || sn.key !== key || sn.cursor !== cursor) return sn
        const seen = new Set([...sn.queue, ...sn.held.map(h => h.asset)].map(a => a.id))
        const next = splitQueue(r.items.filter(a => !seen.has(a.id)), null)
        return { ...sn, queue: [...sn.queue, ...next.queue], held: [...sn.held, ...next.held], cursor: r.cursor ?? null }
      }))
      .catch(e => toast({ kind: 'error', title: errText(e) }))
      .finally(() => setMore(false))
  }, [snap, i, more]) // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useAsset(lib, cur?.id)
  useAsset(lib, queue[i + 1]?.id)   /* prefetch the next one */
  useInspectorTarget(cur ? { kind: 'assets', ids: [cur.id] } : { kind: 'none' }, [cur?.id])

  /* someone else reviewed it meanwhile (ADR-038): skip it and say so, before anyone spends time on it */
  const touched = React.useRef(new Set<string>())
  React.useEffect(() => {
    const d = detail.data
    if (!cur || !d || d.id !== cur.id || touched.current.has(d.id)) return
    if (d.review !== 'pending') { toast({ kind: 'info', title: t('rq.taken', { name: d.name }) }); setI(x => x + 1) }
  }, [detail.data, cur])

  const back = () => { if (location.key !== 'default') navigate(-1); else navigate(`/libraries/${encodeURIComponent(lib)}`) }

  const decide = async (k: Decision, text?: string) => {
    const a = detail.data
    if (!cur || busy) return
    const at = i
    touched.current.add(cur.id)
    if (k !== 'skipped') {
      if (!a) return
      setBusy(true)
      const prev = previousVerdict(a)
      try {
        await setVerdict(lib, a.id, k, text, a.hash)
      } catch (e) {
        setBusy(false)
        if (e instanceof BowerbirdApiError && e.code === 'conflict') {
          toast({ kind: 'info', title: t('rq.taken', { name: a.name }) })
          setRejecting(false); setNote(''); setI(x => x + 1)
          inv.asset(a.id)
          return
        }
        toast({ kind: 'error', title: errText(e) }); return
      }
      setBusy(false)
      inv.asset(a.id); inv.lib('search', 'info')
      const entry: UndoEntry = {
        label: t(`rq.done.${k}`, { name: a.name }),
        /* a failed undo says so and leaves the queue where it is */
        undo: guardedUndo(async () => {
          await setVerdict(lib, a.id, prev.status, prev.note)
          inv.asset(a.id); inv.lib('search', 'info')
          setTally(tl => ({ ...tl, [k]: tl[k].filter(x => x !== a.id) }))
          setI(at); setLast(l => (l?.id === a.id ? null : l))
        })
      }
      pushUndo(entry)
      setLast(l => { if (l) dropUndo(l.entry); return { k, id: a.id, name: a.name, at, entry } })
    } else {
      const entry: UndoEntry = { label: t('rq.done.skipped', { name: cur.name }), undo: () => { setTally(tl => ({ ...tl, skipped: tl.skipped.filter(x => x !== cur.id) })); setI(at); setLast(null) } }
      pushUndo(entry)
      setLast(l => { if (l) dropUndo(l.entry); return { k, id: cur.id, name: cur.name, at, entry } })
    }
    setTally(tl => ({ ...tl, [k]: [...tl[k], cur.id] }))
    setRejecting(false); setNote(''); setNoteBad(false)
    setI(x => x + 1)
  }
  const sendReject = () => { const v = note.trim(); if (!v) { setNoteBad(true); return } void decide('rejected', v) }
  const undoLastHere = async () => { if (!last) return; dropUndo(last.entry); await last.entry.undo() }
  const again = () => {
    const ids = new Set(tally.skipped)
    setSnap(s => s && { ...s, queue: s.queue.filter(a => ids.has(a.id)) })
    setI(0); setTally(emptyTally()); setLast(null)
  }

  const keyRef = React.useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (!cur || e.defaultPrevented || overlayOpen()) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && e.key === 'Enter' && !rejecting) { e.preventDefault(); void decide('approved'); return }
    if (typing(e)) return
    if (e.key === 'ArrowRight' && !mod && !e.altKey && !e.shiftKey) { e.preventDefault(); void decide('skipped') }
  }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const setScope = (s: Scope) => {
    const next = new URLSearchParams()
    if (s.folder) next.set('folder', s.folder)
    if (s.format) next.set('format', s.format)
    setParams(next, { replace: true })
  }

  const state = search.isPending || (!snap && !search.isError) ? 'loading' : search.isError ? 'error' : 'ready'
  /* while pages are still to come, count what the server says is pending (minus those held back so far) */
  const total = snap?.cursor ? Math.max(queue.length, snap.total - held.length) : queue.length
  return (
    <PageFrame
      title={t('rq.title')}
      onBack={back}
      state={state}
      onRetry={() => void search.refetch()}
      subtitle={<ScopeMenu lib={lib} scope={scope} onChange={setScope} />}
      actions={total > 0 ? <>
        <div className="w2-rq__prog" title={t('rq.left', { n: Math.max(0, total - i) })}><i style={{ width: `${(Math.min(i, total) / total) * 100}%` }} /></div>
        <Num>{Math.min(i + 1, total)} / {total}</Num>
      </> : undefined}
    >
      <div className="w2-rq">
        {!cur && snap?.cursor
          ? <Skeleton rows={3} />
          : cur
          ? <QueueItem lib={lib} item={cur} detail={detail.data} held={held} busy={busy}
              rejecting={rejecting} note={note} noteBad={noteBad} last={last}
              onNote={v => { setNote(v); setNoteBad(false) }}
              onApprove={() => void decide('approved')} onSkip={() => void decide('skipped')}
              onReject={() => { setRejecting(true); setNoteBad(false) }} onCancelReject={() => { setRejecting(false); setNote(''); setNoteBad(false) }}
              onSendReject={sendReject} onUndo={() => void undoLastHere()}
              onCompare={up => navigate(comparePath(lib, cur.id, up))}
              onOpen={id => openAssetDetail(navigate, lib, id)} />
          : <Finish total={total} tally={tally} held={held} onAgain={again} onHome={() => navigate(`/libraries/${encodeURIComponent(lib)}`)} onOpen={id => openAssetDetail(navigate, lib, id)} />}
      </div>
    </PageFrame>
  )
}

function ScopeMenu({ lib, scope, onChange }: { lib: string; scope: Scope; onChange(s: Scope): void }) {
  const vocab = useVocabulary(lib)
  const folders = useFolders(lib)
  const fmt = scope.format ? vocab.data?.formats.find(f => f.id === scope.format) : undefined
  const label = scope.folder ?? (scope.format ? t('rq.onlyFormat', { name: fmt ? formatName(fmt) : scope.format }) : t('rq.all'))
  const items = (): MenuEntry[] => {
    const out: MenuEntry[] = [{ label: t('rq.all'), check: !scope.folder && !scope.format, onSelect: () => onChange({}) }]
    const fs = (folders.data?.root.children ?? []).filter(f => f.count > 0)
    if (fs.length || scope.folder) {
      out.push({ kind: 'sep' }, { kind: 'label', label: t('rq.byFolder') })
      if (scope.folder && !fs.some(f => f.path === scope.folder)) out.push({ label: scope.folder, check: true, onSelect: () => onChange({ folder: scope.folder }) })
      for (const f of fs.slice(0, 12)) out.push({ icon: 'folder', label: f.label ? `${f.name} ${f.label}` : f.name, check: scope.folder === f.path, onSelect: () => onChange({ folder: f.path }) })
    }
    const fm = (vocab.data?.formats ?? []).filter(f => f.count > 0 && f.id !== 'unknown')
    if (fm.length) {
      out.push({ kind: 'sep' }, { kind: 'label', label: t('rq.byFormat') })
      for (const f of fm) out.push({ label: t('rq.onlyFormat', { name: formatName(f) }), check: scope.format === f.id, onSelect: () => onChange({ format: f.id }) })
    }
    return out
  }
  return <Menu trigger={<Btn size="sm" variant="ghost" icon="list-filter">{label}<Icon name="chevron-down" size={12} /></Btn>} items={items} />
}

function heldMenu(held: Array<{ asset: AssetSummary; why: string }>, onOpen: (id: string) => void): MenuEntry[] {
  return [{ kind: 'label', label: t('rq.heldTitle') }, ...held.map(h => ({ icon: 'file', label: h.asset.name, kbd: t(`rq.why.${h.why}`), onSelect: () => onOpen(h.asset.id) }))]
}

function QueueItem(p: {
  lib: string; item: AssetSummary; detail: AssetDetail | undefined; held: Array<{ asset: AssetSummary; why: string }>; busy: boolean
  rejecting: boolean; note: string; noteBad: boolean; last: Last | null
  onNote(v: string): void; onApprove(): void; onSkip(): void; onReject(): void; onCancelReject(): void; onSendReject(): void; onUndo(): void
  onCompare(up: string): void; onOpen(id: string): void
}) {
  const a = p.detail
  const reg = usePluginRegistry()
  const up = useLineage(p.lib, p.item.id, { direction: 'up', types: ['source', 'reference'], depth: 4 })
  const near = nearestUpstream(up.data)
  const inv = useInvalidate(p.lib)
  const noteRef = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => { if (p.rejecting) noteRef.current?.focus() }, [p.rejecting])
  const ups = React.useMemo(() => {
    if (!up.data) return []
    const byId = new Map(up.data.nodes.map(n => [n.id, n]))
    const out: Array<{ a: AssetSummary; sub: string }> = []
    const seen = new Set([p.item.id])
    let frontier = [p.item.id]
    while (frontier.length && out.length < 4) {
      const next: string[] = []
      for (const id of frontier) for (const e of up.data.edges) {
        if ((e.type !== 'source' && e.type !== 'reference') || e.from !== id || seen.has(e.to)) continue
        seen.add(e.to)
        const n = byId.get(e.to)
        if (!n) continue
        /* how the one made from it was made (its provenance, ADR-070), else the relation's type */
        const prov = up.data.provenance[e.from]
        out.push({ a: n, sub: prov ? `${methodLabel(prov.method, t)} · ${prov.by}` : t(e.type === 'reference' ? 'w2.rel.type.reference' : 'w2.rel.type.source') })
        next.push(n.id)
      }
      frontier = next
    }
    for (const r of a?.relations.outgoing ?? []) if (r.type === 'belongs' && r.target && !seen.has(r.target.id)) out.push({ a: r.target, sub: t('rel.designObject') })
    return out
  }, [up.data, a, p.item.id])
  const tags = async (op: 'accept' | 'dismiss', list: string[]) => {
    if (!a) return
    try { await (op === 'accept' ? api.assets.acceptTags(p.lib, a.id, list) : api.assets.dismissTags(p.lib, a.id, list)); inv.asset(a.id); inv.lib('tags') }
    catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const peek = (id: string, el: HTMLElement | null) => openQuickLook({ ids: [id], index: 0, origin: el })
  const checks = a?.checks ?? []
  const rec = a?.provenance
  const aiTags = a?.autoTags ?? p.item.autoTags
  return (
    <>
      <div className="w2-rq__main">
        <div className="w2-rq__head">
          <b>{p.item.name}</b>
          <StageMark stage={p.item.stage} size="sm" label="short" />
          <span className="w2-rq__path">{folderOf(p.item.path)}</span>
          <Grow />
          {p.held.length > 0 && <Menu trigger={<button type="button" className="w2-rq__held"><Icon name="clock" size={12} />{t('rq.held', { n: p.held.length })}</button>} items={() => heldMenu(p.held, p.onOpen)} align="end" />}
        </div>
        <div className="w2-rq__view" key={p.item.id}>{a ? <ViewerHost lib={p.lib} asset={a} mode="review" /> : null}</div>
        {checks.length > 0 && (
          <div className="w2-rq__checks">
            {checks.map((c, k) => <span key={k} className={c.verdict === 'pass' ? 'w2-rq__ck' : 'w2-rq__ck bad'} title={checkMessage(c, reg)}><Icon name={c.verdict === 'pass' ? 'check' : 'x'} size={12} />{checkLabel(c, reg)}<small>{checkMessage(c, reg)}</small></span>)}
          </div>
        )}
        <div className="w2-rq__act">
          {p.rejecting ? <>
            <TextArea ref={noteRef} wrapClassName="w2-rq__note" rows={2} value={p.note} invalid={p.noteBad} placeholder={t('rev.notePh')} aria-label={t('rev.noteLabel')}
              onChange={e => p.onNote(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); p.onSendReject() }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onCancelReject() }
              }} />
            <Btn onClick={p.onCancelReject}>{t('w2.common.cancel')} <Kbd>Esc</Kbd></Btn>
            <Btn variant="danger" icon="undo-2" disabled={p.busy} onClick={p.onSendReject}>{t('rev.reject')} <Kbd>↵</Kbd></Btn>
          </> : <>
            {p.last && (
              <span className="w2-rq__last">
                <Icon name={p.last.k === 'approved' ? 'check' : p.last.k === 'rejected' ? 'undo-2' : 'skip-forward'} size={12} />
                {t(`rq.done.${p.last.k}`, { name: p.last.name })}
                <Btn size="sm" variant="ghost" onClick={p.onUndo}>{t('w2.common.undo')} <Kbd>{isMac ? '⌘Z' : 'Ctrl+Z'}</Kbd></Btn>
              </span>
            )}
            <Grow />
            <Btn icon="undo-2" onClick={p.onReject}>{t('rev.rejectMore')}</Btn>
            <Btn icon="skip-forward" onClick={p.onSkip}>{t('rq.skip')} <Kbd>→</Kbd></Btn>
            <Btn variant="primary" icon="check" data-onboard="queue.pass" disabled={p.busy || !a} onClick={p.onApprove}>{t('rev.approve')} <Kbd>{isMac ? '⌘↵' : 'Ctrl+Enter'}</Kbd></Btn>
          </>}
        </div>
      </div>
      <aside className="w2-rq__side">
        {rec && (
          <section>
            <h5><Icon name={rec.method === 'ai-generate' ? 'sparkles' : 'activity'} size={12} />{t('rec.title')}</h5>
            <KV rows={[[t('w2.rec.method'), methodLabel(rec.method, t)], [t('w2.rec.by'), <Mono>{who(rec.by)}</Mono>]]} />
            {rec.prompt && <pre className="w2-prompt">{rec.prompt}</pre>}
          </section>
        )}
        {aiTags.length > 0 && (
          <section>
            <h5><Icon name="sparkles" size={12} />{t('rq.aiTags')} <span className="w2-rq__n">{aiTags.length}</span><Grow /><Btn size="sm" variant="ghost" onClick={() => void tags('accept', aiTags)}>{t('rq.adoptAll')}</Btn></h5>
            <div className="w2-tags">
              {aiTags.map(x => (
                <Tag key={x} ai>{x}
                  <button type="button" aria-label={t('rq.adopt', { tag: x })} title={t('rq.adoptTip')} onClick={() => void tags('accept', [x])}><Icon name="check" size={12} /></button>
                  <button type="button" aria-label={t('rq.drop', { tag: x })} title={t('rq.dropTip')} onClick={() => void tags('dismiss', [x])}><Icon name="x" size={12} /></button>
                </Tag>
              ))}
            </div>
            {(a?.tags ?? p.item.tags).length > 0 && <div className="w2-tags w2-rq__tags--own">{(a?.tags ?? p.item.tags).map(x => <Tag key={x}>{x}</Tag>)}</div>}
          </section>
        )}
        <section>
          <h5><Icon name="git-fork" size={12} />{t('rq.upstream')}<Grow />{near && <Btn size="sm" icon="git-compare-arrows" onClick={() => p.onCompare(near)}>{t('rev.compareUp')}</Btn>}</h5>
          {ups.length
            ? <div className="w2-rq__ups">{ups.map(u => (
                <button key={u.a.id} type="button" className="w2-row" title={t('rq.peek')} onClick={e => peek(u.a.id, (e.currentTarget as HTMLElement).querySelector('.w2-thumb'))}>
                  <span className="w2-thumb"><AssetThumb asset={u.a} size={32} fit="cover" /></span>
                  <span><b>{u.a.name}</b><small>{u.sub}</small></span>
                </button>
              ))}</div>
            : <p className="w2-rq__none">{up.isPending ? '…' : t('rq.noUpstream')}</p>}
        </section>
      </aside>
    </>
  )
}

function Finish({ total, tally, held, onAgain, onHome, onOpen }: { total: number; tally: Tally; held: Array<{ asset: AssetSummary; why: string }>; onAgain(): void; onHome(): void; onOpen(id: string): void }) {
  const sk = tally.skipped.length
  const none = total === 0
  return (
    <div className="w2-rq__end">
      <EmptyState icon="badge-check" title={none ? t('rq.noneTitle') : t('rq.endTitle')}
        body={none ? t('rq.noneText') : t('rq.endText', { a: tally.approved.length, r: tally.rejected.length, s: sk })}
        action={<>
          {sk > 0 && <Btn icon="skip-forward" onClick={onAgain}>{t('rq.again', { s: sk })}</Btn>}
          <Btn variant="primary" onClick={onHome}>{t('rq.home')}</Btn>
        </>} />
      {held.length > 0 && (
        <div className="w2-rq__heldlist">
          <h5>{t('rq.heldTitle')}</h5>
          {held.map(h => (
            <button key={h.asset.id} type="button" className="w2-row" onClick={() => onOpen(h.asset.id)}>
              <span className="w2-thumb"><AssetThumb asset={h.asset} size={32} fit="cover" /></span>
              <span><b>{h.asset.name}</b></span><span className="w2-num">{t(`rq.why.${h.why}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
