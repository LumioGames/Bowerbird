import * as React from 'react'
import type { AssetDetail, PluginInfo } from '@bowerbird/schema'
import { ShellContext, type FileSource, type FormatView, type ShellApi, type UiContributions, type ValidatorView, type WebPlugin } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { textOf } from './text'

/**
 * Plugin web modules: loaded dynamically from `GET /api/v1/plugins/{id}/web` for every enabled plugin with a web part
 * (plugin-system.md 生命周期 5). Built-in and third-party plugins load the same way; the shell never imports a plugin.
 * Owner: line web-1 (loading, slot registry, ShellApi provider, render worker). web-2 consumes the hooks.
 */
export interface LoadedWebPlugin { info: PluginInfo; module: WebPlugin }

export interface PluginRegistry {
  plugins: LoadedWebPlugin[]
  ready: boolean
  /** Format view for a format id (from whichever enabled plugin provides it). */
  formatView(format: string): { pluginId: string; view: FormatView } | null
  /** How a validator's check results read (from the plugin that declares the validator id). */
  validatorView?(validator: string): { pluginId: string; view: ValidatorView } | null
  /** All UI contributions with their plugin id. */
  ui: { [K in keyof UiContributions]-?: Array<NonNullable<UiContributions[K]>[number] & { pluginId: string }> }
  /** Plugins whose web module failed to load, with why. */
  failed?: Array<{ id: string; reason: string }>
}

const EMPTY_UI: PluginRegistry['ui'] = { inspectorSections: [], detailTabs: [], toolbarItems: [], sidebarSections: [], pages: [], settingsPages: [] }

export const PluginRegistryContext = React.createContext<PluginRegistry>({
  plugins: [], ready: false, formatView: () => null, validatorView: () => null, ui: EMPTY_UI
})
export function usePluginRegistry(): PluginRegistry { return React.useContext(PluginRegistryContext) }
export function useFormatView(format: string | null | undefined) { const r = usePluginRegistry(); return format ? r.formatView(format) : null }

/** Load one plugin's web module (ES module at a URL). */
export async function loadWebPlugin(info: PluginInfo): Promise<LoadedWebPlugin> {
  const mod = await import(/* @vite-ignore */ api.plugins.webUrl(info.id) + `?v=${encodeURIComponent(info.version ?? '')}`)
  return { info, module: (mod.default ?? mod) as WebPlugin }
}

/**
 * Merge loaded modules into one registry. For a format several plugins can view, the first enabled one in list
 * order wins (the kernel already decided who claims the file; the list comes in the kernel's order).
 * Slot entries keep their plugin id; ids are unique per plugin (`<pluginId>:<id>` when two plugins clash). Slot titles
 * are shown in the shell's language through the plugin's manifest translations (the shell remounts on a language
 * change, so this runs again).
 */
export function mergeRegistry(loaded: readonly LoadedWebPlugin[], ready = true, failed: Array<{ id: string; reason: string }> = []): PluginRegistry {
  const formats = new Map<string, { pluginId: string; view: FormatView }>()
  const validators = new Map<string, { pluginId: string; view: ValidatorView }>()
  const ui: PluginRegistry['ui'] = { inspectorSections: [], detailTabs: [], toolbarItems: [], sidebarSections: [], pages: [], settingsPages: [] }
  for (const p of loaded) {
    const pid = p.info.id
    for (const [fmt, view] of Object.entries(p.module.formats ?? {})) if (!formats.has(fmt)) formats.set(fmt, { pluginId: pid, view })
    for (const [id, view] of Object.entries(p.module.validators ?? {})) if (!validators.has(id)) validators.set(id, { pluginId: pid, view })
    const u = p.module.ui ?? {}
    for (const key of Object.keys(ui) as Array<keyof PluginRegistry['ui']>) {
      const list = (u[key] ?? []) as Array<{ id: string; title?: string }>
      const target = ui[key] as Array<{ id: string; pluginId: string }>
      for (const item of list) {
        const clash = target.some(x => x.id === item.id)
        const title = typeof item.title === 'string' ? { title: textOf(p.info, item.title) } : {}
        target.push({ ...item, ...title, id: clash ? `${pid}:${item.id}` : item.id, pluginId: pid })
      }
    }
  }
  return { plugins: [...loaded], ready, formatView: f => formats.get(f) ?? null, validatorView: v => validators.get(v) ?? null, ui, failed }
}

export type PluginLoader = (info: PluginInfo) => Promise<LoadedWebPlugin>

