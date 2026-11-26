/* Bowerbird prototype — asset detail page. The shell gives it a tool bar (back, name, tabs, previous/next)
 * and a container; the viewer inside the container comes from the format plugin (viewers.js). */
(function () {
  'use strict';
  var App = window.App, B = Bowerbird, I = B.icon, H = B.html, D = App.D, S = App.S, el = App.el, $ = App.$, $$ = App.$$;
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function local(r) { var z = S.zoom; return { left: r.left / z, top: r.top / z, width: r.width / z, height: r.height / z }; }
  var dbar = $('#dbar'), dv = $('#detail'), tab = 'view', host = null, tabsCtl = null, graph = null, tabsNow = [];
  /* the way here: every asset opened from inside the detail page, with the tab it was on */
  var trail = [];
  function tabsFor(a) { return (App.isDesignObject && App.isDesignObject(a) ? [['obj', '总览'], ['view', '文档'], ['rel', '关系'], ['ver', '版本'], ['rev', '校验']] : [['view', '查看'], ['rel', '关系'], ['ver', '版本'], ['rev', '校验']]).concat(App.dream ? App.dream.tabs(a) : []); }
  function cur() { return App.byId(App.detailOpen); }

  /* ── tool bar ── */
  function buildBar(a) {
    var TABS = tabsNow = tabsFor(a);
    dbar.innerHTML = '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-d="back" aria-label="返回">' + I('chevron-left') + '</button><nav class="dcr" aria-label="路径"></nav><span class="bb-toolbar__grow"></span>' +
      '<div class="bb-tabs" role="tablist" aria-label="详情"><i class="bb-tabs__bar"></i>' + TABS.map(function (t) { return '<button class="bb-tab" role="tab" data-value="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + t[1] + '<span class="bb-tab__count" data-count="' + t[0] + '" hidden></span></button>'; }).join('') + '</div>' +
      '<span class="bb-toolbar__grow"></span><span class="vw__num" data-pos></span>' +
      '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-d="prev" aria-label="上一个" title="上一个 ←">' + I('chevron-left') + '</button><button class="bb-btn bb-btn--ghost bb-btn--icon" data-d="next" aria-label="下一个" title="下一个 →">' + I('chevron-right') + '</button><span class="bb-toolbar__sep"></span>' +
      '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-d="more" aria-label="更多操作" title="更多操作">' + I('ellipsis') + '</button>' +
      '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-d="insp" aria-pressed="' + (el.app.getAttribute('data-insp') !== 'closed') + '" aria-label="检查器" title="检查器 ⌘I">' + I('panel-right') + '</button>';
    var tb = $('.bb-tabs', dbar); tb.setAttribute('data-wired', '');
    tabsCtl = B.tabs(tb, function (v) { if (v === tab) return; tab = v; pane(); });
  }
  function setTab(t) { tab = t; $$('.bb-tab', dbar).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.value === t); }); if (tabsCtl) tabsCtl.place(true); }
  App.detailTab = function (t) { if (!App.detailOpen) return; setTab(t); pane(); };
  function syncHead() {
    var a = cur(); if (!a) return;
    var list = S._list || [], i = list.indexOf(a), t = App.locTitle(), r = D.rel(a), home = t[t.length - 1], sep = I('chevron-right', 'bb-icon--12');
    var shown = trail.map(function (x, k) { return k; }), hidden = [];
    if (trail.length > 2) { hidden = shown.slice(0, trail.length - 1); shown = shown.slice(-1); }
    $('.dcr', dbar).innerHTML = '<button class="dcr__c" data-crumb="home" title="回到浏览页">' + esc(home) + '</button>' +
      (hidden.length ? sep + '<button class="dcr__c" data-crumb="more" aria-label="更早的路径">…</button>' : '') +
      shown.map(function (k) { var x = App.byId(trail[k].id); return sep + '<button class="dcr__c" data-crumb="' + k + '" title="' + esc(x ? x.path : '') + '">' + esc(x ? x.name : '已删除') + '</button>'; }).join('') +
      sep + '<div class="dh"><b title="' + esc(a.path) + '">' + esc(a.name) + '</b>' + (a.issue ? H.issue(a.issue) : '') + H.stage(a.stage, 'short') + H.review(a.review, true) + '</div>';
    var bk = $('[data-d="back"]', dbar), prev = trail.length && App.byId(trail[trail.length - 1].id);
    bk.title = '返回 ' + (prev ? prev.name + '  ⌘[' : home + '  Esc');
    $('[data-pos]', dbar).textContent = i >= 0 ? (i + 1) + ' / ' + list.length : '';
    $('[data-d="prev"]', dbar).disabled = i <= 0; $('[data-d="next"]', dbar).disabled = i < 0 || i >= list.length - 1;
    var c = { rel: r.count, ver: D.versions(a).length, obj: r.members.length };
    $$('[data-count]', dbar).forEach(function (x) { var n = c[x.dataset.count]; x.hidden = !n; x.textContent = n || ''; });
    if (tabsCtl) tabsCtl.place(false);
    var sb = $('.dstale', dv); if (sb) sb.innerHTML = App.staleBanner ? App.staleBanner(a) : '';
  }

  /* ── panes ── */
  var vt = null;  /* the 版本 tab lives in compare.js (App.versionPane) */
  /* one built-in check (ADR-020): the model's size against the design object's target. It is shown, it never sets the verdict; team rules come from plugins. */
  function checks(a) {
    var mf = App.modelFit && App.modelFit(a); if (!mf) return [];
    var dims = function (o, k) { return o[k[0]].toFixed(2) + ' × ' + o[k[1]].toFixed(2) + ' × ' + o[k[2]].toFixed(2) + ' m'; };
    return [[mf.ok, '尺寸与设计对象', '模型 ' + dims(mf.s, ['x', 'y', 'z']) + ' · 目标 ' + dims(mf.t, ['w', 'h', 'd']) + (mf.ok ? '' : ' · ' + mf.issues.join('；'))]];
  }
  App.checks = checks;  /* the review queue shows the same result */
  /* the verdict is the latest one only — who, when, the comment (ADR-024); there is no history in the kernel */
  function revPane(a) {
    var up = App.nearestUpstream && App.nearestUpstream(a), cks = checks(a), v = App.verdictOf(a);
    var who = v.by ? '<span class="text-mono-sm">' + esc(App.who(v.by)) + '</span> · ' + D.fmtAt(v.at) : '';
    return '<section class="rvhead">' + H.review(a.review, true) + (who ? '<span class="rv__who">' + who + '</span>' : '') + '<span class="bb-toolbar__grow"></span>' + (up ? '<button class="bb-btn" data-rv="cmp" data-up="' + up.id + '" title="和 ' + esc(up.name) + ' 对比">' + I('git-compare-arrows') + '与上游对比</button>' : '') + (a.review === 'exempt' ? '' : '<button class="bb-btn" data-rv="reject">' + I('undo-2') + '打回…</button><button class="bb-btn bb-btn--primary" data-rv="approve"' + (a.review === 'approved' ? ' disabled' : '') + '>' + I('check') + '通过</button>') + '</section>' +
      (v.note ? '<section class="rv__note' + (a.review === 'rejected' ? ' rv__note--rej' : '') + '">' + I(a.review === 'rejected' ? 'undo-2' : 'message-square', 'bb-icon--12') + '<p>' + esc(v.note) + '</p></section>' : '') +
      '<section><h4>自动检查</h4>' + (cks.length ? cks.map(function (x) { return '<div class="chk-row' + (x[0] ? '' : ' bad') + '">' + I(x[0] ? 'check' : 'x') + '<span>' + x[1] + '</span><span class="vw__num">' + esc(x[2]) + '</span></div>'; }).join('') : '<p class="rv__none">' + I('list-checks', 'bb-icon--12') + '没有自动检查项</p>') + '</section>';
  }
  function pane(swap) {
    var a = cur(); if (!a) return;
    if (host && host._viewer) { host._viewer.destroy(); host._viewer = null; }
    if (graph) { graph.destroy(); graph = null; }
    if (vt) { vt.destroy(); vt = null; }
    if (tab !== 'rel' && App.forgetGraph) App.forgetGraph();
    var top = '<div class="dstale">' + (App.staleBanner ? App.staleBanner(a) : '') + '</div>';
    if (tab === 'view') { dv.innerHTML = top + '<div class="dpane dview"><div class="vhost"></div></div>'; host = $('.vhost', dv); App.mountViewer(host, a); if (swap) host.firstChild.classList.add('swap'); return; }
    host = null;
    if (tab === 'rel') { dv.innerHTML = top + '<div class="dpane dgraph"></div>'; graph = App.mountGraph($('.dgraph', dv), a); return; }
    if (tab === 'obj') { dv.innerHTML = top + '<div class="dpane"><div class="dcol dcol--wide">' + App.objectOverview(a) + '</div></div>'; return; }
    if (tab === 'ver') { dv.innerHTML = top + '<div class="dpane dver"></div>'; vt = App.versionPane($('.dver', dv), a); return; }
    /* a plugin's own tab (the detail-tab slot) */
    if (tab.indexOf('plug:') === 0) { dv.innerHTML = top + '<div class="dpane"><div class="dcol">' + (App.dream ? App.dream.tabHtml(a) : '') + '</div></div>'; return; }
    dv.innerHTML = top + '<div class="dpane"><div class="dcol">' + revPane(a) + '</div></div>';
  }
  /* after a change made elsewhere (a restore, the version plugin switched on or off) */
  App.detailRefresh = function () { if (!App.detailOpen) return; syncHead(); pane(); };

  /* ── open · step · close ── */
  function flip(from) {
    var st = $('.vw__stage', dv); if (!st || !from) return;
    var r = local(st.getBoundingClientRect());
    st.style.transformOrigin = '0 0'; st.style.transition = 'none';
    st.style.transform = 'translate(' + (from.left - r.left) + 'px,' + (from.top - r.top) + 'px) scale(' + from.width / r.width + ',' + from.height / r.height + ')';
    void st.offsetWidth;
    st.style.transition = 'transform var(--bb-t-settle) var(--bb-spring)'; st.style.transform = '';
    setTimeout(function () { st.style.transition = ''; st.style.transformOrigin = ''; }, 640);
  }
  function setHash(id, push) { try { if (push) location.hash = 'asset-' + id; else location.replace('#asset-' + id); } catch (e) { /* hash is optional */ } }
  function hasTab(tabs, t) { return tabs.some(function (x) { return x[0] === t; }); }
  /* want: a tab to land on; without it, stay on the current tab when the new asset has it */
  App.openDetail = function (id, want, opts) {
    var a = App.byId(id); if (!a || App.modal) return;
    var c = $('[data-id="' + id + '"] .bb-cell__thumb, tr[data-id="' + id + '"] .bb-row__thumb', el.content), from = c ? local(c.getBoundingClientRect()) : null;
    if (App.qlOpen) { var q = $('.ql__panel'); if (q) from = local(q.getBoundingClientRect()); App.qlClose(true); }
    var already = !!App.detailOpen, tabs = tabsFor(a), isBack = !!(opts && opts.back);
    if (!already) trail = [];
    else if (App.detailOpen !== id && !isBack) { trail.push({ id: App.detailOpen, tab: tab }); if (trail.length > 20) trail.shift(); }
    tab = want && hasTab(tabs, want) ? want : already && hasTab(tabs, tab) ? tab : tabs[0][0];
    App.detailOpen = id; S.sel = [id]; S.focus = S.anchor = id;
    if (!already) { el.bar.hidden = true; dbar.hidden = false; dv.hidden = false; dv.className = 'enter'; buildBar(a); setTimeout(function () { if (dv.className === 'enter') dv.className = ''; }, 700); }
    else if (tabsNow.length !== tabs.length) buildBar(a);
    else setTab(tab);
    syncHead(); pane(already); App.syncSel(); setHash(id, !isBack);
    if (!already && tab === 'view') flip(from);
  };
  /* back one step (or to a crumb): the asset comes back on the tab it was left on */
  function back(to) {
    if (!trail.length) return App.closeDetail();
    var k = to == null ? trail.length - 1 : to, x = trail[k];
    trail = trail.slice(0, k);
    if (!App.byId(x.id)) return back();
    App.openDetail(x.id, x.tab, { back: true });
  }
  App.detailBack = back;
  function step(d) {
    var list = S._list || [], i = list.indexOf(cur()) + d; if (i < 0 || i >= list.length) return;
    var b = list[i], tabs = tabsFor(b); App.detailOpen = b.id; S.sel = [b.id]; S.focus = S.anchor = b.id;
    if (!hasTab(tabs, tab)) tab = tabs[0][0];
    if (tabsNow.length !== tabs.length) buildBar(b); else setTab(tab);
    syncHead(); pane(true); App.syncSel(); setHash(b.id);
  }
  App.closeDetail = function (instant) {
    var id = App.detailOpen; if (!id) return;
    App.detailOpen = null; trail = []; try { location.replace('#browse'); } catch (e) { /* hash is optional */ }
    if ((S._list || []).indexOf(App.byId(id)) < 0) S.sel = [];
    dbar.hidden = true; el.bar.hidden = false; App.syncBar(); App.syncSel();
    var cell = $('[data-id="' + id + '"]', el.content), th = cell && $('.bb-cell__thumb, .bb-row__thumb', cell), st = $('.vw__stage', dv);
    if (cell) cell.scrollIntoView({ block: 'nearest' });
    function done() { if (host && host._viewer) host._viewer.destroy(); host = null; if (graph) { graph.destroy(); graph = null; } if (vt) { vt.destroy(); vt = null; } if (App.forgetGraph) App.forgetGraph(); dv.hidden = true; dv.innerHTML = ''; dv.className = ''; }
    if (instant || !th || !st || tab !== 'view') { dv.className = 'leaving'; return setTimeout(done, instant ? 0 : 200); }
    var r = local(st.getBoundingClientRect()), to = local(th.getBoundingClientRect());
    dv.className = 'leaving'; st.style.transformOrigin = '0 0'; st.style.transition = 'transform var(--bb-t-arrive) var(--bb-spring), opacity var(--bb-t-arrive) var(--bb-ease)';
    st.style.transform = 'translate(' + (to.left - r.left) + 'px,' + (to.top - r.top) + 'px) scale(' + to.width / r.width + ',' + to.height / r.height + ')'; st.style.opacity = '0.2';
    setTimeout(done, 380);
  };
  App.detailKey = function (e) {
    var v = host && host._viewer;
    if (e.target.closest && e.target.closest('.bb-tabs')) return true;
    if ((e.metaKey || e.ctrlKey) && e.key === '[') { e.preventDefault(); back(); return true; }
    if (App.qlOpen) return !/^( |Enter|Arrow)/.test(e.key);  /* quick look over the detail page: space / arrows / ↵ belong to it */
    if (tab === 'rel' && graph && graph.key && graph.key(e)) { e.preventDefault(); return true; }
    if (tab === 'view' && v && v.key && v.key(e)) { e.preventDefault(); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); return true; }
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); return true; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      /* in a text document ⌘A / Ctrl+A selects its text, ready for ⌘C */
      var txt = tab === 'view' && $('.vw__stage.doc .dv', dv);
      if (txt) { e.preventDefault(); var r = document.createRange(); r.selectNodeContents(txt); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      return true;
    }
    return false;
  };

  /* ── events ── */
  dbar.addEventListener('click', function (e) {
    var cr = e.target.closest('[data-crumb]');
    if (cr) {
      var k = cr.dataset.crumb;
      if (k === 'home') return App.closeDetail();
      if (k === 'more') { var n = trail.length > 2 ? trail.length - 1 : 0; return App.menu(trail.slice(0, n).map(function (x, i) { var o = App.byId(x.id); return { icon: 'chevron-left', label: o ? o.name : '已删除', act: function () { back(i); } }; }).reverse(), cr); }
      return back(+k);
    }
    var b = e.target.closest('[data-d]'); if (!b) return;
    if (b.dataset.d === 'back') back();
    if (b.dataset.d === 'prev') step(-1);
    if (b.dataset.d === 'next') step(1);
    if (b.dataset.d === 'insp') App.togglePanel('insp');
    /* the same menu as right-clicking the asset in the grid: same actions, same names */
    if (b.dataset.d === 'more') { S.sel = [App.detailOpen]; App.assetMenu(b); }
  });
  dv.addEventListener('click', function (e) {
    var sa = e.target.closest('.dstale [data-stale]'); if (sa) return App.staleAct(cur(), sa.dataset.stale);
    if (e.target.closest('.dgraph')) return;
    var oc = e.target.closest('.ov-grid .bb-cell[data-id]'); if (oc) return App.openDetail(oc.dataset.id);
    var o = e.target.closest('[data-open]'); if (o) return App.openDetail(o.dataset.open);
    var rv = e.target.closest('[data-rv]'); if (!rv) return; var a = cur();
    if (rv.dataset.rv === 'cmp') return App.compare(a, App.byId(rv.dataset.up));
    if (rv.dataset.rv === 'approve') { var pv = App.verdictOf(a); App.setVerdict(a, 'approved'); App.render(); pane(); return App.toast(a.name + ' 已通过', function () { App.restoreVerdict(a, pv); App.render(); pane(); }); }
    var d = App.dialog({ title: '打回 ' + esc(a.name), form: true, body: '<div class="bb-field bb-field--area"><textarea class="bb-field__input" id="rj" rows="3" placeholder="哪里需要改（必填）" aria-label="打回意见"></textarea></div>', actions: [{ label: '取消' }, { label: '打回', kind: 'primary', keep: true, act: function (h) { var t = $('#rj', h), v = t.value.trim(); if (!v) { t.parentNode.setAttribute('data-invalid', ''); return t.focus(); } h.cancel(); var pv = App.verdictOf(a); App.setVerdict(a, 'rejected', v); App.render(); pane(); App.toast(a.name + ' 已打回', function () { App.restoreVerdict(a, pv); App.render(); pane(); }); } }] });
    setTimeout(function () { $('#rj', d).focus(); }, 0);
  });
  /* keep the head in step with edits made elsewhere (stage keys, inspector, relations) */
  var r0 = App.render;
  App.render = function () { r0.apply(App, arguments); if (!App.detailOpen) return; var a = cur(); if (!a || D.assets.indexOf(a) < 0) return App.closeDetail(true); syncHead(); };
  window.addEventListener('hashchange', function () {
    var m = /^#asset-(.+)$/.exec(location.hash);
    if (m && m[1] !== App.detailOpen && App.byId(m[1])) { if (trail.length && trail[trail.length - 1].id === m[1]) back(); else App.openDetail(m[1]); }
    else if (!m && App.detailOpen) App.closeDetail();
  });
  setTimeout(function () { var m = /^#asset-(.+)$/.exec(location.hash); if (m && App.byId(m[1])) App.openDetail(m[1]); }, 600);
})();
