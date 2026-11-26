import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { t, useLocale } from '../lib/i18n'
import { useLibrary, useLibraryId } from '../lib/library'
import { Icon } from '../components/Icon'
import { PageFrame } from '../components/PageFrame'
import { useInspectorTarget } from '../shell/inspector-target'
import { usePluginRegistry } from '../plugins/registry'
import { usePlugins } from './shared/queries'
import { pluginText } from '../plugins/text'
import { AgentSection, LibrarySection, MachineSection } from './settings/sections'
import { PluginSettingsSection, PluginsSection, hasSettings, pluginIcon } from './settings/plugins'
import { TasksSection } from './settings/tasks'

export const SECTIONS = [
  { id: 'library', icon: 'hard-drive' },
  { id: 'machine', icon: 'settings' },
  { id: 'agent', icon: 'bot' },
  { id: 'plugins', icon: 'puzzle' },
  { id: 'tasks', icon: 'activity' }
] as const

/**
 * 设置 `/settings/:section` (pages.md 设置): left navigation — 资产库、本机、Agent 接入、插件、任务, then「插件设置」
 * with every enabled plugin that has settings — its section is the plugin id itself (`/settings/community.forge`, the
 * same as a plugin's `navigate({ to: 'settings', section: '<plugin id>' })`). `?focus=<plugin id>` highlights one plugin
 * (完整性「去安装」).
 */
export function SettingsPage() {
  useLocale()
  const lib = useLibraryId()
  const { section = 'library' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const info = useLibrary()
  const plugins = usePlugins()
  const reg = usePluginRegistry()
  useInspectorTarget({ kind: 'none' }, [])
  const go = (s: string) => navigate(`/libraries/${encodeURIComponent(lib)}/settings/${s}`, { replace: true })
  const back = () => { if (location.key !== 'default') navigate(-1); else navigate(`/libraries/${encodeURIComponent(lib)}`) }
  const withSettings = (plugins.data?.plugins ?? []).filter(p => hasSettings(p, reg.ui.settingsPages))
  const warn = (plugins.data?.plugins ?? []).some(p => p.status === 'failed' || p.missingTools.length > 0 || !!p.consecutiveFailures) || (info.data?.requiredPlugins ?? []).some(r => !r.installed)
  const pluginId = SECTIONS.some(s => s.id === section) ? null : decodeURIComponent(section.replace(/^plugin:/, ''))

  return (
    <PageFrame title={t('set.title')} onBack={back} state={info.isPending ? 'loading' : info.isError ? 'error' : 'ready'} onRetry={() => void info.refetch()}>
      <div className="w2-st">
        <nav className="w2-st__nav" aria-label={t('set.title')}>
          {SECTIONS.map(s => (
            <button key={s.id} type="button" className="w2-st__n" aria-current={section === s.id ? 'page' : undefined} data-onboard={s.id === 'machine' ? 'set.machine' : undefined} onClick={() => go(s.id)}>
              <Icon name={s.icon} size={12} />{t(`set.${s.id}`)}{s.id === 'plugins' && warn && <i className="w2-st__dot" aria-label={t('set.p.attention')} />}
            </button>
          ))}
          {withSettings.length > 0 && <div className="w2-st__nl">{t('set.pluginSettings')}</div>}
          {withSettings.map(p => (
            <button key={p.id} type="button" className="w2-st__n" aria-current={pluginId === p.id ? 'page' : undefined} onClick={() => go(encodeURIComponent(p.id))}>
              <Icon name={pluginIcon(p)} size={12} />{pluginText(p.id, p.displayName)}
            </button>
          ))}
        </nav>
        <div className="w2-st__body">
          {info.data && (
            pluginId ? <PluginSettingsSection lib={lib} pluginId={pluginId} />
              : section === 'machine' ? <MachineSection info={info.data} />
              : section === 'agent' ? <AgentSection lib={lib} info={info.data} />
              : section === 'plugins' ? <PluginsSection lib={lib} info={info.data} focus={params.get('focus')} />
              : section === 'tasks' ? <TasksSection lib={lib} />
              : <LibrarySection lib={lib} info={info.data} />
          )}
        </div>
      </div>
    </PageFrame>
  )
}
