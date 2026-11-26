import { describe, expect, it, vi } from 'vitest'
import { assetPath, backDelta, closeTarget, crumbs, stepTo, type DetailState } from './nav'

describe('detail page trail (浏览路径)', () => {
  const trail = [{ id: 'a', tab: 'rel' }, { id: 'b', tab: 'view' }, { id: 'c', tab: 'rel' }]

  it('shows up to two steps, and folds earlier ones into「…」beyond that', () => {
    expect(crumbs(trail.slice(0, 2))).toEqual({ shown: [0, 1], hidden: [] })
    expect(crumbs(trail)).toEqual({ shown: [2], hidden: [0, 1] })
    expect(crumbs([])).toEqual({ shown: [], hidden: [] })
  })

  it('goes back one history step per trail step', () => {
    expect(backDelta(trail)).toBe(-1)
    expect(backDelta(trail, 0)).toBe(-3)
  })

  it('closes to the browse page it came from, or the library root', () => {
    expect(closeTarget('lib1', { from: '/libraries/lib1?q=chest', trail })).toEqual({ to: '/libraries/lib1?q=chest' })
    expect(closeTarget('lib1', {})).toEqual({ to: '/libraries/lib1' })
    // after more steps than the trail keeps (20), Esc still lands on the browse page, not half way back
    let state: DetailState = { from: '/libraries/lib1?folder=props', trail: [] }
    const navigate = vi.fn((_to: string, o: { state: DetailState }) => { state = o.state })
    for (let i = 0; i < 25; i++) stepTo(navigate as never, 'lib1', { id: `a${i}`, tab: 'rel', state }, `a${i + 1}`, 'rel')
    expect(state.trail).toHaveLength(20)
    expect(closeTarget('lib1', state)).toEqual({ to: '/libraries/lib1?folder=props' })
  })

  it('pushes the asset and the tab it was left on when moving on', () => {
    const navigate = vi.fn()
    const state: DetailState = { from: '/libraries/lib1', trail: [{ id: 'a', tab: 'rel' }] }
    stepTo(navigate, 'lib1', { id: 'b', tab: 'ver', name: 'b.png', state }, 'c', 'rel')
    expect(navigate).toHaveBeenCalledWith(assetPath('lib1', 'c', 'rel'), { state: { from: '/libraries/lib1', trail: [{ id: 'a', tab: 'rel' }, { id: 'b', tab: 'ver', name: 'b.png' }] } })
    expect(assetPath('lib1', 'c', 'rel')).toBe('/libraries/lib1/asset/c?tab=rel')
  })
})
