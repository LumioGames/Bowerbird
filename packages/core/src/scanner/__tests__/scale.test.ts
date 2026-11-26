/**
 * A large rebuild must finish and must not hold the event loop for seconds at its end (a 100 000-asset library
 * stalled ~30 s): runs with core-B's real query engine and pipeline, which receive every asset at once.
 */
import fs from 'node:fs'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { afterEach, expect, it } from 'vitest'
import { serializeBmeta } from '@bowerbird/schema'
import { cleanupTmp, makeLib, type TestLib } from '../../service/__tests__/harness.js'
import { hashBytes } from '../../library/hash.js'

let libs: TestLib[] = []
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

it('rebuilds an index of 6000 registered assets without long event-loop stalls', async () => {
  const t = await makeLib({ realEngines: true })
  libs.push(t)
  const N = 6000
  const at = new Date(Date.now() - 3600_000).toISOString()
  for (let i = 0; i < N; i++) {
    const rel = `d${i % 40}/s${i % 7}/f${i}.bin`
    const data = Buffer.from(`asset ${i}`)
    const abs = t.abs(rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, data)
    const id = `0192f3a7-5c1e-7b3a-9d2f-${i.toString(16).padStart(12, '0')}`
    fs.writeFileSync(abs + '.bmeta', serializeBmeta({ bb: 1, id, hash: hashBytes(data), stage: 'production', tags: ['t'], versions: [{ hash: hashBytes(data), size: data.length, at, by: 'user:x' }], created: { at, by: 'user:x' } }))
    const old = Date.now() / 1000 - 3600
    fs.utimesSync(abs, old, old)
  }
  const h = monitorEventLoopDelay({ resolution: 10 })
  h.enable()
  await t.reopen({ dropIndex: true })
  await t.svc.scanner.idle()
  // the pipeline takes the queued work in too
  await new Promise(r => setTimeout(r, 200))
  h.disable()
  expect(t.svc.store.count()).toBe(N)
  const maxMs = h.max / 1e6
  if (process.env.BB_LAG) console.log('max event-loop delay ms', maxMs)
  // measured: ~200 ms now, ~1 100 ms before the end of the scan was sliced (6000 assets)
  expect(maxMs).toBeLessThan(750)
}, 180_000)
