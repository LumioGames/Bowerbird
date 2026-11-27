import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isMakingRelation, type AssetSummary, type Provenance, type RelationView } from '@bowerbird/schema'
import { t } from '../lib/i18n'
import { paramsText } from '../lib/params'
import { Icon } from '../components/Icon'
import { Banner } from '../components/Banner'
import { AssetThumb } from '../components/AssetThumb'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { Btn, KV, Mono } from '../pages/shared/ui'
import { at, folderOf, who } from '../pages/shared/text'
import { useAsset, useSearch } from '../pages/shared/queries'
import { StaleBanner } from '../detail/banners'
import { methodLabel, type GEdge, type RelRef } from './build'
import { removeRelation, restoreTarget, swapRelation } from './actions'

/** Side panel of the relation graph: how an asset was made (its provenance, ADR-070), or one relation (components.md 关系面板). */

export function AssetRow({ a, onOpen }: { a: AssetSummary; onOpen(id: string): void }) {
  return (
    <button type="button" className="w2-row" onClick={() => onOpen(a.id)}>
      <span className="w2-thumb"><AssetThumb asset={a} size={32} /></span>
      <span><b>{a.name}</b><small>{folderOf(a.path) || '/'}</small></span>
      {a.issueLevel && <IssueMark level={a.issueLevel} count={a.issueCount} flags={a.flags} />}
      <StageMark stage={a.stage} size="sm" />
      {a.review !== 'exempt' && <ReviewMark review={a.review} size="sm" />}
    </button>
  )
}

/**
 * How asset `of` was made: its provenance, its inputs (its source / reference relations with their roles) and, when
 * it came out of a run with other outputs, the whole batch (found by search, `filter.batch`).
 */
export function ProvenanceBody({ lib, rec, of, names, onOpen }: { lib: string; rec: Provenance; of: string; names: Map<string, string>; onOpen(id: string): void }) {
  const owner = useAsset(lib, of)
  const batch = useSearch(lib, { filter: { batch: rec.batch, includeAuxiliary: true }, limit: 200 }, !!rec.batch)
  const outputs = rec.batch ? batch.data?.items ?? [] : []
  const inputs = (owner.data?.relations.outgoing ?? []).filter(r => isMakingRelation(r.type)).map(r => ({ id: r.to, role: r.role, name: r.target?.name ?? r.targetName ?? undefined }))
  const params = paramsText(rec.method, rec.params)
  return (
    <>
      <KV rows={[
        [t('w2.rec.method'), methodLabel(rec.method, t)],
        [t('w2.rec.tool'), rec.tool || '—'],
        rec.plugin ? [t('w2.rec.plugin'), <Mono>{rec.plugin}</Mono>] : null,
        [t('w2.rec.by'), <Mono>{who(rec.by)}</Mono>],
        [t('rec.at'), at(rec.at)],
        params ? [t('w2.rec.params'), params] : null,
        ...inputs.filter(i => i.role).map(i => [i.role, <Mono>{i.name ?? names.get(i.id) ?? i.id.slice(0, 8)}</Mono>] as [React.ReactNode, React.ReactNode])
      ]} />
      {rec.prompt && <><div className="w2-rg-p__lab">{t('w2.rec.prompt')}</div><pre className="w2-prompt">{rec.prompt}</pre></>}
      {rec.note && <><div className="w2-rg-p__lab">{t('rec.note')}</div><p className="m-0 text-[12px] text-ink-2">{rec.note}</p></>}
      {inputs.length > 0 && <>
        <div className="w2-rg-p__lab">{t('rec.inputs')}</div>
        {inputs.map(i => (
          <button key={i.id} type="button" className="w2-row" onClick={() => onOpen(i.id)}>
            <span><b>{i.name ?? names.get(i.id) ?? i.id}</b>{i.role && <small>{i.role}</small>}</span>
          </button>
        ))}
      </>}
      {outputs.length > 0 && <>
        <div className="w2-rg-p__lab">{t('rec.outputs', { n: outputs.length })}</div>
        {outputs.length > 4
          ? <div className="w2-rg-p__mini">{outputs.map(a => <button key={a.id} type="button" title={a.name} onClick={() => onOpen(a.id)}><AssetThumb asset={a} size={40} /></button>)}</div>
          : outputs.map(a => <AssetRow key={a.id} a={a} onOpen={onOpen} />)}
      </>}
    </>
  )
}

const TYPE_ICON: Record<string, string> = { source: 'arrow-right', reference: 'eye', uses: 'link', belongs: 'layers' }
const typeKey = (type: string) => (type === 'source' || type === 'reference' || type === 'uses' || type === 'belongs' ? type : 'other')

/** Find the full relation (as stored on the initiator) for a graph edge. */
export function matchRelation(list: RelationView[] | undefined, rel: RelRef): RelationView | undefined {
  return list?.find(r => r.type === rel.type && r.to === rel.to && (r.slot ?? '') === (rel.slot ?? ''))
}

