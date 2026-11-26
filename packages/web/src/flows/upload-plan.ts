/**
 * Upload planning (web-shell.md「上传」, copy.md 上传): where each file goes (a dropped folder can keep its
 * structure) and what to do with each name that is already taken — asked one by one (替换为新版本 / 保留两者 /
 * 跳过), with「对其余同名文件同样处理」to stop asking. Two files of the same batch landing on the same name count too.
 * Pure, so the decisions are testable without a server.
 */
export type ConflictChoice = 'replace' | 'keep-both' | 'skip'

export interface PlannedFile<F = unknown> {
  file: F
  name: string
  /** Library-relative destination folder. */
  dest: string
  onConflict?: ConflictChoice
}

export function destOf(folder: string, rel: string | undefined, keep: boolean): string {
  if (!keep || !rel) return folder
  return [folder, rel].filter(Boolean).join('/')
}

export interface ConflictQuestion<F> {
  file: PlannedFile<F>
  /** An asset already in the library with that name, or an earlier file of this batch. */
  existing: { kind: 'asset'; id: string } | { kind: 'batch'; file: PlannedFile<F> }
  /** More conflicts come after this one (show「对其余同名文件同样处理」). */
  more: boolean
}

/**
 * Walk the files in order; for each taken name ask (unless a「同样处理」choice is in force).
 * `taken(dest, name)` answers from the precheck; the batch itself is tracked here.
 * Returns the files to send (skipped ones dropped), or null when the dialog was cancelled.
 */
export async function resolveConflicts<F>(
  files: ReadonlyArray<PlannedFile<F>>,
  taken: (dest: string, name: string) => string | null,
  ask: (q: ConflictQuestion<F>) => Promise<{ choice: ConflictChoice; rest: boolean } | null>
): Promise<Array<PlannedFile<F>> | null> {
  const out: Array<PlannedFile<F>> = []
  const inBatch = new Map<string, PlannedFile<F>>()
  const key = (d: string, n: string) => `${d}\u0000${n}`
  let rule: ConflictChoice | null = null
  const isConflict = (f: PlannedFile<F>) => taken(f.dest, f.name) != null || inBatch.has(key(f.dest, f.name))
  for (let i = 0; i < files.length; i++) {
    const f = { ...files[i]! }
    const existingId = taken(f.dest, f.name)
    const earlier = inBatch.get(key(f.dest, f.name))
    if (existingId == null && !earlier) { out.push(f); inBatch.set(key(f.dest, f.name), f); continue }
    let choice = rule
    if (!choice) {
      const more = files.slice(i + 1).some(g => isConflict(g))
      const a = await ask({ file: f, existing: earlier ? { kind: 'batch', file: earlier } : { kind: 'asset', id: existingId! }, more })
      if (!a) return null
      choice = a.choice
      if (a.rest) rule = a.choice
    }
    if (choice === 'skip') continue
    if (earlier && choice === 'replace') {
      // The later file of the same name replaces the earlier one before anything is sent.
      const g: PlannedFile<F> = { ...f, ...(earlier.onConflict ? { onConflict: earlier.onConflict } : {}) }
      out.splice(out.indexOf(earlier), 1, g)
      inBatch.set(key(f.dest, f.name), g)
      continue
    }
    if (earlier && choice === 'keep-both') {
      f.name = nextName(f.name, n => taken(f.dest, n) != null || inBatch.has(key(f.dest, n)))
      if (existingId != null) f.onConflict = 'keep-both'
      out.push(f); inBatch.set(key(f.dest, f.name), f); continue
    }
    f.onConflict = choice
    out.push(f); inBatch.set(key(f.dest, f.name), f)
  }
  return out
}

/** `chest.png` → `chest_1.png`, `chest_2.png`… (sync-and-integrity.md「副本的名字」). */
export function nextName(name: string, isTaken: (n: string) => boolean): string {
  const i = name.lastIndexOf('.')
  const base = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : ''
  for (let n = 1; ; n++) { const c = `${base}_${n}${ext}`; if (!isTaken(c)) return c }
}
