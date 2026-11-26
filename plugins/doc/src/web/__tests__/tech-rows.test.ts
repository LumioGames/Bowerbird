import { describe, expect, it } from 'vitest'
import type { AssetDetail } from '@bowerbird/schema'
import web, { docTechRows } from '../index'
import { inLocale } from '../i18n'

/** The inspector's 技术信息 for a document, as the prototype writes it (flows.js techRows). */
const brief = { tech: { title: '宝箱', words: 318, lines: 42, targetWidth: 1.26, targetHeight: 0.95, targetDepth: 0.87 } } as unknown as AssetDetail

describe('doc tech rows', () => {
  it('Chinese: 字数, 行数 — no 标题 and no 目标宽 / 高 / 深 (the shell shows 目标尺寸 once)', () => {
    expect(docTechRows(brief, inLocale('zh-CN'))).toEqual([['字数', '318'], ['行数', '42']])
    expect(web.formats!.doc!.techRows!(brief, 'zh-CN')).toEqual([['字数', '318'], ['行数', '42']])
    const long = { tech: { title: 'notes', words: 12840, lines: 1503 } } as unknown as AssetDetail
    expect(docTechRows(long, inLocale('zh-CN'))).toEqual([['字数', '12,840'], ['行数', '1,503']])
  })
  it('English and Korean', () => {
    expect(docTechRows(brief, inLocale('en'))).toEqual([['Words', '318'], ['Lines', '42']])
    expect(docTechRows(brief, inLocale('ko'))).toEqual([['단어 수', '318'], ['줄 수', '42']])
  })
  it('nothing to summarise without either count (the shell lists the keys)', () => {
    expect(docTechRows({ tech: {} } as unknown as AssetDetail, inLocale('en'))).toBeNull()
    expect(docTechRows({ tech: { title: 'x' } } as unknown as AssetDetail, inLocale('zh-CN'))).toBeNull()
  })
})
