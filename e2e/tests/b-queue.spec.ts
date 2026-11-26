import { test, expect, type Page } from '@playwright/test'
import { startBB, idOf, libPath } from '../helpers/b-server'
import { MOD, loadingThenError, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/**
 * pages.md「校验队列」. Pending in the sample, oldest change first; held back: hero_idle.fbx (文件缺失), hero_run.skel
 * (缺少插件), rock_01.obj / shop.css / shop.js (无法显示), btn_buy (1).png (有错误级问题). Tests keep to their own
 * folder scope so they do not see each other's verdicts.
 */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const open = (page: Page, q = '') => page.goto(libPath(bb, `/review${q}`))
const head = (page: Page) => page.locator('.w2-rq__head b')
const counter = (page: Page) => page.locator('header').getByText(/^\d+ \/ \d+$/)
const side = (page: Page) => page.locator('.w2-rq__side')
const section = (page: Page, title: string) => side(page).locator('section').filter({ has: page.locator('h5', { hasText: title }) })

test('正常：查看器、阶段与位置、进度「1 / N」；上游；「另有 N 个暂时审不了」列出原因', async ({ page }) => {
  await open(page)
  await expect(page.locator('header')).toContainText('校验队列')
  await expect(page.locator('header').getByRole('button', { name: '全部待审' })).toBeVisible()
  await expect(head(page)).toHaveText('hero_walk.fbx')
  await expect(page.locator('.w2-rq__head')).toContainText('生产')
  await expect(page.locator('.w2-rq__path')).toHaveText('characters/hero')
  await expect(counter(page)).toHaveText(/^1 \/ \d+$/)
  await expect(page.locator('.w2-rq__view')).not.toBeEmpty()
  await expect(page.locator('.w2-rq__act').getByRole('button')).toHaveText(['打回…', /^跳过\s*→$/, /^通过\s*(⌘↵|Ctrl\+Enter)$/])
  await expect(section(page, '上游')).toBeVisible()
  const held = page.locator('.w2-rq__held')
  await expect(held).toHaveText('另有 6 个暂时审不了')
  await held.click()
  const menu = page.getByRole('menu').last()
  await expect(menu).toContainText('暂时审不了')
  const reason = (name: string) => menu.getByRole('menuitem').filter({ hasText: name })
  await expect(reason('hero_idle.fbx')).toContainText('文件缺失')
  await expect(reason('hero_run.skel')).toContainText('缺少插件')
  await expect(reason('rock_01.obj')).toContainText('无法显示')
  await expect(reason('shop.css')).toContainText('无法显示')
  await expect(reason('btn_buy (1).png')).toContainText('有错误级问题')
  await page.keyboard.press('Escape')
})

test('自动检查（有才显示）+ 生产记录 + 上游（设计对象、与上游对比）', async ({ page }) => {
  await open(page, `?folder=props&start=${await idOf(bb, 'props/chest/chest.glb')}`)
  await expect(head(page)).toHaveText('chest.glb')
  await expect(page.locator('.w2-rq__checks')).toContainText('尺寸与设计对象')
  await expect(page.locator('.w2-rq__checks')).toContainText('模型 1.26 × 0.95 × 0.87 m · 目标 1.26 × 0.95 × 0.87 m')
  const up = section(page, '上游')
  await expect(up).toContainText('chest_high.blend')
  await expect(up).toContainText('chest.md')
  await expect(up).toContainText('设计对象')
  await up.getByRole('button', { name: '与上游对比' }).click()
  await expect(page).toHaveURL(new RegExp(`/compare\\?a=${await idOf(bb, 'props/chest/chest.glb')}&b=${await idOf(bb, 'props/chest/chest_turnaround.png')}`))
  // an image without checks shows no check strip; its AI record is on the side
  await open(page, `?folder=props&start=${await idOf(bb, 'props/lantern/lantern_concept.png')}`)
  await expect(head(page)).toHaveText('lantern_concept.png')
  await expect(page.locator('.w2-rq__checks')).toHaveCount(0)
  await expect(section(page, '生产记录')).toContainText('AI 生成')
})

test('AI 标签采纳：单个采纳 / 去掉 / 全部采纳', async ({ page }) => {
  const id = await idOf(bb, 'props/lantern/lantern_concept.png')
  await open(page, `?folder=props&start=${id}`)
  const ai = section(page, 'AI 标签')
  await expect(ai).toContainText('黄铜')
  await ai.getByRole('button', { name: '采纳 黄铜' }).click()
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, id)).tags).toContain('黄铜')
  await ai.getByRole('button', { name: '去掉 卡通' }).click()
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, id)).autoTags).not.toContain('卡通')
  await expect(ai.getByRole('button', { name: '去掉 卡通' })).toHaveCount(0)
  await ai.getByRole('button', { name: '全部采纳' }).click()
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, id)).tags).toEqual(expect.arrayContaining(['黄铜', '磨砂玻璃', '暖光']))
})

