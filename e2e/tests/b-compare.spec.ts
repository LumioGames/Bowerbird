import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { startBB, idOf, libPath } from '../helpers/b-server'
import { MOD, pngStats, toast } from '../helpers/b-ui'
import type { Bowerbird } from '../helpers/server'

/**
 * pages.md「对比页」: every pair in the table with its modes and states, both sides replaceable (version / related /
 * search), swap, the wipe divider (drag, ← / →, Shift, double-click, kept across modes) and the technical
 * information table (「B 相对 A」/「新减旧」). The sample has one decodable video, so a copy of it is added.
 */
let bb: Bowerbird
test.beforeAll(async () => {
  bb = await startBB()
  fs.copyFileSync(path.join(bb.root, 'props/chest/chest_open_preview.mp4'), path.join(bb.root, 'props/chest/chest_open_take2.mp4'))
  await expect.poll(async () => { try { return !!(await idOf(bb, 'props/chest/chest_open_take2.mp4')) } catch { return false } }, { timeout: 30_000 }).toBe(true)
})
test.afterAll(async () => { await bb?.stop() })

async function openCompare(page: Page, a: string, b: string, q = ''): Promise<void> {
  await page.goto(libPath(bb, `/compare?a=${await idOf(bb, a)}&b=${await idOf(bb, b)}${q}`))
  await expect(page.locator('.w2-cbar .w2-cpk')).toHaveCount(2)
}
const modes = (page: Page) => page.getByRole('radiogroup', { name: '对比方式' })
const mode = (page: Page, name: string) => modes(page).getByRole('radio', { name })
const stage = (page: Page) => page.locator('.w2-cstage')
const tech = (page: Page) => page.getByRole('table', { name: '技术信息' })
const picker = (page: Page, k: 'A' | 'B') => page.locator('.w2-cbar .w2-cpk').filter({ has: page.locator('.w2-cpk__k', { hasText: k }) })

/** Which modes are offered: [side, wipe, overlay, diff] → available? */
async function offered(page: Page): Promise<boolean[]> {
  return Promise.all(['并排', '卷帘', '叠加', '差异'].map(async n => (await mode(page, n).getAttribute('aria-disabled')) !== 'true'))
}
async function unavailableSays(page: Page, name: string, why: string) {
  // aria-disabled (so assistive tech hears it is not available) but clickable, to say why: Playwright treats
  // aria-disabled as not actionable, hence force
  await mode(page, name).click({ force: true })
  await expect(toast(page, why).last()).toBeVisible()
}

