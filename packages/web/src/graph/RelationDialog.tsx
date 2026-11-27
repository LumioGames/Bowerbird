import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AssetSummary, ProvenanceInput } from '@bowerbird/schema'
import { BowerbirdApiError } from '@bowerbird/schema'
import { api } from '../lib/api'
import { provenanceBefore, provenanceInput } from '../lib/provenance'
import { t } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { Banner } from '../components/Banner'
import { openDialog } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { pickAsset } from '../shell/picker'
import { DialogFrame } from '../pages/shared/dialogs'
import { Btn, TextArea, TextInput } from '../pages/shared/ui'
import { errText } from '../pages/shared/text'
import { kindOf } from '../pages/shared/kinds'
import { cyclePath, type RelRef } from './build'
import { guardedUndo } from '../pages/shared/undo'
import { useAsset } from '../pages/shared/queries'

export const REL_TYPES = [
  { type: 'source', icon: 'arrow-right' },
  { type: 'reference', icon: 'eye' },
  { type: 'uses', icon: 'link' },
  { type: 'belongs', icon: 'layers' }
] as const
export type RelType = (typeof REL_TYPES)[number]['type']
export const METHODS = ['ai-generate', 'manual', 'slice', 'render', 'export', 'convert', 'other'] as const

export interface RelationDialogOptions {
  type?: RelType
  to?: Pick<AssetSummary, 'id' | 'name' | 'format'> | null
  /** Relations already known (for「已经有这条关系」). */
  existing?: RelRef[]
  /** Known source relations (for the loop check before asking the server). */
  sourceEdges?: Array<Pick<RelRef, 'from' | 'to'>>
  names?: Record<string, string>
}

/**
 * 建立关系… (web-shell.md 流程「建立关系」): pick the type, then the other asset. With 来源 / 参考 the dialog also says
 * how this asset was made — its provenance (方式、工具、提示词、备注, ADR-070), filled with what it has now — and the
 * other asset's role; both go in one wanted-state write (`assets.apply`, ADR-068), so saying the same provenance again
 * writes nothing. Loops of source relations are stopped and explained (循环关系阻止). Also exported for the shell's
 * right-click menu.
 */
export function openRelationDialog(lib: string, asset: Pick<AssetSummary, 'id' | 'name'>, o: RelationDialogOptions = {}): Promise<unknown> {
  return openDialog(close => <RelationBody lib={lib} asset={asset} o={o} close={close} />)
}

export function relationProblem(asset: { id: string; name: string }, type: string, to: { id: string; name: string; format?: string } | null, o: RelationDialogOptions): { text: string; chain?: string[] } | null {
  if (!to) return null
  if (to.id === asset.id) return { text: t('w2.rel.self') }
  if (o.existing?.some(r => r.from === asset.id && r.to === to.id && r.type === type && !r.slot)) return { text: t('rel.dup') }
  if (type === 'belongs' && to.format && kindOf({ format: to.format }) !== 'doc') return { text: t('rel.belongsDoc') }
  if (type === 'source' && o.sourceEdges) {
    const c = cyclePath(o.sourceEdges, asset.id, to.id)
    if (c) return { text: t('w2.rel.cycle', { a: to.name, b: asset.name }), chain: c.map(id => o.names?.[id] ?? id) }
  }
  return null
}

