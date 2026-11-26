/**
 * pages.md「外壳」: 左栏（资产库菜单、视图与数量、智能文件夹与文件夹的右键）、顶栏、检查器三种形态、浮层（右键菜单与二级菜单、
 * 弹出面板、确认类与表单类对话框、提示条、快速预览）. Text from design/docs/copy.md.
 */
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startBowerbird, type Bowerbird } from '../helpers/a-server'
import {
  alert, assetByPath, cell, contextMenu, dialog, folderRow, grid, inspector, libUrl, menuItem, MOD, openBrowse, sidebar, smartRow, toast, toolbar, viewRow, waitScanned
} from '../helpers/a-app'

let bb: Bowerbird
test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo' }) })
test.afterEach(async () => { await bb?.stop() })

const count = (row: ReturnType<typeof viewRow>) => row.locator('span').last()

test.describe('左栏', () => {
  test('资产库菜单：资产库设置…、在文件夹中显示（本机）、切换资产库…', async ({ page }) => {
    await openBrowse(page, bb)
    await sidebar(page).getByRole('button', { name: '星落镇' }).click()
    const m = page.getByRole('menu')
    await expect(m.getByRole('menuitem')).toHaveText(['资产库设置…', '在文件夹中显示', '切换资产库…'])
    // (not clicked: on this machine it would really open the file manager)
    await expect(m.getByRole('menuitem', { name: '在文件夹中显示' })).toBeEnabled()
    await page.getByRole('menuitem', { name: '资产库设置…' }).click()
    await expect(page).toHaveURL(/\/settings\/library/)
  })

  test('五个视图带数量，与服务端一致；「有问题」与完整性页页头同一口径', async ({ page }) => {
    await openBrowse(page, bb)
    const info = await bb.api.libraries.get(bb.lib)
    await expect(viewRow(page, 'all')).toContainText(`全部${info.counts.all}`)
    await expect(viewRow(page, 'untagged')).toContainText(`未打标签${info.counts.untagged}`)
    await expect(viewRow(page, 'pending')).toContainText(`待审${info.counts.pending}`)
    await expect(viewRow(page, 'trash')).toContainText(`回收站${info.counts.trash}`)
    await expect(viewRow(page, 'issues')).toContainText(`有问题${info.stats.issueAssets}`)
    // the inspector's overview of 全部 counts the same way (any level, 提示 included)
    await expect(inspector(page).locator('dt', { hasText: /^有问题$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(String(info.stats.issueAssets))
    expect(info.counts.all).toBe(72)
    expect(info.counts.trash).toBe(4)

    await viewRow(page, 'issues').click()
    await expect(page).toHaveURL(/\/issues/)
    await expect(page.getByText(new RegExp(`^${info.stats.issueAssets} 个资产 · \\d+ 条问题$`))).toBeVisible()
    await viewRow(page, 'trash').click()
    await expect(page).toHaveURL(/\/trash/)
    await viewRow(page, 'untagged').click()
    await expect(page).toHaveURL(/view=untagged/)
    await expect(grid(page).locator('[data-asset-cell]')).toHaveCount(info.counts.untagged)
  })

  test('底部「设置」「标签」「任务」：三个只有图标的按钮，按名字可点', async ({ page }) => {
    await openBrowse(page, bb)
    const foot = page.getByTestId('side-footer')
    await expect(foot.getByRole('button')).toHaveCount(3)
    await expect(foot.getByRole('button', { name: '设置' })).toBeVisible()
    // icons only: no visible words in the footer
    expect((await foot.innerText()).trim()).toBe('')
    await foot.getByRole('button', { name: '设置' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await sidebar(page).getByRole('button', { name: '标签' }).click()
    await expect(page).toHaveURL(/\/tags$/)
    await sidebar(page).getByRole('button', { name: '任务' }).click()
    await expect(page).toHaveURL(/\/settings\/tasks$/)
  })

  test('文件夹显示名、图标、备注；右键六项，顺序固定，最后一项危险色', async ({ page }) => {
    await openBrowse(page, bb)
    const chest = folderRow(page, 'props')
    await expect(chest).toContainText('props道具')
    await folderRow(page, 'props').locator('[aria-expanded], [role="presentation"], svg').first().click().catch(() => {})
    await page.goto(libUrl(bb, '?folder=props%2Fchest'))
    const row = folderRow(page, 'props/chest')
    await expect(row).toContainText('chest宝箱')
    await expect(row).toHaveAttribute('title', '新手村宝箱：原画、模型、贴图、Icon、音效')
    await expect(folderRow(page, 'docs')).toContainText('docs规范文档')
    await row.click({ button: 'right' })
    const items = page.getByRole('menu').getByRole('menuitem')
    await expect(items).toHaveText(['文件夹信息', '新建子文件夹…', '改名…', '把这个文件夹作为一个资产…', '只扫描这个文件夹', '移入回收站…'])
    await expect(items.last()).toHaveAttribute('data-variant', 'danger')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    // top-level folders cannot become one asset
    await folderRow(page, 'docs').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '把这个文件夹作为一个资产…' })).toBeDisabled()
  })

  test('文件夹信息 → 检查器显示显示名、图标、备注、新资产的默认值', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await folderRow(page, 'props/chest').click({ button: 'right' })
    await menuItem(page, '文件夹信息').click()
    const insp = inspector(page)
    await expect(insp.getByRole('textbox', { name: '显示名' })).toHaveValue('宝箱')
    await expect(insp.getByRole('textbox', { name: '备注' })).toHaveValue('新手村宝箱：原画、模型、贴图、Icon、音效')
    await expect(insp.getByRole('button', { name: '更换图标' })).toBeVisible()
    await expect(insp.getByText('新资产的默认值')).toBeVisible()
    await expect(insp.getByText('概况')).toBeVisible()
  })

  test('新建子文件夹… 与改名…（文件夹名改磁盘目录，显示名只在 Bowerbird）', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Flantern')
    await folderRow(page, 'props/lantern').click({ button: 'right' })
    await menuItem(page, '新建子文件夹…').click()
    const nd = dialog(page, '在 props/lantern 里新建文件夹')
    await expect(nd).toBeVisible()
    await nd.getByRole('textbox', { name: '名称' }).fill('variants')
    await nd.getByRole('button', { name: '新建' }).click()
    await expect(toast(page, '已新建 props/lantern/variants')).toBeVisible()
    await expect.poll(() => fs.existsSync(path.join(bb.root, 'props/lantern/variants'))).toBe(true)

    await folderRow(page, 'props/lantern').click({ button: 'right' })
    await menuItem(page, '改名…').click()
    const rd = dialog(page, '改名 props/lantern')
    await expect(rd.getByText('改的是磁盘上的目录名，里面 1 个资产一起换路径，引用不受影响')).toBeVisible()
    await expect(rd.getByText('只在 Bowerbird 里显示，磁盘上不变')).toBeVisible()
    await expect(rd.getByRole('textbox', { name: '显示名' })).toHaveValue('提灯')
    await rd.getByRole('textbox', { name: '文件夹名' }).fill('lanterns')
    await rd.getByRole('button', { name: '改名' }).click()
    await expect(toast(page, '已改名为 lanterns')).toBeVisible()
    await expect.poll(() => fs.existsSync(path.join(bb.root, 'props/lanterns/lantern_concept.png'))).toBe(true)
    expect(fs.existsSync(path.join(bb.root, 'props/lantern'))).toBe(false)
  })

  test('把这个文件夹作为一个资产… → 确认后网格里显示成一叠', async ({ page }) => {
    await openBrowse(page, bb, 'folder=ui')
    await page.goto(libUrl(bb, '?folder=ui%2Fshop_v2'))
    await folderRow(page, 'ui/shop_v2').click({ button: 'right' })
    await menuItem(page, '把这个文件夹作为一个资产…').click()
    const a = alert(page, '把 shop_v2 作为一个资产？')
    await expect(a).toBeVisible()
    await expect(a).toContainText('里面 5 个文件合成一个资产，以后整体浏览、校验和引用。')
    await a.getByRole('button', { name: '作为一个资产' }).click()
    await expect(toast(page, /已把 .*shop_v2.* 作为一个资产/)).toBeVisible()
    await page.goto(libUrl(bb, '?folder=ui'))
    const stack = cell(page, 'shop_v2')
    await expect(stack).toBeVisible()
    await expect(stack.locator('.bb-bundle-stack')).toHaveCount(1)
    await stack.click()
    await expect(inspector(page).getByText(/^包内文件/)).toBeVisible()
  })

  test('只扫描这个文件夹；移入回收站…（说明里面有多少资产，可撤销）；空文件夹的说法', async ({ page }) => {
    await openBrowse(page, bb, 'folder=references%2F3d-render')
    await folderRow(page, 'references').click({ button: 'right' })
    await menuItem(page, '只扫描这个文件夹').click()
    await expect(toast(page, '正在扫描 references…')).toBeVisible()

    await folderRow(page, 'references/3d-render').click({ button: 'right' })
    await menuItem(page, '移入回收站…').click()
    const a = alert(page, '把 references/3d-render 移入回收站？')
    await expect(a).toContainText('里面有 8 个资产，会一起移入回收站。回收站保留 7 天，期间可以恢复。')
    await a.getByRole('button', { name: '移入回收站' }).click()
    const done = toast(page, '已把 references/3d-render 移入回收站')
    await expect(done).toBeVisible()
    await expect(folderRow(page, 'references/3d-render')).toHaveCount(0)
    await expect.poll(async () => (await bb.api.trash.list(bb.lib)).items.length).toBe(12)
    await done.getByRole('button', { name: '撤销' }).click()
    await expect.poll(async () => (await bb.api.trash.list(bb.lib)).items.length).toBe(4)

    await folderRow(page, 'references/illustration').click({ button: 'right' })
    await menuItem(page, '移入回收站…').click()
    await expect(alert(page, '把 references/illustration 移入回收站？')).toContainText('这是一个空文件夹。')
  })

  test('移入回收站…：里面的资产被文件夹外引用时，再问一次并列出引用方（ADR-047）', async ({ page }) => {
    const hud = await assetByPath(bb, 'ui/hud/hud_health.png')
    const potion = await assetByPath(bb, 'props/potion/potion_concept.png')
    await bb.api.relations.add(bb.lib, hud.id, { type: 'uses', to: potion.id })
    let referenced = false
    try { await bb.api.folders.remove(bb.lib, 'props/potion') } catch (e) { referenced = (e as { code?: string }).code === 'referenced' }
    test.fixme(!referenced, '内核的 trashFolder 还没按 ADR-047 返回 referenced（待内核线合并）')

    await openBrowse(page, bb, 'folder=props%2Fpotion')
    await folderRow(page, 'props/potion').click({ button: 'right' })
    await menuItem(page, '移入回收站…').click()
    await alert(page, '把 props/potion 移入回收站？').getByRole('button', { name: '移入回收站' }).click()
    const again = alert(page, '把 props/potion 移入回收站？')
    await expect(again).toContainText('有 1 个资产依赖它，删除后这些关系会指向找不到的文件。')
    await expect(again.getByText('hud_health.png')).toBeVisible()
    await again.getByRole('button', { name: '移入回收站' }).click()
    await expect(toast(page, '已把 props/potion 移入回收站')).toBeVisible()
  })
})

