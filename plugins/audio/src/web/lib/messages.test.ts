/** Every shell language (LOCALES, so a language added later is checked too) has every UI string of this plugin. */
import { describe, expect, it } from 'vitest'
import { LOCALE_IDS } from '@bowerbird/schema/locale'
import { messageProblems } from '@bowerbird/plugin-sdk/testing'
import { messages } from '../i18n.js'
import { formatBadge } from '../index.js'
import { audioBadge } from '../../shared/wave.js'

describe('audio UI text in every language', () => {
  it('has every key in every language, with the same placeholders', () => {
    expect(LOCALE_IDS).toEqual(expect.arrayContaining(['zh-CN', 'en', 'ja', 'ko']))
    expect(messageProblems(messages)).toEqual([])
  })
  it('says the badge the server wrote in every language (short sounds; minutes need no words)', () => {
    expect(formatBadge(audioBadge(0.8), 'zh-CN')).toBe('0.8 秒')
    expect(formatBadge(audioBadge(0.8), 'en')).toBe('0.8 s')
    expect(formatBadge(audioBadge(0.8), 'ja')).toBe('0.8 秒')
    expect(formatBadge(audioBadge(0.8), 'ko')).toBe('0.8초')
    expect(formatBadge(audioBadge(134), 'en')).toBe('2:14')
    expect(formatBadge('something else', 'en')).toBe('something else')
  })
})
