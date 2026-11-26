import type { AssetSummary, Issue, IssueLevel, IssueType } from '@bowerbird/schema'
import { t } from '../../lib/i18n'
import { baseName, day } from '../shared/text'
import { pluginText } from '../../plugins/text'

/**
 * The integrity page's model (pages.md 完整性, copy.md 完整性): levels 错误 / 警告 / 提示 (ADR-035), the type names
 * people read, the sentence for each row, the row actions and the batch action of each type.
 */
export const LEVELS: IssueLevel[] = ['error', 'warning', 'info']
export const TYPE_ORDER: IssueType[] = [
  'broken-reference', 'missing-file', 'duplicate-guid', 'metadata-conflict',
  'stale-upstream', 'orphan-sidecar', 'pipeline-failed', 'plugin-missing',
  'thumbnail-stale', 'duplicate-content'
]
export const TYPE_ICON: Record<IssueType, string> = {
  'broken-reference': 'unlink', 'missing-file': 'file-question', 'duplicate-guid': 'copy', 'metadata-conflict': 'git-compare-arrows',
  'stale-upstream': 'circle-arrow-up', 'orphan-sidecar': 'file-question', 'pipeline-failed': 'triangle-alert', 'plugin-missing': 'puzzle',
  'thumbnail-stale': 'image', 'duplicate-content': 'copy'
}

/** Row action ids: API resolve actions (ISSUE_ACTIONS) plus UI ones that lead elsewhere. */
export type RowAction =
  | 'relink' | 'remove-relation' | 'restore-target'
  | 'relocate' | 'confirm-deleted'
  | 'swap-dialog' | 'confirm'
  | 'keep-dialog'
  | 'compare' | 'replace' | 'acknowledge'
  | 'trash'
  | 'log' | 'retry'
  | 'install'
  | 'clear-thumbnail' | 'reshot'
  | 'ignore' | 'mark-copy'

export const ROW_ACTIONS: Record<IssueType, RowAction[]> = {
  'broken-reference': ['relink', 'remove-relation', 'restore-target'],
  'missing-file': ['relocate', 'confirm-deleted'],
  'duplicate-guid': ['swap-dialog', 'confirm'],
  'metadata-conflict': ['keep-dialog'],
  'stale-upstream': ['compare', 'replace', 'acknowledge'],
  'orphan-sidecar': ['relocate', 'trash'],
  'pipeline-failed': ['log', 'retry'],
  'plugin-missing': ['install'],
  'thumbnail-stale': ['clear-thumbnail', 'reshot'],
  'duplicate-content': ['ignore', 'mark-copy']
}

/** The row action that is a dialog, opened directly when a link points at the issue (`/issues?issue=<id>`). */
export const DIALOG_ACTION: Partial<Record<IssueType, RowAction>> = {
  'missing-file': 'relocate',
  'orphan-sidecar': 'relocate',
  'duplicate-guid': 'swap-dialog',
  'metadata-conflict': 'keep-dialog',
  'pipeline-failed': 'log'
}

/**
 * 同类批量「全部…」: the type's main action, only where it needs no choice per row (a dialog or a jump cannot be
 * done for many at once).
 */
export const BATCH_ACTION: Partial<Record<IssueType, RowAction>> = {
  'broken-reference': 'restore-target',
  'duplicate-guid': 'confirm',
  'stale-upstream': 'acknowledge',
  'pipeline-failed': 'retry',
  'duplicate-content': 'mark-copy'
}

export interface IssueGroup { level: IssueLevel; types: Array<{ type: IssueType; issues: Issue[] }>; count: number }

/** Group by level (错误 → 警告 → 提示), then by type in a fixed order; empty groups are left out. */
export function groupIssues(issues: Issue[], level: IssueLevel | 'all' = 'all'): IssueGroup[] {
  const out: IssueGroup[] = []
  for (const l of LEVELS) {
    if (level !== 'all' && level !== l) continue
    const inLevel = issues.filter(i => i.level === l)
    if (!inLevel.length) continue
    const types = TYPE_ORDER.map(type => ({ type, issues: inLevel.filter(i => i.type === type) })).filter(g => g.issues.length)
    out.push({ level: l, types, count: inLevel.length })
  }
  return out
}

export function levelCounts(issues: Issue[]): Record<IssueLevel, number> {
  const c = { error: 0, warning: 0, info: 0 }
  for (const i of issues) c[i.level]++
  return c
}

/** Distinct assets (or stray files) with a problem — the same count as the side bar's「有问题」(E-09). */
export function assetCount(issues: Issue[]): number {
  return new Set(issues.map(i => i.assetId ?? `path:${i.path ?? i.id}`)).size
}

const str = (v: unknown) => (v == null ? '' : String(v))
const VERB: Record<string, string> = { source: 'w2.rel.type.source', uses: 'w2.rel.type.uses', belongs: 'w2.rel.type.belongs' }

/** The name shown on the row. */
export function issueName(i: Issue, assets: Record<string, AssetSummary>): string {
  const a = i.assetId ? assets[i.assetId] : undefined
  return a?.name ?? baseName(i.path ?? (str(i.details.name) || i.id))
}

/** The other asset of a relation / duplicate, by name. */
export function otherName(i: Issue, assets: Record<string, AssetSummary>): string {
  const d = i.details
  const id = str(d.otherId) || i.relation?.to
  return str(d.toName) || str(d.otherName) || (id && assets[id]?.name) || str(d.otherPath) || id || ''
}

/** The row's sentence (copy.md 完整性「行内说明」). */
export function issueText(i: Issue, assets: Record<string, AssetSummary>, inTrash: boolean): string {
  const d = i.details
  const a = i.assetId ? assets[i.assetId] : undefined
  switch (i.type) {
    case 'broken-reference':
      return t('iss.text.broken', { verb: t(VERB[i.relation?.type ?? ''] ?? 'w2.rel.type.other'), name: otherName(i, assets) }) + (inTrash ? t('iss.text.inTrash') : '')
    case 'missing-file': return t('iss.text.missing', { path: i.path ?? a?.path ?? '' })
    case 'duplicate-guid': return t('iss.text.identity', { name: otherName(i, assets) })
    /* the file name only, as in copy.md / the prototype; the folder is on the row's second line */
    case 'metadata-conflict': return t('iss.text.conflict', { file: baseName(str(d.conflictPath) || i.path || '') })
    case 'stale-upstream': return t('iss.text.stale', { name: otherName(i, assets), a: str(d.fromVersion) || '?', b: str(d.toVersion) || '?' })
    case 'orphan-sidecar': return t('iss.text.orphan', { name: baseName((i.path ?? '').replace(/\.bmeta$/, '')) })
    case 'pipeline-failed': return t('iss.text.failed', { stage: d.stage ? t(`stage.${str(d.stage)}`) : t('iss.text.process'), error: str(d.error) })
    case 'plugin-missing': return t('iss.text.plugin', { plugin: pluginText(str(d.plugin), str(d.displayName) || str(d.plugin)), id: [str(d.plugin), str(d.range)].filter(Boolean).join(' ') })
    case 'thumbnail-stale': return t('iss.text.thumb', { a: day(str(d.thumbAt) || null), b: day(str(d.contentAt) || null) })
    /* the other file by its path when the two share a name (ui/hud/panel_bg.png = ui/shop/panel_bg.png; pages.js) */
    case 'duplicate-content': {
      const other = otherName(i, assets), self = i.assetId ? assets[i.assetId]?.name : baseName(i.path ?? '')
      return t('iss.text.dup', { name: other === self && str(d.otherPath) ? str(d.otherPath) : other })
    }
  }
}
