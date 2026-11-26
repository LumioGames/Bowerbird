import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { OVERSCAN, VirtualRows, windowOf } from './VirtualRows'

afterEach(() => cleanup())

describe('virtual rows (回收站 / 完整性 lists)', () => {
  it('mounts the rows in view plus the overscan, from where the list starts in the scroller', () => {
    expect(windowOf(10_000, 40, 0, 400)).toEqual({ start: 0, end: 10 + OVERSCAN })
    // scrolled 4000 px into the list: rows 100..110 are in view
    expect(windowOf(10_000, 40, -4000, 400)).toEqual({ start: 100 - OVERSCAN, end: 110 + OVERSCAN })
    // a list further down the page that is not reached yet
    expect(windowOf(50, 40, 2000, 400)).toEqual({ start: 0, end: 0 })
    expect(windowOf(5, 40, 0, 400)).toEqual({ start: 0, end: 5 })
  })

  it('10 000 rows: only a slice is in the DOM and the spacers keep the full height', () => {
    const { container } = render(<div style={{ overflowY: 'auto', height: 400 }}><VirtualRows count={10_000} rowHeight={44}>{i => <div data-row={i}>row {i}</div>}</VirtualRows></div>)
    const rows = container.querySelectorAll('[data-row]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(60)
    const pads = [...container.querySelectorAll<HTMLElement>('[data-virtual-pad]')].map(p => parseFloat(p.style.height))
    expect(pads[0]! + rows.length * 44 + pads[1]!).toBe(10_000 * 44)
  })
})
