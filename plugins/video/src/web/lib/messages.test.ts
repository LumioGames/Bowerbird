/** Every shell language (LOCALES, so a language added later is checked too) has every UI string of this plugin. */
import { describe, expect, it } from 'vitest'
import { LOCALE_IDS } from '@bowerbird/schema/locale'
import { messageProblems } from '@bowerbird/plugin-sdk/testing'
import { messages } from '../i18n.js'

describe('video UI text in every language', () => {
  it('has every key in every language, with the same placeholders', () => {
    expect(LOCALE_IDS).toEqual(expect.arrayContaining(['zh-CN', 'en', 'ja', 'ko']))
    expect(messageProblems(messages)).toEqual([])
  })
})
