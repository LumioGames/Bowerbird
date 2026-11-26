/**
 * The plugin's two settings (manifest): `defaultEnvironment` (with the library) and `maxPixelRatio` (this machine).
 * Read once through the API; until then (or when it fails) the defaults apply.
 */
import type { ShellApi } from '@bowerbird/plugin-sdk/web'
import { builtinEnv } from './three/env'

export const PLUGIN_ID = 'bowerbird.model'

export interface ModelSettings { defaultEnvironment: string; maxPixelRatio: number }
export const DEFAULT_SETTINGS: ModelSettings = { defaultEnvironment: 'studio', maxPixelRatio: 2 }

/** `defaultEnvironment` is one of the built-in environments (manifest `enum`); anything else saved means the studio. */
export function environmentSetting(v: unknown): string {
  return typeof v === 'string' && builtinEnv(v) ? v : DEFAULT_SETTINGS.defaultEnvironment
}

let current: ModelSettings = { ...DEFAULT_SETTINGS }
let pending: Promise<ModelSettings> | null = null

export function modelSettings(): ModelSettings { return current }

export function loadSettings(shell: Pick<ShellApi, 'api' | 'library'>): Promise<ModelSettings> {
  if (pending) return pending
  pending = (async () => {
    const [lib, machine] = await Promise.all([
      shell.api.plugins.librarySettings(shell.library.id, PLUGIN_ID).catch(() => null),
      shell.api.plugins.machineSettings(PLUGIN_ID).catch(() => null)
    ])
    const pr = machine?.values?.maxPixelRatio
    current = {
      defaultEnvironment: environmentSetting(lib?.values?.defaultEnvironment),
      maxPixelRatio: typeof pr === 'number' && pr > 0 ? pr : DEFAULT_SETTINGS.maxPixelRatio
    }
    return current
  })()
  return pending
}
