import { describe, expect, it } from 'vitest'
import {
  channelKey, channelName, initialStrips, initialWipe, nextStrip, packedLabels, parseChannel, shortTextureName, unreadable,
  type ModelCaps
} from '../lib/channels'
import { compareModes } from '../lib/compare-modes'
import { en, zh } from '../i18n'
const WHY_MODEL = zh('whyModel'), WHY_NO_GRID = zh('whyNoGrid'), WHY_NO_DIFF = zh('whyNoDiff')
import { aspectDeviation, cellsOf, impliedSizes, measureRaster, orthoFit, sheetViews, trimCell, viewBasis, viewExtent } from '../lib/turnaround'
import { nearestEdges, pixelsPerMeter, scaleBar } from '../lib/measure'

const grid2x2 = { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] as Array<'front' | 'side' | 'back' | 'top'> }

describe('channels and components', () => {
  it('round-trips keys with a component and a vertex colour set', () => {
    expect(parseChannel('base.r')).toEqual({ base: 'base', comp: 'r', set: 0 })
    expect(parseChannel('vcol:1.a')).toEqual({ base: 'vcol', comp: 'a', set: 1 })
    expect(channelKey({ base: 'vcol', comp: 'g', set: 2 })).toBe('vcol:2.g')
    expect(channelKey({ base: 'normal', comp: '', set: 0 })).toBe('normal')
    expect(parseChannel('bogus')).toEqual({ base: 'full', comp: '', set: 0 })
  })
  it('names normal components X Y Z and vertex colours by set only when there are several', () => {
    expect(channelName('normal.g')).toBe('法线 · Y')
    expect(channelName('base.a')).toBe('基础色 · A')
    expect(channelName('vcol.r', 1)).toBe('顶点色 · R')
    expect(channelName('vcol:1.r', 2)).toBe('顶点色 · COLOR_1 · R')
  })
  it('says which channels a file cannot show (FBX Phong: no roughness, metalness, occlusion)', () => {
    const fbx: ModelCaps = { pbr: false, ao: false, uv: true, textures: true, vcolSets: 0, packed: {} }
    expect(['rough', 'metal', 'ao'].map(c => unreadable(c, fbx))).toEqual([true, true, true])
    expect(['full', 'base', 'normal', 'emit', 'alpha', 'vcol', 'wire', 'face'].some(c => unreadable(c, fbx))).toBe(false)
    expect(unreadable('density', { ...fbx, textures: false })).toBe(true)
    expect(unreadable('uv', { ...fbx, uv: false })).toBe(true)
  })
  it('labels packed textures by their bound maps', () => {
    expect(packedLabels({ rough: 'chest_orm.png', metal: 'chest_orm.png', ao: 'chest_orm.png', mrIsAo: true })).toEqual({ rough: 'ORM · G', metal: 'ORM · B', ao: 'ORM · R' })
    expect(packedLabels({ rough: 'rock_mr.png', metal: 'rock_mr.png', ao: 'rock_ao.png' })).toEqual({ rough: 'MR · G', metal: 'MR · B', ao: 'AO · R' })
    expect(shortTextureName('textures/chest_metallicRoughness.png')).toBe('chest_metal…')
  })
  it('starts wipe and strips from the current channel and adds readable strips', () => {
    expect(initialWipe('normal')).toEqual(['normal', 'base'])
    expect(initialWipe('base.r')).toEqual(['base.r', 'full'])
    expect(initialStrips('normal')).toEqual(['normal', 'full', 'base'])
    const caps: ModelCaps = { pbr: false, ao: false, uv: true, textures: true, vcolSets: 0, packed: {} }
    expect(nextStrip(['full', 'base', 'normal'], caps)).toBeNull()
    expect(nextStrip(['full', 'base', 'normal'], { ...caps, pbr: true })).toBe('rough')
  })
})

