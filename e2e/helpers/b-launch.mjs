// Launch `bb` (packages/cli/dist) with the built web shell passed explicitly.
// Work-around: locateAssets() in packages/cli/src/locate.ts walks up from packages/cli/dist and stops at
// packages/web (the Vite source index.html, whose <script src="/src/main.tsx"> cannot load) before it reaches
// packages/web/dist. Remove once the CLI finds packages/web/dist itself.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { main } = await import(path.join(repo, 'packages/cli/dist/main.js'))
const code = await main(process.argv.slice(2), { webDir: path.join(repo, 'packages/web/dist') })
if (code) process.exitCode = code
