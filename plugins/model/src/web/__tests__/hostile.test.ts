/**
 * Untrusted files in the browser (review P1-2, P2): requests go only where slot relations point (or to data the
 * file carries), compressed FBX arrays inflate to at most their declared size, and FBX files whose offsets or
 * arrays lie are refused before FBXLoader sees them.
 */
import { deflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileSource } from '@bowerbird/plugin-sdk/web'
import { BLOCKED_URL, loadModel, resolveRequest } from '../three/load'
import { inflateBounded } from '../three/inflate'
import { fbxBackwardsEnd, fbxZlibBomb, gltfRemoteRefs } from '../../__tests__/hostile'

function source(main: Uint8Array | string, slots: Record<string, string> = {}): FileSource {
  const url = 'data:application/octet-stream;base64,' + Buffer.from(main).toString('base64')
  return { url, version: null, fetch: async () => (await fetch(url)).arrayBuffer(), slotUrl: s => slots[s] ?? null, fetchSlot: async () => null, bundleUrl: i => i }
}

afterEach(() => { vi.restoreAllMocks() })

describe('requests stay inside the library (P2)', () => {
  it('a name a relation fills goes to the library; anything else is missing and goes nowhere', () => {
    const missing = new Set<string>(), resolved = new Map<string, string>()
    const src = { slotUrl: (s: string) => (s === 'scene.bin' ? '/api/v1/libraries/l/assets/a/slots/scene.bin' : null) }
    expect(resolveRequest('scene.bin', src, missing, resolved)).toBe('/api/v1/libraries/l/assets/a/slots/scene.bin')
    expect(resolveRequest('http://192.168.1.1/secret.bin', src, missing, resolved)).toBe(BLOCKED_URL)
    expect(resolveRequest('//evil.example/x.bin', src, missing, resolved)).toBe(BLOCKED_URL)
    expect(resolveRequest('data:application/octet-stream;base64,AAAA', src, missing, resolved)).toMatch(/^data:/)
    expect(resolveRequest('https://evil.example/tex.png', src, missing, resolved)).toMatch(/^data:image\/png/)
    expect([...missing]).toEqual(['http://192.168.1.1/secret.bin', '//evil.example/x.bin', 'https://evil.example/tex.png'])
  })

  it('a glTF whose buffer is an absolute URL is not fetched: it fails as a missing file', async () => {
    const real = globalThis.fetch
    const asked: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      asked.push(u)
      return real(input, init)
    })
    const err = await loadModel(source(gltfRemoteRefs()), 'remote.gltf').catch(e => e)
    expect(err).toMatchObject({ kind: 'load' })
    expect(asked.every(u => u.startsWith('data:'))).toBe(true)
  })
})

describe('FBX in the browser (P1-1, P1-2)', () => {
  it('inflates no more than the declared size', () => {
    const ok = deflateSync(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))
    expect([...inflateBounded(new Uint8Array(ok), 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const bomb = deflateSync(Buffer.alloc(32 * 1024 * 1024))
    expect(() => inflateBounded(new Uint8Array(bomb), 24)).toThrow(RangeError)
  })
  it('refuses a decompression bomb before FBXLoader', async () => {
    const err = await loadModel(source(fbxZlibBomb(32)), 'bomb.fbx').catch(e => e)
    expect(err).toMatchObject({ kind: 'decode' })
  })
  it('refuses a file whose record offsets point backwards', async () => {
    const err = await loadModel(source(fbxBackwardsEnd()), 'loop.fbx').catch(e => e)
    expect(err).toMatchObject({ kind: 'decode' })
  })
})
