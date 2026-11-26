/**
 * The viewer's channels (builtin-plugins.md「通道」「通道菜单」, prototype model.js): nine material channels that
 * output one material input as colour, and six inspection views. A channel key narrows to one component
 * (`base.r`, `normal.g`, `vcol:1.a`); vertex colours pick a set first (COLOR_0, COLOR_1…), then R G B A only —
 * what each component means is not read (ADR-022). Pure.
 */

import { zh, type T } from '../i18n'

export type ChannelBase =
  | 'full' | 'base' | 'normal' | 'rough' | 'metal' | 'ao' | 'emit' | 'alpha' | 'vcol'
  | 'wire' | 'wireover' | 'uv' | 'matcap' | 'face' | 'density'
export type Comp = '' | 'r' | 'g' | 'b' | 'a'

export const CHANNEL_ORDER: ChannelBase[] = [
  'full', 'base', 'normal', 'rough', 'metal', 'ao', 'emit', 'alpha', 'vcol',
  'wire', 'wireover', 'uv', 'matcap', 'face', 'density'
]
export const MATERIAL_CHANNELS = CHANNEL_ORDER.slice(0, 9)
export const CHECK_VIEWS = CHANNEL_ORDER.slice(9)

/** A channel's display name in the given language (Chinese by default). */
export function channelLabel(base: ChannelBase, tr: T = zh): string { return tr(`ch.${base}`) }

/** Components each colour channel can narrow to; a single component shows as grey. `''` is「全部」. */
export const COMPONENTS: Partial<Record<ChannelBase, Array<[Comp, string]>>> = {
  base: [['', ''], ['r', 'R'], ['g', 'G'], ['b', 'B'], ['a', 'A']],
  normal: [['', ''], ['r', 'X'], ['g', 'Y'], ['b', 'Z']],
  emit: [['', ''], ['r', 'R'], ['g', 'G'], ['b', 'B']],
  vcol: [['', ''], ['r', 'R'], ['g', 'G'], ['b', 'B'], ['a', 'A']]
}

/** Shader codes of the material channels (the debug output branch in the patched material). */
export const CHANNEL_CODE: Partial<Record<ChannelBase, number>> = { full: 0, base: 1, normal: 2, rough: 3, metal: 4, ao: 5, emit: 6, alpha: 7, vcol: 8 }
export const COMP_INDEX: Record<Comp, number> = { '': -1, r: 0, g: 1, b: 2, a: 3 }

export interface Channel { base: ChannelBase; comp: Comp; set: number }

export function parseChannel(key: string): Channel {
  const [head = 'full', comp = ''] = key.split('.')
  const [base, set] = head.split(':')
  const b = (CHANNEL_ORDER.includes(base as ChannelBase) ? base : 'full') as ChannelBase
  const c = (['', 'r', 'g', 'b', 'a'].includes(comp) ? comp : '') as Comp
  return { base: b, comp: c, set: Math.max(0, Number(set) || 0) }
}

export function channelKey(c: Channel): string {
  return c.base + (c.base === 'vcol' && c.set > 0 ? ':' + c.set : '') + (c.comp ? '.' + c.comp : '')
}

export function compLabel(base: ChannelBase, comp: Comp, tr: T = zh): string {
  if (!comp) return tr('compAll')
  const l = (COMPONENTS[base] ?? COMPONENTS.base!).find(x => x[0] === comp)
  return l ? l[1] : comp.toUpperCase()
}

/** Name for chips and the tool bar: 基础色 · R, 法线 · X, 顶点色 · COLOR_1 · G (the set only when there are several). */
export function channelName(key: string, vcolSets = 1, tr: T = zh): string {
  const c = parseChannel(key)
  let s = channelLabel(c.base, tr)
  if (c.base === 'vcol' && vcolSets > 1) s += ` · COLOR_${c.set}`
  if (c.comp) s += ' · ' + compLabel(c.base, c.comp, tr)
  return s
}

