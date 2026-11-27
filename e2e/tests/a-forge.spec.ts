/**
 * 创建插件（ADR-016, pages.md「创建插件」, Forge 示意 → fixtures/plugins/forge）: 新建菜单、参数表单、任务进度与取消、
 * 挑选 → 登记 → 出处带插件、输入是带角色的来源关系、右键「生成模型…」、详情页签、顶栏额度、左栏分区、插件设置页、两种故障；
 * 右键菜单里插件动作的插槽（「生成变体（Forge）」）.
 * Build the fixture plugin first: pnpm --filter @bowerbird-fixtures/plugin-forge build
 */
import { expect, test, type Page } from '../helpers/test'
import path from 'node:path'
import { REPO, startBowerbird, type Bowerbird } from '../helpers/a-server'
import { assetByPath, cell, contextMenu, dialog, inspector, libUrl, menuItem, openBrowse, sidebar, toast, toolbar, waitAsset, waitScanned } from '../helpers/a-app'

const FORGE = path.join(REPO, 'fixtures/plugins/forge')
let bb: Bowerbird

async function start(stepMs: number): Promise<Bowerbird> {
  const was = process.env.BB_FORGE_STEP_MS
  process.env.BB_FORGE_STEP_MS = String(stepMs)
  try { return await startBowerbird({ library: 'xingluo', plugins: [FORGE] }) } finally {
    if (was === undefined) delete process.env.BB_FORGE_STEP_MS; else process.env.BB_FORGE_STEP_MS = was
  }
}
test.afterEach(async () => { await bb?.stop() })

const newMenu = async (page: Page) => { await toolbar(page).getByRole('button', { name: /^新建/ }).click(); return page.getByRole('menu') }

/** Wait for「{方式}完成，挑出要留下的」, open 挑选…, keep the first `n`. Returns the registered names. */
async function pick(page: Page, creator: string, n: number) {
  const ready = toast(page, `${creator}完成，挑出要留下的`)
  await expect(ready).toBeVisible({ timeout: 45_000 })
  await ready.getByRole('button', { name: '挑选…' }).click()
  await expect(page).toHaveURL(/\/plugins\/community\.forge\/pick/)
  await expect(page.getByText('没选中的不进资产库，只在这台电脑上临时保留。')).toBeVisible()
  // the first candidate starts chosen; with none chosen the button says「至少选一个」
  const first = page.getByRole('checkbox', { name: '候选 1' })
  await expect(first).toHaveAttribute('aria-checked', 'true')
  await first.click()
  await expect(page.getByRole('button', { name: '至少选一个' })).toBeDisabled()
  for (let i = 1; i <= n; i++) await page.getByRole('checkbox', { name: `候选 ${i}` }).click()
  await expect(page.getByRole('button', { name: '稍后' })).toBeVisible()
  await page.getByRole('button', { name: `留下 ${n} 个` }).click()
}

