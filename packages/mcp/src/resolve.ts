/**
 * Helpers shared by MCP tools and the `bb` command line: which library, which asset (GUID or path), whether this
 * client runs on the server's machine, and moving files in and out. Everything goes through the HTTP API.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  BowerbirdApiError, Guid, REVIEW_STATUSES, dirOf, type ApiClient, type AssetDetail, type ExportPlan, type ExportRequest, type LibraryInfo
} from '@bowerbird/schema'

/** Every review state: pass it as `filter.review` for lookups so `agentSearchScope = approved` does not apply. */
export const ALL_REVIEW = REVIEW_STATUSES

/**
 * Library id: the given one (an id is used as it is; a name is looked up), else the server's default, else the only
 * one. A known id never lists libraries: listing them opens every library of that server (access control).
 */
export async function resolveLibrary(client: ApiClient, given?: string): Promise<string> {
  if (given && Guid.safeParse(given).success) return given
  const r = await client.libraries.list()
  if (given) {
    const hit = r.libraries.find(l => l.id === given || l.name === given)
    if (!hit) throw new BowerbirdApiError(404, 'not_found', `服务没有登记这个资产库：${given}`)
    return hit.id
  }
  const id = r.defaultId ?? (r.libraries.length === 1 ? r.libraries[0]!.id : null)
  if (!id) throw new BowerbirdApiError(404, 'not_found', r.libraries.length ? '服务登记了多个资产库，请用 --library 指定' : '服务还没有登记资产库')
  return id
}

/** Paths starting with `./`, `../`, `~` or absolute are files on this machine; others are library-relative. */
export function isFilesystemRef(ref: string): boolean {
  return path.isAbsolute(ref) || /^\.{1,2}[\\/]/.test(ref) || ref.startsWith('~')
}

/** Library-relative POSIX path for a file on this machine, or null when it is outside the library root. */
export function relativeToRoot(root: string, file: string): string | null {
  const rel = path.relative(path.resolve(root), path.resolve(file))
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

/** Resolve a GUID or a path (library-relative, or a local file inside the library) to an asset id. */
export async function resolveAssetId(client: ApiClient, lib: string, ref: string, cwd = process.cwd()): Promise<string> {
  const trimmed = ref.trim()
  if (Guid.safeParse(trimmed).success) return trimmed
  let rel = trimmed.replace(/\\/g, '/')
  if (isFilesystemRef(trimmed)) {
    const info = await client.libraries.get(lib)
    const abs = path.resolve(cwd, trimmed.startsWith('~') ? trimmed.replace(/^~/, process.env.HOME ?? '~') : trimmed)
    const r = relativeToRoot(info.root, abs)
    if (r === null) throw new BowerbirdApiError(404, 'not_found', `${trimmed} 不在资产库「${info.name}」里`)
    rel = r
  }
  rel = rel.replace(/^\/+/, '').replace(/\/+$/, '')
  const folder = dirOf(rel)
  let cursor: string | null | undefined = null
  do {
    // All review states explicitly: a lookup is not a search, the agent search scope must not hide the asset.
    const res = await client.search(lib, { filter: { folder, folderExact: true, includeAuxiliary: true, review: [...ALL_REVIEW] }, sort: 'name', limit: 1000, cursor })
    const hit = res.items.find(i => i.path === rel)
    if (hit) return hit.id
    cursor = res.cursor
  } while (cursor)
  throw new BowerbirdApiError(404, 'not_found', `资产库里没有 ${rel}`)
}

/** Whether this client is on the server's machine (the server says so) and can reach the library folder. */
export async function localAccess(client: ApiClient, lib: string): Promise<{ info: LibraryInfo; local: boolean }> {
  const info = await client.libraries.get(lib)
  return { info, local: info.isLocal && fs.existsSync(info.root) }
}

/** Absolute local path of an asset when on the same machine. */
export function localPathOf(info: LibraryInfo, asset: Pick<AssetDetail, 'path'>): string {
  return path.join(info.root, ...asset.path.split('/'))
}

/** Read a local file into the shape the schema client uploads. */
export async function fileForUpload(file: string): Promise<Blob> {
  const abs = path.resolve(file)
  const st = await fs.promises.stat(abs).catch(() => null)
  if (!st || !st.isFile()) throw new BowerbirdApiError(400, 'validation_failed', `找不到文件 ${file}`)
  // openAsBlob streams from disk instead of reading large files into memory.
  const blob = await fs.openAsBlob(abs)
  return new File([blob], path.basename(abs))
}

/**
 * Export without a server-side directory: plan the files, then download each into `dir` under its export name
 * (slot names kept, ADR-041). Used when the client is not on the server's machine.
 *
 * A bundle asset (a folder registered as one asset) has many files but `/file` only serves its entry, so each of
 * its files is fetched from `/bundle/<path inside the bundle>`. The place inside the bundle comes from the plan's
 * `inner` field when the server sends it; otherwise it is worked out from the export path and the bundle's file
 * list, and a file whose place cannot be told for certain stops the export before anything is written.
 */
export async function downloadExport(client: ApiClient, lib: string, req: ExportRequest, dir: string): Promise<{ plan: ExportPlan; written: number; bytes: number }> {
  const plan = await client.exports.plan(lib, req)
  const enc = encodeURIComponent
  // Work out every download first: a bundle file that cannot be placed must not leave half an export behind.
  const bundles = new Map<string, AssetDetail | null>()
  const sources: Array<{ target: string; url: string }> = []
  const root = path.resolve(dir)
  for (const f of plan.files) {
    const target = path.resolve(root, ...f.path.split('/'))
    if (!target.startsWith(root + path.sep)) continue
    if (!bundles.has(f.assetId)) {
      const a = await client.assets.get(lib, f.assetId)
      bundles.set(f.assetId, a.bundle ? a : null)
    }
    const bundle = bundles.get(f.assetId)
    let url = `/libraries/${enc(lib)}/assets/${enc(f.assetId)}/file`
    if (bundle) {
      const inner = bundleInnerPath(f, bundle, req.layout ?? 'keep')
      if (!inner) throw new BowerbirdApiError(501, 'unsupported', `无法确定 ${f.path} 在包式资产「${bundle.name}」里对应哪个文件，没有导出任何文件；请在服务所在的电脑上导出`, { path: f.path, assetId: f.assetId })
      url = `/libraries/${enc(lib)}/assets/${enc(f.assetId)}/bundle/${inner.split('/').map(enc).join('/')}`
    }
    sources.push({ target, url })
  }
  await fs.promises.mkdir(root, { recursive: true })
  let written = 0
  let bytes = 0
  for (const { target, url } of sources) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    const res = await client.raw('GET', url)
    await pipeline(Readable.fromWeb(res.body! as import('node:stream/web').ReadableStream), fs.createWriteStream(target))
    written++
    bytes += (await fs.promises.stat(target)).size
  }
  return { plan, written, bytes }
}

