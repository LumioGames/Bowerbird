import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { STAGES, REVIEW_STATUSES, type AssetDetail, type AssetSummary, type RelationView, type ViewName } from '@bowerbird/schema'
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Textarea } from '@bowerbird/plugin-sdk/web'
import { AssetThumb, DocCard } from '../components/AssetThumb'
import { CopyText, FilterChip, Kv, Row, Section, TagChip, TagInput } from '../components/blocks'
import { Icon } from '../components/Icon'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { getLocale, t } from '../lib/i18n'
import { fmtActor, fmtDateTime, fmtRelative, fmtSize } from '../lib/format'
import { kbd } from '../lib/platform'
import { paramsText } from '../lib/params'
import { MenuEntries } from '../overlays/menu'
import { toast, toastError } from '../overlays/toast'
import { usePluginRegistry, PluginSlot } from '../plugins/registry'
import { libPath, rt } from '../shell/runtime'
import { openRelationDialog } from '../graph/RelationDialog'
import * as A from '../flows/actions'
import { IssueBanners, VerdictLine } from './IssueBanners'
import { pluginText } from '../plugins/text'

/**
 * One asset in the inspector, top to bottom (web-shell.md 检查器 table, pages.md): thumbnail (click → quick look),
 * name (edited in place), issue banner, 基本, 描述, 包内文件, 标签, 阶段与校验 (latest verdict: who, when, comment),
 * 技术信息 (a turnaround's grid:「格子：2 行 2 列 · 正面 侧面 / 背面 顶面」), 关系, 生产记录, 版本, plugin sections.
 */
