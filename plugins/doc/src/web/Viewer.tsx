/**
 * Document viewer (builtin-plugins.md「文档」, prototype viewers.js `docViewer`): Markdown typeset or raw,
 * HTML run in a sandboxed frame with viewport presets or shown as source (bundles run from their entry file),
 * JSON as a collapsible tree or raw, TXT raw. Text is selectable; ⌘A / Ctrl+A selects the document only.
 */
import * as React from 'react'
import type { ViewerProps } from '@bowerbird/plugin-sdk/web'
import { decodeText, kindOfName } from '../shared/text.js'
import { MarkdownView } from './markdown.js'
import { frameLayout, HtmlFrame, JsonTree, type Viewport } from './parts.js'
import { Grow, Num, Sep, Seg, ViewerFrame, useSize } from './kit.js'
import { useT, type Key } from './i18n.js'

type View = 'a' | 'b'

const MODES: Record<'markdown' | 'json' | 'html', Array<{ value: View; key: Key }>> = {
  markdown: [{ value: 'a', key: 'typeset' }, { value: 'b', key: 'raw' }],
  json: [{ value: 'a', key: 'tree' }, { value: 'b', key: 'raw' }],
  html: [{ value: 'a', key: 'run' }, { value: 'b', key: 'source' }]
}

export function useText(source: ViewerProps['source'], enabled = true): { text: string | null; error: boolean } {
  const [state, setState] = React.useState<{ text: string | null; error: boolean }>({ text: null, error: false })
  React.useEffect(() => {
    if (!enabled) return
    let gone = false
    const ctl = new AbortController()
    setState({ text: null, error: false })
    source.fetch(ctl.signal).then(b => { if (!gone) setState({ text: decodeText(new Uint8Array(b)), error: false }) }).catch(() => { if (!gone) setState({ text: null, error: true }) })
    return () => { gone = true; ctl.abort() }
  }, [source, enabled])
  return state
}

/** URL a sandboxed frame loads: the bundle's entry file (relative links resolve inside the bundle) or the file. */
export function entryUrl(asset: ViewerProps['asset'], source: ViewerProps['source']): string {
  if (!asset.bundle) return source.url
  return source.bundleUrl(asset.bundleFiles?.find(f => f.entry)?.path ?? 'index.html')
}

export function DocViewer({ asset, source, mode = 'detail' }: ViewerProps) {
  const kind = kindOfName(asset.name, asset.bundle) ?? 'text'
  const compact = mode === 'quicklook' || mode === 'compare'
  const tr = useT()
  const [view, setView] = React.useState<View>('a')
  const [vp, setVp] = React.useState<Viewport>('fit')
  const stageRef = React.useRef<HTMLDivElement>(null)
  const stage = useSize(stageRef)
  const needText = kind !== 'html' || view === 'b'
  const { text, error } = useText(source, needText)
  const contentRef = React.useRef<HTMLElement>(null)
  const json = React.useMemo(() => {
    if (kind !== 'json' || text === null) return { ok: false as const }
    try { return { ok: true as const, value: JSON.parse(text) as unknown } } catch { return { ok: false as const } }
  }, [kind, text])

  const layout = frameLayout(vp, stage.w, stage.h)
  const modes = kind === 'text' ? null : MODES[kind]

  const bar = (
    <>
      {modes ? <Seg<View> label={tr('display')} value={view} onChange={setView} items={modes.map(m => ({ value: m.value, label: tr(m.key) }))} /> : null}
      {kind === 'html' ? (
        <>
          <Sep />
          <span style={{ visibility: view === 'a' ? undefined : 'hidden' }} className="inline-flex items-center gap-1.5">
            <Seg<Viewport> label={tr('viewport')} value={vp} onChange={setVp} items={(['fit', 'phone', 'tablet', 'desktop'] as const).map(v => ({ value: v, label: tr(`vp.${v}`) }))} />
            <Num>{Math.round(layout.w)} × {Math.round(layout.h)}{layout.k < 1 ? `  ·  ${Math.round(layout.k * 100)}%` : ''}</Num>
          </span>
        </>
      ) : null}
      <Grow />
    </>
  )

  // ⌘A / Ctrl+A selects the document's own text, not the page.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A') && contentRef.current) {
      e.preventDefault()
      e.stopPropagation()
      const r = document.createRange()
      r.selectNodeContents(contentRef.current)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
    }
  }

  let body: React.ReactNode
  const raw = (t: string) => <pre ref={contentRef as React.Ref<HTMLPreElement>} className="m-0 whitespace-pre-wrap p-6 font-mono text-[12px] leading-5 text-ink-1 [overflow-wrap:anywhere]">{t}</pre>
  if (kind === 'html' && view === 'a') {
    body = <HtmlFrame url={entryUrl(asset, source)} title={asset.name} layout={layout} />
  } else if (error) {
    body = <p className="p-6 text-sm text-ink-2">{tr('viewerError')}</p>
  } else if (text === null) {
    body = null
  } else if (view === 'b' || kind === 'text') {
    body = raw(text)
  } else if (kind === 'json') {
    body = json.ok ? <JsonTree value={json.value} raw={text} treeRef={contentRef as React.Ref<HTMLDivElement>} /> : raw(text)
  } else {
    body = <MarkdownView src={text} source={source} contentRef={contentRef} />
  }

  const scroll = !(kind === 'html' && view === 'a')
  return (
    <ViewerFrame
      plugin="bowerbird.doc"
      mode={mode}
      bar={bar}
      stageRef={stageRef}
      stageClassName="select-text touch-auto"
      stageStyle={{ background: 'var(--surface-raised)' }}
      rootProps={{ onKeyDown, tabIndex: compact ? undefined : -1 }}
    >
      {scroll ? (
        <div
          tabIndex={0}
          className="absolute inset-0 overflow-auto outline-none"
          onPointerDown={e => (e.currentTarget as HTMLElement).focus({ preventScroll: true })}
        >
          {body}
        </div>
      ) : body}
    </ViewerFrame>
  )
}
