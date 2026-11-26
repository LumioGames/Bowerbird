import * as React from 'react'
import { useNavigate } from 'react-router'
import type { AssetDetail, CheckView } from '@bowerbird/schema'
import { t } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { ReviewMark } from '../components/marks'
import { toast } from '../overlays/toast'
import { Btn, Grow, Mono, Num } from '../pages/shared/ui'
import { at, errText, who } from '../pages/shared/text'
import { useInvalidate, useLineage } from '../pages/shared/queries'
import { comparePath } from '../detail/banners'
import { askRejectNote, nearestUpstream, previousVerdict, setVerdict } from './actions'
import { guardedUndo } from '../pages/shared/undo'
import { usePluginRegistry, type PluginRegistry } from '../plugins/registry'
import { checkText } from '../plugins/text'

type Validators = Pick<PluginRegistry, 'validatorView'>

/**
 * Label of an automatic check rule: the validator's plugin names it in the shell's language (`WebPlugin.validators`);
 * otherwise the built-in one is「尺寸与设计对象」(ADR-020) and others show their rule id.
 */
export function checkLabel(c: CheckView, reg?: Validators): string {
  return (reg && checkText(reg, c).label) || (/size/i.test(c.rule) ? t('rev.check.size') : c.rule)
}

/** A check's message — in the shell's language when the validator's plugin can say it — without its own label in front
 *  (the model plugin writes「尺寸与设计对象：模型 … · 目标 …」; the label is shown next to it already). */
export function checkMessage(c: CheckView, reg?: Validators): string {
  const label = checkLabel(c, reg)
  const m = reg ? checkText(reg, c).message : c.message
  return m.startsWith(`${label}：`) ? m.slice(label.length + 1) : m.startsWith(`${label}:`) ? m.slice(label.length + 1).trimStart() : m
}

/** One row per automatic check: shown for reference only, never sets the verdict (ADR-020). */
export function Checks({ checks }: { checks: CheckView[] }) {
  const reg = usePluginRegistry()
  if (!checks.length) return <p className="w2-rv__none"><Icon name="list-checks" size={12} />{t('rev.noChecks')}</p>
  return (
    <div>
      {checks.map((c, i) => (
        <div key={i} className={c.verdict === 'pass' ? 'w2-chk-row' : 'w2-chk-row bad'}>
          <Icon name={c.verdict === 'pass' ? 'check' : 'x'} />
          <span>{checkLabel(c, reg)}</span>
          <Num>{checkMessage(c, reg)}</Num>
        </div>
      ))}
    </div>
  )
}

/**
 * 校验页签 (pages.md): the latest verdict — who · when — and its comment (red when rejected); 通过 / 打回… (comment
 * required); 与上游对比; automatic checks (only「尺寸与设计对象」built in) or「没有自动检查项」.
 */
export function ReviewTab({ lib, asset }: { lib: string; asset: AssetDetail }) {
  const navigate = useNavigate()
  const inv = useInvalidate(lib)
  const up = useLineage(lib, asset.id, { direction: 'up', types: ['source'], depth: 10 })
  const upId = nearestUpstream(up.data)
  const upName = upId ? up.data?.nodes.find(n => n.id === upId)?.name : null
  const v = asset.reviewVerdict
  const [busy, setBusy] = React.useState(false)

  const decide = async (status: 'approved' | 'rejected') => {
    let note: string | undefined
    if (status === 'rejected') { note = await askRejectNote(asset.name); if (!note) return }
    const prev = previousVerdict(asset)
    setBusy(true)
    try {
      await setVerdict(lib, asset.id, status, note)
      inv.asset(asset.id); inv.lib('search', 'info')
      toast({
        title: t(status === 'approved' ? 'rev.approvedToast' : 'rev.rejectedToast', { name: asset.name }),
        undo: guardedUndo(async () => { await setVerdict(lib, asset.id, prev.status, prev.note); inv.asset(asset.id); inv.lib('search', 'info') })
      })
    } catch (e) { toast({ kind: 'error', title: errText(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="w2-dcol">
      <section className="w2-rvhead">
        <span className="w2-rvhead__st"><ReviewMark review={asset.review} size="md" label /></span>
        {v?.by && <span className="w2-rv__who"><Mono>{who(v.by)}</Mono> · {at(v.at)}</span>}
        <Grow />
        {upId && <Btn icon="git-compare-arrows" title={t('rev.compareWith', { name: upName ?? '' })} onClick={() => navigate(comparePath(lib, asset.id, upId))}>{t('rev.compareUp')}</Btn>}
        {asset.review !== 'exempt' && <>
          <Btn icon="undo-2" disabled={busy} onClick={() => void decide('rejected')}>{t('rev.rejectMore')}</Btn>
          <Btn icon="check" variant="primary" disabled={busy || asset.review === 'approved'} onClick={() => void decide('approved')}>{t('rev.approve')}</Btn>
        </>}
      </section>
      {v?.note && (
        <section className={asset.review === 'rejected' ? 'w2-rv__note w2-rv__note--rej' : 'w2-rv__note'}>
          <Icon name={asset.review === 'rejected' ? 'undo-2' : 'message-square'} size={12} /><p>{v.note}</p>
        </section>
      )}
      <section>
        <h4>{t('rev.checks')}</h4>
        <Checks checks={asset.checks} />
      </section>
    </div>
  )
}
