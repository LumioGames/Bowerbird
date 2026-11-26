/**
 * pages.md 浏览页「上传」与外壳的操作流程: 上传（目标可改、继承的默认值、拖入文件夹保留结构、同名的三种选择与
 * 「对其余同名文件同样处理」、进度面板的取消 / 失败 / 重试）、导出对话框、复制、移动遇到同名、删除被引用的资产.
 */
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO, startBowerbird, type Bowerbird } from '../helpers/a-server'
import { alert, assetByPath, cell, contextMenu, dialog, grid, menuItem, MOD, openBrowse, toast, toolbar, waitAsset } from '../helpers/a-app'

let bb: Bowerbird
test.beforeEach(async () => { bb = await startBowerbird({ library: 'xingluo' }) })
test.afterEach(async () => { await bb?.stop() })

const BATCH = path.join(REPO, 'fixtures/upload-batch')
const file = (rel: string, name = path.basename(rel)) => ({ name, mimeType: /\.png$/.test(name) ? 'image/png' : 'application/octet-stream', buffer: fs.readFileSync(path.join(BATCH, rel)) })
const panel = (page: Page) => page.locator('div.fixed').filter({ has: page.locator('header') }).filter({ hasText: /正在上传|已上传|没有传完/ })

async function upload(page: Page, files: ReturnType<typeof file>[]) {
  const chooser = page.waitForEvent('filechooser')
  await toolbar(page).getByRole('button', { name: '上传' }).click()
  await (await chooser).setFiles(files)
}

/** Drop a folder from the desktop: a DataTransfer whose entries walk like the browser's (webkitGetAsEntry). */
async function dropFolder(page: Page, root: string, files: Array<{ rel: string; data: number[]; type: string }>) {
  await grid(page).evaluate((target, { root, files }) => {
    type Node = { name: string; dir: boolean; kids: Map<string, Node>; file?: File }
    const top: Node = { name: root, dir: true, kids: new Map() }
    for (const f of files) {
      const parts = f.rel.split('/')
      let n = top
      for (const p of parts.slice(0, -1)) { if (!n.kids.has(p)) n.kids.set(p, { name: p, dir: true, kids: new Map() }); n = n.kids.get(p)! }
      const name = parts[parts.length - 1]!
      n.kids.set(name, { name, dir: false, kids: new Map(), file: new File([new Uint8Array(f.data)], name, { type: f.type }) })
    }
    const entry = (n: Node): unknown => n.dir
      ? { isFile: false, isDirectory: true, name: n.name, createReader: () => { let done = false; return { readEntries: (ok: (e: unknown[]) => void) => { ok(done ? [] : [...n.kids.values()].map(entry)); done = true } } } }
      : { isFile: true, isDirectory: false, name: n.name, file: (ok: (f: File) => void) => ok(n.file!) }
    const dt = { types: ['Files'], files: [], items: [{ kind: 'file', webkitGetAsEntry: () => entry(top) }], getData: () => '' }
    const ev = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    target.dispatchEvent(ev)
  }, { root, files })
}

