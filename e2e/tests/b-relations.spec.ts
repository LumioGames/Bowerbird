import { test, expect, type Page } from '../helpers/test'
import { startBB, idOf, openDetail, libPath } from '../helpers/b-server'
import { dialog, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/** pages.md「关系页签」(graph.js): every state. */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const graph = (page: Page) => page.locator('.w2-rg')
const node = (page: Page, name: string) => page.locator('.w2-gn[data-asset]').filter({ has: page.locator('.w2-gn__name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first()
const panel = (page: Page) => page.getByRole('complementary', { name: '关系详情' })
/** Drag the empty canvas to the right (pan). */
async function panRight(page: Page, dx: number) {
  const box = (await graph(page).boundingBox())!
  const y = box.y + box.height - 90
  await page.mouse.move(box.x + 40, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 40 + dx, y, { steps: 6 })
  await page.mouse.up()
}
async function clickEdge(page: Page, key: string) {
  await page.locator(`g[data-edge="${key}"] .w2-ge__hit`).dispatchEvent('click')
}

test('正常：从左到右的生产链、上游追到顶、设计对象在上方、引用在左侧；图例；没有版本插件时没有版本时间轴', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.glb', 'rel')
  for (const n of ['chest_concept.png', 'chest_turnaround.png', 'chest_high.blend', 'chest_icon.png', 'chest_basecolor.png', 'chest_normal.png', 'chest_orm.png', 'chest.md']) await expect(node(page, n)).toBeVisible()
  await expect(page.locator('.w2-gn--center')).toContainText('chest.glb')
  // left to right: concept → turnaround → blend → chest.glb → icon
  const xs = await Promise.all(['chest_concept.png', 'chest_turnaround.png', 'chest_high.blend', 'chest_icon.png'].map(async n => (await node(page, n).boundingBox())!.x))
  const cx = (await page.locator('.w2-gn--center').boundingBox())!.x
  expect(xs[0]! < xs[1]! && xs[1]! < xs[2]! && xs[2]! < cx && cx < xs[3]!).toBe(true)
  // the design object sits above the centre
  expect((await node(page, 'chest.md').boundingBox())!.y).toBeLessThan((await page.locator('.w2-gn--center').boundingBox())!.y)
  // the origin record of the chain's top (AI 生成) — it arrives after the lineage, and the graph is fitted again so
  // the whole chain is in view (graph.js fit, as the prototype's 60 %)
  await expect(page.locator('.w2-gn--rec')).toContainText('AI 生成')
  await expect.poll(async () => {
    const g = (await graph(page).boundingBox())!, r = (await page.locator('.w2-gn--rec').boundingBox())!
    return r.x >= g.x && r.x + r.width <= g.x + g.width
  }).toBe(true)
  // under a used texture: what it is for (graph.js shows the note); the centre shows version · note · day and time
  await expect(node(page, 'chest_basecolor.png').locator('.w2-gn__sub')).toHaveText('基础色')
  await expect(page.locator('.w2-gn--center .w2-gn__sub')).toHaveText(/^v2 · 修正包边比例 · \d+ 日 \d\d:\d\d$/)
  await expect(graph(page).locator('.w2-rg__legend')).toHaveText(/来源\s*引用\s*归属\s*上游已更新\s*断链/)
  // stale upstream mark on chest.glb → chest_icon.png
  await expect(graph(page).getByRole('button', { name: '上游已更新' })).toBeVisible()
  await expect(graph(page).getByRole('group', { name: '版本' })).toHaveCount(0)
  await expect(graph(page).getByRole('button', { name: '建立关系…' })).toBeVisible()
})

test('节点分组：同一条生产记录的下游多于 4 个折叠成一组，可展开、收起', async ({ page }) => {
  await openDetail(page, bb, 'ui/shop/shop_mockup.png', 'rel')
  const group = page.locator('.w2-gn--group').filter({ hasText: /切图 · \d+/ })
  await expect(group).toBeVisible()
  await expect(group).toContainText('agent:slicer')
  await group.click()
  const frame = page.locator('.w2-gn--frame').filter({ hasText: /切图 · \d+/ })
  await expect(frame).toBeVisible()
  await expect(frame.locator('.w2-gm')).toHaveCount(Number((await frame.locator('.w2-gn__fhead b').innerText()).match(/\d+/)![0]))
  await expect(frame).toContainText('btn_buy.png')
  await frame.getByRole('button', { name: '收起' }).click()
  await expect(group).toBeVisible()
})

test('节点分组：设计对象的归属资产多于 6 个折叠成「归属于它 · N」', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.md', 'rel')
  const group = page.locator('.w2-gn--group').filter({ hasText: /归属于它 · \d+/ })
  await expect(group).toBeVisible()
  await expect(group).toContainText('设计对象')
  await group.click()
  await expect(page.locator('.w2-gn--frame')).toContainText('chest.glb')
})

test('生产记录面板：方式、工具、插件、执行者、参数、提示词、输入与角色', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest_turnaround.png', 'rel')
  // the source edge turnaround → concept carries the record (AI 生成, input role 参考图)
  const turn = await idOf(bb, 'props/chest/chest_turnaround.png'), concept = await idOf(bb, 'props/chest/chest_concept.png')
  await clickEdge(page, `source|${turn}|${concept}|`)
  const p = panel(page)
  await expect(p).toContainText('来源')
  await expect(p).toContainText('chest_turnaround.png 由 chest_concept.png 产出')
  await expect(p).toContainText('当时版本')
  await expect(p).toContainText('生产记录')
  await expect(p).toContainText('AI 生成')
  await expect(p).toContainText('turnaround-gen')
  await expect(p).toContainText('agent:concept-artist')
  await expect(p).toContainText('提示词')
  await expect(p).toContainText('参考图')
  // the origin record node at the top of the chain: fit() keeps the centre at 62 % (graph.js), so pan right first
  await p.getByRole('button', { name: '关闭' }).click()
  await panRight(page, 400)
  await page.locator('.w2-gn--rec').click()
  await expect(panel(page)).toContainText('生产记录')
  await expect(panel(page)).toContainText('concept-gen')
})

test('关系面板：位置名「基础色 · chest_basecolor.png」、更换对方…、删除这条关系（可撤销）', async ({ page }) => {
  const chest = await openDetail(page, bb, 'props/chest/chest.glb', 'rel')
  const base = await idOf(bb, 'props/chest/chest_basecolor.png')
  await clickEdge(page, `uses|${chest}|${base}|chest_basecolor.png`)
  const p = panel(page)
  await expect(p).toContainText('引用 · 基础色')
  await expect(p).toContainText('chest.glb 引用 chest_basecolor.png')
  await expect(p).toContainText(/位置\s*基础色 · chest_basecolor\.png/)
  // 更换对方…: picker titled with the slot, then the confirmation in copy.md's words
  await p.getByRole('button', { name: '更换对方…' }).click()
  const pick = dialog(page)
  await expect(pick).toContainText('更换 基础色 的对方')
  await pick.getByRole('radio').filter({ hasText: 'chest_basecolor_dark.png' }).click()
  await pick.getByRole('button', { name: '更换' }).click()
  const conf = dialog(page)
  await expect(conf).toContainText('更换 基础色 的对方')
  await expect(conf).toContainText('位置 chest_basecolor.png · 现在是 chest_basecolor.png → chest_basecolor_dark.png')
  await conf.getByRole('button', { name: '更换' }).click()
  const t = toast(page, '基础色 换成了 chest_basecolor_dark.png')
  await expect(t).toBeVisible()
  await expect(node(page, 'chest_basecolor_dark.png')).toBeVisible()
  await t.getByRole('button', { name: '撤销' }).click()
  await expect(node(page, 'chest_basecolor.png')).toBeVisible()
  await expect(node(page, 'chest_basecolor_dark.png')).toHaveCount(0)
  // 删除这条关系 + 撤销
  await clickEdge(page, `uses|${chest}|${base}|chest_basecolor.png`)
  await panel(page).getByRole('button', { name: '删除这条关系' }).click()
  const d = toast(page, '已删除这条关系')
  await expect(d).toBeVisible()
  await expect(node(page, 'chest_basecolor.png')).toHaveCount(0)
  await d.getByRole('button', { name: '撤销' }).click()
  await expect(node(page, 'chest_basecolor.png')).toBeVisible()
})

test('从完整性页「重新指定…」进来时直接打开那条关系', async ({ page }) => {
  await page.goto(libPath(bb, '/issues'))
  const row = page.locator('.w2-it__row').filter({ hasText: 'potion.glb' }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '重新指定…' }).click()
  await expect(page).toHaveURL(/tab=rel/)
  await expect(panel(page).getByRole('alert')).toContainText('指向的文件找不到了')
})

