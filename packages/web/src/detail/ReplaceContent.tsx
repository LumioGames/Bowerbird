import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AssetDetail } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { openDialog } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { DialogFrame } from '../pages/shared/dialogs'
import { Btn, TextInput } from '../pages/shared/ui'
import { errText, fmtSize } from '../pages/shared/text'
import { guardedUndo } from '../pages/shared/undo'

/**
 * 替换为新版本… / 替换内容… (copy.md 版本「替换为新版本」; the stale banner opens the same dialog). Same file name and
 * GUID, the new content becomes v{n}, review goes back to pending. With a version plugin the toast can undo
 * (by restoring the previous content as one more version).
 */
export function openReplaceContent(lib: string, asset: AssetDetail, _o: { fromStale?: boolean } = {}): Promise<unknown> {
  return openDialog(close => <ReplaceBody lib={lib} asset={asset} close={close} />)
}

function ReplaceBody({ lib, asset, close }: { lib: string; asset: AssetDetail; close(v?: unknown): void }) {
  const qc = useQueryClient()
  const [file, setFile] = React.useState<File | null>(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [missing, setMissing] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const next = asset.versions.length + 1
  const submit = async () => {
    if (!file) { setMissing(true); input.current?.click(); return }
    setBusy(true)
    const prevHash = asset.hash
    try {
      await api.assets.replaceContent(lib, asset.id, file, note.trim() || undefined)
      close(true)
      void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', asset.id] })
      const info = await api.libraries.get(lib).catch(() => null)
      toast({
        kind: 'success',
        title: t('w2.replace.done', { name: asset.name }),
        undo: info?.versionStore ? guardedUndo(async () => { await api.assets.restoreVersion(lib, asset.id, prevHash); void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', asset.id] }) }) : undefined
      })
    } catch (e) { toast({ kind: 'error', title: errText(e) }); setBusy(false) }
  }
  return (
    <DialogFrame kind="form" title={t('w2.replace.title', { name: asset.name })} text={t('w2.replace.text', { n: next })} onDismiss={() => close()}
      footer={<><Btn onClick={() => close()}>{t('w2.common.cancel')}</Btn><Btn variant="primary" disabled={busy} onClick={submit}>{t('replace.confirm')}</Btn></>}>
      <div className="grid gap-2">
        <input ref={input} type="file" hidden onChange={e => { setFile(e.target.files?.[0] ?? null); setMissing(false) }} />
        <div className="flex items-center gap-2">
          <Btn icon="file-up" onClick={() => input.current?.click()}>{t('w2.replace.pick')}</Btn>
          {file ? <span className="w2-num">{file.name} · {fmtSize(file.size)}</span> : missing ? <span className="w2-hint" data-level="error">{t('w2.replace.needFile')}</span> : null}
        </div>
        <TextInput value={note} onChange={e => setNote(e.target.value)} placeholder={t('w2.replace.note')} aria-label={t('w2.replace.note')} />
      </div>
    </DialogFrame>
  )
}
