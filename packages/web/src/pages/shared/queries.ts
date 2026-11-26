import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LineageQuery, Query } from '@bowerbird/schema'
import { api } from '../../lib/api'
import { qk } from '../../lib/keys'

/** TanStack Query hooks for web-2 pages. Keys come from lib/keys.ts so server events invalidate them (lib/events.ts). */

export const useAsset = (lib: string, id: string | null | undefined) =>
  useQuery({ queryKey: qk.asset(lib, id ?? ''), queryFn: () => api.assets.get(lib, id!), enabled: !!id })

export const useVersions = (lib: string, id: string | null | undefined) =>
  useQuery({ queryKey: qk.versions(lib, id ?? ''), queryFn: () => api.assets.versions(lib, id!), enabled: !!id })

export const useLineage = (lib: string, id: string, q: Partial<LineageQuery>, enabled = true) =>
  useQuery({ queryKey: qk.lineage(lib, id, q), queryFn: () => api.assets.lineage(lib, id, q), enabled: enabled && !!id })

export const useSearch = (lib: string, q: Query & { facets?: boolean }, enabled = true) =>
  useQuery({ queryKey: qk.search(lib, q), queryFn: () => api.search(lib, q), enabled })

export const useIssues = (lib: string) => useQuery({ queryKey: qk.issues(lib), queryFn: () => api.issues.list(lib) })
export const useTrash = (lib: string) => useQuery({ queryKey: qk.trash(lib), queryFn: () => api.trash.list(lib) })
export const useTags = (lib: string) => useQuery({ queryKey: qk.tags(lib), queryFn: () => api.tags.list(lib) })
export const useJobs = (lib: string) => useQuery({ queryKey: qk.jobs(lib), queryFn: () => api.jobs.overview(lib) })
export const useCache = (lib: string) => useQuery({ queryKey: qk.cache(lib), queryFn: () => api.libraries.cache(lib) })
export const useVocabulary = (lib: string) => useQuery({ queryKey: qk.vocabulary(lib), queryFn: () => api.libraries.vocabulary(lib) })
export const useFolders = (lib: string) => useQuery({ queryKey: qk.folders(lib), queryFn: () => api.folders.tree(lib) })
export const usePlugins = () => useQuery({ queryKey: qk.plugins(), queryFn: () => api.plugins.list() })
export const useConfig = () => useQuery({ queryKey: qk.config(), queryFn: () => api.config.get() })

/** Invalidate helpers after a write (server events do the same for everyone else). */
export function useInvalidate(lib: string) {
  const qc = useQueryClient()
  return {
    asset: (...ids: Array<string | null | undefined>) => { for (const id of ids) if (id) void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', id] }) },
    lib: (...k: string[]) => { for (const x of k) void qc.invalidateQueries({ queryKey: ['lib', lib, x] }) },
    global: (...k: string[]) => { for (const x of k) void qc.invalidateQueries({ queryKey: [x] }) }
  }
}
