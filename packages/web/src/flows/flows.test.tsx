import { describe, expect, it, vi } from 'vitest'
import { destOf, nextName, resolveConflicts, type ConflictChoice, type ConflictQuestion, type PlannedFile } from './upload-plan'
import { pickLibrary } from '../shell/RootRedirect'

const f = (name: string, dest = 'props/chest'): PlannedFile<string> => ({ file: `${dest}/${name}`, name, dest })

describe('upload: where files go', () => {
  it('a dropped folder keeps its structure only when asked', () => {
    expect(destOf('props', 'export/ui', true)).toBe('props/export/ui')
    expect(destOf('props', 'export/ui', false)).toBe('props')
    expect(destOf('', 'export/ui', true)).toBe('export/ui')
    expect(destOf('props', undefined, true)).toBe('props')
  })
})

describe('upload: taken names are asked one by one', () => {
  const taken = (names: string[]) => (dest: string, name: string) => (names.includes(`${dest}/${name}`) ? 'existing-id' : null)

  it('no conflict, no question', async () => {
    const ask = vi.fn()
    const out = await resolveConflicts([f('a.png'), f('b.png')], taken([]), ask)
    expect(ask).not.toHaveBeenCalled()
    expect(out!.map(x => x.name)).toEqual(['a.png', 'b.png'])
  })

  it('each choice: replace as a new version, keep both, skip', async () => {
    const answers: ConflictChoice[] = ['replace', 'keep-both', 'skip']
    const ask = vi.fn(async () => ({ choice: answers.shift()!, rest: false }))
    const out = await resolveConflicts([f('a.png'), f('b.png'), f('c.png'), f('d.png')], taken(['props/chest/a.png', 'props/chest/b.png', 'props/chest/c.png']), ask)
    expect(ask).toHaveBeenCalledTimes(3)
    expect(out!.map(x => [x.name, x.onConflict])).toEqual([['a.png', 'replace'], ['b.png', 'keep-both'], ['d.png', undefined]])
  })

  it('「对其余同名文件同样处理」stops asking', async () => {
    const ask = vi.fn(async () => ({ choice: 'skip' as const, rest: true }))
    const out = await resolveConflicts([f('a.png'), f('b.png'), f('c.png')], taken(['props/chest/a.png', 'props/chest/b.png']), ask)
    expect(ask).toHaveBeenCalledOnce()
    expect(out!.map(x => x.name)).toEqual(['c.png'])
  })

  it('offers「同样处理」only when more conflicts follow', async () => {
    const more: boolean[] = []
    await resolveConflicts([f('a.png'), f('b.png'), f('c.png')], taken(['props/chest/a.png', 'props/chest/c.png']), async q => { more.push(q.more); return { choice: 'skip', rest: false } })
    expect(more).toEqual([true, false])
  })

  it('two files of one batch landing on the same name count as a conflict too', async () => {
    const ask = vi.fn(async (_q: ConflictQuestion<string>) => ({ choice: 'keep-both' as const, rest: false }))
    const out = await resolveConflicts([f('icon.png', 'ui'), f('icon.png', 'ui')], taken([]), ask)
    expect(ask.mock.calls[0]![0].existing.kind).toBe('batch')
    expect(out!.map(x => x.name)).toEqual(['icon.png', 'icon_1.png'])
  })

  it('cancelling the question cancels the upload', async () => {
    expect(await resolveConflicts([f('a.png')], taken(['props/chest/a.png']), async () => null)).toBeNull()
  })

  it('copy names: name_1, name_2…', () => {
    expect(nextName('chest.png', n => n === 'chest_1.png')).toBe('chest_2.png')
    expect(nextName('README', () => false)).toBe('README_1')
  })
})

describe('root address', () => {
  const res = (ids: string[], defaultId: string | null = null) => ({ libraries: ids.map(id => ({ id, name: id, root: '/' + id, state: 'ready' as const })), defaultId })
  it('opens this browser\'s last library, else the only one, else none', () => {
    expect(pickLibrary(res(['a', 'b']), 'b')).toBe('b')
    expect(pickLibrary(res(['a']), 'gone')).toBe('a')
    expect(pickLibrary(res(['a', 'b'], 'b'), null)).toBe('b')
    expect(pickLibrary(res([]), 'a')).toBeNull()
  })
})

describe('upload queue', () => {
  it('a big batch is queued in one go (not one rebuild of the list per file)', async () => {
    const { enqueueAll, uploadsRunning, cancelAllUploads, clearFinishedUploads } = await import('./upload')
    const planned = Array.from({ length: 5000 }, (_, i) => ({ file: new File(['x'], `f${i}.png`), name: `f${i}.png`, dest: 'props' }))
    const t0 = performance.now()
    enqueueAll('L', planned, {})
    expect(performance.now() - t0).toBeLessThan(300)
    expect(uploadsRunning()).toBe(true)
    cancelAllUploads()
    clearFinishedUploads()
    expect(uploadsRunning()).toBe(false)
  })
})

describe('summary cache lookups', () => {
  it('finds selected assets in grid pages, then details, then other searches; stays fast for big pages', async () => {
    const { QueryClient } = await import('@tanstack/react-query')
    const { findSummaries, findSummary } = await import('./cache')
    const qc = new QueryClient()
    const mk = (id: string, name = id) => ({ id, name }) as never
    const items = Array.from({ length: 20000 }, (_, i) => mk(`a${i}`))
    qc.setQueryData(['lib', 'L', 'browse', {}], { pages: [{ items, total: items.length, cursor: null }], pageParams: [null] })
    qc.setQueryData(['lib', 'L', 'asset', 'd1'], mk('d1', 'from-detail'))
    qc.setQueryData(['lib', 'L', 'search', {}], { items: [mk('s1', 'from-search')], total: 1 })
    const ids = Array.from({ length: 5000 }, (_, i) => `a${i * 4}`)
    const t0 = performance.now()
    expect(findSummaries(qc, 'L', ids)).toHaveLength(5000)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(findSummary(qc, 'L', 'd1')!.name).toBe('from-detail')
    expect(findSummary(qc, 'L', 's1')!.name).toBe('from-search')
    expect(findSummary(qc, 'L', 'nope')).toBeNull()
  })
})

describe('parameter forms (creators and plugin actions)', () => {
  it('only text boxes and selects sit inside a <label>; toggle groups and switches name themselves', async () => {
    const { isTextual } = await import('./creators')
    expect(isTextual({ type: 'string' })).toBe(true)
    expect(isTextual({ type: 'integer' })).toBe(true)
    expect(isTextual({ type: 'string', 'x-widget': 'textarea' })).toBe(true)
    expect(isTextual({ type: 'integer', enum: [90, 180, 270], 'x-widget': 'segmented' })).toBe(false)
    expect(isTextual({ type: 'integer', enum: [1, 2, 4] })).toBe(false)
    expect(isTextual({ type: 'string', enum: ['a', 'b', 'c', 'd', 'e'] })).toBe(true)
    expect(isTextual({ type: 'boolean' })).toBe(false)
  })
})
