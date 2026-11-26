import * as React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { JobInfo } from '@bowerbird/schema'
import { cn, ShellContext, Toaster, TooltipProvider } from '@bowerbird/plugin-sdk/web'
import { useLibraryId, rememberLibrary } from '../lib/library'
import { api, BowerbirdApiError } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { useLibraryEvents, onLibraryEvent } from '../lib/events'
import { useResolvedTheme } from '../lib/theme'
import { getPrefs, setPrefs, usePrefs } from '../lib/prefs'
import { INSPECTOR_STATE, INSPECTOR_TOGGLE } from '../pages/shared/bridge'
import { useShortcut } from '../lib/shortcuts'
import { undoLast } from '../lib/undo'
import { ShellHostsContext } from '../components/hosts'
import { EmptyState } from '../components/EmptyState'
import { DialogHost } from '../overlays/dialogs'
import { QuickLookHost } from '../overlays/quicklook'
import { toast, toastError } from '../overlays/toast'
import { Inspector } from '../inspector/Inspector'
import { PluginRegistryProvider, usePluginRegistry } from '../plugins/registry'
import { useShellApiValue } from '../plugins/shell-api'
import { pluginText, setPluginTexts } from '../plugins/text'
import { useRenderWorker } from '../plugins/render-worker'
import { UploadPanel } from '../flows/upload'
import { ClaimPanel, firstOpenFlow } from '../flows/library'
import { Sidebar } from './Sidebar'
import { libPath, setRuntime } from './runtime'
import { createScanFindings, createScanSummary } from './scan-findings'
import { registering } from '../flows/library'
import { findSummary } from '../flows/cache'
import { Button } from '@bowerbird/plugin-sdk/web'
import './shell.css'

/**
 * Persistent frame for `/libraries/:lib/*`: side bar, tool bar slot, content outlet, inspector, overlays
 * (toasts, dialogs, context menus, quick look), SSE subscription, render worker, keyboard shortcuts.
 * Three columns (design-system Shell): side bar and inspector can be dragged wider (232 / 320 px by default,
 * at least 180 / 280) and folded away (⌘\ / ⌘I). The tool bar spans content and inspector; content scrolls under it.
 */
const LIMITS = { side: [180, 360], insp: [280, 480] } as const

function rubber(over: number, dim: number, c = 0.55): number { return (over * dim * c) / (dim + c * Math.abs(over)) }

export function ShellLayout() {
  const lib = useLibraryId()
  const navigate = useNavigate()
  const loc = useLocation()
  const qc = useQueryClient()
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib), retry: (n, e) => !(e instanceof BowerbirdApiError && e.code === 'not_found') && n < 2 })
  const plugins = useQuery({ queryKey: qk.plugins(), queryFn: () => api.plugins.list() })
  // plugin text in the shell's language needs the plugins' translations before anything below renders
  setPluginTexts(plugins.data?.plugins)
  React.useEffect(() => { rememberLibrary(lib) }, [lib])
  useLibraryEvents(lib)

  const go = React.useCallback((path: string, opts?: { replace?: boolean }) => navigate(path, opts), [navigate])
  const search = React.useRef(loc.search)
  search.current = loc.search
  const onBrowse = loc.pathname.replace(/\/+$/, '') === libPath(lib)
  setRuntime({
    lib, info: info.data, qc, go, navigate,
    currentFolder: () => (onBrowse ? new URLSearchParams(search.current).get('folder') ?? '' : null)
  })

  // A folder with files that is not a library yet: explain, then register (ADR-033).
  const asked = React.useRef<string | null>(null)
  React.useEffect(() => {
    const d = info.data
    if (d && d.state === 'uninitialized' && d.firstOpen && asked.current !== d.id) { asked.current = d.id; void firstOpenFlow(d) }
  }, [info.data])

  if (info.isError && info.error instanceof BowerbirdApiError && info.error.code === 'not_found') {
    return <div className="grid h-full place-items-center"><EmptyState icon="hard-drive" title={t('lib.unavailable')} action={<Button variant="primary" onClick={() => navigate('/')}>{t('common.ok')}</Button>} /></div>
  }
  return (
    <PluginRegistryProvider plugins={plugins.data?.plugins}>
      <Frame lib={lib} />
    </PluginRegistryProvider>
  )
}

