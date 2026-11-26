import * as React from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { AssetDetail, VersionView } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { qk } from '../lib/keys'
import { Icon } from '../components/Icon'
import { Banner } from '../components/Banner'
import { openDialog } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { DialogFrame } from '../pages/shared/dialogs'
import { Btn, Grow, Mono, Num, Option, Skeleton, Tag } from '../pages/shared/ui'
import { at, errText, fmtSize, who } from '../pages/shared/text'
import { useInvalidate, useVersions } from '../pages/shared/queries'
import { ViewerHost } from '../detail/ViewerHost'
import { comparePath } from '../detail/banners'
import { confirmRestore } from './restore'
import { pluginText } from '../plugins/text'

/** The two version plugins offered (versioning.md); package names follow the built-in plugins' naming. */
export const VERSION_PLUGINS = [
  { id: 'bowerbird.version-lore', spec: '@bowerbird/plugin-version-lore', name: 'Lore', icon: 'git-fork', sub: 'ver.lore.sub' },
  { id: 'bowerbird.version-git', spec: '@bowerbird/plugin-version-git', name: 'Git LFS', icon: 'hard-drive', sub: 'ver.lfs.sub' }
] as const

/** 选择版本插件 → install with `POST /plugins`; failures go to a toast. */
export function openVersionPluginPicker(after?: () => void): Promise<unknown> {
  return openDialog(close => <PickerBody close={close} after={after} />)
}
function PickerBody({ close, after }: { close(v?: unknown): void; after?: () => void }) {
  const [pick, setPick] = React.useState(0)
  const qc = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  const install = async () => {
    const p = VERSION_PLUGINS[pick]!
    setBusy(true)
    try {
      await api.plugins.install(p.spec)
      close(true)
      void qc.invalidateQueries({ queryKey: qk.plugins() })
      void qc.invalidateQueries({ queryKey: ['lib'] })
      toast({ kind: 'success', title: t('ver.installed', { name: p.name }) })
      after?.()
    } catch (e) { setBusy(false); toast({ kind: 'error', title: t('ver.installFailed', { name: p.name, reason: errText(e) }) }) }
  }
  return (
    <DialogFrame kind="form" title={t('ver.pickTitle')} onDismiss={() => close()}
      footer={<><Btn onClick={() => close()}>{t('w2.common.cancel')}</Btn><Btn variant="primary" disabled={busy} onClick={install}>{t('ver.install')}</Btn></>}>
      <div className="w2-opts" role="radiogroup" aria-label={t('ver.pickTitle')}>
        {VERSION_PLUGINS.map((p, i) => <Option key={p.id} checked={i === pick} onSelect={() => setPick(i)} icon={p.icon} title={p.name} sub={t(p.sub)} />)}
      </div>
      <p className="w2-dialog__text text-[12px]">{t('ver.pickNote')}</p>
    </DialogFrame>
  )
}

/**
 * 版本页签 (pages.md): without a version plugin only the records (v1 up, time, actor, note, size) with one plain
 * sentence and「选择版本插件…」. With one: list + preview (no「标签与关系」filter: there is no such history), 与当前版本对比,
 * 恢复为当前版本…; records from before the plugin are「未保存内容」and cannot be previewed.
 */
