import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AssetSummary } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { openDialog, FormDialog } from '../overlays/dialogs'
import { AssetThumb } from '../components/AssetThumb'
import { Field } from '../components/blocks'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { hasRuntime, rt } from './runtime'

/**
 * The asset picker dialog (search + browse) used by: build relation, replace relation target (更换对方…),
 * compare「换一个资产」, creator inputs, relocate. It is a form-type dialog (click outside does not close).
 * Rows carry stage, review and issue marks (E-08). Owner: line web-1.
 */
export interface PickAssetOptions {
  title?: string
  formats?: string[]
  /** Only turnaround sheets (assets with a view grid, `hasViews`). */
  views?: boolean
  exclude?: string[]
  confirmLabel?: string
  /** The one currently used (shown as「现在用的」, not pickable). */
  current?: string
  /** Show this folder's assets first when nothing is typed. */
  near?: string
}
let impl: ((o: PickAssetOptions) => Promise<AssetSummary | null>) | null = o =>
  openDialog<AssetSummary | null>(close => <AssetPicker {...o} onDone={a => close(a)} />).then(v => v ?? null)
export function pickAsset(o: PickAssetOptions = {}): Promise<AssetSummary | null> { return impl ? impl(o) : Promise.resolve(null) }
export function setPickAssetImpl(fn: (o: PickAssetOptions) => Promise<AssetSummary | null>): void { impl = fn }

export function AssetPicker(o: PickAssetOptions & { onDone: (a: AssetSummary | null) => void }) {
  const lib = hasRuntime() ? rt().lib : ''
  const [q, setQ] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [pick, setPick] = React.useState<AssetSummary | null>(null)
  React.useEffect(() => { const tm = setTimeout(() => setDebounced(q.trim()), 160); return () => clearTimeout(tm) }, [q])
  const res = useQuery({
    queryKey: ['lib', lib, 'search', 'picker', debounced, o.formats ?? null, o.near ?? null],
    enabled: !!lib,
    queryFn: ({ signal }) => api.search(lib, {
      ...(debounced ? { q: debounced } : {}),
      filter: { ...(o.formats?.length ? { format: o.formats } : {}), ...(!debounced && o.near != null ? { folder: o.near } : {}) },
      limit: 60
    }, signal)
  })
  const items = (res.data?.items ?? []).filter(a => !o.exclude?.includes(a.id) && (!o.views || a.hasViews === true))
  return (
    <FormDialog
      title={o.title ?? t('pick.title')}
      onClose={() => o.onDone(null)}
      primary={{ label: o.confirmLabel ?? t('pick.ok'), disabled: !pick, onClick: () => pick && o.onDone(pick) }}
    >
      <Field icon="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('common.search')} aria-label={t('common.search')} autoComplete="off" />
      <div role="radiogroup" className="mt-3 grid min-h-[200px] max-h-[320px] content-start gap-0.5 overflow-auto">
        {items.map(a => {
          const isCur = a.id === o.current
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={pick?.id === a.id}
              disabled={isCur}
              onClick={() => setPick(a)}
              onDoubleClick={() => !isCur && o.onDone(a)}
              className={cn('flex cursor-default items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-ink-1 outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-accent-ring disabled:opacity-60', pick?.id === a.id && 'bg-accent-soft hover:bg-accent-soft')}
            >
              <span className="size-8 shrink-0 overflow-hidden rounded-xs"><AssetThumb asset={a} fit="cover" /></span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-semibold">{a.name}</b>
                <small className="block truncate text-[11px] text-ink-2">{a.path.slice(0, Math.max(0, a.path.length - a.name.length - 1)) || '/'}{isCur ? ` · ${t('pick.current')}` : ''}</small>
              </span>
              {a.issueLevel && <IssueMark level={a.issueLevel} flags={a.flags} corner={false} />}
              <StageMark stage={a.stage} />
              <ReviewMark review={a.review} />
            </button>
          )
        })}
        {!res.isLoading && !items.length && <p className="m-0 px-2 py-3 text-ink-2">{t('pick.none')}</p>}
      </div>
    </FormDialog>
  )
}
