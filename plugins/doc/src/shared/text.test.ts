import { describe, expect, it } from 'vitest'
import {
  bbGuid, countLines, countWords, decodeText, excerptOf, htmlText, htmlTitle, kindOfName, looksLikeText, markdownImageRefs,
  markdownText, markdownTitle, openingLines, parseFrontMatter, relativeRef, titleOf
} from './text.js'

const MD = `---
size: 1.26 × 0.95 × 0.87 m   # 宽 × 高 × 深
title: "宝箱说明"
---
# 宝箱

新手村第一个可以打开的容器。**卡通**、低多边形。

![原画](./art/chest%20concept.png "原画")
![远程](https://example.com/a.png)
![库内](bb://0192f3a4-7c1e-7b52-9d06-4e8a51c0d202)

| 项目 | 要求 |
|---|---|
| 三角面 | 不超过 5,000 |

\`\`\`
# not a heading
\`\`\`
`

describe('front matter', () => {
  it('reads flat key: value lines with comments and quotes', () => {
    const fm = parseFrontMatter(MD)
    expect(fm.fields).toEqual([
      { key: 'size', value: '1.26 × 0.95 × 0.87 m', comment: '宽 × 高 × 深' },
      { key: 'title', value: '宝箱说明', comment: '' }
    ])
    expect(fm.lines).toBe(4)
    expect(fm.body.startsWith('# 宝箱')).toBe(true)
  })
  it('ignores a file without a closing fence', () => {
    expect(parseFrontMatter('---\nsize: 1x1x1\n# x').fields).toEqual([])
  })
})

describe('titles', () => {
  it('takes the first heading, outside code, or the name', () => {
    expect(markdownTitle(MD)).toBe('宝箱')
    expect(markdownTitle('Intro\n=====\n\ntext')).toBe('Intro')
    expect(markdownTitle('```\n# code\n```\nplain')).toBeNull()
    expect(titleOf('markdown', '---\ntitle: 说明\n---\nplain', 'a.md')).toBe('说明')
    expect(titleOf('text', 'hello', 'changelog.txt')).toBe('changelog.txt')
    expect(htmlTitle('<html><head><title> 商店 &amp; 界面 </title></head></html>')).toBe('商店 & 界面')
    expect(htmlTitle('<body><h1>杂货铺</h1></body>')).toBe('杂货铺')
    expect(titleOf('html', '<p>no title</p>', 'shop')).toBe('shop')
  })
})

describe('plain text and counts', () => {
  it('strips Markdown syntax but keeps the words', () => {
    const t = markdownText(parseFrontMatter(MD).body)
    expect(t).toContain('新手村第一个可以打开的容器。卡通、低多边形。')
    expect(t).toContain('三角面  不超过 5,000')
    expect(t).not.toContain('**')
    expect(t).not.toContain('|---')
    expect(markdownText('a\n\nbb://0192f3a4-7c1e-7b52-9d06-4e8a51c0d202\n\nb')).toBe('a\n\nb')
  })
  it('extracts visible HTML text', () => {
    expect(htmlText('<style>p{}</style><p>货架&nbsp;4×2</p><script>x()</script><div>购买</div>')).toBe('货架 4×2\n购买')
  })
  it('counts CJK characters and other words', () => {
    expect(countWords('宝箱 chest_basecolor.png 5,000')).toBe(2 + 2 + 2)
    expect(countWords('')).toBe(0)
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('')).toBe(0)
  })
  it('builds excerpts and opening lines without the title', () => {
    expect(excerptOf('markdown', MD, '宝箱').startsWith('新手村第一个')).toBe(true)
    expect(excerptOf('json', '{\n "version": 2,\n "target": "glb"\n}', 'x.json')).toBe('{ "version": 2, "target": "glb" }')
    expect(excerptOf('text', 'a'.repeat(400), 'x.txt')).toHaveLength(160)
    expect(openingLines('markdown', MD, '宝箱', 2)).toEqual(['新手村第一个可以打开的容器。卡通、低多边形。', '原画'])
  })
  it('gives a text grid cell the prose only: no headings, tables, code, images or cards (prototype .bb-cell__doc)', () => {
    const md = '---\nsize: 1 × 1 × 1 m\n---\n# 宝箱\n\n新手村第一个可以打开的容器。\n\n## 美术风格\n\n卡通、低多边形。\n\n' +
      'bb://0192f3a4-7c1e-7b52-9d06-4e8a51c0d202\n\n![原画](art/a.png)\n\n| 项目 | 要求 |\n|---|---|\n| 三角面 | 不超过 5,000 |\n\n规格\n---\n\n```\nblender a.blend\n```\n\n- 导出 **glb**\n'
    expect(excerptOf('markdown', md, '宝箱')).toBe('新手村第一个可以打开的容器。卡通、低多边形。导出 glb')
    expect(excerptOf('markdown', '# Guide\n\nFirst line.\nSecond line.\n\n## More\n\nThird.', 'Guide')).toBe('First line. Second line. Third.')
    // nothing but headings and tables: the plain text, as before
    expect(excerptOf('markdown', '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', 'T')).toBe('a  b 1  2')
  })
  it('gives an HTML page its visible text: no doctype, no title, no head', () => {
    const html = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>商店界面原型</title><style>p{}</style></head>\n' +
      '<body><?xml-stylesheet x?><header><b>杂货铺</b> <span>1,240</span></header><footer>购买</footer></body></html>'
    expect(htmlText(html)).toBe('杂货铺 1,240\n购买')
    expect(htmlTitle(html)).toBe('商店界面原型')
    expect(excerptOf('html', html, '商店界面原型')).toBe('杂货铺 1,240 购买')
  })
})

describe('references and kinds', () => {
  it('reports relative Markdown images as slot names only', () => {
    expect(markdownImageRefs(MD)).toEqual(['art/chest concept.png'])
    expect(relativeRef('data:image/png;base64,xx')).toBeNull()
    expect(relativeRef('/abs.png')).toBeNull()
    expect(relativeRef('tex/a.png?v=2#x')).toBe('tex/a.png')
  })
  it('reads bb:// links', () => {
    expect(bbGuid('bb://0192F3A4-7c1e-7b52-9d06-4e8a51c0d202')).toBe('0192f3a4-7c1e-7b52-9d06-4e8a51c0d202')
    expect(bbGuid('bb://chest.png')).toBeNull()
  })
  it('knows kinds and text', () => {
    expect(kindOfName('A.MD')).toBe('markdown')
    expect(kindOfName('shop', true)).toBe('html')
    expect(kindOfName('x.png')).toBeNull()
    expect(looksLikeText(new Uint8Array([0x89, 0x50, 0, 1]))).toBe(false)
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0]))).toBe('a')
  })
})
