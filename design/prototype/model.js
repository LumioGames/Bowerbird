/* Bowerbird prototype — the 3D model viewer (plugin bowerbird.model), real WebGL through three.js r128.
 * Tool bar: what changes every few seconds while checking (channel, compare mode, projection, framing).
 * On the viewport: what is manipulated in place (orbit, view cube, wipe divider, strip channels, animation).
 * Side panel: what is set once per session (environment, light, camera, structure, clip) and what is only read (info). */
(function () {
  'use strict';
  var App = window.App; if (!App || !window.THREE || !App.viewers) return;
  var T = window.THREE, B = Bowerbird, I = B.icon, H = B.html, D = App.D, S = App.S, $ = App.$, $$ = App.$$;
  var fallback = App.viewers.model[1];
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(seed) { var s = seed; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  function seg(label, items, cur, attr) { return '<div class="bb-seg" role="radiogroup" aria-label="' + label + '"' + (attr || '') + '><i class="bb-seg__thumb"></i>' + items.map(function (it) { return '<button class="bb-seg__item" role="radio" aria-checked="' + (it[0] === cur) + '" data-value="' + it[0] + '"' + (it[2] ? ' title="' + it[2] + '" aria-label="' + it[2] + '"' : '') + '>' + it[1] + '</button>'; }).join('') + '</div>'; }
  function cap(el, e) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ } }
  function sw(on, attr, label) { return '<button class="bb-switch" data-own="1" role="switch" ' + attr + ' aria-checked="' + !!on + '" aria-label="' + label + '"></button>'; }

  /* ── channels ── */
  var CH = [['full', '完整渲染'], ['base', '基础色'], ['normal', '法线'], ['rough', '粗糙度'], ['metal', '金属度'], ['ao', '环境光遮蔽'], ['emit', '自发光'], ['alpha', '透明度'], ['vcol', '顶点色'],
    ['wire', '线框'], ['wireover', '线框叠加'], ['uv', 'UV 棋盘格'], ['matcap', 'Matcap'], ['face', '面朝向'], ['density', '贴图密度']];
  var CHN = {}; CH.forEach(function (c) { CHN[c[0]] = c[1]; });
  /* a channel key can narrow to one component: 'base.r', 'normal.g', 'vcol.a'. Vertex colours show R G B A only — what each one means is not read (ADR-022) */
  var COMP = { base: [['', '全部'], ['r', 'R'], ['g', 'G'], ['b', 'B'], ['a', 'A']], normal: [['', '全部'], ['r', 'X'], ['g', 'Y'], ['b', 'Z']], emit: [['', '全部'], ['r', 'R'], ['g', 'G'], ['b', 'B']], vcol: [['', '全部'], ['r', 'R'], ['g', 'G'], ['b', 'B'], ['a', 'A']] };
  var SRC = { ao: 'R', rough: 'G', metal: 'B' };  /* packed in the ORM texture */
  function parseCh(ch) { var p = ch.split('.'); return { base: p[0], comp: p[1] || '' }; }
  function compLabel(base, comp) { var l = (COMP[base] || COMP.base).filter(function (x) { return x[0] === comp; })[0]; return l ? l[1] : comp.toUpperCase(); }
  function chName(ch) { var c = parseCh(ch); return CHN[c.base] + (c.comp ? ' · ' + compLabel(c.base, c.comp) : ''); }
  /* what the file's format plugin could not read stays clickable and says so (ADR-022: not greyed out) */
  function unread(def, key) { return !!(def && def.unread && def.unread.indexOf(parseCh(key).base) >= 0); }
  function channelMenu(cur, at, pick, def) {
    var cc = parseCh(cur);
    function choose(key) { if (unread(def, key)) return App.toast('这个格式不支持'); pick(key); }
    function item(c) {
      var k = c[0], on = cc.base === k;
      if (k === 'vcol' && !(def && def.vcol) && !unread(def, k)) return { label: c[1], check: on, kbd: '无', act: function () { choose(k); } };
      if (COMP[k]) return { label: c[1], check: on, hint: on && cc.comp ? compLabel(k, cc.comp) : '', act: function () { choose(k); },
        sub: COMP[k].map(function (x) { var key = x[0] ? k + '.' + x[0] : k; return { label: x[1], check: cur === key, act: function () { choose(key); } }; }) };
      if (SRC[k]) return { label: c[1], check: on, kbd: !unread(def, k) && def && def.tex && def.tex.some(function (t) { return /_orm\./.test(t[0]); }) ? 'ORM · ' + SRC[k] : '', act: function () { choose(k); } };
      return { label: c[1], check: on, act: function () { choose(k); } };
    }
    App.menu([{ header: '材质通道' }].concat(CH.slice(0, 9).map(item), ['sep', { header: '检查视图' }], CH.slice(9).map(item)), at);
  }

  /* ── generated textures ── */
  var TEX = {};
  function canvasTex(key, size, draw, srgb, repeat) {
    if (TEX[key]) return TEX[key];
    var c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
    var t = new T.CanvasTexture(c); if (srgb) t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); }
    return (TEX[key] = t);
  }
  function woodTex() { return canvasTex('wood', 256, function (g, n) { var r = rnd(7); g.fillStyle = '#a5672f'; g.fillRect(0, 0, n, n); for (var i = 0; i < 4; i++) { var y = i * n / 4; g.fillStyle = 'hsl(' + (24 + r() * 6) + ',56%,' + (36 + r() * 9) + '%)'; g.fillRect(0, y + 2, n, n / 4 - 2); for (var k = 0; k < 16; k++) { var yy = y + 4 + r() * (n / 4 - 8); g.strokeStyle = 'rgba(60,30,10,' + (0.12 + r() * 0.22) + ')'; g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(n * 0.3, yy + r() * 6 - 3, n * 0.6, yy + r() * 6 - 3, n, yy + r() * 4 - 2); g.stroke(); } g.fillStyle = '#3a2410'; g.fillRect(0, y, n, 2); } }, true); }
  function woodNrm() { return canvasTex('woodn', 256, function (g, n) { var r = rnd(3); g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, n, n); for (var k = 0; k < 70; k++) { g.fillStyle = 'rgba(128,' + Math.round(110 + r() * 36) + ',255,0.6)'; g.fillRect(0, r() * n, n, 1); } for (var i = 0; i < 4; i++) { var y = i * n / 4; g.fillStyle = 'rgb(128,70,225)'; g.fillRect(0, y, n, 2); g.fillStyle = 'rgb(128,190,225)'; g.fillRect(0, y + 2, n, 2); } }); }
  function woodRough() { return canvasTex('woodr', 256, function (g, n) { var r = rnd(9); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, n, n); for (var k = 0; k < 50; k++) { var v = Math.round(170 + r() * 60); g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(0, r() * n, n, 1 + r() * 3); } for (var i = 0; i < 4; i++) { g.fillStyle = '#f2f2f2'; g.fillRect(0, i * n / 4, n, 2); } }); }
  function aoTex() { return canvasTex('ao', 128, function (g, n) { var gr = g.createRadialGradient(n / 2, n / 2, n * 0.18, n / 2, n / 2, n * 0.72); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#6e6e6e'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }); }
  function checkerTex() { return canvasTex('uv', 256, function (g, n) { var c = n / 8; for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#2f3136' : 'hsl(' + (y * 42) + ',62%,' + (62 + x * 2) + '%)'; g.fillRect(x * c, y * c, c, c); } g.fillStyle = '#ffffff'; g.font = 'bold 12px sans-serif'; for (var j = 0; j < 8; j += 2) g.fillText(String.fromCharCode(65 + j) + (j + 1), j * c + 6, j * c + 18); }, true); }
  function densityTex() { return canvasTex('den', 256, function (g, n) { var c = n / 16; for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#7a7a7a' : '#e4e4e4'; g.fillRect(x * c, y * c, c, c); } }, true); }
  function matcapTex() { return canvasTex('mc', 256, function (g, n) { g.fillStyle = '#1a1b1e'; g.fillRect(0, 0, n, n); var gr = g.createRadialGradient(n * 0.36, n * 0.32, n * 0.02, n / 2, n / 2, n / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#b9bec8'); gr.addColorStop(0.8, '#4a4e57'); gr.addColorStop(1, '#202226'); g.fillStyle = gr; g.beginPath(); g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); g.fill(); }, true); }
  function missingTex() { return canvasTex('miss', 64, function (g, n) { var c = n / 8; for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#000000' : '#ff00ff'; g.fillRect(x * c, y * c, c, c); } }, true, 2); }

  /* ── materials, per channel and per part role ── */
  var ROLE = {
    wood: { c: '#b07236', r: 0.78, m: 0, tex: true }, brass: { c: '#e0b14a', r: 0.32, m: 1 }, lock: { c: '#ffe394', r: 0.26, m: 1, dense: 'high' },
    inner: { c: '#2b1a0b', r: 1, m: 0, ao: 0.3, dense: 'low' }, gold: { c: '#ffc94a', r: 0.3, m: 1, e: '#ff9a2a', ei: 1.3 },
    glass: { c: '#d7e6f2', r: 0.06, m: 0, a: 0.32 }, liquid: { c: '#e0559a', r: 0.2, m: 0 },
    cloth: { c: '#4f79c9', r: 0.9, m: 0 }, skin: { c: '#e9b48a', r: 0.7, m: 0 }, hair: { c: '#6a3b1e', r: 0.85, m: 0 },
    leather: { c: '#5a3a22', r: 0.85, m: 0 }, steel: { c: '#c3cad2', r: 0.22, m: 1 }
  };
  var MAT = {};
  function matFor(ch, role, def) {
    var key = ch + '|' + role + '|' + def.id + '|' + (def.woodTint || '') + (def.missing ? '|m' : ''); if (MAT[key]) return MAT[key];
    var R = Object.assign({}, ROLE[role]); if (def.tint && def.tint[role]) R.c = def.tint[role];
    var miss = def.missing && def.missing.role === role, col = new T.Color(R.c), m, pc = parseCh(ch);
    function gray(v) { return new T.MeshBasicMaterial({ color: new T.Color(v, v, v), toneMapped: false }); }
    switch (pc.base) {
      case 'full': m = new T.MeshStandardMaterial({ color: miss ? 0xffffff : R.tex ? (def.woodTint && role === 'wood' ? new T.Color(def.woodTint) : 0xffffff) : col, map: miss ? missingTex() : R.tex ? woodTex() : null, normalMap: R.tex ? woodNrm() : null, roughness: R.r, metalness: R.m, emissive: R.e ? new T.Color(R.e) : new T.Color(0), emissiveIntensity: R.ei || 0, transparent: R.a != null, opacity: R.a != null ? R.a : 1, depthWrite: R.a == null }); break;
      case 'base': m = new T.MeshBasicMaterial({ color: miss ? 0xffffff : R.tex ? (def.woodTint && role === 'wood' ? new T.Color(def.woodTint) : 0xffffff) : col, map: miss ? missingTex() : R.tex ? woodTex() : null, toneMapped: false, transparent: R.a != null, opacity: R.a != null ? 0.55 : 1, depthWrite: R.a == null }); break;
      case 'normal': m = new T.MeshNormalMaterial({ normalMap: R.tex ? woodNrm() : null }); break;
      case 'rough': m = R.tex ? new T.MeshBasicMaterial({ map: woodRough(), toneMapped: false }) : gray(R.r); break;
      case 'metal': m = gray(R.m); break;
      case 'ao': m = new T.MeshBasicMaterial({ map: aoTex(), color: new T.Color(R.ao || 1, R.ao || 1, R.ao || 1), toneMapped: false }); break;
      case 'emit': m = new T.MeshBasicMaterial({ color: R.e ? new T.Color(R.e).multiplyScalar(R.ei) : new T.Color(0), toneMapped: false }); break;
      case 'alpha': m = gray(R.a != null ? R.a : 1); break;
      case 'vcol': m = def.vcol ? new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }) : gray(1); break;
      case 'wire': m = new T.MeshBasicMaterial({ color: 0xc9d1dc, wireframe: true, toneMapped: false }); break;
      case 'wireov': m = new T.MeshBasicMaterial({ color: 0x0b0c0e, wireframe: true, transparent: true, opacity: 0.8, toneMapped: false }); break;
      case 'uv': m = new T.MeshBasicMaterial({ map: checkerTex(), toneMapped: false }); break;
      case 'matcap': m = new T.MeshMatcapMaterial({ matcap: matcapTex() }); break;
      case 'face':
        m = new T.MeshBasicMaterial({ side: T.DoubleSide, toneMapped: false });
        m.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor = gl_FrontFacing ? vec4(0.24, 0.47, 0.92, 1.0) : vec4(0.9, 0.27, 0.22, 1.0);'); };
        break;
      default: m = new T.MeshBasicMaterial({ map: densityTex(), color: R.dense === 'high' ? 0xff8a7a : R.dense === 'low' ? 0x7aa7ff : 0x9be28a, toneMapped: false });
    }
    /* one component, shown as gray: append to the end of main() so it works for any material */
    if (pc.comp) {
      var cmp = pc.comp;
      m.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace(/}\s*$/, '  gl_FragColor = vec4(vec3(gl_FragColor.' + cmp + '), 1.0);\n}'); };
      m.customProgramCacheKey = function () { return 'comp-' + cmp; };
      m.transparent = false; m.depthWrite = true; m.opacity = cmp === 'a' ? m.opacity : 1;
    }
    return (MAT[key] = m);
  }

  /* ── sample models, built from primitives ── */
  function box(w, h, d, x, y, z) { var g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
  function kit() {
    var root = new T.Group(), parts = {};
    return { root: root, parts: parts, add: function (parent, g, role, part) { var m = new T.Mesh(g); m.userData.role = role; m.userData.part = part; m.castShadow = true; m.receiveShadow = true; parent.add(m); (parts[part] = parts[part] || []).push(m); return m; } };
  }
  /* sample vertex colours: whatever the artist packed in R G B — the viewer only shows the numbers */
  function paintVcol(root) {
    root.updateMatrixWorld(true); var p3 = new T.Vector3();
    root.traverse(function (m) {
      if (!m.isMesh) return; var g = m.geometry, pos = g.attributes.position, n = pos.count, c0 = new Float32Array(n * 3), wood = m.userData.role === 'wood' || m.userData.role === 'cloth';
      for (var i = 0; i < n; i++) {
        p3.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        var dirt = clamp(1 - p3.y / 0.42, 0, 1), h = Math.sin(p3.x * 12.9898 + p3.z * 78.233 + p3.y * 37.719) * 43758.5453; h -= Math.floor(h);
        c0[i * 3] = dirt * dirt; c0[i * 3 + 1] = wood ? h * 0.85 : 0.15 + h * 0.5; c0[i * 3 + 2] = wood ? clamp((p3.y - 0.6) * 2.6 + (p3.z < 0 ? 0.25 : 0), 0, 1) : 0;
      }
      g.userData.vc = new T.BufferAttribute(c0, 3);
    });
  }
  function halfLid(r, len, x, y, z, k) { var g = new T.CylinderGeometry(r, r, len, 10, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.scale(1, k, 1); g.translate(x, y, z); return g; }
  function buildChest(def) {
    var K = kit(), root = K.root, bw = (def && def.band) || 0.1;  /* trim width: v1 had it too heavy */
    K.add(root, box(1.2, 0.55, 0.8, 0, 0.315, 0), 'wood', 'body');
    K.add(root, box(1.26, 0.06, 0.86, 0, 0.03, 0), 'brass', 'body');
    K.add(root, box(1.1, 0.006, 0.7, 0, 0.592, 0), 'inner', 'body');
    [-0.38, 0.38].forEach(function (x) { K.add(root, box(bw, 0.57, 0.82, x, 0.315, 0), 'brass', 'bands'); });
    K.add(root, box(0.16, 0.2, 0.04, 0, 0.47, 0.42), 'lock', 'lock');
    var r = rnd(5);
    for (var i = 0; i < 16; i++) { var c = new T.CylinderGeometry(0.07, 0.07, 0.02, 12); c.rotateX((r() - 0.5) * 0.7); c.rotateZ((r() - 0.5) * 0.7); c.translate(-0.42 + r() * 0.84, 0.61 + r() * 0.04, -0.24 + r() * 0.48); K.add(root, c, 'gold', 'gold'); }
    var hinge = new T.Group(); hinge.position.set(0, 0.59, -0.4); root.add(hinge);
    K.add(hinge, box(1.2, 0.1, 0.8, 0, 0.05, 0.4), 'wood', 'lid');
    K.add(hinge, halfLid(0.4, 1.2, 0, 0.1, 0.4, 0.62), 'wood', 'lid');
    [-0.38, 0.38].forEach(function (x) { K.add(hinge, box(bw, 0.11, 0.82, x, 0.05, 0.4), 'brass', 'bands'); K.add(hinge, halfLid(0.42, bw, x, 0.1, 0.4, 0.62), 'brass', 'bands'); });
    var tip = new T.Object3D(); tip.position.set(0, 0.2, 0.8); hinge.add(tip);
    return {
      root: root, parts: K.parts,
      partList: [['body', '箱体', 620], ['lid', '箱盖', 860], ['bands', '包边', 540], ['lock', '锁扣', 140], ['gold', '金币', 320]],
      material: 'M_Chest', clips: [{ id: 'open', dur: 0.8 }],
      anim: function (clip, t) { var k = clamp(t / 0.8, 0, 1); k = 1 - Math.pow(1 - k, 3); hinge.rotation.x = -1.95 * k; },
      bones: function () { return [[root, hinge], [hinge, tip]]; }
    };
  }
  function buildBottle() {
    var K = kit(), root = K.root, V = function (p) { return p.map(function (q) { return new T.Vector2(q[0], q[1]); }); };
    var liquid = K.add(root, new T.LatheGeometry(V([[0, 0.03], [0.24, 0.04], [0.33, 0.15], [0.34, 0.3], [0, 0.3]]), 20), 'liquid', 'liquid');
    var glass = K.add(root, new T.LatheGeometry(V([[0, 0], [0.26, 0.02], [0.36, 0.14], [0.38, 0.34], [0.3, 0.52], [0.12, 0.62], [0.11, 0.78], [0.13, 0.8], [0, 0.8]]), 20), 'glass', 'glass');
    glass.renderOrder = 2; liquid.renderOrder = 1;
    var cork = new T.CylinderGeometry(0.1, 0.09, 0.12, 12); cork.translate(0, 0.85, 0); K.add(root, cork, 'wood', 'cork');
    return { root: root, parts: K.parts, partList: [['glass', '瓶身', 640], ['liquid', '药水', 360], ['cork', '瓶塞', 120]], material: 'M_Potion', clips: [], anim: function () {}, bones: function () { return []; } };
  }
  function buildHero() {
    var K = kit(), root = K.root, piv = function (x, y, z) { var g = new T.Group(); g.position.set(x, y, z); root.add(g); return g; };
    var hips = piv(0, 0.52, 0), legL = piv(-0.1, 0.5, 0), legR = piv(0.1, 0.5, 0), armL = piv(-0.27, 0.98, 0), armR = piv(0.27, 0.98, 0), chest = piv(0, 0.56, 0);
    [legL, legR].forEach(function (l) { K.add(l, box(0.14, 0.48, 0.16, 0, -0.25, 0), 'leather', 'legs'); });
    K.add(chest, box(0.42, 0.48, 0.24, 0, 0.22, 0), 'cloth', 'torso'); K.add(chest, box(0.44, 0.06, 0.26, 0, 0, 0), 'brass', 'torso');
    var head = new T.Group(); head.position.set(0, 0.5, 0); chest.add(head);
    K.add(head, box(0.3, 0.3, 0.28, 0, 0.15, 0), 'skin', 'head'); K.add(head, box(0.32, 0.12, 0.3, 0, 0.3, -0.01), 'hair', 'head');
    [armL, armR].forEach(function (a) { K.add(a, box(0.12, 0.44, 0.14, 0, -0.21, 0), 'cloth', 'arms'); K.add(a, box(0.11, 0.1, 0.12, 0, -0.47, 0), 'skin', 'arms'); });
    var hand = [new T.Object3D(), new T.Object3D()]; hand[0].position.set(0, -0.47, 0); hand[1].position.set(0, -0.47, 0); armL.add(hand[0]); armR.add(hand[1]);
    var foot = [new T.Object3D(), new T.Object3D()]; foot[0].position.set(0, -0.48, 0); foot[1].position.set(0, -0.48, 0); legL.add(foot[0]); legR.add(foot[1]);
    var top = new T.Object3D(); top.position.set(0, 0.3, 0); head.add(top);
    return {
      root: root, parts: K.parts, partList: [['head', '头部', 2100], ['torso', '躯干', 2400], ['arms', '手臂', 1800], ['legs', '腿', 2612]], material: 'M_Character',
      clips: [{ id: 'idle', dur: 2 }, { id: 'walk', dur: 1 }],
      anim: function (clip, t) {
        var w = clip && clip.id === 'walk', s = Math.sin(t / (clip ? clip.dur : 1) * Math.PI * 2);
        legL.rotation.x = w ? s * 0.55 : 0; legR.rotation.x = w ? -s * 0.55 : 0; armL.rotation.x = w ? -s * 0.5 : s * 0.04; armR.rotation.x = w ? s * 0.5 : -s * 0.04;
        chest.position.y = 0.56 + (w ? Math.abs(s) * 0.02 : s * 0.008); head.rotation.y = w ? 0 : s * 0.08;
      },
      bones: function () { return [[hips, chest], [chest, head], [head, top], [chest, armL], [armL, hand[0]], [chest, armR], [armR, hand[1]], [hips, legL], [legL, foot[0]], [hips, legR], [legR, foot[1]]]; }
    };
  }
  function buildSword() {
    var K = kit(), root = K.root;
    K.add(root, box(0.08, 0.9, 0.02, 0, 0.78, 0), 'steel', 'blade');
    var tip = new T.ConeGeometry(0.057, 0.12, 4); tip.rotateY(Math.PI / 4); tip.scale(1, 1, 0.35); tip.translate(0, 1.29, 0); K.add(root, tip, 'steel', 'blade');
    K.add(root, box(0.36, 0.06, 0.08, 0, 0.31, 0), 'brass', 'guard');
    var grip = new T.CylinderGeometry(0.035, 0.035, 0.24, 10); grip.translate(0, 0.16, 0); K.add(root, grip, 'leather', 'grip');
    var pom = new T.SphereGeometry(0.05, 10, 8); pom.translate(0, 0.02, 0); K.add(root, pom, 'brass', 'guard');
    return { root: root, parts: K.parts, partList: [['blade', '刀刃', 1640], ['guard', '护手', 1420], ['grip', '握柄', 800]], material: 'M_Sword', clips: [], anim: function () {}, bones: function () { return []; } };
  }
  function slotAsset(a, slot) { var e = D.EDGES.filter(function (x) { return x.from === a.id && x.slot === slot; })[0]; if (!e) return undefined; return e.to ? (App.byId(e.to) || null) : null; }
  /* channels the format plugin could not read from this file (e.g. an FBX without roughness) ride along from the asset */
  function defFor(a) { var d = defBase(a); if (a.unread) d.unread = a.unread; return d; }
  function defBase(a) {
    var n = a.name;
    /* the base colour comes through the slot relation recorded in the .bmeta, not the name inside the file (ADR-018) */
    if (/chest/.test(n)) { var sl = slotAsset(a, 'chest_basecolor.png'); return { id: 'chest', build: buildChest, woodTint: sl ? sl.woodTint || null : null, missing: sl === null ? { role: 'wood', file: 'chest_basecolor.png' } : null, vcol: true, band: a.variant === 'v1' ? 0.18 : 0.1, tex: [['chest_basecolor.png', '基础色'], ['chest_normal.png', '法线'], ['chest_orm.png', '遮蔽 · 粗糙 · 金属']] }; }
    if (/potion/.test(n)) { var sp = slotAsset(a, 'potion_basecolor.png'); return { id: 'potion', build: buildBottle, missing: sp ? null : { role: 'liquid', file: 'potion_basecolor.png' }, tex: [['potion_basecolor.png', '基础色'], ['potion_normal.png', '法线']] }; }
    if (/lantern/.test(n)) return { id: 'lantern', build: buildBottle, tint: { liquid: '#ffcf5a', glass: '#f2e6c8', wood: '#7a4a1f' }, tex: [['lantern_basecolor.png', '基础色'], ['lantern_normal.png', '法线']] };
    if (/sword/.test(n)) return { id: 'sword', build: buildSword, tex: [['sword_basecolor.png', '基础色'], ['sword_orm.png', '遮蔽 · 粗糙 · 金属']] };
    if (/merchant/.test(n)) return { id: 'merchant', build: buildHero, tint: { cloth: '#b5533f', hair: '#3b3b4a' }, tex: [['npc_merchant_basecolor.png', '基础色']] };
    if (/guard/.test(n)) return { id: 'guard', build: buildHero, tint: { cloth: '#5a6b7a', hair: '#2a2a2a' }, tex: [['npc_guard_basecolor.png', '基础色']] };
    return { id: 'hero', build: buildHero, vcol: true, tex: [['hero_basecolor.png', '基础色'], ['hero_normal.png', '法线']] };
  }

  /* ── environments: four built in, plus HDR files from the library ── */
  var ENVS = [
    { id: 'studio', name: '工作室', sky: ['#7b818a', '#1d1f23'], lights: [['#ffffff', 11, [2, 2.4, 2]], ['#fff1dd', 6, [-2.6, 1.4, 1.2]], ['#dfe8ff', 3, [-1, 1.2, -3]]] },
    { id: 'sunset', name: '日落', sky: ['#ffb27a', '#3a2340'], lights: [['#ffbf80', 18, [3, 0.8, 1]], ['#ffd0a0', 5, [-1, 2.5, 2]], ['#7a6cff', 3, [-2, 2, -2]]] },
    { id: 'overcast', name: '阴天', sky: ['#d5dbe2', '#6b7380'], lights: [['#ffffff', 7, [0, 4, 0.5]], ['#eef2f6', 3, [2, 1, 2]]] },
    { id: 'night', name: '夜晚', sky: ['#22345a', '#05070d'], lights: [['#8fb4ff', 10, [-2, 2, -2]], ['#ffd59a', 6, [2, 0.6, 2]]] }
  ];
  function envOf(id) {
    var e = ENVS.filter(function (x) { return x.id === id; })[0]; if (e) return e;
    var a = App.byId(id); return a ? { id: id, name: a.name, sky: a.sky || ['#9fc6ff', '#3d4f3a'], lights: [['#fff4dc', 6, [1.5, 3, 1]]] } : ENVS[0];
  }
  function grad(e) { return 'linear-gradient(' + e.sky[0] + ', ' + e.sky[1] + ')'; }

  /* split views are drawn into offscreen targets, then composited along a wipe line or slanted strips */
  var FRAG = [
    'uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2; uniform sampler2D t3;',
    'uniform int mode; uniform int n; uniform vec2 p; uniform float ang; uniform float slope; uniform vec2 res; uniform float lw;',
    'varying vec2 vUv;',
    'vec4 pick(int i) { if (i == 0) return texture2D(t0, vUv); if (i == 1) return texture2D(t1, vUv); if (i == 2) return texture2D(t2, vUv); return texture2D(t3, vUv); }',
    'void main() {',
    '  vec2 px = vec2(vUv.x * res.x, (1.0 - vUv.y) * res.y); vec4 c; float d;',
    '  if (mode == 1) { vec2 nr = vec2(cos(ang), sin(ang)); float s = dot(px - p, nr); c = s < 0.0 ? texture2D(t0, vUv) : texture2D(t1, vUv); d = abs(s); }',
    '  else { float x = (px.x + (px.y - res.y * 0.5) * slope) / res.x * float(n); int i = int(clamp(floor(x), 0.0, float(n - 1))); c = pick(i); float f = fract(x); d = (x < 0.5 || x > float(n) - 0.5) ? 1000.0 : min(f, 1.0 - f) * res.x / float(n) / sqrt(1.0 + slope * slope); }',
    '  float line = 1.0 - smoothstep(lw * 0.5, lw * 0.5 + 1.0, d);',
    '  gl_FragColor = mix(c, vec4(1.0), line * 0.9);',
    '}'].join('\n');
  var SLOPE = Math.tan(22 * Math.PI / 180), PANEL_W = 272, LOADED = {}, PANEL_PREF = false;

  function modelViewer(v, a) {
    var compact = !!v.opts.compact, def = defFor(a), renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return fallback(v, a); }
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = 1, Hh = 1;
    renderer.setPixelRatio(dpr); renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.setClearColor(0x000000, 0);
    var scene = new T.Scene(), M = def.build(def), root = M.root; scene.add(root); if (def.vcol) paintVcol(root);
    var meshes = []; root.traverse(function (o) { if (o.isMesh) meshes.push(o); });
    var bb = new T.Box3().setFromObject(root), size = bb.getSize(new T.Vector3()), center = bb.getCenter(new T.Vector3()), R0 = Math.max(size.x, size.y, size.z) * 3.3;
    var persp = new T.PerspectiveCamera(35, 1, 0.01, 100), ortho = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    var key = new T.DirectionalLight(0xffffff, 1.8); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0008; key.shadow.radius = 3;
    var sc = key.shadow.camera; sc.left = sc.bottom = -2; sc.right = sc.top = 2; sc.near = 0.1; sc.far = 14; key.target.position.copy(center); scene.add(key); scene.add(key.target);
    var ground = new T.Mesh(new T.PlaneGeometry(10, 10), new T.ShadowMaterial({ opacity: 0.34 })); ground.rotation.x = -Math.PI / 2; ground.position.y = bb.min.y; ground.receiveShadow = true; scene.add(ground);
    var grid = new T.GridHelper(4, 40, 0x9aa0aa, 0x9aa0aa); grid.material.transparent = true; grid.material.opacity = 0.25; grid.position.y = bb.min.y + 0.001; scene.add(grid);
    var boxh = new T.Box3Helper(bb, new T.Color(0x8db4ff)); scene.add(boxh);
    var skelGeo = new T.BufferGeometry(), skel = new T.LineSegments(skelGeo, new T.LineBasicMaterial({ color: 0xffd166, depthTest: false, transparent: true, toneMapped: false }));
    var joints = new T.Points(skelGeo, new T.PointsMaterial({ color: 0xffd166, size: 7, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false })); skel.renderOrder = joints.renderOrder = 9; scene.add(skel); scene.add(joints);
    var st = {
      mode: 'single', ch: 'full', wipe: { ch: ['normal', 'base'], x: 0.5, y: 0.5, ang: 0 }, strips: ['full', 'base', 'normal'],
      env: 'studio', envRot: 0, exp: 0, bg: 'env', bgColor: '#2a2c31', light: true, az: 40, el: 42, shadow: true,
      ortho: false, fov: 35, ground: true, grid: false, dims: !compact, skel: false, turn: compact, hidden: {}, solo: null,
      clip: M.clips[0] || null, t: 0, play: false, loop: true, speed: 1, panel: false
    };
    var orb = { th: 0.62, ph: 1.12, r: R0, tr: R0, vth: 0, vph: 0, vr: 0, goal: null, target: center.clone(), drag: null }, PH0 = 0.06, PH1 = Math.PI - 0.06, Wn = 2 * Math.PI / 0.42;
    var pw = 0, dirty = true, raf = 0, last = performance.now(), loading = false;

    /* DOM: viewport with its overlays */
    v.stage.innerHTML = '<div class="mv3' + (compact ? ' mv3--compact' : '') + '"><div class="mv3__dims"></div><div class="mv3__ui"></div><svg class="mv-gizmo" viewBox="0 0 72 72" aria-label="视图方向"></svg><div class="mv-panel" data-closed></div></div>';
    var view = $('.mv3', v.stage), canvas = renderer.domElement, ui = $('.mv3__ui', view), giz = $('.mv-gizmo', view), panel = $('.mv-panel', view), dims = $('.mv3__dims', view);
    view.insertBefore(canvas, view.firstChild);

    /* ── environment ── */
    var pmrem = new T.PMREMGenerator(renderer), envRT = null, envTimer = 0;
    function makeEnv() {
      var e = envOf(st.env), es = new T.Scene(), geo = new T.SphereGeometry(20, 32, 16), pos = geo.attributes.position, cols = [], top = new T.Color(e.sky[0]), bot = new T.Color(e.sky[1]);
      for (var i = 0; i < pos.count; i++) { var k = clamp(pos.getY(i) / 40 + 0.5, 0, 1), c = bot.clone().lerp(top, k); cols.push(c.r, c.g, c.b); }
      geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      es.add(new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
      e.lights.forEach(function (l) { var p = new T.Mesh(new T.PlaneGeometry(5, 5), new T.MeshBasicMaterial({ color: new T.Color(l[0]).multiplyScalar(l[1]), side: T.DoubleSide })), an = Math.atan2(l[2][0], l[2][2]) + st.envRot * Math.PI / 180, rr = Math.hypot(l[2][0], l[2][2]); p.position.set(Math.sin(an) * rr * 3, l[2][1] * 3, Math.cos(an) * rr * 3); p.lookAt(0, 0, 0); es.add(p); });
      var next = pmrem.fromScene(es, 0.03); if (envRT) envRT.dispose(); envRT = next; scene.environment = envRT.texture;
      es.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      paintBg(); dirty = true;
    }
    function paintBg() { var e = envOf(st.env); view.style.background = st.bg === 'env' ? grad(e) : st.bg === 'color' ? st.bgColor : ''; view.classList.toggle('bg-checker', st.bg === 'none'); }
    function lightPos() { var az = st.az * Math.PI / 180, el = st.el * Math.PI / 180; key.position.set(center.x + Math.sin(az) * Math.cos(el) * 5, center.y + Math.sin(el) * 5, center.z + Math.cos(az) * Math.cos(el) * 5); dirty = true; }

    /* ── camera ── */
    function cam() { return st.ortho ? ortho : persp; }
    function placeCam() {
      var c = cam(), sp = Math.sin(orb.ph), asp = W / Hh;
      c.position.set(orb.target.x + orb.r * sp * Math.sin(orb.th), orb.target.y + orb.r * Math.cos(orb.ph), orb.target.z + orb.r * sp * Math.cos(orb.th));
      c.up.set(0, 1, 0); c.lookAt(orb.target);
      if (st.ortho) { var hh = orb.r * Math.tan(st.fov * Math.PI / 360); ortho.left = -hh * asp; ortho.right = hh * asp; ortho.top = hh; ortho.bottom = -hh; }
      else { persp.fov = st.fov; persp.aspect = asp; }
      if (pw > 0.5) c.setViewOffset(W, Hh, pw / 2, 0, W, Hh); else c.clearViewOffset();
      c.updateProjectionMatrix();
    }
    function spring(k, g, dt) { var v = 'v' + k, h = dt / 4; for (var i = 0; i < 4; i++) { orb[v] += (-Wn * Wn * (orb[k] - g) - 2 * Wn * orb[v]) * h; orb[k] += orb[v] * h; } }
    function wrap(x) { return Math.atan2(Math.sin(x), Math.cos(x)); }
    var VIEWS = { z: [0, Math.PI / 2, '正视图'], '-z': [Math.PI, Math.PI / 2, '后视图'], x: [Math.PI / 2, Math.PI / 2, '右视图'], '-x': [-Math.PI / 2, Math.PI / 2, '左视图'], y: [null, 0.0012, '顶视图'], '-y': [null, Math.PI - 0.0012, '底视图'] };
    function setView(k) { var vw = VIEWS[k], th = vw[0] == null ? orb.th : orb.th + wrap(vw[0] - orb.th); orb.goal = { th: th, ph: vw[1] }; orb.vth = orb.vph = 0; st.turn = false; syncBar(); }
    function frameAll() { orb.target.copy(center); orb.tr = R0; orb.goal = { th: orb.th + wrap(0.62 - orb.th), ph: 1.12 }; }

    /* ── rendering ── */
    var rts = [], quad = new T.Scene(), qcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var comp = new T.ShaderMaterial({ uniforms: { t0: { value: null }, t1: { value: null }, t2: { value: null }, t3: { value: null }, mode: { value: 1 }, n: { value: 2 }, p: { value: new T.Vector2() }, ang: { value: 0 }, slope: { value: SLOPE }, res: { value: new T.Vector2() }, lw: { value: 1.5 } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FRAG, depthTest: false, depthWrite: false, transparent: true });
    quad.add(new T.Mesh(new T.PlaneGeometry(2, 2), comp));
    function rt(i) { if (!rts[i]) { rts[i] = new T.WebGLRenderTarget(W * dpr, Hh * dpr); rts[i].texture.encoding = T.sRGBEncoding; } return rts[i]; }
    function apply(ch) {
      var shaded = ch === 'full' || ch === 'wireover', pc = parseCh(ch);
      meshes.forEach(function (m) { var vc = m.geometry.userData.vc; if (vc && pc.base === 'vcol') m.geometry.setAttribute('color', vc); m.material = matFor(ch === 'wireover' ? 'full' : ch, m.userData.role, def); m.visible = !loading && !st.hidden[m.userData.part] && (!st.solo || st.solo === m.userData.part); });
      key.visible = shaded && st.light; ground.visible = shaded && st.ground && st.light && st.shadow; key.castShadow = st.shadow;
      grid.visible = st.grid && !loading; boxh.visible = st.dims && !compact && !loading; skel.visible = joints.visible = st.skel && !loading;
    }
    function pass(ch, c) {
      apply(ch); renderer.render(scene, c);
      if (ch === 'wireover') { meshes.forEach(function (m) { m.material = matFor('wireov', m.userData.role, def); }); ground.visible = false; renderer.autoClear = false; renderer.render(scene, c); renderer.autoClear = true; }
    }
    function render() {
      placeCam(); var c = cam(); renderer.toneMappingExposure = Math.pow(2, st.exp);
      if (st.skel) { var bs = M.bones(), arr = []; root.updateMatrixWorld(true); bs.forEach(function (b) { var p = b[0].getWorldPosition(new T.Vector3()), q = b[1].getWorldPosition(new T.Vector3()); arr.push(p.x, p.y, p.z, q.x, q.y, q.z); }); skelGeo.setAttribute('position', new T.Float32BufferAttribute(arr, 3)); }
      if (st.mode === 'single' || compact) { renderer.setRenderTarget(null); pass(st.ch, c); }
      else {
        var list = st.mode === 'wipe' ? st.wipe.ch : st.strips;
        list.forEach(function (ch, i) { renderer.setRenderTarget(rt(i)); pass(ch, c); comp.uniforms['t' + i].value = rts[i].texture; });
        renderer.setRenderTarget(null); renderer.clear();
        var u = comp.uniforms; u.mode.value = st.mode === 'wipe' ? 1 : 2; u.n.value = list.length; u.res.value.set(W, Hh); u.p.value.set(st.wipe.x * W, st.wipe.y * Hh); u.ang.value = st.wipe.ang;
        renderer.render(quad, qcam);
      }
      drawGizmo(); placeOverlays(); placeDims();
    }
    function loop(now) {
      var dt = Math.min(0.05, (now - last) / 1000), moving = false; last = now;
      if (st.play && st.clip) { var t = st.t + dt * st.speed; if (t >= st.clip.dur) { if (st.loop) t %= st.clip.dur; else { t = st.clip.dur; st.play = false; syncTl(); } } st.t = t; M.anim(st.clip, t); syncTime(); moving = true; }
      if (!orb.drag) {
        if (orb.goal) { spring('th', orb.goal.th, dt); spring('ph', orb.goal.ph, dt); moving = true; if (Math.abs(orb.th - orb.goal.th) < 1e-4 && Math.abs(orb.ph - orb.goal.ph) < 1e-4 && Math.abs(orb.vth) + Math.abs(orb.vph) < 1e-3) { orb.th = orb.goal.th; orb.ph = orb.goal.ph; orb.goal = null; orb.vth = orb.vph = 0; } }
        else {
          if (Math.abs(orb.vth) + Math.abs(orb.vph) > 1e-3) { var k = Math.exp(-dt * 4.5); orb.th += orb.vth * dt; orb.ph += orb.vph * dt; orb.vth *= k; orb.vph *= k; moving = true; }
          if (orb.ph < PH0 || orb.ph > PH1) { orb.vph = 0; orb.ph += (clamp(orb.ph, PH0, PH1) - orb.ph) * (1 - Math.exp(-dt * 16)); moving = true; }
          if (st.turn) { orb.th += dt * 0.45; moving = true; }
        }
        if (Math.abs(orb.r - orb.tr) > 1e-4 || Math.abs(orb.vr) > 1e-4) { spring('r', orb.tr, dt); moving = true; }
      }
      var pwT = st.panel ? PANEL_W : 0; if (Math.abs(pw - pwT) > 0.5) { pw += (pwT - pw) * (1 - Math.exp(-dt * 12)); moving = true; } else if (pw !== pwT) { pw = pwT; moving = true; }
      if (moving || dirty) { dirty = false; render(); }
      raf = requestAnimationFrame(loop);
    }
    function resize() {
      W = Math.max(1, view.clientWidth); Hh = Math.max(1, view.clientHeight); renderer.setSize(W, Hh, false);
      rts.forEach(function (r) { r.setSize(W * dpr, Hh * dpr); }); dirty = true;
    }

    /* ── view cube: six axis ends, the near ones on top; click one to look along it ── */
    var AX = [['x', 1, 0, 0, 'X', 'var(--axis-x)'], ['-x', -1, 0, 0, '', 'var(--axis-x)'], ['y', 0, 1, 0, 'Y', 'var(--axis-y)'], ['-y', 0, -1, 0, '', 'var(--axis-y)'], ['z', 0, 0, 1, 'Z', 'var(--axis-z)'], ['-z', 0, 0, -1, '', 'var(--axis-z)']];
    function drawGizmo() {
      if (compact) return;
      var q = cam().quaternion.clone().invert(), items = AX.map(function (x) { var p = new T.Vector3(x[1], x[2], x[3]).applyQuaternion(q); return { x: x, sx: 36 + p.x * 25, sy: 36 - p.y * 25, z: p.z }; }).sort(function (m, n) { return m.z - n.z; });
      giz.innerHTML = '<circle cx="36" cy="36" r="34" class="mv-gizmo__bg"/>' + items.map(function (it) {
        var pos = it.x[4], col = it.x[5];
        return (pos ? '<line x1="36" y1="36" x2="' + it.sx.toFixed(1) + '" y2="' + it.sy.toFixed(1) + '" stroke="' + col + '" stroke-width="2"/>' : '') +
          '<g class="mv-gizmo__end" data-view="' + it.x[0] + '"><title>' + VIEWS[it.x[0]][2] + '</title><circle cx="' + it.sx.toFixed(1) + '" cy="' + it.sy.toFixed(1) + '" r="' + (pos ? 8 : 6) + '" fill="' + (pos ? col : 'var(--surface-raised)') + '" stroke="' + col + '" stroke-width="2"/>' + (pos ? '<text x="' + it.sx.toFixed(1) + '" y="' + (it.sy + 3.5).toFixed(1) + '">' + pos + '</text>' : '') + '</g>';
      }).join('');
    }
    giz.addEventListener('click', function (e) { var g = e.target.closest('[data-view]'); if (g) setView(g.getAttribute('data-view')); });

    /* ── overlays: wipe divider, strip channels, animation bar, notices ── */
    function chip(label, attr, x) { return '<button class="mv-chip" ' + attr + '>' + esc(label) + I('chevron-down', 'bb-icon--12') + (x ? '<i class="mv-chip__x" data-strip-x="' + x + '" aria-label="移除这一路">' + I('x', 'bb-icon--12') + '</i>' : '') + '</button>'; }
    function buildUi() {
      var s = '';
      if (!compact && st.mode === 'wipe') s += '<div class="mv-wipe"><i class="mv-wipe__hit" data-drag="move"></i><i class="mv-wipe__knob" data-drag="move" title="拖动分界线">' + I('chevron-left', 'bb-icon--12') + I('chevron-right', 'bb-icon--12') + '</i><i class="mv-wipe__rot" data-drag="rot" title="拖动旋转分界线，双击复位">' + I('refresh-cw', 'bb-icon--12') + '</i>' + chip(chName(st.wipe.ch[0]), 'data-region="0"') + chip(chName(st.wipe.ch[1]), 'data-region="1"') + '</div>';
      if (!compact && st.mode === 'strips') s += '<div class="mv-strips">' + st.strips.map(function (c, i) { return chip(chName(c), 'data-strip="' + i + '"', st.strips.length > 2 ? String(i) : ''); }).join('') + (st.strips.length < 4 ? '<button class="mv-chip mv-chip--add" data-strip-add aria-label="增加一路" title="增加一路">' + I('plus', 'bb-icon--12') + '</button>' : '') + '</div>';
      if (!compact && M.clips.length) s += '<div class="mv-tl"><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-m="play" aria-label="播放" title="播放 空格"></button><button class="mv-tl__clip" data-m="clip">' + esc(st.clip.id) + I('chevron-down', 'bb-icon--12') + '</button><input class="bb-slider" type="range" min="0" max="1000" value="0" aria-label="时间轴"><span class="vw__num" data-time></span><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-m="loop" aria-pressed="' + st.loop + '" aria-label="循环" title="循环">' + I('repeat', 'bb-icon--12') + '</button></div>';
      if (!compact && def.missing) s += '<div class="mv-note mv-note--error">' + I('unlink', 'bb-icon--12') + '<span>缺少 <b class="text-mono-sm">' + def.missing.file + '</b></span><button class="bb-btn bb-btn--sm" data-m="issue">查看问题</button></div>';
      else if (!compact && st.mode === 'single' && parseCh(st.ch).base === 'vcol' && !def.vcol) s += '<div class="mv-note">无顶点色</div>';
      if (loading) s += '<div class="mv-load"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" class="mv-load__bg"/><circle cx="20" cy="20" r="16" class="mv-load__fg" data-ring/></svg><span class="vw__num" data-bytes></span></div>';
      ui.innerHTML = s; view.classList.toggle('split', !compact && st.mode !== 'single');
      var sl = $('.mv-tl .bb-slider', ui); if (sl) B.slider(sl, function (val) { if (!st.clip || sl._sync) return; st.play = false; st.t = val / 1000 * st.clip.dur; M.anim(st.clip, st.t); syncTl(); dirty = true; });
      syncTl(); placeOverlays();
    }
    function syncTime() { var tEl = $('[data-time]', ui), sl = $('.mv-tl .bb-slider', ui); if (!st.clip || !tEl) return; tEl.textContent = st.t.toFixed(2) + ' / ' + st.clip.dur.toFixed(2); sl._sync = true; sl.value = Math.round(st.t / st.clip.dur * 1000); sl.dispatchEvent(new Event('input')); sl._sync = false; }
    function syncTl() { var p = $('[data-m="play"]', ui); if (p) p.innerHTML = I(st.play ? 'pause' : 'play'); var lp = $('[data-m="loop"]', ui); if (lp) lp.setAttribute('aria-pressed', st.loop); syncTime(); }
    function lineX(y) { var px = st.wipe.x * W, py = st.wipe.y * Hh; return px + Math.tan(st.wipe.ang) * (py - y); }
    function placeOverlays() {
      view.style.setProperty('--pw', pw + 'px');
      var wp = $('.mv-wipe', ui);
      if (wp) {
        var px = st.wipe.x * W, py = st.wipe.y * Hh, a = st.wipe.ang, L = Math.hypot(W, Hh) * 2, hit = $('.mv-wipe__hit', wp), knob = $('.mv-wipe__knob', wp), rot = $('.mv-wipe__rot', wp), c0 = $('[data-region="0"]', wp), c1 = $('[data-region="1"]', wp);
        hit.style.cssText = 'left:' + px + 'px;top:' + (py - L / 2) + 'px;height:' + L + 'px;transform:rotate(' + a + 'rad)';
        knob.style.left = px + 'px'; knob.style.top = py + 'px';
        rot.style.left = px + Math.sin(a) * 72 + 'px'; rot.style.top = py - Math.cos(a) * 72 + 'px';
        var xt = lineX(18);
        c0.style.left = clamp(xt - 12 - c0.offsetWidth, 8, W - pw - c0.offsetWidth - 8) + 'px'; c1.style.left = clamp(xt + 12, 8, W - pw - c1.offsetWidth - 8) + 'px';
      }
      var sp = $('.mv-strips', ui);
      if (sp) {
        var n = st.strips.length;
        $$('[data-strip]', sp).forEach(function (cEl, i) { var xc = (i + 0.5) * W / n - (18 - Hh / 2) * SLOPE; cEl.style.left = clamp(xc - cEl.offsetWidth / 2, 8, W - cEl.offsetWidth - 8) + 'px'; });
        var add = $('[data-strip-add]', sp); if (add) add.style.left = clamp(W - (18 - Hh / 2) * SLOPE + 4, 8, W - pw - 36) + 'px';
      }
    }
    /* size: the bounding box with its three measured edges (the ones nearest the camera), and a scale bar
     * true at the depth of the model's centre — it follows zoom and the field of view */
    var STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    function placeDims() {
      if (!st.dims || compact || loading) { dims.innerHTML = ''; return; }
      var c = cam(), cp = c.position, xs = cp.x >= center.x ? bb.max.x : bb.min.x, zs = cp.z >= center.z ? bb.max.z : bb.min.z, y0 = bb.min.y;
      var segs = [['x', [bb.min.x, y0, zs], [bb.max.x, y0, zs], size.x], ['z', [xs, y0, bb.min.z], [xs, y0, bb.max.z], size.z], ['y', [xs, y0, zs], [xs, bb.max.y, zs], size.y]];
      function scr(p) { var v3 = new T.Vector3(p[0], p[1], p[2]).project(c); return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * Hh, z: v3.z }; }
      var lines = '', labs = '';
      segs.forEach(function (s) {
        var a = scr(s[1]), b = scr(s[2]); if (a.z > 1 || b.z > 1) return;
        var len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 14) return;
        var nx = -(b.y - a.y) / len * 4, ny = (b.x - a.x) / len * 4, col = 'var(--axis-' + s[0] + ')';
        lines += '<path d="M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + 'L' + b.x.toFixed(1) + ' ' + b.y.toFixed(1) + 'M' + (a.x - nx).toFixed(1) + ' ' + (a.y - ny).toFixed(1) + 'L' + (a.x + nx).toFixed(1) + ' ' + (a.y + ny).toFixed(1) + 'M' + (b.x - nx).toFixed(1) + ' ' + (b.y - ny).toFixed(1) + 'L' + (b.x + nx).toFixed(1) + ' ' + (b.y + ny).toFixed(1) + '" style="stroke:' + col + '"/>';
        labs += '<span class="mv-dim" style="left:' + ((a.x + b.x) / 2).toFixed(1) + 'px;top:' + ((a.y + b.y) / 2).toFixed(1) + 'px"><i style="background:' + col + '"></i>' + s[3].toFixed(2) + ' m</span>';
      });
      var vis = 2 * orb.r * Math.tan(st.fov * Math.PI / 360), ppm = Hh / vis, L = STEPS[0];
      STEPS.forEach(function (s) { if (s * ppm <= 132) L = s; });
      dims.innerHTML = '<svg class="mv-dimsvg" width="' + W + '" height="' + Hh + '">' + lines + '</svg>' + labs +
        '<div class="mv-scale" title="比例尺（模型中心所在深度）"><span class="mv-scale__bar" style="width:' + (L * ppm).toFixed(1) + 'px"></span><span class="vw__num">' + (L < 1 ? Math.round(L * 100) + ' cm' : L + ' m') + '</span><small>' + size.x.toFixed(2) + ' × ' + size.y.toFixed(2) + ' × ' + size.z.toFixed(2) + ' m</small></div>';
    }

    /* ── pointer: orbit (drag), pan (shift or right drag), zoom (wheel), momentum on release ── */
    var trk = B.tracker();
    function lp(e) { var r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom }; }
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      cap(canvas, e); orb.goal = null; orb.vth = orb.vph = 0; trk.reset(); trk.add(e); view.classList.add('dragging');
      orb.drag = { x: e.clientX, y: e.clientY, th: orb.th, ph: orb.ph, pan: e.shiftKey || e.button === 2, tgt: orb.target.clone(), turn: st.turn }; st.turn = false;
    });
    canvas.addEventListener('pointermove', function (e) {
      var d = orb.drag; if (!d) return; trk.add(e);
      var dx = (e.clientX - d.x) / S.zoom, dy = (e.clientY - d.y) / S.zoom;
      if (d.pan) { var c = cam(), right = new T.Vector3().setFromMatrixColumn(c.matrix, 0), up = new T.Vector3().setFromMatrixColumn(c.matrix, 1), k = orb.r * 0.0017; orb.target.copy(d.tgt).addScaledVector(right, -dx * k).addScaledVector(up, dy * k); }
      else { orb.th = d.th - dx * 0.008; var raw = d.ph - dy * 0.008; orb.ph = raw < PH0 ? PH0 + B.rubberband(raw - PH0, 1.4) : raw > PH1 ? PH1 + B.rubberband(raw - PH1, 1.4) : raw; }
      dirty = true;
    });
    function release() { var d = orb.drag; if (!d) return; orb.drag = null; view.classList.remove('dragging'); if (!d.pan) { var vel = trk.velocity(); orb.vth = -vel.x / S.zoom * 0.008; orb.vph = -vel.y / S.zoom * 0.008; } st.turn = d.turn && !Math.abs(orb.vth); syncBar(); }
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); orb.tr = clamp(orb.tr * Math.exp(e.deltaY * 0.0012), R0 * 0.3, R0 * 3); }, { passive: false });
    canvas.addEventListener('dblclick', frameAll);

    /* wipe divider: the knob moves it 1:1, the outer handle turns it; strips: chips pick channels */
    ui.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('[data-drag]'); if (!h) return; e.preventDefault(); cap(h, e);
      var kind = h.getAttribute('data-drag'), p0 = lp(e), w0 = { x: st.wipe.x, y: st.wipe.y };
      function mv(ev) { var p = lp(ev); if (kind === 'move') { st.wipe.x = clamp(w0.x + (p.x - p0.x) / W, 0.02, 0.98); st.wipe.y = clamp(w0.y + (p.y - p0.y) / Hh, 0.05, 0.95); } else { var an = Math.atan2(p.x - st.wipe.x * W, -(p.y - st.wipe.y * Hh)); if (Math.abs(an) < 0.05) an = 0; st.wipe.ang = clamp(an, -1.3, 1.3); } dirty = true; }
      function up() { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); }
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    ui.addEventListener('dblclick', function (e) { if (e.target.closest('[data-drag="rot"]')) { st.wipe.ang = 0; dirty = true; } });
    ui.addEventListener('click', function (e) {
      var t = e.target, x = t.closest('[data-strip-x]'), r = t.closest('[data-region]'), s = t.closest('[data-strip]'), add = t.closest('[data-strip-add]'), m = t.closest('[data-m]');
      if (x) { e.stopPropagation(); st.strips.splice(+x.getAttribute('data-strip-x'), 1); buildUi(); dirty = true; return; }
      if (r) return channelMenu(st.wipe.ch[+r.dataset.region], r, function (c) { st.wipe.ch[+r.dataset.region] = c; buildUi(); dirty = true; }, def);
      if (s) return channelMenu(st.strips[+s.dataset.strip], s, function (c) { st.strips[+s.dataset.strip] = c; buildUi(); dirty = true; }, def);
      if (add) { var used = st.strips, next = ['full', 'base', 'normal', 'rough', 'metal', 'ao'].filter(function (c) { return used.indexOf(c) < 0 && !unread(def, c); })[0]; st.strips.push(next); buildUi(); dirty = true; return; }
      if (!m) return; var k = m.dataset.m;
      if (k === 'play') togglePlay();
      if (k === 'loop') { st.loop = !st.loop; syncTl(); }
      if (k === 'clip') App.menu(M.clips.map(function (c) { return { label: c.id + ' · ' + c.dur.toFixed(1) + ' 秒', check: c === st.clip, act: function () { st.clip = c; st.t = 0; M.anim(c, 0); buildUi(); renderPanel(); dirty = true; } }; }), m);
      if (k === 'issue') { if (App.el.app.getAttribute('data-insp') === 'closed') App.togglePanel('insp'); var bn = $('.bb-insp__issue .bb-banner', App.el.insp); if (bn) { App.el.insp.firstChild.scrollTop = 0; bn.classList.remove('flash'); void bn.offsetWidth; bn.classList.add('flash'); } }
    });
    function togglePlay() { if (!st.clip) return; st.play = !st.play; if (st.play && !st.loop && st.t >= st.clip.dur - 0.001) st.t = 0; syncTl(); }

    /* ── tool bar ── */
    function syncBar() {
      var n = $('[data-chname]', v.bar); if (n) n.textContent = chName(st.ch);
      var db = $('[data-m="dims"]', v.bar); if (db) db.setAttribute('aria-pressed', !!st.dims);
      var cs = $('[data-m="ch"]', v.bar); if (cs) cs.hidden = st.mode !== 'single';
      var tb = $('[data-m="turn"]', v.bar); if (tb) tb.setAttribute('aria-pressed', !!st.turn);
      var pb = $('[data-m="panel"]', v.bar); if (pb) pb.setAttribute('aria-pressed', st.panel);
    }
    if (!compact) {
      v.bar.innerHTML = '<button class="bb-select" data-m="ch" title="通道"><span data-chname></span>' + I('chevron-down', 'bb-icon--12') + '</button>' +
        '<span data-modeseg>' + seg('对比方式', [['single', I('square'), '单视图'], ['wipe', I('square-split-horizontal'), '卷帘'], ['strips', I('columns-3'), '多通道斜切']], 'single') + '</span><i class="bb-toolbar__sep"></i>' +
        '<span data-projseg>' + seg('投影', [['persp', '透视'], ['ortho', '正交']], 'persp') + '</span>' +
        '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-m="frame" aria-label="复位视图" title="复位视图">' + I('focus') + '</button>' +
        '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-m="turn" aria-pressed="false" aria-label="转台" title="转台">' + I('rotate-3d') + '</button>' +
        '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-m="dims" aria-pressed="true" aria-label="尺寸" title="尺寸：包围盒与比例尺">' + I('box') + '</button>' +
        '<span class="bb-toolbar__grow"></span>' +
        '<button class="bb-btn bb-btn--ghost bb-btn--sm" data-m="shot">' + I('camera', 'bb-icon--12') + '出图</button>' +
        '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-m="panel" aria-pressed="false" aria-label="查看选项" title="查看选项">' + I('sliders-horizontal') + '</button>';
      var ms = $('[data-modeseg] .bb-seg', v.bar), ps = $('[data-projseg] .bb-seg', v.bar);
      ms.setAttribute('data-wired', ''); B.segmented(ms, function (val) {
        if (val === 'wipe') { st.wipe.ch = [st.ch, st.ch === 'base' ? 'full' : 'base']; st.wipe.x = (W - (st.panel ? PANEL_W : 0)) / 2 / W; st.wipe.y = 0.5; st.wipe.ang = 0; }
        if (val === 'strips' && st.mode === 'single') st.strips = [st.ch].concat(['full', 'base', 'normal'].filter(function (c) { return c !== st.ch; })).slice(0, 3);
        st.mode = val; buildUi(); syncBar(); dirty = true;
      });
      ps.setAttribute('data-wired', ''); B.segmented(ps, function (val) { st.ortho = val === 'ortho'; renderPanel(); dirty = true; });
      v.bar.addEventListener('click', function (e) {
        var b = e.target.closest('[data-m]'); if (!b) return; var k = b.dataset.m;
        if (k === 'ch') channelMenu(st.ch, b, function (c) { st.ch = c; syncBar(); buildUi(); dirty = true; }, def);
        if (k === 'dims') { st.dims = !st.dims; syncBar(); renderPanel(); dirty = true; }
        if (k === 'frame') frameAll();
        if (k === 'turn') { st.turn = !st.turn; syncBar(); }
        if (k === 'panel') { st.panel = PANEL_PREF = !st.panel; panel.toggleAttribute('data-closed', !st.panel); syncBar(); }
        if (k === 'shot') App.menu([{ icon: 'image', label: '把当前画面设为缩略图', act: setThumb }, { icon: 'image-plus', label: '另存为图片资产…', act: saveDialog }], b);
      });
    }

    /* ── side panel ── */
    function renderPanel() {
      if (compact) return;
      var e = envOf(st.env), lib = D.assets.filter(function (x) { return /\.hdr$/.test(x.name); }), libOn = !ENVS.some(function (x) { return x.id === st.env; });
      var parts = M.partList.map(function (p) { var off = !!st.hidden[p[0]], solo = st.solo === p[0]; return '<div class="prow"' + (off ? ' data-off' : '') + (solo ? ' data-solo' : '') + ' data-part="' + p[0] + '"><button class="prow__eye" data-eye aria-label="' + (off ? '显示' : '隐藏') + p[1] + '" title="' + (off ? '显示' : '隐藏') + '">' + I(off ? 'eye-off' : 'eye', 'bb-icon--12') + '</button><span title="单独查看">' + p[1] + '</span><small>' + p[2].toLocaleString('en-US') + '</small></div>'; }).join('');
      var texRows = def.tex.map(function (t) { var o = App.byName(t[0]); return '<div class="prow prow--tex"' + (o ? ' data-tex="' + o.id + '"' : '') + '><span class="bb-row__thumb">' + (o && o.art ? B.demo.art(o.art, o) : I(def.missing && def.missing.file === t[0] ? 'unlink' : 'image', 'bb-icon--12')) + '</span><span>' + t[1] + '</span><small>' + (def.missing && def.missing.file === t[0] ? '缺失' : '1024×1024') + '</small></div>'; }).join('');
      panel.innerHTML =
        H.sec('环境', '<div class="envs">' + ENVS.map(function (x) { return '<button class="envt" data-env="' + x.id + '" aria-pressed="' + (st.env === x.id) + '"><i style="background:' + grad(x) + '"></i><span>' + x.name + '</span></button>'; }).join('') + '<button class="envt" data-env-lib aria-pressed="' + libOn + '"><i class="envt__lib">' + I(libOn ? 'check' : 'folder-search', 'bb-icon--12') + '</i><span>' + (libOn ? esc(e.name.replace(/\.hdr$/, '')) : '资产库') + '</span></button></div>' +
          '<div class="rowctl"><span>旋转</span><input class="bb-slider" type="range" min="0" max="360" value="' + st.envRot + '" data-p="envRot" aria-label="旋转环境"><span class="vw__num" data-v="envRot">' + st.envRot + '°</span></div>' +
          '<div class="rowctl"><span>曝光</span><input class="bb-slider" type="range" min="-30" max="30" value="' + Math.round(st.exp * 10) + '" data-p="exp" aria-label="曝光"><span class="vw__num" data-v="exp">' + (st.exp >= 0 ? '+' : '') + st.exp.toFixed(1) + ' EV</span></div>' +
          '<div class="rowctl"><span>背景</span>' + seg('背景', [['env', '环境'], ['color', '纯色'], ['none', '透明']], st.bg, ' data-bgseg') + (st.bg === 'color' ? '<label class="swb swb--pick" style="background:' + st.bgColor + '" title="颜色"><input type="color" value="' + st.bgColor + '" data-bgcolor aria-label="背景颜色"></label>' : '') + '</div>') +
        H.sec('灯光', '<div class="rowctl"><span>主光</span>' + sw(st.light, 'data-t="light"', '主光') + '<span class="grow"></span><span>阴影</span>' + sw(st.shadow, 'data-t="shadow"', '阴影') + '</div>' +
          '<div class="rowctl rowctl--dial"><div class="dial" data-dial aria-label="主光方向" title="拖动调整主光方向"' + (st.light ? '' : ' data-off') + '><i class="dial__ring"></i><i class="dial__dot"></i></div><span class="vw__num" data-lightv></span></div>') +
        H.sec('相机与展示', '<div class="rowctl"><span>视野角</span><input class="bb-slider" type="range" min="15" max="90" value="' + st.fov + '" data-p="fov" aria-label="视野角"' + (st.ortho ? ' disabled' : '') + '><span class="vw__num" data-v="fov">' + st.fov + '°</span></div>' +
          '<div class="rowctl"><span>地面</span>' + sw(st.ground, 'data-t="ground"', '地面') + '<span class="grow"></span><span>网格</span>' + sw(st.grid, 'data-t="grid"', '网格') + '</div><div class="rowctl"><span>尺寸</span>' + sw(st.dims, 'data-t="dims"', '尺寸') + '</div>', { collapsed: !st.secCam }) +
        H.sec('结构', parts + '<div class="prow prow--mat"><span>' + I('layers', 'bb-icon--12') + M.material + '</span><small>1 个材质</small></div><div class="rowctl"><span>骨骼</span>' + sw(st.skel, 'data-t="skel"', '骨骼') + '</div>', { collapsed: !st.secStruct }) +
        (M.clips.length ? H.sec('动作', M.clips.map(function (c) { return '<div class="prow" data-clip="' + c.id + '"' + (c === st.clip ? ' data-solo' : '') + '><span>' + I('play', 'bb-icon--12') + c.id + '</span><small>' + c.dur.toFixed(1) + ' 秒</small></div>'; }).join('') + '<div class="rowctl"><span>速度</span>' + seg('速度', [['0.5', '0.5×'], ['1', '1×'], ['2', '2×']], String(st.speed), ' data-speedseg') + '</div>') : '') +
        H.sec('信息', H.kv([['三角面', (a.tris || 0).toLocaleString('en-US')], ['顶点', Math.round((a.tris || 0) * 0.56).toLocaleString('en-US')], ['网格', String(M.partList.length)], ['骨骼', String(M.bones().length ? M.bones().length + 1 : 0)], ['动画', M.clips.length ? M.clips.map(function (c) { return c.id; }).join('、') : '无'], ['包围盒', size.x.toFixed(2) + ' × ' + size.y.toFixed(2) + ' × ' + size.z.toFixed(2) + ' m'], ['UV · 法线', '有 · 有'], ['顶点色', def.vcol ? 'R G B A' : '无']]) + '<div class="mv-tex">' + texRows + '</div>', { collapsed: !st.secInfo });
      $$('.bb-seg', panel).forEach(function (sg) {
        sg.setAttribute('data-wired', '');
        B.segmented(sg, function (val) { if (sg.hasAttribute('data-bgseg')) { st.bg = val; paintBg(); renderPanel(); } else if (sg.hasAttribute('data-speedseg')) st.speed = +val; });
      });
      $$('.bb-slider', panel).forEach(function (sl) {
        B.slider(sl, function (val) {
          var p = sl.getAttribute('data-p'), out = $('[data-v="' + p + '"]', panel);
          if (p === 'envRot') { st.envRot = val; if (out) out.textContent = val + '°'; clearTimeout(envTimer); envTimer = setTimeout(makeEnv, 30); }
          if (p === 'exp') { st.exp = val / 10; if (out) out.textContent = (st.exp >= 0 ? '+' : '') + st.exp.toFixed(1) + ' EV'; }
          if (p === 'fov') { st.fov = val; if (out) out.textContent = val + '°'; }
          dirty = true;
        });
      });
      placeDial();
    }
    function placeDial() {
      var d = $('[data-dial] .dial__dot', panel), l = $('[data-lightv]', panel); if (!d) return;
      var rr = (1 - st.el / 90) * 26, az = st.az * Math.PI / 180;
      d.style.transform = 'translate(' + (Math.sin(az) * rr).toFixed(1) + 'px,' + (Math.cos(az) * rr).toFixed(1) + 'px)';
      if (l) l.textContent = '方位 ' + Math.round(st.az) + '° · 高度 ' + Math.round(st.el) + '°';
    }
    panel.addEventListener('click', function (e) {
      var t = e.target, env = t.closest('[data-env]'), lib = t.closest('[data-env-lib]'), tg = t.closest('[data-t]'), eye = t.closest('[data-eye]'), part = t.closest('[data-part]'), clip = t.closest('[data-clip]'), tex = t.closest('[data-tex]'), head = t.closest('.bb-sec__head');
      if (head) { var sec = head.textContent.trim(); setTimeout(function () { var collapsed = head.parentElement.hasAttribute('data-collapsed'); if (/相机/.test(sec)) st.secCam = !collapsed; if (/结构/.test(sec)) st.secStruct = !collapsed; if (/信息/.test(sec)) st.secInfo = !collapsed; }, 0); return; }
      if (env) { st.env = env.getAttribute('data-env'); makeEnv(); renderPanel(); return; }
      if (lib) { var hdrs = D.assets.filter(function (x) { return /\.hdr$/.test(x.name); }); return App.menu(hdrs.map(function (x) { return { icon: 'globe', label: x.name, check: st.env === x.id, act: function () { st.env = x.id; makeEnv(); renderPanel(); } }; }), lib); }
      if (tg) { var k = tg.getAttribute('data-t'); st[k] = !st[k]; tg.setAttribute('aria-checked', st[k]); if (k === 'light') renderPanel(); if (k === 'dims') syncBar(); dirty = true; return; }
      if (eye) { var pid = eye.closest('[data-part]').getAttribute('data-part'); st.hidden[pid] = !st.hidden[pid]; renderPanel(); dirty = true; return; }
      if (part) { var id = part.getAttribute('data-part'); st.solo = st.solo === id ? null : id; renderPanel(); dirty = true; return; }
      if (clip) { st.clip = M.clips.filter(function (c) { return c.id === clip.getAttribute('data-clip'); })[0]; st.t = 0; M.anim(st.clip, 0); buildUi(); renderPanel(); dirty = true; return; }
      if (tex) App.openDetail(tex.getAttribute('data-tex'));
    });
    panel.addEventListener('input', function (e) { if (e.target.hasAttribute('data-bgcolor')) { st.bgColor = e.target.value; e.target.parentNode.style.background = st.bgColor; paintBg(); } });
    panel.addEventListener('pointerdown', function (e) {
      var d = e.target.closest('[data-dial]'); if (!d || !st.light) return; e.preventDefault(); cap(d, e);
      function set(ev) { var r = d.getBoundingClientRect(), x = (ev.clientX - r.left - r.width / 2) / (r.width / 2), y = (ev.clientY - r.top - r.height / 2) / (r.height / 2), m = Math.min(1, Math.hypot(x, y)); st.az = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; st.el = Math.max(4, (1 - m) * 90); placeDial(); lightPos(); }
      function up() { d.removeEventListener('pointermove', set); d.removeEventListener('pointerup', up); }
      set(e); d.addEventListener('pointermove', set); d.addEventListener('pointerup', up);
    });

    /* ── output: the current view becomes the thumbnail, or a new image asset with its source recorded ── */
    function capture(px, transparent) {
      var keep = { w: W, h: Hh, pw: pw, g: st.ground, grid: st.grid, dims: st.dims, sk: st.skel, mode: st.mode, ch: st.ch };
      st.ch = shotCh(); st.grid = st.skel = st.dims = false; st.ground = keep.g && !transparent; st.mode = 'single'; pw = 0; W = Hh = px; renderer.setPixelRatio(1); renderer.setSize(px, px, false); render();
      var src = renderer.domElement, out = document.createElement('canvas'); out.width = out.height = px; var g = out.getContext('2d');
      if (!transparent) { var e = envOf(st.env); if (st.bg === 'color') g.fillStyle = st.bgColor; else { var gr = g.createLinearGradient(0, 0, 0, px); gr.addColorStop(0, e.sky[0]); gr.addColorStop(1, e.sky[1]); g.fillStyle = gr; } g.fillRect(0, 0, px, px); }
      g.drawImage(src, 0, 0, px, px);
      W = keep.w; Hh = keep.h; pw = keep.pw; st.ch = keep.ch; st.ground = keep.g; st.grid = keep.grid; st.dims = keep.dims; st.skel = keep.sk; st.mode = keep.mode; renderer.setPixelRatio(dpr); renderer.setSize(W, Hh, false); dirty = true;
      return out.toDataURL('image/png');
    }
    function shotCh() { return st.mode === 'single' ? st.ch : 'full'; }
    function params() { return '通道 ' + chName(shotCh()) + ' · 环境 ' + envOf(st.env).name + ' · 曝光 ' + (st.exp >= 0 ? '+' : '') + st.exp.toFixed(1) + ' EV · ' + (st.ortho ? '正交' : '透视 ' + st.fov + '°'); }
    function setThumb() {
      var prev = { art: a.art, img: a.img, state: a.state }, url = capture(512, false);
      a.art = 'raster'; a.img = url; App.refresh(a, true); App.renderInsp();
      App.toast('已把当前画面设为缩略图', function () { a.art = prev.art; a.img = prev.img; a.state = prev.state; App.refresh(a); App.renderInsp(); });
    }
    /* target: when set, the render replaces that asset's content instead of creating a new asset */
    function saveDialog(target) {
      var base = a.name.replace(/\.\w+$/, ''), o = target ? { name: target.name, folder: target.folder, size: target.w || 256, transparent: !!target.alpha } : { name: base + '_render.png', folder: a.folder, size: 512, transparent: true };
      while (!target && D.assets.some(function (x) { return x.folder === o.folder && x.name === o.name; })) o.name = o.name.replace(/(?: \((\d+)\))?\.png$/, function (m0, n) { return ' (' + ((+n || 0) + 1) + ').png'; });
      function shot() { return capture(o.size, o.transparent); }
      var url = shot();
      function body() { return '<div class="shot"><div class="shot__img' + (o.transparent ? ' bb-cell__thumb--alpha' : '') + '"><img src="' + url + '" alt=""></div><div class="up-opts"><span>名称</span>' + (target ? '<div class="shot__fixed">' + esc(o.name) + '<small>v' + (D.versions(target).length + 1) + '</small></div>' : '<div class="bb-field"><input class="bb-field__input" id="shotname" value="' + esc(o.name) + '" aria-label="名称"></div>') + '<span>位置</span><div>' + (target ? '<div class="shot__fixed">' + esc(o.folder) + '</div>' : '<button class="bb-select" data-shot-folder>' + I('folder', 'bb-icon--12') + esc(o.folder) + I('chevron-down', 'bb-icon--12') + '</button>') + '</div><span>尺寸</span><div data-shot-size>' + seg('尺寸', [['256', '256'], ['512', '512'], ['1024', '1024']], String(o.size)) + '</div><span>透明背景</span><div>' + sw(o.transparent, 'data-shot-alpha', '透明背景') + '</div></div></div>'; }
      var dlg = App.dialog({ wide: true, form: true, title: target ? '重新渲染 ' + esc(target.name) : '另存为图片资产', body: body(), actions: [{ label: '取消' }, { label: target ? '替换' : '保存', kind: 'primary', icon: 'image-plus', act: function () { if (target) replace(target, o, url); else save(o, url); } }] });
      var bd = $('.bb-dialog__body', dlg);
      function wire() {
        var sg = $('[data-shot-size] .bb-seg', bd); sg.setAttribute('data-wired', ''); B.segmented(sg, function (val) { o.size = +val; url = shot(); $('.shot__img img', bd).src = url; });
        var nm = $('#shotname', bd); if (nm) nm.addEventListener('input', function (ev) { o.name = ev.target.value.trim() || o.name; });
      }
      wire();
      bd.addEventListener('click', function (ev) {
        var f = ev.target.closest('[data-shot-folder]'), al = ev.target.closest('[data-shot-alpha]');
        if (f) App.menu([a.folder, 'ui/icons', 'ui/shop', 'props'].filter(function (x, i, arr) { return arr.indexOf(x) === i; }).map(function (x) { return { icon: 'folder', label: x, check: x === o.folder, act: function () { o.folder = x; bd.innerHTML = body(); wire(); } }; }), f);
        if (al) { o.transparent = !o.transparent; url = shot(); bd.innerHTML = body(); wire(); }
      });
      setTimeout(function () { var n = $('#shotname', bd); if (n) { n.focus(); n.setSelectionRange(0, n.value.lastIndexOf('.')); } }, 0);
    }
    function save(o, url) {
      var dflt = App.defaultsFor(o.folder), na = D.mk(o.name, o.folder, 'image', { art: 'raster', img: url, alpha: o.transparent, info: o.size + '×' + o.size, w: o.size, h: o.size, stage: dflt.stage, review: dflt.exempt ? 'exempt' : 'pending', tags: a.tags.slice(), by: App.me(), modified: D.tick(), bytes: Math.round(url.length * 0.75) });
      D.assets.unshift(na);
      D.addEdge(na, 'source', a, { rec: D.addRecord({ method: '渲染', tool: 'Bowerbird 模型查看器', by: App.me(), at: D.fmtAt(na.modified), params: params() + ' · ' + o.size + '×' + o.size }) });
      D.rel(a).belongs.forEach(function (x) { if (x.a) D.addEdge(na, 'belongs', x.a); });
      D.counts.all++; D.counts.pending += na.review === 'pending' ? 1 : 0;
      App.render();
      App.toast('已保存 ' + o.name + '，来源指向 ' + a.name, function () { App.openDetail(na.id, 'rel'); }, '查看');
    }
    function replace(target, o, url) {
      var e = D.EDGES.filter(function (x) { return x.from === target.id && x.to === a.id && x.type === 'source'; })[0], now = D.verAt(a, 8.64e15);
      target.art = 'raster'; target.img = url; target.alpha = o.transparent; target.w = target.h = o.size; target.info = o.size + '×' + o.size;
      D.addVersion(target, App.me(), '从 ' + a.name + ' v' + now.v + ' 重新渲染');
      if (e) { e.reviewedAt = D.tick(); e.rec = D.addRecord({ method: '渲染', tool: 'Bowerbird 模型查看器', by: App.me(), at: D.fmtAt(e.reviewedAt), params: params() + ' · ' + o.size + '×' + o.size }); }
      if (target.issue === 'stale') { target.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); }
      target.review = 'pending'; App.render();
      App.toast('已替换 ' + target.name + '，回到待审', function () { App.openDetail(target.id, 'rel'); }, '查看');
    }

    /* ── keyboard, lifecycle ── */
    function boot() {
      M.anim(st.clip, 0); makeEnv(); lightPos(); resize();
      if (!compact && PANEL_PREF) { st.panel = true; pw = PANEL_W; panel.removeAttribute('data-closed'); }
      buildUi(); renderPanel(); syncBar(); raf = requestAnimationFrame(loop);
      /* arriving from "replace content → re-render": open the shot straight away, aimed at the asset to replace */
      var ps = App.pendingShot; if (!compact && ps && ps.from === a) { App.pendingShot = null; setTimeout(function () { if (raf) saveDialog(ps.replace); }, 650); }
    }
    var ro = new ResizeObserver(resize); ro.observe(view);
    if (!compact && (a.tris || 0) > 5000 && !LOADED[a.id]) {
      loading = true; var t0 = performance.now(), total = a.bytes || 6.8e6;
      boot();
      (function prog() {
        if (!raf) return; var k = Math.min(1, (performance.now() - t0) / 1800), ring = $('[data-ring]', ui), by = $('[data-bytes]', ui);
        if (ring) ring.style.strokeDashoffset = (100.5 * (1 - k)).toFixed(1); if (by) by.textContent = (total * k / 1e6).toFixed(1) + ' / ' + (total / 1e6).toFixed(1) + ' MB';
        if (k < 1) return requestAnimationFrame(prog);
        loading = false; LOADED[a.id] = true; buildUi(); view.classList.add('arrive'); dirty = true;
      })();
    } else boot();
    if (a.state === 'waiting') setTimeout(function () { if (!raf) return; a.art = 'raster'; a.img = capture(512, false); a.state = 'ready'; App.refresh(a, true); App.syncBar(); App.renderInsp(); }, 700);
    return {
      destroy: function () {
        cancelAnimationFrame(raf); raf = 0; ro.disconnect(); clearTimeout(envTimer);
        rts.forEach(function (r) { r.dispose(); }); if (envRT) envRT.dispose(); pmrem.dispose();
        root.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        renderer.dispose(); try { renderer.forceContextLoss(); } catch (err) { /* context already gone */ }
      },
      key: function (e) { if (e.key === ' ' && st.clip) { togglePlay(); return true; } return false; }
    };
  }

  App.viewers.model = ['bowerbird.model', modelViewer];
  /* the same plugin's compare view (compare.js) builds its scenes from these */
  App.m3 = { defFor: defFor, matFor: matFor, envOf: envOf, grad: grad };

  /* ── the grid's small renders: one shared WebGL context, never one per cell ──
   * snap: a still made in this browser when a cell scrolls into view (ADR-025: no render queue, no headless renderer)
   * spin: a live turntable while the pointer rests on a model cell (ADR-022: starts after ~0.5 s, stops on leave) */
  var MINI = null;
  function mini() {
    if (MINI) return MINI;
    var r; try { r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return null; }
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.setClearColor(0x000000, 0);
    r.domElement.className = 'cell3d';
    return (MINI = { r: r, raf: 0, scene: null });
  }
  function miniScene(a) {
    var def = defFor(a), scene = new T.Scene(), M = def.build(def), root = M.root, pivot = new T.Group();
    var bb = new T.Box3().setFromObject(root), size = bb.getSize(new T.Vector3()), c = bb.getCenter(new T.Vector3());
    root.position.sub(c); pivot.add(root); scene.add(pivot);
    root.traverse(function (o) { if (o.isMesh) o.material = matFor('full', o.userData.role, def); });
    scene.add(new T.HemisphereLight(0xeef2ff, 0x40362c, 0.55));
    var key = new T.DirectionalLight(0xffffff, 1.1); key.position.set(2, 3, 2.5); scene.add(key);
    var rim = new T.DirectionalLight(0xdfe8ff, 0.45); rim.position.set(-2.5, 1.5, -2); scene.add(rim);
    var cam = new T.PerspectiveCamera(30, 1, 0.01, 100), d = Math.max(size.x, size.y, size.z) * 2.6;
    cam.position.set(d * 0.62, d * 0.42, d * 0.78); cam.lookAt(0, 0, 0);
    pivot.rotation.y = -0.35;
    return { scene: scene, cam: cam, pivot: pivot, root: root };
  }
  function freeScene(s) { s.root.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
  App.m3.snap = function (a, px) {
    var m = mini(); if (!m) return null; px = px || 320;
    var s = miniScene(a); m.r.setSize(px, px, false); s.cam.aspect = 1; s.cam.updateProjectionMatrix();
    m.r.render(s.scene, s.cam); var url = m.r.domElement.toDataURL('image/png'); freeScene(s); return url;
  };
  App.m3.spin = function (a, host) {
    var m = mini(); if (!m) return function () {};
    App.m3.stopSpin();
    var s = miniScene(a), w = host.clientWidth, h = host.clientHeight, t0 = performance.now();
    m.r.setSize(w, h); s.cam.aspect = w / h; s.cam.updateProjectionMatrix();
    host.appendChild(m.r.domElement); m.host = host; m.scene = s; host.classList.add('spinning');
    (function tick(now) { s.pivot.rotation.y = -0.35 + (now - t0) / 1000 * 1.1; m.r.render(s.scene, s.cam); m.raf = requestAnimationFrame(tick); })(t0);
    return App.m3.stopSpin;
  };
  App.m3.stopSpin = function () {
    var m = MINI; if (!m || !m.scene) return;
    cancelAnimationFrame(m.raf); m.raf = 0; if (m.r.domElement.parentNode) m.r.domElement.parentNode.removeChild(m.r.domElement);
    if (m.host) m.host.classList.remove('spinning'); freeScene(m.scene); m.scene = null; m.host = null;
  };
  /* a still made in the browser becomes the cell's picture */
  B.demo.registerArt('snap', function (a) { return a.snap ? '<image href="' + a.snap + '" x="0" y="0" width="160" height="160" preserveAspectRatio="xMidYMid meet"/>' : ''; });
})();
