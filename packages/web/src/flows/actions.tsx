import * as React from 'react'
import { BowerbirdApiError, type AssetDetail, type AssetSummary, type ReviewStatus, type Stage } from '@bowerbird/schema'
import { Textarea } from '@bowerbird/plugin-sdk/web'
import { api, errorText } from '../lib/api'
import { t } from '../lib/i18n'
import { namesOrCount, stageLabel, reviewLabel } from '../lib/format'
import { toast, toastError } from '../overlays/toast'
import { ConfirmDialog, DialogList, FormDialog, openDialog } from '../overlays/dialogs'
import { openQuickLook } from '../overlays/quicklook'
import { browseContext, libPath, rt } from '../shell/runtime'
import { openAssetDetail } from '../detail/nav'
import { openReplaceContent } from '../detail/ReplaceContent'
import { detailTabId } from '../plugins/shell-api'
import { findSummaries, findSummary, optimistic, patchAssets, putSummaries, removeAssets } from './cache'
import { markOwn } from './own'
import { restoreAllAsking } from './restore'
import { AssetThumb } from '../components/AssetThumb'
import { Row } from '../components/blocks'
import { ReviewMark, StageMark } from '../components/marks'
import { Icon } from '../components/Icon'

/**
 * The asset operations behind the menus, the keyboard, the inspector and the toolbar (copy.md 操作名称表).
 * Every write updates the screen at once, rolls back with a toast if the server says no, and — where it can be
 * undone — puts「撤销」on its toast and on the session undo stack (⌘Z).
 */

function invalidateLibrary(...keys: string[]) {
  const { qc, lib } = rt()
  for (const k of keys) void qc.invalidateQueries({ queryKey: ['lib', lib, k] })
}

async function details(ids: readonly string[]): Promise<AssetDetail[]> {
  const { lib, qc } = rt()
  return Promise.all(ids.map(id => qc.fetchQuery({ queryKey: ['lib', lib, 'asset', id], queryFn: () => api.assets.get(lib, id), staleTime: 5_000 })))
}

export function summaries(ids: readonly string[]): AssetSummary[] { const { qc, lib } = rt(); return findSummaries(qc, lib, ids) }
function nameOf(id: string): string { const { qc, lib } = rt(); return findSummary(qc, lib, id)?.name ?? id }
function label(ids: readonly string[]): string { return ids.length === 1 ? nameOf(ids[0]!) : t('common.nAssets', { n: ids.length }) }

/* ── open, look, compare ── */

export function openAsset(id: string, tab?: string): void {
  const { navigate, lib } = rt()
  const b = browseContext()
  openAssetDetail(navigate, lib, id, { ...(tab ? { tab: detailTabId(tab)! } : {}), ...(b ? { fromLabel: b.label, list: b.list() } : {}) })
}
export function quickLook(ids: string[], index: number, origin?: HTMLElement | null, onIndexChange?: (i: number) => void): void {
  openQuickLook({ ids, index, origin: origin ?? null, onIndexChange })
}
export function compareAssets(a: string, b: string): void {
  const { go, lib } = rt()
  go(libPath(lib, `/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`))
}

/* ── local actions: only on the computer running Bowerbird (ADR-023); elsewhere「下载源文件」 ── */

export async function openWithDefault(id: string): Promise<void> {
  const { lib } = rt()
  try { await api.assets.open(lib, id); toast({ title: t('act.opened', { name: nameOf(id) }) }) } catch (e) { notLocalOr(e) }
}
export async function revealInFolder(ids: string[]): Promise<void> {
  const { lib } = rt()
  try { await Promise.all(ids.map(id => api.assets.reveal(lib, id))); toast({ title: ids.length > 1 ? t('act.revealedN', { n: ids.length }) : t('act.revealed', { name: nameOf(ids[0]!) }) }) } catch (e) { notLocalOr(e) }
}
function notLocalOr(e: unknown) {
  if (e instanceof BowerbirdApiError && e.code === 'not_local') toast({ title: t('err.notLocal'), kind: 'warning' })
  else toastError(e)
}
export function downloadSources(ids: string[]): void {
  const { lib } = rt()
  ids.forEach((id, i) => setTimeout(() => {
    const a = document.createElement('a')
    a.href = api.assets.fileUrl(lib, id, true)
    a.download = nameOf(id)
    document.body.appendChild(a); a.click(); a.remove()
  }, i * 250))
  toast({ title: ids.length > 1 ? t('act.downloadingN', { n: ids.length }) : t('act.downloading', { name: nameOf(ids[0]!) }) })
}

