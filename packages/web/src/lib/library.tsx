import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { api } from './api'
import { qk } from './keys'

/** Current library id from the URL (`/libraries/:lib/...`, ADR-026: each browser picks its own library). */
export function useLibraryId(): string {
  const { lib } = useParams()
  if (!lib) throw new Error('useLibraryId() outside /libraries/:lib')
  return lib
}

export function useLibrary() {
  const lib = useLibraryId()
  return useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
}

const LAST = 'bowerbird.lastLibrary'
export function rememberLibrary(id: string): void { try { localStorage.setItem(LAST, id) } catch { /* ignore */ } }
export function lastLibrary(): string | null { try { return localStorage.getItem(LAST) } catch { return null } }
