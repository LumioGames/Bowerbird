import type { EventType } from '@bowerbird/schema'

/**
 * 「扫描发现 {名称} 不见了」(copy.md 完整性「外部删除被发现」): when a scan finds that a file was deleted outside
 * Bowerbird (a `missing-file` issue appears), say so on a toast with「查看」→ the integrity page. Findings that arrive
 * together (one scan) share one toast. Pure: the shell passes how to name an asset and how to show the toast.
 */
export interface ScanFindingsDeps {
  nameOf: (assetId: string) => Promise<string | null> | string | null
  show: (names: string[]) => void
  /** How long to wait for more findings of the same scan before showing. */
  delayMs?: number
}

export function createScanFindings(d: ScanFindingsDeps) {
  let pending: string[] = []
  const seen = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = async () => {
    timer = null
    const ids = pending
    pending = []
    const names = (await Promise.all(ids.map(id => Promise.resolve(d.nameOf(id)).catch(() => null)))).filter((n): n is string => !!n)
    if (names.length) d.show(names)
  }
  return {
    handle(type: EventType, data: unknown): void {
      const e = data as { id?: string; type?: string; assetId?: string | null } | null
      if (type === 'issue.resolved' && e?.id) { seen.delete(e.id); return }
      if (type !== 'issue.created' || e?.type !== 'missing-file' || !e.assetId) return
      const key = e.id ?? e.assetId
      if (seen.has(key)) return
      seen.add(key)
      pending.push(e.assetId)
      if (!timer) timer = setTimeout(() => void flush(), d.delayMs ?? 400)
    },
    dispose(): void { if (timer) clearTimeout(timer); timer = null; pending = [] }
  }
}

/* ── the end of a scan (ADR-040: long jobs and scan results report on a toast) ── */

let ownScanAt = 0
/** This browser asked for a scan (重新扫描, 只扫描这个文件夹): its end is reported even when nothing changed. */
export function noteOwnScan(now = Date.now()): void { ownScanAt = now }

export interface ScanSummaryDeps {
  /** `added` new assets, `issues` new problems; `own` = this browser started the scan. */
  show: (r: { added: number; issues: number; own: boolean }) => void
  /** Registering a first-opened folder has its own progress panel and toast. */
  quiet?: () => boolean
  now?: () => number
}

/**
 * 「扫描完成 · 新增 {n} 个 · 发现 {m} 条问题」: counts what arrived while a scan ran (asset.created, issue.created) and
 * reports it when the scan ends. A background scan that changed nothing says nothing; one this browser asked for
 * always answers.
 */
export function createScanSummary(d: ScanSummaryDeps) {
  const now = d.now ?? Date.now
  let running = false
  let startedAt = 0
  let added = 0
  let issues = 0
  return {
    handle(type: EventType, data: unknown): void {
      const e = data as { running?: boolean } | null
      if (type === 'scan.progress') {
        if (e?.running && !running) { running = true; startedAt = now(); added = 0; issues = 0 }
        else if (e && !e.running && running) {
          running = false
          const own = ownScanAt > 0 && ownScanAt >= startedAt - 5_000
          if (own) ownScanAt = 0
          if (d.quiet?.()) return
          if (added || issues || own) d.show({ added, issues, own })
        }
        return
      }
      if (!running) return
      if (type === 'asset.created') added++
      else if (type === 'issue.created') issues++
    }
  }
}
