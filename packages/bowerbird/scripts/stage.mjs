#!/usr/bin/env node
// prepack for the `bowerbird` package: copies the six built-in plugins (package.json + dist) and the built web
// shell (packages/web/dist) into this package, checks that this package depends on everything they need, and
// copies LICENSE and THIRD_PARTY_NOTICES.md into it (scripts/copy-legal.mjs).
// Run `pnpm build` first. Test plugins under fixtures/ are never included; @bowerbird/web stays private.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Directories under `<repo>/plugins/` that ship with the main package. */
export const BUILTIN_PLUGINS = ['image', 'video', 'audio', 'model', 'doc', 'search-keyword']
/** @bowerbird packages the main package needs at run time (the plugins import plugin-sdk and schema). */
export const RUNTIME_PACKAGES = ['@bowerbird/cli', '@bowerbird/core', '@bowerbird/server', '@bowerbird/mcp', '@bowerbird/schema', '@bowerbird/plugin-sdk']

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))

/** name → version of every workspace package under packages/ and plugins/. */
function workspaceVersions(repo) {
  const out = {}
  for (const group of ['packages', 'plugins']) {
    const dir = path.join(repo, group)
    if (!fs.existsSync(dir)) continue
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, 'package.json')
      if (!fs.existsSync(f)) continue
      const pkg = readJson(f)
      if (pkg.name) out[pkg.name] = pkg.version
    }
  }
  return out
}

/** Copy a dist folder without TypeScript declarations and build info. */
function copyDist(src, dst) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: p => !/\.d\.ts(\.map)?$/.test(p) && !p.endsWith('.tsbuildinfo')
  })
}

export function stage({ repo, pkgDir }) {
  const versions = workspaceVersions(repo)
  const outPlugins = path.join(pkgDir, 'plugins')
  const outWeb = path.join(pkgDir, 'web')
  const problems = []
  const plugins = []
  for (const dir of BUILTIN_PLUGINS) {
    const src = path.join(repo, 'plugins', dir)
    const pkg = readJson(path.join(src, 'package.json'))
    const m = pkg.bowerbird
    if (!m) { problems.push(`plugins/${dir} has no bowerbird manifest`); continue }
    for (const entry of [m.server, m.web].filter(Boolean)) {
      if (!fs.existsSync(path.join(src, entry))) problems.push(`plugins/${dir}/${entry.replace(/^\.\//, '')} is missing — run pnpm build`)
    }
    plugins.push({ dir, src, pkg })
  }
  const webSrc = path.join(repo, 'packages', 'web', 'dist')
  if (!fs.existsSync(path.join(webSrc, 'index.html'))) problems.push('packages/web/dist/index.html is missing — run pnpm build')
  if (problems.length) throw new Error(`cannot stage the bowerbird package:\n  ${problems.join('\n  ')}`)

  fs.rmSync(outPlugins, { recursive: true, force: true })
  fs.rmSync(outWeb, { recursive: true, force: true })
  for (const { dir, src, pkg } of plugins) {
    const dst = path.join(outPlugins, dir)
    fs.mkdirSync(dst, { recursive: true })
    const deps = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).map(([n, v]) =>
      [n, String(v).startsWith('workspace:') ? (versions[n] ?? (() => { throw new Error(`plugins/${dir}: no workspace package ${n}`) })()) : v]))
    const manifest = {
      name: pkg.name, version: pkg.version, ...(pkg.description ? { description: pkg.description } : {}),
      license: pkg.license, type: pkg.type, ...(pkg.main ? { main: pkg.main } : {}), ...(pkg.exports ? { exports: pkg.exports } : {}),
      dependencies: deps, bowerbird: pkg.bowerbird
    }
    fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    copyDist(path.join(src, 'dist'), path.join(dst, 'dist'))
  }
  fs.cpSync(webSrc, outWeb, { recursive: true })
  return { plugins: plugins.map(p => p.dir), web: outWeb }
}

/** Problems with this package's dependencies (empty = fine). */
export function checkDependencies({ repo, pkgDir }) {
  const own = readJson(path.join(pkgDir, 'package.json')).dependencies ?? {}
  const problems = []
  for (const n of RUNTIME_PACKAGES) if (!own[n]) problems.push(`missing dependency ${n}`)
  if (own['@bowerbird/web']) problems.push('@bowerbird/web is private and must not be a dependency')
  const needed = new Set(RUNTIME_PACKAGES)
  for (const dir of BUILTIN_PLUGINS) {
    const pkg = readJson(path.join(repo, 'plugins', dir, 'package.json'))
    for (const [n, v] of Object.entries(pkg.dependencies ?? {})) {
      needed.add(n)
      if (String(v).startsWith('workspace:')) { if (!own[n]) problems.push(`plugins/${dir} needs ${n}`); continue }
      if (own[n] !== v) problems.push(`plugins/${dir} needs ${n}@${v}, the package has ${own[n] ?? 'nothing'}`)
    }
  }
  // Only what the plugins' server code and the runtime packages load: web-only libraries are bundled into
  // each plugin's dist/web.js, and build tools belong to @bowerbird/plugin-build.
  for (const n of Object.keys(own)) if (!needed.has(n) && n !== '@bowerbird/web') problems.push(`${n} is not needed by any built-in plugin or runtime package`)
  return problems
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const repo = path.resolve(pkgDir, '../..')
  try {
    const problems = checkDependencies({ repo, pkgDir })
    if (problems.length) throw new Error(`bowerbird package.json is out of date:\n  ${problems.join('\n  ')}`)
    const r = stage({ repo, pkgDir })
    // LICENSE and THIRD_PARTY_NOTICES.md into the package and each staged plugin (checks the notices are current)
    const { copyLegal } = await import(pathToFileURL(path.join(repo, 'scripts/copy-legal.mjs')).href)
    copyLegal([pkgDir, ...r.plugins.map(d => path.join(pkgDir, 'plugins', d))])
    process.stdout.write(`staged plugins ${r.plugins.join(', ')}, the web shell and the license files into ${path.relative(repo, pkgDir)}\n`)
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(1)
  }
}
