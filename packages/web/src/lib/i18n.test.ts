import { describe, expect, it } from 'vitest'
import { LOCALES, placeholdersOf } from '@bowerbird/schema'
import { DICTS, initialLocale } from './i18n'

/**
 * Every language follows the Chinese source (ADR-061): no key the source does not have, the same `{placeholders}`.
 * Languages listed in COMPLETE must have every key; add a language here once its dictionaries are filled.
 */
const COMPLETE = ['zh-CN', 'en', 'ja', 'ko'] as const
const source = DICTS['zh-CN']

describe('shell dictionaries', () => {
  for (const { id } of LOCALES) {
    it(`${id}: only keys the source has, with the same placeholders`, () => {
      const dict = DICTS[id]
      expect(Object.keys(dict).filter(k => !(k in source))).toEqual([])
      const wrong = Object.entries(dict).filter(([k, s]) => placeholdersOf(s).join() !== placeholdersOf(source[k]!).join()).map(([k]) => k)
      expect(wrong).toEqual([])
      expect(Object.entries(dict).filter(([, s]) => !s.trim()).map(([k]) => k)).toEqual([])
    })
  }
  for (const id of COMPLETE) {
    it(`${id} has every key`, () => {
      expect(Object.keys(source).filter(k => !(k in DICTS[id]))).toEqual([])
    })
  }
})

describe('initial language', () => {
  it('a saved choice wins; otherwise the browser languages; otherwise English', () => {
    expect(initialLocale('ko', ['ja-JP'])).toBe('ko')
    expect(initialLocale(null, ['ja-JP', 'en-US'])).toBe('ja')
    expect(initialLocale(null, ['ko-KR'])).toBe('ko')
    expect(initialLocale(null, ['zh-TW'])).toBe('zh-CN')
    expect(initialLocale(null, ['fr-FR', 'en-GB'])).toBe('en')
    expect(initialLocale(null, ['fr-FR'])).toBe('en')
    expect(initialLocale('xx', [])).toBe('en')
  })
})

describe('language setting', () => {
  it('every language in LOCALES has its dictionaries (found by folder)', async () => {
    const { LOCALES: list } = await import('@bowerbird/schema')
    for (const { id } of list) expect(Object.keys(DICTS[id]).length, id).toBeGreaterThan(1000)
  })
  it('follows the system until a language is chosen; choosing 跟随系统 follows it again', async () => {
    const { getLocalePref, setLocalePref, getLocale, systemLocale } = await import('./i18n')
    const was = getLocalePref()
    try {
      setLocalePref('ko')
      expect(getLocale()).toBe('ko')
      expect(localStorage.getItem('bowerbird.locale')).toBe('ko')
      setLocalePref('auto')
      expect(getLocalePref()).toBe('auto')
      expect(getLocale()).toBe(systemLocale())
      expect(localStorage.getItem('bowerbird.locale')).toBeNull()
      // following the system: a change of the browser's language switches right away
      const langs = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages')
      Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['ja-JP'] })
      window.dispatchEvent(new Event('languagechange'))
      expect(getLocale()).toBe('ja')
      // …but not once a language is chosen
      setLocalePref('en')
      Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['ko-KR'] })
      window.dispatchEvent(new Event('languagechange'))
      expect(getLocale()).toBe('en')
      if (langs) Object.defineProperty(navigator, 'languages', langs); else delete (navigator as { languages?: unknown }).languages
    } finally { setLocalePref(was) }
  })
})
