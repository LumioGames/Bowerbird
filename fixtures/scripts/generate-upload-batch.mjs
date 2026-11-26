#!/usr/bin/env node
// Generates fixtures/upload-batch/ — the batch a reviewer drops in (prototype data.js `batch`), for the end-to-end
// upload and same-name flows: two `icon_lantern.png` (export/ui, export/hud), `export/v2/lantern_basecolor.png`
// next to the root one, and `lantern_concept.png`, which already exists in「星落镇」(props/lantern/).
//
//   node scripts/generate-upload-batch.mjs [--out <dir>]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPrototype, artSvg } from './lib/proto.mjs'
import { svgToPng } from './lib/images.mjs'
import * as M from './lib/models.mjs'
import * as A from './lib/media.mjs'
import * as C from './lib/content.mjs'
import { writeFile, rmrf, ensureDir, walk } from './lib/util.mjs'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const argOut = process.argv.indexOf('--out')
const OUT = path.resolve(argOut > 0 ? process.argv[argOut + 1] : path.join(here, '../upload-batch'))

const LANTERN_BASE = [['#33241a', '#2b2418'], ['#a9682f', '#c9a24a'], ['#7d4a1f', '#8a6a2a'], ['#e3b648', '#f2e6c8'], ['#b88a26', '#d8c89a']]
const LANTERN_TINT = { liquid: '#ffcf5a', glass: '#f2e6c8', wood: '#7a4a1f' }

const { D } = loadPrototype()

async function make(b) {
  const rel = (b.from ? b.from + '/' : '') + b.name
  switch (rel) {
    case 'lantern_concept.png': return svgToPng(artSvg('env', b, b.w, b.h))
    case 'lantern.glb':
      return M.writeGlb(M.buildBottle({ target: b.tris, name: 'lantern', tint: LANTERN_TINT }), { textures: { liquid: { baseColor: 'lantern_basecolor.png' }, glass: { normal: 'lantern_normal.png' } } })
    case 'lantern_basecolor.png': return svgToPng(artSvg('basecolor', b, b.w, b.h, { recolor: LANTERN_BASE }))
    case 'lantern_normal.png': return svgToPng(artSvg('normal', b, b.w, b.h, { transform: 'translate(160 0) scale(-1 1)' }))
    case 'export/ui/icon_lantern.png':
    case 'export/hud/icon_lantern.png': return svgToPng(artSvg('ui', b, b.w, b.h), { alpha: true })
    case 'export/v2/lantern_basecolor.png': return svgToPng(artSvg('orm', b, b.w, b.h))
    case 'lantern_light.wav': return A.lanternLight()
    case 'lantern.md': return Buffer.from(C.LANTERN_MD)
  }
  throw new Error('no generator for upload-batch/' + rel)
}

rmrf(OUT)
ensureDir(OUT)
for (const b of D.batch) writeFile(path.join(OUT, (b.from ? b.from + '/' : '') + b.name), await make(b))
let n = 0, bytes = 0
for (const rel of walk(OUT)) { n++; bytes += fs.statSync(path.join(OUT, rel)).size }
console.log(`upload-batch: ${n} files, ${(bytes / 1024).toFixed(0)} KB`)
