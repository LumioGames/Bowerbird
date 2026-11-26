/**
 * Test kit for plugins: a fake PluginContext that records registrations, and helpers to drive a format handler
 * over sample files. The shared contract suite (run over every built-in plugin and the Forge test plugin)
 * builds on these.
 */
export * from './context.js'
export * from './contract.js'
export * from './samples.js'
export * from './limits.js'
export * from './text.js'