test.describe('上传', () => {
  test('对话框：目标文件夹可改；继承的阶段、标签、免审及来源文件夹；进度面板完成', async ({ page }) => {
    await openBrowse(page, bb, 'folder=references')
    await upload(page, [file('lantern_concept.png', 'ref_lantern.png'), file('lantern_normal.png', 'ref_lantern_normal.png')])
    const d = dialog(page, '上传 2 个文件')
    await expect(d).toBeVisible()
    await expect(d.getByRole('button', { name: /references/ })).toBeVisible()
    await expect(d.getByText('阶段、标签和免审来自 references 的默认值')).toBeVisible()
    await expect(d.getByRole('button', { name: /^参考/ })).toHaveAttribute('aria-pressed', 'true')
    // the stage chip「参考」and the inherited tag「参考」
    await expect(d.getByText('参考', { exact: true })).toHaveCount(2)
    await expect(d.getByRole('switch', { name: '免审' })).toHaveAttribute('aria-checked', 'true')
    await expect(d.getByText('ref_lantern.png')).toBeVisible()

    // change the target: props/chest hands down its own defaults
    await d.getByRole('button', { name: /references/ }).click()
    await page.getByRole('menuitemcheckbox', { name: 'props/chest' }).click()
    await expect(d.getByText('阶段、标签和免审来自 props/chest 的默认值')).toBeVisible()
    await expect(d.getByRole('button', { name: /^生产/ })).toHaveAttribute('aria-pressed', 'true')
    await d.getByRole('button', { name: '上传' }).click()

    await expect(page.getByText('已上传 2 个文件')).toBeVisible({ timeout: 20_000 })
    const a = await waitAsset(bb, 'props/chest/ref_lantern.png')
    expect(a.stage).toBe('production')
    // own uploads: no「新资产」pill
    await expect(page.getByRole('button', { name: /个新资产 · 显示/ })).toHaveCount(0)
  })

  test('拖入文件夹时保留结构：两个 icon_lantern.png 不冲突', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Flantern')
    const rd = (rel: string) => Array.from(fs.readFileSync(path.join(BATCH, 'export', rel)))
    await dropFolder(page, 'export', [
      { rel: 'ui/icon_lantern.png', data: rd('ui/icon_lantern.png'), type: 'image/png' },
      { rel: 'hud/icon_lantern.png', data: rd('hud/icon_lantern.png'), type: 'image/png' },
      { rel: 'v2/lantern_basecolor.png', data: rd('v2/lantern_basecolor.png'), type: 'image/png' }
    ])
    const d = dialog(page, '上传 3 个文件')
    await expect(d).toBeVisible()
    const keep = d.getByRole('switch', { name: '保留文件夹结构' })
    await expect(keep).toHaveAttribute('aria-checked', 'true')
    await expect(d.getByText('export/ui/')).toBeVisible()
    await d.getByRole('button', { name: '上传' }).click()
    await expect(page.getByText('已上传 3 个文件')).toBeVisible({ timeout: 20_000 })
    await waitAsset(bb, 'props/lantern/export/ui/icon_lantern.png')
    await waitAsset(bb, 'props/lantern/export/hud/icon_lantern.png')
    await waitAsset(bb, 'props/lantern/export/v2/lantern_basecolor.png')
  })

  test('重名：已经有一个 {名称}；跳过 · 保留两者 · 替换为新版本', async ({ page }) => {
    const orig = await assetByPath(bb, 'props/lantern/lantern_concept.png')
    const v0 = (await bb.api.assets.versions(bb.lib, orig.id)).versions.length
    await openBrowse(page, bb, 'folder=props%2Flantern')
    const count = async () => (await bb.api.search(bb.lib, { filter: { folder: 'props/lantern' }, limit: 100 } as never)).total

    const ask = async () => {
      await upload(page, [file('lantern_concept.png')])
      await dialog(page, '上传 1 个文件').getByRole('button', { name: '上传' }).click()
      const c = dialog(page, '已经有一个 lantern_concept.png')
      await expect(c).toBeVisible()
      await expect(c.getByText('现有的')).toBeVisible()
      await expect(c.getByText('新的')).toBeVisible()
      // only one name is taken: no「对其余同名文件同样处理」
      await expect(c.getByText('对其余同名文件同样处理')).toHaveCount(0)
      return c
    }
    let c = await ask()
    await c.getByRole('button', { name: '跳过' }).click()
    await expect(c).toBeHidden()
    expect(await count()).toBe(1)

    c = await ask()
    await c.getByRole('button', { name: '保留两者' }).click()
    await expect(page.getByText('已上传 1 个文件')).toBeVisible({ timeout: 20_000 })
    await expect.poll(count).toBe(2)

    c = await ask()
    await c.getByRole('button', { name: '替换为新版本' }).click()
    await expect.poll(async () => (await bb.api.assets.versions(bb.lib, orig.id)).versions.length).toBe(v0 + 1)
    expect(await count()).toBe(2)
  })

  test('「对其余同名文件同样处理」：选一次，其余同名的不再问', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await upload(page, [file('lantern_normal.png', 'chest_normal.png'), file('lantern_basecolor.png', 'chest_orm.png'), file('lantern_concept.png', 'chest_new.png')])
    await dialog(page, '上传 3 个文件').getByRole('button', { name: '上传' }).click()
    const c = dialog(page, '已经有一个 chest_normal.png')
    await expect(c).toBeVisible()
    await c.getByRole('checkbox').click()
    await expect(c.getByText('对其余同名文件同样处理')).toBeVisible()
    await c.getByRole('button', { name: '跳过' }).click()
    await expect(dialog(page, '已经有一个 chest_orm.png')).toHaveCount(0)
    await expect(page.getByText('已上传 1 个文件')).toBeVisible({ timeout: 20_000 })
    await waitAsset(bb, 'props/chest/chest_new.png')
  })

  test('进度面板：失败原因「连接断开」与重试、单个取消「已取消」、全部取消', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Flantern')
    let failOnce = true
    await page.route('**/api/v1/libraries/*/assets', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      const body = route.request().postData() ?? ''
      if (body.includes('lantern_light.wav') && failOnce) { failOnce = false; return route.abort('connectionreset') }
      return route.continue()
    })
    await upload(page, [file('lantern_light.wav'), file('lantern_normal.png', 'lantern_n2.png')])
    await dialog(page, '上传 2 个文件').getByRole('button', { name: '上传' }).click()
    const p = panel(page)
    await expect(p.getByText('1 个没有传完')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('连接断开')).toBeVisible()
    await p.getByRole('button', { name: '重试' }).click()
    await expect(page.getByText('已上传 2 个文件')).toBeVisible({ timeout: 20_000 })
    await waitAsset(bb, 'props/lantern/lantern_light.wav')
    await page.unroute('**/api/v1/libraries/*/assets')
    await expect(p).toBeHidden({ timeout: 10_000 })

    // hang every upload to cancel them
    await page.route('**/api/v1/libraries/*/assets', async route => { if (route.request().method() !== 'POST') return route.continue(); await new Promise(() => {}) })
    await upload(page, [file('lantern_concept.png', 'hang_a.png'), file('lantern_concept.png', 'hang_b.png'), file('lantern_concept.png', 'hang_c.png')])
    await dialog(page, '上传 3 个文件').getByRole('button', { name: '上传' }).click()
    await expect(p.getByText('正在上传')).toBeVisible()
    await expect(p).toContainText('0 / 3')
    await p.getByRole('button', { name: '取消 hang_a.png' }).click()
    await expect(p.getByText('已取消')).toHaveCount(1)
    await p.getByRole('button', { name: '全部取消' }).click()
    await expect(p.getByText('已取消')).toHaveCount(3)
  })
})

