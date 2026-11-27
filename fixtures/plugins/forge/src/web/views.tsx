/** Forge's UI in the shell's slots: detail tab, top-bar quota, side-bar runs, settings page and the pick page. */
import * as React from 'react'
import type { AssetDetail } from '@bowerbird/schema'
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Progress,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, cn, useShell, type ShellApi
} from '@bowerbird/plugin-sdk/web'
import { Box, Check, CircleAlert, CircleDot, ImagePlus, Loader, Puzzle, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { NAME, PLUGIN_ID, call, paramsLine, routeUrl, runNote, runTitle, tr, type Quota, type RunView, type Status } from './api'

function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i) }
function when(shell: ShellApi, iso: string): string {
  const d = new Date(iso)
  return shell.locale !== 'zh-CN'
    ? d.toLocaleString(shell.locale === 'en' ? 'en-US' : shell.locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Re-run `load` whenever one of this plugin's jobs changes, and every second while something is running. */
const NEVER = () => false
function useForgeData<T>(load: () => Promise<T>, busy: (v: T) => boolean = NEVER): [T | null, () => void] {
  const shell = useShell()
  const [value, setValue] = React.useState<T | null>(null)
  const refresh = React.useCallback(() => { load().then(setValue).catch(() => {}) }, [load])
  React.useEffect(() => {
    refresh()
    return shell.onJob(job => { if (job.pluginId === PLUGIN_ID) refresh() })
  }, [shell, refresh])
  React.useEffect(() => {
    if (!value || !busy(value)) return
    const t = setInterval(refresh, 1000)
    return () => clearInterval(t)
  }, [value, busy, refresh])
  return [value, refresh]
}

/* ───────────── detail tab「Forge」───────────── */

export function isForgeAsset(asset: AssetDetail): boolean { return !!asset.provenance?.plugin?.startsWith(PLUGIN_ID + '@') }

/** The inputs of a run: the asset's source relations with their roles (ADR-070). */
function inputsOf(asset: AssetDetail): Array<{ id: string; role?: string }> {
  return asset.relations.outgoing.filter(r => r.type === 'source').map(r => ({ id: r.to, ...(r.role ? { role: r.role } : {}) }))
}

async function creatorId(shell: ShellApi, creator: string): Promise<string> {
  const { creators } = await shell.api.creators.list(shell.library.id)
  const c = creators.find(x => x.pluginId === PLUGIN_ID && (x.id === creator || x.id.endsWith('/' + creator) || x.id.endsWith(':' + creator)))
  if (!c) throw new Error(`${NAME}: ${creator}`)
  return c.id
}

export function ForgeTab({ asset }: { asset: AssetDetail }) {
  const shell = useShell()
  const rec = asset.provenance
  const inputs = React.useMemo(() => inputsOf(asset), [asset])
  const [names, setNames] = React.useState<Record<string, string>>({})
  const [again, setAgain] = React.useState(false)
  React.useEffect(() => {
    let live = true
    Promise.all(inputs.map(i => shell.api.assets.get(shell.library.id, i.id).then(a => [i.id, a.name] as const).catch(() => [i.id, i.id] as const)))
      .then(pairs => { if (live) setNames(Object.fromEntries(pairs)) })
    return () => { live = false }
  }, [shell, inputs])
  if (!rec) return null
  return (
    <section className="flex max-w-2xl flex-col gap-4 p-6">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Puzzle className="size-3.5" />{tr(shell, 'tabHeading')}</h4>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{tr(shell, 'method')}</dt><dd className="font-mono text-xs">{rec.method}</dd>
        <dt className="text-muted-foreground">{tr(shell, 'started')}</dt><dd><span className="font-mono text-xs">{rec.by}</span> · {when(shell, rec.at)}</dd>
        <dt className="text-muted-foreground">{tr(shell, 'params')}</dt><dd>{paramsLine(rec.params)}</dd>
        {inputs.map(i => (
          <React.Fragment key={i.id}><dt className="text-muted-foreground">{i.role ?? '—'}</dt><dd className="font-mono text-xs">{names[i.id] ?? i.id}</dd></React.Fragment>
        ))}
      </dl>
      {rec.prompt ? <pre className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">{rec.prompt}</pre> : null}
      <div><Button variant="outline" onClick={() => setAgain(true)}><RefreshCw />{tr(shell, 'again')}</Button></div>
      {again ? <AgainDialog asset={asset} onClose={() => setAgain(false)} /> : null}
    </section>
  )
}

/** The same creation way, prefilled with this run's prompt, parameters and inputs (a new seed). */
function AgainDialog({ asset, onClose }: { asset: AssetDetail; onClose(): void }) {
  const shell = useShell()
  const rec = asset.provenance!
  const creator = rec.method.split('/')[1] ?? 'image'
  const title = tr(shell, creator === 'model' ? 'creatorModel' : 'creatorImage')
  const [prompt, setPrompt] = React.useState(rec.prompt ?? '')
  const [busy, setBusy] = React.useState(false)
  const { seed: _seed, ...params } = (rec.params ?? {}) as Record<string, unknown>
  async function start() {
    setBusy(true)
    try {
      const id = await creatorId(shell, creator)
      await shell.api.creators.run(shell.library.id, id, {
        params: creator === 'image' ? { ...params, prompt } : params,
        inputs: inputsOf(asset).map(i => ({ role: i.role ?? '', id: i.id })),
        folder: dirOf(asset.path)
      })
      onClose()
      shell.toast({ title: tr(shell, 'startedToast', title), action: { label: tr(shell, 'viewJobs'), onClick: () => shell.navigate({ to: 'settings', section: 'tasks' }) } })
    } catch (e) {
      shell.toast({ kind: 'error', title: `${NAME}：${e instanceof Error ? e.message : String(e)}` })
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{paramsLine(params)}</DialogDescription></DialogHeader>
        {creator === 'image' ? (
          <div className="grid gap-2"><Label htmlFor="forge-prompt">{tr(shell, 'prompt')}</Label><Textarea id="forge-prompt" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} /></div>
        ) : null}
        <DialogFooter className="items-center sm:justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Puzzle className="size-3" />{tr(shell, 'by', NAME)}</span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{tr(shell, 'cancel')}</Button>
            <Button disabled={busy || (creator === 'image' && !prompt.trim())} onClick={start}><Sparkles />{tr(shell, 'start')}</Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ───────────── top bar: this month's quota ───────────── */

export function QuotaLabel() {
  const shell = useShell()
  const [q] = useForgeData(React.useCallback(() => call<Quota>(shell, 'quota'), [shell]))
  return <span className="tabular-nums">{q ? q.quota - q.used : '—'}</span>
}

export function QuotaPopover({ close }: { close(): void }) {
  const shell = useShell()
  const [q] = useForgeData(React.useCallback(() => call<Quota>(shell, 'quota'), [shell]))
  return (
    <div className="flex w-60 flex-col gap-3">
      <h5 className="text-sm font-semibold">{tr(shell, 'quotaTitle')}</h5>
      <div className="flex items-center gap-3"><Progress value={q ? Math.round((q.used / q.quota) * 100) : 0} /><span className="text-xs tabular-nums whitespace-nowrap">{q ? `${q.used} / ${q.quota}` : '—'}</span></div>
      <Button size="sm" variant="outline" onClick={() => { close(); shell.navigate({ to: 'settings', section: PLUGIN_ID }) }}>{tr(shell, 'settings')}</Button>
    </div>
  )
}

/* ───────────── side bar: the runs in progress ───────────── */

export function RunsSection() {
  const shell = useShell()
  const [data] = useForgeData(
    React.useCallback(() => call<{ runs: RunView[] }>(shell, 'runs'), [shell]),
    React.useCallback((v: { runs: RunView[] }) => v.runs.some(r => r.state === 'running'), [])
  )
  const runs = (data?.runs ?? []).slice(0, 4)
  if (!runs.length) return <div className="px-3 py-1 text-xs text-muted-foreground">{tr(shell, 'none')}</div>
  function open(r: RunView) {
    if (r.state === 'pick') return shell.navigate({ to: 'plugin-page', plugin: PLUGIN_ID, page: 'pick', params: { job: r.job } })
    if (r.state === 'done' && r.registered[0]) return shell.navigate({ to: 'asset', id: r.registered[0].id })
    shell.navigate({ to: 'settings', section: 'tasks' })
  }
  return (
    <div role="list" className="flex flex-col">
      {runs.map(r => {
        const Icon = r.state === 'failed' ? CircleAlert : r.state === 'pick' ? CircleDot : r.state === 'running' ? Loader : r.creator === 'model' ? Box : ImagePlus
        const count = r.state === 'running' ? `${Math.round(r.progress * 100)}%` : r.state === 'pick' ? tr(shell, 'pick') : r.state === 'failed' ? tr(shell, 'failed') : r.state === 'cancelled' ? tr(shell, 'cancelled') : ''
        return (
          <button key={r.job} role="listitem" title={runNote(shell, r)} onClick={() => open(r)}
            className="flex items-center gap-2 rounded-md px-3 py-1 text-left text-sm hover:bg-accent">
            <Icon className={cn('size-3 shrink-0', r.state === 'running' && 'animate-spin', r.state === 'failed' && 'text-destructive')} />
            <span className="min-w-0 flex-1 truncate">{runTitle(shell, r)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ───────────── settings page: where each setting is kept is declared in the manifest ───────────── */

export function SettingsPage() {
  const shell = useShell()
  const lib = shell.library.id
  const [libValues, setLib] = React.useState<Record<string, unknown>>({})
  const [machine, setMachine] = React.useState<Record<string, unknown>>({})
  const [status, setStatus] = React.useState<Status | null>(null)
  const [editKey, setEditKey] = React.useState<string | null>(null)
  React.useEffect(() => {
    shell.api.plugins.librarySettings(lib, PLUGIN_ID).then(r => setLib(r.values)).catch(() => {})
    shell.api.plugins.machineSettings(PLUGIN_ID).then(r => setMachine(r.values)).catch(() => {})
    call<Status>(shell, 'status').then(setStatus).catch(() => {})
  }, [shell, lib])
  async function saveLib(values: Record<string, unknown>) {
    const r = await shell.api.plugins.putLibrarySettings(lib, PLUGIN_ID, { ...libValues, ...values }); setLib(r.values)
    shell.toast({ title: tr(shell, 'saved'), kind: 'success' })
  }
  async function saveMachine(values: Record<string, unknown>) {
    // The server answers the access key as a placeholder ({ set: true }); never send it back, only a new key.
    const { apiKey: _masked, ...rest } = machine
    const r = await shell.api.plugins.putMachineSettings(PLUGIN_ID, { ...rest, ...values }); setMachine(r.values)
    call<Status>(shell, 'status').then(setStatus).catch(() => {})
    shell.toast({ title: tr(shell, 'saved'), kind: 'success' })
  }
  // `{ set: true }` = a key is stored (its value is never sent to the browser)
  const keySet = (typeof machine.apiKey === 'string' && machine.apiKey !== '') || (typeof machine.apiKey === 'object' && machine.apiKey !== null && (machine.apiKey as { set?: unknown }).set === true)
  const row = (label: string, scope: 'library' | 'machine', control: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr_auto] items-center gap-4 border-b py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span><span className="flex min-w-0 items-center gap-2 text-sm">{control}</span>
      <small className="text-xs text-muted-foreground">{tr(shell, scope)}</small>
    </div>
  )
  return (
    <section className="rounded-lg border px-4">
      {row(tr(shell, 'endpoint'), 'library', <Input className="font-mono text-xs" defaultValue={String(libValues.endpoint ?? 'https://api.forge.example/v1')} key={String(libValues.endpoint)} onBlur={e => { if (e.target.value !== libValues.endpoint) void saveLib({ endpoint: e.target.value }) }} />)}
      {row(tr(shell, 'apiKey'), 'machine', editKey !== null
        ? <><Input type="password" autoFocus value={editKey} onChange={e => setEditKey(e.target.value)} /><Button size="sm" onClick={() => { void saveMachine({ apiKey: editKey }); setEditKey(null) }}>{tr(shell, 'save')}</Button></>
        : <>{keySet ? <span className="font-mono text-xs">fk_••••••••</span> : null}<Button size="sm" variant={keySet ? 'ghost' : 'outline'} onClick={() => setEditKey('')}>{keySet ? tr(shell, 'change') : tr(shell, 'fill')}</Button></>)}
      {row(tr(shell, 'defaultModel'), 'library',
        <Select value={String(libValues.defaultModel ?? 'forge-xl 2.1')} onValueChange={v => void saveLib({ defaultModel: v })}>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>{['forge-xl 2.1', 'forge-lite 1.3'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>)}
      {row(tr(shell, 'outputFolder'), 'library', <Input placeholder={tr(shell, 'currentFolder')} defaultValue={String(libValues.outputFolder ?? '')} key={'f' + String(libValues.outputFolder)} onBlur={e => { if (e.target.value !== (libValues.outputFolder ?? '')) void saveLib({ outputFolder: e.target.value }) }} />)}
      {row(tr(shell, 'tool'), 'machine', status?.tool
        ? <span className="font-mono text-xs">{status.tool}</span>
        : <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><TriangleAlert className="size-3" />{tr(shell, 'toolMissing')}</span>)}
      {row(tr(shell, 'simulate'), 'machine',
        <Select value={String(machine.simulate ?? 'none')} onValueChange={v => void saveMachine({ simulate: v })}>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{tr(shell, 'simNone')}</SelectItem>
            <SelectItem value="missing-tool">{tr(shell, 'simTool')}</SelectItem>
            <SelectItem value="unavailable">{tr(shell, 'simDown')}</SelectItem>
          </SelectContent>
        </Select>)}
    </section>
  )
}

/* ───────────── pick page: candidates in a grid, several can be chosen ───────────── */

export function PickPage({ params }: { params: Record<string, string> }) {
  const shell = useShell()
  const job = params.job ?? ''
  const [run, setRun] = React.useState<RunView | null | 'gone'>(null)
  const [on, setOn] = React.useState<number[]>([0])
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { call<RunView>(shell, `runs/${encodeURIComponent(job)}`).then(setRun).catch(() => setRun('gone')) }, [shell, job])
  if (run === null) return null
  if (run === 'gone' || run.state !== 'pick') return <p className="p-6 text-sm text-muted-foreground">{tr(shell, 'gone')}</p>
  const toggle = (i: number) => setOn(cur => cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i])
  async function keep() {
    if (run === null || run === 'gone' || !on.length) return
    setBusy(true)
    try {
      const res = await call<{ registered: RunView['registered'] }>(shell, 'pick', { method: 'POST', body: { job, keep: [...on].sort((a, b) => a - b) } })
      const n = res.registered.length
      shell.toast({ kind: 'success', title: tr(shell, 'registered', n > 1 ? tr(shell, 'registeredN', n) : res.registered[0]?.name ?? '') })
      shell.navigate({ to: 'browse', folder: run.folder })
    } catch (e) {
      shell.toast({ kind: 'error', title: `${NAME}：${e instanceof Error ? e.message : String(e)}` })
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold">{tr(shell, 'pickTitle', runTitle(shell, run))}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {run.candidates.map(c => {
          const checked = on.includes(c.index)
          return (
            <button key={c.index} role="checkbox" aria-checked={checked} aria-label={tr(shell, 'candidate', c.index + 1)} onClick={() => toggle(c.index)}
              className={cn('relative aspect-square overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', checked && 'ring-2 ring-primary')}>
              <img src={routeUrl(shell, c.preview)} alt="" className="size-full object-contain" />
              <span className={cn('absolute top-2 right-2 flex size-5 items-center justify-center rounded-full border bg-background', checked && 'border-primary bg-primary text-primary-foreground')}>{checked ? <Check className="size-3" /> : null}</span>
              <Badge variant="secondary" className="absolute bottom-2 left-2 tabular-nums">{c.index + 1}</Badge>
            </button>
          )
        })}
      </div>
      <p className="text-sm text-muted-foreground">{tr(shell, 'pickNote')}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => shell.navigate({ to: 'browse', folder: run.folder })}>{tr(shell, 'later')}</Button>
        <Button disabled={!on.length || busy} onClick={keep}>{on.length ? tr(shell, 'keepN', on.length) : tr(shell, 'atLeastOne')}</Button>
      </div>
    </div>
  )
}
