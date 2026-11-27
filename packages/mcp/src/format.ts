/**
 * Compact text renderings of the capabilities (capabilities.ts), the same for the MCP tools and the `bb` command
 * line (ADR-071; api-and-agent.md「工具设计约定」): fixed fields, nothing recomputable, every asset line carries stage,
 * review status and issue markers. Chinese only (ADR-061: command line and MCP output are not translated).
 */
import type {
  ApplyResponse, AssetDetail, AssetSummary, CreatorInfo, ExportPlan, IssuesResponse, JobInfo, Lineage, Provenance,
  RegisterResponse, SearchResponse, SummaryResponse, Vocabulary, ActionInfo
} from '@bowerbird/schema'

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function quoteIfSpace(v: string): string { return /\s/.test(v) ? JSON.stringify(v) : v }

/** One search hit / relation end: `id 路径 格式 阶段= 校验= [问题=] [标记=] [标签=] [角标=]`. */
export function summaryLine(s: AssetSummary): string {
  const parts = [s.id, quoteIfSpace(s.path), s.format, `阶段=${s.stage}`, `校验=${s.review}`]
  if (s.issueLevel) parts.push(`问题=${s.issueLevel}×${s.issueCount}`)
  if (s.flags.length) parts.push(`标记=${s.flags.join(',')}`)
  if (s.tags.length) parts.push(`标签=${s.tags.map(quoteIfSpace).join(',')}`)
  if (s.autoTags.length) parts.push(`AI标签=${s.autoTags.map(quoteIfSpace).join(',')}`)
  if (s.badge) parts.push(`角标=${quoteIfSpace(s.badge)}`)
  if (s.auxiliary) parts.push('附属文件')
  if (s.missingPlugin) parts.push(`需要插件=${s.missingPlugin.id}`)
  if (s.score !== undefined) parts.push(`相关度=${s.score.toFixed(3)}`)
  return parts.join(' ')
}

export function searchText(r: SearchResponse): string {
  const lines = [`${r.items.length} 个，共约 ${r.total} 个`]
  if (r.scopedToApproved) lines.push('提示：资产库设定 Agent 只看到通过和免审的资产；要看其他的，加上校验状态条件')
  for (const s of r.items) lines.push(summaryLine(s))
  if (r.cursor) lines.push(`下一页：--cursor ${r.cursor}`)
  return lines.join('\n')
}

/** How an asset was made (ADR-070). */
export function provenanceLine(p: Provenance): string {
  const parts = [`方式=${p.method}`]
  if (p.tool) parts.push(`工具=${quoteIfSpace(p.tool)}`)
  if (p.plugin) parts.push(`插件=${p.plugin}`)
  if (p.prompt) parts.push(`提示词=${JSON.stringify(clip(p.prompt, 160))}`)
  if (p.params && Object.keys(p.params).length) parts.push(`参数=${clip(JSON.stringify(p.params), 160)}`)
  if (p.batch) parts.push(`批次=${p.batch}`)
  parts.push(`执行者=${p.by}`, `时间=${p.at}`)
  if (p.note) parts.push(`备注=${JSON.stringify(clip(p.note, 160))}`)
  return parts.join(' ')
}

const REL_NAMES: Record<string, string> = { source: '来源', reference: '参考', uses: '引用', belongs: '归属' }
const relName = (t: string) => REL_NAMES[t] ?? t