test.describe('导出', () => {
  test('导出…：去向、目录、引用的资产、文件列表与汇总；打包下载', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await contextMenu(page, cell(page, 'chest.glb'))
    await menuItem(page, '导出…').click()
    const d = dialog(page, '导出 chest.glb')
    await expect(d).toBeVisible()
    await expect(d.getByRole('radio', { name: '打包下载' })).toBeVisible()
    await expect(d.getByRole('radio', { name: '复制到文件夹' })).toBeVisible()
    await expect(d.getByRole('radio', { name: '保留目录' })).toBeVisible()
    await expect(d.getByRole('radio', { name: '放在一起' })).toBeVisible()
    await expect(d.getByText(/一起导出 \d+ 个/)).toBeVisible()
    await expect(d.getByText('props/chest/chest_basecolor.png')).toBeVisible()
    await expect(d.getByText(/^\d+ 个文件 · /)).toBeVisible()
    await d.getByRole('switch', { name: '连同引用的资产' }).click()
    await expect(d.getByText('props/chest/chest_basecolor.png')).toHaveCount(0)
    await expect(d.getByText(/^1 个文件 · /)).toBeVisible()
    await d.getByRole('switch', { name: '连同引用的资产' }).click()
    await d.getByRole('radio', { name: '放在一起' }).click()
    await expect(d.getByText('chest_basecolor.png', { exact: true })).toBeVisible()

    const dl = page.waitForEvent('download')
    await d.getByRole('button', { name: '下载 .zip' }).click()
    expect((await dl).suggestedFilename()).toBe('chest.zip')
    await expect(toast(page, /^开始下载 chest\.zip（\d+ 个文件，/)).toBeVisible()
  })

  test('复制到文件夹（只在本机）；换过对方的按位置名写出并注明「来自 {实际文件}」；可多选', async ({ page }) => {
    const chest = await assetByPath(bb, 'props/chest/chest.glb')
    const base = await assetByPath(bb, 'props/chest/chest_basecolor.png')
    const dark = await assetByPath(bb, 'props/chest/chest_basecolor_dark.png')
    await bb.api.relations.replace(bb.lib, chest.id, { type: 'uses', to: base.id, slot: 'chest_basecolor.png', newTo: dark.id })
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-a-export-'))
    try {
      await openBrowse(page, bb, 'folder=props%2Fchest')
      await contextMenu(page, cell(page, 'chest.glb'))
      await menuItem(page, '导出…').click()
      const d = dialog(page, '导出 chest.glb')
      await expect(d.getByText('来自 chest_basecolor_dark.png')).toBeVisible()
      await d.getByRole('radio', { name: '复制到文件夹' }).click()
      await d.getByRole('textbox', { name: '文件夹' }).fill(out)
      await d.getByRole('button', { name: '导出' }).click()
      await expect(toast(page, new RegExp(`^已导出 \\d+ 个文件到 `))).toBeVisible()
      expect(fs.existsSync(path.join(out, 'props/chest/chest.glb'))).toBe(true)
      expect(fs.readFileSync(path.join(out, 'props/chest/chest_basecolor.png')).equals(fs.readFileSync(path.join(bb.root, 'props/chest/chest_basecolor_dark.png')))).toBe(true)

      await cell(page, 'chest_open.wav').click()
      await cell(page, 'chest_icon.png').click({ modifiers: ['ControlOrMeta'] })
      await contextMenu(page, cell(page, 'chest_icon.png'))
      await menuItem(page, '导出…').click()
      await expect(dialog(page, '导出 2 个资产')).toBeVisible()
    } finally { fs.rmSync(out, { recursive: true, force: true }) }
  })
})