describe('compare modes', () => {
  const model = { format: 'model', views: null }
  it('model · model: side or wipe', () => {
    const m = compareModes(model, model)!
    expect(m.filter(x => x.available).map(x => x.mode)).toEqual(['side', 'wipe'])
    expect(m.find(x => x.mode === 'overlay')!.reason).toBe(WHY_MODEL)
  })
  it('model · sheet with a grid: wipe by default, no pixel difference', () => {
    const m = compareModes({ format: 'image', views: grid2x2 }, model)!
    expect(m.filter(x => x.available).map(x => x.mode)).toEqual(['side', 'wipe', 'overlay'])
    expect(m.find(x => x.default)!.mode).toBe('wipe')
    expect(m.find(x => x.mode === 'diff')!.reason).toBe(WHY_NO_DIFF)
  })
  it('model · image without a grid: side only, and says why', () => {
    const m = compareModes(model, { format: 'image', views: null })!
    expect(m.filter(x => x.available).map(x => x.mode)).toEqual(['side'])
    expect(m.find(x => x.mode === 'wipe')!.reason).toBe(WHY_NO_GRID)
    expect(compareModes(model, { format: 'image', views: { rows: 1, cols: 2, cells: [null, null] } })!.find(x => x.mode === 'wipe')!.available).toBe(false)
  })
  it('anything else is not ours', () => {
    expect(compareModes(model, { format: 'doc', views: null })).toBeNull()
    expect(compareModes({ format: 'image', views: grid2x2 }, { format: 'image', views: null })).toBeNull()
  })
})

describe('turnaround grid', () => {
  it('takes cells from the grid, left to right, top to bottom', () => {
    expect(cellsOf(grid2x2)).toEqual({
      front: { x: 0, y: 0, w: 0.5, h: 0.5 }, side: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      back: { x: 0, y: 0.5, w: 0.5, h: 0.5 }, top: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    })
    expect(cellsOf({ rows: 1, cols: 3, cells: ['side', null, 'front'] })).toEqual({ side: { x: 0, y: 0, w: 1 / 3, h: 1 }, front: { x: 2 / 3, y: 0, w: 1 / 3, h: 1 } })
    expect(cellsOf(null)).toBeNull()
  })
  it('trims the plain margin inside a cell', () => {
    const w = 20, h = 10, data = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let y = 3; y <= 6; y++) for (let x = 4; x <= 7; x++) data.set([20, 20, 20, 255], (y * w + x) * 4)
    expect(trimCell(data, w, h, { x: 0, y: 0, w: 0.5, h: 1 })).toEqual({ x: 0.2, y: 0.3, w: 0.2, h: 0.4 })
    expect(trimCell(data, w, h, { x: 0.5, y: 0, w: 0.5, h: 1 })).toBeNull()
    const v = sheetViews(grid2x2, { front: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 } })!
    expect(v.front!.drawn).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.3 })
    expect(v.side!.drawn.x).toBeCloseTo(0.55)
  })
  it('takes the background from the corners most of them agree on (the image viewer\'s rule)', () => {
    // a 20 × 20 cell, white paper; the drawing reaches into the top-left corner (a dark L) and a block in the middle
    const w = 20, h = 20, data = new Uint8ClampedArray(w * h * 4).fill(255)
    const ink = (x: number, y: number) => data.set([30, 30, 30, 255], (y * w + x) * 4)
    for (let y = 0; y <= 5; y++) for (let x = 0; x <= 5; x++) ink(x, y)
    for (let y = 8; y <= 13; y++) for (let x = 9; x <= 14; x++) ink(x, y)
    // three corners are white: the drawing is the dark pixels, from (0,0) to (14,13)
    expect(trimCell(data, w, h, { x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 15 / 20, h: 14 / 20 })
    // a grid line along the cell's top edge: the corners are inset past it, so they still agree on white
    const g = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let x = 0; x < w; x++) g.set([0, 0, 0, 255], x * 4)
    for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) g.set([30, 30, 30, 255], (y * w + x) * 4)
    expect(trimCell(g, w, h, { x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 10 / 20 })
  })
  it('measures on the raster the image viewer samples: long edge 480 px at most, never enlarged', () => {
    expect(measureRaster(2048, 1024)).toEqual({ w: 480, h: 240 })
    expect(measureRaster(500, 2000)).toEqual({ w: 120, h: 480 })
    expect(measureRaster(300, 200)).toEqual({ w: 300, h: 200 })
  })
  it('says compare reasons in English when asked', () => {
    const m = compareModes({ format: 'model', views: null }, { format: 'image', views: null }, en)!
    expect(m.find(x => x.mode === 'wipe')!.reason).toBe('This image has no grid, so it can only be shown side by side with the model')
    expect(channelName('normal.g', 1, en)).toBe('Normal · Y')
    expect(channelName('base', 1, en)).toBe('Base color')
  })
  it('projects the box for each orthographic view', () => {
    expect(viewBasis('front')).toEqual({ right: [1, 0, 0], up: [0, 1, 0] })
    expect(viewBasis('side').right).toEqual([0, 0, -1])
    expect(viewBasis('top')).toEqual({ right: [1, 0, 0], up: [0, 0, -1] })
    const e = viewExtent([-0.63, 0, -0.435], [0.63, 0.95, 0.435], 'side')
    expect(e.xx - e.nx).toBeCloseTo(0.87); expect(e.xy - e.ny).toBeCloseTo(0.95)
    const t = viewExtent([-0.63, 0, -0.435], [0.63, 0.95, 0.435], 'top')
    expect(t.xx - t.nx).toBeCloseTo(1.26); expect(t.xy - t.ny).toBeCloseTo(0.87)
  })
  it('aligns bottom and centre, matching height (or width)', () => {
    const R = { x: 100, y: 50, w: 200, h: 100 }
    const ext = { nx: -0.63, xx: 0.63, ny: 0, xy: 0.95 }
    const f = orthoFit(R, ext, 800, 600, 'h')
    expect(f.ppm).toBeCloseTo(100 / 0.95)
    expect(f.modelRect.y + f.modelRect.h).toBeCloseTo(150)
    expect(f.modelRect.x + f.modelRect.w / 2).toBeCloseTo(200)
    expect(f.modelRect.h).toBeCloseTo(100)
    // a camera-space point maps to pane pixels through the frustum: the model's bottom-centre lands on R's bottom-centre
    expect((0 - f.left) * f.ppm).toBeCloseTo(200)
    expect((f.top - 0) * f.ppm).toBeCloseTo(150)
    expect((f.right - f.left) * f.ppm).toBeCloseTo(800)
    const fw = orthoFit(R, ext, 800, 600, 'w')
    expect(fw.modelRect.w).toBeCloseTo(200)
  })
  it('marks an aspect deviation over 5 %', () => {
    expect(aspectDeviation(1.33, 1.32)).toMatchObject({ bad: false, label: '+0.8%' })
    expect(aspectDeviation(1.32, 1.32).label).toBe('一致')
    expect(aspectDeviation(1.2, 1.32)).toMatchObject({ bad: true, label: '−9.1%' })
  })
  it('measures each view on the sheet at the front view\'s scale', () => {
    const views = sheetViews(grid2x2, {
      front: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 * 0.95 / 1.26 },
      side: { x: 0.6, y: 0.1, w: 0.3 * 0.87 / 1.26 * 1.1, h: 0.3 * 0.95 / 1.26 }
    })
    const imp = impliedSizes(views, 1000, 1000, { w: 1.26, h: 0.95, d: 0.87 })!
    expect(imp.front![0]).toMatchObject({ axis: 'w', ok: true })
    expect(imp.front![1].measured).toBeCloseTo(0.95)
    expect(imp.side![0]).toMatchObject({ axis: 'd', ok: false })
    expect(imp.side![0].measured).toBeCloseTo(0.957)
    expect(impliedSizes(views, 1000, 1000, null)).toBeNull()
  })
})

