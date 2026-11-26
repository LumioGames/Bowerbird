import { BowerbirdApiError, type FolderNode, type Query, type SmartView } from '@bowerbird/schema'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { fmtSize } from '../lib/format'
import { toast, toastError } from '../overlays/toast'
import { confirm, ConfirmDialog, DialogList, openDialog, promptNames } from '../overlays/dialogs'
import { libPath, rt } from '../shell/runtime'
import { Icon } from '../components/Icon'
import { ReferrerList, referrerSummaries } from './actions'
import { markOwn } from './own'
import { restoreAllAsking } from './restore'
import { noteOwnScan } from '../shell/scan-findings'

/**
 * Folder and smart-folder operations from the side bar (F-05, F-06, F-10). A folder's name is the directory on disk;
 * its display name only lives in Bowerbird. A folder becomes one asset only when someone says so.
 */
const BAD = /[/\\:]/

function invalidate(...keys: string[]) { const { qc, lib } = rt(); for (const k of keys) void qc.invalidateQueries({ queryKey: ['lib', lib, k] }) }
function browseTo(params: Record<string, string>) { const { go, lib } = rt(); go(libPath(lib, '?' + new URLSearchParams(params).toString())) }

export async function newFolder(parent: FolderNode | null): Promise<void> {
  const { lib } = rt()
  const siblings = new Set((parent?.children ?? []).map(c => c.name))
  const v = await promptNames({
    title: parent?.path ? t('folder.newSubTitle', { folder: parent.path }) : t('folder.newRootTitle'),
    fields: [{ label: t('lib.name'), placeholder: t('folder.namePlaceholder') }],
    okLabel: t('folder.newSubOk'),
    validate: ([n]) => (!n ? t('folder.errEmpty') : BAD.test(n) ? t('folder.errChars') : siblings.has(n) ? t('folder.errExists', { name: n }) : null)
  })
  if (!v) return
  const path = [parent?.path, v[0]].filter(Boolean).join('/')
  try {
    await api.folders.create(lib, path)
    invalidate('folders')
    toast({ title: t('folder.created', { path }), undo: async () => { await api.folders.remove(lib, path).catch(toastError); invalidate('folders', 'trash') } })
  } catch (e) { toastError(e) }
}

export async function renameFolder(node: FolderNode, siblings: string[]): Promise<void> {
  const { lib, qc } = rt()
  const v = await promptNames({
    title: t('folder.renameTitle', { folder: node.path }),
    fields: [
      { label: t('folder.nameLabel'), value: node.name, hint: t('folder.nameHint', { n: node.count }) },
      { label: t('folder.labelLabel'), value: node.label ?? '', hint: t('folder.labelHint'), placeholder: t('common.optional') }
    ],
    okLabel: t('folder.renameOk'),
    validate: ([n]) => (!n ? t('folder.errEmpty') : BAD.test(n) ? t('folder.errChars') : n !== node.name && siblings.includes(n) ? t('folder.errExists', { name: n }) : null)
  })
  if (!v) return
  const [name, label] = v as [string, string]
  const parent = node.path.slice(0, node.path.length - node.name.length).replace(/\/$/, '')
  const newPath = [parent, name].filter(Boolean).join('/')
  try {
    await api.folders.patch(lib, { path: node.path, ...(name !== node.name ? { rename: name } : {}), label: label || null })
    invalidate('folders', 'browse')
    void qc.invalidateQueries({ queryKey: ['lib', lib, 'asset'] })
    toast({
      title: name !== node.name ? t('folder.renamed', { name }) : t('folder.labelChanged'),
      undo: async () => { await api.folders.patch(lib, { path: newPath, ...(name !== node.name ? { rename: node.name } : {}), label: node.label ?? null }).catch(toastError); invalidate('folders', 'browse') }
    })
  } catch (e) { toastError(e) }
}

/** Display name, icon, note, defaults (inspector folder form). */
export async function patchFolder(path: string, patch: { label?: string | null; icon?: string | null; description?: string | null; defaults?: FolderNode['defaults'] | null }): Promise<void> {
  const { lib } = rt()
  try { await api.folders.patch(lib, { path, ...patch }); invalidate('folders') } catch (e) { toastError(e) }
}

