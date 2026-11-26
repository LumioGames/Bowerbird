import { describe, expect, it } from 'vitest'
import type { AssetDetail } from '@bowerbird/schema'
import web, { videoTechRows } from '../index'
import { inLocale } from '../i18n'

/** The inspector's 技术信息 for a video, as the prototype writes it (flows.js techRows). */
const clip = { tech: { hasAudio: false, container: 'mp4', duration: 3.033, width: 1280, height: 720, frameRate: 30, codec: 'H.264' } } as unknown as AssetDetail

describe('video tech rows', () => {
  it('Chinese: 时长「0:03」, 分辨率「1280 × 720」, 帧率「30」', () => {
    expect(videoTechRows(clip, inLocale('zh-CN'))).toEqual([['时长', '0:03'], ['分辨率', '1280 × 720'], ['帧率', '30']])
    expect(web.formats!.video!.techRows!(clip, 'zh-CN')).toEqual([['时长', '0:03'], ['分辨率', '1280 × 720'], ['帧率', '30']])
    const film = { tech: { duration: 3725, width: 1920, height: 1080, frameRate: 23.976 } } as unknown as AssetDetail
    expect(videoTechRows(film, inLocale('zh-CN'))).toEqual([['时长', '1:02:05'], ['分辨率', '1920 × 1080'], ['帧率', '23.976']])
  })
  it('Japanese; what the container did not tell is「—」', () => {
    expect(videoTechRows(clip, inLocale('ja'))).toEqual([['長さ', '0:03'], ['解像度', '1280 × 720'], ['フレームレート', '30']])
    const bare = { tech: { hasAudio: true, container: 'webm', duration: 12.5 } } as unknown as AssetDetail
    expect(videoTechRows(bare, inLocale('zh-CN'))).toEqual([['时长', '0:13'], ['分辨率', '—'], ['帧率', '—']])
  })
  it('nothing to summarise without duration, size or frame rate (the shell lists the keys)', () => {
    expect(videoTechRows({ tech: { hasAudio: false, container: 'mp4' } } as unknown as AssetDetail, inLocale('en'))).toBeNull()
  })
})