test('断链：「指向的文件找不到了」+ 更换对方… / 从回收站恢复 / 删除这条关系；从回收站恢复后关系自己接上', async ({ page }) => {
  const potion = await openDetail(page, bb, 'props/potion/potion.glb', 'rel')
  const missing = page.locator('.w2-gn--missing')
  await expect(missing).toContainText('potion_basecolor.png')
  await expect(missing).toContainText('在回收站里')
  await graph(page).getByRole('button', { name: '断链' }).click()
  const p = panel(page)
  const banner = p.getByRole('alert')
  await expect(banner).toContainText('指向的文件找不到了')
  await expect(banner).toContainText('potion_basecolor.png 在回收站里')
  await expect(banner.getByRole('button')).toHaveText(['更换对方…', '从回收站恢复', '删除这条关系'])
  // 更换对方… opens the picker (cancel)
  await banner.getByRole('button', { name: '更换对方…' }).click()
  await expect(dialog(page)).toContainText(/更换 .* 的对方/)
  await dialog(page).getByRole('button', { name: '取消' }).click()
  // 从回收站恢复: the relation connects again by itself
  await banner.getByRole('button', { name: '从回收站恢复' }).click()
  await expect(toast(page, 'potion_basecolor.png 已恢复，关系重新接上了')).toBeVisible()
  await expect(missing).toHaveCount(0)
  await expect(node(page, 'potion_basecolor.png')).toBeVisible()
  expect((await bb.api.assets.get(bb.lib, potion)).relations.outgoing.find(r => r.type === 'uses' && r.slot === 'potion_basecolor.png')?.broken).toBeFalsy()
})

