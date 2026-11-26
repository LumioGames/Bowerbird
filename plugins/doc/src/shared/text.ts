/**
 * Document text helpers shared by the server (probe, summary) and the viewer: kinds, front matter, titles,
 * plain text, word and line counts, excerpts. Pure.
 */

export type DocKind = 'markdown' | 'html' | 'text' | 'json'

export function kindOfName(name: string, bundle = false): DocKind | null {
  if (bundle) return 'html'
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'txt') return 'text'
  if (ext === 'json') return 'json'
  return null
}

/** Text from bytes: UTF-8 (BOM stripped) or UTF-16 with a BOM. */
export function decodeText(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  const s = new TextDecoder('utf-8').decode(b)
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** Looks like text: a UTF-16 BOM, or no NUL byte in the first 8 KiB. */
export function looksLikeText(head: Uint8Array): boolean {
  if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) return true
  const n = Math.min(head.length, 8192)
  for (let i = 0; i < n; i++) if (head[i] === 0) return false
  return true
}

/* ───────────── front matter ───────────── */

export interface FrontMatterField { key: string; value: string; comment: string }
export interface FrontMatter { fields: FrontMatterField[]; body: string; /** Lines taken by the front matter block. */ lines: number }

/**
 * `---` block at the very top of a Markdown file. Only `key: value  # comment` lines are read (a flat YAML
 * subset — enough for `size:`, `title:` and similar design-object fields).
 */
export function parseFrontMatter(src: string): FrontMatter {
  const lines = src.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { fields: [], body: src, lines: 0 }
  const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'))
  if (end < 0) return { fields: [], body: src, lines: 0 }
  const fields: FrontMatterField[] = []
  for (const raw of lines.slice(1, end)) {
    // Linear on purpose (untrusted text): trim first, then read `key:` and split off a `# comment` by hand.
    const l = raw.trimEnd()
    const m = /^([A-Za-z_][\w-]*)[ \t]*:/.exec(l)
    if (!m) continue
    let value = l.slice(m[0].length).trim(), comment = ''
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '#' && (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\t')) { comment = value.slice(i + 1).trim(); value = value.slice(0, i).trim(); break }
    }
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) value = value.slice(1, -1)
    fields.push({ key: m[1]!, value, comment })
  }
  return { fields, body: lines.slice(end + 1).join('\n'), lines: end + 1 }
}

/* ───────────── plain text ───────────── */
// Everything below runs on untrusted documents, on the server and in the viewer: hand-written scanners and
// patterns without nested or adjacent unbounded quantifiers, so the work stays linear in the input.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]{1,16}|#\d{1,16}|[a-zA-Z][a-zA-Z0-9]{0,31});/g, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�'
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Elements whose content is not page text (the title shows in the tab, and is the document's title already). */
const RAW_TEXT = new Set(['script', 'style', 'template', 'noscript', 'title'])
/** Closing these (or any `<br>`) ends a line. */
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'br', 'section', 'article', 'header', 'footer', 'main', 'ul', 'ol', 'table'])

/** Visible text of an HTML document: scripts, styles and tags removed, entities decoded, blank runs folded. */
export function htmlText(html: string): string {
  const out: string[] = []
  const n = html.length
  const nameRe = /\/?([a-zA-Z][a-zA-Z0-9-]*)/y
  let i = 0, nextGt = -1
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { out.push(html.slice(i)); break }
    out.push(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      out.push(' ')
      i = end < 0 ? n : end + 3
      continue
    }
    if (nextGt !== Infinity && nextGt <= lt) { const g = html.indexOf('>', lt + 1); nextGt = g < 0 ? Infinity : g }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      // <!doctype html>, other declarations and <?…?>: not text (a browser reads them as comments up to the next >)
      if (nextGt === Infinity) break
      out.push(' ')
      i = nextGt + 1
      continue
    }
    if (nextGt === Infinity) { out.push(html.slice(lt)); break }
    nameRe.lastIndex = lt + 1
    const m = nameRe.exec(html)
    if (!m || m.index !== lt + 1) { out.push('<'); i = lt + 1; continue }
    const closing = html[lt + 1] === '/', name = m[1]!.toLowerCase()
    i = nextGt + 1
    if (!closing && RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}[\\s/>]`, 'gi')
      close.lastIndex = i
      const c = close.exec(html)
      if (!c) { i = n; out.push(' '); continue }
      const gt = html.indexOf('>', c.index + 2)
      i = gt < 0 ? n : gt + 1
      out.push(' ')
      continue
    }
    out.push(name === 'br' || (closing && BLOCK.has(name)) ? '\n' : ' ')
  }
  return decodeEntities(out.join(''))
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Leading spaces / tabs, at most `max`. */
function indent(l: string, max = Infinity): number {
  let i = 0
  while (i < l.length && i < max && (l[i] === ' ' || l[i] === '\t')) i++
  return i
}
function isFence(l: string): boolean { const i = indent(l); return l.startsWith('```', i) || l.startsWith('~~~', i) }

