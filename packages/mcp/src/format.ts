/**
 * Compact text renderings shared by the MCP tools and the `bb` command line (api-and-agent.md「工具设计约定」):
 * fixed fields, nothing recomputable, every asset line carries stage, review status and issue markers.
 */
import type {
  AssetDetail, AssetSummary, CreatorInfo, ExportPlan, IssuesResponse, JobInfo, Lineage, ProductionRecord,
  RegisterResponse, SearchResponse, SummaryResponse, Vocabulary
} from '@bowerbird/schema'

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function quoteIfSpace(v: string): string { return /\s/.test(v) ? JSON.stringify(v) : v }

/** One search hit / relation end: `id path format stage= review= [issues=] [flags=] [tags=] [badge=]`. */
export function summaryLine(s: AssetSummary): string {
  const parts = [s.id, quoteIfSpace(s.path), s.format, `stage=${s.stage}`, `review=${s.review}`]
  if (s.issueLevel) parts.push(`issues=${s.issueLevel}×${s.issueCount}`)
  if (s.flags.length) parts.push(`flags=${s.flags.join(',')}`)
  if (s.tags.length) parts.push(`tags=${s.tags.map(quoteIfSpace).join(',')}`)
  if (s.autoTags.length) parts.push(`aiTags=${s.autoTags.map(quoteIfSpace).join(',')}`)
  if (s.badge) parts.push(`badge=${quoteIfSpace(s.badge)}`)
  if (s.auxiliary) parts.push('auxiliary')
  if (s.missingPlugin) parts.push(`needsPlugin=${s.missingPlugin.id}`)
  if (s.score !== undefined) parts.push(`score=${s.score.toFixed(3)}`)
  return parts.join(' ')
}

export function searchText(r: SearchResponse): string {
  const lines = [`${r.items.length} of ~${r.total}`]
  if (r.scopedToApproved) lines.push('note: library setting limits agents to approved + exempt assets; add a review filter to see others')
  for (const s of r.items) lines.push(summaryLine(s))
  if (r.cursor) lines.push(`next cursor: ${r.cursor}`)
  return lines.join('\n')
}

export function recordLine(rec: ProductionRecord): string {
  const parts = [rec.id, `method=${rec.method}`]
  if (rec.tool) parts.push(`tool=${quoteIfSpace(rec.tool)}`)
  if (rec.plugin) parts.push(`plugin=${rec.plugin}`)
  if (rec.prompt) parts.push(`prompt=${JSON.stringify(clip(rec.prompt, 160))}`)
  if (rec.params && Object.keys(rec.params).length) parts.push(`params=${clip(JSON.stringify(rec.params), 160)}`)
  if (rec.inputs?.length) parts.push(`inputs=${rec.inputs.map(i => i.role ? `${i.id}(${i.role})` : i.id).join(',')}`)
  parts.push(`by=${rec.by}`, `at=${rec.at}`)
  return parts.join(' ')
}

