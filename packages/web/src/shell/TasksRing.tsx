import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { JobsResponse } from '@bowerbird/schema'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'

/**
 * The tasks entry at the bottom of the side bar is a small ring that shows what the background is doing
 * (product decision 2026-11-26): idle → a faint track; working (assets processing, create/action jobs running,
 * thumbnails waiting for this page) → a turning arc, like a loading ring; something failed and nothing is running →
 * the whole ring in the warning colour. Same data as the toolbar's background-tasks button (one cached query).
 */
export type TasksState = { kind: 'idle' } | { kind: 'busy'; count: number } | { kind: 'failed'; count: number }

export function tasksState(d: Pick<JobsResponse, 'busy' | 'waitingRender' | 'failed'> | undefined): TasksState {
  if (!d) return { kind: 'idle' }
  const busy = (d.busy ?? 0) + (d.waitingRender ?? 0)
  if (busy > 0) return { kind: 'busy', count: busy }
  const failed = d.failed?.length ?? 0
  if (failed > 0) return { kind: 'failed', count: failed }
  return { kind: 'idle' }
}

export function tasksLabel(s: TasksState): string {
  if (s.kind === 'busy') return t('side.tasks.busy', { n: s.count })
  if (s.kind === 'failed') return t('side.tasks.failed', { n: s.count })
  return t('side.tasks')
}

export function useTasksState(lib: string): TasksState {
  // shares the cache entry with the toolbar's button; job.updated events invalidate it (lib/events.ts)
  const q = useQuery({ queryKey: qk.jobs(lib), queryFn: () => api.jobs.overview(lib) })
  return tasksState(q.data)
}

export function TasksRing({ state, className }: { state: TasksState; className?: string }) {
  // Deliberately quiet (product decision 2026-11-26): a thin ring that never competes with the content. Busy turns a
  // grey arc; failed tints the ring faintly with the warning colour instead of a bright full circle.
  return (
    <svg viewBox="0 0 16 16" className={'size-3.5 -rotate-90 ' + (className ?? '')} aria-hidden data-state={state.kind}>
      <circle cx="8" cy="8" r="6" fill="none" strokeWidth="1.5"
        stroke={state.kind === 'failed' ? 'var(--warning-ink)' : 'var(--fill-press)'} strokeOpacity={state.kind === 'failed' ? 0.45 : 1} />
      {state.kind === 'busy' && (
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round"
          strokeDasharray="37.7" strokeDashoffset="26" className="origin-center animate-[bb-spin_1.2s_linear_infinite]" />
      )}
    </svg>
  )
}
