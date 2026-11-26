import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '../helpers/test'
import { startBB, idOf, libPath } from '../helpers/b-server'
import { dialog, loadingThenError, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/**
 * pages.md「回收站」. The sample trash (fixtures/README.md, ages rebased to 2026-11-25): btn_close.png (ui/shop, whose
 * place is taken again), potion_basecolor.png (props/potion, still referenced by potion.glb), moodboard_old.jpg
 * (references/illustration, exempt from review), chest_v0.glb (props/chest, 1 day left). The tests run in order on
 * one server.
 */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const open = (page: Page) => page.goto(libPath(bb, '/trash'))
const row = (page: Page, name: string) => page.locator('[data-trash]').filter({ has: page.locator('b', { hasText: name }) })

test('正常：标题与保留天数；行内阶段与校验标记、原来的位置、删除时间、执行者、剩余天数；快到期标黄', async ({ page }) => {
  await open(page)
  await expect(page.locator('header')).toContainText('回收站')
  await expect(page.locator('header')).toContainText('保留 7 天，到期自动清除')
  await expect(page.getByRole('columnheader')).toHaveText(['', '名称', '原来的位置', '删除时间', '执行者', '剩余', ''])
  await expect(page.locator('[data-trash]')).toHaveCount(4)
  const btn = row(page, 'btn_close.png')
  await expect(btn).toContainText('运行时')
  await expect(btn).toContainText('ui/shop')
  await expect(btn).toContainText('agent:slicer')
  await expect(btn).toContainText(/\d+ 天前/)
  await expect(btn.locator('[data-days-left]')).toHaveText('5 天')
  await expect(btn.locator('[data-days-left]')).not.toHaveClass(/w2-tr__soon/)
  await expect(row(page, 'potion_basecolor.png')).toContainText('props/potion')
  await expect(row(page, 'potion_basecolor.png')).toContainText('user:mo')
  // exempt from review: no review mark; a reference asset
  const mood = row(page, 'moodboard_old.jpg')
  await expect(mood).toContainText('参考')
  await expect(mood).toContainText('references/illustration')
  await expect(mood.locator('[data-days-left]')).toHaveText('2 天')
  // one day left: yellow
  const v0 = row(page, 'chest_v0.glb')
  await expect(v0.locator('[data-days-left]')).toHaveText('1 天')
  await expect(v0.locator('[data-days-left]')).toHaveClass(/w2-tr__soon/)
  await expect(v0).toContainText('agent:modeler')
  for (const r of await page.locator('[data-trash]').all()) {
    await expect(r.getByRole('button', { name: '恢复' })).toBeVisible()
    await expect(r.getByRole('button', { name: '彻底删除…' })).toBeVisible()
  }
  await expect(page.locator('header').getByRole('button', { name: '清空回收站…' })).toBeVisible()
})

test('彻底删除确认：说明删掉 .bmeta、不能恢复；还被引用时多一句；取消不删，确认后删除', async ({ page }) => {
  await open(page)
  // still referenced by potion.glb
  await row(page, 'potion_basecolor.png').getByRole('button', { name: '彻底删除…' }).click()
  let d = dialog(page)
  await expect(d).toHaveAttribute('role', 'alertdialog')
  await expect(d).toContainText('彻底删除 potion_basecolor.png？')
  await expect(d).toContainText('文件和旁边的 .bmeta 会从磁盘上删掉，不能恢复。还有资产引用它，这些引用会一直找不到文件。')
  await d.getByRole('button', { name: '取消' }).click()
  await expect(row(page, 'potion_basecolor.png')).toBeVisible()
  // not referenced: the plain sentence; confirm
  await row(page, 'moodboard_old.jpg').getByRole('button', { name: '彻底删除…' }).click()
  d = dialog(page)
  await expect(d).toContainText('彻底删除 moodboard_old.jpg？')
  await expect(d).toContainText('文件和旁边的 .bmeta 会从磁盘上删掉，不能恢复。')
  await expect(d).not.toContainText('还有资产引用它')
  await d.getByRole('button', { name: '彻底删除' }).click()
  await expect(toast(page, '已彻底删除 moodboard_old.jpg')).toBeVisible()
  await expect(row(page, 'moodboard_old.jpg')).toHaveCount(0)
  expect((await bb.api.trash.list(bb.lib)).items.map(i => i.name)).not.toContain('moodboard_old.jpg')
})

test('恢复到被占用的位置：先问，说明会改名为 {名称_1}，两个文件都保留；取消则不动', async ({ page }) => {
  await open(page)
  await row(page, 'btn_close.png').getByRole('button', { name: '恢复' }).click()
  let d = dialog(page)
  await expect(d).toContainText('恢复 btn_close.png？')
  await expect(d).toContainText('ui/shop 里已经有一个同名文件。恢复后它会改名为 btn_close_1.png，两个文件都保留。')
  await d.getByRole('button', { name: '取消' }).click()
  await expect(row(page, 'btn_close.png')).toBeVisible()
  expect(fs.existsSync(path.join(bb.root, 'ui/shop/btn_close_1.png'))).toBe(false)
  await row(page, 'btn_close.png').getByRole('button', { name: '恢复' }).click()
  d = dialog(page)
  await d.getByRole('button', { name: '恢复并改名' }).click()
  await expect(toast(page, 'btn_close_1.png 已恢复到 ui/shop')).toBeVisible()
  await expect(row(page, 'btn_close.png')).toHaveCount(0)
  expect(fs.existsSync(path.join(bb.root, 'ui/shop/btn_close_1.png'))).toBe(true)
  expect(fs.existsSync(path.join(bb.root, 'ui/shop/btn_close.png'))).toBe(true)
  await expect.poll(async () => { try { return !!(await idOf(bb, 'ui/shop/btn_close_1.png')) } catch { return false } }).toBe(true)
})

test('多选恢复：选择条「已选 N 个」，恢复后「已恢复 N 个资产」；断掉的引用重新接上', async ({ page }) => {
  await open(page)
  await row(page, 'potion_basecolor.png').getByRole('checkbox', { name: '选择 potion_basecolor.png' }).click()
  await row(page, 'chest_v0.glb').getByRole('checkbox', { name: '选择 chest_v0.glb' }).click()
  const bar = page.locator('.w2-tr__sel')
  await expect(bar).toContainText('已选 2 个')
  await expect(row(page, 'chest_v0.glb')).toHaveClass(/on/)
  await bar.getByRole('button', { name: '恢复' }).click()
  await expect(toast(page, '已恢复 2 个资产')).toBeVisible()
  await expect(page.locator('[data-trash]')).toHaveCount(0)
  const potion = await bb.api.assets.get(bb.lib, await idOf(bb, 'props/potion/potion.glb'))
  expect(potion.relations.outgoing.filter(r => r.type === 'uses').every(r => !r.broken)).toBe(true)
})

test('空回收站：「回收站是空的」与保留天数说明；删除后能在这里恢复（撤销放回回收站）', async ({ page }) => {
  await open(page)
  await expect(page.getByText('回收站是空的')).toBeVisible()
  await expect(page.getByText('删除的资产会在这里保留 7 天，期间可以恢复。')).toBeVisible()
  await expect(page.getByRole('button', { name: '清空回收站…' })).toHaveCount(0)
  // a fresh delete shows up (event stream), restore it, then undo the restore
  await bb.api.assets.remove(bb.lib, await idOf(bb, 'ui/shop/divider.png'), true)
  await expect(row(page, 'divider.png')).toBeVisible()
  await expect(row(page, 'divider.png').locator('[data-days-left]')).toHaveText('7 天')
  await expect(row(page, 'divider.png')).toContainText('刚刚')
  await row(page, 'divider.png').getByRole('button', { name: '恢复' }).click()
  const t = toast(page, 'divider.png 已恢复到 ui/shop')
  await expect(t).toBeVisible()
  await t.getByRole('button', { name: '撤销' }).click()
  await expect(row(page, 'divider.png')).toBeVisible()
})

test('清空回收站…：确认后全部彻底删除，回到空状态', async ({ page }) => {
  await bb.api.assets.remove(bb.lib, await idOf(bb, 'ui/shop/frame_item.png'), true)
  await open(page)
  await expect(page.locator('[data-trash]')).toHaveCount(2)
  await page.getByRole('button', { name: '清空回收站…' }).click()
  const d = dialog(page)
  await expect(d).toContainText('彻底删除 2 个资产？')
  await d.getByRole('button', { name: '彻底删除' }).click()
  await expect(toast(page, '已彻底删除 2 个资产')).toBeVisible()
  await expect(page.getByText('回收站是空的')).toBeVisible()
  expect(fs.existsSync(path.join(bb.root, 'ui/shop/frame_item.png'))).toBe(false)
})

test('加载中（骨架）与出错（「没有加载出来」+ 重试）', async ({ page }) => {
  await loadingThenError(page, /\/api\/v1\/libraries\/[^/]+\/trash$/, () => open(page), page.getByText('回收站是空的'))
})
