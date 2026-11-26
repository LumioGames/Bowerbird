// Sample 3D models, built from three.js primitives the same way as the prototype's model viewer
// (design/prototype/model.js: buildChest, buildBottle, buildHero, buildSword), then written by our own
// GLB / ASCII-FBX writers so that texture references stay external file names (slot names, ADR-018) and the
// output is byte-for-byte deterministic.
import * as T from 'three'

/* ───────────── materials (model.js ROLE) ───────────── */

export const ROLE = {
  wood: { c: '#b07236', r: 0.78, m: 0 }, brass: { c: '#e0b14a', r: 0.32, m: 1 }, lock: { c: '#ffe394', r: 0.26, m: 1 },
  inner: { c: '#2b1a0b', r: 1, m: 0 }, gold: { c: '#ffc94a', r: 0.3, m: 1, e: '#ff9a2a', ei: 1.3 },
  glass: { c: '#d7e6f2', r: 0.06, m: 0, a: 0.32 }, liquid: { c: '#e0559a', r: 0.2, m: 0 },
  cloth: { c: '#4f79c9', r: 0.9, m: 0 }, skin: { c: '#e9b48a', r: 0.7, m: 0 }, hair: { c: '#6a3b1e', r: 0.85, m: 0 },
  leather: { c: '#5a3a22', r: 0.85, m: 0 }, steel: { c: '#c3cad2', r: 0.22, m: 1 }
}

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255)
}
function linear(hex) { return hexRgb(hex).map(srgbToLinear) }
function round(v, d = 6) { const k = 10 ** d; return Math.round(v * k) / k }

function rnd(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 } }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

/* ───────────── builders ───────────── */

function box(w, h, d, x, y, z, seg = [1, 1, 1]) { const g = new T.BoxGeometry(w, h, d, ...seg); g.translate(x, y, z); return g }
function kit(name) {
  const root = new T.Group(); root.name = name
  let k = 0
  return {
    root,
    add(parent, g, role, part) {
      const m = new T.Mesh(g); m.name = `${part}_${++k}`; m.userData.role = role; parent.add(m); return m
    },
    group(parent, name, x, y, z) { const g = new T.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g }
  }
}
function halfLid(r, len, x, y, z, k, seg) { const g = new T.CylinderGeometry(r, r, len, seg, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.scale(1, k, 1); g.translate(x, y, z); return g }

export function triangles(root) {
  let n = 0
  root.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 })
  return n
}

/** Hide a disc of `target - current` triangles inside a solid part, so the count matches the prototype's badge. */
function padTriangles(K, parent, target, role, place) {
  const s = target - triangles(K.root)
  if (s === 0) return
  if (s < 3) throw new Error(`cannot pad ${K.root.name} by ${s} triangles (target ${target})`)
  const g = new T.CircleGeometry(place.r, s)
  g.rotateX(place.up ? -Math.PI / 2 : Math.PI / 2)
  g.translate(place.x, place.y, place.z)
  K.add(parent, g, role, 'detail')
}