export function detailText(d: AssetDetail, summary?: SummaryResponse | null): string {
  const lines: string[] = []
  lines.push(`${d.name}  ${d.id}`)
  lines.push(`路径=${quoteIfSpace(d.path)} 格式=${d.format} 阶段=${d.stage} 校验=${d.review} 大小=${d.size} 指纹=${d.hash}`)
  lines.push(d.metaPath ? `元数据文件=${quoteIfSpace(d.metaPath)}${d.modifiedBy ? ` 最后修改者=${d.modifiedBy}` : ''}` : '元数据文件：没有（还没有人给它记下信息）')
  const v = d.reviewVerdict
  if (v) lines.push(`校验结论：${v.status}${v.by ? ` ${v.by}` : ''}${v.at ? ` ${v.at}` : ''}${v.note ? ` 意见=${JSON.stringify(v.note)}` : ''}`)
  if (d.tags.length || d.autoTags.length) lines.push(`标签=${d.tags.join(',') || '-'}${d.autoTags.length ? ` AI标签=${d.autoTags.join(',')}` : ''}`)
  if (d.descriptionFull) lines.push(`描述：${clip(d.descriptionFull, 400)}`)
  else if (d.auto?.description) lines.push(`AI 描述：${clip(d.auto.description, 400)}`)
  const tech = Object.entries(d.tech)
  if (tech.length) lines.push(`技术信息：${tech.map(([k, val]) => `${k}=${val}`).join(' ')}`)
  if (d.views) lines.push(`四视图：${d.views.rows}×${d.views.cols} ${d.views.cells.map(c => c ?? '-').join(',')}`)
  if (d.targetSize) lines.push(`目标尺寸：${d.targetSize.w}×${d.targetSize.h}×${d.targetSize.d} 米（来自 ${d.targetSize.from}）`)
  if (d.flags.length) lines.push(`标记=${d.flags.join(',')}`)
  for (const i of d.issues) lines.push(`问题：[${i.level}] ${i.type}${i.relation ? ` ${i.relation.type}→${i.relation.to}` : ''}${i.path ? ` ${i.path}` : ''}`)
  for (const c of d.checks) if (c.verdict !== 'pass') lines.push(`检查：[${c.verdict}] ${c.rule} ${c.message}`)
  if (d.provenance) lines.push(`出处：${provenanceLine(d.provenance)}`)
  for (const r of d.relations.outgoing) {
    const end = r.target ? quoteIfSpace(r.target.path) : `${r.targetName ?? '?'} [断链${r.targetInTrash ? '，在回收站' : ''}]`
    lines.push(`→ ${relName(r.type)}${r.slot ? `(${r.slot})` : ''}${r.role ? `[${r.role}]` : ''} ${r.to} ${end}${r.stale ? ' [上游已更新]' : ''}`)
  }
  for (const r of d.relations.incoming) {
    lines.push(`← ${relName(r.type)}${r.slot ? `(${r.slot})` : ''} ${r.from} ${r.target ? quoteIfSpace(r.target.path) : ''}`.trimEnd())
  }
  if (d.unresolvedRefs.length) lines.push(`文件里引用了但没找到：${d.unresolvedRefs.join(', ')}`)
  if (d.bundleFiles) lines.push(`包式资产：${d.bundleFiles.length} 个文件${d.bundleFiles.find(f => f.entry) ? `，入口 ${d.bundleFiles.find(f => f.entry)!.path}` : ''}`)
  if (summary?.text) lines.push(`摘要：${summary.text}`)
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
  if (!summary) return `概览图：${OVERVIEW_FAILED}`
  if (summary.image) return fetchFailed ? `概览图：${OVERVIEW_FAILED}` : '概览图：有'
  return `概览图：${summary.imageMissingReason ?? OVERVIEW_NONE}`
}

export function lineageText(l: Lineage): string {
  const name = new Map<string, string>()
  for (const n of l.nodes) name.set(n.id, n.path)
  for (const m of l.missing) name.set(m.id, `${m.name ?? m.id} [不在资产库${m.inTrash ? '，在回收站' : ''}]`)
  const lines = [`中心 ${l.center} ${name.get(l.center) ?? ''}`.trimEnd(), '资产：']
  for (const n of l.nodes) {
    lines.push('  ' + summaryLine(n))
    const p = l.provenance[n.id]
    if (p) lines.push(`      出处：${provenanceLine(p)}`)
  }
  if (l.missing.length) for (const m of l.missing) lines.push(`  ${m.id} ${m.name ?? '?'} [不在资产库${m.inTrash ? '，在回收站' : ''}]`)
  lines.push('关系：')
  for (const e of l.edges) {
    const flags = [e.broken ? '断链' : '', e.stale ? '上游已更新' : ''].filter(Boolean)
    lines.push(`  ${name.get(e.from) ?? e.from} --${relName(e.type)}${e.slot ? `(${e.slot})` : ''}${e.role ? `[${e.role}]` : ''}--> ${name.get(e.to) ?? e.to}${flags.length ? ` [${flags.join(',')}]` : ''}`)
  }
  if (!l.edges.length) lines.push('  （没有）')
  return lines.join('\n')
}

export function newTagsText(newTags: RegisterResponse['newTags']): string[] {
  return newTags.map(t => `新标签 ${JSON.stringify(t.tag)}${t.similar.length ? `，已有相近的：${t.similar.join('、')}` : ''}`)
}

export function registerText(r: RegisterResponse, label?: string): string {
  const lines: string[] = []
  if (r.skipped || !r.asset) lines.push(`已跳过${label ? ` ${label}` : ''}（同名文件已存在）`)
  else lines.push(`已登记 ${summaryLine(r.asset)}`)
  lines.push(...newTagsText(r.newTags))
  return lines.join('\n')
}

const FIELD_NAMES: Record<string, string> = {
  stage: '阶段', tags: '标签', description: '描述', review: '校验', provenance: '出处', relations: '关系', views: '四视图', auxiliary: '附属文件'
}
const fieldName = (f: string) => FIELD_NAMES[f] ?? (f.startsWith('fields.') ? `自定义字段 ${f.slice(7)}` : f)
const brief = (v: unknown) => (v === null || v === undefined ? '（空）' : clip(typeof v === 'string' ? v : JSON.stringify(v), 120))

/** What a wanted-state write did (or, on a dry run, would do), item by item (ADR-068). */
export function applyText(r: ApplyResponse): string {
  const changed = r.results.filter(x => x.changed).length
  const failed = r.results.filter(x => x.error).length
  const lines = [`${r.dryRun ? '试运行，没有写入：' : ''}${r.results.length} 项，${r.dryRun ? '会改' : '改了'} ${changed} 项，${r.results.length - changed - failed} 项没有差别${failed ? `，${failed} 项失败` : ''}`]
  for (const x of r.results) {
    const who = x.path ?? x.id ?? `第 ${x.index + 1} 项`
    if (x.error) { lines.push(`× ${who}：${x.error.message}`); continue }
    if (!x.changed) continue
    lines.push(`${r.dryRun ? '会改' : '已改'} ${who}${x.id ? ` ${x.id}` : ''}`)
    for (const c of x.changes) lines.push(`  ${fieldName(c.field)}：${brief(c.before)} → ${brief(c.after)}`)
  }
  lines.push(...newTagsText(r.newTags))
  return lines.join('\n')
}

