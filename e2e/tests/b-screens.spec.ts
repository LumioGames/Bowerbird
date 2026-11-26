import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { startBB, idOf, libPath } from '../helpers/b-server'
import { browseFolder, cell } from '../helpers/b-ui'
import { startPrototype } from '../helpers/prototype'
import { REPO, type Bowerbird } from '../helpers/server'

/**
 * 截图比对: the same sample library and state in the product and in the prototype (design/prototype), dark and light,
 * 1440×900 and 1100×800. Pairs and a side-by-side report go to e2e/.artifacts/compare/ (not committed). Each scenario
 * then compares the visible text and the role tree of the two pages (numbers, relative times and dates normalised),
 * and fails on any difference that is not in KNOWN below — every KNOWN entry says why it is allowed or which line has
 * to fix it.
 */
const OUT = path.join(REPO, 'e2e/.artifacts/compare')
const THEMES = ['dark', 'light'] as const
const SIZES = [[1440, 900], [1100, 800]] as const

let bb: Bowerbird
let proto: { url: string; stop(): Promise<void> }
const ids: Record<string, string> = {}
test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  bb = await startBB()
  proto = await startPrototype()
  for (const p of ['props/chest/chest.glb', 'props/chest/chest_turnaround.png']) ids[p] = await idOf(bb, p)
})
test.afterAll(async () => {
  await bb?.stop(); await proto?.stop()
  writeReport()
})

/* ───────────── scenarios ───────────── */

/** `scope`: where the text and roles are compared — the prototype keeps the browse page under its pages, detail view
 *  and compare view, so those are compared region to region (whole window otherwise). */
interface Scenario { id: string; title: string; app(page: Page): Promise<void>; proto(page: Page): Promise<void>; scope?: { app: string; proto: string } }
const PAGE_SCOPE = { app: 'section:has(> header.bb-chrome)', proto: '#page' }
const DETAIL_SCOPE = { app: '.w2-detail', proto: '#dbar, #detail' }
const P = (page: Page, js: string) => page.evaluate(js)
const glb = () => ids['props/chest/chest.glb']!
const protoCell = (page: Page) => page.locator(`#content [data-id="${glb()}"]`).first()

