import { test, expect, type Page } from '../helpers/test'
import { startBB, idOf, libPath, openDetail, detailTabs } from '../helpers/b-server'
import { browseFolder, cell, dialog, MOD, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/** pages.md「详情页」: top bar, way here, tabs, banners and the special viewer states. */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const crumbs = (page: Page) => page.getByRole('navigation', { name: '路径' })
const tab = (page: Page, name: string | RegExp) => detailTabs(page).getByRole('tab', { name })
const pane = (page: Page) => page.locator('.w2-dpane')

test('顶栏：返回、路径、名称与标记、页签、上一个 / 下一个、更多操作（与右键菜单相同）、检查器', async ({ page }) => {
  await browseFolder(page, bb, 'props/chest')
  // the right-click menu of the same asset, for comparison
  await cell(page, 'chest.glb').click({ button: 'right' })
  const ctxItems = (await page.getByRole('menu').last().getByRole('menuitem').allInnerTexts()).map(s => s.split('\n')[0]!.trim())
  await page.keyboard.press('Escape')
  await cell(page, 'chest.glb').dblclick()

  await expect(page.locator('.w2-dh b')).toHaveText('chest.glb')
  const bar = page.locator('.w2-dbar')
  await expect(bar.getByRole('button', { name: '返回' })).toBeVisible()
  await expect(crumbs(page).locator('.w2-dcr__c').first()).toContainText('chest')
  await expect(page.locator('.w2-dh')).toContainText('运行时')
  await expect(page.locator('.w2-dh')).toContainText('待审')
  await expect(detailTabs(page).getByRole('tab')).toHaveText(['查看', /^关系\s*6$/, /^版本\s*2$/, '校验'])
  await expect(tab(page, '查看')).toHaveAttribute('aria-selected', 'true')
  // previous / next walk the browse result list
  await expect(bar).toContainText(/\d+ \/ \d+/)
  const before = (await bar.innerText()).match(/(\d+) \/ (\d+)/)!
  await bar.getByRole('button', { name: '下一个' }).click()
  await expect(page.locator('.w2-dh b')).not.toHaveText('chest.glb')
  await expect(bar).toContainText(`${Number(before[1]) + 1} / ${before[2]}`)
  await bar.getByRole('button', { name: '上一个' }).click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest.glb')

  // 更多操作 = the right-click menu without「打开」(already open)
  await bar.getByRole('button', { name: '更多操作' }).click()
  const moreItems = (await page.getByRole('menu').last().getByRole('menuitem').allInnerTexts()).map(s => s.split('\n')[0]!.trim())
  await page.keyboard.press('Escape')
  expect(ctxItems[0]).toBe('打开')
  expect(moreItems).toEqual(ctxItems.filter(x => x !== '打开'))
  expect(moreItems).toEqual(expect.arrayContaining(['快速预览', '对比…', '物料阶段', '复制', '移动到…', '改名', '替换为新版本…', '建立关系…', '导出…', '移入回收站']))

  // the inspector switch
  const insp = bar.getByRole('button', { name: '检查器' })
  const was = await insp.getAttribute('aria-pressed')
  await insp.click()
  await expect(insp).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true')
  await insp.click()
  await expect(insp).toHaveAttribute('aria-pressed', was ?? 'true')
})

test('浏览路径的第一段是当前位置的名字（原型 detail.js：home = 路径最后一段）', async ({ page }) => {
  await browseFolder(page, bb, 'props/chest')
  await cell(page, 'chest.glb').dblclick()
  await expect(crumbs(page).locator('.w2-dcr__c').first()).toHaveText('chest')
})

test('浏览路径：超过两段折叠成「…」，点开能回到更早的一步', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.md')
  await expect(tab(page, /总览/)).toHaveAttribute('aria-selected', 'true')
  // 总览 → chest.glb (step 1)
  await pane(page).getByRole('button', { name: /chest\.glb/ }).click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest.glb')
  await expect(crumbs(page)).toContainText('chest.md')
  await expect(crumbs(page).getByRole('button', { name: '更早的路径' })).toHaveCount(0)
  // chest.glb → 关系 → chest_high.blend (step 2)
  await tab(page, /关系/).click()
  await page.locator('.w2-gn[data-asset]').filter({ hasText: 'chest_high.blend' }).first().click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest_high.blend')
  await expect(crumbs(page)).toContainText('chest.md')
  await expect(crumbs(page)).toContainText('chest.glb')
  // → chest_turnaround.png (step 3): the earlier two fold into「…」
  await page.locator('.w2-gn[data-asset]').filter({ hasText: 'chest_turnaround.png' }).first().click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest_turnaround.png')
  const more = crumbs(page).getByRole('button', { name: '更早的路径' })
  await expect(more).toHaveText('…')
  await expect(crumbs(page).locator('.w2-dcr__c')).toHaveText([/chest$/, '…', 'chest_high.blend'])
  await more.click()
  const menu = page.getByRole('menu').last()
  await expect(menu.getByRole('menuitem')).toHaveText(['chest.glb', 'chest.md'])
  await menu.getByRole('menuitem', { name: 'chest.md' }).click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest.md')
  await expect(tab(page, /总览/)).toHaveAttribute('aria-selected', 'true')
})