export async function bundleFolder(node: FolderNode): Promise<void> {
  const { lib, qc } = rt()
  if (!node.count) { toast({ title: t('folder.emptyFolder') }); return }
  const files = await api.search(lib, { filter: { folder: node.path, includeAuxiliary: true }, limit: 200 }).then(r => r.items).catch(() => [])
  const refs = await Promise.all(files.slice(0, 40).map(a => qc.fetchQuery({ queryKey: ['lib', lib, 'asset', a.id], queryFn: () => api.assets.get(lib, a.id) }).catch(() => null)))
  const inside = new Set(files.map(f => f.id))
  const k = refs.reduce((n, d) => n + (d?.relations.incoming.filter(r => !inside.has(r.from)).length ?? 0), 0)
  const ok = await openDialog<boolean>(close => (
    <ConfirmDialog
      title={t('folder.bundleTitle', { folder: node.name })}
      body={t('folder.bundleText', { n: node.count }) + (k ? t('folder.bundleRefs', { k }) : '')}
      confirmLabel={t('folder.bundleOk')}
      icon="package"
      onDone={v => close(v)}
    >
      <div className="flex items-center gap-1.5 rounded-md bg-surface-well px-3 py-2 text-ink-2">
        <Icon name="folder" size={12} className="text-ink-3" /><span className="font-mono text-[11px]">{node.name}/</span>
        <Icon name="file-plus" size={12} className="ml-3 text-accent-ink" /><span className="font-mono text-[11px]">{node.name}.bmeta</span>
      </div>
      <DialogList className="mt-1 max-h-[200px]">
        {files.map(f => (
          <div key={f.id} className="flex min-h-[26px] items-center gap-1.5 px-2">
            <Icon name="file" size={12} className="text-ink-3" />
            <span className="truncate font-mono text-[11px]">{f.path.slice(node.path.length + 1)}</span>
            <small className="ml-auto text-[11px] text-ink-3">{fmtSize(f.size)}</small>
          </div>
        ))}
      </DialogList>
    </ConfirmDialog>
  ))
  if (!ok) return
  try {
    const entry = files.find(f => /(^|\/)index\.html?$/i.test(f.path))?.path.slice(node.path.length + 1)
    const d = await api.folders.bundle(lib, { path: node.path, ...(entry ? { entry } : {}) })
    markOwn(d.id)
    invalidate('folders', 'browse', 'views', 'info')
    const parent = node.path.slice(0, Math.max(0, node.path.length - node.name.length - 1))
    browseTo({ folder: parent })
    toast({ title: t('folder.bundled', { name: node.name }) })
    void d
  } catch (e) { toastError(e) }
}

export async function scanFolder(path: string): Promise<void> {
  noteOwnScan()
  const { lib } = rt()
  try { await api.libraries.rescan(lib, { path }); toast({ title: t('folder.scanning', { folder: path }) }) } catch (e) { toastError(e) }
}

/**
 * 移入回收站… on a folder. Asked without force first: when assets inside are used from outside the folder the server
 * answers `referenced` with the referrers (ADR-047), and the confirmation comes back saying so and listing them,
 * like deleting a referenced asset; agreeing to that sends force.
 */
export async function trashFolder(node: FolderNode): Promise<void> {
  const { lib, info } = rt()
  const days = info?.settings?.trashDays ?? 7
  const title = t('folder.trashTitle', { folder: node.path })
  const body = node.count ? t('folder.trashText', { n: node.count, days }) : t('folder.trashEmpty')
  const ok = await confirm({ title, body, confirmLabel: t('del.ok'), danger: true })
  if (!ok) return
  let r: { trashed: number; batch: string | null }
  try {
    r = await api.folders.remove(lib, node.path)
  } catch (e) {
    if (!(e instanceof BowerbirdApiError && e.code === 'referenced')) { toastError(e); return }
    const ids = Array.isArray(e.details?.referrers) ? (e.details!.referrers as unknown[]).filter((x): x is string => typeof x === 'string') : []
    const referrers = await referrerSummaries(ids)
    const n = ids.length || referrers.length
    const again = await openDialog<boolean>(close => (
      <ConfirmDialog title={title} body={`${body}${t('folder.trashRef', { n })}`} confirmLabel={t('del.ok')} icon="trash-2" danger onDone={v => close(v)}>
        {referrers.length > 0 && <ReferrerList referrers={referrers} />}
      </ConfirmDialog>
    ))
    if (!again) return
    try { r = await api.folders.remove(lib, node.path, true) } catch (e2) { toastError(e2); return }
  }
  try {
    invalidate('folders', 'browse', 'trash', 'info', 'views')
    const cur = new URLSearchParams(location.search).get('folder')
    if (cur != null && (cur === node.path || cur.startsWith(node.path + '/'))) browseTo({})
    toast({
      title: t('folder.trashed', { folder: node.path }),
      // back to where they were; a place taken meanwhile is asked about the way the trash page asks (flows/restore.ts)
      undo: async () => {
        try {
          const tr = await api.trash.list(lib)
          const { error } = await restoreAllAsking(lib, tr.items.filter(x => r.batch && x.batch === r.batch))
          if (error) toastError(error)
          if (!r.trashed) await api.folders.create(lib, node.path)
        } catch (e) { toastError(e) }
        invalidate('folders', 'browse', 'trash', 'info', 'views')
      }
    })
  } catch (e) { toastError(e) }
}