test.describe('智能文件夹', () => {
  test('右键：改名…、编辑条件、用当前条件更新、删除…', async ({ page }) => {
    await openBrowse(page, bb)
    await smartRow(page, '运行时模型').click({ button: 'right' })
    const items = page.getByRole('menu').getByRole('menuitem')
    await expect(items).toHaveText([/^改名…/, /^编辑条件/, /^用当前条件更新/, /^删除…/])
    await expect(page.getByRole('menuitem', { name: /^用当前条件更新/ })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: /^用当前条件更新/ })).toContainText('先设好条件')

    await page.getByRole('menuitem', { name: /^改名…/ }).click()
    const rd = dialog(page, '改名')
    await rd.getByRole('textbox', { name: '名称' }).fill('运行时的模型')
    await rd.getByRole('button', { name: '改名' }).click()
    await expect(toast(page, '已改名为 运行时的模型')).toBeVisible()
    await expect(smartRow(page, '运行时的模型')).toBeVisible()

    await smartRow(page, '本周新增').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^删除…/ }).click()
    const del = alert(page, '删除智能文件夹「本周新增」？')
    await expect(del).toContainText('只删掉这个保存的查询，里面的资产不受影响。')
    await del.getByRole('button', { name: '删除' }).click()
    const done = toast(page, '已删除「本周新增」')
    await expect(done).toBeVisible()
    await expect(smartRow(page, '本周新增')).toHaveCount(0)
    await done.getByRole('button', { name: '撤销' }).click()
    await expect(smartRow(page, '本周新增')).toBeVisible()
  })

  test('保存当前条件为智能文件夹；编辑条件时筛选面板底部「保存到「…」」；用当前条件更新', async ({ page }) => {
    await openBrowse(page, bb)
    await sidebar(page).getByRole('button', { name: '把当前条件保存为智能文件夹' }).click()
    await expect(toast(page, '先加上筛选条件，再保存为智能文件夹')).toBeVisible()

    await page.getByRole('combobox', { name: '搜索' }).fill('format:audio ')
    await expect(page).toHaveURL(/format/)
    await sidebar(page).getByRole('button', { name: '把当前条件保存为智能文件夹' }).click()
    const sd = dialog(page, '保存为智能文件夹')
    await sd.getByRole('textbox', { name: '名称' }).fill('全部音频')
    await sd.getByRole('button', { name: '保存为智能文件夹' }).click()
    await expect(toast(page, '已保存为智能文件夹「全部音频」')).toBeVisible()
    await smartRow(page, '全部音频').click()
    // theme_town.ogg, coin_pickup.wav, ui_click.wav, chest_open.wav
    await expect(grid(page).locator('[data-asset-cell]')).toHaveCount(4)

    // 编辑条件 → 保存到「…」
    await smartRow(page, 'AI 生成待审').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^编辑条件/ }).click()
    const saveTo = page.getByRole('button', { name: '保存到「AI 生成待审」' })
    await expect(saveTo).toBeVisible()
    await page.locator('[data-filter-panel]').getByRole('button', { name: /^运行时/ }).click()
    await saveTo.click()
    await expect(toast(page, '已保存「AI 生成待审」的条件')).toBeVisible()
    await expect.poll(async () => JSON.stringify((await bb.api.views.list(bb.lib)).views.find(v => v.name === 'AI 生成待审'))).toContain('runtime')

    // 用当前条件更新
    await page.goto(libUrl(bb, '?q=format%3Aaudio'))
    await page.getByRole('combobox', { name: '搜索' }).fill('format:model ')
    await smartRow(page, '运行时模型').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^用当前条件更新/ }).click()
    await expect(toast(page, '已用当前条件更新「运行时模型」')).toBeVisible()
  })
})

