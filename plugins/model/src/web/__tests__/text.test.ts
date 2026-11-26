/**
 * The model plugin's text in every shell language (ADR-061): the dictionaries (every language in LOCALES has every
 * key), the grid badge and the size check (ADR-020) rebuilt from what the server part wrote.
 */
import { describe, expect, it } from 'vitest'
import { LOCALE_IDS } from '@bowerbird/schema/locale'
import { messageProblems } from '@bowerbird/plugin-sdk/testing'
import { inLocale, messages } from '../i18n'
import { modelBadge, sizeCheckMessage, sizeCheckView } from '../lib/check'
import plugin, { modelFormat, techLabels } from '../index'
import { checkSize } from '../../server'
import { probeResult, trianglesBadge } from '../../server/probe'
import { BUILTIN_ENVS, envName } from '../three/env'
import { environmentSetting } from '../settings'
import pkgJson from '../../../package.json'
import { compareSize, sizeMessage } from '../../shared/size'
import type { AssetFile } from '@bowerbird/plugin-sdk'
import type { CheckView } from '@bowerbird/schema'

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const pkg = pkgJson as unknown as {
  bowerbird: { contributes: { settings: { properties: Record<string, { enum?: string[]; enumNames?: string[]; default?: unknown }> } }; l10n: Record<string, Record<string, string>> }
}

describe('model UI text in every language', () => {
  it('has every key in every language, with the same placeholders', () => {
    expect(LOCALE_IDS).toEqual(expect.arrayContaining(['zh-CN', 'en', 'ja', 'ko']))
    expect(messageProblems(messages)).toEqual([])
  })
})

describe('grid badge', () => {
  it('says「2,480 面」in each language and leaves other badges alone', () => {
    const b = trianglesBadge(2480)
    expect(modelFormat.formatBadge!(b, 'zh-CN')).toBe('2,480 面')
    expect(modelFormat.formatBadge!(b, 'en')).toBe('2,480 tris')
    expect(modelFormat.formatBadge!(b, 'ja')).toBe('2,480 ポリゴン')
    expect(modelFormat.formatBadge!(b, 'ko')).toBe('2,480 삼각면')
    expect(modelBadge('1024×1024', inLocale('en'))).toBe('1024×1024')
  })
})

describe('size check', () => {
  const target = { w: 1.26, h: 0.95, d: 0.87 }
  async function run(size: { x: number; y: number; z: number }): Promise<CheckView> {
    const asset = { ext: '.fbx', tech: { boundsX: size.x, boundsY: size.y, boundsZ: size.z }, designObject: { id: 'o', targetSize: target } } as unknown as AssetFile
    const [c] = await checkSize(asset)
    return { validator: 'size-vs-design', ...c! }
  }

  it('is declared for the validator in the manifest', () => {
    expect(Object.keys(plugin.validators ?? {})).toEqual(['size-vs-design'])
  })
  it('says in Chinese exactly what the server wrote (without the label in front)', async () => {
    for (const size of [{ x: 1.26, y: 0.95, z: 0.87 }, { x: 1.3, y: 0.95, z: 0.8 }]) {
      const c = await run(size)
      expect(sizeCheckMessage(c, inLocale('zh-CN'))).toBe(sizeMessage(compareSize(size, target)).replace(/^尺寸与设计对象：/, ''))
    }
  })
  it('says it in English, Japanese and Korean, axis by axis when off', async () => {
    const c = await run({ x: 1.3, y: 0.95, z: 0.8 })
    expect(sizeCheckView.label!(c, 'en')).toBe('Size vs design object')
    expect(sizeCheckView.message!(c, 'en')).toBe('Model 1.30 × 0.95 × 0.80 m · Target 1.26 × 0.95 × 0.87 m · Width 1.30 m, should be 1.26; Depth 0.80 m, should be 0.87')
    expect(CJK.test(sizeCheckView.message!(c, 'en')!)).toBe(false)
    expect(sizeCheckView.message!(c, 'ja')).toBe('モデル 1.30 × 0.95 × 0.80 m · 目標 1.26 × 0.95 × 0.87 m · 幅 1.30 m（正しくは 1.26）、奥行き 0.80 m（正しくは 0.87）')
    expect(sizeCheckView.message!(c, 'ko')).toBe('모델 1.30 × 0.95 × 0.80 m · 목표 1.26 × 0.95 × 0.87 m · 너비 1.30 m(기준 1.26), 깊이 0.80 m(기준 0.87)')
    expect(sizeCheckView.label!(c, 'ko')).toBe('크기와 디자인 대상')
  })
  it('leaves other rules and unexpected values to the message the server wrote', () => {
    const c: CheckView = { validator: 'size-vs-design', rule: 'size-vs-design', verdict: 'pass', message: 'x', values: { model: [1, 2] } }
    expect(sizeCheckView.message!(c, 'en')).toBeNull()
    expect(sizeCheckView.message!({ ...c, rule: 'other' }, 'en')).toBeNull()
    expect(sizeCheckView.label!({ ...c, rule: 'other' }, 'en')).toBeNull()
  })
})

describe('technical information', () => {
  it('labels every key the server writes, glTF and FBX, in every language (no raw key in the inspector or compare table)', () => {
    const counts = { triangles: 12, vertices: 24, meshes: 2, materials: 1, textures: 3, maxTextureSize: 1024, bones: 0, animations: 1, hasUV: true, hasNormals: true, hasVertexColors: true, vertexColorSets: 1 }
    const gltf = probeResult({ kind: 'glb', gltf: { ...counts, references: [], embedded: [], materialNames: [], clipNames: [], images: [] } as never, size: { x: 1, y: 1, z: 1 } }).tech
    const fbx = probeResult({ kind: 'fbx', fbx: { ...counts, complete: true, textureList: [], materialNames: [], clipNames: [] } as never, size: null }).tech
    const keys = [...new Set([...Object.keys(gltf), ...Object.keys(fbx)])]
    expect(keys).toContain('vertexColorSets')
    for (const loc of LOCALE_IDS) {
      const labels = techLabels(inLocale(loc))
      for (const k of keys) expect(labels[k], `${loc} ${k}`).toMatch(/\S/)
      expect(Object.keys(labels).filter(k => !keys.includes(k)), loc).toEqual([])
    }
    expect(Object.keys(techLabels()).slice(0, 5)).toEqual(['triangles', 'vertices', 'meshes', 'materials', 'textures'])
  })
})

describe('settings', () => {
  it('offers the four built-in environments by name for「默认环境」, named in every language', () => {
    const env = pkg.bowerbird.contributes.settings.properties.defaultEnvironment!
    expect(env.enum).toEqual(BUILTIN_ENVS.map(e => e.id))
    expect(env.default).toBe('studio')
    expect(env.enumNames).toEqual(BUILTIN_ENVS.map(e => envName(e, inLocale('zh-CN'))))
    for (const loc of ['en', 'ja', 'ko'] as const) {
      expect(env.enumNames!.map(n => pkg.bowerbird.l10n[loc]![n])).toEqual(BUILTIN_ENVS.map(e => envName(e, inLocale(loc))))
    }
  })
  it('falls back to the studio for a saved environment that is not one of them', () => {
    expect(environmentSetting('night')).toBe('night')
    expect(environmentSetting('asset:0192f3a4')).toBe('studio')
    expect(environmentSetting(3)).toBe('studio')
  })
})
