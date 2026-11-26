import { describe, expect, it } from 'vitest'
import { counts, lineDiff, linesOf, sideRows, type Op } from './diff.js'
import { docCompareModes, REASON_HTML, REASON_TEXT } from './rules.js'

/** Apply ops to rebuild B from A (validates any diff). */
function rebuild(ops: Op[], a: string[], b: string[]): { a: string[]; b: string[] } {
  const ra: string[] = [], rb: string[] = []
  for (const o of ops) {
    if (o[0] === '=') { expect(a[o[1]]).toBe(b[o[2]]); ra.push(a[o[1]]!); rb.push(b[o[2]]!) }
    if (o[0] === '-') ra.push(a[o[1]]!)
    if (o[0] === '+') rb.push(b[o[2]]!)
  }
  return { a: ra, b: rb }
}

describe('lineDiff', () => {
  it('finds the minimal edit for a changed line', () => {
    const a = linesOf('# 宝箱\n\n卡通风格\n\n## 规格\n')
    const b = linesOf('# 宝箱\n\n写实风格\n\n## 规格\n面数 5000\n')
    const ops = lineDiff(a, b)
    expect(counts(ops)).toEqual({ added: 2, removed: 1 })
    expect(rebuild(ops, a, b)).toEqual({ a, b })
  })
  it('handles empty sides and identical texts', () => {
    expect(counts(lineDiff([], ['x', 'y']))).toEqual({ added: 2, removed: 0 })
    expect(counts(lineDiff(['x'], []))).toEqual({ added: 0, removed: 1 })
    expect(lineDiff(['a', 'b'], ['a', 'b'])).toEqual([['=', 0, 0], ['=', 1, 1]])
  })
  it('stays correct on random edits', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
    for (let round = 0; round < 30; round++) {
      const a = Array.from({ length: 40 }, () => String(Math.floor(rnd() * 6)))
      const b = a.filter(() => rnd() > 0.2).flatMap(x => (rnd() > 0.85 ? [x, 'new'] : [x]))
      const ops = lineDiff(a, b)
      expect(rebuild(ops, a, b)).toEqual({ a, b })
    }
  })
  it('stays bounded on large, completely different texts', () => {
    const a = Array.from({ length: 20_000 }, (_, i) => `a${i}`), b = Array.from({ length: 20_000 }, (_, i) => `b${i}`)
    const t0 = performance.now()
    const ops = lineDiff(a, b)
    expect(performance.now() - t0).toBeLessThan(3000)
    expect(counts(ops)).toEqual({ added: 20_000, removed: 20_000 })
  })
  it('falls back to replace-all past the edit cap', () => {
    const ops = lineDiff(['a', 'b', 'c'], ['x', 'y', 'z'], 2)
    expect(counts(ops)).toEqual({ added: 3, removed: 3 })
  })
  it('pairs deletions and additions in side-by-side rows', () => {
    const a = ['same', 'old 1', 'old 2', 'end'], b = ['same', 'new 1', 'end']
    const rows = sideRows(lineDiff(a, b), a, b)
    expect(rows.map(r => [r.left?.kind ?? null, r.right?.kind ?? null])).toEqual([['same', 'same'], ['del', 'add'], ['del', null], ['same', 'same']])
    expect(rows[1]!.left!.n).toBe(2)
  })
  it('ignores the final newline and CRLF', () => {
    expect(linesOf('a\r\nb\r\n')).toEqual(['a', 'b'])
  })
})

describe('docCompareModes', () => {
  const d = (name: string, bundle = false) => ({ format: 'doc', name, bundle }) as never
  it('compares texts line by line, side by side or merged', () => {
    const m = docCompareModes(d('a.md'), d('b.txt'))!
    expect(m.filter(x => x.available).map(x => x.mode)).toEqual(['side', 'diff'])
    expect(m.find(x => x.mode === 'wipe')!.reason).toBe(REASON_TEXT)
  })
  it('puts two HTML prototypes side by side only', () => {
    const m = docCompareModes(d('a.html'), d('shop', true))!
    expect(m.filter(x => x.available).map(x => x.mode)).toEqual(['side'])
    expect(m.find(x => x.mode === 'diff')!.reason).toBe(REASON_HTML)
  })
  it('leaves HTML against text to the shell', () => {
    expect(docCompareModes(d('a.html'), d('b.md'))).toBeNull()
    expect(docCompareModes(d('a.md'), { format: 'image', name: 'x.png', bundle: false } as never)).toBeNull()
  })
})
