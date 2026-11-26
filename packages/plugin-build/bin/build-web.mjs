#!/usr/bin/env node
// bowerbird-plugin-build — builds a plugin's web part (plugin-system.md「网页接口」).
//
//   bowerbird-plugin-build [--entry src/web/index.tsx] [--out dist/web.js] [--css-source src/web] [--no-css]
//
// 1. Bundles the entry with esbuild as one ES module. React, react-dom and @bowerbird/plugin-sdk/web are NOT
//    bundled: they resolve at runtime to the shell's instances (globalThis.__bowerbird_shared__).
// 2. Compiles Tailwind utilities used under --css-source against the shared theme (theme as reference, no preflight)
//    and prepends a few lines that inject them as <style data-bb-plugin> when the module loads.
// Built-in and third-party plugins build the same way. Provided by @bowerbird/plugin-build (a devDependency of
// plugins), so the build tools never reach people who only install Bowerbird.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SHARED_MODULES, SHARED_GLOBAL } from './shared-modules.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const cwd0 = process.cwd()
/** The plugin's own @bowerbird/plugin-sdk (theme.css, dist/web.js), else the one installed with this tool. */
const sdkRoot = path.dirname(require.resolve('@bowerbird/plugin-sdk/package.json', { paths: [cwd0, here] }))
/** React (read for its export names) and the Tailwind compiler come with this tool. */
const toolPaths = [here, cwd0]

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def }
const cwd = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
const pluginId = pkg.bowerbird?.id ?? pkg.name
const entry = path.resolve(cwd, arg('--entry', 'src/web/index.tsx'))
const out = path.resolve(cwd, arg('--out', pkg.bowerbird?.web ?? 'dist/web.js'))
const cssSource = path.resolve(cwd, arg('--css-source', path.dirname(entry)))
const withCss = !process.argv.includes('--no-css')

/** Named exports of each shared module, read from the real modules at build time. */
async function exportNames(spec) {
  let mod
  if (spec === '@bowerbird/plugin-sdk/web') mod = await import(pathToFileURL(path.join(sdkRoot, 'dist/web.js')).href)
  else mod = await import(pathToFileURL(require.resolve(spec, { paths: toolPaths })).href)
  return Object.keys(mod).filter(k => k !== 'default' && /^[A-Za-z_$][\w$]*$/.test(k))
}

const sharedPlugin = {
  name: 'bowerbird-shared',
  setup(b) {
    const filter = new RegExp('^(' + SHARED_MODULES.map(s => s.replace(/[/.]/g, m => '\\' + m)).join('|') + ')$')
    b.onResolve({ filter }, args => ({ path: args.path, namespace: 'bb-shared' }))
    b.onLoad({ filter: /.*/, namespace: 'bb-shared' }, async args => {
      const names = await exportNames(args.path)
      const g = `globalThis[${JSON.stringify(SHARED_GLOBAL)}]`
      const contents = `const m = (${g} || {})[${JSON.stringify(args.path)}];\n` +
        `if (!m) throw new Error('Bowerbird shell did not provide ${args.path}');\n` +
        `export default (m.default ?? m);\n` +
        (names.length ? `export const { ${names.join(', ')} } = m;\n` : '')
      return { contents, loader: 'js' }
    })
  }
}

function compileCss() {
  if (!withCss || !fs.existsSync(cssSource)) return ''
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-plugin-css-'))
  const input = path.join(tmp, 'in.css')
  const outCss = path.join(tmp, 'out.css')
  const twDir = path.dirname(require.resolve('tailwindcss/package.json', { paths: toolPaths }))
  fs.writeFileSync(input, [
    '@layer theme, base, components, utilities;',
    `@import ${JSON.stringify(path.join(twDir, 'theme.css'))} layer(theme) reference;`,
    `@import ${JSON.stringify(path.join(twDir, 'utilities.css'))} layer(utilities) source(none);`,
    `@import ${JSON.stringify(path.join(sdkRoot, 'src/web/styles/theme.css'))} reference;`,
    `@source ${JSON.stringify(cssSource)};`
  ].join('\n'))
  const cliPkg = require.resolve('@tailwindcss/cli/package.json', { paths: toolPaths })
  const bin = path.join(path.dirname(cliPkg), JSON.parse(fs.readFileSync(cliPkg, 'utf8')).bin.tailwindcss)
  const r = spawnSync(process.execPath, [bin, '-i', input, '-o', outCss, '--minify'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) { console.error(r.stderr); throw new Error('tailwind failed') }
  const css = fs.readFileSync(outCss, 'utf8')
  fs.rmSync(tmp, { recursive: true, force: true })
  return css
}

const css = compileCss()
const banner = css
  ? `(()=>{if(typeof document==='undefined')return;const id=${JSON.stringify(pluginId)};if(document.querySelector('style[data-bb-plugin="'+id+'"]'))return;const s=document.createElement('style');s.dataset.bbPlugin=id;s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();`
  : ''

await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: process.env.BB_PLUGIN_MINIFY !== '0',
  sourcemap: true,
  banner: banner ? { js: banner } : undefined,
  plugins: [sharedPlugin],
  logLevel: 'warning',
  loader: { '.png': 'dataurl', '.hdr': 'dataurl', '.svg': 'text' }
})
console.log(`${pluginId}: web bundle → ${path.relative(cwd, out)}${css ? ` (+${css.length} bytes css)` : ''}`)