/** Whether a pass of this channel is lit (full render and wireframe overlay keep lights, ground and shadow). */
export function isShaded(key: string): boolean {
  const b = parseChannel(key).base
  return b === 'full' || b === 'wireover'
}

/** What the loaded file can show; decides which channels say「这个格式不支持」(ADR-022: still clickable). */
export interface ModelCaps {
  /** Metallic-roughness materials (glTF); false for FBX's Phong/Lambert. */
  pbr: boolean
  /** Some material has an occlusion map. */
  ao: boolean
  uv: boolean
  /** Some material has a texture (texel density needs one). */
  textures: boolean
  /** Number of vertex colour sets (0 = none:「顶点色 · 无」, not unsupported). */
  vcolSets: number
  /** Packed-texture labels, e.g. { rough: 'ORM · G', metal: 'ORM · B', ao: 'ORM · R' }. */
  packed: Partial<Record<'rough' | 'metal' | 'ao', string>>
}

export const NO_CAPS: ModelCaps = { pbr: true, ao: false, uv: true, textures: false, vcolSets: 0, packed: {} }

export function unreadable(key: string, caps: ModelCaps): boolean {
  const b = parseChannel(key).base
  if (b === 'rough' || b === 'metal') return !caps.pbr
  if (b === 'ao') return !caps.ao
  if (b === 'uv') return !caps.uv
  if (b === 'density') return !caps.uv || !caps.textures
  return false
}

/** Short label of a packed texture: `chest_orm.png` → `ORM`, `rock_mr.png` → `MR`. */
export function shortTextureName(name: string): string {
  const file = name.split(/[\\/]/).pop() ?? name
  const stem = file.replace(/\.[a-z0-9]+$/i, '')
  const token = stem.split(/[_\-\s.]/).filter(Boolean).pop() ?? stem
  if (token.length <= 5) return token.toUpperCase()
  return stem.length > 12 ? stem.slice(0, 11) + '…' : stem
}

/**
 * 「ORM · G」labels from the textures the materials actually bind (glTF: occlusion .r, roughness .g, metalness .b).
 * One texture serving occlusion and metal-roughness is the ORM pack.
 */
export function packedLabels(maps: { rough?: string | null; metal?: string | null; ao?: string | null; mrIsAo?: boolean }): ModelCaps['packed'] {
  const out: ModelCaps['packed'] = {}
  const nameFor = (n: string, fallback: string, shared: boolean) => (shared ? 'ORM' : shortTextureName(n) || fallback)
  if (maps.rough) out.rough = `${nameFor(maps.rough, 'MR', !!maps.mrIsAo)} · G`
  if (maps.metal) out.metal = `${nameFor(maps.metal, 'MR', !!maps.mrIsAo)} · B`
  if (maps.ao) out.ao = `${nameFor(maps.ao, 'AO', !!maps.mrIsAo)} · R`
  return out
}

/** The channel a new strip adds: the first of 完整 / 基础色 / 法线 / 粗糙度 / 金属度 / 遮蔽 not on screen and readable. */
export function nextStrip(used: string[], caps: ModelCaps): string | null {
  const bases = used.map(k => parseChannel(k).base)
  for (const c of ['full', 'base', 'normal', 'rough', 'metal', 'ao'] as ChannelBase[]) if (!bases.includes(c) && !unreadable(c, caps)) return c
  return null
}

/** Strips start from the current channel plus the next of 完整 / 基础色 / 法线 (three in all). */
export function initialStrips(current: string): string[] {
  const cur = parseChannel(current).base
  return [current, ...(['full', 'base', 'normal'] as ChannelBase[]).filter(c => c !== cur)].slice(0, 3)
}

/** Wipe starts with the current channel on the left and 基础色 (or 完整渲染 when already on 基础色) on the right. */
export function initialWipe(current: string): [string, string] {
  return [current, parseChannel(current).base === 'base' ? 'full' : 'base']
}

export const MIN_STRIPS = 2
export const MAX_STRIPS = 4
