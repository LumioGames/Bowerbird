import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AssetDetail, AssetSummary } from '@bowerbird/schema'
import { useInspectorTargetValue } from '../shell/inspector-target'
import { useLibraryId } from '../lib/library'
import { api } from '../lib/api'
import { qk } from '../lib/keys'
import { t } from '../lib/i18n'
import { Icon } from '../components/Icon'
import { findSummaries } from '../flows/cache'
import { SingleInspector } from './Single'
import { BatchInspector } from './Batch'
import { FolderInspector, ViewInspector } from './Place'

/**
 * Inspector (web-shell.md「右栏：检查器」, pages.md 检查器): no selection → folder/view info; one asset → sections;
 * many → batch editing. Reads `useInspectorTargetValue()`. Plugin inspector sections are slotted in.
 * A selection the current view no longer shows says so (E-24).
 */
export function Inspector() {
  const target = useInspectorTargetValue()
  const lib = useLibraryId()
  return (
    <div className="pb-6">
      {target.kind === 'assets' && target.outOfView && (
        <p className="mx-3 mt-3 mb-0 flex items-center gap-1.5 rounded-sm bg-fill-rest px-2 py-1.5 text-[12px] text-ink-2">
          <Icon name="eye-off" size={12} />{target.ids.length > 1 ? t('insp.outOfViewN', { n: target.ids.length }) : t('insp.outOfView')}
        </p>
      )}
      {target.kind === 'assets' && target.ids.length === 1 && <OneAsset lib={lib} id={target.ids[0]!} />}
      {target.kind === 'assets' && target.ids.length > 1 && <ManyAssets lib={lib} ids={target.ids} />}
      {target.kind === 'folder' && <FolderInspector lib={lib} path={target.path} />}
      {target.kind === 'view' && <ViewInspector lib={lib} name={target.name} />}
    </div>
  )
}

function OneAsset({ lib, id }: { lib: string; id: string }) {
  const q = useQuery<AssetDetail>({ queryKey: qk.asset(lib, id), queryFn: () => api.assets.get(lib, id) })
  if (!q.data) return q.isError ? <p className="px-4 py-6 text-ink-2">{t('page.error')}</p> : <InspectorSkeleton />
  return <SingleInspector asset={q.data} />
}

function ManyAssets({ lib, ids }: { lib: string; ids: string[] }) {
  const qc = useQueryClient()
  const cached = findSummaries(qc, lib, ids)
  const missing = ids.filter(id => !cached.some(a => a.id === id))
  const extra = useQuery({ queryKey: ['lib', lib, 'insp-batch', missing], queryFn: () => Promise.all(missing.slice(0, 200).map(id => api.assets.get(lib, id))), enabled: missing.length > 0 })
  const assets: AssetSummary[] = [...cached, ...(extra.data ?? [])]
  return <BatchInspector assets={assets} ids={ids} />
}

export function InspectorSkeleton() {
  return (
    <div aria-busy className="grid gap-3 p-4">
      <div className="aspect-[16/10] animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-md bg-fill-rest" />
      <div className="h-4 w-1/2 animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-xs bg-fill-rest" />
      <div className="h-3 w-3/4 animate-[bb-skel_1.4s_ease-in-out_infinite] rounded-xs bg-fill-rest" />
    </div>
  )
}
