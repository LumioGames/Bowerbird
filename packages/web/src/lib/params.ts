import { t } from './i18n'

/**
 * A production record's parameters in words, the way the prototype writes them (data.js RECS):「缩放 1 · 动画烘焙 30 fps ·
 * 贴图 1024」「seed 4211 · 1536×1536 · 30 步」「通道 完整渲染 · 环境 工作室 · 透视 35° · 256×256」「12 张 · 2× 导出 · 透明裁边」.
 * The keys are open (ProductionRecord.params: a few conventional ones plus whatever a tool writes): a key the
 * dictionaries know gets its phrase (`param.<method>.<key>` when a method means something of its own by it, else
 * `param.<key>`), a value they know gets its word (`param.v.<key>.<value>`), anything else stays `key value`. A known
 * on/off key reads as its phrase when on and is left out when off. Grouping objects (the model viewer's `camera`,
 * `environment`) are read key by key; `rect` (where each slice was cut, per output) is left out.
 */
const GROUPS = new Set(['camera', 'environment'])
const SKIP = new Set(['rect'])

function known(key: string): string | null { return t(key) === key ? null : key }

function phraseKey(method: string, k: string): string | null { return known(`param.${method}.${k}`) ?? known(`param.${k}`) }

function valueText(k: string, v: unknown): string {
  if (typeof v === 'string') { const w = known(`param.v.${k}.${v}`); return w ? t(w) : v }
  if (Array.isArray(v)) return v.map(x => valueText(k, x)).join(', ')
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function paramsText(method: string, params: Record<string, unknown> | null | undefined): string {
  if (!params) return ''
  const flat: Array<[string, unknown]> = []
  for (const [k, v] of Object.entries(params)) {
    if (GROUPS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) flat.push([k2 === 'name' ? k : k2, v2])
    } else flat.push([k, v])
  }
  const has = new Map(flat)
  const parts: string[] = []
  for (const [k, v] of flat) {
    if (v == null || v === '' || SKIP.has(k)) continue
    // joined with their neighbour:「透视 35°」「1280×720」; a frame number says what the time would
    if (k === 'fov' && has.get('projection') === 'perspective') continue
    if (k === 'height' && typeof v === 'number' && typeof has.get('width') === 'number') continue
    if (k === 'time' && has.get('frame') != null) continue
    if (k === 'width' && typeof v === 'number' && typeof has.get('height') === 'number') { parts.push(`${v}×${has.get('height')}`); continue }
    if (k === 'projection' && v === 'perspective' && has.get('fov') != null) { parts.push(`${valueText(k, v)} ${has.get('fov')}°`); continue }
    const key = phraseKey(method, k)
    if (typeof v === 'boolean' && key) { if (v) parts.push(t(key)); continue }
    if (k === 'size' || k === 'projection') { parts.push(valueText(k, v)); continue }
    parts.push(key ? t(key, { v: valueText(k, v) }) : `${k} ${valueText(k, v)}`)
  }
  return parts.join(' · ')
}
