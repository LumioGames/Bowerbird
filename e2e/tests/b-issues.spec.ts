import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '../helpers/test'
import { startBB, idOf, libPath } from '../helpers/b-server'
import { dialog, loadingThenError, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/**
 * pages.md「完整性」. The sample's problems (fixtures/README.md): broken-reference (potion.glb → potion_basecolor.png in
 * the trash), missing-file (hero_idle.fbx), duplicate-guid (btn_buy (1).png), metadata-conflict (shop_prototype.html),
 * plugin-missing (hero_run.skel), stale-upstream (chest_icon.png), duplicate-content (ui/hud/panel_bg.png). Types the
 * sample cannot produce on a server (pipeline-failed happens in a browser; thumbnail-stale, orphan-sidecar) are added
 * to the response. Tests run in order on one server.
 */
let bb: Bowerbird
test.beforeAll(async () => { bb = await startBB() })
test.afterAll(async () => { await bb?.stop() })

const open = async (page: Page) => { await page.goto(libPath(bb, '/issues')); await expect(page.locator('.w2-it__row').first()).toBeVisible() }
const type = (page: Page, t: string) => page.locator(`.w2-it__ty[data-type="${t}"]`)
const row = (page: Page, t: string, name?: string) => (name ? type(page, t).locator('.w2-it__row').filter({ hasText: name }) : type(page, t).locator('.w2-it__row')).first()

test('正常：「N 个资产 · M 条问题」；按错误 / 警告 / 提示分组，再按类型；每行的说明、位置、发现时间与默认按钮', async ({ page }) => {
  await open(page)
  const head = page.locator('header')
  await expect(head).toContainText('完整性')
  await expect(head).toContainText(/\d+ 个资产 · \d+ 条问题/)
  const all = await bb.api.issues.list(bb.lib) as unknown as { total: number; assetCount: number; issues: Array<{ level: string }> }
  await expect(head).toContainText(`${all.assetCount} 个资产 · ${all.total} 条问题`)
  // level sections in order with counts
  await expect(page.locator('.w2-it__lv h4')).toHaveText([/^错误\s*\d+$/, /^警告\s*\d+$/, /^提示\s*\d+$/])
  const lv = (l: string) => page.locator(`.w2-it__lv[data-level="${l}"]`)
  await expect(lv('error').locator('.w2-it__th b')).toHaveText(['指向的文件找不到了', '文件缺失', '被当成同一个资产', '两份记录不一致'])
  await expect(lv('warning').locator('.w2-it__th b')).toHaveText(['上游已更新', '缺少插件'])
  await expect(lv('info').locator('.w2-it__th b')).toHaveText(['内容重复'])
  // rows: text, place, found
  await expect(row(page, 'broken-reference')).toContainText('potion.glb')
  await expect(row(page, 'broken-reference')).toContainText('potion_basecolor.png，但它已不在资产库（在回收站里）')
  await expect(row(page, 'broken-reference')).toContainText(/props\/potion · 发现于 /)
  await expect(row(page, 'missing-file')).toContainText('文件 characters/hero/hero_idle.fbx 不见了；它的标签、关系和历史都还在')
  await expect(row(page, 'duplicate-guid')).toContainText('和 btn_buy.png 被当成了同一个资产，系统已把这一个改成独立的新资产，等你确认')
  await expect(row(page, 'metadata-conflict').locator('.w2-it__m > span')).toHaveText("云盘同步留下了冲突副本：shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta，两份的标签不一样")
  await expect(row(page, 'stale-upstream')).toContainText('上游 chest.glb 从 v1 更新到了 v2，这张图还是按 v1 做的')
  await expect(row(page, 'plugin-missing')).toContainText(/需要 .*（community\.spine \^1\.4\.0），本机没有安装/)
  await expect(row(page, 'duplicate-content')).toContainText('和 ui/shop/panel_bg.png 的内容完全相同')
  // default-style buttons, in the order of copy.md
  const btns = (t: string) => row(page, t).locator('.w2-it__acts button')
  await expect(btns('broken-reference')).toHaveText(['重新指定…', '删除这条关系', '从回收站恢复 potion_basecolor.png'])
  await expect(btns('missing-file')).toHaveText(['重新定位文件…', '确认删除'])
  await expect(btns('duplicate-guid')).toHaveText(['其实这个才是原件…', '确认'])
  await expect(btns('metadata-conflict')).toHaveText(['选择保留哪一份…'])
  await expect(btns('stale-upstream')).toHaveText(['对比变化', '替换内容…', '确认已复核'])
  await expect(btns('plugin-missing')).toHaveText(['去安装'])
  await expect(btns('duplicate-content')).toHaveText(['忽略', '标为副本'])
  for (const b of await page.locator('.w2-it__acts button').all()) await expect(b).not.toHaveClass(/primary|danger/)
  // without a version plugin「对比变化」is off and says why
  await expect(btns('stale-upstream').first()).toBeDisabled()
  await expect(btns('stale-upstream').first()).toHaveAttribute('title', /版本插件/)
})

test('级别筛选：全部 / 错误 / 警告 / 提示 带数量，只显示选中的级别', async ({ page }) => {
  await open(page)
  const seg = page.getByRole('radiogroup', { name: '级别' })
  await expect(seg.getByRole('radio')).toHaveText([/^全部 \d+$/, /^错误 \d+$/, /^警告 \d+$/, /^提示 \d+$/])
  await seg.getByRole('radio', { name: /^警告/ }).click()
  await expect(page.locator('.w2-it__lv')).toHaveCount(1)
  await expect(page.locator('.w2-it__lv h4')).toHaveText(/^警告/)
  await seg.getByRole('radio', { name: /^提示/ }).click()
  await expect(page.locator('.w2-it__lv h4')).toHaveText(/^提示/)
  await seg.getByRole('radio', { name: /^全部/ }).click()
  await expect(page.locator('.w2-it__lv')).toHaveCount(3)
})

test('指向的文件找不到了：删除这条关系先确认；从回收站恢复后问题消失', async ({ page }) => {
  await open(page)
  await row(page, 'broken-reference').getByRole('button', { name: '删除这条关系' }).click()
  const d = dialog(page)
  await expect(d).toContainText('删除这条关系？')
  await expect(d).toContainText('potion.glb 将不再引用 potion_basecolor.png。')
  await d.getByRole('button', { name: '取消' }).click()
  await row(page, 'broken-reference').getByRole('button', { name: '从回收站恢复 potion_basecolor.png' }).click()
  await expect(toast(page, 'potion_basecolor.png 已恢复，potion.glb 的引用重新接上了')).toBeVisible()
  await expect(type(page, 'broken-reference')).toHaveCount(0)
})

test('批量「全部…」：同类多于一条时出现，确认后一起处理', async ({ page }) => {
  // two more broken links: chest.glb's normal map and ORM go to the trash
  await bb.api.assets.remove(bb.lib, await idOf(bb, 'props/chest/chest_normal.png'), true)
  await bb.api.assets.remove(bb.lib, await idOf(bb, 'props/chest/chest_orm.png'), true)
  await open(page)
  await expect(type(page, 'broken-reference').locator('.w2-it__row')).toHaveCount(2)
  const all = type(page, 'broken-reference').getByRole('button', { name: '全部从回收站恢复' })
  await expect(all).toBeVisible()
  await expect(type(page, 'missing-file').getByRole('button', { name: /^全部/ })).toHaveCount(0)
  await all.click()
  const d = dialog(page)
  await expect(d).toContainText('对 2 条「指向的文件找不到了」执行“全部从回收站恢复”？')
  await expect(d).toContainText('chest.glb')
  await d.getByRole('button', { name: '全部从回收站恢复' }).click()
  await expect(toast(page, '已处理 2 条')).toBeVisible()
  await expect(type(page, 'broken-reference')).toHaveCount(0)
})

test('检查器横幅「重新定位文件…」跳到完整性页：那条问题标出来并直接打开它的对话框（?issue=）', async ({ page }) => {
  await page.goto(libPath(bb, `?folder=${encodeURIComponent('characters/hero')}`))
  await page.locator('[data-asset-cell]').filter({ has: page.getByText('hero_idle.fbx', { exact: true }) }).first().click()
  await page.getByRole('complementary', { name: '检查器' }).getByRole('button', { name: '重新定位文件…' }).click()
  await expect(page).toHaveURL(/\/issues\?issue=missing-file/)
  const d = dialog(page)
  await expect(d).toContainText('重新定位 hero_idle.fbx')
  await d.getByRole('button', { name: '取消' }).click()
  const focused = page.locator('.w2-it__row[aria-current="true"]')
  await expect(focused).toHaveCount(1)
  await expect(focused).toContainText('hero_idle.fbx')
  await expect(focused).toBeInViewport()
  // the same for a link to another kind: 两份记录不一致 → 保留哪一份记录？
  const all = await bb.api.issues.list(bb.lib) as unknown as { issues: Array<{ id: string; type: string }> }
  const conflict = all.issues.find(i => i.type === 'metadata-conflict')!
  await page.goto(libPath(bb, `/issues?issue=${encodeURIComponent(conflict.id)}`))
  await expect(dialog(page)).toContainText('保留哪一份记录？')
  await dialog(page).getByRole('button', { name: '取消' }).click()
  await expect(page.locator('.w2-it__row[aria-current="true"]')).toContainText('shop_prototype.html')
})

test('文件缺失：「重新定位 {名称}」列出最像的文件、可选其他文件，默认把文件移回原来的位置', async ({ page }) => {
  fs.copyFileSync(path.join(bb.root, 'characters/hero/hero_walk.fbx'), path.join(bb.root, 'characters/found_idle.fbx'))
  await open(page)
  await row(page, 'missing-file').getByRole('button', { name: '重新定位文件…' }).click()
  const d = dialog(page)
  await expect(d).toContainText('重新定位 hero_idle.fbx')
  await expect(d).toContainText('没有找到内容完全一样的文件，下面是最像的几个。用选中的文件作为 hero_idle.fbx')
  const opts = d.getByRole('radio')
  await expect(opts.first()).toContainText('characters/hero/hero_walk.fbx')
  await expect(opts.first()).toContainText('名字相近')
  await expect(opts.first()).toHaveAttribute('aria-checked', 'true')
  const back = d.getByRole('switch', { name: '把文件移回原来的位置' })
  await expect(back).toHaveAttribute('aria-checked', 'true')
  await expect(d).toContainText('characters/hero/hero_idle.fbx')
  await d.getByRole('button', { name: '从磁盘选择其他文件…' }).click()
  await d.getByRole('textbox', { name: '从磁盘选择其他文件…' }).fill('characters/found_idle.fbx')
  await d.getByRole('button', { name: '接上这个文件' }).click()
  await expect(toast(page, 'characters/found_idle.fbx 已移回 characters/hero/hero_idle.fbx，问题已消失')).toBeVisible()
  await expect(type(page, 'missing-file')).toHaveCount(0)
  expect(fs.existsSync(path.join(bb.root, 'characters/hero/hero_idle.fbx'))).toBe(true)
  expect(fs.existsSync(path.join(bb.root, 'characters/found_idle.fbx'))).toBe(false)
})

test('文件缺失：确认删除（只把记录移入回收站）', async ({ page }) => {
  fs.rmSync(path.join(bb.root, 'characters/hero/hero_idle.fbx'))
  await bb.api.libraries.rescan(bb.lib)
  await open(page)
  await expect(row(page, 'missing-file')).toBeVisible({ timeout: 30_000 })
  await row(page, 'missing-file').getByRole('button', { name: '确认删除' }).click()
  const d = dialog(page)
  await expect(d).toContainText('确认 hero_idle.fbx 已经删除？')
  await expect(d).toContainText('文件已经不在了，只把它的记录移入回收站；指向它的关系会显示找不到文件。回收站保留 7 天，期间可以恢复。')
  await d.getByRole('button', { name: '移入回收站' }).click()
  await expect(toast(page, 'hero_idle.fbx 已移入回收站')).toBeVisible()
  await expect(type(page, 'missing-file')).toHaveCount(0)
})

test('被当成同一个资产：「其实这个才是原件…」说明谁是原件，可对调或确认', async ({ page }) => {
  await open(page)
  await row(page, 'duplicate-guid').getByRole('button', { name: '其实这个才是原件…' }).click()
  const d = dialog(page)
  await expect(d).toContainText('哪一个是原件？')
  await expect(d).toContainText(/系统判定 btn_buy\.png 是原件：它创建得更早，而且有 \d+ 个资产引用它。/)
  await expect(d.locator('.w2-pair')).toContainText('btn_buy.png原件')
  await expect(d.locator('.w2-pair')).toContainText('btn_buy (1).png新身份')
  await expect(d.getByRole('button', { name: '对调' })).toBeVisible()
  await d.getByRole('button', { name: '没错，确认' }).click()
  await expect(toast(page, '已确认 btn_buy.png 是原件')).toBeVisible()
  await expect(type(page, 'duplicate-guid')).toHaveCount(0)
})

test('两份记录不一致：「保留哪一份记录？」，保留本机这份', async ({ page }) => {
  await open(page)
  await row(page, 'metadata-conflict').getByRole('button', { name: '选择保留哪一份…' }).click()
  const d = dialog(page)
  await expect(d).toContainText('保留哪一份记录？')
  await expect(d).toContainText('两份记录的标签不一样。保留一份后，另一份会移入回收站。')
  await expect(d.locator('.w2-pair > div').nth(0)).toContainText('本机这份')
  await expect(d.locator('.w2-pair > div').nth(1)).toContainText('冲突副本')
  await expect(d.locator('.w2-pair')).toContainText('原型稿')
  await expect(d.getByRole('button', { name: '保留冲突副本' })).toBeVisible()
  await d.getByRole('button', { name: '保留本机这份' }).click()
  await expect(toast(page, '已保留本机这份，冲突副本移入回收站')).toBeVisible()
  await expect(type(page, 'metadata-conflict')).toHaveCount(0)
})

test('上游已更新：替换内容… 打开替换对话框；确认已复核', async ({ page }) => {
  await open(page)
  await row(page, 'stale-upstream').getByRole('button', { name: '替换内容…' }).click()
  await expect(dialog(page)).toContainText('替换 chest_icon.png 为新版本')
  await dialog(page).getByRole('button', { name: '取消' }).click()
  await row(page, 'stale-upstream').getByRole('button', { name: '确认已复核' }).click()
  await expect(toast(page, '已复核，记下了 chest.glb v2')).toBeVisible()
  await expect(type(page, 'stale-upstream')).toHaveCount(0)
})

test('内容重复：标为副本', async ({ page }) => {
  await open(page)
  await row(page, 'duplicate-content').getByRole('button', { name: '标为副本' }).click()
  await expect(toast(page, /已把 panel_bg\.png 标为 panel_bg\.png 的副本/)).toBeVisible()
  await expect(type(page, 'duplicate-content')).toHaveCount(0)
})

test('缺少插件：去安装 → 设置的插件页', async ({ page }) => {
  await open(page)
  await row(page, 'plugin-missing').getByRole('button', { name: '去安装' }).click()
  await expect(page).toHaveURL(/\/settings\/plugins\?focus=community\.spine/)
})

test('处理失败 / 手动缩略图过时 / 只有元数据文件：行文字；「查看错误」对话框（阶段、插件、错误、时间）可重试', async ({ page }) => {
  const icon = await idOf(bb, 'ui/icons/icon_coin.png')
  const extra = [
    { id: 'pipeline-failed:x1', type: 'pipeline-failed', level: 'warning', assetId: icon, path: 'ui/icons/icon_coin.png', foundAt: new Date().toISOString(), details: { stage: 'probe', plugin: 'bowerbird.image', error: '读取超时' } },
    { id: 'thumbnail-stale:x2', type: 'thumbnail-stale', level: 'info', assetId: icon, path: 'ui/icons/icon_coin.png', foundAt: new Date().toISOString(), details: { thumbVersion: 1, contentVersion: 2 } },
    { id: 'orphan-sidecar:x3', type: 'orphan-sidecar', level: 'warning', path: 'ui/icons/old_icon.png.bmeta', foundAt: new Date().toISOString(), details: { name: 'old_icon.png' } }
  ]
  await page.route(/\/api\/v1\/libraries\/[^/]+\/issues(\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const r = await route.fetch()
    const j = await r.json()
    j.issues.push(...extra)
    j.total += extra.length
    await route.fulfill({ response: r, json: j })
  })
  let resolved: unknown = null
  await page.route(/\/api\/v1\/libraries\/[^/]+\/issues\/pipeline-failed%3Ax1\/resolve$/, async route => {
    resolved = route.request().postDataJSON()
    await route.fulfill({ json: { resolved: ['pipeline-failed:x1'], failed: [] } })
  })
  await open(page)
  const failed = row(page, 'pipeline-failed', 'icon_coin.png')
  await expect(failed).toContainText('提取信息失败：读取超时')
  await expect(failed.locator('.w2-it__acts button')).toHaveText(['查看错误', '重试'])
  await expect(row(page, 'thumbnail-stale').locator('.w2-it__acts button')).toHaveText(['清除手动缩略图', '重新截图'])
  await expect(row(page, 'orphan-sidecar')).toContainText('只有元数据文件，找不到 old_icon.png 本身')
  await expect(row(page, 'orphan-sidecar').locator('.w2-it__acts button')).toHaveText(['重新定位文件…', '移入回收站'])
  await failed.getByRole('button', { name: '查看错误' }).click()
  const d = dialog(page)
  await expect(d).toContainText('处理失败：icon_coin.png')
  await expect(d.locator('pre')).toContainText('阶段  提取信息')
  await expect(d.locator('pre')).toContainText('插件  bowerbird.image')
  await expect(d.locator('pre')).toContainText('错误  读取超时')
  await expect(d.locator('pre')).toContainText(/时间  \d+ 月 \d+ 日/)
  await d.getByRole('button', { name: '重试' }).click()
  await expect(toast(page, '已重新排队，处理完会自动更新')).toBeVisible()
  expect(resolved).toMatchObject({ action: 'retry' })
})

test('加载中与出错（重试）', async ({ page }) => {
  await loadingThenError(page, /\/api\/v1\/libraries\/[^/]+\/issues(\?.*)?$/, () => page.goto(libPath(bb, '/issues')), page.locator('header').getByText(/条问题|完整性/).first())
})

test('没有问题：「资产库没有问题」空状态', async ({ page }) => {
  const empty = await startBB({ library: 'empty' })
  try {
    await page.goto(`${empty.url}/libraries/${encodeURIComponent(empty.lib)}/issues`)
    await expect(page.getByText('资产库没有问题')).toBeVisible()
    await expect(page.getByText('扫描会随时发现新问题，并显示在这里和左栏的「有问题」里。')).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: '级别' })).toHaveCount(0)
  } finally { await empty.stop() }
})
