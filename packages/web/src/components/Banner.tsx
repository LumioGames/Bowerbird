import type * as React from 'react'
import { cn } from '@bowerbird/plugin-sdk/web'
import { Icon } from './Icon'

/**
 * Banner (design-system Banner): info / warning / danger; block (title, text, buttons below) or line (all on one
 * row, buttons at the end). Danger banners are announced (`role=alert`).
 */
const TONE = {
  info: { bg: 'bg-fill-rest', icon: 'info', ink: 'text-ink-2' },
  warning: { bg: 'bg-warning-soft', icon: 'triangle-alert', ink: 'text-warning-ink' },
  danger: { bg: 'bg-danger-soft', icon: 'circle-alert', ink: 'text-danger-ink' }
} as const

export function Banner(p: { tone: 'info' | 'warning' | 'danger'; variant?: 'line' | 'block'; title?: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; icon?: string; className?: string }) {
  const tone = TONE[p.tone]
  const line = p.variant === 'line'
  return (
    <div role={p.tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-2 rounded-md px-3 py-2 text-ink-1', tone.bg, line ? 'items-center' : 'items-start', p.className)}>
      <span className={cn('shrink-0', !line && 'mt-px', tone.ink)}><Icon name={p.icon ?? tone.icon} /></span>
      <div className={cn('min-w-0 flex-1', line && 'flex items-center gap-2')}>
        {p.title != null && <div className="font-semibold">{p.title}</div>}
        {p.children != null && <div className={cn('text-[12px] leading-4 text-ink-2', !line && p.title != null && 'mt-0.5')}>{p.children}</div>}
        {p.actions != null && <div className={cn('flex flex-wrap items-center gap-1.5', line ? 'ml-auto' : 'mt-2')}>{p.actions}</div>}
      </div>
    </div>
  )
}
