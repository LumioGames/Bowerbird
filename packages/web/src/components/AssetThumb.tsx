import * as React from 'react'
import type { AssetSummary } from '@bowerbird/schema'
import { cn, Progress } from '@bowerbird/plugin-sdk/web'
import { Icon, kindIcon } from './Icon'
import { t } from '../lib/i18n'
import { useIsRendering, useProgress } from '../lib/live'
import { pluginText } from '../plugins/text'

/**
 * Thumbnail of an asset with every state (web-shell.md「状态呈现」, design-system AssetCell):
 * ready (image) · processing (+ progress and the edge beam) · waiting for a browser render (ADR-025; this page
 * renders it once on screen:「正在生成缩略图」) · file missing (last thumbnail greyed) · failed · unknown format
 * (file icon + extension, e.g. OBJ) · missing plugin (「需要 Spine」) · document text card.
 * Fills its parent unless `size` is given. Used by grid, inspector, graph nodes, pickers.
 */
export type ThumbKind = 'ready' | 'processing' | 'render' | 'failed' | 'unknown' | 'plugin' | 'doc' | 'missing' | 'none'

export function thumbKind(a: AssetSummary): ThumbKind {
  if (a.missingPlugin) return 'plugin'
  if (a.flags.includes('missing')) return 'missing'
  if (a.thumbState === 'failed' || a.flags.includes('failed')) return a.thumbnail ? 'ready' : 'failed'
  if (a.format === 'unknown' || (!a.plugin && !a.thumbnail)) return 'unknown'
  if (a.thumbnail && a.thumbState !== 'render') return 'ready'
  if (a.thumbState === 'render') return 'render'
  if (a.flags.includes('processing') || a.thumbState === 'pending') return 'processing'
  if (a.cellText) return 'doc'
  return 'none'
}

function ext(name: string): string { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i) : '' }

function Placeholder({ icon, text, tone, children }: { icon: string; text?: React.ReactNode; tone?: 'danger'; children?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-1.5 p-2 text-center text-[11px] leading-[14px] text-ink-3">
      <Icon name={icon} size={20} />
      {text != null && <span className={cn('max-w-full overflow-hidden text-ellipsis', tone === 'danger' && 'text-danger-ink')}>{text}</span>}
      {children}
    </div>
  )
}

export function DocCard({ title, excerpt, large }: { title?: string; excerpt?: string; large?: boolean }) {
  return (
    <div className={cn('self-stretch justify-self-stretch overflow-hidden text-left', large ? 'max-w-[520px] p-8' : 'bb-doc-fade px-3 pt-3')}>
      <b className={cn('block font-semibold text-ink-1', large ? 'text-[20px] leading-[26px]' : 'pt-5 text-[13px] leading-[18px]')}>{title}</b>
      <p className={cn('mt-1 text-ink-2', large ? 'mt-2 text-[13px] leading-5' : 'text-[11px] leading-[15px]')}>{excerpt}</p>
    </div>
  )
}

export function AssetThumb({ asset: a, size, fit = 'contain', className, arrive }: { asset: AssetSummary; size?: number; fit?: 'cover' | 'contain'; className?: string; arrive?: boolean }) {
  const kind = thumbKind(a)
  const rendering = useIsRendering(a.id)
  const progress = useProgress(a.id)
  const [broken, setBroken] = React.useState(false)
  React.useEffect(() => setBroken(false), [a.thumbnail])
  let inner: React.ReactNode
  switch (kind) {
    case 'ready':
    case 'missing':
      inner = a.thumbnail && !broken
        ? <img src={a.thumbnail} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setBroken(true)}
            className={cn('block size-full', fit === 'cover' ? 'object-cover' : 'object-contain', kind === 'missing' && 'opacity-[0.32] grayscale', arrive && 'bb-arrive')} />
        : <Placeholder icon={kindIcon(a.format)} />
      break
    case 'processing':
      inner = (
        <Placeholder icon={kindIcon(a.format)} text={t('cell.processing')}>
          <Progress value={(progress ?? 0.4) * 100} className="w-16" />
        </Placeholder>
      )
      break
    case 'render': inner = <Placeholder icon="circle-dashed" text={rendering ? t('cell.rendering') : t('cell.waiting')} />; break
    case 'failed': inner = <Placeholder icon={kindIcon(a.format)} text={t('cell.failed')} tone="danger" />; break
    case 'unknown': inner = <Placeholder icon="file" text={<span className="font-mono">{ext(a.name)}</span>} />; break
    case 'plugin': inner = <Placeholder icon="puzzle" text={t('cell.needs', { name: pluginText(a.missingPlugin?.id, a.missingPlugin?.displayName ?? a.missingPlugin?.id ?? '') })} />; break
    case 'doc': inner = <DocCard title={a.cellText?.title ?? a.name} excerpt={a.cellText?.excerpt} />; break
    default: inner = <Placeholder icon={kindIcon(a.format)} />
  }
  return (
    <div
      data-thumb={kind}
      className={cn('relative grid place-items-center overflow-hidden bg-surface-well text-ink-3', size == null && 'size-full', className)}
      style={size != null ? { width: size, height: size } : undefined}
    >
      {inner}
      {kind === 'processing' && <i className="bb-beam" aria-hidden />}
    </div>
  )
}
