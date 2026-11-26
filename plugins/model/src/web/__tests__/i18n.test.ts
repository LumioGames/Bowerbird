/**
 * Model UI text in both shell languages: every string literal, template and JSX text in the web part with Chinese
 * in it lives in the dictionary (i18n.ts), and the English dictionary has every key.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { DICTS, translate } from '../i18n'

const WEB = path.resolve(import.meta.dirname, '..')
const ts = createRequire(path.resolve(WEB, '../../../../package.json'))('typescript') as typeof import('typescript')
const CJK = /[　-〿㐀-鿿＀-￯]/

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(p)
    return /\.tsx?$/.test(e.name) && e.name !== 'i18n.ts' ? [p] : []
  })
}

/** Chinese text in code (not comments): string literals, templates, JSX text. */
function chineseLiterals(file: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (n: import('typescript').Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) && CJK.test(n.text)) out.push(`${path.relative(WEB, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.text.trim()}`)
    if (ts.isTemplateExpression(n)) {
      const parts = [n.head.text, ...n.templateSpans.map(s => s.literal.text)]
      if (parts.some(p => CJK.test(p))) out.push(`${path.relative(WEB, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${parts.join('…')}`)
    }
    n.forEachChild(visit)
  }
  visit(sf)
  return out
}

describe('model UI text (zh-CN / en)', () => {
  it('no Chinese text outside the dictionary', () => {
    expect(sources(WEB).flatMap(chineseLiterals)).toEqual([])
  })
  it('English has every key, with the same placeholders, and no Chinese', () => {
    const zh = DICTS['zh-CN'], en = DICTS.en
    for (const k of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(en[k], k).toBeTruthy()
      expect(CJK.test(en[k]), `${k}: ${en[k]}`).toBe(false)
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
      expect(ph(en[k]), k).toEqual(ph(zh[k]))
    }
  })
  it('fills placeholders', () => {
    expect(translate('en', 'missingNote', { name: 'a.png' })).toContain('a.png')
    expect(translate('zh-CN', 'missingNote', { name: 'a.png' })).toBe('缺少 a.png')
  })
})
