import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FsFolder, FsFoldersResponse, LibraryInfo, LibraryRef } from '@bowerbird/schema'
import { Button, cn } from '@bowerbird/plugin-sdk/web'
import { api, BowerbirdApiError, errorText } from '../lib/api'
import { t } from '../lib/i18n'
import { fmtInt } from '../lib/format'
import { qk } from '../lib/keys'
import { FormDialog } from '../overlays/dialogs'
import { Icon } from '../components/Icon'
import { Field, FormLabel, Hint } from '../components/blocks'

/**
 * Choosing a library folder (「打开文件夹」「新建资产库」, first run and「添加资产库…」): the folders of the computer running
 * Bowerbird (`GET /fs/folders`), starting at the home folder — breadcrumbs, 上一级, double-click to enter — under a path
 * field that stays editable (paste a path; typing follows it). The field is what will be used. A browser on another
 * computer cannot look at that disk (`not_local`): it keeps the typed field only.
 */

/* ───────────── paths (the server's: POSIX or Windows) ───────────── */

function sepOf(p: string): '/' | '\\' { return /^[A-Za-z]:\\/.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/' }

/** Trailing separators off, except at the top of a disk (`/`, `C:\`). */
export function trimSep(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  if (!s) return p.slice(0, 1)
  if (/^[A-Za-z]:$/.test(s)) return s + sepOf(p)
  return s
}
export function sameFolder(a: string, b: string): boolean { return trimSep(a) === trimSep(b) }
export function joinPath(dir: string, name: string): string { return /[\\/]$/.test(dir) ? dir + name : dir + sepOf(dir) + name }

export interface Crumb { label: string; path: string; home?: boolean }
/** Breadcrumbs of an absolute path: from the home folder when it is inside it, else from the top of the disk. */
export function crumbsOf(p: string, home?: string): Crumb[] {
  const path = trimSep(p)
  if (home && (sameFolder(path, home) || path.startsWith(joinPath(trimSep(home), '')))) {
    const h = trimSep(home)
    const out: Crumb[] = [{ label: h.split(/[\\/]/).filter(Boolean).pop() ?? h, path: h, home: true }]
    let acc = h
    for (const part of path.slice(h.length).split(/[\\/]+/).filter(Boolean)) { acc = joinPath(acc, part); out.push({ label: part, path: acc }) }
    return out
  }
  const drive = /^[A-Za-z]:[\\/]?/.exec(path)?.[0]
  const top = drive ? drive.slice(0, 2) + sepOf(path) : path.startsWith('/') ? '/' : ''
  const out: Crumb[] = top ? [{ label: drive ? drive.slice(0, 2) : '/', path: top }] : []
  let acc = top
  for (const part of path.slice(drive ? drive.length : top.length).split(/[\\/]+/).filter(Boolean)) {
    acc = acc ? joinPath(acc, part) : part
    out.push({ label: part, path: acc })
  }
  return out
}

/** A new library's folder name: what the file managers accept everywhere; no leading dot (those are hidden). */
export function checkFolderName(name: string): string | null {
  if (!name) return t('lib.name.required')
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || name.startsWith('.') || /[ .]$/.test(name)) return t('lib.name.invalid')
  return null
}

