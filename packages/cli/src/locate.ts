/**
 * Where the built-in plugins and the built web shell live, found from this package's own location:
 * in the monorepo `<repo>/plugins/` and `<repo>/packages/web/dist/`; in the published `bowerbird` package
 * `<pkg>/plugins/` and `<pkg>/web/` (see docs/usage.md and the hand-off notes on packaging).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function hasPluginPackages(dir: string): boolean {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, e.name, 'package.json'), 'utf8')) as { bowerbird?: unknown }
      if (pkg.bowerbird) return true
    } catch { /* not a plugin */ }
  }
  return false
}

function isBuiltShell(dir: string): boolean {
  if (!fs.existsSync(path.join(dir, 'index.html')) || !fs.existsSync(path.join(dir, 'assets'))) return false
  try { return !/src=["']\/src\//.test(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')) } catch { return false }
}

export interface Located { pluginsDir: string | null; webDir: string | null }

export function locateAssets(from: string = path.dirname(fileURLToPath(import.meta.url))): Located {
  let pluginsDir: string | null = null
  let webDir: string | null = null
  let dir = path.resolve(from)
  for (let i = 0; i < 6; i++) {
    if (!pluginsDir && hasPluginPackages(path.join(dir, 'plugins'))) pluginsDir = path.join(dir, 'plugins')
    if (!webDir) {
      // a *built* shell only: index.html next to Vite's assets/ (the monorepo's packages/web source has an index.html too)
      for (const c of [path.join(dir, 'packages', 'web', 'dist'), path.join(dir, 'web')]) {
        if (isBuiltShell(c)) { webDir = c; break }
      }
    }
    if (pluginsDir && webDir) break
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return { pluginsDir, webDir }
}

/** `BOWERBIRD_HOME` or `~/.bowerbird`. */
export function bowerbirdHome(env: NodeJS.ProcessEnv): string {
  const h = env.BOWERBIRD_HOME?.trim()
  return h ? path.resolve(h.replace(/^~(?=$|[\\/])/, os.homedir())) : path.join(os.homedir(), '.bowerbird')
}
