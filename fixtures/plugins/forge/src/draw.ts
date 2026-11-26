/**
 * Fake generation output: candidate pictures drawn with sharp, candidate models written as small GLB files by hand.
 * Nothing here talks to a network service.
 */
import sharp from 'sharp'

/** Deterministic PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

/** A rendered-looking still: two shaded spheres on a dark floor, hue and layout from the seed. */
export function candidateSvg(seed: number, w: number, h: number): string {
  const r = prng(seed), hue = Math.floor(r() * 360), vw = 160, vh = Math.round((160 * h) / w)
  const cx = 50 + r() * 40, cy = vh * (0.45 + r() * 0.15), rad = 28 + r() * 20, sx = cx + rad + 10 + r() * 20, sy = cy - rad * 0.6
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice">` +
    `<defs><radialGradient id="g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="hsl(${hue} 60% 82%)"/><stop offset=".6" stop-color="hsl(${hue} 45% 48%)"/><stop offset="1" stop-color="hsl(${(hue + 20) % 360} 40% 20%)"/></radialGradient></defs>` +
    `<rect width="${vw}" height="${vh}" fill="hsl(${hue} 14% 12%)"/><ellipse cx="${vw / 2}" cy="${(vh * 0.86).toFixed(1)}" rx="64" ry="8" fill="#000" opacity=".3"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="url(#g)"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(rad * 0.4).toFixed(1)}" fill="url(#g)" opacity=".85"/></svg>`
}

export async function candidatePng(seed: number, w: number, h: number): Promise<Buffer> {
  return sharp(Buffer.from(candidateSvg(seed, w, h))).png({ palette: true, colours: 256, dither: 0, compressionLevel: 9 }).toBuffer()
}

/** A recoloured copy of a picture (the「生成变体」action): hue turned by `degrees`, same size, PNG. */
export async function tintedPng(input: Uint8Array, degrees: number): Promise<Buffer> {
  return sharp(input).modulate({ hue: degrees }).png({ compressionLevel: 9 }).toBuffer()
}

/* ───────────── a tiny GLB writer ───────────── */

interface Box { w: number; h: number; d: number; x: number; y: number; z: number; material: number }

function boxGeometry(b: Box): { pos: number[]; nor: number[]; idx: number[] } {
  const pos: number[] = [], nor: number[] = [], idx: number[] = []
  const faces: Array<[number[], number[], number[]]> = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]
  ]
  const half = [b.w / 2, b.h / 2, b.d / 2]
  for (const [n, u, v] of faces) {
    const base = pos.length / 3
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      for (let k = 0; k < 3; k++) pos.push([b.x, b.y, b.z][k]! + (n[k]! + u[k]! * su + v[k]! * sv) * half[k]!)
      nor.push(...n)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { pos, nor, idx }
}

function linear(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return Math.round((c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) * 1e4) / 1e4 })
}

