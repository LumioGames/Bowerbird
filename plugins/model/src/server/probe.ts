/**
 * Server-side reading of model files: GLB / glTF fully from the JSON (and BIN chunk), FBX lightly
 * (builtin-plugins.md「提取的技术信息」). The browser fills in the rest of FBX when it renders the thumbnail.
 */
import fs from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import type { AssetFile, ProbeResult } from '@bowerbird/plugin-sdk'
import { boundsSize, gltfInfo, openGltf, bytesSource, type ByteSource, type GltfInfo } from '../shared/gltf.js'
import { fbxInfo, parseFbx, type FbxInfo } from '../shared/fbx.js'
import { imageSize } from '../shared/image-size.js'
import type { Size3 } from '../shared/size.js'
import { trianglesBadge } from '../shared/badge.js'

export type ModelKind = 'glb' | 'gltf' | 'fbx'

export function kindOf(ext: string): ModelKind | null {
  const e = ext.toLowerCase()
  return e === '.glb' ? 'glb' : e === '.gltf' ? 'gltf' : e === '.fbx' ? 'fbx' : null
}

/** Range reads straight from disk, so a 500 MB GLB is not loaded to read its JSON chunk. */
async function fileSource(asset: AssetFile): Promise<ByteSource> {
  try {
    const fh = await fs.open(asset.absPath, 'r')
    const st = await fh.stat()
    await fh.close()
    return {
      size: st.size,
      async read(offset, length) {
        const h = await fs.open(asset.absPath, 'r')
        try {
          const n = Math.max(0, Math.min(length, st.size - offset))
          const buf = Buffer.alloc(n)
          await h.read(buf, 0, n, offset)
          return new Uint8Array(buf.buffer, buf.byteOffset, n)
        } finally { await h.close() }
      }
    }
  } catch {
    return bytesSource(await asset.read())
  }
}

/** zlib with the output capped at what the array declares (a decompression bomb stops there, review P1-2). */
export const inflateBounded = (d: Uint8Array, max: number): Uint8Array =>
  new Uint8Array(inflateSync(d, { maxOutputLength: Math.max(1, max) }))

/** FBX files larger than this are not read whole: only their head, and the counts are marked incomplete. */
export const MAX_FBX_BYTES = 256 * 1024 * 1024
/** How much of an oversized FBX is read. */
export const FBX_HEAD_BYTES = 4 * 1024 * 1024

export interface ReadOptions {
  maxFbxBytes?: number
  maxJsonBytes?: number
}

export type ModelInfo =
  | { kind: 'glb' | 'gltf'; gltf: GltfInfo; size: Size3 | null }
  | { kind: 'fbx'; fbx: FbxInfo; size: Size3 | null }

export async function readModel(asset: AssetFile, opts: ReadOptions = {}): Promise<ModelInfo> {
  const kind = kindOf(asset.ext)
  if (kind === 'glb' || kind === 'gltf') {
    const c = await openGltf(await fileSource(asset), opts.maxJsonBytes !== undefined ? { maxJsonBytes: opts.maxJsonBytes } : {})
    const gltf = await gltfInfo(c, slot => asset.readSlot(slot))
    return { kind, gltf, size: boundsSize(gltf.bounds) }
  }
  if (kind === 'fbx') {
    const src = await fileSource(asset)
    const cap = opts.maxFbxBytes ?? MAX_FBX_BYTES
    const partial = src.size > cap
    const bytes = await src.read(0, partial ? Math.min(cap, FBX_HEAD_BYTES) : src.size)
    const fbx = fbxInfo(parseFbx(bytes, inflateBounded, { partial }))
    // external textures: their sizes come from the files the slots point at
    for (const t of fbx.textureList) {
      if (t.embedded || t.width) continue
      const bytes = await asset.readSlot(t.slot).catch(() => null)
      const s = bytes ? imageSize(bytes) : null
      if (s) { t.width = s.width; t.height = s.height }
    }
    fbx.maxTextureSize = fbx.textureList.reduce((m, t) => Math.max(m, t.width ?? 0, t.height ?? 0), 0)
    return { kind, fbx, size: null }
  }
  throw new Error(`not a model file: ${asset.name}`)
}

export { trianglesBadge }

