import * as React from 'react'
import type { AssetDetail, AssetSummary } from '@bowerbird/schema'
import { t } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { AssetThumb } from '../components/AssetThumb'
import { IssueMark, ReviewMark, StageMark, InfoBadge } from '../components/marks'
import { AssetContextMenu } from '../overlays/asset-actions'
import { Skeleton } from '../pages/shared/ui'
import { useSearch } from '../pages/shared/queries'
import { kindOf } from '../pages/shared/kinds'
import { usePluginRegistry } from '../plugins/registry'
import { badgeText } from '../plugins/text'

/** Purpose groups of a design object's members, in display order (prototype graph.js GROUPS). */
export const PURPOSES = ['art', 'model', 'texture', 'icon', 'sfx', 'anim', 'other'] as const
export type Purpose = (typeof PURPOSES)[number]

/** Which purpose an asset serves, from its format and tags (no manual labelling, ADR-013). */
export function purposeOf(a: Pick<AssetSummary, 'format' | 'name' | 'tags'>): Purpose {
  const k = kindOf(a)
  if (k === 'model' || /\.(blend|fbx|max|ma|mb)$/i.test(a.name)) return 'model'
  if (a.tags.includes('贴图') || a.tags.some(x => /^texture$/i.test(x))) return 'texture'
  if (a.tags.some(x => /^icon$/i.test(x)) || /icon/i.test(a.name)) return 'icon'
  if (k === 'image') return 'art'
  if (k === 'audio') return 'sfx'
  if (k === 'video') return 'anim'
  return 'other'
}

/**
 * 设计对象总览 (pages.md): target size from the document's front matter, the assets that belong to it grouped by
 * purpose, and stage / pending / issue counts.
 */
export function ObjectOverview({ lib, asset, onOpen }: { lib: string; asset: AssetDetail; onOpen(id: string): void }) {
  const q = useSearch(lib, { filter: { relation: { type: 'belongs', to: asset.id } }, limit: 1000, sort: 'name' })
  const members = q.data?.items ?? []
  const reg = usePluginRegistry()
  const stages = { reference: 0, production: 0, runtime: 0 }
  let pending = 0, issues = 0
  const groups = new Map<Purpose, AssetSummary[]>()
  for (const m of members) {
    stages[m.stage]++
    if (m.review === 'pending') pending++
    if (m.issueLevel === 'error' || m.issueLevel === 'warning') issues++
    const p = purposeOf(m)
    groups.set(p, [...(groups.get(p) ?? []), m])
  }
  const size = asset.targetSize && asset.targetSize.from === asset.id ? asset.targetSize : null
  return (
    <div className="w2-dcol w2-dcol--wide">
      <header className="w2-ov-head">
        <h1>{asset.cellText?.title || asset.name}</h1>
        {(asset.descriptionFull || asset.cellText?.excerpt) && <p>{asset.descriptionFull || asset.cellText?.excerpt}</p>}
        <div className="w2-ov-stats">
          {size && <span className="w2-ov-size" title={t('ov.sizeTip')}><Icon name="box" size={12} />{size.w} × {size.h} × {size.d} m</span>}
          <span>{t('ov.count', { n: q.data ? members.length : asset.memberCount })}</span>
          {(['reference', 'production', 'runtime'] as const).filter(s => stages[s]).map(s => <span key={s}><StageMark stage={s} size="sm" label="short" /> {stages[s]}</span>)}
          {pending > 0 && <span><ReviewMark review="pending" size="sm" label /> {pending}</span>}
          {issues > 0 && <span><IssueMark level="warning" /> {t('ov.issues', { n: issues })}</span>}
        </div>
      </header>
      {q.isPending ? <Skeleton rows={3} /> : PURPOSES.filter(p => groups.has(p)).map(p => (
        <section key={p}>
          <h4>{t(`ov.group.${p}`)}<span>{groups.get(p)!.length}</span></h4>
          <div className="w2-ov-grid">
            {groups.get(p)!.map(a => (
              <AssetContextMenu key={a.id} ids={[a.id]} context="grid">
                <button type="button" className="w2-ov-cell" onClick={() => onOpen(a.id)} title={a.path}>
                  <span className="w2-ov-cell__t">
                    <AssetThumb asset={a} size={128} fit="contain" />
                    <span className="w2-corner w2-corner--tl"><StageMark stage={a.stage} size="sm" /></span>
                    {a.review !== 'exempt' && <span className="w2-corner w2-corner--tr"><ReviewMark review={a.review} size="sm" /></span>}
                    {a.issueLevel && <span className="w2-corner w2-corner--bl"><IssueMark level={a.issueLevel} count={a.issueCount} flags={a.flags} /></span>}
                    {a.badge && <span className="w2-corner w2-corner--br"><InfoBadge text={badgeText(reg, a)} /></span>}
                  </span>
                  <span>{a.name}</span>
                </button>
              </AssetContextMenu>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
