/**
 * community.forge — test-only creator plugin (replaces the prototype's plugin-demo.js). Fake local generation, no network.
 * The logic lives in forge.ts so tests can drive it with a test context.
 */
import { defineServerPlugin } from '@bowerbird/plugin-sdk'
import { activateForge } from './forge.js'

export default defineServerPlugin({ activate(ctx) { activateForge(ctx) } })