const SCENARIOS: Scenario[] = [
  { id: 'browse', title: '浏览页（props/chest）',
    app: async page => { await browseFolder(page, bb, 'props/chest') },
    proto: async page => { await P(page, `App.go({ type: 'folder', id: 'props/chest' })`) } },
  { id: 'inspector', title: '选中 chest.glb 的检查器',
    app: async page => { await browseFolder(page, bb, 'props/chest'); await cell(page, 'chest.glb').click() },
    proto: async page => { await P(page, `App.go({ type: 'folder', id: 'props/chest' })`); await protoCell(page).click() } },
  { id: 'detail', scope: DETAIL_SCOPE, title: 'chest.glb 详情 · 查看',
    app: async page => { await browseFolder(page, bb, 'props/chest'); await cell(page, 'chest.glb').dblclick(); await expect(page.locator('.w2-dh b')).toHaveText('chest.glb') },
    proto: async page => { await P(page, `App.go({ type: 'folder', id: 'props/chest' })`); await P(page, `App.openDetail('${glb()}', 'view')`) } },
  { id: 'graph', scope: DETAIL_SCOPE, title: 'chest.glb 关系图',
    app: async page => { await browseFolder(page, bb, 'props/chest'); await cell(page, 'chest.glb').dblclick(); await page.getByRole('tab', { name: /^关系/ }).click(); await expect(page.locator('.w2-rg')).toBeVisible() },
    proto: async page => { await P(page, `App.go({ type: 'folder', id: 'props/chest' })`); await P(page, `App.openDetail('${glb()}', 'rel')`) } },
  { id: 'compare-sheet', scope: { app: '.w2-compare', proto: '#compare' }, title: '对比 · 模型与四视图',
    app: async page => { await page.goto(libPath(bb, `/compare?a=${glb()}&b=${ids['props/chest/chest_turnaround.png']}`)); await expect(page.locator('.w2-cpk')).toHaveCount(2) },
    proto: async page => { await P(page, `App.compare({ id: '${glb()}' }, { id: '${ids['props/chest/chest_turnaround.png']}' })`) } },
  { id: 'review', scope: PAGE_SCOPE, title: '校验队列',
    // the prototype's queue starts at the selected asset (chest.glb): start the product's there too
    app: async page => { await page.goto(libPath(bb, `/review?start=${glb()}`)); await expect(page.locator('.w2-rq__head b')).toHaveText('chest.glb') },
    proto: async page => { await P(page, `App.openPage('review')`) } },
  { id: 'integrity', scope: PAGE_SCOPE, title: '完整性',
    app: async page => { await page.goto(libPath(bb, '/issues')); await expect(page.locator('.w2-it__row').first()).toBeVisible() },
    proto: async page => { await P(page, `App.openPage('integrity')`) } },
  { id: 'trash', scope: PAGE_SCOPE, title: '回收站',
    app: async page => { await page.goto(libPath(bb, '/trash')); await expect(page.locator('[data-trash]').first()).toBeVisible() },
    proto: async page => { await P(page, `App.openPage('trash')`) } },
  { id: 'settings', scope: PAGE_SCOPE, title: '设置 · 资产库',
    app: async page => { await page.goto(libPath(bb, '/settings/library')); await expect(page.locator('.w2-st__body h2')).toBeVisible() },
    proto: async page => { await P(page, `App.openSettings()`) } },
  { id: 'tags', scope: PAGE_SCOPE, title: '标签',
    app: async page => { await page.goto(libPath(bb, '/tags')); await expect(page.locator('.w2-tg__r').first()).toBeVisible() },
    proto: async page => { await P(page, `App.openPage('tags')`) } },
  { id: 'context-menu', title: 'chest.glb 的右键菜单',
    app: async page => { await browseFolder(page, bb, 'props/chest'); await cell(page, 'chest.glb').click({ button: 'right' }); await expect(page.getByRole('menu')).toBeVisible() },
    proto: async page => { await P(page, `App.go({ type: 'folder', id: 'props/chest' })`); await protoCell(page).click({ button: 'right' }); await page.getByRole('menu').last().waitFor({ timeout: 10_000 }) } },
  { id: 'delete-confirm', title: '移入回收站的确认框',
    app: async page => {
      await browseFolder(page, bb, 'props/chest'); await cell(page, 'chest.glb').click({ button: 'right' })
      await page.getByRole('menu').last().getByRole('menuitem', { name: /^移入回收站/ }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
    },
    proto: async page => {
      await P(page, `App.go({ type: 'folder', id: 'props/chest' })`); await protoCell(page).click({ button: 'right' })
      await page.getByRole('menu').last().getByRole('menuitem', { name: /移入回收站/ }).click({ timeout: 10_000 })
      await page.getByRole('dialog').or(page.getByRole('alertdialog')).last().waitFor({ timeout: 10_000 })
    } }
]

/* ───────────── capture ───────────── */

interface Capture { text: string[]; roles: string[] }
const results: Record<string, { title: string; shots: Array<{ theme: string; size: string; app: string; proto: string }>; onlyApp: string[]; onlyProto: string[]; rolesOnlyApp: string[]; rolesOnlyProto: string[] }> = {}

/** Numbers, relative times and dates are allowed to differ (the prototype's counts and clock are made up). */
function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
    .replace(/(\d+ (天|小时|分钟|个月)前|刚刚)/g, '‹时间›')
    .replace(/\d+ 月 \d+ 日( \d\d:\d\d)?/g, '‹日期›')
    .replace(/\d[\d,.]*\s*(KB|MB|B|GB)\b/g, '‹大小›')
    .replace(/[+−-]?\d[\d,.]*%?/g, '#')
}
const STRUCT = new Set(['tab', 'tablist', 'menu', 'menuitem', 'menuitemcheckbox', 'dialog', 'alertdialog', 'navigation', 'complementary', 'toolbar', 'table', 'columnheader', 'heading', 'radiogroup', 'radio', 'switch', 'slider', 'checkbox', 'listbox', 'tree', 'treeitem'])

async function capture(page: Page, scope = 'body'): Promise<Capture> {
  const parts = await page.locator(scope).all()
  const raw = (await Promise.all(parts.map(l => l.innerText()))).join('\n')
  const text = [...new Set(raw.split('\n').map(normalise).filter(l => l && l !== '#'))]
  const snap = (await Promise.all(parts.map(l => l.ariaSnapshot()))).join('\n')
  const roles = [...new Set(snap.split('\n').map(l => l.trim().replace(/^- /, '')).map(l => /^([a-z]+)(?: "([^"]*)")?/.exec(l)).filter((m): m is RegExpExecArray => !!m && STRUCT.has(m[1]!)).map(m => `${m[1]}${m[2] ? ` "${normalise(m[2])}"` : ''}`))]
  return { text, roles }
}

async function prepare(page: Page, theme: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h })
  await page.emulateMedia({ colorScheme: theme as 'dark' | 'light' })
}