/** A chest-like candidate: body, lid and two brass bands; proportions and colours vary with the seed. */
export function candidateGlb(seed: number, name: string): { glb: Buffer; colors: { wood: string; brass: string }; lid: number; triangles: number } {
  const r = prng(seed)
  const wood = `#${[0xa0 + Math.floor(r() * 0x30), 0x60 + Math.floor(r() * 0x20), 0x28 + Math.floor(r() * 0x18)].map(v => v.toString(16).padStart(2, '0')).join('')}`
  const brass = r() < 0.5 ? '#e0b14a' : '#c9cfd6'
  const lid = 0.22 + r() * 0.18, w = 1.1 + r() * 0.3, d = 0.75 + r() * 0.2
  const boxes: Box[] = [
    { w, h: 0.55, d, x: 0, y: 0.275, z: 0, material: 0 },
    { w, h: lid, d, x: 0, y: 0.55 + lid / 2, z: 0, material: 0 },
    { w: 0.1, h: 0.57 + lid, d: d + 0.02, x: -w * 0.32, y: (0.57 + lid) / 2, z: 0, material: 1 },
    { w: 0.1, h: 0.57 + lid, d: d + 0.02, x: w * 0.32, y: (0.57 + lid) / 2, z: 0, material: 1 }
  ]
  const chunks: Buffer[] = []
  let offset = 0
  const json: Record<string, any> = {
    asset: { version: '2.0', generator: 'community.forge (fake)' }, scene: 0, scenes: [{ name, nodes: [0] }],
    nodes: [{ name, children: boxes.map((_, i) => i + 1) }, ...boxes.map((_, i) => ({ name: `${name}_part${i + 1}`, mesh: i }))],
    meshes: [], accessors: [], bufferViews: [], buffers: [],
    materials: [
      { name: 'M_wood', pbrMetallicRoughness: { baseColorFactor: [...linear(wood), 1], metallicFactor: 0, roughnessFactor: 0.8 } },
      { name: 'M_brass', pbrMetallicRoughness: { baseColorFactor: [...linear(brass), 1], metallicFactor: 1, roughnessFactor: 0.35 } }
    ]
  }
  const view = (buf: Buffer, target: number) => {
    chunks.push(buf); json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target }); offset += buf.length
    return json.bufferViews.length - 1
  }
  let triangles = 0
  for (const b of boxes) {
    const g = boxGeometry(b)
    const p = Buffer.from(new Float32Array(g.pos).buffer), n = Buffer.from(new Float32Array(g.nor).buffer)
    const ix = Buffer.alloc(g.idx.length * 2); g.idx.forEach((v, i) => ix.writeUInt16LE(v, i * 2))
    const min = [0, 1, 2].map(k => Math.min(...g.pos.filter((_, i) => i % 3 === k)))
    const max = [0, 1, 2].map(k => Math.max(...g.pos.filter((_, i) => i % 3 === k)))
    json.accessors.push({ bufferView: view(p, 34962), componentType: 5126, count: g.pos.length / 3, type: 'VEC3', min, max })
    json.accessors.push({ bufferView: view(n, 34962), componentType: 5126, count: g.nor.length / 3, type: 'VEC3' })
    json.accessors.push({ bufferView: view(ix, 34963), componentType: 5123, count: g.idx.length, type: 'SCALAR' })
    const a = json.accessors.length
    json.meshes.push({ primitives: [{ attributes: { POSITION: a - 3, NORMAL: a - 2 }, indices: a - 1, material: b.material }] })
    triangles += g.idx.length / 3
  }
  let bin = Buffer.concat(chunks)
  if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))])
  json.buffers.push({ byteLength: bin.length })
  let j = Buffer.from(JSON.stringify(json), 'utf8')
  if (j.length % 4) j = Buffer.concat([j, Buffer.alloc(4 - (j.length % 4), 0x20)])
  const head = Buffer.alloc(20)
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8)
  head.writeUInt32LE(j.length, 12); head.writeUInt32LE(0x4e4f534a, 16)
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4)
  return { glb: Buffer.concat([head, j, bh, bin]), colors: { wood, brass }, lid, triangles }
}

/** A small isometric picture of a candidate model, for the pick page. */
export async function modelPreviewPng(colors: { wood: string; brass: string }, lid: number): Promise<Buffer> {
  const top = 74 - lid * 40
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 160 160"><rect width="160" height="160" fill="#2c2d31"/>` +
    `<ellipse cx="82" cy="138" rx="56" ry="9" fill="#000" opacity=".25"/>` +
    `<polygon points="36,${top} 96,${top + 14} 96,132 36,118" fill="${colors.wood}"/><polygon points="96,${top + 14} 128,${top - 2} 128,116 96,132" fill="${colors.wood}" opacity=".7"/>` +
    `<polygon points="36,${top} 96,${top + 14} 128,${top - 2} 68,${top - 16}" fill="${colors.wood}" opacity=".85"/>` +
    `<polygon points="48,${top + 3} 56,${top + 5} 56,123 48,121" fill="${colors.brass}"/><polygon points="76,${top + 9} 84,${top + 11} 84,129 76,127" fill="${colors.brass}"/>` +
    `<line x1="36" y1="92" x2="96" y2="106" stroke="${colors.brass}" stroke-width="2"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