export function EdgePanel({ lib, edge, names, onOpen, onClose }: { lib: string; edge: GEdge; names: Map<string, string>; onOpen(id: string): void; onClose(): void }) {
  const qc = useQueryClient()
  const rel = edge.rel
  const fromQ = useAsset(lib, rel?.from)
  const rv = rel ? matchRelation(fromQ.data?.relations.outgoing, rel) : undefined
  const toQ = useAsset(lib, rel && !edge.broken && rel.type === 'source' ? rel.to : null)

  if (edge.recNode && edge.recOf) return <><h5><Icon name={edge.recNode.method === 'ai-generate' ? 'sparkles' : 'activity'} />{t('rec.title')}</h5><ProvenanceBody lib={lib} rec={edge.recNode} of={edge.recOf} names={names} onOpen={onOpen} /></>
  if (edge.group && edge.rec && edge.recOf) return <><h5><Icon name="activity" />{t('rec.title')}</h5><ProvenanceBody lib={lib} rec={edge.rec} of={edge.recOf} names={names} onOpen={onOpen} /></>
  if (edge.group) return <><h5><Icon name="layers" />{t('graph.members', { n: edge.items?.length ?? 0 })}</h5>{edge.items?.map(a => <AssetRow key={a.id} a={a} onOpen={onOpen} />)}</>
  if (!rel) return null

  const fromName = fromQ.data?.name ?? names.get(rel.from) ?? ''
  const toName = rv?.target?.name ?? rv?.targetName ?? names.get(rel.to) ?? rel.to
  const k = typeKey(rel.type)
  const head = <h5><Icon name={TYPE_ICON[rel.type] ?? 'link'} />{t(`w2.rel.type.${k}`)}{rel.note ? ` · ${rel.note}` : ''}</h5>
  const sent = <p className="w2-rg-p__sent">{t(`rel.sentRich.${k}`, { a: '\u0001', b: '\u0002' }).split(/(\u0001|\u0002)/).map((s, i) => s === '\u0001' ? <b key={i}>{fromName}</b> : s === '\u0002' ? <b key={i}>{toName}</b> : s)}</p>
  const slot = rel.slot ? <KV rows={[[t('rel.slot'), <>{rel.note ? `${rel.note} · ` : ''}<Mono>{rel.slot}</Mono></>]]} /> : null
  const swap = () => void swapRelation(qc, lib, rel, { name: rv?.target?.name ?? null })
  const del = async () => { if (await removeRelation(qc, lib, rel)) onClose() }

  if (edge.broken) {
    const inTrash = rv?.targetInTrash ?? false
    return (
      <>{head}{sent}{slot}
        <Banner tone="danger" title={t('rel.brokenTitle')}
          actions={<>
            <Btn size="sm" onClick={swap}>{t('rel.swap')}</Btn>
            {inTrash && <Btn size="sm" onClick={() => void restoreTarget(qc, lib, rel, toName)}>{t('rel.restore')}</Btn>}
            <Btn size="sm" onClick={() => void del()}>{t('rel.remove')}</Btn>
          </>}>
          {t(inTrash ? 'rel.inTrash' : 'rel.gone', { name: toName })}
        </Banner>
      </>
    )
  }
  const versions = toQ.data?.versions ?? []
  const vLabel = (n: number | null | undefined) => { if (!n) return '—'; const v = versions[n - 1]; return `v${n}${v?.note ? ` · ${v.note}` : ''}` }
  const thenN = rv?.stale ? rv.staleFrom : rv?.toHash ? (versions.map(v => v.hash).lastIndexOf(rv.toHash) + 1 || null) : versions.length || null
  const nowN = rv?.stale ? (rv.staleTo ?? versions.length) : versions.length || null
  /* how the downstream side was made: its own provenance (ADR-070) */
  const rec = isMakingRelation(rel.type) ? fromQ.data?.provenance ?? null : null
  return (
    <>
      {head}{sent}{slot}
      {rel.role && isMakingRelation(rel.type) && <KV rows={[[t('rel.role'), rel.role]]} />}
      {rel.type === 'source' && <>
        {rv?.stale && fromQ.data && <div className="mb-3"><StaleBanner lib={lib} asset={fromQ.data} /></div>}
        <KV rows={[[t('rel.then'), vLabel(thenN)], [t('rel.now'), vLabel(nowN)]]} />
      </>}
      {rec && <><div className="w2-rg-p__lab w2-rg-p__lab--sec">{t('rec.title')}</div><ProvenanceBody lib={lib} rec={rec} of={rel.from} names={names} onOpen={onOpen} /></>}
      {rel.note && rel.type !== 'uses' && <KV rows={[[t('w2.rel.note'), rel.note]]} />}
      <div className="w2-rg-p__foot">
        <Btn size="sm" icon="arrow-up-down" onClick={swap}>{t('rel.swap')}</Btn>
        <Btn size="sm" variant="ghost" icon="trash-2" onClick={() => void del()}>{t('rel.remove')}</Btn>
      </div>
    </>
  )
}
