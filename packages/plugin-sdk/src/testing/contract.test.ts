import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PluginManifest } from '@bowerbird/schema'
import type { FormatHandler, SearchProvider } from '../server.js'
import { createTestContext } from './context.js'
import { loadPluginForTest, runFormatContract, runHostileContract, runRegistrationContract, runSearchProviderContract, sourceEntryFor, webpSize, type LoadedPlugin } from './contract.js'
import { runWithin, TimeLimitError } from './limits.js'
import { makeWav, sampleDir } from './samples.js'

const files = sampleDir('bb-sdk-contract-')
afterAll(() => files.cleanup())

function fake(manifest: Record<string, unknown>, register: (l: LoadedPlugin) => void): LoadedPlugin {
  const m = PluginManifest.parse({ id: 'test.fake', displayName: 'Fake', apiVersion: 1, server: './dist/server.js', ...manifest })
  const l: LoadedPlugin = { dir: files.dir, manifest: m, packageName: 'fake', version: '0.0.0', ctx: createTestContext({ pluginId: m.id }), plugin: null, entry: null }
  register(l)
  return l
}
/** A WebP header (VP8X) of 512 × 256: enough for the format and size checks. */
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0xff, 0x01, 0x00, 0xff, 0x00, 0x00])
const wavFormat = (over: Partial<FormatHandler> = {}): FormatHandler => ({
  id: 'wav',
  match: async f => (f.head[0] === 0x52 ? { format: 'wav' } : null),
  probe: async () => ({ tech: { duration: 0.1 }, badge: '0.1 秒' }),
  thumbnail: async () => ({ thumb: WEBP, aspect: 1 }),
  summarize: async () => ({ text: 'a sound' }),
  ...over
})
const formats = [{ id: 'wav', displayName: 'WAV', extensions: ['.wav'], thumbnail: 'server' }]

describe('runFormatContract', () => {
  const wav = files.write('a.wav', makeWav())
  it('passes a well-behaved handler and reports what it produced', async () => {
    const l = fake({ contributes: { formats } }, x => x.ctx.register.format(wavFormat()))
    const [r] = await runFormatContract(l, [{ file: wav, format: 'wav', tech: { duration: 0.1 }, badge: '0.1 秒', summary: 'sound' }])
    expect(r).toMatchObject({ handler: 'wav', thumbnailBytes: WEBP.length, summary: 'a sound' })
  })
  it('catches a non-WebP thumbnail, bad tech values and a wrong badge', async () => {
    await expect(runFormatContract(fake({ contributes: { formats } }, x => x.ctx.register.format(wavFormat({ thumbnail: async () => ({ thumb: new Uint8Array([1, 2, 3]), aspect: 1 }) }))), [{ file: wav, format: 'wav' }])).rejects.toThrow(/WebP/)
    await expect(runFormatContract(fake({ contributes: { formats } }, x => x.ctx.register.format(wavFormat({ probe: async () => ({ tech: { bad: [1] as unknown as number } }) }))), [{ file: wav, format: 'wav' }])).rejects.toThrow(/tech\.bad/)
    await expect(runFormatContract(fake({ contributes: { formats } }, x => x.ctx.register.format(wavFormat())), [{ file: wav, format: 'wav', badge: '1:00' }])).rejects.toThrow(/badge/)
  })
  it('requires browser-thumbnail formats not to render on the server', async () => {
    const l = fake({ contributes: { formats: [{ ...formats[0], thumbnail: 'browser' }] } }, x => x.ctx.register.format(wavFormat()))
    await expect(runFormatContract(l, [{ file: wav, format: 'wav' }])).rejects.toThrow(/browser/)
  })
  it('fails when a declared format has no handler', async () => {
    await expect(runFormatContract(fake({ contributes: { formats } }, () => {}), [])).rejects.toThrow(/no handler registered/)
  })
  it('checks that unclaimed samples stay unclaimed', async () => {
    const txt = files.write('b.wav', 'hello')
    const l = fake({ contributes: { formats } }, x => x.ctx.register.format(wavFormat({ match: async () => ({ format: 'wav' }) })))
    await expect(runFormatContract(l, [{ file: txt, format: null }])).rejects.toThrow(/should not be claimed/)
  })
})