test.describe('复制、移动、删除', () => {
  test('复制（没被引用）：提示条「已复制为 {副本名}」，撤销删掉副本', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await cell(page, 'chest_open.wav').click()
    await page.keyboard.press(`${MOD}+d`)
    const t = toast(page, '已复制为 chest_open_1.wav')
    await expect(t).toBeVisible()
    await expect(t).not.toContainText('原来的引用')
    // own copy: no「新资产」pill
    await page.waitForTimeout(1800)
    await expect(page.getByRole('button', { name: /个新资产 · 显示/ })).toHaveCount(0)
    await waitAsset(bb, 'props/chest/chest_open_1.wav')
    await t.getByRole('button', { name: '撤销' }).click()
    await expect.poll(() => fs.existsSync(path.join(bb.root, 'props/chest/chest_open_1.wav'))).toBe(false)
  })

  test('移动遇到同名：{文件夹} 里已经有同名的文件；跳过同名的 · 替换（旧的进回收站）· 都保留', async ({ page }) => {
    await openBrowse(page, bb, 'folder=ui%2Fshop')
    const move = async () => {
      await contextMenu(page, cell(page, 'icon_coin.png'))
      await menuItem(page, '移动到…').click()
      const d = dialog(page, '移动 icon_coin.png')
      await d.getByRole('radio', { name: 'ui/icons' }).click()
      await d.getByRole('button', { name: '移动' }).click()
      const a = alert(page, 'ui/icons 里已经有同名的文件')
      await expect(a).toContainText('icon_coin.png 已经在那里了。')
      await expect(a.getByRole('button')).toHaveText(['取消', '跳过同名的', '替换（旧的进回收站）', '都保留'])
      return a
    }
    let a = await move()
    await a.getByRole('button', { name: '跳过同名的' }).click()
    await expect(a).toBeHidden()
    expect(fs.existsSync(path.join(bb.root, 'ui/shop/icon_coin.png'))).toBe(true)
    // nothing moved: it stays in the grid and no toast says it moved
    await page.waitForTimeout(800)
    await expect(cell(page, 'icon_coin.png')).toBeVisible()
    await expect(toast(page, '已把 1 个资产移到 ui/icons')).toHaveCount(0)

    a = await move()
    await a.getByRole('button', { name: '都保留' }).click()
    await expect(toast(page, '已把 1 个资产移到 ui/icons')).toBeVisible()
    await expect.poll(() => fs.readdirSync(path.join(bb.root, 'ui/icons')).filter(n => /^icon_coin.*\.png$/.test(n)).length).toBe(2)
  })

  test('删除被引用的资产：确认框说明依赖数并列出引用方；没被引用的另一种说法；撤销恢复', async ({ page }) => {
    await openBrowse(page, bb, 'folder=props%2Fchest')
    await cell(page, 'chest_basecolor.png').click()
    await page.keyboard.press('Delete')
    const a = alert(page, '把 chest_basecolor.png 移入回收站？')
    await expect(a).toContainText('有 1 个资产依赖它，删除后这些关系会指向找不到的文件。回收站保留 7 天，可以恢复。')
    await expect(a).toContainText('chest.glb')
    await expect(a).toContainText('props/chest/chest.glb')
    await expect(a.getByRole('button')).toHaveText(['取消', '移入回收站'])
    await a.getByRole('button', { name: '移入回收站' }).click()
    const t = toast(page, '已把 chest_basecolor.png 移入回收站')
    await expect(t).toBeVisible()
    await expect(cell(page, 'chest_basecolor.png')).toHaveCount(0)
    await t.getByRole('button', { name: '撤销' }).click()
    await expect.poll(() => fs.existsSync(path.join(bb.root, 'props/chest/chest_basecolor.png'))).toBe(true)

    await contextMenu(page, cell(page, 'chest_open.wav'))
    await menuItem(page, '移入回收站').click()
    await expect(alert(page, '把 chest_open.wav 移入回收站？')).toContainText('没有其他资产依赖它。回收站保留 7 天，期间可以恢复。')
  })
})
