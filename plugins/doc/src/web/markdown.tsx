/**
 * Markdown rendering for the document viewer (builtin-plugins.md「文档」, prototype viewers.js `md`):
 * front matter as a row of properties, tables, code blocks and images; a paragraph that is only `bb://<GUID>`
 * becomes an asset card with its thumbnail; `[text](bb://<GUID>)` opens the asset. Raw HTML in Markdown is
 * shown as text (markdown-it `html: false`), so a document cannot run script in the shell page.
 */
import * as React from 'react'
import { ArrowUpRight, Box, Check, Clock, Hash, Minus, Undo2 } from 'lucide-react'
import type { AssetDetail } from '@bowerbird/schema'
import { ShellContext, type FileSource } from '@bowerbird/plugin-sdk/web'
import { bbGuid, parseFrontMatter, relativeRef } from '../shared/text.js'
import { renderMarkdown } from './lib/md.js'
import { useT } from './i18n.js'

/** Front-matter keys with their own icon and label (prototype `FM`). */
const FM: Record<string, { label: 'targetSize'; icon: React.ComponentType<{ className?: string }> }> = { size: { label: 'targetSize', icon: Box } }

/** Typography of the rendered document (prototype `.md`). */
export const ARTICLE = [
  'mx-auto max-w-[680px] px-6 pb-12 pt-8 text-[14px] leading-[23px] text-ink-1',
  '[&_h1]:mb-4 [&_h1]:text-[26px] [&_h1]:font-bold [&_h1]:leading-8 [&_h1]:tracking-[-0.02em] [&_h1]:text-balance',
  '[&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:leading-6 [&_h2]:tracking-[-0.01em]',
  '[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold',
  '[&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line-control [&_blockquote]:pl-3 [&_blockquote]:text-ink-2',
  '[&_a]:text-accent-ink [&_a]:underline-offset-2 hover:[&_a]:underline',
  '[&_table]:mb-4 [&_table]:mt-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px] [&_table]:leading-[18px]',
  '[&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:text-[12px] [&_th]:font-semibold [&_th]:text-ink-3 [&_th]:shadow-[inset_0_-1px_0_var(--line-hairline)]',
  '[&_td]:py-1.5 [&_td]:pr-3 [&_td]:text-left [&_td]:shadow-[inset_0_-1px_0_var(--line-hairline)]',
  '[&_pre]:mb-4 [&_pre]:mt-2 [&_pre]:whitespace-pre-wrap [&_pre]:rounded-sm [&_pre]:bg-surface-well [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-[11px] [&_pre]:leading-4 [&_pre]:text-ink-2',
  '[&_:not(pre)>code]:rounded-xs [&_:not(pre)>code]:bg-fill-rest [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[12px]',
  '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_hr]:my-6 [&_hr]:border-line-hairline',
  '[&_[data-bb-ext-img]]:my-2 [&_[data-bb-ext-img]]:inline-flex [&_[data-bb-ext-img]]:max-w-full [&_[data-bb-ext-img]]:items-center [&_[data-bb-ext-img]]:gap-2 [&_[data-bb-ext-img]]:rounded-md [&_[data-bb-ext-img]]:bg-fill-rest [&_[data-bb-ext-img]]:px-2 [&_[data-bb-ext-img]]:py-1 [&_[data-bb-ext-img]]:text-xs [&_[data-bb-ext-img]]:text-ink-2',
  '[&_[data-bb-ext-img]_code]:truncate [&_[data-bb-ext-img]_code]:font-mono [&_[data-bb-ext-img]_code]:text-ink-3'
].join(' ')

const REVIEW: Record<string, [React.ComponentType<{ className?: string }>, string]> = {
  pending: [Clock, 'text-ink-1'], approved: [Check, 'text-accent-ink'], rejected: [Undo2, 'text-danger-ink'], exempt: [Minus, 'text-ink-3']
}