export function detailText(d: AssetDetail, summary?: SummaryResponse | null): string {
  const lines: string[] = []
  lines.push(`${d.name}  ${d.id}`)
  lines.push(`path=${quoteIfSpace(d.path)} format=${d.format} stage=${d.stage} review=${d.review} size=${d.size} hash=${d.hash}`)
  const v = d.reviewVerdict
  if (v) lines.push(`verdict: ${v.status}${v.by ? ` by ${v.by}` : ''}${v.at ? ` at ${v.at}` : ''}${v.note ? ` note=${JSON.stringify(v.note)}` : ''}`)
  if (d.tags.length || d.autoTags.length) lines.push(`tags=${d.tags.join(',') || '-'}${d.autoTags.length ? ` aiTags=${d.autoTags.join(',')}` : ''}`)
  if (d.descriptionFull) lines.push(`description: ${clip(d.descriptionFull, 400)}`)
  else if (d.auto?.description) lines.push(`aiDescription: ${clip(d.auto.description, 400)}`)
  const tech = Object.entries(d.tech)
  if (tech.length) lines.push(`tech: ${tech.map(([k, v]) => `${k}=${v}`).join(' ')}`)
  if (d.views) lines.push(`views: ${d.views.rows}×${d.views.cols} ${d.views.cells.map(c => c ?? '-').join(',')}`)
  if (d.targetSize) lines.push(`targetSize: ${d.targetSize.w}×${d.targetSize.h}×${d.targetSize.d} m (from ${d.targetSize.from})`)
  if (d.flags.length) lines.push(`flags=${d.flags.join(',')}`)
  for (const i of d.issues) lines.push(`issue: [${i.level}] ${i.type}${i.relation ? ` ${i.relation.type}→${i.relation.to}` : ''}${i.path ? ` ${i.path}` : ''}`)
  for (const c of d.checks) if (c.verdict !== 'pass') lines.push(`check: [${c.verdict}] ${c.rule} ${c.message}`)
  for (const r of d.relations.outgoing) {
    lines.push(`out: ${r.type}${r.slot ? `(${r.slot})` : ''} → ${r.to} ${r.target ? quoteIfSpace(r.target.path) : `${r.targetName ?? '?'} [broken${r.targetInTrash ? ', in trash' : ''}]`}${r.stale ? ' [stale]' : ''}`)
  }
  for (const r of d.relations.incoming) {
    lines.push(`in: ${r.type}${r.slot ? `(${r.slot})` : ''} ← ${r.from} ${r.target ? quoteIfSpace(r.target.path) : ''}`.trimEnd())
  }
  if (d.record) lines.push(`record: ${recordLine(d.record)}`)
  if (d.unresolvedRefs.length) lines.push(`unresolvedRefs: ${d.unresolvedRefs.join(', ')}`)
  if (d.bundleFiles) lines.push(`bundle: ${d.bundleFiles.length} files${d.bundleFiles.find(f => f.entry) ? `, entry ${d.bundleFiles.find(f => f.entry)!.path}` : ''}`)
  if (summary?.text) lines.push(`summary: ${summary.text}`)
  return lines.join('\n')
}

export const OVERVIEW_NONE = '这种格式没有概览图'
export const OVERVIEW_NOT_RENDERED = '概览图还没有渲染，有人打开页面后才会生成'
export const OVERVIEW_FAILED = '概览图读取失败'

/**
 * One sentence about the overview image: there is one; the format has none; it has not been rendered yet
 * (the server explains why); or (when fetching it went wrong) it could not be read. Never two of them.
 */
export function overviewNote(summary: SummaryResponse | null | undefined, fetchFailed = false): string {
  if (!summary) return `overview image: ${OVERVIEW_FAILED}`
  if (summary.image) return fetchFailed ? `overview image: ${OVERVIEW_FAILED}` : 'overview image: available'
  return `overview image: ${summary.imageMissingReason ?? OVERVIEW_NONE}`
}

export function lineageText(l: Lineage): string {
  const name = new Map<string, string>()
  for (const n of l.nodes) name.set(n.id, n.path)
  for (const m of l.missing) name.set(m.id, `${m.name ?? m.id} [missing${m.inTrash ? ', in trash' : ''}]`)
  const lines = [`center ${l.center} ${name.get(l.center) ?? ''}`.trimEnd(), 'nodes:']
  for (const n of l.nodes) lines.push('  ' + summaryLine(n))
  if (l.missing.length) for (const m of l.missing) lines.push(`  ${m.id} ${m.name ?? '?'} [missing${m.inTrash ? ', in trash' : ''}]`)
  lines.push('edges:')
  for (const e of l.edges) {
    const flags = [e.broken ? 'broken' : '', e.stale ? 'stale' : ''].filter(Boolean)
    let line = `  ${name.get(e.from) ?? e.from} --${e.type}${e.slot ? `(${e.slot})` : ''}--> ${name.get(e.to) ?? e.to}${flags.length ? ` [${flags.join(',')}]` : ''}`
    const rec = e.record ? l.records[e.record] : undefined
    if (rec) line += `\n      record: ${recordLine(rec)}`
    lines.push(line)
  }
  if (!l.edges.length) lines.push('  (none)')
  return lines.join('\n')
}

export function registerText(r: RegisterResponse, label?: string): string {
  const lines: string[] = []
  if (r.skipped || !r.asset) lines.push(`skipped${label ? ` ${label}` : ''} (same name exists)`)
  else lines.push(`registered ${summaryLine(r.asset)}`)
  if (r.recordId) lines.push(`record ${r.recordId}`)
  for (const t of r.newTags) lines.push(`new tag ${JSON.stringify(t.tag)}${t.similar.length ? ` — similar existing: ${t.similar.join(', ')}` : ''}`)
  return lines.join('\n')
}

