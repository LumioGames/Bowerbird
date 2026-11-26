/**
 * Untrusted files (review P1-1, P1-2, P1-3, P2): every reader must finish quickly and within bounded memory, or
 * fail with an error — never loop. Parsers that could hang run in a worker with a time limit.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fileRefFor } from '@bowerbird/plugin-sdk/testing'
import { probeIsolated, runIsolated } from './isolated.js'
import { fbxBackwardsEnd, fbxDeepAscii, fbxHugeArray, fbxNestedBackwards, fbxZlibBomb, gltfChildCycle, gltfChildFanout, gltfIbmBomb } from './hostile.js'
import { asciiFbx, GltfBuilder } from './builders.js'
import { fbxInfo, parseFbx } from '../shared/fbx.js'
import { matchBuffer } from '../server/match.js'
import { readModel } from '../server/probe.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-model-hostile-'))
const write = (name: string, data: Uint8Array | string) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p }

describe('FBX binary: offsets come from the file (P1-1)', () => {
  it('a node that ends where it starts is a parse error, not an endless loop', async () => {
    const r = await runIsolated(`import { parseFbx, fbxInfo } from '@src/shared/fbx.ts'`, `return fbxInfo(parseFbx(new Uint8Array(data))).triangles`, fbxBackwardsEnd())
    expect(r.status).toBe('error')
  })
  it('a child that ends before its parent\'s properties is a parse error', async () => {
    const r = await runIsolated(`import { parseFbx, fbxInfo } from '@src/shared/fbx.ts'`, `return fbxInfo(parseFbx(new Uint8Array(data))).triangles`, fbxNestedBackwards())
    expect(r.status).toBe('error')
  })
  it('the server probe rejects such a file quickly', async () => {
    const r = await probeIsolated(write('loop.fbx', fbxBackwardsEnd()))
    expect(r.status).toBe('error')
  })
  it('ASCII nesting deeper than any real file stops with an error, not a stack overflow', async () => {
    const r = await runIsolated(`import { parseFbx } from '@src/shared/fbx.ts'`, `try { parseFbx(new TextEncoder().encode(data)); return 'parsed' } catch (e: any) { return e instanceof RangeError ? 'stack' : 'error:' + e.message }`, fbxDeepAscii())
    expect(r).toMatchObject({ status: 'ok' })
    expect(String((r as { value: unknown }).value)).toMatch(/^error:/)
  })
})

describe('FBX arrays: decompression is bounded (P1-2)', () => {
  it('inflates at most element count × element size', () => {
    const calls: number[] = []
    const inflate = (d: Uint8Array, max: number) => { calls.push(max); return new Uint8Array(inflateSync(d, { maxOutputLength: max })) }
    const info = fbxInfo(parseFbx(fbxZlibBomb(8), inflate))
    expect(calls).toEqual([6 * 4])
    expect(info.complete).toBe(false)
  })
  it('the server probe of a zlib bomb finishes quickly and marks the counts incomplete', async () => {
    const r = await probeIsolated(write('bomb.fbx', fbxZlibBomb(256)))
    expect(r).toMatchObject({ status: 'ok', value: { complete: false } })
  })
  it('an array that claims more elements than its bytes hold is skipped, not a crash', async () => {
    const r = await probeIsolated(write('huge.fbx', fbxHugeArray()))
    expect(r).toMatchObject({ status: 'ok', value: { complete: false } })
  })
})

describe('glTF: the node graph and accessors come from the file (P1-3)', () => {
  it('a node that is its own child (twice) is visited once', async () => {
    const r = await probeIsolated(write('cycle.glb', gltfChildCycle()))
    expect(r.status).toBe('ok')
  })
  it('2^40 paths through 41 nodes: each node once, and the size check takes the same path', async () => {
    const r = await probeIsolated(write('fanout.glb', gltfChildFanout()))
    expect(r).toMatchObject({ status: 'ok', value: { tech: { triangles: 1 }, checks: 1 } })
  })
  it('an inverse-bind accessor claiming a billion matrices with a zero stride reads only the first one', async () => {
    const r = await probeIsolated(write('ibm.glb', gltfIbmBomb()))
    expect(r).toMatchObject({ status: 'ok', value: { tech: { bones: 1, triangles: 1 } } })
  })
})

describe('server limits (P2)', () => {
  it('a .bin is claimed only from glTF files inside the library root', async () => {
    const { json, bin } = new GltfBuilder().gltf('lib/a.bin')
    write('outer/scene.gltf', json)
    const p = write('outer/lib/a.bin', bin)
    // the library root is outer/lib: the glTF above it is outside the library
    expect(await matchBuffer(fileRefFor(p, 'a.bin'))).toBeNull()
    // the same layout with the root at outer: claimed
    expect(await matchBuffer(fileRefFor(p, 'lib/a.bin'))).toMatchObject({ format: 'gltf-buffer' })
  })
  it('an FBX over the size limit is not read whole: only its head is read and the counts are marked incomplete', async () => {
    const p = write('big.fbx', asciiFbx([{ name: 'Body', size: [60, 140, 30] }], { animation: 'walk' }))
    let readWhole = false
    const af = {
      absPath: p, path: 'big.fbx', name: 'big.fbx', ext: '.fbx', size: fs.statSync(p).size, bundle: false, head: new Uint8Array(),
      read: async () => { readWhole = true; return new Uint8Array(fs.readFileSync(p)) }, readSlot: async () => null
    }
    const info = await readModel(af as never, { maxFbxBytes: 1024 })
    expect(readWhole).toBe(false)
    expect(info.kind === 'fbx' && info.fbx.complete).toBe(false)
  })
  it('a glTF JSON over the size limit is refused', async () => {
    const { json } = new GltfBuilder().gltf('x.bin')
    const p = write('big.gltf', json)
    const af = { absPath: p, path: 'big.gltf', name: 'big.gltf', ext: '.gltf', size: json.length, bundle: false, head: new Uint8Array(), read: async () => json, readSlot: async () => null }
    await expect(readModel(af as never, { maxJsonBytes: 64 })).rejects.toThrow()
  })
})
