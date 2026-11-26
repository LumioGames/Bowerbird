import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ISSUE_TYPES, STAGES, type Filter, type FolderNode, type Stage } from '@bowerbird/schema'
import { Popover, PopoverContent, PopoverTrigger, Switch } from '@bowerbird/plugin-sdk/web'
import { CopyText, Kv, Section, TagChip, TagInput } from '../components/blocks'
import { Icon } from '../components/Icon'
import { StageMark } from '../components/marks'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { fmtActor, fmtInt, fmtRelative, fmtSize } from '../lib/format'
import { patchFolder } from '../flows/folders'
import { locationFilter, type Loc } from '../browse/query'
import { StageChips } from './Single'

/**
 * Nothing selected: what the current folder or view holds (web-shell.md). A folder's display name, icon, note and
 * the defaults new assets get are edited here; they live in its `_folder.bmeta` (display name ≠ the name on disk).
 */
export const FOLDER_ICONS = ['folder', 'box', 'user', 'image', 'film', 'audio-lines', 'file-text', 'layers', 'sparkles', 'tag', 'puzzle', 'waypoints', 'hard-drive', 'inbox', 'activity', 'scan-search', 'shield-check', 'history']

export function findFolder(root: FolderNode | undefined, path: string): FolderNode | undefined {
  if (!root) return undefined
  if (root.path === path) return root
  for (const c of root.children) { const f = findFolder(c, path); if (f) return f }
  return undefined
}

/**
 * Counts for a place: total, size, stage mix, pending, with issues, the latest change and who made it (prototype
 * flows.js none():「12 个 · 29.3 MB」「19 小时前 · user:lin」). 「有问题」counts assets with any issue at any level —
 * the same as the side bar and the integrity page (E-09): the whole library reads `stats.issueAssets`, a narrower
 * place asks for every issue type (not `hasIssues`, which leaves out the 提示 level). The whole library's size is
 * `stats.bytes`; a narrower place adds its assets' sizes up a page at a time, and past SIZE_LIMIT assets leaves the
 * size out rather than show a partial sum.
 */
const SIZE_PAGE = 1000
const SIZE_LIMIT = 10_000

function useSummary(lib: string, filter: Filter, q?: string) {
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
  const whole = !q && Object.keys(filter).length === 0
  const base = useQuery({
    queryKey: ['lib', lib, 'browse-facets', 'insp', filter, q ?? ''],
    queryFn: () => api.search(lib, { filter, ...(q ? { q } : {}), sort: 'modified', order: 'desc', limit: 1, facets: true }),
    staleTime: 10_000
  })
  const issues = useQuery({
    queryKey: ['lib', lib, 'browse-facets', 'insp-issues', filter, q ?? ''],
    queryFn: () => api.search(lib, { filter: { ...filter, issue: [...ISSUE_TYPES] }, ...(q ? { q } : {}), limit: 1 }),
    staleTime: 10_000,
    enabled: !whole
  })
  const total = base.data?.total
  const bytes = useQuery({
    queryKey: ['lib', lib, 'browse-facets', 'insp-bytes', filter, q ?? ''],
    queryFn: async ({ signal }) => {
      let sum = 0
      let cursor: string | null = null
      for (let seen = 0; seen < SIZE_LIMIT; seen += SIZE_PAGE) {
        const r = await api.search(lib, { filter, ...(q ? { q } : {}), limit: SIZE_PAGE, ...(cursor ? { cursor } : {}) }, signal)
        for (const a of r.items) sum += a.size
        cursor = r.cursor
        if (!cursor) return sum
      }
      return null
    },
    staleTime: 10_000,
    enabled: !whole && total != null && total > 0 && total <= SIZE_LIMIT
  })
  const latest = base.data?.items[0]
  const latestDetail = useQuery({ queryKey: qk.asset(lib, latest?.id ?? ''), queryFn: () => api.assets.get(lib, latest!.id), enabled: !!latest, staleTime: 10_000 })
  const stage = new Map((base.data?.facets?.stage ?? []).map(f => [f.value, f.count]))
  const pending = base.data?.facets?.review.find(f => f.value === 'pending')?.count ?? 0
  return {
    total,
    bytes: whole ? info.data?.stats.bytes : total === 0 ? 0 : bytes.data ?? undefined,
    stage, pending, issues: whole ? info.data?.stats.issueAssets : issues.data?.total, latest,
    latestBy: latestDetail.data ? latestDetail.data.modifiedBy ?? latestDetail.data.createdBy : undefined
  }
}

