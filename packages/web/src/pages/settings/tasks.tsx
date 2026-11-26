import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { JobInfo } from '@bowerbird/schema'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/keys'
import { Icon } from '../../components/Icon'
import { toast } from '../../overlays/toast'
import { Btn, Grow, Num, Progress, Skeleton, Tag } from '../shared/ui'
import { ago, errText, fmtInt } from '../shared/text'
import { useJobs } from '../shared/queries'
import { pluginText } from '../../plugins/text'
import { Card, Heading, Row } from './parts'

/** A failed job whose reason names a plugin this machine lacks gets「去安装」instead of a retry. */
export function needsPlugin(j: Pick<JobInfo, 'error' | 'retryable'>): boolean {
  return j.retryable === false && /插件|plugin/i.test(j.error ?? '')
}

function jobState(j: JobInfo): string {
  if (j.status === 'running') return j.progress != null ? `${Math.round(j.progress * 100)}%` : (pluginText(j.pluginId, j.message) ?? t('set.t.running'))
  if (j.status === 'queued') return t('set.t.queued')
  if (j.status === 'failed') return pluginText(j.pluginId, j.error) ?? t('set.t.failed')
  if (j.status === 'cancelled') return t('set.t.cancelled')
  return pluginText(j.pluginId, j.message) ?? t('set.t.done')
}

/**
 * 任务 (pages.md 设置「任务」): creation jobs (progress, cancel, the plugin's follow-up button, ADR-042); the
 * pipeline's stages with queue and speed (stages no plugin handles are hidden); scan progress and「立即扫描」;
 * failed jobs with the reason and what to do next — retry one or all, no retry where it cannot help.
 */