export function StageMark({ stage }: { stage: string }) {
  const tr = useT()
  const fill = stage === 'runtime' ? 'var(--stage-runtime)' : stage === 'production' ? 'linear-gradient(90deg, var(--stage-production) 50%, transparent 50%)' : 'transparent'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2">
      <i className="size-2.5 flex-none rounded-full" style={{ background: fill, boxShadow: `inset 0 0 0 1.5px var(--stage-${stage})` }} />
      {stage === 'reference' || stage === 'production' || stage === 'runtime' ? tr(`stage.${stage}`) : stage}
    </span>
  )
}
export function ReviewMark({ review }: { review: string }) {
  const tr = useT()
  const r = REVIEW[review]
  if (!r) return null
  const [Icon, cls] = r
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-2"><Icon className={'size-3 ' + cls} />{tr(`review.${review as 'pending'}`)}</span>
}

/** `bb://<GUID>` card: thumbnail, name, stage and review; opens the asset. */
function AssetCard({ guid }: { guid: string }) {
  const tr = useT()
  const shell = React.useContext(ShellContext)
  const [a, setA] = React.useState<AssetDetail | null | 'missing'>(null)
  React.useEffect(() => {
    if (!shell) return
    let gone = false
    shell.api.assets.get(shell.library.id, guid).then(x => { if (!gone) setA(x) }).catch(() => { if (!gone) setA('missing') })
    return () => { gone = true }
  }, [shell, guid])
  const asset = a && a !== 'missing' ? a : null
  return (
    <button
      type="button"
      onClick={() => asset && shell?.navigate({ to: 'asset', id: asset.id })}
      className="my-2 flex w-full items-center gap-3 rounded-md bg-fill-rest p-2 text-left text-ink-1 transition-[background-color,transform] duration-fade hover:bg-fill-hover active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
    >
      <span className="grid aspect-[4/3] w-32 flex-none place-items-center overflow-hidden rounded-sm bg-surface-well">
        {asset?.thumbnail ? <img src={asset.thumbnail} alt="" className="size-full object-cover" draggable={false} /> : null}
      </span>
      <span className="min-w-0">
        <b className="block truncate font-semibold">{asset ? asset.name : a === 'missing' ? tr('missingTarget') : `bb://${guid}`}</b>
        {asset ? <small className="mt-1 flex gap-2"><StageMark stage={asset.stage} /><ReviewMark review={asset.review} /></small> : null}
      </span>
      <ArrowUpRight className="ml-auto mr-2 size-4 flex-none text-ink-3" />
    </button>
  )
}

export function MarkdownView({ src, source, contentRef }: { src: string; source: FileSource; contentRef?: React.Ref<HTMLElement> }) {
  const tr = useT()
  const shell = React.useContext(ShellContext)
  const fm = React.useMemo(() => parseFrontMatter(src), [src])
  const html = React.useMemo(() => renderMarkdown(fm.body, {
    image(s) {
      const guid = bbGuid(s)
      if (guid) return shell ? shell.api.assets.fileUrl(shell.library.id, guid) : null
      if (/^(?:data:image\/|blob:)/i.test(s)) return s
      const ref = relativeRef(s)
      return ref ? source.slotUrl(ref) : null
    }
  }), [fm.body, shell, source])
  // Cards are React elements between plain HTML segments (no portals into innerHTML).
  const parts = React.useMemo(() => html.split(/<div data-bb-card="([0-9a-f-]+)"><\/div>\n?/), [html])
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('[data-bb-asset]')
    if (!a) return
    e.preventDefault()
    shell?.navigate({ to: 'asset', id: a.getAttribute('data-bb-asset')! })
  }
  return (
    <article ref={contentRef as React.Ref<HTMLElement>} className={ARTICLE} onClick={onClick}>
      {fm.fields.length ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {fm.fields.map(f => {
            const known = FM[f.key]
            const meta = { label: known ? tr(known.label) : f.key, icon: known?.icon ?? Hash }
            const Icon = meta.icon
            return (
              <span key={f.key} title={f.comment || undefined} className="inline-flex items-center gap-1.5 rounded-full bg-fill-rest py-1 pl-2 pr-3 text-xs">
                <Icon className="size-3 text-ink-3" />
                <small className="text-ink-3">{meta.label}</small>
                <b className="font-semibold tabular-nums">{f.value}</b>
              </span>
            )
          })}
        </div>
      ) : null}
      {parts.map((p, i) => (i % 2 ? <AssetCard key={i} guid={p} /> : p ? <div key={i} className="contents" dangerouslySetInnerHTML={{ __html: p }} /> : null))}
    </article>
  )
}