export function newTagsText(newTags: RegisterResponse['newTags']): string[] {
  return newTags.map(t => `new tag ${JSON.stringify(t.tag)}${t.similar.length ? ` — similar existing: ${t.similar.join(', ')}` : ''}`)
}

export function issuesText(r: IssuesResponse): string {
  const lines = [`${r.total} issues on ${r.assetCount} assets`]
  for (const i of r.issues) {
    const a = i.assetId ? r.assets[i.assetId] : undefined
    const where = a ? `${a.id} ${quoteIfSpace(a.path)}` : (i.path ?? '')
    const extra = i.relation ? ` ${i.relation.type}→${i.relation.to}${i.relation.slot ? `(${i.relation.slot})` : ''}` : ''
    const det = Object.keys(i.details ?? {}).length ? ` ${clip(JSON.stringify(i.details), 160)}` : ''
    lines.push(`[${i.level}] ${i.type} ${where}${extra}${det} id=${i.id}`)
  }
  return lines.join('\n')
}

export function vocabularyText(v: Vocabulary): string {
  const lines: string[] = []
  lines.push(`stages: ${v.stages.map(s => `${s.id}(${s.name})`).join(' ')}`)
  lines.push(`review: ${v.reviews.map(s => `${s.id}(${s.name})`).join(' ')}`)
  lines.push(`formats: ${v.formats.map(f => `${f.id}×${f.count}`).join(' ') || '-'}`)
  lines.push(`relation types: ${v.relationTypes.map(r => `${r.id}(${r.name}/${r.inverseName})`).join(' ')}`)
  lines.push(`tags (${v.tags.length}): ${v.tags.map(t => `${quoteIfSpace(t.name)}×${t.count}`).join(' ') || '-'}`)
  if (v.methods.length) lines.push(`methods: ${v.methods.map(m => `${m.id}×${m.count}`).join(' ')}`)
  if (v.actors.length) lines.push(`actors: ${v.actors.map(m => `${m.id}×${m.count}`).join(' ')}`)
  if (v.templates.length) lines.push(`templates: ${v.templates.map(t => `${t.id}(${t.displayName})`).join(' ')}`)
  if (v.designObjects.length) lines.push(`design objects: ${v.designObjects.map(d => `${d.id} ${quoteIfSpace(d.title ?? d.name)}`).join('; ')}`)
  return lines.join('\n')
}

export function jobText(j: JobInfo): string {
  const parts = [`job ${j.id}`, `kind=${j.kind}`, `status=${j.status}`]
  if (j.creator) parts.push(`creator=${j.creator}`)
  if (j.stage) parts.push(`stage=${j.stage}`)
  if (j.assetId) parts.push(`asset=${j.assetId}`)
  if (j.progress !== undefined) parts.push(`progress=${Math.round(j.progress * 100)}%`)
  if (j.message) parts.push(`message=${JSON.stringify(j.message)}`)
  if (j.error) parts.push(`error=${JSON.stringify(j.error)}${j.retryable === false ? ' (retry will not help)' : ''}`)
  if (j.outputs.length) parts.push(`outputs=${j.outputs.join(',')}`)
  if (j.action) parts.push(`needs: ${j.action.label} (plugin page ${j.action.page})`)
  return parts.join(' ')
}

export function creatorsText(list: CreatorInfo[]): string {
  if (!list.length) return 'no creators available (no creator plugin is enabled)'
  return list.map(c => {
    const inputs = c.inputs.map(i => `${i.role}${i.formats?.length ? `[${i.formats.join('|')}]` : ''}${i.required ? '' : '?'}`).join(', ')
    const props = Object.keys(((c.params as { properties?: Record<string, unknown> }).properties) ?? {})
    return `${c.id} ${JSON.stringify(c.displayName)} plugin=${c.pluginId}${inputs ? ` inputs: ${inputs}` : ''}${props.length ? ` params: ${props.join(', ')}` : ''}${c.page ? ' (opens its own page in the web UI)' : ''}`
  }).join('\n')
}

export function exportPlanText(p: ExportPlan): string {
  const lines = [`${p.files.length} files, ${p.bytes} bytes, ${p.dependencies} dependencies${p.duplicateNames ? ' (duplicate names!)' : ''}`]
  for (const f of p.files) lines.push(`${f.path} ← ${f.assetId}${f.fromFile ? ` (file ${f.fromFile})` : ''}${f.dependency ? ' [dep]' : ''}`)
  return lines.join('\n')
}