export function TasksSection({ lib }: { lib: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useJobs(lib)
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.jobs(lib) })
  const run = async (f: () => Promise<unknown>, msg?: string) => { try { await f(); refresh(); if (msg) toast({ kind: 'success', title: msg }) } catch (e) { toast({ kind: 'error', title: errText(e) }) } }
  if (q.isPending) return <><Heading title={t('set.tasks')} sub={t('set.tasks.sub')} /><Skeleton rows={4} /></>
  if (q.isError) return <><Heading title={t('set.tasks')} sub={t('set.tasks.sub')} /><Card><Row k={t('common.loadFailed')}><Btn size="sm" onClick={() => void q.refetch()}>{t('w2.common.retry')}</Btn></Row></Card></>
  const j = q.data
  const stages = j.stages.filter(s => !s.idle)
  const scan = j.scan
  const retryable = j.failed.filter(f => f.retryable !== false)
  const openAction = (job: JobInfo) => {
    if (!job.action || !job.pluginId) return
    const qs = new URLSearchParams(job.action.params ?? {}).toString()
    navigate(`/libraries/${encodeURIComponent(lib)}/plugins/${encodeURIComponent(job.pluginId)}/${encodeURIComponent(job.action.page)}${qs ? `?${qs}` : ''}`)
  }
  return (
    <>
      <Heading title={t('set.tasks')} sub={t('set.tasks.sub')} />
      {j.creates.length > 0 && (
        <Card>
          <div className="w2-tk__fh"><b>{t('set.t.creates')}</b><Num>{j.creates.length}</Num></div>
          {j.creates.map(c => (
            <div key={c.id} className="w2-tk__f" data-job={c.id}>
              <span className="w2-thumb"><Icon name="sparkles" /></span>
              <span className="w2-tk__jm"><b>{pluginText(c.pluginId, c.creatorName) ?? c.creator ?? c.id}</b><small>{c.pluginId ?? ''} · {jobState(c)}</small></span>
              {c.status === 'running' && c.progress != null && <Progress value={c.progress} style={{ width: 140 }} />}
              {c.action && <Btn size="sm" variant="primary" onClick={() => openAction(c)}>{pluginText(c.pluginId, c.action.label)}</Btn>}
              {(c.status === 'running' || c.status === 'queued') && <Btn size="sm" onClick={() => void run(() => api.jobs.cancel(lib, c.id), t('set.t.cancelledToast', { name: pluginText(c.pluginId, c.creatorName) ?? c.id }))}>{t('w2.common.cancel')}</Btn>}
            </div>
          ))}
        </Card>
      )}
      <Card>
        <div className="w2-tk">
          {stages.map(s => {
            const n = s.queued + s.running
            return (
              <div key={s.stage} className="w2-tk__r" data-stage={s.stage}>
                <span>{t(`stage.${s.stage}`)}</span>
                <span className="w2-tk__bar"><i style={{ width: `${Math.min(100, n * 12)}%` }} /></span>
                <Num>{n ? t('set.t.queuedN', { n: fmtInt(n) }) : t('set.t.idle')}</Num>
                <Num className="w2-tk__sp">{s.rate ? t('set.t.rate', { n: Math.round(s.rate) }) : '—'}</Num>
              </div>
            )
          })}
          {/* models and other formats wait for a browser to render their thumbnails (ADR-025): say how many */}
          {j.waitingRender > 0 && (
            <div className="w2-tk__r" data-stage="waiting-render" title={t('set.t.waitRenderTip')}>
              <span>{t('set.t.waitRender')}</span>
              <span className="w2-tk__bar"><i style={{ width: `${Math.min(100, j.waitingRender * 12)}%` }} /></span>
              <Num>{t('set.t.waitRenderN', { n: fmtInt(j.waitingRender) })}</Num>
              <Num className="w2-tk__sp">—</Num>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <Row k={t('set.t.scan')} id="scan">
          {scan.running
            ? <><Progress value={scan.total ? scan.done / scan.total : 0} style={{ width: 160 }} /><Num>{t('set.t.scanning', { done: fmtInt(scan.done), total: fmtInt(scan.total) })}</Num>
                <Btn size="sm" onClick={() => void run(() => api.libraries.stopScan(lib))}>{t('set.t.stop')}</Btn></>
            : <><span>{scan.finishedAt ? t('set.t.lastScan', { when: ago(scan.finishedAt) }) : t('set.t.neverScanned')}</span>
                <Btn size="sm" icon="refresh-cw" onClick={() => void run(() => api.libraries.rescan(lib), t('set.t.scanStarted'))}>{t('set.t.scanNow')}</Btn></>}
        </Row>
      </Card>
      <Card>
        <div className="w2-tk__fh"><b>{t('set.t.failed')}</b><Num>{j.failed.length}</Num><Grow />
          {retryable.length > 0 && <Btn size="sm" onClick={() => void run(() => api.jobs.retry(lib, { failed: true }), t('set.t.retriedAll', { n: retryable.length }))}>{t('set.t.retryAll')}</Btn>}
        </div>
        {j.failed.length
          ? j.failed.map(f => (
              <div key={f.id} className="w2-tk__f" data-failed={f.id}>
                <b>{f.assetName ?? pluginText(f.pluginId, f.creatorName) ?? f.id}</b>
                {f.stage && <Tag small>{t(`stage.${f.stage}`)}</Tag>}
                <small>{f.pluginId ? pluginText(f.pluginId, f.error) : f.error}</small>
                <Grow />
                {f.retryable !== false
                  ? <Btn size="sm" onClick={() => void run(() => api.jobs.retry(lib, { jobIds: [f.id] }), t('set.t.retried', { name: f.assetName ?? f.id }))}>{t('w2.common.retry')}</Btn>
                  : needsPlugin(f) ? <Btn size="sm" onClick={() => navigate(`/libraries/${encodeURIComponent(lib)}/settings/plugins`)}>{t('viewer.plugin.install')}</Btn> : null}
              </div>
            ))
          : <p className="w2-st__none">{t('set.t.noFailed')}</p>}
      </Card>
    </>
  )
}
