import { test, expect, type Page } from '../helpers/test'
import { startBB, idOf, openDetail, detailTabs } from '../helpers/b-server'
import { dialog, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/** pages.md「版本页签」and「校验页签」(detail.js / compare.js). */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const pane = (page: Page) => page.locator('.w2-dpane')
const tab = (page: Page, name: string | RegExp) => detailTabs(page).getByRole('tab', { name })

test.describe('版本页签', () => {
  test('未安装版本插件：只有记录（v1 起、时间、执行者、说明、大小）+ 一句话说明 +「选择版本插件…」；没有「标签与关系」筛选', async ({ page }) => {
    await openDetail(page, bb, 'props/chest/chest.glb', 'ver')
    await expect(tab(page, /^版本/)).toHaveAttribute('aria-selected', 'true')
    const p = pane(page)
    await expect(p).toContainText('只记录了变化，没有保存旧文件')
    await expect(p).toContainText('Bowerbird 本身不保存旧版本的内容。装一个版本插件，就能预览、对比和恢复。')
    const rows = p.locator('.w2-vtr')
    await expect(rows).toHaveCount(2)
    // newest first, current one tagged, v1 at the bottom; size on every row
    await expect(rows.first()).toContainText('v2')
    await expect(rows.first()).toContainText('当前')
    await expect(rows.last()).toContainText('v1')
    for (const r of await rows.all()) await expect(r).toContainText(/\d+(\.\d+)? (B|KB|MB)/)
    await expect(rows.first()).toContainText(/\d+ 月 \d+ 日 \d\d:\d\d · /)
    // records only: rows are not buttons, nothing to preview, no filter
    await expect(p.locator('button.w2-vtr')).toHaveCount(0)
    await expect(p.getByText('标签与关系')).toHaveCount(0)
    await expect(p.getByRole('radiogroup', { name: '显示' })).toHaveCount(0)
    await expect(p.getByRole('button', { name: '恢复为当前版本…' })).toHaveCount(0)
  })

  test('「选择版本插件…」对话框：Lore / Git LFS 两项、说明、取消；安装失败进提示', async ({ page }) => {
    await openDetail(page, bb, 'props/chest/chest.glb', 'ver')
    await pane(page).getByRole('button', { name: '选择版本插件…' }).click()
    const d = dialog(page)
    await expect(d).toContainText('选择版本插件')
    const opts = d.getByRole('radio')
    await expect(opts).toHaveCount(2)
    await expect(opts.nth(0)).toContainText('Lore')
    await expect(opts.nth(0)).toContainText('为美术大文件设计')
    await expect(opts.nth(1)).toContainText('Git LFS')
    await expect(opts.nth(1)).toContainText('适合已经在用 Git 的团队')
    await expect(opts.nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(d).toContainText('已有的版本记录不会补上内容，从安装起开始保存。')
    await opts.nth(1).click()
    await expect(opts.nth(1)).toHaveAttribute('aria-checked', 'true')
    await d.getByRole('button', { name: '取消' }).click()
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
    // 安装: the plugin packages are not published in phase one → the npm failure reaches a toast (no network here)
    await page.route(/\/api\/v1\/plugins$/, route => route.request().method() === 'POST'
      ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'plugin_install_failed', message: '找不到 @bowerbird/plugin-version-lore' } }) })
      : route.fallback())
    await pane(page).getByRole('button', { name: '选择版本插件…' }).click()
    await dialog(page).getByRole('button', { name: '安装' }).click()
    await expect(toast(page, /Lore 没有装上：/)).toBeVisible()
    await expect(dialog(page)).toContainText('选择版本插件')
  })

  test.fixme('已安装版本插件：列表 + 预览；与当前版本对比；恢复为当前版本…（确认 + 撤销）；安装前的版本「未保存内容」不能预览', async ({ page }) => {
    // FIXME(phase 1): no version plugin exists yet (versioning.md: Lore and Git LFS are optional plugins, not built in
    // phase one), so a server can never report `store`. The UI half is covered by unit tests with a fake store
    // (packages/web/src/compare/ComparePage.test.tsx, versions/restore.test.ts, detail/DetailPage.test.tsx).
    // No「全部 / 内容 / 标签与关系」filter: nothing records tag or relation history (P1-6).
    await openDetail(page, bb, 'props/chest/chest.glb', 'ver')
    await expect(pane(page).getByRole('button', { name: /^v1/ })).toContainText('未保存内容')
  })

  test('加载中显示骨架，出错时说明 + 重试', async ({ page }) => {
    const id = await idOf(bb, 'props/chest/chest.glb')
    let mode: 'hold' | 'fail' | 'ok' = 'hold'
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    await page.route(new RegExp(`/api/v1/libraries/[^/]+/assets/${id}/versions`), async route => {
      if (mode === 'hold') await gate
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"服务出错了"}}' })
      return route.fallback()
    })
    await openDetail(page, bb, 'props/chest/chest.glb', 'ver')
    await expect(pane(page).locator('.w2-skel, [data-skeleton], .animate-pulse').first()).toBeVisible()
    mode = 'fail'
    release()
    await expect(pane(page)).toContainText('服务出错了', { timeout: 20_000 })
    const retry = pane(page).getByRole('button', { name: '重试' })
    await expect(retry).toBeVisible()
    mode = 'ok'
    // an automatic refetch may recover first; then the button is gone already
    await retry.click({ timeout: 5_000 }).catch(() => {})
    await expect(pane(page)).toContainText('只记录了变化，没有保存旧文件')
  })
})

