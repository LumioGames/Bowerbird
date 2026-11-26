import * as React from 'react'
import type { JobInfo, LibraryInfo } from '@bowerbird/schema'
import type { ShellApi, ShellRoute } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { displayActor } from '../lib/actor'
import { getLocale } from '../lib/i18n'
import { onLibraryEvent } from '../lib/events'
import { toast } from '../overlays/toast'
import { confirm } from '../overlays/dialogs'
import { pickAsset } from '../shell/picker'
import { createFileSource, pluginStorage } from './registry'
import { libPath } from '../shell/runtime'

/** Public detail tab names (plugin-sdk ShellRoute) → the detail page's own ids; short ids pass through. */
const TAB_IDS: Record<string, string> = { relations: 'rel', versions: 'ver', review: 'rev' }
export function detailTabId(tab: string | undefined): string | undefined { return tab ? TAB_IDS[tab] ?? tab : tab }

/** Where a ShellRoute leads (web-shell.md 页面清单; compare keeps `?a=&b=&av=&bv=`). */
export function routePath(lib: string, r: ShellRoute): string {
  const qs = (o: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(o)) if (v != null && v !== '') sp.set(k, v)
    const s = sp.toString()
    return s ? '?' + s : ''
  }
  switch (r.to) {
    case 'browse': return libPath(lib, qs({ folder: r.folder, view: r.view, q: r.query }))
    case 'asset': return libPath(lib, `/asset/${encodeURIComponent(r.id)}${qs({ tab: detailTabId(r.tab) })}`)
    case 'compare': return libPath(lib, `/compare${qs({ a: r.left, b: r.right, av: r.leftVersion, bv: r.rightVersion })}`)
    case 'plugin-page': return libPath(lib, `/plugins/${encodeURIComponent(r.plugin)}/${encodeURIComponent(r.page)}${qs(r.params ?? {})}`)
    case 'settings': return libPath(lib, r.section ? `/settings/${encodeURIComponent(r.section)}` : '/settings')
  }
}

/** Build the ShellApi plugins read through `useShell()`. */
export function useShellApiValue(lib: string, info: LibraryInfo | undefined, theme: 'dark' | 'light', go: (path: string) => void): ShellApi {
  return React.useMemo<ShellApi>(() => ({
    library: {
      id: info?.id ?? lib,
      name: info?.name ?? lib,
      isLocal: info?.isLocal ?? false,
      versionStore: info?.versionStore ?? null,
      hasCreators: info?.hasCreators ?? false
    },
    api,
    get actor() { return displayActor() },
    theme,
    get locale() { return getLocale() },
    storage: pluginStorage('shell'),
    toast,
    confirm,
    navigate: route => go(routePath(lib, route)),
    pickAsset: o => pickAsset(o ?? {}),
    fileSource: (asset, versionHash) => createFileSource(lib, asset, versionHash),
    onJob: (handler: (job: JobInfo) => void) => onLibraryEvent((type, data) => { if (type === 'job.updated') handler(data as JobInfo) })
  }), [lib, info, theme, go])
}
