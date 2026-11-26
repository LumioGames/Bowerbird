// Text documents (copied from the prototype's document viewer, design/prototype/viewers.js DOCS) and stand-ins for
// formats nobody claims in phase one (.blend, .skel). All original content.
import { rng } from './util.mjs'

/** chest.md — the design object「宝箱」. Front matter carries the target size (宽 × 高 × 深, ADR-020). */
export function chestMd({ conceptId, turnaroundId }) {
  return `---
size: 1.26 × 0.95 × 0.87 m
---
# 宝箱

新手村第一个可以打开的容器。玩家在这里学会「靠近、交互、获得」。

## 美术风格

卡通、低多边形。木质箱体加黄铜包边，开箱时有一束暖光。

bb://${conceptId}

bb://${turnaroundId}

## 规格

| 项目 | 要求 |
|---|---|
| 三角面 | 不超过 5,000 |
| 贴图 | 3 张 1024：basecolor、normal、orm |
| 动画 | open，0.8 秒 |

## 导出

\`\`\`
blender chest_high.blend --export glb --out chest.glb
\`\`\`
`
}

/** The first draft of chest.md (version 1) — only its size is used, for the version record. */
export function chestMdV1({ conceptId }) {
  return `# 宝箱\n\n新手村第一个可以打开的容器。\n\n## 美术风格\n\n卡通、低多边形，木质箱体。\n\nbb://${conceptId}\n\n## 规格\n\n| 项目 | 要求 |\n|---|---|\n| 三角面 | 不超过 3,000 |\n| 贴图 | 2 张 1024：basecolor、normal |\n`
}

export const ART_STYLE_GUIDE = '# 美术风格规范\n\n色彩明快、轮廓清晰，远看能认出是什么。\n\n## 模型\n\n| 类别 | 面数上限 |\n|---|---|\n| 道具 | 5,000 |\n| 角色 | 12,000 |\n\n## 贴图\n\n边长为 2 的幂，运行时不超过 2048。\n'

export const NAMING_RULES = '# 命名规则\n\n全部小写，下划线分隔。\n\n```\n对象_用途_变体.后缀\nchest_basecolor.png\n```\n\n贴图后缀用 basecolor / normal / orm。\n'

export const CHANGELOG = '2026-11-24  user:lin    chest.glb  修正包边比例\n2026-11-21  agent:modeler  chest.glb  初版\n2026-11-20  agent:slicer   ui/shop    从 shop_mockup.png 切出 12 张\n2026-11-18  agent:concept-artist  chest_concept.png  AI 生成\n'

export const EXPORT_PRESETS = JSON.stringify({ version: 2, target: 'glb', scale: 1, textures: { maxSize: 1024, format: 'png', channels: ['basecolor', 'normal', 'orm'] }, animation: { bake: true, fps: 30 }, naming: '{object}_{usage}' }, null, 2) + '\n'

export const LANTERN_MD = '# 提灯\n\n夜间探索用的手持光源。黄铜骨架、磨砂玻璃，点亮时有暖色光晕。\n'

const ITEMS = [['#ffc24a', '金币袋', 120], ['#6fd3ff', '蓝宝石', 300], ['#ff8fb3', '药水', 80], ['#9be28a', '草药', 40], ['#c9a0ff', '卷轴', 160], ['#ffd65a', '钥匙', 90], ['#ff9f6b', '面包', 20], ['#8fd0c8', '地图', 60]]

const SHOP_CSS = `.shop { display: flex; flex-direction: column; min-height: 100vh; margin: 0; background: #2b2140; color: #f4eefc; font-family: system-ui, sans-serif; }
.shop header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: #6a56a0; font-size: 16px; }
.shop header span { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: #2b2140; color: #ffc24a; font-size: 13px; font-variant-numeric: tabular-nums; }
.shop__grid { flex: 1; display: grid; grid-template-columns: repeat(4, minmax(76px, 1fr)); align-content: start; gap: 12px; padding: 18px; }
.shop__it { appearance: none; border: 0; display: grid; justify-items: center; gap: 8px; padding: 12px 8px 8px; border-radius: 10px; background: #4a3a6e; color: #f4eefc; font: inherit; font-size: 12px; }
.shop__it[aria-pressed="true"] { box-shadow: inset 0 0 0 2px #ffc24a; }
.shop__it i { width: 36px; height: 36px; border-radius: 50%; }
.shop footer { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: #3b2f5a; font-size: 14px; }
.shop__buy { appearance: none; border: 0; padding: 8px 22px; border-radius: 999px; background: #ffb347; color: #2b2140; font: inherit; font-weight: 700; }
`

