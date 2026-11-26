/** Strings follow the page / shell language (web/types.ts: plugins carry both languages). Runs in jsdom. */
import { afterEach, describe, expect, it } from 'vitest'
import { imageCompareModes, REASON_ASPECT } from './rules.js'
import { translate } from '../i18n.js'
import { techLabels } from '../index.js'

const A = (id: string, w: number, h: number) => ({ id, format: 'image', tech: { width: w, height: h }, record: null, relations: { outgoing: [], incoming: [] } }) as never

afterEach(() => { document.documentElement.lang = '' })

describe('page language', () => {
  it('gives compare reasons in Chinese by default and in English when the shell switches', () => {
    const reason = () => imageCompareModes(A('00000000-0000-7000-8000-00000000000a', 100, 100), A('00000000-0000-7000-8000-00000000000b', 200, 100))!.find(m => m.mode === 'diff')!.reason
    expect(reason()).toBe(REASON_ASPECT)
    document.documentElement.lang = 'en'
    expect(reason()).toBe(translate('en', 'reasonAspect'))
  })
  it('gives compare reasons and tech labels in Japanese and Korean too', () => {
    const reason = () => imageCompareModes(A('00000000-0000-7000-8000-00000000000a', 100, 100), A('00000000-0000-7000-8000-00000000000b', 200, 100))!.find(m => m.mode === 'diff')!.reason
    document.documentElement.lang = 'ja'
    expect(reason()).toBe(translate('ja', 'reasonAspect'))
    expect(techLabels().colorSpace).toBe('色空間')
    document.documentElement.lang = 'ko'
    expect(reason()).toBe(translate('ko', 'reasonAspect'))
    expect(techLabels().width).toBe('너비')
    document.documentElement.lang = ''
    expect(techLabels().width).toBe('宽')
  })
})
