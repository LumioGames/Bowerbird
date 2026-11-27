import * as React from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { AssetSummary, Issue, IssueLevel, IssueType } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t, useLocale } from '../lib/i18n'
import { useLibrary, useLibraryId } from '../lib/library'
import { Icon } from '../components/Icon'
import { PageFrame } from '../components/PageFrame'
import { AssetThumb } from '../components/AssetThumb'
import { confirm, openDialog } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { useInspectorTarget } from '../shell/inspector-target'
import { Btn, Grow, Num, Seg } from './shared/ui'
import { DialogFrame, choose } from './shared/dialogs'
import { ago, at, errText, folderOf } from './shared/text'
import { useIssues, useTrash } from './shared/queries'
import { openAssetDetail, assetPath } from '../detail/nav'
import { comparePath } from '../detail/banners'
import { openReplaceContent } from '../detail/ReplaceContent'
import { openRelocate } from './issues/RelocateDialog'
import { VirtualRows } from './shared/VirtualRows'
import {
  BATCH_ACTION, DIALOG_ACTION, ROW_ACTIONS, TYPE_ICON, assetCount, groupIssues, issueName, issueText, levelCounts, otherName, type RowAction
} from './issues/model'

/** Every issue row is this tall (web2.css .w2-it__row): rows are virtual within each type (100k assets can have many). */
export const ISSUE_ROW_H = 68

/** `?tab=rel&relType=&relTo=&relSlot=`: the detail page opens that relation in the graph (「重新指定…」). */
export function relinkPath(lib: string, assetId: string, rel: { type: string; to: string; slot?: string }): string {
  const q = new URLSearchParams({ tab: 'rel', relType: rel.type, relTo: rel.to })
  if (rel.slot) q.set('relSlot', rel.slot)
  return `${assetPath(lib, assetId)}?${q}`
}

/**
 * 完整性 `/issues` (pages.md 完整性): 「N 个资产 · M 条问题」; grouped by 错误 / 警告 / 提示 then by type; level
 * filter; each row shows the asset, the relation, when it was found, and default-style buttons; one batch「全部…」
 * per type; dialogs for relocate, which one is the original, which record to keep, confirm deleted, error log;
 * 去安装 jumps to the plugin in settings; 重新指定… jumps to that relation in the graph.
 */
