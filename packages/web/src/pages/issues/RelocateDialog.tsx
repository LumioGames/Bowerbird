import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Switch } from '@bowerbird/plugin-sdk/web'
import type { AssetSummary, Issue } from '@bowerbird/schema'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { openDialog } from '../../overlays/dialogs'
import { toast } from '../../overlays/toast'
import { DialogFrame } from '../shared/dialogs'
import { Btn, Mono, Option, TextInput } from '../shared/ui'
import { baseName, errText, folderOf } from '../shared/text'

/**
 * 重新定位 {名称} (copy.md 完整性对话框): only offered when no file with the same content exists (the scanner
 * reconnects those by itself, ADR-013). Lists the closest candidates; the chosen file becomes this asset — tags,
 * relations and history stay, the content change is a new version. 「把文件移回原来的位置」is on by default; when it
 * is off, the toast says where the asset is now (E-20).
 */
export function openRelocate(lib: string, issue: Issue, asset?: Pick<AssetSummary, 'name' | 'path'> | null): Promise<unknown> {
  return openDialog(close => <RelocateBody lib={lib} issue={issue} asset={asset ?? null} close={close} />)
}

function RelocateBody({ lib, issue, asset, close }: { lib: string; issue: Issue; asset: Pick<AssetSummary, 'name' | 'path'> | null; close(v?: unknown): void }) {
  const qc = useQueryClient()
  const cands = useQuery({ queryKey: ['lib', lib, 'issues', 'candidates', issue.id], queryFn: () => api.issues.candidates(lib, issue.id) })
  const list = cands.data?.candidates ?? []
  const [pick, setPick] = React.useState(0)
  const [other, setOther] = React.useState<string | null>(null)
  const [moveBack, setMoveBack] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const name = asset?.name ?? baseName((issue.path ?? '').replace(/\.bmeta$/, ''))
  const original = asset?.path ?? (issue.path ?? '').replace(/\.bmeta$/, '')
  const chosen = other !== null ? other.trim() : list[pick]?.path ?? ''
  const submit = async () => {
    if (!chosen) return
    setBusy(true)
    try {
      await api.issues.resolve(lib, issue.id, { action: 'relocate', params: { path: chosen, moveBack } })
      close(true)
      void qc.invalidateQueries({ queryKey: ['lib', lib] })
      toast({ kind: 'success', title: moveBack ? t('iss.relocated.back', { cand: chosen, path: original }) : t('iss.relocated.here', { name, cand: chosen, folder: folderOf(chosen) || '/' }) })
    } catch (e) { setBusy(false); toast({ kind: 'error', title: errText(e) }) }
  }
  return (
    <DialogFrame kind="form" wide title={t('iss.relocate.title', { name })} text={t('iss.relocate.text', { name })} onDismiss={() => close()}
      footer={<><Btn onClick={() => close()}>{t('w2.common.cancel')}</Btn><Btn variant="primary" disabled={!chosen || busy} onClick={submit}>{t('iss.relocate.confirm')}</Btn></>}>
      <div className="w2-opts" role="radiogroup" aria-label={t('iss.relocate.title', { name })}>
        {cands.isPending && <p className="w2-rv__none">…</p>}
        {list.map((c, k) => (
          <Option key={c.path} checked={other === null && k === pick} onSelect={() => { setPick(k); setOther(null) }} icon={c.sameContent || k === 0 ? 'badge-check' : 'file'}
            title={<Mono>{c.path}</Mono>} sub={c.reason} />
        ))}
        {other === null
          ? <button type="button" className="w2-btn w2-btn--ghost w2-btn--sm justify-self-start" onClick={() => setOther('')}>{t('iss.relocate.other')}</button>
          : <TextInput autoFocus value={other} onChange={e => setOther(e.target.value)} placeholder={t('iss.relocate.otherPh')} aria-label={t('iss.relocate.other')} />}
      </div>
      {asset && (
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={moveBack} onCheckedChange={setMoveBack} aria-label={t('iss.relocate.back')} />
          {t('iss.relocate.back')} <Mono>{original}</Mono>
        </label>
      )}
    </DialogFrame>
  )
}
