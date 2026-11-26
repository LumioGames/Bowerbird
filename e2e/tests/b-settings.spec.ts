import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { startBB, libPath } from '../helpers/b-server'
import { dialog, loadingThenError, toast } from '../helpers/b-ui'
import { REPO, type Bowerbird } from '../helpers/server'

/**
 * pages.md「设置」: 资产库、本机、Agent 接入、插件、插件设置、任务, each with its states. Forge (fixtures/plugins/forge)
 * is installed through「安装插件…」; a plugin whose activate() throws gives「加载失败」. States that need npm or a
 * plugin's history (an update, missing tools, repeated failures) are added to the GET /plugins response.
 */
let bb: Bowerbird
const FORGE = path.join(REPO, 'fixtures/plugins/forge')
let broken = ''
test.beforeAll(async () => {
  process.env.BB_FORGE_STEP_MS = '3000' // slow fake generation: the creation job is still running when the page looks
  bb = await startBB({ host: null }) // no --host: a command-line host would hide the saved one (see the fixme below)
  broken = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-b-broken-'))
  fs.writeFileSync(path.join(broken, 'package.json'), JSON.stringify({
    name: 'bowerbird-plugin-broken', version: '0.1.0', type: 'module',
    bowerbird: { id: 'community.broken', displayName: 'Broken', apiVersion: 1, server: './server.js', contributes: {} }
  }))
  fs.writeFileSync(path.join(broken, 'server.js'), "export default { activate() { throw new Error('初始化失败：找不到配置文件 broken.toml') } }\n")
})
test.afterAll(async () => { await bb?.stop(); if (broken) fs.rmSync(broken, { recursive: true, force: true }) })

const open = async (page: Page, section = 'library') => { await page.goto(libPath(bb, `/settings/${section}`)); await expect(page.locator('.w2-st__body h2')).toBeVisible() }
const nav = (page: Page) => page.getByRole('navigation', { name: '设置' })
const body = (page: Page) => page.locator('.w2-st__body')
const row = (page: Page, id: string) => body(page).locator(`[data-row="${id}"]`)
const plugin = (page: Page, id: string) => body(page).locator(`[data-plugin="${id}"]`)

test('左侧导航：资产库、本机、Agent 接入、插件、任务，再是「插件设置」下每个启用且有设置的插件；插件需要处理时有提示点', async ({ page }) => {
  await open(page)
  const items = nav(page).locator('.w2-st__n')
  await expect(items.nth(0)).toHaveText('资产库')
  await expect(items.nth(1)).toHaveText('本机')
  await expect(items.nth(2)).toHaveText('Agent 接入')
  await expect(items.nth(3)).toHaveText('插件')
  await expect(items.nth(4)).toHaveText('任务')
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'page')
  await expect(nav(page).locator('.w2-st__nl')).toHaveText('插件设置')
  await expect(nav(page).getByRole('button', { name: /3D 模型|模型/ })).toBeVisible()
  // community.spine is needed but not installed
  await expect(items.nth(3).locator('[aria-label="有插件需要处理"]')).toBeVisible()
  await items.nth(1).click()
  await expect(page).toHaveURL(/\/settings\/machine$/)
  await expect(body(page).locator('h2')).toContainText('本机')
})

