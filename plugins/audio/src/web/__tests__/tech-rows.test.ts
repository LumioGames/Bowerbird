import { describe, expect, it } from 'vitest'
import type { AssetDetail } from '@bowerbird/schema'
import web, { audioTechRows } from '../index'
import { inLocale } from '../i18n'

/** The inspector's 技术信息 for a sound, as the prototype writes it (flows.js techRows). */
const open = { tech: { duration: 0.8, channels: 2, sampleRate: 48000, bitDepth: 16, codec: 'PCM', loudness: -16.2, peak: -1.3, clips: 0 } } as unknown as AssetDetail

describe('audio tech rows', () => {
  it('Chinese: 时长「0.8 秒」, 声道 立体声, 采样率「48 kHz」, 响度「−16.2 LUFS」', () => {
    expect(audioTechRows(open, inLocale('zh-CN'))).toEqual([['时长', '0.8 秒'], ['声道', '立体声'], ['采样率', '48 kHz'], ['响度', '−16.2 LUFS']])
    expect(web.formats!.audio!.techRows!(open, 'zh-CN')).toEqual([['时长', '0.8 秒'], ['声道', '立体声'], ['采样率', '48 kHz'], ['响度', '−16.2 LUFS']])
  })
  it('mono at 44.1 kHz, minutes, more channels; no 响度 below the gate', () => {
    const music = { tech: { duration: 134.2, channels: 1, sampleRate: 44100, codec: 'MP3' } } as unknown as AssetDetail
    expect(audioTechRows(music, inLocale('zh-CN'))).toEqual([['时长', '2:14'], ['声道', '单声道'], ['采样率', '44.1 kHz']])
    const surround = { tech: { duration: 3, channels: 6, sampleRate: 22050, loudness: -23 } } as unknown as AssetDetail
    expect(audioTechRows(surround, inLocale('zh-CN'))).toEqual([['时长', '3.0 秒'], ['声道', '6 声道'], ['采样率', '22.05 kHz'], ['响度', '−23.0 LUFS']])
  })
  it('English and Japanese', () => {
    expect(audioTechRows(open, inLocale('en'))).toEqual([['Duration', '0.8 s'], ['Channels', 'Stereo'], ['Sample rate', '48 kHz'], ['Loudness', '−16.2 LUFS']])
    const surround = { tech: { duration: 3, channels: 6, sampleRate: 48000 } } as unknown as AssetDetail
    expect(audioTechRows(surround, inLocale('ja'))).toEqual([['長さ', '3.0 秒'], ['チャンネル', '6 チャンネル'], ['サンプルレート', '48 kHz']])
  })
  it('nothing to summarise without duration, channels or sample rate (the shell lists the keys)', () => {
    expect(audioTechRows({ tech: {} } as unknown as AssetDetail, inLocale('en'))).toBeNull()
    expect(audioTechRows({ tech: { codec: 'PCM', clips: 0 } } as unknown as AssetDetail, inLocale('zh-CN'))).toBeNull()
  })
})