export function SingleInspector({ asset: a }: { asset: AssetDetail }) {
  const reg = usePluginRegistry()
  const pluginSections = reg.ui.inspectorSections.filter(s => { try { return !s.appliesTo || s.appliesTo(a) } catch { return false } })
  const fv = reg.formatView(a.format)
  return (
    <>
      <button type="button" onClick={e => A.quickLook([a.id], 0, e.currentTarget)} aria-label={t('act.quicklook')}
        className="mx-4 mt-4 mb-3 block aspect-[16/10] w-[calc(100%-32px)] cursor-default overflow-hidden rounded-md border-0 bg-surface-well p-0">
        {a.cellText && !a.thumbnail ? <DocCard title={a.cellText.title ?? a.name} excerpt={a.cellText.excerpt} /> : <AssetThumb asset={a} />}
      </button>
      <NameEdit asset={a} />
      <IssueBanners asset={a} />
      <Section title={t('insp.basic')} id="insp.basic">
        <Kv rows={[
          [t('insp.path'), <CopyText text={a.path} />],
          [t('insp.guid'), <CopyText text={a.id} />],
          [t('insp.size'), fmtSize(a.size)],
          [t('insp.modified'), <>{fmtRelative(a.modified)} · <span className="font-mono text-[11px]">{fmtActor(a.modifiedBy ?? a.createdBy)}</span></>]
        ]} />
      </Section>
      <Section title={t('insp.desc')} id="insp.desc"><Description asset={a} /></Section>
      {a.bundleFiles && (
        <Section title={t('insp.bundle')} count={a.bundleFiles.length} id="insp.bundle">
          <div className="grid gap-px">
            {a.bundleFiles.map(f => (
              <div key={f.path} className="flex min-h-[26px] items-center gap-1.5">
                <Icon name="file" size={12} className="shrink-0 text-ink-3" />
                <span className="truncate font-mono text-[11px]">{f.path}</span>
                {f.entry && <span className="ml-1 inline-flex h-[18px] items-center rounded-full bg-fill-rest px-1.5 text-[11px]">{t('insp.entry')}</span>}
                <small className="ml-auto shrink-0 text-[11px] text-ink-3">{fmtSize(f.size)}</small>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title={t('insp.tags')} id="insp.tags">
        <div className="flex flex-wrap gap-1">
          {a.tags.map(tg => <TagChip key={tg} text={tg} onRemove={() => void A.editTags([a.id], { remove: [tg] })} />)}
          {a.autoTags.filter(x => !a.tags.includes(x)).map(tg => (
            <TagChip key={'ai:' + tg} text={tg} ai onAdopt={() => void A.acceptAiTags(a.id, [tg])} onRemove={() => void A.dismissAiTags(a.id, [tg])} />
          ))}
          <TagInput placeholder={t('insp.addTag')} onAdd={v => void A.editTags([a.id], { add: [v] })} />
        </div>
      </Section>
      <Section title={t('insp.stageReview')} id="insp.stage">
        <Kv rows={[
          [t('insp.stage'), <StageChips value={a.stage} onPick={s => void A.setStage([a.id], s)} />],
          [t('insp.review'), <ReviewSelect value={a.review} onPick={r => void A.setReview([a.id], r)} />],
          a.reviewVerdict && (a.reviewVerdict.by || a.reviewVerdict.at) ? ['', <VerdictLine by={a.reviewVerdict.by} at={a.reviewVerdict.at} />] : null,
          a.reviewVerdict?.note ? [t('insp.verdictNote'), <span className={cn('whitespace-normal', a.reviewVerdict.status === 'rejected' ? 'text-danger-ink' : 'text-ink-2')}>{a.reviewVerdict.note}</span>] : null
        ]} />
      </Section>
      <TechSection asset={a} labels={fv?.view.techLabels} rows={fv?.view.techRows?.bind(fv.view)} by={a.plugin ?? undefined} />
      <Relations asset={a} />
      {a.record && <RecordSection asset={a} />}
      {a.versions.length > 0 && (
        <Section title={t('insp.versions')} count={a.versions.length} defaultCollapsed id="insp.versions">
          {a.versions.map((v, i) => ({ v, n: i + 1 })).reverse().map(({ v, n }) => (
            <div key={v.hash + n} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1 text-[12px] text-ink-2">
              <b className="truncate font-normal text-ink-1">v{n}{v.note ? ` · ${v.note}` : ''}</b>
              <span>{fmtSize(v.size)}</span>
              <span className="col-span-2">{fmtDateTime(v.at)} · <span className="font-mono text-[11px]">{fmtActor(v.by)}</span></span>
            </div>
          ))}
        </Section>
      )}
      {pluginSections.map(s => (
        <Section key={s.pluginId + s.id} title={s.title} by={s.pluginId} id={`plugin.${s.pluginId}.${s.id}`}>
          <PluginSlot pluginId={s.pluginId} component={s.Component} props={{ asset: a }} />
        </Section>
      ))}
    </>
  )
}

/** The name, edited in place (Enter saves, Esc cancels). Also answers「改名」from menus when no grid cell does. */
function NameEdit({ asset: a }: { asset: AssetDetail }) {
  const [editing, setEditing] = React.useState(false)
  const [v, setV] = React.useState(a.name)
  React.useEffect(() => { setV(a.name); setEditing(false) }, [a.id, a.name])
  React.useEffect(() => A.onRenameRequest(id => { if (id !== a.id) return false; setEditing(true); return true }), [a.id])
  const ref = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => { if (editing) { const i = a.name.lastIndexOf('.'); ref.current?.focus(); ref.current?.setSelectionRange(0, i > 0 ? i : a.name.length) } }, [editing, a.name])
  const done = async (save: boolean) => { setEditing(false); if (save && v.trim() && v.trim() !== a.name) { if (!(await A.renameAsset(a.id, v.trim()))) setV(a.name) } else setV(a.name) }
  if (editing) {
    return (
      <div className="px-4 pb-3">
        <input ref={ref} value={v} aria-label={t('insp.name')} onChange={e => setV(e.target.value)} onBlur={() => void done(true)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') void done(true); if (e.key === 'Escape') void done(false) }}
          className="h-7 w-full rounded-xs border-0 bg-surface-well px-1 text-[15px] leading-5 font-semibold text-ink-1 outline-2 outline-accent-ring" />
      </div>
    )
  }
  return (
    <div className="px-4 pb-3 text-[15px] leading-5 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]" onDoubleClick={() => setEditing(true)} title={t('act.rename')}>
      {a.name}
    </div>
  )
}

/** F-08: the human description (click to edit, ⌘↵ saves, Esc cancels); the AI one in a secondary style,「采用」. */
function Description({ asset: a }: { asset: AssetDetail }) {
  const human = a.descriptionFull ?? ''
  const ai = a.auto?.description ?? ''
  const [editing, setEditing] = React.useState(false)
  const [v, setV] = React.useState(human)
  React.useEffect(() => { setV(human); setEditing(false) }, [a.id, human])
  const save = (keep: boolean) => { setEditing(false); if (keep && v.trim() !== human) void A.setDescription(a.id, v.trim(), human); else setV(human) }
  if (editing) {
    return (
      <div className="grid gap-2">
        <Textarea autoFocus rows={3} value={v} placeholder={t('insp.descPh')} aria-label={t('insp.desc')} onChange={e => setV(e.target.value)} onBlur={() => save(true)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(true) } if (e.key === 'Escape') { e.preventDefault(); save(false) } }} />
        <p className="m-0 text-[11px] text-ink-3">{t('insp.descHint', { save: kbd('mod+enter') })}</p>
      </div>
    )
  }
  return (
    <div className="grid gap-2">
      {human
        ? <p tabIndex={0} title={t('insp.descEdit')} onClick={() => setEditing(true)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true) } }}
            className="m-0 -mx-1.5 cursor-text rounded-sm px-1.5 py-1 leading-[19px] text-ink-1 hover:bg-fill-hover">{human}</p>
        : <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setEditing(true)}><Icon name="plus" size={12} />{t('insp.writeDesc')}</Button>}
      {ai && (
        <p className={cn('m-0 flex items-start gap-1.5 text-[12px] leading-[18px]', human ? 'text-ink-3' : 'text-ink-2')}>
          <Icon name="sparkles" size={12} className="mt-[3px] shrink-0 text-ink-3" />
          <span className="flex-1">{ai}</span>
          {!human && <Button variant="ghost" size="sm" onClick={() => void A.setDescription(a.id, ai, '', { title: t('insp.descAdopted') })}>{t('insp.adopt')}</Button>}
        </p>
      )}
    </div>
  )
}

