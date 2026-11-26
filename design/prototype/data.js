/* Bowerbird prototype — sample library「星落镇」, extended for whole pages.
 * Adds thumbnail drawings and the asset table (window.BBData). Demo data only. */
(function () {
  'use strict';
  var B = Bowerbird, D = B.demo, uid = 0;

  /* ── more thumbnail drawings ── */
  function shade(id, a, b) { return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>'; }
  D.registerArt('ui', function (a) {
    var id = 'u' + (++uid), c = a.c || ['#ffb347', '#e07b1a'], s = shade(id, c[0], c[1]), f = 'url(#' + id + ')';
    switch (a.shape) {
      case 'panel': return s + '<rect x="14" y="26" width="132" height="108" rx="14" fill="#3b2a52"/><rect x="20" y="32" width="120" height="96" rx="10" fill="' + f + '"/><rect x="20" y="32" width="120" height="22" rx="10" fill="#fff" opacity=".18"/>';
      case 'coin': return s + '<circle cx="80" cy="80" r="46" fill="#a86a00"/><circle cx="80" cy="77" r="44" fill="' + f + '"/><circle cx="80" cy="77" r="31" fill="none" stroke="#a86a00" stroke-width="4" opacity=".55"/><path d="M80 58v38M70 66h14a8 8 0 0 1 0 16H70" fill="none" stroke="#a86a00" stroke-width="6" stroke-linecap="round" opacity=".75"/>';
      case 'gem': return s + '<polygon points="80,28 124,64 80,134 36,64" fill="' + f + '"/><polygon points="80,28 124,64 80,64" fill="#fff" opacity=".28"/><polygon points="36,64 80,64 80,134" fill="#000" opacity=".16"/><polyline points="36,64 124,64" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>';
      case 'tab': return s + '<path d="M22 118V60a14 14 0 0 1 14-14h88a14 14 0 0 1 14 14v58Z" fill="' + f + '"/><rect x="48" y="74" width="64" height="10" rx="5" fill="#fff" opacity=".7"/>';
      case 'frame': return s + '<rect x="26" y="26" width="108" height="108" rx="16" fill="#2a2140"/><rect x="26" y="26" width="108" height="108" rx="16" fill="none" stroke="' + f + '" stroke-width="8"/>';
      case 'badge': return s + '<path d="M80 26l14 12 18-2 4 18 16 9-8 17 8 17-16 9-4 18-18-2-14 12-14-12-18 2-4-18-16-9 8-17-8-17 16-9 4-18 18 2Z" fill="' + f + '"/><rect x="58" y="72" width="44" height="12" rx="6" fill="#fff" opacity=".85"/>';
      case 'divider': return s + '<rect x="16" y="74" width="128" height="12" rx="6" fill="' + f + '"/><circle cx="80" cy="80" r="12" fill="' + c[0] + '"/>';
      case 'close': return s + '<circle cx="80" cy="80" r="42" fill="' + f + '"/><path d="M64 64l32 32M96 64 64 96" stroke="#fff" stroke-width="10" stroke-linecap="round"/>';
      default: return s + '<rect x="16" y="50" width="128" height="62" rx="20" fill="#000" opacity=".25"/><rect x="16" y="44" width="128" height="62" rx="20" fill="' + f + '"/><rect x="24" y="50" width="112" height="20" rx="10" fill="#fff" opacity=".25"/><rect x="52" y="70" width="56" height="12" rx="6" fill="#fff" opacity=".9"/>';
    }
  });
  /* the chest turnaround, drawn as true orthographic views at 40 px per metre: front/back show the lid's flat face,
   * the side shows its curve (drawn a little too tall — the kind of slip a model check should catch), the top shows the trim */
  D.registerArt('turnaround', function () {
    var S = 40, F = '#e9dcc0', K = '#40342a', BD = '#d6c39b', ln = ' stroke="' + K + '" stroke-width="1.3" stroke-linejoin="round"';
    function r(x, y, w, h, fill, rx) { return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"' + (rx ? ' rx="' + rx + '"' : '') + ' fill="' + (fill || F) + '"' + ln + '/>'; }
    function face(cx, by, lock) {
      var s = r(cx - 0.63 * S, by - 0.06 * S, 1.26 * S, 0.06 * S, BD) + r(cx - 0.6 * S, by - 0.59 * S, 1.2 * S, 0.53 * S) + r(cx - 0.6 * S, by - 0.95 * S, 1.2 * S, 0.36 * S, F, 2);
      [-0.38, 0.38].forEach(function (x) { s += r(cx + (x - 0.05) * S, by - 0.95 * S, 0.1 * S, 0.89 * S, BD); });
      if (lock) s += r(cx - 0.08 * S, by - 0.57 * S, 0.16 * S, 0.2 * S, '#f0c35a', 1);
      return s;
    }
    function side(cx, by) {
      var d = 0.4 * S, top = by - 0.69 * S, k = 0.32 * S;
      return r(cx - 0.43 * S, by - 0.06 * S, 0.86 * S, 0.06 * S, BD) + r(cx - d, by - 0.59 * S, 0.8 * S, 0.53 * S) + r(cx - d, top, 0.8 * S, 0.1 * S) +
        '<path d="M' + (cx - d).toFixed(1) + ' ' + top.toFixed(1) + 'A' + d.toFixed(1) + ' ' + k.toFixed(1) + ' 0 0 1 ' + (cx + d).toFixed(1) + ' ' + top.toFixed(1) + 'Z" fill="' + F + '"' + ln + '/>';
    }
    function topv(cx, cy) {
      var s = r(cx - 0.63 * S, cy - 0.43 * S, 1.26 * S, 0.86 * S, BD) + r(cx - 0.6 * S, cy - 0.4 * S, 1.2 * S, 0.8 * S, F, 2);
      [-0.38, 0.38].forEach(function (x) { s += r(cx + (x - 0.05) * S, cy - 0.41 * S, 0.1 * S, 0.82 * S, BD); });
      return s + r(cx - 0.08 * S, cy + 0.4 * S, 0.16 * S, 0.03 * S, '#f0c35a');
    }
    function lab(x, y, t) { return '<text x="' + x + '" y="' + y + '" font-size="9" text-anchor="middle" fill="#7b6f60" font-family="system-ui,sans-serif">' + t + '</text>'; }
    return '<rect width="160" height="160" fill="#f3eee4"/>' + face(44, 60, true) + side(116, 60) + face(44, 136) + topv(116, 116);  /* no labels: which cell is which view is in the .bmeta (ADR-019) */
  });
  /* a darker base colour sheet */
  D.registerArt('basecolor_dark', function () { var s = '<rect width="160" height="160" fill="#1a120c"/>'; [[8, 8, 88, 56], [8, 70, 88, 42], [102, 8, 50, 104]].forEach(function (r) { s += '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" rx="2" fill="#6a4326"/>'; for (var y = r[1] + 14; y < r[1] + r[3] - 4; y += 14) s += '<rect x="' + r[0] + '" y="' + y + '" width="' + r[2] + '" height="2" fill="#432817"/>'; }); return s + '<rect x="8" y="118" width="144" height="12" rx="2" fill="#b08a3e"/><rect x="8" y="136" width="144" height="16" rx="2" fill="#b08a3e"/>'; });
  /* the first chest concept, before the lock and trim were brightened */
  D.registerArt('concept_v1', function () { return '<rect width="160" height="160" fill="#dfe7e2"/><circle cx="80" cy="84" r="58" fill="#cfdad3"/>' + D.chest({ top: '#c4935a', front: '#a5672f', side: '#74441b', brass: '#b8995a', brassDk: '#86692c', lock: '#c9b48a', line: '#3a2410' }); });
  D.registerArt('mockup', function (a) {
    var s = '<rect width="240" height="135" fill="#2b2140"/><rect x="14" y="12" width="212" height="111" rx="10" fill="#4a3a6e"/><rect x="14" y="12" width="212" height="20" rx="10" fill="#6a56a0"/><rect x="24" y="18" width="52" height="8" rx="4" fill="#fff" opacity=".8"/><circle cx="214" cy="22" r="6" fill="#ff7a6b"/>';
    for (var i = 0; i < 8; i++) { var x = 24 + (i % 4) * (a.gap || 39), y = 40 + Math.floor(i / 4) * 36; s += '<rect x="' + x + '" y="' + y + '" width="32" height="30" rx="6" fill="#2b2140"/><circle cx="' + (x + 16) + '" cy="' + (y + 13) + '" r="7" fill="' + ['#ffc24a', '#6fd3ff', '#ff8fb3', '#9be28a'][i % 4] + '"/><rect x="' + (x + 7) + '" y="' + (y + 23) + '" width="18" height="3" rx="1.5" fill="#fff" opacity=".5"/>'; }
    return s + '<rect x="184" y="44" width="34" height="62" rx="6" fill="#2b2140"/><rect x="188" y="88" width="26" height="12" rx="6" fill="#ffb347"/>';
  });
  D.registerArt('env', function (a) {
    var h = a.hue || 150, id = 'e' + (++uid);
    return shade(id, 'hsl(' + (h + 50) + ' 70% 78%)', 'hsl(' + (h + 20) + ' 60% 88%)') + '<rect width="240" height="135" fill="url(#' + id + ')"/><circle cx="186" cy="34" r="16" fill="#fff6c9"/><path d="M0 96Q50 62 104 92T240 78V135H0Z" fill="hsl(' + h + ' 38% 52%)"/><path d="M0 112Q70 86 130 108T240 100V135H0Z" fill="hsl(' + h + ' 42% 40%)"/><rect x="52" y="78" width="16" height="20" fill="#c98a5a"/><polygon points="48,80 60,66 72,80" fill="#b5533f"/><rect x="80" y="82" width="12" height="16" fill="#d9a06a"/><polygon points="77,84 86,73 95,84" fill="#8f4a3a"/>';
  });
  D.registerArt('sprite', function () {
    var s = '';
    for (var i = 0; i < 16; i++) { var x = 20 + (i % 4) * 40, y = 20 + Math.floor(i / 4) * 40, r = 3 + i; s += '<path d="M' + x + ' ' + (y - r) + 'L' + (x + r * 0.28) + ' ' + (y - r * 0.28) + 'L' + (x + r) + ' ' + y + 'L' + (x + r * 0.28) + ' ' + (y + r * 0.28) + 'L' + x + ' ' + (y + r) + 'L' + (x - r * 0.28) + ' ' + (y + r * 0.28) + 'L' + (x - r) + ' ' + y + 'L' + (x - r * 0.28) + ' ' + (y - r * 0.28) + 'Z" fill="#ffe08a" opacity="' + (1 - i * 0.045).toFixed(2) + '"/>'; }
    return s;
  });
  /* an animated image: a.frame picks the frame (0 when absent) */
  D.registerArt('smoke', function (a) {
    var f = (a.frame || 0) / (a.frames || 24), s = '';
    for (var k = 0; k < 6; k++) {
      var p = (f + k / 6) % 1, y = 132 - p * 104, r = 12 + p * 30, x = 80 + Math.sin(p * 5 + k * 1.7) * 16, o = Math.sin(p * Math.PI) * 0.75;
      s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="hsl(' + (28 - p * 20) + ' ' + (30 - p * 26) + '% ' + (78 + p * 14) + '%)" opacity="' + o.toFixed(2) + '"/>';
    }
    return s + '<ellipse cx="80" cy="138" rx="18" ry="5" fill="#ff9d2a" opacity=".55"/>';
  });
  D.registerArt('raster', function (a) { return '<image href="' + a.img + '" x="0" y="0" width="160" height="160" preserveAspectRatio="xMidYMid meet"/>'; });
  D.registerArt('character', function (a) {
    var c = a.c || ['#4f79c9', '#e9b48a', '#6a3b1e'];
    return '<rect width="160" height="160" fill="#ece6da"/><ellipse cx="80" cy="140" rx="34" ry="6" fill="#000" opacity=".12"/><rect x="62" y="64" width="36" height="46" rx="8" fill="' + c[0] + '"/><rect x="66" y="108" width="12" height="30" rx="4" fill="#3b3b4a"/><rect x="82" y="108" width="12" height="30" rx="4" fill="#3b3b4a"/><rect x="50" y="68" width="12" height="34" rx="6" fill="' + c[0] + '"/><rect x="98" y="68" width="12" height="34" rx="6" fill="' + c[0] + '"/><circle cx="80" cy="46" r="20" fill="' + c[1] + '"/><path d="M60 44a20 20 0 0 1 40 0q-8-10-20-10t-20 10Z" fill="' + c[2] + '"/><rect x="62" y="84" width="36" height="6" fill="#f0c35a"/>';
  });
  D.registerArt('wave', function (a) {
    var s = '', r = a.seed || 3, n = 34;
    for (var i = 0; i < n; i++) { r = (r * 9301 + 49297) % 233280; var t = i / n, e = a.env === 'long' ? 0.4 + 0.6 * Math.abs(Math.sin(t * 7 + r % 3)) : Math.exp(-t * 4.5); var h = Math.max(3, (0.35 + 0.65 * r / 233280) * e * 96), x = 14 + i * (132 / n); s += '<rect x="' + x.toFixed(1) + '" y="' + (80 - h / 2).toFixed(1) + '" width="2.5" height="' + h.toFixed(1) + '" rx="1"/>'; }
    return '<g class="bb-art__ink">' + s + '</g>';
  });

  /* ── the asset table ── */
  var n = 0, DAY = 86400000, NOW = Date.UTC(2026, 10, 25, 4);
  function mk(name, folder, kind, o) {
    n++;
    var a = Object.assign({ id: '0192f3a4-7c1e-7b52-9d06-' + ('000000000000' + (0x4e8a51c0d200 + n).toString(16)).slice(-12), name: name, folder: folder, path: folder + '/' + name, kind: kind, stage: 'runtime', review: 'approved', tags: [], aiTags: [], by: 'user:mo', modified: NOW - (n * 7 % 23) * DAY - n * 3600000, bytes: 40000 + (n * 7919 % 97) * 21000 }, o || {});
    if (!a.state && kind === 'unknown') a.state = 'unknown';
    if (!a.created) a.created = a.modified - ((n * 5) % 9 + 1) * DAY;
    return a;
  }
  var C = 'props/chest', SH = 'ui/shop', R3 = 'references/3d-render';
  var assets = [
    mk('chest.md', C, 'doc', { stage: 'production', review: 'exempt', title: '宝箱', excerpt: '新手村第一个可以打开的容器。卡通、低多边形，木质箱体加黄铜包边，开箱时有一束暖光。', tags: ['宝箱', '设计对象'], bytes: 2100, by: 'user:lin',
      /* target size, read by the doc plugin from the file's front matter (size: 1.26 × 0.95 × 0.87 m — 宽 × 高 × 深) */
      target: { w: 1.26, h: 0.95, d: 0.87 } }),
    mk('chest_concept.png', C, 'image', { art: 'concept', stage: 'production', info: '1536×1536', w: 1536, h: 1536, tags: ['宝箱', '原画'], aiTags: ['木质', '黄铜', '卡通'], by: 'agent:concept-artist', bytes: 2.1e6 }),
    /* the grid (rows, columns, which view each cell holds) is written into the .bmeta by whoever generated the sheet (ADR-019) */
    mk('chest_turnaround.png', C, 'image', { art: 'turnaround', grid: { rows: 2, cols: 2, cells: ['front', 'side', 'back', 'top'] }, stage: 'production', info: '2048×2048', w: 2048, h: 2048, tags: ['宝箱', '四视图'], by: 'agent:concept-artist', bytes: 1.4e6 }),
    mk('chest_high.blend', C, 'unknown', { stage: 'production', review: 'exempt', tags: ['宝箱'], by: 'agent:modeler', bytes: 18.6e6 }),
    mk('chest.glb', C, 'model', { art: 'model', review: 'pending', info: '2,480 面', tris: 2480, tags: ['宝箱', '道具'], aiTags: ['低多边形'], by: 'user:lin', bytes: 1.2e6, modified: NOW - 0.5 * DAY }),
    mk('chest_basecolor.png', C, 'image', { art: 'basecolor', info: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], bytes: 612e3 }),
    /* a darker take on the base colour: swap the model's 基础色 to it in the relation graph and the 3D view follows (ADR-018) */
    mk('chest_basecolor_dark.png', C, 'image', { art: 'basecolor_dark', woodTint: '#8a6f64', info: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], by: 'user:lin', bytes: 598e3 }),
    mk('chest_normal.png', C, 'image', { art: 'normal', info: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], bytes: 840e3 }),
    mk('chest_orm.png', C, 'image', { art: 'orm', info: '1024×1024', w: 1024, h: 1024, tags: ['宝箱', '贴图'], bytes: 388e3 }),
    mk('chest_icon.png', C, 'image', { art: 'icon', alpha: true, issue: 'stale', info: '256×256', w: 256, h: 256, tags: ['宝箱', 'Icon'], by: 'agent:modeler', bytes: 48e3 }),
    mk('chest_open.wav', C, 'audio', { art: 'audio', info: '0.8 秒', dur: 0.8, tags: ['宝箱', '音效'], bytes: 141e3 }),
    mk('chest_open_preview.mp4', C, 'video', { art: 'video', stage: 'production', review: 'exempt', info: '0:03', dur: 3, tags: ['宝箱'], bytes: 3.4e6 }),
    mk('potion.glb', 'props/potion', 'model', { art: 'potion', issue: 'broken', info: '1,120 面', tris: 1120, tags: ['药水', '道具'], bytes: 640e3 }),
    mk('potion_concept.png', 'props/potion', 'image', { art: 'potion', stage: 'production', info: '1536×1536', w: 1536, h: 1536, tags: ['药水', '原画'], by: 'agent:concept-artist' }),
    mk('sword_iron.glb', 'props/weapon', 'model', { art: 'hero', info: '3,860 面', tris: 3860, tags: ['武器', '道具'], review: 'approved' }),
    /* just registered by an Agent: a prompt, AI tags nobody has adopted yet — the start of walkthrough path 1 */
    mk('lantern_concept.png', 'props/lantern', 'image', { art: 'potion', stage: 'production', review: 'pending', origin: 'rec_lantern', info: '1536×1536', w: 1536, h: 1536, tags: ['提灯', '原画'], aiTags: ['黄铜', '磨砂玻璃', '暖光', '卡通'], by: 'agent:concept-artist', bytes: 1.9e6, modified: NOW - 4 * 60000 }),
    mk('shop_prototype.html', SH, 'doc', { stage: 'production', title: '商店界面原型', excerpt: '可交互原型：货架 4×2，右侧详情与购买按钮，顶部货币栏。', tags: ['商店', '原型稿'], by: 'user:mo', bytes: 38e3 }),
    mk('shop_mockup.png', SH, 'image', { art: 'mockup', vb: [240, 135], ar: 16 / 9, stage: 'production', info: '1920×1080', w: 1920, h: 1080, tags: ['商店', '效果图'], by: 'user:mo' })
  ];
  [['btn_buy.png', '', ['#ffc24a', '#f08a1c'], 'approved'], ['btn_close.png', 'close', ['#ff8f7a', '#e0503c'], 'approved'], ['panel_bg.png', 'panel', ['#7a64b8', '#4a3a6e'], 'approved'], ['icon_coin.png', 'coin', ['#ffd65a', '#f0a81c'], 'approved'], ['icon_gem.png', 'gem', ['#7fe0ff', '#2a8fe0'], 'pending'], ['tab_active.png', 'tab', ['#8f78d0', '#6a56a0'], 'approved'],
    ['tab_idle.png', 'tab', ['#5a4a80', '#40345e'], 'pending'], ['btn_sell.png', '', ['#9be28a', '#3fa85a'], 'approved'], ['frame_item.png', 'frame', ['#ffd65a', '#c98a1c'], 'approved'], ['badge_new.png', 'badge', ['#ff8fb3', '#e0447a'], 'pending'], ['slot_empty.png', 'frame', ['#6a56a0', '#4a3a6e'], 'approved'], ['divider.png', 'divider', ['#8f78d0', '#6a56a0'], 'approved']
  ].forEach(function (s) { assets.push(mk(s[0], SH, 'image', { art: 'ui', shape: s[1], c: s[2], alpha: true, review: s[3], info: '256×256', w: 256, h: 256, tags: ['商店', '切图'], by: 'agent:slicer' })); });
  assets.push(
    mk('btn_buy (1).png', SH, 'image', { art: 'ui', shape: '', c: ['#ffc24a', '#f08a1c'], alpha: true, issue: 'identity', review: 'pending', info: '256×256', w: 256, h: 256, tags: ['商店', '切图'], by: 'system:scanner' }),
    mk('icon_coin.png', 'ui/icons', 'image', { art: 'ui', shape: 'coin', c: ['#ffd65a', '#f0a81c'], alpha: true, info: '256×256', w: 256, h: 256, tags: ['Icon'] }),
    mk('hud_health.png', 'ui/hud', 'image', { art: 'ui', shape: 'divider', c: ['#ff8f7a', '#e0503c'], alpha: true, info: '512×64', w: 512, h: 64, tags: [] }),
    mk('hero_concept.png', 'characters/hero', 'image', { art: 'character', stage: 'production', info: '2048×2048', w: 2048, h: 2048, tags: ['主角', '原画'], by: 'agent:concept-artist' }),
    mk('hero.glb', 'characters/hero', 'model', { art: 'hero', info: '8,912 面', tris: 8912, tags: ['主角'], review: 'rejected', by: 'agent:modeler', bytes: 6.8e6 }),
    /* FBX is read in the browser too (ADR-022); this one carries no roughness, metalness or occlusion the plugin can read */
    mk('hero_walk.fbx', 'characters/hero', 'model', { art: 'hero', stage: 'production', review: 'pending', info: '8,912 面', tris: 8912, unread: ['rough', 'metal', 'ao'], tags: ['主角', '动画'], by: 'agent:modeler', bytes: 7.4e6 }),
    mk('hero_idle.fbx', 'characters/hero', 'model', { art: 'hero', state: 'missing', stage: 'production', review: 'pending', issue: 'missing', info: '8,912 面', tris: 8912, tags: ['主角'] }),
    mk('npc_guard.glb', 'characters/npc', 'model', { state: 'waiting', review: 'pending', tags: [], by: 'agent:modeler', modified: NOW - 600000 }),
    mk('npc_merchant.glb', 'characters/npc', 'model', { state: 'waiting', review: 'pending', tags: [], by: 'agent:modeler', modified: NOW - 540000 }),
    mk('npc_merchant_concept.png', 'characters/npc', 'image', { art: 'character', c: ['#b5533f', '#d9a06a', '#3b3b4a'], stage: 'production', info: '2048×2048', w: 2048, h: 2048, tags: ['NPC', '原画'], review: 'pending', aiTags: ['商人'], by: 'agent:concept-artist' }),
    mk('intro_cutscene.mov', 'environments', 'video', { state: 'failed', stage: 'production', review: 'exempt', issue: 'failed', tags: [], bytes: 86e6 }),
    mk('env_village.png', 'environments', 'image', { art: 'env', hue: 140, vb: [240, 135], ar: 16 / 9, stage: 'production', info: '3840×2160', w: 3840, h: 2160, tags: ['场景', '原画'] }),
    mk('env_forest.png', 'environments', 'image', { art: 'env', hue: 100, vb: [240, 135], ar: 16 / 9, stage: 'production', info: '3840×2160', w: 3840, h: 2160, tags: ['场景'], review: 'approved' }),
    mk('ui_click.wav', 'audio/sfx', 'audio', { art: 'wave', seed: 5, info: '0.2 秒', dur: 0.2, tags: ['音效', '界面'] }),
    mk('coin_pickup.wav', 'audio/sfx', 'audio', { art: 'wave', seed: 9, info: '0.4 秒', dur: 0.4, tags: ['音效'] }),
    mk('theme_town.ogg', 'audio/music', 'audio', { art: 'wave', seed: 4, env: 'long', info: '2:14', dur: 134, tags: ['音乐'], bytes: 4.1e6 }),
    mk('vfx_sparkle.png', 'vfx', 'image', { art: 'sprite', alpha: true, info: '1024×1024', w: 1024, h: 1024, tags: ['特效', '序列帧'] }),
    mk('art_style_guide.md', 'docs', 'doc', { stage: 'production', review: 'exempt', title: '美术风格规范', excerpt: '色彩明快、轮廓清晰。模型面数：道具不超过 5,000，角色不超过 12,000。贴图边长为 2 的幂。', tags: ['规范'], bytes: 9e3 }),
    mk('naming_rules.md', 'docs', 'doc', { stage: 'production', review: 'exempt', title: '命名规则', excerpt: '全部小写，下划线分隔：对象_用途_变体。贴图后缀 basecolor / normal / orm。', tags: ['规范'], bytes: 4e3 }),
    mk('changelog.txt', 'docs', 'doc', { stage: 'production', review: 'exempt', title: 'changelog.txt', excerpt: '2026-11-24  user:lin  chest.glb  修正包边比例', tags: [], bytes: 1e3 }),
    mk('export_presets.json', 'docs', 'doc', { stage: 'production', review: 'exempt', title: 'export_presets.json', excerpt: '{ "version": 2, "target": "glb", "textures": { "maxSize": 1024 } }', tags: ['规范'], bytes: 600 }),
    mk('hero_run.skel', 'characters/hero', 'unknown', { stage: 'runtime', review: 'pending', issue: 'plugin', needs: ['Spine', 'community.spine 1.4'], tags: ['主角', '动画'], by: 'user:lin', bytes: 410e3 }),
    mk('vfx_smoke.gif', 'vfx', 'image', { art: 'smoke', frames: 24, fps: 12, alpha: true, info: '512×512', w: 512, h: 512, tags: ['特效', '动图'], bytes: 2.6e6 }),
    /* OBJ is not supported in phase one: shown as an unknown format (ADR-022) */
    mk('rock_01.obj', 'environments', 'unknown', { stage: 'production', review: 'pending', tags: ['岩石'], by: 'user:mo', bytes: 2.2e6 }),
    mk('sky_noon.hdr', 'environments', 'image', { art: 'env', hue: 190, vb: [240, 135], ar: 2, stage: 'reference', review: 'exempt', sky: ['#9fd0ff', '#4a6b3a'], info: '4096×2048', w: 4096, h: 2048, tags: ['HDRI'], bytes: 24e6 }),
    mk('forest_dusk.hdr', 'environments', 'image', { art: 'env', hue: 30, vb: [240, 135], ar: 2, stage: 'reference', review: 'exempt', sky: ['#f0a070', '#1f2a22'], info: '4096×2048', w: 4096, h: 2048, tags: ['HDRI'], bytes: 22e6 }),
    mk('world_map_16k.png', 'environments', 'image', { art: 'env', hue: 120, vb: [240, 135], ar: 16 / 9, stage: 'production', review: 'pending', viewerError: 'bowerbird.image · 图片尺寸 16384×9216 超出浏览器能显示的上限', info: '16384×9216', w: 16384, h: 9216, tags: ['场景', '地图'], bytes: 214e6 })
  );
  [[205, 1], [28, 3 / 4], [320, 4 / 3], [160, 1], [265, 3 / 4], [48, 4 / 3], [185, 1], [350, 16 / 9]].forEach(function (r, i) {
    assets.push(mk('ref_render_' + ('0' + (i + 1)).slice(-2) + '.png', R3, 'image', { art: 'render', hue: r[0], ar: r[1], stage: 'reference', review: 'exempt', info: '2400×2400', w: 2400, h: 2400, tags: i % 3 ? ['参考'] : ['参考', '材质'], by: 'user:mo' }));
  });

  assets.push(mk('potion_normal.png', 'props/potion', 'image', { art: 'normal', info: '1024×1024', w: 1024, h: 1024, tags: ['药水', '贴图'] }));
  /* a web prototype with its resources, still as loose files: make the folder one asset from its menu (bundle, F-10) */
  var V2 = 'ui/shop_v2';
  assets.push(
    mk('index.html', V2, 'doc', { stage: 'production', review: 'pending', title: '商店界面原型 v2', excerpt: '货架改成 4×2，加了购买确认。', tags: ['商店', '原型稿'], by: 'user:mo', bytes: 12e3 }),
    mk('shop.css', V2, 'unknown', { stage: 'production', review: 'pending', tags: [], by: 'user:mo', bytes: 6e3 }),
    mk('shop.js', V2, 'unknown', { stage: 'production', review: 'pending', tags: [], by: 'user:mo', bytes: 9e3 }),
    mk('slot.png', V2, 'image', { art: 'ui', shape: 'frame', c: ['#ffd65a', '#c98a1c'], alpha: true, info: '128×128', w: 128, h: 128, tags: [], by: 'user:mo', bytes: 14e3 }),
    mk('coin.png', V2, 'image', { art: 'ui', shape: 'coin', c: ['#ffd65a', '#f0a81c'], alpha: true, info: '64×64', w: 64, h: 64, tags: [], by: 'user:mo', bytes: 6e3 })
  );

  /* descriptions: the human one is searched first and shown first; the AI one stays secondary until someone writes their own (F-08) */
  var DESC = { 'chest.glb': ['新手村第一个能打开的宝箱，运行时用。开箱动画在 chest_open_preview.mp4。', '木质宝箱模型，黄铜包边，正面有锁扣，箱盖为半圆柱形。'], 'chest_concept.png': ['', '卡通风格的木质宝箱原画，四分之三视角，黄铜包边。'], 'lantern_concept.png': ['', '黄铜骨架的提灯原画，磨砂玻璃灯罩，暖色光晕。'], 'hero.glb': ['主角的运行时模型。', ''], 'env_village.png': ['', '白天的村庄全景，石板路与木屋，远处有风车。'] };
  assets.forEach(function (a) { var d = DESC[a.name]; if (d) { a.desc = d[0]; a.aiDesc = d[1]; } });

  /* only the latest verdict is kept (ADR-024): who decided, when, and the comment — required when rejecting */
  var NOTES = { 'hero.glb': '左肩甲穿模，手腕权重要重刷', 'chest_concept.png': '包边颜色可以，按这个出四视图' };
  assets.forEach(function (a) {
    if (a.review !== 'approved' && a.review !== 'rejected') return;
    a.reviewBy = a.by === 'user:lin' ? 'user:mo' : 'user:lin'; a.reviewAt = a.modified + 5 * 3600000; a.reviewNote = NOTES[a.name] || '';
  });

  /* ── relations: typed, directed edges. "from" depends on "to":
   *    source  from 由 to 产出（记下 to 当时的版本，to 之后变了就是「上游已更新」）
   *    uses    from 使用时需要 to
   *    belongs from 属于 to 代表的设计对象
   *    An edge whose "to" no longer exists is a broken link and keeps its old file name. ── */
  function byPath(p) { return assets.filter(function (a) { return a.path === p; })[0]; }
  function byId(id) { return assets.filter(function (a) { return a.id === id; })[0]; }
  var EDGES = [], eid = 0, rid = 0;
  function edge(from, type, to, o) { var f = byPath(from), t = byPath(to); if (!f) return; EDGES.push(Object.assign({ id: 'e' + (++eid), from: f.id, to: t ? t.id : null, toName: to.split('/').pop(), type: type }, o || {})); }
  var RECS = {
    rec_concept: { method: 'AI 生成', tool: 'concept-gen 2.1', by: 'agent:concept-artist', at: '11 月 18 日 14:02', prompt: '卡通风格的木质宝箱，黄铜包边，手绘质感，游戏道具原画，四分之三视角，纯色背景', params: 'seed 4211 · 1536×1536 · 30 步' },
    /* the prompt is filled from the design object chest.md: views, layout and target size — so the sheet comes out checkable */
    rec_turn: { method: 'AI 生成', tool: 'turnaround-gen 1.2', by: 'agent:concept-artist', at: '11 月 19 日 10:30', template: '四视图', from: 'chest.md',
      prompt: '宝箱的正交四视图：正、侧、背、顶分开摆放，纯色背景，同一比例，线稿加平涂。\n目标尺寸：宽 1.26 m × 高 0.95 m × 深 0.87 m。\n造型依照 chest_concept.png：木质箱体，黄铜包边，正面锁扣，半圆柱形箱盖。', params: 'seed 1907 · 2048×2048 · 28 步' },
    rec_blend: { method: '手工', tool: 'Blender 4.2', by: 'agent:modeler', at: '11 月 20 日 18:12' },
    rec_export: { method: '导出', tool: 'Blender 4.2 · glTF', by: 'user:lin', at: '11 月 24 日 16:40', params: '缩放 1 · 动画烘焙 30 fps · 贴图 1024' },
    rec_icon: { method: '渲染', tool: 'Bowerbird 模型查看器', by: 'agent:modeler', at: '11 月 21 日 11:05', params: '通道 完整渲染 · 环境 工作室 · 透视 35° · 256×256' },
    rec_mockup: { method: '手工', tool: 'Figma', by: 'user:mo', at: '11 月 15 日 09:20' },
    rec_lantern: { method: 'AI 生成', tool: 'concept-gen 2.1', by: 'agent:concept-artist', at: '刚刚', prompt: '提灯的原画：黄铜骨架，磨砂玻璃灯罩，点亮时有暖色光晕。卡通、低多边形风格，四分之三视角，纯色背景。', params: 'seed 7730 · 1536×1536 · 30 步' },
    rec_slice: { method: '切图', tool: 'slicer 0.9', by: 'agent:slicer', at: '11 月 20 日 15:48', params: '12 张 · 2× 导出 · 透明裁边' },
    rec_potion: { method: '手工', tool: 'Blender 4.2', by: 'agent:modeler', at: '11 月 16 日 13:20' },
    rec_hero: { method: '手工', tool: 'Blender 4.2', by: 'agent:modeler', at: '11 月 12 日 17:45' }
  };
  Object.keys(RECS).forEach(function (k) { RECS[k].id = k; });
  byPath('props/chest/chest_concept.png').origin = 'rec_concept';
  edge('props/chest/chest_turnaround.png', 'source', 'props/chest/chest_concept.png', { rec: 'rec_turn' });
  edge('props/chest/chest_high.blend', 'source', 'props/chest/chest_turnaround.png', { rec: 'rec_blend' });
  edge('props/chest/chest.glb', 'source', 'props/chest/chest_high.blend', { rec: 'rec_export' });
  [['basecolor', '基础色'], ['normal', '法线'], ['orm', 'ORM']].forEach(function (p) { edge('props/chest/chest.glb', 'uses', 'props/chest/chest_' + p[0] + '.png', { note: p[1], slot: 'chest_' + p[0] + '.png' }); });
  edge('props/chest/chest_icon.png', 'source', 'props/chest/chest.glb', { rec: 'rec_icon', stale: { by: 'user:lin', at: '11 月 24 日 16:42', note: '修正包边比例' } });
  assets.filter(function (a) { return a.folder === 'props/chest' && a.name !== 'chest.md'; }).forEach(function (a) { edge(a.path, 'belongs', 'props/chest/chest.md'); });
  edge('ui/shop/shop_mockup.png', 'source', 'ui/shop/shop_prototype.html', { rec: 'rec_mockup' });
  assets.filter(function (a) { return a.folder === 'ui/shop' && a.by === 'agent:slicer'; }).forEach(function (a) { edge(a.path, 'source', 'ui/shop/shop_mockup.png', { rec: 'rec_slice' }); });
  edge('props/potion/potion.glb', 'source', 'props/potion/potion_concept.png', { rec: 'rec_potion' });
  edge('props/potion/potion.glb', 'uses', 'props/potion/potion_basecolor.png', { note: '基础色', slot: 'potion_basecolor.png' });
  edge('props/potion/potion.glb', 'uses', 'props/potion/potion_normal.png', { note: '法线', slot: 'potion_normal.png' });
  edge('characters/hero/hero.glb', 'source', 'characters/hero/hero_concept.png', { rec: 'rec_hero' });

  /* everything around one asset, grouped the way people read it */
  function rel(a) {
    var r = { up: [], down: [], uses: [], usedBy: [], belongs: [], members: [], count: 0 };
    EDGES.forEach(function (e) {
      if (e.from === a.id) { var o = e.to ? byId(e.to) : null; r[e.type === 'source' ? 'up' : e.type === 'uses' ? 'uses' : 'belongs'].push({ e: e, a: o || null, name: o ? o.name : e.toName }); r.count++; }
      else if (e.to === a.id) { var f = byId(e.from); if (!f) return; r[e.type === 'source' ? 'down' : e.type === 'uses' ? 'usedBy' : 'members'].push({ e: e, a: f, name: f.name }); r.count++; }
    });
    return r;
  }
  function noteOf(e, inward) { if (e.type === 'source') { var rc = RECS[e.rec]; return rc ? rc.method + ' · ' + rc.by : '来源'; } if (e.type === 'uses') return (e.note || '引用') + (e.slot ? ' · ' + e.slot : '');  /* the slot name written in the file (ADR-018) */ return inward ? '归属' : '设计对象'; }
  function recordFor(a) { var e = EDGES.filter(function (x) { return x.from === a.id && x.type === 'source' && x.rec; })[0]; return e ? RECS[e.rec] : a.origin ? RECS[a.origin] : null; }
  function addRecord(r) { r.id = 'rec_new' + (++rid); RECS[r.id] = r; return r.id; }
  function addEdge(from, type, to, o) { var e = Object.assign({ id: 'e' + (++eid), from: from.id, to: to.id, toName: to.name, type: type }, live ? { at: tick(), by: window.App && App.me ? App.me() : 'user:unnamed' } : {}, o || {}); EDGES.push(e); return e; }
  var live = false;  /* edges made after load carry who and when, for the change history */
  function removeEdge(e) { var i = EDGES.indexOf(e); if (i >= 0) EDGES.splice(i, 1); return i; }
  function hasEdge(from, type, to) { return EDGES.some(function (e) { return e.from === from.id && e.to === to.id && e.type === type; }); }
  /* adding "from 由 to 产出" closes a loop when "to" already comes from "from"; returns that chain */
  function cyclePath(from, to) {
    if (from.id === to.id) return [from];
    var prev = {}, q = [to.id], seen = {}; seen[to.id] = 1;
    while (q.length) {
      var id = q.shift();
      if (id === from.id) { var p = [byId(id)]; while (prev[id]) { id = prev[id]; p.push(byId(id)); } return p; }
      EDGES.forEach(function (e) { if (e.type === 'source' && e.from === id && e.to && !seen[e.to]) { seen[e.to] = 1; prev[e.to] = id; q.push(e.to); } });
    }
    return null;
  }
  /* ── versions: every content change leaves a record; the graph can be read as of any of them ── */
  function bj(d, h, m) { return Date.UTC(2026, 10, d, h - 8, m); }
  var MD_V1 = '# 宝箱\n\n新手村第一个可以打开的容器。\n\n## 美术风格\n\n卡通、低多边形，木质箱体。\n\nbb://chest_concept.png\n\n## 规格\n\n| 项目 | 要求 |\n|---|---|\n| 三角面 | 不超过 3,000 |\n| 贴图 | 2 张 1024：basecolor、normal |\n';
  var VER = {
    'props/chest/chest.md': [[bj(17, 20, 0), 'user:lin', '初稿', { text: MD_V1, bytes: 1400, target: null }], [bj(22, 9, 15), 'user:lin', '补充规格']],
    'props/chest/chest_concept.png': [[bj(18, 14, 2), 'agent:concept-artist', 'AI 生成', { art: 'concept_v1', bytes: 1.86e6 }], [bj(18, 19, 40), 'user:lin', '锁扣与包边提亮']],
    'props/chest/chest_turnaround.png': [[bj(19, 10, 30), 'agent:concept-artist', 'AI 生成']],
    'props/chest/chest_high.blend': [[bj(20, 18, 12), 'agent:modeler', '初版'], [bj(24, 16, 30), 'user:lin', '调整包边比例']],
    'props/chest/chest_basecolor.png': [[bj(21, 9, 40), 'agent:modeler', '初版']], 'props/chest/chest_normal.png': [[bj(21, 9, 40), 'agent:modeler', '初版']], 'props/chest/chest_orm.png': [[bj(21, 9, 40), 'agent:modeler', '初版']],
    'props/chest/chest.glb': [[bj(21, 10, 5), 'agent:modeler', '初版', { variant: 'v1', tris: 2312, info: '2,312 面', bytes: 1.08e6 }], [bj(24, 16, 42), 'user:lin', '修正包边比例']],
    'props/chest/chest_icon.png': [[bj(21, 11, 5), 'agent:modeler', '渲染']],
    'props/chest/chest_open.wav': [[bj(22, 14, 0), 'user:mo', '初版']], 'props/chest/chest_open_preview.mp4': [[bj(22, 15, 30), 'user:lin', '初版']],
    'ui/shop/shop_prototype.html': [[bj(14, 15, 0), 'user:mo', '初版']], 'ui/shop/shop_mockup.png': [[bj(15, 9, 20), 'user:mo', '初版', { gap: 35 }], [bj(19, 17, 5), 'user:mo', '调整货架间距']]
  };
  /* what a version holds: the content fields a viewer reads. A version plugin keeps these; the core only keeps the record */
  var SNAP = ['art', 'variant', 'info', 'bytes', 'tris', 'w', 'h', 'text', 'gap', 'dur', 'target'];
  function snap(a) { var o = {}; SNAP.forEach(function (k) { o[k] = a[k]; }); return o; }
  assets.forEach(function (a) {
    var v = VER[a.path] || (a.folder === 'ui/shop' && a.by === 'agent:slicer' ? [[bj(20, 15, 48), 'agent:slicer', '切图']] : null);
    if (!v) return;
    var now = snap(a);
    a.versions = v.map(function (x, i) { var o = Object.assign({}, now, { bytes: Math.round(a.bytes * (0.86 + 0.14 * (i + 1) / v.length)) }, x[3] || {}); return { v: i + 1, at: x[0], by: x[1], note: x[2], size: o.bytes, o: o }; });
    a.modified = v[v.length - 1][0];
  });
  var clock = NOW;
  function tick() { clock += 60000; return clock; }
  function versions(a) { return a.versions || (a.versions = [{ v: 1, at: a.modified, by: a.by, note: '入库', size: a.bytes, o: snap(a) }]); }
  function addVersion(a, by, note) { var vs = versions(a), at = tick(); vs.push({ v: vs.length + 1, at: at, by: by, note: note, size: a.bytes, o: snap(a) }); a.modified = at; return vs[vs.length - 1]; }
  /* an asset as it was at version n (a copy; the asset itself is the current content) */
  function atVersion(a, n) { var vs = versions(a), x = typeof n === 'object' ? n : vs[(n || vs.length) - 1]; return Object.assign({}, a, x.o || {}, { ver: x.v, verOf: x, current: x === vs[vs.length - 1] }); }
  /* restoring writes the old content back as a new version; the history keeps everything */
  function restore(a, n, by) { var x = versions(a)[n - 1]; Object.assign(a, x.o); var nv = addVersion(a, by || 'user:mo', '恢复为 v' + n); nv.from = n; return nv; }
  function unrestore(a) { var vs = versions(a); vs.pop(); var last = vs[vs.length - 1]; Object.assign(a, last.o); a.modified = last.at; }
  /* tag, stage and relation changes — kept by a version plugin next to the content history */
  var META = {
    'props/chest/chest.glb': [{ at: bj(22, 10, 12), by: 'user:lin', kind: 'tag', op: '+', text: '低多边形', ai: true }, { at: bj(23, 9, 30), by: 'user:mo', kind: 'tag', op: '−', text: '临时' }, { at: bj(24, 16, 44), by: 'user:lin', kind: 'stage', text: '生产 → 运行时' }],
    'props/chest/chest_concept.png': [{ at: bj(18, 14, 3), by: 'agent:concept-artist', kind: 'tag', op: '+', text: '木质', ai: true }, { at: bj(18, 20, 2), by: 'user:lin', kind: 'review', text: '待审 → 通过' }]
  };
  function metaLog(a) {
    var vs = versions(a), t0 = vs[0].at + 60000, out = (META[a.path] || []).slice();
    a.tags.forEach(function (t) { out.push({ at: t0, by: vs[0].by, kind: 'tag', op: '+', text: t }); });
    EDGES.forEach(function (e) { if (e.from === a.id) out.push({ at: e.at || t0 + 60000, by: e.by || vs[0].by, kind: 'rel', op: '+', type: e.type, to: e.to, toName: e.toName }); });
    return out.sort(function (x, y) { return y.at - x.at; });
  }
  function verAt(a, T) { var vs = versions(a), r = null; vs.forEach(function (x) { if (x.at <= T) r = x; }); return r; }
  /* which version of the upstream a source relation pointed at, as of time T */
  function toVerAt(e, T) { var f = byId(e.from), t = e.to && byId(e.to); if (!f || !t) return null; var fv = verAt(f, T); if (!fv) return null; var ref = Math.min(T, Math.max(fv.at, e.reviewedAt || 0)); return verAt(t, ref); }
  function staleAt(e, T) { if (e.type !== 'source' || !e.to) return false; var t = byId(e.to), now = t && verAt(t, T), was = toVerAt(e, T); return !!(now && was && now.v > was.v); }
  function fmtAt(t) { var d = new Date(t + 8 * 3600000); return (d.getUTCMonth() + 1) + ' 月 ' + d.getUTCDate() + ' 日 ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  var VERSIONS = {};

  window.BBData = {
    assets: assets, EDGES: EDGES, RECS: RECS, VERSIONS: VERSIONS, NOW: NOW,
    rel: rel, noteOf: noteOf, recordFor: recordFor, addRecord: addRecord, addEdge: addEdge, removeEdge: removeEdge, hasEdge: hasEdge, cyclePath: cyclePath, byId: byId,
    versions: versions, addVersion: addVersion, atVersion: atVersion, restore: restore, unrestore: unrestore, metaLog: metaLog, goLive: function () { live = true; }, verAt: verAt, toVerAt: toVerAt, staleAt: staleAt, fmtAt: fmtAt, tick: tick,
    counts: { all: 1284, untagged: 96, pending: 42, issues: 7, trash: 12 },
    folders: [['characters', '角色', 186, [['hero', 58], ['npc', 128]]], ['props', '道具', 213, [['chest', 11], ['lantern', 1], ['potion', 34], ['weapon', 167]]], ['environments', '场景', 158, []], ['ui', '界面', 241, [['shop', 15], ['shop_v2', 5], ['hud', 82], ['icons', 144]]], ['audio', '音频', 97, [['sfx', 71], ['music', 26]]], ['vfx', '特效', 64, []], ['references', '参考', 302, [['3d-render', 124], ['photography', 96], ['illustration', 82]]], ['docs', '规范文档', 24, []]],
    smart: [{ name: '本周新增', count: 86, cond: { when: 'week' } }, { name: '运行时模型', count: 73, cond: { stage: ['runtime'], format: ['model'] } }, { name: 'AI 生成待审', count: 19, cond: { review: ['pending'], method: 'ai-generate' } }],
    /* per-folder display info, as kept in each folder's _folder.bmeta: label (display name), icon, note (= description) */
    folderMeta: {
      characters: { label: '角色' }, props: { label: '道具' }, environments: { label: '场景' }, ui: { label: '界面' }, audio: { label: '音频' }, vfx: { label: '特效' }, references: { label: '参考' },
      docs: { label: '规范文档', icon: 'file-text' },
      'props/chest': { label: '宝箱', icon: 'box', note: '新手村宝箱：原画、模型、贴图、Icon、音效' }, 'props/lantern': { label: '提灯' }
    },
    folderDefaults: { 'props/chest': { stage: 'production', exempt: false, tags: ['宝箱', '道具'] }, 'references': { stage: 'reference', exempt: true, tags: ['参考'] }, 'ui/shop': { stage: 'runtime', exempt: false, tags: ['商店'] } },
    /* the batch a reviewer "drops" in — two files share a name on purpose */
    batch: [
      { name: 'lantern_concept.png', kind: 'image', art: 'env', hue: 30, vb: [240, 135], ar: 16 / 9, info: '2048×1152', w: 2048, h: 1152, bytes: 1.8e6 },
      { name: 'lantern.glb', kind: 'model', art: 'potion', info: '1,640 面', tris: 1640, bytes: 720e3 },
      { name: 'lantern_basecolor.png', kind: 'image', art: 'basecolor', info: '1024×1024', w: 1024, h: 1024, bytes: 540e3 },
      { name: 'lantern_normal.png', kind: 'image', art: 'normal', info: '1024×1024', w: 1024, h: 1024, bytes: 790e3 },
      { name: 'icon_lantern.png', kind: 'image', art: 'ui', shape: 'coin', c: ['#ffe08a', '#f0a81c'], alpha: true, info: '256×256', w: 256, h: 256, bytes: 41e3, from: 'export/ui' },
      { name: 'icon_lantern.png', kind: 'image', art: 'ui', shape: 'gem', c: ['#ffe08a', '#e07b1a'], alpha: true, info: '512×512', w: 512, h: 512, bytes: 96e3, from: 'export/hud' },
      { name: 'lantern_basecolor.png', kind: 'image', art: 'orm', info: '2048×2048', w: 2048, h: 2048, bytes: 1.9e6, from: 'export/v2' },
      { name: 'lantern_light.wav', kind: 'audio', art: 'wave', seed: 7, info: '1.2 秒', dur: 1.2, bytes: 210e3 },
      { name: 'lantern.md', kind: 'doc', title: '提灯', excerpt: '夜间探索用的手持光源。黄铜骨架、磨砂玻璃，点亮时有暖色光晕。', bytes: 1800 }
    ],
    mk: mk
  };
  live = true;
})();
