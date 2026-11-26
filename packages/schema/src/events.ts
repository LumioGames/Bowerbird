/**
 * Server-sent events on `GET /libraries/{library}/events` (api-and-agent.md「事件流」).
 * Each SSE message: `event: <type>` + `data: <JSON of the payload>`.
 */
import { z } from 'zod'
import { Actor, Guid } from './primitives.js'
import { JobInfo, ScanProgress } from './views.js'

export const EVENT_TYPES = [
  'asset.created', 'asset.updated', 'asset.removed', 'asset.thumbnail',
  'relation.updated', 'tags.updated', 'folder.updated', 'view.updated', 'trash.updated',
  'library.updated', 'plugin.updated', 'job.updated', 'issue.created', 'issue.resolved', 'scan.progress'
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EventPayloads = {
  'asset.created': z.object({ id: Guid, path: z.string(), by: Actor.optional() }),
  /** `fields` lists what changed: tags, description, stage, review, content, path, relations, auto, fields, thumbnail… */
  'asset.updated': z.object({ id: Guid, fields: z.array(z.string()), by: Actor.optional(), version: z.number().int().optional() }),
  'asset.removed': z.object({ id: Guid, reason: z.enum(['trash', 'missing', 'purged']) }),
  'asset.thumbnail': z.object({ id: Guid, url: z.string().nullable() }),
  'relation.updated': z.object({ from: Guid, type: z.string(), to: Guid.nullable(), op: z.enum(['added', 'removed', 'replaced', 'acknowledged']) }),
  'tags.updated': z.object({}),
  'folder.updated': z.object({ path: z.string() }),
  'view.updated': z.object({ name: z.string() }),
  'trash.updated': z.object({}),
  'library.updated': z.object({ fields: z.array(z.string()) }),
  'plugin.updated': z.object({ id: z.string(), status: z.string() }),
  'job.updated': JobInfo,
  'issue.created': z.object({ id: z.string(), type: z.string(), assetId: Guid.nullable() }),
  'issue.resolved': z.object({ id: z.string(), type: z.string(), assetId: Guid.nullable() }),
  'scan.progress': ScanProgress
} as const satisfies Record<EventType, z.ZodTypeAny>

export type EventPayload<T extends EventType> = z.infer<(typeof EventPayloads)[T]>
export type BowerbirdEvent = { [K in EventType]: { type: K; data: EventPayload<K> } }[EventType]
