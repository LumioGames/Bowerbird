#!/usr/bin/env node
// bb / bowerbird — the published entry. The six built-in plugins and the built web shell are copied into this
// package at pack time (scripts/stage.mjs); npm installs @bowerbird/cli beside this package, not inside it, so
// their locations are passed explicitly. In the monorepo (nothing staged) the CLI finds them itself.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { main } from '@bowerbird/cli/main'

const here = rel => fileURLToPath(new URL(rel, import.meta.url))
const pluginsDir = fs.existsSync(here('../plugins')) ? here('../plugins') : undefined
const webDir = fs.existsSync(here('../web/index.html')) ? here('../web') : undefined

main(process.argv.slice(2), { pluginsDir, webDir }).then(code => { if (code) process.exitCode = code }, e => {
  process.stderr.write(`错误：${e?.message ?? e}\n`)
  process.exitCode = 1
})