test.describe('每种组合与方式', () => {
  test('图片 · 图片：并排、卷帘、叠加、差异；差异画出不同的像素', async ({ page }) => {
    await openCompare(page, 'props/chest/chest_basecolor.png', 'props/chest/chest_basecolor_dark.png')
    await expect.poll(() => offered(page)).toEqual([true, true, true, true])
    await expect(mode(page, '并排')).toHaveAttribute('aria-checked', 'true')
    await mode(page, '卷帘').click()
    await expect(page).toHaveURL(/mode=wipe/)
    await expect(page.getByRole('slider', { name: '分界线' })).toBeVisible()
    await mode(page, '叠加').click()
    // (the SDK Slider puts aria-label on its root, not on the role=slider thumb)
    await expect(stage(page).locator('[aria-label="B 的不透明度"]')).toBeVisible()
    await mode(page, '差异').click()
    await expect(stage(page)).toContainText(/不同 \d+(\.\d)?%/, { timeout: 20_000 })
  })

  test('图片 · 图片：宽高比相差超过 5% 时差异不可用并说明「两张图的比例不一样，差异看不出东西」', async ({ page }) => {
    await openCompare(page, 'props/chest/chest_basecolor.png', 'environments/env_forest.png')
    await expect.poll(() => offered(page)).toEqual([true, true, true, false])
    await unavailableSays(page, '差异', '两张图的比例不一样，差异看不出东西')
    await expect(mode(page, '并排')).toHaveAttribute('aria-checked', 'true')
  })

  test('图片 · 图片：尺寸不同可按比例 / 原始像素对齐', async ({ page }) => {
    await openCompare(page, 'props/chest/chest_basecolor.png', 'props/chest/chest_concept.png')
    const align = stage(page).getByRole('radiogroup', { name: '对齐方式' })
    await expect(align.getByRole('radio')).toHaveText(['按比例', '原始像素'])
    await expect(align.getByRole('radio', { name: '按比例' })).toHaveAttribute('aria-checked', 'true')
    const before = pngStats(await stage(page).screenshot()).hash
    await align.getByRole('radio', { name: '原始像素' }).click()
    await expect.poll(async () => pngStats(await stage(page).screenshot()).hash).not.toBe(before)
  })

  test('视频 · 视频：并排、卷帘；同步播放与拖动，结束标记', async ({ page }) => {
    await openCompare(page, 'props/chest/chest_open_preview.mp4', 'props/chest/chest_open_take2.mp4')
    await expect.poll(() => offered(page)).toEqual([true, true, false, false])
    await unavailableSays(page, '叠加', '视频只能并排或卷帘')
    const videos = stage(page).locator('video')
    await expect(videos).toHaveCount(2)
    await stage(page).getByRole('button', { name: '播放' }).click()
    await expect.poll(async () => (await videos.evaluateAll(vs => vs.map(v => !(v as HTMLVideoElement).paused)))).toEqual([true, true])
    await stage(page).getByRole('button', { name: '暂停' }).click()
    // seeking on the shared timeline moves both
    const tl = stage(page).locator('.cursor-pointer.touch-none')
    const box = (await tl.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
    await expect.poll(async () => (await videos.evaluateAll(vs => vs.map(v => Math.round((v as HTMLVideoElement).currentTime * 10))))).toEqual(expect.arrayContaining([expect.any(Number)]))
    const times = await videos.evaluateAll(vs => vs.map(v => (v as HTMLVideoElement).currentTime))
    expect(Math.abs(times[0]! - times[1]!)).toBeLessThan(0.15)
    expect(times[0]!).toBeGreaterThan(0.2)
    await mode(page, '卷帘').click()
    await expect(page.getByRole('slider', { name: '分界线' })).toBeVisible()
  })

  test('视频 · 视频：长度不同时在时间轴上标出较短一侧的「结束」', async ({ page }) => {
    // the take2 copy is reported 1 s shorter (its duration is patched in the browser), so B ends first
    const take2 = await idOf(bb, 'props/chest/chest_open_take2.mp4')
    await page.addInitScript(id => {
      const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { const v = d.get!.call(this) as number; return (this as HTMLMediaElement).currentSrc.includes(id) ? Math.max(0.5, v - 1) : v } })
    }, take2)
    await openCompare(page, 'props/chest/chest_open_preview.mp4', 'props/chest/chest_open_take2.mp4')
    await expect(stage(page).locator('[title="B 结束"]')).toBeVisible()
  })

  test('音频 · 音频：上下对齐；A / B 切换保持位置', async ({ page }) => {
    await openCompare(page, 'audio/sfx/coin_pickup.wav', 'audio/sfx/ui_click.wav')
    await expect.poll(() => offered(page)).toEqual([true, false, false, false])
    await unavailableSays(page, '卷帘', '音频按上下两条波形对齐')
    await expect(stage(page).getByTitle('听 A')).toContainText('coin_pickup.wav')
    await expect(stage(page).getByTitle('听 B')).toContainText('ui_click.wav')
    const ear = stage(page).getByRole('radiogroup', { name: '正在听' })
    await expect(ear.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true')
    await stage(page).getByRole('button', { name: '播放' }).click()
    await page.waitForTimeout(150)
    await stage(page).getByRole('button', { name: '暂停' }).click()
    // the shared clock as seconds (mm:ss.cc)
    const pos = async () => { const [m, sec] = (await stage(page).locator('span.tabular-nums').filter({ hasText: / \/ / }).first().innerText()).split(' / ')[0]!.split(':'); return Number(m) * 60 + Number(sec) }
    const p0 = await pos()
    await stage(page).getByTitle('在 A 和 B 之间切换，位置不变').click()
    await expect(ear.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
    expect(Math.abs((await pos()) - p0)).toBeLessThan(0.1) // same place (within a frame or two of the clock)
  })

  test('模型 · 模型：并排（默认）、卷帘；视图预设；相机联动', async ({ page }) => {
    await openCompare(page, 'props/chest/chest.glb', 'props/potion/potion.glb')
    await expect.poll(() => offered(page)).toEqual([true, true, false, false])
    await unavailableSays(page, '叠加', '模型只能并排或卷帘')
    await expect(mode(page, '并排')).toHaveAttribute('aria-checked', 'true')
    const views = stage(page).getByRole('toolbar', { name: '视图' })
    await expect(views.getByRole('button')).toContainText(['透视', '正', '侧', '背', '顶'])
    const canvases = stage(page).locator('canvas')
    await expect(canvases.first()).toBeVisible()
    await page.waitForTimeout(1500)
    const a0 = pngStats(await canvases.nth(0).screenshot()).hash, b0 = pngStats(await canvases.last().screenshot()).hash
    await views.getByRole('button', { name: '顶' }).click()
    await expect(views.getByRole('button', { name: '顶' })).toHaveAttribute('aria-pressed', 'true')
    // both cameras move together
    await expect.poll(async () => pngStats(await canvases.nth(0).screenshot()).hash).not.toBe(a0)
    await expect.poll(async () => pngStats(await canvases.last().screenshot()).hash).not.toBe(b0)
    await mode(page, '卷帘').click()
    await expect(page.getByRole('slider', { name: '分界线' })).toBeVisible()
  })

  test('文本 · 文本：并排、合并差异；增删行数', async ({ page }) => {
    await openCompare(page, 'docs/naming_rules.md', 'docs/art_style_guide.md')
    await expect.poll(() => offered(page)).toEqual([true, false, false, true])
    await unavailableSays(page, '卷帘', '文本按行显示差异')
    await expect(stage(page)).toContainText(/\+\d+/)
    await expect(stage(page)).toContainText(/−\d+/)
    await mode(page, '差异').click()
    await expect(page).toHaveURL(/mode=diff/)
    await expect(stage(page).getByText('+', { exact: true }).first()).toBeVisible()
    await expect(stage(page).getByText('−', { exact: true }).first()).toBeVisible()
  })

  test('模型 · 有格子的四视图：卷帘（默认）、并排、叠加；按格子取视图；尺寸线与目标尺寸读数；宽高比；按高度 / 宽度对齐', async ({ page }) => {
    await openCompare(page, 'props/chest/chest.glb', 'props/chest/chest_turnaround.png')
    await expect.poll(() => offered(page)).toEqual([true, true, true, false])
    await expect(mode(page, '卷帘')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('slider', { name: '分界线' })).toBeVisible()
    await unavailableSays(page, '差异', '模型对照四视图不做像素差异')
    const views = stage(page).getByRole('toolbar', { name: '视图' })
    await expect(views.getByRole('button')).toHaveText(['正', '侧', '背', '顶'])
    await expect(views.getByRole('button', { name: '正' })).toHaveAttribute('aria-pressed', 'true')
    // aspect ratio: the sheet's cell against the model's front view (1.32 against 1.33 in the sample)
    const readout = stage(page).locator('[data-float]').filter({ hasText: '宽高比' })
    await expect(readout).toContainText(/宽高比\s*四视图\s*1\.3\d\s*模型\s*1\.3\d/)
    await expect(readout).toContainText(/尺寸\s*模型\s*1\.26 × 0\.95 m\s*目标\s*1\.26 × 0\.95 m\s*一致/)
    await expect(stage(page).locator('span[title^="宽："], span[title^="高："]').first()).toBeVisible()
    const before = pngStats(await stage(page).screenshot()).hash
    await views.getByRole('button', { name: '侧' }).click()
    await expect(views.getByRole('button', { name: '侧' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => pngStats(await stage(page).screenshot()).hash).not.toBe(before)
    // 对齐 sits in the compare bar, before「技术信息」(prototype compare.js `.copts`), not on the stage
    const fit = page.locator('.w2-cbar').getByRole('radiogroup', { name: '对齐方式' })
    await expect(stage(page).getByRole('radiogroup', { name: '对齐方式' })).toHaveCount(0)
    await expect(fit.getByRole('radio')).toHaveText(['按高度', '按宽度'])
    await fit.getByRole('radio', { name: '按宽度' }).click()
    await expect(fit.getByRole('radio', { name: '按宽度' })).toHaveAttribute('aria-checked', 'true')
    await mode(page, '叠加').click()
    await expect(stage(page).getByRole('slider', { name: '模型的不透明度' })).toBeVisible()
    await mode(page, '并排').click()
    await expect(mode(page, '并排')).toHaveAttribute('aria-checked', 'true')
    await expect(fit).toHaveCount(0) // side by side has nothing to align
  })

  test('模型 · 没有格子的图：只能并排，点卷帘 / 叠加提示「这张图没有格子信息，只能与模型并排」', async ({ page }) => {
    await openCompare(page, 'props/chest/chest.glb', 'props/chest/chest_concept.png')
    await expect.poll(() => offered(page)).toEqual([true, false, false, false])
    await expect(mode(page, '并排')).toHaveAttribute('aria-checked', 'true')
    await unavailableSays(page, '卷帘', '这张图没有格子信息，只能与模型并排')
    await unavailableSays(page, '叠加', '这张图没有格子信息，只能与模型并排')
    await expect(mode(page, '并排')).toHaveAttribute('aria-checked', 'true')
  })

  test('其他组合：两个查看器并排，其余方式说明原因', async ({ page }) => {
    await openCompare(page, 'props/chest/chest_concept.png', 'props/chest/chest_open.wav')
    await expect.poll(() => offered(page)).toEqual([true, false, false, false])
    // two viewers side by side, labelled A / B (with the version when the asset has several)
    await expect(stage(page).locator('.w2-cp')).toHaveCount(2)
    await expect(stage(page).locator('.w2-clab').nth(0)).toContainText(/^A/)
    await expect(stage(page).locator('.w2-clab').nth(1)).toContainText(/^B/)
    await expect(picker(page, 'A')).toContainText('chest_concept.png')
    await expect(picker(page, 'B')).toContainText('chest_open.wav')
    await expect(stage(page).locator('.w2-cp').nth(1).locator('[data-plugin="bowerbird.audio"]').first()).toBeVisible()
    await unavailableSays(page, '卷帘', '两侧格式不同，只能并排')
    // different kinds: no change column
    await expect(tech(page).locator('.w2-ct__lab').first()).toHaveText('')
  })
})

test.describe('公共', () => {
  test('两侧可换：版本 / 相关 / 搜索；选择器带阶段、校验、问题标记', async ({ page }) => {
    await openCompare(page, 'props/chest/chest.glb', 'props/chest/chest_turnaround.png')
    const a = picker(page, 'A')
    await expect(a).toContainText('chest.glb')
    await expect(a).toContainText('运行时')
    await expect(a.locator('.w2-cpk__v')).toHaveText('v2')
    await a.click()
    const menu = page.getByRole('menu').last()
    await expect(menu).toContainText('版本')
    // v1 has no saved content without a version plugin
    const v1 = menu.getByRole('menuitem', { name: /^v1 · / })
    await expect(v1).toHaveAttribute('aria-disabled', 'true')
    await expect(v1).toContainText('未保存')
    await expect(menu).toContainText('相关')
    await menu.getByRole('menuitem', { name: 'chest_basecolor.png' }).click()
    await expect(page).toHaveURL(new RegExp(`a=${await idOf(bb, 'props/chest/chest_basecolor.png')}`))
    await expect(picker(page, 'A')).toContainText('chest_basecolor.png')
    // 其他资产… opens the search picker
    await picker(page, 'B').click()
    await page.getByRole('menu').last().getByRole('menuitem', { name: '其他资产…' }).click()
    const dlg = page.getByRole('dialog').last()
    await expect(dlg).toContainText('换一个资产')
    await dlg.getByRole('textbox').first().fill('chest_normal')
    await dlg.getByRole('radio', { name: /chest_normal\.png/ }).first().dblclick()
    await expect(picker(page, 'B')).toContainText('chest_normal.png')
    // a side with an issue shows its mark
    await openCompare(page, 'props/chest/chest_icon.png', 'props/chest/chest_basecolor.png')
    await expect(picker(page, 'A').locator('[class*="issue"], [data-issue], svg').first()).toBeVisible()
  })

  test('交换两侧', async ({ page }) => {
    const x = await idOf(bb, 'props/chest/chest_basecolor.png'), y = await idOf(bb, 'props/chest/chest_concept.png')
    await openCompare(page, 'props/chest/chest_basecolor.png', 'props/chest/chest_concept.png')
    await page.getByRole('button', { name: '交换两侧' }).click()
    await expect(page).toHaveURL(new RegExp(`a=${y}&b=${x}`))
    await expect(picker(page, 'A')).toContainText('chest_concept.png')
    await expect(picker(page, 'B')).toContainText('chest_basecolor.png')
  })

  test('卷帘分界线：拖动、←/→（Shift 大步）、双击回到中间、换方式后位置保持', async ({ page }) => {
    await openCompare(page, 'props/chest/chest_basecolor.png', 'props/chest/chest_basecolor_dark.png', '&mode=wipe')
    const knob = page.getByRole('slider', { name: '分界线' })
    await expect(knob).toHaveAttribute('aria-valuenow', '50')
    await expect(knob).toHaveAttribute('title', '拖动分界线 · 双击回到中间')
    const s = (await stage(page).boundingBox())!
    const k = (await knob.boundingBox())!
    await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2)
    await page.mouse.down()
    await page.mouse.move(s.x + s.width * 0.25, k.y + k.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Number(await knob.getAttribute('aria-valuenow'))).toBeLessThan(35)
    await knob.dblclick()
    await expect(knob).toHaveAttribute('aria-valuenow', '50')
    await knob.focus()
    await page.keyboard.press('ArrowRight')
    await expect(knob).toHaveAttribute('aria-valuenow', '52')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(knob).toHaveAttribute('aria-valuenow', '62')
    await page.keyboard.press('ArrowLeft')
    await expect(knob).toHaveAttribute('aria-valuenow', '60')
    // the stage really splits there: the line sits at 60 % of the stage
    const line = (await page.locator('.w2-cw__line').boundingBox())!
    const pane = (await page.locator('.w2-cw').boundingBox())!
    expect(Math.abs((line.x + line.width / 2 - pane.x) / pane.width - 0.6)).toBeLessThan(0.02)
    // another mode and back: the position is kept
    await mode(page, '叠加').click()
    await mode(page, '卷帘').click()
    await expect(page.getByRole('slider', { name: '分界线' })).toHaveAttribute('aria-valuenow', '60')
  })

  test('技术信息表：不同资产是「B 相对 A」，差异高亮', async ({ page }) => {
    await openCompare(page, 'props/chest/chest_basecolor.png', 'props/chest/chest_concept.png')
    const t = tech(page)
    await expect(t.locator('.w2-ct__lab').first()).toHaveText('差值：B 相对 A')
    await expect(t.locator('.w2-ct__h')).toHaveCount(2)
    const w = t.locator('[data-row="width"][data-side="b"]')
    await expect(w).toHaveClass(/w2-ct__v--d/)
    await expect(w).toContainText('1,536')
    await expect(w.locator('.w2-ct__dl')).toHaveText('+512 · +50%')
    await expect(t.locator('[data-row="size"][data-side="b"] .w2-ct__dl')).toContainText(/^[+−]/)
    // the list button hides the table
    await page.getByRole('button', { name: '技术信息' }).click()
    await expect(t).toHaveCount(0)
  })

  test('技术信息表：同一资产两个版本是「新减旧」；没有版本插件时不能「恢复为当前版本…」', async ({ page }) => {
    const id = await idOf(bb, 'props/chest/chest.glb')
    await page.goto(libPath(bb, `/compare?a=${id}&b=${id}&av=1&bv=2`))
    await expect(tech(page).locator('.w2-ct__lab').first()).toHaveText('差值：新减旧')
    await expect(tech(page).locator('.w2-ct__h').nth(0)).toContainText('v1')
    await expect(tech(page).locator('.w2-ct__h').nth(1)).toContainText('v2 · 当前')
    await expect(page.getByRole('button', { name: /恢复为当前版本/ })).toHaveCount(0)
  })

  test('加载中（骨架）与出错（没有读到内容 + 原因）', async ({ page }) => {
    const a = await idOf(bb, 'props/chest/chest_basecolor.png')
    let mode: 'hold' | 'fail' = 'hold'
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    await page.route(new RegExp(`/api/v1/libraries/[^/]+/assets/${a}$`), async route => {
      if (mode === 'hold') await gate
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"服务出错了"}}' })
    })
    await page.goto(libPath(bb, `/compare?a=${a}&b=${await idOf(bb, 'props/chest/chest_concept.png')}`))
    await expect(page.locator('.w2-compare .w2-skel, .w2-compare [data-skeleton], .w2-compare .animate-pulse, .w2-compare [aria-busy]').first()).toBeVisible()
    mode = 'fail'
    release()
    await expect(page.locator('.w2-compare')).toContainText('没有读到内容', { timeout: 30_000 })
    await expect(page.locator('.w2-compare')).toContainText('服务出错了')
  })

  test('Esc / ⌘[ 关闭对比页回到来处', async ({ page }) => {
    await page.goto(libPath(bb, ''))
    await openCompare(page, 'props/chest/chest_basecolor.png', 'props/chest/chest_concept.png')
    await page.keyboard.press(`${MOD}+BracketLeft`)
    await expect(page).not.toHaveURL(/\/compare/)
  })
})
