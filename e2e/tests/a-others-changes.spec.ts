/**
 * 「别人的改动」(pages.md 浏览页 / 详情页, F-03): what another client adds waits behind「有 N 个新资产 · 显示」; an asset
 * being looked at that someone replaces gets a banner and keeps showing the old content until「显示新版本」.
 */
import { expect, test } from '../helpers/test'
import fs from 'node:fs'
import path from 'node:path'
import { createApiClient } from '@bowerbird/schema'
import { REPO, startBowerbird, type Bowerbird } from '../helpers/a-server'
import { assetByPath, cell, grid, libUrl, openBrowse, waitScanned } from '../helpers/a-app'

let bb: Bowerbird
test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo' }) })
test.afterEach(async () => { await bb?.stop() })

const png = (name: string) => ({ data: new Uint8Array(fs.readFileSync(path.join(REPO, 'fixtures/upload-batch', name))), name, type: 'image/png' })

test('浏览时 Agent 登记了新资产：网格顶部「有 1 个新资产 · 显示」，点了才出现', async ({ page }) => {
  await openBrowse(page, bb, 'folder=props%2Fchest')
  await expect(cell(page, 'chest.glb')).toBeVisible()
  const before = await grid(page).locator('[data-asset-cell]').count()

  const agent = bb.agent('concept-artist')
  const r = await agent.assets.register(bb.lib, { folder: 'props/chest', name: 'chest_sketch.png' }, png('lantern_concept.png'))
  expect(r.asset?.name).toBe('chest_sketch.png')

  const pill = page.getByRole('button', { name: '有 1 个新资产 · 显示' })
  await expect(pill).toBeVisible()
  // not inserted into the grid by itself
  await page.waitForTimeout(800)
  await expect(cell(page, 'chest_sketch.png')).toHaveCount(0)
  expect(await grid(page).locator('[data-asset-cell]').count()).toBe(before)

  await pill.click()
  await expect(pill).toBeHidden()
  await expect(cell(page, 'chest_sketch.png')).toBeVisible()
})

test('两个新资产合成一个数字', async ({ page }) => {
  await openBrowse(page, bb, 'folder=props%2Fchest')
  const agent = bb.agent('concept-artist')
  await agent.assets.register(bb.lib, { folder: 'props/chest', name: 'chest_sketch_a.png' }, png('lantern_concept.png'))
  await agent.assets.register(bb.lib, { folder: 'props/chest', name: 'chest_sketch_b.png' }, png('lantern_basecolor.png'))
  await expect(page.getByRole('button', { name: '有 2 个新资产 · 显示' })).toBeVisible()
})

test('正在看的资产被别人替换：横幅「user:lin 刚把它替换成了 v{n}」，点「显示新版本」才换', async ({ page }) => {
  const concept = await assetByPath(bb, 'props/chest/chest_concept.png')
  const versions = (await bb.api.assets.versions(bb.lib, concept.id)).versions.length
  await waitScanned(bb)
  await page.goto(libUrl(bb, `/asset/${concept.id}`))
  await expect(page.getByRole('tab', { name: /^查看/ })).toHaveAttribute('aria-selected', 'true')

  const lin = createApiClient({ baseUrl: bb.url, headers: { origin: bb.url }, actor: 'user:lin' })
  await lin.assets.replaceContent(bb.lib, concept.id, png('lantern_concept.png'), '换成新稿')
  const n = versions + 1

  const banner = page.getByText(`user:lin 刚把它替换成了 v${n}`)
  await expect(banner).toBeVisible()
  await expect(page.getByText('你看到的还是替换之前的内容。')).toBeVisible()
  const show = page.getByRole('button', { name: '显示新版本' })
  await expect(show).toBeVisible()
  // stays until asked
  await page.waitForTimeout(1000)
  await expect(banner).toBeVisible()
  await show.click()
  await expect(banner).toBeHidden()
  expect((await bb.api.assets.versions(bb.lib, concept.id)).versions.length).toBe(n)
})