/** `base`, else `base 2`, `base 3`… — the first one no folder here has. */
export function freeName(base: string, taken: string[]): string {
  const lower = new Set(taken.map(n => n.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}

/** The sentence for a path the server refused (`validation_failed` with `details.reason`). */
export function pathError(e: unknown): string {
  if (e instanceof BowerbirdApiError && e.code === 'validation_failed') {
    const key = { not_absolute: 'lib.path.notAbsolute', not_found: 'lib.path.notFound', not_directory: 'lib.path.notDirectory', unreadable: 'lib.path.unreadable' }[String(e.details?.reason)]
    if (key) return t(key)
  }
  return errorText(e)
}

/* ───────────── the chooser's state ───────────── */

interface Listing { shown: FsFoldersResponse | null; shownFor: string | null; pending: boolean; error: unknown; remote: boolean }

export function useChooser() {
  /** The folder whose listing is wanted (null: the home folder). */
  const [want, setWant] = React.useState<string | null>(null)
  const [st, setSt] = React.useState<Listing>({ shown: null, shownFor: null, pending: true, error: null, remote: false })
  const [text, setText] = React.useState('')
  const [selected, setSelected] = React.useState<FsFolder | null>(null)
  const [typed, setTyped] = React.useState<string | null>(null)
  /** The person typed in the field: listings no longer overwrite it. */
  const touched = React.useRef(false)
  /**
   * The path field. What the person types stays in the element (it is not a controlled input): a long listing that
   * renders while they type must never write an older value back into it. Navigation writes it through `show`.
   */
  const fieldRef = React.useRef<HTMLInputElement | null>(null)
  const show = React.useCallback((v: string) => {
    setText(v)
    const el = fieldRef.current
    if (!el || el.value === v) return
    el.value = v
    // a long path shows its end: the folder it names
    el.scrollLeft = el.scrollWidth
  }, [])

  React.useEffect(() => {
    const ac = new AbortController()
    setSt(s => ({ ...s, pending: true }))
    api.fs.folders(want ?? undefined, ac.signal).then(
      // a big folder takes a while to draw: typing and clicks go first
      r => { if (!ac.signal.aborted) React.startTransition(() => setSt({ shown: r, shownFor: want, pending: false, error: null, remote: false })) },
      (e: unknown) => {
        if (ac.signal.aborted || (e as Error)?.name === 'AbortError') return
        if (e instanceof BowerbirdApiError && e.code === 'not_local') setSt(s => ({ ...s, pending: false, error: null, remote: true }))
        else setSt(s => ({ ...s, pending: false, error: e }))
      })
    return () => ac.abort()
  }, [want])

  // the field shows the listed folder until the person types
  React.useEffect(() => { if (st.shown && !touched.current) show(st.shown.path) }, [st.shown, show])

  // typing (or pasting) a path follows it, once the typing pauses
  React.useEffect(() => {
    const v = typed?.trim()
    if (!v) return
    const tm = setTimeout(() => setWant(v), 280)
    return () => clearTimeout(tm)
  }, [typed])

  const enter = React.useCallback((p: string) => { touched.current = false; setSelected(null); setTyped(null); show(p); setWant(p) }, [show])
  const select = React.useCallback((f: FsFolder | null) => {
    touched.current = false; setTyped(null); setSelected(f)
    show(f?.path ?? st.shown?.path ?? '')
  }, [st.shown, show])
  const type = React.useCallback((v: string) => { touched.current = true; setSelected(null); setText(v); setTyped(v) }, [])

  /** What the field names, when already known without asking the server. */
  const chosen = (): { path: string; library: boolean } | null => {
    if (selected) return { path: selected.path, library: selected.library }
    if (!st.shown) return null
    // the listed folder, once the listing for what the field says has arrived (not the one before it)
    const v = (fieldRef.current?.value ?? text).trim()
    if (sameFolder(st.shown.path, v) || (st.shownFor != null && st.shownFor === v)) return { path: st.shown.path, library: st.shown.library }
    return null
  }
  /** The folder the field names, checked by the server (`~` expanded); or why it cannot be used. */
  const resolve = async (): Promise<{ path: string; library: boolean } | { error: string }> => {
    const known = chosen()
    if (known) return known
    const v = (fieldRef.current?.value ?? text).trim()
    if (!v) return { error: t('lib.path.required') }
    try { const r = await api.fs.folders(v); return { path: r.path, library: r.library } } catch (e) { return { error: pathError(e) } }
  }
  /** What the field says now (the element itself: the last keystroke may not have rendered yet). */
  const value = () => fieldRef.current?.value ?? text
  return { ...st, text, value, fieldRef, selected, touched: touched.current, enter, select, type, chosen, resolve }
}
export type Chooser = ReturnType<typeof useChooser>

function useLibraries(): LibraryRef[] {
  return useQuery({ queryKey: qk.libraries(), queryFn: () => api.libraries.list() }).data?.libraries ?? []
}
function addedAt(libs: LibraryRef[], p: string): LibraryRef | undefined { return libs.find(l => sameFolder(l.root, p)) }

/* ───────────── the browser ───────────── */

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-fill-rest px-1.5 text-[11px] leading-[14px] text-ink-2">{children}</span>
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="m-0 mt-1 text-[11px] leading-[14px] text-danger-ink">{children}</p>
}

/** Path field + 上一级 / 主文件夹 + breadcrumbs + the folders (or, from another computer, the field alone). */
export function FolderBrowser({ c, label, libs, error, autoFocus, first = true }: {
  c: Chooser; label: string; libs: LibraryRef[]; error?: string | null; autoFocus?: boolean; first?: boolean
}) {
  const field = c.fieldRef
  const list = React.useRef<HTMLDivElement | null>(null)
  const focusList = React.useRef(false)
  const shown = c.shown
  // the field is filled in once the home folder is listed: select it, so a paste replaces it
  const filled = React.useRef(false)
  React.useEffect(() => {
    if (!shown || filled.current) return
    filled.current = true
    if (document.activeElement === field.current && !c.touched) setTimeout(() => field.current?.select(), 0)
  }, [shown, c.touched, field])
  // entered with the keyboard: focus moves into the new folder in the same commit (before the dialog would park it)
  React.useLayoutEffect(() => {
    if (!focusList.current || !shown) return
    focusList.current = false
    const opts = list.current?.querySelectorAll<HTMLElement>('[role="option"]')
    ;(opts?.[0] ?? list.current)?.focus()
  }, [shown])

  const fieldEl = (
    <Field ref={field} icon="folder" autoFocus={autoFocus} defaultValue={c.text} invalid={!!error} aria-label={label} autoComplete="off" spellCheck={false}
      onChange={e => c.type(e.target.value)} className="font-mono text-[12px]" />
  )
  const typedError = !error && c.touched && c.error ? pathError(c.error) : null

  if (c.remote) {
    return (
      <>
        <FormLabel first={first}>{label}</FormLabel>
        {fieldEl}
        {error ? <ErrorLine>{error}</ErrorLine> : <Hint>{t('lib.remoteHint')}</Hint>}
      </>
    )
  }

  const folders = shown?.folders ?? []
  const sel = c.selected
  const focusIndex = Math.max(0, sel ? folders.findIndex(f => f.path === sel.path) : 0)
  const enterWithKeys = (p: string) => { focusList.current = true; c.enter(p) }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const opts = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const i = opts.indexOf(e.target as HTMLElement)
    const go = (j: number) => { const f = folders[j]; if (!f) return; c.select(f); opts[j]?.focus() }
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    switch (e.key) {
      case 'ArrowDown': stop(); go(i < 0 ? 0 : Math.min(i + 1, folders.length - 1)); break
      case 'ArrowUp': stop(); go(i < 0 ? 0 : Math.max(i - 1, 0)); break
      case 'Home': stop(); go(0); break
      case 'End': stop(); go(folders.length - 1); break
      case 'Enter': case 'ArrowRight': if (i >= 0) { stop(); enterWithKeys(folders[i]!.path) } break
      case 'ArrowLeft': case 'Backspace': if (shown?.parent) { stop(); enterWithKeys(shown.parent) } break
    }
  }
  const crumbs = shown ? crumbsOf(shown.path, shown.home) : []
  const shownCrumbs: Array<Crumb | null> = crumbs.length > 5 ? [crumbs[0]!, null, ...crumbs.slice(-3)] : crumbs

  return (
    <>
      <FormLabel first={first}>{label}</FormLabel>
      {fieldEl}
      {error ? <ErrorLine>{error}</ErrorLine> : typedError && <Hint className="mt-1 text-[11px] leading-[14px]">{typedError}</Hint>}
      <div className="mt-2 flex h-7 min-w-0 items-center gap-0.5">
        <Button size="icon" variant="ghost" aria-label={t('lib.up')} title={t('lib.up')} disabled={!shown?.parent} onClick={() => shown?.parent && c.enter(shown.parent)}>
          <Icon name="arrow-up" />
        </Button>
        <Button size="icon" variant="ghost" aria-label={t('lib.home')} title={t('lib.home')} disabled={!shown || sameFolder(shown.path, shown.home)} onClick={() => shown && c.enter(shown.home)}>
          <Icon name="house" />
        </Button>
        <nav aria-label={t('lib.crumbs')} className="ml-1 flex min-w-0 flex-1 items-center overflow-hidden text-[12px]">
          {shownCrumbs.map((cr, i) => {
            const last = i === shownCrumbs.length - 1
            return (
              <React.Fragment key={cr?.path ?? 'gap'}>
                {i > 0 && <Icon name="chevron-right" size={12} className="shrink-0 text-ink-3" />}
                {cr == null
                  ? <span className="shrink-0 px-1 text-ink-3">…</span>
                  : (
                    <button type="button" aria-current={last ? 'location' : undefined} title={cr.path}
                      onClick={() => (last ? c.select(null) : c.enter(cr.path))}
                      className={cn('inline-flex h-[22px] min-w-0 cursor-default items-center gap-1 rounded-xs border-0 bg-transparent px-1.5 outline-none hover:bg-fill-rest focus-visible:outline-2 focus-visible:outline-accent-ring',
                        last ? 'shrink font-semibold text-ink-1' : 'shrink-[2] text-ink-2 hover:text-ink-1')}>
                      {cr.home && <Icon name="house" size={12} className="shrink-0" />}
                      <span className="truncate">{cr.label}</span>
                    </button>
                  )}
              </React.Fragment>
            )
          })}
        </nav>
      </div>
      <div ref={list} role="listbox" aria-label={t('lib.subfolders')} aria-busy={c.pending || undefined}
        tabIndex={folders.length ? -1 : 0} onKeyDown={onKeyDown}
        onClick={e => { if (e.target === e.currentTarget) c.select(null) }}
        className="mt-1 h-[248px] overflow-auto rounded-md bg-surface-well p-1 outline-none focus-visible:outline-2 focus-visible:outline-accent-ring">
        {!shown && c.pending && <div className="grid h-full place-items-center text-ink-3"><Icon name="loader" className="bb-spin" /></div>}
        {!shown && !c.pending && c.error != null && <div className="grid h-full place-items-center px-6 text-center text-[12px] text-ink-3">{pathError(c.error)}</div>}
        {shown && !folders.length && <div className="pointer-events-none grid h-full place-items-center text-[12px] text-ink-3">{t('lib.noFolders')}</div>}
        {folders.map((f, i) => {
          const isSel = sel?.path === f.path
          const added = addedAt(libs, f.path)
          return (
            <div key={f.path} role="option" aria-selected={isSel} tabIndex={i === focusIndex ? 0 : -1} title={f.path}
              onClick={() => c.select(f)} onDoubleClick={() => c.enter(f.path)}
              className={cn('flex h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 text-ink-1 outline-none hover:bg-fill-rest focus-visible:outline-2 focus-visible:outline-accent-ring',
                isSel && 'bg-accent-soft hover:bg-accent-soft')}>
              <Icon name="folder" className={cn('shrink-0', isSel ? 'text-accent-ink' : 'text-ink-3')} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {added ? <Pill>{t('lib.isAdded')}</Pill> : f.library ? <Pill>{t('lib.isLibrary')}</Pill> : null}
            </div>
          )
        })}
      </div>
      {shown?.truncated && <Hint className="mt-1 text-[11px] leading-[14px]">{t('lib.truncated', { n: fmtInt(shown.folders.length) })}</Hint>}
    </>
  )
}

