#!/usr/bin/env node
/**
 * bb — init, serve, search, get, trace, add, tag, export, health, rescan, rm, plugin, mcp (api-and-agent.md「命令行」).
 * All commands except init/serve/plugin/mcp talk to a running server over the HTTP API.
 */
import { main } from './main.js'

main().then(code => { if (code) process.exitCode = code }, e => {
  process.stderr.write(`错误：${(e as Error)?.message ?? e}\n`)
  process.exitCode = 1
})
