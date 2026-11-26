import { describe, expect, it } from 'vitest'
import { deltaMode, deltaText, techRows } from './tech'

describe('technical information table', () => {
  it('writes the change as「+168 · +7%」', () => {
    expect(deltaText('triangles', 2312, 2480)).toBe('+168 · +7%')
    expect(deltaText('triangles', 2480, 2312)).toBe('−168 · −7%')
    expect(deltaText('size', 612_000, 598_000)).toBe('−14 KB')
    expect(deltaText('width', 0, 512)).toBe('+512')
  })

  it('two versions of one asset read new minus old, whichever side is older', () => {
    expect(deltaMode('x', 'x', 'model', 'model')).toBe('new-minus-old')
    const v1 = { tech: { triangles: 2312 }, size: 1_080_000, n: 1 }
    const v2 = { tech: { triangles: 2480 }, size: 1_200_000, n: 2 }
    const ab = techRows(v1, v2, { triangles: '三角面' }, 'new-minus-old', '文件大小')
    expect(ab[0]).toMatchObject({ label: '三角面', a: '2,312', b: '2,480', differs: true, deltaOn: 'b', delta: '+168 · +7%' })
    /* newer on the left: the change still reads new minus old, shown on the newer side */
    const ba = techRows(v2, v1, { triangles: '三角面' }, 'new-minus-old', '文件大小')
    expect(ba[0]).toMatchObject({ deltaOn: 'a', delta: '+168 · +7%' })
    expect(ab[ab.length - 1]).toMatchObject({ key: 'size', label: '文件大小', delta: '+120 KB' })
  })

  it('two different assets read B relative to A; different kinds show no change', () => {
    expect(deltaMode('a', 'b', 'image', 'image')).toBe('b-vs-a')
    expect(deltaMode('a', 'b', 'model', 'image')).toBeNull()
    const rows = techRows({ tech: { width: 1024 }, size: 10 }, { tech: { width: 512 }, size: 10 }, { width: '宽' }, 'b-vs-a', '文件大小')
    expect(rows[0]).toMatchObject({ differs: true, deltaOn: 'b', delta: '−512 · −50%' })
    expect(rows[1]).toMatchObject({ differs: false, delta: '' })
    const none = techRows({ tech: { width: 1024 }, size: 10 }, { tech: { triangles: 8 }, size: 20 }, {}, null, '文件大小')
    expect(none.every(r => !r.differs && !r.delta)).toBe(true)
  })

  it('orders rows by the plugin labels, then the rest, size last', () => {
    const rows = techRows({ tech: { b: 1, a: 2, z: 3 }, size: 1 }, { tech: { b: 1 }, size: 1 }, { z: 'Z', b: 'B' }, 'b-vs-a', 'size')
    expect(rows.map(r => r.key)).toEqual(['z', 'b', 'a', 'size'])
    expect(rows.find(r => r.key === 'a')).toMatchObject({ a: '2', b: '—', differs: false })
  })
})
