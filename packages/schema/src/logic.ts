/**
 * Pure rules shared by kernel, shell, CLI and fixtures. No I/O here.
 */
import { BMETA_KEY_ORDER, FOLDER_META_KEY_ORDER, RECORD_KEY_ORDER, SIDECAR_SUFFIX, FOLDER_META_NAME, type Bmeta } from './disk.js'
import type { ReviewStatus } from './primitives.js'

/**
 * Effective review status (data-model.md「有效状态的计算」):
 * exempt stays exempt; a verdict for other content is pending; otherwise the stored status.
 */
export function effectiveReview(meta: Pick<Bmeta, 'hash' | 'review'>): ReviewStatus {
  const r = meta.review
  if (!r) return 'pending'
  if (r.status === 'exempt') return 'exempt'
  if (!r.hash || r.hash !== meta.hash) return 'pending'
  return r.status
}

/** Built-in relation types that record the counterpart's version. */
export function builtinTracksVersion(type: string): boolean { return type === 'source' }

/** Split `chest.png` into base `chest` and extension `.png`; dot-files and no-extension names keep everything in base. */
export function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.')
  if (i <= 0) return { base: name, ext: '' }
  return { base: name.slice(0, i), ext: name.slice(i) }
}

/**
 * Copy / keep-both / restore-into-occupied naming: `chest.png` → `chest_1.png`, `chest_2.png`, …
 * (sync-and-integrity.md「副本的名字」). `taken` answers whether a name is already used in the target folder.
 */
export function nextFreeName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name
  const { base, ext } = splitName(name)
  for (let n = 1; ; n++) {
    const c = `${base}_${n}${ext}`
    if (!taken(c)) return c
  }
}

/** Always derive a fresh copy name, even if the original name is free (copy into the same folder). */
export function copyName(name: string, taken: (candidate: string) => boolean): string {
  const { base, ext } = splitName(name)
  for (let n = 1; ; n++) {
    const c = `${base}_${n}${ext}`
    if (!taken(c)) return c
  }
}

export function sidecarOf(assetPath: string): string { return assetPath + SIDECAR_SUFFIX }
export function isSidecar(path: string): boolean { return path.endsWith(SIDECAR_SUFFIX) && !path.endsWith('/' + FOLDER_META_NAME) && path !== FOLDER_META_NAME }
export function assetOfSidecar(sidecarPath: string): string { return sidecarPath.slice(0, -SIDECAR_SUFFIX.length) }

/** Library-relative POSIX path helpers. */
export function joinPath(...parts: string[]): string { return parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') }
export function dirOf(path: string): string { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i) }
export function baseOf(path: string): string { const i = path.lastIndexOf('/'); return i < 0 ? path : path.slice(i + 1) }

function ordered(obj: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k]
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k]
  return out
}

/** Serialize a .bmeta: fixed key order, two-space indent, trailing newline (library-format.md). */
export function serializeBmeta(meta: Bmeta | Record<string, unknown>): string {
  return JSON.stringify(ordered(meta as Record<string, unknown>, BMETA_KEY_ORDER), null, 2) + '\n'
}
export function serializeFolderMeta(meta: Record<string, unknown>): string {
  return JSON.stringify(ordered(meta, FOLDER_META_KEY_ORDER), null, 2) + '\n'
}
export function serializeRecord(rec: Record<string, unknown>): string {
  return JSON.stringify(ordered(rec, RECORD_KEY_ORDER), null, 2) + '\n'
}
export function serializeJson(value: unknown): string { return JSON.stringify(value, null, 2) + '\n' }

/** First sentence of a description (search.md「结果」). */
export function firstSentence(text: string | undefined | null): string | null {
  if (!text) return null
  const t = text.trim()
  if (!t) return null
  const m = /^[\s\S]*?(?:[。！？]|[.!?](?=\s|$))/.exec(t)
  return (m ? m[0] : t).trim()
}

/** Normalize a tag for comparison: Unicode NFC + trim; case-sensitive (data-model.md「标签」). */
export function normalizeTag(tag: string): string { return tag.normalize('NFC').trim() }

/** Actor category (`user`, `agent`, `system`). */
export function actorKind(actor: string): 'user' | 'agent' | 'system' {
  const k = actor.split(':', 1)[0]
  return k === 'agent' ? 'agent' : k === 'system' ? 'system' : 'user'
}

/** Whether an actor matches a `by:` filter (`agent` matches all agents, `agent:modeler` only that one). */
export function actorMatches(actor: string, by: string): boolean {
  return by.includes(':') ? actor === by : actorKind(actor) === by || actor.startsWith(by + ':')
}

/** 1-based version number of a hash within version records (last occurrence). */
export function versionNumberOf(versions: ReadonlyArray<{ hash: string }>, hash: string): number | null {
  for (let i = versions.length - 1; i >= 0; i--) if (versions[i]!.hash === hash) return i + 1
  return null
}

/** Parse `1.26 × 0.95 × 0.87 m` (宽 × 高 × 深, metres; `x` or `×`; optional unit cm/mm/m). */
export function parseTargetSize(text: string): { w: number; h: number; d: number } | null {
  const m = /^\s*([\d.]+)\s*[×xX*]\s*([\d.]+)\s*[×xX*]\s*([\d.]+)\s*(m|cm|mm)?\s*$/.exec(text)
  if (!m) return null
  const f = m[4] === 'cm' ? 0.01 : m[4] === 'mm' ? 0.001 : 1
  const [w, h, d] = [m[1], m[2], m[3]].map(v => Math.round(Number(v) * f * 1e6) / 1e6) as [number, number, number]
  if (![w, h, d].every(Number.isFinite)) return null
  return { w, h, d }
}
