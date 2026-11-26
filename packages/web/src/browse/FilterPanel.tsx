import * as React from 'react'
import { STAGES, REVIEW_STATUSES, type Comparison, type FacetCount, type Filter, type Vocabulary, type WhenValue } from '@bowerbird/schema'
import { Button, Switch } from '@bowerbird/plugin-sdk/web'
import { FilterChip, TagChip, TagInput } from '../components/blocks'
import { Icon, kindIcon } from '../components/Icon'
import { ReviewMark, StageMark } from '../components/marks'
import { t } from '../lib/i18n'
import { fmtInt } from '../lib/format'
import { whenFilter, type BrowseState, type Extras } from './query'
import { formatName } from '../plugins/text'

/**
 * The filter panel (pages.md 浏览页「筛选」, F-04): the same conditions as the search box, as controls.
 * Stage, format and review show how many results each would give (facets). Issue types, belongs to, production
 * method, modified / created time (ADR-034), tags with include / exclude, human tags only, triangles, duration,
 * width, height, auxiliary files. Saves as a smart folder; while editing one, also「保存到「…」」.
 */
export interface FilterPanelProps {
  state: BrowseState
  onChange: (patch: { filter: Filter; extras?: Extras; tagMode?: 'all' | 'any' }) => void
  facets?: { format: FacetCount[]; stage: FacetCount[]; review: FacetCount[]; tags: FacetCount[] }
  vocabulary?: Vocabulary | null
  total: number | null
  onClear: () => void
  onSaveSmart: () => void
  onSaveEdit?: () => void
}

const count = (list: FacetCount[] | undefined, v: string) => (list ? list.find(f => f.value === v)?.count ?? 0 : null)
function toggle<T>(arr: T[] | undefined, v: T): T[] | undefined { const has = arr?.includes(v); const out = has ? arr!.filter(x => x !== v) : [...(arr ?? []), v]; return out.length ? out : undefined }
function clean(f: Filter): Filter { const out = { ...f }; for (const k of Object.keys(out) as Array<keyof Filter>) if (out[k] === undefined) delete out[k]; return out }

function H({ children }: { children: React.ReactNode }) { return <h5 className="m-0 mb-1.5 text-[11px] leading-[14px] font-semibold tracking-[0.04em] text-ink-3">{children}</h5> }

