import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ACTOR_HEADER, type AssetSummary, type FolderNode, type Stage, type RegisterFields, type RegisterResponse, STAGES } from '@bowerbird/schema'
import {
  Button, Checkbox, cn, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Progress, Switch
} from '@bowerbird/plugin-sdk/web'
import { api, hasApiTransport } from '../lib/api'
import { currentActor } from '../lib/actor'
import { t } from '../lib/i18n'
import { fmtSize } from '../lib/format'
import { qk } from '../lib/keys'
import { FormDialog, openDialog } from '../overlays/dialogs'
import { pickAsset } from '../shell/picker'
import { rt } from '../shell/runtime'
import { Icon, kindIcon } from '../components/Icon'
import { AssetThumb } from '../components/AssetThumb'
import { FilterChip, Row, TagChip, TagInput } from '../components/blocks'
import { StageMark } from '../components/marks'
import { destOf, resolveConflicts, type ConflictChoice, type ConflictQuestion, type PlannedFile } from './upload-plan'
import { markOwn } from './own'
import { usePluginRegistry } from '../plugins/registry'
import { badgeText } from '../plugins/text'

/**
 * Upload (F-12): the dialog shows the target folder (changeable) and what it hands down (stage, tags, review-free,
 * and from which folder); a dropped folder can keep its structure; taken names are asked one by one; the panel at
 * the bottom right shows each file's progress with cancel, cancel all, failures with the reason and retry.
 */
export interface UploadFile { file: File; /** Folder inside a dropped folder, e.g. `export/ui`. */ rel?: string }

/* ── the panel's store ── */
export interface UpItem { id: string; name: string; size: number; dest: string; status: 'queued' | 'run' | 'done' | 'fail' | 'cancel'; progress: number; error?: string; xhr?: XMLHttpRequest; send: () => void }
let items: UpItem[] = []
const ls = new Set<() => void>()
function emit() { items = [...items]; ls.forEach(l => l()) }
export function useUploads(): UpItem[] { return React.useSyncExternalStore(cb => { ls.add(cb); return () => ls.delete(cb) }, () => items, () => items) }
export function uploadsRunning(): boolean { return items.some(i => i.status === 'run' || i.status === 'queued') }
function update(id: string, patch: Partial<UpItem>) { items = items.map(i => (i.id === id ? { ...i, ...patch } : i)); emit() }

const MAX_PARALLEL = 3
function pump() {
  let running = items.filter(i => i.status === 'run').length
  for (const it of items) {
    if (running >= MAX_PARALLEL) break
    if (it.status === 'queued') { it.send(); running++ }
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null
function refreshSoon() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    const { qc, lib } = rt()
    for (const k of ['browse', 'folders', 'views', 'info', 'vocabulary', 'jobs']) void qc.invalidateQueries({ queryKey: ['lib', lib, k] })
  }, 300)
}

/** Queue a batch: the panel's list is rebuilt once for the whole batch (not once per file). */
export function enqueueAll(lib: string, planned: ReadonlyArray<PlannedFile<File>>, fields: Omit<RegisterFields, 'folder' | 'name' | 'onConflict'>): void {
  const fresh = planned.map(p => makeItem(lib, p, fields))
  items = [...items.filter(i => i.status === 'run' || i.status === 'queued' || i.status === 'fail'), ...fresh]
  emit()
}

