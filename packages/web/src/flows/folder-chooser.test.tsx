import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setApiFetch } from '../lib/api'
import { DialogHost } from '../overlays/dialogs'
import { RootRedirect, Welcome } from '../shell/RootRedirect'
import { addLibraryDialog } from './library'
import { checkFolderName, crumbsOf, freeName, joinPath, NewLibraryDialog, OpenFolderDialog, sameFolder } from './folder-chooser'

/**
 * First run and 添加资产库 (welcome page, 打开文件夹, 新建资产库): the folder chooser lists the server computer's folders
 * (GET /fs/folders) from the home folder, the path field stays editable, a browser on another computer types the path.
 */
beforeAll(() => {
  // each step waits for a (stubbed) request and a render: give it room when the whole suite runs side by side
  configure({ asyncUtilTimeout: 4000 })
  ;(globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  // the first-run page mounts the toaster, which follows the system theme
  window.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})
afterEach(() => { cleanup(); setApiFetch(null) })

const HOME = '/home/lin'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const err = (status: number, code: string, details?: Record<string, unknown>) => json(status, { error: { code, message: '服务端的话', ...(details ? { details } : {}) } })
const folder = (dir: string, name: string, library = false) => ({ name, path: `${dir === '/' ? '' : dir}/${name}`, library })
const listing = (path: string, folders: ReturnType<typeof folder>[], over: Record<string, unknown> = {}) => ({
  path, parent: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/', home: HOME, library: false, folders, truncated: false, ...over
})
const DISK: Record<string, ReturnType<typeof listing>> = {
  [HOME]: listing(HOME, [folder(HOME, 'art'), folder(HOME, 'starfall', true), folder(HOME, 'xingluo', true), folder(HOME, '我的资产库')]),
  [`${HOME}/art`]: listing(`${HOME}/art`, [folder(`${HOME}/art`, 'concepts')]),
  [`${HOME}/art/concepts`]: listing(`${HOME}/art/concepts`, []),
  '/home': listing('/home', [folder('/home', 'lin')]),
  '/srv/assets': listing('/srv/assets', [folder('/srv/assets', 'ui')], { library: true })
}
const INFO = (root: string, over: Record<string, unknown> = {}) => ({ id: 'L2', name: root.split('/').pop(), root, state: 'ready', firstOpen: null, ...over })

interface Call { method: string; url: URL; body: unknown }
function serve(opts: { remote?: boolean; add?: (body: { root: string; name?: string; create?: boolean }) => Response; slow?: { path: string; until: Promise<void> } } = {}) {
  const calls: Call[] = []
  setApiFetch(async (input, init) => {
    const url = new URL(String(input), 'http://bb.test')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (url.pathname === '/api/v1/fs/folders') {
      if (opts.remote) return err(403, 'not_local')
      const p = url.searchParams.get('path')
      const key = p == null ? HOME : p.replace(/^~/, HOME)
      if (opts.slow && key === opts.slow.path) await opts.slow.until
      if (DISK[key]) return json(200, DISK[key])
      return err(400, 'validation_failed', { reason: key.startsWith('/') ? 'not_found' : 'not_absolute', path: key })
    }
    if (url.pathname === '/api/v1/libraries' && method === 'GET') return json(200, { libraries: [{ id: 'L1', name: '星落镇', root: `${HOME}/xingluo/`, state: 'ready' }], defaultId: 'L1' })
    if (url.pathname === '/api/v1/libraries' && method === 'POST') return opts.add ? opts.add(body) : json(201, INFO(body.root))
    return json(404, { error: { code: 'not_found', message: '?' } })
  })
  return { calls, folderCalls: () => calls.filter(c => c.url.pathname === '/api/v1/fs/folders').map(c => c.url.searchParams.get('path')), posts: () => calls.filter(c => c.method === 'POST').map(c => c.body) }
}
function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>)
}
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const rows = () => within(screen.getByRole('listbox', { name: '子文件夹' })).queryAllByRole('option')
const row = (name: string) => rows().find(r => r.textContent?.startsWith(name))!