test('⌘[ 返回到上一个资产，并停在离开时的页签', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.glb', 'rel')
  await page.locator('.w2-gn[data-asset]').filter({ hasText: 'chest_basecolor.png' }).first().click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest_basecolor.png')
  await tab(page, '校验').click()
  await expect(tab(page, '校验')).toHaveAttribute('aria-selected', 'true')
  await page.locator('body').click({ position: { x: 600, y: 600 } }).catch(() => {})
  await page.keyboard.press(`${MOD}+BracketLeft`)
  await expect(page.locator('.w2-dh b')).toHaveText('chest.glb')
  await expect(tab(page, /关系/)).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/tab=rel/)
  // browser back from the browse-less entry stays consistent: forward goes to basecolor at 校验
  await page.goForward()
  await expect(page.locator('.w2-dh b')).toHaveText('chest_basecolor.png')
  await expect(tab(page, '校验')).toHaveAttribute('aria-selected', 'true')
})

test('设计对象：多出「总览」页签，「查看」改名「文档」；总览有目标尺寸、按用途分组、阶段与待审统计', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.md')
  const names = (await detailTabs(page).getByRole('tab').allInnerTexts()).map(s => s.replace(/\s+\d+$/, '').trim())
  expect(names).toEqual(['总览', '文档', '关系', '版本', '校验'])
  const ov = pane(page)
  await expect(ov.locator('h1')).toHaveText('宝箱')
  await expect(ov.locator('.w2-ov-size')).toHaveText(/1\.26 × 0\.95 × 0\.87 m/)
  await expect(ov.locator('.w2-ov-stats')).toContainText(/\d+ 个资产/)
  await expect(ov.locator('.w2-ov-stats')).toContainText('待审')
  const groups = (await ov.locator('section h4').allInnerTexts()).map(s => s.replace(/\d+$/, '').trim())
  expect(groups).toEqual(expect.arrayContaining(['原画与四视图', '模型', '贴图']))
  await expect(ov.locator('section').filter({ hasText: '模型' })).toContainText('chest.glb')
  await expect(ov.locator('section').filter({ hasText: '贴图' })).toContainText('chest_basecolor.png')
  // 文档 shows the Markdown itself
  await tab(page, '文档').click()
  await expect(pane(page)).toContainText('新手村第一个可以打开的容器')
})

