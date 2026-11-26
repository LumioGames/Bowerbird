/**
 * pages.md「浏览页」: 正常（三种布局、状态标记）、选择、悬停转台、筛选与条件标签、搜索（补全、相关度、命中片段）、空资产库、
 * 搜索无结果、文件夹为空、加载中、连接失败与重试、单元格的各种资产状态.
 */
import { expect, test, type Page, type Route } from '../helpers/test'
import { startBowerbird, type Bowerbird } from '../helpers/a-server'
import { cell, grid, libUrl, MOD, openBrowse, openLibrary, toolbar, waitScanned } from '../helpers/a-app'

let bb: Bowerbird
test.afterEach(async () => { await bb?.stop() })

const search = (page: Page) => page.getByRole('combobox', { name: '搜索' })
const panel = (page: Page) => page.locator('[data-filter-panel]')
const chips = (page: Page) => toolbar(page).getByRole('button', { name: '移除条件' })

test.describe('星落镇', () => {
  test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo' }) })

  test('正常：三种布局；左上阶段、右上校验、左下问题、右下信息', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    const glb = cell(page, 'chest.glb')
    await expect(glb.locator('[data-stage="runtime"]')).toHaveAttribute('title', '运行时物料')
    await expect(glb.locator('[data-review="pending"]')).toHaveAttribute('title', '待审')
    await expect(glb).toContainText('2,480 面')
    const icon = cell(page, 'chest_icon.png')
    await expect(icon.locator('[data-level="warning"]')).toBeVisible()
    await expect(icon.locator('[data-review="approved"]')).toBeVisible()

    await toolbar(page).getByRole('radio', { name: '瀑布流' }).click()
    await expect(cell(page, 'chest.glb')).toBeVisible()
    await toolbar(page).getByRole('radio', { name: '列表' }).click()
    const list = page.getByRole('grid', { name: '资产' })
    await expect(list).toBeVisible()
    for (const h of ['名称', '格式', '阶段', '校验']) await expect(list.getByRole('columnheader', { name: new RegExp(h) })).toBeVisible()
    await expect(list.getByText('chest.glb', { exact: true })).toBeVisible()
    await toolbar(page).getByRole('radio', { name: '等高网格' }).click()
    await expect(grid(page)).toBeVisible()
  })

  test('选择：单选、⌘ 加选、Shift 连选、⌘A 全选、方向键移动、框选、Esc 清空', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest&sort=name&order=asc')
    const sel = grid(page).locator('[data-asset-cell][aria-selected="true"]')
    await cell(page, 'chest.glb').click()
    await expect(sel).toHaveCount(1)
    // by name: chest.glb, chest.md, chest_basecolor.png, chest_basecolor_dark.png, chest_concept.png …
    await cell(page, 'chest_basecolor.png').click({ modifiers: ['Shift'] })
    await expect(sel).toHaveCount(3)
    await cell(page, 'chest_concept.png').click({ modifiers: ['ControlOrMeta'] })
    await expect(sel).toHaveCount(4)
    await cell(page, 'chest.md').click({ modifiers: ['ControlOrMeta'] })
    await expect(sel).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(sel).toHaveCount(0)
    await cell(page, 'chest.glb').click()
    await page.keyboard.press('ArrowRight')
    await expect(cell(page, 'chest.md')).toHaveAttribute('aria-selected', 'true')
    await expect(cell(page, 'chest.md')).toBeFocused()
    await page.keyboard.press(`${MOD}+a`)
    await expect(sel).toHaveCount(await grid(page).locator('[data-asset-cell]').count())
    await page.keyboard.press('Escape')

    // marquee: drag from empty space across the first row
    const first = await cell(page, 'chest.glb').boundingBox()
    const third = await cell(page, 'chest_basecolor.png').boundingBox()
    await page.mouse.move(first!.x - 8, first!.y - 6)
    await page.mouse.down()
    await page.mouse.move(third!.x + third!.width / 2, first!.y + 40, { steps: 6 })
    await page.mouse.up()
    await expect(sel).toHaveCount(3)
  })

  test('悬停：模型停留约半秒后实时转台，移开即停', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    const glb = cell(page, 'chest.glb')
    await expect(glb.locator('img')).toBeVisible({ timeout: 45_000 })
    const box = glb.locator('[data-thumb-box]')
    await box.hover()
    await page.waitForTimeout(200)
    await expect(glb.locator('canvas.bbm-cell3d')).toHaveCount(0)
    await expect(glb.locator('canvas.bbm-cell3d')).toBeVisible({ timeout: 5_000 })
    await page.mouse.move(5, 5)
    await expect(glb.locator('canvas.bbm-cell3d')).toHaveCount(0)
  })

  test('筛选面板（阶段、格式、校验带数量）与条件标签双向同步；结果数', async ({ page }) => {
    await openBrowse(page, bb)
    await toolbar(page).getByRole('button', { name: '筛选' }).click()
    const p = panel(page)
    await expect(p).toBeVisible()
    for (const h of ['物料阶段', '格式', '校验状态', '问题', '生产方式', '修改时间', '创建时间', '包含标签', '排除标签', '面数', '时长', '宽度', '高度', '只用人工标签', '附属文件']) {
      await expect(p.getByRole('heading', { name: h, exact: true })).toBeVisible()
    }
    await expect(p.getByRole('button', { name: /^运行时\s*37$/ })).toBeVisible()
    await expect(p.getByText('72 个结果')).toBeVisible()

    // panel → chip
    await p.getByRole('button', { name: /^运行时/ }).click()
    await expect(page).toHaveURL(/stage/)
    await expect(chips(page)).toHaveCount(1)
    await expect(toolbar(page).getByText('stage:')).toBeVisible()
    await expect(p.getByText('37 个结果')).toBeVisible()
    await expect(p.getByRole('button', { name: /^运行时/ })).toHaveAttribute('aria-pressed', 'true')

    // chip typed in the box → panel
    await search(page).fill('format:model ')
    await expect(chips(page)).toHaveCount(2)
    await expect(p.getByRole('button', { name: /^3D 模型/ })).toHaveAttribute('aria-pressed', 'true')

    // remove the chip → panel follows
    await chips(page).last().click()
    await expect(p.getByRole('button', { name: /^3D 模型/ })).toHaveAttribute('aria-pressed', 'false')
    await search(page).click()
    await page.keyboard.press('Backspace')
    await expect(chips(page)).toHaveCount(0)
    await expect(p.getByRole('button', { name: /^运行时/ })).toHaveAttribute('aria-pressed', 'false')

    await p.getByRole('button', { name: '有问题' }).click()
    await expect(toolbar(page).getByText('is:')).toBeVisible()
    await p.getByRole('button', { name: '清空' }).click()
    await expect(chips(page)).toHaveCount(0)
  })

  test('语法补全：键与中文含义、值来自资产库；↑↓ 选择，Tab 填入成为条件标签', async ({ page }) => {
    await openBrowse(page, bb)
    await search(page).click()
    await page.keyboard.type('sta')
    const ac = page.getByRole('listbox').filter({ hasText: '↑↓ 选择 · Tab 或 ↵ 填入' })
    await expect(ac).toBeVisible()
    await expect(ac.getByRole('option', { name: /stage:\s*物料阶段/ })).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(search(page)).toHaveValue('stage:')
    await expect(ac.getByRole('option')).toHaveText([/reference\s*参考/, /production\s*生产/, /runtime\s*运行时/])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(ac.getByRole('option', { name: /runtime/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(chips(page)).toHaveCount(1)
    await expect(toolbar(page).getByText('runtime')).toBeVisible()

    await page.keyboard.type('tag:宝')
    await expect(ac.getByRole('option', { name: /宝箱/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ac).toBeHidden()
  })

  test('有查询词时默认按相关度；命中名称以外时显示片段并高亮', async ({ page }) => {
    await openBrowse(page, bb)
    await search(page).fill('开箱')
    await search(page).press('Enter')
    await expect(toolbar(page).getByRole('button', { name: /^相关度/ })).toBeVisible()
    const glb = cell(page, 'chest.glb')
    await expect(glb).toBeVisible()
    const hit = glb.locator('.bb-hit').last()
    await expect(hit).toContainText('描述')
    await expect(hit.locator('mark').first()).toHaveText('开箱')
  })

  test('搜索无结果：「没有符合条件的资产」+「去掉最后一个条件」「清空」', async ({ page }) => {
    await openBrowse(page, bb)
    await search(page).fill('format:audio ')
    await search(page).fill('不存在的东西xyz')
    await search(page).press('Enter')
    await expect(page.getByText('没有符合条件的资产')).toBeVisible()
    await page.getByRole('button', { name: '去掉最后一个条件' }).click()
    await expect(chips(page)).toHaveCount(0)
    await expect(page.getByText('没有符合条件的资产')).toBeVisible()
    await page.getByRole('button', { name: '清空' }).click()
    await expect(search(page)).toHaveValue('')
    await expect(grid(page)).toBeVisible()
  })

  test('文件夹为空：「这个文件夹是空的」+「上传」', async ({ page }) => {
    await openLibrary(page, bb, '?folder=references%2Fillustration')
    await expect(page.getByText('这个文件夹是空的')).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('main').getByRole('button', { name: '上传' }).click()
    await chooser
  })

  test('加载中：骨架', async ({ page }) => {
    await waitScanned(bb)
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    await page.route('**/api/v1/libraries/*/search', async (route: Route) => { await gate; await route.continue() })
    await page.goto(libUrl(bb))
    await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible()
    await expect(grid(page)).toHaveCount(0)
    release()
    await expect(grid(page)).toBeVisible()
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
  })

  test('单元格状态：文件缺失、未知格式（OBJ）、缺少插件、处理失败', async ({ page }) => {
    await openBrowse(page, bb, 'folder=characters%2Fhero')
    const missing = cell(page, 'hero_idle.fbx')
    await expect(missing.locator('[data-thumb="missing"]')).toBeVisible()
    await expect(missing.locator('div[title]').last()).toHaveClass(/line-through/)
    const skel = cell(page, 'hero_run.skel')
    await expect(skel.locator('[data-thumb="plugin"]')).toBeVisible()
    await expect(skel).toContainText(/需要 \S+/)

    await page.goto(libUrl(bb, '?folder=environments'))
    const obj = cell(page, 'rock_01.obj')
    await expect(obj.locator('[data-thumb="unknown"]')).toBeVisible()
    await expect(obj).toContainText('.obj')
    const mov = cell(page, 'intro_cutscene.mov')
    await expect(mov.locator('[data-thumb="failed"]')).toBeVisible({ timeout: 30_000 })
    await expect(mov).toContainText('处理失败')
  })

  test('单元格状态：处理中（进度）', async ({ page }) => {
    await waitScanned(bb)
    await page.route('**/api/v1/libraries/*/search', async route => {
      const res = await route.fetch()
      const body = await res.json() as { items?: Array<Record<string, unknown>> }
      for (const a of body.items ?? []) if (a.name === 'chest_orm.png') Object.assign(a, { flags: ['processing'], thumbnail: null, thumbState: 'pending' })
      await route.fulfill({ response: res, json: body })
    })
    await page.goto(libUrl(bb, '?folder=props%2Fchest'))
    const orm = cell(page, 'chest_orm.png')
    await expect(orm.locator('[data-thumb="processing"]')).toBeVisible()
    await expect(orm).toContainText('正在处理')
    await expect(orm.getByRole('progressbar')).toBeVisible()
  })

  test('单元格状态：等待显示时生成缩略图 → 进入视口后由本页渲染并替换（ADR-025）', async ({ page }) => {
    await waitScanned(bb)
    let hold = true
    await page.route('**/api/v1/libraries/*/render/next**', async route => { if (hold) await route.fulfill({ json: { task: null } }); else await route.continue() })
    await page.goto(libUrl(bb, '?folder=characters%2Fnpc'))
    const guard = cell(page, 'npc_guard.glb')
    await expect(guard.locator('[data-thumb="render"]')).toBeVisible()
    await expect(guard).toContainText(/缩略图稍后生成|正在生成缩略图/)
    hold = false
    await expect(guard.locator('img')).toBeVisible({ timeout: 45_000 })
    await expect(guard.locator('[data-thumb="render"]')).toHaveCount(0)
  })

  test('连接失败：「连接不到 Bowerbird 服务」+ 重试', async ({ page }) => {
    await waitScanned(bb)
    await page.goto(libUrl(bb, '?folder=props%2Fchest'))
    await expect(cell(page, 'chest.glb')).toBeVisible()
    await bb.kill()
    // a page already open whose next request finds no server
    await page.locator('[data-folder="audio"]').click()
    await expect(page.getByText('连接不到 Bowerbird 服务').first()).toBeVisible({ timeout: 30_000 })
    const retry = page.getByRole('button', { name: '重试' }).first()
    await expect(retry).toBeVisible()
    await retry.click()
    await expect(page.getByText('连接不到 Bowerbird 服务').first()).toBeVisible()
  })
})

test('空资产库：「把文件拖进来」+「选择文件」', async ({ page }) => {
  bb = await startBowerbird({ library: 'empty' })
  await page.goto(bb.url)
  await expect(page.getByText('把文件拖进来')).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择文件' }).click()
  await chooser
})

test('启动扫描还没完成时打开浏览页：扫描进来的资产直接出现在网格里，文件夹与视图计数跟着变，不用刷新', async ({ page }) => {
  bb = await startBowerbird({ library: 'xingluo' })
  // no waitScanned: the library was copied a moment ago, so the scanner leaves the files for its retry pass
  await page.goto(bb.url)
  await expect(grid(page).locator('[data-asset-cell]').nth(11)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-view="all"]')).toContainText('全部72', { timeout: 30_000 })
  await expect(page.locator('[data-folder="props"]')).toContainText('17')
  await expect(page.locator('[data-folder="ui"]')).toContainText('23')
  await page.waitForTimeout(2000)
  await expect(page.getByRole('button', { name: /个新资产 · 显示/ })).toHaveCount(0)
  await expect(page.getByText('没有符合条件的资产')).toHaveCount(0)
  await expect(page.getByText('把文件拖进来')).toHaveCount(0)
})