test.describe('顶栏', () => {
  test('路径、缩略图大小、三种布局、排序（相关度只在有查询词时）、筛选、检查器开关', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    const bar = toolbar(page)
    await expect(bar.getByRole('navigation')).toContainText('星落镇')
    await expect(bar.getByRole('navigation')).toContainText('props')
    await expect(bar.getByRole('navigation')).toContainText('chest')
    await expect(bar.getByRole('slider')).toBeVisible()

    await bar.getByRole('radio', { name: '列表' }).click()
    await expect(page.getByRole('columnheader', { name: /名称/ })).toBeVisible()
    await bar.getByRole('radio', { name: '瀑布流' }).click()
    await expect(page.getByRole('columnheader')).toHaveCount(0)
    await bar.getByRole('radio', { name: '等高网格' }).click()

    await bar.getByRole('button', { name: /修改时间/ }).click()
    const rel = page.getByRole('menuitem', { name: /^相关度/ })
    await expect(rel).toBeDisabled()
    await expect(rel).toContainText('有查询词时')
    await expect(page.getByRole('menuitem')).toHaveText([/相关度/, /名称/, /修改时间/, /创建时间/, /大小/, /格式/])
    await page.getByRole('menuitem', { name: /^名称/ }).click()
    await expect(page).toHaveURL(/sort=name/)

    await bar.getByRole('button', { name: '筛选' }).click()
    await expect(page.locator('[data-filter-panel]')).toBeVisible()
    await bar.getByRole('button', { name: '筛选' }).click()
    await expect(page.locator('[data-filter-panel]')).toHaveCount(0)

    await expect(bar.getByRole('button', { name: '开始校验' })).toHaveCount(0)
    await expect(bar.getByRole('button', { name: '上传' })).toBeVisible()

    await bar.getByRole('button', { name: '检查器' }).click()
    await expect(inspector(page)).toBeHidden()
    await page.keyboard.press(`${MOD}+i`)
    await expect(inspector(page)).toBeVisible()
  })

  test('重新扫描；后台处理（一个数字，弹出面板）', async ({ page }) => {
    await openBrowse(page, bb)
    await toolbar(page).getByRole('button', { name: '重新扫描' }).click()
    await expect(toast(page, '正在扫描…')).toBeVisible()
    // a scan this browser asked for answers when it ends (ADR-040)
    await expect(toast(page, /^扫描完成/)).toBeVisible({ timeout: 20_000 })
    const jobs =toolbar(page).getByRole('button', { name: '后台处理' })
    await expect(jobs).toHaveText(/^\d+$/)
    await jobs.click()
    const pop = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '后台处理' }) })
    await expect(pop).toBeVisible()
    await pop.getByRole('button', { name: '查看全部任务' }).click()
    await expect(page).toHaveURL(/\/settings\/tasks/)
  })
})

