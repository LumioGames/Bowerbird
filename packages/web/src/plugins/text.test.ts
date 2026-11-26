/** Plugin-provided text in the shell's language (ADR-061): manifest translations, badges and check results. */
import { afterEach, describe, expect, it } from 'vitest'
import type { CheckView, PluginInfo } from '@bowerbird/schema'
import type { FormatView, WebPlugin } from '@bowerbird/plugin-sdk/web'
import { badgeText, checkText, enumLabel, formatName, pluginSchema, pluginText, setPluginTexts } from './text'
import { mergeRegistry, type LoadedWebPlugin } from './registry'
import { setLocale } from '../lib/i18n'

const info = (id: string, o: Partial<PluginInfo> = {}): PluginInfo => ({
  id, packageName: id, version: '1.0.0', displayName: id, builtin: false, status: 'enabled', contributes: [], formats: [], hasWeb: true,
  settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'npm', ...o
})

const forge = info('community.forge', {
  displayName: 'Forge',
  l10n: {
    en: { 'AI 生图': 'AI image', 提示词: 'Prompt', 随机: 'Random', 不模拟: 'Off', '生成中 {pct}%': 'Generating {pct}%', 挑选: 'Pick' },
    ja: { 'AI 生图': 'AI 画像生成', 提示词: 'プロンプト', 挑选: '選択' }
  }
})
const english = info('studio.spine', { displayName: 'Spine', sourceLocale: 'en', l10n: { 'zh-CN': { 'Spine animation': 'Spine 动画' } } })

afterEach(() => { setPluginTexts([]); setLocale('zh-CN') })

describe('plugin text', () => {
  it('shows manifest and registered text in the language, then English, then as written', () => {
    setPluginTexts([forge, english])
    expect(pluginText('community.forge', 'AI 生图', 'zh-CN')).toBe('AI 生图')
    expect(pluginText('community.forge', 'AI 生图', 'en')).toBe('AI image')
    expect(pluginText('community.forge', 'AI 生图', 'ja')).toBe('AI 画像生成')
    expect(pluginText('community.forge', '随机', 'ko')).toBe('Random')
    expect(pluginText('community.forge', '没翻译的', 'en')).toBe('没翻译的')
    expect(pluginText('community.forge', '生成中 42%', 'ja')).toBe('Generating 42%')
    expect(pluginText('studio.spine', 'Spine animation', 'zh-CN')).toBe('Spine 动画')
    expect(pluginText('studio.spine', 'Spine animation', 'ja')).toBe('Spine animation')
  })
  it('leaves the kernel’s text, unknown plugins and empty values alone', () => {
    setPluginTexts([forge])
    expect(pluginText(null, 'AI 生图', 'en')).toBe('AI 生图')
    expect(pluginText('community.other', 'AI 生图', 'en')).toBe('AI 生图')
    expect(pluginText('community.forge', undefined, 'en')).toBeUndefined()
    expect(pluginText('community.forge', '', 'en')).toBe('')
  })
  it('follows the shell language by default', () => {
    setPluginTexts([forge])
    setLocale('ja')
    expect(pluginText('community.forge', '提示词')).toBe('プロンプト')
    setLocale('zh-CN')
    expect(pluginText('community.forge', '提示词')).toBe('提示词')
  })
  it('translates a JSON Schema form: titles, descriptions, placeholders and option labels, not values', () => {
    setPluginTexts([forge])
    const schema = {
      type: 'object', required: ['prompt'],
      properties: {
        prompt: { type: 'string', title: '提示词', 'x-placeholder': '随机' },
        simulate: { type: 'string', title: '提示词', enum: ['none', 'x'], enumNames: ['不模拟', '没翻译的'], default: 'none' }
      }
    }
    const out = pluginSchema('community.forge', schema, 'en')
    expect(out.properties.prompt).toEqual({ type: 'string', title: 'Prompt', 'x-placeholder': 'Random' })
    expect(out.properties.simulate).toEqual({ type: 'string', title: 'Prompt', enum: ['none', 'x'], enumNames: ['Off', '没翻译的'], default: 'none' })
    expect(out.required).toEqual(['prompt'])
    expect(schema.properties.prompt.title).toBe('提示词')
    expect(enumLabel(out.properties.simulate, 'none', 0)).toBe('Off')
    expect(enumLabel({}, 4, 2)).toBe('4')
  })
  it('names formats through their plugin; the kernel’s unknown format through the shell', () => {
    setPluginTexts([info('bowerbird.audio', { l10n: { en: { 音频: 'Audio' } } })])
    expect(formatName({ id: 'audio', displayName: '音频', plugin: 'bowerbird.audio' }, 'en')).toBe('Audio')
    setLocale('en')
    expect(formatName({ id: 'unknown', displayName: '未知格式', plugin: null })).toBe('Other')
  })
  it('translates UI slot titles when the registry is merged', () => {
    const mod: WebPlugin = { ui: { pages: [{ id: 'pick', title: '挑选', Component: () => null }], toolbarItems: [{ id: 'q', title: 'Forge' }] } }
    setLocale('ja')
    const r = mergeRegistry([{ info: forge, module: mod }])
    expect(r.ui.pages[0]!.title).toBe('選択')
    expect(r.ui.toolbarItems[0]!.title).toBe('Forge')
    setLocale('zh-CN')
    expect(mergeRegistry([{ info: forge, module: mod }]).ui.pages[0]!.title).toBe('挑选')
  })
})

