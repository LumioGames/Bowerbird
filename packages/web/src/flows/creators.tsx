import * as React from 'react'
import { BowerbirdApiError, type ActionInfo, type AssetSummary, type CreatorInfo } from '@bowerbird/schema'
import { Button, Input, Switch, Textarea, ToggleGroup, ToggleGroupItem } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { toast, toastError } from '../overlays/toast'
import { FormDialog, openDialog } from '../overlays/dialogs'
import { pickAsset } from '../shell/picker'
import { Icon } from '../components/Icon'
import { AssetThumb } from '../components/AssetThumb'
import { libPath, rt } from '../shell/runtime'
import { enumLabel, pluginSchema, pluginText } from '../plugins/text'

/**
 * Creation ways from creator plugins (ADR-016): the shell draws the form each one declares — inputs by role
 * (assets, chosen with the picker), parameters from its JSON Schema — shows「某插件提供」, and starts a job that
 * shows up with the pipeline's tasks. A creation way with its own page opens that page instead.
 * Plugin actions on a selection (right-click menu, plugin-system.md「动作」) use the same parameter form.
 */
export type Schema = { type?: string; title?: string; description?: string; enum?: unknown[]; enumNames?: string[]; 'x-enumNames'?: string[]; default?: unknown; format?: string; maxLength?: number; minimum?: number; maximum?: number; properties?: Record<string, Schema>; required?: string[]; 'x-placeholder'?: string; 'x-widget'?: 'textarea' | 'segmented' | string }

/**
 * A creation way fits the selection when it has required inputs and the one selected asset fills all of them: the
 * format matches, and an input that needs a turnaround sheet (`views`) gets an asset with a view grid.
 */
export function creatorFits(c: CreatorInfo, sel: readonly AssetSummary[]): boolean {
  const req = c.inputs.filter(i => i.required)
  if (!req.length || sel.length !== 1) return false
  const a = sel[0]!
  return req.every(i => (!i.formats?.length || i.formats.includes(a.format)) && (!i.views || a.hasViews === true)) && !a.flags.includes('missing')
}

export async function startCreator(c: CreatorInfo, preselected: readonly AssetSummary[] = []): Promise<void> {
  const { go, lib } = rt()
  if (c.page) { go(libPath(lib, `/plugins/${encodeURIComponent(c.pluginId)}/${encodeURIComponent(c.page)}`)); return }
  await openDialog(close => <CreatorForm creator={c} preselected={preselected} onClose={() => close()} />)
}

function defaults(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, s] of Object.entries(schema.properties ?? {})) if (s.default !== undefined) out[k] = s.default
  return out
}

function folderOf(a: AssetSummary): string { const i = a.path.lastIndexOf('/'); return i < 0 ? '' : a.path.slice(0, i) }

