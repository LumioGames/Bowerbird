/**
 * 只用键盘走完每个对话框（打开、Tab 到各控件、Esc / ↵），并对浏览页、详情页、每个对话框跑 axe（WCAG 2.1 A/AA,
 * serious / critical 为零）. Dialogs are opened from the keyboard: buttons by Tab + Enter, the asset menu with
 * Shift+F10 on the focused cell.
 */
import { expect, test, type Locator, type Page } from '../helpers/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { axeViolations } from '../helpers/axe'
import { REPO, startBowerbird, type Bowerbird } from '../helpers/a-server'
import { assetByPath, cell, folderRow, grid, libUrl, MOD, openBrowse, sidebar, toolbar } from '../helpers/a-app'

let bb: Bowerbird
test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo' }) })
test.afterEach(async () => { await bb?.stop() })

const fmt = (v: Awaited<ReturnType<typeof axeViolations>>) => v.map(x => `${x.id} (${x.impact}): ${x.help}\n  ${x.nodes.slice(0, 4).map(n => n.target.join(' ')).join('\n  ')}`).join('\n')
async function noAxe(page: Page, include?: string) {
  // dialogs and menus fade in: contrast measured mid-animation is not the contrast people see
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(150)
  const v = await axeViolations(page, include)
  expect(v, fmt(v)).toEqual([])
}
const DIALOG = '[role="dialog"], [role="alertdialog"]'

/** Press Tab until `target` has focus (at most `max` times). */
async function tabTo(page: Page, target: Locator, max = 60, key = 'Tab') {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate(el => el === document.activeElement || el.contains(document.activeElement)).catch(() => false)) return
    await page.keyboard.press(key)
  }
  throw new Error(`could not reach ${target} with ${key}`)
}
/** Every focusable control inside the dialog is reached by Tab and focus stays inside. */
async function tabThrough(page: Page, d: Locator) {
  const n = await d.locator('button:not([disabled]), input:not([disabled]), textarea, select, [role="radio"], [role="switch"], [role="checkbox"], [tabindex="0"]').count()
  for (let i = 0; i < n + 2; i++) {
    await page.keyboard.press('Tab')
    expect(await d.evaluate(el => el.contains(document.activeElement))).toBe(true)
  }
}
async function focusCell(page: Page, name: string) {
  await cell(page, name).click()
  await expect(cell(page, name)).toBeFocused().catch(async () => { await cell(page, name).focus() })
}
async function assetMenu(page: Page, name: string) {
  await focusCell(page, name)
  await page.keyboard.press('Shift+F10')
  const m = page.getByRole('menu')
  await expect(m.first()).toBeVisible()
  return m.first()
}
/** Walk the open menu with ↓ until the focused item reads `label`, then ↵. */
async function chooseInMenu(page: Page, label: RegExp) {
  await expect(page.getByRole('menu').last()).toBeVisible()
  for (let i = 0; i < 40; i++) {
    // the item the menu highlights (focus follows it a frame later)
    const text = await page.evaluate(() => {
      const menus = Array.from(document.querySelectorAll('[role="menu"]'))
      const el = menus[menus.length - 1]?.querySelector('[role="menuitem"][data-highlighted]')
      return el && el === document.activeElement ? (el.textContent ?? '') : ''
    })
    if (label.test(text.trim())) { await page.keyboard.press('Enter'); return }
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(50)
  }
  throw new Error(`menu item ${label} not reached with ↓`)
}

