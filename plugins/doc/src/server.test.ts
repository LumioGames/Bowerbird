import { afterAll, describe, expect, it } from 'vitest'
import { assetFileFor, fileRefFor, sampleDir, SAMPLE_HTML, SAMPLE_JSON, SAMPLE_MARKDOWN, SAMPLE_TEXT } from '@bowerbird/plugin-sdk/testing'
import { docFormat } from './server.js'

const files = sampleDir('bb-doc-')
afterAll(() => files.cleanup())

describe('docFormat', () => {
  it('claims text documents by extension and refuses binary content', async () => {
    expect(await docFormat.match(fileRefFor(files.write('chest.md', SAMPLE_MARKDOWN)))).toEqual({ format: 'doc', confidence: 1 })
    expect(await docFormat.match(fileRefFor(files.write('bin.txt', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]))))).toBeNull()
    expect(await docFormat.match(fileRefFor(files.write('pic.png', 'text')))).toBeNull()
  })

  it('claims a bundle that has an index.html, and reads it', async () => {
    files.write('shop_v2/index.html', SAMPLE_HTML)
    files.write('shop_v2/shop.js', 'console.log(1)')
    files.write('plain/readme.txt', 'x')
    const ref = fileRefFor(files.dir + '/shop_v2')
    expect(ref.bundle).toBe(true)
    expect(await docFormat.match(ref)).toEqual({ format: 'doc', confidence: 0.9 })
    expect(await docFormat.match(fileRefFor(files.dir + '/plain'))).toBeNull()
    const p = await docFormat.probe!(assetFileFor(files.dir + '/shop_v2'))
    expect(p.tech.title).toBe('商店界面原型')
  })

  it('probes Markdown: title, counts, target size from front matter, text, excerpt', async () => {
    const p = await docFormat.probe!(assetFileFor(files.write('chest.md', SAMPLE_MARKDOWN)))
    expect(p.tech).toMatchObject({ title: '宝箱', targetWidth: 1.26, targetHeight: 0.95, targetDepth: 0.87, lines: 16 })
    expect(p.tech.words).toBeGreaterThan(20)
    expect(p.text!.startsWith('新手村第一个可以打开的容器')).toBe(true)
    expect(p.text!.endsWith('宝箱')).toBe(true)
    expect(p.text).not.toContain('size:')
    expect((p.analysis as { excerpt: string }).excerpt.startsWith('新手村第一个可以打开的容器')).toBe(true)
    expect(p.badge).toBeUndefined()
  })

  it('reports relative images in Markdown as slot names', async () => {
    const p = await docFormat.probe!(assetFileFor(files.write('guide.md', '# 规范\n\n![](tex/chest_basecolor.png)\n![](https://x.y/z.png)\n')))
    expect(p.references).toEqual(['tex/chest_basecolor.png'])
  })

  it('probes HTML, TXT and JSON', async () => {
    const h = await docFormat.probe!(assetFileFor(files.write('shop.html', SAMPLE_HTML)))
    expect(h.tech).toMatchObject({ title: '商店界面原型', lines: 3 })
    expect(h.text).toContain('杂货铺')
    expect(h.text).not.toContain('document.title')
    // the grid cell shows the title and the page's visible text, never its source
    expect((h.analysis as { excerpt: string }).excerpt).toBe('杂货铺货架 4×2')
    const t = await docFormat.probe!(assetFileFor(files.write('changelog.txt', SAMPLE_TEXT)))
    expect(t.tech).toMatchObject({ title: 'changelog.txt', lines: 2 })
    const j = await docFormat.probe!(assetFileFor(files.write('export_presets.json', SAMPLE_JSON)))
    expect(j.tech).toMatchObject({ title: 'export_presets.json', valid: true, lines: 5 })
    expect((j.analysis as { excerpt: string }).excerpt.startsWith('{ "version": 2')).toBe(true)
    expect((await docFormat.probe!(assetFileFor(files.write('broken.json', '{ nope')))).tech.valid).toBe(false)
  })

  it('summarises the title, the target size and the opening lines', async () => {
    const s = await docFormat.summarize!(assetFileFor(files.write('chest.md', SAMPLE_MARKDOWN)))
    expect(s.text.split('\n').slice(0, 4)).toEqual(['标题：宝箱', '目标尺寸：1.26 × 0.95 × 0.87 m（宽 × 高 × 深）', '', '新手村第一个可以打开的容器。玩家在这里学会「靠近、交互、获得」。'])
    const t = await docFormat.summarize!(assetFileFor(files.write('n.txt', 'line one\nline two\n')))
    expect(t.text).toBe('标题：n.txt\n\nline one\nline two')
  })

  it('does not implement server thumbnails (thumbnail: none)', () => {
    expect(docFormat.thumbnail).toBeUndefined()
  })
})
