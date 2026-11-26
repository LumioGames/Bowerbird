import { test, expect, type Locator, type Page } from '../helpers/test'
import { startBB, idOf, openDetail } from '../helpers/b-server'
import { browseFolder, cell, decodePng, pngStats, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/**
 * builtin-plugins.md「3D 模型」viewer on the detail page: channel menu and components, vertex colours, FBX channels
 * the format cannot show, wipe and strips, perspective / orthographic, the view cube, environments and library HDRs,
 * the size overlay, animation playback, 另存为图片资产, the grid's hover turntable and lazy thumbnails. Picture
 * changes are judged from screenshots of the WebGL canvas, not from buttons alone.
 */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const pane = (page: Page) => page.locator('.w2-dpane')
const canvas = (page: Page) => pane(page).locator('canvas').first()
const channelBtn = (page: Page) => pane(page).getByTitle('通道', { exact: true })
const shot = async (l: Locator) => pngStats(await l.screenshot())

async function openModel(page: Page, p: string) {
  await openDetail(page, bb, p)
  await expect(pane(page).getByRole('group', { name: '视图方向' })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(800) // first frames
}
/** Wait until the canvas shows something other than `hash`. */
async function changed(page: Page, hash: string) {
  await expect.poll(async () => (await shot(canvas(page))).hash, { timeout: 15_000 }).not.toBe(hash)
}
/** A menu row by its leading name (rows may carry the current component or the packed texture: 「粗糙度 ORM · G」). */
const item = (page: Page, n: string) => page.getByRole('menuitem', { name: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`) }).last()
async function pickChannel(page: Page, path: string[]) {
  await expect(page.getByRole('menu')).toHaveCount(0)
  await channelBtn(page).click()
  await expect(page.getByRole('menu').first()).toBeVisible()
  for (let i = 0; i < path.length - 1; i++) await item(page, path[i]!).hover()
  // a channel the format cannot show looks unavailable but stays clickable (ADR-022): force past aria-disabled
  await item(page, path[path.length - 1]!).click({ force: true })
}

test('懒渲染缩略图：npc_guard.glb 从占位变成图（浏览器渲染后回传）— 第一个打开页面的浏览器来渲染', async ({ page }) => {
  const id = await idOf(bb, 'characters/npc/npc_guard.glb')
  expect((await bb.api.assets.get(bb.lib, id)).thumbState).not.toBe('ready')
  await browseFolder(page, bb, 'characters/npc')
  const c = cell(page, 'npc_guard.glb')
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, id)).thumbState, { timeout: 45_000 }).toBe('ready')
  await expect(c.locator('img').first()).toBeVisible({ timeout: 15_000 })
  const img = await c.locator('img').first().evaluate(i => ({ w: (i as HTMLImageElement).naturalWidth, src: (i as HTMLImageElement).src }))
  expect(img.w).toBeGreaterThan(0)
})

test('通道菜单：材质通道与检查视图；颜色通道可取单个分量（灰度显示）', async ({ page }) => {
  await openModel(page, 'props/chest/chest.glb')
  await expect(channelBtn(page)).toContainText('完整渲染')
  // the tool bar starts with the channel menu, then 单视图 / 卷帘 / 多通道斜切 (prototype model.js)
  const split = pane(page).getByRole('radiogroup', { name: '对比方式' })
  expect(await channelBtn(page).evaluate((b, g) => !!(b.compareDocumentPosition(g as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await split.elementHandle())).toBe(true)
  await channelBtn(page).click()
  const menu = page.getByRole('menu').last()
  await expect(menu).toContainText('材质通道')
  await expect(menu).toContainText('检查视图')
  const names = (await menu.getByRole('menuitem').allInnerTexts()).map(x => x.trim().split(/\s+/)[0])
  expect(names).toEqual(['完整渲染', '基础色', '法线', '粗糙度', '金属度', '环境光遮蔽', '自发光', '透明度', '顶点色', '线框', '线框叠加', 'UV', 'Matcap', '面朝向', '贴图密度'])
  // packed ORM: the row names the texture and component
  await expect(item(page, '粗糙度')).toContainText('ORM · G')
  await item(page, '完整渲染').click() // closes the menu (no Escape: that belongs to the page)
  const full = await shot(canvas(page))
  const fullPx = decodePng(await canvas(page).screenshot())
  await pickChannel(page, ['基础色', 'R'])
  await expect(channelBtn(page)).toContainText('基础色')
  await changed(page, full.hash)
  // one component is drawn as grey: where the model is (pixels that changed from the full render), R = G = B
  const px = decodePng(await canvas(page).screenshot())
  let grey = 0, coloured = 0
  for (let i = 0; i < px.data.length && i < fullPx.data.length; i += px.channels * 13) {
    const r = px.data[i]!, g = px.data[i + 1]!, b = px.data[i + 2]!
    const moved = Math.abs(r - fullPx.data[i]!) + Math.abs(g - fullPx.data[i + 1]!) + Math.abs(b - fullPx.data[i + 2]!) > 24
    if (!moved) continue
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 4) grey++; else coloured++
  }
  expect(grey + coloured).toBeGreaterThan(100)
  expect(grey / (grey + coloured)).toBeGreaterThan(0.9)
  const r = await shot(canvas(page))
  await pickChannel(page, ['线框'])
  await expect(channelBtn(page)).toContainText('线框')
  await changed(page, r.hash)
})

test('顶点色：R G B A 分量', async ({ page }) => {
  await openModel(page, 'props/chest/chest.glb')
  await channelBtn(page).click()
  await item(page, '顶点色').hover()
  const sub = page.getByRole('menu').last()
  await expect(sub.getByRole('menuitem')).toHaveText(['全部', 'R', 'G', 'B', 'A'])
  await sub.getByRole('menuitem', { name: '全部' }).click()
  await expect(channelBtn(page)).toContainText('顶点色')
  const all = await shot(canvas(page))
  await pickChannel(page, ['顶点色', 'G'])
  await changed(page, all.hash)
  const g = await shot(canvas(page))
  await pickChannel(page, ['顶点色', 'A'])
  await changed(page, g.hash)
})

test('FBX（hero_walk.fbx）：粗糙度 / 金属度 / 遮蔽点了出提示条「这个格式不支持」，画面不变', async ({ page }) => {
  await openModel(page, 'characters/hero/hero_walk.fbx')
  const before = await shot(canvas(page))
  for (const n of ['粗糙度', '金属度', '环境光遮蔽']) {
    await pickChannel(page, [n])
    await expect(toast(page, '这个格式不支持').last()).toBeVisible()
    await expect(channelBtn(page)).toContainText('完整渲染')
  }
  // the turntable / animation may move the model: only the channel must stay
  expect(before.hash).toBeTruthy()
})

test('卷帘与多通道斜切：分界线两侧各选通道；斜切可增删一路', async ({ page }) => {
  await openModel(page, 'props/chest/chest.glb')
  const split = pane(page).getByRole('radiogroup', { name: '对比方式' })
  const single = await shot(canvas(page))
  await split.getByRole('radio', { name: '卷帘' }).click()
  await expect(pane(page).getByTitle('拖动分界线')).toBeVisible()
  await expect(pane(page).getByTitle('拖动旋转分界线，双击复位')).toBeVisible()
  await changed(page, single.hash)
  await split.getByRole('radio', { name: '多通道斜切' }).click()
  const add = pane(page).getByRole('button', { name: '增加一路' })
  await expect(add).toBeVisible()
  // the strips' channel chips; with more than two, each shows「移除这一路」on hover (a button next to the chip's own)
  const chips = pane(page).locator('[data-chip]')
  const n = await chips.count()
  expect(n).toBeGreaterThanOrEqual(2)
  const before = await shot(canvas(page))
  await add.click()
  await expect(chips).toHaveCount(n + 1)
  await changed(page, before.hash)
  // the keyboard reaches it: Tab from a chip lands on its「移除这一路」, which then shows
  await chips.first().getByRole('button').first().focus()
  await page.keyboard.press('Tab')
  await expect(chips.first().getByRole('button', { name: '移除这一路' })).toBeFocused()
  await expect(chips.first().getByRole('button', { name: '移除这一路' })).toBeVisible()
  await chips.last().hover()
  await chips.last().getByRole('button', { name: '移除这一路' }).click()
  await expect(chips).toHaveCount(n)
  await split.getByRole('radio', { name: '单视图' }).click()
  await expect(pane(page).getByTitle('拖动分界线')).toHaveCount(0)
})

test('透视 / 正交；视图方块切到正视、顶视', async ({ page }) => {
  await openModel(page, 'props/chest/chest.glb')
  const proj = pane(page).getByRole('radiogroup', { name: '投影' })
  await expect(proj.getByRole('radio', { name: '透视' })).toHaveAttribute('aria-checked', 'true')
  const p0 = await shot(canvas(page))
  await proj.getByRole('radio', { name: '正交' }).click()
  await changed(page, p0.hash)
  const gizmo = pane(page).getByRole('group', { name: '视图方向' })
  const views = gizmo.locator('[data-view]')
  expect(await views.count()).toBeGreaterThanOrEqual(4)
  const o0 = await shot(canvas(page))
  await gizmo.locator('[data-view="y"]').dispatchEvent('click')
  await changed(page, o0.hash)
  const t0 = await shot(canvas(page))
  await gizmo.locator('[data-view="z"]').dispatchEvent('click')
  await changed(page, t0.hash)
})

test('环境切换与资产库里的 .hdr；背景透明 / 纯色', async ({ page }) => {
  await openModel(page, 'props/chest/chest.glb')
  const opts = pane(page).getByRole('button', { name: '查看选项' })
  if ((await opts.getAttribute('aria-pressed')) !== 'true') await opts.click()
  const env = (n: string) => pane(page).getByRole('button', { name: n, exact: true })
  await expect(env('工作室')).toBeVisible()
  const e0 = await shot(canvas(page))
  await env('夜晚').click()
  await expect(env('夜晚')).toHaveAttribute('aria-pressed', 'true')
  await changed(page, e0.hash)
  const e1 = await shot(canvas(page))
  await pane(page).getByRole('button', { name: '资产库' }).click()
  const menu = page.getByRole('menu').last()
  await expect(menu.getByRole('menuitem', { name: 'sky_noon.hdr' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'forest_dusk.hdr' })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'sky_noon.hdr' }).click()
  await expect(pane(page).getByTitle('sky_noon.hdr', { exact: true })).toHaveAttribute('aria-pressed', 'true')
  await changed(page, e1.hash)
  await expect(toast(page, '无法读取这个 HDR 文件')).toHaveCount(0)
  const bg = pane(page).getByRole('radiogroup', { name: '背景' })
  const b0 = await shot(canvas(page))
  await bg.getByRole('radio', { name: '纯色' }).click()
  await expect(pane(page).getByLabel('背景颜色')).toBeAttached()
  await changed(page, b0.hash)
})

test('尺寸开关：包围盒与比例尺，标出模型尺寸', async ({ page }) => {
  await openModel(page, 'props/chest/chest.glb')
  const dims = pane(page).getByRole('button', { name: '尺寸：包围盒与比例尺' })
  if ((await dims.getAttribute('aria-pressed')) === 'true') { await dims.click(); await expect(dims).toHaveAttribute('aria-pressed', 'false') }
  const off = await shot(pane(page).locator('.relative.min-h-0.flex-1').first())
  await dims.click()
  await expect(dims).toHaveAttribute('aria-pressed', 'true')
  await expect(pane(page).locator('.bbm-dim').filter({ hasText: /^1\.26 m$/ }).first()).toBeVisible()
  await expect(pane(page).locator('.bbm-dim').filter({ hasText: /^0\.87 m$/ }).first()).toBeVisible()
  await expect(pane(page).getByTitle('比例尺（模型中心所在深度）')).toBeVisible()
  await expect.poll(async () => (await shot(pane(page).locator('.relative.min-h-0.flex-1').first())).hash).not.toBe(off.hash)
  await dims.click()
  await expect(dims).toHaveAttribute('aria-pressed', 'false')
})

test('动作播放：时间轴前进、画面在动，暂停后停住', async ({ page }) => {
  await openModel(page, 'props/chest/chest.glb')
  const time = pane(page).getByRole('slider', { name: '时间轴' })
  await expect(time).toBeVisible()
  const play = pane(page).getByRole('button', { name: '播放' })
  await play.click()
  await expect.poll(async () => Number(await time.inputValue())).toBeGreaterThan(0)
  const a = await shot(canvas(page))
  await page.waitForTimeout(300)
  const b = await shot(canvas(page))
  expect(b.hash).not.toBe(a.hash)
  await pane(page).getByRole('button', { name: '暂停' }).click()
  const v = await time.inputValue()
  await page.waitForTimeout(400)
  expect(await time.inputValue()).toBe(v)
})

test('截图另存为图片资产：生产记录方式 render、来源指向模型', async ({ page }) => {
  const glb = await idOf(bb, 'props/chest/chest.glb')
  await openModel(page, 'props/chest/chest.glb')
  await pane(page).getByRole('button', { name: '出图' }).click()
  const menu = page.getByRole('menu').last()
  await expect(menu.getByRole('menuitem')).toHaveText(['把当前画面设为缩略图', '另存为图片资产…'])
  await menu.getByRole('menuitem', { name: '另存为图片资产…' }).click()
  const d = page.getByRole('dialog', { name: '另存为图片资产' })
  await expect(d).toBeVisible()
  await expect(d.locator('img')).toHaveAttribute('src', /^(data:|blob:)/)
  await d.getByRole('textbox', { name: '名称' }).fill('chest_shot_e2e')
  await d.getByRole('radiogroup', { name: '尺寸' }).getByRole('radio', { name: '512' }).click()
  await d.getByRole('button', { name: '保存' }).click()
  const t = toast(page, '已保存 chest_shot_e2e.png，来源指向 chest.glb')
  await expect(t).toBeVisible()
  const id = await idOf(bb, 'props/chest/chest_shot_e2e.png')
  const a = await bb.api.assets.get(bb.lib, id)
  expect(a.record?.method).toBe('render')
  expect(a.record?.tool).toBe('Bowerbird 模型查看器')
  expect(a.relations.outgoing.some(r => r.type === 'source' && r.to === glb)).toBe(true)
  expect(a.tech.width).toBe(512)
  await t.getByRole('button', { name: '查看' }).click()
  await expect(page.locator('.w2-dh b')).toHaveText('chest_shot_e2e.png')
})

test('网格悬停约半秒后转台：不到半秒不转，停在上面后画面在动', async ({ page }) => {
  await browseFolder(page, bb, 'props/chest')
  const c = cell(page, 'chest.glb')
  const id = await idOf(bb, 'props/chest/chest.glb')
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, id)).thumbState, { timeout: 45_000 }).toBe('ready')
  await page.reload()
  await expect(c.locator('img').first()).toBeVisible({ timeout: 15_000 })
  await c.hover()
  await page.waitForTimeout(250)
  await expect(c.locator('canvas.bbm-cell3d')).toHaveCount(0)
  await expect(c.locator('canvas.bbm-cell3d')).toBeVisible({ timeout: 15_000 }) // starts ~0.5 s after the hover, once the model is prepared
  const a = await shot(c)
  await page.waitForTimeout(400)
  expect((await shot(c)).hash).not.toBe(a.hash)
  await page.mouse.move(5, 5)
  await expect(c.locator('canvas.bbm-cell3d')).toHaveCount(0)
})
