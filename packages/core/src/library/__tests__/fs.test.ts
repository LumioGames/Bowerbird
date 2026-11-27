import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { BMETA_KEY_ORDER, type Bmeta } from '@bowerbird/schema'
import { LocalLibraryFs } from '../fs.js'
import { effectiveDefaults } from '../defaults.js'
import { normRel } from '../paths.js'

const dirs: string[] = []
function tmp(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-fs-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

const ID = '0192f3a7-5c1e-7b3a-9d2f-4a6c8e0b1d23'
const meta = (extra: Partial<Bmeta> = {}): Bmeta => ({
  bb: 1, id: ID, hash: 'sha256:00', stage: 'production', created: { at: '2026-11-25T00:00:00Z', by: 'user:a' }, ...extra
})

describe('LibraryFs', () => {
  it('writes sidecars atomically with the fixed key order and keeps unknown keys', async () => {
    const root = tmp()
    const seen: string[] = []
    const lfs = new LocalLibraryFs(root, { onWrite: r => seen.push(r) })
    fs.writeFileSync(path.join(root, 'a.png'), 'x')
    await lfs.writeSidecar('a.png', { ...meta({ tags: ['宝箱'] }), futureKey: { x: 1 } } as Bmeta)
    const raw = fs.readFileSync(path.join(root, 'a.png.bmeta'), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('\n  "bb": 1,')
    const keys = Object.keys(JSON.parse(raw))
    expect(keys.slice(0, 5)).toEqual(['bb', 'id', 'hash', 'stage', 'tags'])
    expect(keys.indexOf('created')).toBeGreaterThan(keys.indexOf('tags'))
    expect(keys[keys.length - 1]).toBe('futureKey')
    expect(BMETA_KEY_ORDER[0]).toBe('bb')
    expect(fs.readdirSync(root).filter(n => n.endsWith('.tmp'))).toEqual([])
    expect(seen).toContain('a.png.bmeta')
    const back = await lfs.readSidecar('a.png')
    expect(back?.ok && back.meta.id).toBe(ID)
    expect(back?.ok && (back.meta as Record<string, unknown>).futureKey).toEqual({ x: 1 })
  })

  it('reports unreadable sidecars instead of guessing (R10)', async () => {
    const root = tmp()
    const lfs = new LocalLibraryFs(root)
    fs.writeFileSync(path.join(root, 'a.png.bmeta'), '{ "bb": 1, "id": ')
    const r = await lfs.readSidecar('a.png')
    expect(r && !r.ok).toBe(true)
    fs.writeFileSync(path.join(root, 'b.png.bmeta'), JSON.stringify({ bb: 1, id: 'nope' }))
    const r2 = await lfs.readSidecar('b.png')
    expect(r2 && !r2.ok && r2.error).toMatch(/id/)
    expect(await lfs.readSidecar('missing.png')).toBeNull()
  })

  it('inherits folder defaults item by item from the nearest ancestor', async () => {
    const root = tmp()
    const lfs = new LocalLibraryFs(root)
    fs.mkdirSync(path.join(root, 'props/chest'), { recursive: true })
    await lfs.writeFolderMeta('', { bb: 1, defaults: { tags: ['全库'] } })
    await lfs.writeFolderMeta('props', { bb: 1, label: '道具', defaults: { stage: 'runtime', review: 'exempt' } })
    await lfs.writeFolderMeta('props/chest', { bb: 1, defaults: { review: 'pending' } })
    const d = await effectiveDefaults(lfs, 'props/chest')
    expect(d).toEqual({ stage: 'runtime', review: 'pending', tags: ['全库'], from: { review: 'props/chest', stage: 'props', tags: '' } })
    expect((await lfs.readFolderMeta('props'))?.label).toBe('道具')
    await lfs.writeFolderMeta('props', null)
    expect(await lfs.readFolderMeta('props')).toBeNull()
  })

  it('applies built-in ignore rules and .bbignore', () => {
    const root = tmp()
    fs.writeFileSync(path.join(root, '.bbignore'), 'build/\n*.psd\n')
    const lfs = new LocalLibraryFs(root)
    expect(lfs.ignored('.bowerbird', true)).toBe(true)
    expect(lfs.ignored('a/.DS_Store', false)).toBe(true)
    expect(lfs.ignored('a/x.png.bmeta', false)).toBe(true)
    expect(lfs.ignored('a/_folder.bmeta', false)).toBe(true)
    expect(lfs.ignored('Thumbs.db', false)).toBe(true)
    expect(lfs.ignored('~$doc.docx', false)).toBe(true)
    expect(lfs.ignored('a/x.part', false)).toBe(true)
    expect(lfs.ignored('build/a.png', false)).toBe(true)
    expect(lfs.ignored('art/hero.psd', false)).toBe(true)
    expect(lfs.ignored('art/hero.png', false)).toBe(false)
    fs.writeFileSync(path.join(root, '.bbignore'), '')
    lfs.reloadIgnore()
    expect(lfs.ignored('art/hero.psd', false)).toBe(false)
  })

  it('hashes files by streaming SHA-256 and bundles by sorted path + file hash', async () => {
    const root = tmp()
    const lfs = new LocalLibraryFs(root)
    fs.writeFileSync(path.join(root, 'a.txt'), 'hello')
    expect(await lfs.hash('a.txt')).toBe('sha256:' + createHash('sha256').update('hello').digest('hex'))
    const mk = (dir: string, order: string[]) => {
      for (const n of order) {
        fs.mkdirSync(path.dirname(path.join(root, dir, n)), { recursive: true })
        fs.writeFileSync(path.join(root, dir, n), `content of ${n}`)
      }
    }
    mk('b1', ['index.html', 'assets/app.js', 'assets/style.css'])
    mk('b2', ['assets/style.css', 'index.html', 'assets/app.js'])
    fs.writeFileSync(path.join(root, 'b2', '.DS_Store'), 'junk')
    const h1 = await lfs.hash('b1')
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await lfs.hash('b2')).toBe(h1)
    const lines = ['assets/app.js', 'assets/style.css', 'index.html'].map(n => `${n} sha256:${createHash('sha256').update(`content of ${n}`).digest('hex')}`)
    expect(h1).toBe('sha256:' + createHash('sha256').update(lines.join('\n')).digest('hex'))
    fs.writeFileSync(path.join(root, 'b2', 'index.html'), 'changed')
    expect(await lfs.hash('b2')).not.toBe(h1)
  })

  it('reads the production records of an older library and sets the folder aside (ADR-070)', async () => {
    const root = tmp()
    const lfs = new LocalLibraryFs(root)
    expect(await lfs.hasLegacyRecords()).toBe(false)
    const rec = { bb: 1 as const, id: 'rec_0192f3a7-5c1e-7b3a-9d2f-4a6c8e0b1d23', method: 'ai-generate', prompt: '宝箱', by: 'agent:x', at: '2026-11-25T08:00:00Z' }
    fs.mkdirSync(path.join(root, '.bowerbird/records/2026'), { recursive: true })
    fs.writeFileSync(path.join(root, '.bowerbird/records/2026', `${rec.id}.json`), JSON.stringify(rec))
    expect(await lfs.hasLegacyRecords()).toBe(true)
    expect((await lfs.listRecords()).map(r => r.prompt)).toEqual(['宝箱'])
    const aside = await lfs.setAsideRecords()
    expect(aside).toMatch(/^records-converted-\d{4}-\d{2}-\d{2}$/)
    expect(await lfs.hasLegacyRecords()).toBe(false)
    expect(fs.existsSync(path.join(root, '.bowerbird', aside, '2026', `${rec.id}.json`))).toBe(true)
  })

  it('rejects paths that escape the library', () => {
    expect(() => normRel('../x')).toThrow()
    expect(() => normRel('a/../../x')).toThrow()
    expect(normRel('/a//b/')).toBe('a/b')
    expect(normRel('a\\b')).toBe('a/b')
  })
})