test.describe('检查器', () => {
  test('无选择：视图概况；单选：各分区；多选：共同标签、批量阶段与校验', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    const insp = inspector(page)
    await expect(insp.getByText('概况')).toBeVisible()

    await cell(page, 'chest.glb').click()
    for (const s of ['基本', '描述', '标签', '阶段与校验', '技术信息', '生产记录']) await expect(insp.getByRole('button', { name: new RegExp(`^${s}`) }).first()).toBeVisible()
    await expect(insp.getByRole('button', { name: /^关系 · 6/ })).toBeVisible()
    await expect(insp.getByRole('button', { name: /^版本 · 2/ })).toBeVisible()
    await expect(insp.getByText('木质宝箱模型，黄铜包边，正面有锁扣，箱盖为半圆柱形。')).toBeVisible()
    await expect(insp.getByRole('button', { name: '采纳标签 低多边形' })).toBeVisible()

    await cell(page, 'chest_turnaround.png').click()
    await expect(insp.getByText('2 行 2 列 · 正面 侧面 / 背面 顶面')).toBeVisible()

    await cell(page, 'chest_basecolor.png').click({ modifiers: [MOD as 'ControlOrMeta'] })
    await cell(page, 'chest_normal.png').click({ modifiers: [MOD as 'ControlOrMeta'] })
    await expect(insp.getByText('已选 3 个')).toBeVisible()
    await expect(insp.getByRole('button', { name: /^物料阶段/ })).toBeVisible()
    await expect(insp.getByRole('button', { name: /^校验状态/ })).toBeVisible()
    await expect(insp.getByRole('textbox', { name: '给全部选中的资产添加标签' })).toBeVisible()
  })

  test('选中的资产已不在当前视图时标明「已不在这个视图里」', async ({ page }) => {
    await openBrowse(page, bb, 'view=pending')
    const name = 'lantern_concept.png'
    await cell(page, name).click()
    const a = await assetByPath(bb, 'props/lantern/lantern_concept.png')
    await bb.api.assets.review(bb.lib, a.id, { status: 'approved' })
    await page.getByRole('combobox', { name: '搜索' }).fill('lantern')
    await page.keyboard.press('Enter')
    await expect(inspector(page).getByText('已不在这个视图里')).toBeVisible()
  })
})

