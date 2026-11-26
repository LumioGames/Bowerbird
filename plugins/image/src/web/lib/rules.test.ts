import { describe, expect, it } from 'vitest'
import { alignBoxes, aspectsDiffer, imageCompareModes, REASON_ASPECT, REASON_SLICE_NO_RECT, sliceCrop } from './rules.js'
import { diffPercent, diffPixels, exceedsBrowserLimit, pixelAt, viewForRect, zoomAt } from './pixels.js'
import { translate } from '../i18n.js'
import { cellPixels, cellRect, describeGrid, dimensionLines, drawnExtent, viewsOf } from '../../shared/grid.js'

const ID_A = '00000000-0000-7000-8000-00000000000a'
const ID_B = '00000000-0000-7000-8000-00000000000b'
type A = Parameters<typeof imageCompareModes>[0]
function img(id: string, w: number, h: number, extra: Partial<A> = {}): A {
  return { id, format: 'image', tech: { width: w, height: h }, record: null, relations: { outgoing: [], incoming: [] }, ...extra } as A
}
const modes = (r: ReturnType<typeof imageCompareModes>) => Object.fromEntries((r ?? []).map(m => [m.mode, m]))

describe('imageCompareModes', () => {
  it('offers all four modes for two images of the same proportions', () => {
    const m = modes(imageCompareModes(img(ID_A, 1024, 1024), img(ID_B, 512, 512)))
    expect(Object.values(m).every(x => x.available)).toBe(true)
    expect(m.side!.default).toBe(true)
  })
  it('refuses the difference when proportions differ by more than 5 %', () => {
    const m = modes(imageCompareModes(img(ID_A, 1000, 1000), img(ID_B, 1000, 940)))
    expect(m.diff).toEqual({ mode: 'diff', available: false, reason: REASON_ASPECT })
    expect(m.overlay!.available).toBe(true)
    expect(modes(imageCompareModes(img(ID_A, 1000, 1000), img(ID_B, 1000, 960))).diff!.available).toBe(true)
  })
  it('is not for other formats', () => {
    expect(imageCompareModes(img(ID_A, 1, 1), { ...img(ID_B, 1, 1), format: 'model' })).toBeNull()
  })
  it('crops the source picture to the slice record rect (ADR-036)', () => {
    const slice = img(ID_A, 120, 60, { record: { method: 'slice', inputs: [{ id: ID_B }], params: { rect: [10, 20, 120, 60] } } as A['record'] })
    const mock = img(ID_B, 1280, 720)
    expect(sliceCrop(slice, mock)).toEqual({ crop: 'right', rect: [10, 20, 120, 60] })
    expect(sliceCrop(mock, slice)).toEqual({ crop: 'left', rect: [10, 20, 120, 60] })
    expect(modes(imageCompareModes(slice, mock)).diff!.available).toBe(true)
  })
  it('reads the rect of this output from a multi-output record', () => {
    const rect = { [ID_A]: [100, 40, 64, 64], '00000000-0000-7000-8000-0000000000cc': [0, 0, 64, 64] }
    const slice = img(ID_A, 64, 64, { record: { method: 'slice', inputs: [{ id: ID_B }], params: { rect } } as A['record'] })
    expect(sliceCrop(slice, img(ID_B, 1280, 720))).toEqual({ crop: 'right', rect: [100, 40, 64, 64] })
    const other = img(ID_A, 64, 64, { record: { method: 'slice', inputs: [{ id: ID_B }], params: { rect: { x: [1, 2, 3, 4] } } } as A['record'] })
    expect(sliceCrop(other, img(ID_B, 1280, 720))).toEqual({ crop: null, missingRect: true })
  })
  it('only allows side by side when the slice has no rect', () => {
    const slice = img(ID_A, 120, 60, {
      record: { method: 'slice' } as A['record'],
      relations: { outgoing: [{ type: 'source', to: ID_B }], incoming: [] } as unknown as A['relations']
    })
    const m = modes(imageCompareModes(slice, img(ID_B, 1280, 720)))
    expect(m.side!.available).toBe(true)
    expect(m.wipe).toEqual({ mode: 'wipe', available: false, reason: REASON_SLICE_NO_RECT })
  })
  it('treats unrelated slices as ordinary images', () => {
    const slice = img(ID_A, 100, 100, { record: { method: 'slice', params: { rect: [0, 0, 1, 1] } } as A['record'] })
    expect(sliceCrop(slice, img(ID_B, 100, 100))).toBeNull()
  })
})

describe('alignment and aspect', () => {
  it('detects proportion differences', () => {
    expect(aspectsDiffer({ w: 100, h: 100 }, { w: 106, h: 100 })).toBe(true)
    expect(aspectsDiffer({ w: 100, h: 100 }, { w: 104, h: 100 })).toBe(false)
  })
  it('fits both boxes by proportion, or keeps their pixel ratio', () => {
    const [a, b] = alignBoxes(556, 556, { w: 1000, h: 1000 }, { w: 500, h: 250 }, 'fit')
    expect(a).toEqual({ w: 500, h: 500 })
    expect(b).toEqual({ w: 500, h: 250 })
    const [pa, pb] = alignBoxes(556, 556, { w: 1000, h: 1000 }, { w: 500, h: 250 }, 'px')
    expect(pa).toEqual({ w: 500, h: 500 })
    expect(pb).toEqual({ w: 250, h: 125 })
  })
})