/* ───────────── the two dialogs ───────────── */

/** 打开文件夹: a folder already registered switches to it; one with files goes through the first open; an empty one becomes an empty library. */
export function OpenFolderDialog({ onDone }: { onDone: (info?: LibraryInfo) => void }) {
  const c = useChooser()
  const libs = useLibraries()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => setError(null), [c.text])
  const submit = async () => {
    if (busy) return
    let root = c.value().trim()
    if (!c.remote) {
      const r = await c.resolve()
      if ('error' in r) { setError(r.error); return }
      root = r.path
    } else if (!root) { setError(t('lib.path.required')); return }
    setBusy(true)
    try { onDone(await api.libraries.add({ root })) } catch (e) { setBusy(false); setError(errorText(e)) }
  }
  const chosen = c.remote ? null : c.chosen()
  const added = chosen ? addedAt(libs, chosen.path) : undefined
  return (
    <FormDialog size="wide" title={t('lib.openFolder')} onClose={() => onDone()} submitOnEnter
      footLeft={added ? <span className="truncate">{t('lib.chosenAdded', { name: added.name })}</span> : chosen?.library ? <span className="truncate">{t('lib.chosenLibrary')}</span> : null}
      primary={{ label: t('common.open'), disabled: busy, onClick: () => void submit() }}>
      <FolderBrowser c={c} label={t('lib.folder')} libs={libs} error={error} autoFocus />
    </FormDialog>
  )
}

