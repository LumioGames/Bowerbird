// Bundles src/web/index.ts to dist/web.js (ESM, React external) so Node tooling can import the module
// (the plugin build helper reads its export names). The shell itself compiles the sources with Vite.
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [path.join(root, 'src/web/index.ts')],
  outfile: path.join(root, 'dist/web.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  logLevel: 'warning'
})
console.log('plugin-sdk: dist/web.js bundled')
