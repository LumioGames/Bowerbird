import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './md.js'

const env = { image: (s: string) => (s.startsWith('bb://') ? '/file/' + s.slice(5) : s.startsWith('http') ? null : 'slot:' + s) }
const G = '0192f3a4-7c1e-7b52-9d06-4e8a51c0d202'

describe('renderMarkdown', () => {
  it('renders tables, code blocks and headings', () => {
    const h = renderMarkdown('# 宝箱\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nx < y\n```\n', env)
    expect(h).toContain('<h1>宝箱</h1>')
    expect(h).toContain('<table>')
    expect(h).toContain('<pre><code>x &lt; y')
  })
  it('turns a bb:// paragraph into a card and bb:// links into asset links', () => {
    const h = renderMarkdown(`intro\n\nbb://${G}\n\n[原画](bb://${G}) and [site](https://example.com)\n`, env)
    expect(h).toContain(`<div data-bb-card="${G}"></div>`)
    expect(h).toContain(`<a href="#" data-bb-asset="${G}">原画</a>`)
    expect(h).toContain('target="_blank" rel="noopener noreferrer"')
    expect(renderMarkdown(`[bb://${G}](bb://${G})`, env)).toContain('data-bb-card')
  })
  it('resolves images through the environment', () => {
    const h = renderMarkdown(`![a](tex/a.png) ![b](bb://${G})`, env)
    expect(h).toContain('src="slot:tex/a.png"')
    expect(h).toContain(`src="/file/${G}"`)
  })
  it('never loads external images: a placeholder shows the address', () => {
    const h = renderMarkdown('![logo <x>](https://evil.example/t.png?a=1&b=2)', env)
    expect(h).not.toContain('<img')
    expect(h).toContain('<span data-bb-ext-img title="https://evil.example/t.png?a=1&amp;b=2"><span>logo &lt;x&gt;</span><code>https://evil.example/t.png?a=1&amp;b=2</code></span>')
  })
  it('shows raw HTML as text and drops unsafe links', () => {
    const h = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n', env)
    expect(h).not.toContain('<script>')
    expect(h).toContain('&lt;script&gt;')
    expect(h).not.toContain('href="javascript')
  })
})
