import { dirOf, normalizeTag, type FolderDefaults, type Stage } from '@bowerbird/schema'
import type { LocalLibraryFs } from './fs.js'

export interface EffectiveDefaults {
  stage?: Stage
  review?: 'pending' | 'exempt'
  tags?: string[]
  /** Which folder each item comes from ('' = library root). */
  from: Record<string, string>
}

/** Ancestors of a folder, nearest first, ending with the root (''). */
export function ancestors(folder: string): string[] {
  const out: string[] = []
  let f = folder
  for (;;) {
    out.push(f)
    if (f === '') break
    f = dirOf(f)
  }
  return out
}

/**
 * Folder defaults inherited item by item from the nearest ancestor that sets them (library-format.md「文件夹设置」).
 * Applied once, when an asset is claimed in the folder.
 */
export async function effectiveDefaults(fs: LocalLibraryFs, folder: string): Promise<EffectiveDefaults> {
  const out: EffectiveDefaults = { from: {} }
  for (const f of ancestors(folder)) {
    const meta = await fs.readFolderMeta(f)
    const d: FolderDefaults | undefined = meta?.defaults
    if (!d) continue
    if (out.stage === undefined && d.stage) { out.stage = d.stage; out.from.stage = f }
    if (out.review === undefined && d.review) { out.review = d.review; out.from.review = f }
    if (out.tags === undefined && d.tags) { out.tags = d.tags.map(normalizeTag).filter(Boolean); out.from.tags = f }
  }
  return out
}