test('打回填写意见：空意见拦下，↵ 发出并前进；「刚处理过一个」可撤销', async ({ page }) => {
  const id = await idOf(bb, 'props/lantern/lantern_concept.png')
  await open(page, `?folder=props&start=${id}`)
  await expect(head(page)).toHaveText('lantern_concept.png')
  await page.locator('.w2-rq__act').getByRole('button', { name: '打回…' }).click()
  const note = page.getByRole('textbox', { name: '打回意见' })
  await expect(note).toBeFocused()
  await expect(note).toHaveAttribute('placeholder', '哪里需要改（必填）')
  await note.press('Enter')
  await expect(note).toHaveAttribute('aria-invalid', 'true')
  await expect(head(page)).toHaveText('lantern_concept.png')
  // Esc cancels the comment, not the page
  await note.press('Escape')
  await expect(note).toHaveCount(0)
  await page.locator('.w2-rq__act').getByRole('button', { name: '打回…' }).click()
  await page.getByRole('textbox', { name: '打回意见' }).fill('玻璃再透一点')
  await page.getByRole('textbox', { name: '打回意见' }).press('Enter')
  await expect(head(page)).not.toHaveText('lantern_concept.png')
  const last = page.locator('.w2-rq__last')
  await expect(last).toContainText('lantern_concept.png 已打回')
  expect((await bb.api.assets.get(bb.lib, id)).review).toBe('rejected')
  expect((await bb.api.assets.get(bb.lib, id)).reviewVerdict?.note).toBe('玻璃再透一点')
  await last.getByRole('button', { name: /撤销/ }).click()
  await expect(head(page)).toHaveText('lantern_concept.png')
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, id)).review).toBe('pending')
})

test('通过（⌘↵）、跳过（→）、打回；审完显示统计与「再审跳过的 N 个」，审不了的列在下面', async ({ page }) => {
  await open(page, '?folder=characters')
  await expect(page.locator('header').getByRole('button', { name: 'characters' })).toBeVisible()
  await expect(counter(page)).toHaveText('1 / 4')
  await expect(head(page)).toHaveText('hero_walk.fbx')
  await page.locator('.w2-rq__main').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(`${MOD}+Enter`)
  await expect(head(page)).not.toHaveText('hero_walk.fbx')
  await expect(page.locator('.w2-rq__last')).toContainText('hero_walk.fbx 已通过')
  await expect(counter(page)).toHaveText('2 / 4')
  const skipped = await head(page).innerText()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.w2-rq__last')).toContainText(`${skipped} 已跳过`)
  await page.locator('.w2-rq__act').getByRole('button', { name: '打回…' }).click()
  await page.getByRole('textbox', { name: '打回意见' }).fill('护甲颜色不对')
  await page.locator('.w2-rq__act').getByRole('button', { name: /^打回/ }).last().click()
  await page.locator('.w2-rq__act').getByRole('button', { name: /^通过/ }).click()
  const end = page.locator('.w2-rq__end')
  await expect(end).toContainText('这一轮审完了')
  await expect(end).toContainText('通过 2 · 打回 1 · 跳过 1')
  const heldList = end.locator('.w2-rq__heldlist')
  await expect(heldList).toContainText('暂时审不了')
  await expect(heldList.locator('.w2-row').filter({ hasText: 'hero_idle.fbx' })).toContainText('文件缺失')
  await expect(heldList.locator('.w2-row').filter({ hasText: 'hero_run.skel' })).toContainText('缺少插件')
  await end.getByRole('button', { name: '再审跳过的 1 个' }).click()
  await expect(head(page)).toHaveText(skipped)
  await expect(counter(page)).toHaveText('1 / 1')
  await page.locator('.w2-rq__act').getByRole('button', { name: /^通过/ }).click()
  await expect(end).toContainText('通过 1 · 打回 0 · 跳过 0')
  await end.getByRole('button', { name: '回到浏览' }).click()
  await expect(page.locator('[data-asset-cell]').first()).toBeVisible()
})

test('别人刚审过的会跳过并提示（ADR-038）', async ({ page }) => {
  await open(page, '?folder=ui')
  const first = await head(page).innerText()
  // the next one gets a verdict from an agent meanwhile
  const items = (await bb.api.search(bb.lib, { filter: { review: ['pending'], folder: 'ui' }, limit: 100, sort: 'modified', order: 'asc' } as never)) as unknown as { items: Array<{ id: string; name: string; format: string; flags: string[]; issueLevel?: string | null }> }
  const queue = items.items.filter(a => a.format !== 'unknown' && !a.flags.length && a.issueLevel !== 'error')
  expect(queue[0]!.name).toBe(first)
  const next = queue[1]!
  await bb.agent('reviewer-bot').assets.review(bb.lib, next.id, { status: 'approved' })
  await page.locator('.w2-rq__act').getByRole('button', { name: '跳过' }).click()
  await expect(toast(page, `${next.name} 已经有人审过了，跳到下一个`)).toBeVisible()
  await expect(head(page)).toHaveText(queue[2]!.name)
})

test('范围切换：全部待审 / 文件夹 / 只审某种格式，范围写进地址', async ({ page }) => {
  await open(page)
  await page.locator('header').getByRole('button', { name: '全部待审' }).click()
  const menu = page.getByRole('menu').last()
  await expect(menu).toContainText('文件夹')
  await expect(menu).toContainText('格式')
  await menu.getByRole('menuitem', { name: '只审3D 模型' }).click()
  await expect(page).toHaveURL(/format=model/)
  await expect(page.locator('header').getByRole('button', { name: '只审3D 模型' })).toBeVisible()
  await expect(page.locator('.w2-rq__head')).toContainText(/\.(glb|fbx)/)
  await page.locator('header').getByRole('button', { name: '只审3D 模型' }).click()
  await page.getByRole('menu').last().getByRole('menuitem', { name: /^props/ }).click()
  await expect(page).toHaveURL(/folder=props/)
  await expect(page.locator('.w2-rq__path')).toContainText('props/')
})

test('没有待审：「没有待审的资产」', async ({ page }) => {
  await open(page, '?folder=audio')
  await expect(page.getByText('没有待审的资产')).toBeVisible()
  await expect(page.getByText('新登记的资产会出现在这里。')).toBeVisible()
  await expect(page.getByRole('button', { name: '回到浏览' })).toBeVisible()
})

test('加载中与出错（重试）', async ({ page }) => {
  await loadingThenError(page, /\/api\/v1\/libraries\/[^/]+\/search$/, () => open(page), head(page), 'POST')
})
