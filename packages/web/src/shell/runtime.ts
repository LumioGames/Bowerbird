import type { QueryClient } from '@tanstack/react-query'
import type { NavigateFunction } from 'react-router'
import type { LibraryInfo } from '@bowerbird/schema'

/**
 * What operations started from menus, shortcuts and dialogs need to know, wherever they are started:
 * the current library, its info, the router and the query cache. ShellLayout keeps it current.
 * Operations live outside React components (they are called from menus, the keyboard and plugin code).
 */
export interface ShellRuntime {
  lib: string
  info: LibraryInfo | undefined
  qc: QueryClient
  /** Path navigation inside the app (`/libraries/<lib>/…`). */
  go: (path: string, opts?: { replace?: boolean }) => void
  /** react-router navigate, for navigation that carries state (the detail page's trail). */
  navigate: NavigateFunction
  /** The browse page's current folder (upload target), '' = library root, null = not in a folder. */
  currentFolder: () => string | null
}

let current: ShellRuntime | null = null
export function setRuntime(r: ShellRuntime | null): void { current = r }
export function rt(): ShellRuntime {
  if (!current) throw new Error('shell runtime is not ready')
  return current
}
export function hasRuntime(): boolean { return current != null }

/**
 * What the browse page is showing, so「打开」from anywhere on it hands the detail page the result list (previous /
 * next) and the place to return to (web-2 detail/nav.ts).
 */
export interface BrowseContext { list: () => string[]; label: string }
let browse: BrowseContext | null = null
export function setBrowseContext(c: BrowseContext | null): void { browse = c }
export function browseContext(): BrowseContext | null { return browse }

/** `/libraries/<lib>` + path. */
export function libPath(lib: string, path = ''): string { return `/libraries/${encodeURIComponent(lib)}${path}` }