/* ── stage, review, tags, description ── */

export async function setStage(ids: string[], stage: Stage): Promise<void> {
  const { qc, lib } = rt()
  const prev = new Map(findSummaries(qc, lib, ids).map(a => [a.id, a.stage]))
  const write = (map: (id: string) => Stage) => {
    const groups = new Map<Stage, string[]>()
    for (const id of ids) { const s = map(id); groups.set(s, [...(groups.get(s) ?? []), id]) }
    return Promise.all([...groups].map(([s, g]) => api.assets.batch(lib, { ids: g, patch: { stage: s } })))
  }
  try {
    await optimistic(() => patchAssets(qc, lib, ids, a => ({ ...a, stage })), () => write(() => stage))
    invalidateLibrary('browse-facets', 'views')
    toast({
      title: t('act.stageSet', { name: label(ids), stage: stageLabel(stage) }),
      undo: async () => {
        patchAssets(qc, lib, ids, a => ({ ...a, stage: prev.get(a.id) ?? a.stage }))
        await write(id => prev.get(id) ?? stage).catch(toastError)
      }
    })
  } catch (e) { toastError(e) }
}

/** Review: 打回 always asks why (required), wherever it is chosen (ADR-024, E-16). */
export async function setReview(ids: string[], status: ReviewStatus): Promise<void> {
  const { qc, lib } = rt()
  let note: string | undefined
  if (status === 'rejected') {
    note = await openDialog<string>(close => <RejectDialog name={label(ids)} onDone={v => close(v)} />)
    if (!note) return
  }
  const prev = new Map(findSummaries(qc, lib, ids).map(a => [a.id, a.review]))
  try {
    await optimistic<unknown>(
      () => patchAssets(qc, lib, ids, a => ({ ...a, review: status })),
      () => (ids.length === 1 ? api.assets.review(lib, ids[0]!, { status, ...(note ? { note } : {}) }) : api.assets.batch(lib, { ids, patch: { review: { status, ...(note ? { note } : {}) } } }))
    )
    for (const id of ids) void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', id] })
    invalidateLibrary('info', 'views', 'browse-facets')
    toast({
      title: status === 'rejected' ? t('reject.done', { name: label(ids) }) : t('insp.reviewSet', { name: label(ids), status: reviewLabel(status) }),
      undo: async () => {
        const byStatus = new Map<ReviewStatus, string[]>()
        for (const id of ids) { const s = prev.get(id) ?? 'pending'; byStatus.set(s, [...(byStatus.get(s) ?? []), id]) }
        patchAssets(qc, lib, ids, a => ({ ...a, review: prev.get(a.id) ?? a.review }))
        await Promise.all([...byStatus].map(([s, g]) => api.assets.batch(lib, { ids: g, patch: { review: { status: s } } }))).catch(toastError)
        for (const id of ids) void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', id] })
      }
    })
  } catch (e) { toastError(e) }
}