/** Send one file with XHR (fetch has no upload progress). Same public endpoint as `api.assets.register`. */
function makeItem(lib: string, p: PlannedFile<File>, fields: Omit<RegisterFields, 'folder' | 'name' | 'onConflict'>): UpItem {
  const id = `up${Math.random().toString(36).slice(2)}`
  const send = () => {
    if (hasApiTransport()) { sendViaTransport(); return }
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append('meta', JSON.stringify({ ...fields, folder: p.dest, name: p.name, ...(p.onConflict ? { onConflict: p.onConflict } : {}) }))
    form.append('file', p.file, p.name)
    xhr.open('POST', api.url(`/libraries/${encodeURIComponent(lib)}/assets`))
    xhr.setRequestHeader(ACTOR_HEADER, currentActor())
    xhr.upload.onprogress = e => { if (e.lengthComputable) update(id, { progress: e.loaded / e.total }) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { const r = JSON.parse(xhr.responseText) as RegisterResponse; if (r.asset) markOwn(r.asset.id) } catch { /* ignore */ }
        update(id, { status: 'done', progress: 1, xhr: undefined }); refreshSoon()
      } else {
        let msg = xhr.statusText
        try { msg = (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message ?? msg } catch { /* not JSON */ }
        update(id, { status: 'fail', error: msg, xhr: undefined })
      }
      pump()
    }
    xhr.onerror = () => { update(id, { status: 'fail', error: t('up.disconnected'), xhr: undefined }); pump() }
    xhr.onabort = () => { update(id, { status: 'cancel', xhr: undefined }); pump() }
    update(id, { status: 'run', progress: 0, error: undefined, xhr })
    xhr.send(form)
  }
  /** Without a real server (fixtures, tests) there is no XHR progress: send through the API client, tick progress. */
  function sendViaTransport() {
    let cancelled = false
    const fake = { abort: () => { cancelled = true; update(id, { status: 'cancel', xhr: undefined }); pump() } } as unknown as XMLHttpRequest
    update(id, { status: 'run', progress: 0, error: undefined, xhr: fake })
    let pr = 0
    const tick = setInterval(() => { pr = Math.min(0.9, pr + 0.15); if (!cancelled) update(id, { progress: pr }) }, 120)
    api.assets.register(lib, { ...fields, folder: p.dest, name: p.name, ...(p.onConflict ? { onConflict: p.onConflict } : {}) }, p.file)
      .then(r => { clearInterval(tick); if (cancelled) return; if (r.asset) markOwn(r.asset.id); update(id, { status: 'done', progress: 1, xhr: undefined }); refreshSoon(); pump() })
      .catch(e => { clearInterval(tick); if (cancelled) return; update(id, { status: 'fail', error: (e as Error).message, xhr: undefined }); pump() })
  }
  return { id, name: p.name, size: p.file.size, dest: p.dest, status: 'queued', progress: 0, send }
}

export function cancelUpload(id: string) { const it = items.find(i => i.id === id); if (!it) return; if (it.xhr) it.xhr.abort(); else update(id, { status: 'cancel' }) }
export function cancelAllUploads() { for (const it of items) if (it.status === 'run' || it.status === 'queued' || it.status === 'fail') cancelUpload(it.id) }
export function retryUpload(id: string) { const it = items.find(i => i.id === id); if (it) { update(id, { status: 'queued', error: undefined }); pump() } }
export function clearFinishedUploads() { items = items.filter(i => i.status === 'run' || i.status === 'queued' || i.status === 'fail'); emit() }

/* ── entry points ── */

/** Choose files with the system picker, then upload. */
export function pickAndUpload(folder?: string | null): void {
  const input = document.createElement('input')
  input.type = 'file'; input.multiple = true
  input.onchange = () => { const fs = [...(input.files ?? [])].map(file => ({ file })); if (fs.length) void uploadFiles(fs, folder) }
  input.click()
}