test.describe('校验页签', () => {
  test('待审：通过 / 打回…；自动检查只有「尺寸与设计对象」（只显示不打回）；与上游对比到最近的可显示上游', async ({ page }) => {
    const id = await openDetail(page, bb, 'props/chest/chest.glb', 'rev')
    const p = pane(page)
    await expect(p.locator('.w2-rvhead')).toContainText('待审')
    await expect(p.getByRole('button', { name: '打回…' })).toBeEnabled()
    await expect(p.getByRole('button', { name: '通过' })).toBeEnabled()
    await expect(p.locator('h4')).toHaveText('自动检查')
    const checks = p.locator('.w2-chk-row')
    await expect(checks).toHaveCount(1)
    await expect(checks.first()).toContainText('尺寸与设计对象')
    await expect(checks.first()).toContainText('模型 1.26 × 0.95 × 0.87 m · 目标 1.26 × 0.95 × 0.87 m')
    await expect(checks.first()).not.toContainText('尺寸与设计对象：') // the label once, not again in the message
    await expect(checks.first()).not.toHaveClass(/bad/)
    // chest.glb ← chest_high.blend (unknown format) ← chest_turnaround.png: the nearest viewable one
    const up = p.getByRole('button', { name: '与上游对比' })
    await expect(up).toHaveAttribute('title', '和 chest_turnaround.png 对比')
    await up.click()
    await expect(page).toHaveURL(new RegExp(`/compare\\?a=${id}&b=${await idOf(bb, 'props/chest/chest_turnaround.png')}`))
  })

  test('打回必须填意见：空意见拦在对话框里；填了才打回，意见红色显示，谁 · 何时；可撤销', async ({ page }) => {
    await openDetail(page, bb, 'characters/npc/npc_merchant_concept.png', 'rev')
    const p = pane(page)
    await p.getByRole('button', { name: '打回…' }).click()
    const d = dialog(page)
    await expect(d).toContainText('打回 npc_merchant_concept.png')
    const note = d.getByRole('textbox', { name: '打回意见' })
    await expect(note).toHaveAttribute('placeholder', '哪里需要改（必填）')
    await expect(note).toBeFocused()
    await d.getByRole('button', { name: '打回', exact: true }).click()
    await expect(note).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog(page)).toContainText('打回 npc_merchant_concept.png')
    await note.fill('   ')
    await d.getByRole('button', { name: '打回', exact: true }).click()
    await expect(note).toHaveAttribute('aria-invalid', 'true')
    await note.fill('配色太暗，围裙改成暖色')
    await d.getByRole('button', { name: '打回', exact: true }).click()
    const t = toast(page, 'npc_merchant_concept.png 已打回')
    await expect(t).toBeVisible()
    await expect(p.locator('.w2-rvhead')).toContainText('打回')
    await expect(p.locator('.w2-rv__who')).toContainText(/未署名 · \d+ 月 \d+ 日 \d\d:\d\d/)
    const red = p.locator('.w2-rv__note--rej')
    await expect(red).toHaveText('配色太暗，围裙改成暖色')
    expect((await bb.api.assets.get(bb.lib, await idOf(bb, 'characters/npc/npc_merchant_concept.png'))).review).toBe('rejected')
    // undo puts back the verdict before (pending)
    await t.getByRole('button', { name: '撤销' }).click()
    await expect(p.locator('.w2-rvhead')).toContainText('待审')
    await expect(p.locator('.w2-rv__note--rej')).toHaveCount(0)
  })

  test('通过：结论变成「通过」（谁 · 何时），「通过」置灰；打回的意见是红色、通过的意见不是', async ({ page }) => {
    await openDetail(page, bb, 'props/lantern/lantern_concept.png', 'rev')
    const p = pane(page)
    await p.getByRole('button', { name: '通过' }).click()
    await expect(toast(page, 'lantern_concept.png 已通过')).toBeVisible()
    await expect(p.locator('.w2-rvhead__st')).toHaveText('通过')
    await expect(p.locator('.w2-rv__who')).toContainText(/未署名 · \d+ 月 \d+ 日/)
    await expect(p.getByRole('button', { name: '通过' })).toBeDisabled()
    // a rejected one from the sample: red comment and who
    await openDetail(page, bb, 'characters/hero/hero.glb', 'rev')
    await expect(pane(page).locator('.w2-rvhead')).toContainText('打回')
    await expect(pane(page).locator('.w2-rv__who')).toContainText('user:lin')
    await expect(pane(page).locator('.w2-rv__note--rej')).toHaveText('左肩甲穿模，手腕权重要重刷')
    // an approved one with a comment: not red
    await openDetail(page, bb, 'props/chest/chest_concept.png', 'rev')
    await expect(pane(page).locator('.w2-rv__note')).toHaveText('包边颜色可以，按这个出四视图')
    await expect(pane(page).locator('.w2-rv__note--rej')).toHaveCount(0)
  })

  test('没有可检查的项时显示「没有自动检查项」；不需要校验的资产没有通过 / 打回', async ({ page }) => {
    await openDetail(page, bb, 'props/chest/chest_basecolor.png', 'rev')
    await expect(pane(page)).toContainText('没有自动检查项')
    await expect(pane(page).locator('.w2-chk-row')).toHaveCount(0)
    await openDetail(page, bb, 'references/3d-render/ref_render_01.png', 'rev')
    await expect(pane(page)).toContainText('没有自动检查项')
    await expect(pane(page).getByRole('button', { name: '通过' })).toHaveCount(0)
    await expect(pane(page).getByRole('button', { name: '打回…' })).toHaveCount(0)
  })

  test('尺寸不符时检查标红但不改结论（ADR-020）', async ({ page }) => {
    // chest.glb gets another model's content (potion.glb), so its bounding box no longer matches chest.md's target
    const glb = await idOf(bb, 'props/chest/chest.glb')
    const bytes = await (await fetch(bb.api.assets.fileUrl(bb.lib, await idOf(bb, 'props/potion/potion.glb')))).arrayBuffer()
    await bb.api.assets.replaceContent(bb.lib, glb, new Blob([bytes], { type: 'model/gltf-binary' }) as never, '换了模型')
    await expect.poll(async () => (await bb.api.assets.get(bb.lib, glb)).checks[0]?.verdict, { timeout: 30_000 }).toBe('fail')
    await openDetail(page, bb, 'props/chest/chest.glb', 'rev')
    const row = pane(page).locator('.w2-chk-row')
    await expect(row).toHaveClass(/bad/)
    await expect(row).toContainText('尺寸与设计对象')
    await expect(row).toContainText('目标 1.26 × 0.95 × 0.87 m')
    await expect(pane(page).locator('.w2-rvhead')).toContainText('待审')
  })

  test('设计对象改了目标尺寸后，归属它的模型重新检查', async ({ page }) => {
    // pipeline-and-cache.md「触发条件」: the design object's content changed → the assets belonging to it are validated again.
    const md = await idOf(bb, 'props/chest/chest.md')
    const text = await (await fetch(bb.api.assets.fileUrl(bb.lib, md))).text()
    await bb.api.assets.replaceContent(bb.lib, md, new Blob([text.replace('size: 1.26 × 0.95 × 0.87 m', 'size: 2 × 0.95 × 0.87 m')], { type: 'text/markdown' }) as never, '改目标尺寸')
    await openDetail(page, bb, 'props/chest/chest.glb', 'rev')
    // sizes are written with two decimals (copy.md「宽 1.30 m，应为 1.26」)
    await expect(pane(page).locator('.w2-chk-row')).toContainText('目标 2.00 × 0.95 × 0.87 m')
  })
})
