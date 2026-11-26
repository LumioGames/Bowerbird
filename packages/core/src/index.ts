/**
 * @bowerbird/core — the kernel. Knows no file format, AI service or version control system (ADR-003);
 * never imports a concrete plugin (engineering.md hard rule 1).
 */
export * from './contracts.js'
export { createHub } from './hub.js'
export { createQueryEngine } from './index/query.js'
export { createPipeline } from './pipeline/index.js'
export { createPluginHost } from './plugins/index.js'
export { openIndexDb, openMemoryIndexDb } from './index/db.js'
export { DDL, INDEX_SCHEMA_VERSION, FLAG, ISSUE_RANK } from './index/ddl.js'
export { createLogger, silentLogger } from './log.js'
export { createEventBus } from './events.js'
