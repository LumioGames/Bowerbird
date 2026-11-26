#!/usr/bin/env node
// Performance benchmark for the phase-one targets (engineering.md, search.md, web-shell.md「性能目标」).
//
//   node tests/perf/run-perf.mjs [--count 100000] [--keep] [--skip-web]
//
// Builds (or reuses) the deterministic 100k-asset library from fixtures/scripts/generate-100k.mjs, runs the real
// `bb serve` on it with a fresh BOWERBIRD_HOME, and measures:
//   server: full index build (first open with sidecars), incremental start scan (no change), resident memory,
//           single file change → asset.updated event, pure filter query, keyword query (HTTP round trip)
//   web:    first screen visible, grid scroll frame rate, folder switch, quick look of an image
// Prints a table and writes tests/perf/results.json. Requires `pnpm build` and Playwright's chromium.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const COUNT = Number(flag('--count') ?? 100000)
const SKIP_WEB = args.includes('--skip-web')
const WORK = path.join(os.tmpdir(), `bb-perf-${COUNT}`)
const LIB = path.join(WORK, 'library')
const HOME = path.join(WORK, 'home')
const results = { count: COUNT, machine: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 1e9), node: process.version }, server: {}, web: {} }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const now = () => performance.now()
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
function p95(a) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] }
async function freePort() { return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) }) }
function dirBytes(dir) { let n = 0, files = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n += fs.statSync(p).size; files++ } } }; walk(dir); return { bytes: n, files } }

