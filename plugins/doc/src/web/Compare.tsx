/**
 * Document compare (builtin-plugins.md「文档 · 对比视图」, prototype compare.js `FMT.text`): Markdown, TXT and
 * JSON line by line — side by side (`side`) or merged (`diff`) — with the counts of added and removed lines;
 * two HTML prototypes run side by side.
 */
import * as React from 'react'
import { cn, type CompareProps, type CompareSide } from '@bowerbird/plugin-sdk/web'
import { kindOfName } from '../shared/text.js'
import { counts, lineDiff, linesOf, sideRows } from './lib/diff.js'
import { frameLayout, HtmlFrame } from './parts.js'
import { entryUrl, useText } from './Viewer.js'
import { Float, Key, SideLabel, useSize } from './kit.js'
import { useT } from './i18n.js'

const label = (s: CompareSide, current: string) => (s.version ? `v${s.version.n}${s.version.current ? ` · ${current}` : ''}` : s.asset.name)

const DEL = 'bg-[color-mix(in_srgb,var(--danger-fill)_16%,transparent)]'
const ADD = 'bg-[color-mix(in_srgb,var(--stage-runtime)_18%,transparent)]'
const GAP = 'bg-[repeating-linear-gradient(135deg,transparent_0_5px,var(--line-hairline)_5px_6px)]'
const NUM = 'select-none pr-2 text-right text-ink-3'
const TXT = 'min-w-0 whitespace-pre-wrap break-words pl-1 pr-3 text-ink-1'

export function DocCompare(props: CompareProps) {
  const html = kindOfName(props.left.asset.name, props.left.asset.bundle) === 'html'
  return html ? <HtmlCompare {...props} /> : <TextCompare {...props} />
}

function HtmlPane({ side }: { side: CompareSide }) {
  const tr = useT()
  const ref = React.useRef<HTMLDivElement>(null)
  const size = useSize(ref)
  return (
    <div ref={ref} className="relative min-w-0 flex-1 overflow-hidden bg-surface-well">
      {size.w ? <HtmlFrame url={entryUrl(side.asset, side.source)} title={side.asset.name} layout={frameLayout('fit', size.w, size.h)} /> : null}
      <SideLabel k={side.label} text={label(side, tr('current'))} />
    </div>
  )
}

function HtmlCompare({ left, right }: CompareProps) {
  return (
    <div data-plugin="bowerbird.doc" className="flex size-full min-h-0 gap-px bg-line-hairline">
      <HtmlPane side={left} />
      <HtmlPane side={right} />
    </div>
  )
}

function TextCompare({ left, right, mode }: CompareProps) {
  const tr = useT()
  const a = useText(left.source), b = useText(right.source)
  const diff = React.useMemo(() => {
    if (a.text === null || b.text === null) return null
    const la = linesOf(a.text), lb = linesOf(b.text)
    const ops = lineDiff(la, lb)
    return { la, lb, ops, n: counts(ops) }
  }, [a.text, b.text])
  if (!diff) return <div data-plugin="bowerbird.doc" className="size-full bg-surface-canvas" />
  const { la, lb, ops, n } = diff
  return (
    <div data-plugin="bowerbird.doc" className="relative size-full min-h-0">
      <div className="absolute inset-0 select-text overflow-auto bg-surface-canvas pb-8 pt-3 font-mono text-[12px] leading-5">
        {mode === 'diff' ? (
          ops.map((o, i) => {
            const t = o[0] === '+' ? lb[o[2]!] : la[o[1]!]
            return (
              <div key={i} className={cn('grid grid-cols-[44px_44px_20px_minmax(0,1fr)]', o[0] === '+' && ADD, o[0] === '-' && DEL)}>
                <span className={NUM}>{o[1] === null ? '' : o[1] + 1}</span>
                <span className={NUM}>{o[2] === null ? '' : o[2] + 1}</span>
                <span className={cn('select-none text-center text-ink-2', o[0] === '-' && 'text-danger-ink')}>{o[0] === '=' ? '' : o[0] === '+' ? '+' : '−'}</span>
                <span className={TXT}>{t || ' '}</span>
              </div>
            )
          })
        ) : (
          <>
            <div className="sticky -top-3 z-[1] grid grid-cols-[44px_minmax(0,1fr)_44px_minmax(0,1fr)] bg-surface-canvas py-1.5 font-sans">
              <span /><span className="inline-flex items-center gap-1.5 text-xs"><Key>A</Key>{label(left, tr('current'))}</span>
              <span /><span className="inline-flex items-center gap-1.5 text-xs"><Key>B</Key>{label(right, tr('current'))}</span>
            </div>
            {sideRows(ops, la, lb).map((r, i) => (
              <div key={i} className="grid grid-cols-[44px_minmax(0,1fr)_44px_minmax(0,1fr)]">
                <span className={NUM}>{r.left?.n ?? ''}</span>
                <span className={cn(TXT, 'shadow-[inset_-1px_0_0_var(--line-hairline)]', r.left?.kind === 'del' && DEL, !r.left && GAP)}>{r.left ? r.left.text || ' ' : ''}</span>
                <span className={NUM}>{r.right?.n ?? ''}</span>
                <span className={cn(TXT, r.right?.kind === 'add' && ADD, !r.right && GAP)}>{r.right ? r.right.text || ' ' : ''}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <Float className="right-3 top-2 font-mono">
        <b className="font-semibold text-stage-runtime">+{n.added}</b>
        <b className="font-semibold text-danger-ink">−{n.removed}</b>
        <span className="font-sans text-ink-2">{tr('lines')}</span>
      </Float>
    </div>
  )
}
