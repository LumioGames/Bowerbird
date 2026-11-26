import type { AssetSummary, ReviewStatus, Stage } from '@bowerbird/schema'
import { Button } from '@bowerbird/plugin-sdk/web'
import { AssetThumb } from '../components/AssetThumb'
import { Section, TagChip, TagInput } from '../components/blocks'
import { Icon } from '../components/Icon'
import { ReviewMark, StageMark } from '../components/marks'
import { t } from '../lib/i18n'
import { fmtSize } from '../lib/format'
import * as A from '../flows/actions'
import { ReviewSelect, StageChips } from './Single'

/**
 * Several selected (web-shell.md: batch editing): common tags (a tag on some shows n/m — click adds it to all),
 * stage and review for all (a mix is shown first), move, move to trash.
 */
function mix<K extends string>(as: AssetSummary[], key: (a: AssetSummary) => K): { same: K | null; counts: Array<[K, number]> } {
  const m = new Map<K, number>()
  for (const a of as) m.set(key(a), (m.get(key(a)) ?? 0) + 1)
  return { same: m.size === 1 ? [...m.keys()][0]! : null, counts: [...m] }
}

export function BatchInspector({ assets, ids }: { assets: AssetSummary[]; ids: string[] }) {
  const st = mix<Stage>(assets, a => a.stage)
  const rv = mix<ReviewStatus>(assets, a => a.review)
  const bytes = assets.reduce((s, a) => s + a.size, 0)
  const tagCount = new Map<string, number>()
  for (const a of assets) for (const tg of a.tags) tagCount.set(tg, (tagCount.get(tg) ?? 0) + 1)
  const tags = [...tagCount].sort((x, y) => y[1] - x[1])
  const n = ids.length
  return (
    <>
      <div className="flex items-center gap-3 p-4">
        <div className="relative h-14 w-16 shrink-0">
          {assets.slice(0, 3).map((a, i) => (
            <span key={a.id} className="absolute size-11 overflow-hidden rounded-sm shadow-[0_0_0_2px_var(--surface-panel)]"
              style={{ left: i * 10, top: [12, 6, 0][i], transform: i === 0 ? 'rotate(-6deg)' : i === 2 ? 'rotate(6deg)' : undefined }}>
              <AssetThumb asset={a} fit="cover" />
            </span>
          ))}
        </div>
        <div>
          <b className="block text-[15px] leading-5 font-semibold tracking-[-0.01em]">{t('insp.selectedN', { n })}</b>
          <small className="text-[12px] text-ink-2">{fmtSize(bytes)}</small>
        </div>
      </div>
      <Section title={t('insp.tags')} id="batch.tags">
        <div className="flex flex-wrap gap-1">
          {tags.map(([tg, c]) => c === n
            ? <TagChip key={tg} text={tg} onRemove={() => void A.editTags(ids, { remove: [tg] })} />
            : <TagChip key={tg} text={tg} partial count={`${c}/${n}`} onClick={() => void A.editTags(ids, { add: [tg] })} />)}
          <TagInput placeholder={t('insp.addToAll')} label={t('insp.addTagAll')} onAdd={v => void A.editTags(ids, { add: [v] })} />
        </div>
      </Section>
      <Section title={t('insp.stage')} id="batch.stage">
        {!st.same && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2">{st.counts.map(([k, c]) => <span key={k}><StageMark stage={k} label="short" /> {c}</span>)}</div>}
        <StageChips value={st.same} onPick={s => void A.setStage(ids, s)} />
      </Section>
      <Section title={t('insp.review')} id="batch.review">
        {!rv.same && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2">{rv.counts.map(([k, c]) => <span key={k}><ReviewMark review={k} label /> {c}</span>)}</div>}
        <div><ReviewSelect value={rv.same} onPick={r => void A.setReview(ids, r)} /></div>
      </Section>
      <section className="px-4 pt-2 pb-3 shadow-[inset_0_1px_0_var(--line-hairline)]">
        <div className="flex gap-1">
          <Button onClick={() => void A.moveDialog(ids)}><Icon name="folder-input" />{t('act.move')}</Button>
          <Button onClick={() => void A.trashAssets(ids)}><Icon name="trash-2" />{t('act.trash')}</Button>
        </div>
      </section>
    </>
  )
}