async function startServer() {
  const port = await freePort()
  const child = spawn(process.execPath, [path.join(REPO, 'packages/cli/dist/index.js'), 'serve', LIB, '--port', String(port)], { env: { ...process.env, BOWERBIRD_HOME: HOME, BOWERBIRD_LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; child.stdout.on('data', d => { log += d }); child.stderr.on('data', d => { log += d })
  const url = `http://127.0.0.1:${port}`
  const t0 = now()
  for (;;) {
    if (child.exitCode !== null) throw new Error('server exited:\n' + log)
    try { const r = await fetch(url + '/api/v1/libraries', { headers: { origin: url } }); if (r.ok) { const j = await r.json(); if (j.libraries.length) return { child, url, lib: j.libraries[0].id, startedMs: now() - t0, log: () => log } } } catch {}
    await sleep(100)
  }
}
async function api(srv, method, p, body) {
  const r = await fetch(srv.url + '/api/v1' + p, { method, headers: { origin: srv.url, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}
async function waitScanDone(srv, timeoutMs = 3_600_000) {
  const t0 = now()
  for (;;) {
    const info = await api(srv, 'GET', `/libraries/${srv.lib}`)
    if (!info.scan.running && (info.scan.phase === 'done' || info.scan.phase === 'idle') && info.stats.assets > 0) return { ms: now() - t0, info }
    if (now() - t0 > timeoutMs) throw new Error('scan timeout')
    await sleep(250)
  }
}
function rssMB(pid) { try { return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()) / 1024) } catch { return null } }
async function stop(srv) { srv.child.kill('SIGTERM'); await new Promise(r => srv.child.once('exit', r)) }

async function timeQuery(srv, body, n = 30) {
  const times = []
  for (let i = 0; i < n; i++) { const t0 = now(); await api(srv, 'POST', `/libraries/${srv.lib}/search`, body); times.push(now() - t0) }
  return { median: +median(times).toFixed(1), p95: +p95(times).toFixed(1) }
}

async function main() {
  console.log(`work dir ${WORK}`)
  if (!fs.existsSync(path.join(LIB, '.bowerbird/library.json'))) {
    fs.rmSync(WORK, { recursive: true, force: true })
    const t0 = now()
    execFileSync(process.execPath, [path.join(REPO, 'fixtures/scripts/generate-100k.mjs'), LIB, '--count', String(COUNT), '--with-sidecars', '--force'], { stdio: 'inherit' })
    results.generateMs = Math.round(now() - t0)
  }
  fs.rmSync(HOME, { recursive: true, force: true })
  const size = dirBytes(LIB); results.library = { files: size.files, bytes: size.bytes }

  // 1. full index build (fresh home = no index)
  let srv = await startServer()
  const full = await waitScanDone(srv)
  results.server.fullIndexBuildMs = Math.round(full.ms + srv.startedMs)
  results.server.assets = full.info.stats.assets
  results.server.hashRateMBps = +((size.bytes / 1e6) / ((full.ms + srv.startedMs) / 1000)).toFixed(1)
  // let the pipeline settle a little, then memory and queries
  await sleep(5000)
  results.server.rssAfterBuildMB = rssMB(srv.child.pid)
  results.server.filterQuery = await timeQuery(srv, { filter: { stage: ['runtime'], format: ['image'] }, sort: 'modified', limit: 100 })
  results.server.filterFolderQuery = await timeQuery(srv, { filter: { folder: 'props/chest', review: ['pending', 'approved'] }, limit: 100 })
  results.server.keywordQuery = await timeQuery(srv, { q: '宝箱 木质', limit: 100 })
  results.server.keywordShort = await timeQuery(srv, { q: '药', limit: 100 })
  results.server.facetQuery = await timeQuery(srv, { filter: { stage: ['production'] }, facets: true, limit: 100 }, 10)

  // 2. single file change → asset.updated event
  const sample = (await api(srv, 'POST', `/libraries/${srv.lib}/search`, { filter: { format: ['doc'] }, limit: 1 })).items[0]
  if (sample) {
    const controller = new AbortController()
    const evRes = await fetch(`${srv.url}/api/v1/libraries/${srv.lib}/events`, { headers: { origin: srv.url }, signal: controller.signal })
    const reader = evRes.body.getReader(); const dec = new TextDecoder()
    await sleep(500)
    const t0 = now()
    fs.appendFileSync(path.join(LIB, sample.path), `\nperf change ${Date.now()}\n`)
    let got = null, buf = ''
    while (now() - t0 < 30_000) {
      const { value, done } = await Promise.race([reader.read(), sleep(1000).then(() => ({ value: null, done: false }))])
      if (done) break
      if (value) buf += dec.decode(value)
      if (buf.includes('asset.updated') && buf.includes(sample.id)) { got = now() - t0; break }
    }
    controller.abort()
    results.server.fileChangeToEventMs = got === null ? null : Math.round(got)
  }
  results.server.rssSteadyMB = rssMB(srv.child.pid)

  // 3. web
  if (!SKIP_WEB) {
    const { chromium } = await import(path.join(REPO, 'node_modules/@playwright/test/index.js')).then(m => m.default ?? m).catch(async () => await import('@playwright/test'))
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const t0 = now()
    await page.goto(`${srv.url}/libraries/${srv.lib}`)
    await page.waitForSelector('[data-asset-id], [role="gridcell"]', { timeout: 30_000 })
    results.web.firstScreenMs = Math.round(now() - t0)
    // scroll fps
    const fps = await page.evaluate(async () => {
      const scroller = [...document.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight * 3 && getComputedStyle(e).overflowY !== 'visible' && e.querySelector('[data-asset-id], [role="gridcell"]'))
      if (!scroller) return null
      let frames = 0; const times = []; let last = performance.now()
      const end = last + 2000
      return await new Promise(res => {
        const tick = t => { frames++; times.push(t - last); last = t; scroller.scrollTop += 120; if (t < end) requestAnimationFrame(tick); else res({ fps: frames / 2, worstFrameMs: Math.max(...times.slice(2)) }) }
        requestAnimationFrame(tick)
      })
    })
    results.web.scroll = fps
    // folder switch: click a sidebar folder row and wait for the grid to show its items
    const tSwitch = []
    for (const name of ['props', 'characters', 'ui', 'audio', 'environments']) {
      const row = page.getByRole('treeitem', { name: new RegExp(`^${name}`) }).first()
      if (!(await row.count())) continue
      const before = await page.evaluate(() => location.href)
      const t1 = now()
      await row.click()
      await page.waitForFunction(b => location.href !== b, before)
      await page.waitForSelector('[data-asset-id], [role="gridcell"]')
      await page.waitForLoadState('networkidle').catch(() => {})
      tSwitch.push(now() - t1)
    }
    results.web.folderSwitchMs = tSwitch.length ? { median: Math.round(median(tSwitch)), max: Math.round(Math.max(...tSwitch)) } : null
    // quick look of an image
    const cell = page.locator('[data-asset-format="image"], [data-format="image"]').first()
    if (await cell.count()) {
      await cell.click()
      const t2 = now()
      await page.keyboard.press(' ')
      await page.waitForSelector('[role="dialog"] img, [role="dialog"] canvas', { timeout: 10_000 })
      results.web.quickLookImageMs = Math.round(now() - t2)
    }
    await browser.close()
  }
  await stop(srv)

  // 4. incremental start scan (no change)
  srv = await startServer()
  const inc = await waitScanDone(srv)
  results.server.incrementalStartScanMs = Math.round(inc.ms + srv.startedMs)
  results.server.rssAfterRestartMB = rssMB(srv.child.pid)
  await stop(srv)

  fs.writeFileSync(path.join(REPO, 'tests/perf/results.json'), JSON.stringify(results, null, 2) + '\n')
  const T = { fullIndexBuildMs: '以指纹计算速度为上限', incrementalStartScanMs: '< 30000', fileChangeToEventMs: '< 2000', rssSteadyMB: '< 500', filterQuery: '< 100', keywordQuery: '< 200', firstScreenMs: '< 1000', scroll: '60 fps', folderSwitchMs: '< 300', quickLookImageMs: '< 200' }
  console.log(JSON.stringify(results, null, 2))
  console.log('targets:', T)
  if (!args.includes('--keep')) fs.rmSync(HOME, { recursive: true, force: true })
}
main().catch(e => { console.error(e); process.exit(1) })