test('资产库：名称（不能为空）、默认物料阶段、回收站保留天数（校验）、缓存与清理、需要的插件（缺的标黄）', async ({ page }) => {
  await open(page)
  await expect(body(page).locator('h2')).toContainText('资产库')
  await expect(body(page).locator('h2 small')).toHaveText('存在资产库的 .bowerbird/ 里，所有人看到的都一样')
  const name = row(page, 'name').getByRole('textbox', { name: '资产库名称' })
  await expect(name).toHaveValue('星落镇')
  await name.fill('  ')
  await name.press('Enter')
  await expect(row(page, 'name').getByRole('alert')).toHaveText('名称不能为空')
  await name.fill('星落镇 2')
  await name.press('Enter')
  await expect.poll(async () => (await bb.api.libraries.get(bb.lib)).name).toBe('星落镇 2')
  await expect(row(page, 'name').getByRole('alert')).toHaveCount(0)
  await name.fill('星落镇')
  await name.press('Enter')
  await expect.poll(async () => (await bb.api.libraries.get(bb.lib)).name).toBe('星落镇')
  // default stage
  const stage = row(page, 'stage').getByRole('radiogroup', { name: '默认物料阶段' })
  await expect(stage.getByRole('radio')).toHaveText(['参考', '生产', '运行时'])
  await expect(stage.getByRole('radio', { name: '生产' })).toHaveAttribute('aria-checked', 'true')
  await expect(row(page, 'stage')).toContainText('文件夹自己设了默认值的，以文件夹为准')
  await stage.getByRole('radio', { name: '运行时' }).click()
  await expect.poll(async () => (await bb.api.libraries.get(bb.lib)).settings?.defaultStage).toBe('runtime')
  await stage.getByRole('radio', { name: '生产' }).click()
  // trash days (default 7), validated
  const days = row(page, 'trash').getByRole('textbox', { name: '回收站保留天数' })
  await expect(days).toHaveValue('7')
  await days.fill('0')
  await days.press('Enter')
  await expect(row(page, 'trash').getByRole('alert')).toHaveText('填 1 到 3650 之间的整数')
  await days.fill('14')
  await days.press('Enter')
  await expect.poll(async () => (await bb.api.libraries.get(bb.lib)).settings?.trashDays).toBe(14)
  await days.fill('7')
  await days.press('Enter')
  // cache
  await expect(row(page, 'cache')).toContainText('.bowerbird/cache/')
  await expect(row(page, 'cache')).toContainText('缩略图和预览，随资产库一起同步')
  await expect(row(page, 'cache')).toContainText(/\d+(\.\d+)? (B|KB|MB)/)
  await row(page, 'cache').getByRole('button', { name: '清理缓存…' }).click()
  const d = dialog(page)
  await expect(d).toContainText('清理缓存？')
  await expect(d).toContainText(/会删掉 .* 的缩略图和预览，资产本身不受影响。/)
  await d.getByRole('button', { name: '清理' }).click()
  await expect(toast(page, /^已清理缓存，腾出 /)).toBeVisible()
  // the plugins the library needs: the missing one in yellow, leading to 插件
  const chip = row(page, 'plugins').getByRole('button', { name: /community\.spine/ })
  await expect(chip).toContainText('未安装')
  await expect(chip).toHaveClass(/warn/)
  await chip.click()
  await expect(page).toHaveURL(/\/settings\/plugins\?focus=community\.spine/)
  await expect(plugin(page, 'community.spine')).toHaveClass(/w2-pl--focus/)
})

