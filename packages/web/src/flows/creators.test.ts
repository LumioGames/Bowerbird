import { describe, expect, it } from 'vitest'
import type { CreatorInfo } from '@bowerbird/schema'
import { creatorFits } from './creators'
import { summary } from '../pages/shared/test/fake'

const creator = (inputs: CreatorInfo['inputs']): CreatorInfo =>
  ({ id: 'community.forge:model', pluginId: 'community.forge', pluginName: 'Forge', displayName: '生成模型', params: {}, inputs })

describe('creatorFits', () => {
  const sheet = summary({ id: 'a', name: 'chest_turnaround.png', format: 'image', hasViews: true })
  const concept = summary({ id: 'b', name: 'chest_concept.png', format: 'image' })
  const doc = summary({ id: 'c', name: 'chest.md', format: 'doc' })

  it('an input that needs a turnaround sheet fits only an asset with a view grid', () => {
    const c = creator([{ role: '四视图', formats: ['image'], views: true, required: true }])
    expect(creatorFits(c, [sheet])).toBe(true)
    expect(creatorFits(c, [concept])).toBe(false)
    expect(creatorFits(c, [doc])).toBe(false)
  })
  it('without `views` any asset of the format fits; one asset only; a missing file never fits', () => {
    const c = creator([{ role: '参考图', formats: ['image'], required: true }])
    expect(creatorFits(c, [concept])).toBe(true)
    expect(creatorFits(c, [sheet])).toBe(true)
    expect(creatorFits(c, [sheet, concept])).toBe(false)
    expect(creatorFits(c, [summary({ id: 'd', name: 'x.png', format: 'image', flags: ['missing'] })])).toBe(false)
    expect(creatorFits(creator([{ role: '参考图', formats: ['image'], required: false }]), [concept])).toBe(false)
  })
})