describe('badges and check results', () => {
  const model: FormatView = { Viewer: () => null, formatBadge: (b, locale) => (b.endsWith(' 面') ? (locale === 'zh-CN' ? b : b.replace(' 面', locale === 'en' ? ' tris' : ' 三角面')) : b) }
  const broken: FormatView = { Viewer: () => null, formatBadge: () => { throw new Error('boom') } }
  const check: CheckView = { validator: 'size-vs-design', rule: 'size-vs-design', verdict: 'fail', message: '尺寸与设计对象：模型 1 m', values: { model: [1, 1, 1] } }
  const validators: WebPlugin['validators'] = {
    'size-vs-design': { label: (_c, l) => (l === 'en' ? 'Size vs design object' : null), message: (c, l) => (l === 'en' ? `Model ${(c.values!.model as number[])[0]} m` : null) }
  }
  const loaded: LoadedWebPlugin[] = [
    { info: info('bowerbird.model'), module: { formats: { model }, validators } },
    { info: info('x.broken'), module: { formats: { broken }, validators: { other: { message: () => { throw new Error('boom') } } } } }
  ]
  const reg = mergeRegistry(loaded)

  it('asks the format plugin to say its badge; keeps the badge when it cannot', () => {
    expect(badgeText(reg, { format: 'model', badge: '2,480 面' }, 'en')).toBe('2,480 tris')
    expect(badgeText(reg, { format: 'model', badge: '2,480 面' }, 'zh-CN')).toBe('2,480 面')
    expect(badgeText(reg, { format: 'model', badge: '2,480 面' }, 'ja')).toBe('2,480 三角面')
    expect(badgeText(reg, { format: 'image', badge: '1024×1024' }, 'en')).toBe('1024×1024')
    expect(badgeText(reg, { format: 'broken', badge: '3 页' }, 'en')).toBe('3 页')
    expect(badgeText(reg, { format: 'model', badge: null }, 'en')).toBeNull()
  })
  it('asks the plugin that declares the validator for the label and the message; falls back to what it wrote', () => {
    expect(reg.validatorView!('size-vs-design')!.pluginId).toBe('bowerbird.model')
    expect(checkText(reg, check, 'en')).toEqual({ label: 'Size vs design object', message: 'Model 1 m' })
    expect(checkText(reg, check, 'zh-CN')).toEqual({ label: null, message: check.message })
    expect(checkText(reg, { ...check, validator: 'other' }, 'en')).toEqual({ label: null, message: check.message })
    expect(checkText(reg, { ...check, validator: 'nobody' }, 'en')).toEqual({ label: null, message: check.message })
    expect(checkText({}, check, 'en')).toEqual({ label: null, message: check.message })
  })
})