/** 「12 个 · 29.3 MB」: the count, and the size once it is known. */
function countAndSize(n: number, bytes: number | undefined, key: string): string {
  const count = t(key, { n: fmtInt(n) })
  return bytes != null ? `${count} · ${fmtSize(bytes)}` : count
}

function Overview({ lib, filter, q, path, modified }: { lib: string; filter: Filter; q?: string; path?: string; modified?: string | null }) {
  const s = useSummary(lib, filter, q)
  const when = modified ?? s.latest?.modified ?? null
  return (
    <Section title={t('insp.overview')} id="insp.overview">
      <Kv rows={[
        path != null ? [t('insp.path'), <CopyText text={path ? path + '/' : '/'} />] : null,
        [t('insp.assets'), s.total != null ? countAndSize(s.total, s.bytes, 'insp.assetsValue') : '—'],
        [t('insp.lastModified'), when ? <>{fmtRelative(when)}{s.latestBy ? <> · <span className="font-mono text-[11px]">{fmtActor(s.latestBy)}</span></> : null}</> : '—'],
        [t('insp.stage'), <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2">{STAGES.map(st => <span key={st}><StageMark stage={st} label="short" /> {s.stage.get(st) ?? 0}</span>)}</div>],
        [t('insp.pending'), String(s.pending)],
        [t('insp.issues'), s.issues != null ? String(s.issues) : '—']
      ]} />
    </Section>
  )
}

export function FolderInspector({ lib, path }: { lib: string; path: string }) {
  const tree = useQuery({ queryKey: qk.folders(lib), queryFn: () => api.folders.tree(lib) })
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
  const node = findFolder(tree.data?.root, path)
  const [label, setLabel] = React.useState(node?.label ?? '')
  const [note, setNote] = React.useState(node?.description ?? '')
  React.useEffect(() => { setLabel(node?.label ?? ''); setNote(node?.description ?? '') }, [node?.path, node?.label, node?.description])
  if (!node) return null
  const eff = node.effectiveDefaults
  const defStage = (eff.stage as Stage | undefined) ?? info.data?.settings?.defaultStage ?? 'production'
  const defExempt = eff.review === 'exempt'
  const defTags = eff.tags ?? []
  const writeDefaults = (patch: { stage?: Stage; review?: 'pending' | 'exempt'; tags?: string[] }) =>
    void patchFolder(path, { defaults: { ...(node.defaults ?? {}), stage: defStage, review: defExempt ? 'exempt' : 'pending', tags: defTags, ...patch } })
  const isRoot = path === ''
  return (
    <>
      <div className="flex items-center gap-3 px-4 pt-4 pb-1">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label={t('insp.changeIcon')} title={t('insp.changeIcon')} disabled={isRoot}
              className="grid size-11 shrink-0 cursor-default place-items-center rounded-md border-0 bg-surface-raised text-ink-1 shadow-raise transition-transform duration-press hover:bg-fill-hover active:scale-95 focus-visible:outline-2 focus-visible:outline-accent-ring">
              <Icon name={isRoot ? 'hard-drive' : node.icon || 'folder'} size={24} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="min-w-0">
            <div className="grid grid-cols-[repeat(6,32px)] gap-1">
              {FOLDER_ICONS.map(n => (
                <button key={n} type="button" aria-label={n} title={n} aria-pressed={(node.icon || 'folder') === n}
                  onClick={() => void patchFolder(path, { icon: n === 'folder' ? null : n })}
                  className="grid size-8 cursor-default place-items-center rounded-sm border-0 bg-transparent text-ink-1 hover:bg-fill-hover active:scale-90 aria-pressed:bg-accent-soft aria-pressed:shadow-[inset_0_0_0_1px_var(--accent-ring)]">
                  <Icon name={n} />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">{isRoot ? info.data?.name : node.name}</b>
          {!isRoot && (
            <input value={label} placeholder={t('insp.labelPh')} aria-label={t('insp.labelPh')} autoComplete="off"
              onChange={e => setLabel(e.target.value)}
              onBlur={() => { if ((node.label ?? '') !== label.trim()) void patchFolder(path, { label: label.trim() || null }) }}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
              className="-mx-1 block w-[calc(100%+8px)] rounded-xs border-0 bg-transparent px-1 text-[12px] leading-[18px] text-ink-2 outline-none hover:bg-fill-rest focus:bg-fill-rest focus:text-ink-1 focus:shadow-[0_0_0_2px_var(--accent-ring)] placeholder:text-ink-3" />
          )}
        </div>
      </div>
      {!isRoot && (
        <div className="px-4 pb-2">
          <textarea value={note} rows={2} placeholder={t('insp.notePh')} aria-label={t('insp.notePh')}
            onChange={e => setNote(e.target.value)}
            onBlur={() => { if ((node.description ?? '') !== note) void patchFolder(path, { description: note.trim() ? note : null }) }}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur() }}
            className="-mx-1 block min-h-[26px] w-[calc(100%+8px)] resize-none rounded-xs border-0 bg-transparent p-1 text-[13px] leading-[18px] text-ink-1 outline-none [field-sizing:content] hover:bg-fill-rest focus:bg-fill-rest focus:shadow-[0_0_0_2px_var(--accent-ring)] placeholder:text-ink-3" />
        </div>
      )}
      <Overview lib={lib} filter={path ? { folder: path } : {}} path={path} modified={node.modified} />
      <Section title={t('insp.defaults')} id="insp.defaults">
        <Kv rows={[
          [t('insp.stage'), <StageChips value={defStage} onPick={s => writeDefaults({ stage: s })} />],
          [t('insp.exempt'), <Switch checked={defExempt} onCheckedChange={v => writeDefaults({ review: v ? 'exempt' : 'pending' })} aria-label={t('insp.exempt')} />],
          [t('insp.tags'), (
            <div className="flex flex-wrap gap-1">
              {defTags.map(tg => <TagChip key={tg} text={tg} onRemove={() => writeDefaults({ tags: defTags.filter(x => x !== tg) })} />)}
              <TagInput placeholder={t('insp.defTagPh')} label={t('insp.defaults')} onAdd={v => writeDefaults({ tags: defTags.includes(v) ? defTags : [...defTags, v] })} />
            </div>
          )]
        ]} />
      </Section>
    </>
  )
}

export function ViewInspector({ lib, name }: { lib: string; name: string }) {
  const views = useQuery({ queryKey: qk.views(lib), queryFn: () => api.views.list(lib) })
  const builtin = ['all', 'untagged', 'pending'].includes(name)
  const smart = builtin ? null : views.data?.views.find(v => v.name === name) ?? null
  const loc: Loc = name === 'all' ? { type: 'all' } : name === 'untagged' || name === 'pending' ? { type: 'view', id: name } : { type: 'smart', name }
  const lf = locationFilter(loc, smart)
  const title = builtin ? t('view.' + name) : name
  const s = useSummary(lib, lf.filter, lf.q)
  return (
    <>
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0">
          <b className="block truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">{title}</b>
          <small className="text-[12px] text-ink-2">{s.total != null ? countAndSize(s.total, s.bytes, 'common.nAssets') : ''}</small>
        </div>
      </div>
      <Overview lib={lib} filter={lf.filter} q={lf.q} />
    </>
  )
}