describe('paths', () => {
  it('breadcrumbs start at the home folder inside it, else at the top of the disk', () => {
    expect(crumbsOf('/home/lin/art/concepts', HOME)).toEqual([
      { label: 'lin', path: HOME, home: true }, { label: 'art', path: `${HOME}/art` }, { label: 'concepts', path: `${HOME}/art/concepts` }
    ])
    expect(crumbsOf(HOME, HOME)).toEqual([{ label: 'lin', path: HOME, home: true }])
    expect(crumbsOf('/home/linda', HOME).map(c => c.path)).toEqual(['/', '/home', '/home/linda'])
    expect(crumbsOf('/', HOME)).toEqual([{ label: '/', path: '/' }])
    expect(crumbsOf('D:\\Art\\Lib', 'C:\\Users\\lin').map(c => [c.label, c.path])).toEqual([['D:', 'D:\\'], ['Art', 'D:\\Art'], ['Lib', 'D:\\Art\\Lib']])
  })
  it('joins and compares like the server (trailing separators, the top of a disk)', () => {
    expect(joinPath('/home/lin', '我的资产库')).toBe('/home/lin/我的资产库')
    expect(joinPath('/', 'x')).toBe('/x')
    expect(joinPath('C:\\Users\\lin', 'x')).toBe('C:\\Users\\lin\\x')
    expect(sameFolder('/home/lin/xingluo/', '/home/lin/xingluo')).toBe(true)
    expect(sameFolder('/', '/')).toBe(true)
    expect(sameFolder('/home/lin/x', '/home/lin/xy')).toBe(false)
  })
  it('a new library name: no separators or reserved characters, no leading dot; the default is one not taken', () => {
    expect(checkFolderName('我的资产库')).toBeNull()
    expect(checkFolderName('')).toBe('要填名称')
    for (const bad of ['a/b', 'a\\b', 'x:y', '.hidden', 'tail.', 'tail ', 'a?']) expect(checkFolderName(bad), bad).toMatch(/不能/)
    expect(freeName('我的资产库', ['art'])).toBe('我的资产库')
    expect(freeName('我的资产库', ['我的资产库', '我的资产库 2'])).toBe('我的资产库 3')
  })
})

