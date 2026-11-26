import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LibraryInfo, LibraryRef } from '@bowerbird/schema'
import { Button, cn, Progress } from '@bowerbird/plugin-sdk/web'
import { api, BowerbirdApiError } from '../lib/api'
import { t } from '../lib/i18n'
import { fmtInt } from '../lib/format'
import { qk } from '../lib/keys'
import { rememberLibrary } from '../lib/library'
import { onLibraryEvent } from '../lib/events'
import { toast, toastError } from '../overlays/toast'
import { FormDialog, openDialog } from '../overlays/dialogs'
import { Icon } from '../components/Icon'
import { NewLibraryDialog, OpenFolderDialog } from './folder-chooser'
import { libPath } from '../shell/runtime'

/**
 * Libraries (ADR-026, ADR-033, F-11): one Bowerbird registers several library folders; each browser opens its own,
 * switching changes nobody else's page. Adding a folder that already holds files goes through the first-open
 * explanation (a .bmeta beside every file, formats no plugin reads yet) and registration progress that can stop.
 */
type Go = (path: string, opts?: { replace?: boolean }) => void

export async function switchLibraryDialog(currentId: string, go: Go): Promise<void> {
  const r = await openDialog<{ open?: LibraryRef; add?: boolean }>(close => <SwitchDialog currentId={currentId} onDone={v => close(v)} />)
  if (!r) return
  if (r.add) { await addLibraryDialog(go, currentId); return }
  if (r.open && r.open.id !== currentId) switchTo(r.open, currentId, go)
}

function switchTo(lib: { id: string; name: string }, from: string | null, go: Go) {
  rememberLibrary(lib.id)
  go(libPath(lib.id))
  toast({
    title: t('lib.switched', { name: lib.name }),
    ...(from ? { action: { label: t('lib.switchBack'), onClick: () => { rememberLibrary(from); go(libPath(from)) } } } : {})
  })
}

function SwitchDialog({ currentId, onDone }: { currentId: string; onDone: (v?: { open?: LibraryRef; add?: boolean }) => void }) {
  const libs = useQuery({ queryKey: qk.libraries(), queryFn: () => api.libraries.list() })
  const [pick, setPick] = React.useState(currentId)
  const list = libs.data?.libraries ?? []
  const chosen = list.find(l => l.id === pick)
  return (
    <FormDialog
      title={t('lib.switchTitle')}
      onClose={() => onDone()}
      footLeft={<Button size="lg" variant="ghost" className="-ml-2" onClick={() => onDone({ add: true })}><Icon name="plus" />{t('lib.add')}</Button>}
      primary={{ label: t('common.open'), disabled: !chosen, onClick: () => chosen && onDone({ open: chosen }) }}
    >
      <p className="m-0 mb-2 text-[12px] text-ink-3">{t('lib.switchHint')}</p>
      <div role="radiogroup" aria-label={t('side.library')} className="grid gap-0.5 rounded-md bg-surface-well p-1">
        {list.map(l => (
          <button key={l.id} type="button" role="radio" aria-checked={pick === l.id} onClick={() => setPick(l.id)} onDoubleClick={() => onDone({ open: l })}
            className={cn('flex w-full cursor-default items-center gap-2 rounded-sm border-0 bg-transparent p-2 text-left text-ink-1 outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-accent-ring', pick === l.id && 'bg-accent-soft hover:bg-accent-soft')}>
            <Icon name="hard-drive" className="shrink-0 text-ink-3" />
            <span className="grid min-w-0 flex-1">
              <b className="font-semibold">{l.name}</b>
              <small className="truncate font-mono text-[11px] text-ink-3">{l.root}</small>
            </span>
            {l.id === currentId && <span className="inline-flex h-[22px] items-center rounded-full bg-fill-rest px-2 text-[12px]">{t('lib.current')}</span>}
          </button>
        ))}
      </div>
    </FormDialog>
  )
}

/**
 * 添加资产库: the same two choices as the first-run page (打开文件夹 / 新建资产库), then that dialog. The library is
 * registered inside the dialog (so a refusal is shown there), then opened here.
 */
