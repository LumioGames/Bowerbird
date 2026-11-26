import type * as React from 'react'
import { createPortal } from 'react-dom'
import { Button, cn } from '@bowerbird/plugin-sdk/web'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { useShellHosts } from './hosts'
import { t } from '../lib/i18n'
import { useShortcut } from '../lib/shortcuts'

/**
 * Page frame for full pages over the browse area (components.md「页面框架」): header with back, title, subtitle,
 * right-side actions; content; the shared loading (skeleton) / error (retry) / empty states.
 * It covers the content and the inspector, the side bar stays. web-2 pages (issues, trash, tags, settings,
 * review queue) and plugin pages use it.
 */
export interface PageFrameProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  onBack?: () => void
  state?: 'ready' | 'loading' | 'error' | 'empty'
  onRetry?: () => void
  empty?: { icon?: string; title: string; body?: string; action?: React.ReactNode }
  children?: React.ReactNode
  /** Extra classes for the scrolling body (e.g. a page that lays out its own columns). */
  bodyClassName?: string
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto my-6 grid max-w-[820px] gap-2 px-6" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 rounded-md bg-surface-panel px-3">
          <i className="size-8 rounded-xs bg-fill-rest" />
          <span className="h-2.5 w-[30%] animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-[5px] bg-fill-rest" />
          <span className="ml-auto h-2.5 w-[18%] animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-[5px] bg-fill-rest" />
        </div>
      ))}
    </div>
  )
}

export function PageFrame(p: PageFrameProps) {
  const { page } = useShellHosts()
  const state = p.state ?? 'ready'
  // Esc goes back (pages.md: Esc closes a page), unless a dialog or menu is open.
  useShortcut('esc', () => { if (!p.onBack) return false; p.onBack() }, { enabled: !!p.onBack })
  const frame = (
    <section className="pointer-events-auto absolute inset-0 z-[5] flex min-w-0 flex-col bg-surface-canvas animate-[bb-fade_var(--duration-fade)_var(--ease-out)_both]">
      <header className="bb-chrome flex h-12 shrink-0 items-center gap-2 pr-3 pl-2 shadow-[inset_0_-1px_0_var(--line-hairline)]">
        {p.onBack && (
          <Button variant="ghost" size="icon" aria-label={t('page.back')} title={t('page.back')} onClick={p.onBack}>
            <Icon name="chevron-left" />
          </Button>
        )}
        <span className={cn('font-semibold', !p.onBack && 'pl-2')}>{p.title}</span>
        {p.subtitle != null && <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">{p.subtitle}</span>}
        <span className="flex-1" />
        {p.actions}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-auto bb-scroll-thin', state === 'ready' && 'animate-[bb-arrive_var(--duration-arrive)_var(--ease-out)_both]', p.bodyClassName)}>
        {state === 'loading' && <PageSkeleton />}
        {state === 'error' && (
          <EmptyState
            className="mt-[12vh]"
            icon="unlink"
            title={t('page.error')}
            action={p.onRetry && <Button variant="primary" onClick={p.onRetry}><Icon name="refresh-cw" />{t('page.retry')}</Button>}
          />
        )}
        {state === 'empty' && p.empty && <EmptyState className="mt-[12vh]" icon={p.empty.icon} title={p.empty.title} body={p.empty.body} action={p.empty.action} />}
        {state === 'ready' && p.children}
      </div>
    </section>
  )
  return page ? createPortal(frame, page) : frame
}
