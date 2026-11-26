#!/usr/bin/env node
/**
 * Writes THIRD_PARTY_NOTICES.md from what the build actually bundles: the web shell's source map, the plugin-sdk web
 * bundle's module comments and each built-in plugin's web source map, plus the CSS framework and the component code
 * adapted into plugin-sdk. Run after `pnpm build`:
 *
 *   node scripts/third-party-notices.mjs           write THIRD_PARTY_NOTICES.md
 *   node scripts/third-party-notices.mjs --check   exit 1 if the file is out of date
 *
 * The output is generated: do not edit it by hand.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const NOTICES_FILE = path.join(REPO, 'THIRD_PARTY_NOTICES.md')

const PLUGIN_NAMES = { image: '图片', video: '视频', audio: '音频', model: '3D 模型', doc: '文档' }

/** The bundles that ship, where they ship, and how to list their modules. */
function bundles() {
  const out = []
  const webAssets = path.join(REPO, 'packages/web/dist/assets')
  const maps = fs.existsSync(webAssets) ? fs.readdirSync(webAssets).filter(f => f.endsWith('.js.map')).map(f => path.join(webAssets, f)) : []
  out.push({ where: '网页外壳（`bowerbird` 包 `web/`）', files: maps, kind: 'map', required: 'packages/web/dist/assets/*.js.map' })
  out.push({ where: '插件开发包的网页模块（`@bowerbird/plugin-sdk` 包 `dist/web.js`）', files: [path.join(REPO, 'packages/plugin-sdk/dist/web.js')], kind: 'comments', required: 'packages/plugin-sdk/dist/web.js' })
  for (const [dir, name] of Object.entries(PLUGIN_NAMES)) {
    out.push({ where: `${name}插件的网页模块（\`bowerbird\` 包 \`plugins/${dir}/dist/web.js\`）`, files: [path.join(REPO, `plugins/${dir}/dist/web.js.map`)], kind: 'map', required: `plugins/${dir}/dist/web.js.map` })
  }
  return out
}

const PNPM_RE = /node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//

/** Package folders (absolute) a bundle was built from. */
function packageDirs(bundle) {
  const dirs = new Set()
  for (const f of bundle.files) {
    if (!fs.existsSync(f)) throw new Error(`${path.relative(REPO, f)} is missing — run pnpm build first`)
    const paths = bundle.kind === 'map'
      ? JSON.parse(fs.readFileSync(f, 'utf8')).sources
      : [...fs.readFileSync(f, 'utf8').matchAll(/^\/\/ (\S*node_modules\/\.pnpm\/\S+)$/gm)].map(m => m[1])
    for (const s of paths) {
      const m = PNPM_RE.exec(s)
      if (!m) continue
      // The store folder names the package (`@scope+name@1.2.3_peers`); a path inside it may not (a package's own
      // source maps can point at folders such as `shared/`).
      const at = m[1].indexOf('@', m[1].startsWith('@') ? 1 : 0)
      const name = m[1].slice(0, at).replace('+', '/')
      dirs.add(path.join(REPO, 'node_modules/.pnpm', m[1], 'node_modules', name))
    }
  }
  if (bundle.files.length === 0) throw new Error(`${bundle.required} is missing — run pnpm build first`)
  return dirs
}

const LICENSE_NAMES = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i

/** A notice line such as `Copyright (c) 2021 Name` — not a sentence of the license body that mentions copyright. */
function isCopyrightLine(l) {
  if (/^copyright\s+(notice|license|holders?|owners?|and|statement)\b/i.test(l)) return false
  return /^copyright\b/i.test(l) || /^(\(c\)|©)\s*\d{4}/i.test(l)
}

function readPackage(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const file = fs.readdirSync(dir).find(f => LICENSE_NAMES.test(f))
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : null
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? '未声明')
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  const copyright = text
    ? [...new Set(text.split('\n').map(l => l.trim()).filter(isCopyrightLine))].slice(0, 3)
    : []
  return { name: pkg.name, version: pkg.version, license, text, author, copyright }
}

/** Packages the CSS framework puts into every stylesheet (Tailwind's base layer, the shell's animation utilities). */
function cssPackages() {
  // the shell's own node_modules links (some packages do not export ./package.json)
  return ['tailwindcss', 'tw-animate-css'].map(n => fs.realpathSync(path.join(REPO, 'packages/web/node_modules', n)))
}

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/** Component code copied into plugin-sdk and changed there (no npm package to read). */
const ADAPTED = [
  {
    name: '[shadcn/ui](https://github.com/shadcn-ui/ui)',
    where: '`packages/plugin-sdk/src/web/ui/`，改写后打包进网页外壳与插件开发包的网页模块',
    license: 'MIT', copyright: ['Copyright (c) 2023 shadcn'],
    text: `MIT License\n\nCopyright (c) 2023 shadcn\n\n${MIT_BODY}`
  },
  {
    name: '[Magic UI](https://github.com/magicuidesign/magicui)',
    where: '`packages/plugin-sdk/src/web/magic/`，改写后打包进网页外壳与插件开发包的网页模块',
    license: 'MIT', copyright: ['Copyright (c) Magic UI'],
    text: `MIT License\n\nCopyright (c) Magic UI\n\n${MIT_BODY}`
  }
]

