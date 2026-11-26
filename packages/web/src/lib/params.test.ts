import { afterEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale } from './i18n'
import { paramsText } from './params'

/** Record parameters read the way the prototype writes them (data.js RECS); unknown keys stay as written. */
const was = getLocale()
afterEach(() => setLocale(was))

describe('production-record parameters in words', () => {
  it('the sample library\'s records, in Chinese', () => {
    setLocale('zh-CN')
    expect(paramsText('export', { scale: 1, animationBakeFps: 30, textureSize: 1024 })).toBe('缩放 1 · 动画烘焙 30 fps · 贴图 1024')
    expect(paramsText('ai-generate', { seed: 4211, size: '1536×1536', steps: 30 })).toBe('seed 4211 · 1536×1536 · 30 步')
    expect(paramsText('render', { channel: 'full', environment: 'studio', projection: 'perspective', fov: 35, size: '256×256' })).toBe('通道 完整渲染 · 环境 工作室 · 透视 35° · 256×256')
    expect(paramsText('slice', { count: 12, scale: 2, trim: true, rect: { a: [0, 0, 1, 1] } })).toBe('12 张 · 2× 导出 · 透明裁边')
    expect(paramsText('render', { frame: 42, time: 1.4, width: 1280, height: 720 })).toBe('第 42 帧 · 1280×720')
  })

  it('a grouping object is read key by key; unknown keys and values stay as written; off switches are left out', () => {
    setLocale('zh-CN')
    expect(paramsText('render', { channel: '完整渲染', camera: { projection: 'orthographic' }, environment: { name: 'sunset.hdr', exposure: 0.5, toneMapping: 'neutral' } }))
      .toBe('通道 完整渲染 · 正交 · 环境 sunset.hdr · 曝光 0.5 · 色调映射 中性')
    expect(paramsText('community.forge/image', { quality: 'high', transparent: false })).toBe('quality high')
    expect(paramsText('export', {})).toBe('')
    expect(paramsText('export', undefined)).toBe('')
  })

  it('other languages', () => {
    setLocale('en')
    expect(paramsText('export', { scale: 1, animationBakeFps: 30, textureSize: 1024 })).toBe('scale 1 · animation baked at 30 fps · textures 1024')
    setLocale('ja')
    expect(paramsText('ai-generate', { seed: 4211, size: '1536×1536', steps: 30 })).toBe('seed 4211 · 1536×1536 · 30 ステップ')
  })
})
