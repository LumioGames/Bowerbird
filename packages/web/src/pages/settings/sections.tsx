import * as React from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { LibraryInfo, Stage } from '@bowerbird/schema'
import { Banner } from '../../components/Banner'
import { Icon } from '../../components/Icon'
import { api } from '../../lib/api'
import { actorName, setActorName } from '../../lib/actor'
import { LOCALES, getLocale, setLocalePref, systemLocale, t, useLocalePref, type LocalePref } from '../../lib/i18n'
import { qk } from '../../lib/keys'
import { setThemePref, useThemePref, type ThemePref } from '../../lib/theme'
import { confirm } from '../../overlays/dialogs'
import { toast } from '../../overlays/toast'
import { Btn, Mono, Num, Seg } from '../shared/ui'
import { Menu } from '../shared/menu'
import { errText, fmtSize } from '../shared/text'
import { useCache, useConfig, usePlugins } from '../shared/queries'
import { pluginText } from '../../plugins/text'
import { Card, Code, Heading, Row, SavedInput, copyText, intIn } from './parts'

const isLoopback = (host: string | undefined) => !host || host === '127.0.0.1' || host === 'localhost' || host === '::1'

/** 资产库: name, default stage, trash days, cache and cleaning, plugins the library needs (missing ones in yellow). */
export function LibrarySection({ lib, info }: { lib: string; info: LibraryInfo }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const cache = useCache(lib)
  const plugins = usePlugins()
  const settings = info.settings ?? { defaultStage: 'production', agentSearchScope: 'all', trashDays: 7 }
  const patch = async (body: Parameters<typeof api.libraries.patch>[1]) => { await api.libraries.patch(lib, body); void qc.invalidateQueries({ queryKey: qk.library(lib) }) }
  const [stageErr, setStageErr] = React.useState<string | null>(null)
  const setStage = async (s: Stage) => {
    try { await patch({ settings: { defaultStage: s } }); setStageErr(null) }
    catch (e) { const m = t('set.saveFailed', { reason: errText(e) }); setStageErr(m); toast({ kind: 'error', title: m }) }
  }
  const clean = async () => {
    const size = cache.data ? fmtSize(cache.data.bytes) : '—'
    const ok = await confirm({ title: t('set.cache.title'), body: t('set.cache.text', { size }), confirmLabel: t('set.cache.confirm') })
    if (!ok) return
    try { const r = await api.libraries.cleanCache(lib, { all: true }); void qc.invalidateQueries({ queryKey: qk.cache(lib) }); toast({ kind: 'success', title: t('set.cache.done', { size: fmtSize(r.removedBytes) }) }) }
    catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const nameOf = (id: string) => pluginText(id, plugins.data?.plugins.find(p => p.id === id)?.displayName ?? id)
  return (
    <>
      <Heading title={t('set.library')} sub={t('set.library.sub')} />
      <Card>
        <Row k={t('set.lib.name')} id="name">
          <SavedInput ariaLabel={t('set.lib.nameLabel')} value={info.name} validate={v => (v.trim() ? null : t('set.lib.nameEmpty'))} save={v => patch({ name: v.trim() })} />
        </Row>
        <Row k={t('set.lib.stage')} note={t('set.lib.stageNote')} error={stageErr} id="stage">
          <Seg<Stage> label={t('set.lib.stageLabel')} value={settings.defaultStage} onChange={s => void setStage(s)}
            items={[{ value: 'reference', label: t('w2.stage.short.reference') }, { value: 'production', label: t('w2.stage.short.production') }, { value: 'runtime', label: t('w2.stage.short.runtime') }]} />
        </Row>
        <Row k={t('set.lib.trash')} id="trash">
          <SavedInput className="w2-st__in--num" inputMode="numeric" ariaLabel={t('set.lib.trashLabel')} value={String(settings.trashDays)} validate={intIn(1, 3650)} save={v => patch({ settings: { trashDays: Number(v) } })} />
          <span>{t('set.days')}</span>
        </Row>
        <Row k={t('set.lib.cache')} note={t('set.lib.cacheNote')} id="cache">
          <Mono>{cache.data && !cache.data.inLibrary ? cache.data.dir : '.bowerbird/cache/'}</Mono>
          <span className="w2-st__val">{cache.data ? fmtSize(cache.data.bytes) : '…'}</span>
          <Btn size="sm" onClick={() => void clean()}>{t('set.cache.clean')}</Btn>
        </Row>
        {info.requiredPlugins.length > 0 && (
          <Row k={t('set.lib.plugins')} id="plugins">
            {info.requiredPlugins.map(p => (
              <button key={p.id} type="button" className={p.installed ? 'w2-st__chip' : 'w2-st__chip warn'} title={`${p.id} ${p.range}`}
                onClick={() => navigate(`/libraries/${encodeURIComponent(lib)}/settings/${p.installed && p.enabled ? encodeURIComponent(p.id) : `plugins?focus=${encodeURIComponent(p.id)}`}`)}>
                <Icon name="puzzle" size={12} />{nameOf(p.id)}{p.installed ? '' : ` · ${t('set.lib.notInstalled')}`}
              </button>
            ))}
          </Row>
        )}
      </Card>
    </>
  )
}

const SCAN_STEPS = [5, 10, 15, 30, 60]

/** 本机: your name, listen address (LAN needs a confirm, then a standing warning), port, scan interval, concurrency, language, theme. */
export function MachineSection({ info }: { info: LibraryInfo }) {
  const qc = useQueryClient()
  const cfg = useConfig()
  const theme = useThemePref()
  const [name, setName] = React.useState(actorName())
  const c = cfg.data?.config
  const lan = c ? !isLoopback(c.host) : info.lanOpen
  const [netErr, setNetErr] = React.useState<string | null>(null)
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 8
  const [conc, setConc] = React.useState<number | null>(null)
  const patch = async (body: Parameters<typeof api.config.patch>[0]) => {
    const r = await api.config.patch(body)
    qc.setQueryData(qk.config(), r)
    void qc.invalidateQueries({ queryKey: ['lib'] })
    if (r.restartRequired) toast({ kind: 'info', title: t('set.restart') })
    return r
  }
  const setLan = async (v: 'local' | 'lan') => {
    if ((v === 'lan') === lan) return
    if (v === 'lan') {
      const ok = await confirm({ title: t('set.lan.title'), body: t('set.lan.text'), confirmLabel: t('set.lan.confirm'), danger: true })
      if (!ok) return
    }
    try { await patch({ host: v === 'lan' ? '0.0.0.0' : '127.0.0.1' }); setNetErr(null) }
    catch (e) { const m = t('set.saveFailed', { reason: errText(e) }); setNetErr(m); toast({ kind: 'error', title: m }) }
  }
  const saveConc = async (n: number) => {
    try { await patch({ concurrency: n }) } catch (e) { toast({ kind: 'error', title: t('set.saveFailed', { reason: errText(e) }) }); setConc(null) }
  }
  const pref = useLocalePref()
  // 「跟随系统」first (shows which language that is now), then each language in its own name
  const sys = LOCALES.find(l => l.id === systemLocale())?.name ?? ''
  const locales: Array<[LocalePref, string]> = [['auto', t('set.m.langAuto', { name: sys })], ...LOCALES.map(l => [l.id, l.name] as [LocalePref, string])]
  return (
    <>
      <Heading title={t('set.machine')} sub={t('set.machine.sub')} />
      <Card>
        <Row k={t('set.m.name')} note={t('set.m.nameNote')} id="name">
          <input className="w2-st__in" value={name} placeholder={t('w2.common.unnamed')} aria-label={t('set.m.name')}
            onChange={e => setName(e.target.value)} onBlur={() => setActorName(name)} onKeyDown={e => { if (e.key === 'Enter') setActorName(name) }} />
        </Row>
        <Row k={t('set.m.listen')} error={netErr} id="listen">
          <Seg<'local' | 'lan'> label={t('set.m.listen')} value={lan ? 'lan' : 'local'} onChange={v => void setLan(v)}
            items={[{ value: 'local', label: t('set.m.local') }, { value: 'lan', label: t('set.m.lan') }]} />
          <SavedInput className="w2-st__in--port" inputMode="numeric" ariaLabel={t('set.m.port')} value={String(c?.port ?? 7420)} validate={intIn(1, 65535)} save={v => patch({ port: Number(v) })} />
        </Row>
        {lan && (
          <div className="w2-st__warn">
            <Banner tone="danger" title={t('set.lanWarn.title')}>{t('set.lanWarn.text', { address: info.address })}</Banner>
          </div>
        )}
        <Row k={t('set.m.scan')} id="scan">
          <Menu trigger={<button type="button" className="w2-btn">{t('set.m.every', { n: c?.scanIntervalMinutes ?? 10 })}<Icon name="chevron-down" size={12} /></button>}
            items={SCAN_STEPS.map(n => ({ label: t('set.m.every', { n }), check: (c?.scanIntervalMinutes ?? 10) === n, onSelect: () => void patch({ scanIntervalMinutes: n }).catch(e => toast({ kind: 'error', title: t('set.saveFailed', { reason: errText(e) }) })) }))} />
        </Row>
        <Row k={t('set.m.concurrency')} id="concurrency">
          <input type="range" className="w-40 accent-[var(--accent-fill)]" min={1} max={Math.max(2, cores)} value={conc ?? c?.concurrency ?? Math.max(1, cores - 1)} aria-label={t('set.m.concurrency')}
            onChange={e => setConc(Number(e.target.value))} onPointerUp={() => conc && void saveConc(conc)} onKeyUp={() => conc && void saveConc(conc)} />
          <Num>{conc ?? c?.concurrency ?? Math.max(1, cores - 1)}</Num>
        </Row>
        {/* findable in any language: a globe and the word "Language" next to the translated name (ADR-061) */}
        <Row k={<span className="inline-flex items-center gap-1.5"><Icon name="globe" size={12} />{t('set.m.lang')}</span>} note={getLocale() === 'en' ? undefined : 'Language'} id="lang">
          <Menu trigger={<button type="button" className="w2-btn">{locales.find(l => l[0] === pref)?.[1]}<Icon name="chevron-down" size={12} /></button>}
            items={locales.map(([l, n]) => ({ label: n, check: pref === l, onSelect: () => setLocalePref(l) }))} />
        </Row>
        <Row k={t('set.m.theme')} id="theme">
          <Seg<ThemePref> label={t('set.m.theme')} value={theme} onChange={setThemePref}
            items={[{ value: 'system', label: t('set.m.theme.system') }, { value: 'dark', label: t('set.m.theme.dark') }, { value: 'light', label: t('set.m.theme.light') }]} />
        </Row>
      </Card>
    </>
  )
}

/** Agent 接入: the address (copy), the default search scope, the agent name convention, MCP config, CLI examples. */
export function AgentSection({ lib, info }: { lib: string; info: LibraryInfo }) {
  const qc = useQueryClient()
  const base = (info.address || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '')
  const url = `${base}/api/v1/libraries/${info.id}`
  const scope = info.settings?.agentSearchScope ?? 'all'
  const [err, setErr] = React.useState<string | null>(null)
  const setScope = async (v: 'all' | 'approved') => {
    try { await api.libraries.patch(lib, { settings: { agentSearchScope: v } }); setErr(null); void qc.invalidateQueries({ queryKey: qk.library(lib) }) }
    catch (e) { const m = t('set.saveFailed', { reason: errText(e) }); setErr(m); toast({ kind: 'error', title: m }) }
  }
  const mcp = JSON.stringify({ mcpServers: { bowerbird: { command: 'bb', args: ['mcp', '--url', base, '--library', info.id] } } }, null, 2)
  const cli = ['bb search "宝箱 stage:runtime format:model"', 'bb trace props/chest/chest.glb', 'bb add chest_icon.png --folder props/chest --source chest.glb --by agent:modeler'].join('\n')
  return (
    <>
      <Heading title={t('set.agent')} sub={t('set.agent.sub')} />
      <Card>
        <Row k={t('set.a.url')} id="url"><Mono>{url}</Mono><Btn size="sm" variant="ghost" icon="copy" onClick={() => void copyText(url)}>{t('set.copy')}</Btn></Row>
        <Row k={t('set.a.scope')} error={err} id="scope">
          <Seg<'all' | 'approved'> label={t('set.a.scope')} value={scope} onChange={v => void setScope(v)}
            items={[{ value: 'all', label: t('set.a.scope.all') }, { value: 'approved', label: t('set.a.scope.approved') }]} />
        </Row>
        <Row k={t('set.a.name')} note={t('set.a.nameNote')} id="agent-name"><Mono>agent:&lt;{t('set.a.nameVar')}&gt;</Mono></Row>
      </Card>
      <h3 className="w2-st__h3">MCP</h3>
      <Code text={mcp} label="MCP" />
      <h3 className="w2-st__h3">{t('set.a.cli')}</h3>
      <Code text={cli} label={t('set.a.cli')} />
    </>
  )
}