/** ATX heading text (`## Title ##` → `Title`), or null when the line is not a heading. */
export function atxHeading(l: string): string | null {
  const i = indent(l, 3)
  if (l[i] !== '#') return null
  let j = i
  while (j < l.length && l[j] === '#') j++
  if (j - i > 6 || (j < l.length && l[j] !== ' ' && l[j] !== '\t')) return null
  let text = l.slice(j).trim()
  let k = text.length
  while (k > 0 && text[k - 1] === '#') k--
  if (k === 0) text = ''
  else if (k < text.length && (text[k - 1] === ' ' || text[k - 1] === '\t')) text = text.slice(0, k).trimEnd()
  return text
}

/** A table delimiter row: `| --- | :---: |`. */
function isTableRule(t: string): boolean {
  if (!t.includes('-')) return false
  const cells = t.split('|')
  if (t.startsWith('|')) cells.shift()
  if (t.endsWith('|') && cells.length) cells.pop()
  return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c.trim()))
}
/** `---`, `***`, `___` with optional spaces. */
function isRule(t: string): boolean {
  const s = t.replace(/[ \t]/g, '')
  return s.length >= 3 && /^(?:-+|\*+|_+)$/.test(s)
}
/** A paragraph that is only an asset reference (`bb://GUID` or `[x](bb://GUID)`): a card, not text. */
function isCardLine(t: string): boolean {
  if (bbGuid(t)) return true
  if (!t.startsWith('[') || !t.endsWith(')')) return false
  const k = t.lastIndexOf('](')
  return k > 0 && !!bbGuid(t.slice(k + 2, -1))
}

/**
 * Inline Markdown removed in one pass: emphasis and code markers dropped, `[text](url)` and `![alt](url)` keep
 * their text, backslash escapes resolved. The next `)` is cached so a line of unclosed links stays linear.
 */
export function stripInline(l: string): string {
  let out = ''
  let close = -1
  const n = l.length
  const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)
  for (let i = 0; i < n; i++) {
    const c = l[i]!
    if (c === '\\' && i + 1 < n) { out += l[++i]; continue }
    if (c === '`' || c === '*' || c === '~') continue
    if (c === '_' && !(word(l[i - 1]) && word(l[i + 1]))) continue
    if (c === '!' && l[i + 1] === '[') continue
    if (c === '[') continue
    if (c === ']') {
      if (l[i + 1] === '(') {
        if (close !== Infinity && close < i + 2) { const k = l.indexOf(')', i + 2); close = k < 0 ? Infinity : k }
        if (close !== Infinity) { i = close; continue }
      }
      continue
    }
    out += c
  }
  return out
}