function RelationBody({ lib, asset, o, close }: { lib: string; asset: Pick<AssetSummary, 'id' | 'name'>; o: RelationDialogOptions; close(v?: unknown): void }) {
  const qc = useQueryClient()
  const [type, setType] = React.useState<RelType>(o.type ?? 'source')
  const [to, setTo] = React.useState(o.to ?? null)
  const [method, setMethod] = React.useState<string>('manual')
  const [tool, setTool] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const [note, setNote] = React.useState('')
  const [role, setRole] = React.useState('')
  /* the provenance the asset has now fills the form once it arrives (a second input does not wipe the first's) */
  const self = useAsset(lib, asset.id)
  const had = self.data?.provenance ?? null
  const filled = React.useRef(false)
  React.useEffect(() => {
    if (filled.current || !self.data) return
    filled.current = true
    if (had) { setMethod(had.method); setTool(had.tool ?? ''); setPrompt(had.prompt ?? ''); setNote(had.note ?? '') }
  }, [self.data, had])
  const making = type === 'source' || type === 'reference'
  /* a prompt belongs to AI methods: the built-in one, or a plugin's own (「community.forge/image」) */
  const promptable = method === 'ai-generate' || !(METHODS as readonly string[]).includes(method)
  const methods: string[] = had && !(METHODS as readonly string[]).includes(had.method) ? [...METHODS, had.method] : [...METHODS]
  const [serverProblem, setServerProblem] = React.useState<{ text: string; chain?: string[] } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const problem = relationProblem(asset, type, to, o) ?? serverProblem
  const verb = (k: RelType) => t(`rel.sent.${k}`, { a: asset.name, b: to?.name ?? '' })

  const choose = async () => {
    const p = await pickAsset({ title: t('rel.pickTitle', { name: asset.name }), exclude: [asset.id], formats: type === 'belongs' ? ['doc'] : undefined })
    if (p) { setTo(p); setServerProblem(null) }
  }
  /* until the asset's provenance is known, saying one could overwrite it */
  const waiting = making && self.isPending
  const create = async () => {
    if (!to || problem || waiting) return
    setBusy(true)
    const refresh = () => { for (const id of [asset.id, to.id]) void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', id] }) }
    const cycle = (details: Record<string, unknown> | undefined) => {
      const path = (details?.path as Array<{ name: string }> | undefined)?.map(x => x.name)
      setServerProblem({ text: t('w2.rel.cycle', { a: to.name, b: asset.name }), chain: path })
    }
    try {
      let undo: () => Promise<void>
      if (making) {
        /* the asset's provenance as the form says it; what the form does not show (parameters, batch) is kept */
        const { params, batch } = had && had.method === method ? provenanceInput(had) : {}
        const prov: ProvenanceInput = {
          method,
          ...(tool.trim() ? { tool: tool.trim() } : {}),
          ...(promptable && prompt.trim() ? { prompt: prompt.trim() } : {}),
          ...(params ? { params } : {}), ...(batch ? { batch } : {}),
          ...(note.trim() ? { note: note.trim() } : {})
        }
        const rel = { type, to: to.id, ...(role.trim() ? { role: role.trim() } : {}) }
        const res = await api.assets.apply(lib, { items: [{ id: asset.id, provenance: prov, relations: { add: [rel] } }] })
        const r = res.results[0]
        if (r?.error) {
          setBusy(false)
          if (r.error.code === 'cycle') cycle(r.error.details); else toast({ kind: 'error', title: r.error.message })
          return
        }
        const was = provenanceBefore(r?.changes)
        undo = async () => { await api.assets.apply(lib, { items: [{ id: asset.id, relations: { remove: [{ type, to: to.id }] }, ...(was.changed ? { provenance: was.before } : {}) }] }) }
      } else {
        await api.relations.add(lib, asset.id, { type, to: to.id })
        undo = async () => { await api.relations.remove(lib, asset.id, { type, to: to.id }) }
      }
      close(true)
      refresh()
      toast({ kind: 'success', title: t(`rel.made.${type}`, { a: asset.name, b: to.name }), undo: guardedUndo(async () => { await undo(); refresh() }) })
    } catch (e) {
      setBusy(false)
      if (e instanceof BowerbirdApiError && e.code === 'cycle') cycle(e.details)
      else toast({ kind: 'error', title: errText(e) })
    }
  }
  return (
    <DialogFrame kind="form" wide title={t('rel.newTitle', { name: asset.name })} onDismiss={() => close()}
      footer={<><Btn onClick={() => close()}>{t('w2.common.cancel')}</Btn><Btn variant="primary" icon="link" disabled={!to || !!problem || busy || waiting} onClick={create}>{t('rel.create')}</Btn></>}>
      <div className="w2-rtypes" role="radiogroup" aria-label={t('rel.typeLabel')}>
        {REL_TYPES.map(x => (
          <button key={x.type} type="button" className="w2-rtype" role="radio" aria-checked={type === x.type}
            onClick={() => { setType(x.type); setServerProblem(null); if (x.type === 'belongs' && to && to.format && kindOf({ format: to.format }) !== 'doc') setTo(null) }}>
            <Icon name={x.icon} /><b>{t(`w2.rel.type.${x.type}`)}</b><span>{t(`rel.typeHint.${x.type}`)}</span>
          </button>
        ))}
      </div>
      <div className="w2-label">{t('rel.other')}</div>
      <div className="flex items-center gap-2">
        {to ? <><b className="min-w-0 flex-1 truncate">{to.name}</b><Btn size="sm" variant="ghost" onClick={choose}>{t('rel.change')}</Btn></>
          : <Btn icon="search" onClick={choose}>{t('rel.pick')}</Btn>}
      </div>
      {to && <p className="w2-rsent">{verb(type)}</p>}
      {problem && <Banner tone="danger" title={problem.text}>{problem.chain?.join(' → ')}</Banner>}
      {making && (
        <div className="w2-form">
          <span>{t('rel.role')}</span>
          <TextInput value={role} onChange={e => setRole(e.target.value)} placeholder={t('rel.rolePh')} aria-label={t('rel.role')} />
          <span>{t('w2.rel.method')}</span>
          <div className="w2-chips" role="radiogroup" aria-label={t('w2.rel.method')}>
            {methods.map(m => <button key={m} type="button" className="w2-chip" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}>{(METHODS as readonly string[]).includes(m) ? t(`w2.method.${m}`) : m}</button>)}
          </div>
          <span>{t('w2.rel.tool')}</span>
          <TextInput value={tool} onChange={e => setTool(e.target.value)} placeholder={t('w2.rel.toolPh')} aria-label={t('w2.rel.tool')} />
          {promptable && <><span>{t('w2.rel.prompt')}</span><TextArea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} aria-label={t('w2.rel.prompt')} /></>}
          <span>{t('w2.rel.note')}</span>
          <TextInput value={note} onChange={e => setNote(e.target.value)} aria-label={t('w2.rel.note')} />
        </div>
      )}
    </DialogFrame>
  )
}