function CreatorForm({ creator: c, preselected, onClose }: { creator: CreatorInfo; preselected: readonly AssetSummary[]; onClose: () => void }) {
  const { lib, currentFolder, go } = rt()
  // the plugin's names, form and input roles in the shell's language (its manifest translations)
  const schema = React.useMemo(() => pluginSchema(c.pluginId, c.params as Schema), [c])
  const name = pluginText(c.pluginId, c.displayName)
  const role = (r: string) => pluginText(c.pluginId, r)
  const [vals, setVals] = React.useState<Record<string, unknown>>(() => defaults(schema))
  const [ins, setIns] = React.useState<Record<string, AssetSummary>>(() => {
    const o: Record<string, AssetSummary> = {}
    for (const inp of c.inputs) { const hit = preselected.find(a => (!inp.formats?.length || inp.formats.includes(a.format)) && (!inp.views || a.hasViews === true)); if (hit) o[inp.role] = hit }
    return o
  })
  const [invalid, setInvalid] = React.useState<string | null>(null)
  const firstIn = Object.values(ins)[0]
  const folder = firstIn ? folderOf(firstIn) : currentFolder() ?? ''

  const start = async () => {
    const miss = c.inputs.find(i => i.required && !ins[i.role])
    if (miss) { toast({ title: t('cr.needInput', { role: role(miss.role) }) }); return }
    const need = missingRequired(schema, vals)
    if (need) { setInvalid(need); return }
    try {
      const job = await api.creators.run(lib, c.id, { params: vals, inputs: Object.entries(ins).map(([role, a]) => ({ role, id: a.id })), folder })
      onClose()
      toast({ title: t('cr.started', { name }), action: { label: t('cr.viewJobs'), onClick: () => go(libPath(lib, '/settings/tasks')) } })
      void job
    } catch (e) { toastError(e) }
  }

  return (
    <FormDialog
      size="wide"
      title={name}
      onClose={onClose}
      footLeft={<span className="inline-flex items-center gap-1 text-ink-3"><Icon name="puzzle" size={12} />{t('cr.by', { plugin: pluginText(c.pluginId, c.pluginName) })}</span>}
      primary={{ label: t('common.start'), icon: 'sparkles', onClick: () => void start() }}
    >
      <div className="grid gap-2">
        {c.inputs.length > 0 && (
          <div className="mb-1 grid gap-0.5 rounded-md bg-surface-well p-1">
            {c.inputs.map(inp => {
              const a = ins[inp.role]
              return (
                <div key={inp.role} className="grid min-h-10 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 px-2">
                  <span className="grid text-[12px] font-semibold text-ink-2">{role(inp.role)}{!inp.required && <small className="font-normal text-ink-3">{t('common.optional')}</small>}</span>
                  {a ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-8 shrink-0 overflow-hidden rounded-sm"><AssetThumb asset={a} fit="cover" /></span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{a.name}</span>
                      <Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onClick={() => setIns(s => { const n = { ...s }; delete n[inp.role]; return n })}><Icon name="x" size={12} /></Button>
                    </span>
                  ) : (
                    <Button size="sm" className="justify-self-start" onClick={async () => {
                      const picked = await pickAsset({ title: t('cr.pickRole', { role: role(inp.role) }), formats: inp.formats, views: inp.views })
                      if (picked) setIns(s => ({ ...s, [inp.role]: picked }))
                    }}><Icon name="plus" size={12} />{t('cr.pick')}</Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <ParamFields schema={schema} vals={vals} setVals={setVals} invalid={invalid} setInvalid={setInvalid} />
        <p className="m-0 mt-1 flex items-center gap-1 text-[12px] text-ink-3"><Icon name="folder" size={12} />{t('cr.to', { folder: folder || t('folder.root') })}</p>
      </div>
    </FormDialog>
  )
}

/** The first required parameter that is still empty, if any. */
function missingRequired(schema: Schema, vals: Record<string, unknown>): string | null {
  return (schema.required ?? []).find(k => vals[k] === undefined || String(vals[k] ?? '').trim() === '') ?? null
}

/** The parameter rows of a JSON Schema form (creators and plugin actions). */
function ParamFields({ schema, vals, setVals, invalid, setInvalid }: {
  schema: Schema
  vals: Record<string, unknown>
  setVals: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  invalid: string | null
  setInvalid: (k: string | null) => void
}) {
  const required = new Set(schema.required ?? [])
  return (
    <>
      {Object.entries(schema.properties ?? {}).map(([k, s]) => {
        // A <label> names the first control inside it: right for a text box, wrong for a group of toggles or a switch
        // (it would rename the first toggle to the field title). Those carry their own aria-label instead.
        const Row = isTextual(s) ? 'label' : 'div'
        return (
          <Row key={k} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 has-[textarea]:items-start">
            <span className="text-[12px] font-semibold text-ink-2 [label:has(textarea)_&]:pt-1.5">{s.title ?? k}</span>
            <ParamField name={k} schema={s} value={vals[k]} invalid={invalid === k} required={required.has(k)}
              onChange={v => { setVals(o => ({ ...o, [k]: v })); if (invalid === k) setInvalid(null) }} />
          </Row>
        )
      })}
    </>
  )
}

/* ── plugin actions on a selection ── */

/** Actions that apply to these assets; none while the server does not support them yet (`unsupported`). */
export async function actionsFor(lib: string, ids: readonly string[]): Promise<ActionInfo[]> {
  if (!ids.length) return []
  try { return (await api.actions.forSelection(lib, [...ids])).actions }
  catch (e) {
    if (e instanceof BowerbirdApiError && (e.code === 'unsupported' || e.status === 404 || e.status === 501)) return []
    throw e
  }
}

/** The action asks for parameters first (its menu label then ends in「…」, copy.md). */
export function hasParams(a: ActionInfo): boolean {
  const s = a.params as Schema | undefined
  return !!s && Object.keys(s.properties ?? {}).length > 0
}

/** Run an action: its parameter form first when it declares one; the job then shows in 后台处理. */
export async function runPluginAction(a: ActionInfo, ids: readonly string[]): Promise<void> {
  let params: Record<string, unknown> | undefined
  if (hasParams(a)) {
    params = await openDialog<Record<string, unknown>>(close => <ActionForm action={a} n={ids.length} onDone={v => close(v)} />)
    if (!params) return
  }
  await startAction(a, ids, params)
}

async function startAction(a: ActionInfo, ids: readonly string[], params?: Record<string, unknown>): Promise<void> {
  const { lib, go, qc } = rt()
  try {
    await api.actions.run(lib, a.id, { ids: [...ids], ...(params ? { params } : {}) })
    void qc.invalidateQueries({ queryKey: qk.jobs(lib) })
    toast({ title: t('cr.started', { name: pluginText(a.pluginId, a.title) }), action: { label: t('cr.viewJobs'), onClick: () => go(libPath(lib, '/settings/tasks')) } })
  } catch (e) { toastError(e) }
}

function ActionForm({ action: a, n, onDone }: { action: ActionInfo; n: number; onDone: (params?: Record<string, unknown>) => void }) {
  const schema = React.useMemo(() => pluginSchema(a.pluginId, (a.params ?? {}) as Schema), [a])
  const [vals, setVals] = React.useState<Record<string, unknown>>(() => defaults(schema))
  const [invalid, setInvalid] = React.useState<string | null>(null)
  const start = () => { const need = missingRequired(schema, vals); if (need) { setInvalid(need); return } onDone(vals) }
  return (
    <FormDialog
      size="wide"
      title={pluginText(a.pluginId, a.title)}
      onClose={() => onDone()}
      footLeft={<span className="inline-flex items-center gap-1 text-ink-3"><Icon name="puzzle" size={12} />{t('cr.by', { plugin: pluginText(a.pluginId, a.pluginName) })}</span>}
      primary={{ label: t('common.start'), icon: 'sparkles', onClick: start }}
    >
      <div className="grid gap-2">
        {n > 1 && <p className="m-0 mb-1 text-[12px] text-ink-2">{t('act.selected', { n })}</p>}
        <ParamFields schema={schema} vals={vals} setVals={setVals} invalid={invalid} setInvalid={setInvalid} />
      </div>
    </FormDialog>
  )
}

/** Drawn as a text box (or a select), which a wrapping <label> names correctly. */
export function isTextual(s: Schema): boolean {
  if (s.enum) return !(s['x-widget'] === 'segmented' || (s['x-widget'] == null && s.enum.length <= 4))
  return s.type !== 'boolean'
}

function ParamField({ name, schema: s, value, onChange, invalid, required }: { name: string; schema: Schema; value: unknown; onChange: (v: unknown) => void; invalid: boolean; required: boolean }) {
  const widget = s['x-widget']
  if (s.enum && (widget === 'segmented' || (widget == null && s.enum.length <= 4))) {
    return (
      <ToggleGroup type="single" className="justify-self-start" value={value == null ? '' : String(value)} onValueChange={v => { if (!v) return; const raw = s.enum!.find(x => String(x) === v); onChange(raw) }} aria-label={s.title ?? name}>
        {s.enum.map((o, i) => <ToggleGroupItem key={String(o)} value={String(o)}>{enumLabel(s, o, i)}</ToggleGroupItem>)}
      </ToggleGroup>
    )
  }
  if (s.enum) {
    return (
      <select value={value == null ? '' : String(value)} onChange={e => onChange(s.enum!.find(x => String(x) === e.target.value))} aria-label={s.title ?? name}
        className="h-7 rounded-sm border-0 bg-fill-rest px-2 text-ink-1 outline-none focus-visible:outline-2 focus-visible:outline-accent-ring">
        {s.enum.map((o, i) => <option key={String(o)} value={String(o)}>{enumLabel(s, o, i)}</option>)}
      </select>
    )
  }
  if (s.type === 'boolean') return <Switch checked={!!value} onCheckedChange={onChange} aria-label={s.title ?? name} />
  if (s.type === 'number' || s.type === 'integer') {
    return <Input className="max-w-[140px]" inputMode="numeric" value={value == null ? '' : String(value)} placeholder={s['x-placeholder'] ?? ''} data-invalid={invalid || undefined} aria-label={s.title ?? name}
      onChange={e => { const v = e.target.value.trim(); onChange(v === '' ? undefined : Number.isNaN(Number(v)) ? v : Number(v)) }} />
  }
  if (widget === 'textarea' || s.format === 'textarea') {
    return <Textarea rows={3} value={value == null ? '' : String(value)} placeholder={required ? t('common.required') : s['x-placeholder'] ?? ''} data-invalid={invalid || undefined} aria-label={s.title ?? name} onChange={e => onChange(e.target.value)} />
  }
  return <Input value={value == null ? '' : String(value)} placeholder={required ? t('common.required') : s['x-placeholder'] ?? ''} data-invalid={invalid || undefined} aria-label={s.title ?? name} onChange={e => onChange(e.target.value)} />
}