export async function addLibraryDialog(go: Go, from: string | null = null): Promise<void> {
  const k = await openDialog<LibraryChoice>(close => (
    <FormDialog title={t('lib.addTitle')} size="wide" onClose={() => close()}>
      <LibraryChoices inDialog onPick={close} />
    </FormDialog>
  ))
  if (k === 'open') await openFolderFlow(go, from)
  else if (k === 'new') await newLibraryFlow(go, from)
}

export async function openFolderFlow(go: Go, from: string | null = null): Promise<void> {
  const info = await openDialog<LibraryInfo>(close => <OpenFolderDialog onDone={v => close(v)} />)
  if (info) await opened(info, go, from)
}

export async function newLibraryFlow(go: Go, from: string | null = null): Promise<void> {
  const info = await openDialog<LibraryInfo>(close => <NewLibraryDialog onDone={v => close(v)} />)
  if (info) await opened(info, go, from)
}

/** After 打开文件夹 / 新建资产库: registered → switch; files to register → the shell asks the first-open questions; empty → init. */
async function opened(info: LibraryInfo, go: Go, from: string | null): Promise<void> {
  if (info.id === from) return
  try {
    if (info.state === 'uninitialized' && info.firstOpen && info.firstOpen.files > 0) {
      // the shell asks the first-open questions as soon as it opens an uninitialized library
      rememberLibrary(info.id)
      go(libPath(info.id))
      return
    }
    if (info.state === 'uninitialized') await api.libraries.init(info.id)
    switchTo(info, from, go)
  } catch (e) { toastError(e) }
}

export type LibraryChoice = 'open' | 'new'

/** The two ways to a library, as two equal cards (first-run page, 添加资产库). */
export function LibraryChoices({ onPick, inDialog }: { onPick: (k: LibraryChoice) => void; inDialog?: boolean }) {
  const id = React.useId()
  const card = (k: LibraryChoice, icon: string, title: string, text: string) => (
    <button type="button" autoFocus={inDialog && k === 'open'} onClick={() => onPick(k)} aria-labelledby={`${id}-${k}`} aria-describedby={`${id}-${k}-d`}
      className={cn('group grid cursor-default content-start justify-items-start gap-1 rounded-lg border-0 p-4 text-left outline-none transition-[background-color,transform] duration-fade ease-out-bb active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring',
        inDialog ? 'bg-fill-rest hover:bg-fill-hover' : 'bg-surface-raised shadow-raise hover:bg-fill-rest')}>
      <span className="mb-2 grid size-9 place-items-center rounded-md bg-surface-well text-ink-2 group-hover:text-accent-ink"><Icon name={icon} size={20} /></span>
      <b id={`${id}-${k}`} className="text-[14px] leading-5 font-semibold text-ink-1">{title}</b>
      <span id={`${id}-${k}-d`} className="text-[12px] leading-[18px] text-ink-2">{text}</span>
    </button>
  )
  return (
    <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
      {card('open', 'folder-open', t('lib.openFolder'), t('lib.openFolderText'))}
      {card('new', 'folder-plus', t('lib.new'), t('lib.newText'))}
    </div>
  )
}