/** model.js buildChest. `band` 0.18 is the heavier trim of the first export. */
export function buildChest({ band = 0.1, coins = 16, coinSeg = 24, lidSeg = 16, target, name = 'chest' } = {}) {
  const K = kit(name), root = K.root, bw = band
  K.add(root, box(1.2, 0.55, 0.8, 0, 0.315, 0, [4, 2, 3]), 'wood', 'body')
  K.add(root, box(1.26, 0.06, 0.86, 0, 0.03, 0), 'brass', 'base')
  K.add(root, box(1.1, 0.006, 0.7, 0, 0.592, 0), 'inner', 'inner')
  for (const x of [-0.38, 0.38]) K.add(root, box(bw, 0.57, 0.82, x, 0.315, 0), 'brass', 'band')
  K.add(root, box(0.16, 0.2, 0.04, 0, 0.47, 0.42, [2, 2, 1]), 'lock', 'lock')
  const r = rnd(5)
  for (let i = 0; i < coins; i++) {
    const c = new T.CylinderGeometry(0.07, 0.07, 0.02, coinSeg)
    c.rotateX((r() - 0.5) * 0.7); c.rotateZ((r() - 0.5) * 0.7); c.translate(-0.42 + r() * 0.84, 0.61 + r() * 0.04, -0.24 + r() * 0.48)
    K.add(root, c, 'gold', 'coin')
  }
  const hinge = K.group(root, 'lid_hinge', 0, 0.59, -0.4)
  K.add(hinge, box(1.2, 0.1, 0.8, 0, 0.05, 0.4, [4, 1, 3]), 'wood', 'lid')
  K.add(hinge, halfLid(0.4, 1.2, 0, 0.1, 0.4, 0.62, lidSeg), 'wood', 'lid_top')
  for (const x of [-0.38, 0.38]) { K.add(hinge, box(bw, 0.11, 0.82, x, 0.05, 0.4), 'brass', 'lid_band'); K.add(hinge, halfLid(0.42, bw, x, 0.1, 0.4, 0.62, lidSeg), 'brass', 'lid_band_top') }
  if (target) padTriangles(K, root, target, 'brass', { r: 0.3, x: 0, y: 0.002, z: 0, up: false })
  const ease = k => 1 - Math.pow(1 - k, 3)
  const clips = [{ name: 'open', duration: 0.8, apply: t => { hinge.rotation.x = -1.95 * ease(clamp(t / 0.8, 0, 1)) }, reset: () => { hinge.rotation.x = 0 }, animated: [hinge] }]
  return { root, clips, vcolRoles: ['wood'] }
}

/** model.js buildBottle (potion, lantern). */
export function buildBottle({ tint = {}, seg = 20, target, name = 'potion' } = {}) {
  // two lathes give 24 triangles per radial segment, the cork 48
  if (target) seg = Math.floor((target - 48 - 3) / 24)
  const K = kit(name), root = K.root
  const V = p => p.map(q => new T.Vector2(q[0], q[1]))
  K.add(root, new T.LatheGeometry(V([[0, 0.03], [0.24, 0.04], [0.33, 0.15], [0.34, 0.3], [0, 0.3]]), seg), 'liquid', 'liquid')
  K.add(root, new T.LatheGeometry(V([[0, 0], [0.26, 0.02], [0.36, 0.14], [0.38, 0.34], [0.3, 0.52], [0.12, 0.62], [0.11, 0.78], [0.13, 0.8], [0, 0.8]]), seg), 'glass', 'glass')
  const cork = new T.CylinderGeometry(0.1, 0.09, 0.12, 12); cork.translate(0, 0.85, 0); K.add(root, cork, 'wood', 'cork')
  if (target) padTriangles(K, root, target, 'wood', { r: 0.05, x: 0, y: 0.85, z: 0, up: true })
  return { root, clips: [], tint }
}

