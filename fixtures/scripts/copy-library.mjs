#!/usr/bin/env node
// Copies「星落镇」to a working folder (tests must never serve the committed fixture in place: the server writes
// .bowerbird/cache/ and claims files). With --rebase-trash, trash entries keep the same age relative to today, so
// they are not purged on start when the tests run after the fixture's 2026-11-25 clock (trashDays is 7).
//
//   node scripts/copy-library.mjs <target dir> [--from <library>] [--rebase-trash] [--force]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeJson } from '@bowerbird/schema'

const here = path.dirname(fileURLToPath(import.meta.url))
/** The prototype's clock (data.js NOW): 2026-11-25 04:00 UTC. */
export const FIXTURE_NOW = Date.UTC(2026, 10, 25, 4)

export function copyLibrary(target, { from = path.join(here, '../xingluo'), rebaseTrash = false, force = false, now = Date.now() } = {}) {
  const src = path.resolve(from), dst = path.resolve(target)
  if (fs.existsSync(dst) && fs.readdirSync(dst).length) {
    if (!force) throw new Error(`${dst} is not empty (use --force to replace it)`)
    fs.rmSync(dst, { recursive: true, force: true })
  }
  const cache = path.join(src, '.bowerbird', 'cache')
  fs.cpSync(src, dst, { recursive: true, filter: p => p !== cache && !p.startsWith(cache + path.sep) })
  if (rebaseTrash) {
    const dir = path.join(dst, '.bowerbird/trash')
    if (fs.existsSync(dir)) for (const id of fs.readdirSync(dir)) {
      const f = path.join(dir, id, 'info.json')
      if (!fs.existsSync(f)) continue
      const info = JSON.parse(fs.readFileSync(f, 'utf8'))
      info.deletedAt = new Date(now - (FIXTURE_NOW - Date.parse(info.deletedAt))).toISOString()
      fs.writeFileSync(f, serializeJson(info))
    }
  }
  return dst
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--from')
  if (!target) { console.error('usage: copy-library.mjs <target dir> [--from <library>] [--rebase-trash] [--force]'); process.exit(2) }
  const fi = args.indexOf('--from')
  console.log('copied to', copyLibrary(target, { from: fi >= 0 ? args[fi + 1] : undefined, rebaseTrash: args.includes('--rebase-trash'), force: args.includes('--force') }))
}