/** The path inside a bundle asset that an export-plan file comes from, or null when it cannot be told for certain. */
export function bundleInnerPath(
  f: ExportPlan['files'][number] & { inner?: string },
  bundle: Pick<AssetDetail, 'name' | 'path' | 'bundleFiles'>,
  layout: 'keep' | 'flat'
): string | null {
  const files = new Set((bundle.bundleFiles ?? []).map(b => b.path))
  const known = (p: string | undefined | null) => (p && files.has(p) ? p : null)
  // 1. the server says so
  if (f.inner !== undefined) return known(f.inner)
  // 2. a slot pointing into the bundle under another name: `fromFile` is `<bundle name>/<inner>`
  if (f.fromFile?.startsWith(bundle.name + '/')) return known(f.fromFile.slice(bundle.name.length + 1))
  // 3. the exported asset itself: `<path or name>/<inner>`
  if (!f.dependency) {
    const base = layout === 'flat' ? bundle.name : bundle.path
    return f.path.startsWith(base + '/') ? known(f.path.slice(base.length + 1)) : null
  }
  // 4. a dependency: exported as `…/<bundle name>/<inner>`, or under a slot equal to an inner path — only if unique
  const matches = [...files].filter(inner => f.path === inner || f.path.endsWith('/' + inner) || f.path.endsWith(`/${bundle.name}/${inner}`) || f.path === `${bundle.name}/${inner}`)
  const viaName = matches.filter(inner => f.path === `${bundle.name}/${inner}` || f.path.endsWith(`/${bundle.name}/${inner}`))
  if (viaName.length === 1) return viaName[0]!
  return matches.length === 1 ? matches[0]! : null
}

export function errorText(e: unknown): string {
  if (e instanceof BowerbirdApiError) {
    const det = e.details && Object.keys(e.details).length ? ` ${JSON.stringify(e.details)}` : ''
    return e.code === 'network' ? `连不上 Bowerbird 服务：${e.message}` : `${e.code}: ${e.message}${det}`
  }
  return (e as Error)?.message ?? String(e)
}
