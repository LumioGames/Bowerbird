/**
 * Hostile documents on the server: huge files are read only up to a limit, JSON is parsed at most once and never
 * re-printed, and a bundle entry that links outside its folder is refused.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assetFileFor, fileRefFor, sampleDir, settleWithin, SAMPLE_HTML } from '@bowerbird/plugin-sdk/testing'
import { docFormat, MAX_READ } from './server.js'

const files = sampleDir('bb-doc-hostile-')
afterAll(() => files.cleanup())

describe('size limits', () => {
  it('reads only the first MAX_READ bytes of a huge text file', async () => {
    const p = files.write('huge.txt', 'line\n'.repeat(1000))
    fs.truncateSync(p, MAX_READ * 4)
    const r = await settleWithin(5000, () => docFormat.probe!(assetFileFor(p)))
    expect(r.ok).toBe(true)
    const tech = (r as { value: { tech: Record<string, unknown> } }).value.tech
    expect(tech.truncated).toBe(true)
    const s = await settleWithin(5000, () => docFormat.summarize!(assetFileFor(p)))
    expect(s.ok).toBe(true)
  })
  it('handles deeply nested and very large JSON without re-printing it', async () => {
    const deep = files.write('deep.json', '['.repeat(500_000) + ']'.repeat(500_000))
    const r = await settleWithin(5000, () => docFormat.probe!(assetFileFor(deep)))
    expect(r.ok).toBe(true)
    const wide = files.write('wide.json', JSON.stringify(Array.from({ length: 200_000 }, (_, i) => ({ i, name: `item ${i}` }))))
    const w = await settleWithin(5000, () => docFormat.probe!(assetFileFor(wide)))
    expect(w.ok).toBe(true)
    expect((w as { value: { tech: Record<string, unknown> } }).value.tech.valid).toBe(true)
  })
  it('settles on pathological Markdown and HTML', async () => {
    for (const [name, text] of [['spaces.md', '# a' + ' '.repeat(200_000) + 'b\n' + '**'.repeat(200_000)], ['tags.html', '<'.repeat(300_000) + '<title>' + '<!--'.repeat(100_000)]] as const) {
      const p = files.write(name, text)
      const r = await settleWithin(5000, () => docFormat.probe!(assetFileFor(p)))
      expect(r.ms).toBeLessThan(5000)
    }
  })
})

describe('bundle entries', () => {
  it('refuses an index.html that links outside the bundle', async () => {
    const outside = files.write('secret.html', '<title>outside</title>')
    const dir = path.join(files.dir, 'evil_bundle')
    fs.mkdirSync(dir)
    fs.symlinkSync(outside, path.join(dir, 'index.html'))
    expect(await docFormat.match(fileRefFor(dir))).toBeNull()
    const r = await settleWithin(2000, () => docFormat.probe!(assetFileFor(dir)))
    expect(r.ok).toBe(false)
  })
  it('accepts a link that stays inside the bundle', async () => {
    const dir = path.join(files.dir, 'ok_bundle')
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'pages/main.html'), SAMPLE_HTML)
    fs.symlinkSync(path.join(dir, 'pages/main.html'), path.join(dir, 'index.html'))
    expect(await docFormat.match(fileRefFor(dir))).toEqual({ format: 'doc', confidence: 0.9 })
    expect((await docFormat.probe!(assetFileFor(dir))).tech.title).toBe('商店界面原型')
  })
  it('refuses an entry that is a directory or a link to one', async () => {
    const dir = path.join(files.dir, 'dir_entry')
    fs.mkdirSync(path.join(dir, 'index.html'), { recursive: true })
    expect(await docFormat.match(fileRefFor(dir))).toBeNull()
    expect(os.platform()).toBeTruthy()
  })
})
