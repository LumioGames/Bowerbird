/**
 * Line e2e-a page helpers: wait for the library to be indexed, open pages, find cells, menus, dialogs and toasts
 * by their visible text (design/docs/copy.md).
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { AssetSummary } from '@bowerbird/schema'
import type { Bowerbird } from './a-server'

/**
 * The kernel has indexed the library. Files written less than 2 s ago are left for a retry scan (the scanner's
 * stability rule, sync-and-integrity.md), and the test copies the library right before the server starts — so the
 * first scan can finish having skipped everything. Done = pipeline idle, no scan running, and the last scan started
 * long enough ago that its retry (stableMs + 200 ms) would already have begun.
 */
export async function waitScanned(bb: Bowerbird, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      const j = await bb.api.jobs.overview(bb.lib)
      const busy = j.stages.filter(s => s.stage === 'identify' || s.stage === 'probe' || s.stage === 'index').reduce((n, s) => n + s.queued + s.running, 0)
      const started = j.scan.startedAt ? Date.parse(j.scan.startedAt) : 0
      if (!j.scan.running && busy === 0 && j.scan.finishedAt && Date.now() - started > 2_600) return
    } catch { /* starting */ }
    if (Date.now() > end) throw new Error('library scan did not finish')
    await new Promise(r => setTimeout(r, 200))
  }
}

export const libUrl = (bb: Bowerbird, path = '') => `${bb.url}/libraries/${encodeURIComponent(bb.lib)}${path}`

/** Open the browse page (or another path of the library) after the first scan. */
export async function openLibrary(page: Page, bb: Bowerbird, path = ''): Promise<void> {
  await waitScanned(bb)
  await page.goto(libUrl(bb, path))
}

export async function openBrowse(page: Page, bb: Bowerbird, query = ''): Promise<void> {
  await openLibrary(page, bb, query ? `?${query}` : '')
  await expect(grid(page)).toBeVisible()
}

export const grid = (page: Page) => page.getByRole('listbox', { name: '资产' })
/** A grid cell by the asset's file name (exact). */
export const cell = (page: Page, name: string): Locator =>
  grid(page).locator('[data-asset-cell]').filter({ has: page.locator('div[title]').getByText(name, { exact: true }) })
export const sidebar = (page: Page) => page.getByRole('complementary', { name: '导航' })
export const inspector = (page: Page) => page.getByRole('complementary', { name: '检查器' })
export const toolbar = (page: Page) => page.getByRole('toolbar', { name: '顶栏' })
export const treeItem = (page: Page, sel: string) => sidebar(page).locator(sel)
export const folderRow = (page: Page, path: string) => sidebar(page).locator(`[data-folder="${path}"]`)
export const viewRow = (page: Page, id: string) => sidebar(page).locator(`[data-view="${id}"]`)
export const smartRow = (page: Page, name: string) => sidebar(page).locator(`[data-smart="${name}"]`)
/** A sonner toast containing this text. */
export const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text })
export const menu = (page: Page) => page.getByRole('menu').last()
/** A menu item of the newest open menu (a closing one may still be in the DOM; portals append, so last = newest). */
export const menuItem = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitem', { name: typeof name === 'string' ? new RegExp(`^${escapeRe(name)}`) : name }).last()
export const dialog = (page: Page, title?: string | RegExp) =>
  (title ? page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ has: page.getByRole('heading', { name: title }) }) : page.getByRole('dialog').or(page.getByRole('alertdialog'))).last()
export const alert = (page: Page, title: string | RegExp) => page.getByRole('alertdialog').filter({ has: page.getByRole('heading', { name: title }) })

export function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Find an asset by its library path through the API. */
export async function assetByPath(bb: Bowerbird, p: string): Promise<AssetSummary> {
  await waitScanned(bb)
  const name = p.split('/').pop()!
  const folder = p.slice(0, Math.max(0, p.length - name.length - 1))
  const r = await bb.api.search(bb.lib, { filter: { folder }, limit: 500 } as never)
  const a = r.items.find(x => x.path === p)
  if (!a) throw new Error(`no asset at ${p}`)
  return a
}

/** Find an asset by file name anywhere in the library (first match). */
export async function assetByName(bb: Bowerbird, name: string): Promise<AssetSummary> {
  await waitScanned(bb)
  const r = await bb.api.search(bb.lib, { limit: 1000 } as never)
  const a = r.items.find(x => x.name === name)
  if (!a) throw new Error(`no asset named ${name}`)
  return a
}

/** Wait until an asset exists at this path. */
export async function waitAsset(bb: Bowerbird, p: string, timeoutMs = 20_000): Promise<AssetSummary> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try { return await assetByPath(bb, p) } catch (e) { if (Date.now() > end) throw e }
    await new Promise(r => setTimeout(r, 200))
  }
}

/** Right-click a cell and wait for the menu. */
export async function contextMenu(page: Page, target: Locator): Promise<Locator> {
  await target.click({ button: 'right' })
  const m = page.getByRole('menu')
  await expect(m.first()).toBeVisible()
  return m.first()
}

/** The platform modifier as Playwright spells it (⌘ on macOS, Ctrl elsewhere; the app follows navigator.platform). */
export const MOD = 'ControlOrMeta'