/** model.js buildHero (hero, npc_guard, npc_merchant). `cell` sets how finely the boxes are subdivided. */
export function buildHero({ tint = {}, target, name = 'hero', clips: clipNames = ['idle', 'walk'], cell = 0.03 } = {}) {
  if (target) {
    // the coarsest subdivision that still fits under the target; the rest is padded
    for (let c = 0.06; c >= 0.01; c -= 0.0005) { if (triangles(buildHero({ cell: c, clips: [] }).root) <= target - 3) cell = c; else break }
  }
  const seg = (w, h, d) => [w, h, d].map(v => Math.max(1, Math.round(v / cell)))
  const sbox = (w, h, d, x, y, z) => box(w, h, d, x, y, z, seg(w, h, d))
  const K = kit(name), root = K.root
  const hips = K.group(root, 'hips', 0, 0.52, 0)
  const legL = K.group(root, 'leg_l', -0.1, 0.5, 0), legR = K.group(root, 'leg_r', 0.1, 0.5, 0)
  const armL = K.group(root, 'arm_l', -0.27, 0.98, 0), armR = K.group(root, 'arm_r', 0.27, 0.98, 0)
  const chest = K.group(root, 'chest', 0, 0.56, 0)
  for (const l of [legL, legR]) K.add(l, sbox(0.14, 0.48, 0.16, 0, -0.25, 0), 'leather', 'leg')
  K.add(chest, sbox(0.42, 0.48, 0.24, 0, 0.22, 0), 'cloth', 'torso'); K.add(chest, sbox(0.44, 0.06, 0.26, 0, 0, 0), 'brass', 'belt')
  const head = K.group(chest, 'head', 0, 0.5, 0)
  K.add(head, sbox(0.3, 0.3, 0.28, 0, 0.15, 0), 'skin', 'head'); K.add(head, sbox(0.32, 0.12, 0.3, 0, 0.3, -0.01), 'hair', 'hair')
  for (const a of [armL, armR]) { K.add(a, sbox(0.12, 0.44, 0.14, 0, -0.21, 0), 'cloth', 'arm'); K.add(a, sbox(0.11, 0.1, 0.12, 0, -0.47, 0), 'skin', 'hand') }
  if (target) padTriangles(K, chest, target, 'cloth', { r: 0.08, x: 0, y: 0.22, z: 0, up: true })
  void hips
  const pose = (w, s) => {
    legL.rotation.x = w ? s * 0.55 : 0; legR.rotation.x = w ? -s * 0.55 : 0
    armL.rotation.x = w ? -s * 0.5 : s * 0.04; armR.rotation.x = w ? s * 0.5 : -s * 0.04
    chest.position.y = 0.56 + (w ? Math.abs(s) * 0.02 : s * 0.008); head.rotation.y = w ? 0 : s * 0.08
  }
  const all = [legL, legR, armL, armR, chest, head]
  const defs = { idle: { duration: 2, walk: false }, walk: { duration: 1, walk: true } }
  const clips = clipNames.map(n => ({
    name: n, duration: defs[n].duration, animated: all,
    apply: t => pose(defs[n].walk, Math.sin(t / defs[n].duration * Math.PI * 2)),
    reset: () => pose(false, 0)
  }))
  return { root, clips, tint, vcolRoles: ['cloth'] }
}

/** model.js buildSword. */
export function buildSword({ target, name = 'sword_iron' } = {}) {
  const K = kit(name), root = K.root
  K.add(root, box(0.08, 0.9, 0.02, 0, 0.78, 0, [4, 24, 1]), 'steel', 'blade')
  const tip = new T.ConeGeometry(0.057, 0.12, 4); tip.rotateY(Math.PI / 4); tip.scale(1, 1, 0.35); tip.translate(0, 1.29, 0); K.add(root, tip, 'steel', 'tip')
  K.add(root, box(0.36, 0.06, 0.08, 0, 0.31, 0, [12, 2, 3]), 'brass', 'guard')
  const grip = new T.CylinderGeometry(0.035, 0.035, 0.24, 24, 16); grip.translate(0, 0.16, 0); K.add(root, grip, 'leather', 'grip')
  const pom = new T.SphereGeometry(0.05, 32, 24); pom.translate(0, 0.02, 0); K.add(root, pom, 'brass', 'pommel')
  if (target) padTriangles(K, root, target, 'leather', { r: 0.02, x: 0, y: 0.16, z: 0, up: true })
  return { root, clips: [] }
}

/* ───────────── vertex colours (model.js paintVcol) ───────────── */