export function StageChips({ value, onPick }: { value: string | null; onPick: (s: (typeof STAGES)[number]) => void }) {
  return <div className="flex gap-1">{STAGES.map(s => <FilterChip key={s} pressed={value === s} onClick={() => onPick(s)}><StageMark stage={s} label="short" /></FilterChip>)}</div>
}

export function ReviewSelect({ value, onPick }: { value: (typeof REVIEW_STATUSES)[number] | null; onPick: (r: (typeof REVIEW_STATUSES)[number]) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button className="pr-2 pl-3">{value ? <ReviewMark review={value} label /> : t('common.mixed')}<Icon name="chevron-down" size={12} className="text-ink-2" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <MenuEntries kind="dropdown" close={() => {}} entries={REVIEW_STATUSES.map(r => ({ id: r, label: <ReviewMark review={r} label />, check: value === r, onSelect: () => onPick(r) }))} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const VIEW_KEY: Record<ViewName, string> = { front: 'view3.front', side: 'view3.side', back: 'view3.back', top: 'view3.top' }

/** 格子：{rows} 行 {cols} 列 · 正面 侧面 / 背面 顶面 (ADR-019; read-only, declared by whoever made the sheet). */
export function gridText(g: { rows: number; cols: number; cells: Array<ViewName | null> }): string {
  const rows: string[] = []
  for (let r = 0; r < g.rows; r++) rows.push(g.cells.slice(r * g.cols, r * g.cols + g.cols).map(c => (c ? t(VIEW_KEY[c]) : '—')).join(' '))
  return t('insp.gridValue', { rows: g.rows, cols: g.cols, cells: rows.join(' / ') })
}

function TechSection({ asset: a, labels, rows: rowsOf, by }: {
  asset: AssetDetail; labels?: Record<string, string>; rows?: (asset: AssetDetail, locale: ReturnType<typeof getLocale>) => Array<[string, string]> | null; by?: string
}) {
  const entries = Object.entries(a.tech)
  if (!entries.length && !a.views && !a.targetSize) return null
  const fmt = (v: number | string | boolean) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v))
  const keys = labels ? [...Object.keys(labels).filter(k => k in a.tech), ...entries.map(([k]) => k).filter(k => !(k in labels))] : entries.map(([k]) => k)
  // the format plugin may summarise its tech info itself (FormatView.techRows); a failing hook falls back to the keys
  let custom: Array<[string, string]> | null = null
  try { custom = rowsOf?.(a, getLocale()) ?? null } catch { custom = null }
  return (
    <Section title={t('insp.tech')} by={by} id="insp.tech">
      <Kv rows={[
        ...(custom ?? keys.map(k => [labels?.[k] ?? (t('tech.' + k) === 'tech.' + k ? k : t('tech.' + k)), fmt(a.tech[k]!)] as [string, string])),
        a.views ? [t('insp.grid'), gridText(a.views)] : null,
        a.targetSize ? [t('insp.targetSize'), `${a.targetSize.w} × ${a.targetSize.h} × ${a.targetSize.d} m`] : null
      ]} />
    </Section>
  )
}

