/**
 * Query terms, text folding and hit snippets for the keyword search (search.md「关键词检索」, pages.md「搜索」:
 * 命中名称以外的地方时显示片段并高亮). Pure.
 *
 * Folding (NFKC, then lower case) is applied to the index and to the query alike, so full-width letters,
 * ligatures and case match. Highlight ranges are found in the folded text and mapped back to the original,
 * because folding can change lengths (`ﬁ` → `fi`, `İ` → `i̇`).
 */

/** NFKC + lower case: the form stored in the index and searched for. */
export function fold(s: string): string { return s.normalize('NFKC').toLowerCase() }

/** Terms of a query: whitespace separated, folded, unique; quotes and FTS syntax characters dropped. */
export function queryTerms(q: string): string[] {
  const out: string[] = []
  for (const raw of fold(q).split(/\s+/)) {
    const t = raw.replace(/["*^]/g, '').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Length in characters (code points), the unit of the trigram rule. */
export function charLength(s: string): number { return [...s].length }

/** Folded text with, for every folded UTF-16 unit, the original [start, end) it came from. */
export function foldMap(s: string): { text: string; start: Int32Array; end: Int32Array } {
  const parts: string[] = []
  const start: number[] = [], end: number[] = []
  let i = 0
  for (const cp of s) {
    const c = cp.charCodeAt(0)
    const f = c < 0x80 ? (c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : cp) : fold(cp)
    parts.push(f)
    for (let k = 0; k < f.length; k++) { start.push(i); end.push(i + cp.length) }
    i += cp.length
  }
  return { text: parts.join(''), start: Int32Array.from(start), end: Int32Array.from(end) }
}

/** Every occurrence of every (folded) term in `text`, as merged, sorted ranges of the original text. */
export function findRanges(text: string, terms: string[]): Array<[number, number]> {
  const m = foldMap(text)
  const raw: Array<[number, number]> = []
  for (const t of terms) {
    if (!t) continue
    for (let i = m.text.indexOf(t); i >= 0; i = m.text.indexOf(t, i + Math.max(1, t.length))) raw.push([m.start[i]!, m.end[i + t.length - 1]!])
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Array<[number, number]> = []
  for (const r of raw) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

export interface Snippet { text: string; ranges: Array<[number, number]> }

/**
 * A window of about `width` characters around the first match, with「…」where it was cut, and the highlight
 * ranges relative to the window. Null when no term occurs.
 */
export function makeSnippet(text: string, terms: string[], width = 64): Snippet | null {
  const flat = text.slice(0, 20_000).replace(/\s+/g, ' ').trim()
  const all = findRanges(flat, terms)
  if (!all.length) return null
  const first = all[0]!
  let start = Math.max(0, first[0] - Math.floor((width - (first[1] - first[0])) / 3))
  let end = Math.min(flat.length, Math.max(start + width, first[1]))
  start = Math.max(0, Math.min(start, end - width))
  // Never cut a highlighted word: widen the window to the whole of a match it would split.
  for (const r of all) { if (r[0] < end && r[1] > end) end = r[1]; if (r[0] < start && r[1] > start) start = r[0] }
  // Never cut a surrogate pair.
  if (start > 0 && /[\udc00-\udfff]/.test(flat[start] ?? '')) start--
  if (end < flat.length && /[\udc00-\udfff]/.test(flat[end] ?? '')) end++
  const pre = start > 0 ? '…' : '', post = end < flat.length ? '…' : ''
  const body = flat.slice(start, end)
  const ranges = all
    .filter(r => r[0] >= start && r[1] <= end)
    .map(r => [r[0] - start + pre.length, r[1] - start + pre.length] as [number, number])
  return { text: pre + body + post, ranges }
}
