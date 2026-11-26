/**
 * The published `bowerbird` package (packages/bowerbird): manifest, dependency coverage of the six built-in
 * plugins, and the prepack staging that copies the plugins and the web shell into it.
 * (Kept under packages/cli/src so the workspace's vitest config picks it up.)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM script without type declarations
import { BUILTIN_PLUGINS, checkDependencies, stage } from '../../bowerbird/scripts/stage.mjs'

const REPO = path.resolve(import.meta.dirname, '../../..')
const PKG = path.join(REPO, 'packages/bowerbird')
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))

describe('bowerbird package manifest', () => {
  const pkg = read(path.join(PKG, 'package.json'))
  it('is the public main package with bb and bowerbird commands', () => {
    expect(pkg.name).toBe('bowerbird')
    expect(pkg.private).not.toBe(true)
    expect(pkg.bin).toEqual({ bb: 'bin/bb.js', bowerbird: 'bin/bb.js' })
    expect(pkg.files).toEqual(expect.arrayContaining(['bin', 'plugins', 'web']))
    expect(pkg.scripts.prepack).toMatch(/stage\.mjs/)
    expect(pkg.type).toBe('module')
    expect(fs.readFileSync(path.join(PKG, 'bin/bb.js'), 'utf8').startsWith('#!/usr/bin/env node')).toBe(true)
  })
  it('is the only package that provides the bb / bowerbird commands (no clash in node_modules/.bin)', () => {
    for (const dir of fs.readdirSync(path.join(REPO, 'packages'))) {
      if (dir === 'bowerbird') continue
      const f = path.join(REPO, 'packages', dir, 'package.json')
      if (!fs.existsSync(f)) continue
      const bin = read(f).bin ?? {}
      expect(Object.keys(typeof bin === 'string' ? { [dir]: bin } : bin), dir).not.toEqual(expect.arrayContaining(['bb']))
      expect(Object.keys(typeof bin === 'string' ? { [dir]: bin } : bin), dir).not.toEqual(expect.arrayContaining(['bowerbird']))
    }
  })
  it('depends on the runtime @bowerbird packages, never on the private web package', () => {
    for (const d of ['@bowerbird/cli', '@bowerbird/core', '@bowerbird/server', '@bowerbird/mcp', '@bowerbird/schema', '@bowerbird/plugin-sdk']) {
      expect(pkg.dependencies[d], d).toBe('workspace:*')
    }
    expect(pkg.dependencies['@bowerbird/web']).toBeUndefined()
    expect(read(path.join(REPO, 'packages/web/package.json')).private).toBe(true)
  })
  it('lists the six built-in plugins and nothing else', () => {
    const dirs = fs.readdirSync(path.join(REPO, 'plugins')).filter(d => fs.existsSync(path.join(REPO, 'plugins', d, 'package.json')))
    expect([...BUILTIN_PLUGINS].sort()).toEqual(dirs.sort())
    expect(BUILTIN_PLUGINS).toHaveLength(6)
  })
  it('covers every runtime dependency of the built-in plugins with the same version', () => {
    expect(checkDependencies({ repo: REPO, pkgDir: PKG })).toEqual([])
  })
})

/** Bare module specifiers a plugin's server code loads at run time (type-only imports excluded). */
function serverRuntimeImports(pluginDir: string): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'web' && e.name !== '__tests__') walk(p); continue }
      if (!/\.(ts|mts)$/.test(e.name) || /\.(test|d)\.ts$/.test(e.name)) continue
      const src = fs.readFileSync(p, 'utf8')
      const re = /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
      for (const m of src.matchAll(re)) {
        if (m[1]) continue
        const spec = m[2] ?? m[3]!
        if (spec.startsWith('.') || spec.startsWith('node:')) continue
        out.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!)
      }
    }
  }
  walk(path.join(pluginDir, 'src'))
  return out
}

