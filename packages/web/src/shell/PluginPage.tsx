import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { PageFrame } from '../components/PageFrame'
import { usePluginRegistry, PluginSlot } from '../plugins/registry'
import { t } from '../lib/i18n'
import { useLibraryId } from '../lib/library'
import { libPath } from './runtime'
import { pluginText } from '../plugins/text'

/**
 * A plugin's own page (ui.pages slot), e.g. a creator with its own interface or a follow-up such as「挑选…」
 * (ADR-042: `/libraries/<lib>/plugins/<plugin>/<page>?job=…`). Query parameters become the page's `params`.
 */
export function PluginPage() {
  const { plugin = '', page = '' } = useParams()
  const [sp] = useSearchParams()
  const lib = useLibraryId()
  const navigate = useNavigate()
  const reg = usePluginRegistry()
  // the page says which plugin it belongs to by the plugin's name (「Forge」), not its id
  const plugins = useQuery({ queryKey: qk.plugins(), queryFn: () => api.plugins.list() })
  const pluginName = pluginText(plugin, plugins.data?.plugins.find(p => p.id === plugin)?.displayName ?? plugin)
  const def = reg.ui.pages.find(p => p.pluginId === plugin && (p.id === page || p.id === `${plugin}:${page}`))
  const back = () => (history.length > 1 ? navigate(-1) : navigate(libPath(lib)))
  if (!def) {
    return (
      <PageFrame
        title={pluginName}
        onBack={back}
        state={reg.ready ? 'empty' : 'loading'}
        empty={{ icon: 'puzzle', title: t('plugin.missingPage'), body: t('plugin.missingPageText') }}
      />
    )
  }
  const params = Object.fromEntries(sp.entries())
  return (
    <PageFrame title={def.title} subtitle={pluginName} onBack={back}>
      <PluginSlot pluginId={plugin} component={def.Component} props={{ params }} />
    </PageFrame>
  )
}
