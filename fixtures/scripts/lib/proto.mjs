// Loads the prototype's sample library (design/prototype/bb/bundle.js + data.js) in a Node `vm` sandbox, so the
// fixture generator reads the asset table, relations, records and drawings from the one authoritative source.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(here, '../../..')
const PROTO = path.join(REPO, 'design/prototype')

let cached = null

/** { B: window.Bowerbird, D: window.BBData, trash: [...] } — the trash seeds replay pages.js `App.seedTrash`. */
export function loadPrototype() {
  if (cached) return cached
  const doc = { readyState: 'loading', addEventListener() {}, body: null, getElementById: () => null }
  const sandbox = { console, document: doc, navigator: {}, performance: { now: () => 0 } }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  for (const f of ['bb/bundle.js', 'data.js']) {
    vm.runInContext(fs.readFileSync(path.join(PROTO, f), 'utf8'), sandbox, { filename: f })
  }
  const B = sandbox.Bowerbird
  const D = sandbox.BBData
  // pages.js App.seedTrash, called once right after data.js: same mk() order, so the same GUIDs
  const DAY = 86400000
  const NOW = D.NOW
  function t(name, folder, kind, o, days, by) {
    const a = D.mk(name, folder, kind, Object.assign({ stage: 'runtime', review: 'approved' }, o))
    a.trashedAt = NOW - days * DAY
    a.trashedBy = by
    return a
  }
  const trash = [
    t('potion_basecolor.png', 'props/potion', 'image', { art: 'basecolor', info: '1024×1024', w: 1024, h: 1024, tags: ['药水', '贴图'], bytes: 580e3 }, 3, 'user:mo'),
    t('btn_close.png', 'ui/shop', 'image', { art: 'ui', shape: 'close', c: ['#ff8f7a', '#e0503c'], alpha: true, info: '256×256', w: 256, h: 256, tags: ['商店', '切图'], bytes: 36e3 }, 2, 'agent:slicer'),
    t('moodboard_old.jpg', 'references/illustration', 'image', { art: 'render', hue: 320, stage: 'reference', review: 'exempt', info: '2400×1600', w: 2400, h: 1600, tags: ['参考'], bytes: 3.1e6 }, 5, 'user:lin'),
    t('chest_v0.glb', 'props/chest', 'model', { art: 'model', info: '1,904 面', tris: 1904, tags: ['宝箱'], bytes: 900e3 }, 6, 'agent:modeler')
  ]
  cached = { B, D, trash, NOW }
  return cached
}

/**
 * The prototype drawing for an asset as a standalone SVG document of `w`×`h` pixels.
 * `demo.art` returns `<svg class="bb-art" viewBox=… preserveAspectRatio=…>…</svg>`; we add the namespace and size.
 */
export function artSvg(kind, asset, w, h, opts = {}) {
  const { B } = loadPrototype()
  let svg = B.demo.art(kind, asset)
  svg = svg.replace(/^<svg class="bb-art"/, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`)
  svg = svg.replace(/ role="img" aria-label="[^"]*"/, '')
  // ink-coloured strokes (waveforms) take currentColor in the shell; give them a colour here
  svg = svg.replace(/class="bb-art__ink"/g, 'fill="#3a3d44"')
  if (opts.recolor) for (const [from, to] of opts.recolor) svg = svg.split(from).join(to)
  if (opts.transform) svg = svg.replace(/(<svg[^>]*>)/, `$1<g transform="${opts.transform}">`).replace(/<\/svg>$/, '</g></svg>')
  return svg
}