describe('size display', () => {
  it('picks a round scale bar length that fits', () => {
    expect(scaleBar(400)).toMatchObject({ meters: 0.2, label: '20 cm' })
    expect(scaleBar(400).px).toBeCloseTo(80)
    expect(scaleBar(60)).toMatchObject({ meters: 2, label: '2 m' })
    expect(scaleBar(20000)).toMatchObject({ label: '5 mm' })
  })
  it('is true at the model centre depth, and follows the field of view', () => {
    const p = pixelsPerMeter({ ortho: false, heightPx: 600, fovDeg: 90, depth: 3, orthoHeight: 0 })
    expect(p).toBeCloseTo(100)
    expect(pixelsPerMeter({ ortho: false, heightPx: 600, fovDeg: 45, depth: 3, orthoHeight: 0 })).toBeGreaterThan(p)
    expect(pixelsPerMeter({ ortho: true, heightPx: 600, fovDeg: 45, depth: 3, orthoHeight: 2 })).toBe(300)
  })
  it('measures the three edges on the sides facing the camera', () => {
    const e = nearestEdges([-1, 0, -0.5], [1, 2, 0.5], [5, 3, -4])
    expect(e.map(x => [x.axis, x.length])).toEqual([['x', 2], ['z', 1], ['y', 2]])
    expect(e[0]!.a[2]).toBe(-0.5)
    expect(e[1]!.a[0]).toBe(1)
    expect(e[2]!.a).toEqual([1, 0, -0.5])
  })
})
