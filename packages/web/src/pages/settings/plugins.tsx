import * as React from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LibraryInfo, PluginInfo } from '@bowerbird/schema'
import { cn, Switch } from '@bowerbird/plugin-sdk/web'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/keys'
import { Icon } from '../../components/Icon'
import { confirm } from '../../overlays/dialogs'
import { toast } from '../../overlays/toast'
import { PluginSlot, usePluginRegistry } from '../../plugins/registry'
import { enumLabel, pluginSchema, pluginText } from '../../plugins/text'
import { Btn, Mono, Skeleton, Tag } from '../shared/ui'
import { promptText } from '../shared/dialogs'
import { errText } from '../shared/text'
import { KIND_ICON, kindOf } from '../shared/kinds'
import { usePlugins } from '../shared/queries'
import { Card, Heading, Row } from './parts'

export type PluginState = 'enabled' | 'disabled' | 'failed' | 'missing'
const STATE_CLASS: Record<PluginState, string> = { enabled: 'ok', disabled: 'off', failed: 'bad', missing: 'warn' }

export function pluginIcon(p: Pick<PluginInfo, 'formats' | 'contributes' | 'id'>): string {
  if (p.formats[0]) return KIND_ICON[kindOf({ format: p.formats[0].id })] === 'file' ? 'puzzle' : KIND_ICON[kindOf({ format: p.formats[0].id })]
  if (p.contributes.includes('versionStore')) return p.id.includes('lore') ? 'git-fork' : 'hard-drive'
  if (p.contributes.includes('searchProviders')) return 'search'
  if (p.contributes.includes('creators')) return 'sparkles'
  return 'puzzle'
}

/** Whether a plugin has a settings page here: a settings schema with properties, or its own settings pages. */
export function hasSettings(p: PluginInfo, pages: Array<{ pluginId: string }>): boolean {
  const props = (p.settings as { properties?: Record<string, unknown> } | null)?.properties
  return p.status === 'enabled' && (!!(props && Object.keys(props).length) || pages.some(x => x.pluginId === p.id))
}

/**
 * 插件 (pages.md 设置「插件」): the fixed trust note; enabled / disabled / failed (with the reason) / needed by the
 * library but not installed (安装) / missing external tools / repeated failures (warn only, never disabled);
 * update (confirm); built-ins cannot be disabled;「安装插件…」takes an npm name or a local path.
 */
