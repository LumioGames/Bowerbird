import { describe, expect, it } from 'vitest'
import type { AssetDetail } from '@bowerbird/schema'
import { modelTechRows } from '../index'
import { inLocale } from '../i18n'

/** The inspector's 技术信息 for a model, as the prototype writes it (flows.js techRows). */
const chest = {
  tech: { triangles: 2480, vertices: 3494, meshes: 29, materials: 5, textures: 3, maxTextureSize: 1024, animations: 1, bones: 0 },
  analysis: { 'bowerbird.model': { clipNames: ['open'], materialNames: ['M_Chest'] } }
} as unknown as AssetDetail

describe('model tech rows', () => {
  it('Chinese: 三角面, 材质, 贴图「3 张 · 最大 1024」, 动画「1 段 · open」', () => {
    expect(modelTechRows(chest, inLocale('zh-CN'))).toEqual([
      ['三角面', '2,480'], ['材质', '5'], ['贴图', '3 张 · 最大 1024'], ['动画', '1 段 · open']
    ])
  })
  it('Japanese, and without clip names or textures', () => {
    expect(modelTechRows(chest, inLocale('ja'))).toEqual([
      ['三角ポリゴン', '2,480'], ['マテリアル', '5'], ['テクスチャ', '3 枚 · 最大 1024'], ['アニメーション', '1 個 · open']
    ])
    const bare = { tech: { triangles: 12, materials: 1, textures: 0, animations: 2 }, analysis: {} } as unknown as AssetDetail
    expect(modelTechRows(bare, inLocale('zh-CN'))).toEqual([['三角面', '12'], ['材质', '1'], ['贴图', '无'], ['动画', '2 段']])
  })
  it('nothing to summarise without a triangle count (the shell lists the keys)', () => {
    expect(modelTechRows({ tech: {}, analysis: {} } as unknown as AssetDetail, inLocale('en'))).toBeNull()
  })
})