test('上游已更新横幅：说明上游版本变化；没有版本插件时「对比上游的变化」置灰并说明；确认已复核后横幅消失', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest_icon.png')
  const banner = page.locator('.w2-dtop [role="status"]').filter({ hasText: '上游已更新，待复核' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('chest.glb')
  await expect(banner).toContainText(/v1 → v2/)
  await expect(banner.getByRole('button', { name: '确认已复核' })).toBeEnabled()
  await expect(banner.getByRole('button', { name: '替换内容…' })).toBeEnabled()
  await expect(banner.getByRole('button', { name: '对比上游的变化' })).toBeDisabled()
  await expect(banner).toContainText('需要版本插件')
  // 替换内容… opens the same dialog as「替换为新版本…」
  await banner.getByRole('button', { name: '替换内容…' }).click()
  await expect(dialog(page)).toContainText('替换 chest_icon.png 为新版本')
  await dialog(page).getByRole('button', { name: '取消' }).click()
  await banner.getByRole('button', { name: '确认已复核' }).click()
  await expect(toast(page, '已复核，记下了 chest.glb v2')).toBeVisible()
  await expect(banner).toHaveCount(0)
})

test('被别人替换：「{谁} 刚把它替换成了 vN」，不自动换掉，点「显示新版本」才换', async ({ page }) => {
  const id = await openDetail(page, bb, 'ui/shop/badge_new.png')
  await page.waitForTimeout(500) // event stream connected
  const png = await (await fetch(bb.api.assets.fileUrl(bb.lib, await idOf(bb, 'ui/shop/tab_idle.png')))).arrayBuffer()
  await bb.agent('ui-bot').assets.replaceContent(bb.lib, id, new Blob([png], { type: 'image/png' }) as never, 'agent 替换')
  const banner = page.locator('.w2-dtop').getByText(/agent:ui-bot 刚把它替换成了 v\d+/)
  await expect(banner).toBeVisible()
  await expect(page.locator('.w2-dtop')).toContainText('你看到的还是替换之前的内容。')
  await page.locator('.w2-dtop').getByRole('button', { name: '显示新版本' }).click()
  await expect(banner).toHaveCount(0)
})

test.describe('特殊状态', () => {
  test('未知格式：没有插件能显示 .blend / .obj 文件，可下载原文件', async ({ page }) => {
    await openDetail(page, bb, 'props/chest/chest_high.blend')
    await expect(pane(page)).toContainText('没有插件能显示 .blend 文件')
    await expect(pane(page).getByRole('button', { name: '下载原文件' })).toBeVisible()
    await openDetail(page, bb, 'environments/rock_01.obj')
    await expect(pane(page)).toContainText('没有插件能显示 .obj 文件')
  })

  test('缺少插件：需要 Spine 插件，「去安装」到设置的插件页', async ({ page }) => {
    await openDetail(page, bb, 'characters/hero/hero_run.skel')
    await expect(pane(page)).toContainText(/需要 .*插件/)
    await expect(pane(page)).toContainText('community.spine')
    await expect(pane(page)).toContainText('^1.4.0')
    await pane(page).getByRole('button', { name: '去安装' }).click()
    await expect(page).toHaveURL(/\/settings\/plugins\?focus=community\.spine/)
    await expect(page.locator('body')).toContainText('资产库需要，本机未安装')
  })

  test('文件缺失：磁盘上找不到这个文件 + 重新定位文件…', async ({ page }) => {
    await openDetail(page, bb, 'characters/hero/hero_idle.fbx')
    await expect(pane(page)).toContainText('磁盘上找不到这个文件')
    await expect(pane(page)).toContainText('characters/hero/hero_idle.fbx')
    await pane(page).getByRole('button', { name: '重新定位文件…' }).click()
    await expect(dialog(page)).toContainText('重新定位 hero_idle.fbx')
    await dialog(page).getByRole('button', { name: '取消' }).click()
  })

  test('处理失败（浏览器解码不了）：intro_cutscene.mov 是 ProRes 4444，说明原因，可重试、下载原文件', async ({ page }) => {
    await openDetail(page, bb, 'environments/intro_cutscene.mov')
    await expect(pane(page)).toContainText('当前浏览器无法解码这个视频')
    await expect(pane(page)).toContainText('ProRes 4444')
    await expect(pane(page).getByRole('button', { name: '重试' })).toBeVisible()
    await expect(pane(page).getByRole('button', { name: '下载原文件' })).toBeVisible()
  })

  test('处理失败（处理任务失败）：显示失败原因与阶段，「重试」重新排队', async ({ page }) => {
    // a stage that failed for good (after three retries, ~80 s in the real pipeline) is mimicked on the response
    const id = await idOf(bb, 'audio/sfx/ui_click.wav')
    await page.route(new RegExp(`/api/v1/libraries/[^/]+/assets/${id}$`), async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      const r = await route.fetch()
      const j = await r.json()
      j.flags = [...j.flags, 'failed']
      j.stages = [...j.stages.filter((s: { stage: string }) => s.stage !== 'probe'), { stage: 'probe', status: 'failed', error: '读取超时' }]
      await route.fulfill({ response: r, json: j })
    })
    await openDetail(page, bb, 'audio/sfx/ui_click.wav')
    await expect(pane(page)).toContainText('读取超时')
    await expect(pane(page)).toContainText('提取信息')
    await expect(pane(page).getByRole('button', { name: '下载原文件' })).toBeVisible()
    await pane(page).getByRole('button', { name: '重试' }).click()
    await expect(toast(page, '已重新排队，处理完会自动更新')).toBeVisible()
  })

  test('查看器出错：world_map_16k.png（16384×9216）超出浏览器能显示的上限', async ({ page }) => {
    // prototype data.js world_map_16k viewerError, fixtures/README: decoded it is 604 MB, over what a browser
    // allocates for one image (plugins/image/src/web/lib/pixels.ts exceedsBrowserLimit)
    await openDetail(page, bb, 'environments/world_map_16k.png')
    await expect(pane(page)).toContainText('查看器出错了')
    await expect(pane(page)).toContainText('图片尺寸 16384×9216 超出浏览器能显示的上限')
    await expect(pane(page).getByRole('button', { name: '下载原文件' })).toBeVisible()
    await expect(pane(page).getByRole('button', { name: '重试' })).toBeVisible()
  })

  test('查看器出错（外壳兜底）：插件查看器抛错时显示错误、下载原文件与重试，页面不崩', async ({ page }) => {
    // a format plugin whose viewer throws: the shell's error boundary takes over (web-shell.md 状态呈现)
    await page.route(/\/api\/v1\/plugins\/bowerbird\.doc\/web(\?.*)?$/, route => route.fulfill({
      contentType: 'text/javascript',
      body: `const Boom = () => { throw new Error('渲染崩了') }
export default { formats: { doc: { Viewer: Boom } }, views: { doc: { Viewer: Boom } }, viewers: [{ formats: ['doc'], Viewer: Boom }] }`
    }))
    await openDetail(page, bb, 'docs/changelog.txt')
    const err = pane(page).getByRole('alert')
    await expect(err).toContainText('查看器出错了')
    await expect(err).toContainText('bowerbird.doc')
    await expect(err.getByRole('button', { name: '下载原文件' })).toBeVisible()
    await expect(err.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(page.locator('.w2-dbar')).toBeVisible()
  })
})

test('加载中显示骨架，出错时「打不开这个资产」+ 重试', async ({ page }) => {
  const id = await idOf(bb, 'props/chest/chest.glb')
  let mode: 'hold' | 'fail' | 'ok' = 'hold'
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  await page.route(new RegExp(`/api/v1/libraries/[^/]+/assets/${id}$`), async route => {
    if (mode === 'hold') await gate
    if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"服务出错了"}}' })
    return route.fallback()
  })
  await page.goto(libPath(bb, `/asset/${id}`))
  await expect(page.locator('.w2-detail .w2-skel, .w2-detail [data-skeleton], .w2-detail .animate-pulse').first()).toBeVisible()
  mode = 'fail'
  release()
  await expect(page.getByText('打不开这个资产')).toBeVisible({ timeout: 20_000 })
  mode = 'ok'
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest.glb')
})
