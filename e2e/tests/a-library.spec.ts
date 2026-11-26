/**
 * pages.md「资产库」(ADR-026, ADR-033, F-11, copy.md 资产库): 第一次打开（还没有资产库：欢迎页的两个选择、选文件夹对话框）、
 * 切换资产库（登记过的库、当前、只切换这个浏览器、切回）与添加资产库（同样的两个选择；空文件夹直接成为空资产库；有文件的走首次打开）.
 */
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO, startBowerbird, type Bowerbird } from '../helpers/a-server'
import { dialog, libUrl, openBrowse, sidebar, toast } from '../helpers/a-app'

let bb: Bowerbird
const temps: string[] = []
test.afterEach(async () => { await bb?.stop(); for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true }) })

function tempDir(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-a-lib-')); temps.push(d); return d }
const subfolders = (page: Page) => page.getByRole('listbox', { name: '子文件夹' })
const folderOption = (page: Page, name: string) => subfolders(page).getByRole('option', { name: new RegExp(`^${name}`) })

test.describe('第一次打开：还没有资产库', () => {
  /** The home folder the server sees: projects/ (empty), loose/ (three files), starfall/ (already a library), notes.txt. */
  let home: string
  test.beforeEach(async () => {
    home = tempDir()
    fs.mkdirSync(path.join(home, 'projects'))
    fs.mkdirSync(path.join(home, 'loose'))
    for (const f of ['lantern_concept.png', 'lantern.glb', 'lantern.md']) fs.copyFileSync(path.join(REPO, 'fixtures/upload-batch', f), path.join(home, 'loose', f))
    fs.mkdirSync(path.join(home, 'starfall', '.bowerbird'), { recursive: true })
    fs.writeFileSync(path.join(home, 'starfall', '.bowerbird', 'library.json'), '{}')
    fs.mkdirSync(path.join(home, '.cache'))
    fs.writeFileSync(path.join(home, 'notes.txt'), 'x')
    bb = await startBowerbird({ library: 'none', fsHome: home })
  })

  test('欢迎页：产品名、一句话说明、两个一样大的选择', async ({ page }) => {
    await page.goto(bb.url)
    await expect(page.getByRole('heading', { level: 1, name: 'Bowerbird' })).toBeVisible()
    await expect(page.getByText('把游戏资产放在一个文件夹里管理：浏览、预览、校验、追溯，人和 Agent 都能用。')).toBeVisible()
    const open = page.getByRole('button', { name: '打开文件夹' })
    const create = page.getByRole('button', { name: '新建资产库' })
    await expect(open).toHaveAccessibleDescription('把一个已有的文件夹作为资产库。里面的文件会被登记：每个文件旁边写一个 .bmeta，原文件不改动。')
    await expect(create).toHaveAccessibleDescription('新建一个空文件夹作为资产库。')
    const [a, b] = [await open.boundingBox(), await create.boundingBox()]
    expect(Math.round(a!.width)).toBe(Math.round(b!.width))
    expect(Math.round(a!.height)).toBe(Math.round(b!.height))
    expect(Math.round(a!.y)).toBe(Math.round(b!.y))
    expect((await bb.api.libraries.list()).libraries).toEqual([])
  })

  test('新建资产库：从主文件夹开始选位置（双击进入、上一级），已有内容的名字被拒绝，新建后打开空资产库', async ({ page }) => {
    await page.goto(bb.url)
    await page.getByRole('button', { name: '新建资产库' }).click()
    const d = dialog(page, '新建资产库')
    await expect(d).toBeVisible()
    await expect(d.getByRole('textbox', { name: '名称' })).toHaveValue('我的资产库')
    await expect(d.getByRole('textbox', { name: '名称' })).toBeFocused()
    await expect(d.getByRole('textbox', { name: '位置' })).toHaveValue(home)
    // only folders, hidden ones left out, a library marked
    await expect(subfolders(page).getByRole('option')).toHaveText(['loose', 'projects', 'starfall资产库'])
    await expect(d.getByText(path.join(home, '我的资产库'))).toBeVisible()

    // a name that exists and holds things is refused, nothing registered
    await d.getByRole('textbox', { name: '名称' }).fill('loose')
    await d.getByRole('button', { name: '新建', exact: true }).click()
    await expect(d.getByRole('alert')).toHaveText('「loose」已经存在，里面有内容；换一个名称')
    expect((await bb.api.libraries.list()).libraries).toEqual([])

    await folderOption(page, 'projects').dblclick()
    await expect(d.getByRole('textbox', { name: '位置' })).toHaveValue(path.join(home, 'projects'))
    await expect(d.getByRole('navigation', { name: '所在位置' }).getByRole('button')).toHaveText([path.basename(home), 'projects'])
    await expect(page.getByText('这里没有文件夹')).toBeVisible()
    await d.getByRole('button', { name: '上一级' }).click()
    await expect(d.getByRole('textbox', { name: '位置' })).toHaveValue(home)
    await folderOption(page, 'projects').dblclick()
    await expect(d.getByRole('textbox', { name: '位置' })).toHaveValue(path.join(home, 'projects'))
    await d.getByRole('textbox', { name: '名称' }).fill('星落镇')
    await expect(d.getByText(path.join(home, 'projects', '星落镇'))).toBeVisible()
    await d.getByRole('button', { name: '新建', exact: true }).click()

    await expect(d).toBeHidden()
    await expect(page).toHaveURL(/\/libraries\/[^/]+$/)
    await expect(page.getByText('把文件拖进来')).toBeVisible()
    await expect(sidebar(page).getByRole('button', { name: '星落镇' })).toBeVisible()
    expect(fs.existsSync(path.join(home, 'projects', '星落镇', '.bowerbird', 'library.json'))).toBe(true)
    const libs = (await bb.api.libraries.list()).libraries
    expect(libs.map(l => [l.name, l.root, l.state])).toEqual([['星落镇', path.join(home, 'projects', '星落镇'), 'ready']])
  })

  test('打开文件夹：选一个有文件的文件夹走首次打开的说明；已经添加过的会标出来', async ({ page }) => {
    await page.goto(bb.url)
    await page.getByRole('button', { name: '打开文件夹' }).click()
    const d = dialog(page, '打开文件夹')
    await expect(d).toBeVisible()
    await expect(d.getByRole('textbox', { name: '文件夹' })).toHaveValue(home)
    await folderOption(page, 'starfall').click()
    await expect(d.getByText('已经是资产库，直接打开')).toBeVisible()
    await folderOption(page, 'loose').click()
    await expect(d.getByRole('textbox', { name: '文件夹' })).toHaveValue(path.join(home, 'loose'))
    await d.getByRole('button', { name: '打开', exact: true }).click()

    const loose = path.join(home, 'loose')
    const first = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `打开 ${loose}` }) })
    await expect(first).toBeVisible()
    await expect(first).toContainText('3')
    await expect(first).toContainText('个文件 · 0 个文件夹')
    await expect(first.getByRole('button', { name: '开始' })).toBeVisible()
    // nothing written before 开始
    expect(fs.readdirSync(loose).filter(n => n.endsWith('.bmeta'))).toEqual([])
    await first.getByRole('button', { name: '开始' }).click()
    await expect(toast(page, '已登记 3 个文件')).toBeVisible({ timeout: 30_000 })
    expect(fs.readdirSync(loose).filter(n => n.endsWith('.bmeta')).sort()).toEqual(['lantern.glb.bmeta', 'lantern.md.bmeta', 'lantern_concept.png.bmeta'])

    // back to the chooser from the library menu: the folder is marked as added
    await sidebar(page).getByRole('button', { name: 'loose' }).click()
    await page.getByRole('menuitem', { name: '切换资产库…' }).click()
    await dialog(page, '切换资产库').getByRole('button', { name: '添加资产库…' }).click()
    await dialog(page, '添加资产库').getByRole('button', { name: '打开文件夹' }).click()
    await expect(folderOption(page, 'loose')).toHaveText('loose已添加')
    await expect(folderOption(page, 'starfall')).toHaveText('starfall资产库')
  })

  test('打开文件夹：粘贴路径（路径框可编辑），列表跟过去；空文件夹直接成为空资产库', async ({ page }) => {
    const elsewhere = path.join(tempDir(), 'empty_lib')
    fs.mkdirSync(elsewhere)
    await page.goto(bb.url)
    await page.getByRole('button', { name: '打开文件夹' }).click()
    const d = dialog(page, '打开文件夹')
    const field = d.getByRole('textbox', { name: '文件夹' })
    await expect(field).toHaveValue(home)
    await field.fill(path.join(home, 'nowhere'))
    await d.getByRole('button', { name: '打开', exact: true }).click()
    await expect(d.getByRole('alert')).toHaveText('找不到这个文件夹')
    await field.fill(path.dirname(elsewhere))
    await expect(folderOption(page, 'empty_lib')).toBeVisible()
    await field.fill(elsewhere)
    await field.press('Enter')
    await expect(d).toBeHidden()
    await expect(toast(page, '已切换到 empty_lib')).toBeVisible()
    await expect(page.getByText('把文件拖进来')).toBeVisible()
    expect(fs.existsSync(path.join(elsewhere, '.bowerbird', 'library.json'))).toBe(true)
  })
})

