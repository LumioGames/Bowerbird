import type { AssetSummary } from '@bowerbird/schema'
import { t } from '../lib/i18n'
import type { MenuEntry } from '../pages/shared/menu'
import { kindOf } from '../pages/shared/kinds'
import type { RelRef } from './build'

export interface PointAt { x: number; y: number }
export interface LinkMenuDeps {
  /** Would「a 由 b 产出」close a loop of source relations? */
  wouldCycle(a: string, b: string): boolean
  existing: RelRef[]
  onSource(a: AssetSummary, b: AssetSummary): void
  onAdd(type: 'uses' | 'belongs', a: AssetSummary, b: AssetSummary): void
  /** Show a menu at a point (the graph's PointMenu). */
  open(menu: PointAt & { items: MenuEntry[] }): void
}

/**
 * The menu after dragging a link from `a` onto `b` (graph.js): 来源 / 引用 / 归属 as sentences, a source that would
 * close a loop and a relation that already exists are disabled with the reason; 对调方向 shows the same menu again,
 * at the same place, with the two ends swapped (choosing an item closes the menu first, so it reopens on the next tick).
 */
export function linkMenu(a: AssetSummary, b: AssetSummary, at: PointAt, d: LinkMenuDeps): MenuEntry[] {
  const item = (type: 'source' | 'uses' | 'belongs', icon: string): MenuEntry => {
    const cyc = type === 'source' && d.wouldCycle(a.id, b.id)
    const dup = d.existing.some(r => r.from === a.id && r.to === b.id && r.type === type && !r.slot)
    const bad = type === 'belongs' && kindOf(b) !== 'doc'
    return {
      icon,
      label: <span>{t(`rel.sentShort.${type}`, { a: a.name, b: b.name })}{cyc ? <small className="ml-2 text-ink-3">{t('rel.wouldCycle')}</small> : dup ? <small className="ml-2 text-ink-3">{t('rel.already')}</small> : null}</span>,
      disabled: cyc || dup || bad,
      onSelect: () => { if (type === 'source') d.onSource(a, b); else d.onAdd(type, a, b) }
    }
  }
  return [item('source', 'arrow-right'), item('uses', 'link'), item('belongs', 'layers'), { kind: 'sep' },
    { icon: 'arrow-up-down', label: t('rel.flip'), onSelect: () => { setTimeout(() => d.open({ ...at, items: linkMenu(b, a, at, d) }), 0) } }]
}