test('本机：你的名字（不填为「未署名」）、监听地址改成局域网先确认、确认后常驻警告；端口、定时扫描、并发、语言、主题', async ({ page }) => {
  await open(page, 'machine')
  await expect(body(page).locator('h2 small')).toHaveText('只影响这台电脑和这个浏览器')
  await expect(row(page, 'name').getByRole('textbox', { name: '你的名字' })).toHaveAttribute('placeholder', '未署名')
  await expect(row(page, 'name')).toContainText('不填时记为「未署名」')
  const listen = row(page, 'listen').getByRole('radiogroup', { name: '监听地址' })
  await expect(listen.getByRole('radio')).toHaveText(['只允许本机', '允许局域网'])
  await expect(listen.getByRole('radio', { name: '只允许本机' })).toHaveAttribute('aria-checked', 'true')
  await expect(row(page, 'listen').getByRole('textbox', { name: '端口' })).toHaveValue(/^\d+$/)
  // LAN: asks first; cancelling changes nothing
  await listen.getByRole('radio', { name: '允许局域网' }).click()
  let d = dialog(page)
  await expect(d).toHaveAttribute('role', 'alertdialog')
  await expect(d).toContainText('允许局域网里的其他电脑访问？')
  await expect(d).toContainText('Bowerbird 没有登录功能。打开后，同一网络里任何人都能读写整个资产库，也能安装插件。')
  await d.getByRole('button', { name: '取消' }).click()
  await expect(listen.getByRole('radio', { name: '只允许本机' })).toHaveAttribute('aria-checked', 'true')
  await expect(body(page).locator('.w2-st__warn')).toHaveCount(0)
  await listen.getByRole('radio', { name: '允许局域网' }).click()
  d = dialog(page)
  await d.getByRole('button', { name: '允许局域网访问' }).click()
  const warn = body(page).locator('.w2-st__warn')
  await expect(warn).toContainText('任何能访问这个地址的人，都能读写整个资产库')
  await expect(warn).toContainText('Bowerbird 没有登录功能。只在可信的局域网里打开，不要直接暴露到公网。现在的地址：')
  await expect(toast(page, '重启 Bowerbird 后生效')).toBeVisible()
  await expect.poll(async () => (await bb.api.config.get()).config.host).toBe('0.0.0.0')
  // back to local: no confirm, the warning goes
  await listen.getByRole('radio', { name: '只允许本机' }).click()
  await expect(warn).toHaveCount(0)
  await expect.poll(async () => (await bb.api.config.get()).config.host).toBe('127.0.0.1')
  // scan every 10 minutes (menu of steps)
  await row(page, 'scan').getByRole('button', { name: '每 10 分钟' }).click()
  await page.getByRole('menu').last().getByRole('menuitem', { name: '每 30 分钟' }).click()
  await expect(row(page, 'scan').getByRole('button', { name: '每 30 分钟' })).toBeVisible()
  await expect(row(page, 'concurrency').getByRole('slider', { name: '后台并发' })).toBeVisible()
  // language (ADR-061): follow the system by default (the browser here is zh-CN), then each language in its own name
  const lang = row(page, 'lang')
  await expect(lang).toContainText('界面语言')
  await expect(lang).toContainText('Language')
  await lang.getByRole('button', { name: '跟随系统（简体中文）' }).click()
  await expect(page.getByRole('menu').last().getByRole('menuitem')).toHaveText(['跟随系统（简体中文）', '简体中文', 'English', '日本語', '한국어'])
  await page.keyboard.press('Escape')
  const theme = row(page, 'theme').getByRole('radiogroup', { name: '主题' })
  await expect(theme.getByRole('radio')).toHaveText(['跟随系统', '深色', '浅色'])
  await theme.getByRole('radio', { name: '浅色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await theme.getByRole('radio', { name: '跟随系统' }).click()
})

test('Agent 接入：地址（可复制）、搜索的默认范围、名字约定、MCP 配置与命令行示例（可复制）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: bb.url })
  await open(page, 'agent')
  const url = `/api/v1/libraries/${bb.lib}`
  await expect(row(page, 'url')).toContainText(url)
  await row(page, 'url').getByRole('button', { name: '复制' }).click()
  await expect(toast(page, '已复制')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(url)
  const scope = row(page, 'scope').getByRole('radiogroup', { name: '搜索的默认范围' })
  await expect(scope.getByRole('radio')).toHaveText(['返回全部并标明状态', '只返回已通过和免审的'])
  await scope.getByRole('radio', { name: '只返回已通过和免审的' }).click()
  await expect.poll(async () => (await bb.api.libraries.get(bb.lib)).settings?.agentSearchScope).toBe('approved')
  await scope.getByRole('radio', { name: '返回全部并标明状态' }).click()
  await expect(row(page, 'agent-name')).toContainText('agent:<名字>')
  await expect(row(page, 'agent-name')).toContainText('每个 Agent 用自己的名字，留痕里分得清是谁')
  const mcp = body(page).getByLabel('MCP', { exact: true })
  const cfg = JSON.parse(await mcp.innerText())
  expect(cfg.mcpServers.bowerbird).toMatchObject({ command: 'bb', args: ['mcp', '--url', expect.stringContaining('http://'), '--library', bb.lib] })
  await expect(body(page).getByLabel('命令行', { exact: true })).toContainText('bb search')
})

test('插件：固定的安全说明；内置插件不能禁用；资产库需要但本机未安装（安装先确认）', async ({ page }) => {
  await open(page, 'plugins')
  await expect(body(page).locator('.w2-st__trust')).toHaveText('插件在本机以完全信任的方式运行，能读写资产库里的所有文件。只安装来源可信的插件。')
  await expect(body(page).locator('h2 small')).toContainText('每台电脑各自安装')
  const img = plugin(page, 'bowerbird.image')
  await expect(img).toContainText('内置')
  await expect(img.locator('.w2-pl__st')).toHaveText('已启用')
  await expect(img.getByRole('switch')).toHaveCount(0)
  await expect(img.locator('.w2-pl__caps')).toContainText('PNG')
  const spine = plugin(page, 'community.spine')
  await expect(spine.locator('.w2-pl__st')).toHaveText('资产库需要，本机未安装')
  await expect(spine).toContainText('资产库需要 ^1.4.0')
  await spine.getByRole('button', { name: '安装' }).click()
  const d = dialog(page)
  await expect(d).toContainText('安装 community.spine？')
  await expect(d).toContainText('来源：npm 包 community.spine ^1.4.0。插件在本机以完全信任的方式运行，能读写资产库里的所有文件。')
  await d.getByRole('button', { name: '取消' }).click()
})

test('插件：「安装插件…」填本机路径安装 Forge；禁用 / 启用；有设置的出现在「插件设置」', async ({ page }) => {
  await open(page, 'plugins')
  await body(page).getByRole('button', { name: '安装插件…' }).click()
  const d = dialog(page)
  await expect(d).toContainText('安装插件')
  await expect(d).toContainText('例如 @studio/bowerbird-spine 或 ~/plugins/my-checks')
  await expect(d).toContainText('插件在本机以完全信任的方式运行。只安装来源可信的插件。')
  await d.getByRole('textbox', { name: 'npm 包名，或本机上的文件夹路径' }).fill(FORGE)
  await d.getByRole('button', { name: '安装' }).click()
  await expect(toast(page, `已安装 ${FORGE}`)).toBeVisible({ timeout: 60_000 })
  const forge = plugin(page, 'community.forge')
  await expect(forge).toBeVisible()
  await expect(forge.locator('small.w2-mono')).toContainText('community.forge · 0.4.0')
  const sw = forge.getByRole('switch', { name: '启用 Forge' })
  if ((await sw.getAttribute('aria-checked')) !== 'true') { await sw.click(); await expect(toast(page, 'Forge 已启用')).toBeVisible() }
  await expect(forge.locator('.w2-pl__st')).toHaveText('已启用')
  await sw.click()
  await expect(toast(page, 'Forge 已禁用，它负责的格式暂时只显示文件信息')).toBeVisible()
  await expect(forge.locator('.w2-pl__st')).toHaveText('已禁用')
  await sw.click()
  await expect(toast(page, 'Forge 已启用')).toBeVisible()
  await expect(nav(page).getByRole('button', { name: 'Forge' })).toBeVisible()
  await forge.getByRole('button', { name: '插件设置' }).click()
  await expect(page).toHaveURL(/\/settings\/community\.forge$/)
})

test('插件设置：每项标明「随资产库」或「只在本机」，凭据只在本机且不回显；保存', async ({ page }) => {
  await open(page, 'plugins')
  await nav(page).getByRole('button', { name: 'Forge' }).click()
  await expect(page).toHaveURL(/\/settings\/community\.forge$/)
  await expect(body(page).locator('h2')).toContainText('Forge')
  const scopeOf = (id: string) => row(page, id).locator('.w2-st__scope')
  await expect(scopeOf('endpoint')).toHaveText('随资产库')
  await expect(scopeOf('defaultModel')).toHaveText('随资产库')
  await expect(scopeOf('outputFolder')).toHaveText('随资产库')
  await expect(scopeOf('apiKey')).toHaveText('只在本机')
  await expect(scopeOf('simulate')).toHaveText('只在本机')
  await expect(row(page, 'apiKey').locator('input')).toHaveAttribute('type', 'password')
  const ep = row(page, 'endpoint').getByRole('textbox', { name: '服务地址' })
  await expect(ep).toHaveValue('https://api.forge.example/v1')
  await ep.fill('https://forge.studio.lan/v1')
  await ep.press('Enter')
  await expect.poll(async () => (await bb.api.plugins.librarySettings(bb.lib, 'community.forge')).values.endpoint).toBe('https://forge.studio.lan/v1')
  await row(page, 'defaultModel').getByRole('combobox', { name: '默认模型' }).selectOption('forge-lite 1.3')
  await expect.poll(async () => (await bb.api.plugins.librarySettings(bb.lib, 'community.forge')).values.defaultModel).toBe('forge-lite 1.3')
  await row(page, 'apiKey').locator('input').fill('sk-test-123')
  await row(page, 'apiKey').locator('input').press('Enter')
  await expect.poll(async () => JSON.stringify((await bb.api.plugins.machineSettings('community.forge')).values)).not.toContain('sk-test-123')
  await nav(page).getByRole('button', { name: '资产库' }).click()
  await nav(page).getByRole('button', { name: 'Forge' }).click()
  await expect(row(page, 'apiKey').locator('input')).not.toHaveValue('sk-test-123')
  // the plugin's own settings page follows the form
  await expect(body(page).locator('.w2-st__card h3')).toBeVisible()
})

test('插件：缺少外部工具；连续失败只警告不禁用；有更新时「更新到 vX」先确认', async ({ page }) => {
  await page.route(/\/api\/v1\/plugins(\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const r = await route.fetch()
    const j = await r.json()
    for (const p of j.plugins) {
      if (p.id === 'community.forge') { p.update = { version: '0.5.0' }; p.missingTools = ['forge-cli']; p.consecutiveFailures = { count: 3, reason: '服务没有响应（503）' } }
    }
    await route.fulfill({ response: r, json: j })
  })
  await open(page, 'plugins')
  const forge = plugin(page, 'community.forge')
  await expect(forge).toContainText('需要外部工具 forge-cli，这台电脑上没找到')
  await expect(forge).toContainText('最近 3 次创建都失败了：服务没有响应（503）')
  await expect(forge.locator('.w2-pl__st')).toHaveText('已启用')
  await expect(forge.getByRole('switch', { name: '启用 Forge' })).toHaveAttribute('aria-checked', 'true')
  await expect(nav(page).locator('.w2-st__n').nth(3).locator('[aria-label="有插件需要处理"]')).toBeVisible()
  await forge.getByRole('button', { name: '更新到 0.5.0' }).click()
  const d = dialog(page)
  await expect(d).toContainText('把 Forge 更新到 0.5.0？')
  await expect(d).toContainText('更新时会短暂停用它，大约几秒钟。')
  await d.getByRole('button', { name: '取消' }).click()
})

test('插件：加载失败（原因 + 重新加载）', async ({ page }) => {
  // A plugin whose activate() throws, enabled for the library: GET /plugins reports it failed with the start-up error.
  await bb.api.plugins.install(broken)
  await bb.api.plugins.enable('community.broken', bb.lib)
  await open(page, 'plugins')
  const bad = plugin(page, 'community.broken')
  await expect(bad.locator('.w2-pl__st')).toHaveText('加载失败')
  await expect(bad.locator('.w2-pl__why')).toContainText('初始化失败：找不到配置文件 broken.toml')
  await bad.getByRole('button', { name: '重新加载' }).click()
  await expect(toast(page, /^Broken 仍然加载失败：/)).toBeVisible()
})

test('任务：管线阶段、扫描（上一次 / 立即扫描）、没有失败时的空状态；失败任务说明原因，单个 / 全部重试', async ({ page }) => {
  await open(page, 'tasks')
  await expect(body(page).locator('h2')).toContainText('任务')
  await expect(row(page, 'scan')).toContainText(/上一次 /)
  await row(page, 'scan').getByRole('button', { name: '立即扫描' }).click()
  await expect(toast(page, '已开始扫描')).toBeVisible()
  // nothing failed (a browser that met intro_cutscene.mov has reported failed renders by now: cleared here)
  await page.route(/\/api\/v1\/libraries\/[^/]+\/jobs$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const r = await route.fetch()
    await route.fulfill({ response: r, json: { ...(await r.json()), failed: [] } })
  })
  await page.reload()
  await expect(body(page)).toContainText('没有失败的任务')
  await page.unrouteAll({ behavior: 'wait' })
  // failed jobs: added to the response
  await page.route(/\/api\/v1\/libraries\/[^/]+\/jobs$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const r = await route.fetch()
    const j = await r.json()
    j.failed = [
      { id: 'job-1', kind: 'pipeline', status: 'failed', stage: 'thumbnail', assetName: 'world_map_16k.png', error: '图片太大，浏览器画不出来；换一张小一点的图', retryable: true },
      { id: 'job-2', kind: 'pipeline', status: 'failed', stage: 'probe', assetName: 'hero_run.skel', error: '需要 Spine 插件，本机没有安装', retryable: false }
    ]
    j.stages = [{ stage: 'thumbnail', queued: 3, running: 1, rate: 42, idle: false }, ...j.stages.filter((s: { stage: string }) => s.stage !== 'thumbnail')]
    await route.fulfill({ response: r, json: j })
  })
  let retried: unknown = null
  await page.route(/\/api\/v1\/libraries\/[^/]+\/jobs\/retry$/, async route => { retried = route.request().postDataJSON(); await route.fulfill({ json: { retried: 1 } }) })
  await page.reload()
  await expect(body(page).locator('[data-stage="thumbnail"]')).toContainText('4 个排队')
  await expect(body(page).locator('[data-stage="thumbnail"]')).toContainText('42 个/分')
  const f1 = body(page).locator('[data-failed="job-1"]')
  await expect(f1).toContainText('world_map_16k.png')
  await expect(f1).toContainText('图片太大，浏览器画不出来；换一张小一点的图')
  const f2 = body(page).locator('[data-failed="job-2"]')
  await expect(f2.getByRole('button', { name: '重试' })).toHaveCount(0)
  await expect(f2.getByRole('button', { name: '去安装' })).toBeVisible()
  await f1.getByRole('button', { name: '重试' }).click()
  await expect(toast(page, 'world_map_16k.png 已重新排队')).toBeVisible()
  expect(retried).toEqual({ jobIds: ['job-1'] })
  await body(page).getByRole('button', { name: '全部重试' }).click()
  await expect(toast(page, '1 个任务已重新排队')).toBeVisible()
  expect(retried).toEqual({ failed: true })
})

