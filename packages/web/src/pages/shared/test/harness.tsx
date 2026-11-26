/**
 * Test-only render harness: query client (no retries), memory router with the library routes, the shell's dialog
 * host, and a probe exposing the current location as `data-testid="loc"`.
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router'
import { DialogHost } from '../../../overlays/dialogs'

function Probe() {
  const l = useLocation()
  return <output data-testid="loc" data-state={JSON.stringify(l.state ?? null)}>{l.pathname + l.search}</output>
}

export function renderRoutes(routes: Array<{ path: string; element: React.ReactNode }>, entries: InitialEntry[], initialIndex?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={initialIndex ?? entries.length - 1}>
        <Routes>
          {routes.map(r => <Route key={r.path} path={r.path} element={<>{r.element}<Probe /></>} />)}
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
      <DialogHost />
    </QueryClientProvider>
  )
  return { ...utils, qc }
}