/** Loads the enabled plugins' web modules once the plugin list is known; failures are isolated per plugin. */
export function PluginRegistryProvider({ plugins, loader = loadWebPlugin, children }: { plugins: PluginInfo[] | undefined; loader?: PluginLoader; children: React.ReactNode }) {
  const [reg, setReg] = React.useState<PluginRegistry>(() => mergeRegistry([], false))
  const key = (plugins ?? []).filter(p => p.status === 'enabled' && p.hasWeb).map(p => `${p.id}@${p.version ?? ''}`).join(',')
  React.useEffect(() => {
    if (!plugins) return
    let alive = true
    const wanted = plugins.filter(p => p.status === 'enabled' && p.hasWeb)
    void Promise.allSettled(wanted.map(p => loader(p))).then(results => {
      if (!alive) return
      const ok: LoadedWebPlugin[] = []
      const failed: Array<{ id: string; reason: string }> = []
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok.push(r.value)
        else { failed.push({ id: wanted[i]!.id, reason: String((r.reason as Error)?.message ?? r.reason) }); console.warn(`[bowerbird] plugin ${wanted[i]!.id} web module failed to load`, r.reason) }
      })
      setReg(mergeRegistry(ok, true, failed))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <PluginRegistryContext.Provider value={reg}>{children}</PluginRegistryContext.Provider>
}

/** FileSource over the HTTP API (current content or a version), resolving slots through relations (ADR-018). */
export function createFileSource(lib: string, asset: AssetDetail, versionHash?: string | null): FileSource {
  const current = !versionHash || versionHash === asset.hash
  const url = current ? api.assets.fileUrl(lib, asset.id) : api.assets.versionFileUrl(lib, asset.id, versionHash!)
  const slots = new Set(asset.relations.outgoing.filter(r => r.slot && !r.broken).map(r => r.slot!))
  const get = async (u: string, signal?: AbortSignal) => { const res = await fetch(u, { signal }); if (!res.ok) throw new Error(`${res.status} ${u}`); return res.arrayBuffer() }
  const n = current ? asset.versions.length : asset.versions.findIndex(v => v.hash === versionHash) + 1
  return {
    url,
    version: current ? null : { n, hash: versionHash! },
    fetch: signal => get(url, signal),
    slotUrl: slot => (slots.has(slot) ? api.assets.slotUrl(lib, asset.id, slot) : null),
    fetchSlot: async (slot, signal) => (slots.has(slot) ? get(api.assets.slotUrl(lib, asset.id, slot), signal) : null),
    bundleUrl: inner => api.assets.bundleFileUrl(lib, asset.id, inner)
  }
}

/** The ShellApi handed to plugin components (ShellContext provider is mounted by ShellLayout). */
export type { ShellApi }

/** Per-plugin storage in this browser (`bowerbird.plugin.<id>.<key>`). */
export function pluginStorage(pluginId: string): ShellApi['storage'] {
  const k = (key: string) => `bowerbird.plugin.${pluginId}.${key}`
  return {
    get<T>(key: string): T | undefined { try { const v = localStorage.getItem(k(key)); return v == null ? undefined : (JSON.parse(v) as T) } catch { return undefined } },
    set(key: string, value: unknown) { try { localStorage.setItem(k(key), JSON.stringify(value)) } catch { /* private mode */ } }
  }
}

/** Error boundary around one plugin's component: a crash shows the reason, the shell keeps working. */
export class PluginErrorBoundary extends React.Component<{ pluginId: string; fallback?: (error: Error) => React.ReactNode; children: React.ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  override componentDidCatch(error: Error) { console.error(`[bowerbird] plugin ${this.props.pluginId} crashed`, error) }
  override render() {
    if (this.state.error) {
      return this.props.fallback?.(this.state.error) ?? (
        <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12px] leading-4 text-ink-1">
          <b className="font-mono">{this.props.pluginId}</b> · {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Render a plugin component inside its own ShellContext (storage namespaced to the plugin) and error boundary.
 * web-2 uses it for detail tabs and viewers; the shell for inspector sections, tool bar items, side bar sections,
 * pages and settings pages.
 */
export function PluginSlot<P extends object>({ pluginId, component: C, props, fallback }: { pluginId: string; component: React.ComponentType<P>; props: P; fallback?: (error: Error) => React.ReactNode }) {
  const base = React.useContext(ShellContext)
  const value = React.useMemo(() => (base ? { ...base, storage: pluginStorage(pluginId) } : null), [base, pluginId])
  return (
    <PluginErrorBoundary pluginId={pluginId} fallback={fallback}>
      <ShellContext.Provider value={value}>
        <C {...props} />
      </ShellContext.Provider>
    </PluginErrorBoundary>
  )
}
