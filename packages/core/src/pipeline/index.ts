// line core-B: Pipeline (8 stages, job queue, cache keys and cleanup, render worker tasks, creation jobs).
import type { CreatePipeline } from '../contracts.js'
import { createPipelineImpl } from './pipeline.js'

export const createPipeline: CreatePipeline = opts => createPipelineImpl(opts)
export { createPipelineImpl, type PipelineImpl, type PipelineExtraOptions } from './pipeline.js'
export { cacheKey, relPathFor, STAGE_PARAM_VERSION } from './cache.js'
export { PRIORITY } from './jobs.js'