test('断链：删除这条关系', async ({ page }) => {
  // a second broken link: potion_normal.png goes to the trash
  const normal = await idOf(bb, 'props/potion/potion_normal.png')
  await bb.api.assets.remove(bb.lib, normal, true)
  const potion = await openDetail(page, bb, 'props/potion/potion.glb', 'rel')
  const missing = page.locator('.w2-gn--missing')
  await expect(missing).toContainText('potion_normal.png')
  await graph(page).getByRole('button', { name: '断链' }).click()
  await panel(page).getByRole('alert').getByRole('button', { name: '删除这条关系' }).click()
  await expect(toast(page, '已删除这条关系')).toBeVisible()
  await expect(missing).toHaveCount(0)
  expect((await bb.api.assets.get(bb.lib, potion)).relations.outgoing.some(r => r.to === normal)).toBe(false)
})

test('断链：删除后「撤销」把这条关系加回来', async ({ page }) => {
  // the kernel accepts a relation to an asset in the trash (it stays broken until the asset is restored)
  const orm = await idOf(bb, 'props/chest/chest_orm.png')
  const { trashId } = await bb.api.assets.remove(bb.lib, orm, true)
  try {
    const chest = await openDetail(page, bb, 'props/chest/chest.glb', 'rel')
    const missing = page.locator('.w2-gn--missing').filter({ hasText: 'chest_orm.png' })
    await expect(missing).toBeVisible()
    await graph(page).getByRole('button', { name: '断链' }).click()
    await panel(page).getByRole('alert').getByRole('button', { name: '删除这条关系' }).click()
    const d = toast(page, '已删除这条关系')
    await d.getByRole('button', { name: '撤销' }).click()
    await expect(missing).toBeVisible()
    expect((await bb.api.assets.get(bb.lib, chest)).relations.outgoing.filter(r => r.to === orm)).toEqual([expect.objectContaining({ broken: true, targetInTrash: true })])
  } finally {
    // later cases use chest_orm.png as a live node
    await bb.api.trash.restore(bb.lib, trashId)
  }
})

