/**
 * Markdown to HTML for the document viewer (markdown-it, raw HTML off). A paragraph that is only `bb://<GUID>`
 * (or a link to it) becomes a card placeholder `<div data-bb-card>`; links to `bb://` get `data-bb-asset`;
 * images go through `env.image` so relative paths resolve through slots, and anything outside the library becomes
 * a placeholder with its address (nothing external is fetched). Pure (no DOM).
 */
import MarkdownIt from 'markdown-it'
import { bbGuid } from '../../shared/text.js'

export interface RenderEnv {
  /**
   * Resolve an image `src` as written in the file to an address inside the library (slot, bundle, `bb://`) or a
   * `data:` / `blob:` URL; null means it is not loaded (external addresses) and a placeholder shows the address.
   */
  image(src: string): string | null
}

type Tok = { type: string; content: string; attrs: Array<[string, string]> | null; children: Tok[] | null; meta: unknown; attrGet(n: string): string | null; attrSet(n: string, v: string): void }

let engine: MarkdownIt | null = null
function markdown(): MarkdownIt {
  if (engine) return engine
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
  // A paragraph holding only `bb://<GUID>` (or a link to it) becomes an asset card.
  md.core.ruler.push('bb_cards', state => {
    const t = state.tokens as unknown as Tok[]
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i]!.type !== 'paragraph_open' || t[i + 1]!.type !== 'inline' || t[i + 2]!.type !== 'paragraph_close') continue
      const inl = t[i + 1]!
      let guid = bbGuid(inl.content)
      const kids = inl.children ?? []
      if (!guid && kids.length === 3 && kids[0]!.type === 'link_open' && kids[2]!.type === 'link_close') guid = bbGuid(kids[0]!.attrGet('href') ?? '')
      if (!guid) continue
      const card = new state.Token('bb_card', 'div', 0) as unknown as Tok
      card.meta = guid
      t.splice(i, 3, card)
    }
  })
  md.renderer.rules.bb_card = (tokens, idx) => `<div data-bb-card="${String((tokens[idx] as unknown as Tok).meta)}"></div>\n`
  const image = md.renderer.rules.image!
  md.renderer.rules.image = (tokens, idx, opts, env: RenderEnv, self) => {
    const tok = tokens[idx]!
    const raw = tok.attrGet('src') ?? ''
    const src = env.image(raw)
    if (src === null) {
      const alt = self.renderInlineAsText(tok.children ?? [], opts, env)
      const esc = md.utils.escapeHtml
      return `<span data-bb-ext-img title="${esc(raw)}">${alt ? `<span>${esc(alt)}</span>` : ''}<code>${esc(raw)}</code></span>`
    }
    tok.attrSet('src', src)
    tok.attrSet('loading', 'lazy')
    return image(tokens, idx, opts, env, self)
  }
  const linkOpen = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const tok = tokens[idx]!
    const href = tok.attrGet('href') ?? ''
    const guid = bbGuid(href)
    if (guid) { tok.attrSet('href', '#'); tok.attrSet('data-bb-asset', guid) } else if (/^https?:/i.test(href)) { tok.attrSet('target', '_blank'); tok.attrSet('rel', 'noopener noreferrer') }
    return linkOpen(tokens, idx, opts, env, self)
  }
  // markdown-it refuses unknown schemes it considers unsafe; bb:// is ours.
  const validate = md.validateLink.bind(md)
  md.validateLink = url => /^bb:\/\//i.test(url) || validate(url)
  engine = md
  return md
}

export function renderMarkdown(body: string, env: RenderEnv): string {
  return markdown().render(body, env)
}