test.describe('axe：页面', () => {
  test('浏览页', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await expect(cell(page, 'chest.glb')).toBeVisible()
    await noAxe(page)
  })

  test('浏览页：筛选面板打开、列表布局', async ({ page }) => {
    await openBrowse(page, bb)
    await toolbar(page).getByRole('button', { name: '筛选' }).click()
    await noAxe(page)
    await toolbar(page).getByRole('radio', { name: '列表' }).click()
    await noAxe(page)
  })

  test('详情页（图片：查看、关系、版本、校验）', async ({ page }) => {
    const concept = await assetByPath(bb, 'props/chest/chest_concept.png')
    await page.goto(libUrl(bb, `/asset/${concept.id}`))
    await expect(page.getByRole('tab', { name: /^查看/ })).toBeVisible()
    await page.waitForTimeout(1500)
    await noAxe(page)
    for (const tab of [/^关系/, /^版本/, /^校验/]) {
      await page.getByRole('tab', { name: tab }).click()
      await page.waitForTimeout(800)
      await noAxe(page)
    }
  })

  test('详情页（3D 模型的关系图）', async ({ page }) => {
    const chest = await assetByPath(bb, 'props/chest/chest.glb')
    await page.goto(libUrl(bb, `/asset/${chest.id}?tab=rel`))
    await expect(page.locator('.w2-rg__world [data-asset]').first()).toBeVisible()
    await page.waitForTimeout(800)
    await noAxe(page)
  })

  test('详情页（3D 查看器）', async ({ page }) => {
    const chest = await assetByPath(bb, 'props/chest/chest.glb')
    await page.goto(libUrl(bb, `/asset/${chest.id}`))
    await page.waitForTimeout(2000)
    await noAxe(page)
  })
})

