/**
 * The prototype's four walkthroughs (design/review/2026-11-25-prototype-revision.md「八、验证」) against the real
 * server and the「星落镇」sample library.
 */
import { expect, test } from '../helpers/test'
import fs from 'node:fs'
import path from 'node:path'
import { startBowerbird, type Bowerbird } from '../helpers/a-server'
import { assetByName, assetByPath, waitAsset, cell, dialog, libUrl, MOD, openBrowse, toast, toolbar, viewRow } from '../helpers/a-app'

let bb: Bowerbird
test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo' }) })
test.afterEach(async () => { await bb?.stop() })

test('① 待审 → 开始校验 → 通过（⌘↵）→ ⌘Z 撤销，服务端恢复为待审', async ({ page }) => {
  await openBrowse(page, bb)
  await viewRow(page, 'pending').click()
  await expect(page).toHaveURL(/view=pending/)
  const start = toolbar(page).getByRole('button', { name: '开始校验' })
  await expect(start).toBeVisible()
  await start.click()
  await expect(page).toHaveURL(/\/review/)
  await expect(page.getByText('校验队列')).toBeVisible()

  const head = page.locator('.w2-rq__head b')
  await expect(head).toHaveText(/\S/)
  const name = (await head.textContent())!.trim()
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible()
  const before = await assetByName(bb, name)
  expect(before.review).toBe('pending')

  const approve = page.getByRole('button', { name: /^通过/ })
  await expect(approve).toBeEnabled()
  await page.keyboard.press(`${MOD}+Enter`)
  await expect(page.getByText(`${name} 已通过`)).toBeVisible()
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible()
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, before.id)).review).toBe('approved')

  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, before.id)).review).toBe('pending')
  await expect(page.getByText(`${name} 已通过`)).toBeHidden()
})

test('② chest.glb 关系图：上游一直追到顶，9 个节点，引用边带位置名', async ({ page }) => {
  const chest = await assetByPath(bb, 'props/chest/chest.glb')
  await openBrowse(page, bb, 'folder=props%2Fchest')
  await cell(page, 'chest.glb').dblclick()
  await expect(page).toHaveURL(new RegExp(`/asset/${chest.id}`))
  await page.getByRole('tab', { name: /^关系/ }).click()
  await expect(page).toHaveURL(/tab=rel/)

  const nodes = page.locator('.w2-rg__world [data-asset]')
  // chest.glb ← chest_high.blend ← chest_turnaround.png ← chest_concept.png (top: no source of its own);
  // downstream chest_icon.png; uses basecolor / normal / orm; belongs chest.md
  for (const p of ['props/chest/chest_high.blend', 'props/chest/chest_turnaround.png', 'props/chest/chest_concept.png', 'props/chest/chest_icon.png',
    'props/chest/chest_basecolor.png', 'props/chest/chest_normal.png', 'props/chest/chest_orm.png', 'props/chest/chest.md']) {
    const a = await assetByPath(bb, p)
    await expect(nodes.and(page.locator(`[data-asset="${a.id}"]`)), p).toHaveCount(1)
  }
  await expect(nodes).toHaveCount(9)
  const concept = await assetByPath(bb, 'props/chest/chest_concept.png')
  expect((await bb.api.assets.get(bb.lib, concept.id)).relations.outgoing.filter(r => r.type === 'source')).toHaveLength(0)
  await expect(page.locator('.w2-rg__world').getByText('AI 生成 · agent:concept-artist')).toBeVisible()

  // used assets carry the relation's note on their node (graph.js: sub = e.note); the slot name is in the link's panel
  const usedAssets: Array<[file: string, note: string, slot: string]> = [['chest_basecolor.png', '基础色', 'chest_basecolor.png'], ['chest_normal.png', '法线', 'chest_normal.png'], ['chest_orm.png', 'ORM', 'chest_orm.png']]
  for (const [file, note, slot] of usedAssets) {
    const used = await assetByPath(bb, `props/chest/${file}`)
    await expect(page.locator(`.w2-rg__world [data-asset="${used.id}"] .w2-gn__sub`)).toHaveText(note)
    await page.locator(`g[data-edge="uses|${chest.id}|${used.id}|${slot}"] .w2-ge__hit`).dispatchEvent('click')
    await expect(page.getByRole('complementary', { name: '关系详情' })).toContainText(new RegExp(`位置\\s*${note} · ${slot.replace('.', '\\.')}`))
  }
  await expect(page.getByRole('button', { name: '上游已更新' }).first()).toBeVisible()
})

