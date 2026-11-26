import { describe, expect, it } from 'vitest'
import { PluginManifest } from '@bowerbird/schema'
import { manifestStrings, manifestTextProblems, messageProblems, registeredStrings, schemaStrings } from './text.js'

describe('message checks', () => {
  it('passes complete dictionaries and reports what is missing, extra, misplaced or in the wrong script', () => {
    const ok = { 'zh-CN': { play: '播放', n: '{n} 个' }, en: { play: 'Play', n: '{n}' }, ja: { play: '再生', n: '{n} 個' }, ko: { play: '재생', n: '{n}개' } }
    expect(messageProblems(ok)).toEqual([])
    const bad = { 'zh-CN': { play: '播放', n: '{n} 个' }, en: { play: '播放', n: '{count}', extra: 'x' }, ja: { play: '재생' } }
    expect(messageProblems(bad)).toEqual([
      'en.play: not in this language: 播放',
      'en.n: placeholders count ≠ n',
      'en.extra: not in the Chinese dictionary',
      'ja.play: not in this language: 재생',
      'ja.n: missing',
      'ko: no dictionary'
    ])
  })
})

describe('manifest text checks', () => {
  const m = PluginManifest.parse({
    id: 'studio.spine', displayName: 'Spine 动画', description: '骨骼动画', apiVersion: 1,
    contributes: {
      formats: [{ id: 'spine', displayName: 'Spine', extensions: ['.skel'] }],
      relationTypes: [{ id: 'skin', name: '皮肤', inverseName: '皮肤所属' }],
      settings: { type: 'object', properties: { skin: { type: 'string', title: '默认皮肤', enum: ['a', 'b'], enumNames: ['甲', '乙'], 'x-placeholder': '无' } } }
    },
    l10n: {
      en: { 'Spine 动画': 'Spine animation', '生成中 {pct}%': 'Generating {pct}%' },
      ja: { 'Spine 动画': 'Spine アニメ', '生成中 {pct}%': '生成中 {p}%' }
    }
  })
  it('lists the strings a manifest hands to the shell', () => {
    expect(manifestStrings(m)).toEqual(['Spine 动画', '骨骼动画', 'Spine', '皮肤', '皮肤所属', '默认皮肤', '无', '甲', '乙'])
    expect(schemaStrings({ items: { title: 'a', oneOf: [{ title: 'b' }] } })).toEqual(['a', 'b'])
    expect(registeredStrings({ creators: [{ id: 'c', displayName: '生成', params: { properties: { q: { title: '提示' } } }, inputs: [{ role: '原图', required: true }], run: async () => {} }], actions: [], templates: [] })).toEqual(['生成', '提示', '原图'])
  })
  it('reports strings without a translation, changed placeholders and wrong scripts', () => {
    const problems = manifestTextProblems(m, ['Spine 动画', '生成中 40%'], ['zh-CN', 'en', 'ja', 'ko'])
    expect(problems).toEqual([
      'ko: no translation for「Spine 动画」',
      'ko: no translation for「生成中 40%」',
      'ja:「生成中 {pct}%」→「生成中 {p}%」changes the placeholders'
    ])
  })
  it('skips the language the plugin writes in', () => {
    const en = PluginManifest.parse({ id: 'x.y', displayName: 'Spine', apiVersion: 1, sourceLocale: 'en', l10n: { 'zh-CN': { Spine: 'Spine' } } })
    expect(manifestTextProblems(en, ['Spine'], ['zh-CN', 'en'])).toEqual([])
  })
})
