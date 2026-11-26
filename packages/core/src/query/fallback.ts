/**
 * Query words without any search plugin: substring match on name, tags and description (ADR-003: search keeps
 * working without plugins). Every word must match somewhere; name hits weigh more than tag hits, tag hits more
 * than description hits.
 */
import type { AssetSummary, HitSnippet } from '@bowerbird/schema'

export function queryWords(q: string): string[] {
  return [...new Set(q.split(/\s+/).map(w => w.trim()).filter(Boolean))]
}

function likePattern(word: string): string {
  return '%' + word.replace(/[\\%_]/g, m => '\\' + m) + '%'
}

/** SQL condition (every word matches) and score expression over alias `a`, with their parameters. */
export function substringSql(words: string[], humanTagsOnly: boolean): { cond: string; condParams: unknown[]; score: string; scoreParams: unknown[] } {
  const ai = humanTagsOnly ? ' AND ai = 0' : ''
  const conds: string[] = []
  const condParams: unknown[] = []
  const scores: string[] = []
  const scoreParams: unknown[] = []
  for (const w of words) {
    const p = likePattern(w)
    const tag = `a.id IN (SELECT asset_id FROM tags WHERE tag LIKE ? ESCAPE '\\'${ai})`
    conds.push(`(a.name LIKE ? ESCAPE '\\' OR ${tag} OR a.description LIKE ? ESCAPE '\\' OR a.auto_description LIKE ? ESCAPE '\\')`)
    condParams.push(p, p, p, p)
    scores.push(`(CASE WHEN a.name LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END) + (CASE WHEN ${tag} THEN 2 ELSE 0 END) + (CASE WHEN a.description LIKE ? ESCAPE '\\' OR a.auto_description LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`)
    scoreParams.push(p, p, p, p)
  }
  return { cond: conds.join(' AND '), condParams, score: scores.length ? scores.join(' + ') : '0', scoreParams }
}

function ranges(text: string, words: string[]): Array<[number, number]> {
  const lower = text.toLowerCase()
  const out: Array<[number, number]> = []
  for (const w of words) {
    const lw = w.toLowerCase()
    let i = lower.indexOf(lw)
    while (i >= 0 && lw.length > 0) { out.push([i, i + lw.length]); i = lower.indexOf(lw, i + lw.length) }
  }
  return out.sort((x, y) => x[0] - y[0])
}

/** Excerpt of at most ~120 characters around the first match, ranges shifted to the excerpt. */
function excerpt(text: string, words: string[]): { text: string; ranges: Array<[number, number]> } {
  const all = ranges(text, words)
  const first = all[0]?.[0] ?? 0
  const start = Math.max(0, first - 40)
  const end = Math.min(text.length, start + 120)
  const piece = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
  const shift = start > 0 ? start - 1 : 0
  return { text: piece, ranges: all.filter(([s, e]) => s >= start && e <= end).map(([s, e]) => [s - shift, e - shift]) }
}

/** Snippet for a fallback hit: nothing when the name matched (the name is highlighted by the shell). */
export function fallbackSnippet(s: AssetSummary, words: string[], full: { description: string | null; autoDescription: string | null }): HitSnippet | undefined {
  const has = (text: string | null | undefined): boolean => !!text && words.some(w => text.toLowerCase().includes(w.toLowerCase()))
  if (has(s.name)) return undefined
  const tag = [...s.tags, ...s.autoTags].find(t => has(t))
  if (tag) return { field: 'tags', text: tag, ranges: ranges(tag, words) }
  const desc = has(full.description) ? full.description : has(full.autoDescription) ? full.autoDescription : null
  if (desc) { const e = excerpt(desc, words); return { field: 'description', text: e.text, ranges: e.ranges } }
  return undefined
}
