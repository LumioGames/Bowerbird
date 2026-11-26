import { describe, expect, it } from 'vitest'
import { defineMessages, translate } from './i18n'

const m = defineMessages({
  'zh-CN': { play: '播放', frameOf: '帧 {i} / {n}', only: '只有中文' },
  en: { play: 'Play', frameOf: 'Frame {i} / {n}' },
  ja: { play: '再生' }
})

describe('plugin messages', () => {
  it('uses the language, then English, then Chinese', () => {
    expect(translate(m, 'ja', 'play')).toBe('再生')
    expect(translate(m, 'ja', 'frameOf', { i: 2, n: 9 })).toBe('Frame 2 / 9')
    expect(translate(m, 'ko', 'only')).toBe('只有中文')
    expect(translate(m, 'zh-CN', 'frameOf', { i: 1, n: 3 })).toBe('帧 1 / 3')
  })
})
