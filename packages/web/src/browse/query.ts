import {
  filterChips, formatQueryText, parseQueryText, tokenize, whenToRange,
  type Filter, type Query, type QueryChip, type SmartView, type SortKey, type WhenValue
} from '@bowerbird/schema'

/**
 * The browse page's query lives in the address (web-shell.md「前端状态」: shareable, back/forward work):
 *   folder=<path> | view=<untagged|pending> | smart=<name>   — where we are
 *   q=<text syntax>                                           — the conditions (chips) + free words, round-tripped
 *                                                               through the schema's parseQueryText / formatQueryText
 *   tags=any · human=1 · aux=1                                — the three filter-panel switches the syntax cannot say
 *   sort=<key> · order=<asc|desc>                             — only when someone picked a sort
 *   edit=<smart name>                                         — editing a smart folder's conditions (「保存到「…」」)
 * The search box and the filter panel both edit the same `filter`, so they stay in two-way sync.
 */
export type Loc =
  | { type: 'all' }
  | { type: 'view'; id: 'untagged' | 'pending' }
  | { type: 'folder'; path: string }
  | { type: 'smart'; name: string }

export interface Extras { when?: WhenValue; createdWhen?: WhenValue; belongsName?: string }

export interface BrowseState {
  loc: Loc
  /** Free words (no syntax). */
  text: string
  /** The person's conditions — what the chips show. */
  filter: Filter
  extras: Extras
  tagMode: 'all' | 'any'
  sort?: SortKey
  order?: 'asc' | 'desc'
  editSmart?: string
}

export const EMPTY_STATE: BrowseState = { loc: { type: 'all' }, text: '', filter: {}, extras: {}, tagMode: 'all' }

/** Round `now` to the minute so relative times (`when:week`) give a stable query key. */
function minuteNow(): Date { const d = new Date(); d.setSeconds(0, 0); return d }

export function stateFromParams(sp: URLSearchParams, now: Date = minuteNow()): BrowseState {
  const parsed = parseQueryText(sp.get('q') ?? '', now)
  const filter: Filter = parsed.filter
  const tagMode = sp.get('tags') === 'any' ? 'any' : 'all'
  if (tagMode === 'any' && filter.tags?.all?.length) {
    filter.tags = { ...filter.tags, any: [...(filter.tags.any ?? []), ...filter.tags.all] }
    delete filter.tags.all
  }
  if (sp.get('human') === '1') filter.humanTagsOnly = true
  if (sp.get('aux') === '1') filter.includeAuxiliary = true
  let loc: Loc = { type: 'all' }
  const folder = sp.get('folder'), view = sp.get('view'), smart = sp.get('smart')
  if (folder != null) loc = { type: 'folder', path: folder }
  else if (smart) loc = { type: 'smart', name: smart }
  else if (view === 'untagged' || view === 'pending') loc = { type: 'view', id: view }
  const extras: Extras = {}
  if (parsed.when) extras.when = parsed.when
  if (parsed.createdWhen) extras.createdWhen = parsed.createdWhen
  if (parsed.belongsName) extras.belongsName = parsed.belongsName
  const s: BrowseState = { loc, text: parsed.q, filter, extras, tagMode }
  const sort = sp.get('sort'), order = sp.get('order')
  if (sort) s.sort = sort as SortKey
  if (order === 'asc' || order === 'desc') s.order = order
  const edit = sp.get('edit')
  if (edit) s.editSmart = edit
  return s
}

/** The text-syntax form of the conditions + free words (what goes in `q`). */
export function queryText(s: Pick<BrowseState, 'text' | 'filter' | 'extras'>): string {
  return formatQueryText({ q: s.text.trim() || undefined, filter: s.filter, ...s.extras })
}

