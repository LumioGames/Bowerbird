/**
 * Malformed model files for the parsers (review P1/P2): each one is small and claims to be a valid GLB or FBX,
 * but would make a naive reader loop forever, allocate gigabytes, or read outside the library.
 * Used by this plugin's tests and by the shared contract table (tests/contract).
 */
import { deflateSync } from 'node:zlib'
import { binaryFbx, packGlb } from './builders.js'

/** Binary FBX whose first node says it ends where it starts: a reader that trusts `end` reads it forever. */
export function fbxBackwardsEnd(): Uint8Array {
  const out = Buffer.alloc(27 + 14 + 13)
  out.write('Kaydara FBX Binary  ', 0, 'latin1'); out[20] = 0; out[21] = 0x1a; out[22] = 0; out.writeUInt32LE(7400, 23)
  out.writeUInt32LE(27, 27) // end offset = start of this very record
  out.writeUInt32LE(0, 31); out.writeUInt32LE(0, 35); out[39] = 1; out.write('A', 40, 'latin1')
  return new Uint8Array(out)
}

/** Binary FBX whose child record ends before its parent's properties: the nested reader goes backwards. */
export function fbxNestedBackwards(): Uint8Array {
  const out = Buffer.alloc(27 + 13 + 7 + 13 + 1 + 13 + 13)
  out.write('Kaydara FBX Binary  ', 0, 'latin1'); out[21] = 0x1a; out.writeUInt32LE(7400, 23)
  let o = 27
  out.writeUInt32LE(out.length - 13, o); out.writeUInt32LE(0, o + 4); out.writeUInt32LE(0, o + 8); out[o + 12] = 7; out.write('Objects', o + 13, 'latin1')
  o += 20
  out.writeUInt32LE(30, o); out.writeUInt32LE(0, o + 4); out.writeUInt32LE(0, o + 8); out[o + 12] = 1; out.write('G', o + 13, 'latin1')
  return new Uint8Array(out)
}

/**
 * Binary FBX with a polygon index array that claims 6 elements but whose zlib data inflates to `mb` megabytes
 * (a decompression bomb). A reader must stop at 6 × 4 bytes.
 */
export function fbxZlibBomb(mb = 64): Uint8Array {
  const bomb = deflateSync(Buffer.alloc(mb * 1024 * 1024), { level: 9 })
  // a raw 'i' array property: length, encoding 1 (zlib), compressed length, data
  const head = Buffer.alloc(13)
  head.write('i', 0, 'latin1'); head.writeUInt32LE(6, 1); head.writeUInt32LE(1, 5); head.writeUInt32LE(bomb.length, 9)
  const prop = Buffer.concat([head, bomb])
  const name = Buffer.from('PolygonVertexIndex', 'latin1')
  const geoName = Buffer.from('Geometry', 'latin1')
  const objName = Buffer.from('Objects', 'latin1')
  const parts: Buffer[] = []
  const hdr = Buffer.alloc(27); hdr.write('Kaydara FBX Binary  ', 0, 'latin1'); hdr[21] = 0x1a; hdr.writeUInt32LE(7400, 23)
  parts.push(hdr)
  let o = 27
  const objStart = o
  // Objects { Geometry { PolygonVertexIndex: <bomb> } }
  const rec = (n: Buffer, props: Buffer, nprops: number, end: number) => { const h = Buffer.alloc(13); h.writeUInt32LE(end, 0); h.writeUInt32LE(nprops, 4); h.writeUInt32LE(props.length, 8); h[12] = n.length; return Buffer.concat([h, n, props]) }
  const pviLen = 13 + name.length + prop.length
  const geoLen = 13 + geoName.length + pviLen + 13
  const objLen = 13 + objName.length + geoLen + 13
  parts.push(rec(objName, Buffer.alloc(0), 0, objStart + objLen))
  o += 13 + objName.length
  parts.push(rec(geoName, Buffer.alloc(0), 0, o + geoLen))
  o += 13 + geoName.length
  parts.push(rec(name, prop, 1, o + pviLen))
  parts.push(Buffer.alloc(13), Buffer.alloc(13), Buffer.alloc(13))
  return new Uint8Array(Buffer.concat(parts))
}

/** Binary FBX with an index array that claims two billion elements in twelve bytes. */
export function fbxHugeArray(): Uint8Array {
  const b = Buffer.from(binaryFbx([{ name: 'Objects', children: [{ name: 'Geometry', props: [{ t: 'L', v: 1 }, { t: 'S', v: 'G\u0000\u0001Geometry' }, { t: 'S', v: 'Mesh' }], children: [
    { name: 'Vertices', props: [{ t: 'd', v: [0, 0, 0] }] },
    { name: 'PolygonVertexIndex', props: [{ t: 'i', v: [0, 1, -3] }] }
  ] }] }]))
  const at = b.indexOf(Buffer.from('PolygonVertexIndexi', 'latin1')) + 'PolygonVertexIndex'.length
  b.writeUInt32LE(0x7fffffff, at + 1)
  return new Uint8Array(b)
}

/** Deeply nested ASCII FBX (`a: { a: { … } }`): recursion must stop at a fixed depth. */
export function fbxDeepAscii(depth = 200_000): string {
  return '; FBX 7.4.0 project file\nObjects:  {\n' + 'A: {\n'.repeat(depth) + '}\n'.repeat(depth) + '}\n'
}

function glb(json: unknown, bin: Uint8Array | null = null): Uint8Array { return packGlb(json, bin) }

/** glTF whose node lists itself as its child twice: a walk without a visited set never ends. */
export function gltfChildCycle(): Uint8Array {
  return glb({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ children: [0, 0] }] })
}

/** glTF where every node lists the next one twice: 2^40 paths through 41 nodes. */
export function gltfChildFanout(levels = 40): Uint8Array {
  const nodes = Array.from({ length: levels + 1 }, (_, i) => (i < levels ? { children: [i + 1, i + 1] } : { mesh: 0 }))
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  return glb({
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }]
  }, new Uint8Array(pos.buffer))
}

/** glTF skin whose inverse-bind-matrix accessor claims a billion matrices with a zero stride over 64 bytes. */
export function gltfIbmBomb(): Uint8Array {
  const ibm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const bin = new Uint8Array(64 + 36)
  bin.set(new Uint8Array(ibm.buffer), 0); bin.set(new Uint8Array(pos.buffer), 64)
  return glb({
    asset: { version: '2.0' }, scenes: [{ nodes: [1] }],
    nodes: [{ name: 'hip' }, { mesh: 0, skin: 0, children: [0] }],
    skins: [{ joints: [0], inverseBindMatrices: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 } }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 64, byteStride: 0 }, { buffer: 0, byteOffset: 64, byteLength: 36 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 1_000_000_000, type: 'MAT4' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }
    ]
  }, bin)
}

/** A glTF JSON that names buffers and images by absolute URLs (the browser must not fetch them). */
export function gltfRemoteRefs(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: 'http://192.168.1.1/secret.bin', byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }]
  }))
}