/**
 * One test for all scenarios (a failed test would restart the worker and lose the report): each scenario is a step
 * with soft assertions, so every pair is captured and every difference is listed before the test fails.
 */
test('正式版与原型：结构与文字一致（12 个场景 · 深色 / 浅色 · 1440×900 / 1100×800）', async ({ page }) => {
  test.setTimeout(30 * 60_000)
  page.setDefaultTimeout(20_000)
  for (const sc of SCENARIOS) {
    await test.step(sc.title, async () => {
      const r: { title: string; shots: Array<{ theme: string; size: string; app: string; proto: string }>; onlyApp: string[]; onlyProto: string[]; rolesOnlyApp: string[]; rolesOnlyProto: string[] } =
        results[sc.id] = { title: sc.title, shots: [], onlyApp: [], onlyProto: [], rolesOnlyApp: [], rolesOnlyProto: [] }
      let appCap: Capture | null = null, protoCap: Capture | null = null
      for (const theme of THEMES) for (const [w, h] of SIZES) {
        const tag = `${sc.id}-${theme}-${w}x${h}`
        await prepare(page, theme, w, h)
        await page.goto(proto.url)
        // the prototype boots in its loading state for ~0.5 s (app.js App.boot): wait until it is ready
        await page.waitForFunction(() => (window as unknown as { App?: { S?: { state?: string } } }).App?.S?.state === 'ready')
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
        await sc.proto(page)
        await page.waitForTimeout(1200)
        await page.screenshot({ path: path.join(OUT, `${tag}-proto.png`) })
        if (theme === 'dark' && w === 1440) protoCap = await capture(page, sc.scope?.proto)
        await page.goto('about:blank')
        await sc.app(page)
        await page.waitForTimeout(1200)
        await page.screenshot({ path: path.join(OUT, `${tag}-app.png`) })
        if (theme === 'dark' && w === 1440) appCap = await capture(page, sc.scope?.app)
        r.shots.push({ theme, size: `${w}×${h}`, app: `${tag}-app.png`, proto: `${tag}-proto.png` })
      }
      const a = appCap!, p = protoCap!
      r.onlyApp = a.text.filter(x => !p.text.includes(x))
      r.onlyProto = p.text.filter(x => !a.text.includes(x))
      r.rolesOnlyApp = a.roles.filter(x => !p.roles.includes(x))
      r.rolesOnlyProto = p.roles.filter(x => !a.roles.includes(x))
      fs.writeFileSync(path.join(OUT, `${sc.id}.json`), JSON.stringify({ ...r, app: a, proto: p }, null, 2))
      const k = KNOWN[sc.id] ?? {}
      const unknown = {
        onlyApp: r.onlyApp.filter(x => !(k.onlyApp ?? []).some(m => match(m, x))),
        onlyProto: r.onlyProto.filter(x => !(k.onlyProto ?? []).some(m => match(m, x))),
        rolesOnlyApp: r.rolesOnlyApp.filter(x => !(k.rolesOnlyApp ?? []).some(m => match(m, x))),
        rolesOnlyProto: r.rolesOnlyProto.filter(x => !(k.rolesOnlyProto ?? []).some(m => match(m, x)))
      }
      expect.soft(unknown, `${sc.title}: differences not in KNOWN (see e2e/.artifacts/compare/report.html)`).toEqual({ onlyApp: [], onlyProto: [], rolesOnlyApp: [], rolesOnlyProto: [] })
    })
  }
})

/* ───────────── known differences ───────────── */
/*
 * What may differ between the two, per scenario. Two kinds: allowed (made-up sample data, thumbnails still being
 * rendered, roles the product names better) and findings (F_*: another line has to fix them — listed in the hand-back
 * with the file). Anything not listed fails the test, so a new difference is never silently accepted.
 */

type Matcher = string | RegExp
const match = (m: Matcher, x: string) => (typeof m === 'string' ? m === x : m.test(x))
interface Known { onlyApp?: Matcher[]; onlyProto?: Matcher[]; rolesOnlyApp?: Matcher[]; rolesOnlyProto?: Matcher[] }

