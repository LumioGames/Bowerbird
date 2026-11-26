import { SYNTAX_KEYS, STAGES, REVIEW_STATUSES, type Vocabulary } from '@bowerbird/schema'
import { t } from '../lib/i18n'
import { formatName } from '../plugins/text'

/**
 * Search syntax completion (search.md「文本语法」, prototype app.js acOpen): typing a word offers the keys with their
 * Chinese meaning; after `key:` it offers that key's values, taken from the library (formats, tags, folders, actors,
 * design objects, methods). ↑↓ choose, Tab / ↵ insert. A finished value becomes a chip.
 */
export interface Completion {
  /** Text that replaces the word under the caret. */
  insert: string
  /** Left column (mono). */
  label: string
  /** Right column (meaning). */
  detail: string
  /** A complete `key:value` (becomes a chip) — vs. a key still waiting for its value, or a folder to go deeper. */
  done: boolean
}

export interface CompletionSource {
  vocabulary?: Vocabulary | null
  /** Library-relative folder paths. */
  folders?: string[]
}

/** The whitespace-separated word the caret is in. */
export function wordAt(text: string, caret: number): { word: string; start: number; end: number } {
  const start = text.lastIndexOf(' ', caret - 1) + 1
  let end = text.indexOf(' ', caret)
  if (end < 0) end = text.length
  return { word: text.slice(start, caret), start, end }
}

function keyLabel(key: string): string {
  return SYNTAX_KEYS.find(k => k.key === key)?.label ?? ''
}

export function valuesFor(key: string, src: CompletionSource): Array<[string, string]> {
  const v = src.vocabulary
  switch (key) {
    case 'stage': return STAGES.map(s => [s, t('stage.short.' + s)])
    case 'review': return REVIEW_STATUSES.map(r => [r, t('ac.review.' + r)])
    case 'format': return (v?.formats ?? []).map(f => [f.id, formatName(f)])
    case 'tag': case '-tag': return (v?.tags ?? []).map(x => [x.name, ''])
    case 'folder': return (src.folders ?? []).map(f => [f + '/', ''])
    case 'is': return [['issue', t('ac.is.issue')], ['stale', t('ac.is.stale')], ['missing', t('ac.is.missing')]]
    case 'when': case 'created': return (['today', 'week', 'month'] as const).map(w => [w, t('ac.when.' + w)])
    case 'by': return [['agent', t('ac.by.agent')], ['user', t('ac.by.user')], ...(v?.actors ?? []).map(a => [a.id, ''] as [string, string])]
    case 'belongs': return (v?.designObjects ?? []).map(o => [o.name.replace(/\.[^.]+$/, ''), o.title ?? ''])
    case 'method': {
      const ids = new Set<string>(['ai-generate', 'manual', 'slice', 'render', 'export', 'convert', 'copy', 'other'])
      for (const m of v?.methods ?? []) ids.add(m.id)
      return [...ids].map(id => [id, t('method.' + id) === 'method.' + id ? '' : t('method.' + id)])
    }
    case 'tris': return [['<5000', t('ac.tris.lt')], ['>=10000', t('ac.tris.gte')]]
    case 'width': case 'height': return [['>=1024', t('ac.px.gte')], ['<=256', t('ac.px.lte')]]
    case 'dur': return [['<5', t('ac.dur.lt')], ['>=60', t('ac.dur.gte')]]
    default: return []
  }
}

export function complete(text: string, caret: number, src: CompletionSource, max = 8): { items: Completion[]; start: number; end: number } {
  const { word, start, end } = wordAt(text, caret)
  const none = { items: [], start, end }
  if (!word) return none
  const m = /^(-?[a-zA-Z]+):(.*)$/.exec(word)
  let items: Completion[]
  if (m) {
    const key = m[1]!.toLowerCase(), part = m[2]!
    const lp = part.toLowerCase()
    items = valuesFor(key, src)
      .filter(([val, d]) => !part || val.toLowerCase().startsWith(lp) || (!!d && d.includes(part)))
      .slice(0, max)
      .map(([val, d]) => ({ insert: `${key}:${/\s/.test(val) ? `"${val}"` : val}`, label: val, detail: d, done: !val.endsWith('/') }))
  } else {
    const lw = word.toLowerCase()
    items = SYNTAX_KEYS
      .filter(k => k.key.startsWith(lw) || k.label.includes(word))
      .slice(0, max)
      .map(k => ({ insert: k.key + ':', label: k.key + ':', detail: keyLabel(k.key), done: false }))
  }
  if (!items.length || (items.length === 1 && items[0]!.insert === word)) return none
  return { items, start, end }
}

/** Apply a completion: returns the new text and caret. A finished value gets a trailing space (→ chip). */
export function applyCompletion(text: string, c: Completion, start: number, end: number): { text: string; caret: number } {
  const tail = text.slice(end)
  const ins = c.insert + (c.done ? ' ' : '')
  const next = text.slice(0, start) + ins + (c.done ? tail.replace(/^\s+/, '') : tail)
  return { text: next, caret: start + ins.length }
}
