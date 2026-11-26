/**
 * Which compare modes two documents support (builtin-plugins.md「文档 · 对比视图」, prototype compare.js). Pure.
 */
import type { AssetDetail, CompareModeSupport } from '@bowerbird/schema'
import { kindOfName } from '../../shared/text.js'
import { t } from '../i18n.js'

/** prototype compare.js `WHY.text`. */
export const REASON_TEXT = '文本按行显示差异'
export const REASON_HTML = '网页原型只能并排'

type A = Pick<AssetDetail, 'format' | 'name' | 'bundle'>

export function docCompareModes(left: A, right: A): CompareModeSupport[] | null {
  if (left.format !== 'doc' || right.format !== 'doc') return null
  const ka = kindOfName(left.name, left.bundle), kb = kindOfName(right.name, right.bundle)
  if (!ka || !kb) return null
  const html = ka === 'html', htmlB = kb === 'html'
  if (html !== htmlB) return null
  if (html) {
    return [
      { mode: 'side', available: true, default: true },
      { mode: 'wipe', available: false, reason: t('reasonHtml') },
      { mode: 'overlay', available: false, reason: t('reasonHtml') },
      { mode: 'diff', available: false, reason: t('reasonHtml') }
    ]
  }
  return [
    { mode: 'side', available: true, default: true },
    { mode: 'wipe', available: false, reason: t('reasonText') },
    { mode: 'overlay', available: false, reason: t('reasonText') },
    { mode: 'diff', available: true }
  ]
}
