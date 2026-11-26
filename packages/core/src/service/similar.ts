/** Tag governance helpers (api-and-agent.md「标签治理」): similar existing tags for a new one. */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]!
}

/** Normalized similarity 0..1 of two strings (1 = equal). */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (!x.length && !y.length) return 1
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

/**
 * Existing tags close to `tag`: same apart from case, one containing the other, a small edit distance,
 * or `tag` is an alias of an existing tag. Most used first, at most `limit`.
 */
export function similarTags(tag: string, existing: Map<string, number>, aliases: Map<string, string>, limit = 5): string[] {
  const t = tag.toLowerCase()
  const hits = new Map<string, number>()
  const scoreOf = (other: string): number => {
    const n = other.toLowerCase()
    if (n === t) return 3
    if (Math.min(n.length, t.length) >= 2 && (n.includes(t) || t.includes(n))) return 2
    const d = levenshtein(n, t)
    const maxLen = Math.max(n.length, t.length)
    return (maxLen >= 3 && d <= 1) || (maxLen >= 6 && d <= 2) ? 1 : 0
  }
  for (const name of existing.keys()) {
    if (name === tag) continue
    const score = scoreOf(name)
    if (score) hits.set(name, Math.max(hits.get(name) ?? 0, score))
  }
  // an old name kept as an alias points to the tag it became
  for (const [alias, canonical] of aliases) {
    if (canonical === tag || !existing.has(canonical)) continue
    const score = scoreOf(alias)
    if (score) hits.set(canonical, Math.max(hits.get(canonical) ?? 0, score))
  }
  return [...hits].sort((a, b) => b[1] - a[1] || (existing.get(b[0]) ?? 0) - (existing.get(a[0]) ?? 0) || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit).map(([n]) => n)
}