/** First open of a folder that already has files: explain, then register with progress (can stop, resumes later). */
export async function firstOpenFlow(info: LibraryInfo): Promise<void> {
  const fo = info.firstOpen
  if (!fo) return
  const ok = await openDialog<boolean>(close => (
    <FormDialog size="wide" title={t('first.title', { path: info.root })} onClose={() => close(false)} primary={{ label: t('common.start'), onClick: () => close(true) }}>
      <p className="m-0 mb-3 text-ink-2"><b className="text-[20px] font-semibold tabular-nums text-ink-1">{fmtInt(fo.files)}</b> {t('first.countRest', { folders: fmtInt(fo.folders) })}</p>
      <div className="flex items-center gap-1.5 rounded-md bg-surface-well px-3 py-2 text-ink-2">
        <Icon name="file" size={12} className="text-ink-3" /><span className="font-mono text-[11px]">chest.glb</span>
        <Icon name="file-plus" size={12} className="ml-3 text-accent-ink" /><span className="font-mono text-[11px]">chest.glb.bmeta</span>
      </div>
      <p className="m-0 mt-2 leading-[19px] text-ink-2">{t('first.bmeta')}</p>
      {fo.unsupported.length > 0 && <>
        <h3 className="mt-4 mb-2 text-[13px] font-semibold text-ink-2">{t('first.unsupported')}</h3>
        <ul className="m-0 mt-1 grid list-none gap-0.5 p-0">
          {fo.unsupported.map(u => (
            <li key={u.ext} className="grid min-h-7 grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm bg-fill-rest px-2">
              <span className="font-mono text-[11px]">{u.ext}</span><span>{u.hint ?? ''}</span><span className="text-[12px] tabular-nums text-ink-3">{fmtInt(u.count)}</span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 text-[12px] text-ink-3">{t('first.unsupportedNote')}</p>
      </>}
    </FormDialog>
  ))
  if (!ok) return
  try { await api.libraries.init(info.id) } catch (e) { toastError(e); return }
  openClaimPanel(info, fo.unsupported.length)
}

/* the registration progress panel (bottom right, like uploads) */
let claim: { info: LibraryInfo; needs: number } | null = null
const claimLs = new Set<() => void>()
function openClaimPanel(info: LibraryInfo, needs: number) { claim = { info, needs }; claimLs.forEach(l => l()) }
function closeClaimPanel() { claim = null; claimLs.forEach(l => l()) }
/** This browser is registering a library's existing files (first open): the assets it creates are its own. */
export function registering(libId: string): boolean { return claim?.info.id === libId }

export function ClaimPanel({ go }: { go: Go }) {
  const qc = useQueryClient()
  const c = React.useSyncExternalStore(cb => { claimLs.add(cb); return () => claimLs.delete(cb) }, () => claim, () => null)
  const [p, setP] = React.useState<{ done: number; total: number; current?: string; phase: string }>({ done: 0, total: c?.info.firstOpen?.files ?? 0, phase: 'walking' })
  React.useEffect(() => {
    if (!c) return
    setP({ done: 0, total: c.info.firstOpen?.files ?? 0, phase: 'walking' })
    return onLibraryEvent((type, data) => {
      if (type !== 'scan.progress') return
      const s = data as { done: number; total: number; current?: string; phase: string; running: boolean }
      setP({ done: s.done, total: s.total || c.info.firstOpen?.files || 0, ...(s.current ? { current: s.current } : {}), phase: s.phase })
      // what was registered is this browser's own doing: show it (grid, folder counts), no「新资产」pill
      if (s.phase === 'done' || s.phase === 'stopped') void qc.invalidateQueries({ queryKey: ['lib', c.info.id] })
      if (s.phase === 'done') {
        closeClaimPanel()
        toast({
          title: c.needs ? t('first.done', { n: fmtInt(s.done), k: c.needs }) : t('first.doneAll', { n: fmtInt(s.done) }),
          ...(c.needs ? { action: { label: t('common.view'), onClick: () => go(libPath(c.info.id, '/settings/library')) } } : {})
        })
      } else if (s.phase === 'stopped') {
        closeClaimPanel()
        toast({ title: t('first.stopped', { n: fmtInt(s.done) }) })
      }
    })
  }, [c, go, qc])
  if (!c) return null
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  return (
    <div className="fixed right-4 bottom-4 z-30 w-[304px] rounded-lg bg-surface-raised p-3 shadow-popover animate-[bb-rise_var(--duration-settle)_var(--spring-settle)_both]">
      <header className="mb-2 flex items-center gap-2 font-semibold">
        <span className="flex-1 truncate">{t('first.progress', { name: c.info.name })}</span>
        <small className="font-normal tabular-nums text-ink-2">{fmtInt(p.done)} / {fmtInt(p.total)}</small>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 py-[3px] text-[12px] text-ink-2">
        <b className="truncate font-mono text-[11px] font-normal text-ink-1">{p.current ? p.current + '.bmeta' : '—'}</b>
        <span>{pct}%</span>
        <Progress className="col-span-2" value={pct} />
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => { void api.libraries.stopScan(c.info.id).catch(toastError) }}>{t('first.stop')}</Button>
    </div>
  )
}

/** 在文件夹中显示 the library root (only on the computer running Bowerbird). */
export async function revealLibrary(info: LibraryInfo): Promise<void> {
  try {
    await api.libraries.reveal(info.id)
    toast({ title: t('lib.revealed', { path: info.root }) })
  } catch (e) {
    if (e instanceof BowerbirdApiError && e.code === 'not_local') toast({ title: t('err.notLocal'), kind: 'warning' })
    else toastError(e)
  }
}
