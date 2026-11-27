import type { Query } from '@bowerbird/schema'
/** TanStack Query keys. Events from the server invalidate by prefix (lib/events.ts). */
export const qk = {
  libraries: () => ['libraries'] as const,
  library: (lib: string) => ['lib', lib, 'info'] as const,
  search: (lib: string, q: Query & { facets?: boolean }) => ['lib', lib, 'search', q] as const,
  /** The browse grid's paged result. Kept apart from `search` so new assets wait behind the pill (F-03). */
  browse: (lib: string, q: Query) => ['lib', lib, 'browse', q] as const,
  /** Facet counts for the filter panel and the inspector's view summary. */
  facets: (lib: string, q: Query) => ['lib', lib, 'browse-facets', q] as const,
  asset: (lib: string, id: string) => ['lib', lib, 'asset', id] as const,
  lineage: (lib: string, id: string, opts: unknown) => ['lib', lib, 'asset', id, 'lineage', opts] as const,
  versions: (lib: string, id: string) => ['lib', lib, 'asset', id, 'versions'] as const,
  folders: (lib: string) => ['lib', lib, 'folders'] as const,
  views: (lib: string) => ['lib', lib, 'views'] as const,
  tags: (lib: string) => ['lib', lib, 'tags'] as const,
  vocabulary: (lib: string) => ['lib', lib, 'vocabulary'] as const,
  issues: (lib: string, q?: unknown) => ['lib', lib, 'issues', q ?? {}] as const,
  trash: (lib: string) => ['lib', lib, 'trash'] as const,
  jobs: (lib: string) => ['lib', lib, 'jobs'] as const,
  creators: (lib: string) => ['lib', lib, 'creators'] as const,
  cache: (lib: string) => ['lib', lib, 'cache'] as const,
  plugins: () => ['plugins'] as const,
  config: () => ['config'] as const
}
