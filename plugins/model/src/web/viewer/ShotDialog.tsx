/**
 * 「另存为图片资产…」(prototype saveDialog, builtin-plugins.md「出图」): a square shot registered as a PNG with a
 * provenance of method `render` (camera, environment, channel) and a source relation to the model (role 模型) —
 * used to make icons from models. The new image keeps the model's tags and design objects (prototype).
 */
import * as React from 'react'
import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Switch, useShell
} from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { Seg } from './ui'
import { Icon } from '../icons'
import { useT } from '../i18n'

export interface ShotParams { [k: string]: unknown }

function folderOf(path: string): string { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i) }
function stem(name: string): string { return name.replace(/\.[^.]+$/, '') }

interface FolderNodeLite { path: string; children: FolderNodeLite[] }
function flatten(nodes: FolderNodeLite[], out: string[] = []): string[] {
  for (const n of nodes) { out.push(n.path); flatten(n.children ?? [], out) }
  return out
}

export function ShotDialog({ open, onOpenChange, asset, shoot, params }: {
  open: boolean
  onOpenChange(v: boolean): void
  asset: AssetDetail
  /** Render a square shot of `px` pixels. */
  shoot(px: number, transparent: boolean): HTMLCanvasElement
  params(): ShotParams
}) {
  const shell = useShell()
  const tr = useT()
  const lib = shell.library.id
  const [name, setName] = React.useState(`${stem(asset.name)}_render.png`)
  const [folder, setFolder] = React.useState(folderOf(asset.path))
  const [size, setSize] = React.useState(512)
  const [transparent, setTransparent] = React.useState(true)
  const [preview, setPreview] = React.useState<string | null>(null)
  const [folders, setFolders] = React.useState<string[]>([folderOf(asset.path)])
  const [busy, setBusy] = React.useState(false)
  const nameRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return
    setPreview(shoot(Math.min(size, 512), transparent).toDataURL('image/png'))
  }, [open, size, transparent, shoot])

  React.useEffect(() => {
    if (!open) return
    shell.api.folders.tree(lib).then(r => {
      const all = flatten([r.root as FolderNodeLite])
      setFolders(prev => [...new Set([...prev, ...all])])
    }).catch(() => { /* the current folder is enough */ })
    setTimeout(() => { const n = nameRef.current; if (n) { n.focus(); n.setSelectionRange(0, n.value.lastIndexOf('.')) } }, 0)
  }, [open, lib, shell])

  const save = async () => {
    setBusy(true)
    try {
      const canvas = shoot(size, transparent)
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'))
      const belongs = asset.relations.outgoing.filter(r => r.type === 'belongs' && !r.broken).map(r => ({ type: 'belongs', to: r.to }))
      const finalName = /\.png$/i.test(name.trim()) ? name.trim() : name.trim() + '.png'
      const res = await shell.api.assets.register(lib, {
        folder, name: finalName, tags: asset.tags, onConflict: 'keep-both',
        relations: [{ type: 'source', to: asset.id, role: tr('roleModel') }, ...belongs],
        provenance: {
          method: 'render', tool: tr('toolName'),
          params: { ...params(), size: `${size}×${size}`, transparent }
        }
      }, { data: new Uint8Array(await blob.arrayBuffer()), name: finalName, type: 'image/png' })
      onOpenChange(false)
      const saved = res.asset
      shell.toast({
        title: tr('saved', { name: saved?.name ?? finalName, model: asset.name }), kind: 'success',
        action: saved ? { label: tr('open'), onClick: () => shell.navigate({ to: 'asset', id: saved.id, tab: 'relations' }) } : undefined
      })
    } catch (e) {
      shell.toast({ title: tr('saveFailed'), description: (e as Error).message, kind: 'error' })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" onPointerDownOutside={e => e.preventDefault()}>
        <DialogHeader><DialogTitle>{tr('saveAsImage')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-[160px_minmax(0,1fr)] items-start gap-4">
          <div className={'aspect-square overflow-hidden rounded-md bg-surface-well shadow-[inset_0_0_0_1px_var(--line-hairline)]' + (transparent ? ' checkerboard' : '')}>
            {preview && <img src={preview} alt="" className="block size-full" />}
          </div>
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm whitespace-nowrap">
            <span className="text-ink-2">{tr('name')}</span>
            <Input ref={nameRef} value={name} aria-label={tr('name')} onChange={e => setName(e.target.value)} />
            <span className="text-ink-2">{tr('location')}</span>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger className="w-full" aria-label={tr('location')}><Icon name="folder-search" size={12} /><SelectValue /></SelectTrigger>
              <SelectContent>{folders.map(f => <SelectItem key={f || '/'} value={f}>{f || '/'}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-ink-2">{tr('shotSize')}</span>
            <Seg label={tr('shotSize')} value={String(size)} onChange={v => setSize(Number(v))} items={[{ value: '256', label: '256' }, { value: '512', label: '512' }, { value: '1024', label: '1024' }]} />
            <span className="text-ink-2">{tr('transparentBg')}</span>
            <Switch checked={transparent} onCheckedChange={setTransparent} aria-label={tr('transparentBg')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr('cancel')}</Button>
          <Button onClick={save} disabled={busy || !name.trim()}><Icon name="image-plus" size={16} />{tr('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
