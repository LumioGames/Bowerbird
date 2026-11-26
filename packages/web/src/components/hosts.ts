import * as React from 'react'

/**
 * Where page pieces go inside the persistent shell (ShellLayout provides them):
 *  - toolbar: the translucent bar spanning the content and the inspector (browse and detail fill it);
 *  - page: the layer over content + inspector for whole pages (issues, trash, tags, settings, review queue).
 * Outside the shell (tests) both are null and the pieces render in place.
 */
export interface ShellHosts { toolbar: HTMLElement | null; page: HTMLElement | null }
export const ShellHostsContext = React.createContext<ShellHosts>({ toolbar: null, page: null })
export function useShellHosts(): ShellHosts { return React.useContext(ShellHostsContext) }
