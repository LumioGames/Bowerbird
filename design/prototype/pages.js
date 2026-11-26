/* Bowerbird prototype — whole pages that take over the browse area:
 * 校验队列 · 完整性 · 回收站 · 设置（资产库、本机、插件、标签、任务，以及每个插件自己的设置）.
 * Wording rule: every notice says what happened and what happens next, in words an artist who doesn't know the internals understands. */
(function () {
  'use strict';
  var App = window.App, B = Bowerbird, I = B.icon, H = B.html, D = App.D, S = App.S, el = App.el, $ = App.$, $$ = App.$$, DEMO = B.demo, L = H.labels;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function seg(label, items, cur, attr) { return '<div class="bb-seg" role="radiogroup" aria-label="' + label + '"' + (attr || '') + '><i class="bb-seg__thumb"></i>' + items.map(function (it) { return '<button class="bb-seg__item" role="radio" aria-checked="' + (it[0] === cur) + '" data-value="' + it[0] + '">' + it[1] + '</button>'; }).join('') + '</div>'; }
  function sw(on, attr, label) { return '<button class="bb-switch" role="switch" ' + attr + ' aria-checked="' + !!on + '" aria-label="' + label + '"></button>'; }
  function thumb(a) { return '<span class="pt' + (a.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + (a.kind === 'doc' ? I('file-text') : a.art ? DEMO.art(a.art, Object.assign({}, a, { fit: 'slice' })) : I(L.KIND_ICON[a.kind] || 'file')) + '</span>'; }
  var DAY = 86400000, NOW = D.NOW;
  function ago(t) { return App.fmtTime(t); }

  /* ── the page frame ── */
  var pg = document.createElement('section'); pg.id = 'page'; pg.hidden = true; pg.setAttribute('aria-label', '页面'); el.app.appendChild(pg);
  var cur = null, PAGES = {};
  App.openPage = function (id, opt) {
    if (App.detailOpen) App.closeDetail(true);
    if (App.qlOpen) App.qlClose(true);
    if (cur && cur.ctl.destroy) cur.ctl.destroy();
    var fresh = !App.pageOn; App.pageOn = id; pg.hidden = false; pg.className = 'pg pg--' + id + (fresh ? ' enter' : '');
    setTimeout(function () { pg.classList.remove('enter'); }, 500);
    cur = { id: id, ctl: (S.state === 'loading' || S.state === 'offline') && App.statePage ? App.statePage(pg, id, S.state) : PAGES[id](pg, opt || {}) || {} };
  };
  App.closePage = function () {
    if (!App.pageOn) return; if (cur && cur.ctl.destroy) cur.ctl.destroy(); cur = null; App.pageOn = null;
    pg.classList.add('leaving'); setTimeout(function () { if (App.pageOn) return; pg.hidden = true; pg.innerHTML = ''; pg.className = ''; }, 180);
  };
  App.pageKey = function (e) { return cur && cur.ctl.key ? cur.ctl.key(e) : false; };
  /* Esc: a page may use it first (cancel a comment), otherwise it closes the page */
  App.pageEsc = function () { if (cur && cur.ctl.esc && cur.ctl.esc()) return true; App.closePage(); if (S.loc.type === 'view' && (S.loc.id === 'issues' || S.loc.id === 'trash')) App.go({ type: 'view', id: 'all' }); return true; };
  /* the side bar's 有问题 and 回收站 are pages; going anywhere else leaves them */
  App.routePage = function (loc) {
    if (loc.type === 'view' && loc.id === 'issues') return App.openPage('integrity');
    if (loc.type === 'view' && loc.id === 'trash') return App.openPage('trash');
    if (App.pageOn) App.closePage();
  };
  function bar(title, extra, sub) { return '<div class="pbar"><button class="bb-btn bb-btn--ghost bb-btn--icon" data-pg="back" aria-label="返回" title="返回 Esc">' + I('chevron-left') + '</button><b class="pbar__t">' + title + '</b>' + (sub ? '<span class="pbar__s">' + sub + '</span>' : '') + '<span class="bb-toolbar__grow"></span>' + (extra || '') + '</div>'; }
  pg.addEventListener('click', function (e) { if (e.target.closest('[data-pg="back"]')) App.pageEsc(); });
  function empty(icon, title, text, actions) { return '<div class="bb-empty pg-empty"><div class="bb-empty__icon">' + I(icon, 'bb-icon--24') + '</div><h3 class="bb-empty__title">' + title + '</h3>' + (text ? '<p class="bb-empty__text">' + text + '</p>' : '') + (actions ? '<div class="bb-empty__actions">' + actions + '</div>' : '') + '</div>'; }

  /* ───────── 校验队列 ───────── */
  var VERB = { source: '来源', uses: '引用', belongs: '归属' };
  /* why an asset can't be reviewed right now — told, not silently dropped */
  function heldWhy(a) {
    if (a.state === 'missing') return '文件缺失'; if (a.state === 'waiting' || a.state === 'processing') return '还在处理';
    if (a.state === 'failed' || a.viewerError) return '无法显示'; if (a.needs) return '缺少插件';
    if (a.issue === 'identity' || a.issue === 'conflict' || a.issue === 'broken') return '有错误级问题'; return '';
  }
  function upstream(a) {
    var out = [], seen = {}, q = [a], n = 0;
    while (q.length && n < 4) { var x = q.shift(); D.rel(x).up.forEach(function (u) { if (u.a && !seen[u.a.id]) { seen[u.a.id] = 1; out.push({ a: u.a, e: u.e }); q.push(u.a); n++; } }); }
    D.rel(a).belongs.forEach(function (b) { if (b.a && !seen[b.a.id]) out.push({ a: b.a, e: b.e }); });
    return out;
  }
  PAGES.review = function (root, opt) {
    var scope = opt.scope || 'all', i = 0, tally = { approved: [], rejected: [], skipped: [] }, rejecting = false, hostV = null, last = null, Q = [], held = [];
    function inScope(a) { return scope === 'all' || (scope.indexOf('folder:') === 0 ? (a.folder === scope.slice(7) || a.folder.indexOf(scope.slice(7) + '/') === 0) : a.kind === scope.slice(5)); }
    function load(list) {
      var all = D.assets.filter(function (a) { return a.review === 'pending' && inScope(a); });
      Q = list || all.filter(function (a) { return !heldWhy(a); }); held = all.filter(function (a) { return heldWhy(a); }); i = 0;
      /* started with something selected: that one comes first, the rest keep their order */
      var s = !list && opt.start && Q.filter(function (a) { return a.id === opt.start; })[0]; if (s) { Q.splice(Q.indexOf(s), 1); Q.unshift(s); } opt.start = null;
    }
    function scopeLabel() { return scope === 'all' ? '全部待审' : scope.indexOf('folder:') === 0 ? scope.slice(7) : { model: '模型', image: '图片' }[scope.slice(5)] || scope; }
    function draw() {
      if (hostV && hostV._viewer) hostV._viewer.destroy(); hostV = null;
      var a = Q[i], left = Q.length - i;
      var prog = '<div class="rq__prog" title="还剩 ' + left + ' 个"><i style="width:' + (Q.length ? i / Q.length * 100 : 100) + '%"></i></div><span class="vw__num">' + (a ? (i + 1) + ' / ' + Q.length : Q.length + ' / ' + Q.length) + '</span>';
      root.innerHTML = bar('校验队列', prog, '<button class="bb-select" data-rq="scope">' + I('list-filter', 'bb-icon--12') + esc(scopeLabel()) + I('chevron-down', 'bb-icon--12') + '</button>') + '<div class="pbody rq">' + (a ? item(a) : finish()) + '</div>';
      if (a) { hostV = $('.rq__view', root); App.mountViewer(hostV, a, { compact: false }); }
    }
    function item(a) {
      var rec = D.recordFor(a), ups = upstream(a), near = App.nearestUpstream && App.nearestUpstream(a), cks = App.checks ? App.checks(a) : [];
      var bad = cks.filter(function (c) { return !c[0]; });
      return '<div class="rq__main"><div class="rq__head"><b>' + esc(a.name) + '</b>' + H.stage(a.stage, 'short') + '<span class="rq__path">' + esc(a.folder) + '</span><span class="bb-toolbar__grow"></span>' + (heldNote()) + '</div>' +
        '<div class="rq__view"></div>' +
        /* the one built-in check (model size against the design object) is shown, never decides (ADR-020) */
        (cks.length ? '<div class="rq__checks">' + cks.map(function (c) { return '<span class="rq__ck' + (c[0] ? '' : ' bad') + '" title="' + esc(c[2]) + '">' + I(c[0] ? 'check' : 'x', 'bb-icon--12') + c[1] + '<small>' + esc(c[2]) + '</small></span>'; }).join('') + '</div>' : '') +
        '<div class="rq__act">' + (rejecting ? '<div class="bb-field bb-field--area rq__note"><textarea class="bb-field__input" id="rqnote" rows="2" placeholder="哪里需要改（必填）" aria-label="打回意见"></textarea></div><button class="bb-btn" data-rq="cancel">取消 ' + H.kbd('Esc') + '</button><button class="bb-btn bb-btn--danger" data-rq="send">' + I('undo-2') + '打回 ' + H.kbd('↵') + '</button>'
          : (last ? '<span class="rq__last">' + I(last.k === 'approved' ? 'check' : last.k === 'rejected' ? 'undo-2' : 'skip-forward', 'bb-icon--12') + esc(last.a.name) + ' ' + { approved: '已通过', rejected: '已打回', skipped: '已跳过' }[last.k] + '<button class="bb-btn bb-btn--ghost bb-btn--sm" data-rq="undo">撤销 ' + H.kbd('⌘Z') + '</button></span>' : '') + '<span class="bb-toolbar__grow"></span>' +
            '<button class="bb-btn" data-rq="reject">' + I('undo-2') + '打回…</button><button class="bb-btn" data-rq="skip">' + I('skip-forward') + '跳过 ' + H.kbd('→') + '</button><button class="bb-btn bb-btn--primary" data-rq="ok">' + I('check') + '通过 ' + H.kbd('⌘↵') + '</button>') + '</div></div>' +
        '<aside class="rq__side">' +
          (rec ? '<section><h5>' + I(rec.method === 'AI 生成' ? 'sparkles' : 'activity', 'bb-icon--12') + '生产记录</h5>' + H.kv([['方式', esc(rec.method)], ['执行者', '<span class="text-mono-sm">' + esc(rec.by) + '</span>']]) + (rec.prompt ? '<pre class="prompt">' + esc(rec.prompt) + '</pre>' : '') + '</section>' : '') +
          (a.aiTags && a.aiTags.length ? '<section><h5>' + I('sparkles', 'bb-icon--12') + 'AI 标签 <span class="rq__n">' + a.aiTags.length + '</span><span class="bb-toolbar__grow"></span><button class="bb-btn bb-btn--ghost bb-btn--sm" data-rq="adopt-all">全部采纳</button></h5><div class="rq__tags">' + a.aiTags.map(function (t) { return '<span class="bb-tag bb-tag--ai">' + esc(t) + '<button data-rq-adopt="' + esc(t) + '" aria-label="采纳 ' + esc(t) + '" title="采纳">' + I('check', 'bb-icon--12') + '</button><button data-rq-drop="' + esc(t) + '" aria-label="去掉 ' + esc(t) + '" title="去掉">' + I('x', 'bb-icon--12') + '</button></span>'; }).join('') + '</div>' + (a.tags.length ? '<div class="rq__tags rq__tags--own">' + a.tags.map(function (t) { return '<span class="bb-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') + '</section>' : '') +
          '<section><h5>' + I('git-fork', 'bb-icon--12') + '上游<span class="bb-toolbar__grow"></span>' + (near ? '<button class="bb-btn bb-btn--sm" data-rq="cmp" data-up="' + near.id + '" title="和 ' + esc(near.name) + ' 对比">' + I('git-compare-arrows', 'bb-icon--12') + '与上游对比</button>' : '') + '</h5>' +
            (ups.length ? '<div class="rq__ups">' + ups.map(function (u) { return '<button class="rq__up" data-rq="peek" data-id="' + u.a.id + '" title="快速预览">' + thumb(u.a) + '<span><b>' + esc(u.a.name) + '</b><small>' + (u.e.type === 'belongs' ? '设计对象' : esc(D.noteOf(u.e))) + '</small></span></button>'; }).join('') + '</div>' : '<p class="rq__none">没有上游</p>') + '</section>' +
        '</aside>';
    }
    function heldNote() { return held.length ? '<button class="rq__held" data-rq="held">' + I('clock', 'bb-icon--12') + '另有 ' + held.length + ' 个暂时审不了</button>' : ''; }
    function finish() {
      var sk = tally.skipped.length;
      return '<div class="rq__end">' + empty('badge-check', Q.length ? '这一轮审完了' : '没有待审的资产', Q.length ? '通过 ' + tally.approved.length + ' · 打回 ' + tally.rejected.length + ' · 跳过 ' + sk : '新登记的资产会出现在这里。', (sk ? '<button class="bb-btn" data-rq="again">' + I('skip-forward') + '再审跳过的 ' + sk + ' 个</button>' : '') + '<button class="bb-btn bb-btn--primary" data-rq="home">回到浏览</button>') + (held.length ? '<div class="rq__heldlist"><h5>暂时审不了</h5>' + held.map(function (h) { return '<div class="rq__hrow">' + thumb(h) + '<b>' + esc(h.name) + '</b><span>' + heldWhy(h) + '</span></div>'; }).join('') + '</div>' : '') + '</div>';
    }
    /* a decision keeps only the latest verdict — who, when, the comment (ADR-024); ⌘Z undoes it, this session only */
    function decide(k, note) {
      var a = Q[i]; if (!a) return; var prev = App.verdictOf(a), rec = { k: k, a: a, at: i };
      if (k !== 'skipped') App.setVerdict(a, k, note);
      tally[k].push(a); last = rec; rejecting = false; i++;
      if (k !== 'skipped') { D.counts.pending = Math.max(0, D.counts.pending - 1); App.render(); }
      rec.u = App.pushUndo(function () { App.restoreVerdict(a, prev); var t = tally[k].indexOf(a); if (t >= 0) tally[k].splice(t, 1); if (k !== 'skipped') { D.counts.pending++; App.render(); } if (App.pageOn === 'review' && cur && cur.ctl.back) cur.ctl.back(rec); });
      swapIn();
    }
    function back(rec) { if (last === rec) last = null; i = rec.at; swapIn(-1); }
    function undo() { if (last && last.u) App.runUndo(last.u); }
    function swapIn(dir) { var m = $('.rq__main', root); if (m) { m.style.transition = 'none'; } draw(); var n = $('.rq__view', root); if (n && !B.reducedMotion()) { n.animate([{ opacity: 0, transform: 'translateX(' + (dir < 0 ? -24 : 24) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }); } }
    function startReject() { rejecting = true; draw(); var t = $('#rqnote', root); if (t) t.focus(); }
    function send() { var t = $('#rqnote', root), v = t && t.value.trim(); if (!v) { t.parentNode.setAttribute('data-invalid', ''); t.focus(); return; } decide('rejected', v); }
    function adopt(t) { var a = Q[i]; a.aiTags.splice(a.aiTags.indexOf(t), 1); if (a.tags.indexOf(t) < 0) a.tags.push(t); var y = $('.rq__side', root).scrollTop; draw(); $('.rq__side', root).scrollTop = y; }
    function drop(t) { var a = Q[i]; a.aiTags.splice(a.aiTags.indexOf(t), 1); draw(); }
    root.onclick = function (e) {
      var ad = e.target.closest('[data-rq-adopt]'); if (ad) return adopt(ad.dataset.rqAdopt);
      var dr = e.target.closest('[data-rq-drop]'); if (dr) return drop(dr.dataset.rqDrop);
      var b = e.target.closest('[data-rq]'); if (!b) return; var k = b.dataset.rq;
      if (k === 'ok') decide('approved'); if (k === 'skip') decide('skipped'); if (k === 'reject') startReject(); if (k === 'cancel') { rejecting = false; draw(); } if (k === 'send') send(); if (k === 'undo') undo();
      if (k === 'adopt-all') { Q[i].aiTags.slice().forEach(adopt); }
      if (k === 'cmp') App.compare(Q[i], App.byId(b.dataset.up));
      if (k === 'peek') App.quickLook(b.dataset.id, { from: function () { return b.querySelector('.pt'); } });
      if (k === 'again') { load(tally.skipped.slice()); tally.skipped = []; last = null; draw(); }
      if (k === 'home') { App.closePage(); App.go({ type: 'view', id: 'pending' }); }
      if (k === 'held') App.menu([{ header: '暂时审不了' }].concat(held.map(function (h) { return { icon: L.KIND_ICON[h.kind] || 'file', label: h.name, kbd: heldWhy(h), act: function () { App.closePage(); App.openDetail(h.id); } }; })), b);
      if (k === 'scope') {
        var opts = [['all', '全部待审']].concat(S.loc.type === 'folder' ? [['folder:' + S.loc.id, '当前文件夹 ' + S.loc.id]] : [['folder:props/chest', 'props/chest'], ['folder:ui/shop', 'ui/shop']], [['kind:model', '只审模型'], ['kind:image', '只审图片']]);
        App.menu(opts.map(function (o) { return { label: o[1], check: scope === o[0], act: function () { scope = o[0]; tally = { approved: [], rejected: [], skipped: [] }; last = null; load(); draw(); } }; }), b);
      }
    };
    root.oninput = function (e) { if (e.target.id === 'rqnote') e.target.parentNode.removeAttribute('data-invalid'); };
    /* the comment box is a text field, so the shell's shortcuts skip it: ↵ sends from here */
    root.onkeydown = function (e) { if (e.target.id === 'rqnote' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
    load(); draw();
    return {
      destroy: function () { if (hostV && hostV._viewer) hostV._viewer.destroy(); root.onclick = root.oninput = root.onkeydown = null; },
      esc: function () { if (rejecting) { rejecting = false; draw(); return true; } return false; },
      back: back,
      /* keys: ⌘↵ / Ctrl+Enter 通过, → 跳过; 打回 and 与上游对比 by mouse (single-letter keys were dropped) */
      key: function (e) {
        if (!Q[i]) return false;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); decide('approved'); return true; }
        if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); decide('skipped'); return true; }
        if (hostV && hostV._viewer && hostV._viewer.key && hostV._viewer.key(e)) { e.preventDefault(); return true; }
        return false;
      }
    };
  };
  /* entry: 待审 shows a button in the tool bar; the side bar's 待审 row gets one too */
  App.startReview = function () { App.openPage('review', { scope: S.loc.type === 'folder' ? 'folder:' + S.loc.id : 'all', start: S.focus || S.sel[0] }); };

  /* ───────── 完整性 ───────── */
  var LEVEL = { error: ['错误', 'danger'], warning: ['警告', 'warning'], info: ['提示', 'info'] };
  var TYPE = {
    broken: ['指向的文件找不到了', 'unlink', 'error'], missing: ['文件缺失', 'file-question', 'error'], identity: ['被当成同一个资产', 'copy', 'error'], conflict: ['两份记录不一致', 'git-compare-arrows', 'error'],
    stale: ['上游已更新', 'circle-arrow-up', 'warning'], orphan: ['文件缺失', 'file-question', 'warning'], failed: ['处理失败', 'triangle-alert', 'warning'], plugin: ['缺少插件', 'puzzle', 'warning'],
    thumb: ['手动缩略图过时', 'image', 'info'], dup: ['内容重复', 'copy', 'info']
  };
  /* issues not tied to a live asset, as the scanner would report them */
  var EXTRA = [
    { id: 'x-orphan', type: 'orphan', name: 'axe_old.png.bmeta', path: 'props/weapon/axe_old.png.bmeta', detail: '只有元数据文件，找不到 axe_old.png 本身', at: NOW - 2 * DAY },
    { id: 'x-thumb', type: 'thumb', asset: 'chest_open_preview.mp4', detail: '手动设的缩略图停在 11 月 21 日，视频内容 11 月 22 日更新过', at: NOW - 3 * DAY },
    { id: 'x-dup', type: 'dup', asset: 'panel_bg.png', detail: '和 ui/hud/panel_bg.png 的内容完全相同', at: NOW - 5 * DAY },
    { id: 'x-conflict', type: 'conflict', asset: 'shop_prototype.html', detail: '云盘同步留下了冲突副本：shop_prototype.html (lin 的 MacBook 冲突).bmeta，两份的标签不一样', at: NOW - 1 * DAY }
  ];
  var done = {};
  /* E-09: the side bar and the page count the same thing — assets (and stray files) with a problem */
  App.issueAssets = function () { var ids = {}; issues().forEach(function (x) { ids[x.a ? x.a.id : x.id] = 1; }); return Object.keys(ids).length; };
  function issues() {
    if (S.emptyLib) return [];
    var out = [];
    D.assets.forEach(function (a) {
      if (!a.issue || done[a.id + a.issue]) return; var t = a.issue, d = '';
      if (t === 'broken') { var e = D.EDGES.filter(function (x) { return x.from === a.id && !x.to; })[0]; d = (e ? VERB[e.type] + ' ' + e.toName + '，但它已不在资产库' + (S.trash.some(function (x) { return x.name === e.toName; }) ? '（在回收站里）' : '') : '有一条关系指向不存在的资产'); }
      if (t === 'missing') d = '文件 ' + a.path + ' 不见了；它的标签、关系和历史都还在';
      if (t === 'identity') d = '和 btn_buy.png 被当成了同一个资产，系统已把这一个改成独立的新资产，等你确认';
      if (t === 'stale') d = '上游 chest.glb 从 v1 更新到了 v2，这张图还是按 v1 做的';
      if (t === 'failed') d = '生成缩略图失败：不支持的编码 ProRes 4444';
      if (t === 'plugin') d = '需要 Spine 插件（community.spine 1.4），本机没有安装';
      out.push({ id: a.id + t, type: t, a: a, detail: d, at: a.foundAt || a.modified });
    });
    EXTRA.forEach(function (x) { if (done[x.id]) return; var a = x.asset ? App.byName(x.asset) : null; if (x.asset && !a) return; out.push(Object.assign({}, x, { a: a })); });
    return out;
  }
  function resolve(it, msg, undo) {
    done[it.id] = 1; if (it.a && it.a.issue === it.type) { it.a.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); }
    App.render(); if (App.pageOn === 'integrity') cur.ctl.redraw();
    App.toast(msg, undo ? function () { delete done[it.id]; if (it.a) { it.a.issue = it.type; D.counts.issues++; } undo(); App.render(); if (App.pageOn === 'integrity') cur.ctl.redraw(); } : null);
  }
  function actionsFor(it) {
    var a = it.a;
    switch (it.type) {
      case 'broken': var e = D.EDGES.filter(function (x) { return x.from === a.id && !x.to; })[0], inTrash = e && S.trash.filter(function (x) { return x.name === e.toName; })[0];
        return [['relink', '重新指定…'], ['unlink', '删除这条关系'], ['restore', '从回收站恢复 ' + (e ? e.toName : ''), !inTrash, true]];
      case 'missing': return [['relocate', '重新定位文件…', false, true], ['forget', '确认删除']];
      case 'identity': return [['swap', '其实这个才是原件…'], ['confirm', '确认', false, true]];
      case 'conflict': return [['pick', '选择保留哪一份…', false, true]];
      case 'stale': return [['cmp', '对比变化'], ['replace', '替换内容…'], ['reviewed', '确认已复核', false, true]];
      case 'orphan': return [['relocate', '重新定位文件…'], ['trash', '移入回收站']];
      case 'failed': return [['log', '查看错误'], ['retry', '重试', false, true]];
      case 'plugin': return [['install', '去安装', false, true]];
      case 'thumb': return [['clearthumb', '清除手动缩略图'], ['reshot', '重新截图', false, true]];
      case 'dup': return [['ignore', '忽略'], ['markcopy', '标为副本', false, true]];
    }
    return [];
  }
  /* 重新定位文件: a moved file with the same content is reconnected by the scanner on its own; this only comes up when
   * nothing matches exactly, so Bowerbird lists its best guesses (same or similar name) and the person picks */
  function relocate(it) {
    var a = it.a, cands = a ? [[a.folder + '/_old/' + a.name, '同名 · 内容改过，可能是重新导出的', true], ['characters/hero/export/hero_idle_v2.fbx', '名字相近 · 2 天前出现']] : [['props/weapon/_archive/axe_old.png', '同名 · 内容改过', true]];
    var pick = 0;
    var d = App.dialog({ title: '重新定位 ' + esc(a ? a.name : it.name), text: '没有找到内容完全一样的文件，下面是最像的几个。用选中的文件作为 ' + esc(a ? a.name : it.name) + '：标签、关系和历史都不变，内容的变化记为一个新版本。',
      body: '<div class="rl" role="radiogroup">' + cands.map(function (c, k) { return '<button class="vpl__o rl__o" role="radio" data-k="' + k + '" aria-checked="' + (k === 0) + '">' + I(c[2] ? 'badge-check' : 'file') + '<span><b class="text-mono-sm">' + esc(c[0]) + '</b><small>' + c[1] + '</small></span><i class="vpl__r"></i></button>'; }).join('') + '<button class="rl__pick">' + I('folder-search') + '从磁盘选择其他文件…</button></div>' +
        /* E-20: say where the asset will be afterwards, and offer to put the file back where it was */
        (a ? '<label class="up-keep rl__back"><button class="bb-switch" data-own="1" data-rl-back role="switch" aria-checked="true" aria-label="把文件移回原来的位置"></button>把文件移回原来的位置 <span class="text-mono-sm">' + esc(a.path) + '</span></label>' : ''),
      actions: [{ label: '取消' }, { label: '接上这个文件', kind: 'primary', act: function () {
        if (a) { var prev = { state: a.state, path: a.path, folder: a.folder }, back = $('[data-rl-back]', d).getAttribute('aria-checked') === 'true'; a.state = null; if (!back) { a.path = cands[pick][0]; a.folder = a.path.slice(0, a.path.lastIndexOf('/')); } resolve(it, back ? cands[pick][0] + ' 已移回 ' + a.path + '，问题已消失' : a.name + ' 已接上 ' + cands[pick][0] + '，现在在 ' + a.folder, function () { Object.assign(a, prev); }); }
        else resolve(it, it.name + ' 已接上 ' + cands[pick][0]);
      } }] });
    d.addEventListener('click', function (e) { var o = e.target.closest('.rl__o'); if (o) { pick = +o.dataset.k; $$('.rl__o', d).forEach(function (x) { x.setAttribute('aria-checked', x === o); }); } if (e.target.closest('.rl__pick')) App.toast('会打开系统的文件选择窗口'); var rb = e.target.closest('[data-rl-back]'); if (rb) rb.setAttribute('aria-checked', rb.getAttribute('aria-checked') !== 'true'); });
  }
  function act(it, k) {
    var a = it.a;
    if (k === 'relink') { App.pendingEdge = D.EDGES.filter(function (x) { return x.from === a.id && !x.to; })[0]; App.closePage(); return App.openDetail(a.id, 'rel'); }  /* the swap lives in the relation graph only (ADR-018) */
    if (k === 'unlink') { var e2 = D.EDGES.filter(function (x) { return x.from === a.id && !x.to; })[0]; return App.dialog({ title: '删除这条关系？', text: a.name + ' 将不再' + VERB[e2.type] + ' ' + e2.toName + '。删除后可以在 5 秒内撤销。', actions: [{ label: '取消' }, { label: '删除关系', kind: 'danger', act: function () { var i2 = D.removeEdge(e2); resolve(it, '已删除这条关系', function () { D.EDGES.splice(i2, 0, e2); }); } }] }); }
    if (k === 'restore') { var e3 = D.EDGES.filter(function (x) { return x.from === a.id && !x.to; })[0], t = S.trash.filter(function (x) { return x.name === e3.toName; })[0]; return restore(t, function () { e3.to = t.id; resolve(it, t.name + ' 已恢复到 ' + t.folder + '，' + a.name + ' 的引用重新接上了'); }); }
    if (k === 'relocate') return relocate(it);
    if (k === 'forget') return App.dialog({ title: '确认 ' + esc(a.name) + ' 已经删除？', text: '文件已经不在了，只把它的记录移入回收站；指向它的关系会显示找不到文件。回收站保留 7 天，期间可以恢复。', actions: [{ label: '取消' }, { label: '移入回收站', kind: 'danger', act: function () { D.assets.splice(D.assets.indexOf(a), 1); a.trashedAt = NOW; a.trashedBy = App.me(); S.trash.unshift(a); resolve(it, a.name + ' 已移入回收站'); } }] });
    if (k === 'confirm') return resolve(it, '已确认：btn_buy.png 是原件，' + a.name + ' 是独立的新资产');
    if (k === 'swap') return App.dialog({ title: '哪一个是原件？', text: '系统判定 btn_buy.png 是原件：它创建得更早，而且有 3 个资产引用它。btn_buy (1).png 已换成新身份，没有资产引用它。', body: '<div class="idc"><div>' + thumb(App.byName('btn_buy.png')) + '<b>btn_buy.png</b><span class="bb-tag">原件</span><small>11 月 20 日 · 被引用 3</small></div><div>' + thumb(a) + '<b>' + esc(a.name) + '</b><span class="bb-tag">新身份</span><small>11 月 23 日 · 被引用 0</small></div></div>',
      actions: [{ label: '取消' }, { label: '对调', act: function () { resolve(it, '已对调：' + a.name + ' 成为原件，3 条引用跟着它走'); } }, { label: '没错，确认', kind: 'primary', act: function () { resolve(it, '已确认 btn_buy.png 是原件'); } }] });
    if (k === 'pick') return App.dialog({ title: '保留哪一份记录？', text: '两份记录的标签不一样。保留一份后，另一份会移入回收站。', body: '<div class="idc"><div><b>本机这份</b><small>11 月 24 日 · user:mo</small><div class="bb-tags"><span class="bb-tag">商店</span><span class="bb-tag">原型稿</span></div></div><div><b>冲突副本</b><small>11 月 24 日 · lin 的 MacBook</small><div class="bb-tags"><span class="bb-tag">商店</span><span class="bb-tag">原型稿</span><span class="bb-tag">v2</span></div></div></div>',
      actions: [{ label: '取消' }, { label: '保留冲突副本', act: function () { resolve(it, '已保留冲突副本，本机这份移入回收站'); } }, { label: '保留本机这份', kind: 'primary', act: function () { resolve(it, '已保留本机这份，冲突副本移入回收站'); } }] });
    if (k === 'cmp') return App.staleAct(a, 'cmp');
    if (k === 'replace') return App.staleAct(a, 'replace');
    if (k === 'reviewed') { App.staleAct(a, 'ok'); done[it.id] = 1; return cur.ctl.redraw(); }
    if (k === 'trash') return resolve(it, '已把 ' + it.name + ' 移入回收站');
    if (k === 'log') return App.dialog({ title: '处理失败：' + esc(a.name), body: '<pre class="prompt">阶段  生成缩略图\n插件  bowerbird.video 1.0\n错误  不支持的编码 ProRes 4444（ffmpeg 解码器缺失）\n时间  ' + D.fmtAt(it.at) + '</pre>', actions: [{ label: '关闭' }, { label: '重试', kind: 'primary', act: function () { act(it, 'retry'); } }] });
    if (k === 'retry') return resolve(it, '已重新排队，处理完会自动更新');
    if (k === 'install') { App.openPage('settings', { section: 'plugins', focus: 'community.spine' }); return; }
    if (k === 'clearthumb') return resolve(it, '已清除手动缩略图，改回自动生成');
    if (k === 'reshot') { App.closePage(); return App.openDetail(a.id, 'view'); }
    if (k === 'ignore') return resolve(it, '已忽略，这两个文件以后不再提示');
    if (k === 'markcopy') return resolve(it, '已把 ui/hud/panel_bg.png 标为 ' + a.name + ' 的副本');
  }
  PAGES.integrity = function (root) {
    var lv = 'all';
    function draw() {
      var all = issues(), list = all.filter(function (x) { return lv === 'all' || TYPE[x.type][2] === lv; }), cnt = { error: 0, warning: 0, info: 0 };
      all.forEach(function (x) { cnt[TYPE[x.type][2]]++; });
      root.innerHTML = bar('完整性', all.length ? seg('级别', [['all', '全部 ' + all.length], ['error', '错误 ' + cnt.error], ['warning', '警告 ' + cnt.warning], ['info', '提示 ' + cnt.info]], lv, ' data-lv') : '', all.length ? (function () { var ids = {}; all.forEach(function (x) { ids[x.a ? x.a.id : x.id] = 1; }); return Object.keys(ids).length + ' 个资产 · ' + all.length + ' 条问题'; })() : '') +
        '<div class="pbody it">' + (all.length ? ['error', 'warning', 'info'].filter(function (l) { return list.some(function (x) { return TYPE[x.type][2] === l; }); }).map(function (l) {
          var types = Object.keys(TYPE).filter(function (t) { return TYPE[t][2] === l && list.some(function (x) { return x.type === t; }); });
          return '<section class="it__lv it__lv--' + l + '"><h4>' + LEVEL[l][0] + '<span>' + list.filter(function (x) { return TYPE[x.type][2] === l; }).length + '</span></h4>' + types.map(function (t) {
            var xs = list.filter(function (x) { return x.type === t; }), acts = actionsFor(xs[0]), main = acts.filter(function (q) { return q[3]; })[0];
            return '<div class="it__ty"><div class="it__th">' + I(TYPE[t][1], 'bb-icon--12') + '<b>' + TYPE[t][0] + '</b><span class="vw__num">' + xs.length + '</span><span class="bb-toolbar__grow"></span>' + (xs.length > 1 && main ? '<button class="bb-btn bb-btn--sm" data-it-all="' + t + '" data-k="' + main[0] + '">全部' + main[1].replace('…', '') + '</button>' : '') + '</div>' +
              xs.map(function (x) {
                return '<div class="it__row" data-iid="' + esc(x.id) + '">' + (x.a ? thumb(x.a) : '<span class="pt">' + I('file-question') + '</span>') + '<div class="it__m"><b' + (x.a ? ' data-open="' + x.a.id + '"' : '') + '>' + esc(x.a ? x.a.name : x.name) + '</b><span>' + esc(x.detail) + '</span><small>' + esc(x.a ? x.a.folder : x.path) + ' · 发现于 ' + ago(x.at) + '</small></div><div class="it__acts">' +
                  actionsFor(x).map(function (q) { return '<button class="bb-btn bb-btn--sm" data-it="' + q[0] + '"' + (q[2] ? ' disabled title="回收站里没有它"' : '') + '>' + esc(q[1]) + '</button>'; }).join('') + '</div></div>';
              }).join('') + '</div>';
          }).join('') + '</section>';
        }).join('') : empty('shield-check', '资产库没有问题', '扫描会随时发现新问题，并显示在这里和左栏的「有问题」里。')) + '</div>';
      var sg = $('[data-lv]', root); if (sg) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (v) { lv = v; draw(); }); }
    }
    root.onclick = function (e) {
      var o = e.target.closest('[data-open]'); if (o && !e.target.closest('[data-it]')) { App.closePage(); return App.openDetail(o.dataset.open); }
      var b = e.target.closest('[data-it]'); if (b) { var id = b.closest('[data-iid]').dataset.iid, it = issues().filter(function (x) { return x.id === id; })[0]; if (it) act(it, b.dataset.it); return; }
      var all = e.target.closest('[data-it-all]'); if (all) { var xs = issues().filter(function (x) { return x.type === all.dataset.itAll; }); App.dialog({ title: '对 ' + xs.length + ' 条「' + TYPE[all.dataset.itAll][0] + '」执行“' + all.textContent + '”？', text: xs.map(function (x) { return x.a ? x.a.name : x.name; }).join('、'), actions: [{ label: '取消' }, { label: all.textContent, kind: 'primary', act: function () { xs.forEach(function (x) { done[x.id] = 1; if (x.a && x.a.issue === x.type) { x.a.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); } }); App.render(); draw(); App.toast('已处理 ' + xs.length + ' 条'); } }] }); }
    };
    draw();
    return { redraw: draw, destroy: function () { root.onclick = null; } };
  };

  /* ───────── 回收站 ───────── */
  function keep() { return App.trashKeep || 7; }  /* set in 资产库 settings */
  App.seedTrash = function () {
    function t(name, folder, kind, o, days, by) { var a = D.mk(name, folder, kind, Object.assign({ stage: 'runtime', review: 'approved' }, o)); a.trashedAt = NOW - days * DAY; a.trashedBy = by; return a; }
    return [
      t('potion_basecolor.png', 'props/potion', 'image', { art: 'basecolor', info: '1024×1024', w: 1024, h: 1024, tags: ['药水', '贴图'], bytes: 580e3 }, 3, 'user:mo'),
      t('btn_close.png', 'ui/shop', 'image', { art: 'ui', shape: 'close', c: ['#ff8f7a', '#e0503c'], alpha: true, info: '256×256', w: 256, h: 256, tags: ['商店', '切图'], bytes: 36e3 }, 2, 'agent:slicer'),
      t('moodboard_old.jpg', 'references/illustration', 'image', { art: 'render', hue: 320, stage: 'reference', review: 'exempt', info: '2400×1600', w: 2400, h: 1600, tags: ['参考'], bytes: 3.1e6 }, 5, 'user:lin'),
      t('chest_v0.glb', 'props/chest', 'model', { art: 'model', info: '1,904 面', tris: 1904, tags: ['宝箱'], bytes: 900e3 }, 6, 'agent:modeler')
    ];
  };
  if (!S.trash.length) S.trash = App.seedTrash();
  function leftDays(a) { return Math.max(0, keep() - Math.floor((NOW - (a.trashedAt || NOW)) / DAY)); }
  /* restoring goes back to the original place; if that name is taken, the restored file is renamed — and we say so */
  function restore(a, then) {
    var taken = D.assets.some(function (x) { return x.path === a.path; }), dot = a.name.lastIndexOf('.'), nm = a.name;
    function go() {
      if (taken) { nm = a.name.slice(0, dot) + ' (2)' + a.name.slice(dot); a.name = nm; a.path = a.folder + '/' + nm; }
      S.trash.splice(S.trash.indexOf(a), 1); delete a.trashedAt; D.assets.push(a); App.render(); if (App.pageOn === 'trash') cur.ctl.redraw();
      if (then) then(); else App.toast(nm + ' 已恢复到 ' + a.folder, function () { D.assets.splice(D.assets.indexOf(a), 1); a.trashedAt = NOW; S.trash.unshift(a); App.render(); if (App.pageOn === 'trash') cur.ctl.redraw(); });
    }
    if (!taken) return go();
    App.dialog({ title: '恢复 ' + esc(a.name) + '？', text: a.folder + ' 里已经有一个同名文件。恢复后它会改名为 ' + a.name.slice(0, dot) + ' (2)' + a.name.slice(dot) + '，两个文件都保留。', actions: [{ label: '取消' }, { label: '恢复并改名', kind: 'primary', act: go }] });
  }
  App.restoreFromTrash = restore;
  PAGES.trash = function (root) {
    var sel = [];
    function draw() {
      var L2 = S.trash;
      root.innerHTML = bar('回收站', L2.length ? '<button class="bb-btn" data-tr="empty">' + I('trash-2') + '清空回收站…</button>' : '', '保留 ' + keep() + ' 天，到期自动清除') +
        '<div class="pbody tr">' + (L2.length ? '<div class="tr__sel"' + (sel.length ? '' : ' hidden') + '><span>已选 ' + sel.length + ' 个</span><button class="bb-btn bb-btn--sm" data-tr="restore-sel">' + I('undo-2', 'bb-icon--12') + '恢复</button><button class="bb-btn bb-btn--sm bb-btn--danger" data-tr="purge-sel">彻底删除…</button></div>' +
          '<div class="tr__table" role="table"><div class="tr__h" role="row"><span></span><span>名称</span><span>原来的位置</span><span>删除时间</span><span>执行者</span><span>剩余</span><span></span></div>' +
          L2.map(function (a) { var d = leftDays(a); return '<div class="tr__r' + (sel.indexOf(a.id) >= 0 ? ' on' : '') + '" role="row" data-tid="' + a.id + '"><button class="tr__ck" data-tr="ck" aria-pressed="' + (sel.indexOf(a.id) >= 0) + '" aria-label="选择">' + I('check', 'bb-icon--12') + '</button><span class="tr__n">' + thumb(a) + '<b>' + esc(a.name) + '</b>' + H.stage(a.stage, 'short') + (a.review !== 'exempt' ? H.review(a.review) : '') + '</span><span class="text-mono-sm">' + esc(a.folder) + '</span><span>' + ago(a.trashedAt) + '</span><span class="text-mono-sm">' + esc(a.trashedBy || '') + '</span><span class="vw__num' + (d <= 1 ? ' tr__soon' : '') + '">' + d + ' 天</span><span class="tr__a"><button class="bb-btn bb-btn--sm" data-tr="restore">恢复</button><button class="bb-btn bb-btn--sm bb-btn--ghost" data-tr="purge">彻底删除…</button></span></div>'; }).join('') + '</div>'
          : empty('trash-2', '回收站是空的', '删除的资产会在这里保留 ' + keep() + ' 天，期间可以恢复。')) + '</div>';
    }
    function purge(as) {
      App.dialog({ title: '彻底删除 ' + (as.length > 1 ? as.length + ' 个资产' : esc(as[0].name)) + '？', text: '文件和旁边的 .bmeta 会从磁盘上删掉，不能恢复。' + (as.some(function (a) { return D.EDGES.some(function (e) { return e.toName === a.name && !e.to; }); }) ? '还有资产引用它，这些引用会一直找不到文件。' : ''),
        actions: [{ label: '取消' }, { label: '彻底删除', kind: 'danger', act: function () { as.forEach(function (a) { S.trash.splice(S.trash.indexOf(a), 1); }); sel = []; App.render(); draw(); App.toast('已彻底删除 ' + (as.length > 1 ? as.length + ' 个资产' : as[0].name)); } }] });
    }
    root.onclick = function (e) {
      var b = e.target.closest('[data-tr]'); if (!b) return; var k = b.dataset.tr, row = b.closest('[data-tid]'), a = row && S.trash.filter(function (x) { return x.id === row.dataset.tid; })[0];
      if (k === 'ck') { var i = sel.indexOf(a.id); if (i >= 0) sel.splice(i, 1); else sel.push(a.id); draw(); }
      if (k === 'restore') restore(a);
      if (k === 'purge') purge([a]);
      var picked = S.trash.filter(function (x) { return sel.indexOf(x.id) >= 0; });
      if (k === 'restore-sel') { picked.forEach(function (x) { restore(x, function () {}); }); sel = []; draw(); App.toast('已恢复 ' + picked.length + ' 个资产'); }
      if (k === 'purge-sel') purge(picked);
      if (k === 'empty') purge(S.trash.slice());
    };
    draw();
    return { redraw: draw, destroy: function () { root.onclick = null; } };
  };

  /* ───────── 设置：资产库 · 本机 · Agent 接入 · 插件 · 任务（标签是独立的页面） ───────── */
  var PLUG = [
    { id: 'bowerbird.image', name: '图片', icon: 'image', ver: '1.0.0', caps: ['PNG', 'JPG', 'WebP', 'GIF', 'SVG', 'AVIF', 'HDR'], st: 'on', builtin: true, set: [['缩略图最长边', '512 px']] },
    { id: 'bowerbird.video', name: '视频', icon: 'film', ver: '1.0.0', caps: ['MP4', 'MOV', 'WebM'], st: 'on', builtin: true, set: [['缩略图取帧位置', '30%']] },
    { id: 'bowerbird.audio', name: '音频', icon: 'audio-lines', ver: '1.0.0', caps: ['WAV', 'OGG', 'MP3', 'FLAC'], st: 'on', builtin: true, set: [['响度标准', '−16 LUFS']] },
    { id: 'bowerbird.model', name: '3D 模型', icon: 'box', ver: '1.0.0', caps: ['GLB', 'glTF', 'FBX'], st: 'on', builtin: true, set: [['默认环境', '工作室'], ['默认显示尺寸', 'SW'], ['单位', '米']] },
    { id: 'bowerbird.doc', name: '文档', icon: 'file-text', ver: '1.0.0', caps: ['Markdown', 'TXT', 'JSON', 'HTML'], st: 'on', builtin: true, set: [['目标尺寸字段', 'size']] },
    { id: 'bowerbird.search-keyword', name: '关键词搜索', icon: 'search', ver: '1.0.0', caps: ['名称', '标签', '描述', '文档正文', '提示词'], st: 'on', builtin: true, set: [] },
    { id: 'bowerbird.version-lore', name: 'Lore 版本存储', icon: 'git-fork', ver: '0.9.2', next: '0.10.0', caps: ['版本内容', '对比', '恢复'], st: 'on', set: [['仓库位置', '.lore/'], ['大文件阈值', '50 MB']] },
    { id: 'community.spine', name: 'Spine 动画', icon: 'bone', ver: '1.4.0', caps: ['SKEL', 'ATLAS'], st: 'missing', need: 'hero_run.skel 需要它' },
    { id: 'community.psd-layers', name: 'PSD 分层', icon: 'layers', ver: '0.3.1', caps: ['PSD'], st: 'failed', why: '这个插件需要更新版本的 Bowerbird（2.x），现在是 1.4' }
  ];
  var ST = { on: ['已启用', 'ok'], off: ['已禁用', 'off'], failed: ['加载失败', 'bad'], missing: ['资产库需要，本机未安装', 'warn'] };
  /* the fictional third-party creator plugin (plugin-demo.js) joins the list while it is switched on in the review controls */
  function plugs() { return App.dream && App.dream.on() ? PLUG.concat([App.dream.card()]) : PLUG; }
  var SECS = [['library', '资产库', 'hard-drive'], ['machine', '本机', 'settings'], ['agent', 'Agent 接入', 'bot'], ['plugins', '插件', 'puzzle'], ['tasks', '任务', 'activity']];
  var LIB = { name: '星落镇', id: 'xingluo', keep: 7 };
  var STAGES8 = [['识别', 0, 0], ['提取信息', 2, 42], ['派生', 0, 0], ['生成缩略图', 3, 18], ['生成 Agent 摘要', 1, 30], ['AI 富化', -1, 0], ['规则校验', 0, 0], ['写入索引', 0, 0]];
  /* failures say what to do next; a retry is only offered where it can help */
  var FAILED = [['theme_town.ogg', '生成缩略图', '读取超时', 'retry'], ['intro_cutscene.mov', '生成缩略图', '这台电脑的浏览器放不了这种视频（ProRes 4444）', ''], ['world_map_16k.png', '生成缩略图', '图片尺寸 16384×16384，超过 8192 的上限', ''], ['hero_run.skel', '识别', '需要 Spine 插件', 'install']];
  PAGES.settings = function (root, opt) {
    var sec = opt.section || 'library', plug = opt.plug || null, lan = !!S.lan, scanning = false;
    function nav() {
      var P = plugs();
      return '<nav class="st__nav">' + SECS.map(function (s) { return '<button class="st__n" data-sec="' + s[0] + '" aria-current="' + (sec === s[0] && !plug) + '">' + I(s[2], 'bb-icon--12') + s[1] + (s[0] === 'plugins' && P.some(function (p) { return p.st === 'failed' || p.st === 'missing' || p.warn; }) ? '<i class="st__dot"></i>' : '') + '</button>'; }).join('') +
        '<div class="st__nl">插件设置</div>' + P.filter(function (p) { return p.st === 'on' && p.set && p.set.length; }).map(function (p) { return '<button class="st__n st__n--p" data-plug="' + p.id + '" aria-current="' + (plug === p.id) + '">' + I(p.icon, 'bb-icon--12') + p.name + '</button>'; }).join('') + '</nav>';
    }
    function row(k, v, note) { return '<div class="st__row"><span class="st__k">' + k + '</span><span class="st__v">' + v + '</span>' + (note ? '<small class="st__note">' + note + '</small>' : '') + '</div>'; }
    function val(v) { return v === 'SW' ? sw(true, 'data-ps', '') : /^</.test(v) ? v : '<span class="st__val">' + esc(v) + '</span>'; }
    function code(id, text) { return '<div class="st__code"><pre id="' + id + '">' + esc(text) + '</pre><button class="bb-btn bb-btn--ghost bb-btn--sm" data-copy="' + id + '">' + I('copy', 'bb-icon--12') + '复制</button></div>'; }
    function body() {
      if (plug) { var p = plugs().filter(function (x) { return x.id === plug; })[0]; return '<h2>' + I(p.icon) + p.name + '<small class="text-mono-sm">' + p.id + ' ' + p.ver + '</small></h2>' + (p.setHtml ? p.setHtml() : '<section class="st__card">' + (p.set || []).map(function (s) { return row(s[0], val(s[1]), s[2]); }).join('') + '</section>'); }
      if (sec === 'library') return '<h2>资产库<small>存在资产库的 .bowerbird/ 里，所有人看到的都一样</small></h2><section class="st__card">' +
        row('名称', '<input class="bb-field__input st__in" value="' + esc(LIB.name) + '" aria-label="资产库名称">') +
        row('新资产的物料阶段', seg('默认物料阶段', [['reference', '参考'], ['production', '生产'], ['runtime', '运行时']], 'production', ' data-st'), '文件夹自己设了默认值的，以文件夹为准') +
        row('回收站保留', '<input class="bb-field__input st__in st__in--num" value="' + LIB.keep + '" aria-label="回收站保留天数" data-keep><span>天</span>') +
        row('缓存', '<span class="text-mono-sm">.bowerbird/cache/</span><span class="st__val">1.8 GB</span><button class="bb-btn bb-btn--sm" data-st-act="cache">清理缓存…</button>', '缩略图和预览，随资产库一起同步') +
        row('需要的插件', ['bowerbird.version-lore', 'community.spine'].map(function (id) { var q = PLUG.filter(function (x) { return x.id === id; })[0]; return '<button class="st__chip' + (q.st === 'missing' ? ' warn' : '') + '" data-goplug="' + id + '">' + I(q.icon, 'bb-icon--12') + q.name + (q.st === 'missing' ? ' · 未安装' : '') + '</button>'; }).join('')) + '</section>';
      if (sec === 'machine') return '<h2>本机<small>只影响这台电脑和这个浏览器</small></h2><section class="st__card">' +
        row('你的名字', '<input class="bb-field__input st__in" value="' + esc(S.myName) + '" placeholder="未署名" aria-label="你的名字" data-myname>', '你做的改动记在这个名字下面') +
        row('监听地址', seg('监听地址', [['local', '只允许本机'], ['lan', '允许局域网']], lan ? 'lan' : 'local', ' data-lan') + '<input class="bb-field__input st__in st__in--port" value="7420" aria-label="端口">') +
        (lan ? '<div class="st__warn">' + H.banner('danger', 'triangle-alert', '任何能访问这个地址的人，都能读写整个资产库', 'Bowerbird 没有登录功能，局域网里的人也能安装插件。只在可信的局域网里打开，不要暴露到公网。现在的地址：http://192.168.1.23:7420', '') + '</div>' : '') +
        row('定时扫描', '<button class="bb-select">每 10 分钟' + I('chevron-down', 'bb-icon--12') + '</button>') +
        row('后台并发', '<input class="bb-slider st__sl" type="range" min="1" max="8" value="4" aria-label="后台并发"><span class="vw__num" data-cv>4</span>') +
        row('界面语言', '<button class="bb-select">简体中文' + I('chevron-down', 'bb-icon--12') + '</button>') +
        row('主题', seg('主题', [['auto', '跟随系统'], ['dark', '深色'], ['light', '浅色']], document.documentElement.getAttribute('data-theme') || 'auto', ' data-theme-seg')) + '</section>';
      if (sec === 'agent') {
        var base = 'http://' + (lan ? '192.168.1.23' : '127.0.0.1') + ':7420';
        return '<h2>Agent 接入<small>Agent 与网页用同一套接口</small></h2><section class="st__card">' +
          row('地址', '<span class="text-mono-sm">' + base + '/api/libraries/' + LIB.id + '</span><button class="bb-btn bb-btn--ghost bb-btn--sm" data-copy-text="' + base + '/api/libraries/' + LIB.id + '">' + I('copy', 'bb-icon--12') + '复制</button>') +
          row('搜索的默认范围', seg('Agent 搜索范围', [['all', '返回全部并标明状态'], ['approved', '只返回已通过和免审的']], 'all', ' data-st')) +
          row('名字', '<span class="text-mono-sm">agent:&lt;名字&gt;</span>', '每个 Agent 用自己的名字，留痕里分得清是谁') + '</section>' +
          '<h3 class="st__h3">MCP</h3>' + code('mcpcfg', JSON.stringify({ mcpServers: { bowerbird: { command: 'bb', args: ['mcp', '--url', base, '--library', LIB.id] } } }, null, 2)) +
          '<h3 class="st__h3">命令行</h3>' + code('clidemo', 'bb search "宝箱 stage:runtime format:model"\nbb trace props/chest/chest.glb\nbb add chest_icon.png --folder props/chest --source chest.glb --by agent:modeler');
      }
      if (sec === 'plugins') { var P = plugs(); return '<h2>插件<small>' + P.length + ' 个 · 每台电脑各自安装</small><span class="bb-toolbar__grow"></span><button class="bb-btn bb-btn--sm" data-st-act="add">' + I('plus', 'bb-icon--12') + '安装插件…</button></h2>' +
        '<div class="st__trust">' + I('shield-check', 'bb-icon--12') + '插件在本机以完全信任的方式运行，能读写资产库里的所有文件。只安装来源可信的插件。</div>' +
        '<div class="st__plugs">' + P.map(function (p) {
          var s = ST[p.st];
          return '<div class="pl' + (opt.focus === p.id ? ' pl--focus' : '') + '" data-pid="' + p.id + '"><span class="pl__ic">' + I(p.icon) + '</span><div class="pl__m"><b>' + p.name + (p.builtin ? '<span class="bb-tag">内置</span>' : '') + '</b><small class="text-mono-sm">' + p.id + ' · ' + p.ver + '</small><div class="pl__caps">' + p.caps.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>' +
            (p.why ? '<p class="pl__why">' + I('circle-alert', 'bb-icon--12') + esc(p.why) + '</p>' : '') + (p.need ? '<p class="pl__why pl__why--warn">' + I('puzzle', 'bb-icon--12') + esc(p.need) + '</p>' : '') + (p.warn ? '<p class="pl__why pl__why--warn">' + I('triangle-alert', 'bb-icon--12') + esc(p.warn) + '</p>' : '') + '</div>' +
            '<div class="pl__r"><span class="pl__st pl__st--' + s[1] + '">' + s[0] + '</span>' +
            (p.st === 'missing' ? '<button class="bb-btn bb-btn--sm bb-btn--primary" data-pl="install">安装</button>' : p.st === 'failed' ? '<button class="bb-btn bb-btn--sm" data-pl="retry">重新加载</button>' : (p.next ? '<button class="bb-btn bb-btn--sm" data-pl="update">更新到 ' + p.next + '</button>' : '') + (p.builtin ? '' : sw(p.st === 'on', 'data-pl="toggle"', '启用 ' + p.name)) + ((p.set && p.set.length) || p.setHtml ? '<button class="bb-btn bb-btn--sm bb-btn--ghost" data-goplug="' + p.id + '">插件设置</button>' : '')) + '</div></div>';
        }).join('') + '</div>'; }
      if (sec === 'tasks') {
        var jobs = App.dream ? App.dream.jobs() : [];
        return '<h2>任务<small>后台处理</small></h2>' +
          (jobs.length ? '<section class="st__card"><div class="tk__fh"><b>创建</b><span class="vw__num">' + jobs.length + '</span></div>' + jobs.map(function (j) { return '<div class="tk__f tk__job" data-job="' + j.id + '"><span class="pt">' + I(j.icon || 'sparkles') + '</span><span class="tk__jm"><b>' + esc(j.title) + '</b><small>' + esc(j.plugin) + ' · ' + esc(j.stateText) + '</small></span>' + (j.state === 'running' ? '<span class="bb-progress tk__jp" style="--p:' + j.p + '%"><i></i></span><button class="bb-btn bb-btn--sm" data-tk="cancel-job">取消</button>' : j.state === 'pick' ? '<button class="bb-btn bb-btn--sm bb-btn--primary" data-tk="pick-job">挑选…</button>' : '') + '</div>'; }).join('') + '</section>' : '') +
          '<section class="st__card"><div class="tk">' + STAGES8.map(function (s) { return '<div class="tk__r"><span>' + s[0] + '</span><span class="tk__bar"><i style="width:' + Math.max(0, Math.min(100, s[1] * 12)) + '%"></i></span><span class="vw__num">' + (s[1] < 0 ? '没有插件' : s[1] ? s[1] + ' 个排队' : '空闲') + '</span><span class="vw__num tk__sp">' + (s[2] ? s[2] + ' 个/分' : '—') + '</span></div>'; }).join('') + '</div></section>' +
          '<section class="st__card">' + row('扫描', scanning ? '<span class="bb-progress" style="--p:46%;width:160px"><i></i></span><span class="vw__num">1,284 个文件里第 590 个</span>' : '<span>上一次 3 分钟前 · 没有发现变化</span><button class="bb-btn bb-btn--sm" data-tk="scan">' + I('refresh-cw', 'bb-icon--12') + '立即扫描</button>') + '</section>' +
          '<section class="st__card"><div class="tk__fh"><b>失败的任务</b><span class="vw__num">' + FAILED.length + '</span><span class="bb-toolbar__grow"></span>' + (FAILED.some(function (f) { return f[3] === 'retry'; }) ? '<button class="bb-btn bb-btn--sm" data-tk="retry-all">全部重试</button>' : '') + '</div>' +
          (FAILED.length ? FAILED.map(function (f, i) { var a = App.byName(f[0]); return '<div class="tk__f">' + (a ? thumb(a) : '') + '<b>' + esc(f[0]) + '</b><span class="bb-tag">' + f[1] + '</span><small>' + esc(f[2]) + '</small><span class="bb-toolbar__grow"></span>' + (f[3] === 'retry' ? '<button class="bb-btn bb-btn--sm" data-tk="retry" data-i="' + i + '">重试</button>' : f[3] === 'install' ? '<button class="bb-btn bb-btn--sm" data-goplug="community.spine">去安装</button>' : '') + '</div>'; }).join('') : '<p class="st__none">没有失败的任务</p>') + '</section>';
      }
      return '';
    }
    function draw() {
      root.innerHTML = bar('设置', '', '') + '<div class="pbody st">' + nav() + '<div class="st__body">' + body() + '</div></div>';
      $$('.bb-seg', root).forEach(function (s) { s.setAttribute('data-wired', ''); B.segmented(s, function (v) {
        if (s.hasAttribute('data-lan')) { if (v === 'lan') return App.dialog({ title: '允许局域网里的其他电脑访问？', text: 'Bowerbird 没有登录功能。打开后，同一网络里任何人都能读写整个资产库，也能安装插件。只在可信的局域网里这样做，不要暴露到公网。', actions: [{ label: '取消', act: function () { draw(); } }, { label: '允许局域网访问', kind: 'danger', act: function () { lan = S.lan = true; draw(); } }] }); lan = S.lan = false; draw(); }
        if (s.hasAttribute('data-theme-seg')) { if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }
      }); });
      var sl = $('.st__sl', root); if (sl) B.slider(sl, function (v) { var o = $('[data-cv]', root); if (o) o.textContent = v; });
      var f = $('.pl--focus', root); if (f) { f.scrollIntoView({ block: 'center' }); opt.focus = null; }
    }
    root.oninput = function (e) {
      if (e.target.hasAttribute('data-myname')) { S.myName = e.target.value.trim(); }
      if (e.target.hasAttribute('data-keep')) { var n = parseInt(e.target.value, 10); if (n > 0) { LIB.keep = n; App.trashKeep = n; } }
    };
    root.onclick = function (e) {
      var t = e.target, s = t.closest('[data-sec]'); if (s) { sec = s.dataset.sec; plug = null; return draw(); }
      var cp = t.closest('[data-copy], [data-copy-text]'); if (cp) { var txt = cp.dataset.copyText || ($('#' + cp.dataset.copy, root) || {}).textContent || ''; try { navigator.clipboard.writeText(txt).catch(function () {}); } catch (err) { /* clipboard may be refused */ } return App.toast('已复制'); }
      var gp = t.closest('[data-goplug]'), pp = t.closest('[data-plug]'); if (gp || pp) { var id = (gp || pp).dataset.goplug || (pp && pp.dataset.plug); var P = plugs().filter(function (x) { return x.id === id; })[0]; if (P && P.st === 'on' && ((P.set && P.set.length) || P.setHtml)) { plug = id; } else { sec = 'plugins'; plug = null; opt.focus = id; } return draw(); }
      var pl = t.closest('[data-pl]'); if (pl) {
        var P2 = plugs().filter(function (x) { return x.id === pl.closest('[data-pid]').dataset.pid; })[0], k = pl.dataset.pl;
        if (k === 'toggle') { if (P2.toggle) { P2.toggle(); draw(); return; } P2.st = P2.st === 'on' ? 'off' : 'on'; draw(); return App.toast(P2.name + (P2.st === 'on' ? ' 已启用' : ' 已禁用，它负责的格式暂时只显示文件信息')); }
        if (k === 'update') return App.dialog({ title: '把 ' + P2.name + ' 更新到 ' + P2.next + '？', text: '更新时会短暂停用它，大约几秒钟。', actions: [{ label: '取消' }, { label: '更新', kind: 'primary', act: function () { P2.ver = P2.next; P2.next = null; draw(); App.toast(P2.name + ' 已更新到 ' + P2.ver); } }] });
        if (k === 'retry') return App.toast(P2.name + ' 仍然加载失败：' + P2.why);
        if (k === 'install') return App.dialog({ title: '安装 ' + P2.name + '？', text: '来源：npm 包 ' + P2.id + ' ' + P2.ver + '。插件在本机以完全信任的方式运行，能读写资产库里的所有文件。', actions: [{ label: '取消' }, { label: '安装', kind: 'primary', act: function () {
          P2.st = 'on'; delete P2.need; draw(); var a = App.byName('hero_run.skel'); if (a) { a.needs = null; if (a.issue === 'plugin') { a.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); } App.render(); }
          FAILED = FAILED.filter(function (f) { return f[3] !== 'install'; });
          App.toast(P2.name + ' 已安装，hero_run.skel 可以预览了'); } }] });
      }
      var sa = t.closest('[data-st-act]'); if (sa) {
        var k2 = sa.dataset.stAct;
        if (k2 === 'cache') return App.dialog({ title: '清理缓存？', text: '会删掉 1.8 GB 的缩略图和预览，资产本身不受影响。之后打开页面时会重新生成，期间显示占位图；其他人同步后也要重新生成。', actions: [{ label: '取消' }, { label: '清理', kind: 'primary', act: function () { App.toast('已清理缓存'); } }] });
        if (k2 === 'add') { var d = App.dialog({ title: '安装插件', form: true, body: '<div class="bb-field"><input class="bb-field__input" id="plsrc" placeholder="npm 包名，或本机上的文件夹路径" aria-label="npm 包名或本机路径" autocomplete="off" spellcheck="false"></div><p class="st__hint">例如 <span class="text-mono-sm">@studio/bowerbird-spine</span> 或 <span class="text-mono-sm">~/plugins/my-checks</span></p><p class="st__hint">' + I('shield-check', 'bb-icon--12') + '插件在本机以完全信任的方式运行。只安装来源可信的插件。</p>', actions: [{ label: '取消' }, { label: '安装', kind: 'primary', keep: true, act: function (h) { var v = $('#plsrc', h).value.trim(); if (!v) { $('#plsrc', h).parentNode.setAttribute('data-invalid', ''); return $('#plsrc', h).focus(); } h.cancel(); App.toast('正在安装 ' + v); } }] }); setTimeout(function () { $('#plsrc', d).focus(); }, 0); return; }
      }
      var tk = t.closest('[data-tk]'); if (tk) {
        var k4 = tk.dataset.tk;
        if (k4 === 'scan') { scanning = true; draw(); setTimeout(function () { scanning = false; if (App.pageOn === 'settings') draw(); App.toast('扫描完成，没有发现变化'); }, 1800); }
        if (k4 === 'retry') { var f = FAILED.splice(+tk.dataset.i, 1)[0]; draw(); return App.toast(f[0] + ' 已重新排队'); }
        if (k4 === 'retry-all') { var rs = FAILED.filter(function (x) { return x[3] === 'retry'; }); FAILED = FAILED.filter(function (x) { return x[3] !== 'retry'; }); draw(); return App.toast(rs.length + ' 个任务已重新排队'); }
        if (k4 === 'cancel-job' && App.dream) { App.dream.cancel(tk.closest('[data-job]').dataset.job); return draw(); }
        if (k4 === 'pick-job' && App.dream) { App.dream.pick(tk.closest('[data-job]').dataset.job); return; }
      }
    };
    draw();
    var tick = setInterval(function () { if (sec === 'tasks' && !plug && App.dream && App.dream.jobs().some(function (j) { return j.state === 'running'; })) draw(); }, 600);
    return { destroy: function () { clearInterval(tick); root.onclick = root.oninput = null; }, key: function () { return false; } };
  };
  App.openSettings = function (section, focus, own) { App.openPage('settings', { section: section, focus: focus, plug: own ? focus : null }); };
  App.trashKeep = LIB.keep;

  /* ───────── 标签：独立的页面，左栏有入口 ───────── */
  var TAGS = [
    { n: '宝箱', g: '对象', c: '#e8a33a', k: 11, al: ['chest'] }, { n: '药水', g: '对象', c: '#e0559a', k: 34, al: ['potion'] }, { n: '主角', g: '对象', c: '#4f8ff0', k: 58, al: [] }, { n: 'NPC', g: '对象', c: '#6cbf43', k: 128, al: [] },
    { n: '原画', g: '用途', c: '#8f78d0', k: 140, al: ['concept'] }, { n: '四视图', g: '用途', c: '#8f78d0', k: 46, al: ['turnaround'] }, { n: '贴图', g: '用途', c: '#8f78d0', k: 412, al: ['texture'] }, { n: 'Icon', g: '用途', c: '#8f78d0', k: 144, al: [] }, { n: '切图', g: '用途', c: '#8f78d0', k: 96, al: [] }, { n: '音效', g: '用途', c: '#8f78d0', k: 71, al: ['sfx'] },
    { n: '道具', g: '', c: '', k: 213, al: [] }, { n: '商店', g: '', c: '', k: 15, al: [] }, { n: '参考', g: '', c: '', k: 302, al: [] }, { n: '设计对象', g: '', c: '', k: 24, al: [] }, { n: '宝相', g: '', c: '', k: 1, al: [] }, { n: '道具s', g: '', c: '', k: 2, al: [] }
  ];
  var AITAGS = [['低多边形', 64], ['木质', 23], ['黄铜', 19], ['卡通', 57], ['金属', 31], ['发光', 12], ['磨砂玻璃', 4]];
  var GROUPS = ['对象', '用途'];
  PAGES.tags = function (root) {
    var tagSort = 'name', dragTag = null;
    function draw() {
      var list = TAGS.slice().sort(function (x, y) { return tagSort === 'count' ? x.k - y.k : x.n < y.n ? -1 : 1; }), groups = GROUPS.concat(['']);
      root.innerHTML = bar('标签', TAGS.length && !S.emptyLib ? seg('排序', [['name', '按名称'], ['count', '用得最少的在前']], tagSort, ' data-tsort') + '<button class="bb-btn bb-btn--sm" data-tg="group">' + I('plus', 'bb-icon--12') + '新建分组</button>' : '', S.emptyLib ? '' : TAGS.length + ' 个') +
        '<div class="pbody tg">' + (S.emptyLib ? empty('tags', '还没有标签', '给资产打标签后，会在这里统一管理。') :
          groups.map(function (g) { var xs = list.filter(function (t) { return t.g === g; }); return '<section class="tg__grp" data-grp="' + g + '"><h5>' + (g || '未分组') + '<span>' + xs.length + '</span></h5>' + xs.map(function (t) { return '<div class="tg__r" draggable="true" data-tag="' + esc(t.n) + '"><i class="tg__c" style="background:' + (t.c || 'var(--fill-press)') + '"></i><b>' + esc(t.n) + '</b>' + (t.al.length ? '<small>别名 ' + esc(t.al.join('、')) + '</small>' : '') + '<span class="bb-toolbar__grow"></span><span class="vw__num' + (t.k <= 2 ? ' tg__few' : '') + '">' + t.k + '</span><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-tg="more" aria-label="更多">' + I('ellipsis', 'bb-icon--12') + '</button></div>'; }).join('') + '</section>'; }).join('') +
          (AITAGS.length ? '<section class="tg__ai"><h5>' + I('sparkles', 'bb-icon--12') + 'AI 打的标签，还没人采纳<span>' + AITAGS.length + '</span><span class="bb-toolbar__grow"></span><button class="bb-btn bb-btn--sm" data-tg="drop-all">全部移除…</button><button class="bb-btn bb-btn--sm bb-btn--primary" data-tg="adopt-all">全部采纳</button></h5><div class="rq__tags">' + AITAGS.map(function (t) { return '<span class="bb-tag bb-tag--ai">' + esc(t[0]) + '<small>' + t[1] + '</small><button data-tg-adopt="' + esc(t[0]) + '" aria-label="采纳" title="采纳为正式标签">' + I('check', 'bb-icon--12') + '</button></span>'; }).join('') + '</div></section>' : '')) + '</div>';
      var sg = $('[data-tsort]', root); if (sg) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (v) { tagSort = v; draw(); }); }
    }
    function rename(T0) {
      var d = App.dialog({ title: '把「' + esc(T0.n) + '」改名', form: true, text: '会更新用到它的 ' + T0.k + ' 个资产。', body: '<div class="bb-field"><input class="bb-field__input" id="tgn" value="' + esc(T0.n) + '" aria-label="新名称"></div>', actions: [{ label: '取消' }, { label: '改名', kind: 'primary', act: function (h) { var v = $('#tgn', h).value.trim(); if (v && v !== T0.n) { var old = T0.n; T0.al.push(old); T0.n = v; draw(); App.toast('已改名，' + T0.k + ' 个资产已更新；旧名字留作别名', function () { T0.n = old; T0.al.pop(); draw(); }); } } }] });
      setTimeout(function () { var i = $('#tgn', d); i.focus(); i.select(); }, 0);
    }
    function merge(T0, at) {
      App.menu([{ header: '把「' + T0.n + '」并入' }].concat(TAGS.filter(function (q) { return q !== T0; }).slice(0, 10).map(function (o) { return { label: o.n, kbd: String(o.k), act: function () {
        App.dialog({ title: '把「' + esc(T0.n) + '」并入「' + esc(o.n) + '」？', text: T0.k + ' 个资产会改用「' + o.n + '」，「' + T0.n + '」会成为它的别名。合并不能撤销。', actions: [{ label: '取消' }, { label: '合并', kind: 'danger', act: function () { o.k += T0.k; o.al.push(T0.n); TAGS.splice(TAGS.indexOf(T0), 1); draw(); App.toast('已合并，' + T0.k + ' 个资产已更新'); } }] });
      } }; })), at);
    }
    root.ondragstart = function (e) { var r = e.target.closest('[data-tag]'); if (r) { dragTag = r.dataset.tag; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragTag); } catch (err) { /* some browsers */ } S.dragging = true; } };
    root.ondragend = function () { S.dragging = false; dragTag = null; $$('.tg__grp', root).forEach(function (g) { g.classList.remove('over'); }); };
    root.ondragover = function (e) { var g = e.target.closest('[data-grp]'); if (g && dragTag) { e.preventDefault(); $$('.tg__grp', root).forEach(function (x) { x.classList.toggle('over', x === g); }); } };
    root.ondrop = function (e) { var g = e.target.closest('[data-grp]'); if (!g || !dragTag) return; e.preventDefault(); var t = TAGS.filter(function (x) { return x.n === dragTag; })[0], was = t.g; t.g = g.dataset.grp; S.dragging = false; draw(); App.toast('「' + t.n + '」移到了' + (t.g || '未分组'), function () { t.g = was; draw(); }); };
    root.onclick = function (e) {
      var t = e.target, ta = t.closest('[data-tg-adopt]');
      if (ta) { var nm = ta.dataset.tgAdopt, x = AITAGS.filter(function (q) { return q[0] === nm; })[0]; AITAGS.splice(AITAGS.indexOf(x), 1); TAGS.push({ n: nm, g: '', c: '', k: x[1], al: [] }); draw(); return App.toast('「' + nm + '」成为正式标签，' + x[1] + ' 个资产已更新'); }
      var tg = t.closest('[data-tg]'); if (!tg) return; var k = tg.dataset.tg;
      if (k === 'group') { GROUPS.push('新分组 ' + GROUPS.length); return draw(); }
      if (k === 'adopt-all') { var n = AITAGS.length; AITAGS.forEach(function (q) { TAGS.push({ n: q[0], g: '', c: '', k: q[1], al: [] }); }); AITAGS.length = 0; draw(); return App.toast('已采纳 ' + n + ' 个 AI 标签'); }
      if (k === 'drop-all') return App.dialog({ title: '移除全部 ' + AITAGS.length + ' 个 AI 标签？', text: '只移除还没采纳的 AI 标签，已经采纳的不受影响。AI 以后可能再次打出它们。', actions: [{ label: '取消' }, { label: '全部移除', kind: 'danger', act: function () { AITAGS.length = 0; draw(); } }] });
      if (k === 'more') { var T0 = TAGS.filter(function (q) { return q.n === tg.closest('[data-tag]').dataset.tag; })[0];
        return App.menu([{ icon: 'pencil', label: '改名…', act: function () { rename(T0); } }, { icon: 'git-compare-arrows', label: '合并到…', act: function () { merge(T0, tg); } }, { icon: 'folder-input', label: '移到分组', sub: GROUPS.concat(['']).map(function (g) { return { label: g || '未分组', check: T0.g === g, act: function () { T0.g = g; draw(); } }; }) }], tg); }
    };
    draw();
    return { destroy: function () { root.onclick = root.ondragstart = root.ondragend = root.ondragover = root.ondrop = null; } };
  };

  /* ───────── loading and error, for every page ───────── */
  var TITLES = { review: '校验队列', integrity: '完整性', trash: '回收站', settings: '设置', tags: '标签' };
  App.statePage = function (root, id, state) {
    root.innerHTML = bar(TITLES[id] || '') + '<div class="pbody">' + (state === 'loading' ? '<div class="pg-skel">' + new Array(7).join('<div class="pg-skel__r"><i></i><span></span><span></span></div>') + '</div>'
      : empty('unlink', '连接不到 Bowerbird 服务', '<span class="text-mono">127.0.0.1:7420</span>', '<button class="bb-btn bb-btn--primary" data-pgretry>' + I('refresh-cw') + '重试</button>')) + '</div>';
    root.onclick = function (e) { if (e.target.closest('[data-pgretry]')) { S.state = 'loading'; App.render(); App.openPage(id); setTimeout(function () { S.state = 'ready'; App.render(); if (App.pageOn === id) App.openPage(id); }, 800); } };
    return { destroy: function () { root.onclick = null; } };
  };
})();