/** Markdown without its syntax (for search, word counts and excerpts). */
export function markdownText(md: string): string {
  const out: string[] = []
  let fence = false
  for (const raw of md.split(/\r?\n/)) {
    if (isFence(raw)) { fence = !fence; continue }
    if (fence) { out.push(raw); continue }
    const t = raw.trim()
    if (isTableRule(t) || isCardLine(t) || isRule(t)) continue
    let l = atxHeading(raw)
    if (l === null) l = raw.replace(/^[ \t]{0,3}>[ \t]?/, '').replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
    l = stripInline(l)
    if (l.includes('|')) {
      const cells = l.split('|').map(c => c.trim())
      if (!cells[0]) cells.shift()
      if (cells.length && !cells[cells.length - 1]) cells.pop()
      l = cells.join('  ')
    }
    out.push(l.trimEnd())
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The prose of a Markdown body — paragraphs, list items and quotes, one line each as written — without headings,
 * tables, code blocks, rules and asset cards: what a text grid cell shows under the title (prototype `.bb-cell__doc`).
 */
export function markdownProse(md: string): string {
  const out: string[] = []
  const lines = md.split(/\r?\n/)
  let fence = false, table = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    if (isFence(raw)) { fence = !fence; continue }
    if (fence) continue
    const t = raw.trim()
    if (!t) { table = false; continue }
    const next = lines[i + 1]?.trim() ?? ''
    // a table runs from its header row (the next line is `| --- |`) to the first blank line
    if (table || (t.includes('|') && isTableRule(next))) { table = true; continue }
    if (atxHeading(raw) !== null || isTableRule(t) || isCardLine(t) || isRule(t) || isImageLine(t)) continue
    // setext heading: the text line and its `===` / `---` underline
    if (next && /^(?:=+|-+)$/.test(next) && indent(lines[i + 1]!) <= 3 && !/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/.test(raw)) { i++; continue }
    const l = stripInline(raw.replace(/^[ \t]{0,3}>[ \t]?/, '').replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')).trim()
    if (l) out.push(l)
  }
  return out.join('\n')
}

/** Plain text of a document for search, counts and excerpts (Markdown without front matter). */
export function plainText(kind: DocKind, src: string): string {
  if (kind === 'markdown') return markdownText(parseFrontMatter(src).body)
  if (kind === 'html') return htmlText(src)
  return src
}

/* ───────────── title, counts, excerpt ───────────── */

/** First heading (ATX or setext) outside code fences. */
export function markdownTitle(md: string): string | null {
  const lines = parseFrontMatter(md).body.split(/\r?\n/)
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (isFence(l)) { fence = !fence; continue }
    if (fence) continue
    const h = atxHeading(l)
    if (h !== null) return h ? stripInline(h).trim() || null : null
    const next = lines[i + 1]?.trim()
    if (l.trim() && next && /^(?:=+|-+)$/.test(next) && indent(lines[i + 1]!) <= 3 && !/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/.test(l)) return stripInline(l).trim() || null
  }
  return null
}

/** Text of the first element `<tag…>…</tag>` found by `open` (case-insensitive), or null. */
function elementText(html: string, open: RegExp, close: RegExp): string | null {
  const m = open.exec(html)
  if (!m) return null
  const gt = html.indexOf('>', m.index)
  if (gt < 0) return null
  close.lastIndex = gt + 1
  const c = close.exec(html)
  const v = htmlText(html.slice(gt + 1, c ? c.index : Math.min(html.length, gt + 1 + 4096))).replace(/\s+/g, ' ').trim()
  return v || null
}

export function htmlTitle(html: string): string | null {
  return elementText(html, /<title[\s>]/i, /<\/title[\s>]/gi) ?? elementText(html, /<h[1-6][\s>]/i, /<\/h[1-6][\s>]/gi)
}

/** 「首个标题或文件名」 (builtin-plugins.md). */
export function titleOf(kind: DocKind, src: string, name: string): string {
  if (kind === 'markdown') return markdownTitle(src) ?? parseFrontMatter(src).fields.find(f => f.key === 'title')?.value ?? name
  if (kind === 'html') return htmlTitle(src) ?? name
  return name
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u
/** Words: each CJK character counts as one, other runs of letters / digits as one each. */
export function countWords(text: string): number {
  let n = 0
  for (const m of text.matchAll(/[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]|[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)) if (m[0]) n++
  return n
}
export const isCjk = (ch: string) => CJK.test(ch)

/** Lines of a file (a final newline does not start another line). */
export function countLines(src: string): number {
  if (!src) return 0
  let n = 1
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i)
    if (c === 10) n++
    else if (c === 13) { n++; if (src.charCodeAt(i + 1) === 10) i++ }
  }
  const last = src.charCodeAt(src.length - 1)
  return last === 10 || last === 13 ? n - 1 : n
}

/** Only the start of a document feeds excerpts and summaries. */
export const OPENING_CHARS = 64 * 1024

/**
 * The opening lines of the body (without the title) for the text grid cell: Markdown's prose (no headings, tables
 * or code; the plain text when there is no prose), an HTML page's visible text, TXT as written.
 */
export function excerptOf(kind: DocKind, src: string, title: string, maxChars = 160): string {
  // JSON: the raw text with whitespace folded — never parsed or re-printed here.
  if (kind === 'json') return clip(src.slice(0, Math.max(maxChars * 8, 4096)).replace(/\s+/g, ' ').trim(), maxChars)
  const head = src.slice(0, OPENING_CHARS)
  const prose = kind === 'markdown' ? markdownProse(parseFrontMatter(head).body) : ''
  const lines = (prose || plainText(kind, head)).split('\n').map(l => l.trim()).filter(Boolean)
  if (lines[0] === title) lines.shift()
  return clip(joinLines(lines), maxChars)
}

/** Lines run together with a space, none between Chinese or Japanese text (「…容器。卡通…」, not「…容器。 卡通…」). */
function joinLines(lines: string[]): string {
  let s = ''
  for (const l of lines) s += !s ? l : CJK_EDGE.test(s[s.length - 1]!) && CJK_EDGE.test(l[0]!) ? l : ' ' + l
  return s
}
const CJK_EDGE = /[぀-ヿ㐀-䶿一-鿿豈-﫿　-〿＀-￯]/u

/** A line that is only an image: `![alt](path)` (or several). */
function isImageLine(t: string): boolean {
  if (!t.startsWith('![') || !t.endsWith(')')) return false
  return t.split('![').length - 1 === imageTargets(t).length
}

/** First `n` non-empty lines of the plain body (summary text). */
export function openingLines(kind: DocKind, src: string, title: string, n = 10): string[] {
  const head = src.slice(0, OPENING_CHARS)
  const lines = (kind === 'json' ? head : plainText(kind, head)).split('\n').map(l => l.trimEnd().slice(0, 400)).filter(l => l.trim())
  if (lines[0]?.trim() === title) lines.shift()
  return lines.slice(0, n)
}

function clip(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }

/** Targets of `![alt](target "title")` on one line, in one pass (the next `)` is cached). */
function imageTargets(l: string): string[] {
  const out: string[] = []
  let open = false, close = -1
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (c === '\\') { i++; continue }
    if (c === '!' && l[i + 1] === '[') { open = true; i++; continue }
    if (c === ']' && l[i + 1] === '(' && open) {
      if (close !== Infinity && close < i + 2) { const k = l.indexOf(')', i + 2); close = k < 0 ? Infinity : k }
      if (close === Infinity) break
      const inner = l.slice(i + 2, close).trim()
      let target: string
      if (inner.startsWith('<')) { const e = inner.indexOf('>'); target = e < 0 ? '' : inner.slice(1, e) } else target = inner.split(/[ \t]/, 1)[0] ?? ''
      if (target) out.push(target)
      open = false
      i = close
    }
  }
  return out
}

/** Image paths written in Markdown that point at other files (`![](tex/a.png)`): slot names (ADR-018). */
export function markdownImageRefs(md: string): string[] {
  const out = new Set<string>()
  let fence = false
  for (const l of parseFrontMatter(md).body.split(/\r?\n/)) {
    if (isFence(l)) { fence = !fence; continue }
    if (fence) continue
    for (const t of imageTargets(l)) {
      const ref = relativeRef(t)
      if (ref) out.add(ref)
    }
  }
  return [...out]
}

/** A relative file reference without `./`, query or fragment; null for URLs, `bb://`, data URIs and absolute paths. */
export function relativeRef(src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('#') || src.startsWith('//')) return null
  let s = src.split(/[?#]/)[0]!.replace(/^(\.\/)+/, '')
  try { s = decodeURI(s) } catch { /* keep as written */ }
  return s || null
}

/** `bb://<GUID>` → GUID. */
export function bbGuid(href: string): string | null {
  const m = /^bb:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(href.trim())
  return m ? m[1]!.toLowerCase() : null
}
