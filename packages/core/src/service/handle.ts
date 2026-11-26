/** LibraryHandle for the plugin host (reader, registration channel, per-plugin cache). */
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { CacheWriter, LibraryReader } from '@bowerbird/plugin-sdk'
import type { Guid, LibraryJson, PipelineStage } from '@bowerbird/schema'
import type { LibraryHandle, LibraryPaths } from '../contracts.js'
import type { LocalLibraryFs } from '../library/fs.js'

export interface HandleDeps {
  id: string
  name: () => string
  paths: LibraryPaths
  libraryJson: () => LibraryJson | null
  updateLibraryJson: (mut: (lib: LibraryJson) => void) => Promise<void>
  reader: LibraryReader
  register: LibraryHandle['register']
  /** Current content hash of an asset (cache path component). */
  hashOf: (id: Guid) => string | null
  /** All writes go through the library module (engineering.md「代码约定」). */
  fs: LocalLibraryFs
}

/** Cache files of plugins: `<cacheDir>/<stage>/plugins/<pluginId>/<assetId>-<hash8>/<name>`, written once, never changed. */
export function pluginCache(deps: Pick<HandleDeps, 'paths' | 'hashOf' | 'fs'>, pluginId: string): CacheWriter {
  const dirOf = (assetId: Guid, stage: PipelineStage): string | null => {
    const h = deps.hashOf(assetId)
    if (!h) return null
    const hex = h.includes(':') ? h.slice(h.indexOf(':') + 1) : h
    return path.join(deps.paths.cacheDir, stage, 'plugins', pluginId.replace(/[^\w.@-]/g, '_'), `${assetId}-${hex.slice(0, 8)}`)
  }
  const safe = (name: string) => name.split(/[\\/]/).filter(p => p && p !== '.' && p !== '..').join(path.sep) || 'data'
  return {
    async put(assetId, stage, name, data) {
      const dir = dirOf(assetId, stage)
      if (!dir) throw new Error(`unknown asset ${assetId}`)
      // content-addressed: written once, never overwritten
      return deps.fs.writeCacheOnce(path.join(dir, safe(name)), data)
    },
    async get(assetId, stage, name) {
      const dir = dirOf(assetId, stage)
      if (!dir) return null
      try { return new Uint8Array(await fsp.readFile(path.join(dir, safe(name)))) } catch { return null }
    }
  }
}

/**
 * The handle the plugin host binds plugin contexts to. `cache.put/get` take the plugin id from a `<pluginId>/<name>`
 * name prefix (the frozen LibraryHandle has no plugin parameter); `cacheFor(pluginId)` is the direct form.
 */
export function createHandle(deps: HandleDeps): LibraryHandle & { cacheFor(pluginId: string): CacheWriter } {
  const split = (name: string): [string, string] => {
    const i = name.indexOf('/')
    return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : ['kernel', name]
  }
  return {
    id: deps.id,
    get name() { return deps.name() },
    paths: deps.paths,
    libraryJson: deps.libraryJson,
    updateLibraryJson: deps.updateLibraryJson,
    reader: deps.reader,
    register: deps.register,
    cache: {
      put(assetId, stage, name, data) { const [p, n] = split(name); return pluginCache(deps, p).put(assetId, stage, n, data) },
      get(assetId, stage, name) { const [p, n] = split(name); return pluginCache(deps, p).get(assetId, stage, n) }
    },
    cacheFor(pluginId: string) { return pluginCache(deps, pluginId) }
  }
}
