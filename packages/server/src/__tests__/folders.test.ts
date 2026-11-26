import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listFolders, mayLookInside } from '../folders.js'

/** Listing the home folder on macOS must not look inside folders the system protects (no privacy prompt). */
const tmps: string[] = []
afterEach(() => { for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true }) })
function home(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-home-'))
  tmps.push(h)
  for (const d of ['Documents', 'Art']) fs.mkdirSync(path.join(h, d, '.bowerbird'), { recursive: true })
  for (const d of ['Documents', 'Art']) fs.writeFileSync(path.join(h, d, '.bowerbird', 'library.json'), '{}')
  return fs.realpathSync(h)
}

describe('folder chooser and macOS protected folders', () => {
  it('on macOS the home listing does not look inside Documents (no library flag there); other folders are checked', async () => {
    const h = home()
    const r = await listFolders(h, { home: h, platform: 'darwin' })
    expect(r.folders.map(f => [f.name, f.library])).toEqual([['Art', true], ['Documents', false]])
    // entering Documents itself is the person's own action: there the check runs as usual
    expect((await listFolders(path.join(h, 'Documents'), { home: h, platform: 'darwin' })).library).toBe(true)
  })
  it('other systems check every folder', async () => {
    const h = home()
    expect((await listFolders(h, { home: h, platform: 'linux' })).folders.map(f => f.library)).toEqual([true, true])
  })
  it('the volume list is never looked into on macOS', () => {
    expect(mayLookInside('/Volumes', 'Backup', '/Users/x', 'darwin')).toBe(false)
    expect(mayLookInside('/Users/x/Art', 'Documents', '/Users/x', 'darwin')).toBe(true)
    expect(mayLookInside('/Volumes', 'Backup', '/home/x', 'linux')).toBe(true)
  })
})