test.describe('登记过资产库', () => {
  // the folder chooser starts at the home folder the server sees: a temp one, not this computer's
  test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo', fsHome: tempDir() }) })

  async function openSwitch(page: Page) {
    await sidebar(page).getByRole('button', { name: /星落镇|第二个库|空库/ }).first().click()
    await page.getByRole('menuitem', { name: '切换资产库…' }).click()
    const d = dialog(page, '切换资产库')
    await expect(d).toBeVisible()
    return d
  }
  /** 添加资产库… → the same two choices as the first-run page → 打开文件夹. */
  async function openFolderFromMenu(page: Page) {
    const d = await openSwitch(page)
    await d.getByRole('button', { name: '添加资产库…' }).click()
    const add = dialog(page, '添加资产库')
    await expect(add).toBeVisible()
    await expect(add.getByRole('button', { name: '新建资产库' })).toBeVisible()
    await add.getByRole('button', { name: '打开文件夹' }).click()
    const open = dialog(page, '打开文件夹')
    await expect(open).toBeVisible()
    return open
  }

  test('切换资产库：列出登记过的库（名称、根文件夹、当前）；只切换这个浏览器；切换后可切回', async ({ page }) => {
    const second = path.join(tempDir(), 'second')
    fs.mkdirSync(second)
    const added = await bb.api.libraries.add({ root: second, name: '第二个库' })
    if (added.state === 'uninitialized') await bb.api.libraries.init(added.id)

    await openBrowse(page, bb)
    const d = await openSwitch(page)
    await expect(d.getByText('只切换这个浏览器')).toBeVisible()
    const list = d.getByRole('radiogroup', { name: '资产库' })
    const cur = list.getByRole('radio', { name: /星落镇/ })
    await expect(cur).toContainText(bb.root)
    await expect(cur).toContainText('当前')
    await expect(cur).toHaveAttribute('aria-checked', 'true')
    const other = list.getByRole('radio', { name: /第二个库/ })
    await expect(other).toContainText(second)
    await expect(other).not.toContainText('当前')
    await expect(d.getByRole('button', { name: '添加资产库…' })).toBeVisible()
    await expect(d.getByRole('button', { name: '取消' })).toBeVisible()

    await other.click()
    await d.getByRole('button', { name: '打开' }).click()
    await expect(page).toHaveURL(new RegExp(`/libraries/${added.id}`))
    const t = toast(page, '已切换到 第二个库')
    await expect(t).toBeVisible()
    await expect(page.getByText('把文件拖进来')).toBeVisible()
    // only this browser: the server's default library did not change
    expect((await bb.api.libraries.list()).defaultId).toBe(bb.lib)

    await t.getByRole('button', { name: '切回' }).click()
    await expect(page).toHaveURL(new RegExp(`/libraries/${bb.lib}`))
    await expect(sidebar(page).getByRole('button', { name: '星落镇' })).toBeVisible()
  })

  test('添加资产库：空文件夹直接成为空资产库', async ({ page }) => {
    const empty = path.join(tempDir(), '空库')
    fs.mkdirSync(empty)
    await openBrowse(page, bb)
    const add = await openFolderFromMenu(page)
    await add.getByRole('textbox', { name: '文件夹' }).fill(empty)
    await add.getByRole('button', { name: '打开', exact: true }).click()
    await expect(toast(page, '已切换到 空库')).toBeVisible()
    await expect(page.getByText('把文件拖进来')).toBeVisible()
    await expect(sidebar(page).getByRole('button', { name: '空库' })).toBeVisible()
    expect(fs.existsSync(path.join(empty, '.bowerbird'))).toBe(true)
  })

  test('添加资产库：有文件的文件夹走首次打开的说明', async ({ page }) => {
    const withFiles = path.join(tempDir(), 'loose')
    fs.mkdirSync(withFiles)
    for (const f of ['lantern_concept.png', 'lantern.glb', 'lantern.md']) fs.copyFileSync(path.join(REPO, 'fixtures/upload-batch', f), path.join(withFiles, f))
    await openBrowse(page, bb)
    const add = await openFolderFromMenu(page)
    await add.getByRole('textbox', { name: '文件夹' }).fill(withFiles)
    await add.getByRole('button', { name: '打开', exact: true }).click()
    const first = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `打开 ${withFiles}` }) })
    await expect(first).toBeVisible()
    await expect(first).toContainText('3')
    await expect(first).toContainText('个文件 · 0 个文件夹')
    await expect(first.getByRole('button', { name: '开始' })).toBeVisible()
    void libUrl
  })

  test('添加资产库：新建资产库，在另一个库里也一样', async ({ page }) => {
    const where = tempDir()
    await openBrowse(page, bb)
    const d = await openSwitch(page)
    await d.getByRole('button', { name: '添加资产库…' }).click()
    await dialog(page, '添加资产库').getByRole('button', { name: '新建资产库' }).click()
    const create = dialog(page, '新建资产库')
    await create.getByRole('textbox', { name: '位置' }).fill(where)
    await expect(create.getByRole('listbox', { name: '子文件夹' })).toBeVisible()
    await create.getByRole('textbox', { name: '名称' }).fill('第三个库')
    await create.getByRole('button', { name: '新建', exact: true }).click()
    await expect(toast(page, '已切换到 第三个库')).toBeVisible()
    await expect(page.getByText('把文件拖进来')).toBeVisible()
    await toast(page, '已切换到 第三个库').getByRole('button', { name: '切回' }).click()
    await expect(sidebar(page).getByRole('button', { name: '星落镇' })).toBeVisible()
    expect(fs.existsSync(path.join(where, '第三个库', '.bowerbird', 'library.json'))).toBe(true)
  })
})
