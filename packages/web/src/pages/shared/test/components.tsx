/**
 * Test-only stand-ins for web-1's shared components (PageFrame, Banner, EmptyState, marks, AssetThumb), so web-2's
 * tests can see the props they are given while those components are still placeholders. Same signatures.
 */
import * as React from 'react'
import type { PageFrameProps } from '../../../components/PageFrame'

export function PageFrame(p: PageFrameProps) {
  return (
    <div data-testid="page" data-state={p.state ?? 'ready'} className="w2-page">
      <header className="w2-pbar"><button type="button" onClick={p.onBack}>back</button><b className="w2-pbar__t">{p.title}</b><div data-testid="subtitle" className="w2-pbar__s">{p.subtitle}</div><span className="w2-grow" /><div data-testid="actions" className="flex items-center gap-2">{p.actions}</div></header>
      {p.state === 'loading' && <p>loading</p>}
      {p.state === 'error' && <button type="button" onClick={p.onRetry}>retry</button>}
      {p.state === 'empty' && p.empty && <div data-testid="empty"><h2>{p.empty.title}</h2><p>{p.empty.body}</p>{p.empty.action}</div>}
      {(p.state === undefined || p.state === 'ready') && <div className="w2-pbody">{p.children}</div>}
    </div>
  )
}
export function Banner(p: { tone: string; title?: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) {
  return <div role="status" data-tone={p.tone}><b>{p.title}</b><span>{p.children}</span><span>{p.actions}</span></div>
}
export function EmptyState(p: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return <div data-testid="empty-state"><h2>{p.title}</h2>{p.body && <p>{p.body}</p>}{p.action}</div>
}
export function StageMark(p: { stage: string }) { return <i data-mark="stage" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{p.stage}</i> }
export function ReviewMark(p: { review: string }) { return <i data-mark="review" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{p.review}</i> }
export function IssueMark(p: { level: string | null }) { return <i data-mark="issue" style={{ fontSize: 10, color: 'var(--warning-ink)' }}>{p.level}</i> }
export function InfoBadge(p: { text: string | null }) { return <i data-mark="info">{p.text}</i> }
export function AssetThumb(p: { asset: { name: string; thumbnail?: string | null }; fit?: 'cover' | 'contain' }) {
  return p.asset.thumbnail ? <img data-thumb={p.asset.name} src={p.asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: p.fit ?? 'contain' }} /> : <i data-thumb={p.asset.name} />
}