export function paramsFromState(s: BrowseState): URLSearchParams {
  const sp = new URLSearchParams()
  if (s.loc.type === 'folder') sp.set('folder', s.loc.path)
  else if (s.loc.type === 'view') sp.set('view', s.loc.id)
  else if (s.loc.type === 'smart') sp.set('smart', s.loc.name)
  const q = queryText(s)
  if (q) sp.set('q', q)
  if (s.tagMode === 'any' && (s.filter.tags?.any?.length || s.filter.tags?.all?.length)) sp.set('tags', 'any')
  if (s.filter.humanTagsOnly) sp.set('human', '1')
  if (s.filter.includeAuxiliary) sp.set('aux', '1')
  if (s.sort) sp.set('sort', s.sort)
  if (s.order) sp.set('order', s.order)
  if (s.editSmart) sp.set('edit', s.editSmart)
  return sp
}

/** Chips in display order. */
export function chipsOf(s: Pick<BrowseState, 'filter' | 'extras'>): QueryChip[] { return filterChips(s.filter, s.extras) }

/** Anything set besides the location? (「保存为智能文件夹」needs one.) */
export function hasConditions(s: BrowseState): boolean {
  return !!s.text.trim() || chipsOf(s).length > 0 || !!s.filter.humanTagsOnly || !!s.filter.includeAuxiliary
}

const ARRAY_KEYS = ['stage', 'format', 'review', 'method', 'issue'] as const

/** Add conditions (from typed syntax) to a filter: lists are united, single values replaced. */
export function addConditions(base: Filter, add: Filter): Filter {
  const out: Filter = structuredClone(base)
  for (const k of ARRAY_KEYS) {
    const v = add[k] as string[] | undefined
    if (!v?.length) continue
    const cur = (out[k] as string[] | undefined) ?? []
    ;(out as Record<string, unknown>)[k] = [...cur, ...v.filter(x => !cur.includes(x))]
  }
  if (add.tags) {
    const t = (out.tags ??= {})
    for (const k of ['all', 'any', 'none'] as const) {
      const v = add.tags[k]; if (!v?.length) continue
      const cur = t[k] ?? []
      t[k] = [...cur, ...v.filter(x => !cur.includes(x))]
    }
  }
  if (add.tech) out.tech = { ...(out.tech ?? {}), ...Object.fromEntries(Object.entries(add.tech).map(([k, c]) => [k, { ...(out.tech?.[k] ?? {}), ...c }])) }
  for (const k of ['folder', 'by', 'modifiedBy', 'batch', 'relation', 'modified', 'created', 'hasIssues', 'humanTagsOnly', 'includeAuxiliary'] as const) {
    if (add[k] !== undefined) (out as Record<string, unknown>)[k] = add[k]
  }
  return out
}

/**
 * Typing in the search box: every finished `key:value` token becomes a chip; free words stay as the query.
 * While typing (`final` false) the token under the caret is left alone; ↵ (`final` true) takes it too.
 * Returns the new conditions and what should remain in the input.
 */
export function absorbTyped(s: Pick<BrowseState, 'filter' | 'extras' | 'tagMode'>, input: string, final: boolean): { filter: Filter; extras: Extras; input: string; changed: boolean } {
  const trailingSpace = /\s$/.test(input)
  const tokens = tokenize(input)
  const typing = !final && !trailingSpace && tokens.length ? tokens.pop()! : ''
  const keyish = tokens.filter(tk => /^-?[a-zA-Z][\w.-]*:.+$/.test(tk))
  if (!keyish.length) return { filter: s.filter, extras: s.extras, input, changed: false }
  const parsed = parseQueryText(tokens.map(tk => (/\s/.test(tk) ? `"${tk}"` : tk)).join(' '), minuteNow())
  // Only take what actually parsed into conditions; leave the rest as words.
  let add = parsed.filter
  if (s.tagMode === 'any' && add.tags?.all?.length) add = { ...add, tags: { ...add.tags, any: [...(add.tags.any ?? []), ...add.tags.all], all: undefined } }
  const before = JSON.stringify(s.filter)
  const filter = addConditions(s.filter, add)
  const extras: Extras = { ...s.extras }
  if (parsed.when) extras.when = parsed.when
  if (parsed.createdWhen) extras.createdWhen = parsed.createdWhen
  if (parsed.belongsName) extras.belongsName = parsed.belongsName
  const changed = JSON.stringify(filter) !== before || JSON.stringify(extras) !== JSON.stringify(s.extras)
  const rest = [parsed.q, typing].filter(Boolean).join(' ')
  return { filter, extras, input: changed ? rest + (trailingSpace && rest && !typing ? ' ' : '') : input, changed }
}