const cell = s => s.replace(/\|/g, '\\|')

export function render() {
  /** dir → { info, where: Set } */
  const found = new Map()
  const note = (dir, where) => {
    if (!found.has(dir)) found.set(dir, { info: readPackage(dir), where: new Set() })
    found.get(dir).where.add(where)
  }
  const order = []
  for (const b of bundles()) { order.push(b.where); for (const d of packageDirs(b)) note(d, b.where) }
  const CSS = '网页外壳与各插件网页模块的样式'
  order.push(CSS)
  for (const d of cssPackages()) note(d, CSS)
  const byOrder = ws => [...ws].sort((a, b) => order.indexOf(a) - order.indexOf(b))

  // One row per group of packages that share a license text and ship in the same places.
  const rows = new Map()
  for (const { info, where } of [...found.values()].sort((a, b) => a.info.name.localeCompare(b.info.name))) {
    const key = `${info.text ?? info.license}\u0000${byOrder(where).join('\u0000')}`
    if (!rows.has(key)) rows.set(key, { infos: [], where: byOrder(where) })
    rows.get(key).infos.push(info)
  }

  const lines = []
  lines.push('<!-- 由 scripts/third-party-notices.mjs 按构建结果生成，不要手改；改了依赖或打包内容后运行 pnpm notices -->')
  lines.push('')
  lines.push('# 第三方组件通知')
  lines.push('')
  lines.push('Bowerbird 的许可（[LICENSE](LICENSE)：PolyForm Shield 1.0.0 加 LumioGames 的附加许可和商标说明；插件开发包、插件构建工具与共用数据结构按 MIT）只覆盖 LumioGames 的原创代码、脚本和文档，不重新许可第三方源码、图标、字体或图片。本文按发布包里实际打包的东西逐项列出；许可原文附在文末。')
  lines.push('')
  lines.push('## 打包在发布包里的')
  lines.push('')
  lines.push('| 组件 | 位置 | 版本 | 许可与署名 |')
  lines.push('| --- | --- | --- | --- |')
  for (const { infos, where } of rows.values()) {
    const names = infos.map(i => `[${i.name}](https://www.npmjs.com/package/${i.name})${infos.length > 1 ? ` ${i.version}` : ''}`).join('、')
    const versions = infos.length > 1 ? '见左' : infos[0].version
    const head = infos[0]
    const credit = head.copyright.length ? head.copyright.join('；') : (head.author ? `作者 ${head.author}` : '')
    const missing = head.text ? '' : '；包里没有附许可文件，以 package.json 的声明为准'
    lines.push(`| ${cell(names)} | ${cell(where.join('；'))} | ${cell(versions)} | ${cell([head.license, credit].filter(Boolean).join('，'))}${missing} |`)
  }
  lines.push('')
  lines.push('## 改写进源码的')
  lines.push('')
  lines.push('| 组件 | 位置 | 许可与署名 |')
  lines.push('| --- | --- | --- |')
  for (const a of ADAPTED) lines.push(`| ${a.name} | ${a.where} | ${a.license}，${a.copyright.join('；')} |`)
  lines.push('')
  lines.push('## 随 npm 一起安装、不在发布包里的')
  lines.push('')
  lines.push('服务端的运行依赖（Fastify、better-sqlite3、sharp、音频解码器等）由 npm 在安装 `bowerbird` 时单独下载，各自带着自己的许可文件，Bowerbird 不重新分发它们。其中两类不是宽松许可，要留意：')
  lines.push('')
  lines.push('- sharp 的预编译图像库 `@img/sharp-libvips-*`：LGPL-3.0-or-later。')
  lines.push('- 音频插件的解码器依赖 `codec-parser`：LGPL-3.0-or-later。')
  lines.push('')
  lines.push('## 许可原文')
  lines.push('')
  const texts = new Map()
  for (const { info } of [...found.values()].sort((a, b) => a.info.name.localeCompare(b.info.name))) {
    if (!info.text) continue
    if (!texts.has(info.text)) texts.set(info.text, [])
    texts.get(info.text).push(`${info.name} ${info.version}`)
  }
  for (const a of ADAPTED) texts.set(a.text, [a.name.replace(/^\[([^\]]+)\].*$/, '$1')])
  for (const [text, names] of texts) {
    lines.push(`### ${names.join('、')}`)
    lines.push('')
    lines.push('```text')
    lines.push(text.replace(/```/g, "'''"))
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = render()
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(NOTICES_FILE) ? fs.readFileSync(NOTICES_FILE, 'utf8') : ''
    if (now !== text) {
      console.error('THIRD_PARTY_NOTICES.md is out of date — run pnpm notices')
      process.exit(1)
    }
    console.log('THIRD_PARTY_NOTICES.md is up to date')
  } else {
    fs.writeFileSync(NOTICES_FILE, text)
    console.log(`wrote ${path.relative(REPO, NOTICES_FILE)}`)
  }
}
