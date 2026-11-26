import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import type { FolderNode, LibraryInfo, SmartView } from '@bowerbird/schema'
import {
  Button, ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger
} from '@bowerbird/plugin-sdk/web'
import { Row, RowRoleContext, SectionLabel, useTreeKeys } from '../components/blocks'
import { Icon } from '../components/Icon'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { fmtInt } from '../lib/format'
import { kbd } from '../lib/platform'
import { MenuEntries, type MenuEntry } from '../overlays/menu'
import { toast } from '../overlays/toast'
import { usePluginRegistry, PluginSlot } from '../plugins/registry'
import { bundleFolder, deleteSmart, newFolder, renameFolder, renameSmart, saveSmart, scanFolder, trashFolder, updateSmart } from '../flows/folders'
import { revealLibrary, switchLibraryDialog } from '../flows/library'
import { moveAssets } from '../flows/actions'
import { hasConditions, paramsFromState, smartQueryOf, stateFromParams, stateFromSmart, chipsOf } from '../browse/query'
import { libPath } from './runtime'
import { DRAG_TYPE } from './drag'
import { TasksRing, tasksLabel, useTasksState } from './TasksRing'

/**
 * Side bar (web-shell.md 左栏, pages.md 外壳): the library menu, the five views with counts (「有问题」counts the
 * same way as the integrity page and flashes when it changes), smart folders, the real folder tree (display name,
 * icon, note; drag assets onto a folder to move them), plugin sections, and the footer「设置」「标签」「任务」.
 */
const BUILTIN = [
  { id: 'all', icon: 'inbox' },
  { id: 'untagged', icon: 'tag' },
  { id: 'pending', icon: 'clock' },
  { id: 'issues', icon: 'triangle-alert' },
  { id: 'trash', icon: 'trash-2' }
] as const

const OPEN_KEY = 'bowerbird.openFolders'
function readOpen(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]) } catch { return new Set() } }

