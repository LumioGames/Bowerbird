import type { AssetSummary, ReviewStatus, Stage } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { Icon } from './Icon'
import { t } from '../lib/i18n'

/**
 * State marks (design-system StateMarks). Four groups that cannot be mistaken for one another, even without colour:
 *   stage  — top-left on a thumbnail: a disc whose FILL LEVEL says the stage (hollow / half / solid)
 *   review — top-right: a rounded square holding a line icon (exempt shows nothing)
 *   issue  — bottom-left: a solid flag flush with the edge, the only filled mark, with a count
 *   info   — bottom-right: plain text from the format plugin (宽×高 / 时长 / 面数 / 版本)
 * Inline (with words) in lists and the inspector; `corner` draws the thumbnail mark.
 * Shared by grid, inspector, graph, compare, trash (web-2 uses them too).
 */
const STAGE_VAR: Record<Stage, string> = { reference: 'var(--stage-reference)', production: 'var(--stage-production)', runtime: 'var(--stage-runtime)' }

function StageGlyph({ stage, px = 10 }: { stage: Stage; px?: number }) {
  const c = STAGE_VAR[stage]
  const bg = stage === 'runtime' ? c : stage === 'production' ? `linear-gradient(90deg, ${c} 50%, transparent 50%)` : 'transparent'
  return <i aria-hidden className="block shrink-0 rounded-full" style={{ width: px, height: px, background: bg, boxShadow: `inset 0 0 0 1.5px ${c}` }} />
}

export function StageMark({ stage, size = 'md', label = 'none', corner }: { stage: Stage; size?: 'sm' | 'md'; label?: 'none' | 'short' | 'long'; corner?: boolean }) {
  const title = t('stage.' + stage)
  if (corner) {
    return (
      <span title={title} role="img" aria-label={title} data-stage={stage} className="inline-flex size-[18px] items-center justify-center rounded-full bg-material-mark">
        <StageGlyph stage={stage} />
      </span>
    )
  }
  return (
    <span title={title} {...(label === 'none' ? { role: 'img', 'aria-label': title } : {})} data-stage={stage} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2', size === 'sm' ? 'text-[11px] leading-[14px]' : 'text-[12px] leading-4')}>
      <StageGlyph stage={stage} px={size === 'sm' ? 8 : 10} />
      {label !== 'none' && <span>{t((label === 'short' ? 'stage.short.' : 'stage.') + stage)}</span>}
    </span>
  )
}

const REVIEW_ICON: Record<ReviewStatus, string> = { pending: 'clock', approved: 'check', rejected: 'undo-2', exempt: 'minus' }
const REVIEW_COLOR: Record<ReviewStatus, string> = { pending: 'text-ink-1', approved: 'text-accent-ink', rejected: 'text-danger-ink', exempt: 'text-ink-3' }

export function ReviewMark({ review, size = 'md', label = false, corner }: { review: ReviewStatus; size?: 'sm' | 'md'; label?: boolean; corner?: boolean }) {
  const title = t('review.' + review)
  if (corner) {
    if (review === 'exempt') return null
    return (
      <span title={title} role="img" aria-label={title} data-review={review} className={cn('inline-flex size-[18px] items-center justify-center rounded-xs bg-material-mark', review === 'approved' ? 'text-accent-ink' : review === 'rejected' ? 'text-danger-ink' : 'text-ink-1')}>
        <Icon name={REVIEW_ICON[review]} size={12} />
      </span>
    )
  }
  return (
    <span title={title} {...(!label ? { role: 'img', 'aria-label': title } : {})} data-review={review} className={cn('inline-flex items-center gap-1 whitespace-nowrap text-ink-2', size === 'sm' ? 'text-[11px] leading-[14px]' : 'text-[12px] leading-4')}>
      <span className={REVIEW_COLOR[review]}><Icon name={review === 'approved' && label ? 'badge-check' : REVIEW_ICON[review]} size={label ? 16 : 12} /></span>
      {label && <span>{title}</span>}
    </span>
  )
}

/** The icon an issue flag shows: what is wrong first (missing, broken, failed, stale), else the level. */
export function issueIcon(level: 'error' | 'warning' | 'info' | null, flags?: AssetSummary['flags']): string {
  if (flags?.includes('missing')) return 'file-question'
  if (flags?.includes('broken')) return 'unlink'
  if (flags?.includes('failed')) return 'triangle-alert'
  if (flags?.includes('stale')) return 'circle-arrow-up'
  return level === 'error' ? 'circle-alert' : level === 'warning' ? 'triangle-alert' : 'info'
}

export function issueTitle(level: 'error' | 'warning' | 'info' | null, flags?: AssetSummary['flags']): string {
  for (const f of ['missing', 'broken', 'failed', 'stale'] as const) if (flags?.includes(f)) return t('flag.' + f)
  return level ? t('level.' + level) : ''
}

export function IssueMark({ level, count, flags, label, corner = true }: { level: 'error' | 'warning' | 'info' | null; count?: number; flags?: AssetSummary['flags']; label?: string | boolean; corner?: boolean }) {
  if (!level) return null
  const icon = issueIcon(level, flags)
  const title = issueTitle(level, flags)
  if (!corner || label) {
    return (
      <span title={title} {...(!label ? { role: 'img', 'aria-label': title } : {})} data-level={level} className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] leading-4 text-ink-1">
        <span className={level === 'error' ? 'text-danger-ink' : level === 'warning' ? 'text-warning-ink' : 'text-ink-3'}><Icon name={icon} size={label ? 16 : 12} /></span>
        {label && <span>{typeof label === 'string' ? label : title}</span>}
      </span>
    )
  }
  return (
    <span
      title={title}
      role="img"
      aria-label={count != null && count > 1 ? `${title} ${count}` : title}
      data-level={level}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-r-xs pr-[5px] pl-1 text-[11px] leading-[14px] font-semibold tabular-nums',
        level === 'error' ? 'bg-danger-fill text-danger-on' : level === 'warning' ? 'bg-warning-fill text-warning-on' : 'bg-material-mark text-ink-1'
      )}
    >
      <Icon name={icon} size={12} />
      {count != null && count > 1 && <span>{count}</span>}
    </span>
  )
}

export function InfoBadge({ text }: { text: string | null }) {
  if (!text) return null
  return <span className="inline-flex h-[18px] items-center rounded-xs bg-material-mark px-1 text-[11px] leading-[14px] whitespace-nowrap tabular-nums text-ink-1">{text}</span>
}
