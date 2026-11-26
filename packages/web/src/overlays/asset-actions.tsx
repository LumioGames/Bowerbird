import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { STAGES, type ActionInfo, type AssetSummary, type CreatorInfo, type Stage } from '@bowerbird/schema'
import { Button, ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { isMac, kbd } from '../lib/platform'
import { stageLabel } from '../lib/format'
import { useLibraryId } from '../lib/library'
import { Icon } from '../components/Icon'
import { StageMark } from '../components/marks'
import { MenuEntries, type MenuEntry } from './menu'
import { findSummaries } from '../flows/cache'
import * as A from '../flows/actions'
import { exportDialog } from '../flows/export'
import { openRelationDialog } from '../graph/RelationDialog'
import { rt } from '../shell/runtime'
import { actionsFor, creatorFits, hasParams, runPluginAction, startCreator } from '../flows/creators'
import { pluginText } from '../plugins/text'

/**
 * The asset action set — same names, icons and order everywhere (copy.md「操作名称表」):
 * right-click menu in the grid, the detail page「更多操作」, the relation graph.
 * Owner: line web-1. web-2 renders `<AssetActionsMenu>` in the detail toolbar and wraps graph nodes in
 * `<AssetContextMenu>`.
 */
export interface AssetActionsProps {
  /** Selected asset ids (one or many). */
  ids: string[]
  /** Where the menu is shown (changes a few items, e.g. 打开 is hidden on the detail page of that asset). */
  context?: 'grid' | 'detail' | 'graph'
}

export interface AssetMenuInput {
  assets: AssetSummary[]
  /** The page runs on the computer Bowerbird runs on (ADR-023): local actions instead of「下载源文件」. */
  isLocal: boolean
  context: 'grid' | 'detail' | 'graph'
  creators: CreatorInfo[]
  /** Plugin actions that apply to this selection (GET /actions), after the table's items, before 移入回收站. */
  actions?: ActionInfo[]
  mac?: boolean
}

/** The entries, in the fixed order of copy.md. `run(id)` performs an entry. Pure: no side effects until chosen. */
export function assetMenuEntries(i: AssetMenuInput, run: (id: string) => void): MenuEntry[] {
  const as = i.assets
  const a = as[0]
  if (!a) return []
  const many = as.length > 1
  const gone = as.some(x => x.flags.includes('missing'))
  const sameStage = as.every(x => x.stage === a.stage)
  const mac = i.mac ?? isMac
  const k = (spec: string) => kbd(spec, mac)
  const item = (id: string, icon: string, label: string, o: Partial<Extract<MenuEntry, { id: string }>> = {}): MenuEntry => ({ id, icon, label, onSelect: () => run(id), ...o })
  const fitting = i.creators.filter(c => creatorFits(c, as))
  return [
    ...(many ? [{ header: t('act.selected', { n: as.length }) }] : []),
    ...(i.context === 'detail' ? [] : [item('open', 'maximize-2', t('act.open'), { kbd: mac ? '↵' : 'Enter', disabled: many })]),
    item('quicklook', 'eye', t('act.quicklook'), { kbd: t('common.space') }),
    item('compare', 'git-compare-arrows', t('act.compare'), { disabled: as.length !== 2 }),
    'sep',
    ...fitting.map(c => item(`creator:${c.id}`, 'sparkles', `${pluginText(c.pluginId, c.displayName)}…`, { hint: pluginText(c.pluginId, c.pluginName) })),
    'sep',
    ...(i.isLocal
      ? [
          item('openDefault', 'external-link', t('act.openDefault'), { kbd: k('mod+O'), disabled: many || gone }),
          item('reveal', 'folder-search', t('act.reveal'), { kbd: k('alt+mod+R'), disabled: gone })
        ]
      : [item('download', 'download', t('act.download'), { disabled: gone })]),
    'sep',
    {
      id: 'stage', icon: 'layers', label: t('act.stage'), hint: sameStage ? t('stage.short.' + a.stage) : t('common.mixed'),
      sub: STAGES.map(s => ({ id: `stage:${s}`, label: <StageMark stage={s} label="long" />, check: sameStage && a.stage === s, onSelect: () => run(`stage:${s}`) }))
    },
    'sep',
    item('copy', 'copy', t('act.copy'), { kbd: k('mod+D'), disabled: many }),
    item('move', 'folder-input', t('act.move')),
    item('rename', 'pencil', t('act.rename'), { disabled: many }),
    item('replace', 'file-up', t('act.replace'), { disabled: many || gone }),
    item('relate', 'link', t('act.relate'), { disabled: many }),
    item('export', 'package', t('act.export')),
    'sep',
    ...(i.actions ?? []).map(x => { const title = pluginText(x.pluginId, x.title); return item(`action:${x.id}`, 'puzzle', hasParams(x) ? `${title}…` : title, { hint: pluginText(x.pluginId, x.pluginName) }) }),
    'sep',
    item('trash', 'trash-2', t('act.trash'), { kbd: mac ? '⌫' : 'Delete', danger: true })
  ]
}

/** Perform a menu entry on these assets (also used by the keyboard and the detail page). */
export function runAssetAction(id: string, assets: AssetSummary[], creators: CreatorInfo[] = [], actions: ActionInfo[] = []): void {
  const ids = assets.map(a => a.id)
  const a = assets[0]
  if (!a) return
  if (id.startsWith('stage:')) { void A.setStage(ids, id.slice(6) as Stage); return }
  if (id.startsWith('action:')) { const x = actions.find(y => y.id === id.slice(7)); if (x) void runPluginAction(x, ids); return }
  if (id.startsWith('creator:')) { const c = creators.find(x => x.id === id.slice(8)); if (c) void startCreator(c, assets); return }
  switch (id) {
    case 'open': A.openAsset(a.id); break
    case 'quicklook': A.quickLook(ids, 0); break
    case 'compare': if (ids.length === 2) A.compareAssets(ids[0]!, ids[1]!); break
    case 'openDefault': void A.openWithDefault(a.id); break
    case 'reveal': void A.revealInFolder(ids); break
    case 'download': A.downloadSources(ids); break
    case 'copy': void A.copyAsset(a.id); break
    case 'move': void A.moveDialog(ids); break
    case 'rename': A.requestRename(a.id); break
    case 'replace': void A.replaceContent(a.id); break
    case 'relate': void openRelationDialog(rt().lib, a); break
    case 'export': void exportDialog(ids); break
    case 'trash': void A.trashAssets(ids); break
  }
}

/** Summaries for ids: from the cache, else fetched. */
function useAssets(ids: string[]): AssetSummary[] {
  const lib = useLibraryId()
  const qc = useQueryClient()
  const cached = findSummaries(qc, lib, ids)
  const missing = ids.filter(id => !cached.some(a => a.id === id))
  const fetched = useQuery({ queryKey: ['lib', lib, 'menu-assets', missing], queryFn: () => Promise.all(missing.map(id => api.assets.get(lib, id))), enabled: missing.length > 0 })
  return ids.map(id => cached.find(a => a.id === id) ?? fetched.data?.find(a => a.id === id)).filter((a): a is AssetSummary => !!a)
}

function useMenuContext() {
  const lib = useLibraryId()
  const info = useQuery({ queryKey: qk.library(lib), queryFn: () => api.libraries.get(lib) })
  const creators = useQuery({ queryKey: qk.creators(lib), queryFn: () => api.creators.list(lib), enabled: !!info.data?.hasCreators, staleTime: 60_000 })
  return { isLocal: info.data?.isLocal ?? false, creators: creators.data?.creators ?? [] }
}

/** Plugin actions for the selection, asked for when the menu opens; none when the server cannot list them. */
function useSelectionActions(ids: string[]): ActionInfo[] {
  const lib = useLibraryId()
  const q = useQuery({ queryKey: ['lib', lib, 'actions', ids.join(',')], queryFn: () => actionsFor(lib, ids).catch(() => [] as ActionInfo[]), staleTime: 10_000, enabled: ids.length > 0 })
  return q.data ?? []
}

function AssetMenuBody({ ids, context, kind, close }: AssetActionsProps & { kind: 'context' | 'dropdown'; close: () => void }) {
  const assets = useAssets(ids)
  const { isLocal, creators } = useMenuContext()
  const actions = useSelectionActions(ids)
  const entries = assetMenuEntries({ assets, isLocal, context: context ?? 'grid', creators, actions }, id => runAssetAction(id, assets, creators, actions))
  return <MenuEntries kind={kind} entries={entries} close={close} />
}

/** Wraps a target; right-click opens the action menu for `ids`. */
export function AssetContextMenu(props: AssetActionsProps & { children: React.ReactNode; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <ContextMenu modal={false} onOpenChange={o => { setOpen(o); props.onOpenChange?.(o) }}>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent>
        {open && props.ids.length > 0 && <AssetMenuBody ids={props.ids} context={props.context} kind="context" close={() => setOpen(false)} />}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A「更多操作」button opening the same menu. */
export function AssetActionsMenu(props: AssetActionsProps & { trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        {props.trigger ?? <Button variant="ghost" size="icon" aria-label={t('act.more')} title={t('act.more')}><Icon name="ellipsis" /></Button>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {open && <AssetMenuBody ids={props.ids} context={props.context ?? 'detail'} kind="dropdown" close={() => setOpen(false)} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { stageLabel }
