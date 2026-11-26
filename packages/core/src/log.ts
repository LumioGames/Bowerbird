import fs from 'node:fs'
import path from 'node:path'
import type { CoreLogger } from './contracts.js'

type Level = 'debug' | 'info' | 'warn' | 'error'
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LoggerOptions {
  /** `~/.bowerbird/logs`; files roll daily (`bowerbird-YYYY-MM-DD.log`). Omit to log only to the console. */
  dir?: string
  level?: Level
  console?: boolean
}

/**
 * Structured JSON-lines logger, one line per event, filtered by module and level (engineering.md「日志与可观测」).
 * Never log file contents or credentials. Every write operation logs one `write` line (ADR-024).
 */
export function createLogger(opts: LoggerOptions = {}, module = 'core'): CoreLogger {
  const min = RANK[opts.level ?? ((process.env.BOWERBIRD_LOG_LEVEL as Level) || 'info')] ?? 20
  if (opts.dir) fs.mkdirSync(opts.dir, { recursive: true })
  function write(level: Level, msg: string, data?: Record<string, unknown>): void {
    if (RANK[level] < min) return
    const at = new Date()
    const line = JSON.stringify({ at: at.toISOString(), level, module, msg, ...(data ?? {}) })
    if (opts.dir) {
      try { fs.appendFileSync(path.join(opts.dir, `bowerbird-${at.toISOString().slice(0, 10)}.log`), line + '\n') } catch { /* logging must never throw */ }
    }
    if (opts.console ?? (!opts.dir || !!process.env.BOWERBIRD_LOG_CONSOLE)) {
      if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
      else if (process.env.BOWERBIRD_LOG_CONSOLE) process.stdout.write(line + '\n')
    }
  }
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: m => createLogger(opts, `${module}.${m}`)
  }
}

/** A logger that drops everything (tests). */
export const silentLogger: CoreLogger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silentLogger }