function RejectDialog({ name, onDone }: { name: string; onDone: (note?: string) => void }) {
  const [v, setV] = React.useState('')
  const [bad, setBad] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement | null>(null)
  const submit = () => { if (!v.trim()) { setBad(true); ref.current?.focus(); return } onDone(v.trim()) }
  return (
    <FormDialog title={t('reject.title', { name })} onClose={() => onDone()} primary={{ label: t('reject.ok'), onClick: submit }}>
      <Textarea ref={ref} autoFocus rows={3} value={v} data-invalid={bad || undefined} placeholder={t('reject.ph')} aria-label={t('reject.aria')}
        onChange={e => { setV(e.target.value); setBad(false) }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
    </FormDialog>
  )
}

export async function editTags(ids: string[], edit: { add?: string[]; remove?: string[] }, opts: { toast?: boolean } = {}): Promise<void> {
  const { qc, lib } = rt()
  const add = edit.add ?? [], remove = edit.remove ?? []
  const apply = (a: AssetSummary): AssetSummary => ({ ...a, tags: [...a.tags.filter(x => !remove.includes(x)), ...add.filter(x => !a.tags.includes(x))] })
  const had = new Map(findSummaries(qc, lib, ids).map(a => [a.id, a.tags]))
  try {
    const res = await optimistic<unknown>(
      () => patchAssets(qc, lib, ids, a => apply(a) as typeof a),
      () => (ids.length === 1 ? api.assets.patch(lib, ids[0]!, { tags: { add, remove } }).then(r => [r]) : api.assets.batch(lib, { ids, patch: { tags: { add, remove } } }))
    )
    invalidateLibrary('tags', 'vocabulary', 'views')
    for (const id of ids) void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', id] })
    const newTags = Array.isArray(res) ? (res[0] as { newTags?: Array<{ tag: string; similar: string[] }> })?.newTags : undefined
    if (newTags?.length && newTags[0]!.similar.length) toast({ title: `「${newTags[0]!.tag}」· ${newTags[0]!.similar.join('、')}`, kind: 'info' })
    if (opts.toast || ids.length > 1) {
      toast({
        title: add.length ? t('insp.tagAdded', { n: ids.length, tag: add.join('、') }) : t('insp.tagRemoved', { n: ids.length, tag: remove.join('、') }),
        undo: async () => {
          // Undo only what this edit changed on each asset.
          await Promise.all(ids.map(id => {
            const before = had.get(id) ?? []
            const undoAdd = remove.filter(x => before.includes(x)), undoRemove = add.filter(x => !before.includes(x))
            return api.assets.patch(lib, id, { tags: { add: undoAdd, remove: undoRemove } })
          })).catch(toastError)
          patchAssets(qc, lib, ids, a => ({ ...a, tags: had.get(a.id) ?? a.tags }))
        }
      })
    }
  } catch (e) { toastError(e) }
}

export async function acceptAiTags(id: string, tags: string[]): Promise<void> {
  const { qc, lib } = rt()
  try {
    const d = await optimistic(() => patchAssets(qc, lib, [id], a => ({ ...a, tags: [...a.tags, ...tags.filter(x => !a.tags.includes(x))], autoTags: a.autoTags.filter(x => !tags.includes(x)) })), () => api.assets.acceptTags(lib, id, tags))
    qc.setQueryData(['lib', lib, 'asset', id], d); putSummaries(qc, lib, [d]); invalidateLibrary('tags', 'vocabulary')
    toast({ title: t('insp.tagAdopted', { tag: tags.join('、') }), undo: async () => { await api.assets.patch(lib, id, { tags: { remove: tags } }).catch(toastError); void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset', id] }) } })
  } catch (e) { toastError(e) }
}
export async function dismissAiTags(id: string, tags: string[]): Promise<void> {
  const { qc, lib } = rt()
  try {
    const d = await optimistic(() => patchAssets(qc, lib, [id], a => ({ ...a, autoTags: a.autoTags.filter(x => !tags.includes(x)) })), () => api.assets.dismissTags(lib, id, tags))
    qc.setQueryData(['lib', lib, 'asset', id], d); putSummaries(qc, lib, [d])
  } catch (e) { toastError(e) }
}

export async function setDescription(id: string, text: string, was: string, o: { title?: string } = {}): Promise<boolean> {
  const { qc, lib } = rt()
  try {
    const r = await api.assets.patch(lib, id, { description: text })
    qc.setQueryData(['lib', lib, 'asset', id], r.asset); putSummaries(qc, lib, [r.asset])
    toast({ title: o.title ?? (text ? t('insp.descSaved') : t('insp.descCleared')), undo: async () => { const b = await api.assets.patch(lib, id, { description: was }).catch(toastError); if (b) { qc.setQueryData(['lib', lib, 'asset', id], b.asset); putSummaries(qc, lib, [b.asset]) } } })
    return true
  } catch (e) { toastError(e); return false }
}

/* ── copy, rename, move, replace, trash ── */

export async function copyAsset(id: string, onCopied?: (newId: string) => void): Promise<void> {
  const { lib, qc } = rt()
  try {
    const r = await api.assets.copy(lib, id)
    markOwn(r.asset.id)
    invalidateLibrary('browse', 'folders', 'views', 'info')
    onCopied?.(r.asset.id)
    toast({
      title: r.originalReferenced ? t('copy.doneRef', { name: r.name }) : t('copy.done', { name: r.name }),
      undo: async () => {
        // the copy goes to the trash like any deletion (never removed for good by an undo)
        try { await api.assets.remove(lib, r.asset.id, true) } catch (e) { toastError(e) }
        removeAssets(qc, lib, [r.asset.id]); invalidateLibrary('browse', 'trash', 'info', 'views')
      }
    })
  } catch (e) { toastError(e) }
}

/** Ask the grid / inspector to edit a name in place (「改名」is in place for assets). */
const renameListeners = new Set<(id: string) => boolean>()
export function onRenameRequest(l: (id: string) => boolean): () => void { renameListeners.add(l); return () => { renameListeners.delete(l) } }
export function requestRename(id: string): void {
  for (const l of [...renameListeners].reverse()) if (l(id)) return
}

export async function renameAsset(id: string, name: string): Promise<boolean> {
  const { lib, qc } = rt()
  const a = findSummary(qc, lib, id)
  const old = a?.name ?? ''
  if (!name.trim()) { toast({ title: t('act.nameEmpty'), kind: 'warning' }); return false }
  if (name === old) return true
  try {
    const d = await optimistic(() => patchAssets(qc, lib, [id], x => ({ ...x, name, path: x.path.slice(0, x.path.length - x.name.length) + name })), () => api.assets.move(lib, id, { name }))
    qc.setQueryData(['lib', lib, 'asset', id], d); putSummaries(qc, lib, [d])
    toast({ title: t('act.renamed', { name }), undo: async () => { const b = await api.assets.move(lib, id, { name: old }).catch(toastError); if (b) { qc.setQueryData(['lib', lib, 'asset', id], b); putSummaries(qc, lib, [b]) } } })
    return true
  } catch (e) { toastError(e); return false }
}

export async function moveDialog(ids: string[]): Promise<void> {
  const { qc, lib } = rt()
  const tree = await qc.fetchQuery({ queryKey: ['lib', lib, 'folders'], queryFn: () => api.folders.tree(lib), staleTime: 10_000 })
  const all: string[] = []
  const walk = (n: typeof tree.root) => { if (n.path) all.push(n.path); n.children.forEach(walk) }
  walk(tree.root)
  const folder = await openDialog<string>(close => <MoveDialog ids={ids} folders={all} onDone={f => close(f)} />)
  if (folder != null) await moveAssets(ids, folder)
}

function MoveDialog({ ids, folders, onDone }: { ids: string[]; folders: string[]; onDone: (f?: string) => void }) {
  const [pick, setPick] = React.useState<string | null>(null)
  return (
    <FormDialog title={t('move.title', { name: label(ids) })} onClose={() => onDone()} primary={{ label: t('move.ok'), disabled: pick == null, onClick: () => pick != null && onDone(pick) }}>
      <div role="radiogroup" className="grid max-h-[320px] min-h-[200px] content-start gap-0.5 overflow-auto">
        {['', ...folders].map(f => (
          <button key={f || '/'} type="button" role="radio" aria-checked={pick === f} onClick={() => setPick(f)} onDoubleClick={() => onDone(f)}
            className="flex cursor-default items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-ink-1 outline-none hover:bg-fill-hover aria-checked:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent-ring"
            style={{ paddingLeft: 8 + (f ? f.split('/').length - 1 : 0) * 16 }}>
            <Icon name={f ? (f.includes('/') ? 'folder' : 'folder-open') : 'hard-drive'} className="text-ink-2" />
            <span className="font-mono text-[11px]">{f || t('folder.root')}</span>
          </button>
        ))}
      </div>
    </FormDialog>
  )
}

/** Move (also: drag onto a side-bar folder). A name already used there asks first (F-06). */
export async function moveAssets(ids: string[], folder: string): Promise<void> {
  const { lib, qc } = rt()
  const list = findSummaries(qc, lib, ids).filter(a => dirOf(a.path) !== folder)
  if (!list.length) return
  let onConflict: 'skip' | 'replace' | 'keep-both' | undefined
  let clashNames = new Set<string>()
  try {
    const pre = await api.assets.precheck(lib, { folder, names: list.map(a => a.name) })
    const clash = pre.conflicts.filter(c => !list.some(a => a.id === c.existing.id))
    clashNames = new Set(clash.map(c => c.name))
    if (clash.length) {
      const names = clash.map(c => c.name)
      const choice = await openDialog<'skip' | 'replace' | 'keep-both'>(close => (
        <ConfirmDialog
          title={t('move.conflictTitle', { folder: folder || t('folder.root') })}
          body={names.length > 1 ? t('move.conflictMany', { n: names.length, names: names.slice(0, 3).join('、') + (names.length > 3 ? '…' : '') }) : t('move.conflictOne', { name: names[0]! })}
          confirmLabel={t('move.both')}
          onDone={ok => close(ok ? 'keep-both' : undefined)}
          extraActions={[{ label: t('move.skip'), onClick: () => close('skip') }, { label: t('move.replace'), variant: 'danger', onClick: () => close('replace') }]}
        />
      ))
      if (!choice) return
      onConflict = choice
    }
  } catch (e) { toastError(e); return }
  // 跳过同名的: those stay where they are — not taken off the screen, not counted as moved
  const skipped = new Set(onConflict === 'skip' ? list.filter(a => clashNames.has(a.name)).map(a => a.id) : [])
  const going = list.filter(a => !skipped.has(a.id))
  const prev = going.map(a => ({ id: a.id, folder: dirOf(a.path), name: a.name }))
  try {
    const res = await optimistic(() => removeAssets(qc, lib, going.map(a => a.id)), () => api.assets.batch(lib, { ids: list.map(a => a.id), patch: { move: { folder, ...(onConflict ? { onConflict } : {}) } } }))
    invalidateLibrary('browse', 'folders', 'views')
    if (res.failed.length) toast({ title: t('err.generic', { message: res.failed[0]!.message }), kind: 'error' })
    const moved = res.updated.filter(id => !skipped.has(id))
    if (!moved.length) return
    toast({
      title: t('move.done', { n: moved.length, folder: folder || t('folder.root') }),
      undo: async () => {
        await Promise.all(prev.filter(p => moved.includes(p.id)).map(p => api.assets.move(lib, p.id, { folder: p.folder, name: p.name }))).catch(toastError)
        invalidateLibrary('browse', 'folders', 'views', 'trash')
      }
    })
  } catch (e) { toastError(e) }
}
function dirOf(path: string): string { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i) }

/** 替换为新版本… (F-09): the detail page's dialog (web-2 detail/ReplaceContent.tsx), one dialog for every entry. */
export async function replaceContent(id: string, o: { fromStale?: boolean } = {}): Promise<void> {
  const { lib } = rt()
  try { const [d] = await details([id]); await openReplaceContent(lib, d!, o) } catch (e) { toastError(e) }
}

/** How many selected assets we read up front to say who depends on them; beyond that the server tells us. */
const KNOW_LIMIT = 50

/**
 * Who depends on the selection, from the assets' incoming relations — or null when we cannot be sure (too many to
 * read, or a read failed). A confirmation never says「没有其他资产依赖它」without knowing.
 */
export async function knownReferrers(ids: readonly string[]): Promise<{ referrers: AssetSummary[]; referenced: Set<string> } | null> {
  if (ids.length > KNOW_LIMIT) return null
  let dets: AssetDetail[]
  try { dets = await details(ids) } catch { return null }
  const sel = new Set(ids)
  const refs = new Map<string, AssetSummary>()
  const referenced = new Set<string>()
  for (const d of dets) for (const r of d.relations.incoming) {
    if (!r.target || sel.has(r.target.id) || r.from === d.id) continue
    refs.set(r.target.id, r.target); referenced.add(d.id)
  }
  return { referrers: [...refs.values()], referenced }
}

function TrashConfirm({ ids, referrers, days, onDone }: { ids: string[]; referrers: AssetSummary[] | null; days: number; onDone: (ok: boolean) => void }) {
  const body = referrers == null ? t('del.textUnknown', { days }) : referrers.length ? t('del.textRef', { n: referrers.length, days }) : t('del.text', { days })
  return (
    <ConfirmDialog title={t('del.title', { name: label(ids) })} body={body} confirmLabel={t('del.ok')} icon="trash-2" danger onDone={onDone}>
      {referrers && referrers.length > 0 && <ReferrerList referrers={referrers} />}
    </ConfirmDialog>
  )
}

/** One request to the server: without force it answers which ones are still referenced (copy.md 删除被引用的资产). */
async function sendTrash(ids: string[], force: boolean): Promise<{ done: string[]; trashIds: string[]; referenced: string[]; failed: string[] }> {
  const { lib } = rt()
  if (ids.length === 1) {
    try { const r = await api.assets.remove(lib, ids[0]!, force); return { done: ids, trashIds: [r.trashId], referenced: [], failed: [] } } catch (e) {
      if (e instanceof BowerbirdApiError && e.code === 'referenced') return { done: [], trashIds: [], referenced: ids, failed: [] }
      throw e
    }
  }
  const r = await api.assets.batch(lib, { ids, patch: { trash: true, ...(force ? { force: true } : {}) } })
  return {
    done: r.updated, trashIds: [],
    referenced: r.failed.filter(f => f.code === 'referenced').map(f => f.id),
    failed: r.failed.filter(f => f.code !== 'referenced').map(f => f.message)
  }
}

/**
 * 移入回收站: always asks. The question names who depends on the selection when we know; the deletion itself goes
 * without force, and whatever the server still finds referenced is asked about again — listing the referrers — before
 * it is sent with force (copy.md 删除与回收站, ADR-047).
 */
export async function trashAssets(ids: string[]): Promise<void> {
  const { lib, qc, info } = rt()
  if (!ids.length) return
  const days = info?.settings?.trashDays ?? 7
  const known = await knownReferrers(ids)
  const ok = await openDialog<boolean>(close => <TrashConfirm ids={ids} referrers={known?.referrers ?? null} days={days} onDone={v => close(v)} />)
  if (!ok) return
  const nameById = new Map(ids.map(id => [id, nameOf(id)]))
  try {
    const first = await sendTrash(ids, false)
    const done = [...first.done]
    const trashIds = [...first.trashIds]
    const failed = [...first.failed]
    const referenced = first.referenced
    if (referenced.length) {
      // already listed and agreed to → send with force; otherwise (unknown before, or new since) ask with the list
      let go = known != null && referenced.every(id => known.referenced.has(id))
      if (!go) {
        const again = await knownReferrers(referenced)
        go = (await openDialog<boolean>(close => <TrashConfirm ids={referenced} referrers={again?.referrers ?? null} days={days} onDone={v => close(v)} />)) === true
      }
      if (go) {
        const second = await sendTrash(referenced, true)
        done.push(...second.done); trashIds.push(...second.trashIds); failed.push(...second.failed)
      }
    }
    if (done.length) removeAssets(qc, lib, done)
    invalidateLibrary('browse', 'trash', 'info', 'views', 'folders')
    if (failed.length) toast({ title: t('err.generic', { message: failed[0]! }), kind: 'error' })
    if (!done.length) return
    const doneSet = new Set(done)
    toast({
      title: t('del.done', { name: namesOrCount(done.map(id => nameById.get(id) ?? id)) }),
      // back to where they were; a place taken meanwhile is asked about the way the trash page asks (flows/restore.ts)
      undo: async () => {
        try {
          const tidSet = new Set(trashIds.length === done.length ? trashIds : [])
          const tr = await api.trash.list(lib)
          const entries = tr.items.filter(x => (tidSet.size ? tidSet.has(x.id) : doneSet.has(x.assetId)))
          const { error } = await restoreAllAsking(lib, entries)
          if (error) toastError(error)
        } catch (e) { toastError(e) }
        invalidateLibrary('browse', 'trash', 'info', 'views', 'folders')
      }
    })
  } catch (e) { toastError(e) }
}

/** The assets that depend on what is being deleted, listed under the confirmation text (copy.md 删除与回收站). */
export function ReferrerList({ referrers }: { referrers: AssetSummary[] }) {
  return (
    <DialogList>
      {referrers.map(r => (
        <Row key={r.id} thumb={<AssetThumb asset={r} fit="cover" />} label={r.name} sub={r.path} trailing={<><StageMark stage={r.stage} /><ReviewMark review={r.review} /></>} />
      ))}
    </DialogList>
  )
}

/** Summaries for referrer ids from an error's details (the cache first, else fetched; at most 30). */
export async function referrerSummaries(ids: readonly string[]): Promise<AssetSummary[]> {
  const { qc, lib } = rt()
  const out = await Promise.all(ids.slice(0, 30).map(id => findSummary(qc, lib, id) ?? api.assets.get(lib, id).catch(() => null)))
  return out.filter((a): a is AssetSummary => !!a)
}

/** A readable reason for a failed request inside a dialog. */
export function reason(e: unknown): string { return errorText(e) }
