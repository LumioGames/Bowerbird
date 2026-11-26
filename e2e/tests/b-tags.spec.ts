import { test, expect, type Page } from '../helpers/test'
import { startBB, idOf, libPath } from '../helpers/b-server'
import { dialog, loadingThenError, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/**
 * pages.md「标签」: groups (drag in), colour, aliases, counts; rename (count shown, old name kept as an alias,
 * undoable); merge (not undoable); least used first; AI tags (adopt / adopt all / remove all); empty library.
 * The sample's tags.json: groups 对象 / 用途, 宝箱 (对象, alias chest), 原画 (用途, alias concept). Tests run in order.
 */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const open = async (page: Page) => { await page.goto(libPath(bb, '/tags')); await expect(page.locator('.w2-tg__r').first()).toBeVisible() }
const group = (page: Page, name: string) => page.locator('.w2-tg__grp').filter({ has: page.locator('h5', { hasText: new RegExp(`^${name}\\d+$`) }) })
const tagRow = (page: Page, name: string) => page.locator(`.w2-tg__r[data-tag="${name}"]`)
const more = async (page: Page, name: string, item: string) => {
  await tagRow(page, name).getByRole('button', { name: `${name} 的更多操作` }).click()
  await page.getByRole('menu').last().getByRole('menuitem', { name: item }).click()
}

test('分组、颜色、别名、数量；用得少的标黄；按名称 / 用得最少的在前', async ({ page }) => {
  await open(page)
  await expect(page.locator('header')).toContainText('标签')
  await expect(page.locator('header')).toContainText(/\d+ 个/)
  await expect(page.locator('.w2-tg__grp h5')).toHaveText([/^对象\d+$/, /^用途\d+$/, /^未分组\d+$/])
  await expect(group(page, '对象').locator('.w2-tg__r[data-tag="宝箱"]')).toBeVisible()
  await expect(group(page, '用途').locator('.w2-tg__r[data-tag="原画"]')).toBeVisible()
  await expect(group(page, '未分组').locator('.w2-tg__r[data-tag="商店"]')).toBeVisible()
  // colour dot, aliases, count
  await expect(tagRow(page, '宝箱').locator('.w2-tg__c')).toHaveAttribute('style', /background/)
  await expect(tagRow(page, '商店').locator('.w2-tg__c')).not.toHaveAttribute('style', /background/)
  await expect(tagRow(page, '宝箱')).toContainText('别名 chest')
  await expect(tagRow(page, '宝箱')).toContainText('12')
  await expect(tagRow(page, '宝箱').locator('.w2-tg__few')).toHaveCount(0)
  await expect(tagRow(page, '武器').locator('.w2-tg__few')).toHaveText('1')
  // sort: least used first
  const seg = page.getByRole('radiogroup', { name: '排序' })
  await expect(seg.getByRole('radio')).toHaveText(['按名称', '用得最少的在前'])
  await seg.getByRole('radio', { name: '用得最少的在前' }).click()
  const counts = (await group(page, '未分组').locator('.w2-tg__r').allInnerTexts()).map(s => Number(s.match(/(\d+)\s*$/)![1]))
  expect(counts).toEqual(counts.slice().sort((a, b) => a - b))
  expect(counts[0]).toBe(1)
})

test('改名：显示影响数量；已有的名字拦下；旧名字留作别名；可撤销', async ({ page }) => {
  await open(page)
  await more(page, '宝箱', '改名…')
  const d = dialog(page)
  await expect(d).toContainText('把「宝箱」改名')
  await expect(d).toContainText('会更新用到它的 12 个资产。')
  const input = d.getByRole('textbox', { name: '新名称' })
  await expect(input).toHaveValue('宝箱')
  await input.fill('道具')
  await d.getByRole('button', { name: '改名' }).click()
  await expect(d).toContainText('已经有这个标签，要合并请用「合并到…」')
  await input.fill('箱子')
  await d.getByRole('button', { name: '改名' }).click()
  const t = toast(page, '已改名，12 个资产已更新；旧名字留作别名')
  await expect(t).toBeVisible()
  await expect(tagRow(page, '箱子')).toContainText(/别名 .*宝箱/)
  await expect(tagRow(page, '宝箱')).toHaveCount(0)
  expect((await bb.api.assets.get(bb.lib, await idOf(bb, 'props/chest/chest.glb'))).tags).toContain('箱子')
  await t.getByRole('button', { name: '撤销' }).click()
  await expect(tagRow(page, '宝箱')).toBeVisible()
  await expect(tagRow(page, '箱子')).toHaveCount(0)
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, await idOf(bb, 'props/chest/chest.glb'))).tags).toContain('宝箱')
})