/** Third-party packages an `npm install bowerbird` pulls in through `dependencies` (peers not followed). */
function installClosure(): Set<string> {
  const ws = new Map<string, any>()
  for (const group of ['packages', 'plugins']) {
    for (const d of fs.readdirSync(path.join(REPO, group))) {
      const f = path.join(REPO, group, d, 'package.json')
      if (fs.existsSync(f)) { const j = read(f); ws.set(j.name, j) }
    }
  }
  const seen = new Set<string>()
  const third = new Set<string>()
  const visit = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    for (const dep of Object.keys(ws.get(name)?.dependencies ?? {})) {
      if (ws.has(dep)) visit(dep)
      else third.add(dep)
    }
  }
  visit('bowerbird')
  return third
}

describe('build tools are not installed with bowerbird', () => {
  const sdk = read(path.join(REPO, 'packages/plugin-sdk/package.json'))
  const pb = read(path.join(REPO, 'packages/plugin-build/package.json'))
  it('@bowerbird/plugin-build provides bowerbird-plugin-build and carries the build tools and UI typings', () => {
    expect(pb.name).toBe('@bowerbird/plugin-build')
    expect(pb.private).not.toBe(true)
    expect(Object.keys(pb.bin ?? {})).toEqual(['bowerbird-plugin-build'])
    expect(fs.existsSync(path.join(REPO, 'packages/plugin-build', pb.bin['bowerbird-plugin-build']))).toBe(true)
    for (const d of ['esbuild', '@tailwindcss/cli', 'tailwindcss', 'react', 'react-dom', '@types/react', '@types/react-dom', 'radix-ui', 'motion', 'lucide-react', 'sonner', 'class-variance-authority', 'clsx', 'tailwind-merge', '@bowerbird/plugin-sdk']) {
      expect(pb.dependencies?.[d], d).toBeDefined()
    }
  })
  it('@bowerbird/plugin-sdk needs only @bowerbird/schema at run time; React is an optional peer; no build bin', () => {
    expect(sdk.dependencies).toEqual({ '@bowerbird/schema': 'workspace:*' })
    expect(sdk.peerDependenciesMeta).toEqual({ react: { optional: true }, 'react-dom': { optional: true } })
    expect(sdk.bin).toBeUndefined()
    expect(sdk.exports['./build']).toBeUndefined()
    for (const d of ['esbuild', 'radix-ui', 'motion', 'lucide-react', 'sonner', 'class-variance-authority', 'clsx', 'tailwind-merge']) {
      expect(sdk.devDependencies?.[d], d).toBeDefined()
    }
    expect(fs.existsSync(path.join(REPO, 'packages/plugin-sdk/build/build-web.mjs'))).toBe(false)
  })
  it('every plugin builds its web part with @bowerbird/plugin-build and depends only on what its server code loads', () => {
    const dirs = [...(BUILTIN_PLUGINS as string[]).map(d => path.join(REPO, 'plugins', d)), path.join(REPO, 'fixtures/plugins/forge')]
    for (const dir of dirs) {
      const pkg = read(path.join(dir, 'package.json'))
      const name = path.basename(dir)
      if (pkg.bowerbird.web) {
        expect(pkg.scripts.build, name).toMatch(/bowerbird-plugin-build/)
        expect(pkg.devDependencies?.['@bowerbird/plugin-build'], name).toBe('workspace:*')
      }
      const needed = serverRuntimeImports(dir)
      expect(Object.keys(pkg.dependencies ?? {}).sort(), name).toEqual([...needed].sort())
    }
  })
  it('npm install bowerbird pulls in no build tools and no React', () => {
    const closure = installClosure()
    for (const banned of ['esbuild', 'tailwindcss', '@tailwindcss/cli', 'react', 'react-dom', 'radix-ui', 'motion', 'three', 'markdown-it']) {
      expect(closure.has(banned), banned).toBe(false)
    }
    expect(closure.has('sharp')).toBe(true)
    expect(closure.has('better-sqlite3')).toBe(true)
  })
  it('the stage check flags dependencies no plugin needs any more', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pkgdeps-'))
    const own = read(path.join(PKG, 'package.json'))
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ ...own, dependencies: { ...own.dependencies, three: '0.180.0' } }))
    expect(checkDependencies({ repo: REPO, pkgDir: tmp })).toEqual(['three is not needed by any built-in plugin or runtime package'])
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