/* ── relations, as lists: each group folds, each row jumps to the other asset or drops the relation ── */
type Group = 'up' | 'down' | 'uses' | 'usedBy' | 'belongs' | 'members' | string
const groupOpen = new Map<string, boolean>()

function groupOf(r: RelationView, outgoing: boolean): Group {
  if (r.type === 'source') return outgoing ? 'up' : 'down'
  if (r.type === 'uses') return outgoing ? 'uses' : 'usedBy'
  if (r.type === 'belongs') return outgoing ? 'belongs' : 'members'
  return (outgoing ? 'out:' : 'in:') + r.type
}

function Relations({ asset: a }: { asset: AssetDetail }) {
  const { lib, qc, go } = rt()
  const vocab = useQuery({ queryKey: qk.vocabulary(lib), queryFn: () => api.libraries.vocabulary(lib), staleTime: 60_000 })
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  const groups = new Map<Group, Array<{ r: RelationView; out: boolean }>>()
  for (const r of a.relations.outgoing) { const g = groupOf(r, true); groups.set(g, [...(groups.get(g) ?? []), { r, out: true }]) }
  for (const r of a.relations.incoming) { const g = groupOf(r, false); groups.set(g, [...(groups.get(g) ?? []), { r, out: false }]) }
  const order: Group[] = ['up', 'down', 'uses', 'usedBy', 'belongs', 'members', ...[...groups.keys()].filter(k => k.includes(':'))]
  const title = (g: Group) => {
    if (!g.includes(':')) return t('relg.' + g)
    const [dir, type] = g.split(':') as [string, string]
    const rt2 = vocab.data?.relationTypes.find(x => x.id === type)
    return rt2 ? pluginText(rt2.plugin, dir === 'out' ? rt2.name : rt2.inverseName) : type
  }
  const count = a.relations.outgoing.length + a.relations.incoming.length
  const remove = async (r: RelationView, out: boolean) => {
    const owner = out ? a.id : r.from
    const ref = { type: r.type, to: out ? r.to : a.id, ...(r.slot ? { slot: r.slot } : {}) }
    try {
      const fresh = await api.relations.remove(lib, owner, ref)
      if (out) qc.setQueryData(qk.asset(lib, a.id), fresh); else void qc.invalidateQueries({ queryKey: qk.asset(lib, a.id) })
      void qc.invalidateQueries({ queryKey: qk.asset(lib, out ? r.to : r.from) })
      toast({ title: t('rel.deleted'), undo: async () => { await api.relations.add(lib, owner, { ...ref, ...(r.note ? { note: r.note } : {}), ...(r.record ? { record: r.record } : {}) }).catch(toastError); void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset'] }) } })
    } catch (e) { toastError(e) }
  }
  const goTo = (other: AssetSummary) => {
    const onDetail = /\/asset\//.test(location.pathname)
    if (onDetail) { A.openAsset(other.id); return }
    const folder = other.path.slice(0, Math.max(0, other.path.length - other.name.length - 1))
    go(libPath(lib, `?folder=${encodeURIComponent(folder)}&select=${encodeURIComponent(other.id)}`))
  }
  return (
    <Section title={t('insp.relations')} count={count} defaultCollapsed={!count} id="insp.relations">
      <div className="-mx-2">
        {order.filter(g => groups.has(g)).map(g => {
          const list = groups.get(g)!
          const shut = groupOpen.get(g) === false
          return (
            <div key={g} className="[&+&]:mt-1">
              <button type="button" onClick={() => { groupOpen.set(g, shut); force() }}
                className="flex h-6 w-full cursor-default items-center gap-1 rounded-xs border-0 bg-transparent px-2 text-[11px] leading-[14px] font-semibold tracking-[0.04em] text-ink-3 hover:text-ink-2">
                <Icon name="chevron-right" size={12} className={cn('transition-transform duration-snappy ease-settle', !shut && 'rotate-90')} />{title(g)}<span className="ml-0.5 font-normal">{list.length}</span>
              </button>
              {!shut && list.map(({ r, out }, i) => {
                const other = r.target
                const del = (
                  <button type="button" aria-label={t('insp.relDelete')} title={t('insp.relDelete')} onClick={e => { e.stopPropagation(); void remove(r, out) }}
                    className="grid size-5 shrink-0 cursor-default place-items-center rounded-xs border-0 bg-transparent p-0 text-ink-2 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-fill-hover hover:text-ink-1 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent-ring">
                    <Icon name="x" size={12} />
                  </button>
                )
                if (!other) {
                  const openRel = () => go(libPath(lib, `/asset/${encodeURIComponent(a.id)}?tab=rel&relType=${encodeURIComponent(r.type)}&relTo=${encodeURIComponent(r.to)}${r.slot ? `&relSlot=${encodeURIComponent(r.slot)}` : ''}`))
                  return (
                    <Row key={i} className="cursor-pointer" thumb={<span className="grid size-full place-items-center bg-danger-soft text-danger-ink"><Icon name="file-question" /></span>}
                      label={<RowLink onClick={openRel}><span className="text-ink-2 line-through">{r.targetName ?? r.to}</span></RowLink>} sub={<span className="no-underline">{t('insp.relGone')}</span>} subBlock
                      trailing={<><IssueMark level="error" flags={['broken']} corner={false} />{del}</>}
                      onClick={openRel} />
                  )
                }
                return (
                  <Row key={i} thumb={<AssetThumb asset={other} fit="cover" />} label={<RowLink onClick={() => goTo(other)}>{other.name}</RowLink>} sub={<RelSub lib={lib} asset={a} r={r} out={out} />} subBlock onClick={() => goTo(other)}
                    trailing={<>
                      {r.stale ? <IssueMark level="warning" flags={['stale']} corner={false} /> : out && other.issueLevel ? <IssueMark level={other.issueLevel} flags={other.flags} corner={false} /> : null}
                      <StageMark stage={other.stage} /><ReviewMark review={other.review} />{del}
                    </>} />
                )
              })}
            </div>
          )
        })}
      </div>
      <Button variant="ghost" size="sm" className="mt-1 ml-1 justify-self-start" onClick={() => void openRelationDialog(lib, a)}><Icon name="plus" size={12} />{t('insp.relNew')}</Button>
    </Section>
  )
}

/**
 * A relation row's second line (prototype data.js noteOf): a source relation says how the downstream one was made and
 * by whom (「导出 · user:lin」, from its production record), else「来源」; a uses relation its note and the slot written
 * in the file (「基础色 · chest_basecolor.png」), else「引用」; belongs says「设计对象」going out and「归属」coming in.
 */
function RelSub({ lib, asset: a, r, out }: { lib: string; asset: AssetDetail; r: RelationView; out: boolean }) {
  const own = r.record && a.record?.id === r.record ? a.record : null
  const rec = useQuery({ queryKey: qk.record(lib, r.record ?? ''), queryFn: () => api.records.get(lib, r.record!), enabled: r.type === 'source' && !!r.record && !own, staleTime: 60_000 })
  if (r.type === 'source') {
    const record = own ?? rec.data?.record
    if (record) return <>{methodName(record.method)} · {fmtActor(record.by)}</>
    return r.record && rec.isPending ? null : <>{t('rel.type.source')}</>
  }
  if (r.type === 'uses') return <>{r.note || t('rel.type.uses')}{r.slot ? ` · ${r.slot}` : ''}</>
  if (r.type === 'belongs') return <>{t(out ? 'rel.designObject' : 'rel.belongsIn')}</>
  return r.note ? <>{r.note}</> : null
}

/** A production method's name:「导出」for the built-in ones, the method id as written for a plugin's own. */
function methodName(m: string): string { return t('method.' + m) === 'method.' + m ? m : t('method.' + m) }

/** The keyboard way into a clickable row: its name is a button (the row's click stays for the mouse). */
function RowLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick() }}
      className="max-w-full cursor-default truncate rounded-xs border-0 bg-transparent p-0 text-left text-inherit outline-none focus-visible:outline-2 focus-visible:outline-accent-ring">
      {children}
    </button>
  )
}

