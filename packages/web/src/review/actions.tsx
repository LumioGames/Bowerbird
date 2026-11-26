import * as React from 'react'
import type { AssetDetail, Lineage, ReviewStatus } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { openDialog } from '../overlays/dialogs'
import { DialogFrame } from '../pages/shared/dialogs'
import { Btn, TextArea } from '../pages/shared/ui'
import { kindOf, isViewable } from '../pages/shared/kinds'

/** Review verdicts (ADR-020: only people decide; ADR-024: only the latest verdict is kept). */

/** The verdict to put back on undo: the stored one when it was about this content, else pending. */
export function previousVerdict(asset: Pick<AssetDetail, 'review' | 'reviewVerdict' | 'hash'>): { status: ReviewStatus; note?: string } {
  const v = asset.reviewVerdict
  if (asset.review === 'exempt') return { status: 'exempt' }
  if (v && v.hash === asset.hash && (v.status === 'approved' || v.status === 'rejected')) return { status: v.status, note: v.note }
  return { status: 'pending' }
}

export function setVerdict(lib: string, id: string, status: ReviewStatus, note?: string, expectHash?: string) {
  return api.assets.review(lib, id, { status, note: note || undefined, expectHash })
}

/** 打回…: the comment is required — an empty one is stopped in the dialog (「哪里需要改（必填）」); ↵ sends, Shift+↵ is a new line (copy.md). */
export function askRejectNote(name: string): Promise<string | undefined> {
  return openDialog<string>(close => <RejectBody name={name} close={close} />)
}
function RejectBody({ name, close }: { name: string; close(v?: unknown): void }) {
  const [v, setV] = React.useState('')
  const [bad, setBad] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => { ref.current?.focus() }, [])
  const send = () => { const x = v.trim(); if (!x) { setBad(true); ref.current?.focus(); return } close(x) }
  return (
    <DialogFrame kind="form" title={t('rev.rejectTitle', { name })} onDismiss={() => close()}
      footer={<><Btn onClick={() => close()}>{t('w2.common.cancel')}</Btn><Btn variant="primary" onClick={send}>{t('rev.reject')}</Btn></>}>
      <TextArea ref={ref} rows={3} value={v} invalid={bad} placeholder={t('rev.notePh')} aria-label={t('rev.noteLabel')}
        onChange={e => { setV(e.target.value); setBad(false) }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
    </DialogFrame>
  )
}

/**
 * 与上游对比: along source relations (breadth first), the nearest upstream that is an image or a model and can be
 * shown (web-shell.md 校验页签「对照上游」).
 */
export function nearestUpstream(lineage: Pick<Lineage, 'center' | 'nodes' | 'edges'> | undefined | null): string | null {
  if (!lineage) return null
  const byId = new Map(lineage.nodes.map(n => [n.id, n]))
  const seen = new Set([lineage.center])
  let frontier = [lineage.center]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const e of lineage.edges) {
        if (e.type !== 'source' || e.from !== id || e.broken || seen.has(e.to)) continue
        seen.add(e.to)
        const n = byId.get(e.to)
        if (!n) continue
        const k = kindOf(n)
        if ((k === 'image' || k === 'model') && isViewable(n)) return n.id
        next.push(n.id)
      }
    }
    frontier = next
  }
  return null
}
