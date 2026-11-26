/** Export plan (api-and-agent.md「导出」, ADR-018): asset files, plus `uses` dependencies written under their slot names. */
import fsp from 'node:fs/promises'
import { baseOf, dirOf, joinPath, nextFreeName, type ExportPlan, type ExportRequest, type Guid } from '@bowerbird/schema'
import { CoreError } from '../contracts.js'
import { isSafeRelPath } from '../library/paths.js'
import type { IndexStore } from '../index/store.js'
import type { LocalLibraryFs } from '../library/fs.js'

/** `inner`: for a file of a bundle asset, its path inside the bundle (clients download it with the bundle file endpoint). */
export interface PlannedFile { path: string; abs: string; size: number; assetId: Guid; fromFile?: string; inner?: string; dependency: boolean }

/**
 * Every path an export writes must stay inside the export folder (ADR-048): slot names that are not relative paths
 * are left out (`skipped`), never written under their name.
 */
export async function planExport(store: IndexStore, fs: LocalLibraryFs, req: ExportRequest): Promise<{ plan: ExportPlan; files: PlannedFile[]; skipped: string[] }> {
  const files: PlannedFile[] = []
  const byPath = new Map<string, PlannedFile>()
  const skipped: string[] = []
  let duplicateNames = false

  const add = async (exportPath: string, abs: string, assetId: Guid, dependency: boolean, fromFile?: string, inner?: string): Promise<string> => {
    if (!isSafeRelPath(exportPath)) { skipped.push(exportPath); return exportPath }
    const existing = byPath.get(exportPath)
    if (existing && existing.abs === abs) return exportPath
    let p = exportPath
    if (existing) {
      duplicateNames = true
      const dir = dirOf(exportPath)
      p = joinPath(dir, nextFreeName(baseOf(exportPath), c => byPath.has(joinPath(dir, c))))
    }
    const size = (await fsp.stat(abs).catch(() => null))?.size ?? 0
    const f: PlannedFile = { path: p, abs, size, assetId, dependency, ...(fromFile ? { fromFile } : {}), ...(inner ? { inner } : {}) }
    files.push(f)
    byPath.set(p, f)
    return p
  }

  const addAsset = async (id: Guid, exportPath: string, dependency: boolean, fromFile?: string): Promise<void> => {
    const row = store.row(id)
    if (!row || row.missing) return
    if (row.bundle) {
      for (const f of await fs.bundleFiles(row.path)) await add(joinPath(exportPath, f.path), fs.absolute(joinPath(row.path, f.path)), id, dependency, undefined, f.path)
    } else {
      await add(exportPath, fs.absolute(row.path), id, dependency, fromFile)
    }
  }

  const visited = new Set<string>()
  const deps = async (id: Guid, exportDir: string): Promise<void> => {
    const key = `${id}\u0000${exportDir}`
    if (visited.has(key)) return
    visited.add(key)
    const meta = store.metaOf(id)
    for (const r of meta?.relations ?? []) {
      if (r.type !== 'uses') continue
      if (r.slot !== undefined && !isSafeRelPath(r.slot)) { skipped.push(r.slot); continue }
      const target = store.row(r.to)
      if (!target || target.missing) continue
      if (target.bundle && r.slot) {
        // ADR-041: the slot names a file inside the bundle
        const inner = (await fs.bundleFiles(target.path)).find(f => f.path === r.slot) ??
          (await fs.bundleFiles(target.path)).find(f => baseOf(f.path) === baseOf(r.slot!))
        if (inner) await add(joinPath(exportDir, r.slot), fs.absolute(joinPath(target.path, inner.path)), target.id, true,
          baseOf(inner.path) !== baseOf(r.slot) ? `${target.name}/${inner.path}` : undefined, inner.path)
        continue
      }
      const name = r.slot ?? target.name
      const depPath = joinPath(exportDir, name)
      const fromFile = r.slot && baseOf(r.slot) !== target.name ? target.name : undefined
      await addAsset(target.id, depPath, true, fromFile)
      await deps(target.id, dirOf(depPath))
    }
  }

  for (const id of req.ids) {
    const row = store.row(id)
    if (!row) throw new CoreError('not_found', `资产不存在：${id}`, { id })
    const base = (req.layout ?? 'keep') === 'flat' ? row.name : row.path
    await addAsset(id, base, false)
    if (req.withDeps) await deps(id, dirOf(base))
  }

  const plan: ExportPlan = {
    files: files.map(f => ({ path: f.path, size: f.size, assetId: f.assetId, dependency: f.dependency, ...(f.fromFile ? { fromFile: f.fromFile } : {}), ...(f.inner ? { inner: f.inner } : {}) })),
    bytes: files.reduce((s, f) => s + f.size, 0),
    dependencies: files.filter(f => f.dependency).length,
    duplicateNames
  }
  return { plan, files, skipped }
}
