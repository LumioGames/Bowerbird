import type { SearchDoc } from '@bowerbird/plugin-sdk'

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
/** A search document for tests: `asset_<n>.png` unless overridden. */
export function doc(n: number, over: Partial<SearchDoc> = {}): SearchDoc {
  const name = over.name ?? `asset_${n}.png`
  return {
    id: id(n), name, stem: name.replace(/\.[^.]+$/, ''), path: `props/${name}`, folder: 'props',
    tags: [], autoTags: [], description: '', autoDescription: '', prompts: [], text: '', format: 'image', ...over
  }
}
