/* Bowerbird prototype — compare page and the version timeline.
 * The shell owns the frame: two sides (an asset, or one version of it), the mode switch, the wipe divider,
 * the information table and "set as current". Each format plugin fills the stage:
 * image · video · audio · model · text, and a model checked against an image (turnaround sheet). */
(function () {
  'use strict';
  var App = window.App, B = Bowerbird, I = B.icon, H = B.html, D = App.D, S = App.S, el = App.el, $ = App.$, $$ = App.$$, DEMO = B.demo, L = H.labels;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function cap(n, e) { try { n.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ } }
  function pt(n, e) { var r = n.getBoundingClientRect(); return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom, w: r.width / S.zoom, h: r.height / S.zoom }; }
  function fmtN(n) { return Number(n).toLocaleString('en-US'); }
  function tc(t) { var s = Math.floor(t), m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + ('0' + (s % 60)).slice(-2) + '.' + ('0' + Math.floor((t - s) * 100)).slice(-2); }
  function seg(label, items, cur, attr) { return '<div class="bb-seg" role="radiogroup" aria-label="' + label + '"' + (attr || '') + '><i class="bb-seg__thumb"></i>' + items.map(function (it) { return '<button class="bb-seg__item" role="radio" aria-checked="' + (it[0] === cur) + '" data-value="' + it[0] + '">' + it[1] + '</button>'; }).join('') + '</div>'; }

  /* ── version plugin: which one is installed, and from when versions keep their content ── */
  S.verPlugin = 'lore'; S.verSince = 0;
  function lastOf(a) { var vs = D.versions(a); return vs[vs.length - 1]; }
  /* the current version is the file on disk; older ones exist only if a version plugin kept them */
  function stored(a, x) { return x === lastOf(a) || (!!S.verPlugin && x.at >= S.verSince); }
  App.verStored = stored;

  /* ── sides ── */
  function side(x) { var a = App.byId(x.id); return { id: x.id, v: x.v || x.ver || D.versions(a).length }; }
  function view(s) { var a = App.byId(s.id); return a ? D.atVersion(a, Math.min(s.v, D.versions(a).length)) : null; }
  function sortOf(a) { if (!a || a.kind === 'unknown' || /missing|failed|unknown|waiting|processing/.test(a.state || '')) return 'none'; if (a.kind === 'doc') return /\.(md|txt|json)$/i.test(a.name) ? 'text' : 'doc'; return a.kind; }
  function pairOf(x, y) { var p = sortOf(x), q = sortOf(y); if (p === q && FMT[p]) return p; if ((p === 'model' && q === 'image') || (p === 'image' && q === 'model')) return 'mi'; return 'pair'; }
  var MODES = [['side', '并排', 'columns-2'], ['wipe', '卷帘', 'square-split-horizontal'], ['over', '叠加', 'layers'], ['diff', '差异', 'scan-search']];
  var CAN = { image: 'side wipe over diff', model: 'side wipe', video: 'side wipe', audio: 'side', text: 'side diff', mi: 'side', pair: 'side' };
  var WHY = { model: '模型只能并排或卷帘', video: '视频只能并排或卷帘', audio: '音频按上下两条波形对齐', text: '文本按行显示差异', mi: '模型对照图片只能并排', pair: '两侧格式不同，只能并排' };
  /* ── the turnaround's grid (ADR-019): rows × columns and which view each cell holds, declared in the .bmeta by whoever made the sheet.
   * Nothing is recognised from the picture any more. Inside a declared cell the plain margin is trimmed, so a model can be laid over the drawing. */
  var VORD = ['front', 'side', 'back', 'top'], VLAB = { front: '正', side: '侧', back: '背', top: '顶' }, VNAME = { front: '正面', side: '侧面', back: '背面', top: '顶面' };
  App.VLAB = VLAB; App.VNAME = VNAME;
  function cellsOf(a) {
    var g = a && a.grid; if (!g) return null; var out = {};
    g.cells.forEach(function (k, i) { if (!k) return; var r = Math.floor(i / g.cols), c = i % g.cols; out[k] = [c / g.cols, r / g.rows, 1 / g.cols, 1 / g.rows]; });
    return out;
  }
  App.cellsOf = cellsOf;
  function trimCells(a, done) {
    var r0 = sizeOf(a), w = 480, h = Math.max(8, Math.round(w * r0.h / r0.w)), cells = cellsOf(a);
    raster(a, w, h, function (cv) {
      if (!cv) return done({});
      var d = cv.getContext('2d').getImageData(0, 0, w, h).data, out = {};
      Object.keys(cells).forEach(function (k) {
        var c = cells[k], x0 = Math.round(c[0] * w), y0 = Math.round(c[1] * h), x1 = Math.round((c[0] + c[2]) * w) - 1, y1 = Math.round((c[1] + c[3]) * h) - 1, bg = ((y0 + 2) * w + x0 + 2) * 4;
        var nx = x1, ny = y1, mx = x0, my = y0, hit = false;
        for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { var p = (y * w + x) * 4; if (Math.max(Math.abs(d[p] - d[bg]), Math.abs(d[p + 1] - d[bg + 1]), Math.abs(d[p + 2] - d[bg + 2]), Math.abs(d[p + 3] - d[bg + 3])) > 28) { hit = true; if (x < nx) nx = x; if (x > mx) mx = x; if (y < ny) ny = y; if (y > my) my = y; } }
        if (hit) out[k] = [nx / w, ny / h, (mx - nx + 1) / w, (my - ny + 1) / h];
      });
      done(out);
    });
  }
  /* kept per asset and drawing — the compare works on per-version copies, so the result must not live on the copy */
  var TRIM = {};
  function trimKey(a) { return a.id + '|' + (a.art || '') + '|' + JSON.stringify(a.grid); }
  function trimOf(a) { var t = TRIM[trimKey(a)]; return t && t !== 'busy' ? t : null; }
  function ensureTrim(a) {
    var k = trimKey(a); if (!a.grid || TRIM[k]) return; TRIM[k] = 'busy';
    trimCells(a, function (m) { TRIM[k] = m; if (App.cmpOpen && C && C.pair === 'mi' && (C.a.id === a.id || C.b.id === a.id)) build(); });
  }
  var SIZE = {};
  function modelSize(a) {
    var T = window.THREE, M3 = App.m3; if (!T || !M3) return null;
    var key = a.id + '|' + (a.variant || ''); if (SIZE[key]) return SIZE[key];
    var def = M3.defFor(a), M = def.build(def), s = new T.Box3().setFromObject(M.root).getSize(new T.Vector3());
    M.root.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    return (SIZE[key] = { x: s.x, y: s.y, z: s.z });
  }
  /* the sheet's views, by its grid: [cell x, y, w, h, label, drawn extent] — or null when the image declares no grid */
  function gridViews(P) {
    var cells = cellsOf(P); if (!cells) return null; ensureTrim(P); var V = {};
    VORD.forEach(function (k) { var c = cells[k]; if (!c) return; var t = trimOf(P) && trimOf(P)[k], pad = 0.1; V[k] = [c[0], c[1], c[2], c[3], VLAB[k], t || [c[0] + c[2] * pad, c[1] + c[3] * pad, c[2] * (1 - 2 * pad), c[3] * (1 - 2 * pad)]]; });
    return V;
  }
  /* ── target size: written once in the design object (chest.md front matter); the model check and the sheet's size lines come from it (ADR-020) ── */
  var AXES = { front: ['w', 'h'], side: ['d', 'h'], back: ['w', 'h'], top: ['w', 'd'] }, AXN = { w: '宽', h: '高', d: '深' };
  App.targetOf = function (a) {
    if (a.target) return a.target; var t = null, real = App.byId(a.id); if (!real) return null;
    D.rel(real).belongs.forEach(function (x) { if (!t && x.a && x.a.target) t = x.a.target; }); return t;
  };
  /* what each drawn view measures, with the sheet's scale taken from the front view's width */
  function implied(V, rp, t) {
    if (!V || !V.front || !t) return null; var f = V.front[5], mpp = t.w / (f[2] * rp.w), out = {};
    VORD.forEach(function (k) { var v = V[k]; if (!v) return; var o = v[5], ax = AXES[k]; out[k] = [[ax[0], o[2] * rp.w * mpp, t[ax[0]]], [ax[1], o[3] * rp.h * mpp, t[ax[1]]]]; });
    return out;
  }
  function off(got, want) { return Math.abs(got / want - 1) > 0.03; }
  /* the one built-in check (ADR-020): the model's bounding box against the design object's size — shown, never decides */
  App.modelFit = function (a) {
    var t = App.targetOf(a), s = t && a.kind === 'model' && modelSize(a); if (!s) return null; var issues = [];
    [['w', 'x'], ['h', 'y'], ['d', 'z']].forEach(function (p) { if (off(s[p[1]], t[p[0]])) issues.push(AXN[p[0]] + ' ' + s[p[1]].toFixed(2) + ' m，应为 ' + t[p[0]].toFixed(2)); });
    return { ok: !issues.length, issues: issues, s: s, t: t };
  };
  function sheetViews(A, Bv) { return gridViews(sheetOf(A, Bv)); }
  function sheetOf(A, Bv) { return A.kind === 'image' ? A : Bv; }
  /* E-13: two pictures whose proportions differ give no meaningful pixel difference */
  function apart(A, B) { if (!A || !B || A.kind !== 'image' || B.kind !== 'image') return false; var a = sizeOf(A), b = sizeOf(B); return Math.abs((a.w / a.h) / (b.w / b.h) - 1) > 0.05; }
  function canOf(pr, A, B) { if (pr === 'mi') return C.views ? ['side', 'wipe', 'over'] : ['side']; var c = CAN[pr].split(' '); return pr === 'image' && apart(A, B) ? c.filter(function (m) { return m !== 'diff'; }) : c; }
  function whyOf(pr, A, B) { if (pr === 'mi') return C.views ? '模型对照四视图不做像素差异' : '这张图没有格子信息，只能与模型并排'; if (pr === 'image' && apart(A, B)) return '两张图的比例不一样，差异看不出东西'; return WHY[pr]; }
  function thumb(a) { return a.kind === 'doc' ? I('file-text') : a.art && sortOf(a) !== 'none' ? DEMO.art(a.art, Object.assign({}, a, { fit: 'slice' })) : I(L.KIND_ICON[a.kind] || 'file'); }
  function verLabel(a) { return D.versions(App.byId(a.id)).length > 1 ? 'v' + a.ver : ''; }

  /* ── the page ── */
  var pg = document.createElement('section'); pg.id = 'compare'; pg.hidden = true; pg.setAttribute('aria-label', '对比'); el.app.appendChild(pg);
  var C = null, R = null;
  App.compare = function (a, b, o) {
    if (!a || !b) return; o = o || {};
    if (App.qlOpen) App.qlClose(true);
    C = { a: side(a), b: side(b), mode: o.mode || null, wipe: 0.5, align: 'fit', op: 0.5, info: C ? C.info : true, view: { z: 1, x: 0, y: 0 }, t: 0, ear: 'a', link: true };
    App.cmpOpen = true; pg.hidden = false; pg.className = 'enter';
    setTimeout(function () { if (pg.className === 'enter') pg.className = ''; }, 520);
    build();
  };
  App.closeCompare = function () {
    if (!App.cmpOpen) return; App.cmpOpen = false; stopR();
    pg.className = 'leaving';
    setTimeout(function () { if (App.cmpOpen) return; pg.hidden = true; pg.innerHTML = ''; pg.className = ''; }, 200);
  };
  function stopR() { if (R && R.destroy) R.destroy(); R = null; }
  function build() {
    var A = view(C.a), Bv = view(C.b); if (!A || !Bv) return App.closeCompare();
    var pr = pairOf(A, Bv);
    C.views = pr === 'mi' ? sheetViews(A, Bv) : null;
    var can = canOf(pr, A, Bv);
    if (!C.mode && pr === 'mi' && can.indexOf('wipe') >= 0) C.mode = 'wipe';  /* checking proportions is what this pairing is for */
    if (can.indexOf(C.mode) < 0) C.mode = can[0];
    C.pair = pr; C.can = can; stopR();
    pg.innerHTML = '<div class="cbar">' + bar(A, Bv, pr, can) + '</div><div class="cstage"></div><div class="ctab"' + (infoOn() ? '' : ' hidden') + '>' + table(A, Bv) + '</div>';
    placeThumb(false); wireBar();
    stage(A, Bv);
  }
  function stage(A, Bv) {
    stopR(); var st = $('.cstage', pg); st.className = 'cstage cstage--' + C.pair + ' cstage--' + C.mode; st.innerHTML = '';
    R = FMT[C.pair] ? FMT[C.pair](st, A, Bv) : FMT.pair(st, A, Bv);
    var o = $('.copts', pg); if (o) o.innerHTML = opts(A, Bv);
    wireOpts();
  }
  function setMode(m) {
    if (C.can.indexOf(m) < 0 || m === C.mode) return;
    C.picked = true;
    C.mode = m; $$('.cmodes [data-mode]', pg).forEach(function (b) { b.setAttribute('aria-checked', b.dataset.mode === m); }); placeThumb(true);
    if (R && R.setMode) { R.setMode(m); var st = $('.cstage', pg); st.className = 'cstage cstage--' + C.pair + ' cstage--' + m; var o = $('.copts', pg); if (o) { o.innerHTML = opts(view(C.a), view(C.b)); wireOpts(); } }
    else stage(view(C.a), view(C.b));
  }

  /* ── tool bar ── */
  function picker(which, A) {
    var vl = verLabel(A);
    return '<button class="cpk" data-pick="' + which + '" title="' + esc(A.path) + '"><i class="cpk__k">' + which.toUpperCase() + '</i><span class="cpk__t' + (A.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + thumb(A) + '</span><b>' + esc(A.name) + '</b>' + (A.issue ? H.issue(A.issue) : '') + H.stage(A.stage, 'short') + (A.review !== 'exempt' ? H.review(A.review) : '') + (vl ? '<span class="cpk__v' + (A.current ? ' cpk__v--now' : '') + '">' + vl + '</span>' : '') + I('chevron-down', 'bb-icon--12') + '</button>';
  }
  function bar(A, Bv, pr, can) {
    return '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-c="close" aria-label="返回" title="返回 Esc">' + I('chevron-left') + '</button>' +
      picker('a', A) + '<button class="bb-btn bb-btn--ghost bb-btn--icon cswap" data-c="swap" aria-label="交换两侧" title="交换两侧">' + I('arrow-up-down') + '</button>' + picker('b', Bv) +
      '<span class="bb-toolbar__grow"></span><div class="bb-seg cmodes" role="radiogroup" aria-label="对比方式"><i class="bb-seg__thumb"></i>' + MODES.map(function (m, i) {
        var ok = can.indexOf(m[0]) >= 0;
        return '<button class="bb-seg__item" role="radio" data-mode="' + m[0] + '" aria-checked="' + (m[0] === C.mode) + '"' + (ok ? ' title="' + m[1] + '"' : ' aria-disabled="true" data-why="' + whyOf(pr, A, Bv) + '"') + '>' + I(m[2], 'bb-icon--12') + m[1] + '</button>';
      }).join('') + '</div><span class="bb-toolbar__grow"></span><span class="copts"></span>' +
      curBtn() + '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-c="info" aria-pressed="' + (pr === 'mi' ? !!C.infoMi : C.info) + '" aria-label="技术信息" title="技术信息">' + I('list') + '</button>';
  }
  function placeThumb(anim) {
    var sg = $('.cmodes', pg), th = sg && $('.bb-seg__thumb', sg), cur = sg && $('[aria-checked="true"]', sg); if (!cur) return;
    if (!anim) th.style.transition = 'none';
    th.style.width = cur.offsetWidth + 'px'; th.style.transform = 'translateX(' + cur.offsetLeft + 'px)';
    if (!anim) { void th.offsetWidth; th.style.transition = ''; }
  }
  function curBtn() {
    if (C.a.id !== C.b.id || !S.verPlugin) return '';
    var a = App.byId(C.a.id), n = D.versions(a).length, cand = [C.a.v, C.b.v].filter(function (v, i, arr) { return v !== n && arr.indexOf(v) === i && stored(a, D.versions(a)[v - 1]); });
    if (!cand.length) return '';
    return '<button class="bb-btn bb-btn--sm" data-c="cur"' + (cand.length === 1 ? ' data-v="' + cand[0] + '">' + I('undo-2', 'bb-icon--12') + '把 v' + cand[0] + ' 恢复为当前版本…' : '>' + I('undo-2', 'bb-icon--12') + '恢复为当前版本…' + I('chevron-down', 'bb-icon--12')) + '</button>';
  }
  var tip = null;
  function hideTip() { if (tip) { tip.remove(); tip = null; } }
  function showTip(b) {
    hideTip(); var r = b.getBoundingClientRect(), z = S.zoom;
    tip = document.createElement('div'); tip.className = 'ctip'; tip.textContent = b.dataset.why; el.layer.appendChild(tip);
    tip.style.left = (r.left + r.width / 2) / z + 'px'; tip.style.top = (r.bottom + 6) / z + 'px';
  }
  function wireBar() {
    var b = $('.cbar', pg);
    b.addEventListener('pointerover', function (e) { var w = e.target.closest('[data-why]'); if (w) showTip(w); else hideTip(); });
    b.addEventListener('pointerleave', hideTip);
    b.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]'); if (m) { if (m.dataset.why) { hideTip(); App.toast(m.dataset.why); return; }  /* a mode this pairing can't do says why in a toast */ return setMode(m.dataset.mode); }
      var p = e.target.closest('[data-pick]'); if (p) return pickMenu(p.dataset.pick, p);
      var c = e.target.closest('[data-c]'); if (!c) return; var k = c.dataset.c;
      if (k === 'close') App.closeCompare();
      if (k === 'swap') swap();
      if (k === 'info') toggleInfo();
      if (k === 'cur') {
        var a = App.byId(C.a.id);
        if (c.dataset.v) return App.confirmRestore(a, +c.dataset.v, afterRestore);
        return App.menu([C.a.v, C.b.v].filter(function (v) { return v !== D.versions(a).length; }).map(function (v) { var x = D.versions(a)[v - 1]; return { icon: 'undo-2', label: '把 v' + v + ' 恢复为当前版本…', kbd: x.note, act: function () { App.confirmRestore(a, v, afterRestore); } }; }), c);
      }
    });
  }
  function afterRestore() { if (App.cmpOpen) build(); }
  function swap() { var t = C.a; C.a = C.b; C.b = t; C.ear = C.ear === 'a' ? 'b' : 'a'; build(); }
  /* a model against a sheet shares almost no fields, so the table starts folded there */
  function infoOn() { return C.pair === 'mi' ? !!C.infoMi : C.info; }
  function toggleInfo() { if (C.pair === 'mi') C.infoMi = !C.infoMi; else C.info = !C.info; var on = infoOn(), t = $('.ctab', pg), b = $('[data-c="info"]', pg); if (t) t.hidden = !on; if (b) b.setAttribute('aria-pressed', on); if (R && R.resize) R.resize(); }

  /* change one side: another version of it, something related, or anything in the library */
  function related(a, other) {
    var r = D.rel(a), seen = {}, out = [];
    function add(x) { if (x && x.id !== a.id && !seen[x.id] && D.assets.indexOf(x) >= 0) { seen[x.id] = 1; out.push(x); } }
    ['up', 'down', 'uses', 'usedBy', 'belongs', 'members'].forEach(function (k) { r[k].forEach(function (o) { add(o.a); }); });
    D.assets.forEach(function (x) { if (x.folder === a.folder && x.kind === (other || a).kind) add(x); });
    return out.sort(function (x, y) { return (y.kind === (other || a).kind) - (x.kind === (other || a).kind); }).slice(0, 8);
  }
  function pickMenu(which, btn) {
    var s = C[which], a = App.byId(s.id), vs = D.versions(a), other = view(C[which === 'a' ? 'b' : 'a']), items = [];
    if (vs.length > 1) {
      items.push({ header: '版本' });
      vs.slice().reverse().forEach(function (x) { var ok = stored(a, x); items.push({ label: 'v' + x.v + ' · ' + x.note, check: x.v === s.v, kbd: ok ? D.fmtAt(x.at).replace(/^\d+ 月 /, '').replace(/ \d\d:\d\d$/, '') : '未保存', disabled: !ok, act: function () { s.v = x.v; build(); } }); });
      items.push('sep');
    }
    var rel = related(a, other);
    if (rel.length) { items.push({ header: '相关' }); rel.forEach(function (o) { items.push({ icon: L.KIND_ICON[o.kind] || 'file', label: o.name, act: function () { C[which] = side(o); build(); } }); }); items.push('sep'); }
    items.push({ icon: 'search', label: '其他资产…', act: function () { pickDialog(which); } });
    App.menu(items, btn);
  }
  function pickDialog(which) {
    var d = App.dialog({ title: '换一个资产', form: true, body: '<div class="bb-field"><input class="bb-field__input" id="cpq" placeholder="搜索名称、文件夹或标签" aria-label="搜索资产" autocomplete="off"></div><div class="cpl" role="listbox"></div>', actions: [{ label: '取消' }] });
    var q = $('#cpq', d), list = $('.cpl', d);
    function draw() {
      var s = q.value.trim().toLowerCase(), xs = D.assets.filter(function (x) { return !s || (x.name + ' ' + x.folder + ' ' + x.tags.join(' ')).toLowerCase().indexOf(s) >= 0; }).slice(0, 8);
      list.innerHTML = xs.map(function (x) { return '<button class="cpl__it" role="option" data-id="' + x.id + '"><span class="cpk__t' + (x.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + thumb(x) + '</span><span><b>' + esc(x.name) + '</b><small>' + esc(x.folder) + '</small></span></button>'; }).join('') || '<p class="cpl__none">没有匹配的资产</p>';
    }
    q.addEventListener('input', draw); draw(); setTimeout(function () { q.focus(); }, 0);
    list.addEventListener('click', function (e) { var it = e.target.closest('[data-id]'); if (!it) return; d.cancel(); C[which] = side(App.byId(it.dataset.id)); build(); });
  }

  /* ── format options in the bar ── */
  function opts(A, Bv) {
    if (C.pair === 'image' && (A.w !== Bv.w || A.h !== Bv.h)) return '<span class="copts__l">对齐</span>' + seg('对齐方式', [['fit', '按比例'], ['px', '原始像素']], C.align, ' data-align');
    if (C.pair === 'mi' && C.mode !== 'side') return '<span class="copts__l">对齐</span>' + seg('对齐方式', [['h', '按高度'], ['w', '按宽度']], C.fitBy || 'h', ' data-fitby');
    if (C.pair === 'text' && R && R.counts) return '<span class="cx-n"><b class="cx-n--add">+' + R.counts[0] + '</b><b class="cx-n--del">−' + R.counts[1] + '</b> 行</span>';
    return '';
  }
  function wireOpts() {
    var s = $('.copts [data-align]', pg); if (s) { s.setAttribute('data-wired', ''); B.segmented(s, function (v) { C.align = v; if (R && R.layout) R.layout(true); }); }
    var f = $('.copts [data-fitby]', pg); if (f) { f.setAttribute('data-wired', ''); B.segmented(f, function (v) { C.fitBy = v; if (R && R.layout) R.layout(); }); }
  }

  /* ── technical information, side by side; differences highlighted ── */
  function rows(a) {
    var r = [];
    if (a.kind === 'image') r.push(['size', '尺寸', a.w && a.h ? a.w + ' × ' + a.h : '—', a.w && a.w * a.h], ['alpha', '透明通道', a.alpha ? '有' : '无'], ['cs', '色彩空间', 'sRGB']);
    if (a.kind === 'model') { var chest = /^chest/.test(a.name); r.push(['tris', '三角面', a.tris ? fmtN(a.tris) : '—', a.tris], ['verts', '顶点', a.tris ? fmtN(Math.round(a.tris * 0.58)) : '—', a.tris && Math.round(a.tris * 0.58)], ['mat', '材质', chest ? '1 · M_Chest' : '1'], ['tex', '贴图', chest ? '3 张 · 1024' : '2 张 · 1024'], ['bbox', '包围盒', chest ? '1.26 × 0.95 × 0.87 m' : '—'], ['anim', '动画', chest ? '1 段 · open' : '无']); }
    if (a.kind === 'audio') r.push(['dur', '时长', a.info, a.dur], ['ch', '声道', '立体声'], ['sr', '采样率', '48 kHz'], ['lufs', '响度', a.lufs || '−16.2 LUFS']);
    if (a.kind === 'video') r.push(['dur', '时长', a.info, a.dur], ['res', '分辨率', '1280 × 720'], ['fps', '帧率', '30']);
    if (a.kind === 'doc') { var t = App.docText(a); r.push(['lines', '行数', fmtN(t.split('\n').length), t.split('\n').length], ['chars', '字数', fmtN(t.replace(/\s/g, '').length), t.replace(/\s/g, '').length]); }
    var fit = a.kind === 'model' ? App.modelFit(a) : null;
    if (fit && !fit.pending) r.push(['fit', '目标尺寸', fit.ok ? '一致' : fit.issues.join('；')]);
    r.push(['bytes', '文件大小', a.bytes ? App.fmtSize(a.bytes) : '—', a.bytes]);
    return r;
  }
  function delta(k, x, y) {
    if (x == null || y == null || x === y) return '';
    var d = y - x, s = d > 0 ? '+' : '−';
    if (k === 'bytes') return s + App.fmtSize(Math.abs(d));
    if (k === 'size') return '';
    return s + fmtN(Math.abs(Math.round(d * 100) / 100)) + (x ? ' · ' + s + Math.abs(Math.round(d / x * 100)) + '%' : '');
  }
  function head(a, k) {
    var x = a.verOf, multi = D.versions(App.byId(a.id)).length > 1;
    return '<div class="ct__h"><i class="cpk__k">' + k + '</i><b>' + esc(a.name) + '</b>' + (multi ? '<span class="cpk__v' + (a.current ? ' cpk__v--now' : '') + '">v' + a.ver + (a.current ? ' · 当前' : '') + '</span>' : '') + '<small>' + (multi ? esc(x.note) + ' · ' : '') + '<span class="text-mono-sm">' + esc(x.by || a.by) + '</span> · ' + D.fmtAt(x.at) + '</small></div>';
  }
  function table(A, Bv) {
    var ra = rows(A), rb = rows(Bv), keys = [], la = {}, lb = {}, same = A.kind === Bv.kind;
    ra.forEach(function (r) { la[r[0]] = r; keys.push(r[0]); }); rb.forEach(function (r) { lb[r[0]] = r; if (keys.indexOf(r[0]) < 0) keys.push(r[0]); });
    return '<div class="ct"><div class="ct__lab">' + (A.id === Bv.id ? '<small>差值：新减旧</small>' : same ? '<small>差值：B 相对 A</small>' : '') + '</div>' + head(A, 'A') + head(Bv, 'B') + keys.map(function (k) {
      /* E-12: two versions of one asset always read new minus old; two different assets read right relative to left (said in the header) */
      var x = la[k], y = lb[k], lab = (x || y)[1], dif = same && x && y && x[2] !== y[2], flip = A.id === Bv.id && (A.ver || 0) > (Bv.ver || 0), dl = dif ? (flip ? delta(k, y[3], x[3]) : delta(k, x[3], y[3])) : '';
      return '<div class="ct__lab">' + lab + '</div><div class="ct__v' + (dif ? ' ct__v--d' : '') + '">' + (x ? esc(x[2]) : '—') + (dl && flip ? '<span class="ct__dl">' + dl + '</span>' : '') + '</div><div class="ct__v' + (dif ? ' ct__v--d' : '') + '">' + (y ? esc(y[2]) : '—') + (dl && !flip ? '<span class="ct__dl">' + dl + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  /* ── shared stage parts ── */
  function lab(k, a) { var vl = verLabel(a); return '<span class="clab"><i class="cpk__k">' + k.toUpperCase() + '</i>' + (vl ? vl + (a.current ? ' · 当前' : '') : esc(a.name)) + '</span>'; }
  /* the wipe divider — one control for every format: drag the line or its knob, ←/→ to nudge, double-click to centre.
   * Dragging anywhere else still belongs to the format (pan an image, turn a model). */
  function wipe(paneEl, onMove) {
    paneEl.insertAdjacentHTML('beforeend', '<div class="cw"><i class="cw__hit"></i><i class="cw__line"></i><button class="cw__knob" aria-label="分界线" title="拖动分界线 · 双击回到中间">' + I('chevron-left', 'bb-icon--12') + I('chevron-right', 'bb-icon--12') + '</button><span class="cw__tag cw__tag--a">A</span><span class="cw__tag cw__tag--b">B</span></div>');
    var w = paneEl.lastChild, knob = $('.cw__knob', w);
    function place(anim) { var W = paneEl.clientWidth; w.classList.toggle('anim', !!anim); w.style.setProperty('--x', C.wipe * W + 'px'); onMove(C.wipe * W, W, anim); }
    function down(e) {
      e.preventDefault(); e.stopPropagation(); var h = e.currentTarget; cap(h, e); w.classList.add('dragging');
      function mv(ev) { var p = pt(paneEl, ev); C.wipe = clamp(p.x / p.w, 0.02, 0.98); place(); }
      function up() { w.classList.remove('dragging'); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); }
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    }
    knob.addEventListener('pointerdown', down); $('.cw__hit', w).addEventListener('pointerdown', down);
    knob.addEventListener('dblclick', function (e) { e.stopPropagation(); C.wipe = 0.5; place(true); });
    knob.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); e.stopPropagation(); C.wipe = clamp(C.wipe + d * (e.shiftKey ? 0.1 : 0.02), 0.02, 0.98); place(); });
    place(); return { place: place, el: w };
  }
  function nudgeWipe(d) { C.wipe = clamp(C.wipe + d, 0.02, 0.98); if (R && R.wipe) R.wipe(); }
  function zoomCtl() { return '<div class="cz"><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-z="out" aria-label="缩小">' + I('minus', 'bb-icon--12') + '</button><span class="vw__num" data-zl></span><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-z="in" aria-label="放大">' + I('plus', 'bb-icon--12') + '</button><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-z="fit" aria-label="适应" title="适应 · 双击画面">' + I('focus', 'bb-icon--12') + '</button></div>'; }

  /* pan & zoom for flat media: one transform for every layer on the stage, so two panes move together */
  function panZoom(st, vs, onApply) {
    function apply(anim) {
      $$('.cl', st).forEach(function (c) { c.classList.toggle('anim', !!anim); c.style.transform = 'translate(' + vs.x + 'px,' + vs.y + 'px) scale(' + vs.z + ')'; });
      var zl = $('[data-zl]', st); if (zl) zl.textContent = Math.round(vs.z * 100) + '%';
      if (onApply) onApply(anim);
    }
    function at(z2, px, py, anim) { z2 = clamp(z2, 0.25, 16); vs.x = px - (px - vs.x) * (z2 / vs.z); vs.y = py - (py - vs.y) * (z2 / vs.z); vs.z = z2; apply(anim); }
    function paneOf(e) { return e.target.closest && e.target.closest('.cp'); }
    st.addEventListener('wheel', function (e) { var p = paneOf(e); if (!p || e.target.closest('.c3, .cfloat')) return; e.preventDefault(); var q = pt(p, e); at(vs.z * Math.exp(-e.deltaY * 0.0018), q.x - q.w / 2, q.y - q.h / 2); }, { passive: false });
    var drag = null;
    st.addEventListener('pointerdown', function (e) { if (e.button || !paneOf(e) || e.target.closest('.c3, .cw__knob, .cw__hit, .cfloat, .cz, button, input')) return; cap(st, e); drag = { x: e.clientX, y: e.clientY, sx: vs.x, sy: vs.y }; st.classList.add('grabbing'); });
    st.addEventListener('pointermove', function (e) { if (!drag) return; vs.x = drag.sx + (e.clientX - drag.x) / S.zoom; vs.y = drag.sy + (e.clientY - drag.y) / S.zoom; apply(); });
    function up() { drag = null; st.classList.remove('grabbing'); }
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    st.addEventListener('dblclick', function (e) { if (!paneOf(e) || e.target.closest('.c3, .cw, .cfloat, .cz')) return; vs.x = vs.y = 0; vs.z = 1; apply(true); });
    st.addEventListener('click', function (e) { var b = e.target.closest('[data-z]'); if (!b) return; var k = b.dataset.z; if (k === 'fit') { vs.x = vs.y = 0; vs.z = 1; apply(true); } else at(vs.z * (k === 'in' ? 1.25 : 0.8), 0, 0, true); });
    return { apply: apply };
  }
  function layer(k, inner, cls) { return '<div class="clw' + (cls ? ' ' + cls : '') + '" data-l="' + k + '"><div class="cl"><div class="cl__img">' + inner + '</div></div></div>'; }
  function artOf(a) { return a.art ? DEMO.art(a.art, Object.assign({}, a, { fit: 'meet' })) : '<div class="bb-cell__ph">' + I(L.KIND_ICON[a.kind] || 'file', 'bb-icon--24') + '</div>'; }
  function sizeOf(a) { return { w: a.w || (a.vb ? a.vb[0] * 8 : 1024), h: a.h || (a.vb ? a.vb[1] * 8 : 1024) }; }
  /* where each image sits: by proportion (both fill the same box) or by pixels (a smaller file looks smaller) */
  function dims(W, Hh, ra, rb, align) {
    var mw = Math.max(40, W - 56), mh = Math.max(40, Hh - 56);
    if (align === 'px') { var k = Math.min(mw / Math.max(ra.w, rb.w), mh / Math.max(ra.h, rb.h)); return [{ w: ra.w * k, h: ra.h * k }, { w: rb.w * k, h: rb.h * k }]; }
    function fit(r) { var ar = r.w / r.h, w = Math.min(mw, mh * ar); return { w: w, h: w / ar }; }
    return [fit(ra), fit(rb)];
  }
  function sizeImg(img, d, anim) { img.classList.toggle('anim', !!anim); img.style.width = d.w + 'px'; img.style.height = d.h + 'px'; img.style.marginLeft = -d.w / 2 + 'px'; img.style.marginTop = -d.h / 2 + 'px'; }

  var FMT = {};

  /* ── image ── */
  function raster(a, w, h, cb) {
    var im = new Image();
    im.onload = function () { var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d', { willReadFrequently: true }); try { x.drawImage(im, 0, 0, w, h); cb(c); } catch (err) { cb(null); } };
    im.onerror = function () { cb(null); };
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(artOf(a).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" '));
  }
  FMT.image = function (st, A, Bv) {
    var mode = C.mode, ra = sizeOf(A), rb = sizeOf(Bv), pz = panZoom(st, C.view, null), wp = null, token = 0;
    function draw() {
      mode = C.mode; wp = null; token++;
      if (mode === 'side') st.innerHTML = '<div class="cpanes"><div class="cp">' + layer('a', artOf(A)) + lab('a', A) + '</div><div class="cp">' + layer('b', artOf(Bv)) + lab('b', Bv) + '</div></div>';
      else if (mode === 'diff') st.innerHTML = '<div class="cpanes"><div class="cp">' + layer('d', '<canvas class="cd"></canvas>') + '<div class="cfloat cfloat--tr cd-read"><i class="cd-sw"></i><span>计算中</span></div></div></div>';
      else st.innerHTML = '<div class="cpanes"><div class="cp">' + layer('a', artOf(A)) + layer('b', artOf(Bv), mode === 'wipe' ? 'clw--clip' : '') + (mode === 'over' ? '<div class="cfloat cfloat--b cover"><i class="cpk__k">A</i><input class="bb-slider" type="range" min="0" max="100" value="' + Math.round(C.op * 100) + '" aria-label="B 的不透明度"><i class="cpk__k">B</i><span class="vw__num" data-op></span></div>' : '') + '</div></div>';
      $$('.cp', st)[0].insertAdjacentHTML('beforeend', zoomCtl());
      if (mode === 'wipe') wp = wipe($('.cp', st), function (x) { var b = $('[data-l="b"]', st); if (b) b.style.clipPath = 'inset(0 0 0 ' + x + 'px)'; });
      if (mode === 'over') { var sl = $('.cover .bb-slider', st); B.slider(sl, function (v) { C.op = v / 100; var b = $('[data-l="b"]', st); if (b) b.style.opacity = C.op; $('[data-op]', st).textContent = v + '%'; }); }
      layout(false); pz.apply(false);
      if (mode === 'diff') diff();
    }
    function boxes() { var p = $('.cp', st); return dims(p.clientWidth, p.clientHeight, ra, rb, C.pair === 'image' && (ra.w !== rb.w || ra.h !== rb.h) ? C.align : 'fit'); }
    function layout(anim) {
      if (!$('.cp', st)) return; var d = boxes();
      if (mode === 'diff') { var u = { w: Math.max(d[0].w, d[1].w), h: Math.max(d[0].h, d[1].h) }; sizeImg($('.cl__img', st), u, anim); if (anim) diff(); }
      else { sizeImg($('[data-l="a"] .cl__img', st), d[0], anim); sizeImg($('[data-l="b"] .cl__img', st), d[1], anim); }
      if (wp) wp.place();
    }
    /* differing pixels: both drawn into the same box, compared per channel, marked over a dimmed copy of A */
    function diff() {
      var my = ++token, d = boxes(), uw = Math.max(d[0].w, d[1].w), uh = Math.max(d[0].h, d[1].h), s = Math.min(1, 560 / Math.max(uw, uh)), cw = Math.max(2, Math.round(uw * s)), ch = Math.max(2, Math.round(uh * s));
      var wa = Math.round(d[0].w * s), ha = Math.round(d[0].h * s), wb = Math.round(d[1].w * s), hb = Math.round(d[1].h * s);
      raster(A, wa, ha, function (ia) { raster(Bv, wb, hb, function (ib) {
        if (my !== token || !ia || !ib) return;
        function onto(src, w, h) { var c = document.createElement('canvas'); c.width = cw; c.height = ch; var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, Math.round((cw - w) / 2), Math.round((ch - h) / 2)); return x.getImageData(0, 0, cw, ch).data; }
        var pa = onto(ia, wa, ha), pb = onto(ib, wb, hb), cv = $('.cd', st); if (!cv) return;
        cv.width = cw; cv.height = ch; var x = cv.getContext('2d'), out = x.createImageData(cw, ch), o = out.data, n = 0, area = 0;
        for (var i = 0; i < pa.length; i += 4) {
          var aa = pa[i + 3], ab = pb[i + 3]; if (aa < 8 && ab < 8) continue; area++;
          var dd = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(aa - ab));
          if (dd > 22) { n++; o[i] = 255; o[i + 1] = 56; o[i + 2] = 150; o[i + 3] = 255; }
          else { var g = Math.round((pa[i] * 0.3 + pa[i + 1] * 0.59 + pa[i + 2] * 0.11) * 0.32 + 18); o[i] = o[i + 1] = o[i + 2] = g; o[i + 3] = Math.max(aa, ab); }
        }
        x.putImageData(out, 0, 0);
        var rd = $('.cd-read span', st); if (rd) rd.textContent = n ? '不同 ' + (n / Math.max(1, area) * 100).toFixed(1) + '%' : '没有差异';
        $('.cd-read', st).classList.toggle('cd-read--none', !n);
      }); });
    }
    var ro = new ResizeObserver(function () { layout(false); }); ro.observe(st);
    draw();
    return { destroy: function () { ro.disconnect(); token++; }, setMode: function () { draw(); }, layout: layout, wipe: function () { if (wp) wp.place(); }, resize: function () { layout(false); } };
  };

  /* ── video: both play and scrub together ── */
  FMT.video = function (st, A, Bv) {
    var da = A.dur || 3, db = Bv.dur || 3, T = Math.max(da, db), play = false, raf = 0, last = 0, wp = null;
    function frame(a, d) { return App.videoFrame(Math.min(C.t, d), d); }
    function draw() {
      wp = null;
      var mode = C.mode, panes = mode === 'side' ? '<div class="cp">' + layer('a', frame(A, da)) + lab('a', A) + '</div><div class="cp">' + layer('b', frame(Bv, db)) + lab('b', Bv) + '</div>' : '<div class="cp">' + layer('a', frame(A, da)) + layer('b', frame(Bv, db), 'clw--clip') + '</div>';
      st.innerHTML = '<div class="cpanes">' + panes + '</div><div class="ctrans"><button class="bb-btn bb-btn--ghost bb-btn--icon" data-t="play" aria-label="播放" title="播放 空格"></button><span class="vw__num" data-tc></span><div class="ctl"><div class="ctl__end" style="left:' + da / T * 100 + '%" title="A 结束"></div><div class="ctl__end ctl__end--b" style="left:' + db / T * 100 + '%" title="B 结束"></div><div class="ctl__head"></div></div><span class="vw__num">' + tc(da) + ' · ' + tc(db) + '</span></div>';
      if (mode === 'wipe') wp = wipe($('.cp', st), function (x) { var b = $('[data-l="b"]', st); if (b) b.style.clipPath = 'inset(0 0 0 ' + x + 'px)'; });
      layout(); paint();
    }
    function layout() { $$('.cp', st).forEach(function (p) { var d = dims(p.clientWidth, p.clientHeight, { w: 1280, h: 720 }, { w: 1280, h: 720 }, 'fit'); $$('.cl__img', p).forEach(function (i) { sizeImg(i, d[0]); }); }); if (wp) wp.place(); }
    function paint() {
      var a = $('[data-l="a"] .cl__img', st), b = $('[data-l="b"] .cl__img', st); if (!a) return;
      a.innerHTML = frame(A, da); b.innerHTML = frame(Bv, db);
      $('.ctl__head', st).style.left = C.t / T * 100 + '%'; $('[data-tc]', st).textContent = tc(C.t);
      $('[data-t="play"]', st).innerHTML = I(play ? 'pause' : 'play');
      st.classList.toggle('cv-enda', C.t >= da); st.classList.toggle('cv-endb', C.t >= db);
    }
    function tick(now) { C.t += (now - last) / 1000; last = now; if (C.t >= T) C.t = 0; paint(); if (play) raf = requestAnimationFrame(tick); }
    function toggle() { play = !play; if (play) { last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); paint(); }
    var held = false;
    function seek(e) { var tl = $('.ctl', st), p = pt(tl, e); C.t = clamp(p.x / p.w, 0, 1) * T; paint(); }
    st.addEventListener('pointerdown', function (e) { if (!e.target.closest('.ctl')) return; cap(e.target.closest('.ctl'), e); held = true; seek(e); });
    st.addEventListener('pointermove', function (e) { if (held) seek(e); });
    st.addEventListener('pointerup', function () { held = false; });
    st.addEventListener('click', function (e) { if (e.target.closest('[data-t="play"]') || (e.target.closest('.cp') && !e.target.closest('.cw'))) toggle(); });
    var ro = new ResizeObserver(layout); ro.observe(st);
    draw();
    return { destroy: function () { cancelAnimationFrame(raf); ro.disconnect(); }, setMode: draw, wipe: function () { if (wp) wp.place(); }, resize: layout,
      key: function (e) { if (e.key === ' ') { toggle(); return true; } } };
  };

  /* ── audio: two waveforms on one time axis; A/B switches what you hear without moving the play head ── */
  FMT.audio = function (st, A, Bv) {
    var da = A.dur || 1, db = Bv.dur || 1, T = Math.max(da, db), play = false, raf = 0, last = 0, snd = null, P = { a: App.audioPeaks(A, 160), b: App.audioPeaks(Bv, 160) };
    function wave(k, a, d) {
      var bars = P[k].map(function (h, i) { return '<rect x="' + (i * 1000 / 160).toFixed(1) + '" y="' + (100 - h * 92).toFixed(1) + '" width="3.6" height="' + (h * 184).toFixed(1) + '" rx="1.2"/>'; }).join('');
      return '<div class="ca__row" data-k="' + k + '"><button class="ca__lab" data-ear="' + k + '" title="听 ' + k.toUpperCase() + '"><i class="cpk__k">' + k.toUpperCase() + '</i><span>' + (verLabel(a) || esc(a.name)) + '</span><small class="vw__num">' + tc(d) + '</small>' + I('volume-2', 'bb-icon--12') + '</button><div class="ca__track"><div class="ca__w" style="width:' + d / T * 100 + '%"><svg viewBox="0 0 1000 200" preserveAspectRatio="none">' + bars + '</svg><div class="ca__p"><svg viewBox="0 0 1000 200" preserveAspectRatio="none">' + bars + '</svg></div></div></div></div>';
    }
    st.innerHTML = '<div class="cpanes"><div class="ca"><div class="ca__rows">' + wave('a', A, da) + wave('b', Bv, db) + '<div class="ca__head"></div></div></div></div>' +
      '<div class="ctrans"><button class="bb-btn bb-btn--ghost bb-btn--icon" data-t="play" aria-label="播放" title="播放 空格"></button><span class="vw__num" data-tc></span><span class="bb-toolbar__grow"></span>' + seg('正在听', [['a', 'A'], ['b', 'B']], C.ear, ' data-ear-seg') + '<button class="bb-btn bb-btn--sm" data-t="flip" title="在 A 和 B 之间切换，位置不变">' + I('arrow-up-down', 'bb-icon--12') + '切换</button></div>';
    var rows = $('.ca__rows', st), headEl = $('.ca__head', st), sg = $('[data-ear-seg]', st), ctl;
    sg.setAttribute('data-wired', ''); ctl = B.segmented(sg, function (v) { ear(v, true); });
    function cur() { return C.ear === 'a' ? A : Bv; }
    function paint() {
      var tr = $('.ca__track', rows); headEl.style.left = tr.offsetLeft + tr.clientWidth * (C.t / T) + 'px';
      ['a', 'b'].forEach(function (k) { var r = $('[data-k="' + k + '"]', rows), w = $('.ca__w', r), d = k === 'a' ? da : db, p = $('.ca__p', r); p.style.width = clamp(C.t / d, 0, 1) * 100 + '%'; p.firstChild.style.width = w.clientWidth + 'px'; r.classList.toggle('on', C.ear === k); });
      $('[data-tc]', st).textContent = tc(C.t) + ' / ' + tc(T); $('[data-t="play"]', st).innerHTML = I(play ? 'pause' : 'play');
    }
    function stop() { play = false; cancelAnimationFrame(raf); if (snd) snd.stop(); snd = null; paint(); }
    function start() { if (C.t >= T - 0.01) C.t = 0; play = true; snd = App.audioSynth(cur(), C.t, 0.7); last = performance.now(); raf = requestAnimationFrame(tick); paint(); }
    function tick(now) { C.t += (now - last) / 1000; last = now; if (C.t >= T) { C.t = T; return stop(); } paint(); if (play) raf = requestAnimationFrame(tick); }
    function ear(k, fromSeg) { if (C.ear === k) return; C.ear = k; if (!fromSeg) ctl.pick($('[data-value="' + k + '"]', sg)); if (play) { if (snd) snd.stop(); snd = App.audioSynth(cur(), C.t, 0.7); } paint(); }
    rows.addEventListener('pointerdown', function (e) { var w = e.target.closest('.ca__track'); if (!w) return; var p = pt(w, e); C.t = clamp(p.x / p.w, 0, 1) * T; var k = w.parentNode.dataset.k; if (C.ear !== k) ear(k); else if (play) { if (snd) snd.stop(); snd = App.audioSynth(cur(), C.t, 0.7); } paint(); });
    st.addEventListener('click', function (e) { var b = e.target.closest('[data-t], [data-ear]'); if (!b) return; if (b.dataset.ear) return ear(b.dataset.ear); if (b.dataset.t === 'play') { if (play) stop(); else start(); } if (b.dataset.t === 'flip') ear(C.ear === 'a' ? 'b' : 'a'); });
    var ro = new ResizeObserver(paint); ro.observe(st); paint();
    return { destroy: function () { stop(); ro.disconnect(); },
      key: function (e) { if (e.key === ' ') { if (play) stop(); else start(); return true; } } };
  };

  /* ── text: line by line ── */
  function lineDiff(a, b) {
    var n = a.length, m = b.length, dp = [], i, j, out = [];
    for (i = 0; i <= n; i++) dp.push(new Int16Array(m + 1));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { out.push(['=', i, j]); i++; j++; }
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { out.push(['+', null, j]); j++; }
      else { out.push(['-', i, null]); i++; }
    }
    return out;
  }
  FMT.text = function (st, A, Bv) {
    var la = App.docText(A).replace(/\n$/, '').split('\n'), lb = App.docText(Bv).replace(/\n$/, '').split('\n'), ops = lineDiff(la, lb), add = 0, del = 0;
    ops.forEach(function (o) { if (o[0] === '+') add++; if (o[0] === '-') del++; });
    function cell(n, t, cls) { return '<span class="cx__n">' + (n == null ? '' : n + 1) + '</span><span class="cx__t' + (cls ? ' ' + cls : '') + '">' + (t == null ? '' : esc(t) || ' ') + '</span>'; }
    function sideRows() {
      var rows = [], k = 0;
      while (k < ops.length) {
        if (ops[k][0] === '=') { rows.push('<div class="cx__r">' + cell(ops[k][1], la[ops[k][1]]) + cell(ops[k][2], lb[ops[k][2]]) + '</div>'); k++; continue; }
        var dels = [], adds = []; while (k < ops.length && ops[k][0] !== '=') { (ops[k][0] === '-' ? dels : adds).push(ops[k]); k++; }
        for (var r = 0; r < Math.max(dels.length, adds.length); r++) { var d = dels[r], a = adds[r]; rows.push('<div class="cx__r cx__r--c">' + (d ? cell(d[1], la[d[1]], 'cx__t--del') : cell(null, null, 'cx__t--gap')) + (a ? cell(a[2], lb[a[2]], 'cx__t--add') : cell(null, null, 'cx__t--gap')) + '</div>'); }
      }
      return rows.join('');
    }
    function oneRows() { return ops.map(function (o) { var t = o[0] === '+' ? lb[o[2]] : la[o[1]]; return '<div class="cx__r cx__r--u' + (o[0] === '+' ? ' cx__r--add' : o[0] === '-' ? ' cx__r--del' : '') + '"><span class="cx__n">' + (o[1] == null ? '' : o[1] + 1) + '</span><span class="cx__n">' + (o[2] == null ? '' : o[2] + 1) + '</span><span class="cx__g">' + (o[0] === '=' ? '' : o[0] === '+' ? '+' : '−') + '</span><span class="cx__t">' + (esc(t) || ' ') + '</span></div>'; }).join(''); }
    function draw() { st.innerHTML = '<div class="cpanes"><div class="cx' + (C.mode === 'side' ? ' cx--side' : ' cx--one') + '">' + (C.mode === 'side' ? '<div class="cx__r cx__r--h"><span></span>' + lab('a', A) + '<span></span>' + lab('b', Bv) + '</div>' + sideRows() : oneRows()) + '</div></div>'; }
    draw();
    return { counts: [add, del], setMode: draw };
  };

  /* ── 3D: one renderer; two scenes side by side (one shared camera, so they turn together) or split by the wipe line ── */
  var VIEWS3 = { persp: [null, null, '透视'], front: [0, Math.PI / 2, '正'], side: [Math.PI / 2, Math.PI / 2, '侧'], back: [Math.PI, Math.PI / 2, '背'], top: [0, 0.0015, '顶'] };
  /* the studio environment and one lit scene per model; shared by the 3D compare and the turnaround overlay */
  function stage3(r, list, env) {
    var T = window.THREE, M3 = App.m3, pm = new T.PMREMGenerator(r), es = new T.Scene(), geo = new T.SphereGeometry(20, 32, 16), pos = geo.attributes.position, cols = [], top = new T.Color(env.sky[0]), bot = new T.Color(env.sky[1]);
    for (var i = 0; i < pos.count; i++) { var k = clamp(pos.getY(i) / 40 + 0.5, 0, 1), c = bot.clone().lerp(top, k); cols.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3)); es.add(new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    env.lights.forEach(function (l) { var p = new T.Mesh(new T.PlaneGeometry(5, 5), new T.MeshBasicMaterial({ color: new T.Color(l[0]).multiplyScalar(l[1]), side: T.DoubleSide })); p.position.set(l[2][0] * 3, l[2][1] * 3, l[2][2] * 3); p.lookAt(0, 0, 0); es.add(p); });
    var envRT = pm.fromScene(es, 0.03);
    var scenes = list.map(function (a) {
      var sc = new T.Scene(), def = M3.defFor(a), M = def.build(def); sc.add(M.root); sc.environment = envRT.texture;
      M.root.traverse(function (m) { if (m.isMesh) { m.material = M3.matFor('full', m.userData.role, def); m.castShadow = m.receiveShadow = true; } });
      var bb = new T.Box3().setFromObject(M.root), ctr = bb.getCenter(new T.Vector3());
      var key = new T.DirectionalLight(0xffffff, 1.8); key.position.set(ctr.x + 3, ctr.y + 3.6, ctr.z + 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0008; key.shadow.radius = 3;
      var sc2 = key.shadow.camera; sc2.left = sc2.bottom = -2; sc2.right = sc2.top = 2; sc2.near = 0.1; sc2.far = 14; key.target.position.copy(ctr); sc.add(key); sc.add(key.target);
      var g = new T.Mesh(new T.PlaneGeometry(10, 10), new T.ShadowMaterial({ opacity: 0.34 })); g.rotation.x = -Math.PI / 2; g.position.y = bb.min.y; g.receiveShadow = true; sc.add(g);
      return { sc: sc, M: M, bb: bb, ground: g, key: key };
    });
    return { envRT: envRT, pm: pm, scenes: scenes };
  }
  function view3d(box, list, mode, o) {
    o = o || {}; var T = window.THREE, M3 = App.m3, r;
    if (!T || !M3) { box.innerHTML = '<div class="bb-empty"><h3 class="bb-empty__title">无法显示 3D</h3></div>'; return { destroy: function () {}, setMode: function () {} }; }
    try { r = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { box.innerHTML = '<div class="bb-empty"><h3 class="bb-empty__title">浏览器不支持 WebGL</h3></div>'; return { destroy: function () {}, setMode: function () {} }; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = 1, Hh = 1, dirty = true, raf = 0, last = performance.now();
    r.setPixelRatio(dpr); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap; r.setClearColor(0x000000, 0);
    var env = M3.envOf('studio'); box.classList.add('c3'); box.style.background = M3.grad(env);
    box.insertAdjacentHTML('afterbegin', '<div class="c3__ui"></div>'); box.insertBefore(r.domElement, box.firstChild);
    var ui = $('.c3__ui', box), S3 = stage3(r, list, env), envRT = S3.envRT, pm = S3.pm, scenes = S3.scenes;
    var bb0 = scenes[0].bb, size = bb0.getSize(new T.Vector3()), center = bb0.getCenter(new T.Vector3()), R0 = Math.max(size.x, size.y, size.z) * 3.1;
    var persp = new T.PerspectiveCamera(35, 1, 0.01, 100), ortho = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 100), orth = false, vk = 'persp';
    var orb = { th: 0.62, ph: 1.12, r: R0, vth: 0, vph: 0, goal: null, drag: null };
    function cam() { return orth ? ortho : persp; }
    function place(w, h) {
      var c = cam(), sp = Math.sin(orb.ph); c.position.set(center.x + orb.r * sp * Math.sin(orb.th), center.y + orb.r * Math.cos(orb.ph), center.z + orb.r * sp * Math.cos(orb.th)); c.up.set(0, 1, 0); c.lookAt(center);
      if (orth) { var hh = orb.r * Math.tan(35 * Math.PI / 360); ortho.left = -hh * w / h; ortho.right = hh * w / h; ortho.top = hh; ortho.bottom = -hh; } else persp.aspect = w / h;
      c.updateProjectionMatrix();
    }
    function render() {
      r.setScissorTest(true); r.setClearColor(0x000000, 0);
      scenes.forEach(function (s) { s.ground.visible = !orth; });
      if (mode === 'side' && scenes[1]) { var hw = Math.floor(W / 2); place(hw, Hh); [0, 1].forEach(function (k) { r.setViewport(k * hw, 0, hw, Hh); r.setScissor(k * hw, 0, hw, Hh); r.render(scenes[k].sc, cam()); }); }
      else if (mode === 'wipe' && scenes[1]) { var x = Math.round(C.wipe * W); place(W, Hh); r.setViewport(0, 0, W, Hh); r.setScissor(0, 0, x, Hh); r.render(scenes[0].sc, cam()); r.setScissor(x, 0, W - x, Hh); r.render(scenes[1].sc, cam()); }
      else { place(W, Hh); r.setViewport(0, 0, W, Hh); r.setScissor(0, 0, W, Hh); r.render(scenes[0].sc, cam()); }
    }
    function wrap(x) { return Math.atan2(Math.sin(x), Math.cos(x)); }
    function loop(now) {
      var dt = Math.min(0.05, (now - last) / 1000), moving = false; last = now;
      if (!orb.drag) {
        if (orb.goal) { var e = 1 - Math.exp(-dt * 11); orb.th += (orb.goal.th - orb.th) * e; orb.ph += (orb.goal.ph - orb.ph) * e; moving = true; if (Math.abs(orb.th - orb.goal.th) + Math.abs(orb.ph - orb.goal.ph) < 1e-4) { orb.th = orb.goal.th; orb.ph = orb.goal.ph; orb.goal = null; } }
        else if (Math.abs(orb.vth) + Math.abs(orb.vph) > 1e-3) { var kk = Math.exp(-dt * 4.5); orb.th += orb.vth * dt; orb.ph = clamp(orb.ph + orb.vph * dt, 0.06, Math.PI - 0.06); orb.vth *= kk; orb.vph *= kk; moving = true; }
      }
      if (moving || dirty) { dirty = false; render(); }
      raf = requestAnimationFrame(loop);
    }
    function resize() { W = Math.max(1, box.clientWidth); Hh = Math.max(1, box.clientHeight); r.setSize(W, Hh, false); dirty = true; if (wp) wp.place(); }
    var trk = B.tracker(), cv = r.domElement;
    cv.addEventListener('pointerdown', function (e) { cap(cv, e); orb.goal = null; trk.reset(); trk.add(e); orb.drag = { x: e.clientX, y: e.clientY, th: orb.th, ph: orb.ph }; box.classList.add('dragging'); });
    cv.addEventListener('pointermove', function (e) { var d = orb.drag; if (!d) return; trk.add(e); orb.th = d.th - (e.clientX - d.x) / S.zoom * 0.008; orb.ph = clamp(d.ph - (e.clientY - d.y) / S.zoom * 0.008, 0.06, Math.PI - 0.06); if (vk !== 'persp' && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) setActive(null); dirty = true; });
    function rel() { if (!orb.drag) return; orb.drag = null; box.classList.remove('dragging'); var v = trk.velocity(); orb.vth = -v.x / S.zoom * 0.008; orb.vph = -v.y / S.zoom * 0.008; }
    cv.addEventListener('pointerup', rel); cv.addEventListener('pointercancel', rel);
    cv.addEventListener('wheel', function (e) { e.preventDefault(); orb.r = clamp(orb.r * Math.exp(e.deltaY * 0.0012), R0 * 0.3, R0 * 3); dirty = true; }, { passive: false });
    cv.addEventListener('dblclick', function () { orb.r = R0; setView('persp'); });
    function setActive(k) { vk = k || 'none'; $$('[data-v3]', ui).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v3 === vk); }); }
    function setView(k) {
      var v = VIEWS3[k]; orth = k !== 'persp';
      orb.goal = k === 'persp' ? { th: orb.th + wrap(0.62 - orb.th), ph: 1.12 } : { th: orb.th + wrap(v[0] - orb.th), ph: v[1] }; orb.vth = orb.vph = 0;
      setActive(k); dirty = true; if (o.onView) o.onView(k);
    }
    var wp = null;
    function ui3() {
      wp = null;
      ui.innerHTML = '<div class="c3__views" role="toolbar" aria-label="视图">' + Object.keys(VIEWS3).map(function (k) { return '<button class="c3__v" data-v3="' + k + '" aria-pressed="' + (k === vk) + '" title="' + (k === 'persp' ? '透视' : VIEWS3[k][2] + '视图（正交）') + '">' + VIEWS3[k][2] + '</button>'; }).join('') + (o.linkable ? '<i class="c3__sep"></i><button class="c3__v c3__link" data-link aria-pressed="' + C.link + '" title="选视图时，图片跟着定位到同一个视图">' + I('link', 'bb-icon--12') + '</button>' : '') + '</div>' +
        (mode === 'side' && scenes[1] ? '<i class="c3__mid"></i>' + lab('a', list[0]).replace('clab', 'clab clab--l') + lab('b', list[1]).replace('clab', 'clab clab--r') : '') + (o.label || '');
      if (mode === 'wipe' && scenes[1]) wp = wipe(box, function () { dirty = true; });
    }
    ui.addEventListener('click', function (e) { var b = e.target.closest('[data-v3]'); if (b) return setView(b.dataset.v3); var l = e.target.closest('[data-link]'); if (l) { C.link = !C.link; l.setAttribute('aria-pressed', C.link); if (C.link && o.onView && vk !== 'persp' && vk !== 'none') o.onView(vk); } });
    ui3(); var ro = new ResizeObserver(resize); ro.observe(box); resize(); raf = requestAnimationFrame(loop);
    return {
      setMode: function (m) { mode = m; if (wp) { wp.el.remove(); wp = null; } ui3(); dirty = true; },
      wipe: function () { if (wp) wp.place(); },
      view: setView,
      destroy: function () { cancelAnimationFrame(raf); ro.disconnect(); envRT.dispose(); pm.dispose(); scenes.forEach(function (s) { s.sc.traverse(function (m) { if (m.geometry) m.geometry.dispose(); }); }); r.dispose(); try { r.forceContextLoss(); } catch (err) { /* already gone */ } }
    };
  }
  FMT.model = function (st, A, Bv) {
    st.innerHTML = '<div class="cpanes"><div class="cp cp--3d"></div></div>';
    var v = view3d($('.cp', st), [A, Bv], C.mode);
    return { destroy: v.destroy, setMode: function (m) { v.setMode(m); }, wipe: v.wipe };
  };

  /* ── a model against an image (turnaround sheet): pick 正/侧/背/顶 on the model, the sheet frames the same view ── */
  /* wipe / overlay: the model drawn orthographically, scaled and placed onto the matching view of the sheet.
   * The drawing's object box (marked once per sheet) and the model's bounding box share their bottom edge and centre;
   * they match in height (or width), so what is left over is the proportion error — boxed, and given as a number. */
  var VDIR = { front: [[0, 0, 1], [0, 1, 0]], side: [[1, 0, 0], [0, 1, 0]], back: [[0, 0, -1], [0, 1, 0]], top: [[0, 1, 0], [0, 0, -1]] };
  function overlayMI(st, A, Bv) {
    var T = window.THREE, M3 = App.m3, mFirst = A.kind === 'model', M = mFirst ? A : Bv, P = mFirst ? Bv : A, rp = sizeOf(P), mode = C.mode, r;
    var V = C.views, keys = VORD.filter(function (x) { return V[x]; }), k = C.mv && V[C.mv] ? C.mv : keys[0], vz = { z: 1, x: 0, y: 0 }, mk = mFirst ? 'A' : 'B', pk = mFirst ? 'B' : 'A', wp = null;
    st.innerHTML = '<div class="cpanes"><div class="cp cal"><div class="cal__img">' + artOf(P) + '</div><div class="cal__m' + (mode === 'wipe' ? ' cal__m--bg' : '') + '"></div><svg class="cal__g"></svg><div class="cal__dims"></div>' +
      '<div class="c3__views cal__views" role="toolbar" aria-label="视图">' + keys.map(function (x) { return '<button class="c3__v" data-v3="' + x + '" aria-pressed="' + (x === k) + '" title="' + V[x][4] + '视图（正交）">' + V[x][4] + '</button>'; }).join('') + '</div>' +
      '<div class="cfloat cal__r"></div>' +
      (mode === 'over' ? '<div class="cfloat cfloat--b cover"><i class="cpk__k">' + pk + '</i><input class="bb-slider" type="range" min="0" max="100" value="' + Math.round(C.op * 100) + '" aria-label="模型的不透明度"><i class="cpk__k">' + mk + '</i><span class="vw__num" data-op></span></div>' : '') +
      zoomCtl() + '</div></div>';
    var pane = $('.cal', st), img = $('.cal__img', st), mbox = $('.cal__m', st), gsvg = $('.cal__g', st), chip = $('.cal__r', st);
    if (!T || !M3) { mbox.innerHTML = '<div class="bb-empty"><h3 class="bb-empty__title">无法显示 3D</h3></div>'; return {}; }
    try { r = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { mbox.innerHTML = '<div class="bb-empty"><h3 class="bb-empty__title">浏览器不支持 WebGL</h3></div>'; return {}; }
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.setClearColor(0x000000, 0);
    var env = M3.envOf('studio'); if (mode === 'wipe') mbox.style.background = M3.grad(env);
    mbox.appendChild(r.domElement);
    var S3 = stage3(r, [M], env), sc = S3.scenes[0], bb = sc.bb, cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 40), W = 0, Hh = 0;
    var dimsEl = $('.cal__dims', st), tgt = App.targetOf(P) || App.targetOf(M), IMP = implied(V, rp, tgt);
    sc.ground.visible = false;
    function guides(R, Mr) {
      function rect(q, cls) { return '<rect class="' + cls + '" x="' + q.x.toFixed(1) + '" y="' + q.y.toFixed(1) + '" width="' + q.w.toFixed(1) + '" height="' + q.h.toFixed(1) + '"/>'; }
      var s = rect(R, 'cal__gd') + rect(Mr, 'cal__gm'), labs = '';
      /* dimension lines on the drawing, from the design object's size and the sheet's own scale — an overlay, never written into the image */
      var d = IMP && IMP[k];
      if (d) {
        var y = R.y + R.h + 14, x = R.x + R.w + 14;
        s += '<path class="cal__dl" d="M' + R.x + ' ' + y + 'H' + (R.x + R.w) + 'M' + R.x + ' ' + (y - 4) + 'v8M' + (R.x + R.w) + ' ' + (y - 4) + 'v8M' + x + ' ' + R.y + 'V' + (R.y + R.h) + 'M' + (x - 4) + ' ' + R.y + 'h8M' + (x - 4) + ' ' + (R.y + R.h) + 'h8"/>';
        labs = [[d[0], R.x + R.w / 2, y, 'h'], [d[1], x, R.y + R.h / 2, 'v']].map(function (q) {
          var v = q[0], bad = off(v[1], v[2]);
          return '<span class="cal__dim cal__dim--' + q[3] + (bad ? ' bad' : '') + '" style="left:' + q[1].toFixed(1) + 'px;top:' + q[2].toFixed(1) + 'px" title="' + AXN[v[0]] + '：按正视图的比例量出 ' + v[1].toFixed(2) + ' m，设计对象写的是 ' + v[2].toFixed(2) + ' m">' + AXN[v[0]] + ' ' + v[1].toFixed(2) + ' m' + (bad ? '<small>应为 ' + v[2].toFixed(2) + '</small>' : '') + '</span>';
        }).join('');
      }
      gsvg.innerHTML = s; dimsEl.innerHTML = labs;
    }
    function ratio(ma, da, mw, mh) {
      var dev = ma / da - 1, bad = Math.abs(dev) > 0.05, ax = AXES[k], fit = '';
      if (tgt) { var tw = tgt[ax[0]], th = tgt[ax[1]], ok = !off(mw, tw) && !off(mh, th); fit = '<span class="cal__l">尺寸</span><span class="cal__k"><i class="cal__sw cal__sw--m"></i>模型</span><b class="vw__num">' + mw.toFixed(2) + ' × ' + mh.toFixed(2) + ' m</b><span class="cal__k">目标</span><b class="vw__num">' + tw.toFixed(2) + ' × ' + th.toFixed(2) + ' m</b><span class="cal__dev' + (ok ? '' : ' bad') + '">' + (ok ? '一致' : '不符') + '</span>'; }
      chip.innerHTML = '<div class="cal__row"><span class="cal__l">宽高比</span><span class="cal__k"><i class="cal__sw cal__sw--d"></i>四视图</span><b class="vw__num">' + da.toFixed(2) + '</b><span class="cal__k"><i class="cal__sw cal__sw--m"></i>模型</span><b class="vw__num">' + ma.toFixed(2) + '</b>' +
        '<span class="cal__dev' + (bad ? ' bad' : '') + '">' + (Math.abs(dev) < 0.005 ? '一致' : (dev > 0 ? '+' : '−') + Math.abs(dev * 100).toFixed(1) + '%') + '</span></div>' + (fit ? '<div class="cal__row">' + fit + '</div>' : '');
    }
    function layout() {
      var w = pane.clientWidth, h = pane.clientHeight; if (w < 10 || h < 10) return;
      if (w !== W || h !== Hh) { W = w; Hh = h; r.setSize(W, Hh, false); }
      var o = V[k][5], ar = rp.h / rp.w, sw = Math.min(W * 0.56 / o[2], Hh * 0.56 / (o[3] * ar)) * vz.z, sh = sw * ar;
      var left = W / 2 + vz.x - (o[0] + o[2] / 2) * sw, top = Hh / 2 + vz.y - (o[1] + o[3] / 2) * sh;
      img.style.left = left + 'px'; img.style.top = top + 'px'; img.style.width = sw + 'px'; img.style.height = sh + 'px';
      var R = { x: left + o[0] * sw, y: top + o[1] * sh, w: o[2] * sw, h: o[3] * sh };
      var d = VDIR[k], ctr = bb.getCenter(new T.Vector3());
      cam.position.set(ctr.x + d[0][0] * 10, ctr.y + d[0][1] * 10, ctr.z + d[0][2] * 10); cam.up.set(d[1][0], d[1][1], d[1][2]); cam.lookAt(ctr); cam.updateMatrixWorld(true);
      var inv = cam.matrixWorldInverse, nx = Infinity, xx = -Infinity, ny = Infinity, xy = -Infinity;
      [bb.min.x, bb.max.x].forEach(function (x) { [bb.min.y, bb.max.y].forEach(function (y) { [bb.min.z, bb.max.z].forEach(function (z) { var p = new T.Vector3(x, y, z).applyMatrix4(inv); nx = Math.min(nx, p.x); xx = Math.max(xx, p.x); ny = Math.min(ny, p.y); xy = Math.max(xy, p.y); }); }); });
      var mw = xx - nx, mh = xy - ny, ppm = C.fitBy === 'w' ? R.w / mw : R.h / mh, lft = (nx + xx) / 2 - (R.x + R.w / 2) / ppm, tp = ny + (R.y + R.h) / ppm;
      cam.left = lft; cam.right = lft + W / ppm; cam.top = tp; cam.bottom = tp - Hh / ppm; cam.updateProjectionMatrix();
      r.render(sc.sc, cam);
      guides(R, { x: R.x + R.w / 2 - mw * ppm / 2, y: R.y + R.h - mh * ppm, w: mw * ppm, h: mh * ppm });
      ratio(mw / mh, R.w / R.h, mw, mh);
      var zl = $('[data-zl]', pane); if (zl) zl.textContent = Math.round(vz.z * 100) + '%';
      if (wp) wp.place();
    }
    if (mode === 'wipe') wp = wipe(pane, function (x, w) { mbox.style.clipPath = mFirst ? 'inset(0 ' + Math.max(0, w - x) + 'px 0 0)' : 'inset(0 0 0 ' + x + 'px)'; });
    if (mode === 'over') { var sl = $('.cover .bb-slider', st); B.slider(sl, function (v) { C.op = v / 100; mbox.style.opacity = C.op; $('[data-op]', st).textContent = v + '%'; }); }
    /* pan and zoom move the sheet and the model together */
    function zoomAt(z2, px, py) { z2 = clamp(z2, 0.3, 8); var cx = W / 2 + vz.x, cy = Hh / 2 + vz.y; cx = px + (cx - px) * z2 / vz.z; cy = py + (cy - py) * z2 / vz.z; vz.x = cx - W / 2; vz.y = cy - Hh / 2; vz.z = z2; layout(); }
    pane.addEventListener('wheel', function (e) { e.preventDefault(); var q = pt(pane, e); zoomAt(vz.z * Math.exp(-e.deltaY * 0.0018), q.x, q.y); }, { passive: false });
    var drag = null;
    pane.addEventListener('pointerdown', function (e) { if (e.button || e.target.closest('.cw__knob, .cw__hit, .cfloat, .cz, button, input')) return; cap(pane, e); drag = { x: e.clientX, y: e.clientY, sx: vz.x, sy: vz.y }; pane.classList.add('grabbing'); });
    pane.addEventListener('pointermove', function (e) { if (!drag) return; vz.x = drag.sx + (e.clientX - drag.x) / S.zoom; vz.y = drag.sy + (e.clientY - drag.y) / S.zoom; layout(); });
    function up() { drag = null; pane.classList.remove('grabbing'); }
    pane.addEventListener('pointerup', up); pane.addEventListener('pointercancel', up);
    pane.addEventListener('dblclick', function (e) { if (e.target.closest('.cw, .cfloat, .cz, .cal__views')) return; vz = { z: 1, x: 0, y: 0 }; layout(); });
    pane.addEventListener('click', function (e) {
      var v = e.target.closest('[data-v3]'); if (v) { k = C.mv = v.dataset.v3; $$('[data-v3]', pane).forEach(function (b) { b.setAttribute('aria-pressed', b === v); }); vz = { z: 1, x: 0, y: 0 }; return layout(); }
      var z = e.target.closest('[data-z]'); if (z) { if (z.dataset.z === 'fit') { vz = { z: 1, x: 0, y: 0 }; layout(); } else zoomAt(vz.z * (z.dataset.z === 'in' ? 1.25 : 0.8), W / 2, Hh / 2); }
    });
    var ro = new ResizeObserver(layout); ro.observe(pane); layout();
    return {
      layout: layout, wipe: function () { if (wp) wp.place(); }, resize: layout,
      destroy: function () { ro.disconnect(); S3.envRT.dispose(); S3.pm.dispose(); sc.sc.traverse(function (m) { if (m.geometry) m.geometry.dispose(); }); r.dispose(); try { r.forceContextLoss(); } catch (err) { /* already gone */ } }
    };
  }
  FMT.mi = function (st, A, Bv) {
    if (C.mode !== 'side') return overlayMI(st, A, Bv);
    var mFirst = A.kind === 'model', M = mFirst ? A : Bv, P = mFirst ? Bv : A, rp = sizeOf(P), vs = { z: 1, x: 0, y: 0 }, mark = null, V = C.views;
    var imgPane = '<div class="cp">' + layer('i', artOf(P) + '<i class="cv-box" hidden><b></b></i>') + lab(mFirst ? 'b' : 'a', P) + zoomCtl() + '</div>';
    st.innerHTML = '<div class="cpanes">' + (mFirst ? '<div class="cp cp--3d"></div>' + imgPane : imgPane + '<div class="cp cp--3d"></div>') + '</div>';
    var ipane = $$('.cp', st).filter(function (p) { return !p.classList.contains('cp--3d'); })[0], img = $('.cl__img', ipane), box = $('.cv-box', ipane);
    var pz = panZoom(st, vs, null);
    function layout() { var d = dims(ipane.clientWidth, ipane.clientHeight, rp, rp, 'fit')[0]; sizeImg(img, d); if (mark) frame(mark, false); }
    function frame(k, anim) {
      var r = V && V[k]; mark = k; box.hidden = !r; if (!r) { vs.x = vs.y = 0; vs.z = 1; return pz.apply(anim); }
      box.style.left = r[0] * 100 + '%'; box.style.top = r[1] * 100 + '%'; box.style.width = r[2] * 100 + '%'; box.style.height = r[3] * 100 + '%'; $('b', box).textContent = r[4];
      var iw = img.offsetWidth, ih = img.offsetHeight, z = Math.min(ipane.clientWidth * 0.86 / (r[2] * iw), ipane.clientHeight * 0.86 / (r[3] * ih));
      vs.z = clamp(z, 0.25, 16); vs.x = -((r[0] + r[2] / 2) - 0.5) * iw * vs.z; vs.y = -((r[1] + r[3] / 2) - 0.5) * ih * vs.z; pz.apply(anim);
    }
    var v = view3d($('.cp--3d', st), [M], 'one', { linkable: !!V, label: lab(mFirst ? 'a' : 'b', M).replace('clab', 'clab clab--l'), onView: function (k) { if (!V) return; if (V[k]) C.mv = k; if (k === 'persp') { mark = null; box.hidden = true; vs.x = vs.y = 0; vs.z = 1; return pz.apply(true); } if (C.link) frame(k, true); } });
    var ro = new ResizeObserver(layout); ro.observe(ipane); layout(); pz.apply(false);
    if (V) setTimeout(function () { if (R && R.view) R.view(C.mv && V[C.mv] ? C.mv : VORD.filter(function (x) { return V[x]; })[0]); }, 60);
    return { destroy: function () { ro.disconnect(); v.destroy(); }, view: v.view };
  };

  /* ── anything else: the two viewers, side by side ── */
  FMT.pair = function (st, A, Bv) {
    st.innerHTML = '<div class="cpanes"><div class="cp cp--v"><div class="cpv"></div>' + lab('a', A) + '</div><div class="cp cp--v"><div class="cpv"></div>' + lab('b', Bv) + '</div></div>';
    var hs = $$('.cpv', st); App.mountViewer(hs[0], A, { compact: true, still: true }); App.mountViewer(hs[1], Bv, { compact: true, still: true });
    return { destroy: function () { hs.forEach(function (h) { if (h._viewer) h._viewer.destroy(); }); } };
  };

  /* ── keys ── */
  App.cmpKey = function (e) {
    if (App.modal) return;
    if (e.metaKey || e.ctrlKey) { if (e.key === '[') { e.preventDefault(); App.closeCompare(); } return; }
    if (R && R.key && R.key(e)) { e.preventDefault(); return; }
    var k = e.key;  /* modes, swap and the info table are mouse-only: single-key shortcuts were dropped */
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && C.mode === 'wipe') { e.preventDefault(); nudgeWipe((k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.02)); }
  };

  /* ── restoring an old version: a new version with the old content; downstream gets "upstream changed" ── */
  App.confirmRestore = function (a, n, done) {
    /* E-18: only downstream made from different content gets 上游已更新 — one made from vn itself matches by fingerprint */
    var vs = D.versions(a), cur = vs[vs.length - 1], next = vs.length + 1, down = D.rel(a).down.filter(function (x) { if (!x.a) return false; var e = D.EDGES.filter(function (y) { return y.from === x.a.id && y.to === a.id && y.type === 'source'; })[0], b = e && D.toVerAt(e, 8.64e15); return !(b && b.v === n); });
    App.dialog({ title: '把 v' + n + ' 恢复为当前版本？', text: '会新增一条记录 v' + next + '，内容与 v' + n + ' 相同；v' + cur.v + ' 仍保留在历史里。' + (a.review !== 'exempt' ? '校验回到待审。' : '') + (down.length ? '下游 ' + down.length + ' 个资产会提示上游已更新。' : ''),
      actions: [{ label: '取消' }, { label: '恢复为当前版本', kind: 'primary', act: function () {
        var rv = a.review, flagged = [];
        var nv = D.restore(a, n, App.me()); if (a.review !== 'exempt') a.review = 'pending';
        down.forEach(function (x) { if (!x.a.issue) { x.a.issue = 'stale'; D.counts.issues++; flagged.push(x.a); } });
        App.render(); if (App.detailRefresh) App.detailRefresh(); if (done) done(nv);
        /* E-19: undoing appends again — back to what vcur was, as one more version; the history is never cut */
        App.toast(a.name + ' 已恢复为 v' + n + ' 的内容，记为 v' + nv.v, function () {
          D.restore(a, cur.v, App.me()); a.review = rv; flagged.forEach(function (x) { x.issue = null; D.counts.issues--; });
          App.render(); if (App.detailRefresh) App.detailRefresh(); if (done) done(null);
        });
      } }] });
  };

  /* ── the 版本 tab ── */
  function pluginDialog(after) {
    var pick = 'lore', P = [['lore', 'Lore', 'git-fork', '为美术大文件设计'], ['lfs', 'Git LFS', 'hard-drive', '适合已经在用 Git 的团队']];
    var d = App.dialog({ title: '选择版本插件', form: true, body: '<div class="vpl" role="radiogroup">' + P.map(function (p) { return '<button class="vpl__o" role="radio" data-p="' + p[0] + '" aria-checked="' + (p[0] === pick) + '">' + I(p[2]) + '<span><b>' + p[1] + '</b><small>' + p[3] + '</small></span><i class="vpl__r"></i></button>'; }).join('') + '</div><p class="vpl__n">已有的版本记录不会补上内容，从安装起开始保存。</p>',
      actions: [{ label: '取消' }, { label: '安装', kind: 'primary', act: function () { S.verPlugin = pick; S.verSince = D.tick(); App.toast('已安装 ' + (pick === 'lore' ? 'Lore' : 'Git LFS') + ' 版本插件'); if (after) after(); } }] });
    d.addEventListener('click', function (e) { var o = e.target.closest('[data-p]'); if (!o) return; pick = o.dataset.p; $$('[data-p]', d).forEach(function (x) { x.setAttribute('aria-checked', x === o); }); });
  }
  var VERB = { source: '来源', uses: '引用', belongs: '归属' };
  function metaRow(m) {
    var ic = m.kind === 'tag' ? 'tag' : m.kind === 'rel' ? 'link' : m.kind === 'stage' ? 'layers' : 'badge-check', t;
    if (m.kind === 'tag') t = (m.op === '+' ? (m.ai ? '采纳 AI 标签' : '加标签') : '去掉标签') + ' <span class="bb-tag' + (m.ai ? ' bb-tag--ai' : '') + '">' + esc(m.text) + '</span>';
    else if (m.kind === 'rel') t = '建立' + VERB[m.type] + ' <b>' + esc(m.toName) + '</b>';
    else if (m.kind === 'stage') t = '物料阶段 ' + esc(m.text);
    else t = '校验 ' + esc(m.text);
    return '<div class="vtm"><i class="vtm__ic">' + I(ic, 'bb-icon--12') + '</i><span class="vtm__t">' + t + '</span><small>' + D.fmtAt(m.at).replace(/^\d+ 月 /, '') + ' · <span class="text-mono-sm">' + esc(m.by) + '</span></small></div>';
  }
  App.versionPane = function (box, a) {
    var vs = D.versions(a), sel = null, filt = 'content', hostV = null;
    function cur() { return vs[vs.length - 1]; }
    function row(x, plug) {
      var prev = vs[x.v - 2], d = prev ? x.size - prev.size : 0, ok = plug && stored(a, x), now = x === cur();
      return '<' + (plug ? 'button' : 'div') + ' class="vtr' + (plug && x === sel ? ' on' : '') + (plug && !ok ? ' vtr--off' : '') + '"' + (plug ? ' data-ver="' + x.v + '"' + (ok ? '' : ' title="安装版本插件之前的版本，没有保存内容"') : '') + '><i class="vtr__dot' + (now ? ' now' : '') + '"></i><span class="vtr__m"><b><span class="vw__num">v' + x.v + '</span> ' + (x.from ? I('undo-2', 'bb-icon--12') : '') + esc(x.note) + (now ? ' <span class="bb-tag">当前</span>' : '') + '</b><small>' + D.fmtAt(x.at) + ' · <span class="text-mono-sm">' + esc(x.by) + '</span>' + (plug && !ok ? ' · 未保存内容' : '') + '</small></span><span class="vtr__s"><span class="vw__num">' + App.fmtSize(x.size) + '</span>' + (d ? '<small class="vw__num">' + (d > 0 ? '+' : '−') + App.fmtSize(Math.abs(d)) + '</small>' : '') + '</span></' + (plug ? 'button' : 'div') + '>';
    }
    function list(plug) {
      var cs = vs.slice().reverse().map(function (x) { return { at: x.at, html: row(x, plug) }; });
      if (!plug || filt === 'content') return cs.map(function (c) { return c.html; }).join('');
      var ms = D.metaLog(a).map(function (m) { return { at: m.at, html: metaRow(m) }; });
      return (filt === 'meta' ? ms : cs.concat(ms).sort(function (x, y) { return y.at - x.at; })).map(function (c) { return c.html; }).join('');
    }
    function render() {
      vs = D.versions(a); var plug = !!S.verPlugin;
      if (!sel || vs.indexOf(sel) < 0) sel = cur();
      destroyV();
      box.innerHTML = (plug ? '<div class="vt__head"><span class="vt__plug">' + I(S.verPlugin === 'lore' ? 'git-fork' : 'hard-drive', 'bb-icon--12') + (S.verPlugin === 'lore' ? 'Lore' : 'Git LFS') + '<i class="vt__ok"></i>已同步</span><span class="bb-toolbar__grow"></span>' + seg('显示', [['all', '全部'], ['content', '内容'], ['meta', '标签与关系']], filt, ' data-vf') + '</div>'
        : '<div class="vt__note">' + H.banner('', 'history', '只记录了变化，没有保存旧文件', 'Bowerbird 本身不保存旧版本的内容。装一个版本插件，就能预览、对比和恢复。', '<button class="bb-btn bb-btn--sm" data-vt="plugins">' + I('puzzle', 'bb-icon--12') + '选择版本插件…</button>') + '</div>') +
        '<div class="vt' + (plug ? '' : ' vt--plain') + '"><div class="vt__list">' + list(plug) + '</div>' + (plug ? '<div class="vt__prev"></div>' : '') + '</div>';
      var f = $('[data-vf]', box); if (f) { f.setAttribute('data-wired', ''); B.segmented(f, function (v) { filt = v; $('.vt__list', box).innerHTML = list(true); }); }
      if (plug) preview();
    }
    function destroyV() { if (hostV && hostV._viewer) hostV._viewer.destroy(); hostV = null; }
    function preview() {
      var p = $('.vt__prev', box), x = sel, now = x === cur(), ok = stored(a, x);
      destroyV();
      p.innerHTML = '<div class="vt__ph"><span class="vt__pt"><b><span class="vw__num">v' + x.v + '</span> ' + esc(x.note) + '</b>' + (now ? '<span class="bb-tag">当前</span>' : '') + '<small>' + D.fmtAt(x.at) + ' · <span class="text-mono-sm">' + esc(x.by) + '</span></small></span><span class="bb-toolbar__grow"></span>' +
        (now ? (vs.length > 1 && stored(a, vs[vs.length - 2]) ? '<button class="bb-btn bb-btn--sm" data-vt="cmpprev">' + I('git-compare-arrows', 'bb-icon--12') + '与 v' + (x.v - 1) + ' 对比</button>' : '')
          : ok ? '<button class="bb-btn bb-btn--sm" data-vt="cmp">' + I('git-compare-arrows', 'bb-icon--12') + '与当前版本对比</button><button class="bb-btn bb-btn--sm bb-btn--primary" data-vt="restore">' + I('undo-2', 'bb-icon--12') + '恢复为当前版本…</button>' : '') + '</div>' +
        (ok ? '<div class="vt__view"></div>' : '<div class="vt__none">' + I('history', 'bb-icon--24') + '<span>这个版本在安装版本插件之前，没有保存内容</span></div>');
      if (ok) { hostV = $('.vt__view', p); App.mountViewer(hostV, D.atVersion(a, x), { compact: true, still: true }); }
      $$('.vtr', box).forEach(function (r) { r.classList.toggle('on', +r.dataset.ver === x.v); });
    }
    box.addEventListener('click', function (e) {
      var r = e.target.closest('[data-ver]'); if (r) { var x = vs[+r.dataset.ver - 1]; if (x && x !== sel) { sel = x; preview(); } return; }
      var b = e.target.closest('[data-vt]'); if (!b) return; var k = b.dataset.vt;
      if (k === 'plugins') return pluginDialog(render);
      if (k === 'cmp') return App.compare({ id: a.id, v: sel.v }, { id: a.id, v: cur().v });
      if (k === 'cmpprev') return App.compare({ id: a.id, v: cur().v - 1 }, { id: a.id, v: cur().v });
      if (k === 'restore') return App.confirmRestore(a, sel.v, function (nv) { sel = nv || null; render(); });
    });
    render();
    return { destroy: destroyV, refresh: render };
  };

  /* the nearest upstream worth looking at (an image or a model), along source relations */
  App.nearestUpstream = function (a) {
    var q = [a.id], seen = {}; seen[a.id] = 1;
    while (q.length) {
      var id = q.shift(), hit = null;
      D.EDGES.forEach(function (e) { if (hit || e.type !== 'source' || e.from !== id || !e.to || seen[e.to]) return; seen[e.to] = 1; var t = App.byId(e.to); if (!t) return; if (/image|model/.test(sortOf(t))) hit = t; else q.push(t.id); });
      if (hit) return hit;
    }
    return null;
  };
})();
