// line core-B: PluginHost (discovery, manifests, enablement, activation, contexts, install/update/remove).
import type { CreatePluginHost } from '../contracts.js'
import { createPluginHostImpl } from './host.js'

export const createPluginHost: CreatePluginHost = opts => createPluginHostImpl(opts)
export { createPluginHostImpl, FAILURE_THRESHOLD, type PluginHostImpl, type PluginHostExtraOptions, type NpmRunner } from './host.js'
export { creatorKey, BUILTIN_RELATION_TYPES } from './library-plugins.js'
export { apiVersionProblem, KERNEL_VERSION } from './manifest.js'
