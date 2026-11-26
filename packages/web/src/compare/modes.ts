import type { AssetDetail, CompareMode, CompareModeSupport } from '@bowerbird/schema'
import type { FormatView } from '@bowerbird/plugin-sdk/web'

/**
 * Which compare modes a pair offers (web-shell.md 对比页): the format plugin of either side may claim the pair
 * (`compareModes(left, right)`), e.g. the model plugin for a model against a turnaround sheet. A claimed pair with a
 * `Compare` view uses it; otherwise the shell shows the two viewers side by side and only 并排 is available.
 * Unavailable modes are never greyed out: clicking one shows the reason in a toast.
 */
export const MODES: ReadonlyArray<{ mode: CompareMode; icon: string }> = [
  { mode: 'side', icon: 'columns-2' },
  { mode: 'wipe', icon: 'square-split-horizontal' },
  { mode: 'overlay', icon: 'layers' },
  { mode: 'diff', icon: 'scan-search' }
]

export interface Resolved {
  /** Plugin whose Compare view draws the stage, or null for two viewers side by side. */
  pluginId: string | null
  view: FormatView | null
  modes: Array<{ mode: CompareMode; available: boolean; reason?: string }>
  defaultMode: CompareMode
}

type Lookup = (format: string) => { pluginId: string; view: FormatView } | null

export function resolveModes(a: AssetDetail, b: AssetDetail, lookup: Lookup, reasons: { pair: string; notOffered: string }): Resolved {
  const candidates = [lookup(a.format), lookup(b.format)].filter((x): x is NonNullable<ReturnType<Lookup>> => !!x)
  let claim: { pluginId: string; view: FormatView; support: CompareModeSupport[] } | null = null
  for (const c of candidates) {
    let support: CompareModeSupport[] | null = null
    try { support = c.view.compareModes?.(a, b) ?? null } catch { support = null }
    if (support && support.length) { claim = { ...c, support }; break }
  }
  if (!claim || !claim.view.Compare) {
    const why = claim ? reasons.notOffered : reasons.pair
    return { pluginId: null, view: null, modes: MODES.map(m => (m.mode === 'side' ? { mode: 'side', available: true } : { mode: m.mode, available: false, reason: claim?.support.find(s => s.mode === m.mode)?.reason ?? why })), defaultMode: 'side' }
  }
  const modes = MODES.map(m => {
    const s = claim!.support.find(x => x.mode === m.mode)
    if (s) return { mode: m.mode, available: s.available, reason: s.available ? undefined : s.reason ?? reasons.notOffered }
    return { mode: m.mode, available: false, reason: reasons.notOffered }
  })
  const def = claim.support.find(s => s.default && s.available)?.mode ?? modes.find(m => m.available)?.mode ?? 'side'
  return { pluginId: claim.pluginId, view: claim.view, modes, defaultMode: def }
}

/** The mode to show: the one asked for when it is available, else the pair's default. */
export function pickMode(r: Resolved, wanted: string | null): CompareMode {
  const w = r.modes.find(m => m.mode === wanted && m.available)
  return w ? w.mode : r.defaultMode
}
