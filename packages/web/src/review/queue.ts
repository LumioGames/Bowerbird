import type { AssetSummary, Filter } from '@bowerbird/schema'

/**
 * Review queue rules (pages.md 校验队列, deviations 第二类第 3 条): assets that cannot be reviewed right now are kept
 * out of the queue — and counted, with the reason — instead of being dropped silently.
 */
export type HeldReason = 'missing' | 'processing' | 'unviewable' | 'plugin' | 'error'

export function heldWhy(a: Pick<AssetSummary, 'flags' | 'missingPlugin' | 'issueLevel' | 'format' | 'thumbState'>): HeldReason | null {
  if (a.flags.includes('missing')) return 'missing'
  if (a.flags.includes('processing')) return 'processing'
  /* before「无法显示」: an asset that needs a missing plugin is also of an unknown format here (hero_run.skel) */
  if (a.missingPlugin) return 'plugin'
  if (a.flags.includes('failed') || a.format === 'unknown') return 'unviewable'
  if (a.issueLevel === 'error') return 'error'
  return null
}

/** Queue scope (复用筛选条件): everything pending, one folder, or one format. Kept in the URL. */
export interface Scope { folder?: string; format?: string }
export function scopeFilter(s: Scope): Filter {
  const f: Filter = { review: ['pending'] }
  if (s.folder) f.folder = s.folder
  if (s.format) f.format = [s.format]
  return f
}

/** Split the pending list into the queue (start first, if given) and the held-back ones. */
export function splitQueue(items: AssetSummary[], start?: string | null): { queue: AssetSummary[]; held: Array<{ asset: AssetSummary; why: HeldReason }> } {
  const queue: AssetSummary[] = []
  const held: Array<{ asset: AssetSummary; why: HeldReason }> = []
  for (const a of items) {
    const why = heldWhy(a)
    if (why) held.push({ asset: a, why }); else queue.push(a)
  }
  if (start) {
    const i = queue.findIndex(a => a.id === start)
    if (i > 0) queue.unshift(...queue.splice(i, 1))
  }
  return { queue, held }
}

export interface Tally { approved: string[]; rejected: string[]; skipped: string[] }
export const emptyTally = (): Tally => ({ approved: [], rejected: [], skipped: [] })
