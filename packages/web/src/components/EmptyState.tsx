import type * as React from 'react'
import { cn } from '@bowerbird/plugin-sdk/web'
import { Icon } from './Icon'

/**
 * Empty state (design-system EmptyState): a raised icon tile, a title, an optional line of text and the actions,
 * on a faint dot pattern. Used for the empty library, no search results, an empty folder, connection lost.
 */
export function EmptyState(p: { icon?: string; title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bb-dots grid min-h-[280px] content-center justify-items-center gap-2 px-6 py-12 text-center text-ink-2', p.className)}>
      {p.icon && (
        <div className="mb-2 grid size-12 place-items-center rounded-lg bg-surface-raised text-ink-2 shadow-raise">
          <Icon name={p.icon} size={24} />
        </div>
      )}
      <h3 className="m-0 text-[15px] leading-5 font-semibold tracking-[-0.01em] text-ink-1">{p.title}</h3>
      {p.body != null && <p className="m-0 max-w-[380px]">{p.body}</p>}
      {p.action != null && <div className="mt-3 flex gap-2">{p.action}</div>}
    </div>
  )
}