/** Files (and folders) dropped from the desktop, with their relative folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<UploadFile[]> {
  const out: UploadFile[] = []
  const entries = [...dt.items].map(i => (i.kind === 'file' ? (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null : null))
  if (!entries.some(Boolean)) return [...dt.files].map(file => ({ file }))
  const walk = async (e: FileSystemEntry, dir: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej))
      out.push(dir ? { file, rel: dir } : { file })
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      const next = dir ? `${dir}/${e.name}` : e.name
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const c of batch) await walk(c, next)
      }
    }
  }
  for (const e of entries) if (e) await walk(e, '')
  return out
}

interface UploadOptions { folder: string; keep: boolean; stage: Stage; tags: string[]; exempt: boolean; source: AssetSummary | null }

export async function uploadFiles(files: UploadFile[], folder?: string | null): Promise<void> {
  const { lib } = rt()
  const opt = await openDialog<UploadOptions>(close => <UploadDialog files={files} folder={folder ?? ''} onDone={o => close(o)} />)
  if (!opt) return
  const planned: Array<PlannedFile<File>> = files.map(f => ({ file: f.file, name: f.file.name, dest: destOf(opt.folder, f.rel, opt.keep) }))
  // Ask the server which names are taken, per destination folder.
  const takenMap = new Map<string, Map<string, AssetSummary>>()
  try {
    const byDest = new Map<string, string[]>()
    for (const p of planned) byDest.set(p.dest, [...(byDest.get(p.dest) ?? []), p.name])
    await Promise.all([...byDest].map(async ([dest, names]) => {
      const r = await api.assets.precheck(lib, { folder: dest, names })
      takenMap.set(dest, new Map(r.conflicts.map(c => [c.name, c.existing])))
    }))
  } catch { /* the server will still refuse a taken name; continue with what we know */ }
  const resolved = await resolveConflicts(planned, (d, n) => takenMap.get(d)?.get(n)?.id ?? null, q => askConflict(q, takenMap))
  if (!resolved || !resolved.length) return
  const fields: Omit<RegisterFields, 'folder' | 'name' | 'onConflict'> = { stage: opt.stage, tags: opt.tags, ...(opt.exempt ? { review: 'exempt' as const } : {}), ...(opt.source ? { relations: [{ type: 'source', to: opt.source.id }] } : {}) }
  enqueueAll(lib, resolved, fields)
  pump()
}

function askConflict(q: ConflictQuestion<File>, taken: Map<string, Map<string, AssetSummary>>) {
  const existing = q.existing.kind === 'asset' ? taken.get(q.file.dest)?.get(q.file.name) ?? null : null
  return openDialog<{ choice: ConflictChoice; rest: boolean }>(close => <ConflictDialog q={q} existing={existing} onDone={v => close(v)} />).then(v => v ?? null)
}

function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => { if (!file.type.startsWith('image/')) return; const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u) }, [file])
  return url ? <img src={url} alt="" className="size-full object-contain" /> : <Icon name={kindIcon(guessFormat(file.name))} size={24} />
}
function guessFormat(name: string): string {
  const e = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(e)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(e)) return 'video'
  if (['wav', 'mp3', 'ogg', 'flac'].includes(e)) return 'audio'
  if (['glb', 'gltf', 'fbx'].includes(e)) return 'model'
  if (['md', 'markdown', 'html', 'htm', 'txt', 'json'].includes(e)) return 'doc'
  return 'unknown'
}