export function IssuesPage() {
  useLocale()
  const lib = useLibraryId()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const libInfo = useLibrary()
  const q = useIssues(lib)
  const trash = useTrash(lib)
  const [level, setLevel] = React.useState<IssueLevel | 'all'>('all')
  /* `?issue=<id>` (the inspector's 重新定位文件… / 其实这个才是原件… / 选择保留哪一份…): scroll to that row, mark it
     and open its dialog once */
  const [params] = useSearchParams()
  const focusId = params.get('issue')
  const opened = React.useRef<string | null>(null)
  useInspectorTarget({ kind: 'none' }, [])
  const back = () => { if (location.key !== 'default') navigate(-1); else navigate(`/libraries/${encodeURIComponent(lib)}`) }
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['lib', lib] }) }

  const issues = q.data?.issues ?? []
  const assets = q.data?.assets ?? {}
  const trashIds = new Set((trash.data?.items ?? []).map(x => x.assetId))
  const inTrash = (i: Issue) => i.type === 'broken-reference' && (i.details.inTrash === true || (!!i.relation && trashIds.has(i.relation.to)))
  const counts = levelCounts(issues)
  const groups = groupIssues(issues, level)
  const hasStore = !!libInfo.data?.versionStore

  const resolve = async (i: Issue, action: string, params?: Record<string, unknown>, msg?: string) => {
    try {
      const r = await api.issues.resolve(lib, i.id, { action, params })
      if (r.failed.length) { toast({ kind: 'error', title: r.failed[0]!.message }); return }
      refresh()
      if (msg) toast({ kind: 'success', title: msg })
    } catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }

  const run = async (i: Issue, a: RowAction) => {
    const name = issueName(i, assets)
    const other = otherName(i, assets)
    const asset = i.assetId ? assets[i.assetId] : undefined
    switch (a) {
      case 'relink':
        if (i.assetId && i.relation) navigate(relinkPath(lib, i.assetId, i.relation), { state: { from: location.pathname + location.search, fromLabel: t('iss.title'), trail: [] } })
        return
      case 'remove-relation': {
        const ok = await confirm({ title: t('iss.unlink.title'), body: t('iss.unlink.text', { name, verb: t(`w2.rel.type.${i.relation?.type === 'source' || i.relation?.type === 'reference' || i.relation?.type === 'belongs' ? i.relation.type : 'uses'}`), other }), confirmLabel: t('iss.unlink.confirm'), danger: true })
        if (ok) await resolve(i, 'remove-relation', undefined, t('rel.removed'))
        return
      }
      case 'restore-target': return resolve(i, 'restore-target', undefined, t('iss.done.restore', { name: other, asset: name }))
      case 'relocate': return void openRelocate(lib, i, asset)
      case 'confirm-deleted': {
        const ok = await confirm({ title: t('iss.forget.title', { name }), body: t('iss.forget.text'), confirmLabel: t('iss.forget.confirm'), danger: true })
        if (ok) await resolve(i, 'confirm-deleted', undefined, t('iss.done.forget', { name }))
        return
      }
      case 'swap-dialog': {
        const v = await choose<'swap' | 'confirm'>({
          title: t('iss.identity.title'),
          text: t('iss.identity.text', { name: other, n: String(i.details.referrers ?? 0) }),
          body: <div className="w2-pair">
            <div><b>{other}</b><span className="w2-tag w2-tag--sm">{t('iss.identity.original')}</span></div>
            <div><b>{name}</b><span className="w2-tag w2-tag--sm">{t('iss.identity.copy')}</span></div>
          </div>,
          choices: [{ label: t('iss.identity.swap'), value: 'swap' }, { label: t('iss.identity.ok'), value: 'confirm', variant: 'primary' }]
        })
        if (v === 'swap') await resolve(i, 'swap', undefined, t('iss.done.swap', { name }))
        if (v === 'confirm') await resolve(i, 'confirm', undefined, t('iss.done.confirm', { name: other }))
        return
      }
      case 'confirm': return resolve(i, 'confirm', undefined, t('iss.done.confirm', { name: other }))
      case 'keep-dialog': {
        const tagsOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
        const copy = (label: string, tags: string[]) => <div><b>{label}</b><span className="w2-tags">{tags.map(x => <span key={x} className="w2-tag w2-tag--sm">{x}</span>)}</span></div>
        const v = await choose<'keep-conflict' | 'keep-local'>({
          title: t('iss.keep.title'), text: t('iss.keep.text'),
          /* the two records side by side with their tags (pages.js「保留哪一份记录？」) */
          body: <div className="w2-pair">{copy(t('iss.keep.localCopy'), tagsOf(i.details.localTags))}{copy(t('iss.keep.conflictCopy'), tagsOf(i.details.conflictTags))}</div>,
          choices: [{ label: t('iss.keep.conflict'), value: 'keep-conflict' }, { label: t('iss.keep.local'), value: 'keep-local', variant: 'primary' }]
        })
        if (v) await resolve(i, v, undefined, t(v === 'keep-local' ? 'iss.done.keepLocal' : 'iss.done.keepConflict'))
        return
      }
      case 'compare':
        if (i.relation) navigate(comparePath(lib, i.relation.to, i.relation.to, { av: i.details.fromVersion as number | undefined, bv: i.details.toVersion as number | undefined }))
        return
      case 'replace': if (i.assetId) { const d = await api.assets.get(lib, i.assetId).catch(() => null); if (d) void openReplaceContent(lib, d, { fromStale: true }) } return
      case 'acknowledge': return resolve(i, 'acknowledge', undefined, t('stale.acked', { name: other, v: String(i.details.toVersion ?? '') }))
      case 'trash': return resolve(i, 'trash', undefined, t('iss.done.trash', { name }))
      case 'log': {
        const retry = await openDialog<boolean>(close => (
          <DialogFrame kind="form" title={t('iss.log.title', { name })} onDismiss={() => close()}
            footer={<><Btn onClick={() => close()}>{t('w2.common.close')}</Btn><Btn variant="primary" onClick={() => close(true)}>{t('w2.common.retry')}</Btn></>}>
            <pre className="w2-prompt">{[
              `${t('iss.log.stage')}  ${i.details.stage ? t(`stage.${String(i.details.stage)}`) : '—'}`,
              `${t('iss.log.plugin')}  ${String(i.details.plugin ?? '—')}`,
              `${t('iss.log.error')}  ${String(i.details.error ?? '—')}`,
              `${t('iss.log.at')}  ${at(i.foundAt)}`
            ].join('\n')}</pre>
          </DialogFrame>
        ))
        if (retry) await resolve(i, 'retry', undefined, t('iss.done.retry'))
        return
      }
      case 'retry': return resolve(i, 'retry', undefined, t('iss.done.retry'))
      case 'install': navigate(`/libraries/${encodeURIComponent(lib)}/settings/plugins?focus=${encodeURIComponent(String(i.details.plugin ?? ''))}`); return
      case 'clear-thumbnail': return resolve(i, 'clear-thumbnail', undefined, t('iss.done.clearThumb'))
      case 'reshot': if (i.assetId) openAssetDetail(navigate, lib, i.assetId, { tab: 'view', fromLabel: t('iss.title') }); return
      case 'ignore': return resolve(i, 'ignore', undefined, t('iss.done.ignore'))
      case 'mark-copy': return resolve(i, 'mark-copy', undefined, t('iss.done.markCopy', { name, other }))
    }
  }

  React.useEffect(() => {
    if (!focusId || opened.current === focusId || !q.data) return
    const i = issues.find(x => x.id === focusId)
    if (!i) return
    opened.current = focusId
    if (level !== 'all' && level !== i.level) setLevel('all')
    const a = DIALOG_ACTION[i.type]
    if (a) void run(i, a)
  }, [focusId, q.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const runAll = async (type: IssueType, list: Issue[]) => {
    const a = BATCH_ACTION[type]!
    const label = t('iss.all', { action: t(`iss.act.${a}`).replace(/…$/, '') })
    const ok = await confirm({ title: t('iss.batch.title', { n: list.length, type: t(`iss.type.${type}`), action: label }), body: list.map(i => issueName(i, assets)).join('、'), confirmLabel: label })
    if (!ok) return
    try {
      const r = await api.issues.resolveMany(lib, { action: a, type, ids: list.map(i => i.id) })
      refresh()
      toast({ kind: r.failed.length ? 'warning' : 'success', title: t('iss.batch.done', { n: r.resolved.length }), description: r.failed.length ? r.failed.map(f => f.message).join('；') : undefined })
    } catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }

  const disabledWhy = (i: Issue, a: RowAction): string | null => {
    if (a === 'restore-target' && !inTrash(i)) return t('iss.notInTrash')
    if (a === 'compare' && !hasStore) return t('stale.needPlugin')
    if ((a === 'relink' || a === 'remove-relation') && !i.relation) return '—'
    return null
  }
  const label = (i: Issue, a: RowAction) => a === 'restore-target' ? t('iss.act.restore-target-named', { name: otherName(i, assets) }) : t(`iss.act.${a}`)

  return (
    <PageFrame
      title={t('iss.title')}
      subtitle={issues.length ? t('iss.head', { n: q.data?.assetCount ?? assetCount(issues), m: q.data?.total ?? issues.length }) : undefined}
      onBack={back}
      state={q.isPending ? 'loading' : q.isError ? 'error' : issues.length ? 'ready' : 'empty'}
      onRetry={() => void q.refetch()}
      empty={{ icon: 'shield-check', title: t('iss.emptyTitle'), body: t('iss.emptyText') }}
      actions={issues.length ? <Seg<IssueLevel | 'all'> label={t('iss.level')} value={level} onChange={setLevel}
        items={[{ value: 'all', label: `${t('iss.level.all')} ${issues.length}` }, ...(['error', 'warning', 'info'] as const).map(l => ({ value: l, label: `${t(`iss.level.${l}`)} ${counts[l]}` }))]} /> : undefined}
    >
      <div className="w2-it">
        {groups.map(g => (
          <section key={g.level} className={`w2-it__lv w2-it__lv--${g.level}`} data-level={g.level}>
            <h4>{t(`iss.level.${g.level}`)}<span>{g.count}</span></h4>
            {g.types.map(({ type, issues: list }) => {
              const batch = BATCH_ACTION[type]
              const batchable = batch ? list.filter(i => !disabledWhy(i, batch)) : []
              return (
                <div key={type} className="w2-it__ty" data-type={type}>
                  <div className="w2-it__th">
                    <Icon name={TYPE_ICON[type]} size={12} /><b>{t(`iss.type.${type}`)}</b><Num>{list.length}</Num><Grow />
                    {batch && batchable.length > 1 && <Btn size="sm" onClick={() => void runAll(type, batchable)}>{t('iss.all', { action: t(`iss.act.${batch}`).replace(/…$/, '') })}</Btn>}
                  </div>
                  <VirtualRows count={list.length} rowHeight={ISSUE_ROW_H} scrollToIndex={focusId ? (list.findIndex(x => x.id === focusId) >= 0 ? list.findIndex(x => x.id === focusId) : null) : null}>{k => {
                    const i = list[k]!
                    const asset: AssetSummary | undefined = i.assetId ? assets[i.assetId] : undefined
                    return (
                      <div key={i.id} className={i.id === focusId ? 'w2-it__row w2-it__row--focus' : 'w2-it__row'} data-issue={i.id} aria-current={i.id === focusId ? 'true' : undefined}>
                        <span className="w2-thumb">{asset ? <AssetThumb asset={asset} size={32} fit="cover" /> : <Icon name="file-question" />}</span>
                        <div className="w2-it__m">
                          {asset ? <button type="button" className="w2-link" onClick={() => openAssetDetail(navigate, lib, asset.id, { fromLabel: t('iss.title') })}>{asset.name}</button> : <b>{issueName(i, assets)}</b>}
                          <span>{issueText(i, assets, inTrash(i))}</span>
                          <small>{(asset ? folderOf(asset.path) : i.path) || '/'} · {t('iss.found', { when: ago(i.foundAt) })}</small>
                        </div>
                        <div className="w2-it__acts">
                          {ROW_ACTIONS[type].map((a, k) => { const why = disabledWhy(i, a); return <Btn key={a} size="sm" data-onboard={k === 0 ? 'issues.fix' : undefined} disabled={!!why} title={why ?? undefined} onClick={() => void run(i, a)}>{label(i, a)}</Btn> })}
                        </div>
                      </div>
                    )
                  }}</VirtualRows>
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </PageFrame>
  )
}