describe('prepack staging', () => {
  const tmps: string[] = []
  afterEach(() => { for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true }) })

  function fakeRepo(opts: { webBuilt?: boolean; builtExcept?: string } = {}) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-stage-'))
    tmps.push(repo)
    const write = (rel: string, data: string | object) => {
      const p = path.join(repo, rel)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data))
    }
    write('packages/schema/package.json', { name: '@bowerbird/schema', version: '0.3.0' })
    write('packages/plugin-sdk/package.json', { name: '@bowerbird/plugin-sdk', version: '0.3.1' })
    for (const p of BUILTIN_PLUGINS as string[]) {
      write(`plugins/${p}/package.json`, {
        name: `@bowerbird/plugin-${p}`, version: '0.1.0', type: 'module', license: 'MIT', files: ['dist'],
        scripts: { build: 'tsc -b' }, devDependencies: { react: '19.2.9' },
        dependencies: { '@bowerbird/plugin-sdk': 'workspace:*', '@bowerbird/schema': 'workspace:*', sharp: '0.34.5' },
        bowerbird: { id: `bowerbird.${p}`, displayName: p, apiVersion: 1, server: './dist/server.js', ...(p === 'search-keyword' ? {} : { web: './dist/web.js' }) }
      })
      if (p !== opts.builtExcept) {
        write(`plugins/${p}/dist/server.js`, 'export default {}')
        write(`plugins/${p}/dist/server.d.ts`, 'export {}')
        write(`plugins/${p}/dist/server.js.map`, '{}')
        if (p !== 'search-keyword') write(`plugins/${p}/dist/web.js`, 'export default {}')
      }
      write(`plugins/${p}/src/server.ts`, '')
    }
    write('fixtures/plugins/forge/package.json', { name: '@bowerbird-fixtures/plugin-forge', bowerbird: { id: 'community.forge' } })
    write('fixtures/plugins/forge/dist/server.js', '')
    if (opts.webBuilt !== false) { write('packages/web/dist/index.html', '<!doctype html>'); write('packages/web/dist/assets/app-1.js', '1') }
    const pkgDir = path.join(repo, 'packages/bowerbird')
    fs.mkdirSync(pkgDir, { recursive: true })
    return { repo, pkgDir }
  }

  it('copies the six plugins (manifest + dist, no type declarations) and the web dist', () => {
    const { repo, pkgDir } = fakeRepo()
    fs.mkdirSync(path.join(pkgDir, 'plugins/stale'), { recursive: true })
    const r = stage({ repo, pkgDir })
    expect(r.plugins.sort()).toEqual([...BUILTIN_PLUGINS].sort())
    expect(fs.readdirSync(path.join(pkgDir, 'plugins')).sort()).toEqual([...BUILTIN_PLUGINS].sort())
    const img = read(path.join(pkgDir, 'plugins/image/package.json'))
    expect(img.dependencies).toEqual({ '@bowerbird/plugin-sdk': '0.3.1', '@bowerbird/schema': '0.3.0', sharp: '0.34.5' })
    expect(img.scripts).toBeUndefined()
    expect(img.devDependencies).toBeUndefined()
    expect(img.bowerbird.id).toBe('bowerbird.image')
    expect(fs.existsSync(path.join(pkgDir, 'plugins/image/dist/server.js'))).toBe(true)
    expect(fs.existsSync(path.join(pkgDir, 'plugins/image/dist/server.js.map'))).toBe(true)
    expect(fs.existsSync(path.join(pkgDir, 'plugins/image/dist/server.d.ts'))).toBe(false)
    expect(fs.existsSync(path.join(pkgDir, 'plugins/image/src'))).toBe(false)
    expect(fs.existsSync(path.join(pkgDir, 'web/index.html'))).toBe(true)
    expect(fs.existsSync(path.join(pkgDir, 'web/assets/app-1.js'))).toBe(true)
    expect(fs.existsSync(path.join(pkgDir, 'plugins/forge'))).toBe(false)
  })
  it('refuses to stage unbuilt plugins or an unbuilt web shell', () => {
    const a = fakeRepo({ builtExcept: 'model' })
    expect(() => stage(a)).toThrow(/plugins\/model.*pnpm build/)
    const b = fakeRepo({ webBuilt: false })
    expect(() => stage(b)).toThrow(/packages\/web\/dist.*pnpm build/)
  })
})