test.describe('Forge（创建插件）', () => {
  test('新建菜单：「上传文件…」在前，后面是 Forge 的 AI 生图…、生成模型…；没有单独的「上传」', async ({ page }) => {
    bb = await start(40)
    await openBrowse(page, bb)
    await expect(toolbar(page).getByRole('button', { name: '上传', exact: true })).toHaveCount(0)
    const m = await newMenu(page)
    await expect(m.getByRole('menuitem')).toHaveText(['上传文件…', 'AI 生图…', '生成模型…'])
    await expect(m.getByText('Forge', { exact: true })).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await m.getByRole('menuitem', { name: '上传文件…' }).click()
    await chooser
  })

  test('AI 生图：参数表单（输入按角色、参数、放到、Forge 提供）→ 进度 → 挑选两个 → 登记的资产带出处（插件）、来源关系带角色', async ({ page }) => {
    bb = await start(40)
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await (await newMenu(page)).getByRole('menuitem', { name: 'AI 生图…' }).click()
    const d = dialog(page, 'AI 生图')
    await expect(d).toBeVisible()
    await expect(d.getByText('Forge 提供')).toBeVisible()
    await expect(d.getByText('参考图')).toBeVisible()
    await expect(d.getByText('可选')).toBeVisible()
    for (const label of ['提示词', '不想要的', '模型', '数量', '尺寸', '种子']) await expect(d.getByText(label, { exact: true })).toBeVisible()
    await expect(d.getByText('放到 props/chest')).toBeVisible()
    await d.getByRole('button', { name: '开始' }).click()
    await expect(d.getByRole('textbox', { name: '提示词' })).toHaveAttribute('data-invalid', 'true')
    await expect(d).toBeVisible()

    await d.getByRole('button', { name: /^选择…/ }).click()
    const picker = dialog(page, '选择参考图')
    await picker.getByRole('textbox', { name: '搜索' }).fill('chest_concept')
    await picker.getByRole('radio', { name: /chest_concept\.png/ }).click()
    await picker.getByRole('button', { name: '选择' }).click()
    await expect(d.getByText('chest_concept.png')).toBeVisible()
    await d.getByRole('textbox', { name: '提示词' }).fill('木质宝箱，暖色')
    await d.getByRole('radio', { name: '2', exact: true }).click()
    await d.getByRole('button', { name: '开始' }).click()
    const started = toast(page, '已开始AI 生图')
    await expect(started).toBeVisible()
    await expect(started.getByRole('button', { name: '查看任务' })).toBeVisible()

    await pick(page, 'AI 生图', 2)
    await expect(toast(page, /已登记/).first()).toBeVisible({ timeout: 20_000 })
    const items = (await bb.api.search(bb.lib, { filter: { folder: 'props/chest', method: ['community.forge/image'] }, limit: 50 } as never)).items
    expect(items).toHaveLength(2)
    const concept = await assetByPath(bb, 'props/chest/chest_concept.png')
    const made = await bb.api.assets.get(bb.lib, items[0]!.id)
    expect(made.provenance).toMatchObject({ method: 'community.forge/image', plugin: 'community.forge@0.4.0', prompt: '木质宝箱，暖色' })
    // the run's inputs are the outputs' source relations, with their roles (ADR-070); the two picked share a batch
    expect(made.relations.outgoing.filter(r => r.type === 'source')).toEqual([expect.objectContaining({ to: concept.id, role: '参考图' })])
    const other = await bb.api.assets.get(bb.lib, items[1]!.id)
    expect(other.provenance?.batch).toBeTruthy()
    expect(other.provenance?.batch).toBe(made.provenance?.batch)

    await page.goto(libUrl(bb, '?folder=props%2Fchest'))
    await cell(page, items[0]!.name).click()
    const rec2 = inspector(page)
    await expect(rec2.getByRole('button', { name: /^出处/ })).toBeVisible()
    await expect(rec2).toContainText('community.forge')
    await expect(rec2).toContainText('参考图')
    await expect(rec2).toContainText('chest_concept.png')
  })

  test('选中有格子的四视图，右键出现「生成模型…」；模型上没有；表单里四视图已填好；挑两个登记，输入角色「四视图」', async ({ page }) => {
    bb = await start(30)
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await contextMenu(page, cell(page, 'chest.glb'))
    await expect(page.getByRole('menuitem', { name: /^生成模型…/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await contextMenu(page, cell(page, 'chest_turnaround.png'))
    const item = menuItem(page, '生成模型…')
    await expect(item).toBeVisible()
    await expect(item).toContainText('Forge')
    await item.click()
    const d = dialog(page, '生成模型')
    await expect(d.getByText('四视图')).toBeVisible()
    await expect(d.getByText('chest_turnaround.png')).toBeVisible()
    await expect(d.getByText('设计对象')).toBeVisible()
    await d.getByRole('button', { name: '开始' }).click()
    await expect(toast(page, '已开始生成模型')).toBeVisible()
    await pick(page, '生成模型', 2)
    const made = await waitAsset(bb, 'props/chest/chest_forge_1.glb', 30_000)
    await waitAsset(bb, 'props/chest/chest_forge_2.glb')
    const turnaround = await assetByPath(bb, 'props/chest/chest_turnaround.png')
    const det = await bb.api.assets.get(bb.lib, made.id)
    expect(det.relations.outgoing.find(r => r.type === 'source' && r.to === turnaround.id)).toBeTruthy()
    expect(det.provenance).toMatchObject({ method: 'community.forge/model', plugin: 'community.forge@0.4.0' })
    expect(det.relations.outgoing).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'source', to: turnaround.id, role: '四视图' })]))
  })

  test('只有带格子的图才出现「生成模型…」（没有格子的图片不出现）', async ({ page }) => {
    // Forge's 四视图 input says `views: true`; AssetSummary.hasViews marks assets whose .bmeta has a view grid.
    bb = await start(30)
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await contextMenu(page, cell(page, 'chest_concept.png'))
    await expect(page.getByRole('menuitem', { name: /^生成模型…/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await contextMenu(page, cell(page, 'chest_turnaround.png'))
    await expect(page.getByRole('menuitem', { name: /^生成模型…/ })).toHaveCount(1)
  })

  test('任务进度与取消：顶栏后台处理里有这次生成，可以取消', async ({ page }) => {
    bb = await start(500)
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await contextMenu(page, cell(page, 'chest_turnaround.png'))
    await menuItem(page, '生成模型…').click()
    await dialog(page, '生成模型').getByRole('button', { name: '开始' }).click()
    await expect(toast(page, '已开始生成模型')).toBeVisible()
    const jobs = toolbar(page).getByRole('button', { name: '后台处理' })
    await expect(jobs).not.toHaveText('0')
    await jobs.click()
    const pop = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '后台处理' }) })
    const row = pop.locator('div').filter({ has: page.getByText('生成模型', { exact: true }) }).filter({ has: page.getByRole('button', { name: '取消' }) }).last()
    await expect(row).toBeVisible()
    await expect(row.getByRole('progressbar')).toBeVisible()
    await row.getByRole('button', { name: '取消' }).click()
    await expect(toast(page, '已取消生成模型')).toBeVisible()
    await expect.poll(async () => (await bb.api.jobs.overview(bb.lib)).creates.filter(j => j.status === 'running' || j.status === 'queued').length, { timeout: 20_000 }).toBe(0)
  })

  test('Forge 的详情页签、顶栏本月额度、左栏分区、插件设置页（每项标明随资产库或只在本机）', async ({ page }) => {
    bb = await start(30)
    await openBrowse(page, bb, 'folder=props%2Fchest')
    // top bar: quota
    const quota = toolbar(page).getByRole('button', { name: 'Forge' })
    await expect(quota).toBeVisible()
    await expect(quota).toContainText(/\d+/)
    await quota.click()
    await expect(page.getByText('Forge 本月额度')).toBeVisible()
    await page.keyboard.press('Escape')
    // side bar section
    await expect(sidebar(page).getByText('Forge', { exact: true })).toBeVisible()

    // one run so the tab has something to show
    await contextMenu(page, cell(page, 'chest_turnaround.png'))
    await menuItem(page, '生成模型…').click()
    const d = dialog(page, '生成模型')
    await d.getByRole('radio', { name: '1', exact: true }).click()
    await d.getByRole('button', { name: '开始' }).click()
    const made = await waitAsset(bb, 'props/chest/chest_forge.glb', 45_000)
    await expect(sidebar(page).getByRole('listitem').first()).toBeVisible()
    await page.goto(libUrl(bb, `/asset/${made.id}`))
    const tab = page.getByRole('tab', { name: 'Forge' })
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(page.getByText('Forge 的这次生成')).toBeVisible()
    await expect(page.getByRole('button', { name: '用同样的设置再生成…' })).toBeVisible()

    // plugin settings page
    await page.goto(libUrl(bb, '/settings'))
    await page.getByRole('navigation', { name: '设置' }).getByRole('button', { name: 'Forge' }).click()
    await expect(page).toHaveURL(/\/settings\/community\.forge/)
    for (const label of ['服务地址', '访问密钥', '默认模型', '产出放到']) await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('随资产库').first()).toBeVisible()
    await expect(page.getByText('只在本机').first()).toBeVisible()
  })

  test('设置的插件分区：缺少外部工具、连续失败（只警告不禁用）', async ({ page }) => {
    bb = await start(30)
    await waitScanned(bb)
    const turnaround = await assetByPath(bb, 'props/chest/chest_turnaround.png')
    const creators = (await bb.api.creators.list(bb.lib)).creators
    const model = creators.find(c => c.displayName === '生成模型')!

    // three failed creations in a row, before any page polls the plugin's routes
    await bb.api.plugins.putMachineSettings('community.forge', { simulate: 'unavailable' })
    for (let i = 0; i < 3; i++) {
      const j = await bb.api.creators.run(bb.lib, model.id, { params: {}, inputs: [{ role: '四视图', id: turnaround.id }] })
      await expect.poll(async () => (await bb.api.jobs.get(bb.lib, j.id)).status, { timeout: 20_000 }).toBe('failed')
    }
    const forge = async () => (await bb.api.plugins.list()).plugins.find(p => p.id === 'community.forge')!
    expect((await forge()).consecutiveFailures).toMatchObject({ count: 3 })
    await page.goto(libUrl(bb, '/settings/plugins'))
    await expect(page.getByText(/^最近 \d+ 次创建都失败了：.*服务没有响应（503）/)).toBeVisible({ timeout: 20_000 })

    await bb.api.plugins.putMachineSettings('community.forge', { simulate: 'missing-tool' })
    await bb.api.creators.run(bb.lib, model.id, { params: {}, inputs: [{ role: '四视图', id: turnaround.id }] }).catch(() => {})
    await expect.poll(async () => (await forge()).missingTools).toContain('forge-cli')
    await page.reload()
    await expect(page.getByText('需要外部工具 forge-cli，这台电脑上没找到')).toBeVisible({ timeout: 20_000 })
    expect((await bb.api.plugins.list()).plugins.find(p => p.id === 'community.forge')!.status).toBe('enabled')
  })

  test('右键菜单的插件动作：「生成变体（Forge）…」只对单个图片；参数表单；运行后登记一张改色图（来源关系、方式 community.forge/variant）', async ({ page }) => {
    bb = await start(30)
    await waitScanned(bb)
    const base = await assetByPath(bb, 'props/chest/chest_basecolor.png')
    let supported = true
    try { await bb.api.actions.forSelection(bb.lib, [base.id]) } catch { supported = false }
    test.fixme(!supported, '服务端还没有 GET /actions（插件动作的内核实现未合并）')

    await openBrowse(page, bb, 'folder=props%2Fchest')
    await contextMenu(page, cell(page, 'chest.glb'))
    await expect(page.getByRole('menuitem', { name: /生成变体（Forge）/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await contextMenu(page, cell(page, 'chest_basecolor.png'))
    const items = page.getByRole('menu').last().getByRole('menuitem')
    const names = await items.allTextContents()
    const at = names.findIndex(n => n.startsWith('生成变体（Forge）'))
    expect(at).toBeGreaterThan(names.findIndex(n => n.startsWith('导出…')))
    expect(at).toBe(names.length - 2)
    expect(names[names.length - 1]).toMatch(/^移入回收站/)
    await menuItem(page, '生成变体（Forge）…').click()
    const d = dialog(page, '生成变体（Forge）')
    await expect(d.getByText('Forge 提供')).toBeVisible()
    await expect(d.getByText('色相', { exact: true })).toBeVisible()
    await d.getByRole('radio', { name: '90', exact: true }).click()
    await d.getByRole('button', { name: '开始' }).click()
    await expect(toast(page, '已开始生成变体（Forge）')).toBeVisible()

    const v = await waitAsset(bb, 'props/chest/chest_basecolor_variant.png', 30_000)
    const det = await bb.api.assets.get(bb.lib, v.id)
    expect(det.relations.outgoing.find(r => r.type === 'source' && r.to === base.id)).toBeTruthy()
    expect(det.provenance).toMatchObject({ method: 'community.forge/variant', params: { hue: 90 } })
    expect(det.relations.outgoing.find(r => r.type === 'source' && r.to === base.id)?.role).toBe('原图')
  })
})
