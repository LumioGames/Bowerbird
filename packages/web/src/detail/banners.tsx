import * as React from 'react'
import { useNavigate } from 'react-router'
import type { AssetDetail, RelationView } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { Banner } from '../components/Banner'
import { toast } from '../overlays/toast'
import { useLibrary } from '../lib/library'
import { Btn, Mono } from '../pages/shared/ui'
import { at, errText, who } from '../pages/shared/text'
import { useAsset, useInvalidate } from '../pages/shared/queries'
import { openReplaceContent } from './ReplaceContent'

/** The outgoing source relation whose upstream changed since it was made / last acknowledged. */
export function staleRelation(asset: Pick<AssetDetail, 'relations'>): RelationView | null {
  return asset.relations.outgoing.find(r => r.stale && !r.broken) ?? null
}

export const comparePath = (lib: string, a: string, b: string, o: { av?: number | string; bv?: number | string; mode?: string } = {}) => {
  const q = new URLSearchParams({ a, b })
  if (o.av != null) q.set('av', String(o.av))
  if (o.bv != null) q.set('bv', String(o.bv))
  if (o.mode) q.set('mode', o.mode)
  return `/libraries/${encodeURIComponent(lib)}/compare?${q}`
}

/**
 * 上游已更新，待复核 (web-shell.md 流程「上游已更新」): 确认已复核 · 替换内容… · 对比上游的变化 (needs a version plugin;
 * without one the button stays visible but disabled, with the reason next to it).
 */
export function StaleBanner({ lib, asset }: { lib: string; asset: AssetDetail }) {
  const rel = staleRelation(asset)
  const up = useAsset(lib, rel?.to)
  const libInfo = useLibrary()
  const navigate = useNavigate()
  const inv = useInvalidate(lib)
  const [busy, setBusy] = React.useState(false)
  if (!rel) return null
  const upA = up.data
  const upName = upA?.name ?? rel.target?.name ?? rel.targetName ?? ''
  const last = upA?.versions[upA.versions.length - 1]
  const toV = rel.staleTo ?? upA?.versions.length
  const hasStore = !!libInfo.data?.versionStore
  const ack = async () => {
    setBusy(true)
    try {
      await api.relations.acknowledge(lib, asset.id, rel.to)
      inv.asset(asset.id); inv.lib('issues', 'search', 'info')
      toast({ kind: 'success', title: t('stale.acked', { name: upName, v: toV ?? '' }) })
    } catch (e) { toast({ kind: 'error', title: errText(e) }) } finally { setBusy(false) }
  }
  return (
    <Banner tone="warning" title={t('stale.title')}
      actions={<>
        <Btn size="sm" variant="primary" disabled={busy} onClick={ack}>{t('stale.ack')}</Btn>
        <Btn size="sm" onClick={() => openReplaceContent(lib, asset, { fromStale: true })}>{t('stale.replace')}</Btn>
        {hasStore
          ? <Btn size="sm" onClick={() => navigate(comparePath(lib, rel.to, rel.to, { av: rel.staleFrom, bv: rel.staleTo }))}>{t('stale.compare')}</Btn>
          : <><Btn size="sm" disabled title={t('stale.needPlugin')}>{t('stale.compare')}</Btn><span className="w2-banner__hint">{t('stale.needPlugin')}</span></>}
      </>}>
      <b>{upName}</b>{' '}v{rel.staleFrom ?? '?'} → v{toV ?? '?'}
      {last && <> · {last.note ?? ''} · <Mono>{who(last.by)}</Mono> · {at(last.at)}</>}
    </Banner>
  )
}

/**
 * Someone else replaced the content while this page is open (F-03): say who and which version, keep showing what
 * was on screen until「显示新版本」.
 */
export function ReplacedBanner({ by, version, onShow }: { by: string; version: number | null; onShow(): void }) {
  return (
    <Banner tone="info" title={t('replaced.title', { who: who(by), n: version ?? '' })}
      actions={<Btn size="sm" variant="primary" onClick={onShow}>{t('replaced.show')}</Btn>}>
      {t('replaced.text')}
    </Banner>
  )
}
