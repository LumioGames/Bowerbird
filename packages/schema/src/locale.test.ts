import { describe, expect, it } from 'vitest'
import { LOCALES, fillPlaceholders, localeChain, localizeText, matchLocale, placeholdersOf } from './locale.js'

describe('locales', () => {
  it('lists Chinese, English, Japanese and Korean, each named in its own language', () => {
    expect(LOCALES.map(l => [l.id, l.name])).toEqual([['zh-CN', '简体中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']])
  })
  it('matches language tags exactly, then by language', () => {
    expect(matchLocale(['ja'])).toBe('ja')
    expect(matchLocale(['ko-KR'])).toBe('ko')
    expect(matchLocale(['zh-Hant-TW'])).toBe('zh-CN')
    expect(matchLocale(['de', 'en-AU'])).toBe('en')
    expect(matchLocale(['de'])).toBeNull()
  })
  it('looks strings up in the language, then English, then Chinese', () => {
    expect(localeChain('ja')).toEqual(['ja', 'en', 'zh-CN'])
    expect(localeChain('en')).toEqual(['en', 'zh-CN'])
    expect(localeChain('zh-CN')).toEqual(['zh-CN', 'en'])
    expect(localeChain('de')).toEqual(['en', 'zh-CN'])
  })
  it('fills and lists placeholders', () => {
    expect(fillPlaceholders('{n} 个 · {name}', { n: 3 })).toBe('3 个 · {name}')
    expect(placeholdersOf('{b} {a} {b}')).toEqual(['a', 'b'])
  })
})

describe('plugin text', () => {
  const table = {
    en: { 音频: 'Audio', '生成中 {pct}%': 'Generating {pct}%', '{name}完成，挑出要留下的': '{name} is done: pick the ones to keep', 挑选: 'Pick' },
    ja: { 音频: 'オーディオ', '生成中 {pct}%': '生成中 {pct}%' }
  }
  it('looks in the language, then English, then shows the source text', () => {
    expect(localizeText('音频', 'ja', table)).toBe('オーディオ')
    expect(localizeText('挑选', 'ja', table)).toBe('Pick')
    expect(localizeText('音频', 'zh-CN', table)).toBe('音频')
    expect(localizeText('没有译文', 'en', table)).toBe('没有译文')
    expect(localizeText('音频', 'de', table)).toBe('Audio')
    expect(localizeText('音频', 'en', undefined)).toBe('音频')
  })
  it('stops at the language the plugin wrote in', () => {
    const fromEnglish = { 'zh-CN': { Generate: '生成' }, ko: { Generate: '생성' } }
    expect(localizeText('Generate', 'ja', fromEnglish, 'en')).toBe('Generate')
    expect(localizeText('Generate', 'zh-CN', fromEnglish, 'en')).toBe('生成')
    expect(localizeText('Generate', 'ko', fromEnglish, 'en')).toBe('생성')
    expect(localizeText('Generate', 'en', fromEnglish, 'en')).toBe('Generate')
  })
  it('matches source texts with placeholders and fills in what they matched', () => {
    expect(localizeText('生成中 35%', 'en', table)).toBe('Generating 35%')
    expect(localizeText('生成中 35%', 'ja', table)).toBe('生成中 35%')
    expect(localizeText('AI 生图完成，挑出要留下的', 'en', table)).toBe('AI 生图 is done: pick the ones to keep')
    expect(localizeText('生成中 (35)', 'en', table)).toBe('生成中 (35)')
  })
  it('ignores entries that are not strings', () => {
    expect(localizeText('音频', 'en', { en: { 音频: 3 as unknown as string } })).toBe('音频')
    expect(localizeText('toString', 'en', { en: {} })).toBe('toString')
  })
})
