import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ExportPlan } from '@bowerbird/schema'
import { Switch, ToggleGroup, ToggleGroupItem } from '@bowerbird/plugin-sdk/web'
import { api, hasApiTransport } from '../lib/api'
import { t } from '../lib/i18n'
import { fmtSize, stem } from '../lib/format'
import { toast, toastError } from '../overlays/toast'
import { FormDialog, openDialog } from '../overlays/dialogs'
import { Icon } from '../components/Icon'
import { Field } from '../components/blocks'
import { rt } from '../shell/runtime'
import { findSummaries } from './cache'
import { postDownload } from './download-form'

/**
 * 导出… (F-07, POST /export): a zip the browser downloads by itself (a plain form POST, streamed to disk), or a copy
 * into a folder on the computer running Bowerbird; with what
 * they use, written under the slot names their files refer to (ADR-018), so a model still finds its textures
 * outside Bowerbird; a file whose relation was changed notes「来自 {实际文件}」.
 */
export async function exportDialog(ids: string[]): Promise<void> {
  await openDialog(close => <ExportDialog ids={ids} onClose={() => close()} />)
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2"><span className="text-[12px] font-semibold text-ink-2">{k}</span><div className="min-w-0">{children}</div></div>
}

function ExportDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { lib, info, qc } = rt()
  const local = info?.isLocal ?? false
  const names = findSummaries(qc, lib, ids).map(a => a.name)
  const base = ids.length > 1 ? 'export' : stem(names[0] ?? 'export')
  const [to, setTo] = React.useState<'zip' | 'dir'>('zip')
  const [layout, setLayout] = React.useState<'keep' | 'flat'>('keep')
  const [deps, setDeps] = React.useState(true)
  const [dir, setDir] = React.useState(`~/Desktop/${ids.length > 1 ? 'export' : base + '_export'}`)
  const [busy, setBusy] = React.useState(false)
  const plan = useQuery({
    queryKey: ['lib', lib, 'export-plan', ids, deps, layout],
    queryFn: () => api.exports.plan(lib, { ids, withDeps: deps, layout }),
    placeholderData: prev => prev
  })
  const p: ExportPlan | undefined = plan.data
  // How many assets the selection uses, whether or not they are included right now (a plan without them reports 0,
  // which would grey the switch out after turning it off once).
  const withDepsPlan = useQuery({
    queryKey: ['lib', lib, 'export-plan', ids, true, 'keep'],
    queryFn: () => api.exports.plan(lib, { ids, withDeps: true, layout: 'keep' }),
    enabled: !deps
  })
  const depCount = (deps ? p?.dependencies : withDepsPlan.data?.dependencies) ?? 0

  const run = async () => {
    setBusy(true)
    try {
      if (to === 'zip') {
        let size = p?.bytes ?? 0
        if (hasApiTransport()) {
          // a stand-in transport (development fixtures, tests) cannot answer a form, so fetch the zip through it
          const blob = await (await api.exports.run(lib, { ids, withDeps: deps, layout })).blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = `${base}.zip`; document.body.appendChild(a); a.click(); a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 30_000)
          size ||= blob.size
        } else {
          // the browser streams the zip to disk itself; nothing is held in this page's memory
          postDownload(api.url(`/libraries/${encodeURIComponent(lib)}/export`), { ids, withDeps: deps, layout, name: `${base}.zip` },
            message => toastError(new Error(message)))
        }
        toast({ title: t('export.started', { name: base, n: p?.files.length ?? 0, size: fmtSize(size) }) })
      } else {
        const res = await api.exports.run(lib, { ids, withDeps: deps, layout, dir })
        const r = await res.json() as { written: number; dir: string }
        toast({ title: t('export.done', { n: r.written, dir: r.dir }) })
      }
      onClose()
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }

  return (
    <FormDialog
      size="wide"
      title={t('export.title', { name: ids.length > 1 ? t('common.nAssets', { n: ids.length }) : names[0] ?? '' })}
      onClose={onClose}
      primary={{ label: to === 'zip' ? t('export.download') : t('export.run'), icon: to === 'zip' ? 'download' : 'folder-output', disabled: busy || !p, onClick: () => void run() }}
    >
      <div className="grid gap-2">
        <Line k={t('export.to')}>
          <ToggleGroup type="single" value={to} onValueChange={v => {
            if (!v) return
            if (v === 'dir' && !local) { toast({ title: t('export.dirToast') }); return }
            setTo(v as 'zip' | 'dir')
          }} aria-label={t('export.to')}>
            <ToggleGroupItem value="zip">{t('export.zip')}</ToggleGroupItem>
            <ToggleGroupItem value="dir" data-unavailable={!local || undefined} title={local ? undefined : t('export.dirLocalOnly')}>{t('export.dir')}</ToggleGroupItem>
          </ToggleGroup>
        </Line>
        {to === 'dir' && (
          <Line k={t('export.folder')}><Field icon="folder" value={dir} onChange={e => setDir(e.target.value)} aria-label={t('export.folder')} /></Line>
        )}
        <Line k={t('export.layout')}>
          <ToggleGroup type="single" value={layout} onValueChange={v => v && setLayout(v as 'keep' | 'flat')} aria-label={t('export.layout')}>
            <ToggleGroupItem value="keep">{t('export.keep')}</ToggleGroupItem>
            <ToggleGroupItem value="flat">{t('export.flat')}</ToggleGroupItem>
          </ToggleGroup>
        </Line>
        <Line k={t('export.deps')}>
          <span className="inline-flex items-center gap-2 text-[12px] text-ink-2">
            <Switch checked={deps && depCount > 0} disabled={!depCount && !deps} onCheckedChange={setDeps} aria-label={t('export.depsAria')} />
            {depCount ? t('export.depsN', { n: depCount }) : t('export.noDeps')}
          </span>
        </Line>
        <div className="mt-1 max-h-[200px] overflow-auto rounded-md bg-surface-well p-1">
          {(p?.files ?? []).map(f => (
            <div key={f.path} className="flex min-h-[26px] items-center gap-1.5 px-2 text-ink-1">
              <Icon name="file" size={12} className="shrink-0 text-ink-3" />
              <span className="truncate font-mono text-[11px]">{f.path}</span>
              {f.fromFile && <small className="ml-auto shrink-0 text-[11px] text-ink-3">{t('export.from', { file: f.fromFile })}</small>}
            </div>
          ))}
        </div>
        <p className="m-0 mt-1 text-[12px] text-ink-3">
          {t('export.summary', { n: p?.files.length ?? 0, size: fmtSize(p?.bytes ?? 0) })}
          {p?.duplicateNames && layout === 'flat' ? ' · ' + t('export.dup') : ''}
        </p>
      </div>
    </FormDialog>
  )
}