/** ui/shop/shop_prototype.html — the interactive shop prototype, one self-contained page. */
export function shopPrototypeHtml() {
  const items = ITEMS.map((it, i) => `      <button class="shop__it" aria-pressed="${i === 0}" data-price="${it[2]}" data-name="${it[1]}"><i style="background:${it[0]}"></i><span>${it[2]}</span></button>`).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>商店界面原型</title>
<style>
body { margin: 0; }
${SHOP_CSS}</style>
</head>
<body>
  <main class="shop">
    <header><b>杂货铺</b><span id="coins">1,240</span></header>
    <!-- 4 × 2 货架 -->
    <section class="shop__grid">
${items}
    </section>
    <footer><span id="pick">金币袋</span><button class="shop__buy" id="buy">购买</button></footer>
  </main>
<script>
let coins = 1240
const grid = document.querySelector('.shop__grid')
grid.addEventListener('click', e => {
  const b = e.target.closest('.shop__it'); if (!b) return
  grid.querySelectorAll('.shop__it').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
  document.getElementById('pick').textContent = b.dataset.name
})
document.getElementById('buy').addEventListener('click', () => {
  const b = grid.querySelector('[aria-pressed="true"]'); const p = Number(b.dataset.price)
  if (coins < p) return
  coins -= p; document.getElementById('coins').textContent = coins.toLocaleString('en-US')
})
</script>
</body>
</html>
`
}

/** ui/shop_v2/ — loose files of a web prototype (to be turned into one bundle asset from the folder menu). */
export function shopV2() {
  const items = ITEMS.map((it, i) => `      <button class="shop__it" aria-pressed="${i === 0}" data-price="${it[2]}" data-name="${it[1]}"><img src="slot.png" alt=""><span>${it[1]} · <img class="coin" src="coin.png" alt="">${it[2]}</span></button>`).join('\n')
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>商店界面原型 v2</title>
<link rel="stylesheet" href="shop.css">
</head>
<body>
  <main class="shop">
    <header><b>杂货铺</b><span><img class="coin" src="coin.png" alt=""><b id="coins">1,240</b></span></header>
    <!-- 货架改成 4×2，加了购买确认 -->
    <section class="shop__grid">
${items}
    </section>
    <footer><span id="pick">金币袋</span><button class="shop__buy" id="buy">购买</button></footer>
    <dialog id="confirm"><p>确定购买 <b id="what"></b>？</p><form method="dialog"><button value="no">取消</button><button value="yes" class="shop__buy">购买</button></form></dialog>
  </main>
  <script src="shop.js"></script>
</body>
</html>
`
  const css = SHOP_CSS + `.shop__it img { width: 48px; height: 48px; }
.coin { width: 14px; height: 14px; vertical-align: -2px; margin-right: 2px; }
dialog { border: 0; border-radius: 12px; background: #3b2f5a; color: #f4eefc; }
dialog form { display: flex; gap: 8px; justify-content: flex-end; }
`
  const js = `// 商店界面原型 v2：选中货架上的物品，购买前先确认。
let coins = 1240
const grid = document.querySelector('.shop__grid')
const confirmBox = document.getElementById('confirm')
grid.addEventListener('click', e => {
  const b = e.target.closest('.shop__it'); if (!b) return
  grid.querySelectorAll('.shop__it').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
  document.getElementById('pick').textContent = b.dataset.name
})
document.getElementById('buy').addEventListener('click', () => {
  const b = grid.querySelector('[aria-pressed="true"]')
  document.getElementById('what').textContent = b.dataset.name
  confirmBox.showModal()
})
confirmBox.addEventListener('close', () => {
  if (confirmBox.returnValue !== 'yes') return
  const p = Number(grid.querySelector('[aria-pressed="true"]').dataset.price)
  if (coins < p) return
  coins -= p
  document.getElementById('coins').textContent = coins.toLocaleString('en-US')
})
`
  return { html, css, js }
}

/** chest_high.blend — a Blender-looking file: the real 12-byte header and block codes, deterministic filler. */
export function fakeBlend(size = 196608) {
  const r = rng(42)
  const parts = [Buffer.from('BLENDER-v402', 'latin1')]
  let total = 12
  const block = (code, len) => {
    const h = Buffer.alloc(24)
    h.write(code.padEnd(4, '\0'), 0, 'latin1'); h.writeInt32LE(len, 4); h.writeBigUInt64LE(BigInt(0x7f0000000000 + total), 8); h.writeInt32LE(0, 16); h.writeInt32LE(1, 20)
    const body = Buffer.alloc(len)
    for (let i = 0; i < len; i++) body[i] = Math.floor(r() * 256) & (i % 7 === 0 ? 0x0f : 0xff)
    parts.push(h, body); total += 24 + len
  }
  block('REND', 72); block('TEST', 4096); block('GLOB', 1104)
  while (total < size - 4096) block('DATA', 8192)
  block('DNA1', 2048)
  parts.push(Buffer.from('ENDB\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0', 'latin1'))
  return Buffer.concat(parts)
}

/** hero_run.skel — a Spine-like binary skeleton header followed by filler (no plugin reads it in phase one). */
export function fakeSkel(size = 40960) {
  const r = rng(99)
  const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([b.length + 1]), b]) }
  const f = v => { const b = Buffer.alloc(4); b.writeFloatBE(v); return b }
  const head = Buffer.concat([str('bbFixtureHeroRun01'), str('4.2.18'), f(-48), f(-4), f(96), f(170), Buffer.from([1]), f(30), str('./images/'), str('')])
  const body = Buffer.alloc(size - head.length)
  for (let i = 0; i < body.length; i++) body[i] = Math.floor(r() * 256)
  return Buffer.concat([head, body])
}

/** rough slice rectangles of each cut-out on shop_mockup.png (1920×1080), for the slice record's `rect` (ADR-036). */
export const SLICE_RECTS = {
  'btn_buy.png': [1504, 704, 208, 96], 'btn_close.png': [1664, 128, 96, 96], 'panel_bg.png': [112, 96, 1696, 888],
  'icon_coin.png': [232, 368, 112, 112], 'icon_gem.png': [544, 368, 112, 112], 'tab_active.png': [112, 96, 416, 160],
  'tab_idle.png': [528, 96, 416, 160], 'btn_sell.png': [1504, 576, 208, 96], 'frame_item.png': [192, 320, 256, 240],
  'badge_new.png': [400, 320, 64, 64], 'slot_empty.png': [1440, 352, 272, 496], 'divider.png': [192, 872, 1248, 32]
}
