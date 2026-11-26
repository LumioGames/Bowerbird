/**
 * The folder chooser (`GET /fs/folders`, ADR-029): folders of the computer running Bowerbird, so a library can be
 * opened or created there without typing a path. Names only — no file is opened except the probe for
 * `.bowerbird/library.json`. The route answers local requests only (ADR-049「本机请求」).
 * Also the check behind「新建资产库」(`POST /libraries` with `create`): the new folder must not hold anything yet.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FS_FOLDERS_LIMIT, type FsFoldersResponse } from '@bowerbird/schema'
import { HttpError } from './errors.js'

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
/** What the file managers leave in a folder; a folder holding only these counts as empty. */
const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

/** `~` and `~/…` (a pasted path) stand for the home folder. */
export function expandHome(p: string, home: string): string {
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2))
  return p
}

function bad(reason: 'not_absolute' | 'not_found' | 'not_directory' | 'unreadable', message: string, p: string): HttpError {
  return new HttpError(400, 'validation_failed', message, { reason, path: p })
}

/**
 * macOS asks the person before a process reads Desktop, Documents, Downloads, the media folders or another volume.
 * Listing the home folder (or /Volumes) must not look inside those — only entering one may ask, and then it is the
 * person's own action. Those entries are listed without the library check.
 */
const MAC_ASKS = new Set(['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Library'])
export function mayLookInside(dir: string, name: string, home: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin') return true
  if (dir === home && MAC_ASKS.has(name)) return false
  return dir !== '/Volumes'
}

async function isLibrary(dir: string): Promise<boolean> {
  try { return (await fs.promises.stat(path.join(dir, '.bowerbird', 'library.json'))).isFile() } catch { return false }
}

async function isDirectory(p: string): Promise<boolean> {
  try { return (await fs.promises.stat(p)).isDirectory() } catch { return false }
}

/** List the folders in `raw` (absolute; the home folder when omitted). Bad paths are 400 `validation_failed`. */
export async function listFolders(raw: string | undefined, opts: { home?: string; limit?: number; platform?: NodeJS.Platform } = {}): Promise<FsFoldersResponse> {
  const home = path.resolve(opts.home ?? os.homedir())
  const limit = opts.limit ?? FS_FOLDERS_LIMIT
  const given = raw?.trim() ? expandHome(raw.trim(), home) : home
  if (!path.isAbsolute(given)) throw bad('not_absolute', `要给出完整的文件夹路径：${given}`, given)
  const dir = path.resolve(given)
  let st: fs.Stats
  try { st = await fs.promises.stat(dir) } catch { throw bad('not_found', `找不到这个文件夹：${dir}`, dir) }
  if (!st.isDirectory()) throw bad('not_directory', `这不是文件夹：${dir}`, dir)
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { throw bad('unreadable', `读不了这个文件夹（没有权限）：${dir}`, dir) }
  const names: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    // a link to a folder is listed like the folder (macOS /tmp, /var); a dangling link is not
    if (e.isDirectory() || (e.isSymbolicLink() && await isDirectory(path.join(dir, e.name)))) names.push(e.name)
  }
  names.sort(byName.compare)
  const folders = await Promise.all(names.slice(0, limit).map(async name => {
    const p = path.join(dir, name)
    return { name, path: p, library: mayLookInside(dir, name, home, opts.platform) ? await isLibrary(p) : false }
  }))
  const parent = path.dirname(dir)
  return { path: dir, parent: parent === dir ? null : parent, home, library: await isLibrary(dir), folders, truncated: names.length > limit }
}

/**
 * 「新建资产库」: the folder may not exist yet (it is created) or be empty; a file there, or a folder holding anything
 * (a library's `.bowerbird` included), is 409 `conflict` with `details.reason: 'not_empty'`.
 */
export function assertNewFolder(root: string): void {
  const abs = path.resolve(root)
  let st: fs.Stats
  try { st = fs.statSync(abs) } catch { return }
  const taken = !st.isDirectory() || fs.readdirSync(abs).some(n => !SYSTEM_FILES.has(n))
  if (taken) throw new HttpError(409, 'conflict', `${abs} 已经存在，里面有内容；换一个名称`, { reason: 'not_empty', path: abs })
}
