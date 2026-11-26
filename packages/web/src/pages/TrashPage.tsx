import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { TrashItem } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { t, useLocale } from '../lib/i18n'
import { useLibraryId } from '../lib/library'
import { Icon } from '../components/Icon'
import { PageFrame } from '../components/PageFrame'
import { ReviewMark, StageMark } from '../components/marks'
import { confirm } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { useInspectorTarget } from '../shell/inspector-target'
import { Btn, Mono } from './shared/ui'
import { ago, errText, who } from './shared/text'
import { useTrash } from './shared/queries'
import { KIND_ICON, kindOf } from './shared/kinds'
import { guardedUndo } from './shared/undo'
import { restoreAsking } from '../flows/restore'
import { VirtualRows } from './shared/VirtualRows'

/** Days left before automatic purge get the warning colour at one day or less. */
export const SOON_DAYS = 1
export const isSoon = (daysLeft: number) => daysLeft <= SOON_DAYS

export { renamedName } from './shared/text'

/** Every trash row is this tall (web2.css .w2-tr__r): the list is virtual (thousands of deleted assets stay smooth). */
export const TRASH_ROW_H = 44

/**
 * 回收站 `/trash` (pages.md 回收站): rows with stage and review marks, original place, when, who, days left
 * (default 7, yellow when about to go); multi-select restore / purge; restoring into a taken place asks first and
 * says the new name; purge confirms; empty; loading; error.
 */
export function TrashPage() {
  useLocale()
  const lib = useLibraryId()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const q = useTrash(lib)
  const [sel, setSel] = React.useState<string[]>([])
  useInspectorTarget({ kind: 'none' }, [])
  const items = q.data?.items ?? []
  const days = q.data?.trashDays ?? 7
  const back = () => { if (location.key !== 'default') navigate(-1); else navigate(`/libraries/${encodeURIComponent(lib)}`) }
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['lib', lib] }) }
  React.useEffect(() => { setSel(s => s.filter(id => items.some(i => i.id === id))) }, [q.data]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Restore one; a taken place asks first (「恢复后它会改名为 {名称_1}」). Returns true when restored. */
  const restoreOne = async (it: TrashItem, quiet = false): Promise<boolean> => {
    try {
      const r = await restoreAsking(lib, it)
      if (!r) return false
      if (!quiet) toast({ kind: 'success', title: t('trash.restored', { name: r.name, folder: it.folder || '/' }), undo: guardedUndo(async () => { await api.assets.remove(lib, it.assetId, true); refresh() }) })
      return true
    } catch (e) { toast({ kind: 'error', title: errText(e) }); return false } finally { refresh() }
  }
  const restoreSel = async () => {
    const list = items.filter(i => sel.includes(i.id))
    let n = 0
    for (const it of list) if (await restoreOne(it, true)) n++
    setSel([])
    if (n) toast({ kind: 'success', title: t('trash.restoredMany', { n }) })
  }
  const purge = async (list: TrashItem[], all = false) => {
    if (!list.length) return
    const referenced = list.some(i => i.referencedBy > 0)
    const ok = await confirm({
      title: t('trash.purge.title', { what: list.length > 1 ? t('trash.nAssets', { n: list.length }) : list[0]!.name }),
      body: t('trash.purge.text') + (referenced ? t('trash.purge.refs') : ''),
      confirmLabel: t('trash.purge.confirm'),
      danger: true
    })
    if (!ok) return
    try {
      if (all) await api.trash.empty(lib)
      else for (const it of list) await api.trash.purge(lib, it.id)
      setSel([])
      toast({ title: t('trash.purged', { what: list.length > 1 ? t('trash.nAssets', { n: list.length }) : list[0]!.name }) })
    } catch (e) { toast({ kind: 'error', title: errText(e) }) } finally { refresh() }
  }
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))

  return (
    <PageFrame
      title={t('trash.title')}
      subtitle={t('trash.keep', { n: days })}
      onBack={back}
      state={q.isPending ? 'loading' : q.isError ? 'error' : items.length ? 'ready' : 'empty'}
      onRetry={() => void q.refetch()}
      empty={{ icon: 'trash-2', title: t('trash.emptyTitle'), body: t('trash.emptyText', { n: days }) }}
      actions={items.length ? <Btn icon="trash-2" onClick={() => void purge(items, true)}>{t('trash.emptyAll')}</Btn> : undefined}
    >
      <div className="w2-tr">
        {sel.length > 0 && (
          <div className="w2-tr__sel">
            <span>{t('trash.selected', { n: sel.length })}</span>
            <Btn size="sm" icon="undo-2" onClick={() => void restoreSel()}>{t('trash.restore')}</Btn>
            <Btn size="sm" variant="danger" onClick={() => void purge(items.filter(i => sel.includes(i.id)))}>{t('trash.purgeMore')}</Btn>
          </div>
        )}
        <div className="w2-tr__table" role="table" aria-label={t('trash.title')}>
          <div className="w2-tr__h" role="row">
            <span role="columnheader" />
            <span role="columnheader">{t('trash.col.name')}</span>
            <span role="columnheader">{t('trash.col.where')}</span>
            <span role="columnheader">{t('trash.col.when')}</span>
            <span role="columnheader">{t('trash.col.who')}</span>
            <span role="columnheader">{t('trash.col.left')}</span>
            <span role="columnheader" />
          </div>
          <VirtualRows count={items.length} rowHeight={TRASH_ROW_H}>{k => {
            const it = items[k]!
            const on = sel.includes(it.id)
            return (
              <div key={it.id} className={cn('w2-tr__r', on && 'on')} role="row" data-trash={it.id}>
                <span role="cell"><button type="button" className="w2-ck" role="checkbox" aria-checked={on} aria-label={t('trash.pick', { name: it.name })} onClick={() => toggle(it.id)}><Icon name="check" size={12} /></button></span>
                <span role="cell" className="w2-tr__n">
                  <span className="w2-thumb">{it.thumbnail ? <img src={it.thumbnail} alt="" /> : <Icon name={KIND_ICON[kindOf(it)]} />}</span>
                  <b title={it.originalPath}>{it.name}</b>
                  <StageMark stage={it.stage} size="sm" label="short" />
                  {it.review !== 'exempt' && <ReviewMark review={it.review} size="sm" />}
                </span>
                <span role="cell"><Mono className="min-w-0 truncate" title={it.folder || '/'}>{it.folder || '/'}</Mono></span>
                <span role="cell">{ago(it.deletedAt)}</span>
                <span role="cell"><Mono className="min-w-0 truncate" title={who(it.deletedBy)}>{who(it.deletedBy)}</Mono></span>
                <span role="cell" className={cn('w2-num', isSoon(it.daysLeft) && 'w2-tr__soon')} data-days-left={it.daysLeft}>{t('trash.days', { n: it.daysLeft })}</span>
                <span role="cell" className="w2-tr__a">
                  <Btn size="sm" onClick={() => void restoreOne(it)}>{t('trash.restore')}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void purge([it])}>{t('trash.purgeMore')}</Btn>
                </span>
              </div>
            )
          }}</VirtualRows>
        </div>
      </div>
    </PageFrame>
  )
}
