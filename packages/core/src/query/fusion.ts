/**
 * Reciprocal rank fusion of several providers' hit lists (search.md「检索与融合」). Only ranks are used, so a new
 * provider needs no tuning. With a single list the provider's own order and scores are kept.
 */
import type { HitSnippet } from '@bowerbird/schema'
import type { ScoredHit } from '@bowerbird/plugin-sdk'

export const RRF_K = 60

export interface FusedHit { id: string; score: number; hit?: HitSnippet }

function byScore(hits: ScoredHit[]): ScoredHit[] {
  // Providers should return best first; sort defensively (stable for equal scores).
  return hits.map((h, i) => ({ h, i })).sort((x, y) => (y.h.score - x.h.score) || (x.i - y.i)).map(x => x.h)
}

function dedupe(hits: ScoredHit[]): ScoredHit[] {
  const seen = new Set<string>()
  return hits.filter(h => (seen.has(h.id) ? false : (seen.add(h.id), true)))
}

export function fuse(lists: ScoredHit[][], k: number = RRF_K): FusedHit[] {
  const nonEmpty = lists.filter(l => l.length > 0)
  if (nonEmpty.length === 0) return []
  if (nonEmpty.length === 1) {
    return dedupe(byScore(nonEmpty[0]!)).map(h => ({ id: h.id, score: h.score, ...(h.snippet ? { hit: h.snippet } : {}) }))
  }
  const acc = new Map<string, { score: number; best: number; hit?: HitSnippet; hitRank: number }>()
  for (const list of nonEmpty) {
    dedupe(byScore(list)).forEach((h, i) => {
      const rank = i + 1
      const e = acc.get(h.id) ?? { score: 0, best: Infinity, hitRank: Infinity }
      e.score += 1 / (k + rank)
      e.best = Math.min(e.best, rank)
      if (h.snippet && rank < e.hitRank) { e.hit = h.snippet; e.hitRank = rank }
      acc.set(h.id, e)
    })
  }
  return [...acc.entries()]
    .sort((x, y) => (y[1].score - x[1].score) || (x[1].best - y[1].best) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([id, e]) => ({ id, score: e.score, ...(e.hit ? { hit: e.hit } : {}) }))
}