describe('diffPixels', () => {
  it('marks differing pixels and reports the share of visible ones', () => {
    const a = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 0, 0, 0, 0, 10, 10, 10, 255])
    const b = new Uint8ClampedArray([0, 0, 0, 255, 200, 100, 100, 255, 0, 0, 0, 0, 20, 10, 10, 255])
    const r = diffPixels(a, b)
    expect(r.area).toBe(3)
    expect(r.differing).toBe(1)
    expect([...r.image.slice(4, 8)]).toEqual([255, 56, 150, 255])
    expect(r.image[11]).toBe(0)
    expect(diffPercent(r)).toBe('33.3')
    expect(diffPercent({ differing: 0, area: 9 })).toBeNull()
  })
  it('counts a change of transparency as a difference', () => {
    expect(diffPixels([0, 0, 0, 255], [0, 0, 0, 100]).differing).toBe(1)
  })
})

describe('viewer maths', () => {
  it('knows the browser size limit', () => {
    // decoded RGBA over 500 MB (Firefox's largest surface): 16384² is 1 GiB, the sample's 16384×9216 604 MB
    expect(exceedsBrowserLimit(10000, 10000)).toBe(false)
    expect(exceedsBrowserLimit(16384, 9216)).toBe(true)
    expect(exceedsBrowserLimit(16384, 16384)).toBe(true)
    expect(exceedsBrowserLimit(32767, 100)).toBe(false)
    expect(exceedsBrowserLimit(40000, 10)).toBe(true)
    expect(exceedsBrowserLimit(20000, 20000)).toBe(true)
    expect(translate('zh-CN', 'tooLarge', { w: 40000, h: 10 })).toBe('图片尺寸 40000×10 超出浏览器能显示的上限')
    expect(translate('en', 'tooLarge', { w: 40000, h: 10 })).toBe('The image is 40000×10, larger than a browser can show')
  })
  it('zooms about a point', () => {
    const v = zoomAt({ z: 1, x: 0, y: 0 }, 2, 100, 0, 0.1, 40)
    expect(v).toEqual({ z: 2, x: -100, y: 0 })
    expect(zoomAt(v, 100, 0, 0, 0.1, 40).z).toBe(40)
  })
  it('maps stage points to image pixels, also when tiled', () => {
    const rect = { left: 0, top: 0, width: 300, height: 150 }
    expect(pixelAt(150, 75, rect, { w: 600, h: 300 })).toEqual({ x: 300, y: 150 })
    expect(pixelAt(301, 0, rect, { w: 600, h: 300 })).toBeNull()
    expect(pixelAt(150, 75, rect, { w: 60, h: 30 }, true)).toEqual({ x: 30, y: 15 })
  })
  it('zooms to a cell of the sheet', () => {
    const v = viewForRect([0.5, 0, 0.5, 0.5], { w: 400, h: 400 }, 1)
    expect(v).toEqual({ z: 2, x: -200, y: 200 })
  })
})

describe('turnaround grid (ADR-019)', () => {
  const grid = { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] as const }
  const g = { ...grid, cells: [...grid.cells] }
  it('takes cells by the grid', () => {
    expect(cellRect(g, 'front')).toEqual([0, 0, 0.5, 0.5])
    expect(cellRect(g, 'top')).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(cellRect({ rows: 1, cols: 3, cells: ['side', null, 'front'] }, 'front')).toEqual([2 / 3, 0, 1 / 3, 1])
    expect(cellRect({ rows: 1, cols: 2, cells: ['front', null] }, 'back')).toBeNull()
    expect(cellPixels(g, 'back', 2048, 1024)).toEqual({ x: 0, y: 512, w: 1024, h: 512 })
  })
  it('lists views in the fixed order and describes the grid', () => {
    expect(viewsOf({ rows: 1, cols: 3, cells: ['top', 'front', null] })).toEqual(['front', 'top'])
    expect(viewsOf(null)).toEqual([])
    expect(describeGrid(g)).toBe('2 行 2 列 · 正面 侧面 / 背面 顶面')
  })
  it('measures the drawing inside a cell against the cell background', () => {
    const w = 20, h = 20, px = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let y = 4; y <= 5; y++) for (let x = 3; x <= 6; x++) { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0 }
    // a line along the top edge: the corners still agree on white, the line widens the extent only where it lies inside the cell
    for (let x = 0; x < w; x++) { const i = (0 * w + x) * 4; px[i] = px[i + 1] = 0 }
    expect(drawnExtent(px, w, h, [0, 0, 0.5, 0.5])).toEqual([0, 0, 0.5, 0.3])
    expect(drawnExtent(px, w, h, [0, 0.05, 0.5, 0.45])).toEqual([0.15, 0.2, 0.2, 0.1])
    expect(drawnExtent(px, w, h, [0.5, 0.5, 0.5, 0.5])).toBeNull()
  })
  it('labels the dimension lines of each view from the target size', () => {
    const size = { w: 1.26, h: 0.95, d: 0.87 }
    expect(dimensionLines('front', size).map(d => d.label)).toEqual(['宽 1.26 m', '高 0.95 m'])
    expect(dimensionLines('side', size).map(d => d.label)).toEqual(['深 0.87 m', '高 0.95 m'])
    expect(dimensionLines('top', size).map(d => [d.label, d.orientation])).toEqual([['宽 1.26 m', 'horizontal'], ['深 0.87 m', 'vertical']])
  })
})
