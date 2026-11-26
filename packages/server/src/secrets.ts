/**
 * Plugin settings marked `writeOnly` in the manifest's JSON Schema (access keys) never leave the server in clear:
 * reads replace a stored value with the placeholder `{ "set": true }`; writes that send the placeholder back, or
 * leave the key out, keep the stored value; `null` clears it.
 */
export const SECRET_PLACEHOLDER = Object.freeze({ set: true as const })

type Values = Record<string, unknown>

export function isSecretPlaceholder(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && (v as { set?: unknown }).set === true && Object.keys(v).length === 1
}

/** Keys whose schema property says `writeOnly: true`; null when the schema is unknown (mask everything). */
export function writeOnlyKeys(schema: Record<string, unknown> | null | undefined): string[] | null {
  if (!schema) return null
  const props = (schema.properties ?? {}) as Record<string, unknown>
  return Object.entries(props)
    .filter(([, p]) => typeof p === 'object' && p !== null && (p as { writeOnly?: unknown }).writeOnly === true)
    .map(([k]) => k)
}

/** Values as returned to clients. `keys === null` (plugin unknown): every stored value is masked. */
export function maskSecrets(values: Values | null | undefined, keys: string[] | null): Values {
  const out: Values = { ...(values ?? {}) }
  for (const k of keys ?? Object.keys(out)) {
    if (!(k in out)) continue
    const v = out[k]
    if (v === undefined || v === null || v === '') delete out[k]
    else out[k] = { ...SECRET_PLACEHOLDER }
  }
  return out
}

/** Values to store: placeholders and omitted secrets keep what is stored; `null` clears. */
export function restoreSecrets(incoming: Values, stored: Values | null | undefined, keys: string[] | null): Values {
  const out: Values = { ...incoming }
  const current = stored ?? {}
  for (const k of keys ?? []) {
    const has = Object.prototype.hasOwnProperty.call(out, k)
    if (!has || isSecretPlaceholder(out[k])) {
      if (current[k] !== undefined && current[k] !== null) out[k] = current[k]
      else delete out[k]
    }
  }
  // Unknown schema: a placeholder can only mean「keep」.
  if (keys === null) for (const [k, v] of Object.entries(out)) if (isSecretPlaceholder(v)) { if (current[k] !== undefined) out[k] = current[k]; else delete out[k] }
  return out
}