test('合并：确认说明不能撤销；合并后旧名成为别名，提示没有撤销', async ({ page }) => {
  await open(page)
  await tagRow(page, '地图').getByRole('button', { name: '地图 的更多操作' }).click()
  await page.getByRole('menu').last().getByRole('menuitem', { name: '合并到…' }).hover()
  const sub = page.getByRole('menu').last()
  await expect(sub).toContainText('把「地图」并入')
  await sub.getByRole('menuitem', { name: /^场景/ }).click()
  const d = dialog(page)
  await expect(d).toHaveAttribute('role', 'alertdialog')
  await expect(d).toContainText('把「地图」并入「场景」？')
  await expect(d).toContainText('1 个资产会改用「场景」，「地图」会成为它的别名。合并不能撤销。')
  await d.getByRole('button', { name: '合并' }).click()
  const t = toast(page, '已合并，1 个资产已更新')
  await expect(t).toBeVisible()
  await expect(t.getByRole('button', { name: '撤销' })).toHaveCount(0)
  await expect(tagRow(page, '地图')).toHaveCount(0)
  await expect(tagRow(page, '场景')).toContainText('别名 地图')
  // world_map_16k.png had both: 场景 now counts the union
  const after = (await bb.api.tags.list(bb.lib)).tags.find(x => x.name === '场景')!
  await expect(tagRow(page, '场景')).toContainText(String(after.count))
  expect(after.aliases).toContain('地图')
})

test('分组：拖入另一组（可撤销）；菜单「移到分组」；新建分组', async ({ page }) => {
  await open(page)
  await tagRow(page, '动画').dragTo(group(page, '用途'))
  const t = toast(page, '「动画」移到了用途')
  await expect(t).toBeVisible()
  await expect(group(page, '用途').locator('.w2-tg__r[data-tag="动画"]')).toBeVisible()
  await t.getByRole('button', { name: '撤销' }).click()
  await expect(group(page, '未分组').locator('.w2-tg__r[data-tag="动画"]')).toBeVisible()
  // the same through the menu
  await tagRow(page, '岩石').getByRole('button', { name: '岩石 的更多操作' }).click()
  await page.getByRole('menu').last().getByRole('menuitem', { name: '移到分组' }).hover()
  await page.getByRole('menu').last().getByRole('menuitem', { name: '对象' }).click()
  await expect(toast(page, '「岩石」移到了对象')).toBeVisible()
  await expect(group(page, '对象').locator('.w2-tg__r[data-tag="岩石"]')).toBeVisible()
  // 新建分组
  await page.locator('header').getByRole('button', { name: '新建分组' }).click()
  const d = dialog(page)
  await expect(d.getByRole('textbox', { name: '分组名称' })).toHaveValue('新分组 3')
  await d.getByRole('textbox', { name: '分组名称' }).fill('对象')
  await d.getByRole('button', { name: '新建' }).click()
  await expect(d).toContainText('已经有这个分组')
  await d.getByRole('textbox', { name: '分组名称' }).fill('场景元素')
  await d.getByRole('button', { name: '新建' }).click()
  await expect(page.locator('.w2-tg__grp h5')).toHaveText([/^对象/, /^用途/, /^场景元素0$/, /^未分组/])
})

test('AI 标签区：采纳一个；全部移除先确认（取消）；全部采纳', async ({ page }) => {
  await open(page)
  const ai = page.locator('.w2-tg__ai')
  await expect(ai.locator('h5')).toContainText('AI 打的标签，还没人采纳')
  const n = await ai.locator('.w2-tags > *').count()
  expect(n).toBeGreaterThan(1)
  await expect(ai.locator('.w2-tags > *').filter({ hasText: '黄铜' })).toContainText('2')
  await ai.getByRole('button', { name: '采纳 黄铜' }).click()
  await expect(toast(page, '「黄铜」成为正式标签，2 个资产已更新')).toBeVisible()
  await expect(tagRow(page, '黄铜')).toBeVisible()
  await expect(ai.locator('.w2-tags > *')).toHaveCount(n - 1)
  await ai.getByRole('button', { name: '全部移除…' }).click()
  const d = dialog(page)
  await expect(d).toContainText(`移除全部 ${n - 1} 个 AI 标签？`)
  await expect(d).toContainText('只移除还没采纳的 AI 标签，已经采纳的不受影响。AI 以后可能再次打出它们。')
  await d.getByRole('button', { name: '取消' }).click()
  await ai.getByRole('button', { name: '全部采纳' }).click()
  await expect(toast(page, `已采纳 ${n - 1} 个 AI 标签`)).toBeVisible()
  await expect(ai).toHaveCount(0)
})

test('加载中与出错（重试）', async ({ page }) => {
  await loadingThenError(page, /\/api\/v1\/libraries\/[^/]+\/tags$/, () => page.goto(libPath(bb, '/tags')), page.locator('.w2-tg__r').first())
})

test('空资产库：「还没有标签」', async ({ page }) => {
  const empty = await startBB({ library: 'empty' })
  try {
    await page.goto(`${empty.url}/libraries/${encodeURIComponent(empty.lib)}/tags`)
    await expect(page.getByText('还没有标签')).toBeVisible()
    await expect(page.getByText('给资产打标签后，会在这里统一管理。')).toBeVisible()
  } finally { await empty.stop() }
})
