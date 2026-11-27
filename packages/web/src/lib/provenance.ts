import type { Provenance, ProvenanceInput } from '@bowerbird/schema'

/**
 * Provenance is said as a whole (ADR-068, ADR-070): to change one part of it, say it again with that part changed.
 * This turns what an asset has into what a client may say: the kernel stamps `by` / `at` (and keeps `plugin` while the
 * method stays), so those are left out.
 */
export function provenanceInput(p: Provenance): ProvenanceInput {
  return {
    method: p.method,
    ...(p.tool ? { tool: p.tool } : {}),
    ...(p.prompt ? { prompt: p.prompt } : {}),
    ...(p.params && Object.keys(p.params).length ? { params: p.params } : {}),
    ...(p.batch ? { batch: p.batch } : {}),
    ...(p.note ? { note: p.note } : {})
  }
}

/** The provenance an apply answer says was there before (`changes[].before`), as something to say again for undo. */
export function provenanceBefore(changes: Array<{ field: string; before: unknown }> | undefined): { changed: boolean; before: ProvenanceInput | null } {
  const c = changes?.find(x => x.field === 'provenance')
  if (!c) return { changed: false, before: null }
  const b = c.before as Provenance | null | undefined
  return { changed: true, before: b && typeof b === 'object' && 'method' in b ? provenanceInput(b) : null }
}