function ConflictDialog({ q, existing, onDone }: { q: ConflictQuestion<File>; existing: AssetSummary | null; onDone: (v?: { choice: ConflictChoice; rest: boolean }) => void }) {
  const [rest, setRest] = React.useState(false)
  const reg = usePluginRegistry()
  const pick = (choice: ConflictChoice) => onDone({ choice, rest })
  const other = q.existing.kind === 'batch' ? q.existing.file.file as File : null
  return (
    <FormDialog
      title={t('up.conflictTitle', { name: q.file.name })}
      onClose={() => onDone()}
      footLeft={q.more && (
        <label className="inline-flex cursor-default items-center gap-2 text-[12px] text-ink-2"><Checkbox checked={rest} onCheckedChange={v => setRest(v === true)} />{t('up.applyRest')}</label>
      )}
      actions={<>
        <Button size="lg" variant="ghost" onClick={() => pick('skip')}>{t('up.skip')}</Button>
        <Button size="lg" onClick={() => pick('keep-both')}>{t('up.both')}</Button>
        <Button size="lg" variant="primary" onClick={() => pick('replace')}>{t('up.replace')}</Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <figure className="m-0">
          <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-sm bg-surface-well text-ink-3">
            {existing ? <AssetThumb asset={existing} /> : other ? <LocalPreview file={other} /> : null}
          </div>
          <figcaption className="mt-1.5 flex justify-between text-[12px] tabular-nums text-ink-2"><b className="font-semibold text-ink-1">{t('up.existing')}</b><span>{[existing ? badgeText(reg, existing) : null, fmtSize(existing?.size ?? other?.size ?? 0)].filter(Boolean).join(' · ')}</span></figcaption>
        </figure>
        <figure className="m-0">
          <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-sm bg-surface-well text-ink-3"><LocalPreview file={q.file.file as File} /></div>
          <figcaption className="mt-1.5 flex justify-between text-[12px] tabular-nums text-ink-2"><b className="font-semibold text-ink-1">{t('up.new')}</b><span>{fmtSize((q.file.file as File).size)}</span></figcaption>
        </figure>
      </div>
      <p className="m-0 mt-3 flex items-center gap-1.5 text-[12px] text-ink-3"><Icon name="folder" size={12} /><span className="font-mono text-[11px]">{q.file.dest || t('folder.root')}</span></p>
    </FormDialog>
  )
}

function flatten(n: FolderNode, out: FolderNode[] = []): FolderNode[] { if (n.path) out.push(n); n.children.forEach(c => flatten(c, out)); return out }

function UploadDialog({ files, folder: initial, onDone }: { files: UploadFile[]; folder: string; onDone: (o?: UploadOptions) => void }) {
  const { lib, info } = rt()
  const tree = useQuery({ queryKey: qk.folders(lib), queryFn: () => api.folders.tree(lib) })
  const all = tree.data ? flatten(tree.data.root) : []
  const dropped = files.some(f => f.rel)
  const [folder, setFolder] = React.useState(initial)
  const [keep, setKeep] = React.useState(dropped)
  const node = all.find(n => n.path === folder) ?? (folder === '' ? tree.data?.root : undefined)
  const eff = node?.effectiveDefaults
  const inherited = React.useMemo(() => ({
    stage: (eff?.stage as Stage | undefined) ?? info?.settings?.defaultStage ?? 'production',
    tags: eff?.tags ?? [],
    exempt: eff?.review === 'exempt',
    from: eff ? [...new Set(Object.values(eff.from))][0] ?? '' : ''
  }), [eff, info])
  const [stage, setStage] = React.useState<Stage>(inherited.stage)
  const [tags, setTags] = React.useState<string[]>(inherited.tags)
  const [exempt, setExempt] = React.useState(inherited.exempt)
  const [source, setSource] = React.useState<AssetSummary | null>(null)
  React.useEffect(() => { setStage(inherited.stage); setTags(inherited.tags); setExempt(inherited.exempt) }, [inherited])

  return (
    <FormDialog
      size="wide"
      title={t('up.title', { n: files.length })}
      onClose={() => onDone()}
      primary={{ label: t('up.ok'), icon: 'upload', onClick: () => onDone({ folder, keep, stage, tags, exempt, source }) }}
    >
      <div className="mb-3 flex items-center gap-2 text-ink-2">
        <span>{t('up.to')}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="pr-2 pl-3"><Icon name="folder" size={12} /><span className="font-mono text-[11px]">{folder || t('folder.root')}</span><Icon name="chevron-down" size={12} className="text-ink-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80">
            <DropdownMenuCheckboxItem checked={folder === ''} onSelect={() => setFolder('')}>{t('folder.root')}</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {all.map(n => <DropdownMenuCheckboxItem key={n.path} checked={folder === n.path} onSelect={() => setFolder(n.path)}><span className="font-mono text-[11px]">{n.path}</span></DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        {dropped && (
          <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-ink-2"><Switch checked={keep} onCheckedChange={setKeep} aria-label={t('up.keep')} />{t('up.keep')}</label>
        )}
      </div>
      <div className="max-h-[232px] overflow-auto rounded-md bg-surface-well p-1">
        {files.map((f, i) => (
          <Row key={i} icon={kindIcon(guessFormat(f.file.name))} label={f.file.name}
            sub={f.rel ? (keep ? f.rel + '/' : t('up.from', { folder: f.rel })) : undefined}
            count={fmtSize(f.file.size)} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <span className="text-[12px] text-ink-2">{t('up.stage')}</span>
        <div className="flex gap-1">{STAGES.map(s => <FilterChip key={s} pressed={stage === s} onClick={() => setStage(s)}><StageMark stage={s} label="short" /></FilterChip>)}</div>
        <span className="text-[12px] text-ink-2">{t('up.tags')}</span>
        <div className="flex flex-wrap gap-1">
          {tags.map(tg => <TagChip key={tg} text={tg} onRemove={() => setTags(ts => ts.filter(x => x !== tg))} />)}
          <TagInput placeholder={t('up.addTag')} onAdd={v => setTags(ts => (ts.includes(v) ? ts : [...ts, v]))} />
        </div>
        <span className="text-[12px] text-ink-2">{t('up.exempt')}</span>
        <div><Switch checked={exempt} onCheckedChange={setExempt} aria-label={t('up.exempt')} /></div>
        <span className="text-[12px] text-ink-2">{t('up.source')}</span>
        <div className="flex items-center gap-1">
          <Button onClick={async () => { const a = await pickAsset({ title: t('up.source') }); if (a) setSource(a) }} className="pr-2 pl-3">
            {source ? source.name : t('common.none')}<Icon name="chevron-down" size={12} className="text-ink-2" />
          </Button>
          {source && <Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onClick={() => setSource(null)}><Icon name="x" size={12} /></Button>}
        </div>
      </div>
      {inherited.from && (
        <p className="m-0 mt-3 flex items-center gap-1.5 text-[12px] text-ink-3"><Icon name="corner-down-right" size={12} />{t('up.inherit', { folder: inherited.from })}</p>
      )}
    </FormDialog>
  )
}

/** Bottom-right upload panel (prototype .uppanel). Its height lifts the toasts above it. */
export function UploadPanel({ onHeight }: { onHeight?: (h: number) => void }) {
  const list = useUploads()
  const ref = React.useRef<HTMLDivElement | null>(null)
  const visible = list.length > 0
  React.useLayoutEffect(() => {
    if (!visible || !ref.current) { onHeight?.(0); return }
    const el = ref.current
    const ro = new ResizeObserver(() => onHeight?.(el.offsetHeight))
    ro.observe(el); onHeight?.(el.offsetHeight)
    return () => { ro.disconnect(); onHeight?.(0) }
  }, [visible, onHeight])
  const running = list.filter(i => i.status === 'run' || i.status === 'queued').length
  const fails = list.filter(i => i.status === 'fail').length
  const done = list.filter(i => i.status === 'done').length
  React.useEffect(() => {
    if (!list.length || running || fails) return
    const tm = setTimeout(clearFinishedUploads, 2600)
    return () => clearTimeout(tm)
  }, [list.length, running, fails])
  if (!visible) return null
  return (
    <div ref={ref} className="fixed right-4 bottom-4 z-30 w-[304px] rounded-lg bg-surface-raised p-3 shadow-popover animate-[bb-rise_var(--duration-settle)_var(--spring-settle)_both]">
      <header className="mb-2 flex items-center gap-2 font-semibold">
        <span className="flex-1">{running ? t('up.panel') : fails ? t('up.failed', { k: fails }) : t('up.done', { n: done })}</span>
        <small className="font-normal tabular-nums text-ink-2">{done} / {list.length}</small>
        {running > 0 && <Button variant="ghost" size="sm" onClick={cancelAllUploads}>{t('up.cancelAll')}</Button>}
      </header>
      <div className="max-h-60 overflow-auto">
        {list.map(it => (
          <div key={it.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-0.5 py-[3px] text-[12px] text-ink-2">
            <b className="truncate font-normal text-ink-1">{it.name}</b>
            <span className={cn(it.status === 'fail' && 'text-danger-ink')}>
              {it.status === 'done' ? <Icon name="check" size={12} /> : it.status === 'cancel' ? t('up.cancelled') : it.status === 'fail' ? (it.error ?? t('up.disconnected')) : `${Math.round(it.progress * 100)}%`}
            </span>
            {it.status === 'run' || it.status === 'queued'
              ? <Button variant="ghost" size="icon-sm" className="size-5" aria-label={t('up.cancelOne', { name: it.name })} onClick={() => cancelUpload(it.id)}><Icon name="x" size={12} /></Button>
              : it.status === 'fail' ? <Button size="sm" onClick={() => retryUpload(it.id)}>{t('up.retry')}</Button> : <i />}
            {(it.status === 'run' || it.status === 'queued' || it.status === 'fail') && (
              <Progress className="col-span-3" value={it.progress * 100} tone={it.status === 'fail' ? 'danger' : 'ink'} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