/** Remove one chip's condition (the chip's ×, Backspace in an empty box, 「去掉最后一个条件」). */
export function removeChip(s: Pick<BrowseState, 'filter' | 'extras'>, chip: QueryChip): { filter: Filter; extras: Extras } {
  const f: Filter = structuredClone(s.filter)
  const extras: Extras = { ...s.extras }
  const drop = <T,>(arr: T[] | undefined, v: T) => { const out = (arr ?? []).filter(x => x !== v); return out.length ? out : undefined }
  const { key, value } = chip
  switch (key) {
    case 'stage': f.stage = drop(f.stage, value as never); break
    case 'format': f.format = drop(f.format, value); break
    case 'review': f.review = drop(f.review, value as never); break
    case 'method': f.method = drop(f.method, value); break
    case 'tag': if (f.tags) { f.tags.all = drop(f.tags.all, value); f.tags.any = drop(f.tags.any, value) } break
    case '-tag': if (f.tags) f.tags.none = drop(f.tags.none, value); break
    case 'is':
      if (value === 'issue') delete f.hasIssues
      else f.issue = drop(f.issue, (value === 'stale' ? 'stale-upstream' : 'missing-file') as never)
      break
    case 'folder': delete f.folder; break
    case 'belongs': delete f.relation; delete extras.belongsName; break
    case 'when': delete f.modified; delete extras.when; break
    case 'created': delete f.created; delete extras.createdWhen; break
    case 'by': delete f.by; break
    case 'editor': delete f.modifiedBy; break
    case 'batch': delete f.batch; break
    default: {
      // tech condition: tris / dur / width / height / any plugin key
      const techKey = key === 'tris' ? 'triangles' : key === 'dur' ? 'duration' : key
      const c = f.tech?.[techKey]
      if (c) {
        const m = /^(<=|>=|<|>)?(.*)$/.exec(value)!
        const op = m[1]
        if (op === '>=') delete c.gte; else if (op === '>') delete c.gt; else if (op === '<=') delete c.lte; else if (op === '<') delete c.lt; else delete c.eq
        if (!Object.keys(c).length) delete f.tech![techKey]
        if (!Object.keys(f.tech!).length) delete f.tech
      }
    }
  }
  if (f.tags && !f.tags.all && !f.tags.any && !f.tags.none) delete f.tags
  return { filter: f, extras }
}

/**
 * Filter the location itself contributes (not shown as chips). A smart folder's saved `q` may carry syntax
 * (relative times like `when:week` stay relative, `belongs:<name>`); it is parsed here like the search box.
 */
export function locationFilter(loc: Loc, smart?: SmartView | null): { filter: Filter; q?: string } {
  switch (loc.type) {
    case 'all': return { filter: {} }
    case 'view': return { filter: loc.id === 'untagged' ? { untagged: true } : { review: ['pending'] } }
    case 'folder': return { filter: loc.path ? { folder: loc.path } : {} }
    case 'smart': {
      const p = parseQueryText(smart?.query.q ?? '', minuteNow())
      const out: { filter: Filter; q?: string } = { filter: mergeFilters(smart?.query.filter ?? {}, p.filter) }
      if (p.q) out.q = p.q
      return out
    }
  }
}

/**
 * Location + the person's conditions. Where both set the same field the person's value wins (they asked for it);
 * tag lists and tech conditions are combined.
 */