test.describe('浮层', () => {
  test('右键菜单的二级菜单（物料阶段）；提示条可撤销', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await contextMenu(page, cell(page, 'chest_orm.png'))
    await page.getByRole('menuitem', { name: /^物料阶段/ }).hover()
    const sub = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: '参考素材' }) })
    await expect(sub).toBeVisible()
    await expect(sub.getByRole('menuitem')).toHaveText(['参考素材', '生产物料', '运行时物料'])
    await sub.getByRole('menuitem', { name: '参考素材' }).click()
    const t = toast(page, 'chest_orm.png 已设为参考素材')
    await expect(t).toBeVisible()
    const orm = await assetByPath(bb, 'props/chest/chest_orm.png')
    await expect.poll(async () => (await bb.api.assets.get(bb.lib, orm.id)).stage).toBe('reference')
    await t.hover()
    await page.waitForTimeout(9000)
    await expect(t).toBeVisible()
    await t.getByRole('button', { name: '撤销' }).click()
    await expect.poll(async () => (await bb.api.assets.get(bb.lib, orm.id)).stage).toBe('runtime')
  })

  test('确认类对话框点外面就关；表单类点外面不关，Esc 关', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await cell(page, 'chest_orm.png').click()
    await page.keyboard.press('Delete')
    const c = alert(page, '把 chest_orm.png 移入回收站？')
    await expect(c).toBeVisible()
    await page.mouse.click(30, 450)
    await expect(c).toBeHidden()

    await folderRow(page, 'props/chest').click({ button: 'right' })
    await menuItem(page, '新建子文件夹…').click()
    const f = dialog(page, '在 props/chest 里新建文件夹')
    await expect(f).toBeVisible()
    await page.mouse.click(30, 450)
    await expect(f).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(f).toBeHidden()
  })

  test('提示条叠放在右下角', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    for (let i = 0; i < 3; i++) await toolbar(page).getByRole('button', { name: '重新扫描' }).click()
    const ts = toast(page, '正在扫描…')
    await expect(ts).toHaveCount(3)
    const box = await ts.first().boundingBox()
    const vp = page.viewportSize()!
    expect(box!.x + box!.width).toBeGreaterThan(vp.width - 40)
    expect(box!.y + box!.height).toBeGreaterThan(vp.height - 120)
  })

  test('快速预览：空格打开，方向键换下一个，Esc 关闭', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest&sort=name&order=asc')
    await cell(page, 'chest.glb').click()
    await page.keyboard.press('Space')
    const ql = page.getByRole('dialog', { name: '快速预览' })
    await expect(ql).toBeVisible()
    const name = ql.locator('div.h-12 > b')  // the footer (a document viewer has bold text of its own)
    await expect(name).toHaveText('chest.glb')
    await page.keyboard.press('ArrowRight')
    await expect(name).toHaveText('chest.md')
    await expect(cell(page, 'chest.md')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(name).toHaveText('chest.glb')
    await page.keyboard.press('Escape')
    await expect(ql).toBeHidden()
    await page.keyboard.press('Space')
    await expect(ql).toBeVisible()
    await page.keyboard.press('Space')
    await expect(ql).toBeHidden()
  })
})

void waitScanned
export type { Page }
