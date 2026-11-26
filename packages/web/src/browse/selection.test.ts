import { describe, expect, it } from 'vitest'
import { clickMode, marquee, moveFocus, NO_SELECTION, select, selectAll } from './selection'
import { gridGeom, gridRange, listRange, masonryGeom, masonryVisible } from './layout'

const order = ['a', 'b', 'c', 'd', 'e', 'f']

describe('selection', () => {
  it('single click, toggle with the modifier, range with shift', () => {
    let s = select(NO_SELECTION, order, 'b', 'one')
    expect(s.ids).toEqual(['b'])
    s = select(s, order, 'e', 'range')
    expect(s.ids).toEqual(['b', 'c', 'd', 'e'])
    expect(s.anchor).toBe('b')
    s = select(s, order, 'c', 'toggle')
    expect(s.ids).toEqual(['b', 'd', 'e'])
    s = select(s, order, 'a', 'range')
    expect(s.ids).toEqual(['a', 'b', 'c'])
  })

  it('range upwards from the anchor', () => {
    const s = select(select(NO_SELECTION, order, 'e', 'one'), order, 'b', 'range')
    expect(s.ids).toEqual(['b', 'c', 'd', 'e'])
  })

  it('maps modifier keys per platform', () => {
    expect(clickMode({ metaKey: true, ctrlKey: false, shiftKey: false }, true)).toBe('toggle')
    expect(clickMode({ metaKey: true, ctrlKey: false, shiftKey: false }, false)).toBe('one')
    expect(clickMode({ metaKey: false, ctrlKey: true, shiftKey: false }, false)).toBe('toggle')
    expect(clickMode({ metaKey: false, ctrlKey: false, shiftKey: true }, true)).toBe('range')
  })

  it('select all keeps the focus', () => {
    const s = selectAll(order, select(NO_SELECTION, order, 'c', 'one'))
    expect(s.ids).toEqual(order)
    expect(s.focus).toBe('c')
  })

  it('marquee adds the cells under the box to the base', () => {
    const cells = [
      { id: 'a', rect: { left: 0, top: 0, right: 100, bottom: 100 } },
      { id: 'b', rect: { left: 110, top: 0, right: 210, bottom: 100 } },
      { id: 'c', rect: { left: 0, top: 110, right: 100, bottom: 210 } }
    ]
    expect(marquee([], { left: 50, top: 50, right: 150, bottom: 60 }, cells)).toEqual(['a', 'b'])
    expect(marquee(['c'], { left: 120, top: 10, right: 130, bottom: 20 }, cells)).toEqual(['c', 'b'])
  })

  it('arrow keys in a grid move by one or by a row', () => {
    expect(moveFocus(order, 'b', 'right', { cols: 3 })).toBe('c')
    expect(moveFocus(order, 'b', 'down', { cols: 3 })).toBe('e')
    expect(moveFocus(order, 'e', 'up', { cols: 3 })).toBe('b')
    expect(moveFocus(order, 'a', 'up', { cols: 3 })).toBe('a')
    expect(moveFocus(order, null, 'down', { cols: 3 })).toBe('a')
  })

  it('arrow keys in masonry pick the nearest cell below', () => {
    const rects = new Map([
      ['a', { left: 0, top: 0, right: 100, bottom: 80 }],
      ['b', { left: 104, top: 0, right: 204, bottom: 150 }],
      ['c', { left: 0, top: 84, right: 100, bottom: 200 }]
    ])
    expect(moveFocus(['a', 'b', 'c'], 'a', 'down', { rects })).toBe('c')
    expect(moveFocus(['a', 'b', 'c'], 'c', 'up', { rects })).toBe('a')
  })
})

describe('virtual scrolling geometry', () => {
  it('a 100,000-asset grid only asks for the rows in view', () => {
    const g = gridGeom(1000, 168, 100_000)
    expect(g.cols).toBe(5)
    const r = gridRange(g, 100_000, 50_000, 800)
    expect(r.end - r.start).toBeLessThanOrEqual(g.cols * (Math.ceil(800 / (g.cellH + 4)) + 5))
    expect(r.start).toBeGreaterThan(0)
  })

  it('masonry places each cell in the shortest column and finds the visible ones', () => {
    const m = masonryGeom(400, 196, [1, 0.5, 2, 1])
    expect(m.cols).toBe(2)
    // third cell goes under the shorter first column
    expect(m.pos[2 * 4]).toBe(0)
    const vis = masonryVisible(m, 0, 100, 0)
    expect(vis).toContain(0)
    expect(vis).toContain(1)
  })

  it('list rows', () => {
    expect(listRange(1000, 360, 360, 0)).toEqual({ start: 10, end: 20 })
  })
})
