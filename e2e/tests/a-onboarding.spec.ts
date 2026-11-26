/**
 * 新手引导（onboarding.md, ADR-064, copy.md「新手引导」）: the browse-page tour, the first-visit hint of each page, the
 * new-file hints and the side bar's「帮助」menu. Hints are on in this file only (helpers/test.ts turns them off elsewhere).
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '../helpers/test'
import { REPO, startBowerbird, type Bowerbird } from '../helpers/a-server'
import { assetByPath, cell, inspector, libUrl, menuItem, openBrowse, openLibrary, sidebar, toolbar, viewRow, waitScanned } from '../helpers/a-app'
import { axeViolations } from '../helpers/axe'

test.use({ hints: true })

let bb: Bowerbird | undefined
test.afterEach(async () => { await bb?.stop(); bb = undefined })

const ALL_FORMATS = ['image', 'video', 'audio', 'model', 'doc'].map(f => `format:${f}`)
const bubble = (page: Page) => page.locator('[data-onboard-bubble]')
const ring = (page: Page) => page.locator('[data-onboard-ring]')
const button = (page: Page, name: string) => bubble(page).getByRole('button', { name, exact: true })

/** Start this tab with a given record (once: reloads keep what the page wrote since). */
async function preset(page: Page, record: object): Promise<void> {
  await page.addInitScript(r => {
    if (sessionStorage.getItem('bb-test-preset')) return
    sessionStorage.setItem('bb-test-preset', '1')
    localStorage.setItem('bowerbird.onboarding', r)
  }, JSON.stringify(record))
}

async function expectHint(page: Page, title: string, text: string, target?: Locator): Promise<void> {
  const b = bubble(page)
  await expect(b).toBeVisible()
  await expect(b).toHaveAttribute('aria-label', title)
  await expect(b).toContainText(text)
  if (target) await expectPointsAt(page, target)
}
/** The ring sits around the target (3 px outside it). */
async function expectPointsAt(page: Page, target: Locator): Promise<void> {
  await expect.poll(async () => {
    const [r, t] = await Promise.all([ring(page).boundingBox(), target.boundingBox()])
    if (!r || !t) return false
    return Math.abs(r.x - (t.x - 3)) <= 2 && Math.abs(r.y - (t.y - 3)) <= 2 && Math.abs(r.width - (t.width + 6)) <= 2
  }).toBe(true)
}
async function expectNoHint(page: Page): Promise<void> {
  await page.waitForTimeout(700)
  await expect(bubble(page)).toHaveCount(0)
}
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bowerbird.onboarding') ?? '{}') as { off?: boolean; tourDone?: boolean; seen?: string[] })

const BATCH = path.join(REPO, 'fixtures/upload-batch')
async function uploadOne(page: Page, name: string) {
  const chooser = page.waitForEvent('filechooser')
  await toolbar(page).getByRole('button', { name: '上传' }).click()
  await (await chooser).setFiles([{ name, mimeType: 'image/png', buffer: fs.readFileSync(path.join(BATCH, name)) }])
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '上传 1 个文件' }) }).getByRole('button', { name: '上传' }).click()
}

