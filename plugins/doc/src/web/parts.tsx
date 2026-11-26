/**
 * Document viewer parts: the collapsible JSON tree (prototype viewers.js `tree`) and the sandboxed HTML frame
 * with viewport presets (ADR-043: `sandbox="allow-scripts"`, never `allow-same-origin`).
 */
import * as React from 'react'
import { ChevronRight } from 'lucide-react'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const LEAF: Record<string, string> = { number: 'text-accent-ink', boolean: 'text-accent-ink', string: 'text-ink-1', object: 'text-ink-3' }

function Key({ k }: { k: string | null }) {
  if (k === null) return null
  return <><span className="text-ink-2">{k}</span><span className="text-ink-3">: </span></>
}

/** Children rendered per node before a「… +n」line; nodes deeper than MAX_DEPTH show as「…」. */
const MAX_CHILDREN = 500
const MAX_DEPTH = 100

function JsonNode({ k, v, depth }: { k: string | null; v: Json; depth: number }) {
  // Children render only while the node is open, so a huge or deep document costs what is on screen.
  const [open, setOpen] = React.useState(depth < 3)
  if (v === null || typeof v !== 'object') {
    return <div className="whitespace-pre-wrap break-all"><Key k={k} /><span className={LEAF[v === null ? 'object' : typeof v]}>{JSON.stringify(v)}</span></div>
  }
  if (depth >= MAX_DEPTH) return <div><Key k={k} /><span className="text-ink-3">…</span></div>
  const arr = Array.isArray(v)
  const keys = Object.keys(v)
  return (
    <details open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)} className={depth ? "pl-4" : undefined}>
      <summary className="-ml-4 block cursor-default list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mr-1 inline size-3 align-[-1px] text-ink-3 transition-transform duration-snappy [details[open]>summary>&]:rotate-90" />
        <Key k={k} /><span className="text-ink-3">{arr ? `[${keys.length}]` : `{${keys.length}}`}</span>
      </summary>
      {open ? keys.slice(0, MAX_CHILDREN).map(x => <JsonNode key={x} k={arr ? null : x} v={(v as Record<string, Json>)[x] as Json} depth={depth + 1} />) : null}
      {open && keys.length > MAX_CHILDREN ? <div className="text-ink-3">… +{keys.length - MAX_CHILDREN}</div> : null}
    </details>
  )
}

/**
 * The tree; copying all of it gives the JSON text itself, a partial selection copies what is shown
 * (「键: 值」 lines).
 */
export function JsonTree({ value, raw, treeRef }: { value: unknown; raw: string; treeRef?: React.Ref<HTMLDivElement> }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(treeRef, () => ref.current!, [])
  const onCopy = (e: React.ClipboardEvent) => {
    const t = ref.current, sel = window.getSelection()
    if (!t || !sel || !sel.rangeCount) return
    const r = sel.getRangeAt(0), all = document.createRange()
    all.selectNodeContents(t)
    if (r.compareBoundaryPoints(Range.START_TO_START, all) <= 0 && r.compareBoundaryPoints(Range.END_TO_END, all) >= 0) {
      e.clipboardData.setData('text/plain', raw)
      e.preventDefault()
    }
  }
  return (
    <div ref={ref} onCopy={onCopy} className="py-6 pl-8 pr-6 font-mono text-[12px] leading-[22px] text-ink-1">
      <JsonNode k={null} v={value as Json} depth={0} />
    </div>
  )
}

export type Viewport = 'fit' | 'phone' | 'tablet' | 'desktop'
/** Viewport presets (prototype `VP`). */
export const VIEWPORTS: Record<Viewport, [number, number] | null> = { fit: null, phone: [390, 760], tablet: [820, 620], desktop: [1280, 720] }

/** Frame size and scale for a preset inside a stage of `W × H` (24 px margin). */
export function frameLayout(vp: Viewport, W: number, H: number): { w: number; h: number; k: number } {
  const mw = Math.max(1, W - 48), mh = Math.max(1, H - 48)
  const p = VIEWPORTS[vp]
  const w = p ? p[0] : mw, h = p ? p[1] : mh
  return { w, h, k: Math.min(1, mw / w, mh / h) }
}

export function HtmlFrame({ url, title, layout }: { url: string; title: string; layout: { w: number; h: number; k: number } }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 overflow-hidden rounded-md bg-white shadow-dialog"
      style={{ width: layout.w, height: layout.h, transform: `translate(-50%, -50%) scale(${layout.k})` }}
    >
      <iframe src={url} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" className="block size-full border-0" />
    </div>
  )
}