/** RGBA per vertex: R = dirt towards the floor, G = noise, B = top wear, A = mask. Near white, so the full render stays readable. */
function vertexColors(mesh, vcolRoles) {
  const g = mesh.geometry, pos = g.attributes.position, n = pos.count, out = new Uint8Array(n * 4), p = new T.Vector3()
  const strong = vcolRoles.includes(mesh.userData.role)
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    const dirt = clamp(1 - p.y / 0.42, 0, 1)
    let h = Math.sin(p.x * 12.9898 + p.z * 78.233 + p.y * 37.719) * 43758.5453; h -= Math.floor(h)
    const top = clamp((p.y - 0.6) * 2.6 + (p.z < 0 ? 0.25 : 0), 0, 1)
    out[i * 4] = Math.round(255 * (1 - 0.35 * dirt * dirt))
    out[i * 4 + 1] = Math.round(255 * (strong ? 0.82 + 0.18 * h : 0.95))
    out[i * 4 + 2] = Math.round(255 * (0.88 + 0.12 * top))
    out[i * 4 + 3] = Math.round(255 * (strong ? h : 0.5))
  }
  return out
}

/* ───────────── GLB writer ───────────── */

/**
 * @param model { root, clips, tint, vcolRoles }
 * @param opts.textures role → { baseColor?, normal?, orm? } external image URIs (slot names)
 * @param opts.vcol write COLOR_0
 */
