import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as Lucide from 'lucide-react'
import { hasIcon, lucideIcon } from './Icon'
import { ICONS } from './icon-table'

/**
 * The icon table (icon-table.ts) keeps the bundle to the icons that are used. Every Lucide name written in the shell's
 * and the bundled plugins' sources must be in it — otherwise it would draw the fallback.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const pascal = (n: string) => n.split('-').map(s => s[0]!.toUpperCase() + s.slice(1)).join('')

function namesIn(dir: string, out = new Set<string>()): Set<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) namesIn(p, out)
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'icon-table.ts') {
      // comments may quote words that happen to be icon names (`rows`, `container`): scan code only
      const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      for (const m of src.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g)) {
        // a dictionary key handed to a translate call (`t('timeline')`, `tr(…)`, `m(…)`) is not an icon name
        if (/\b(?:t|tr|m|translate)\(\s*$/.test(src.slice(Math.max(0, m.index! - 16), m.index))) continue
        const k = pascal(m[1]!)
        const lib = Lucide as unknown as Record<string, unknown>
        if (lib[k] && typeof lib[k] === 'object' && !/^(Icon|LucideIcon)$/.test(k)) out.add(m[1]!)
      }
    }
  }
  return out
}

describe('icon table', () => {
  it('has every Lucide name the shell and the bundled plugins use', () => {
    const used = new Set<string>()
    for (const d of ['packages/web/src', 'plugins', 'fixtures/plugins', 'packages/plugin-sdk/src/web']) namesIn(path.join(repo, d), used)
    const missing = [...used].filter(n => !hasIcon(n))
    expect(missing).toEqual([])
    expect(Object.keys(ICONS).length).toBeLessThan(400)
  })

  it('an unknown name draws the fallback', () => {
    expect(lucideIcon('no-such-icon')).toBe(ICONS['file'])
    expect(lucideIcon('folder-search')).toBe(ICONS['folder-search'])
  })
})
