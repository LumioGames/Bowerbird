/**
 * DEVELOPMENT ONLY. The sample library「星落镇」from the prototype (design/prototype/data.js), as the shapes the API
 * returns. Loaded only through `installFixtures` behind `import.meta.env.DEV` and an explicit switch.
 */
import type { AssetDetail, ReviewStatus, Stage, ViewGrid } from '@bowerbird/schema'

export const NOW = Date.UTC(2026, 10, 25, 4)
const DAY = 86_400_000

export interface Seed {
  name: string; folder: string; kind: 'image' | 'video' | 'audio' | 'model' | 'doc' | 'unknown'
  stage?: Stage; review?: ReviewStatus; tags?: string[]; ai?: string[]; by?: string; bytes?: number; badge?: string
  w?: number; h?: number; tris?: number; dur?: number; hue?: number; issue?: 'stale' | 'broken' | 'missing' | 'failed' | 'identity' | 'plugin'
  state?: 'waiting' | 'missing' | 'failed' | 'processing'; title?: string; excerpt?: string; desc?: string; aiDesc?: string; grid?: ViewGrid
  alpha?: boolean; needs?: string; ar?: number; modifiedAgo?: number; prompt?: string; method?: string
}

const C = 'props/chest', SH = 'ui/shop', R3 = 'references/3d-render', V2 = 'ui/shop_v2'