function Range({ label, k, unit, filter, onChange }: { label: string; k: string; unit: string; filter: Filter; onChange: (f: Filter) => void }) {
  const c = filter.tech?.[k] ?? {}
  const lo = c.gte ?? c.gt, hi = c.lte ?? c.lt
  const set = (which: 'gte' | 'lte', raw: string) => {
    const v = raw.trim() === '' || Number.isNaN(Number(raw)) ? undefined : Number(raw)
    const next: Comparison = { ...c }
    if (which === 'gte') { delete next.gt; if (v == null) delete next.gte; else next.gte = v } else { delete next.lt; if (v == null) delete next.lte; else next.lte = v }
    const tech = { ...(filter.tech ?? {}) }
    if (Object.keys(next).length) tech[k] = next; else delete tech[k]
    onChange(clean({ ...filter, tech: Object.keys(tech).length ? tech : undefined }))
  }
  const box = (which: 'gte' | 'lte', v: number | undefined, ph: string) => (
    <input key={which + String(v)} defaultValue={v ?? ''} inputMode="numeric" placeholder={ph} aria-label={`${label}${ph}`}
      onBlur={e => set(which, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="h-[22px] w-14 shrink-0 rounded-xs border-0 bg-fill-rest px-1.5 text-[12px] text-ink-1 outline-none hover:bg-fill-hover focus:outline-2 focus:outline-accent-ring placeholder:text-ink-3" />
  )
  return (
    <div>
      <H>{label}</H>
      <div className="flex items-center gap-1 whitespace-nowrap">
        {box('gte', lo, t('fp.min'))}<span className="text-[12px] text-ink-3">–</span>{box('lte', hi, t('fp.max'))}{unit && <span className="text-[12px] text-ink-3">{unit}</span>}
      </div>
    </div>
  )
}

export function FilterPanel(p: FilterPanelProps) {
  const f = p.state.filter
  const set = (filter: Filter, extras?: Extras, tagMode?: 'all' | 'any') => p.onChange({ filter: clean(filter), ...(extras ? { extras } : {}), ...(tagMode ? { tagMode } : {}) })
  const tagList = p.state.tagMode === 'any' ? f.tags?.any : f.tags?.all
  const setTags = (key: 'all' | 'any' | 'none', list: string[] | undefined) => {
    const tags = { ...(f.tags ?? {}), [key]: list?.length ? list : undefined }
    const any = tags.all?.length || tags.any?.length || tags.none?.length
    set({ ...f, tags: any ? tags : undefined })
  }
  const when = (key: 'when' | 'createdWhen', v: WhenValue) => {
    const on = p.state.extras[key] === v
    const extras = { ...p.state.extras }
    const field = key === 'when' ? 'modified' : 'created'
    if (on) { delete extras[key]; set({ ...f, [field]: undefined }, extras) } else { extras[key] = v; set({ ...f, [field]: whenFilter(v) }, extras) }
  }
  const objects = p.vocabulary?.designObjects ?? []
  const methods = ['ai-generate', 'manual', 'export', 'render', ...(p.vocabulary?.methods.map(m => m.id).filter(m => m.includes('/')) ?? [])]
  const formats = p.vocabulary?.formats.length ? p.vocabulary.formats : [{ id: 'image', displayName: t('kind.image') }, { id: 'video', displayName: t('kind.video') }, { id: 'audio', displayName: t('kind.audio') }, { id: 'model', displayName: t('kind.model') }, { id: 'doc', displayName: t('kind.doc') }, { id: 'unknown', displayName: t('kind.unknown') }]

  return (
    <div className="mx-5 mt-2 flex flex-wrap items-start gap-x-6 gap-y-3 rounded-lg bg-surface-panel px-4 py-3 origin-[70%_0] animate-[bb-materialize_var(--duration-snappy)_var(--spring-settle)_both]" data-filter-panel>
      <div><H>{t('fp.stage')}</H><div className="flex gap-1">{STAGES.map(s => <FilterChip key={s} pressed={!!f.stage?.includes(s)} count={count(p.facets?.stage, s)} onClick={() => set({ ...f, stage: toggle(f.stage, s) })}><StageMark stage={s} label="short" /></FilterChip>)}</div></div>
      <div><H>{t('fp.format')}</H><div className="flex flex-wrap gap-1">{formats.map(x => <FilterChip key={x.id} pressed={!!f.format?.includes(x.id)} count={count(p.facets?.format, x.id)} onClick={() => set({ ...f, format: toggle(f.format, x.id) })}><Icon name={kindIcon(x.id)} size={12} />{formatName(x)}</FilterChip>)}</div></div>
      <div><H>{t('fp.review')}</H><div className="flex gap-1">{REVIEW_STATUSES.map(r => <FilterChip key={r} pressed={!!f.review?.includes(r)} count={count(p.facets?.review, r)} onClick={() => set({ ...f, review: toggle(f.review, r) })}><ReviewMark review={r} label /></FilterChip>)}</div></div>
      <div><H>{t('fp.issue')}</H><div className="flex gap-1">
        <FilterChip pressed={!!f.hasIssues} onClick={() => set({ ...f, hasIssues: f.hasIssues ? undefined : true })}><Icon name="triangle-alert" size={12} />{t('fp.hasIssue')}</FilterChip>
        <FilterChip pressed={!!f.issue?.includes('stale-upstream')} onClick={() => set({ ...f, issue: toggle(f.issue, 'stale-upstream') })}><Icon name="git-pull-request-arrow" size={12} />{t('fp.stale')}</FilterChip>
        <FilterChip pressed={!!f.issue?.includes('missing-file')} onClick={() => set({ ...f, issue: toggle(f.issue, 'missing-file') })}><Icon name="file-question" size={12} />{t('fp.missing')}</FilterChip>
      </div></div>
      {objects.length > 0 && (
        <div><H>{t('fp.belongs')}</H><div className="flex flex-wrap gap-1">{objects.map(o => {
          const nm = o.name.replace(/\.[^.]+$/, '')
          const on = f.relation?.type === 'belongs' && (f.relation.to === o.id || f.relation.to === nm)
          return <FilterChip key={o.id} pressed={on} onClick={() => {
            const extras = { ...p.state.extras }
            if (on) { delete extras.belongsName; set({ ...f, relation: undefined }, extras) } else { extras.belongsName = nm; set({ ...f, relation: { type: 'belongs', to: nm } }, extras) }
          }}><Icon name="box" size={12} />{o.title ?? nm}</FilterChip>
        })}</div></div>
      )}
      <div><H>{t('fp.method')}</H><div className="flex flex-wrap gap-1">{methods.map(m => <FilterChip key={m} pressed={!!f.method?.includes(m)} onClick={() => set({ ...f, method: toggle(f.method, m) })}>{t('method.' + m) === 'method.' + m ? m : t('method.' + m)}</FilterChip>)}</div></div>
      <div><H>{t('fp.modified')}</H><div className="flex gap-1">{(['today', 'week', 'month'] as const).map(w => <FilterChip key={w} pressed={p.state.extras.when === w} onClick={() => when('when', w)}>{t('ac.when.' + w)}</FilterChip>)}</div></div>
      <div><H>{t('fp.created')}</H><div className="flex gap-1">{(['today', 'week', 'month'] as const).map(w => <FilterChip key={w} pressed={p.state.extras.createdWhen === w} onClick={() => when('createdWhen', w)}>{t('ac.when.' + w)}</FilterChip>)}</div></div>
      <div className="min-w-0 flex-[1_1_168px]"><H>{t('fp.tags')}</H><div className="flex flex-wrap items-center gap-1">
        {(tagList ?? []).map(tg => <TagChip key={tg} text={tg} onRemove={() => setTags(p.state.tagMode === 'any' ? 'any' : 'all', tagList!.filter(x => x !== tg))} />)}
        <TagInput placeholder={t('fp.tagInput')} label={t('fp.tags')} onAdd={v => setTags(p.state.tagMode === 'any' ? 'any' : 'all', [...new Set([...(tagList ?? []), v])])} />
        <FilterChip pressed={p.state.tagMode === 'all'} onClick={() => { if (p.state.tagMode === 'all') return; const list = f.tags?.any; set({ ...f, tags: { ...(f.tags ?? {}), all: list, any: undefined } }, undefined, 'all') }}>{t('fp.tagsAll')}</FilterChip>
        <FilterChip pressed={p.state.tagMode === 'any'} onClick={() => { if (p.state.tagMode === 'any') return; const list = f.tags?.all; set({ ...f, tags: { ...(f.tags ?? {}), any: list, all: undefined } }, undefined, 'any') }}>{t('fp.tagsAny')}</FilterChip>
      </div></div>
      <div className="min-w-0 flex-[1_1_168px]"><H>{t('fp.ntags')}</H><div className="flex flex-wrap items-center gap-1">
        {(f.tags?.none ?? []).map(tg => <TagChip key={tg} text={tg} onRemove={() => setTags('none', f.tags!.none!.filter(x => x !== tg))} />)}
        <TagInput placeholder={t('fp.tagInput')} label={t('fp.ntags')} onAdd={v => setTags('none', [...new Set([...(f.tags?.none ?? []), v])])} />
      </div></div>
      <Range label={t('fp.tris')} k="triangles" unit="" filter={f} onChange={x => set(x)} />
      <Range label={t('fp.dur')} k="duration" unit={t('fp.sec')} filter={f} onChange={x => set(x)} />
      <Range label={t('fp.width')} k="width" unit="px" filter={f} onChange={x => set(x)} />
      <Range label={t('fp.height')} k="height" unit="px" filter={f} onChange={x => set(x)} />
      <div><H>{t('fp.human')}</H><div className="flex h-[22px] items-center"><Switch checked={!!f.humanTagsOnly} aria-label={t('fp.humanAria')} onCheckedChange={v => set({ ...f, humanTagsOnly: v || undefined })} /></div></div>
      <div><H>{t('fp.aux')}</H><div className="flex h-[22px] items-center"><Switch checked={!!f.includeAuxiliary} aria-label={t('fp.auxAria')} onCheckedChange={v => set({ ...f, includeAuxiliary: v || undefined })} /></div></div>
      <div className="flex flex-[1_0_100%] items-center gap-2 pt-2 shadow-[inset_0_1px_0_var(--line-hairline)]">
        <span className="flex-1 text-[12px] tabular-nums text-ink-3">{p.total != null ? t('fp.results', { n: fmtInt(p.total) }) : ''}</span>
        <Button size="sm" variant="ghost" onClick={p.onClear}>{t('common.clear')}</Button>
        {p.state.editSmart && p.onSaveEdit && <Button size="sm" variant="primary" onClick={p.onSaveEdit}><Icon name="check" size={12} />{t('smart.saveTo', { name: p.state.editSmart })}</Button>}
        <Button size="sm" onClick={p.onSaveSmart}><Icon name="folder-search" size={12} />{t('fp.saveSmart')}</Button>
      </div>
    </div>
  )
}