test('③ 复制贴图（⌘D）→ 关系图里把基础色换成副本 → 撤销可用，服务端关系已换', async ({ page }) => {
  const chest = await assetByPath(bb, 'props/chest/chest.glb')
  const base = await assetByPath(bb, 'props/chest/chest_basecolor.png')
  await openBrowse(page, bb, 'folder=props%2Fchest')
  await cell(page, 'chest_basecolor.png').click()
  await page.keyboard.press(`${MOD}+d`)
  await expect(toast(page, '已复制为 chest_basecolor_1.png，原来的引用仍指向原件')).toBeVisible()
  await expect(toast(page, '已复制为 chest_basecolor_1.png').getByRole('button', { name: '撤销' })).toBeVisible()
  const copy = await waitAsset(bb, 'props/chest/chest_basecolor_1.png')
  // the original reference still points at the original
  expect((await bb.api.assets.get(bb.lib, chest.id)).relations.outgoing.find(r => r.slot === 'chest_basecolor.png')!.to).toBe(base.id)

  await page.goto(libUrl(bb, `/asset/${chest.id}?tab=rel`))
  const edge = page.locator(`[data-edge="uses|${chest.id}|${base.id}|chest_basecolor.png"] .w2-ge__hit`)
  await expect(edge).toHaveCount(1)
  await edge.dispatchEvent('click')
  const panel = page.getByRole('complementary', { name: '关系详情' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('chest_basecolor.png').first()).toBeVisible()
  await panel.getByRole('button', { name: '更换对方…' }).click()

  const picker = dialog(page, '更换 基础色 的对方')
  await expect(picker).toBeVisible()
  await picker.getByRole('textbox', { name: '搜索' }).fill('chest_basecolor_1')
  await picker.getByRole('radio', { name: /chest_basecolor_1\.png/ }).click()
  await picker.getByRole('button', { name: '更换' }).click()

  const confirmBox = page.getByRole('alertdialog').filter({ hasText: '更换 基础色 的对方' })
  await expect(confirmBox).toBeVisible()
  await expect(confirmBox).toContainText('位置 chest_basecolor.png · 现在是 chest_basecolor.png')
  await confirmBox.getByRole('button', { name: '更换' }).click()

  const done = toast(page, '基础色 换成了 chest_basecolor_1.png')
  await expect(done).toBeVisible()
  await expect(done.getByRole('button', { name: '撤销' })).toBeVisible()
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, chest.id)).relations.outgoing.find(r => r.slot === 'chest_basecolor.png')?.to).toBe(copy.id)
  // the graph now draws the copy in that place
  await expect(page.locator(`[data-edge="uses|${chest.id}|${copy.id}|chest_basecolor.png"]`)).toHaveCount(1)

  // 撤销 puts the original back
  await done.getByRole('button', { name: '撤销' }).click()
  await expect.poll(async () => (await bb.api.assets.get(bb.lib, chest.id)).relations.outgoing.find(r => r.slot === 'chest_basecolor.png')?.to).toBe(base.id)
})

test('④ 磁盘上删掉被引用的文件 → 扫描发现 → 完整性页 → 重新指定… 打开关系图里那条关系', async ({ page }) => {
  const chest = await assetByPath(bb, 'props/chest/chest.glb')
  const normal = await assetByPath(bb, 'props/chest/chest_normal.png')
  await openBrowse(page, bb, 'folder=props%2Fchest')
  await expect(cell(page, 'chest_normal.png')).toBeVisible()

  fs.rmSync(path.join(bb.root, 'props/chest/chest_normal.png'))
  const found = toast(page, '扫描发现 chest_normal.png 不见了')
  await expect(found).toBeVisible({ timeout: 30_000 })
  await found.getByRole('button', { name: '查看' }).click()
  await expect(page).toHaveURL(/\/issues/)

  // 文件缺失 → 确认删除 (the record goes to the trash) → chest.glb now points to a file it cannot find
  const missingRow = page.locator(`[data-issue="missing-file:${normal.id}"]`)
  await expect(missingRow).toContainText('props/chest/chest_normal.png 不见了')
  await missingRow.getByRole('button', { name: '确认删除' }).click()
  const confirmDel = page.getByRole('alertdialog').filter({ hasText: '确认 chest_normal.png 已经删除？' })
  await expect(confirmDel).toBeVisible()
  await confirmDel.getByRole('button', { name: '移入回收站' }).click()

  const row = page.locator(`[data-issue^="broken-reference:${chest.id}:uses:${normal.id}"]`)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row.locator('xpath=ancestor::*[@data-type][1]')).toContainText('指向的文件找不到了')
  await row.getByRole('button', { name: '重新指定…' }).click()

  await expect(page).toHaveURL(new RegExp(`/asset/${chest.id}\\?.*tab=rel`))
  await expect(page).toHaveURL(new RegExp(`relTo=${normal.id}`))
  const panel = page.getByRole('complementary', { name: '关系详情' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('指向的文件找不到了')).toBeVisible()
  await expect(panel.getByRole('button', { name: '更换对方…' })).toBeVisible()
  await expect(panel.getByRole('button', { name: '从回收站恢复' })).toBeVisible()
  await expect(panel.getByRole('button', { name: '删除这条关系' })).toBeVisible()
})