export function probeResult(info: ModelInfo): ProbeResult {
  if (info.kind === 'fbx') {
    const f = info.fbx
    const tech: ProbeResult['tech'] = {
      triangles: f.triangles, vertices: f.vertices, meshes: f.meshes, materials: f.materials, textures: f.textures,
      maxTextureSize: f.maxTextureSize, bones: f.bones, animations: f.animations,
      hasUV: f.hasUV, hasNormals: f.hasNormals, hasVertexColors: f.hasVertexColors, vertexColorSets: f.vertexColorSets
    }
    const references = f.textureList.map(t => t.slot)
    return {
      tech,
      // an incomplete read without faces says nothing rather than「0 面」
      ...(f.complete || f.triangles > 0 ? { badge: trianglesBadge(f.triangles) } : {}),
      references,
      embedded: f.textureList.filter(t => t.embedded).map(t => t.slot),
      analysis: { clipNames: f.clipNames, materialNames: f.materialNames },
      text: [...f.materialNames, ...f.clipNames].join(' ')
    }
  }
  const g = info.gltf
  const tech: ProbeResult['tech'] = {
    triangles: g.triangles, vertices: g.vertices, meshes: g.meshes, materials: g.materials, textures: g.textures,
    maxTextureSize: g.maxTextureSize, bones: g.bones, animations: g.animations,
    hasUV: g.hasUV, hasNormals: g.hasNormals, hasVertexColors: g.hasVertexColors, vertexColorSets: g.vertexColorSets
  }
  if (info.size) { tech.boundsX = info.size.x; tech.boundsY = info.size.y; tech.boundsZ = info.size.z }
  return {
    tech,
    badge: trianglesBadge(g.triangles),
    references: g.references,
    embedded: g.embedded,
    analysis: { clipNames: g.clipNames, materialNames: g.materialNames },
    text: [...g.materialNames, ...g.clipNames].join(' ')
  }
}

const KIND_LABEL: Record<ModelKind, string> = { glb: 'GLB', gltf: 'glTF', fbx: 'FBX' }

function n(v: number): string { return v.toLocaleString('en-US') }

/** Agent summary (builtin-plugins.md「Agent 摘要」): 面数、材质数、贴图清单与尺寸、骨骼数、动画片段名. */
export function summaryText(info: ModelInfo, name: string): string {
  const lines: string[] = []
  if (info.kind === 'fbx') {
    const f = info.fbx
    lines.push(`${name}：3D 模型（${KIND_LABEL.fbx}）· ${n(f.triangles)} 面 · ${n(f.vertices)} 顶点 · ${f.meshes} 个网格`)
    lines.push(`材质 ${f.materials} 个${f.materialNames.length ? '：' + f.materialNames.join('、') : ''}`)
    lines.push(f.textureList.length
      ? `贴图 ${f.textureList.length} 张：` + f.textureList.map(t => t.slot + (t.width ? ` ${t.width}×${t.height}` : '') + (t.embedded ? '（打包在文件内）' : '')).join('、')
      : '贴图 0 张')
    lines.push(`骨骼 ${f.bones} 根；动画 ${f.animations} 段${f.clipNames.length ? '：' + f.clipNames.join('、') : ''}`)
    if (!f.complete) lines.push('（文件过大或部分数据读不出来，以上计数不完整）')
    return lines.join('\n')
  }
  const g = info.gltf
  lines.push(`${name}：3D 模型（${KIND_LABEL[info.kind]}）· ${n(g.triangles)} 面 · ${n(g.vertices)} 顶点 · ${g.meshes} 个网格`)
  lines.push(`材质 ${g.materials} 个${g.materialNames.length ? '：' + g.materialNames.join('、') : ''}`)
  lines.push(g.images.length
    ? `贴图 ${g.images.length} 张：` + g.images.map(im => {
      const label = im.slot ?? `图像 ${im.index + 1}`
      const size = im.width ? ` ${im.width}×${im.height}` : ''
      const use = im.use ? `（${im.use}）` : ''
      return label + size + use
    }).join('、')
    : '贴图 0 张')
  lines.push(`骨骼 ${g.bones} 根；动画 ${g.animations} 段${g.clipNames.length ? '：' + g.clipNames.join('、') : ''}`)
  if (info.size) lines.push(`包围盒 ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} × ${info.size.z.toFixed(2)} m`)
  return lines.join('\n')
}