function Frame({ lib }: { lib: string }) {
  const navigate = useNavigate()
  const loc = useLocation()
  const qc = useQueryClient()
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
  const registry = usePluginRegistry()
  useRenderWorker(lib, registry)
  const theme = useResolvedTheme()
  const go = React.useCallback((path: string) => navigate(path), [navigate])
  const shellApi = useShellApiValue(lib, info.data, theme, go)
  const prefs = usePrefs()
  const [toolbarEl, setToolbarEl] = React.useState<HTMLElement | null>(null)
  const [pageEl, setPageEl] = React.useState<HTMLElement | null>(null)
  const hosts = React.useMemo(() => ({ toolbar: toolbarEl, page: pageEl }), [toolbarEl, pageEl])
  const [uploadH, setUploadH] = React.useState(0)
  const inViewer = /\/(asset\/[^/]+|compare)\/?$/.test(loc.pathname)
  // Whole pages (compare, review queue, integrity, trash, tags, settings, plugin pages) cover the browse area and
  // hide the inspector; the detail page keeps it.
  const rest = loc.pathname.slice(libPath(lib).length)
  const fullPage = /^\/(compare|review|issues|trash|tags|settings|plugins)(\/|$)/.test(rest)

  /* panel widths: 1:1 with the pointer, rubber-band past the limits, snap back on release */
  const [live, setLive] = React.useState<{ side: number; insp: number } | null>(null)
  const sideW = prefs.sideClosed ? 0 : live?.side ?? prefs.sideWidth
  const inspW = prefs.inspClosed || fullPage ? 0 : live?.insp ?? prefs.inspWidth
  const resizer = (edge: 'side' | 'insp') => (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX, base = edge === 'side' ? prefs.sideWidth : prefs.inspWidth
    const [lo, hi] = LIMITS[edge]
    let w = base
    const move = (ev: PointerEvent) => {
      w = base + (edge === 'side' ? 1 : -1) * (ev.clientX - x0)
      const shown = w < lo ? lo + rubber(w - lo, 240) : w > hi ? hi + rubber(w - hi, 240) : w
      setLive({ side: edge === 'side' ? shown : prefs.sideWidth, insp: edge === 'insp' ? shown : prefs.inspWidth })
    }
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      setLive(null)
      setPrefs(edge === 'side' ? { sideWidth: Math.round(Math.min(hi, Math.max(lo, w))) } : { inspWidth: Math.round(Math.min(hi, Math.max(lo, w))) })
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }

  /* page-wide shortcuts (copy.md 快捷键) */
  useShortcut('mod+\\', () => setPrefs({ sideClosed: !prefs.sideClosed }), { inInput: true })
  useShortcut('mod+i', () => setPrefs({ inspClosed: !prefs.inspClosed }), { inInput: true })
  /* the detail page's「检查器」button talks to the shell through window events (web-2 pages/shared/bridge.ts) */
  React.useEffect(() => {
    const on = () => setPrefs({ inspClosed: !getPrefs().inspClosed })
    window.addEventListener(INSPECTOR_TOGGLE, on)
    return () => window.removeEventListener(INSPECTOR_TOGGLE, on)
  }, [])
  React.useEffect(() => { window.dispatchEvent(new CustomEvent(INSPECTOR_STATE, { detail: { open: !prefs.inspClosed } })) }, [prefs.inspClosed])
  useShortcut('mod+,', () => { void navigate(libPath(lib, '/settings')) }, { inInput: true })
  useShortcut('mod+z', () => { undoLast().then(e => { if (!e) toast({ title: t('undo.nothing') }) }, err => toastError(err)) })

  /* creation jobs report back on toasts: a follow-up (「挑选…」, ADR-042) or a failure */
  React.useEffect(() => {
    const seen = new Set<string>()
    return onLibraryEvent((type, data) => {
      if (type !== 'job.updated') return
      const j = data as JobInfo
      if (j.kind !== 'create') return
      const key = `${j.id}:${j.status}:${j.action?.label ?? ''}`
      if (seen.has(key)) return
      if (j.action && j.pluginId) {
        seen.add(key)
        const qs = new URLSearchParams(j.action.params ?? {}).toString()
        toast({ title: pluginText(j.pluginId, j.message ?? j.creatorName ?? ''), action: { label: pluginText(j.pluginId, j.action.label), onClick: () => navigate(libPath(lib, `/plugins/${encodeURIComponent(j.pluginId!)}/${encodeURIComponent(j.action!.page)}${qs ? '?' + qs : ''}`)) } })
      } else if (j.status === 'failed') {
        seen.add(key)
        toast({ title: `${pluginText(j.pluginId, j.creatorName) ?? j.pluginId ?? ''}：${pluginText(j.pluginId, j.error) ?? ''}`, kind: 'error', action: { label: t('common.view'), onClick: () => navigate(libPath(lib, '/settings/tasks')) } })
      } else if (j.status === 'done' && j.outputs.length) {
        seen.add(key)
        void qc.invalidateQueries({ queryKey: ['lib', lib, 'browse'] })
      }
    })
  }, [lib, navigate, qc])

  /* a scan noticed files deleted outside Bowerbird: 「扫描发现 {名称} 不见了」· 查看 (copy.md 完整性) */
  React.useEffect(() => {
    const f = createScanFindings({
      nameOf: id => findSummary(qc, lib, id)?.name ?? api.assets.get(lib, id).then(a => a.name),
      show: names => toast({
        title: names.length === 1 ? t('scan.gone', { name: names[0]! }) : t('scan.goneN', { n: names.length }),
        action: { label: t('common.view'), onClick: () => navigate(libPath(lib, '/issues')) }
      })
    })
    const off = onLibraryEvent(f.handle)
    // the end of a scan: what it found (ADR-040)
    const summary = createScanSummary({
      quiet: () => registering(lib),
      show: r => {
        const parts = [t('scan.done'), ...(r.added ? [t('scan.added', { n: r.added })] : []), ...(r.issues ? [t('scan.issues', { n: r.issues })] : [])]
        toast({
          title: r.added || r.issues ? parts.join(' · ') : t('scan.unchanged'),
          ...(r.issues ? { action: { label: t('common.view'), onClick: () => navigate(libPath(lib, '/issues')) } } : {})
        })
      }
    })
    const off2 = onLibraryEvent(summary.handle)
    return () => { off(); off2(); f.dispose() }
  }, [lib, navigate, qc])

  const cols = `${sideW}px minmax(0,1fr) ${inspW}px`
  // The frame and its panels clip (overflow: clip), they do not hide: a hidden overflow can still be scrolled, and
  // focus landing on something cut off at the edge (a dialog handing focus back to its button) slid the whole page
  // sideways. Scrolling happens only in the scroll areas inside.
  return (
    <ShellContext.Provider value={shellApi}>
      <ShellHostsContext.Provider value={hosts}>
        <TooltipProvider>
          <div
            data-resizing={live ? '' : undefined}
            className={cn('relative grid h-full min-h-0 overflow-clip bg-surface-canvas text-ink-1', !live && 'transition-[grid-template-columns] duration-settle ease-settle')}
            style={{ gridTemplateColumns: cols, ['--bb-side-w' as string]: `${sideW}px`, ['--bb-insp-w' as string]: `${inspW}px` }}
          >
            <aside aria-label={t('side.nav')} className="relative min-h-0 min-w-0 overflow-clip bg-surface-panel shadow-[inset_-1px_0_0_var(--line-hairline)]">
              <div className="h-full min-w-[180px]">
                <Sidebar lib={lib} info={info.data} onFolderInfo={() => setPrefs({ inspClosed: false })} />
              </div>
            </aside>
            <main className="relative min-h-0 min-w-0 overflow-clip">
              <Outlet />
            </main>
            <aside aria-label={t('insp.label')} className="relative min-h-0 min-w-0 overflow-clip bg-surface-panel shadow-[inset_1px_0_0_var(--line-hairline)]">
              <div className="h-full min-w-[280px] overflow-x-hidden overflow-y-auto pt-12 bb-scroll-thin">
                <Inspector />
              </div>
            </aside>
            {/* the tool bar spans content and inspector; pages fill it */}
            <div ref={setToolbarEl} className={cn('bb-chrome bb-chrome-fade absolute top-0 right-0 z-[5] h-12 empty:hidden', !live && 'transition-[left] duration-settle ease-settle')} style={{ left: sideW }} />
            {/* whole pages cover content and inspector */}
            <div ref={setPageEl} className={cn('pointer-events-none absolute top-0 right-0 bottom-0 z-[6]', !live && 'transition-[left] duration-settle ease-settle')} style={{ left: sideW }} />
            {!prefs.sideClosed && (
              <div role="separator" aria-label={t('side.resize')} onPointerDown={resizer('side')}
                className="group/rs absolute top-0 bottom-0 z-[7] w-2 cursor-col-resize touch-none" style={{ left: sideW - 4 }}>
                <span className={cn('absolute top-0 bottom-0 left-[3px] w-0.5 bg-accent-ring opacity-0 transition-opacity duration-fade group-hover/rs:opacity-100', live && 'opacity-100')} />
              </div>
            )}
            {!prefs.inspClosed && !fullPage && (
              <div role="separator" aria-label={t('insp.resize')} onPointerDown={resizer('insp')}
                className="group/rs absolute top-0 bottom-0 z-[7] w-2 cursor-col-resize touch-none" style={{ right: inspW - 4 }}>
                <span className={cn('absolute top-0 bottom-0 left-[3px] w-0.5 bg-accent-ring opacity-0 transition-opacity duration-fade group-hover/rs:opacity-100', live && 'opacity-100')} />
              </div>
            )}
          </div>
          <DialogHost />
          <QuickLookHost />
          <UploadPanel onHeight={setUploadH} />
          <ClaimPanel go={p => navigate(p)} />
          {/* toasts: bottom right; above the upload panel; above a viewer's timeline and controls (E-28) */}
          <Toaster theme={theme} offset={{ right: 16, bottom: uploadH ? uploadH + 28 : inViewer ? 84 : 16 }} />
        </TooltipProvider>
      </ShellHostsContext.Provider>
    </ShellContext.Provider>
  )
}
