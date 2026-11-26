/**
 * The shared format contract (engineering.md「插件契约」) over the built plugin and the sample models.
 * Needs `pnpm --filter @bowerbird/plugin-model build` first; skipped otherwise.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPluginForTest, runFormatContract } from '@bowerbird/plugin-sdk/testing'

const dir = path.resolve(import.meta.dirname, '../..')
const fx = path.resolve(dir, '../../fixtures/xingluo')
const built = fs.existsSync(path.join(dir, 'dist/server.js'))
const samples = fs.existsSync(path.join(fx, 'props/chest/chest.glb'))

describe.skipIf(!built || !samples)('format contract', () => {
  it('manifest, handlers and samples agree', async () => {
    const loaded = await loadPluginForTest(dir)
    expect(loaded.manifest.id).toBe('bowerbird.model')
    const results = await runFormatContract(loaded, [
      { file: path.join(fx, 'props/chest/chest.glb'), format: 'model', techKeys: ['triangles', 'boundsX', 'boundsY', 'boundsZ', 'hasVertexColors'], references: ['chest_basecolor.png', 'chest_normal.png', 'chest_orm.png'] },
      { file: path.join(fx, 'characters/hero/hero_walk.fbx'), format: 'model', techKeys: ['triangles', 'animations'] },
      { file: path.join(fx, 'characters/hero/hero.glb'), format: 'model' },
      { file: path.join(fx, 'environments/rock_01.obj'), format: null }
    ])
    expect(results.filter(r => r.handler).every(r => r.summary && r.thumbnailBytes === 0)).toBe(true)
  })
})