test.describe('只用键盘的对话框（并跑 axe）', () => {
  test('移入回收站（确认类）：Delete 打开，Tab 在按钮间，Esc 取消；↵ 确认', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await focusCell(page, 'chest_open.wav')
    await page.keyboard.press('Delete')
    const d = page.getByRole('alertdialog')
    await expect(d).toBeVisible()
    await expect(d.getByRole('button', { name: '移入回收站' })).toBeFocused()
    await noAxe(page, DIALOG)
    await tabThrough(page, d)
    await page.keyboard.press('Escape')
    await expect(d).toBeHidden()
    expect(fs.existsSync(path.join(bb.root, 'props/chest/chest_open.wav'))).toBe(true)

    await focusCell(page, 'chest_open.wav')
    await page.keyboard.press('Delete')
    await expect(d.getByRole('button', { name: '移入回收站' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(d).toBeHidden()
    await expect.poll(() => fs.existsSync(path.join(bb.root, 'props/chest/chest_open.wav'))).toBe(false)
  })

  test('新建文件夹（表单类）：Tab 到左栏「新建文件夹」，↵ 打开，输入后 ↵ 提交；Esc 关闭', async ({ page }) => {
    await openBrowse(page, bb)
    const plus = sidebar(page).getByRole('button', { name: '新建文件夹' })
    await page.locator('body').focus()
    await tabTo(page, plus)
    await page.keyboard.press('Enter')
    const d = page.getByRole('dialog', { name: '新建文件夹' })
    await expect(d).toBeVisible()
    await expect(d.getByRole('textbox', { name: '名称' })).toBeFocused()
    await noAxe(page, DIALOG)
    await tabThrough(page, d)
    await page.keyboard.press('Escape')
    await expect(d).toBeHidden()

    await tabTo(page, plus)
    await page.keyboard.press('Enter')
    await expect(d.getByRole('textbox', { name: '名称' })).toBeFocused()
    await page.keyboard.type('keyboard_made')
    await page.keyboard.press('Enter')
    await expect(d).toBeHidden()
    await expect.poll(() => fs.existsSync(path.join(bb.root, 'keyboard_made'))).toBe(true)
  })

  test('资产右键菜单用 Shift+F10 打开：导出…、移动到…（同名冲突）、替换为新版本…', async ({ page }) => {
    await openBrowse(page, bb, 'folder=ui%2Fshop')
    // 导出…
    await assetMenu(page, 'icon_coin.png')
    await chooseInMenu(page, /^导出…/)
    let d = page.getByRole('dialog', { name: '导出 icon_coin.png' })
    await expect(d).toBeVisible()
    await noAxe(page, DIALOG)
    await tabThrough(page, d)
    await page.keyboard.press('Escape')
    await expect(d).toBeHidden()

    // 移动到… → 同名冲突
    await assetMenu(page, 'icon_coin.png')
    await chooseInMenu(page, /^移动到…/)
    d = page.getByRole('dialog', { name: '移动 icon_coin.png' })
    await expect(d).toBeVisible()
    await noAxe(page, DIALOG)
    const target = d.getByRole('radio', { name: 'ui/icons' })
    await tabTo(page, target)
    await page.keyboard.press('Enter')
    await expect(target).toHaveAttribute('aria-checked', 'true')
    await tabTo(page, d.getByRole('button', { name: '移动' }))
    await page.keyboard.press('Enter')
    const c = page.getByRole('alertdialog')
    await expect(c).toContainText('ui/icons 里已经有同名的文件')
    await noAxe(page, DIALOG)
    await tabThrough(page, c)
    await page.keyboard.press('Escape')
    await expect(c).toBeHidden()

    // 替换为新版本…
    await assetMenu(page, 'icon_coin.png')
    await chooseInMenu(page, /^替换为新版本…/)
    d = page.getByRole('dialog').filter({ hasText: '替换 icon_coin.png 为新版本' })
    await expect(d).toBeVisible()
    await noAxe(page, DIALOG)
    await tabThrough(page, d)
    await page.keyboard.press('Escape')
    await expect(d).toBeHidden()
  })

  test('建立关系…：Shift+F10 打开，只用键盘走完', async ({ page }) => {
    await openBrowse(page, bb, 'folder=ui%2Fshop')
    await assetMenu(page, 'icon_coin.png')
    await chooseInMenu(page, /^建立关系…/)
    const d = page.getByRole('dialog').filter({ hasText: '为 icon_coin.png 建立关系' })
    await expect(d).toBeVisible()
    await tabThrough(page, d)
    await page.keyboard.press('Escape')
    await expect(d).toBeHidden()
  })

  test('建立关系… 对话框的 axe', async ({ page }) => {
    await openBrowse(page, bb, 'folder=ui%2Fshop')
    await assetMenu(page, 'icon_coin.png')
    await chooseInMenu(page, /^建立关系…/)
    await expect(page.getByRole('dialog').filter({ hasText: '为 icon_coin.png 建立关系' })).toBeVisible()
    await noAxe(page, DIALOG)
  })

  test('上传与重名：Tab 到「上传」打开，表单与重名对话框都只用键盘', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Flantern')
    const up = toolbar(page).getByRole('button', { name: '上传' })
    const chooser = page.waitForEvent('filechooser')
    await page.locator('body').focus()
    await tabTo(page, up)
    await page.keyboard.press('Enter')
    await (await chooser).setFiles([{ name: 'lantern_concept.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(REPO, 'fixtures/upload-batch/lantern_concept.png')) }])
    const d = page.getByRole('dialog', { name: '上传 1 个文件' })
    await expect(d).toBeVisible()
    await noAxe(page, DIALOG)
    await tabThrough(page, d)
    await tabTo(page, d.getByRole('button', { name: '上传' }))
    await page.keyboard.press('Enter')
    const c = page.getByRole('dialog', { name: '已经有一个 lantern_concept.png' })
    await expect(c).toBeVisible()
    await noAxe(page, DIALOG)
    await tabThrough(page, c)
    await tabTo(page, c.getByRole('button', { name: '跳过' }))
    await page.keyboard.press('Enter')
    await expect(c).toBeHidden()
  })

  test('切换资产库与添加资产库：资产库名 ↵ 打开菜单，方向键选「切换资产库…」，单选用方向键，Esc', async ({ page }) => {
    // the folder chooser starts at the home folder the server sees: a temp one, not this computer's
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-a-kb-home-'))
    fs.mkdirSync(path.join(home, 'art'))
    await bb.stop()
    bb = await startBowerbird({ library: 'xingluo', fsHome: home })
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-a-kb-'))
    try {
      await openBrowse(page, bb)
      const libBtn = sidebar(page).getByRole('button', { name: '星落镇' })
      await page.locator('body').focus()
      await tabTo(page, libBtn)
      await page.keyboard.press('Enter')
      await chooseInMenu(page, /^切换资产库…/)
      const d = page.getByRole('dialog', { name: '切换资产库' })
      await expect(d).toBeVisible()
      await noAxe(page, DIALOG)
      await tabThrough(page, d)
      await tabTo(page, d.getByRole('button', { name: '添加资产库…' }))
      await page.keyboard.press('Enter')
      // the same two choices as the first-run page
      const add = page.getByRole('dialog', { name: '添加资产库' })
      await expect(add).toBeVisible()
      await expect(add.getByRole('button', { name: '打开文件夹' })).toBeFocused()
      await noAxe(page, DIALOG)
      await tabThrough(page, add)
      await tabTo(page, add.getByRole('button', { name: '打开文件夹' }))
      await page.keyboard.press('Enter')
      const open = page.getByRole('dialog', { name: '打开文件夹' })
      await expect(open).toBeVisible()
      const field = open.getByRole('textbox', { name: '文件夹' })
      await expect(field).toBeFocused()
      await expect(field).toHaveValue(home)
      await noAxe(page, DIALOG)
      await tabThrough(page, open)
      // the folders: ↵ enters, ← goes back up
      await tabTo(page, open.getByRole('option', { name: 'art' }))
      await page.keyboard.press('Enter')
      await expect(field).toHaveValue(path.join(home, 'art'))
      await expect(open.getByText('这里没有文件夹')).toBeVisible()
      await expect(open.getByRole('listbox', { name: '子文件夹' })).toBeFocused()
      await page.keyboard.press('ArrowLeft')
      await expect(field).toHaveValue(home)
      await expect(open.getByRole('option', { name: 'art' })).toBeFocused()
      // the path field stays editable: type a path, ↵ opens it
      await field.focus()
      await page.keyboard.press(`${MOD}+a`)
      await page.keyboard.type(empty)
      await page.keyboard.press('Enter')
      await expect(open).toBeHidden()
      await expect(page.getByText('把文件拖进来')).toBeVisible()
    } finally { for (const dir of [empty, home]) fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test('第一次打开：欢迎页的两个选择用 Tab 到达；新建资产库对话框：Tab、↵', async ({ page }) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-a-kb-home-'))
    fs.mkdirSync(path.join(home, 'art'))
    await bb.stop()
    bb = await startBowerbird({ library: 'none', fsHome: home })
    try {
      await page.goto(bb.url)
      await expect(page.getByRole('button', { name: '打开文件夹' })).toBeVisible()
      await noAxe(page)
      await page.locator('body').focus()
      await tabTo(page, page.getByRole('button', { name: '打开文件夹' }))
      await tabTo(page, page.getByRole('button', { name: '新建资产库' }))
      await page.keyboard.press('Enter')
      const d = page.getByRole('dialog', { name: '新建资产库' })
      await expect(d).toBeVisible()
      const name = d.getByRole('textbox', { name: '名称' })
      await expect(name).toBeFocused()
      await expect(d.getByRole('option', { name: 'art' })).toBeVisible()
      await noAxe(page, DIALOG)
      await tabThrough(page, d)
      await name.focus()
      await page.keyboard.press(`${MOD}+a`)
      await page.keyboard.type('键盘库')
      await page.keyboard.press('Enter')
      await expect(d).toBeHidden()
      await expect(page.getByText('把文件拖进来')).toBeVisible()
      expect(fs.existsSync(path.join(home, '键盘库', '.bowerbird', 'library.json'))).toBe(true)
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })

  test('文件夹与智能文件夹的对话框（改名…、作为一个资产…、删除…）：Shift+F10 打开右键菜单', async ({ page }) => {
    await openBrowse(page, bb, 'folder=ui%2Fshop_v2')
    for (const [row, item, name] of [
      [folderRow(page, 'ui/shop_v2'), /^改名…/, '改名 ui/shop_v2'],
      [folderRow(page, 'ui/shop_v2'), /^把这个文件夹作为一个资产…/, '把 shop_v2 作为一个资产？'],
      [folderRow(page, 'ui/shop_v2'), /^移入回收站…/, '把 ui/shop_v2 移入回收站？'],
      [sidebar(page).locator('[data-smart="本周新增"]'), /^删除…/, '删除智能文件夹「本周新增」？']
    ] as const) {
      await row.focus()
      await page.keyboard.press('Shift+F10')
      await expect(page.getByRole('menu').first()).toBeVisible()
      await chooseInMenu(page, item)
      const d = page.getByRole('dialog', { name }).or(page.getByRole('alertdialog', { name }))
      await expect(d).toBeVisible()
      await noAxe(page, DIALOG)
      await tabThrough(page, d)
      await page.keyboard.press('Escape')
      await expect(d).toBeHidden()
    }
  })

  test('快速预览：空格打开、方向键、Esc；检查器里「打回」的意见对话框', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await focusCell(page, 'chest_concept.png')
    await page.keyboard.press('Space')
    const ql = page.getByRole('dialog', { name: '快速预览' })
    await expect(ql).toBeVisible()
    await noAxe(page, DIALOG)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await expect(ql).toBeHidden()

    await focusCell(page, 'chest.glb')
    const insp = page.getByRole('complementary', { name: '检查器' })
    const review = insp.getByRole('button', { name: /待审/ }).last()
    await tabTo(page, review)
    await page.keyboard.press('Enter')
    await chooseInMenu(page, /^打回/)
    const d = page.getByRole('dialog').filter({ hasText: '打回 chest.glb' })
    await expect(d).toBeVisible()
    await expect(d.getByRole('textbox', { name: '打回意见' })).toBeFocused()
    await noAxe(page, DIALOG)
    await page.keyboard.press('Enter')
    await expect(d.getByRole('textbox', { name: '打回意见' })).toHaveAttribute('data-invalid', 'true')
    await page.keyboard.type('锁扣太小')
    await page.keyboard.press('Enter')
    await expect(d).toBeHidden()
    const chest = await assetByPath(bb, 'props/chest/chest.glb')
    await expect.poll(async () => (await bb.api.assets.get(bb.lib, chest.id)).review).toBe('rejected')
  })

  test('关系图「更换对方…」的选择器与确认：只用键盘', async ({ page }) => {
    const chest = await assetByPath(bb, 'props/chest/chest.glb')
    const base = await assetByPath(bb, 'props/chest/chest_basecolor.png')
    await page.goto(libUrl(bb, `/asset/${chest.id}?tab=rel&relType=uses&relTo=${base.id}&relSlot=chest_basecolor.png`))
    const panel = page.getByRole('complementary', { name: '关系详情' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '更换对方…' }).focus()
    await page.keyboard.press('Enter')
    const picker = page.getByRole('dialog', { name: '更换 基础色 的对方' })
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('textbox', { name: '搜索' })).toBeFocused()
    await noAxe(page, DIALOG)
    await page.keyboard.type('chest_basecolor_dark')
    const opt = picker.getByRole('radio', { name: /chest_basecolor_dark\.png/ })
    await tabTo(page, opt)
    await page.keyboard.press('Enter')
    await tabTo(page, picker.getByRole('button', { name: '更换' }))
    await page.keyboard.press('Enter')
    const c = page.getByRole('alertdialog').filter({ hasText: '更换 基础色 的对方' })
    await expect(c).toBeVisible()
    await noAxe(page, DIALOG)
    await page.keyboard.press('Escape')
    await expect(c).toBeHidden()
  })

  test('首次打开的说明对话框：Tab、↵ 开始', async ({ page }) => {
    await bb.stop()
    bb = await startBowerbird({ library: 'first-open' })
    await page.goto(bb.url)
    const d = page.getByRole('dialog').filter({ hasText: '每个文件旁边会多一个同名的 .bmeta' })
    await expect(d).toBeVisible()
    await noAxe(page, DIALOG)
    await tabThrough(page, d)
    await tabTo(page, d.getByRole('button', { name: '开始' }))
    await page.keyboard.press('Enter')
    await expect(d).toBeHidden()
    void grid; void MOD
  })
})