export const SEEDS: Seed[] = [
  { name: 'chest.md', folder: C, kind: 'doc', stage: 'production', review: 'exempt', title: '宝箱', excerpt: '新手村第一个可以打开的容器。卡通、低多边形，木质箱体加黄铜包边，开箱时有一束暖光。', tags: ['宝箱', '设计对象'], bytes: 2100, by: 'user:lin' },
  { name: 'chest_concept.png', folder: C, kind: 'image', stage: 'production', badge: '1536×1536', w: 1536, h: 1536, tags: ['宝箱', '原画'], ai: ['木质', '黄铜', '卡通'], by: 'agent:concept-artist', bytes: 2.1e6, hue: 140, prompt: '卡通风格的木质宝箱，四分之三视角，黄铜包边，正面锁扣，暖色调', method: 'ai-generate', aiDesc: '卡通风格的木质宝箱原画，四分之三视角，黄铜包边。' },
  { name: 'chest_turnaround.png', folder: C, kind: 'image', stage: 'production', badge: '2048×2048', w: 2048, h: 2048, tags: ['宝箱', '四视图'], by: 'agent:concept-artist', bytes: 1.6e6, hue: 40, grid: { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] } },
  { name: 'chest_high.blend', folder: C, kind: 'unknown', stage: 'production', review: 'exempt', tags: ['宝箱'], by: 'agent:modeler', bytes: 18.6e6 },
  { name: 'chest.glb', folder: C, kind: 'model', review: 'pending', badge: '2,480 面', tris: 2480, tags: ['宝箱', '道具'], ai: ['低多边形'], by: 'user:lin', bytes: 1.2e6, modifiedAgo: 0.5, hue: 30, desc: '新手村第一个能打开的宝箱，运行时用。开箱动画在 chest_open_preview.mp4。', aiDesc: '木质宝箱模型，黄铜包边，正面有锁扣，箱盖为半圆柱形。' },
  { name: 'chest_basecolor.png', folder: C, kind: 'image', badge: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], bytes: 612e3, hue: 28 },
  { name: 'chest_basecolor_dark.png', folder: C, kind: 'image', badge: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], by: 'user:lin', bytes: 598e3, hue: 20 },
  { name: 'chest_normal.png', folder: C, kind: 'image', badge: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], bytes: 840e3, hue: 240 },
  { name: 'chest_orm.png', folder: C, kind: 'image', badge: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], bytes: 388e3, hue: 50 },
  { name: 'chest_icon.png', folder: C, kind: 'image', alpha: true, issue: 'stale', badge: '256×256', w: 256, h: 256, tags: ['宝箱', 'Icon'], by: 'agent:modeler', bytes: 48e3, hue: 36 },
  { name: 'chest_open.wav', folder: C, kind: 'audio', badge: '0.8 秒', dur: 0.8, tags: ['宝箱', '音效'], bytes: 141e3 },
  { name: 'chest_open_preview.mp4', folder: C, kind: 'video', stage: 'production', review: 'exempt', badge: '0:03', dur: 3, tags: ['宝箱'], bytes: 3.4e6, hue: 220 },
  { name: 'potion.glb', folder: 'props/potion', kind: 'model', issue: 'broken', badge: '1,120 面', tris: 1120, tags: ['药水', '道具'], bytes: 640e3, hue: 320 },
  { name: 'potion_concept.png', folder: 'props/potion', kind: 'image', stage: 'production', badge: '1536×1536', w: 1536, h: 1536, tags: ['药水', '原画'], by: 'agent:concept-artist', hue: 320 },
  { name: 'potion_normal.png', folder: 'props/potion', kind: 'image', badge: '1024×1024', w: 1024, h: 1024, tags: ['药水', '贴图'], hue: 240 },
  { name: 'sword_iron.glb', folder: 'props/weapon', kind: 'model', badge: '3,860 面', tris: 3860, tags: ['武器', '道具'], review: 'approved', hue: 210 },
  { name: 'lantern_concept.png', folder: 'props/lantern', kind: 'image', stage: 'production', review: 'pending', badge: '1536×1536', w: 1536, h: 1536, tags: ['提灯', '原画'], ai: ['黄铜', '磨砂玻璃', '暖光', '卡通'], by: 'agent:concept-artist', bytes: 1.9e6, hue: 44, prompt: '一盏卡通风格的手提灯，黄铜骨架，磨砂玻璃，暖色光晕', method: 'ai-generate', modifiedAgo: 0.1 },
  { name: 'shop_prototype.html', folder: SH, kind: 'doc', stage: 'production', title: '商店界面原型', excerpt: '可交互原型：货架 4×2，右侧详情与购买按钮，顶部货币栏。', tags: ['商店', '原型稿'], by: 'user:mo', bytes: 38e3 },
  { name: 'shop_mockup.png', folder: SH, kind: 'image', ar: 16 / 9, stage: 'production', badge: '1920×1080', w: 1920, h: 1080, tags: ['商店', '效果图'], by: 'user:mo', hue: 270 },
  ...[['btn_buy.png', 35, 'approved'], ['btn_close.png', 8, 'approved'], ['panel_bg.png', 260, 'approved'], ['icon_coin.png', 45, 'approved'], ['icon_gem.png', 195, 'pending'], ['tab_idle.png', 255, 'pending'], ['btn_sell.png', 110, 'approved'], ['frame_item.png', 42, 'approved'], ['badge_new.png', 335, 'pending'], ['slot_empty.png', 260, 'approved']].map(([n, hue, r]) => ({ name: n as string, folder: SH, kind: 'image' as const, alpha: true, review: r as ReviewStatus, badge: '256×256', w: 256, h: 256, tags: ['商店', '切图'], by: 'agent:slicer', hue: hue as number, method: 'slice' })),
  { name: 'btn_buy (1).png', folder: SH, kind: 'image', alpha: true, issue: 'identity', review: 'pending', badge: '256×256', w: 256, h: 256, tags: ['商店', '切图'], by: 'system:scanner', hue: 35 },
  { name: 'icon_coin.png', folder: 'ui/icons', kind: 'image', alpha: true, badge: '256×256', w: 256, h: 256, tags: ['Icon'], hue: 45 },
  { name: 'hud_health.png', folder: 'ui/hud', kind: 'image', alpha: true, badge: '512×64', w: 512, h: 64, ar: 8, tags: [], hue: 5 },
  { name: 'hero_concept.png', folder: 'characters/hero', kind: 'image', stage: 'production', badge: '2048×2048', w: 2048, h: 2048, tags: ['主角', '原画'], by: 'agent:concept-artist', hue: 15 },
  { name: 'hero.glb', folder: 'characters/hero', kind: 'model', badge: '8,912 面', tris: 8912, tags: ['主角'], review: 'rejected', by: 'agent:modeler', bytes: 6.8e6, hue: 210 },
  { name: 'hero_walk.fbx', folder: 'characters/hero', kind: 'model', stage: 'production', review: 'pending', badge: '8,912 面', tris: 8912, tags: ['主角', '动画'], by: 'agent:modeler', bytes: 7.4e6, hue: 210 },
  { name: 'hero_idle.fbx', folder: 'characters/hero', kind: 'model', state: 'missing', stage: 'production', review: 'pending', issue: 'missing', badge: '8,912 面', tris: 8912, tags: ['主角'], hue: 210 },
  { name: 'hero_run.skel', folder: 'characters/hero', kind: 'unknown', stage: 'runtime', review: 'pending', issue: 'plugin', needs: 'Spine', tags: ['主角', '动画'], by: 'user:lin', bytes: 410e3 },
  { name: 'npc_guard.glb', folder: 'characters/npc', kind: 'model', state: 'waiting', review: 'pending', tags: [], by: 'agent:modeler', modifiedAgo: 0.01 },
  { name: 'npc_merchant.glb', folder: 'characters/npc', kind: 'model', state: 'waiting', review: 'pending', tags: [], by: 'agent:modeler', modifiedAgo: 0.008 },
  { name: 'npc_merchant_concept.png', folder: 'characters/npc', kind: 'image', stage: 'production', badge: '2048×2048', w: 2048, h: 2048, tags: ['NPC', '原画'], review: 'pending', ai: ['商人'], by: 'agent:concept-artist', hue: 25 },
  { name: 'intro_cutscene.mov', folder: 'environments', kind: 'video', state: 'failed', stage: 'production', review: 'exempt', issue: 'failed', tags: [], bytes: 86e6 },
  { name: 'env_village.png', folder: 'environments', kind: 'image', ar: 16 / 9, stage: 'production', badge: '3840×2160', w: 3840, h: 2160, tags: ['场景', '原画'], hue: 140 },
  { name: 'env_forest.png', folder: 'environments', kind: 'image', ar: 16 / 9, stage: 'production', badge: '3840×2160', w: 3840, h: 2160, tags: ['场景'], review: 'approved', hue: 100 },
  { name: 'rock_01.obj', folder: 'environments', kind: 'unknown', stage: 'production', review: 'pending', tags: ['岩石'], by: 'user:mo', bytes: 2.2e6 },
  { name: 'sky_noon.hdr', folder: 'environments', kind: 'image', ar: 2, stage: 'reference', review: 'exempt', badge: '4096×2048', w: 4096, h: 2048, tags: ['HDRI'], bytes: 24e6, hue: 200 },
  { name: 'world_map_16k.png', folder: 'environments', kind: 'image', ar: 16 / 9, stage: 'production', review: 'pending', badge: '16384×9216', w: 16384, h: 9216, tags: ['场景', '地图'], hue: 120 },
  { name: 'ui_click.wav', folder: 'audio/sfx', kind: 'audio', badge: '0.2 秒', dur: 0.2, tags: ['音效', '界面'] },
  { name: 'coin_pickup.wav', folder: 'audio/sfx', kind: 'audio', badge: '0.4 秒', dur: 0.4, tags: ['音效'] },
  { name: 'theme_town.ogg', folder: 'audio/music', kind: 'audio', badge: '2:14', dur: 134, tags: ['音乐'], bytes: 4.1e6 },
  { name: 'vfx_sparkle.png', folder: 'vfx', kind: 'image', alpha: true, badge: '1024×1024', w: 1024, h: 1024, tags: ['特效', '序列帧'], hue: 55 },
  { name: 'vfx_smoke.gif', folder: 'vfx', kind: 'image', alpha: true, badge: '512×512', w: 512, h: 512, tags: ['特效', '动图'], bytes: 2.6e6, hue: 0 },
  { name: 'art_style_guide.md', folder: 'docs', kind: 'doc', stage: 'production', review: 'exempt', title: '美术风格规范', excerpt: '色彩明快、轮廓清晰。模型面数：道具不超过 5,000，角色不超过 12,000。贴图边长为 2 的幂。', tags: ['规范'] },
  { name: 'naming_rules.md', folder: 'docs', kind: 'doc', stage: 'production', review: 'exempt', title: '命名规则', excerpt: '全部小写，下划线分隔：对象_用途_变体。贴图后缀 basecolor / normal / orm。', tags: ['规范'], bytes: 4e3 },
  { name: 'changelog.txt', folder: 'docs', kind: 'doc', stage: 'production', review: 'exempt', title: 'changelog.txt', excerpt: '2026-11-24  user:lin  chest.glb  修正包边比例', tags: [], bytes: 1e3 },
  { name: 'index.html', folder: V2, kind: 'doc', stage: 'production', review: 'pending', title: '商店界面原型 v2', excerpt: '货架改成 4×2，加了购买确认。', tags: ['商店', '原型稿'], by: 'user:mo', bytes: 12e3 },
  { name: 'shop.css', folder: V2, kind: 'unknown', stage: 'production', review: 'pending', tags: [], by: 'user:mo', bytes: 6e3 },
  ...[[205, 1], [28, 3 / 4], [320, 4 / 3], [160, 1], [265, 3 / 4], [48, 4 / 3], [185, 1], [350, 16 / 9]].map(([hue, ar], i) => ({ name: `ref_render_${String(i + 1).padStart(2, '0')}.png`, folder: R3, kind: 'image' as const, hue: hue!, ar: ar!, stage: 'reference' as Stage, review: 'exempt' as ReviewStatus, badge: '2400×2400', w: 2400, h: 2400, tags: i % 3 ? ['参考'] : ['参考', '材质'], by: 'user:mo' }))
]