describe('bin/bb.js', () => {
  const cliBuilt = fs.existsSync(path.join(REPO, 'packages/cli/dist/main.js'))
  it.skipIf(!cliBuilt)('runs the CLI (needs `pnpm build`)', () => {
    const out = execFileSync(process.execPath, [path.join(PKG, 'bin/bb.js'), '--version'], { encoding: 'utf8' })
    expect(out.trim()).toBe(read(path.join(REPO, 'packages/cli/package.json')).version)
  })
})

describe('license (PolyForm Shield 1.0.0 with LumioGames additions, ADR-058; plugin packages MIT, ADR-059)', () => {
  const MIT_PACKAGES = ['packages/schema', 'packages/plugin-sdk', 'packages/plugin-build']
  const license = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8')
  const manifests = () => {
    const out: Array<{ rel: string; pkg: Record<string, unknown> }> = [{ rel: 'package.json', pkg: read(path.join(REPO, 'package.json')) }]
    for (const group of ['packages', 'plugins', 'fixtures/plugins']) {
      for (const d of fs.readdirSync(path.join(REPO, group))) {
        const f = path.join(REPO, group, d, 'package.json')
        if (fs.existsSync(f)) out.push({ rel: `${group}/${d}/package.json`, pkg: read(f) })
      }
    }
    return out
  }
  it('LICENSE carries the Bowerbird notices, the additional permission and the full PolyForm Shield text', () => {
    expect(license.startsWith('# Bowerbird License\n')).toBe(true)
    expect(license).toContain('Required Notice: Copyright © 2026 LumioGames (https://lumio.games)')
    expect(license).toContain('Required Notice: Bowerbird is licensed under the PolyForm Shield License 1.0.0')
    expect(license).toContain('Licensor Line of Business: Bowerbird')
    expect(license).toContain('## Additional Permission')
    expect(license).toContain('**Parts under the MIT License.**')
    for (const p of ['@bowerbird/plugin-sdk', '@bowerbird/plugin-build', '@bowerbird/schema']) expect(license).toContain(p)
    expect(license).toContain('## Trademarks')
    expect(license).toContain('# PolyForm Shield License 1.0.0')
    expect(license).toContain('**Use** means anything you do with the software requiring one of your licenses.')
  })
  it('the packages plugins are built with are MIT with their own LICENSE; every other package points at LICENSE', () => {
    for (const { rel, pkg } of manifests()) {
      const dir = path.dirname(rel)
      expect(pkg.license, rel).toBe(MIT_PACKAGES.includes(dir) ? 'MIT' : 'SEE LICENSE IN LICENSE')
    }
    for (const dir of MIT_PACKAGES) {
      const own = fs.readFileSync(path.join(REPO, dir, 'LICENSE'), 'utf8')
      expect(own.startsWith('MIT License\n\nCopyright (c) 2026 LumioGames (https://lumio.games)\n'), dir).toBe(true)
    }
  })
  it('every published package copies LICENSE and THIRD_PARTY_NOTICES.md in when packed', () => {
    for (const { rel, pkg } of manifests()) {
      if (!rel.startsWith('packages/') || pkg.private) continue
      expect(String((pkg.scripts as Record<string, string> | undefined)?.prepack ?? ''), rel).toMatch(/copy-legal\.mjs|stage\.mjs/)
      expect(pkg.files as string[], rel).toContain('THIRD_PARTY_NOTICES.md')
    }
    expect(fs.readFileSync(path.join(PKG, 'scripts/stage.mjs'), 'utf8')).toMatch(/copyLegal\(/)
  })
  const built = fs.existsSync(path.join(REPO, 'packages/web/dist/index.html')) && fs.existsSync(path.join(REPO, 'plugins/model/dist/web.js.map'))
  it.skipIf(!built)('THIRD_PARTY_NOTICES.md lists exactly what the build bundles (needs `pnpm build`)', async () => {
    // @ts-expect-error — plain ESM script without type declarations
    const { render, NOTICES_FILE } = await import('../../../scripts/third-party-notices.mjs')
    expect(render(), 'run pnpm notices').toBe(fs.readFileSync(NOTICES_FILE, 'utf8'))
  })
})
