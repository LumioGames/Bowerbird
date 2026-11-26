import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { applyTheme, useThemePref } from '../lib/theme'
import { useLocale } from '../lib/i18n'
import { router } from './routes'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } }
})

/**
 * Development fixtures (sample library「星落镇」from the prototype's data.js) stand in for the server only when
 * asked for explicitly in a development build: `?fixtures` in the address (or `?fixtures=100k` for the virtual
 * scrolling benchmark), or `VITE_BB_FIXTURES=1`. Production builds drop this branch (import.meta.env.DEV is false).
 */
function wantFixtures(): string | null {
  if (!import.meta.env.DEV) return null
  try {
    const sp = new URLSearchParams(location.search)
    if (sp.has('fixtures')) { sessionStorage.setItem('bowerbird.fixtures', sp.get('fixtures') || '1'); return sp.get('fixtures') || '1' }
    if (sp.has('nofixtures')) { sessionStorage.removeItem('bowerbird.fixtures'); return null }
    return sessionStorage.getItem('bowerbird.fixtures') ?? (import.meta.env.VITE_BB_FIXTURES === '1' ? '1' : null)
  } catch { return null }
}

export function App() {
  const theme = useThemePref()
  React.useEffect(() => { applyTheme(theme) }, [theme])
  const locale = useLocale()
  const [ready, setReady] = React.useState(() => !wantFixtures())
  React.useEffect(() => {
    const mode = wantFixtures()
    if (!import.meta.env.DEV || !mode) return
    void import('../lib/dev-fixtures').then(m => { m.installFixtures(mode); setReady(true) })
  }, [])
  if (!ready) return null
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider key={locale} router={router} />
    </QueryClientProvider>
  )
}
