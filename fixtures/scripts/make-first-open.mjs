#!/usr/bin/env node
// Copies the asset files of「星落镇」(no .bmeta, no .bowerbird/, no dot-files) into a folder, for the
// "first open of a folder that already has files" test (ADR-033): a plain folder Bowerbird has never seen.
//
//   node scripts/make-first-open.mjs <target dir> [--from <library>] [--force]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIDECAR_SUFFIX } from '@bowerbird/schema'
import { walk } from './lib/util.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

export function makeFirstOpen(target, { from = path.join(here, '../xingluo'), force = false } = {}) {
  const src = path.resolve(from)
  const dst = path.resolve(target)
  if (fs.existsSync(dst) && fs.readdirSync(dst).length) {
    if (!force) throw new Error(`${dst} is not empty (use --force to replace it)`)
    fs.rmSync(dst, { recursive: true, force: true })
  }
  fs.mkdirSync(dst, { recursive: true })
  let files = 0, bytes = 0
  for (const rel of walk(src)) {
    const parts = rel.split('/')
    if (parts.some(p => p.startsWith('.')) || rel.endsWith(SIDECAR_SUFFIX)) continue
    const to = path.join(dst, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(path.join(src, rel), to)
    files++; bytes += fs.statSync(to).size
  }
  return { target: dst, files, bytes }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--from')
  if (!target) { console.error('usage: make-first-open.mjs <target dir> [--from <library>] [--force]'); process.exit(2) }
  const fi = args.indexOf('--from')
  const r = makeFirstOpen(target, { from: fi >= 0 ? args[fi + 1] : undefined, force: args.includes('--force') })
  console.log(`first-open folder: ${r.target} — ${r.files} files, ${(r.bytes / 1048576).toFixed(1)} MB, no .bmeta, no .bowerbird/`)
}
