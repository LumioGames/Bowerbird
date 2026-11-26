/**
 * Runs a snippet in a worker thread with a time limit, so a parser that loops forever fails the test instead of
 * hanging the test run (a synchronous loop cannot be interrupted any other way). The snippet is TypeScript,
 * bundled with esbuild (from the plugin SDK's dependencies); it receives `data` and posts its result.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const requireSdk = createRequire(path.join(ROOT, 'packages/plugin-sdk/package.json'))

export type Isolated = { status: 'ok'; value: unknown } | { status: 'error'; message: string } | { status: 'timeout' }

/**
 * `body` is the inside of `async (data) => { … }`; it may import from `src/` with paths relative to
 * `plugins/model/src` (write them as `@src/…`).
 */
export function runIsolated(imports: string, body: string, data: unknown, timeoutMs = 3000): Promise<Isolated> {
  const { buildSync } = requireSdk('esbuild') as typeof import('esbuild')
  const src = path.join(ROOT, 'plugins/model/src')
  const contents = imports.replace(/@src\//g, src + '/') + `
import { parentPort, workerData } from 'node:worker_threads'
;(async (data: any) => { ${body} })(workerData)
  .then(value => parentPort!.postMessage({ status: 'ok', value }))
  .catch((e: any) => parentPort!.postMessage({ status: 'error', message: String(e?.message ?? e) }))
`
  const out = buildSync({ stdin: { contents, resolveDir: src, loader: 'ts', sourcefile: 'isolated.ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const code = out.outputFiles[0]!.text
  return new Promise(resolve => {
    const w = new Worker(code, { eval: true, workerData: data })
    const timer = setTimeout(() => { void w.terminate(); resolve({ status: 'timeout' }) }, timeoutMs)
    w.once('message', m => { clearTimeout(timer); void w.terminate(); resolve(m as Isolated) })
    w.once('error', e => { clearTimeout(timer); resolve({ status: 'error', message: e.message }) })
  })
}

/**
 * The server probe and the size check of one model file, in a worker with a time limit: `ok` with the tech, whether
 * the counts are complete and how many checks ran; `error` when the file is refused; `timeout` when it hangs.
 */
export function probeIsolated(file: string, timeoutMs = 4000): Promise<Isolated> {
  return runIsolated(
    `import fs from 'node:fs'\nimport path from 'node:path'\nimport { readModel, probeResult } from '@src/server/probe.ts'\nimport { checkSize } from '@src/server.ts'`,
    `const p = data.file
     const af: any = { absPath: p, path: path.basename(p), name: path.basename(p), ext: path.extname(p), size: fs.statSync(p).size, bundle: false, head: new Uint8Array(),
       read: async () => new Uint8Array(fs.readFileSync(p)), readSlot: async () => null, tech: {}, views: null, relations: [],
       designObject: { id: 'x', targetSize: { w: 1, h: 1, d: 1 } } }
     const info = await readModel(af)
     const probe = probeResult(info)
     const checks = await checkSize(af)
     return { tech: probe.tech, complete: info.kind === 'fbx' ? info.fbx.complete : true, checks: checks.length }`,
    { file }, timeoutMs)
}