export function VersionsTab({ lib, asset }: { lib: string; asset: AssetDetail }) {
  const q = useVersions(lib, asset.id)
  const navigate = useNavigate()
  const inv = useInvalidate(lib)
  const [sel, setSel] = React.useState<number | null>(null)
  if (q.isPending) return <Skeleton rows={4} />
  if (q.isError) return <div className="w2-dcol"><Banner tone="danger" title={errText(q.error)} actions={<Btn size="sm" onClick={() => void q.refetch()}>{t('w2.common.retry')}</Btn>} /></div>
  const { versions, store } = q.data
  const cur = versions.find(v => v.current) ?? versions[versions.length - 1]
  const picked = versions.find(v => v.n === sel) ?? cur
  const refresh = () => { inv.asset(asset.id); setSel(null) }

  const row = (x: VersionView, plug: boolean) => {
    const prev = versions.find(v => v.n === x.n - 1)
    const d = prev ? x.size - prev.size : 0
    const off = plug && !x.hasContent
    const inner = <>
      <i className={cn('w2-vtr__dot', x.current && 'now')} />
      <span className="w2-vtr__m">
        <b><Num>v{x.n}</Num>{x.restoredFrom ? <Icon name="undo-2" size={12} /> : null}{x.restoredFrom ? t('ver.restoredFrom', { n: x.restoredFrom }) : (x.note ?? '')}{x.current && <Tag small>{t('ver.current')}</Tag>}</b>
        <small>{at(x.at)} · <Mono>{who(x.by)}</Mono>{off ? ` · ${t('ver.noContent')}` : ''}</small>
      </span>
      <span className="w2-vtr__s"><Num>{fmtSize(x.size)}</Num>{d ? <small>{d > 0 ? '+' : '−'}{fmtSize(Math.abs(d))}</small> : null}</span>
    </>
    if (!plug) return <div key={x.n} className="w2-vtr">{inner}</div>
    return (
      <button key={x.n} type="button" className={cn('w2-vtr', picked?.n === x.n && 'on', off && 'w2-vtr--off')} title={off ? t('ver.noContentTip') : undefined} aria-pressed={picked?.n === x.n} data-onboard={x.current ? undefined : 'ver.first'} onClick={() => setSel(x.n)}>
        {inner}
      </button>
    )
  }
  const list = versions.slice().reverse()

  if (!store) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="w2-vt__note">
          <Banner tone="info" title={t('ver.noPluginTitle')} actions={<Btn size="sm" icon="puzzle" data-onboard="ver.pick" onClick={() => void openVersionPluginPicker(refresh)}>{t('ver.pickPlugin')}</Btn>}>
            {t('ver.noPluginText')}
          </Banner>
        </div>
        <div className="w2-vt w2-vt--plain"><div className="w2-vt__list">{list.map(x => row(x, false))}</div></div>
      </div>
    )
  }

  const prevOfCur = cur ? versions.find(v => v.n === cur.n - 1) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="w2-vt__head">
        <span className="w2-vt__plug"><Icon name={store.id.includes('lore') ? 'git-fork' : 'hard-drive'} size={12} />{pluginText(store.id, store.displayName)}</span>
        {/* no「全部 / 内容 / 标签与关系」filter: versions only record content changes, nothing records tag or relation
            history (ADR-024), so a filter would have nothing to show */}
      </div>
      <div className="w2-vt">
        <div className="w2-vt__list">{list.map(x => row(x, true))}</div>
        {picked && (
          <div className="w2-vt__prev">
            <div className="w2-vt__ph">
              <span className="w2-vt__pt">
                <b><Num>v{picked.n}</Num> {picked.note ?? ''}</b>{picked.current && <Tag small>{t('ver.current')}</Tag>}
                <small>{at(picked.at)} · <Mono>{who(picked.by)}</Mono></small>
              </span>
              <Grow />
              {picked.current
                ? prevOfCur?.hasContent && <Btn size="sm" icon="git-compare-arrows" onClick={() => navigate(comparePath(lib, asset.id, asset.id, { av: prevOfCur.n, bv: picked.n }))}>{t('ver.compareWith', { n: prevOfCur.n })}</Btn>
                : picked.hasContent && <>
                  <Btn size="sm" icon="git-compare-arrows" onClick={() => navigate(comparePath(lib, asset.id, asset.id, { av: picked.n, bv: cur!.n }))}>{t('ver.compareCurrent')}</Btn>
                  <Btn size="sm" variant="primary" icon="undo-2" onClick={() => void confirmRestore(lib, asset, versions, picked.n, refresh)}>{t('ver.restore')}</Btn>
                </>}
            </div>
            {picked.hasContent || picked.current
              ? <div className="w2-vt__view"><ViewerHost key={picked.hash} lib={lib} asset={asset} versionHash={picked.current ? null : picked.hash} /></div>
              : <div className="w2-vt__none"><Icon name="history" size={24} /><span>{t('ver.beforePlugin')}</span></div>}
          </div>
        )}
      </div>
    </div>
  )
}
