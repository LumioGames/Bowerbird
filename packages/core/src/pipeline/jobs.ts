/**
 * Rows of the `jobs` table (ddl.ts, owned by the pipeline) and their API shape, plus the pipeline's own
 * bookkeeping table of what each stage last ran with (to find work after plugin or reference changes).
 */
import { PIPELINE_STAGES, type JobAction, type JobInfo, type PipelineStage } from '@bowerbird/schema'

export interface JobRow {
  id: string
  kind: 'process' | 'create' | 'render' | 'action'
  asset_id: string | null
  stage: string | null
  creator: string | null
  plugin: string | null
  status: JobInfo['status']
  priority: number
  attempts: number
  progress: number | null
  message: string | null
  action_json: string | null
  error: string | null
  retryable: number
  outputs_json: string
  params_json: string | null
  by: string | null
  created_at: string
  updated_at: string
  run_after: number
}

/** What each stage of each asset last ran with: content hash, referenced hashes, plugin id@version list. */
export const PIPELINE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS pipeline_stages (
  asset_id TEXT NOT NULL,
  stage    TEXT NOT NULL,
  hash     TEXT,
  refs     TEXT,
  plugin   TEXT,
  at       TEXT NOT NULL,
  PRIMARY KEY (asset_id, stage)
);
`

/**
 * Indexes for the queue's lists (failed jobs, recent runs), newest first without sorting the whole table. Partial, so
 * the hot path — queued/running/done process jobs, rewritten several times each — never touches them.
 */
export const JOB_LIST_INDEXES = /* sql */ `
DROP INDEX IF EXISTS q_jobs_status_updated;
DROP INDEX IF EXISTS q_jobs_kind_created;
CREATE INDEX IF NOT EXISTS q_jobs_failed ON jobs(updated_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS q_jobs_runs ON jobs(created_at) WHERE kind IN ('create', 'action');
`

export const PRIORITY = { visible: 100, recent: 10, backlog: 0 } as const

export function stageIndex(stage: string): number {
  return PIPELINE_STAGES.indexOf(stage as PipelineStage)
}

/** SQL expression giving the 1-based order of a stage column. */
export function stageOrderSql(col: string): string {
  return `(CASE ${col} ${PIPELINE_STAGES.map((s, i) => `WHEN '${s}' THEN ${i + 1}`).join(' ')} ELSE 99 END)`
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function toJobInfo(r: JobRow, extra: { assetName?: string | null; creatorName?: string | null }): JobInfo {
  const action = parseJson<JobAction | null>(r.action_json, null)
  const info: JobInfo = {
    id: r.id,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    outputs: parseJson<string[]>(r.outputs_json, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
  if (r.stage) info.stage = r.stage as PipelineStage
  if (r.asset_id) info.assetId = r.asset_id
  if (extra.assetName) info.assetName = extra.assetName
  // Action jobs keep `pluginId:actionId` in the creator column.
  if (r.creator && r.kind === 'action') info.actionId = r.creator
  else if (r.creator) info.creator = r.creator
  if (extra.creatorName) info.creatorName = extra.creatorName
  if (r.plugin) info.pluginId = r.plugin.split('@')[0]!
  if (r.progress != null) info.progress = Math.max(0, Math.min(1, r.progress))
  if (r.message) info.message = r.message
  if (action) info.action = action
  if (r.error) info.error = r.error
  if (r.error || r.status === 'failed') info.retryable = r.retryable !== 0
  if (r.by) info.by = r.by
  return info
}