export function PluginsSection({ lib, info, focus }: { lib: string; info: LibraryInfo; focus: string | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = usePlugins()
  const reg = usePluginRegistry()
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.plugins() }); void qc.invalidateQueries({ queryKey: ['lib'] }) }
  const focusRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => { focusRef.current?.scrollIntoView?.({ block: 'center' }) }, [focus, q.data])

  const install = async (spec: string, name?: string) => {
    toast({ title: t('set.p.installing', { spec }) })
    try { await api.plugins.install(spec); refresh(); toast({ kind: 'success', title: t('set.p.installed', { name: name ?? spec }) }) }
    catch (e) { toast({ kind: 'error', title: t('set.p.installFailed', { name: name ?? spec, reason: errText(e) }) }) }
  }
  const addPlugin = async () => {
    const spec = await promptText({
      title: t('set.p.addTitle'), placeholder: t('set.p.addPh'), label: t('set.p.addPh'), confirmLabel: t('set.p.install'),
      hint: <><p className="w2-hint">{t('set.p.addHint')}</p><p className="w2-hint flex items-center gap-1"><Icon name="shield-check" size={12} />{t('set.p.trustShort')}</p></>
    })
    if (spec) await install(spec)
  }
  const act = async (raw: PluginInfo, k: 'install' | 'reload' | 'update' | 'toggle') => {
    const p = { ...raw, displayName: pluginText(raw.id, raw.displayName) }
    try {
      if (k === 'install') {
        const ok = await confirm({ title: t('set.p.installOne', { name: p.displayName }), body: t('set.p.installOneText', { spec: `${p.packageName}${p.required ? ` ${p.required}` : ''}` }), confirmLabel: t('set.p.install') })
        if (ok) await install(p.packageName || p.id, p.displayName)
        return
      }
      if (k === 'reload') {
        const r = await api.plugins.enable(p.id, lib)
        refresh()
        const now = r.plugins.find(x => x.id === p.id)
        toast(now?.status === 'failed' ? { kind: 'error', title: t('set.p.stillFailed', { name: p.displayName, reason: now.reason ?? '' }) } : { kind: 'success', title: t('set.p.enabled', { name: p.displayName }) })
        return
      }
      if (k === 'update') {
        const ok = await confirm({ title: t('set.p.updateTitle', { name: p.displayName, v: p.update?.version ?? '' }), body: t('set.p.updateText'), confirmLabel: t('set.p.update') })
        if (!ok) return
        await api.plugins.update(p.id); refresh()
        toast({ kind: 'success', title: t('set.p.updated', { name: p.displayName, v: p.update?.version ?? '' }) })
        return
      }
      if (p.status === 'enabled') { await api.plugins.disable(p.id, lib); toast({ title: t('set.p.disabled', { name: p.displayName }) }) }
      else { await api.plugins.enable(p.id, lib); toast({ kind: 'success', title: t('set.p.enabled', { name: p.displayName }) }) }
      refresh()
    } catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }

  if (q.isPending) return <Skeleton rows={4} />
  if (q.isError) return <Card><Row k={t('common.loadFailed')}><Btn size="sm" onClick={() => void q.refetch()}>{t('w2.common.retry')}</Btn></Row></Card>
  /* plugins the library needs that this machine does not have yet are listed too */
  const list: PluginInfo[] = [...q.data.plugins]
  for (const r of info.requiredPlugins) if (!r.installed && !list.some(p => p.id === r.id)) {
    list.push({ id: r.id, packageName: r.id, version: null, displayName: r.id, builtin: false, status: 'missing', required: r.range, contributes: [], formats: [], hasWeb: false, settings: null, missingTools: [], consecutiveFailures: null, update: null, source: 'npm' })
  }
  return (
    <>
      <Heading title={t('set.plugins')} sub={t('set.p.sub', { n: list.length })}>
        <span className="w2-grow" />
        <Btn size="sm" icon="plus" onClick={() => void addPlugin()}>{t('set.p.add')}</Btn>
      </Heading>
      <div className="w2-st__trust"><Icon name="shield-check" size={12} />{t('set.p.trust')}</div>
      <div className="w2-st__plugs">
        {list.map(p => {
          const st = p.status as PluginState
          const focused = focus === p.id
          return (
            <div key={p.id} ref={focused ? focusRef : undefined} className={cn('w2-pl', focused && 'w2-pl--focus')} data-plugin={p.id}>
              <span className="w2-pl__ic"><Icon name={pluginIcon(p)} /></span>
              <div className="w2-pl__m">
                <b>{pluginText(p.id, p.displayName)}{p.builtin && <Tag small>{t('set.p.builtin')}</Tag>}</b>
                <small className="w2-mono">{p.id}{p.version ? ` · ${p.version}` : p.required ? ` · ${p.required}` : ''}</small>
                {(p.formats.length > 0 || p.contributes.length > 0) && (
                  <div className="w2-pl__caps">{(p.formats.length ? p.formats.flatMap(f => f.extensions.map(x => x.slice(1).toUpperCase())) : p.contributes).map(c => <span key={c}>{c}</span>)}</div>
                )}
                {st === 'failed' && p.reason && <p className="w2-pl__why"><Icon name="circle-alert" size={12} />{p.reason}</p>}
                {st === 'missing' && <p className="w2-pl__why w2-pl__why--warn"><Icon name="puzzle" size={12} />{t('set.p.neededBy', { range: p.required ?? '' })}</p>}
                {p.missingTools.map(tool => <p key={tool} className="w2-pl__why w2-pl__why--warn"><Icon name="triangle-alert" size={12} />{t('set.p.missingTool', { tool })}</p>)}
                {p.consecutiveFailures && <p className="w2-pl__why w2-pl__why--warn"><Icon name="triangle-alert" size={12} />{t('set.p.failures', { n: p.consecutiveFailures.count, reason: pluginText(p.id, p.consecutiveFailures.reason) })}</p>}
              </div>
              <div className="w2-pl__r">
                <span className={`w2-pl__st w2-pl__st--${STATE_CLASS[st]}`}>{t(`set.p.state.${st}`)}</span>
                {st === 'missing' && <Btn size="sm" variant="primary" onClick={() => void act(p, 'install')}>{t('set.p.install')}</Btn>}
                {st === 'failed' && <Btn size="sm" onClick={() => void act(p, 'reload')}>{t('set.p.reload')}</Btn>}
                {(st === 'enabled' || st === 'disabled') && <>
                  {p.update && <Btn size="sm" onClick={() => void act(p, 'update')}>{t('set.p.updateTo', { v: p.update.version })}</Btn>}
                  {!p.builtin && <Switch checked={st === 'enabled'} onCheckedChange={() => void act(p, 'toggle')} aria-label={t('set.p.toggle', { name: pluginText(p.id, p.displayName) })} />}
                  {hasSettings(p, reg.ui.settingsPages) && <Btn size="sm" variant="ghost" onClick={() => navigate(`/libraries/${encodeURIComponent(lib)}/settings/${encodeURIComponent(p.id)}`)}>{t('set.p.settings')}</Btn>}
                </>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

interface Prop { key: string; title: string; description?: string; type: string; enum?: unknown[]; enumNames?: string[]; minimum?: number; maximum?: number; format?: string; scope: 'library' | 'machine'; secret: boolean; required: boolean; default?: unknown }

/** Properties of a plugin settings JSON Schema; credentials are always machine-only (plugin-system.md 设置). */
export function schemaProps(schema: Record<string, unknown> | null): Prop[] {
  const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>
  const req = new Set((schema?.required as string[] | undefined) ?? [])
  return Object.entries(props).map(([key, p]) => {
    const secret = p.format === 'password' || p.secret === true || p.credential === true || p.writeOnly === true
    return {
      key, title: String(p.title ?? key), description: p.description as string | undefined, type: String(p.type ?? 'string'),
      enum: p.enum as unknown[] | undefined, enumNames: (p.enumNames ?? p['x-enumNames']) as string[] | undefined, minimum: p.minimum as number | undefined, maximum: p.maximum as number | undefined, format: p.format as string | undefined,
      scope: secret ? 'machine' : p.scope === 'library' ? 'library' : 'machine', secret, required: req.has(key), default: p.default
    }
  })
}

export function validateProp(p: Prop, raw: string): string | null {
  if (!raw.trim()) return p.required ? t('set.ps.required') : null
  if (p.type === 'number' || p.type === 'integer') {
    const n = Number(raw)
    if (!Number.isFinite(n) || (p.type === 'integer' && !Number.isInteger(n))) return t('set.ps.number')
    if (p.minimum != null && n < p.minimum) return t('set.ps.min', { n: p.minimum })
    if (p.maximum != null && n > p.maximum) return t('set.ps.max', { n: p.maximum })
  }
  return null
}

/**
 * 插件设置: a form generated from the manifest's JSON Schema; each item says where it is kept —「随资产库」or
 * 「只在本机」— and credentials only ever on this machine; then the plugin's own settings pages.
 */
export function PluginSettingsSection({ lib, pluginId }: { lib: string; pluginId: string }) {
  const qc = useQueryClient()
  const plugins = usePlugins()
  const reg = usePluginRegistry()
  const p = plugins.data?.plugins.find(x => x.id === pluginId)
  const machine = useQuery({ queryKey: ['plugins', pluginId, 'settings'], queryFn: () => api.plugins.machineSettings(pluginId), enabled: !!p })
  const library = useQuery({ queryKey: ['lib', lib, 'plugin-settings', pluginId], queryFn: () => api.plugins.librarySettings(lib, pluginId), enabled: !!p })
  const [errs, setErrs] = React.useState<Record<string, string | null>>({})
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  if (plugins.isPending) return <Skeleton rows={3} />
  if (!p) return <Heading title={pluginId} />
  // the settings form in the shell's language (the plugin's manifest translations)
  const props = schemaProps(pluginSchema(p.id, p.settings))
  const pages = reg.ui.settingsPages.filter(x => x.pluginId === pluginId)
  const valueOf = (x: Prop) => ((x.scope === 'library' ? library.data?.values : machine.data?.values) ?? {})[x.key] ?? x.default
  const save = async (x: Prop, v: unknown) => {
    const cur = { ...((x.scope === 'library' ? library.data?.values : machine.data?.values) ?? {}), [x.key]: v }
    try {
      if (x.scope === 'library') { await api.plugins.putLibrarySettings(lib, pluginId, cur); void qc.invalidateQueries({ queryKey: ['lib', lib, 'plugin-settings', pluginId] }) }
      else { await api.plugins.putMachineSettings(pluginId, cur); void qc.invalidateQueries({ queryKey: ['plugins', pluginId, 'settings'] }) }
      setErrs(e => ({ ...e, [x.key]: null }))
    } catch (e) { const m = t('set.saveFailed', { reason: errText(e) }); setErrs(s => ({ ...s, [x.key]: m })); toast({ kind: 'error', title: m }) }
  }
  const commitText = (x: Prop) => {
    const raw = draft[x.key]
    if (raw === undefined) return
    const err = validateProp(x, raw)
    if (err) { setErrs(e => ({ ...e, [x.key]: err })); return }
    void save(x, x.type === 'number' || x.type === 'integer' ? (raw.trim() ? Number(raw) : undefined) : raw)
  }
  return (
    <>
      <Heading icon={<Icon name={pluginIcon(p)} />} title={pluginText(p.id, p.displayName)} sub={<Mono>{p.id} {p.version ?? ''}</Mono>} />
      {props.length > 0 && (
        <Card>
          {props.map(x => {
            const v = valueOf(x)
            let control: React.ReactNode
            if (x.type === 'boolean') control = <Switch checked={!!v} onCheckedChange={c => void save(x, c)} aria-label={x.title} />
            else if (x.enum) control = (
              <select className="w2-st__in" value={String(v ?? '')} aria-label={x.title} onChange={e => void save(x, x.enum!.find(o => String(o) === e.target.value))}>
                {x.enum.map((o, i) => <option key={String(o)} value={String(o)}>{enumLabel(x, o, i)}</option>)}
              </select>
            )
            else control = (
              <input className={cn('w2-st__in', (x.type === 'number' || x.type === 'integer') && 'w2-st__in--num')} type={x.secret ? 'password' : 'text'} aria-label={x.title}
                value={draft[x.key] ?? (v == null ? '' : String(v))} aria-invalid={errs[x.key] ? true : undefined} autoComplete={x.secret ? 'new-password' : 'off'}
                onChange={e => { setDraft(d => ({ ...d, [x.key]: e.target.value })); if (errs[x.key]) setErrs(s => ({ ...s, [x.key]: validateProp(x, e.target.value) })) }}
                onBlur={() => commitText(x)} onKeyDown={e => { if (e.key === 'Enter') commitText(x) }} />
            )
            return <Row key={x.key} k={x.title} note={x.description} error={errs[x.key]} scope={x.scope} id={x.key}>{control}</Row>
          })}
        </Card>
      )}
      {pages.map(pg => (
        <Card key={pg.id}><h3 className="w2-st__h3">{pg.title}</h3>
          <PluginSlot pluginId={pluginId} component={pg.Component} props={{}} />
        </Card>
      ))}
    </>
  )
}