/** 新建资产库: a name and where; creates `<where>/<name>` (refused when that exists and holds anything). */
export function NewLibraryDialog({ onDone }: { onDone: (info?: LibraryInfo) => void }) {
  const c = useChooser()
  const libs = useLibraries()
  const [name, setName] = React.useState(t('lib.defaultName'))
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [pathError, setPathError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const nameField = React.useRef<HTMLInputElement | null>(null)
  const named = React.useRef(false)
  React.useEffect(() => { nameField.current?.select() }, [])
  // the default name is one the home folder does not have yet
  const homeListed = React.useRef(false)
  React.useEffect(() => {
    if (!c.shown || homeListed.current) return
    homeListed.current = true
    if (named.current) return
    const free = freeName(t('lib.defaultName'), c.shown.folders.map(f => f.name))
    setName(free)
    if (document.activeElement === nameField.current) setTimeout(() => nameField.current?.select(), 0)
  }, [c.shown])
  React.useEffect(() => setPathError(null), [c.text])
  const n = name.trim()
  const submit = async () => {
    if (busy) return
    const bad = checkFolderName(n)
    if (bad) { setNameError(bad); nameField.current?.focus(); return }
    let where = c.value().trim()
    if (!c.remote) {
      const r = await c.resolve()
      if ('error' in r) { setPathError(r.error); return }
      where = r.path
    } else if (!where) { setPathError(t('lib.path.required')); return }
    setBusy(true)
    try { onDone(await api.libraries.add({ root: joinPath(where, n), name: n, create: true })) } catch (e) {
      setBusy(false)
      if (e instanceof BowerbirdApiError && e.code === 'conflict' && e.details?.reason === 'not_empty') { setNameError(t('lib.name.taken', { name: n })); nameField.current?.focus() }
      else setPathError(errorText(e))
    }
  }
  const chosen = c.remote ? (c.text.trim() ? { path: c.text.trim() } : null) : c.chosen()
  const preview = chosen && !checkFolderName(n) ? joinPath(chosen.path, n) : null
  return (
    <FormDialog size="wide" title={t('lib.new')} onClose={() => onDone()} submitOnEnter
      footLeft={preview && <span className="flex min-w-0 items-center gap-1.5" title={preview}><Icon name="folder-plus" size={12} className="shrink-0 text-ink-3" /><span dir="rtl" className="truncate text-left font-mono text-[11px]"><bdi dir="ltr">{preview}</bdi></span></span>}
      primary={{ label: t('lib.newOk'), disabled: busy, onClick: () => void submit() }}>
      <FormLabel first>{t('lib.name')}</FormLabel>
      <Field ref={nameField} autoFocus value={name} invalid={!!nameError} aria-label={t('lib.name')} autoComplete="off" spellCheck={false}
        onChange={e => { named.current = true; setName(e.target.value); setNameError(null) }} />
      {nameError && <ErrorLine>{nameError}</ErrorLine>}
      <FolderBrowser c={c} label={t('lib.location')} libs={libs} error={pathError} first={false} />
    </FormDialog>
  )
}