function RecordSection({ asset: a }: { asset: AssetDetail }) {
  const { lib, qc } = rt()
  const r = a.record!
  const [note, setNote] = React.useState('')
  const methodText = r.plugin || r.method.includes('/') ? <span className="font-mono text-[11px]">{r.method}</span> : methodName(r.method)
  const nameOf = (id: string) => a.relations.outgoing.find(x => x.to === id)?.target?.name ?? a.relations.outgoing.find(x => x.to === id)?.targetName ?? id.slice(-8)
  const params = paramsText(r.method, r.params)
  const add = async () => {
    if (!note.trim()) return
    try { await api.records.addNote(lib, r.id, note.trim()); setNote(''); void qc.invalidateQueries({ queryKey: qk.asset(lib, a.id) }); toast({ title: t('rec.noteAdded') }) } catch (e) { toastError(e) }
  }
  return (
    <Section title={t('insp.record')} id="insp.record">
      <Kv rows={[
        [t('rec.method'), methodText],
        r.tool ? [t('rec.tool'), r.tool] : null,
        r.plugin ? [t('rec.plugin'), <span className="font-mono text-[11px]">{r.plugin}</span>] : null,
        [t('rec.by'), <span className="font-mono text-[11px]">{fmtActor(r.by)}</span>],
        params ? [t('rec.params'), params] : null,
        ...(r.inputs ?? []).map(x => [x.role ?? '—', <span className="font-mono text-[11px]">{nameOf(x.id)}</span>] as [string, React.ReactNode])
      ]} />
      {r.prompt && <pre className="m-0 cursor-text rounded-sm bg-surface-well p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-ink-2 select-text">{r.prompt}</pre>}
      {(r.notes ?? []).map((n, i) => (
        <p key={i} className="m-0 text-[12px] text-ink-2"><span className="font-mono text-[11px]">{fmtActor(n.by)}</span> · {fmtDateTime(n.at)}<br /><span className="text-ink-1">{n.text}</span></p>
      ))}
      <div className="flex items-center gap-1">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('rec.notePh')} aria-label={t('rec.addNote')}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') void add() }}
          className="h-[22px] min-w-0 flex-1 border-0 bg-transparent px-1 text-[12px] text-ink-1 outline-none placeholder:text-ink-3" />
        {note.trim() && <Button size="sm" onClick={() => void add()}>{t('rec.addNote')}</Button>}
      </div>
    </Section>
  )
}