test('任务：创建任务的进度与取消', async ({ page }) => {
  const plugins = (await bb.api.plugins.list()).plugins.map(p => `${p.id}:${p.status}`)
  expect(plugins, 'Forge is still installed').toContain('community.forge:enabled')
  const c = (await bb.api.creators.list(bb.lib)).creators.find(x => x.pluginId === 'community.forge')!
  const job = await bb.api.creators.run(bb.lib, c.id, { params: { prompt: '提灯，黄铜，暖光' }, inputs: [] } as never)
  await open(page, 'tasks')
  const row1 = body(page).locator(`[data-job="${job.id}"]`)
  await expect(row1).toBeVisible()
  await expect(row1).toContainText(c.displayName)
  await expect(row1).toContainText('community.forge')
  await row1.getByRole('button', { name: '取消' }).click()
  await expect(toast(page, `已取消 ${c.displayName}`)).toBeVisible()
})

test('以 --host 启动时改监听地址：网页反映保存下来的选择并提示重启', async ({ page }) => {
  // GET/PATCH /config answer the saved config; --host only applies to this run, so saving 0.0.0.0 needs a restart
  const s = await startBB()
  try {
    await page.goto(`${s.url}/libraries/${encodeURIComponent(s.lib)}/settings/machine`)
    await page.getByRole('radiogroup', { name: '监听地址' }).getByRole('radio', { name: '允许局域网' }).click()
    await dialog(page).getByRole('button', { name: '允许局域网访问' }).click()
    await expect(toast(page, '重启 Bowerbird 后生效')).toBeVisible()
    await expect(page.locator('.w2-st__warn')).toContainText('任何能访问这个地址的人，都能读写整个资产库')
    await expect(page.getByRole('radiogroup', { name: '监听地址' }).getByRole('radio', { name: '允许局域网' })).toBeChecked()
  } finally { await s.stop() }
})

test('直接打开（或刷新）/settings/community.forge 进入插件设置', async ({ page }) => {
  // plugin ids have dots: the server still answers the page with the shell (only /assets/ and /api/ never fall back)
  const forge = (await bb.api.plugins.list()).plugins.find(p => p.id === 'community.forge')
  if (!forge) await bb.api.plugins.install(FORGE) // when this test runs on its own
  if (forge?.status !== 'enabled') await bb.api.plugins.enable('community.forge', bb.lib)
  await page.goto(libPath(bb, '/settings/community.forge'))
  await expect(page.locator('.w2-st__body h2')).toContainText('Forge')
  await page.reload()
  await expect(page.locator('.w2-st__body h2')).toContainText('Forge')
})

test('加载中与出错（重试）', async ({ page }) => {
  await loadingThenError(page, new RegExp(`/api/v1/libraries/${bb.lib}$`), () => page.goto(libPath(bb, '/settings/library')), body(page).locator('h2'))
})
