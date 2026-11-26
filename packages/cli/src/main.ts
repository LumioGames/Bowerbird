/**
 * Library entry of the CLI: `main(argv, overrides)` wires the real kernel, server and MCP server.
 * The published `bowerbird` package calls this with its own plugin and web directories (see docs/usage.md).
 */
import { createHub } from '@bowerbird/core'
import { startServer } from '@bowerbird/server'
import { runMcpServer } from '@bowerbird/mcp'
import { run, buildProgram, type CliIO } from './program.js'
import { locateAssets, bowerbirdHome, type Located } from './locate.js'

export { run, buildProgram, locateAssets, bowerbirdHome, type CliIO, type Located }

export async function main(argv: string[] = process.argv.slice(2), overrides: Partial<CliIO> & { pluginsDir?: string; webDir?: string } = {}): Promise<number> {
  const { pluginsDir, webDir, ...rest } = overrides
  const io: CliIO = {
    out: t => process.stdout.write(t + '\n'),
    err: t => process.stderr.write(t + '\n'),
    env: process.env,
    cwd: process.cwd(),
    createHub,
    startServer,
    runMcpServer,
    ...(pluginsDir || webDir ? { locate: () => { const l = locateAssets(); return { pluginsDir: pluginsDir ?? l.pluginsDir, webDir: webDir ?? l.webDir } } } : {}),
    ...rest
  }
  return run(argv, io)
}
