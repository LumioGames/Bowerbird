#!/usr/bin/env node
/**
 * The sample libraries the tests use (fixtures/xingluo「星落镇」, fixtures/upload-batch) are generated, not kept in the
 * repository, so a download stays clean. This makes sure they exist and match their generators: missing, or generated
 * by other generator sources (a hash in fixtures/.generated.json), → generate them again (pnpm fixtures; needs ffmpeg).
 *
 *   node scripts/ensure-fixtures.mjs            generate when needed
 *   node scripts/ensure-fixtures.mjs --force    always generate
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAMP = path.join(REPO, 'fixtures/.generated.json')
const OUTPUTS = ['fixtures/xingluo/.bowerbird/library.json', 'fixtures/upload-batch']
/** What the generators read: their own code and the prototype data they copy. */
const SOURCES = ['fixtures/scripts', 'design/prototype/data.js', 'design/prototype/pages.js', 'design/prototype/viewers.js']

function filesUnder(p) {
  const abs = path.join(REPO, p)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [p]
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(e => filesUnder(path.join(p, e.name)))
}

export function sourcesHash() {
  const h = crypto.createHash('sha256')
  for (const f of SOURCES.flatMap(filesUnder).filter(f => /\.(mjs|js|json)$/.test(f)).sort()) {
    h.update(f.split(path.sep).join('/')).update('\0').update(fs.readFileSync(path.join(REPO, f))).update('\0')
  }
  return h.digest('hex')
}

function upToDate(hash) {
  if (!OUTPUTS.every(p => fs.existsSync(path.join(REPO, p)))) return false
  try { return JSON.parse(fs.readFileSync(STAMP, 'utf8')).sources === hash } catch { return false }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hash = sourcesHash()
  if (!process.argv.includes('--force') && upToDate(hash)) process.exit(0)
  if (spawnSync('ffmpeg', ['-hide_banner', '-version']).status !== 0) {
    process.stderr.write('The test sample libraries are generated and need ffmpeg (https://ffmpeg.org). Install it, then run the tests again.\n')
    process.exit(1)
  }
  process.stdout.write('generating the sample libraries (fixtures/xingluo, fixtures/upload-batch)…\n')
  const r = spawnSync('pnpm', ['--filter', '@bowerbird/fixtures', 'run', 'generate'], { cwd: REPO, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
  fs.writeFileSync(STAMP, JSON.stringify({ sources: hash }, null, 2) + '\n')
}