export function writeGlb(model, { textures = {}, vcol = false, generator = 'Bowerbird fixtures generator' } = {}) {
  const { root } = model
  for (const c of model.clips ?? []) c.reset?.()
  root.updateMatrixWorld(true)
  const json = {
    asset: { version: '2.0', generator },
    scene: 0, scenes: [{ name: root.name, nodes: [0] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }]
  }
  const chunks = []
  let offset = 0
  function view(typed, target) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    const pad = (4 - (offset % 4)) % 4
    if (pad) { chunks.push(new Uint8Array(pad)); offset += pad }
    chunks.push(bytes.slice())
    const bv = { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength }
    if (target) bv.target = target
    offset += bytes.byteLength
    json.bufferViews.push(bv)
    return json.bufferViews.length - 1
  }
  function accessor(typed, type, componentType, count, { target, normalized, minmax } = {}) {
    const a = { bufferView: view(typed, target), componentType, count, type }
    if (normalized) a.normalized = true
    if (minmax) Object.assign(a, minmax)
    json.accessors.push(a)
    return json.accessors.length - 1
  }
  function minmax(arr, size) {
    const min = Array(size).fill(Infinity), max = Array(size).fill(-Infinity)
    for (let i = 0; i < arr.length; i += size) for (let k = 0; k < size; k++) { min[k] = Math.min(min[k], arr[i + k]); max[k] = Math.max(max[k], arr[i + k]) }
    return { min: min.map(v => round(v)), max: max.map(v => round(v)) }
  }

  // materials and textures
  const matIndex = new Map(), images = [], textureIdx = new Map()
  function tex(uri) {
    if (textureIdx.has(uri)) return textureIdx.get(uri)
    images.push({ uri })
    json.textures ??= []; json.samplers ??= [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
    json.textures.push({ sampler: 0, source: images.length - 1 })
    textureIdx.set(uri, json.textures.length - 1)
    return json.textures.length - 1
  }
  function material(role) {
    if (matIndex.has(role)) return matIndex.get(role)
    const R = { ...ROLE[role] }
    if (model.tint?.[role]) R.c = model.tint[role]
    const t = textures[role] ?? {}
    const pbr = { baseColorFactor: t.baseColor ? [1, 1, 1, 1] : [...linear(R.c).map(v => round(v)), R.a ?? 1], metallicFactor: R.m, roughnessFactor: R.r }
    if (t.baseColor) pbr.baseColorTexture = { index: tex(t.baseColor) }
    if (t.orm) pbr.metallicRoughnessTexture = { index: tex(t.orm) }
    const m = { name: 'M_' + role, pbrMetallicRoughness: pbr }
    if (t.normal) m.normalTexture = { index: tex(t.normal) }
    if (t.orm) m.occlusionTexture = { index: tex(t.orm) }
    if (R.e) { m.emissiveFactor = linear(R.e).map(v => round(Math.min(1, v * (R.ei ?? 1)))) }
    if (R.a != null) m.alphaMode = 'BLEND'
    json.materials.push(m)
    matIndex.set(role, json.materials.length - 1)
    return json.materials.length - 1
  }

  // nodes
  const nodeIndex = new Map()
  function addNode(o) {
    const n = { name: o.name || undefined }
    const idx = json.nodes.length
    json.nodes.push(n)
    nodeIndex.set(o, idx)
    if (o.position.x || o.position.y || o.position.z) n.translation = o.position.toArray().map(v => round(v))
    const q = o.quaternion
    if (q.x || q.y || q.z || q.w !== 1) n.rotation = q.toArray().map(v => round(v))
    if (o.isMesh) {
      const g = o.geometry
      const pos = g.attributes.position.array, nor = g.attributes.normal.array, uv = g.attributes.uv?.array
      const count = g.attributes.position.count
      const attrs = {
        POSITION: accessor(new Float32Array(pos), 'VEC3', 5126, count, { target: 34962, minmax: minmax(pos, 3) }),
        NORMAL: accessor(new Float32Array(nor), 'VEC3', 5126, count, { target: 34962 })
      }
      if (uv) { const f = new Float32Array(uv); for (let i = 1; i < f.length; i += 2) f[i] = 1 - f[i]; attrs.TEXCOORD_0 = accessor(f, 'VEC2', 5126, count, { target: 34962 }) }
      if (vcol) attrs.COLOR_0 = accessor(vertexColors(o, model.vcolRoles ?? []), 'VEC4', 5121, count, { target: 34962, normalized: true })
      const idxArr = g.index ? g.index.array : Array.from({ length: count }, (_, i) => i)
      const indices = count > 65535 ? new Uint32Array(idxArr) : new Uint16Array(idxArr)
      const prim = { attributes: attrs, indices: accessor(indices, 'SCALAR', count > 65535 ? 5125 : 5123, indices.length, { target: 34963 }), material: material(o.userData.role), mode: 4 }
      json.meshes.push({ name: o.name, primitives: [prim] })
      n.mesh = json.meshes.length - 1
    }
    const kids = o.children.map(addNode)
    if (kids.length) n.children = kids
    return idx
  }
  addNode(root)

  // animations: sample each clip at 30 fps
  for (const clip of model.clips ?? []) {
    const fps = 30, steps = Math.round(clip.duration * fps)
    const times = Float32Array.from({ length: steps + 1 }, (_, i) => round(i / fps))
    const rot = new Map(), tr = new Map()
    for (const o of clip.animated) { rot.set(o, []); tr.set(o, []) }
    for (let i = 0; i <= steps; i++) {
      clip.apply(times[i])
      for (const o of clip.animated) { rot.get(o).push(...o.quaternion.toArray().map(v => round(v))); tr.get(o).push(...o.position.toArray().map(v => round(v))) }
    }
    clip.reset()
    const anim = { name: clip.name, channels: [], samplers: [] }
    const input = accessor(times, 'SCALAR', 5126, times.length, { minmax: { min: [0], max: [round(times[times.length - 1])] } })
    for (const o of clip.animated) {
      const r = rot.get(o), t = tr.get(o)
      const varies = (arr, size) => arr.some((v, i) => v !== arr[i % size])
      if (varies(r, 4)) {
        anim.samplers.push({ input, output: accessor(new Float32Array(r), 'VEC4', 5126, steps + 1), interpolation: 'LINEAR' })
        anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: nodeIndex.get(o), path: 'rotation' } })
      }
      if (varies(t, 3)) {
        anim.samplers.push({ input, output: accessor(new Float32Array(t), 'VEC3', 5126, steps + 1), interpolation: 'LINEAR' })
        anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: nodeIndex.get(o), path: 'translation' } })
      }
    }
    if (anim.channels.length) (json.animations ??= []).push(anim)
  }
  if (images.length) json.images = images
  json.buffers[0].byteLength = offset
  const bin = new Uint8Array(offset + ((4 - (offset % 4)) % 4))
  let p = 0
  for (const c of chunks) { bin.set(c, p); p += c.byteLength }
  for (const n of json.nodes) if (n.name === undefined) delete n.name
  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jpad = (4 - (jsonBytes.length % 4)) % 4
  if (jpad) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jpad, 0x20)])
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonBytes.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(out, 20)
  const b0 = 20 + jsonBytes.length
  out.writeUInt32LE(bin.length, b0); out.writeUInt32LE(0x004e4942, b0 + 4); Buffer.from(bin).copy(out, b0 + 8)
  return out
}