/* ── smart folders ── */

export async function saveSmart(query: Query, suggested: string, existing: SmartView[]): Promise<void> {
  const { lib } = rt()
  const v = await promptNames({
    title: t('fp.saveSmart'),
    fields: [{ label: t('smart.nameLabel'), value: suggested }],
    okLabel: t('fp.saveSmart'),
    validate: ([n]) => (!n ? t('smart.errEmpty') : existing.some(s => s.name === n) ? t('smart.errExists', { name: n }) : null)
  })
  if (!v) return
  const name = v[0]!
  try {
    await api.views.put(lib, name, { query })
    invalidate('views')
    browseTo({ smart: name })
    toast({ title: t('smart.saved', { name }), undo: async () => { await api.views.remove(lib, name).catch(toastError); invalidate('views') } })
  } catch (e) { toastError(e) }
}

export async function renameSmart(view: SmartView, existing: SmartView[]): Promise<void> {
  const { lib } = rt()
  const v = await promptNames({
    title: t('smart.renameTitle'),
    fields: [{ label: t('smart.nameLabel'), value: view.name }],
    okLabel: t('folder.renameOk'),
    validate: ([n]) => (!n ? t('smart.errEmpty') : n !== view.name && existing.some(s => s.name === n) ? t('smart.errExists', { name: n }) : null)
  })
  if (!v || v[0] === view.name) return
  const name = v[0]!
  try {
    await api.views.put(lib, view.name, { query: view.query, rename: name })
    invalidate('views')
    const cur = new URLSearchParams(location.search).get('smart')
    if (cur === view.name) browseTo({ smart: name })
    toast({ title: t('smart.renamed', { name }), undo: async () => { await api.views.put(lib, name, { query: view.query, rename: view.name }).catch(toastError); invalidate('views') } })
  } catch (e) { toastError(e) }
}

export async function updateSmart(view: SmartView, query: Query): Promise<void> {
  const { lib } = rt()
  try {
    await api.views.put(lib, view.name, { query })
    invalidate('views', 'browse')
    toast({ title: t('smart.updated', { name: view.name }), undo: async () => { await api.views.put(lib, view.name, { query: view.query }).catch(toastError); invalidate('views', 'browse') } })
  } catch (e) { toastError(e) }
}

export async function saveSmartEdit(name: string, query: Query): Promise<void> {
  const { lib } = rt()
  try {
    await api.views.put(lib, name, { query })
    invalidate('views', 'browse')
    browseTo({ smart: name })
    toast({ title: t('smart.savedCond', { name }) })
  } catch (e) { toastError(e) }
}

export async function deleteSmart(view: SmartView): Promise<void> {
  const { lib } = rt()
  const ok = await confirm({ title: t('smart.deleteTitle', { name: view.name }), body: t('smart.deleteText'), confirmLabel: t('smart.deleteOk'), danger: true })
  if (!ok) return
  try {
    await api.views.remove(lib, view.name)
    invalidate('views')
    if (new URLSearchParams(location.search).get('smart') === view.name) browseTo({})
    toast({ title: t('smart.deleted', { name: view.name }), undo: async () => { await api.views.put(lib, view.name, { query: view.query }).catch(toastError); invalidate('views') } })
  } catch (e) { toastError(e) }
}