describe('runRegistrationContract', () => {
  it('compares declarations with registrations both ways', () => {
    expect(runRegistrationContract(fake({ contributes: { creators: [{ id: 'gen' }] } }, x => x.ctx.register.creator({ id: 'gen', displayName: 'Gen', params: {}, inputs: [], run: async () => {} })))).toEqual({ creators: ['gen'] })
    expect(() => runRegistrationContract(fake({ contributes: { creators: [{ id: 'gen' }] } }, () => {}))).toThrow(/not registered/)
    expect(() => runRegistrationContract(fake({ contributes: {} }, x => x.ctx.register.validator({ id: 'v', appliesTo: () => true, check: async () => [] })))).toThrow(/not declared/)
    expect(() => runRegistrationContract(fake({ contributes: {} }, x => x.ctx.register.route({ method: 'GET', path: 'settings/x', handler: async () => ({}) })))).toThrow(/reserved/)
  })
})

describe('runSearchProviderContract', () => {
  it('fails a provider that ignores candidates', async () => {
    const docs = new Map<string, string>()
    const naive: SearchProvider = {
      id: 'naive',
      index: async ds => { for (const d of ds) docs.set(d.id, [d.stem, ...d.tags, d.description, ...d.prompts, d.text, d.folder].join(' ').toLowerCase()) },
      remove: async ids => { for (const id of ids) docs.delete(id) },
      query: async q => [...docs].filter(([, t]) => t.includes(q.toLowerCase())).map(([id], i) => ({ id, score: 100 - i })),
      clear: async () => docs.clear()
    }
    await expect(runSearchProviderContract(naive)).rejects.toThrow(/must return|snippet|candidate/)
  })
})

describe('loadPluginForTest', () => {
  it('maps the built entry to the TypeScript source', () => {
    expect(sourceEntryFor('/p', './dist/server.js')).toBe(path.resolve('/p/src/server.ts'))
  })
  it('imports the source under Vitest when nothing is built', async () => {
    const dir = path.join(files.dir, 'plug')
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '1.2.3', bowerbird: { id: 'test.src', displayName: 'P', apiVersion: 1, server: './dist/server.js', contributes: { searchProviders: [{ id: 's' }] } } }))
    fs.writeFileSync(path.join(dir, 'src/server.ts'), "export default { activate(ctx: any) { ctx.register.searchProvider({ id: 's', index: async () => {}, remove: async () => {}, query: async () => [] }) } }\n")
    const l = await loadPluginForTest(dir)
    expect(l.entry).toBe(path.join(dir, 'src/server.ts'))
    expect(l.ctx.pluginVersion).toBe('1.2.3')
    expect(runRegistrationContract(l)).toEqual({ searchProviders: ['s'] })
  })
})

describe('hostile-input helpers', () => {
  it('runWithin interrupts a backtracking pattern', () => {
    expect(() => runWithin(100, () => /^(a+)+$/.test('a'.repeat(40) + 'b'))).toThrow(TimeLimitError)
    expect(runWithin(100, () => 1 + 1)).toBe(2)
  })
  it('runHostileContract accepts clean rejections and fails a stage that hangs', async () => {
    const wav = files.write('h.wav', makeWav())
    const rejecting = fake({ contributes: { formats } }, x => x.ctx.register.format(wavFormat({ probe: async () => { throw new Error('bad file') } })))
    const [o] = await runHostileContract(rejecting, [wav], 500)
    expect(o!.handler).toBe('wav')
    expect(o!.stages.probe!.ok).toBe(false)
    const hanging = fake({ contributes: { formats } }, x => x.ctx.register.format(wavFormat({ probe: () => new Promise(() => {}) })))
    await expect(runHostileContract(hanging, [wav], 200)).rejects.toThrow(/did not finish within 200 ms/)
  })
  it('reads WebP sizes for the long-edge checks', () => {
    const vp8x = new Uint8Array(30)
    vp8x.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58])
    vp8x.set([0xff, 0x01, 0x00, 0xff, 0x00, 0x00], 24)
    expect(webpSize(vp8x)).toEqual({ width: 512, height: 256 })
    expect(webpSize(new Uint8Array(10))).toBeNull()
  })
  it('test contexts refuse external tools unless asked', async () => {
    const off = createTestContext()
    await expect(off.exec('ls', [])).rejects.toThrow(/without \{ exec: true \}/)
    const stub = createTestContext({ exec: async () => ({ code: 0, stdout: new Uint8Array([1]), stderr: '' }) })
    expect((await stub.exec('anything', [])).stdout).toEqual(new Uint8Array([1]))
  })
})