/* ── allowed: sample data, timing and things the product does better ── */
/** The prototype's made-up data where the sample library is real (descriptions, names, counts, file names). */
const DATA: Matcher[] = [/^新手村第一个可以打开的容器。/, /^宝箱 新手村第一个/, /lin 的 MacBook 冲突|lin's conflicted copy/]
/** Thumbnails a browser renders after the page opens (ADR-025): the shot can be taken before they are done. */
const RENDERING: Matcher[] = ['正在生成缩略图', '缩略图稍后生成', '# 面', '#:#', '# 秒', '.blend', /^M_wood M_brass/]
/** The product names its landmarks (导航 / 资产) where the prototype leaves them unnamed; the shell divider is a slider. */
const NAMED_ROLES: Matcher[] = ['tree "导航"', 'tree "视图"', 'tree "智能文件夹"', 'tree "文件夹"', 'listbox "资产"', 'navigation "路径"', 'slider "分界线"', 'navigation "设置"', 'tree', 'listbox', 'navigation']
/**
 * Rows in the inspector's relation list: the prototype's are treeitems whose names repeat the file name (the thumbnail's
 * alt) before the record line; the product's are plain rows (a name button, the record line under it, the 删除 button).
 */
const INSPECTOR_REL_ROWS: Matcher[] = [/^treeitem ".*删除这条关系"$/]
/** A modal dialog hides the page behind it from the accessibility tree (aria-modal); the prototype's does not. */
const BEHIND_MODAL: Matcher[] = [/^(complementary|treeitem|toolbar|slider|radiogroup|radio|listbox|tree|alertdialog)\b/]

/* ── findings: differences other lines have to fix (listed in the hand-back); kept here so the test still catches
      anything new, and shown in the report ── */
/** Allowed: the side bar's footer shows icons only (product decision 2026-11-26, design/docs/deviations.md 第五类 1). */
const ICON_ONLY_FOOTER: Matcher[] = ['设置']
/**
 * web-1 inspector: the shell adds a「目标尺寸」row (the design object's target size) and a「源文件」entry that the
 * prototype's inspector does not show. The model's own rows match the prototype (FormatView.techRows: 三角面, 材质,
 * 贴图「3 张 · 最大 1024」, 动画「1 段 · open」).
 */
const F_MODEL_TECH: Matcher[] = ['目标尺寸', '# × # × # m', '源文件']
/**
 * Allowed: the 3D viewer's「查看选项」keeps the tone-mapping choice builtin-plugins.md asks for (查看器功能 · 渲染「色调映射
 * 可选（ACES、AgX、中性、无）」), for which the prototype's panel has no control; and its key-light dial is a named slider
 * the keyboard turns, where the prototype's is an unnamed div. Every other control matches the prototype by role and name.
 */
const MODEL_PANEL_EXTRA: Matcher[] = ['色调', 'ACES', 'AgX', '中性', '无', 'radiogroup "色调映射"', /^radio "(ACES|AgX|中性|无)"$/, 'slider "主光方向"']

const KNOWN: Record<string, Known> = {
  browse: { onlyApp: [...RENDERING, ...DATA], onlyProto: [...RENDERING, ...DATA, ...ICON_ONLY_FOOTER], rolesOnlyApp: [...NAMED_ROLES, ...ICON_ONLY_FOOTER], rolesOnlyProto: [...NAMED_ROLES, ...ICON_ONLY_FOOTER] },
  inspector: { onlyApp: [...RENDERING, ...DATA, ...F_MODEL_TECH], onlyProto: [...RENDERING, ...DATA, ...F_MODEL_TECH, ...ICON_ONLY_FOOTER], rolesOnlyApp: [...NAMED_ROLES, ...ICON_ONLY_FOOTER], rolesOnlyProto: [...NAMED_ROLES, ...INSPECTOR_REL_ROWS, ...ICON_ONLY_FOOTER] },
  detail: {
    onlyApp: [...MODEL_PANEL_EXTRA], onlyProto: [],
    rolesOnlyApp: [...MODEL_PANEL_EXTRA],
    // the prototype's detail bar is a toolbar; the product's bar holds a tablist and links and is not one
    rolesOnlyProto: ['toolbar "详情"']
  },
  graph: {
    // no version timeline:「v1 时的关系」has no data source in phase one (P1-6); the centre shows version · note · day+time
    onlyApp: [...DATA, ...RENDERING, /^v# · 修正包边比例 · /], onlyProto: [...DATA, 'v#', '‹日期›', '当前', /^v# · 修正包边比例 · /],
    rolesOnlyProto: ['toolbar "详情"']
  },
  'compare-sheet': { onlyApp: ['chest.glb · chest_turnaround.png · 正', ...RENDERING], rolesOnlyApp: [...NAMED_ROLES] },
  review: { onlyApp: [...MODEL_PANEL_EXTRA, ...DATA, ...RENDERING], onlyProto: [...DATA], rolesOnlyApp: [...MODEL_PANEL_EXTRA] },
  integrity: {
    // the HTML document's 36 px row thumbnail is its text card (title, first lines of the page) where the prototype
    // shows a document icon (web-1 AssetThumb); the card no longer shows the page source (plugins/doc excerpt)
    onlyApp: [...DATA, '商店界面原型', /^杂货铺/, '全部重试', /^生成(缩略图|( Agent)? ?摘要)失败：这台电脑的浏览器放不了这种视频/, '需要 community.spine', /^需要 community\.spine（community\.spine \^#），本机没有安装$/, 'ui/hud · 发现于 ‹时间›', '和 ui/shop/panel_bg.png 的内容完全相同'],
    onlyProto: [...DATA, 'axe_old.png.bmeta', /axe_old\.png/, '移入回收站', /^生成缩略图失败：不支持的编码/, /^需要 Spine 插件/, '手动缩略图过时', 'chest_open_preview.mp#', /^手动设的缩略图停在/, '清除手动缩略图', '重新截图', '和 ui/hud/panel_bg.png 的内容完全相同']
  },
  trash: { rolesOnlyApp: [/^(table "回收站"|columnheader( ".*")?|checkbox "选择 .*")$/], rolesOnlyProto: ['table'] },
  settings: { onlyApp: ['关键词搜索', 'community.spine · 未安装'], onlyProto: ['Lore 版本存储', 'Spine 动画 · 未安装'], rolesOnlyApp: [...NAMED_ROLES], rolesOnlyProto: [...NAMED_ROLES] },
  // the prototype's tag page has its own made-up set (with typos to merge: 宝相, 道具s)
  tags: { onlyApp: ['材质', '场景', '地图', '动画', '动图', '规范', '界面', '特效', '提灯', '武器', '效果图', '序列帧', '岩石', '音乐', '原型稿', 'HDRI', '商人', '暖光'], onlyProto: ['宝相', '道具s', '金属', '发光'] },
  'context-menu': { onlyApp: [...DATA, ...RENDERING, ...F_MODEL_TECH], onlyProto: [...DATA, ...RENDERING, ...F_MODEL_TECH, ...ICON_ONLY_FOOTER], rolesOnlyApp: [...NAMED_ROLES, ...ICON_ONLY_FOOTER], rolesOnlyProto: [...NAMED_ROLES, ...INSPECTOR_REL_ROWS, ...ICON_ONLY_FOOTER] },
  'delete-confirm': { onlyApp: [...DATA, ...RENDERING, ...F_MODEL_TECH], onlyProto: [...DATA, ...RENDERING, ...F_MODEL_TECH, ...ICON_ONLY_FOOTER], rolesOnlyApp: [/^alertdialog "把 chest\.glb 移入回收站？"$/, /^treeitem "chest_icon\.png /], rolesOnlyProto: [...BEHIND_MODAL] }
}

/* ───────────── report ───────────── */

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function writeReport() {
  const list = (t: string, xs: string[]) => xs.length ? `<details open><summary>${t} (${xs.length})</summary><ul>${xs.map(x => `<li><code>${esc(x)}</code></li>`).join('')}</ul></details>` : `<p class="ok">${t}: —</p>`
  const body = Object.entries(results).map(([id, r]) => `
    <section id="${id}"><h2>${esc(r.title)}</h2>
      <div class="diff">${list('只在正式版', r.onlyApp)}${list('只在原型', r.onlyProto)}${list('角色只在正式版', r.rolesOnlyApp)}${list('角色只在原型', r.rolesOnlyProto)}</div>
      ${r.shots.map(s => `<h3>${s.theme} · ${s.size}</h3><div class="pair"><figure><figcaption>原型</figcaption><img src="${s.proto}" loading="lazy"></figure><figure><figcaption>正式版</figcaption><img src="${s.app}" loading="lazy"></figure></div>`).join('')}
    </section>`).join('')
  fs.writeFileSync(path.join(OUT, 'report.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>截图比对</title>
<style>body{font:13px system-ui,sans-serif;margin:16px;background:#111;color:#ddd}h2{margin-top:40px}nav a{margin-right:12px;color:#9cf}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}figure{margin:0}img{width:100%;border:1px solid #333}figcaption{color:#999;margin:4px 0}
.diff{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}code{white-space:pre-wrap}.ok{color:#7c7}ul{margin:4px 0;padding-left:18px;max-height:240px;overflow:auto}</style></head>
<body><h1>正式版 · 原型 截图比对</h1><nav>${Object.entries(results).map(([id, r]) => `<a href="#${id}">${esc(r.title)}</a>`).join('')}</nav>${body}</body></html>`)
}
