/**
 * @bowerbird/plugin-sdk — server-side plugin interfaces. Web-side types and components: `@bowerbird/plugin-sdk/web`.
 * Plugins depend only on this package and `@bowerbird/schema` (engineering.md hard rule 2).
 */
export * from './server.js'
export type {
  AssetDetail, AssetSummary, Guid, Hash, Stage, ViewGrid, ProductionRecord, RegisterFields, RecordInput, RelationInput,
  PluginManifest, CompareMode, CompareModeSupport, JobAction
} from '@bowerbird/schema'