test('拖出连线建立关系；会形成循环的来源被阻止', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.glb', 'rel')
  const drag = async (from: string, to: string) => {
    const port = node(page, from).locator('.w2-gn__port')
    await node(page, from).hover()
    const a = (await port.boundingBox())!, b = (await node(page, to).locator('.w2-gn__thumb').boundingBox())!
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  // chest_concept.png already is the top of chest.glb's chain: chest_concept 由 chest.glb 产出 would be a cycle
  await drag('chest_concept.png', 'chest_icon.png')
  let menu = page.getByRole('menu').last()
  await expect(menu.getByRole('menuitem')).toHaveCount(4)
  const cyc = menu.getByRole('menuitem', { name: /chest_concept\.png 由 chest_icon\.png 产出/ })
  await expect(cyc).toContainText('会形成循环')
  await expect(cyc).toHaveAttribute('aria-disabled', 'true')
  await expect(menu.getByRole('menuitem', { name: '对调方向' })).toBeVisible()
  // 引用 is allowed
  await menu.getByRole('menuitem', { name: /chest_concept\.png 引用 chest_icon\.png/ }).click()
  await expect(toast(page, '已建立：chest_concept.png 引用 chest_icon.png')).toBeVisible()
  // 对调方向 flips the sentence
  await drag('chest_normal.png', 'chest_orm.png')
  menu = page.getByRole('menu').last()
  await menu.getByRole('menuitem', { name: '对调方向' }).click()
  await expect(page.getByRole('menu').last().getByRole('menuitem').first()).toContainText('chest_orm.png 由 chest_normal.png 产出')
  await page.keyboard.press('Escape')
})

test('选两个节点对比：选择条「已选 2 个」→「对比」进入对比页', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.glb', 'rel')
  await node(page, 'chest_concept.png').hover()
  await node(page, 'chest_concept.png').getByRole('button', { name: '选择' }).click()
  const bar = page.locator('.w2-rg__selbar')
  await expect(bar).toContainText('已选 1 个')
  await expect(bar.getByRole('button', { name: '对比' })).toBeDisabled()
  await node(page, 'chest_turnaround.png').click({ modifiers: ['Shift'] })
  await expect(bar).toContainText('已选 2 个')
  await bar.getByRole('button', { name: '对比' }).click()
  await expect(page).toHaveURL(new RegExp(`/compare\\?a=${await idOf(bb, 'props/chest/chest_concept.png')}&b=${await idOf(bb, 'props/chest/chest_turnaround.png')}`))
})

test('空格快速预览停在指针下的节点，方向键按图从左到右走，Esc 关闭', async ({ page }) => {
  await openDetail(page, bb, 'props/chest/chest.glb', 'rel')
  await node(page, 'chest_turnaround.png').hover()
  await page.keyboard.press('Space')
  const ql = page.getByRole('dialog', { name: '快速预览' })
  await expect(ql).toBeVisible()
  await expect(ql).toContainText('chest_turnaround.png')
  await page.keyboard.press('ArrowRight')
  await expect(ql).toContainText('chest_high.blend')
  await expect(node(page, 'chest_high.blend')).toHaveClass(/w2-gn--kb/)
  await page.keyboard.press('ArrowLeft')
  await expect(ql).toContainText('chest_turnaround.png')
  await page.keyboard.press('Escape')
  await expect(ql).toHaveCount(0)
})
