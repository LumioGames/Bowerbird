import { describe, expect, it } from 'vitest'
import type { AssetDetail } from '@bowerbird/schema'
import web, { imageTechRows } from '../index'
import { inLocale } from '../i18n'

/** The inspector's 技术信息 for an image, as the prototype writes it (flows.js techRows). */
const tile = { tech: { width: 2048, height: 2048, channels: 4, hasAlpha: true, colorSpace: 'srgb', frames: 1, dpi: 72 } } as unknown as AssetDetail

describe('image tech rows', () => {
  it('Chinese: 尺寸「2048 × 2048」, 透明通道 有 / 无, 色彩空间「sRGB」', () => {
    expect(imageTechRows(tile, inLocale('zh-CN'))).toEqual([['尺寸', '2048 × 2048'], ['透明通道', '有'], ['色彩空间', 'sRGB']])
    const grey = { tech: { width: 16384, height: 9216, hasAlpha: false, colorSpace: 'grey16' } } as unknown as AssetDetail
    expect(imageTechRows(grey, inLocale('zh-CN'))).toEqual([['尺寸', '16384 × 9216'], ['透明通道', '无'], ['色彩空间', '灰度 16 位']])
    // the shell calls the hook with the page language
    expect(web.formats!.image!.techRows!(tile, 'zh-CN')).toEqual([['尺寸', '2048 × 2048'], ['透明通道', '有'], ['色彩空间', 'sRGB']])
  })
  it('English and Korean; a colour space the plugin has no name for stays as sharp wrote it', () => {
    expect(imageTechRows(tile, inLocale('en'))).toEqual([['Size', '2048 × 2048'], ['Alpha channel', 'Yes'], ['Colour space', 'sRGB']])
    const cmyk = { tech: { width: 640, height: 480, hasAlpha: false, colorSpace: 'cmyk' } } as unknown as AssetDetail
    expect(imageTechRows(cmyk, inLocale('ko'))).toEqual([['크기', '640 × 480'], ['알파 채널', '없음'], ['색 공간', 'CMYK']])
    const odd = { tech: { width: 8, height: 8, colorSpace: 'multiband' } } as unknown as AssetDetail
    expect(imageTechRows(odd, inLocale('en'))).toEqual([['Size', '8 × 8'], ['Alpha channel', '—'], ['Colour space', 'multiband']])
  })
  it('nothing to summarise without a size (the shell lists the keys)', () => {
    expect(imageTechRows({ tech: {} } as unknown as AssetDetail, inLocale('en'))).toBeNull()
    expect(imageTechRows({ tech: { width: 10, hasAlpha: true } } as unknown as AssetDetail, inLocale('zh-CN'))).toBeNull()
  })
})