export function issuesText(r: IssuesResponse): string {
  const lines = [`${r.assetCount} 个资产上共 ${r.total} 条问题`]
  for (const i of r.issues) {
    const a = i.assetId ? r.assets[i.assetId] : undefined
    const where = a ? `${a.id} ${quoteIfSpace(a.path)}` : (i.path ?? '')
    lines.push(`[${i.level}] ${i.type} ${where}`.trimEnd())
    if (i.relation) lines.push(`  关系：${relName(i.relation.type)}${i.relation.slot ? `(${i.relation.slot})` : ''} → ${i.relation.to}`)
    if (Object.keys(i.details ?? {}).length) lines.push(`  详情：${clip(JSON.stringify(i.details), 160)}`)
    lines.push(`  标识：${i.id}`)
  }
  return lines.join('\n')
}

export function vocabularyText(v: Vocabulary): string {
  const lines: string[] = []
  lines.push(`物料阶段：${v.stages.map(s => `${s.id}(${s.name})`).join(' ')}`)
  lines.push(`校验状态：${v.reviews.map(s => `${s.id}(${s.name})`).join(' ')}`)
  lines.push(`格式：${v.formats.map(f => `${f.id}×${f.count}`).join(' ') || '-'}`)
  lines.push(`关系类型：${v.relationTypes.map(r => `${r.id}(${r.name}/${r.inverseName}${r.tracksVersion ? '，跟踪上游' : ''})`).join(' ')}`)
  lines.push(`标签（${v.tags.length} 个）：${v.tags.map(t => `${quoteIfSpace(t.name)}×${t.count}`).join(' ') || '-'}`)
  if (v.methods.length) lines.push(`生产方式：${v.methods.map(m => `${m.id}×${m.count}`).join(' ')}`)
  if (v.actors.length) lines.push(`执行者：${v.actors.map(m => `${m.id}×${m.count}`).join(' ')}`)
  if (v.templates.length) lines.push(`模板：${v.templates.map(t => `${t.id}(${t.displayName})`).join(' ')}`)
  if (v.designObjects.length) lines.push(`设计对象：${v.designObjects.map(d => `${d.id} ${quoteIfSpace(d.title ?? d.name)}`).join('；')}`)
  return lines.join('\n')
}

export function jobText(j: JobInfo): string {
  const parts = [`任务 ${j.id}`, `类别=${j.kind}`, `状态=${j.status}`]
  if (j.creator) parts.push(`方式=${j.creator}`)
  if (j.stage) parts.push(`阶段=${j.stage}`)
  if (j.assetId) parts.push(`资产=${j.assetId}`)
  if (j.progress !== undefined) parts.push(`进度=${Math.round(j.progress * 100)}%`)
  if (j.message) parts.push(`说明=${JSON.stringify(j.message)}`)
  if (j.error) parts.push(`错误=${JSON.stringify(j.error)}${j.retryable === false ? '（重试也没用）' : ''}`)
  if (j.outputs.length) parts.push(`产出=${j.outputs.join(',')}`)
  if (j.action) parts.push(`需要：${j.action.label}（插件页面 ${j.action.page}）`)
  return parts.join(' ')
}

export function creatorsText(list: CreatorInfo[]): string {
  if (!list.length) return '没有可用的创建方式（没有启用创建插件）'
  return list.map(c => {
    const inputs = c.inputs.map(i => `${i.role}${i.formats?.length ? `[${i.formats.join('|')}]` : ''}${i.required ? '' : '?'}`).join(', ')
    const props = Object.keys(((c.params as { properties?: Record<string, unknown> }).properties) ?? {})
    return `${c.id} ${JSON.stringify(c.displayName)} 插件=${c.pluginId}${inputs ? ` 输入：${inputs}` : ''}${props.length ? ` 参数：${props.join(', ')}` : ''}${c.page ? '（在网页里打开它自己的页面）' : ''}`
  }).join('\n')
}

export function actionsText(list: ActionInfo[]): string {
  if (!list.length) return '这些资产没有可用的动作'
  return list.map(a => `${a.id} ${JSON.stringify(a.title)} 插件=${a.pluginId}`).join('\n')
}

export function exportPlanText(p: ExportPlan): string {
  const lines = [`${p.files.length} 个文件，${p.bytes} 字节，依赖 ${p.dependencies} 个${p.duplicateNames ? '（有重名！）' : ''}`]
  for (const f of p.files) lines.push(`${f.path} ← ${f.assetId}${f.fromFile ? `（文件 ${f.fromFile}）` : ''}${f.dependency ? ' [依赖]' : ''}`)
  return lines.join('\n')
}
