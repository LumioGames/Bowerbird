import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AssetDetail, Issue } from '@bowerbird/schema'
import { Button } from '@bowerbird/plugin-sdk/web'
import { Banner } from '../components/Banner'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { fmtActor, fmtDateTime } from '../lib/format'
import { toast, toastError } from '../overlays/toast'
import { confirm } from '../overlays/dialogs'
import { libPath, rt } from '../shell/runtime'
import { replaceContent } from '../flows/actions'
import { putSummaries } from '../flows/cache'
import { pluginText } from '../plugins/text'

/**
 * The issue banner at the top of the single-asset inspector (E-02: the same names and buttons as the integrity page):
 * 上游已更新 (确认已复核 · 替换内容… · 对比上游的变化 — the last needs a version plugin), 指向的文件找不到了
 * (重新指定… goes to that relation in the graph · 删除这条关系), 文件缺失 (重新定位文件… · 确认删除), 处理失败
 * (查看错误 · 重试), and the rest. Each button leads to the same endpoint the integrity page uses.
 */
export function IssueBanners({ asset }: { asset: AssetDetail }) {
  const issues = asset.issues.slice().sort((a, b) => rank(a) - rank(b)).slice(0, 3)
  if (!issues.length) return null
  return <div className="grid gap-2 px-3 pb-3">{issues.map(i => <OneIssue key={i.id} asset={asset} issue={i} />)}</div>
}

function rank(i: Issue): number { return i.level === 'error' ? 0 : i.level === 'warning' ? 1 : 2 }

function str(v: unknown): string { return v == null ? '' : String(v) }

