import { expect, type Locator, type Page } from '@playwright/test'
import type { Bowerbird } from './server'
import { libPath } from './b-server'

/** sonner toasts (bottom right). */
export const toast = (page: Page, text?: string | RegExp): Locator => {
  const all = page.locator('[data-sonner-toast]')
  return text ? all.filter({ hasText: text }) : all
}

/** The open modal dialog (confirm dialogs are alertdialog). */
export const dialog = (page: Page): Locator => page.locator('[role="dialog"], [role="alertdialog"]').last()

/** Open the browse page on a folder and wait for its cells. */
export async function browseFolder(page: Page, bb: Bowerbird, folder: string): Promise<void> {
  await page.goto(libPath(bb, `?folder=${encodeURIComponent(folder)}`))
  await expect(page.locator('[data-asset-cell]').first()).toBeVisible()
}

/** A browse cell by asset name. */
export const cell = (page: Page, name: string): Locator => page.locator('[data-asset-cell]').filter({ has: page.getByText(name, { exact: true }) }).first()

/** Visible text of an element, whitespace collapsed. */
export async function textOf(l: Locator): Promise<string> {
  return (await l.innerText()).replace(/\s+/g, ' ').trim()
}

/**
 * A whole page's loading and error states (PageFrame): hold the first `method` call matching `pattern` (skeleton), fail it
 * (「没有加载出来」+「重试」), then let「重试」through and wait for `ready`.
 */
export async function loadingThenError(page: Page, pattern: RegExp, open: () => Promise<unknown>, ready: Locator, method = 'GET'): Promise<void> {
  let mode: 'hold' | 'fail' | 'ok' = 'hold'
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  await page.route(pattern, async route => {
    if (route.request().method() !== method) return route.fallback()
    if (mode === 'hold') await gate
    if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"服务出错了"}}' })
    return route.fallback()
  })
  await open()
  await expect(page.locator('[aria-busy]').first()).toBeVisible()
  mode = 'fail'
  release()
  await expect(page.getByText('没有加载出来')).toBeVisible({ timeout: 30_000 })
  mode = 'ok'
  await page.getByRole('button', { name: '重试' }).click()
  await expect(ready).toBeVisible()
}

/** Platform modifier for shortcuts (the shell uses ⌘ on macOS, Ctrl elsewhere). */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Mean RGB of a screenshot region (canvas / WebGL output checks). */
export async function regionStats(page: Page, l: Locator): Promise<{ mean: number[]; hash: string }> {
  const buf = await l.screenshot()
  return pngStats(buf)
}

import zlib from 'node:zlib'
import crypto from 'node:crypto'
/** Decode an 8-bit RGBA/RGB PNG (Playwright screenshots) and return mean channel values and a content hash. */
export function pngStats(buf: Buffer): { mean: number[]; hash: string } {
  const px = decodePng(buf)
  const sum: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < px.data.length; i += px.channels) { sum[0] += px.data[i]!; sum[1] += px.data[i + 1]!; sum[2] += px.data[i + 2]! }
  const n = px.data.length / px.channels
  return { mean: sum.map(s => s / n), hash: crypto.createHash('sha1').update(px.data).digest('hex') }
}

export interface Pixels { width: number; height: number; channels: number; data: Uint8Array }
export function decodePng(buf: Buffer): Pixels {
  let off = 8, width = 0, height = 0, colorType = 6
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); colorType = body[9]! }
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!, line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels]! : 0
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0
      let v = line[x]!
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[y * stride + x] = v & 255
    }
  }
  return { width, height, channels, data: out }
}

/** Fraction of pixels that differ by more than `tol` (any channel) between two same-size screenshots. */
export function diffRatio(a: Buffer, b: Buffer, tol = 8): number {
  const A = decodePng(a), B = decodePng(b)
  if (A.width !== B.width || A.height !== B.height) return 1
  let d = 0
  const n = A.width * A.height
  for (let i = 0; i < n; i++) {
    const ia = i * A.channels, ib = i * B.channels
    if (Math.abs(A.data[ia]! - B.data[ib]!) > tol || Math.abs(A.data[ia + 1]! - B.data[ib + 1]!) > tol || Math.abs(A.data[ia + 2]! - B.data[ib + 2]!) > tol) d++
  }
  return d / n
}
