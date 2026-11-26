import * as React from 'react'
import type { AssetDetail } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { EmptyState } from '../components/EmptyState'
import { PluginSlot } from '../plugins/registry'
import { Btn } from '../pages/shared/ui'

/** Download an asset's original file (the way out when its plugin cannot show it). */
export function downloadOriginal(lib: string, asset: Pick<AssetDetail, 'id'>): void {
  const a = document.createElement('a')
  a.href = api.assets.fileUrl(lib, asset.id, true)
  a.rel = 'noopener'
  a.click()
}

/** Whether a plugin's `appliesTo` accepts an asset; a predicate that throws counts as no (and is logged). */
export function safeApplies<A>(pluginId: string, appliesTo: ((a: A) => boolean) | undefined, a: A): boolean {
  if (!appliesTo) return true
  try { return !!appliesTo(a) } catch (e) { console.error(`[bowerbird] plugin ${pluginId} appliesTo failed`, e); return false }
}

/**
 * Every plugin component web-2 renders (viewers, compare views, detail tabs, settings pages) goes through the
 * registry's PluginSlot — its own ShellContext with storage namespaced to the plugin, and its own error boundary.
 * A crash shows「查看器出错了」with the plugin and the reason,「下载原文件」for the assets involved and「重试」; the
 * page around it keeps working.
 */
export function PluginView<P extends object>({ pluginId, component, props, lib, assets = [] }: {
  pluginId: string
  component: React.ComponentType<P>
  props: P
  lib: string
  /** Assets whose originals the fallback offers to download. */
  assets?: Array<Pick<AssetDetail, 'id' | 'name'>>
}) {
  const [attempt, setAttempt] = React.useState(0)
  return (
    <PluginSlot key={attempt} pluginId={pluginId} component={component} props={props}
      fallback={error => <PluginFailure pluginId={pluginId} error={error} lib={lib} assets={assets} onRetry={() => setAttempt(n => n + 1)} />} />
  )
}

export function PluginFailure({ pluginId, error, lib, assets, onRetry }: { pluginId: string; error: Error; lib: string; assets: Array<Pick<AssetDetail, 'id' | 'name'>>; onRetry(): void }) {
  return (
    <div className="flex h-full items-center justify-center" role="alert">
      <EmptyState icon="circle-alert" title={t('viewer.error.title')} body={`${pluginId} · ${error.message}`}
        action={<>
          {assets.map((a, i) => (
            <Btn key={a.id} variant={i === 0 ? 'primary' : undefined} icon="download" onClick={() => downloadOriginal(lib, a)}>
              {assets.length > 1 ? t('viewer.downloadNamed', { name: a.name }) : t('viewer.download')}
            </Btn>
          ))}
          <Btn icon="refresh-cw" onClick={onRetry}>{t('w2.common.retry')}</Btn>
        </>} />
    </div>
  )
}