export const FOLDER_META: Record<string, { label?: string; icon?: string; description?: string; defaults?: { stage?: Stage; review?: 'pending' | 'exempt'; tags?: string[] } }> = {
  characters: { label: '角色' }, props: { label: '道具' }, environments: { label: '场景' }, ui: { label: '界面' }, audio: { label: '音频' }, vfx: { label: '特效' },
  references: { label: '参考', defaults: { stage: 'reference', review: 'exempt', tags: ['参考'] } },
  docs: { label: '规范文档', icon: 'file-text' },
  'props/chest': { label: '宝箱', icon: 'box', description: '新手村宝箱：原画、模型、贴图、Icon、音效', defaults: { stage: 'production', review: 'pending', tags: ['宝箱', '道具'] } },
  'props/lantern': { label: '提灯' },
  'ui/shop': { defaults: { stage: 'runtime', tags: ['商店'] } }
}

/** A stable small hash for ids and colours. */
export function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

export function guid(n: number): string { return '0192f3a4-7c1e-7b52-9d06-' + (0x4e8a51c0d200 + n).toString(16).padStart(12, '0').slice(-12) }

/** A small SVG drawing per kind, as a data URL — stands in for server / browser-rendered thumbnails. */
export function thumbSvg(s: Seed): string {
  const h = s.hue ?? (hash(s.name) % 360)
  const ar = s.ar ?? (s.w && s.h ? s.w / s.h : 1)
  const W = 160, H = Math.round(160 / ar)
  let body = ''
  const bg = `<rect width="${W}" height="${H}" fill="hsl(${h} 18% 14%)"/>`
  switch (s.kind) {
    case 'image':
      body = s.alpha
        ? `<circle cx="${W / 2}" cy="${H / 2}" r="${Math.min(W, H) * 0.34}" fill="hsl(${h} 70% 58%)"/><circle cx="${W / 2 - 10}" cy="${H / 2 - 10}" r="${Math.min(W, H) * 0.12}" fill="#fff" opacity=".35"/>`
        : `${bg}<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h + 40} 60% 78%)"/><stop offset="1" stop-color="hsl(${h} 45% 40%)"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><path d="M0 ${H * 0.72}Q${W * 0.3} ${H * 0.5} ${W * 0.6} ${H * 0.68}T${W} ${H * 0.6}V${H}H0Z" fill="hsl(${h} 38% 30%)"/><circle cx="${W * 0.74}" cy="${H * 0.26}" r="${H * 0.1}" fill="#fff6c9"/>`
      break
    case 'model':
      body = `<rect width="${W}" height="${H}" fill="#2c2d31"/><path d="M0 132h160M0 146h160" stroke="#fff" stroke-opacity=".07"/><polygon points="40,70 80,50 120,70 120,112 80,132 40,112" fill="hsl(${h} 45% 45%)"/><polygon points="40,70 80,90 120,70 80,50" fill="hsl(${h} 50% 62%)"/><polygon points="80,90 120,70 120,112 80,132" fill="hsl(${h} 45% 32%)"/>`
      break
    case 'video':
      body = `<rect width="${W}" height="${H}" fill="#1b2230"/><rect y="${H - 30}" width="${W}" height="30" fill="#141a25"/><polygon points="66,50 66,100 108,75" fill="hsl(${h} 60% 70%)"/>`
      break
    case 'audio': {
      let bars = ''
      for (let i = 0; i < 34; i++) { const v = 8 + Math.abs(Math.sin(i * 1.7 + (hash(s.name) % 7))) * 46 * Math.exp(-i / 20); bars += `<rect x="${12 + i * 4}" y="${80 - v / 2}" width="2.4" height="${v}" rx="1.2" fill="#9a9aa3"/>` }
      body = `<rect width="${W}" height="${H}" fill="#18181b"/>${bars}`
      break
    }
    default: body = bg
  }
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">${body}</svg>`)
}

export function ago(days: number): string { return new Date(NOW - days * DAY).toISOString() }

export type Store = Map<string, AssetDetail>
