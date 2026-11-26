/* Bowerbird prototype — browse page panels and flows: filter, inspector, menus, toasts, dialogs,
 * upload with name conflicts, quick look, page states. Built on App (app.js). */
(function () {
  'use strict';
  var App = window.App, B = Bowerbird, I = B.icon, H = B.html, D = App.D, S = App.S, el = App.el, $ = App.$, $$ = App.$$, DEMO = B.demo;
  var L = H.labels, STAGES = ['reference', 'production', 'runtime'], REVIEWS = ['pending', 'approved', 'rejected', 'exempt'];
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function sel() { return S.sel.map(App.byId).filter(Boolean); }
  function thumb(a) { return a.art && !/unknown|waiting|failed|processing/.test(a.state || '') ? DEMO.art(a.art, a) : I(L.KIND_ICON[a.kind]); }
  function local(r) { var z = S.zoom; return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z }; }
  function vw() { return window.innerWidth / S.zoom; } function vh() { return window.innerHeight / S.zoom; }
  function add(cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; el.layer.appendChild(d); return d; }

  /* ── menu · popover · toast · dialog ── */
  function closeFloat() { $$('.menu-host, .pop', el.layer).forEach(function (x) { x.remove(); }); }
  function menuHtml(items) {
    return items.map(function (it, i) {
      if (it === 'sep') return '<div class="bb-menu__sep"></div>';
      if (it.header) return '<div class="bb-menu__label">' + it.header + '</div>';
      return '<button class="bb-menu__item' + (it.danger ? ' bb-menu__item--danger' : '') + '" role="menuitem" data-i="' + i + '"' + (it.disabled ? ' aria-disabled="true"' : '') + (it.sub ? ' aria-haspopup="menu" aria-expanded="false"' : '') + '>' + (it.check != null ? '<span class="bb-menu__check">' + (it.check ? I('check') : '') + '</span>' : '') + (it.icon ? I(it.icon) : '') + (it.html || esc(it.label)) + (it.sub ? '<span class="bb-menu__kbd">' + (it.hint || '') + '</span>' + I('chevron-right', 'bb-icon--12') : it.kbd ? '<span class="bb-menu__kbd">' + it.kbd + '</span>' : '') + '</button>';
    }).join('');
  }
  /* items: 'sep' | { header } | { icon, label | html, kbd, check, danger, disabled, act, sub: [items], hint } — a sub opens on hover, to the side */
  App.menu = function (items, at) {
    closeFloat();
    var host = add('menu-host', '<div class="bb-menu" role="menu" data-open>' + menuHtml(items) + '</div>'), m = host.firstChild, x, y;
    if (at.clientX != null) { x = at.clientX / S.zoom; y = at.clientY / S.zoom; } else { var r = local(at.getBoundingClientRect()); x = r.left; y = r.bottom + 4; }
    var w = m.offsetWidth, h = m.offsetHeight, fx = x + w > vw() - 8, fy = y + h > vh() - 8;
    host.style.left = (fx ? Math.max(8, x - w) : x) + 'px'; host.style.top = (fy ? Math.max(8, vh() - h - 8) : y) + 'px';
    m.style.setProperty('--bb-origin', (fx ? '100%' : '0') + ' ' + (fy ? '100%' : '0'));
    var sub = null, subFor = -1, tmr = 0;
    function closeSub() { if (sub) { sub.remove(); sub = null; } var b = $('[data-i="' + subFor + '"]', host); if (b) { b.setAttribute('aria-expanded', 'false'); b.removeAttribute('data-active'); } subFor = -1; }
    function openSub(btn) {
      var i = +btn.dataset.i, it = items[i]; if (subFor === i) return; closeSub(); subFor = i;
      btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('data-active', '');
      sub = add('menu-host', '<div class="bb-menu" role="menu" data-open>' + menuHtml(it.sub) + '</div>');
      var r = local(btn.getBoundingClientRect()), sm = sub.firstChild, sw = sm.offsetWidth, sh = sm.offsetHeight, sx = r.right + 2, left = sx + sw > vw() - 8;
      if (left) sx = r.left - sw - 2;
      sub.style.left = sx + 'px'; sub.style.top = Math.max(8, Math.min(r.top - 5, vh() - sh - 8)) + 'px'; sm.style.setProperty('--bb-origin', (left ? '100%' : '0') + ' 0');
      sub.addEventListener('pointerenter', function () { clearTimeout(tmr); });
      sub.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (!b) return; var s = it.sub[+b.dataset.i]; if (s.disabled) return; closeFloat(); if (s.act) s.act(); });
    }
    host.addEventListener('pointerover', function (e) {
      var b = e.target.closest('[data-i]'); if (!b) return; clearTimeout(tmr);
      if (items[+b.dataset.i].sub) tmr = setTimeout(function () { openSub(b); }, 60); else if (sub) tmr = setTimeout(closeSub, 180);
    });
    /* a row with a submenu opens it on click — unless the row has its own action (e.g. a channel: click = all components, hover = pick one) */
    host.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (!b) return; var it = items[+b.dataset.i]; if (it.sub && !it.act) { clearTimeout(tmr); return openSub(b); } if (it.disabled) return; closeFloat(); if (it.act) it.act(); });
  };
  App.pop = function (html, anchor, place) {
    closeFloat();
    var p = add('pop', html), r = local(anchor.getBoundingClientRect()), w = p.offsetWidth, h = p.offsetHeight;
    var x = place === 'right' ? r.right + 8 : Math.min(r.left, vw() - w - 8), y = place === 'right' ? Math.min(r.top, vh() - h - 8) : r.bottom + 6;
    p.style.left = Math.max(8, x) + 'px'; p.style.top = y + 'px'; p.style.setProperty('--bb-origin', place === 'right' ? '0 12px' : (r.left > vw() - w - 8 ? '90% 0' : '10% 0'));
    return p;
  };
  document.addEventListener('pointerdown', function (e) { if (!e.target.closest('.menu-host, .pop')) closeFloat(); }, true);
  /* toasts (ADR-021): from the bottom right, stacked, fading after a few seconds; a hovered toast stays; one with 撤销 stays longer.
   * label other than 撤销 (e.g. 查看) is an action, not an undo. Every undo is also kept for ⌘Z / Ctrl+Z, for this session only. */
  var tstack = null, UNDO = [];
  App.pushUndo = function (fn, t) { var u = { fn: fn, t: t || null }; UNDO.push(u); if (UNDO.length > 50) UNDO.shift(); return u; };
  App.undoLast = function () {
    var u = UNDO.pop(); if (!u) return App.toast('没有可以撤销的操作');
    u.fn(); if (u.t && u.t._out) u.t._out();
  };
  App.runUndo = function (u) { var i = UNDO.indexOf(u); if (i < 0) return; UNDO.splice(i, 1); u.fn(); if (u.t && u.t._out) u.t._out(); };
  /* who is acting (ADR-023): no name asked for on first visit; a name can be set in 设置. Without one the actor is user:unnamed, shown as 未署名 */
  S.myName = '';
  App.me = function () { return S.myName ? 'user:' + S.myName : 'user:unnamed'; };
  App.who = function (by) { return by === 'user:unnamed' ? '未署名' : by || ''; };
  /* review keeps only the latest verdict: who, when, the comment (ADR-024) */
  App.verdictOf = function (a) { return { review: a.review, by: a.reviewBy, at: a.reviewAt, note: a.reviewNote }; };
  App.setVerdict = function (a, status, note) { a.review = status; a.reviewBy = App.me(); a.reviewAt = D.tick(); a.reviewNote = note || ''; };
  /* 打回 always asks why (the comment is required), wherever it is chosen */
  App.rejectWithNote = function (as) {
    var d = App.dialog({ title: '打回 ' + (as.length > 1 ? as.length + ' 个资产' : esc(as[0].name)), form: true, body: '<div class="bb-field bb-field--area"><textarea class="bb-field__input" id="rjn" rows="3" placeholder="哪里需要改（必填）" aria-label="打回意见"></textarea></div>', actions: [{ label: '取消' }, { label: '打回', kind: 'primary', keep: true, act: function (h) { var t = $('#rjn', h), v = t.value.trim(); if (!v) { t.parentNode.setAttribute('data-invalid', ''); return t.focus(); } h.cancel(); var pv = as.map(App.verdictOf); as.forEach(function (x) { App.setVerdict(x, 'rejected', v); }); App.render(); App.toast('已打回 ' + (as.length > 1 ? as.length + ' 个资产' : as[0].name), function () { as.forEach(function (x, i) { App.restoreVerdict(x, pv[i]); }); App.render(); }); } }] });
    setTimeout(function () { $('#rjn', d).focus(); }, 0);
  };
  App.restoreVerdict = function (a, v) { a.review = v.review; a.reviewBy = v.by; a.reviewAt = v.at; a.reviewNote = v.note; };
  App.toast = function (text, act, label) {
    if (!tstack || !tstack.isConnected) tstack = add('tstack', '');
    var up = $('.uppanel', el.layer); tstack.style.bottom = up ? (up.offsetHeight + 28) / 1 + 'px' : App.detailOpen || App.cmpOpen ? '84px' : '';  /* above the upload panel; E-28: above a viewer's timeline and controls */
    var isUndo = act && (!label || label === '撤销'), t = document.createElement('div'); t.className = 'bb-toast'; t.setAttribute('role', 'status');
    t.innerHTML = '<span>' + esc(text) + '</span>' + (act ? '<button class="bb-btn bb-btn--sm">' + (label || '撤销') + '</button>' : '');
    tstack.appendChild(t);
    var left = act ? 7000 : 3800, t0 = Date.now(), tm = 0, gone = false, u = isUndo ? App.pushUndo(act, t) : null;
    t._out = function () { if (gone) return; gone = true; clearTimeout(tm); t.setAttribute('data-out', ''); setTimeout(function () { t.remove(); }, 260); };
    function arm() { t0 = Date.now(); tm = setTimeout(t._out, left); }
    t.addEventListener('pointerenter', function () { clearTimeout(tm); left = Math.max(1500, left - (Date.now() - t0)); });
    t.addEventListener('pointerleave', arm);
    if (act) t.querySelector('button').addEventListener('click', function () { if (u) { var i = UNDO.indexOf(u); if (i >= 0) UNDO.splice(i, 1); } act(); t._out(); });
    arm();
    while (tstack.children.length > 4) tstack.firstChild.remove();
  };
  /* o: { title, text, body, wide, form, actions: [{ label, kind, icon, act, keep }] } — the first action is "cancel".
   * A confirmation is an alert dialog; a form or a picker (form: true) is a plain dialog that a stray click outside doesn't close. */
  App.dialog = function (o) {
    var host = add('bb-scrim', '<div class="bb-dialog' + (o.wide ? ' bb-dialog--wide' : '') + '" role="' + (o.form ? 'dialog' : 'alertdialog') + '" aria-modal="true"><h2 class="bb-dialog__title">' + o.title + '</h2>' + (o.text ? '<p class="bb-dialog__text">' + o.text + '</p>' : '') + (o.body ? '<div class="bb-dialog__body">' + o.body + '</div>' : '') +
      '<div class="bb-dialog__foot">' + (o.foot || '') + o.actions.map(function (a, i) { return '<button class="bb-btn bb-btn--lg ' + (a.kind ? 'bb-btn--' + a.kind : 'bb-btn--ghost') + '" data-k="' + i + '">' + (a.icon ? I(a.icon) : '') + a.label + '</button>'; }).join('') + '</div></div>');
    App.modal = true;
    function close() { host.remove(); App.modal = !!$('.bb-scrim', el.layer); }
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (b) { var a = o.actions[+b.dataset.k]; if (!a.keep) close(); if (a.act) a.act(host); return; }
      if (e.target === host && !o.form) { close(); if (o.actions[0].act) o.actions[0].act(host); }
    });
    host.cancel = function () { close(); if (o.actions[0].act) o.actions[0].act(host); };
    var f = host.querySelector('[data-k="0"]'); if (f) f.focus();
    return host;
  };
  App.closeTop = function () {
    var m = $('.menu-host, .pop', el.layer); if (m) { closeFloat(); return true; }
    if (App.qlOpen) { App.qlClose(); return true; }
    var d = $$('.bb-scrim', el.layer).pop(); if (d) { d.cancel(); return true; }
    if (App.cmpOpen) { App.closeCompare(); return true; }
    if (App.pageOn) return App.pageEsc();
    if (App.graphEsc && App.graphEsc()) return true;
    if (App.detailOpen) { App.closeDetail(); return true; }
    if (S.filterOpen) { S.filterOpen = false; App.render(false, true); return true; }
    return false;
  };

  /* ── empty and error states ── */
  App.empty = function (kind) {
    var e = {
      library: ['upload', '把文件拖进来', '', '<button class="bb-btn bb-btn--primary" data-do="upload">' + I('upload') + '选择文件</button>'],
      folder: ['folder-open', '这个文件夹是空的', '', '<button class="bb-btn" data-do="upload">' + I('upload') + '上传</button>'],
      trash: ['trash-2', '回收站是空的', '', ''],
      search: ['search', '没有符合条件的资产', '', '<button class="bb-btn" data-do="clear-last">去掉最后一个条件</button><button class="bb-btn bb-btn--ghost" data-do="clear">清空</button>'],
      offline: ['unlink', '连接不到 Bowerbird 服务', '<span class="text-mono">127.0.0.1:7420</span>', '<button class="bb-btn bb-btn--primary" data-do="retry">' + I('refresh-cw') + '重试</button>']
    }[kind];
    return '<div class="center"><div class="bb-empty"><div class="bb-empty__icon">' + I(e[0], 'bb-icon--24') + '</div><h3 class="bb-empty__title">' + e[1] + '</h3>' + (e[2] ? '<p class="bb-empty__text">' + e[2] + '</p>' : '') + (e[3] ? '<div class="bb-empty__actions">' + e[3] + '</div>' : '') + '</div></div>';
  };

  /* ── actions on the selection ── */
  App.setStage = function (stage) {
    var as = sel(), prev = as.map(function (a) { return a.stage; }); if (!as.length) return;
    as.forEach(function (a) { a.stage = stage; }); App.render();
    App.toast((as.length > 1 ? as.length + ' 个资产' : as[0].name) + ' 已设为' + L.STAGE[stage][0], function () { as.forEach(function (a, i) { a.stage = prev[i]; }); App.render(); });
  };
  function referrers(a) { var r = D.rel(a); return r.usedBy.concat(r.down, r.members).map(function (x) { return x.a; }).filter(Boolean); }
  function doTrash(as) {
    var idx = as.map(function (a) { return D.assets.indexOf(a); });
    as.forEach(function (a) { D.assets.splice(D.assets.indexOf(a), 1); S.trash.unshift(a); }); S.sel = []; App.render();
    App.toast('已把 ' + (as.length > 1 ? as.length + ' 个资产' : as[0].name) + ' 移入回收站', function () { as.forEach(function (a, i) { S.trash.splice(S.trash.indexOf(a), 1); D.assets.splice(Math.min(idx[i], D.assets.length), 0, a); }); App.render(); });
  }
  function byId(id) { return App.byId(id); }
  App.act = function (name) {
    var as = sel(), a = as[0];
    if (name === 'upload') return App.upload();
    if (name === 'clear') { S.cond = App.emptyCond(); S.q = ''; el.search.value = ''; return App.render(false, true); }
    if (name === 'clear-last') { var cs = App.chips(); if (cs.length) cs[cs.length - 1].rm(); else { S.q = ''; el.search.value = ''; } return App.render(false, true); }
    if (name === 'retry') { S.state = 'loading'; App.render(); return setTimeout(function () { S.state = 'ready'; App.render(true); }, 800); }
    if (!a) return;
    if (name === 'trash') {
      if (S.loc.id === 'trash') return;
      var refs = []; as.forEach(function (x) { referrers(x).forEach(function (r) { if (refs.indexOf(r) < 0 && as.indexOf(r) < 0) refs.push(r); }); });
      if (!refs.length) return App.dialog({ title: '把 ' + (as.length > 1 ? as.length + ' 个资产' : esc(a.name)) + ' 移入回收站？', text: '没有其他资产依赖它。回收站保留 7 天，期间可以恢复。', actions: [{ label: '取消' }, { label: '移入回收站', kind: 'danger', icon: 'trash-2', act: function () { doTrash(as); } }] });
      return App.dialog({ title: '把 ' + (as.length > 1 ? as.length + ' 个资产' : a.name) + ' 移入回收站？', text: '有 ' + refs.length + ' 个资产依赖它，删除后这些关系会指向找不到的文件。回收站保留 7 天，可以恢复。', body: '<div class="bb-dialog__list">' + refs.map(function (r) { return H.row({ thumb: thumb(r), label: r.name, sub: r.path, trailing: H.stage(r.stage) + H.review(r.review) }); }).join('') + '</div>', actions: [{ label: '取消' }, { label: '移入回收站', kind: 'danger', icon: 'trash-2', act: function () { doTrash(as); } }] });
    }
    /* copying is just copying (ADR-018): a new asset with its own identity, named name_1 / name_2…; references stay with the original.
     * It starts its own history, goes back to review, keeps what it depends on, and records where it came from (ADR-005, E-17). */
    if (name === 'copy') {
      var dot = a.name.lastIndexOf('.'), stem = a.name.slice(0, dot), ext = a.name.slice(dot), n = 1;
      while (D.assets.some(function (x) { return x.folder === a.folder && x.name === stem + '_' + n + ext; })) n++;
      var c = Object.assign({}, a, { id: a.id.slice(0, -4) + ('0000' + Math.floor(Math.random() * 65535).toString(16)).slice(-4), name: stem + '_' + n + ext, tags: a.tags.slice(), aiTags: [], issue: null, review: a.review === 'exempt' ? 'exempt' : 'pending', reviewBy: null, reviewAt: null, reviewNote: '', by: App.me(), modified: D.tick(), origin: null });
      c.path = a.folder + '/' + c.name; delete c.versions;
      D.assets.splice(D.assets.indexOf(a) + 1, 0, c);
      var carried = D.EDGES.filter(function (e) { return e.from === a.id; }).map(function (e) { return D.addEdge(c, e.type, App.byId(e.to) || { id: e.to, name: e.toName }, { note: e.note, slot: e.slot }); });
      carried.push(D.addEdge(c, 'source', a, { rec: D.addRecord({ method: '复制', tool: 'Bowerbird', by: App.me(), at: D.fmtAt(c.modified) }) }));
      S.sel = [c.id]; S.focus = c.id; App.render();
      var used = D.EDGES.some(function (e) { return e.to === a.id && e.from !== c.id; });
      return App.toast('已复制为 ' + c.name + (used ? '，原来的引用仍指向原件' : ''), function () { carried.forEach(function (e) { D.removeEdge(e); }); D.assets.splice(D.assets.indexOf(c), 1); S.sel = [a.id]; S.focus = a.id; App.render(); });
    }
    if (name === 'rename') {
      var cell = $('[data-id="' + a.id + '"] .bb-cell__name, tr[data-id="' + a.id + '"] .nm > span:last-child', el.content); if (!cell) return;
      cell.innerHTML = '<input class="rename" value="' + esc(a.name) + '" aria-label="名称">'; var inp = cell.firstChild; inp.focus(); inp.setSelectionRange(0, a.name.lastIndexOf('.'));
      var done = function (ok) { if (ok && inp.value.trim()) { a.name = inp.value.trim(); a.path = a.folder + '/' + a.name; } App.render(); };
      inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', function () { done(true); }); inp.addEventListener('click', function (e) { e.stopPropagation(); });
    }
  };
  App.assetMenu = function (e) {
    var as = sel(), a = as[0], many = as.length > 1, same = as.every(function (x) { return x.stage === a.stage; });
    var gone = as.some(function (x) { return x.state === 'missing'; });
    var items = (many ? [{ header: '已选 ' + as.length + ' 个资产' }] : []).concat([
      { icon: 'maximize-2', label: '打开', kbd: '↵', disabled: many, act: function () { App.openDetail(a.id); } },
      { icon: 'eye', label: '快速预览', kbd: '空格', act: function () { App.quickLook(a.id); } },
      { icon: 'git-compare-arrows', label: '对比…', disabled: as.length !== 2, act: function () { if (App.compare) App.compare(as[0], as[1]); } }, 'sep'
    ].concat(App.dream ? App.dream.ctxItems(as) : [], [
    ].concat(S.remote
      /* opened from another computer: the files are not on this disk, so they come down instead (ADR-023) */
      ? [{ icon: 'download', label: '下载源文件', disabled: gone, act: function () { App.toast(many ? '开始下载 ' + as.length + ' 个文件' : '开始下载 ' + a.name); } }, 'sep']
      : [{ icon: 'external-link', label: '用默认程序打开源文件', kbd: '⌘O', disabled: many || gone, act: function () { App.toast('已用默认程序打开 ' + a.name); } },
        { icon: 'folder-search', label: '在文件夹中显示源文件', kbd: '⌥⌘R', disabled: gone, act: function () { App.toast('已在文件夹中显示 ' + (many ? as.length + ' 个文件' : a.name)); } }, 'sep'], [
      { icon: 'layers', label: '物料阶段', hint: same ? L.STAGE[a.stage][1] : '混合', sub: STAGES.map(function (s, n) { return { html: H.stage(s, 'full'), check: same && a.stage === s, act: function () { App.setStage(s); } }; }) },
      'sep', { icon: 'copy', label: '复制', kbd: '⌘D', disabled: many, act: function () { App.act('copy'); } }, { icon: 'folder-input', label: '移动到…', act: function () { App.moveDialog(as.map(function (x) { return x.id; })); } }, { icon: 'pencil', label: '改名', disabled: many, act: function () { App.act('rename'); } },
      { icon: 'file-up', label: '替换为新版本…', disabled: many || gone, act: function () { App.replaceContent(a); } }, { icon: 'link', label: '建立关系…', disabled: many, act: function () { if (App.relationDialog) App.relationDialog(a); } }, { icon: 'package', label: '导出…', act: function () { App.exportDialog(as.map(function (x) { return x.id; })); } }, 'sep', { icon: 'trash-2', label: '移入回收站', kbd: '⌫', danger: true, act: function () { App.act('trash'); } }
    ])));
    App.menu(items, e);
  };
  /* ── export (F-07, POST /export): a zip to download, or a copy into a folder on the computer running Bowerbird;
   * with what they use, written under the slot names their files refer to, so a model still finds its textures outside Bowerbird ── */
  App.exportDialog = function (ids) {
    var as = ids.map(App.byId).filter(Boolean), o = { to: 'zip', deps: true, keep: true, dir: '~/Desktop/' + (as.length > 1 ? 'export' : as[0].name.replace(/\.[^.]+$/, '') + '_export') };
    function deps() {
      var out = [];
      as.forEach(function (a) { D.EDGES.filter(function (e) { return e.from === a.id && e.type === 'uses'; }).forEach(function (e) { var t = App.byId(e.to); if (!t || as.indexOf(t) >= 0 || out.some(function (x) { return x.a === t; })) return; out.push({ a: t, as: e.slot || t.name, by: a }); }); });
      return out;
    }
    function files() {
      var list = as.map(function (a) { return { path: o.keep ? a.path : a.name, a: a }; });
      if (o.deps) deps().forEach(function (d) { var dir = d.by.folder; list.push({ path: o.keep ? dir + '/' + d.as : d.as, a: d.a, slot: d.as !== d.a.name ? d.a.name : null }); });
      return list;
    }
    function body() {
      var fl = files(), dp = deps(), bytes = fl.reduce(function (s, f) { return s + (f.a.bytes || 0); }, 0), dup = !o.keep && fl.some(function (f, i) { return fl.findIndex(function (g) { return g.path === f.path; }) !== i; });
      return '<div class="ex">' +
        '<div class="fg__row"><span class="fg__k">去向</span><div class="bb-seg" role="radiogroup" aria-label="去向" data-ex="to"><i class="bb-seg__thumb"></i><button class="bb-seg__item" role="radio" aria-checked="' + (o.to === 'zip') + '" data-value="zip">打包下载</button><button class="bb-seg__item" role="radio" aria-checked="' + (o.to === 'dir') + '" data-value="dir"' + (S.remote ? ' aria-disabled="true" title="只在装 Bowerbird 的那台电脑上能用"' : '') + '>复制到文件夹</button></div></div>' +
        (o.to === 'dir' ? '<div class="fg__row"><span class="fg__k">文件夹</span><div class="bb-field">' + I('folder') + '<input class="bb-field__input" data-ex-dir value="' + esc(o.dir) + '" aria-label="导出到的文件夹"></div></div>' : '') +
        '<div class="fg__row"><span class="fg__k">目录</span><div class="bb-seg" role="radiogroup" aria-label="目录" data-ex="keep"><i class="bb-seg__thumb"></i><button class="bb-seg__item" role="radio" aria-checked="' + o.keep + '" data-value="1">保留目录</button><button class="bb-seg__item" role="radio" aria-checked="' + !o.keep + '" data-value="0">放在一起</button></div></div>' +
        '<div class="fg__row"><span class="fg__k">引用的资产</span><span class="up-keep"><button class="bb-switch" data-own="1" data-ex-deps role="switch" aria-checked="' + o.deps + '" aria-label="连同引用的资产"' + (dp.length ? '' : ' disabled') + '></button>' + (dp.length ? '一起导出 ' + dp.length + ' 个' : '没有引用别的资产') + '</span></div>' +
        '<div class="ex__list">' + fl.map(function (f) { return '<div class="ex__f">' + I(L.KIND_ICON[f.a.kind], 'bb-icon--12') + '<span class="text-mono-sm">' + esc(f.path) + '</span>' + (f.slot ? '<small>来自 ' + esc(f.slot) + '</small>' : '') + '</div>'; }).join('') + '</div>' +
        '<p class="fo__p fo__sub">' + fl.length + ' 个文件 · ' + App.fmtSize(bytes) + (dup ? ' · 有同名文件，放在一起时会加上序号' : '') + '</p></div>';
    }
    var d = App.dialog({ wide: true, form: true, title: '导出 ' + (as.length > 1 ? as.length + ' 个资产' : esc(as[0].name)), body: body(),
      actions: [{ label: '取消' }, { label: '下载 .zip', kind: 'primary', icon: 'download', act: function () {
        var fl = files(), bytes = fl.reduce(function (s, f) { return s + (f.a.bytes || 0); }, 0);
        App.toast(o.to === 'zip' ? '开始下载 ' + (as.length > 1 ? 'export' : as[0].name.replace(/\.[^.]+$/, '')) + '.zip（' + fl.length + ' 个文件，' + App.fmtSize(bytes) + '）' : '已导出 ' + fl.length + ' 个文件到 ' + o.dir);
      } }] });
    var bd = $('.bb-dialog__body', d), ok = d.querySelector('[data-k="1"]');
    function redraw() { bd.innerHTML = body(); wire(); ok.innerHTML = o.to === 'zip' ? I('download') + '下载 .zip' : I('folder-output') + '导出'; }
    function wire() {
      $$('[data-ex]', bd).forEach(function (sg) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (v) { if (sg.dataset.ex === 'to') { if (v === 'dir' && S.remote) { App.toast('只在装 Bowerbird 的那台电脑上能复制到文件夹'); return redraw(); } o.to = v; } else o.keep = v === '1'; redraw(); }); });
    }
    bd.addEventListener('click', function (e) { if (e.target.closest('[data-ex-deps]') && !e.target.closest('[disabled]')) { o.deps = !o.deps; redraw(); } });
    bd.addEventListener('input', function (e) { if (e.target.hasAttribute('data-ex-dir')) o.dir = e.target.value; });
    wire();
  };
  App.saveSmart = function () {
    if (!App.condActive() && !S.q) return App.toast('先加上筛选条件，再保存为智能文件夹');
    var n = App.list().length, name = App.chips().map(function (c) { return c.v; }).concat(S.q ? [S.q] : []).join(' · ');
    S.smart.push({ name: name, count: n, cond: JSON.parse(JSON.stringify(S.cond)) });
    S.cond = App.emptyCond(); S.q = ''; el.search.value = ''; S.filterOpen = false;
    App.go({ type: 'smart', id: S.smart.length - 1 }); App.toast('已保存为智能文件夹「' + name + '」');
  };
  /* background work: processing assets and plugin creation jobs (ADR-016); rendering happens lazily in the page, so nothing to switch here (ADR-025) */
  App.jobsPop = function (anchor) {
    var busy = D.assets.filter(function (a) { return a.state === 'processing'; }), jobs = App.dream ? App.dream.jobs().filter(function (j) { return j.state === 'running' || j.state === 'pick'; }) : [];
    App.pop('<h5>后台处理</h5>' + jobs.map(function (j) { return '<div class="job job--c" data-job="' + j.id + '"><b>' + esc(j.title) + '</b><span>' + esc(j.stateText) + '</span>' + (j.state === 'running' ? '<span class="bb-progress" style="--p:' + j.p + '%"><i></i></span><button class="bb-btn bb-btn--ghost bb-btn--sm" data-pop="cancel-job">取消</button>' : '<button class="bb-btn bb-btn--sm bb-btn--primary" data-pop="pick-job">挑选…</button>') + '</div>'; }).join('') +
      busy.map(function (a) { return '<div class="job"><b>' + esc(a.name) + '</b><span>' + (a.stateText || '处理中') + '</span><span class="bb-progress" style="--p:' + (a.progress || 40) + '%"><i></i></span></div>'; }).join('') +
      (jobs.length || busy.length ? '' : '<p class="pop__none">没有在处理的任务</p>') +
      '<button class="bb-btn bb-btn--sm pop__more" data-pop="tasks">查看全部任务' + I('chevron-right', 'bb-icon--12') + '</button>', anchor);
  };
  el.layer.addEventListener('click', function (e) { var b = e.target.closest('[data-pop="cancel-job"], [data-pop="pick-job"]'); if (!b || !App.dream) return; var id = b.closest('[data-job]').dataset.job; closeFloat(); if (b.dataset.pop === 'cancel-job') App.dream.cancel(id); else App.dream.pick(id); });
  el.layer.addEventListener('click', function (e) { if (e.target.closest('[data-pop="tasks"]')) { closeFloat(); App.openSettings('tasks'); } });
  el.layer.addEventListener('click', function (e) { var s = e.target.closest('.bb-switch'); if (s && !s.dataset.own) s.setAttribute('aria-checked', s.getAttribute('aria-checked') !== 'true'); });

  /* ── filter panel: the same conditions as the search field, as controls ── */
  function chip(f, on, inner, n) { return '<button class="fchip" data-f="' + f + '" aria-pressed="' + !!on + '">' + inner + (n != null ? '<span class="fchip__n vw__num">' + n + '</span>' : '') + '</button>'; }
  /* facet counts: how many results this option would give together with the other conditions (search.md: by format, stage, tag) */
  function facet(key, v) { var keep = S.cond, c = JSON.parse(JSON.stringify(keep)); c[key] = [v]; S.cond = c; var n = App.list().length; S.cond = keep; return n; }
  App.renderFilter = function () {
    var f = el.filter, c = S.cond; f.hidden = !S.filterOpen; if (!S.filterOpen) return (f.innerHTML = '');
    function tags(arr, key) { return arr.map(function (t) { return '<span class="bb-tag">' + esc(t) + '<button class="bb-tag__act" data-untag="' + key + ':' + esc(t) + '" aria-label="移除">' + I('x', 'bb-icon--12') + '</button></span>'; }).join('') + '<input class="taginput" data-t="' + key + '" placeholder="输入后回车" aria-label="标签">'; }
    function range(label, key, unit) { var r = c[key]; return '<div class="ln rg"><div class="bb-field"><input class="bb-field__input" data-r="' + key + ':0" inputmode="numeric" placeholder="最小" value="' + (r[0] == null ? '' : r[0]) + '" aria-label="' + label + '最小"></div><span>–</span><div class="bb-field"><input class="bb-field__input" data-r="' + key + ':1" inputmode="numeric" placeholder="最大" value="' + (r[1] == null ? '' : r[1]) + '" aria-label="' + label + '最大"></div><span>' + unit + '</span></div>'; }
    f.className = 'fp';
    f.innerHTML =
      '<div><h5>物料阶段</h5><div class="ln">' + STAGES.map(function (s) { return chip('stage:' + s, c.stage.indexOf(s) >= 0, H.stage(s, 'short'), facet('stage', s)); }).join('') + '</div></div>' +
      '<div><h5>格式</h5><div class="ln">' + Object.keys(App.KIND).map(function (k) { return chip('format:' + k, c.format.indexOf(k) >= 0, I(L.KIND_ICON[k], 'bb-icon--12') + App.KIND[k], facet('format', k)); }).join('') + '</div></div>' +
      '<div><h5>校验状态</h5><div class="ln">' + REVIEWS.map(function (r) { return chip('review:' + r, c.review.indexOf(r) >= 0, H.review(r, true), facet('review', r)); }).join('') + '</div></div>' +
      '<div><h5>问题</h5><div class="ln">' + chip('issue', c.issue, I('triangle-alert', 'bb-icon--12') + '有问题') + chip('stale', c.stale, I('git-pull-request-arrow', 'bb-icon--12') + '上游已更新') + chip('missing', c.missing, I('file-question', 'bb-icon--12') + '文件缺失') + '</div></div>' +
      '<div><h5>归属于</h5><div class="ln">' + D.assets.filter(function (x) { return App.isDesignObject && App.isDesignObject(x); }).map(function (o) { var k = o.name.replace(/\.[^.]+$/, ''); return chip('belongs:' + k, c.belongs === k, I('box', 'bb-icon--12') + esc(o.title || k)); }).join('') + '</div></div>' +
      '<div><h5>生产方式</h5><div class="ln">' + [['ai-generate', 'AI 生成'], ['manual', '手工'], ['export', '导出'], ['render', '渲染']].map(function (m) { return chip('method:' + m[0], c.method === m[0], m[1]); }).join('') + '</div></div>' +
      '<div><h5>修改时间</h5><div class="ln">' + chip('when:today', c.when === 'today', '今天') + chip('when:week', c.when === 'week', '本周') + chip('when:month', c.when === 'month', '本月') + '</div></div>' +
      '<div class="grow"><h5>包含标签</h5><div class="ln">' + tags(c.tag, 'tag') + chip('tagMode:all', c.tagMode === 'all', '全部') + chip('tagMode:any', c.tagMode === 'any', '任一') + '</div></div>' +
      '<div class="grow"><h5>排除标签</h5><div class="ln">' + tags(c.ntag, 'ntag') + '</div></div>' +
      '<div><h5>面数</h5>' + range('', 'tris', '') + '</div><div><h5>时长</h5>' + range('', 'dur', '秒') + '</div><div><h5>宽度</h5>' + range('', 'width', 'px') + '</div><div><h5>高度</h5>' + range('', 'height', 'px') + '</div>' +
      '<div><h5>只用人工标签</h5><div class="ln" style="height:22px"><button class="bb-switch" data-own="1" data-f="human" role="switch" aria-checked="' + !!c.human + '" aria-label="标签条件只匹配人工标签"></button></div></div>' +
      '<div><h5>附属文件</h5><div class="ln" style="height:22px"><button class="bb-switch" data-own="1" data-f="aux" role="switch" aria-checked="' + c.aux + '" aria-label="显示附属文件"></button></div></div>' +
      '<div class="fp__foot"><span>' + App.list().length + ' 个结果</span><button class="bb-btn bb-btn--sm bb-btn--ghost" data-do="clear">清空</button>' + (S.editSmart != null && S.smart[S.editSmart] ? '<button class="bb-btn bb-btn--sm bb-btn--primary" data-do="smart-save">' + I('check', 'bb-icon--12') + '保存到「' + esc(S.smart[S.editSmart].name) + '」</button>' : '') + '<button class="bb-btn bb-btn--sm" data-do="smart">' + I('folder-search', 'bb-icon--12') + '保存为智能文件夹</button></div>';
  };
  el.filter.addEventListener('click', function (e) {
    var d = e.target.closest('[data-do]'); if (d) return d.dataset.do === 'smart' ? App.saveSmart() : d.dataset.do === 'smart-save' ? App.saveSmartEdit() : App.act('clear');
    var u = e.target.closest('[data-untag]'), c = S.cond;
    if (u) { var p = u.dataset.untag.split(':'); c[p[0]].splice(c[p[0]].indexOf(p[1]), 1); return App.render(false, true); }
    var b = e.target.closest('[data-f]'); if (!b) return;
    var k = b.dataset.f.split(':')[0], v = b.dataset.f.split(':')[1];
    if (k === 'issue' || k === 'aux' || k === 'stale' || k === 'missing' || k === 'human') c[k] = !c[k];
    else if (k === 'belongs' || k === 'method') c[k] = c[k] === v ? '' : v;
    else if (k === 'tagMode') c.tagMode = v;
    else if (k === 'when') c.when = c.when === v ? 'all' : v;
    else { var i = c[k].indexOf(v); if (i >= 0) c[k].splice(i, 1); else c[k].push(v); }
    App.render(false, true);
  });
  el.filter.addEventListener('change', function (e) { var r = e.target.dataset.r; if (!r) return; var p = r.split(':'), v = e.target.value.trim(); S.cond[p[0]][+p[1]] = v === '' || isNaN(+v) ? null : +v; App.render(false, true); });
  el.filter.addEventListener('keydown', function (e) {
    var t = e.target.dataset.t; if (!t || e.key !== 'Enter') return; var v = e.target.value.trim(); if (!v) return;
    if (S.cond[t].indexOf(v) < 0) S.cond[t].push(v); App.render(false, true); var again = $('[data-t="' + t + '"]', el.filter); if (again) again.focus();
  });

  /* ── inspector: nothing selected · one asset · several ── */
  var sec = H.sec, kv = H.kv;
  function stageChips(cur, attr) { return '<div class="seg3">' + STAGES.map(function (s) { return '<button class="fchip" ' + attr + '="' + s + '" aria-pressed="' + (cur === s) + '">' + H.stage(s, 'short') + '</button>'; }).join('') + '</div>'; }
  /* relations, as lists: each group folds, each row jumps to the other asset or drops the relation */
  var RELG = [['up', '上游'], ['down', '下游'], ['uses', '引用'], ['usedBy', '被引用'], ['belongs', '归属'], ['members', '归属于它']];
  S.relShut = S.relShut || {};
  function relRows(a) {
    var r = D.rel(a);
    var s = RELG.map(function (g) {
      var list = r[g[0]]; if (!list.length) return '';
      var inward = g[0] === 'down' || g[0] === 'usedBy' || g[0] === 'members';
      return '<div class="relg"' + (S.relShut[g[0]] ? ' data-shut' : '') + '><button class="relg__head" data-relg="' + g[0] + '">' + I('chevron-right', 'bb-icon--12') + g[1] + '<span>' + list.length + '</span></button><div class="relg__body">' + list.map(function (x) {
        var o = x.a, stale = x.e.type === 'source' && D.staleAt(x.e, 8.64e15), note = D.noteOf(x.e, inward), del = '<button class="rel-x" data-rel-del="' + x.e.id + '" aria-label="删除这条关系" title="删除这条关系">' + I('x', 'bb-icon--12') + '</button>';
        if (!o) return '<div class="bb-row bb-row--media rel-miss" data-rel-broken="' + x.e.id + '"><span class="bb-row__thumb">' + I('file-question') + '</span><span class="bb-row__label">' + esc(x.name) + '<small>已不在资产库</small></span>' + H.issue('broken') + del + '</div>';
        return H.row({ thumb: thumb(o), label: o.name, sub: note, trailing: (stale ? H.issue('stale') : o.issue && !inward ? H.issue(o.issue) : '') + H.stage(o.stage) + H.review(o.review) + del }).replace('<div class="bb-row', '<div data-goto="' + o.id + '" class="bb-row');
      }).join('') + '</div></div>';
    }).join('') + '<button class="bb-btn bb-btn--sm bb-btn--ghost rel-add" data-rel-new>' + I('plus', 'bb-icon--12') + '建立关系…</button>';
    return ['<div class="sec-rows">' + s + '</div>', r.count];
  }
  /* E-02: the same issue offers the same buttons here as on the integrity page */
  var FIX = { stale: ['warning', '上游已更新，待复核', 'chest.glb 在 11 月 24 日被 user:lin 改过', [['确认已复核', 'ok', 1], ['替换内容…', 'replace']]], broken: ['danger', '指向的文件找不到了', 'potion_basecolor.png 已不在资产库里', [['重新指定…', 'x', 1], ['删除这条关系', 'ok']]], missing: ['danger', '文件缺失', '磁盘上找不到这个文件，它的标签和关系还在', [['重新定位文件…', 'ok', 1], ['确认删除', 'trash']]], failed: ['warning', '处理失败', '这台电脑的浏览器放不了这种视频（ProRes 4444）', [['查看错误', 'x', 1]]], identity: ['danger', '被当成了同一个资产', '它是连同 .bmeta 一起复制出来的，系统已把它改成独立的新资产', [['确认', 'ok', 1], ['其实这个才是原件…', 'x']]] };
  function techRows(a) {
    if (a.kind === 'model') return [['三角面', a.tris ? a.tris.toLocaleString('en-US') : '—'], ['材质', '1'], ['贴图', a.name === 'chest.glb' ? '3 张 · 最大 1024' : '2 张'], ['动画', a.name === 'chest.glb' ? '1 段 · open' : '无']];
    if (a.kind === 'image') return [['尺寸', a.w + ' × ' + a.h], ['透明通道', a.alpha ? '有' : '无'], ['色彩空间', 'sRGB']].concat(a.grid ? [['格子', a.grid.rows + ' 行 ' + a.grid.cols + ' 列 · ' + a.grid.cells.map(function (k, i) { return (App.VNAME || {})[k] + (i % a.grid.cols === a.grid.cols - 1 && i < a.grid.cells.length - 1 ? ' / ' : ' '); }).join('').trim()]] : []);  /* read-only: declared by whoever made the sheet (ADR-019) */
    if (a.kind === 'audio') return [['时长', a.info], ['声道', '立体声'], ['采样率', '48 kHz'], ['响度', '−16.2 LUFS']];
    if (a.kind === 'video') return a.dur ? [['时长', a.info], ['分辨率', '1280 × 720'], ['帧率', '30']] : [];
    if (a.kind === 'doc') return [['字数', '318'], ['行数', '42']].concat(a.target ? [['目标尺寸', a.target.w + ' × ' + a.target.h + ' × ' + a.target.d + ' m']] : []);
    return [];
  }
  function single(a) {
    var fx = a.issue && a.issue !== 'stale' && FIX[a.issue], rel = relRows(a), rec = D.recordFor(a), ver = D.versions(a).slice().reverse().map(function (v) { return [D.fmtAt(v.at), v.by, 'v' + v.v + ' · ' + esc(v.note), App.fmtSize(v.size)]; }), tech = techRows(a), stb = App.staleBanner ? App.staleBanner(a) : '';
    return '<div class="bb-insp__thumb' + (a.alpha && a.state !== 'missing' ? ' bb-cell__thumb--alpha' : '') + '" data-ql="' + a.id + '">' + (a.kind === 'doc' ? '<div class="bb-cell__doc"><b>' + esc(a.title) + '</b><p>' + esc(a.excerpt) + '</p></div>' : thumb(Object.assign({}, a, { fit: 'meet' }))) + '</div><div class="bb-insp__name">' + esc(a.name) + '</div>' +
      (stb ? '<div class="bb-insp__issue">' + stb + '</div>' : '') +
      (fx ? '<div class="bb-insp__issue">' + H.banner(fx[0], L.ISSUE[a.issue][1], fx[1], fx[2], fx[3].map(function (b) { return '<button class="bb-btn bb-btn--sm' + (b[2] ? ' bb-btn--primary' : '') + '" data-fix="' + b[1] + '">' + b[0] + '</button>'; }).join('')) + '</div>' : '') +
      sec('基本', kv([['路径', H.copy(a.path)], ['GUID', H.copy(a.id)], ['大小', App.fmtSize(a.bytes)], ['修改', App.fmtTime(a.modified) + ' · <span class="text-mono-sm">' + esc(App.who(a.by)) + '</span>']])) +
      sec('描述', descHtml(a)) +
      (a.bundle ? sec('包内文件', '<div class="bdl">' + a.files.map(function (f) { return '<div class="ex__f">' + I(L.KIND_ICON[f.kind], 'bb-icon--12') + '<span class="text-mono-sm">' + esc(f.path) + '</span>' + (f.path === a.entry ? '<span class="bb-tag">入口</span>' : '') + '<small>' + App.fmtSize(f.bytes) + '</small></div>'; }).join('') + '</div>', { count: a.files.length }) : '') +
      sec('标签', '<div class="bb-tags">' + a.tags.map(function (t) { return H.tag(t, { removable: true }); }).join('') + (a.aiTags || []).map(function (t) { return H.tag(t, { ai: true }); }).join('') + '<input class="taginput" placeholder="添加标签" aria-label="添加标签"></div>') +
      sec('阶段与校验', kv([['物料阶段', stageChips(a.stage, 'data-stage-set')], ['校验状态', '<button class="bb-select" data-review-menu>' + H.review(a.review, true) + I('chevron-down', 'bb-icon--12') + '</button>']].concat(a.reviewBy ? [['', '<span class="text-mono-sm">' + esc(App.who(a.reviewBy)) + '</span> · ' + D.fmtAt(a.reviewAt)]] : [], a.reviewNote ? [['意见', '<span class="rv__inote' + (a.review === 'rejected' ? ' rej' : '') + '">' + esc(a.reviewNote) + '</span>']] : []))) +
      (tech.length ? sec('技术信息', kv(tech), { by: 'bowerbird.' + a.kind }) : '') +
      sec('关系', rel[0], { count: rel[1], collapsed: !rel[1] }) +
      (rec ? sec('生产记录', kv([['方式', rec.plugin ? '<span class="text-mono-sm">' + esc(rec.method) + '</span>' : rec.method], ['工具', rec.tool]].concat(rec.plugin ? [['插件', '<span class="text-mono-sm">' + esc(rec.plugin) + '</span>']] : [], [['执行者', '<span class="text-mono-sm">' + esc(App.who(rec.by)) + '</span>']], rec.params ? [['参数', rec.params]] : [], (rec.inputs || []).map(function (x) { return [x.role, '<span class="text-mono-sm">' + esc(x.name) + '</span>']; }))) + (rec.prompt ? '<pre class="prompt">' + esc(rec.prompt) + '</pre>' : '')) : '') +
      sec('版本', ver.map(function (v) { return '<div class="ver"><b>' + v[2] + '</b><span>' + v[3] + '</span><span>' + v[0] + ' · <span class="text-mono-sm">' + v[1] + '</span></span></div>'; }).join(''), { count: ver.length, collapsed: true });
  }
  function descHtml(a) {
    return '<div class="dsc">' + (a.desc ? '<p class="dsc__h" data-desc-edit tabindex="0" title="点按编辑">' + esc(a.desc) + '</p>' : '<button class="bb-btn bb-btn--sm bb-btn--ghost dsc__add" data-desc-edit>' + I('plus', 'bb-icon--12') + '写描述</button>') +
      (a.aiDesc && !a.desc ? '<p class="dsc__ai">' + I('sparkles', 'bb-icon--12') + '<span>' + esc(a.aiDesc) + '</span><button class="bb-btn bb-btn--ghost bb-btn--sm" data-desc-adopt>采用</button></p>' : a.aiDesc ? '<p class="dsc__ai dsc__ai--sub">' + I('sparkles', 'bb-icon--12') + '<span>' + esc(a.aiDesc) + '</span></p>' : '') + '</div>';
  }
  function editDesc(a, host) {
    var was = a.desc || '';
    host.innerHTML = '<div class="bb-field bb-field--area"><textarea class="bb-field__input" rows="3" aria-label="描述" placeholder="写给人和 Agent 看的一两句话">' + esc(was) + '</textarea></div><p class="dsc__hint">⌘↵ 保存 · Esc 取消</p>';
    var t = $('textarea', host); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
    function done(save) { if (!t.isConnected) return; var v = t.value.trim(); if (save && v !== was) { a.desc = v; App.renderInsp(); App.toast(v ? '已保存描述' : '已清空描述', function () { a.desc = was; App.renderInsp(); }); } else App.renderInsp(); }
    t.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } });
    t.addEventListener('blur', function () { done(true); });
  }
  el.insp.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-desc-edit]'), ad = e.target.closest('[data-desc-adopt]'); if (!ed && !ad) return; var a = App.byId(S.focus || S.sel[0]); if (!a) return;
    if (ad) { a.desc = a.aiDesc; App.renderInsp(); return App.toast('已采用 AI 描述', function () { a.desc = ''; App.renderInsp(); }); }
    editDesc(a, ed.closest('.dsc'));
  });
  el.insp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('.dsc__h')) { e.preventDefault(); e.target.click(); } });
  /* F-09: the regular way to make a new version — pick the new file, say what changed */
  App.replaceContent = function (a) {
    var next = D.versions(a).length + 1, file = a.name.replace(/(\.[^.]+)$/, '_v' + next + '$1');
    var d = App.dialog({ title: '替换 ' + esc(a.name) + ' 为新版本', form: true, body: '<div class="rep__file">' + I('file-up') + '<span class="text-mono-sm">' + esc(file) + '</span><span class="bb-toolbar__grow"></span><button class="bb-btn bb-btn--sm" data-rep-pick>选择文件…</button></div>' +
      '<label class="st__lab">这一版改了什么</label><div class="bb-field bb-field--area"><textarea class="bb-field__input" id="repnote" rows="2" placeholder="可不填" aria-label="版本说明"></textarea></div>' +
      '<p class="fo__p fo__sub">文件名和编号不变，新内容成为 v' + next + '，校验回到待审。</p>',
      actions: [{ label: '取消' }, { label: '替换', kind: 'primary', act: function (h) {
        var note = ($('#repnote', h).value || '').trim() || '替换内容', prev = { review: a.review, issue: a.issue }, v = D.addVersion(a, App.me(), note);
        if (a.review !== 'exempt') a.review = 'pending'; if (a.issue === 'stale') { a.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); } App.render(); if (App.detailRefresh) App.detailRefresh();
        App.toast('已替换为 v' + v.v + '，回到待审', function () { D.versions(a).pop(); a.review = prev.review; a.issue = prev.issue; App.render(); if (App.detailRefresh) App.detailRefresh(); });
      } }] });
    $('[data-rep-pick]', d).addEventListener('click', function () { App.toast('会打开系统的选择文件窗口'); });
    setTimeout(function () { $('#repnote', d).focus(); }, 0);
  };
  function mixOf(as, key, render) { var m = {}; as.forEach(function (a) { m[a[key]] = (m[a[key]] || 0) + 1; }); var ks = Object.keys(m); return { same: ks.length === 1 ? ks[0] : null, html: '<div class="mix">' + ks.map(function (k) { return '<span>' + render(k) + ' ' + m[k] + '</span>'; }).join('') + '</div>' }; }
  function batch(as) {
    var st = mixOf(as, 'stage', function (k) { return H.stage(k, 'short'); }), rv = mixOf(as, 'review', function (k) { return H.review(k, true); }), cnt = {}, bytes = 0;
    as.forEach(function (a) { bytes += a.bytes; a.tags.forEach(function (t) { cnt[t] = (cnt[t] || 0) + 1; }); });
    var tags = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x]; }).map(function (t) { return cnt[t] === as.length ? H.tag(t, { removable: true }) : '<span class="bb-tag" data-partial data-tag-all="' + esc(t) + '" title="加到全部"><span>' + esc(t) + '</span><small>' + cnt[t] + '/' + as.length + '</small></span>'; }).join('');
    return '<div class="batch-head"><div class="stack">' + as.slice(0, 3).map(function (a) { return '<span class="bb-row__thumb">' + thumb(a) + '</span>'; }).join('') + '</div><div><b>已选 ' + as.length + ' 个</b><small>' + App.fmtSize(bytes) + '</small></div></div>' +
      sec('标签', '<div class="bb-tags">' + tags + '<input class="taginput" placeholder="加到全部" aria-label="给全部选中的资产添加标签"></div>') +
      sec('物料阶段', (st.same ? '' : st.html) + stageChips(st.same, 'data-stage-set')) +
      sec('校验状态', (rv.same ? '' : rv.html) + '<div><button class="bb-select" data-review-menu>' + (rv.same ? H.review(rv.same, true) : '混合') + I('chevron-down', 'bb-icon--12') + '</button></div>') +
      '<div class="bb-sec"><div class="seg3"><button class="bb-btn" data-batch="move">' + I('folder-input') + '移动到…</button><button class="bb-btn" data-batch="trash">' + I('trash-2') + '移入回收站</button></div></div>';
  }
  function defaultsFor(id) { var p = id; while (p) { if (D.folderDefaults[p]) return D.folderDefaults[p]; p = p.indexOf('/') > 0 ? p.slice(0, p.lastIndexOf('/')) : ''; } return (D.folderDefaults[id] = { stage: 'production', exempt: false, tags: [] }); }
  App.defaultsFor = defaultsFor;
  function defaultsHtml(id) { var d = defaultsFor(id); return kv([['物料阶段', stageChips(d.stage, 'data-def-stage')], ['免审', '<button class="bb-switch" data-own="1" data-def-exempt role="switch" aria-checked="' + d.exempt + '" aria-label="免审"></button>'], ['标签', '<div class="bb-tags">' + d.tags.map(function (t) { return H.tag(t, { removable: true }); }).join('') + '<input class="taginput" data-def-tag placeholder="添加" aria-label="默认标签"></div>']]); }
  function none() {
    var all = S._list || [], bytes = 0, n = { reference: 0, production: 0, runtime: 0 }, pend = 0, iss = 0, last = null;
    all.forEach(function (a) { bytes += a.bytes; n[a.stage]++; if (a.review === 'pending') pend++; if (a.issue) iss++; if (!last || a.modified > last.modified) last = a; });
    var t = S.emptyLib ? [App.libName()] : App.locTitle(), isF = S.loc.type === 'folder' && !S.emptyLib, m = isF ? App.meta(S.loc.id) : null;
    var head = isF
      ? '<div class="fhead"><button class="ficon" data-ficon aria-label="更换图标" title="更换图标">' + I(m.icon || 'folder', 'bb-icon--24') + '</button><div class="fhead__t"><b>' + esc(t[t.length - 1]) + '</b><input class="finput" data-flabel value="' + esc(m.label || '') + '" placeholder="显示名" aria-label="显示名" autocomplete="off"></div></div>' +
        '<div class="fnote-wrap"><textarea class="finput fnote" data-fnote rows="2" placeholder="备注" aria-label="备注">' + esc(m.note || '') + '</textarea></div>'
      : '<div class="batch-head"><div><b>' + t[t.length - 1] + '</b><small>' + all.length + ' 个资产 · ' + App.fmtSize(bytes) + '</small></div></div>';
    return head +
      sec('概况', kv([].concat(isF ? [['路径', H.copy(S.loc.id + '/')], ['资产', all.length + ' 个 · ' + App.fmtSize(bytes)]] : [], [['最近修改', last ? App.fmtTime(last.modified) + ' · <span class="text-mono-sm">' + last.by + '</span>' : '—'], ['物料阶段', '<div class="mix">' + STAGES.map(function (s) { return '<span>' + H.stage(s, 'short') + ' ' + n[s] + '</span>'; }).join('') + '</div>'], ['待审', String(pend)], ['有问题', String(iss)]]))) +
      (S.loc.type === 'folder' && !S.emptyLib ? '<div data-def="' + S.loc.id + '">' + sec('新资产的默认值', defaultsHtml(S.loc.id)) + '</div>' : '');
  }
  App.renderInsp = function () {
    var ae = document.activeElement; if (ae && el.insp.contains(ae) && ae.classList.contains('finput')) return;
    var as = sel(), keep = document.activeElement && document.activeElement.classList.contains('taginput') && el.insp.contains(document.activeElement);
    el.insp.innerHTML = S.state !== 'ready' ? '' : !as.length ? none() : as.length === 1 ? single(as[0]) : batch(as);
    /* E-24: a selection the current view no longer shows says so instead of silently disagreeing with the grid */
    if (as.length && S.state === 'ready' && !App.detailOpen && !App.pageOn) { var vis = App.list(), out = as.filter(function (x) { return vis.indexOf(x) < 0; }).length; if (out) el.insp.insertAdjacentHTML('afterbegin', '<p class="insp__gone">' + I('eye-off', 'bb-icon--12') + (as.length > 1 ? out + ' 个已不在这个视图里' : '已不在这个视图里') + '</p>'); }
    if (keep) { var t = $('.taginput', el.insp); if (t) t.focus(); }
  };
  function addTag(as, t) { var prev = as.map(function (a) { return a.tags.slice(); }); as.forEach(function (a) { if (a.tags.indexOf(t) < 0) a.tags.push(t); }); App.render(); if (as.length > 1) App.toast('已给 ' + as.length + ' 个资产加上标签「' + t + '」', function () { as.forEach(function (a, i) { a.tags = prev[i]; }); App.render(); }); }
  function applyDefaults(root, e) {
    var d = defaultsFor(root.dataset.def), st = e.target.closest('[data-def-stage]'), ex = e.target.closest('[data-def-exempt]'), rm = e.target.closest('.bb-tag__act');
    if (!D.folderDefaults[root.dataset.def]) d = D.folderDefaults[root.dataset.def] = { stage: d.stage, exempt: d.exempt, tags: d.tags.slice() };
    if (st) d.stage = st.getAttribute('data-def-stage'); else if (ex) d.exempt = !d.exempt; else if (rm) d.tags.splice(d.tags.indexOf(rm.parentElement.querySelector('span').textContent), 1); else return false;
    return true;
  }
  el.insp.addEventListener('click', function (e) {
    var as = sel(), a = as[0], t = e.target, def = t.closest('[data-def]');
    if (def) { if (applyDefaults(def, e)) App.renderInsp(); return; }
    var fi = t.closest('[data-ficon]'); if (fi) return iconPicker(fi);
    var sa = t.closest('[data-stale]'); if (sa) return App.staleAct(a, sa.dataset.stale);
    var rg = t.closest('[data-relg]'); if (rg) { S.relShut[rg.dataset.relg] = !S.relShut[rg.dataset.relg]; return rg.parentElement.toggleAttribute('data-shut'); }
    if (t.closest('[data-rel-new]')) return App.relationDialog(a);
    var rd = t.closest('[data-rel-del]'); if (rd) { var ed = D.EDGES.filter(function (x) { return x.id === rd.dataset.relDel; })[0]; if (ed) App.removeRelation(ed); return; }
    var rb = t.closest('[data-rel-broken]'); if (rb) { var eb = D.EDGES.filter(function (x) { return x.id === rb.dataset.relBroken; })[0]; if (eb) App.relationDialog(a, { type: eb.type, relink: eb }); return; }
    if (t.closest('[data-ql]')) return App.quickLook(a.id);
    var st = t.closest('[data-stage-set]'); if (st) return App.setStage(st.getAttribute('data-stage-set'));
    var rm = t.closest('[data-review-menu]'); if (rm) return App.menu(REVIEWS.map(function (r) { return { html: H.review(r, true), check: as.every(function (x) { return x.review === r; }), act: function () { if (r === 'rejected') return App.rejectWithNote(as); as.forEach(function (x) { App.setVerdict(x, r); }); App.render(); } }; }), rm);
    var go = t.closest('[data-goto]'); if (go) { var o = App.byId(go.dataset.goto); if (App.detailOpen) return App.openDetail(o.id); App.go({ type: 'folder', id: o.folder }); return App.select(o.id, 'one'); }
    var fix = t.closest('[data-fix]'); if (fix) { if (fix.dataset.fix === 'ok') { a.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); App.render(); App.toast('已处理，标记已清除'); } else if (fix.dataset.fix === 'trash') App.act('trash'); return; }
    var all = t.closest('[data-tag-all]'); if (all) return addTag(as, all.dataset.tagAll);
    var bt = t.closest('[data-batch]'); if (bt && bt.dataset.batch === 'trash') return App.act('trash');
    var act = t.closest('.bb-tag__act'); if (!act) return;
    var name = act.parentElement.querySelector('span').textContent;
    if (act.dataset.act === 'adopt') { a.aiTags.splice(a.aiTags.indexOf(name), 1); a.tags.push(name); }
    else if (act.closest('.bb-tag--ai')) a.aiTags.splice(a.aiTags.indexOf(name), 1);
    else as.forEach(function (x) { var i = x.tags.indexOf(name); if (i >= 0) x.tags.splice(i, 1); });
    App.render();
  });
  /* folder display info: name shown beside the folder, its icon and a note — kept in the folder's _folder.bmeta */
  var FOLDER_ICONS = ['folder', 'box', 'user', 'image', 'film', 'audio-lines', 'file-text', 'layers', 'sparkles', 'tag', 'puzzle', 'waypoints', 'hard-drive', 'inbox', 'activity', 'scan-search', 'shield-check', 'history'];
  function iconPicker(btn) {
    var id = S.loc.id, m = App.meta(id), cur = m.icon || 'folder';
    var p = App.pop('<div class="igrid">' + FOLDER_ICONS.map(function (n) { return '<button data-pick-icon="' + n + '" aria-pressed="' + (cur === n) + '" aria-label="' + n + '" title="' + n + '">' + I(n) + '</button>'; }).join('') + '</div>', btn);
    p.addEventListener('click', function (e) { var b = e.target.closest('[data-pick-icon]'); if (!b) return; if (b.dataset.pickIcon === 'folder') delete m.icon; else m.icon = b.dataset.pickIcon; closeFloat(); App.renderSide(); App.renderInsp(); });
  }
  el.insp.addEventListener('input', function (e) {
    var t = e.target, m = S.loc.type === 'folder' ? App.meta(S.loc.id) : null; if (!m) return;
    if (t.hasAttribute('data-flabel')) { if (t.value.trim()) m.label = t.value.trim(); else delete m.label; App.renderSide(); }
    if (t.hasAttribute('data-fnote')) { if (t.value.trim()) m.note = t.value; else delete m.note; }
  });
  el.insp.addEventListener('focusout', function (e) { if (e.target.classList && e.target.classList.contains('finput')) App.renderSide(); });
  el.insp.addEventListener('keydown', function (e) {
    if (e.target.classList.contains('finput')) { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.target.blur(); } return; }
    if (!e.target.classList.contains('taginput')) return;
    if (e.key === 'Escape') return e.target.blur();
    if (e.key !== 'Enter') return; var v = e.target.value.trim(); if (!v) return;
    var def = e.target.closest('[data-def]');
    if (def) { applyDefaults(def, { target: document.body }); var d = D.folderDefaults[def.dataset.def]; if (d.tags.indexOf(v) < 0) d.tags.push(v); App.renderInsp(); var again = $('[data-def-tag]', el.insp); if (again) again.focus(); return; }
    addTag(sel(), v);
  });
  /* ── folders and smart folders in the side bar (F-05, F-06) ── */
  function fNode(id) { var p = id.split('/'), top = D.folders.filter(function (f) { return f[0] === p[0]; })[0]; if (!top) return null; if (p.length === 1) return { top: top }; var ch = top[3].filter(function (c) { return c[0] === p[1]; })[0]; return ch ? { top: top, ch: ch } : null; }
  function inFolder(id) { return D.assets.filter(function (a) { return a.folder === id || a.folder.indexOf(id + '/') === 0; }); }
  function closeDlg(h) { h.remove(); App.modal = !!$('.bb-scrim', el.layer); }
  function nameDlg(title, fields, ok, okLabel) {
    var d = App.dialog({ title: title, form: true, body: fields.map(function (f, i) { return '<label class="st__lab">' + f[0] + '</label><div class="bb-field"><input class="bb-field__input" data-nf="' + i + '" value="' + esc(f[1]) + '" aria-label="' + f[0] + '" autocomplete="off"' + (f[3] ? ' placeholder="' + f[3] + '"' : '') + '></div>' + (f[2] ? '<p class="fo__p fo__sub">' + f[2] + '</p>' : ''); }).join(''),
      actions: [{ label: '取消' }, { label: okLabel || '好', kind: 'primary', keep: true, act: function (h) { var v = $$('[data-nf]', h).map(function (x) { return x.value.trim(); }), err = ok(v); if (err) { var x = $('[data-nf="0"]', h); x.parentNode.setAttribute('data-invalid', ''); App.toast(err); return x.focus(); } closeDlg(h); } }] });
    d.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-nf]')) { e.preventDefault(); d.querySelector('[data-k="1"]').click(); } });
    setTimeout(function () { var x = $('[data-nf="0"]', d); x.focus(); x.select(); }, 0);
  }
  function newSub(id) {
    nameDlg('在 ' + id + ' 里新建文件夹', [['名称', '', '', '例如 variants']], function (v) {
      var n = v[0]; if (!n) return '先填名称'; if (/[\/\\:]/.test(n)) return '名称里不能有 / \\ :';
      var node = fNode(id); if (!node || node.ch) return '这里只演示两层文件夹';
      if (node.top[3].some(function (c) { return c[0] === n; })) return '已经有叫 ' + n + ' 的文件夹';
      node.top[3].push([n, 0]); S.open[id] = true; App.renderSide(); App.toast('已新建 ' + id + '/' + n, function () { node.top[3].splice(node.top[3].findIndex(function (c) { return c[0] === n; }), 1); App.renderSide(); });
    }, '新建');
  }
  /* the folder name is the directory on disk; the display name only lives in Bowerbird (folder settings) */
  function renameFolder(id) {
    var node = fNode(id), m = App.meta(id), n = inFolder(id).length, base = id.split('/').pop();
    nameDlg('改名 ' + id, [['文件夹名', base, '改的是磁盘上的目录名，里面 ' + n + ' 个资产一起换路径，引用不受影响'], ['显示名', m.label || '', '只在 Bowerbird 里显示，磁盘上不变', '可不填']], function (v) {
      var nn = v[0], lab = v[1]; if (!nn) return '文件夹名不能为空'; if (/[\/\\:]/.test(nn)) return '名称里不能有 / \\ :';
      var sib = node.ch ? node.top[3].map(function (c) { return c[0]; }) : D.folders.map(function (f) { return f[0]; }); if (nn !== base && sib.indexOf(nn) >= 0) return '同一层已经有 ' + nn;
      var was = { name: base, label: m.label }, nid = id.slice(0, id.length - base.length) + nn;
      function apply(from, to, name, label) { (node.ch || node.top)[0] = name; inFolder(from).forEach(function (a) { a.folder = to + a.folder.slice(from.length); a.path = a.folder + '/' + a.name; }); var mm = App.meta(from); if (from !== to) { D.folderMeta[to] = mm; delete D.folderMeta[from]; } mm.label = label; if (S.loc.type === 'folder' && S.loc.id.indexOf(from) === 0) S.loc = { type: 'folder', id: to + S.loc.id.slice(from.length) }; App.render(); }
      apply(id, nid, nn, lab);
      App.toast(nn !== base ? '已改名为 ' + nn : '已改显示名', function () { apply(nid, id, was.name, was.label); });
    }, '改名');
  }
  /* F-10: a folder becomes one asset only when someone says so; its .bmeta sits beside it, the files inside stop being separate assets */
  function bundleFolder(id) {
    var as = inFolder(id), node = fNode(id), name = id.split('/').pop(), parent = id.slice(0, id.length - name.length - 1), entry = as.filter(function (a) { return /\.html?$/.test(a.name); })[0];
    if (!as.length) return App.toast('这个文件夹是空的');
    var used = D.EDGES.filter(function (e) { return as.some(function (a) { return a.id === e.to; }) && !as.some(function (a) { return a.id === e.from; }); }).length;
    App.dialog({ title: '把 ' + esc(name) + ' 作为一个资产？', text: '里面 ' + as.length + ' 个文件合成一个资产，以后整体浏览、校验和引用。' + (used ? '有 ' + used + ' 条关系指向里面的文件，会改为指向这个资产。' : ''),
      body: '<div class="fo__ex">' + I('folder', 'bb-icon--12') + '<span class="text-mono-sm">' + esc(name) + '/</span>' + I('file-plus', 'bb-icon--12') + '<span class="text-mono-sm">' + esc(name) + '.bmeta</span></div><div class="ex__list">' + as.map(function (a) { return '<div class="ex__f">' + I(L.KIND_ICON[a.kind], 'bb-icon--12') + '<span class="text-mono-sm">' + esc(a.path.slice(id.length + 1)) + '</span><small>' + App.fmtSize(a.bytes) + '</small></div>'; }).join('') + '</div>',
      actions: [{ label: '取消' }, { label: '作为一个资产', kind: 'primary', icon: 'package', act: function () {
        var idx = node.top[3].indexOf(node.ch), b = D.mk(name, parent, 'doc', { bundle: true, entry: entry ? entry.name : null, title: entry ? entry.title || name : name, excerpt: entry ? entry.excerpt || '' : '', files: as.map(function (a) { return { path: a.path.slice(id.length + 1), kind: a.kind, bytes: a.bytes }; }), info: '包 · ' + as.length + ' 个文件', stage: as[0].stage, review: 'pending', tags: entry ? entry.tags.slice() : [], by: App.me(), bytes: as.reduce(function (s, a) { return s + a.bytes; }, 0) });
        b.modified = D.tick(); as.forEach(function (a) { D.assets.splice(D.assets.indexOf(a), 1); }); D.assets.unshift(b); node.top[3].splice(idx, 1);
        S.loc = { type: 'folder', id: parent }; S.sel = [b.id]; S.focus = b.id; App.render(true);
        App.toast('已把 ' + name + ' 作为一个资产', function () { D.assets.splice(D.assets.indexOf(b), 1); as.forEach(function (a) { D.assets.push(a); }); node.top[3].splice(idx, 0, node.ch); App.go({ type: 'folder', id: id }); });
      } }] });
  }
  /* a folder goes to the trash with everything in it; it always asks, and says how much is inside */
  function trashFolder(id) {
    var as = inFolder(id), node = fNode(id);
    App.dialog({ title: '把 ' + esc(id) + ' 移入回收站？', text: as.length ? '里面有 ' + as.length + ' 个资产，会一起移入回收站。回收站保留 ' + (App.trashKeep || 7) + ' 天，期间可以恢复。' : '这是一个空文件夹。',
      actions: [{ label: '取消' }, { label: '移入回收站', kind: 'danger', icon: 'trash-2', act: function () {
        var idx = node.ch ? node.top[3].indexOf(node.ch) : D.folders.indexOf(node.top), list = node.ch ? node.top[3] : D.folders, item = list.splice(idx, 1)[0];
        as.forEach(function (a) { D.assets.splice(D.assets.indexOf(a), 1); a.trashedAt = D.tick(); a.trashedBy = App.me(); S.trash.unshift(a); });
        if (S.loc.type === 'folder' && S.loc.id.indexOf(id) === 0) S.loc = { type: 'view', id: 'all' }; App.render();
        App.toast('已把 ' + id + ' 移入回收站', function () { list.splice(idx, 0, item); as.forEach(function (a) { S.trash.splice(S.trash.indexOf(a), 1); D.assets.push(a); }); App.render(); });
      } }] });
  }
  /* moving: the server refuses a name that is already taken; the shell asks what to do (keep both / replace / skip) */
  App.moveAssets = function (ids, to) {
    var as = ids.map(App.byId).filter(Boolean).filter(function (a) { return a.folder !== to; }); if (!as.length) return;
    var clash = as.filter(function (a) { return D.assets.some(function (x) { return x !== a && x.folder === to && x.name === a.name; }); });
    function go(mode) {
      var prev = as.map(function (a) { return [a, a.folder, a.name]; }), gone = [];
      as.forEach(function (a) {
        var hit = D.assets.filter(function (x) { return x !== a && x.folder === to && x.name === a.name; })[0];
        if (hit && mode === 'skip') return;
        if (hit && mode === 'replace') { D.assets.splice(D.assets.indexOf(hit), 1); hit.trashedAt = D.tick(); hit.trashedBy = App.me(); S.trash.unshift(hit); gone.push(hit); }
        if (hit && mode === 'both') { var dot = a.name.lastIndexOf('.'), k = 1; while (D.assets.some(function (x) { return x.folder === to && x.name === a.name.slice(0, dot) + '_' + k + a.name.slice(dot); })) k++; a.name = a.name.slice(0, dot) + '_' + k + a.name.slice(dot); }
        a.folder = to; a.path = to + '/' + a.name;
      });
      S.sel = []; App.render();
      var moved = prev.filter(function (p) { return p[0].folder === to; }).length;
      App.toast('已把 ' + moved + ' 个资产移到 ' + to, function () { prev.forEach(function (p) { p[0].folder = p[1]; p[0].name = p[2]; p[0].path = p[1] + '/' + p[2]; }); gone.forEach(function (h) { S.trash.splice(S.trash.indexOf(h), 1); D.assets.push(h); }); App.render(); });
    }
    if (!clash.length) return go('none');
    App.dialog({ title: to + ' 里已经有同名的文件', text: clash.length > 1 ? clash.length + ' 个文件同名：' + clash.slice(0, 3).map(function (a) { return a.name; }).join('、') + (clash.length > 3 ? '…' : '') : clash[0].name + ' 已经在那里了。',
      actions: [{ label: '取消' }, { label: '跳过同名的', act: function () { go('skip'); } }, { label: '替换（旧的进回收站）', kind: 'danger', act: function () { go('replace'); } }, { label: '都保留', kind: 'primary', act: function () { go('both'); } }] });
  };
  App.moveDialog = function (ids) {
    var all = [].concat.apply([], D.folders.map(function (f) { return [f[0]].concat(f[3].map(function (c) { return f[0] + '/' + c[0]; })); })), pick = null;
    var d = App.dialog({ title: '移动 ' + (ids.length > 1 ? ids.length + ' 个资产' : esc(App.byId(ids[0]).name)), form: true, body: '<div class="cpl sw__list">' + all.map(function (f) { return '<button class="cpl__it" role="radio" aria-checked="false" data-mv="' + f + '">' + I(f.indexOf('/') > 0 ? 'folder' : 'folder-open') + '<span class="text-mono-sm">' + f + '</span></button>'; }).join('') + '</div>',
      actions: [{ label: '取消' }, { label: '移动', kind: 'primary', act: function () { if (pick) App.moveAssets(ids, pick); } }] });
    var ok = d.querySelector('[data-k="1"]'); ok.disabled = true;
    d.addEventListener('click', function (e) { var b = e.target.closest('[data-mv]'); if (!b) return; pick = b.dataset.mv; $$('[data-mv]', d).forEach(function (x) { x.setAttribute('aria-checked', x === b); }); ok.disabled = false; });
  };
  /* smart folders: a saved query — rename, edit its conditions, update it with the current ones, delete (always asked) */
  function smartMenu(i, e) {
    var m = S.smart[i], cur = App.condActive() || S.q;
    App.menu([{ icon: 'pencil', label: '改名…', act: function () { nameDlg('改名', [['名称', m.name]], function (v) { if (!v[0]) return '名称不能为空'; var was = m.name; m.name = v[0]; App.render(); App.toast('已改名为 ' + v[0], function () { m.name = was; App.render(); }); }, '改名'); } },
      { icon: 'list-filter', label: '编辑条件', act: function () { App.go({ type: 'view', id: 'all' }); S.cond = Object.assign(App.emptyCond(), JSON.parse(JSON.stringify(m.cond))); S.editSmart = i; S.filterOpen = true; App.render(false, true); } },
      { icon: 'refresh-cw', label: '用当前条件更新', disabled: !cur, hint: cur ? '' : '先设好条件', act: function () { var was = m.cond; m.cond = JSON.parse(JSON.stringify(S.cond)); App.toast('已用当前条件更新「' + m.name + '」', function () { m.cond = was; App.render(); }); App.render(); } },
      'sep', { icon: 'trash-2', label: '删除…', danger: true, act: function () { App.dialog({ title: '删除智能文件夹「' + esc(m.name) + '」？', text: '只删掉这个保存的查询，里面的资产不受影响。', actions: [{ label: '取消' }, { label: '删除', kind: 'danger', act: function () { S.smart.splice(i, 1); if (S.loc.type === 'smart') App.go({ type: 'view', id: 'all' }); else App.render(); App.toast('已删除「' + m.name + '」', function () { S.smart.splice(i, 0, m); App.render(); }); } }] }); } }], e);
  }
  App.saveSmartEdit = function () { var i = S.editSmart, m = S.smart[i]; if (m == null) return; m.cond = JSON.parse(JSON.stringify(S.cond)); S.editSmart = null; S.cond = App.emptyCond(); S.filterOpen = false; App.go({ type: 'smart', id: i }); App.toast('已保存「' + m.name + '」的条件'); };
  el.side.addEventListener('contextmenu', function (e) {
    var r = e.target.closest('[data-loc]'); if (!r) return; e.preventDefault(); var p = r.dataset.loc.split(':'), id = p[1];
    if (p[0] === 'folder') return App.menu([{ icon: 'info', label: '文件夹信息', act: function () { App.go({ type: 'folder', id: id }); if (el.app.getAttribute('data-insp') === 'closed') App.togglePanel('insp'); var f = $('[data-flabel]', el.insp); if (f) { f.focus(); f.select(); } } },
      { icon: 'folder-plus', label: '新建子文件夹…', disabled: id.indexOf('/') > 0, act: function () { newSub(id); } }, { icon: 'pencil', label: '改名…', act: function () { renameFolder(id); } },
      { icon: 'package', label: '把这个文件夹作为一个资产…', disabled: id.indexOf('/') < 0, act: function () { bundleFolder(id); } },
      { icon: 'refresh-cw', label: '只扫描这个文件夹', act: function () { App.toast('正在扫描 ' + id + '…'); setTimeout(function () { App.toast('扫描完成 ' + id + '：没有发现变化'); }, 900); } },
      'sep', { icon: 'trash-2', label: '移入回收站…', danger: true, act: function () { trashFolder(id); } }], e);
    if (p[0] === 'smart') return smartMenu(+id, e);
  });

  /* ── upload: review the batch → resolve name conflicts → progress, placeholders, thumbnails arrive ──
   * F-12: the target folder can be changed here; what it hands down (stage, tags, exempt) is shown; a dropped folder keeps its structure;
   * each file can be cancelled while it goes up, and a failed one says why and can be retried. */
  function fileRow(f, keep) { return H.row({ icon: L.KIND_ICON[f.kind], label: f.name, sub: f.from ? (keep ? f.from + '/' : '来自 ' + f.from) : '', trailing: '<span class="bb-row__count">' + App.fmtSize(f.bytes) + '</span>' }); }
  function allFolders() { return [].concat.apply([], D.folders.map(function (f) { return [f[0]].concat(f[3].map(function (c) { return f[0] + '/' + c[0]; })); })); }
  App.upload = function (pre) {
    var folder = pre != null ? pre : S.emptyLib || S.loc.type !== 'folder' ? '' : S.loc.id, files = D.batch.map(function (f) { return Object.assign({}, f); }), dropped = files.some(function (f) { return f.from; });
    var opt = { source: null, keep: dropped };
    function inherit() { var d = folder ? defaultsFor(folder) : { stage: 'production', exempt: false, tags: [] }; opt.stage = d.stage; opt.tags = d.tags.slice(); opt.exempt = d.exempt; opt.from = folder && D.folderDefaults[folder] ? folder : folder ? (function () { var p = folder; while (p && !D.folderDefaults[p]) p = p.indexOf('/') > 0 ? p.slice(0, p.lastIndexOf('/')) : ''; return p; })() : ''; }
    inherit();
    function body() {
      return '<div class="up-to"><span>放到</span><button class="bb-select" data-up-to>' + I('folder', 'bb-icon--12') + '<span class="text-mono-sm">' + esc(folder || '资产库根目录') + '</span>' + I('chevron-down', 'bb-icon--12') + '</button>' +
        (dropped ? '<span class="bb-toolbar__grow"></span><span class="up-keep"><button class="bb-switch" data-own="1" data-up-keep role="switch" aria-checked="' + opt.keep + '" aria-label="保留文件夹结构"></button>保留文件夹结构</span>' : '') + '</div>' +
        '<div class="up-list">' + files.map(function (f) { return fileRow(f, opt.keep); }).join('') + '</div>' +
        '<div class="up-opts"><span>物料阶段</span>' + stageChips(opt.stage, 'data-up-stage') + '<span>标签</span><div class="bb-tags">' + opt.tags.map(function (t) { return H.tag(t, { removable: true }); }).join('') + '<input class="taginput" placeholder="添加标签" aria-label="添加标签"></div>' +
        '<span>免审</span><div><button class="bb-switch" data-own="1" data-up-exempt role="switch" aria-checked="' + !!opt.exempt + '" aria-label="免审"></button></div>' +
        '<span>来源</span><div><button class="bb-select" data-up-src>' + (opt.source ? esc(opt.source.name) : '无') + I('chevron-down', 'bb-icon--12') + '</button></div></div>' +
        (opt.from ? '<p class="up-inh">' + I('corner-down-right', 'bb-icon--12') + '阶段、标签和免审来自 <span class="text-mono-sm">' + esc(opt.from) + '</span> 的默认值</p>' : '');
    }
    var dlg = App.dialog({ wide: true, title: '上传 ' + files.length + ' 个文件', body: body(), actions: [{ label: '取消' }, { label: '上传', kind: 'primary', icon: 'upload', act: function () {
      var list = files.map(function (f) { var g = Object.assign({}, f); g.dest = opt.keep && f.from ? (folder ? folder + '/' : '') + f.from : folder; return g; });
      conflicts(list, opt);
    } }] });
    var bd = $('.bb-dialog__body', dlg), redraw = function () { bd.innerHTML = body(); };
    bd.addEventListener('click', function (e) {
      var st = e.target.closest('[data-up-stage]'), rm = e.target.closest('.bb-tag__act'), src = e.target.closest('[data-up-src]'), to = e.target.closest('[data-up-to]');
      if (e.target.closest('[data-up-keep]')) { opt.keep = !opt.keep; return redraw(); }
      if (e.target.closest('[data-up-exempt]')) { opt.exempt = !opt.exempt; return redraw(); }
      if (to) return App.menu([{ label: '资产库根目录', check: !folder, act: function () { folder = ''; inherit(); redraw(); } }, 'sep'].concat(allFolders().map(function (f) { return { label: f, check: folder === f, act: function () { folder = f; inherit(); redraw(); } }; })), to);
      if (st) { opt.stage = st.getAttribute('data-up-stage'); redraw(); }
      else if (rm) { opt.tags.splice(opt.tags.indexOf(rm.parentElement.querySelector('span').textContent), 1); redraw(); }
      else if (src) App.menu([{ label: '无', check: !opt.source, act: function () { opt.source = null; redraw(); } }].concat(D.assets.filter(function (a) { return a.kind === 'image' && a.stage === 'production'; }).slice(0, 5).map(function (a) { return { label: a.name, check: opt.source === a, act: function () { opt.source = a; redraw(); } }; })), src);
    });
    bd.addEventListener('keydown', function (e) { if (e.target.classList.contains('taginput') && e.key === 'Enter' && e.target.value.trim()) { e.stopPropagation(); opt.tags.push(e.target.value.trim()); redraw(); $('.taginput', bd).focus(); } });
  };
  function conflicts(files, opt) {
    var out = [], rule = null, i = 0;
    function existing(f, name) { return D.assets.filter(function (a) { return a.folder === f.dest && a.name === name; })[0] || out.filter(function (g) { return g.dest === f.dest && g.name === name; })[0]; }
    function apply(f, ex, how) {
      if (how === 'skip') return;
      if (how === 'both') { var dot = f.name.lastIndexOf('.'), k = 1, nm; do { nm = f.name.slice(0, dot) + '_' + k++ + f.name.slice(dot); } while (existing(f, nm)); f.name = nm; out.push(f); }
      else if (out.indexOf(ex) >= 0) out[out.indexOf(ex)] = f; else { f.replaces = ex; out.push(f); }
    }
    function next() {
      if (i >= files.length) return run(out, opt);
      var f = files[i++], ex = existing(f, f.name);
      if (!ex) { out.push(f); return next(); }
      if (rule) { apply(f, ex, rule); return next(); }
      var same = files.slice(i).some(function (g) { return existing(g, g.name); });
      function pick(how) { return function (host) { if ($('.chk', host).getAttribute('aria-checked') === 'true') rule = how; apply(f, ex, how); next(); }; }
      var d = App.dialog({ title: '已经有一个 ' + esc(f.name), body: '<div class="cmp"><figure><div class="bb-cell__thumb' + (ex.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + thumb(ex) + '</div><figcaption><b>现有的</b><span>' + (ex.info || '') + ' · ' + App.fmtSize(ex.bytes) + '</span></figcaption></figure><figure><div class="bb-cell__thumb' + (f.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + (f.art ? DEMO.art(f.art, f) : I(L.KIND_ICON[f.kind])) + '</div><figcaption><b>新的</b><span>' + (f.info || '') + ' · ' + App.fmtSize(f.bytes) + '</span></figcaption></figure></div><p class="up-inh">' + I('folder', 'bb-icon--12') + '<span class="text-mono-sm">' + esc(f.dest || '资产库根目录') + '</span></p>',
        foot: '<span class="chk" role="checkbox" tabindex="0" aria-checked="false"' + (same ? '' : ' hidden') + '><i>' + I('check', 'bb-icon--12') + '</i>对其余同名文件同样处理</span>',
        actions: [{ label: '跳过', act: pick('skip') }, { label: '保留两者', kind: '', act: pick('both') }, { label: '替换为新版本', kind: 'primary', act: pick('replace') }] });
      $('.bb-dialog__foot', d).children[2].className = 'bb-btn bb-btn--lg';
      $('.chk', d).addEventListener('click', function () { this.setAttribute('aria-checked', this.getAttribute('aria-checked') !== 'true'); });
    }
    next();
  }
  function run(files, opt) {
    if (!files.length) return;
    var failOnce = files.filter(function (f) { return f.kind === 'audio'; })[0];
    var items = files.map(function (f) {
      var a;
      if (f.replaces && D.assets.indexOf(f.replaces) >= 0) { a = f.replaces; a._was = { art: a.art, shape: a.shape, c: a.c, info: a.info, w: a.w, h: a.h, bytes: a.bytes, review: a.review }; Object.assign(a, { art: f.art, shape: f.shape, c: f.c, info: f.info, w: f.w, h: f.h, bytes: f.bytes, review: opt.exempt ? 'exempt' : 'pending' }); }
      else { a = D.mk(f.name, f.dest, f.kind, Object.assign({}, f, { stage: opt.stage, tags: opt.tags.slice(), review: opt.exempt ? 'exempt' : 'pending', by: App.me() })); if (!f.dest) a.path = a.name; a._new = true; D.assets.unshift(a); if (opt.source) D.addEdge(a, 'source', opt.source); }
      Object.assign(a, { modified: D.NOW + items0++, state: 'processing', stateText: '上传中', progress: 0, _fail: f === failOnce }); return a;
    });
    if (S.emptyLib) S.loc = { type: 'view', id: 'all' };
    S.sort = { key: 'modified', dir: -1 }; S.sel = []; S.jobs.busy += items.length; D.counts.all += items.length; D.counts.pending += items.length; App.render();
    var panel = add('uppanel', '<header><span>正在上传</span><small>0 / ' + items.length + '</small><button class="bb-btn bb-btn--ghost bb-btn--sm" data-up-all>全部取消</button></header>' + items.map(function (a) { return '<div class="job" data-job="' + a.id + '"><b>' + esc(a.name) + '</b><span>0%</span><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-up-x aria-label="取消 ' + esc(a.name) + '">' + I('x', 'bb-icon--12') + '</button><span class="bb-progress"><i></i></span></div>'; }).join('')), done = 0, timers = {};
    function head() { var left = items.filter(function (a) { return a._up === 'run'; }).length, fails = items.filter(function (a) { return a._up === 'fail'; }).length; $('header small', panel).textContent = done + ' / ' + items.length; $('header span', panel).textContent = left ? '正在上传' : fails ? fails + ' 个没有传完' : '已上传 ' + done + ' 个文件'; $('[data-up-all]', panel).hidden = !left; if (!left && !fails) setTimeout(function () { if (panel.isConnected && !items.some(function (a) { return a._up === 'run' || a._up === 'fail'; })) panel.remove(); }, 2600); }
    function drop(a) { var i = D.assets.indexOf(a); if (a._new && i >= 0) { D.assets.splice(i, 1); D.counts.all--; D.counts.pending--; } else if (a._was) { Object.assign(a, a._was); } a.state = a._new ? a.state : null; S.jobs.busy = Math.max(0, S.jobs.busy - 1); App.render(); App.syncBar(); }
    function start(a, n) {
      var speed = 9 + (n * 7) % 13, row = $('[data-job="' + a.id + '"]', panel); a._up = 'run'; a.progress = 0; row.removeAttribute('data-fail'); row.removeAttribute('data-done');
      row.children[2].outerHTML = '<button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-up-x aria-label="取消 ' + esc(a.name) + '">' + I('x', 'bb-icon--12') + '</button>';
      timers[a.id] = setTimeout(function tick() {
        if (a._up !== 'run') return;
        a.progress = Math.min(100, a.progress + speed);
        var bar = $('[data-id="' + a.id + '"] .bb-progress', el.content); if (bar) bar.style.setProperty('--p', a.progress + '%');
        row.children[1].textContent = a.progress + '%'; row.children[3].style.setProperty('--p', a.progress + '%');
        if (a._fail && a.progress >= 60) { a._fail = false; a._up = 'fail'; row.setAttribute('data-fail', ''); row.children[1].textContent = '连接断开'; row.children[2].outerHTML = '<button class="bb-btn bb-btn--sm" data-up-retry>重试</button>'; a.stateText = '上传失败'; App.refresh(a); return head(); }
        if (a.progress < 100) { timers[a.id] = setTimeout(tick, 140); return; }
        a._up = 'done'; row.setAttribute('data-done', ''); row.children[1].innerHTML = I('check', 'bb-icon--12'); row.children[2].outerHTML = '<i></i>'; done++;
        /* a model gets its picture from the first browser that shows it (ADR-025) */
        if (a.kind === 'model') a.state = 'waiting'; else if (a.kind === 'doc') a.state = 'ready'; else { a.stateText = '生成缩略图'; a.progress = 30; }
        S.jobs.busy = Math.max(0, S.jobs.busy - (a.kind === 'model' || a.kind === 'doc' ? 1 : 0)); App.refresh(a, a.state === 'ready'); App.syncBar();
        if (a.kind !== 'model') setTimeout(function () { if (a.kind !== 'doc') S.jobs.busy = Math.max(0, S.jobs.busy - 1); a.state = 'ready'; App.refresh(a, true); App.syncBar(); if (S.sel.indexOf(a.id) >= 0) App.renderInsp(); }, a.kind === 'doc' ? 0 : 900 + n * 260);
        head();
      }, 200 + n * 180);
    }
    function cancel(a) { clearTimeout(timers[a.id]); a._up = 'cancel'; var row = $('[data-job="' + a.id + '"]', panel); row.setAttribute('data-done', ''); row.children[1].textContent = '已取消'; row.children[2].outerHTML = '<i></i>'; drop(a); head(); }
    panel.addEventListener('click', function (e) {
      var row = e.target.closest('[data-job]'), a = row && items.filter(function (x) { return x.id === row.dataset.job; })[0];
      if (e.target.closest('[data-up-all]')) { items.forEach(function (x) { if (x._up === 'run' || x._up === 'fail') cancel(x); }); return; }
      if (a && e.target.closest('[data-up-x]')) return cancel(a);
      if (a && e.target.closest('[data-up-retry]')) { a.stateText = '上传中'; a.state = 'processing'; App.refresh(a); start(a, items.indexOf(a)); head(); }
    });
    items.forEach(start); head();
  }
  var items0 = 1;
  /* files dragged in from the desktop */
  var dz = null, dzT;
  function hideDz() { if (dz) { dz.remove(); dz = null; } }
  document.addEventListener('dragover', function (e) {
    if (S.dragging || !e.dataTransfer || [].indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return; e.preventDefault(); clearTimeout(dzT); dzT = setTimeout(hideDz, 160);
    if (!dz) dz = add('dropzone', '<div>' + I('upload') + '上传到 ' + (S.loc.type === 'folder' && !S.emptyLib ? S.loc.id : App.libName()) + '</div>');
  });
  document.addEventListener('drop', function (e) { if (S.dragging || !e.dataTransfer || [].indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return; e.preventDefault(); hideDz(); App.upload(); });

  /* ── quick look: grows out of the thumbnail and returns to it ── */
  var ql = null;
  function qlBody(a) {
    var st = $('.ql__stage', ql), art = a.kind === 'doc' ? '<div class="bb-cell__doc"><b>' + esc(a.title) + '</b><p>' + esc(a.excerpt) + '</p></div>' : a.art && !/unknown|waiting|failed|processing/.test(a.state || '') ? DEMO.art(a.art, Object.assign({}, a, { fit: 'meet' })) : '<div class="bb-cell__ph">' + I(L.KIND_ICON[a.kind], 'bb-icon--24') + '</div>';
    st.className = 'ql__stage'; App.mountViewer(st, a, { compact: true });
    $('.ql__bar', ql).innerHTML = '<b>' + esc(a.name) + '</b>' + H.stage(a.stage, 'short') + H.review(a.review, true) + (a.issue ? H.issue(a.issue, true) : '') + '<span class="sp"></span><small>' + [a.info, App.fmtSize(a.bytes)].filter(Boolean).join(' · ') + '</small><button class="bb-btn bb-btn--sm" data-ql-open title="打开 ↵">打开</button><button class="bb-btn bb-btn--ghost bb-btn--icon" data-ql-close aria-label="关闭" title="关闭 空格">' + I('x') + '</button>';
  }
  function fromRect(id, p, from) { var c = from ? from(id) : $('[data-id="' + id + '"] .bb-cell__thumb, tr[data-id="' + id + '"] .bb-row__thumb', el.content); if (!c) return 'scale(0.9)'; var r = local(c.getBoundingClientRect()); return 'translate(' + (r.left - p.x) + 'px,' + (r.top - p.y) + 'px) scale(' + r.width / p.w + ',' + r.height / p.h + ')'; }
  /* opts (from another surface, e.g. the relation graph): list — ids the arrows walk; from(id) — element it grows from; onStep(id) */
  App.quickLook = function (id, opts) {
    var a = App.byId(id); if (!a || ql) return; opts = opts || {};
    var w = Math.min(vw() * 0.64, 900), h = Math.min(vh() * 0.82, 680), p = { x: (vw() - w) / 2, y: (vh() - h) / 2, w: w, h: h };
    ql = add('ql', '<div class="ql__scrim"></div><div class="ql__panel" style="left:' + p.x + 'px;top:' + p.y + 'px;width:' + w + 'px;height:' + h + 'px"><div class="ql__stage"></div><div class="ql__bar"></div></div>'); ql._p = p; ql._o = opts;
    var panel = $('.ql__panel', ql); qlBody(a); panel.style.transition = 'none'; panel.style.transform = fromRect(id, p, opts.from); panel.style.opacity = '0.4';
    void panel.offsetWidth; panel.style.transition = ''; panel.style.transform = 'none'; panel.style.opacity = '1'; ql.setAttribute('data-open', ''); App.qlOpen = id;
    ql.addEventListener('click', function (e) { if (e.target.closest('[data-ql-open]')) return App.openDetail(App.qlOpen); if (e.target.closest('[data-ql-close]') || e.target.classList.contains('ql__scrim')) App.qlClose(); });
  };
  App.qlClose = function (instant) { if (!ql) return; var host = ql, panel = $('.ql__panel', host), qs = $('.ql__stage', host); ql = null; if (qs._viewer) qs._viewer.destroy(); if (instant) { host.remove(); App.qlOpen = null; return; } panel.style.transform = fromRect(App.qlOpen, host._p, host._o.from); panel.style.opacity = '0'; host.removeAttribute('data-open'); App.qlOpen = null; setTimeout(function () { host.remove(); }, 420); };
  App.qlStep = function (d) {
    var o = ql && ql._o;
    if (o && o.list) { var j = o.list.indexOf(App.qlOpen) + d; if (j < 0 || j >= o.list.length) return; App.qlOpen = o.list[j]; qlBody(App.byId(App.qlOpen)); if (o.onStep) o.onStep(App.qlOpen); return; }
    var list = S._list || [], i = list.map(function (a) { return a.id; }).indexOf(App.qlOpen) + d; if (i < 0 || i >= list.length) return; App.qlOpen = list[i].id; App.select(list[i].id, 'one'); qlBody(list[i]); var c = $('[data-id="' + list[i].id + '"]', el.content); if (c) c.scrollIntoView({ block: 'nearest' }); };

  /* ── page states, for review: ready · empty library · loading · offline ── */
  var backup = JSON.stringify(D.assets), counts0 = JSON.stringify(D.counts);
  function reset(empty) { D.assets.length = 0; if (!empty) JSON.parse(backup).forEach(function (a) { D.assets.push(a); }); D.counts = JSON.parse(counts0); S.trash = empty || !App.seedTrash ? [] : App.seedTrash(); if (App.pageOn) App.closePage(); S.emptyLib = !!empty; S.state = 'ready'; S.jobs = { busy: empty ? 0 : 1 }; $$('.uppanel, .bb-toast', el.layer).forEach(function (x) { x.remove(); }); App.go(empty ? { type: 'view', id: 'all' } : { type: 'folder', id: 'props/chest' }); }
  /* walkthrough path 4: someone deletes hero_idle.fbx in the file manager; the next scan notices, the side bar count moves */
  function externalDelete() {
    var h = App.byName('hero_idle.fbx'); if (!h) return;
    if (h.issue === 'missing') { h.issue = null; h.state = null; D.counts.issues = Math.max(0, D.counts.issues - 1); }
    App.go({ type: 'folder', id: 'characters/hero' });
    setTimeout(function () {
      h.issue = 'missing'; h.state = 'missing'; h.foundAt = D.tick(); D.counts.issues++; App.render();
      var row = $('[data-loc="view:issues"]', el.side); if (row) { row.classList.remove('pulse'); void row.offsetWidth; row.classList.add('pulse'); }
      App.toast('扫描发现 hero_idle.fbx 不见了', function () { App.go({ type: 'view', id: 'issues' }); }, '查看');
    }, 1600);
  }
  /* ── libraries (ADR-026): several registered, each browser opens its own; switching here changes nobody else's page ── */
  function switchLib(id) {
    if (id === S.libId) return; var was = S.libId; S.libId = id; reset(id !== 'xingluo');
    App.toast('已切换到 ' + App.libName(), function () { S.libId = was; reset(was !== 'xingluo'); }, '切回');
  }
  App.libraryPanel = function () {
    var pick = S.libId;
    function rows() { return S.libs.map(function (l) { var on = l.id === pick; return '<button class="lbr" role="radio" aria-checked="' + on + '" data-lib="' + l.id + '">' + I('hard-drive') + '<span><b>' + esc(l.name) + '</b><small class="text-mono-sm">' + esc(l.root) + '</small></span>' + (l.id === S.libId ? '<span class="bb-tag">当前</span>' : '') + '</button>'; }).join(''); }
    var d = App.dialog({ title: '切换资产库', form: true, body: '<p class="lbr__hint">只切换这个浏览器</p><div class="lbr__list" role="radiogroup" aria-label="资产库">' + rows() + '</div>',
      foot: '<button class="bb-btn bb-btn--lg bb-btn--ghost lbr__add" data-lib-add>' + I('plus') + '添加资产库…</button><span class="bb-toolbar__grow"></span>',
      actions: [{ label: '取消' }, { label: '打开', kind: 'primary', act: function () { switchLib(pick); } }] });
    var list = $('.lbr__list', d);
    list.addEventListener('click', function (e) { var b = e.target.closest('[data-lib]'); if (!b) return; pick = b.dataset.lib; list.innerHTML = rows(); });
    list.addEventListener('dblclick', function (e) { var b = e.target.closest('[data-lib]'); if (!b) return; d.remove(); App.modal = !!$('.bb-scrim', el.layer); switchLib(b.dataset.lib); });
    $('[data-lib-add]', d).addEventListener('click', function () { d.remove(); App.modal = !!$('.bb-scrim', el.layer); App.addLibrary(); });
  };
  /* adding one: point at a folder (an empty one here); a folder that already holds files goes through the first open below */
  App.addLibrary = function () {
    var d = App.dialog({ title: '添加资产库', form: true,
      body: '<label class="st__lab">文件夹</label><div class="bb-field">' + I('folder') + '<input class="bb-field__input" id="lbp" value="~/Projects/forest-tales/art" aria-label="文件夹" autocomplete="off"></div>' +
        '<label class="st__lab">名称</label><div class="bb-field"><input class="bb-field__input" id="lbn" value="森林故事" aria-label="名称" autocomplete="off"></div>',
      actions: [{ label: '取消' }, { label: '下一步', kind: 'primary', keep: true, act: function (h) {
        var p = $('#lbp', h).value.trim(), n = $('#lbn', h).value.trim() || p.split('/').pop(); if (!p) return $('#lbp', h).focus();
        h.remove(); App.modal = !!$('.bb-scrim', el.layer);
        var id = 'lib' + S.libs.length; S.libs.push({ id: id, name: n, root: p }); switchLib(id);
      } }] });
    setTimeout(function () { var x = $('#lbp', d); x.focus(); x.select(); }, 0);
  };
  /* first open of a folder that already has files: say what will be written beside them, then claim every file with progress.
   * The sample library replays it on itself from the review control, so the claimed result is the library on screen. */
  var NEEDS = [['.skel', 'Spine 骨骼动画', 'community.spine'], ['.psd', 'Photoshop 文件', 'community.psd']];
  App.firstOpen = function () {
    var lib = { name: App.libName(), root: App.lib().root, files: (D.counts && D.counts.all) || D.assets.length, dirs: 31 };
    var files = lib.files, list = '<ul class="fo__needs">' + NEEDS.map(function (n) { return '<li><span class="text-mono-sm">' + n[0] + '</span><span>' + n[1] + '</span><span class="text-mono-sm fo__pkg">' + n[2] + '</span></li>'; }).join('') + '</ul>';
    App.dialog({ wide: true, title: '打开 ' + esc(lib.root), body:
      '<p class="fo__count"><b>' + files.toLocaleString('en-US') + '</b> 个文件 · ' + lib.dirs + ' 个文件夹</p>' +
      '<div class="fo__ex">' + I('file', 'bb-icon--12') + '<span class="text-mono-sm">chest.glb</span>' + I('file-plus', 'bb-icon--12') + '<span class="text-mono-sm">chest.glb.bmeta</span></div>' +
      '<p class="fo__p">每个文件旁边会多一个同名的 .bmeta，记下编号、标签和关系。原文件不改动。</p>' +
      '<h3 class="st__h3">还没有插件能读的格式</h3>' + list + '<p class="fo__p fo__sub">这些文件照样登记，装好插件后再生成预览。</p>',
      actions: [{ label: '取消' }, { label: '开始', kind: 'primary', act: function () { claim(lib); } }] });
  };
  function claim(lib) {
    var total = lib.files, n = 0, panel = add('uppanel', '<header><span>正在登记 ' + esc(lib.name) + '</span><small>0 / ' + total.toLocaleString('en-US') + '</small></header><div class="job"><b class="text-mono-sm">—</b><span>0%</span><span class="bb-progress"><i></i></span></div><button class="bb-btn bb-btn--sm bb-btn--ghost fo__stop" data-fo-stop>停止</button>'), stop = false;
    var names = D.assets.map(function (a) { return a.path; }), row = $('.job', panel);
    $('[data-fo-stop]', panel).addEventListener('click', function () { stop = true; });
    S.state = 'loading'; App.render();
    (function tick() {
      if (stop) { panel.remove(); S.state = 'ready'; App.render(); return App.toast('已停止，登记了 ' + n.toLocaleString('en-US') + ' 个文件；下次打开会接着登记'); }
      n = Math.min(total, n + Math.ceil(total / 40)); var p = Math.round(n / total * 100);
      $('header small', panel).textContent = n.toLocaleString('en-US') + ' / ' + total.toLocaleString('en-US');
      row.children[0].textContent = names[n % names.length] + '.bmeta'; row.children[1].textContent = p + '%'; row.children[2].style.setProperty('--p', p + '%');
      if (n < total) return setTimeout(tick, 90);
      panel.remove();
      S.state = 'ready'; App.render(true);
      App.toast('已登记 ' + total.toLocaleString('en-US') + ' 个文件 · ' + NEEDS.length + ' 种格式需要插件', function () { App.openSettings('library'); }, '查看');
    })();
  }

  /* F-03: what others and Agents change arrives through the event stream. New assets wait behind a pill instead of jumping into the grid;
   * an asset someone replaces while you look at it says so, and keeps showing what you were looking at until you ask for the new one. */
  S.incoming = [];
  function liveNew() {
    var f = S.loc.type === 'folder' ? S.loc.id : 'props/chest', made = [['lantern_side.png', 'potion'], ['lantern_glow.png', 'env'], ['lantern_icon.png', 'ui']].map(function (x, i) {
      var a = D.mk(x[0], f, 'image', { art: x[1], hue: 40 + i * 20, shape: 'coin', c: ['#ffe08a', '#f0a81c'], alpha: x[1] === 'ui', stage: 'production', review: 'pending', info: '1024×1024', w: 1024, h: 1024, tags: ['提灯'], by: 'agent:concept-artist', bytes: 1.1e6 });
      a.modified = D.tick(); return a;
    });
    S.incoming = S.incoming.concat(made); App.renderContent();
  }
  App.showIncoming = function () { var n = S.incoming; S.incoming = []; n.forEach(function (a) { D.assets.unshift(a); }); D.counts.all += n.length; D.counts.pending += n.length; App.render(true); };
  function liveReplace() {
    var a = App.byName('chest.glb'); if (!a) return;
    if (App.detailOpen !== a.id) App.openDetail(a.id, 'view');
    setTimeout(function () {
      var v = D.addVersion(a, 'user:lin', '收窄包边'); a._newer = v.v; if (a.review !== 'exempt') a.review = 'pending'; App.render();
      var top = $('#detail .dstale'); if (top) top.insertAdjacentHTML('afterbegin', H.banner('info', 'refresh-cw', 'user:lin 刚把它替换成了 v' + v.v, '你看到的还是替换之前的内容。', '<button class="bb-btn bb-btn--sm bb-btn--primary" data-live="show">显示新版本</button>'));
    }, 900);
  }
  document.addEventListener('click', function (e) { if (e.target.closest('[data-live="show"]')) { var a = App.byId(App.detailOpen); if (a) a._newer = null; App.detailRefresh(); } if (e.target.closest('[data-incoming]')) App.showIncoming(); });
  App.demoLive = [{ header: '别人的改动' }, { label: 'Agent 登记了 3 个新资产', act: liveNew }, { label: '正在看的模型被别人替换', act: liveReplace }];
  var sb = add('statebtn', '<button class="bb-btn bb-btn--ghost bb-btn--icon" aria-label="页面状态" title="页面状态">' + I('layers') + '</button>');
  sb.addEventListener('click', function () {
    var cur = S.state !== 'ready' ? S.state : S.emptyLib ? 'empty' : 'ready';
    App.menu([{ label: '正常', check: cur === 'ready', act: function () { S.libId = 'xingluo'; reset(false); } }, { label: '空资产库', check: cur === 'empty', act: function () { reset(true); } }, { label: '加载中', check: cur === 'loading', act: function () { S.state = 'loading'; App.render(); } }, { label: '连接失败', check: cur === 'offline', act: function () { S.state = 'offline'; App.render(); } },
      'sep', { header: '演示路径' },
      { label: '1 · Agent 登记的原画由人校验', act: function () { App.go({ type: 'view', id: 'pending' }); var x = App.byName('lantern_concept.png'); if (x) { S.sel = [x.id]; S.focus = x.id; App.render(); } } },
      { label: '2 · 从模型追溯到原画并对比', act: function () { App.go({ type: 'view', id: 'all' }); } },
      { label: '3 · 复制贴图，在关系图里换成副本', act: function () { App.go({ type: 'folder', id: 'props/chest' }); var x = App.byName('chest_basecolor.png'); if (x) { S.sel = [x.id]; S.focus = x.id; App.render(); } } },
      { label: '4 · 外部删除文件后恢复', act: externalDelete },
      { label: '首次打开已有文件的文件夹', act: function () { S.libId = 'xingluo'; reset(false); App.firstOpen(); } },
      'sep'].concat(App.demoLive, [

      'sep', { header: '版本插件' },
      { label: '已安装 Lore', check: !!S.verPlugin, act: function () { S.verPlugin = 'lore'; S.verSince = 0; App.render(); if (App.detailRefresh) App.detailRefresh(); } },
      { label: '未安装', check: !S.verPlugin, act: function () { S.verPlugin = null; App.render(); if (App.detailRefresh) App.detailRefresh(); } },
      'sep', { header: '打开网页的电脑' },
      { label: '本机', check: !S.remote, act: function () { S.remote = false; App.render(); if (App.detailRefresh) App.detailRefresh(); } },
      { label: '其他电脑', check: !!S.remote, act: function () { S.remote = true; App.render(); if (App.detailRefresh) App.detailRefresh(); } }].concat(App.demoExtra ? App.demoExtra() : [])), sb);
  });

  App.boot();
})();
