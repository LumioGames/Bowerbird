/**
 * 从别的电脑打开（ADR-023, copy.md 操作名称表）: the right-click menu offers「下载源文件」instead of「用默认程序打开源文件」
 * and「在文件夹中显示源文件」, the library menu has no「在文件夹中显示」, and ⌘O / ⌥⌘R do nothing.
 * Adding a library from there: the folder chooser cannot look at the server's disk (`not_local`), only the typed path
 * field is left. The page is opened through this machine's own LAN address, so the server sees a non-loopback client.
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startBowerbird, type Bowerbird } from '../helpers/a-server'
import { cell, contextMenu, menuItem, MOD, sidebar, toast, waitScanned } from '../helpers/a-app'

function lanAddress(): string | null {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list ?? []).map(a => ({ name, ...a })))
  const v4 = all.filter(a => a.family === 'IPv4' && !a.internal)
  const pick = v4.find(a => /^(en|eth|wl)/.test(a.name) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) ?? v4.find(a => /^(en|eth|wl)/.test(a.name)) ?? v4[0]
  return pick?.address ?? null
}

const LAN = lanAddress()
let bb: Bowerbird

test.describe('远程访问', () => {
  test.skip(!LAN, '这台机器没有非回环的 IPv4 网卡，无法从「别的电脑」的地址打开页面')
  test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo', host: '0.0.0.0' }) })
  test.afterEach(async () => { await bb?.stop() })

  test('右键菜单只有「下载源文件」，资产库菜单没有「在文件夹中显示」，⌘O 不起作用', async ({ page }) => {
    await waitScanned(bb)
    const port = new URL(bb.url).port
    const remote = `http://${LAN}:${port}`
    await page.goto(`${remote}/libraries/${bb.lib}?folder=props%2Fchest`)
    expect((await (await page.request.get(`${remote}/api/v1/libraries/${bb.lib}`)).json()).isLocal).toBe(false)

    const c = cell(page, 'chest_basecolor.png')
    await expect(c).toBeVisible()
    const m = await contextMenu(page, c)
    await expect(menuItem(page, '下载源文件')).toBeVisible()
    await expect(m.getByRole('menuitem', { name: /用默认程序打开源文件/ })).toHaveCount(0)
    await expect(m.getByRole('menuitem', { name: /在文件夹中显示源文件/ })).toHaveCount(0)

    const download = page.waitForEvent('download')
    await menuItem(page, '下载源文件').click()
    const dl = await download
    expect(dl.suggestedFilename()).toBe('chest_basecolor.png')
    await expect(toast(page, '开始下载 chest_basecolor.png')).toBeVisible()

    await sidebar(page).getByRole('button', { name: '星落镇' }).click()
    const libMenu = page.getByRole('menu')
    await expect(libMenu.getByRole('menuitem', { name: '资产库设置…' })).toBeVisible()
    await expect(libMenu.getByRole('menuitem', { name: '切换资产库…' })).toBeVisible()
    await expect(libMenu.getByRole('menuitem', { name: '在文件夹中显示' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await c.click()
    await page.keyboard.press(`${MOD}+o`)
    await page.keyboard.press(`Alt+${MOD}+r`)
    await page.waitForTimeout(800)
    await expect(toast(page, /已用默认程序打开|已在文件夹中显示|只在装 Bowerbird 的那台电脑上能用/)).toHaveCount(0)
  })

  test('添加资产库：看不到那台电脑的文件夹，只能输入路径', async ({ page }) => {
    await waitScanned(bb)
    const remote = `http://${LAN}:${new URL(bb.url).port}`
    await page.goto(`${remote}/libraries/${bb.lib}`)
    const listed = await page.request.get(`${remote}/api/v1/fs/folders`)
    expect(listed.status()).toBe(403)
    expect((await listed.json()).error.code).toBe('not_local')

    await sidebar(page).getByRole('button', { name: '星落镇' }).click()
    await page.getByRole('menuitem', { name: '切换资产库…' }).click()
    await page.getByRole('dialog', { name: '切换资产库' }).getByRole('button', { name: '添加资产库…' }).click()
    await page.getByRole('dialog', { name: '添加资产库' }).getByRole('button', { name: '打开文件夹' }).click()
    const d = page.getByRole('dialog', { name: '打开文件夹' })
    await expect(d.getByText('只在装 Bowerbird 的那台电脑上能浏览文件夹；请输入那台电脑上的完整路径。')).toBeVisible()
    await expect(d.getByRole('listbox')).toHaveCount(0)
    await expect(d.getByRole('button', { name: '上一级' })).toHaveCount(0)
    const field = d.getByRole('textbox', { name: '文件夹' })
    await expect(field).toHaveValue('')
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-a-remote-'))
    try {
      await field.fill(empty)
      await d.getByRole('button', { name: '打开', exact: true }).click()
      await expect(toast(page, `已切换到 ${path.basename(empty)}`)).toBeVisible()
      await expect(page.getByText('把文件拖进来')).toBeVisible()
      expect(fs.existsSync(path.join(empty, '.bowerbird', 'library.json'))).toBe(true)
    } finally { fs.rmSync(empty, { recursive: true, force: true }) }
  })

  test('对照：本机打开时右键菜单有两项本机操作，没有「下载源文件」', async ({ page }) => {
    await waitScanned(bb)
    await page.goto(`${bb.url}/libraries/${bb.lib}?folder=props%2Fchest`)
    const m = await contextMenu(page, cell(page, 'chest_basecolor.png'))
    await expect(m.getByRole('menuitem', { name: /^用默认程序打开源文件/ })).toBeVisible()
    await expect(m.getByRole('menuitem', { name: /^在文件夹中显示源文件/ })).toBeVisible()
    await expect(m.getByRole('menuitem', { name: /^下载源文件/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await sidebar(page).getByRole('button', { name: '星落镇' }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: '在文件夹中显示' })).toBeVisible()
  })
})