function OneIssue({ asset, issue }: { asset: AssetDetail; issue: Issue }) {
  const { lib, go, qc } = rt()
  const qcl = useQueryClient()
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
  const hasVersions = !!info.data?.versionStore
  const d = issue.details ?? {}
  const refresh = (fresh?: AssetDetail) => {
    if (fresh) { qcl.setQueryData(qk.asset(lib, asset.id), fresh); putSummaries(qc, lib, [fresh]) } else void qcl.invalidateQueries({ queryKey: qk.asset(lib, asset.id) })
    for (const k of ['issues', 'info', 'views', 'browse']) void qcl.invalidateQueries({ queryKey: ['lib', lib, k] })
  }
  const resolve = async (action: string, params?: Record<string, unknown>, msg = t('fix.done')) => {
    try { await api.issues.resolve(lib, issue.id, { action, ...(params ? { params } : {}) }); refresh(); toast({ title: msg }) } catch (e) { toastError(e) }
  }
  const btn = (label: string, onClick: () => void, primary = false, disabled = false, title?: string) => (
    <Button key={label} size="sm" variant={primary ? 'primary' : 'default'} disabled={disabled} title={title} onClick={onClick}>{label}</Button>
  )
  const toIssues = () => go(libPath(lib, `/issues?issue=${encodeURIComponent(issue.id)}`))
  const toGraph = () => go(libPath(lib, `/asset/${encodeURIComponent(asset.id)}?tab=rel${issue.relation ? `&relType=${encodeURIComponent(issue.relation.type)}&relTo=${encodeURIComponent(issue.relation.to)}${issue.relation.slot ? `&relSlot=${encodeURIComponent(issue.relation.slot)}` : ''}` : ''}`))

  switch (issue.type) {
    case 'stale-upstream': {
      const rel = asset.relations.outgoing.find(r => r.stale && (!issue.relation || r.to === issue.relation.to))
      const name = rel?.target?.name ?? str(d.toName)
      const from = rel?.staleFrom ?? (d.fromVersion as number | undefined), to = rel?.staleTo ?? (d.toVersion as number | undefined)
      return (
        <Banner tone="warning" icon="circle-arrow-up" title={t('fix.stale.title')}
          actions={[
            btn(t('fix.ack'), async () => {
              if (!rel) return
              try { const fresh = await api.relations.acknowledge(lib, asset.id, rel.to); refresh(fresh); toast({ title: t('fix.acked', { name: `${name} v${to ?? ''}` }) }) } catch (e) { toastError(e) }
            }, true),
            btn(t('fix.replace'), () => void replaceContent(asset.id, { fromStale: true })),
            btn(t('fix.compare'), () => rel && go(libPath(lib, `/compare?a=${rel.to}&b=${rel.to}${from ? `&av=${from}` : ''}${to ? `&bv=${to}` : ''}`)), false, !hasVersions, hasVersions ? undefined : t('fix.compareNeedPlugin')),
            ...(!hasVersions ? [<span key="hint" className="text-[12px] text-ink-3">{t('fix.compareNeedPlugin')}</span>] : [])
          ]}>
          <b className="font-semibold text-ink-1">{name}</b>{from != null && to != null ? ` v${from} → v${to}` : ''}
        </Banner>
      )
    }
    case 'broken-reference': {
      const rel = asset.relations.outgoing.find(r => r.broken && (!issue.relation || r.to === issue.relation.to))
      const name = rel?.targetName ?? str(d.toName)
      return (
        <Banner tone="danger" icon="unlink" title={t('issue.broken-reference')}
          actions={[
            btn(t('fix.relink'), toGraph, true),
            btn(t('fix.removeRel'), async () => {
              if (!rel) return
              try { const fresh = await api.relations.remove(lib, asset.id, { type: rel.type, to: rel.to, ...(rel.slot ? { slot: rel.slot } : {}) }); refresh(fresh); toast({ title: t('rel.deleted') }) } catch (e) { toastError(e) }
            }),
            ...(rel?.targetInTrash ? [btn(t('fix.restore'), () => void resolve('restore-target'))] : [])
          ]}>
          {rel?.targetInTrash ? t('fix.brokenTrash.text', { name }) : t('fix.broken.text', { name })}
        </Banner>
      )
    }
    case 'missing-file':
    case 'orphan-sidecar':
      return (
        <Banner tone="danger" icon="file-question" title={t('issue.missing-file')}
          actions={[
            btn(t('fix.relocate'), toIssues, true),
            btn(t('fix.confirmDeleted'), async () => {
              const ok = await confirm({ title: t('fix.confirmDeletedTitle', { name: asset.name }), body: t('fix.confirmDeletedText', { days: info.data?.settings?.trashDays ?? 7 }), confirmLabel: t('del.ok'), danger: true })
              if (ok) await resolve('confirm-deleted')
            })
          ]}>
          {t('fix.missing.text')}
        </Banner>
      )
    case 'pipeline-failed': {
      const err = str(d.error) || asset.stages.find(s => s.status === 'failed')?.error || ''
      return (
        <Banner tone="warning" icon="triangle-alert" title={t('issue.pipeline-failed')}
          actions={[
            btn(t('fix.viewError'), () => toast({ title: err || t('issue.pipeline-failed'), kind: 'error', durationMs: 10_000 }), true),
            ...(d.retryable === false ? [] : [btn(t('fix.retry'), async () => { try { await api.jobs.retry(lib, { assetIds: [asset.id] }); toast({ title: t('fix.retrying') }); refresh() } catch (e) { toastError(e) } })])
          ]}>
          {err}
        </Banner>
      )
    }
    case 'duplicate-guid':
      return (
        <Banner tone="danger" icon="copy" title={t('issue.duplicate-guid')} actions={[btn(t('fix.confirm'), () => void resolve('confirm'), true), btn(t('fix.original'), toIssues)]}>
          {t('fix.identity.text')}
        </Banner>
      )
    case 'metadata-conflict':
      return (
        <Banner tone="danger" icon="git-compare-arrows" title={t('issue.metadata-conflict')} actions={[btn(t('fix.chooseRecord'), toIssues, true)]}>
          {t('fix.conflict.text', { file: issue.path ?? '' })}
        </Banner>
      )
    case 'plugin-missing':
      return (
        <Banner tone="warning" icon="puzzle" title={t('issue.plugin-missing')} actions={[btn(t('fix.install'), () => go(libPath(lib, '/settings/plugins')), true)]}>
          {t('fix.plugin.text', { plugin: pluginText(str(d.plugin), str(d.displayName ?? d.plugin)), id: str(d.plugin), range: str(d.range) })}
        </Banner>
      )
    case 'thumbnail-stale':
      return (
        <Banner tone="info" icon="image" title={t('issue.thumbnail-stale')} actions={[btn(t('fix.clearThumb'), () => void resolve('clear-thumbnail'), true)]}>
          {t('fix.thumb.text')}
        </Banner>
      )
    case 'duplicate-content':
      return (
        <Banner tone="info" icon="copy" title={t('issue.duplicate-content')} actions={[btn(t('fix.ignore'), () => void resolve('ignore')), btn(t('fix.markCopy'), () => void resolve('mark-copy'))]}>
          {t('fix.dup.text', { other: str(d.otherName ?? d.otherId) })}
        </Banner>
      )
  }
  return null
}

/** The latest verdict line: who · when (ADR-024). */
export function VerdictLine({ by, at }: { by?: string | null; at?: string | null }) {
  if (!by && !at) return null
  return <span className="text-[12px] text-ink-3"><span className="font-mono text-[11px]">{fmtActor(by)}</span>{at ? ` · ${fmtDateTime(at)}` : ''}</span>
}