export function Sidebar({ lib, info, onFolderInfo }: { lib: string; info: LibraryInfo | undefined; onFolderInfo: () => void }) {
  const loc = useLocation()
  const navigate = useNavigate()
  const go = React.useCallback((p: string) => navigate(p), [navigate])
  const tasks = useTasksState(lib)
  const sp = new URLSearchParams(loc.search)
  const onBrowse = loc.pathname.replace(/\/+$/, '') === libPath(lib)
  const page = loc.pathname.slice(libPath(lib).length).split('/')[1] ?? ''
  const curFolder = onBrowse ? sp.get('folder') : null
  const curSmart = onBrowse ? sp.get('smart') : null
  const curView = onBrowse && curFolder == null && !curSmart ? sp.get('view') ?? 'all' : page === 'issues' ? 'issues' : page === 'trash' ? 'trash' : null

  const folders = useQuery({ queryKey: qk.folders(lib), queryFn: () => api.folders.tree(lib) })
  const views = useQuery({ queryKey: qk.views(lib), queryFn: () => api.views.list(lib) })
  const reg = usePluginRegistry()
  const smart = (views.data?.views ?? []).filter(v => !v.builtin)

  const [open, setOpen] = React.useState(readOpen)
  const toggle = (p: string) => setOpen(o => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); try { localStorage.setItem(OPEN_KEY, JSON.stringify([...n])) } catch { /* ignore */ } return n })
  React.useEffect(() => {
    if (!curFolder) return
    const parts = curFolder.split('/')
    setOpen(o => { const n = new Set(o); for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join('/')); return n.size === o.size ? o : n })
  }, [curFolder])

  // 「有问题」flashes when its number changes.
  // Same count as the integrity page header (「N 个资产」, every level), E-09.
  const issues = info?.stats.issueAssets
  const prevIssues = React.useRef(issues)
  const [pulse, setPulse] = React.useState(0)
  React.useEffect(() => { if (prevIssues.current != null && issues != null && issues !== prevIssues.current) setPulse(p => p + 1); prevIssues.current = issues }, [issues])

  const browse = (params: Record<string, string>) => go(libPath(lib, Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : ''))
  const openView = (id: string) => {
    if (id === 'issues') return go(libPath(lib, '/issues'))
    if (id === 'trash') return go(libPath(lib, '/trash'))
    browse(id === 'all' ? {} : { view: id })
  }
  const curState = onBrowse ? stateFromParams(sp) : null
  const hasCond = !!curState && hasConditions(curState)
  const suggestedName = curState ? [...chipsOf(curState).map(c => c.value), curState.text.trim()].filter(Boolean).join(' · ') : ''

  const dragOver = (path: string) => (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDrop(path) } }
  const [drop, setDrop] = React.useState<string | null>(null)
  const onDrop = (path: string) => (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    setDrop(null)
    if (!raw) return
    e.preventDefault()
    void moveAssets(raw.split(','), path)
  }

  const folderMenu = (n: FolderNode, siblings: string[]): MenuEntry[] => [
    { id: 'info', icon: 'info', label: t('folder.info'), onSelect: () => { browse({ folder: n.path }); onFolderInfo() } },
    { id: 'sub', icon: 'folder-plus', label: t('folder.newSub'), onSelect: () => void newFolder(n) },
    { id: 'rename', icon: 'pencil', label: t('folder.rename'), onSelect: () => void renameFolder(n, siblings) },
    { id: 'bundle', icon: 'package', label: t('folder.bundle'), disabled: !n.path.includes('/') || !!n.isBundle, onSelect: () => void bundleFolder(n) },
    { id: 'scan', icon: 'refresh-cw', label: t('folder.scan'), onSelect: () => void scanFolder(n.path) },
    'sep',
    { id: 'trash', icon: 'trash-2', label: t('folder.trash'), danger: true, onSelect: () => void trashFolder(n) }
  ]

  const smartMenu = (v: SmartView): MenuEntry[] => [
    { id: 'rename', icon: 'pencil', label: t('smart.rename'), onSelect: () => void renameSmart(v, smart) },
    { id: 'edit', icon: 'list-filter', label: t('smart.edit'), onSelect: () => { const s = stateFromSmart(v); go(libPath(lib, '?' + paramsFromState(s).toString())) } },
    { id: 'update', icon: 'refresh-cw', label: t('smart.update'), disabled: !hasCond, hint: hasCond ? undefined : t('smart.updateHint'), onSelect: () => curState && void updateSmart(v, smartQueryOf(curState, smart.find(s => s.name === curSmart))) },
    'sep',
    { id: 'delete', icon: 'trash-2', label: t('smart.delete'), danger: true, onSelect: () => void deleteSmart(v) }
  ]

  const renderFolder = (n: FolderNode, depth: number, siblings: string[]): React.ReactNode => {
    const isOpen = open.has(n.path)
    const kids = n.children
    return (
      <React.Fragment key={n.path}>
        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild>
            <Row
              icon={n.icon || (n.isBundle ? 'package' : isOpen && kids.length ? 'folder-open' : 'folder')}
              label={n.name}
              sub={n.label}
              title={n.description || undefined}
              count={fmtInt(n.count)}
              depth={depth}
              toggle={kids.length > 0}
              expanded={isOpen}
              onToggle={() => toggle(n.path)}
              selected={curFolder === n.path}
              drop={drop === n.path}
              onClick={() => browse({ folder: n.path })}
              onDragOver={dragOver(n.path)}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(d => (d === n.path ? null : d)) }}
              onDrop={onDrop(n.path)}
              data-folder={n.path}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <MenuEntries kind="context" entries={folderMenu(n, siblings)} close={() => {}} />
          </ContextMenuContent>
        </ContextMenu>
        {isOpen && kids.map(c => renderFolder(c, depth + 1, kids.map(k => k.name)))}
      </React.Fragment>
    )
  }

  const counts = info?.counts
  const tops = folders.data?.root.children ?? []
  // three trees (views, smart folders, folders), each with roving focus and the tree keys
  const viewKeys = useTreeKeys<HTMLDivElement>()
  const smartKeys = useTreeKeys<HTMLDivElement>()
  const folderKeys = useTreeKeys<HTMLDivElement>()
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2 bb-scroll-thin">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <div role="button" tabIndex={0} title={t('side.library')}
              className="mb-1 flex h-9 cursor-default items-center gap-2 rounded-sm px-2 text-ink-1 outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-accent-ring data-[state=open]:bg-fill-hover">
              <Icon name="hard-drive" className="shrink-0 text-ink-2" />
              <b className="min-w-0 truncate font-semibold">{info?.name ?? ''}</b>
              <Icon name="chevron-down" size={12} className="shrink-0 text-ink-3" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <MenuEntries kind="dropdown" close={() => {}} entries={[
              { header: info?.name ?? '' },
              { id: 'settings', icon: 'settings', label: t('lib.settings'), onSelect: () => go(libPath(lib, '/settings/library')) },
              ...(info?.isLocal ? [{ id: 'reveal', icon: 'folder-search', label: t('lib.reveal'), onSelect: () => void revealLibrary(info) }] : []),
              'sep',
              { id: 'switch', icon: 'hard-drive', label: t('lib.switch'), onSelect: () => void switchLibraryDialog(lib, go) }
            ]} />
          </DropdownMenuContent>
        </DropdownMenu>
        <RowRoleContext.Provider value="treeitem">
        <div role="tree" aria-label={t('side.views')} {...viewKeys}>
          {BUILTIN.map(v => (
            <Row key={v.id + (v.id === 'issues' ? pulse : '')} icon={v.icon} label={t('view.' + v.id)} pulse={v.id === 'issues' && pulse > 0}
              count={counts ? fmtInt(v.id === 'issues' ? info!.stats.issueAssets : counts[v.id]) : undefined} selected={curView === v.id} onClick={() => openView(v.id)} data-view={v.id} />
          ))}
        </div>
          <SectionLabel action={
            <Button variant="ghost" size="icon-sm" aria-label={t('side.saveSmart')} title={t('side.saveSmart')}
              onClick={() => { if (!curState || !hasCond) { toast({ title: t('smart.needCond') }); return } void saveSmart(smartQueryOf(curState, smart.find(s => s.name === curSmart)), suggestedName, smart) }}>
              <Icon name="plus" size={12} />
            </Button>
          }>{t('side.smart')}</SectionLabel>
          <div role="tree" aria-label={t('side.smart')} {...smartKeys}>
          {smart.map(v => (
            <ContextMenu key={v.name} modal={false}>
              <ContextMenuTrigger asChild>
                <Row icon="folder-search" label={v.name} count={fmtInt(v.count)} selected={curSmart === v.name} onClick={() => browse({ smart: v.name })} data-smart={v.name} />
              </ContextMenuTrigger>
              <ContextMenuContent><MenuEntries kind="context" entries={smartMenu(v)} close={() => {}} /></ContextMenuContent>
            </ContextMenu>
          ))}
          </div>
          <SectionLabel action={
            <Button variant="ghost" size="icon-sm" aria-label={t('side.newFolder')} title={t('side.newFolder')}
              onClick={() => void newFolder(curFolder ? (findNode(folders.data?.root, curFolder) ?? folders.data?.root ?? null) : folders.data?.root ?? null)}>
              <Icon name="plus" size={12} />
            </Button>
          }>{t('side.folders')}</SectionLabel>
          <div role="tree" aria-label={t('side.folders')} {...folderKeys}>
            {tops.map(n => renderFolder(n, 0, tops.map(x => x.name)))}
          </div>
        </RowRoleContext.Provider>
        {reg.ui.sidebarSections.map(s => (
          <div key={s.pluginId + s.id}>
            <SectionLabel>{s.title}</SectionLabel>
            <PluginSlot pluginId={s.pluginId} component={s.Component} props={{}} />
          </div>
        ))}
      </div>
      {/* Icons only (product decision 2026-11-26): settings bottom-left; tags and the tasks ring on the right.
          Names (and the tasks state) live in title / aria-label. */}
      <div className="flex h-11 shrink-0 items-center gap-1 px-2 shadow-[inset_0_1px_0_var(--line-hairline)]" data-testid="side-footer">
        <Button variant="ghost" size="icon" aria-label={t('side.settings')} title={`${t('side.settings')} ${kbd('mod+,')}`} onClick={() => go(libPath(lib, '/settings'))}><Icon name="settings" /></Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={t('side.tags')} title={t('side.tags')} onClick={() => go(libPath(lib, '/tags'))}><Icon name="tags" /></Button>
          <Button variant="ghost" size="icon" aria-label={tasksLabel(tasks)} title={tasksLabel(tasks)} data-testid="side-tasks" onClick={() => go(libPath(lib, '/settings/tasks'))}><TasksRing state={tasks} /></Button>
        </div>
      </div>
    </div>
  )
}

function findNode(root: FolderNode | undefined, path: string): FolderNode | null {
  if (!root) return null
  if (root.path === path) return root
  for (const c of root.children) { const f = findNode(c, path); if (f) return f }
  return null
}
