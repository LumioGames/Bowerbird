/**
 * 「首次打开已有文件的文件夹」(pages.md 浏览页, copy.md 资产库, ADR-033): the explanation, formats no plugin reads,
 * registration progress that can stop, and the closing toast naming the plugins needed.
 */
import { expect, test } from '../helpers/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO, startBowerbird, type Bowerbird } from '../helpers/a-server'
import { grid, toast } from '../helpers/a-app'

/** Make every file look settled (the scanner leaves files written in the last 2 s for a later pass). */
function backdate(root: string): void {
  const t = new Date(Date.now() - 3600_000)
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p); else fs.utimesSync(p, t, t)
    }
  }
  walk(root)
}
function folders(root: string): number {
  let n = 0
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) { n++; walk(path.join(d, e.name)) } }
  walk(root)
  return n
}
function sidecars(root: string): number {
  let n = 0
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '.bowerbird') walk(p) } else if (e.name.endsWith('.bmeta') && e.name !== '_folder.bmeta') n++ } }
  walk(root)
  return n
}

let bb: Bowerbird | undefined
test.afterEach(async () => { await bb?.stop(); bb = undefined })

test('说明、缺插件的格式、开始后读取完成并提示需要的插件；网格直接出现这些资产；文件旁边不写 .bmeta（ADR-067）', async ({ page }) => {
  bb = await startBowerbird({ library: 'first-open' })
  backdate(bb.root)
  expect(sidecars(bb.root)).toBe(0)
  await page.goto(bb.url)

  const d = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `打开 ${bb.root}` }) })
  await expect(d).toBeVisible()
  await expect(d).toContainText('71')
  await expect(d).toContainText(`个文件 · ${folders(bb.root)} 个文件夹`)
  await expect(d.getByText('文件只被读取，原文件不改动。给文件记下标签、关系或出处后，它旁边才会多一个同名的 .bmeta。')).toBeVisible()
  await expect(d.getByRole('heading', { name: '还没有插件能读的格式' })).toBeVisible()
  const exts = d.getByRole('listitem')
  for (const ext of ['.hdr', '.skel', '.obj', '.blend', '.css', '.js']) await expect(exts.filter({ hasText: ext })).toHaveCount(1)
  await expect(exts.filter({ hasText: '.hdr' })).toContainText('2')
  await expect(d.getByText('这些文件照样收进资产库，装好插件后再生成预览。')).toBeVisible()
  await expect(d.getByRole('button', { name: '取消' })).toBeVisible()
  await d.getByRole('button', { name: '开始' }).click()
  await expect(d).toBeHidden()

  const done = toast(page, '已读取 71 个文件 · 6 种格式需要插件')
  await expect(done).toBeVisible({ timeout: 30_000 })
  // files nobody said anything about live in the index only: nothing is written beside them
  expect(sidecars(bb.root)).toBe(0)
  expect(fs.existsSync(path.join(bb.root, 'props/chest/chest.glb.bmeta'))).toBe(false)

  // the assets are on screen (own registration: no「有 N 个新资产」pill)
  await expect(grid(page).locator('[data-asset-cell]').first()).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => (await bb!.api.search(bb!.lib, { limit: 1 } as never)).total).toBe(71)
  await expect(page.getByRole('button', { name: /个新资产 · 显示/ })).toHaveCount(0)
  await expect(grid(page)).toBeVisible()

  await done.getByRole('button', { name: '查看' }).click()
  await expect(page).toHaveURL(/\/settings\/library/)
})

test('取消：什么都不写，下次打开还会问', async ({ page }) => {
  bb = await startBowerbird({ library: 'first-open' })
  backdate(bb.root)
  await page.goto(bb.url)
  const d = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `打开 ${bb.root}` }) })
  await expect(d).toBeVisible()
  await d.getByRole('button', { name: '取消' }).click()
  await expect(d).toBeHidden()
  await page.waitForTimeout(1500)
  expect(sidecars(bb.root)).toBe(0)
  expect((await bb.api.libraries.get(bb.lib)).state).toBe('uninitialized')
  await page.reload()
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `打开 ${bb.root}` }) })).toBeVisible()
})

test('读取进度可以停止：「已停止，读取了 N 个文件；下次打开会接着读取」', async ({ page }) => {
  test.setTimeout(180_000)
  const big = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-e2e-a-big-'))
  try {
    execFileSync(process.execPath, [path.join(REPO, 'fixtures/scripts/generate-100k.mjs'), path.join(big, 'lib'), '--count', '4000', '--force'], { stdio: 'ignore' })
    bb = await startBowerbird({ library: { dir: path.join(big, 'lib') } })
  } finally { fs.rmSync(big, { recursive: true, force: true }) }
  backdate(bb.root)
  await page.goto(bb.url)
  const d = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `打开 ${bb.root}` }) })
  await expect(d).toBeVisible()
  await expect(d).toContainText('4,000')
  await d.getByRole('button', { name: '开始' }).click()

  const panel = page.locator('div').filter({ has: page.getByText(`正在读取 ${path.basename(bb.root)}`, { exact: true }) }).filter({ has: page.getByRole('button', { name: '停止' }) }).last()
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(/\d[\d,]* \/ [\d,]+/)
  await panel.getByRole('button', { name: '停止' }).click()
  const stopped = toast(page, /^已停止，读取了 [\d,]+ 个文件；下次打开会接着读取$/)
  await expect(stopped).toBeVisible({ timeout: 30_000 })
  await expect(panel).toBeHidden()
  const n = Number((await stopped.textContent())!.match(/读取了 ([\d,]+) 个/)![1]!.replace(/,/g, ''))
  expect(n).toBeLessThan(4000)
})