/* ───────────── ASCII FBX 7.4 writer ───────────── */

const KTIME = 46186158000
function num(v) { const r = round(v, 6); return Object.is(r, -0) ? '0' : String(r) }

/**
 * Writes an ASCII FBX 7.4 file three.js FBXLoader reads: Null pivots, one Mesh model per part, phong materials with
 * only a diffuse colour (no roughness / metalness / occlusion), and one animation stack per clip on Lcl Rotation /
 * Lcl Translation of the pivots.
 */
export function writeFbxAscii(model, { stamp, creator = 'Bowerbird fixtures generator' }) {
  const { root } = model
  for (const c of model.clips ?? []) c.reset?.()
  root.updateMatrixWorld(true)
  let nextId = 1000000
  const id = () => ++nextId
  const objects = [], conns = []
  const modelId = new Map(), matIds = new Map()
  const tab = n => '\t'.repeat(n)
  const arr = (name, values, ind) => `${tab(ind)}${name}: *${values.length} {\n${tab(ind + 1)}a: ${values.join(',')}\n${tab(ind)}}`

  function material(role) {
    if (matIds.has(role)) return matIds.get(role)
    const mid = id(); matIds.set(role, mid)
    const c = hexRgb(model.tint?.[role] ?? ROLE[role].c)
    objects.push([
      `\tMaterial: ${mid}, "Material::M_${role}", "" {`,
      '\t\tVersion: 102', '\t\tShadingModel: "phong"', '\t\tMultiLayer: 0', '\t\tProperties70:  {',
      `\t\t\tP: "DiffuseColor", "Color", "", "A",${c.map(num).join(',')}`,
      '\t\t\tP: "DiffuseFactor", "Number", "", "A",1',
      '\t\t\tP: "SpecularColor", "Color", "", "A",0.2,0.2,0.2',
      '\t\t\tP: "Shininess", "Number", "", "A",8',
      '\t\t}', '\t}'
    ].join('\n'))
    return mid
  }
  function addModel(o, parentId) {
    const mid = id(); modelId.set(o, mid)
    const type = o.isMesh ? 'Mesh' : 'Null'
    const props = []
    if (o.position.x || o.position.y || o.position.z) props.push(`\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${o.position.toArray().map(num).join(',')}`)
    const e = o.rotation
    if (e.x || e.y || e.z) props.push(`\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",${[e.x, e.y, e.z].map(v => num(v * 180 / Math.PI)).join(',')}`)
    objects.push([`\tModel: ${mid}, "Model::${o.name}", "${type}" {`, '\t\tVersion: 232', '\t\tProperties70:  {', ...props, '\t\t}', '\t\tShading: Y', '\t\tCulling: "CullingOff"', '\t}'].join('\n'))
    conns.push(`\tC: "OO",${mid},${parentId}`)
    if (o.isMesh) {
      const g = o.geometry.index ? o.geometry : o.geometry
      const pos = Array.from(g.attributes.position.array), nor = Array.from(g.attributes.normal.array), uv = Array.from(g.attributes.uv.array)
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.length / 3 }, (_, i) => i)
      const pvi = []
      for (let i = 0; i < idx.length; i += 3) pvi.push(idx[i], idx[i + 1], -(idx[i + 2] + 1))
      const gid = id()
      objects.push([
        `\tGeometry: ${gid}, "Geometry::${o.name}", "Mesh" {`,
        arr('Vertices', pos.map(num), 2), arr('PolygonVertexIndex', pvi, 2), '\t\tGeometryVersion: 124',
        '\t\tLayerElementNormal: 0 {', '\t\t\tVersion: 101', '\t\t\tName: ""', '\t\t\tMappingInformationType: "ByVertice"', '\t\t\tReferenceInformationType: "Direct"', arr('Normals', nor.map(num), 3), '\t\t}',
        '\t\tLayerElementUV: 0 {', '\t\t\tVersion: 101', '\t\t\tName: "map1"', '\t\t\tMappingInformationType: "ByVertice"', '\t\t\tReferenceInformationType: "Direct"', arr('UV', uv.map(num), 3), '\t\t}',
        '\t\tLayerElementMaterial: 0 {', '\t\t\tVersion: 101', '\t\t\tName: ""', '\t\t\tMappingInformationType: "AllSame"', '\t\t\tReferenceInformationType: "IndexToDirect"', arr('Materials', [0], 3), '\t\t}',
        '\t\tLayer: 0 {', '\t\t\tVersion: 100',
        '\t\t\tLayerElement:  {', '\t\t\t\tType: "LayerElementNormal"', '\t\t\t\tTypedIndex: 0', '\t\t\t}',
        '\t\t\tLayerElement:  {', '\t\t\t\tType: "LayerElementMaterial"', '\t\t\t\tTypedIndex: 0', '\t\t\t}',
        '\t\t\tLayerElement:  {', '\t\t\t\tType: "LayerElementUV"', '\t\t\t\tTypedIndex: 0', '\t\t\t}',
        '\t\t}', '\t}'
      ].join('\n'))
      conns.push(`\tC: "OO",${gid},${mid}`)
      conns.push(`\tC: "OO",${material(o.userData.role)},${mid}`)
    }
    for (const c of o.children) addModel(c, mid)
  }
  addModel(root, 0)

  let stops = 0
  for (const clip of model.clips ?? []) {
    const fps = 30, steps = Math.round(clip.duration * fps)
    const times = Array.from({ length: steps + 1 }, (_, i) => Math.round(i / fps * KTIME))
    const samples = new Map(clip.animated.map(o => [o, { r: [[], [], []], t: [[], [], []] }]))
    for (let i = 0; i <= steps; i++) {
      clip.apply(i / fps)
      for (const o of clip.animated) {
        const s = samples.get(o)
        ;[o.rotation.x, o.rotation.y, o.rotation.z].forEach((v, k) => s.r[k].push(v * 180 / Math.PI))
        ;[o.position.x, o.position.y, o.position.z].forEach((v, k) => s.t[k].push(v))
      }
    }
    clip.reset()
    stops = Math.max(stops, times[times.length - 1])
    const stack = id(), layer = id()
    objects.push([`\tAnimationStack: ${stack}, "AnimStack::${clip.name}", "" {`, '\t\tProperties70:  {', `\t\t\tP: "LocalStop", "KTime", "Time", "",${times[times.length - 1]}`, `\t\t\tP: "ReferenceStop", "KTime", "Time", "",${times[times.length - 1]}`, '\t\t}', '\t}'].join('\n'))
    objects.push(`\tAnimationLayer: ${layer}, "AnimLayer::BaseLayer", "" {\n\t}`)
    conns.push(`\tC: "OO",${layer},${stack}`)
    for (const o of clip.animated) {
      const s = samples.get(o)
      for (const [attr, prop, data] of [['R', 'Lcl Rotation', s.r], ['T', 'Lcl Translation', s.t]]) {
        if (!data.some(axis => axis.some(v => Math.abs(v - axis[0]) > 1e-9))) continue
        const cn = id()
        objects.push([`\tAnimationCurveNode: ${cn}, "AnimCurveNode::${attr}", "" {`, '\t\tProperties70:  {', ...['X', 'Y', 'Z'].map((ax, k) => `\t\t\tP: "d|${ax}", "Number", "", "A",${num(data[k][0])}`), '\t\t}', '\t}'].join('\n'))
        conns.push(`\tC: "OO",${cn},${layer}`)
        conns.push(`\tC: "OP",${cn},${modelId.get(o)}, "${prop}"`)
        ;['X', 'Y', 'Z'].forEach((ax, k) => {
          const cv = id()
          objects.push([`\tAnimationCurve: ${cv}, "AnimCurve::", "" {`, `\t\tDefault: ${num(data[k][0])}`, '\t\tKeyVer: 4009', arr('KeyTime', times, 2), arr('KeyValueFloat', data[k].map(num), 2),
            arr('KeyAttrFlags', [24840], 2), arr('KeyAttrDataFloat', [0, 0, 255790911, 0], 2), arr('KeyAttrRefCount', [times.length], 2), '\t}'].join('\n'))
          conns.push(`\tC: "OP",${cv},${cn}, "d|${ax}"`)
        })
      }
    }
  }

  const d = new Date(stamp)
  const header = [
    '; FBX 7.4.0 project file',
    '; Generated by the Bowerbird fixtures generator (fixtures/scripts). Original content, MIT licensed.',
    '; ----------------------------------------------------',
    '',
    'FBXHeaderExtension:  {',
    '\tFBXHeaderVersion: 1003', '\tFBXVersion: 7400',
    '\tCreationTimeStamp:  {', '\t\tVersion: 1000', `\t\tYear: ${d.getUTCFullYear()}`, `\t\tMonth: ${d.getUTCMonth() + 1}`, `\t\tDay: ${d.getUTCDate()}`,
    `\t\tHour: ${d.getUTCHours()}`, `\t\tMinute: ${d.getUTCMinutes()}`, `\t\tSecond: ${d.getUTCSeconds()}`, '\t\tMillisecond: 0', '\t}',
    `\tCreator: "${creator}"`,
    '}',
    'GlobalSettings:  {', '\tVersion: 1000', '\tProperties70:  {',
    '\t\tP: "UpAxis", "int", "Integer", "",1', '\t\tP: "UpAxisSign", "int", "Integer", "",1',
    '\t\tP: "FrontAxis", "int", "Integer", "",2', '\t\tP: "FrontAxisSign", "int", "Integer", "",1',
    '\t\tP: "CoordAxis", "int", "Integer", "",0', '\t\tP: "CoordAxisSign", "int", "Integer", "",1',
    '\t\tP: "UnitScaleFactor", "double", "Number", "",100',
    '\t\tP: "TimeMode", "enum", "", "",6',
    `\t\tP: "TimeSpanStop", "KTime", "Time", "",${stops}`,
    '\t}', '}',
    ''
  ]
  return Buffer.from([...header, 'Objects:  {', ...objects, '}', '', 'Connections:  {', ...conns, '}', ''].join('\n'), 'utf8')
}

/* ───────────── OBJ (rock_01.obj: real OBJ text, unsupported in phase one) ───────────── */

export function rockObj(seed = 11) {
  const g = new T.IcosahedronGeometry(1, 3)
  const pos = g.attributes.position, r = rnd(seed), key = v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
  const bump = new Map(), v = new T.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const k = key(v)
    if (!bump.has(k)) bump.set(k, 0.78 + r() * 0.36)
    const s = bump.get(k)
    pos.setXYZ(i, v.x * s * 1.4, v.y * s * 0.8 + 0.6, v.z * s)
  }
  const verts = [], index = new Map(), faces = []
  for (let i = 0; i < pos.count; i += 3) {
    const f = []
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, i + k)
      const kk = key(v)
      if (!index.has(kk)) { index.set(kk, verts.length + 1); verts.push(kk) }
      f.push(index.get(kk))
    }
    faces.push(f)
  }
  return ['# rock_01.obj — generated by the Bowerbird fixtures generator (original content, MIT licensed)', 'o rock_01',
    ...verts.map(s => 'v ' + s.split(',').join(' ')), 's 1', ...faces.map(f => 'f ' + f.join(' ')), ''].join('\n')
}
