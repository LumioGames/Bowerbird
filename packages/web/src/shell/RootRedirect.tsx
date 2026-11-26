import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from 'react-router'
import type { LibrariesResponse } from '@bowerbird/schema'
import { Button, Toaster } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { lastLibrary } from '../lib/library'
import { useResolvedTheme } from '../lib/theme'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { DialogHost } from '../overlays/dialogs'
import { LibraryChoices, newLibraryFlow, openFolderFlow, type LibraryChoice } from '../flows/library'
import { libPath } from './runtime'
import './shell.css'

/**
 * Root `/`: open this browser's last library, or the only one; none registered → the first-run page: what Bowerbird
 * is, and the two ways to a library (打开文件夹 / 新建资产库), each with its folder chooser (ADR-026, ADR-033).
 */
export function pickLibrary(res: LibrariesResponse, last: string | null): string | null {
  const ids = res.libraries.map(l => l.id)
  if (last && ids.includes(last)) return last
  if (ids.length === 1) return ids[0]!
  if (res.defaultId && ids.includes(res.defaultId)) return res.defaultId
  return ids[0] ?? null
}

export function RootRedirect() {
  const libs = useQuery({ queryKey: qk.libraries(), queryFn: () => api.libraries.list() })
  const navigate = useNavigate()
  const theme = useResolvedTheme()
  if (libs.isLoading) return <div className="grid h-full place-items-center text-ink-3"><Icon name="loader" className="bb-spin" /></div>
  if (libs.isError) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState icon="unlink" title={t('empty.offline')} body={<span className="font-mono">{location.host}</span>}
          action={<Button variant="primary" onClick={() => void libs.refetch()}><Icon name="refresh-cw" />{t('empty.retry')}</Button>} />
      </div>
    )
  }
  const id = libs.data ? pickLibrary(libs.data, lastLibrary()) : null
  if (id) return <Navigate to={libPath(id)} replace />
  const pick = (k: LibraryChoice) => void (k === 'open' ? openFolderFlow : newLibraryFlow)(p => navigate(p)).then(() => void libs.refetch())
  return (
    <div className="h-full overflow-auto bg-surface-canvas">
      <Welcome onPick={pick} />
      <DialogHost />
      <Toaster theme={theme} />
    </div>
  )
}

/** The first-run page: the product name, one sentence on what it does, the two choices. */
export function Welcome({ onPick }: { onPick: (k: LibraryChoice) => void }) {
  return (
    <main className="bb-dots grid min-h-full place-items-center px-4 py-12">
      <div className="grid w-full max-w-[560px] gap-6">
        <header className="grid justify-items-center gap-1.5 text-center">
          <h1 className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.015em] text-ink-1">{t('app.name')}</h1>
          <p className="m-0 max-w-[540px] text-balance text-ink-2">{t('welcome.text')}</p>
        </header>
        <LibraryChoices onPick={onPick} />
      </div>
    </main>
  )
}
