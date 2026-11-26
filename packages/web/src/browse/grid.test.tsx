import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { AssetSummary } from '@bowerbird/schema'
import { Grid } from './Grid'
import { fitListColumns } from './layout'

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})
afterEach(cleanup)

const N = 100_000
function makeItems(n: number): AssetSummary[] {
  const out: AssetSummary[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: `id-${i}`, name: `bench_${i}.png`, path: `bench/bench_${i}.png`, format: 'image', plugin: 'bowerbird.image', stage: 'runtime', review: 'approved',
      tags: [], autoTags: [], description: null, flags: [], thumbnail: null, thumbState: 'ready', aspect: [1, 0.75, 1.5][i % 3]!, badge: null,
      issueLevel: null, issueCount: 0, size: 1, modified: '2026-11-25T00:00:00Z', created: '2026-11-24T00:00:00Z', createdBy: 'user:mo', bundle: false,
      auxiliary: false, memberCount: 0, cellText: null, missingPlugin: null
    }
  }
  return out
}
const items = makeItems(N)

function scroller(top: number) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { value: 900 })
  el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 1000, bottom: 900, width: 1000, height: 900, x: 0, y: 0, toJSON() {} })
  el.scrollTop = top
  document.body.appendChild(el)
  return el
}

const noop = () => {}
const props = (layout: 'grid' | 'masonry' | 'list', sc: HTMLElement) => ({
  items, total: N, layout, size: 168, scroller: sc, query: '', selected: new Set<string>(), focus: null, renaming: null,
  columns: ['format', 'stage', 'review', 'size'], sort: { sort: 'modified', order: 'desc' as const }, onSortColumn: noop, onRenameDone: noop,
  onPointerSelect: noop, onOpen: noop, onContext: noop, onDragStart: noop, onLongPress: noop, onNeedMore: vi.fn()
})

describe('virtual scrolling: only what is in view is mounted (100,000 assets)', () => {
  for (const layout of ['grid', 'masonry', 'list'] as const) {
    it(`${layout}: a few dozen cells, not 100,000`, () => {
      const sc = scroller(0)
      const { container } = render(<Grid {...props(layout, sc)} />)
      const cells = container.querySelectorAll('[data-asset-cell]').length
      expect(cells).toBeGreaterThan(5)
      expect(cells).toBeLessThan(200)
      expect(container.querySelector('[data-asset-cell="id-50000"]')).toBeNull()
    })
  }

  it('the grid reserves the full height and asks for more when the end of what is loaded is near', () => {
    const sc = scroller(0)
    const p = { ...props('grid', sc), items: items.slice(0, 20) }
    const { container } = render(<Grid {...p} />)
    const host = container.firstElementChild as HTMLElement
    expect(parseFloat(host.style.height)).toBeGreaterThan(100_000)
    expect(p.onNeedMore).toHaveBeenCalled()
    // rows not loaded yet are skeletons, not cells
    expect(container.querySelectorAll('[data-asset-cell]').length).toBe(20)
  })
})

describe('list columns in a narrow list', () => {
  const min = (id: string, w: number) => ({ name: 160, format: 64, stage: 84, review: 96, tags: 0.18 * w, size: 76, modified: 88, tech: 88 } as Record<string, number>)[id] ?? 0
  const all = ['name', 'format', 'stage', 'review', 'tags', 'size', 'modified', 'tech']
  it('a wide list shows every chosen column', () => {
    expect(fitListColumns(all, 1200, min, 28)).toEqual(all)
  })
  it('a narrow one leaves out the least needed first and keeps the name', () => {
    // 1100×800 with the inspector open: the list is about 508 px wide
    expect(fitListColumns(all, 508, min, 28)).toEqual(['name', 'stage', 'review', 'tags'])
    expect(fitListColumns(all, 700, min, 28)).toEqual(['name', 'stage', 'review', 'tags', 'size', 'modified'])
    expect(fitListColumns(['name', 'size'], 100, min, 28)).toEqual(['name'])
    // not measured yet: nothing is left out
    expect(fitListColumns(all, 0, min, 28)).toEqual(all)
  })
})