test('空资产库不出导览；有了第一个资产，五步导览从「待审」走到「设置」；之后换个地方出新文件提示，「打开看看」进详情', async ({ page }) => {
  bb = await startBowerbird({ library: 'empty' })
  await openLibrary(page, bb)
  await expect(page.getByText('把文件拖进来')).toBeVisible()
  await expectNoHint(page)

  await uploadOne(page, 'lantern_concept.png')
  await expect(cell(page, 'lantern_concept.png')).toBeVisible()

  await expectHint(page, '左栏', '按状态看：待审、有问题、回收站。下面是磁盘上的文件夹。', viewRow(page, 'pending'))
  await expect(bubble(page)).toContainText('1/5')
  await expect(page.locator('.bb-coach-hand')).toHaveCount(1)
  await button(page, '下一步').click()
  await expectHint(page, '网格', '双击打开，空格快速预览，右键看全部操作。', cell(page, 'lantern_concept.png'))
  await expect(bubble(page)).toContainText('2/5')
  await button(page, '下一步').click()
  await expectHint(page, '搜索与筛选', '按名字、标签、提示词找；筛选按阶段、格式、校验。', page.locator('[data-onboard="search"]'))
  await button(page, '下一步').click()
  // nothing was selected: the step selects the first asset so the inspector shows it
  await expect(cell(page, 'lantern_concept.png')).toHaveAttribute('aria-selected', 'true')
  await expectHint(page, '检查器', '选中一个资产，在这里改标签、阶段，看关系。', inspector(page).locator('[data-section="insp.tags"]'))
  await expect(bubble(page)).toContainText('4/5')
  await button(page, '下一步').click()
  await expectHint(page, '设置、标签、任务', '设置、标签管理、后台任务在这里。点 ? 可以再看这些提示。', sidebar(page).getByRole('button', { name: '设置', exact: true }))
  await expect(button(page, '下一步')).toHaveCount(0)
  // the「?」the sentence names is not covered by the bubble
  const help = (await sidebar(page).getByRole('button', { name: '帮助' }).boundingBox())!
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[aria-label="帮助"]'), [help.x + help.width / 2, help.y + help.height / 2])).toBe(true)
  await button(page, '完成').click()
  await expect(bubble(page)).toHaveCount(0)
  expect((await stored(page)).tourDone).toBe(true)

  // the new-file hint waits until the place changes
  await expectNoHint(page)
  await viewRow(page, 'pending').click()
  await expectHint(page, '图片', '能看单个通道、取色，平铺检查接缝。', cell(page, 'lantern_concept.png'))
  await button(page, '打开看看').click()
  await expect(page).toHaveURL(/\/asset\//)
  expect((await stored(page)).seen).toContain('format:image')

  // the detail page's first visit points at the「关系」tab; pressing it counts as seen and the next tab has its own
  const tabs = page.getByRole('tablist', { name: '详情' })
  await expectHint(page, '查看', '这里看文件本身；关系、版本、校验在这些页签里。', tabs.getByRole('tab', { name: /^关系/ }))
  await tabs.getByRole('tab', { name: /^关系/ }).click()
  await expectHint(page, '关系', '上游在左、下游在右；点节点走过去，拖线建立关系。', page.locator('[data-onboard="graph.center"]'))
  await button(page, '知道了').click()
  await expect(bubble(page)).toHaveCount(0)
  expect((await stored(page)).seen).toEqual(expect.arrayContaining(['page:detail.view', 'page:detail.rel']))

  // seen stays seen
  await page.reload()
  await expectNoHint(page)
  await page.goto(libUrl(bb))
  await expect(cell(page, 'lantern_concept.png')).toBeVisible()
  await expectNoHint(page)
})

test('Esc 跳过导览，各页提示照常；「帮助」菜单关掉、打开提示；点被指的按钮也算看过；重新看导览从第一步开始', async ({ page }) => {
  bb = await startBowerbird()
  await preset(page, { seen: ALL_FORMATS })
  await openBrowse(page, bb)
  await expectHint(page, '左栏', '按状态看：待审、有问题、回收站。下面是磁盘上的文件夹。')
  // a menu puts the bubble away until it closes
  await cell(page, 'chest.glb').click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(bubble(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expectHint(page, '左栏', '按状态看：待审、有问题、回收站。下面是磁盘上的文件夹。')
  // Esc does the page's own things first: the selection the right click made, then the tour
  await expect(cell(page, 'chest.glb')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(cell(page, 'chest.glb')).toHaveAttribute('aria-selected', 'false')
  await expect(bubble(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bubble(page)).toHaveCount(0)
  expect((await stored(page)).tourDone).toBe(true)

  // skipping the tour does not turn the page hints off
  await page.goto(libUrl(bb, '/trash'))
  const restore = page.locator('[data-trash]').first().getByRole('button', { name: '恢复', exact: true })
  await expectHint(page, '回收站', '删掉的资产在这里留 7 天，可以恢复。', restore)

  // 关掉提示: the bubble goes at once and nothing shows anywhere
  await sidebar(page).getByRole('button', { name: '帮助' }).click()
  await menuItem(page, '关掉提示').click()
  await expect(bubble(page)).toHaveCount(0)
  await page.goto(libUrl(bb, '/settings'))
  await expectNoHint(page)
  expect((await stored(page)).off).toBe(true)

  // 打开提示: the unseen ones come back
  await sidebar(page).getByRole('button', { name: '帮助' }).click()
  await menuItem(page, '打开提示').click()
  const machine = page.locator('[data-onboard="set.machine"]')
  await expectHint(page, '设置', '你的名字、语言、主题在这里；其余随资产库走。', machine)
  // pressing what the hint points at counts as seeing it
  await machine.click()
  await expect(bubble(page)).toHaveCount(0)
  await page.reload()
  await expectNoHint(page)
  await page.goto(libUrl(bb, '/trash'))
  await expectHint(page, '回收站', '删掉的资产在这里留 7 天，可以恢复。')
  await button(page, '知道了').click()
  await page.reload()
  await expectNoHint(page)

  // 重新看导览: back to the browse page, from the first step, and the page hints are new again
  await sidebar(page).getByRole('button', { name: '帮助' }).click()
  await menuItem(page, '重新看导览').click()
  await expect(page).toHaveURL(new RegExp(`/libraries/${bb.lib}$`))
  await expectHint(page, '左栏', '按状态看：待审、有问题、回收站。下面是磁盘上的文件夹。')
  await expect(bubble(page)).toContainText('1/5')
  expect(await stored(page)).toMatchObject({ off: false, tourDone: false, seen: [] })
  await button(page, '跳过').click()
  await page.goto(libUrl(bb, '/trash'))
  await expectHint(page, '回收站', '删掉的资产在这里留 7 天，可以恢复。')
})

test('各页第一次打开时指着最主要的按钮：详情的四个页签、对比、校验队列、完整性、标签；第二次不再出现', async ({ page }) => {
  bb = await startBowerbird()
  await waitScanned(bb)
  await preset(page, { tourDone: true, seen: ALL_FORMATS })
  const chest = await assetByPath(bb, 'props/chest/chest.glb')
  const concept = await assetByPath(bb, 'props/chest/chest_concept.png')
  const basecolor = await assetByPath(bb, 'props/chest/chest_basecolor.png')
  const tabs = page.getByRole('tablist', { name: '详情' })
  const tab = (name: string) => tabs.getByRole('tab', { name: new RegExp(`^${name}`) })

  await page.goto(libUrl(bb, `/asset/${chest.id}`))
  await expectHint(page, '查看', '这里看文件本身；关系、版本、校验在这些页签里。', tab('关系'))
  await button(page, '知道了').click()
  await expect(bubble(page)).toHaveCount(0)
  await tab('关系').click()
  await expectHint(page, '关系', '上游在左、下游在右；点节点走过去，拖线建立关系。', page.locator('[data-onboard="graph.center"]'))
  await button(page, '知道了').click()
  await tab('版本').click()
  await expectHint(page, '版本', '装上版本插件，才能预览和恢复旧版本。', page.getByRole('button', { name: '选择版本插件…' }))
  await button(page, '知道了').click()
  await tab('校验').click()
  await expectHint(page, '校验', '通过还是打回由人决定，自动检查只供参考。', page.locator('[data-onboard="rev.pass"]'))
  await button(page, '知道了').click()

  await page.goto(libUrl(bb, `/compare?a=${concept.id}&b=${basecolor.id}`))
  await expectHint(page, '对比', '换对比方式；卷帘的分界线可以拖。', page.getByRole('radiogroup', { name: '对比方式' }))
  await button(page, '知道了').click()

  await page.goto(libUrl(bb, '/review'))
  await expectHint(page, '校验队列', '通过后自动下一个；打回要写意见。', page.locator('[data-onboard="queue.pass"]'))
  await button(page, '知道了').click()

  await page.goto(libUrl(bb, '/issues'))
  await expectHint(page, '完整性', '每条问题右边就是处理办法。', page.locator('[data-onboard="issues.fix"]').first())
  await button(page, '知道了').click()

  await page.goto(libUrl(bb, '/tags'))
  const more = page.locator('[data-onboard="tags.more"]').first()
  await expectHint(page, '标签', '改名、合并在这里；拖动标签可以放进分组。', more)
  // pressing what it points at counts, even though this button opens its menu on pointer down
  await more.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expectNoHint(page)

  expect((await stored(page)).seen).toEqual(expect.arrayContaining(
    ['page:detail.view', 'page:detail.rel', 'page:detail.ver', 'page:detail.rev', 'page:compare', 'page:queue', 'page:issues', 'page:tags']))
  for (const p of [`/asset/${chest.id}`, `/asset/${chest.id}?tab=rel`, `/asset/${chest.id}?tab=ver`, `/asset/${chest.id}?tab=rev`, `/compare?a=${concept.id}&b=${basecolor.id}`, '/review', '/issues', '/tags']) {
    await page.goto(libUrl(bb, p))
    await expectNoHint(page)
  }
})

test('新文件提示：一类只出一次；关掉后同一个地方不再出下一类，换了地方才出；打开过的那类不再提示', async ({ page }) => {
  bb = await startBowerbird()
  await waitScanned(bb)
  // images and documents already seen; a video is opened before its hint could show
  await preset(page, { tourDone: true, seen: ['format:image', 'format:doc'] })
  const video = await assetByPath(bb, 'props/chest/chest_open_preview.mp4')
  await page.goto(libUrl(bb, `/asset/${video.id}`))
  await expect(page.getByRole('tablist', { name: '详情' })).toBeVisible()
  await expect.poll(async () => (await stored(page)).seen).toContain('format:video')

  // props/chest has a model and a sound: one of them first, in reading order
  await page.goto(libUrl(bb, '?folder=props%2Fchest'))
  await expect(bubble(page)).toBeVisible()
  const first = await bubble(page).getAttribute('aria-label')
  expect(['音频', '3D 模型']).toContain(first)
  const TEXT = { '音频': '按空格试听；能看波形和频谱，选一段循环。', '3D 模型': '能看通道、分屏，还能和四视图对照。' } as const
  const FORMAT = { '音频': 'audio', '3D 模型': 'model' } as const
  const second = first === '音频' ? '3D 模型' : '音频'
  await expectHint(page, first!, TEXT[first as keyof typeof TEXT], page.locator(`[data-asset-cell][data-format="${FORMAT[first as keyof typeof FORMAT]}"]`).first())
  await button(page, '知道了').click()
  // the other kind is on screen too, but waits for another place
  await expectNoHint(page)
  // another place, inside the page: a search
  await page.getByRole('combobox', { name: '搜索' }).fill('chest')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/q=chest/)
  await expectHint(page, second, TEXT[second], page.locator(`[data-asset-cell][data-format="${FORMAT[second]}"]`).first())
  await button(page, '知道了').click()
  // nothing for videos (one was opened), even in another place
  await page.goto(libUrl(bb, '?folder=props%2Fchest&q=open'))
  await expect(cell(page, 'chest_open_preview.mp4')).toBeVisible()
  await expectNoHint(page)
  expect((await stored(page)).seen).toEqual(expect.arrayContaining(['format:audio', 'format:model', 'format:video']))
})

test('截图：深色 / 浅色，1440 与 1100 宽；气泡没有读屏与对比度问题', async ({ page }) => {
  bb = await startBowerbird()
  await waitScanned(bb)
  const out = path.join(REPO, 'e2e/.artifacts/onboarding')
  fs.mkdirSync(out, { recursive: true })
  await page.goto(bb.url + '/favicon.ico').catch(() => {})
  const write = (record: object) => page.evaluate(r => localStorage.setItem('bowerbird.onboarding', r), JSON.stringify(record))
  for (const scheme of ['dark', 'light'] as const) {
    for (const width of [1440, 1100]) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width, height: 900 })
      await write({ seen: ALL_FORMATS })
      await openBrowse(page, bb)
      await expectHint(page, '左栏', '按状态看：待审、有问题、回收站。下面是磁盘上的文件夹。')
      await page.screenshot({ path: path.join(out, `tour-1-${scheme}-${width}.png`) })
      for (let i = 0; i < 3; i++) await button(page, '下一步').click()
      await expectHint(page, '检查器', '选中一个资产，在这里改标签、阶段，看关系。')
      await page.screenshot({ path: path.join(out, `tour-4-${scheme}-${width}.png`) })
      await button(page, '下一步').click()
      await expectHint(page, '设置、标签、任务', '设置、标签管理、后台任务在这里。点 ? 可以再看这些提示。')
      await page.screenshot({ path: path.join(out, `tour-5-${scheme}-${width}.png`) })
      if (scheme === 'dark' && width === 1440) expect(await axeViolations(page, '[data-onboard-bubble]')).toEqual([])
      await button(page, '完成').click()
      await page.goto(libUrl(bb, '/review'))
      await expectHint(page, '校验队列', '通过后自动下一个；打回要写意见。')
      await page.screenshot({ path: path.join(out, `queue-${scheme}-${width}.png`) })
      await write({ tourDone: true, seen: ALL_FORMATS.filter(f => f !== 'format:model') })
      await page.goto(libUrl(bb, '?folder=props%2Fchest'))
      await expectHint(page, '3D 模型', '能看通道、分屏，还能和四视图对照。')
      await page.screenshot({ path: path.join(out, `format-${scheme}-${width}.png`) })
    }
  }
})
