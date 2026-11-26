/** File watching must not cost one descriptor per file (a 100 000-asset library ran the process out of them). */
import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTmp, ctx, makeLib, type TestLib } from '../../service/__tests__/harness.js'

let libs: TestLib[] = []
async function lib(o?: Parameters<typeof makeLib>[0]): Promise<TestLib> { const t = await makeLib(o); libs.push(t); return t }
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

const openFds = (): number => { try { return fs.readdirSync('/dev/fd').length } catch { return -1 } }
const until = async (ok: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end && !ok()) await new Promise(r => setTimeout(r, 50)) }

async function filled(files: number, dirs: number): Promise<TestLib> {
  const t = await lib()
  for (let i = 0; i < files; i++) t.write(`d${i % dirs}/sub${i % 3}/f${i}.png`, `content ${i}`, -100)
  await t.scan()
  expect(t.svc.store.count()).toBe(files)
  return t
}

describe('file watching', () => {
  it('opens about the same number of descriptors for 60 or 3000 files', async () => {
    const small = await filled(60, 6)
    const big = await filled(3000, 300)
    const deltas: number[] = []
    for (const t of [small, big]) {
      const before = openFds()
      const state = await t.svc.scanner.startWatching()
      expect(state.enabled).toBe(true)
      const after = openFds()
      deltas.push(after - before)
    }
    if (deltas.every(d => d >= 0)) {
      expect(deltas[1]!).toBeLessThanOrEqual(8)
      expect(deltas[1]! - deltas[0]!).toBeLessThanOrEqual(2)
    }
    // the big library still notices changes
    await new Promise(r => setTimeout(r, 500))
    big.write('d7/new.png', 'new file', -10)
    await until(() => big.exists('d7/new.png.bmeta'))
    expect(big.exists('d7/new.png.bmeta')).toBe(true)
  }, 60_000)

  it('watches per directory up to a limit, then turns watching off and says so', async () => {
    const t = await lib({ watch: false })
    for (let i = 0; i < 12; i++) t.write(`d${i}/f.png`, `f${i}`, -100)
    await t.scan()
    ;(t.svc.scanner as unknown as { o: { watchMode: string; maxWatchDirs: number } }).o.watchMode = 'per-directory'
    ;(t.svc.scanner as unknown as { o: { maxWatchDirs: number } }).o.maxWatchDirs = 5
    const state = await t.svc.scanner.startWatching()
    expect(state).toMatchObject({ enabled: false, mode: 'off' })
    expect(state.reason).toContain('定时扫描')
    const info = await t.svc.info(ctx) as unknown as { watch: { enabled: boolean; reason?: string } }
    expect(info.watch).toMatchObject({ enabled: false })
  })

  it('per-directory mode picks up new files and new folders', async () => {
    const t = await lib({ watch: false, stableMs: 200 })
    t.write('a/x.png', 'x', -100)
    await t.scan()
    ;(t.svc.scanner as unknown as { o: { watchMode: string } }).o.watchMode = 'per-directory'
    const state = await t.svc.scanner.startWatching()
    expect(state).toMatchObject({ enabled: true, mode: 'per-directory', dirs: 2 })
    // the OS needs a moment before a new watch reports (macOS FSEvents streams start asynchronously)
    await new Promise(r => setTimeout(r, 500))
    t.write('a/y.png', 'y', -10)
    await until(() => t.exists('a/y.png.bmeta'))
    expect(t.exists('a/y.png.bmeta')).toBe(true)
    fs.mkdirSync(t.abs('b'))
    await new Promise(r => setTimeout(r, 300))
    t.write('b/z.png', 'z', -10)
    await until(() => t.exists('b/z.png.bmeta'))
    expect(t.exists('b/z.png.bmeta')).toBe(true)
  }, 30_000)

  it('notices deletions and folder moves', async () => {
    const t = await lib({ watch: true, stableMs: 200 })
    t.write('m/a.png', 'a', -100)
    t.write('m/sub/b.png', 'b', -100)
    await t.scan()
    const a = t.idOf('m/a.png')
    const b = t.idOf('m/sub/b.png')
    await new Promise(r => setTimeout(r, 500))
    fs.renameSync(t.abs('m'), t.abs('n'))
    await until(() => t.row(a)?.path === 'n/a.png' && t.row(b)?.path === 'n/sub/b.png')
    expect(t.row(a)?.path).toBe('n/a.png')
    expect(t.row(b)?.path).toBe('n/sub/b.png')
    t.rm('n/a.png')
    await until(() => t.row(a)?.missing === 1)
    expect(t.row(a)?.missing).toBe(1)
  }, 30_000)
})
