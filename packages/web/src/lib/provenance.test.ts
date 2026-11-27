import { describe, expect, it } from 'vitest'
import { provenanceBefore, provenanceInput } from './provenance'

const had = {
  method: 'ai-generate', tool: 'Forge', plugin: 'community.forge@0.4.0', prompt: '木质宝箱', params: { seed: 7 }, batch: 'bat_1',
  by: 'agent:concept-artist', at: '2026-11-20T08:00:00.000Z', note: '初稿'
}

describe('saying a provenance again (ADR-068, ADR-070)', () => {
  it('keeps what a client may say and leaves who / when / plugin to the kernel', () => {
    expect(provenanceInput(had)).toEqual({ method: 'ai-generate', tool: 'Forge', prompt: '木质宝箱', params: { seed: 7 }, batch: 'bat_1', note: '初稿' })
    expect(provenanceInput({ method: 'manual', params: {}, by: 'user:lin', at: had.at })).toEqual({ method: 'manual' })
  })

  it('reads what an apply answer says was there before, for undo', () => {
    expect(provenanceBefore([{ field: 'relations', before: [] }, { field: 'provenance', before: had }])).toEqual({ changed: true, before: provenanceInput(had) })
    expect(provenanceBefore([{ field: 'provenance', before: null }])).toEqual({ changed: true, before: null })
    expect(provenanceBefore([{ field: 'relations', before: [] }])).toEqual({ changed: false, before: null })
    expect(provenanceBefore(undefined)).toEqual({ changed: false, before: null })
  })
})
