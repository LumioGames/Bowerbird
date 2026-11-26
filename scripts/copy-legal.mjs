#!/usr/bin/env node
/**
 * prepack for every published package: npm packs only files inside the package folder, so this copies the
 * repository's LICENSE and THIRD_PARTY_NOTICES.md into it — after checking the notices still match the build
 * (pnpm notices regenerates them). The copies are ignored by git; the root files are the only source.
 * Packages under MIT (`"license": "MIT"`: schema, plugin-sdk, plugin-build — ADR-059) keep their own LICENSE and
 * only get the notices.
 *
 *   node ../../scripts/copy-legal.mjs [extra target dirs…]     (run from the package folder)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOTICES_FILE, render } from './third-party-notices.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const LEGAL_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md']

/** `license: false` keeps the target's own LICENSE (an MIT package) and copies only the notices. */
export function copyLegal(targets, { license = true } = {}) {
  const current = fs.existsSync(NOTICES_FILE) ? fs.readFileSync(NOTICES_FILE, 'utf8') : ''
  if (render() !== current) throw new Error('THIRD_PARTY_NOTICES.md does not match the build — run pnpm notices and commit it')
  for (const dir of targets) {
    for (const f of LEGAL_FILES) if (license || f !== 'LICENSE') fs.copyFileSync(path.join(REPO, f), path.join(dir, f))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const own = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).license
    copyLegal([process.cwd(), ...process.argv.slice(2).map(d => path.resolve(d))], { license: own !== 'MIT' })
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(1)
  }
}
