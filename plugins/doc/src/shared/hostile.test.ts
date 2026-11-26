/**
 * Hostile text: every helper that runs on untrusted documents (server probe and the browser viewer) must stay
 * linear. Each call is interrupted after its time limit (vm timeout), so a backtracking pattern fails instead
 * of hanging the run.
 */
import { describe, expect, it } from 'vitest'
import { runWithin } from '@bowerbird/plugin-sdk/testing'
import { decodeEntities, excerptOf, htmlText, htmlTitle, markdownImageRefs, markdownText, markdownTitle, parseFrontMatter, plainText, titleOf } from './text.js'

const N = 20_000
const LIMIT = 500
const ws = ' '.repeat(N)

describe('Markdown helpers stay linear on hostile lines', () => {
  it('heading with a long run of spaces before the last word', () => {
    expect(runWithin(LIMIT, () => markdownTitle('# a' + ws + 'b'))).toMatch(/^a\s+b$/)
    expect(runWithin(LIMIT, () => markdownText('## a' + ws + 'b ##'))).toMatch(/^a\s+b$/)
  })
  it('closing hashes, spaces and setext underlines', () => {
    expect(runWithin(LIMIT, () => markdownTitle('# title' + ws + '#'.repeat(N) + ws + 'x'))).toContain('title')
    expect(runWithin(LIMIT, () => markdownTitle('# Title ##   '))).toBe('Title')
    expect(runWithin(LIMIT, () => markdownTitle('#'.repeat(6) + ' ' + '#'.repeat(N)))).toBeNull()
    expect(runWithin(LIMIT, () => markdownTitle('Title\n' + '='.repeat(N) + 'x'))).toBeNull()
  })
  it('plain text of lines full of syntax characters', () => {
    for (const line of ['a' + ws + 'b', '![' .repeat(N), '['.repeat(N) + '](', ']('.repeat(N), '**'.repeat(N), '_'.repeat(N) + 'x', '`'.repeat(N), '~~'.repeat(N), '|' + ' :---'.repeat(N) + ' x', '- '.repeat(N) + 'x', '#'.repeat(N), '> '.repeat(N), '1'.repeat(N) + 'x', '-'.repeat(3) + ws + 'x']) {
      runWithin(LIMIT, () => { markdownText(line + '\n' + line); excerptOf('markdown', line + '\n' + line, 'x') }, line.slice(0, 12))
    }
  })
  it('image references on hostile lines', () => {
    for (const line of ['!['.repeat(N), '![a](' + ' '.repeat(N), '![a](<' + 'x'.repeat(N), '![]('.repeat(N)]) runWithin(LIMIT, () => markdownImageRefs(line))
    expect(markdownImageRefs('![a](tex/a.png "t") ![b](<b c.png>) ![c](https://x/y.png)')).toEqual(['tex/a.png', 'b c.png'])
  })
  it('front matter values with long whitespace', () => {
    const fm = runWithin(LIMIT, () => parseFrontMatter('---\nsize: a' + ws + 'b\ntitle:' + ws + '\n' + 'k'.repeat(N) + '\n---\nbody'))
    expect(fm.fields[0]).toEqual({ key: 'size', value: 'a' + ws + 'b', comment: '' })
    expect(fm.fields[1]).toEqual({ key: 'title', value: '', comment: '' })
  })
})

describe('HTML helpers stay linear on hostile markup', () => {
  it('unclosed comments, tags and raw-text elements', () => {
    for (const doc of ['<!--'.repeat(N), '<'.repeat(N), '< '.repeat(N) + '>', '<script>'.repeat(N), '<title>'.repeat(N), '<h1>'.repeat(N), '<a' + ' x'.repeat(N), '&'.repeat(N) + 'amp', '&#'.repeat(N), '&#x'.repeat(N) + 'zz', '<!'.repeat(N), '<!x'.repeat(N) + '>', '<?'.repeat(N)]) {
      runWithin(LIMIT, () => { htmlText(doc); htmlTitle(doc); plainText('html', doc); excerptOf('html', doc, 'x') }, doc.slice(0, 10))
    }
  })
  it('still reads ordinary markup', () => {
    expect(htmlText('<p>a &amp; b</p><script>x()</script><br>c<!-- no -->d')).toBe('a & b\n\nc d')
    expect(htmlTitle('<TITLE>商店 &lt;v2&gt;</TITLE>')).toBe('商店 <v2>')
  })
})

describe('entities', () => {
  it('decodes out-of-range code points as U+FFFD instead of throwing', () => {
    expect(decodeEntities('&#x110000;|&#99999999999;|&#0;|&#x41;')).toBe('�|�|�|A')
  })
})

describe('JSON excerpt', () => {
  it('does not parse or pretty-print the whole document', () => {
    const deep = '['.repeat(200_000) + ']'.repeat(200_000)
    expect(runWithin(LIMIT, () => excerptOf('json', deep, 'x.json')).length).toBeLessThanOrEqual(160)
    expect(runWithin(LIMIT, () => titleOf('json', deep, 'x.json'))).toBe('x.json')
  })
})