export function mergeFilters(base: Filter, user: Filter): Filter {
  const out: Filter = { ...structuredClone(base), ...structuredClone(user) }
  if (base.tags || user.tags) {
    const t: NonNullable<Filter['tags']> = {}
    for (const k of ['all', 'any', 'none'] as const) {
      const v = [...(base.tags?.[k] ?? []), ...(user.tags?.[k] ?? [])]
      if (v.length) t[k] = [...new Set(v)]
    }
    out.tags = t
  }
  if (base.tech || user.tech) out.tech = { ...(base.tech ?? {}), ...(user.tech ?? {}) }
  return out
}

export function defaultOrder(sort: SortKey): 'asc' | 'desc' { return sort === 'name' || sort === 'format' ? 'asc' : 'desc' }

/** Sorting: with a query word relevance by default; relevance is only possible with one. */
export function effectiveSort(s: BrowseState, smart?: SmartView | null): { sort: SortKey; order: 'asc' | 'desc' } {
  const hasText = !!(s.text.trim() || smart?.query.q)
  let sort: SortKey = s.sort ?? (hasText ? 'relevance' : smart?.query.sort ?? 'modified')
  if (sort === 'relevance' && !hasText) sort = 'modified'
  const order = s.sort ? s.order ?? defaultOrder(sort) : (smart?.query.sort === sort ? smart?.query.order : undefined) ?? defaultOrder(sort)
  return { sort, order }
}

/**
 * The request the grid sends (without paging). `resolveBelongs` maps a design object's name (`belongs:chest`)
 * to its GUID from the library vocabulary; unknown names are passed on for the kernel to resolve.
 */
export function buildQuery(s: BrowseState, smart?: SmartView | null, resolveBelongs?: (name: string) => string | null): Query {
  const loc = locationFilter(s.loc, smart)
  const filter = mergeFilters(loc.filter, s.filter)
  if (filter.relation?.type === 'belongs' && resolveBelongs) {
    const id = resolveBelongs(filter.relation.to)
    if (id) filter.relation = { ...filter.relation, to: id }
  }
  const q = [loc.q, s.text.trim()].filter(Boolean).join(' ')
  const { sort, order } = effectiveSort(s, smart)
  const out: Query = { filter, sort, order }
  if (q) out.q = q
  return out
}

/**
 * What a smart folder saves: the location's own filter (a folder) + the person's conditions. Relative times and
 * design-object names stay as syntax in `q` so「本周新增」keeps meaning this week.
 */
export function smartQueryOf(s: BrowseState, smart?: SmartView | null): Query {
  const loc = locationFilter(s.loc, smart)
  const filter = mergeFilters(loc.filter, s.filter)
  const keep: Filter = {}
  if (s.extras.when) delete filter.modified
  if (s.extras.createdWhen) delete filter.created
  if (s.extras.belongsName && filter.relation) { keep.relation = filter.relation; delete filter.relation }
  const q = formatQueryText({ q: [loc.q, s.text.trim()].filter(Boolean).join(' ') || undefined, filter: keep, ...s.extras })
  const out: Query = { filter }
  if (q) out.q = q
  if (s.sort) { out.sort = s.sort; out.order = s.order ?? defaultOrder(s.sort) }
  return out
}

/** Load a saved query into editable state (「编辑条件」): its conditions become chips again. */
export function stateFromSmart(view: SmartView): BrowseState {
  const parsed = parseQueryText(view.query.q ?? '', minuteNow())
  const filter = mergeFilters(view.query.filter ?? {}, parsed.filter)
  const extras: Extras = {}
  if (parsed.when) extras.when = parsed.when
  if (parsed.createdWhen) extras.createdWhen = parsed.createdWhen
  if (parsed.belongsName) extras.belongsName = parsed.belongsName
  const s: BrowseState = { loc: { type: 'all' }, text: parsed.q, filter, extras, tagMode: filter.tags?.any?.length ? 'any' : 'all', editSmart: view.name }
  if (view.query.sort) s.sort = view.query.sort
  if (view.query.order) s.order = view.query.order
  return s
}

/** `when:` value → modified range (kept for the filter panel's chips). */
export function whenFilter(w: WhenValue): { after?: string; before?: string } { return whenToRange(w, minuteNow()) }