describe('first-run page', () => {
  it('the product name, one sentence, two equal choices', () => {
    const pick = vi.fn()
    mount(<Welcome onPick={pick} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bowerbird')
    expect(screen.getByText('把游戏资产放在一个文件夹里管理：浏览、预览、校验、追溯，人和 Agent 都能用。')).toBeTruthy()
    const open = screen.getByRole('button', { name: '打开文件夹' })
    const create = screen.getByRole('button', { name: '新建资产库' })
    expect(open.getAttribute('aria-describedby') && document.getElementById(open.getAttribute('aria-describedby')!)!.textContent)
      .toBe('把一个已有的文件夹作为资产库。里面的文件会被登记：每个文件旁边写一个 .bmeta，原文件不改动。')
    expect(document.getElementById(create.getAttribute('aria-describedby')!)!.textContent).toBe('新建一个空文件夹作为资产库。')
    expect(open.className).toBe(create.className)
    fireEvent.click(create)
    fireEvent.click(open)
    expect(pick.mock.calls).toEqual([['new'], ['open']])
  })
  it('the root address shows it when no library is registered', async () => {
    setApiFetch(async () => json(200, { libraries: [], defaultId: null }))
    mount(<RootRedirect />)
    expect(await screen.findByRole('button', { name: '打开文件夹' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建资产库' })).toBeTruthy()
  })
  it('添加资产库 (library menu) offers the same two choices, then that dialog', async () => {
    serve()
    mount(<DialogHost />)
    let done: Promise<void>
    await act(async () => { done = addLibraryDialog(() => {}, 'L1') })
    const choice = await screen.findByRole('dialog', { name: '添加资产库' })
    expect(within(choice).getByRole('button', { name: '新建资产库' })).toBeTruthy()
    fireEvent.click(within(choice).getByRole('button', { name: '打开文件夹' }))
    expect(await screen.findByRole('dialog', { name: '打开文件夹' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await act(async () => { await done })
  })
})

describe('打开文件夹', () => {
  it('starts at the home folder; marks libraries and added ones; double-click enters, 上一级 and the breadcrumbs go back', async () => {
    const s = serve()
    mount(<OpenFolderDialog onDone={() => {}} />)
    await waitFor(() => expect(field('文件夹').value).toBe(HOME))
    expect(s.folderCalls()[0]).toBeNull()
    expect(rows().map(r => r.textContent)).toEqual(['art', 'starfall资产库', 'xingluo已添加', '我的资产库'])
    fireEvent.doubleClick(row('art'))
    // the field names the folder at once; its folders follow when listed
    expect(field('文件夹').value).toBe(`${HOME}/art`)
    await waitFor(() => expect(rows().map(r => r.textContent)).toEqual(['concepts']))
    const crumbs = screen.getByRole('navigation', { name: '所在位置' })
    expect(within(crumbs).getAllByRole('button').map(b => b.textContent)).toEqual(['lin', 'art'])
    fireEvent.click(screen.getByRole('button', { name: '上一级' }))
    await waitFor(() => expect(rows()).toHaveLength(4))
    expect(field('文件夹').value).toBe(HOME)
    fireEvent.click(screen.getByRole('button', { name: '上一级' }))
    await waitFor(() => expect(rows().map(r => r.textContent)).toEqual(['lin']))
    expect(field('文件夹').value).toBe('/home')
    fireEvent.click(screen.getByRole('button', { name: '主文件夹' }))
    await waitFor(() => expect(rows()).toHaveLength(4))
    expect(field('文件夹').value).toBe(HOME)
  })

  it('the keyboard: ↓ selects, ↵ enters, ← goes up', async () => {
    serve()
    mount(<OpenFolderDialog onDone={() => {}} />)
    await waitFor(() => expect(rows()).toHaveLength(4))
    const first = row('art')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(row('starfall').getAttribute('aria-selected')).toBe('true')
    expect(field('文件夹').value).toBe(`${HOME}/starfall`)
    fireEvent.keyDown(row('starfall'), { key: 'ArrowUp' })
    fireEvent.keyDown(row('art'), { key: 'Enter' })
    await waitFor(() => expect(rows().map(r => r.textContent)).toEqual(['concepts']))
    await waitFor(() => expect(document.activeElement).toBe(row('concepts')))
    // into an empty folder: the list itself has focus, ← still goes up
    fireEvent.keyDown(row('concepts'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('这里没有文件夹')).toBeTruthy())
    const list = screen.getByRole('listbox', { name: '子文件夹' })
    await waitFor(() => expect(document.activeElement).toBe(list))
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    await waitFor(() => expect(rows().map(r => r.textContent)).toEqual(['concepts']))
    fireEvent.keyDown(row('concepts'), { key: 'ArrowLeft' })
    await waitFor(() => expect(rows()).toHaveLength(4))
  })

  it('a selected folder is what opens: a library says so; 打开 adds it by its full path', async () => {
    const s = serve()
    const done = vi.fn()
    mount(<OpenFolderDialog onDone={done} />)
    await waitFor(() => expect(rows()).toHaveLength(4))
    fireEvent.click(row('starfall'))
    expect(field('文件夹').value).toBe(`${HOME}/starfall`)
    expect(screen.getByText('已经是资产库，直接打开')).toBeTruthy()
    fireEvent.click(row('xingluo'))
    expect(screen.getByText('已添加为「星落镇」，打开就是切换过去')).toBeTruthy()
    fireEvent.click(row('starfall'))
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    await waitFor(() => expect(done).toHaveBeenCalledWith(expect.objectContaining({ root: `${HOME}/starfall` })))
    expect(s.posts()).toEqual([{ root: `${HOME}/starfall` }])
  })

  it('a pasted path is followed and opened as the server spells it (~ expanded); a wrong one is said and not added', async () => {
    const s = serve()
    const done = vi.fn()
    mount(<OpenFolderDialog onDone={done} />)
    await waitFor(() => expect(field('文件夹').value).toBe(HOME))
    fireEvent.change(field('文件夹'), { target: { value: '/srv/nowhere' } })
    expect(await screen.findByText('找不到这个文件夹')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect((await screen.findByRole('alert')).textContent).toBe('找不到这个文件夹')
    expect(s.posts()).toEqual([])
    fireEvent.change(field('文件夹'), { target: { value: 'assets' } })
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect((await screen.findByRole('alert')).textContent).toBe('要填完整的路径（从磁盘的最上层开始）')
    // typing follows the path once it pauses; the listing shows that folder
    fireEvent.change(field('文件夹'), { target: { value: '/srv/assets' } })
    await waitFor(() => expect(rows().map(r => r.textContent)).toEqual(['ui']))
    expect(field('文件夹').value).toBe('/srv/assets')
    expect(screen.getByText('已经是资产库，直接打开')).toBeTruthy()
    // Enter in the field opens what it names
    fireEvent.keyDown(field('文件夹'), { key: 'Enter' })
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(s.posts()).toEqual([{ root: '/srv/assets' }])
  })

  it('typed then opened at once: the server resolves it first (~ is the home folder)', async () => {
    const s = serve()
    const done = vi.fn()
    mount(<OpenFolderDialog onDone={done} />)
    await waitFor(() => expect(field('文件夹').value).toBe(HOME))
    fireEvent.change(field('文件夹'), { target: { value: '~/art' } })
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(s.posts()).toEqual([{ root: `${HOME}/art` }])
  })

  it('while a folder is still being listed, what opens is that folder, not the one listed before', async () => {
    let release!: () => void
    const s = serve({ slow: { path: `${HOME}/art`, until: new Promise<void>(r => { release = r }) } })
    const done = vi.fn()
    mount(<OpenFolderDialog onDone={done} />)
    await waitFor(() => expect(rows()).toHaveLength(4))
    fireEvent.doubleClick(row('art'))
    expect(screen.queryByText('已经是资产库，直接打开')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    release()
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(s.posts()).toEqual([{ root: `${HOME}/art` }])
  })

  it('from another computer (not_local): only the typed field, no folders', async () => {
    const s = serve({ remote: true })
    const done = vi.fn()
    mount(<OpenFolderDialog onDone={done} />)
    expect(await screen.findByText('只在装 Bowerbird 的那台电脑上能浏览文件夹；请输入那台电脑上的完整路径。')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '上一级' })).toBeNull()
    expect(field('文件夹').value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect((await screen.findByRole('alert')).textContent).toBe('要填文件夹的路径')
    fireEvent.change(field('文件夹'), { target: { value: '/srv/projects/星落' } })
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(s.posts()).toEqual([{ root: '/srv/projects/星落' }])
  })

  it('a refusal from the server stays in the dialog', async () => {
    serve({ add: () => err(409, 'conflict') })
    const done = vi.fn()
    mount(<OpenFolderDialog onDone={done} />)
    await waitFor(() => expect(field('文件夹').value).toBe(HOME))
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect((await screen.findByRole('alert')).textContent).toBe('服务端的话')
    expect(done).not.toHaveBeenCalled()
  })
})

describe('新建资产库', () => {
  it('a name (one the home folder does not have) and where; creates <where>/<name>', async () => {
    const s = serve()
    const done = vi.fn()
    mount(<NewLibraryDialog onDone={done} />)
    await waitFor(() => expect(field('名称').value).toBe('我的资产库 2'))
    expect(field('位置').value).toBe(HOME)
    expect(screen.getByText(`${HOME}/我的资产库 2`)).toBeTruthy()
    fireEvent.doubleClick(row('art'))
    await waitFor(() => expect(field('位置').value).toBe(`${HOME}/art`))
    fireEvent.change(field('名称'), { target: { value: '原画库' } })
    expect(await screen.findByText(`${HOME}/art/原画库`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(s.posts()).toEqual([{ root: `${HOME}/art/原画库`, name: '原画库', create: true }])
  })

  it('a bad name is said before anything is sent; a folder that exists and holds things is refused by the server', async () => {
    const s = serve({ add: b => (b.name === '我的资产库' ? err(409, 'conflict', { reason: 'not_empty', path: b.root }) : json(201, INFO(b.root))) })
    const done = vi.fn()
    mount(<NewLibraryDialog onDone={done} />)
    await waitFor(() => expect(rows()).toHaveLength(4))
    fireEvent.change(field('名称'), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    expect((await screen.findByRole('alert')).textContent).toContain('不能有 /')
    fireEvent.change(field('名称'), { target: { value: '  ' } })
    fireEvent.keyDown(field('名称'), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe('要填名称')
    expect(s.posts()).toEqual([])
    fireEvent.change(field('名称'), { target: { value: '我的资产库' } })
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    expect((await screen.findByRole('alert')).textContent).toBe('「我的资产库」已经存在，里面有内容；换一个名称')
    expect(done).not.toHaveBeenCalled()
    expect(s.posts()).toEqual([{ root: `${HOME}/我的资产库`, name: '我的资产库', create: true }])
  })

  it('from another computer: where is typed', async () => {
    const s = serve({ remote: true })
    const done = vi.fn()
    mount(<NewLibraryDialog onDone={done} />)
    expect(await screen.findByText('只在装 Bowerbird 的那台电脑上能浏览文件夹；请输入那台电脑上的完整路径。')).toBeTruthy()
    expect(field('名称').value).toBe('我的资产库')
    fireEvent.change(field('位置'), { target: { value: '/srv/projects' } })
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(s.posts()).toEqual([{ root: '/srv/projects/我的资产库', name: '我的资产库', create: true }])
  })
})
