/**
 * Line diff for the document compare view (builtin-plugins.md「文档 · 对比视图」): Myers' O(ND) algorithm on the
 * part between the common prefix and suffix, with a cap on the edit distance for huge rewrites. Pure.
 */

/** `=` same line (a and b index), `-` only in A, `+` only in B. */
export type Op = ['=', number, number] | ['-', number, null] | ['+', null, number]

/**
 * Edit distance explored before a changed run is shown as removed-then-added. The trace keeps only the live
 * diagonals of each step (2d + 1 entries), so memory stays near MAX_EDITS² / 1 entries (≈ 9 MB at 1500).
 */
export const MAX_EDITS = 1500

export function lineDiff(a: string[], b: string[], maxEdits = MAX_EDITS): Op[] {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const out: Op[] = []
  for (let i = 0; i < pre; i++) out.push(['=', i, i])
  out.push(...middle(a, b, pre, a.length - suf, pre, b.length - suf, maxEdits))
  for (let k = suf; k > 0; k--) out.push(['=', a.length - k, b.length - k])
  return out
}

function middle(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number, maxEdits: number): Op[] {
  const n = a1 - a0, m = b1 - b0
  if (!n && !m) return []
  const allChanged = (): Op[] => {
    const r: Op[] = []
    for (let i = a0; i < a1; i++) r.push(['-', i, null])
    for (let j = b0; j < b1; j++) r.push(['+', null, j])
    return r
  }
  if (!n || !m) return allChanged()
  const max = Math.min(n + m, maxEdits), off = max + 1
  const v = new Int32Array(2 * max + 3)
  /** trace[d] = v[off - d … off + d] before step d (only the diagonals step d can read). */
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d, off + d + 1))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) { found = d; break }
    }
    if (found >= 0) break
  }
  if (found < 0) return allChanged()
  // Walk the trace back from (n, m).
  const rev: Op[] = []
  let x = n, y = m
  for (let d = found; d > 0; d--) {
    const t = trace[d]!, at = (k: number) => t[k + d]!
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const px = at(prevK), py = px - prevK
    while (x > px && y > py) { x--; y--; rev.push(['=', a0 + x, b0 + y]) }
    if (x === px) { y--; rev.push(['+', null, b0 + y]) } else { x--; rev.push(['-', a0 + x, null]) }
  }
  while (x > 0 && y > 0) { x--; y--; rev.push(['=', a0 + x, b0 + y]) }
  return rev.reverse()
}

export function counts(ops: Op[]): { added: number; removed: number } {
  let added = 0, removed = 0
  for (const o of ops) { if (o[0] === '+') added++; else if (o[0] === '-') removed++ }
  return { added, removed }
}

export interface SideRow { left: { n: number; text: string; kind: 'same' | 'del' } | null; right: { n: number; text: string; kind: 'same' | 'add' } | null }

/** Side-by-side rows: unchanged lines pair up; each changed run pairs deletions with additions row by row. */
export function sideRows(ops: Op[], a: string[], b: string[]): SideRow[] {
  const rows: SideRow[] = []
  let k = 0
  while (k < ops.length) {
    const o = ops[k]!
    if (o[0] === '=') { rows.push({ left: { n: o[1] + 1, text: a[o[1]]!, kind: 'same' }, right: { n: o[2] + 1, text: b[o[2]]!, kind: 'same' } }); k++; continue }
    const dels: number[] = [], adds: number[] = []
    while (k < ops.length && ops[k]![0] !== '=') { const p = ops[k]!; if (p[0] === '-') dels.push(p[1]!); else adds.push(p[2]!); k++ }
    for (let r = 0; r < Math.max(dels.length, adds.length); r++) {
      const d = dels[r], ad = adds[r]
      rows.push({ left: d === undefined ? null : { n: d + 1, text: a[d]!, kind: 'del' }, right: ad === undefined ? null : { n: ad + 1, text: b[ad]!, kind: 'add' } })
    }
  }
  return rows
}

/** Split text into lines for diffing (a final newline adds no empty line). */
export function linesOf(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n')
  return (t.endsWith('\n') ? t.slice(0, -1) : t).split('\n')
}
