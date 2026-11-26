import * as React from 'react'
import { useNavigate } from 'react-router'
import type { AssetDetail } from '@bowerbird/schema'
import type { ViewerMode } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { usePluginRegistry, createFileSource } from '../plugins/registry'
import { EmptyState } from '../components/EmptyState'
import { AssetThumb } from '../components/AssetThumb'
import { toast } from '../overlays/toast'
import { Btn, Skeleton } from '../pages/shared/ui'
import { errText, extOf, fmtSize } from '../pages/shared/text'
import { useInvalidate } from '../pages/shared/queries'
import { openRelocate } from '../pages/issues/RelocateDialog'
import { PluginView, downloadOriginal } from './PluginView'
import { pluginText } from '../plugins/text'

/**
 * The viewer slot (web-shell.md 插槽「查看器」, 状态呈现): the format plugin's Viewer with a FileSource, wrapped in an
 * error boundary; when no viewer can run, the shell says why and what to do (pages.md 查看器「特殊」):
 * 未知格式 · 缺少插件 · 解码失败 / 处理失败 · 查看器出错 · 文件缺失. 处理中 and 大模型加载进度 are the plugin's own.
 */
export type ViewerProblem = 'missing' | 'plugin' | 'failed' | 'unknown'

export function viewerProblem(asset: Pick<AssetDetail, 'flags' | 'missingPlugin' | 'format'>, hasView: boolean): ViewerProblem | null {
  if (asset.flags.includes('missing')) return 'missing'
  if (asset.missingPlugin) return 'plugin'
  if (asset.flags.includes('failed')) return 'failed'
  if (asset.format === 'unknown' || !hasView) return 'unknown'
  return null
}

export function ViewerHost({ lib, asset, mode = 'detail', versionHash, className }: {
  lib: string
  asset: AssetDetail
  mode?: ViewerMode
  /** Show this version's content instead of the current file (version plugin). */
  versionHash?: string | null
  className?: string
}) {
  const reg = usePluginRegistry()
  const fv = reg.formatView(asset.format)
  /* the source object stays the same while the content is the same, so a viewer never reloads for metadata edits */
  const source = React.useMemo(() => createFileSource(lib, asset, versionHash), [lib, asset.id, asset.hash, versionHash]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!reg.ready && !fv) return <div className={className}><Skeleton rows={3} /></div>
  const problem = viewerProblem(asset, !!fv)
  if (problem) return <div className={className}><ViewerProblemView lib={lib} asset={asset} problem={problem} /></div>
  return (
    <div className={className} data-plugin={fv!.pluginId}>
      <PluginView lib={lib} pluginId={fv!.pluginId} component={fv!.view.Viewer} props={{ asset, source, mode }} assets={[asset]} />
    </div>
  )
}


export function ViewerProblemView({ lib, asset, problem }: { lib: string; asset: AssetDetail; problem: ViewerProblem }) {
  const navigate = useNavigate()
  const inv = useInvalidate(lib)
  const dl = <Btn icon="download" onClick={() => downloadOriginal(lib, asset)}>{t('viewer.download')}</Btn>
  if (problem === 'missing') {
    const issue = asset.issues.find(i => i.type === 'missing-file')
    return (
      <div className="relative flex h-full items-center justify-center">
        {asset.thumbnail && <div className="w2-ghost"><AssetThumb asset={asset} fit="contain" /></div>}
        <EmptyState icon="file-question" title={t('viewer.missing.title')} body={asset.path}
          action={issue ? <Btn variant="primary" icon="folder-search" onClick={() => openRelocate(lib, issue, asset)}>{t('iss.act.relocate')}</Btn> : undefined} />
      </div>
    )
  }
  if (problem === 'plugin') {
    const mp = asset.missingPlugin!
    const name = pluginText(mp.id, mp.displayName ?? mp.id)
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon="puzzle" title={t('viewer.plugin.title', { plugin: name })} body={[mp.id, mp.range].filter(Boolean).join(' ')}
          action={<>
            <Btn variant="primary" icon="puzzle" onClick={() => navigate(`/libraries/${encodeURIComponent(lib)}/settings/plugins?focus=${encodeURIComponent(mp.id)}`)}>{t('viewer.plugin.install')}</Btn>
            {dl}
          </>} />
      </div>
    )
  }
  if (problem === 'failed') {
    const st = asset.stages.find(s => s.status === 'failed')
    const retry = async () => {
      try { await api.jobs.retry(lib, { assetIds: [asset.id], failed: true }); inv.asset(asset.id); toast({ title: t('viewer.failed.queued') }) }
      catch (e) { toast({ kind: 'error', title: errText(e) }) }
    }
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon="triangle-alert" title={st?.error ?? t('viewer.failed.title')} body={st ? t(`stage.${st.stage}`) : ''}
          action={<><Btn variant="primary" icon="refresh-cw" onClick={retry}>{t('w2.common.retry')}</Btn>{dl}</>} />
      </div>
    )
  }
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState icon="file" title={t('viewer.unknown.title', { ext: extOf(asset.name) || asset.name })} body={fmtSize(asset.size)} action={dl} />
    </div>
  )
}
