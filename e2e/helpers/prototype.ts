import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { REPO, freePort } from './server'

/** Serve design/prototype with python's static server (the prototype needs http://, not file://). */
export async function startPrototype(): Promise<{ url: string; stop(): Promise<void> }> {
  const port = await freePort()
  const child: ChildProcess = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.join(REPO, 'design/prototype')], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}/index.html`
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(url); if (r.ok) break } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100))
  }
  return { url, stop: async () => { child.kill(); } }
}
