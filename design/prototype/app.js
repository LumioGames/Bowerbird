/* Bowerbird prototype — browse page: state, queries, the three layouts, selection, keyboard, navigation.
 * Panels and flows (filter, inspector, menus, upload, quick look, page states) live in flows.js. */
(function () {
  'use strict';
  var B = Bowerbird, I = B.icon, H = B.html, D = BBData, DAY = 86400000;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var el = { app: $('#app'), side: $('#side'), bar: $('#bar'), main: $('#main'), content: $('#content'), filter: $('#filter'), insp: $('#insp'), layer: $('#layer') };
  function emptyCond() { return { stage: [], format: [], tag: [], tagMode: 'all', ntag: [], review: [], issue: false, tris: [null, null], dur: [null, null], width: [null, null], height: [null, null], when: 'all', aux: false, by: '', folder: '', belongs: '', method: '', stale: false, missing: false, human: false }; }
  var S = {
    loc: { type: 'folder', id: 'props/chest' }, hist: [], hi: -1,
    layout: 'grid', size: 168, sort: { key: 'modified', dir: -1 }, cond: emptyCond(), q: '',
    sel: [], anchor: null, focus: null, filterOpen: false, state: 'loading', emptyLib: false,
    open: { props: true }, trash: [], smart: D.smart.slice(), jobs: { busy: 1 }, zoom: 1,
    /* libraries this Bowerbird has registered; which one is open is this browser's own choice (ADR-026) */
    libs: [{ id: 'xingluo', name: '星落镇', root: '~/Art/星落镇' }, { id: 'pixel', name: '像素小队', root: '~/Projects/pixel-squad/assets' }], libId: 'xingluo'
  };
  var KIND = { image: '图片', video: '视频', audio: '音频', model: '模型', doc: '文档', unknown: '其他' };
  var VIEWS = { all: ['inbox', '全部'], untagged: ['tag', '未打标签'], pending: ['clock', '待审'], issues: ['triangle-alert', '有问题'], trash: ['trash-2', '回收站'] };
  var App = window.App = { S: S, D: D, el: el, $: $, $$: $$, KIND: KIND, VIEWS: VIEWS, emptyCond: emptyCond };
  App.lib = function () { return S.libs.filter(function (l) { return l.id === S.libId; })[0] || S.libs[0]; };
  App.libName = function () { return App.lib().name; };

  /* ── queries ── */
  function rng(v, r) { if (r[0] == null && r[1] == null) return true; if (v == null) return false; return (r[0] == null || v >= r[0]) && (r[1] == null || v <= r[1]); }
  function match(a, c, q) {
    if (c.stage.length && c.stage.indexOf(a.stage) < 0) return false;
    if (c.format.length && c.format.indexOf(a.kind) < 0) return false;
    if (c.review.length && c.review.indexOf(a.review) < 0) return false;
    if (c.issue && !a.issue) return false;
    if (c.stale && a.issue !== 'stale') return false;
    if (c.missing && a.state !== 'missing') return false;
    if (c.folder && a.folder !== c.folder.replace(/\/$/, '') && a.folder.indexOf(c.folder.replace(/\/$/, '') + '/') !== 0) return false;
    if (c.belongs && !D.rel(a).belongs.some(function (x) { return x.a && (x.a.name === c.belongs || x.a.name.replace(/\.[^.]+$/, '') === c.belongs || x.a.id === c.belongs); })) return false;
    if (c.method && methodOf(a) !== c.method) return false;
    var all = c.human ? a.tags.slice() : a.tags.concat(a.aiTags || []);
    if (c.tag.length) { var hit = c.tag.filter(function (t) { return all.indexOf(t) >= 0; }).length; if (c.tagMode === 'all' ? hit < c.tag.length : !hit) return false; }
    if (c.ntag.some(function (t) { return all.indexOf(t) >= 0; })) return false;
    if (!rng(a.tris, c.tris) || !rng(a.dur, c.dur) || !rng(a.w, c.width) || !rng(a.h, c.height)) return false;
    var age = D.NOW - a.modified;
    if (c.when === 'today' && age > DAY) return false;
    if (c.when === 'week' && age > 7 * DAY) return false;
    if (c.when === 'month' && age > 30 * DAY) return false;
    if (c.by && a.by.indexOf(c.by) !== 0) return false;
    if (q) { var hay = textOf(a).toLowerCase(); if (q.toLowerCase().split(/\s+/).some(function (w) { return w && hay.indexOf(w) < 0; })) return false; }
    return true;
  }
  /* what the built-in keyword plugin reads: name, tags, description, document text, the prompt of the record that made it (search.md) */
  function promptOf(a) { var r = D.recordFor(a); return r && r.prompt || ''; }
  function textOf(a) { return [a.name, a.tags.concat(a.aiTags || []).join(' '), a.desc || '', a.aiDesc || '', a.title || '', a.excerpt || '', promptOf(a), a.folder].join(' '); }
  /* production method as the query model names it; plugin-defined values keep their plugin prefix */
  var METHOD = { 'AI 生成': 'ai-generate', '手工': 'manual', '导出': 'export', '渲染': 'render', '复制': 'copy', '切图': 'slice' };
  function methodOf(a) { var r = D.recordFor(a); return r ? METHOD[r.method] || r.method : ''; }
  App.methodOf = methodOf; App.METHOD = METHOD;
  /* relevance: a stand-in for the keyword plugin's ranking — name beats tags beats description and prompt */
  function score(a, q) {
    var s = 0; q.toLowerCase().split(/\s+/).forEach(function (w) { if (!w) return; if (a.name.toLowerCase().indexOf(w) >= 0) s += 4; if (a.tags.concat(a.aiTags || []).join(' ').toLowerCase().indexOf(w) >= 0) s += 3; if (((a.desc || '') + (a.title || '')).toLowerCase().indexOf(w) >= 0) s += 2; if ((promptOf(a) + (a.aiDesc || '') + (a.excerpt || '')).toLowerCase().indexOf(w) >= 0) s += 1; });
    return s;
  }
  /* where a query word hit outside the name: a short excerpt with the hit marked (prompt, description, document text) */
  function mark(t, q) { var out = esc0(t); q.split(/\s+/).filter(Boolean).forEach(function (w) { out = out.split(esc0(w)).join('<mark>' + esc0(w) + '</mark>'); }); return out; }
  function esc0(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function hitOf(a, q) {
    var ws = q.toLowerCase().split(/\s+/).filter(Boolean); if (!ws.length || ws.every(function (w) { return a.name.toLowerCase().indexOf(w) >= 0; })) return null;
    var src = [['提示词', promptOf(a)], ['描述', a.desc || ''], ['描述', a.aiDesc || ''], ['正文', a.excerpt || '']].filter(function (x) { return x[1] && ws.some(function (w) { return x[1].toLowerCase().indexOf(w) >= 0; }); })[0]; if (!src) return null;
    var t = src[1], i = t.toLowerCase().indexOf(ws.filter(function (w) { return t.toLowerCase().indexOf(w) >= 0; })[0]), from = Math.max(0, i - 8), cut = (from ? '…' : '') + t.slice(from, from + 34) + (t.length > from + 34 ? '…' : '');
    return { where: src[0], html: mark(cut, q) };
  }
  App.hitOf = hitOf; App.markQ = mark;
  function inLoc(a) {
    var l = S.loc;
    if (l.type === 'folder') return a.folder === l.id || a.folder.indexOf(l.id + '/') === 0;
    if (l.type === 'smart') return match(a, Object.assign(emptyCond(), S.smart[l.id].cond), '');
    return l.id === 'all' || (l.id === 'untagged' && !a.tags.length) || (l.id === 'pending' && a.review === 'pending') || (l.id === 'issues' && !!a.issue);
  }
  function list() {
    var base = S.loc.type === 'view' && S.loc.id === 'trash' ? S.trash : D.assets.filter(inLoc);
    var k = S.sort.key, d = S.sort.dir;
    var q = S.q, val = { relevance: function (a) { return q ? score(a, q) : a.modified; }, created: function (a) { return a.created || a.modified; }, name: function (a) { return a.name; }, modified: function (a) { return a.modified; }, size: function (a) { return a.bytes; }, format: function (a) { return a.name.split('.').pop(); }, stage: function (a) { return ['reference', 'production', 'runtime'].indexOf(a.stage); }, review: function (a) { return a.review; } }[k];
    if (k === 'relevance' && !q) { k = 'modified'; val.relevance = val.modified; }
    return base.filter(function (a) { return match(a, S.cond, S.q); }).sort(function (x, y) { var a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * d || (x.name < y.name ? -1 : 1); });
  }
  function byId(id) { return D.assets.concat(S.trash).filter(function (a) { return a.id === id; })[0]; }
  function byName(n) { return D.assets.filter(function (a) { return a.name === n; })[0]; }
  function condActive() { var c = S.cond; return !!(c.stage.length || c.format.length || c.tag.length || c.ntag.length || c.review.length || c.issue || c.stale || c.missing || c.folder || c.belongs || c.method || c.human || c.when !== 'all' || c.by || [c.tris, c.dur, c.width, c.height].some(function (r) { return r[0] != null || r[1] != null; })); }
  function fmtSize(b) { return b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B'; }
  function fmtTime(t) { var d = Math.floor((D.NOW - t) / DAY); if (d < 1) { var h = Math.floor((D.NOW - t) / 3600000); return h < 1 ? '刚刚' : h + ' 小时前'; } return d < 30 ? d + ' 天前' : Math.floor(d / 30) + ' 个月前'; }
  function locTitle() { var l = S.loc; return l.type === 'folder' ? l.id.split('/') : l.type === 'smart' ? [S.smart[l.id].name] : [VIEWS[l.id][1]]; }
  Object.assign(App, { match: match, list: list, byId: byId, byName: byName, condActive: condActive, fmtSize: fmtSize, fmtTime: fmtTime, locTitle: locTitle });

  /* ── navigation ── */
  function go(loc, keepHist) {
    if (App.detailOpen) App.closeDetail(true);
    if (!keepHist) { S.hist = S.hist.slice(0, S.hi + 1); S.hist.push(loc); S.hi = S.hist.length - 1; }
    S.loc = loc; S.sel = []; S.focus = S.anchor = null; S.cond = emptyCond(); S.editSmart = null; S.q = ''; el.search.value = '';
    if (loc.type === 'folder') S.open[loc.id.split('/')[0]] = true;
    el.main.scrollTop = 0; render(true);
    if (App.routePage) App.routePage(loc);
  }
  App.go = go;

  /* ── side bar ── */
  function attr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function meta(id) { return D.folderMeta[id] || (D.folderMeta[id] = {}); }
  App.meta = meta;
  function renderSide() {
    var s = '<div class="bb-side__lib" data-act="lib" role="button" tabindex="0" title="资产库">' + I('hard-drive') + '<b>' + App.libName() + '</b>' + I('chevron-down', 'bb-icon--12') + '</div><div role="tree">';
    var c = S.emptyLib ? { all: D.assets.length, untagged: 0, pending: D.assets.length, issues: 0, trash: 0 } : D.counts;
    Object.keys(VIEWS).forEach(function (k) { s += H.row({ icon: VIEWS[k][0], label: VIEWS[k][1], count: (k === 'trash' ? c.trash + S.trash.length : k === 'issues' && App.issueAssets && !S.emptyLib ? App.issueAssets() : c[k]).toLocaleString('en-US'), selected: S.loc.type === 'view' && S.loc.id === k }).replace('<div class="bb-row"', '<div class="bb-row" data-loc="view:' + k + '"'); });
    if (!S.emptyLib) {
      s += '<div class="bb-section-label">智能文件夹<button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-act="smart-new" aria-label="把当前条件保存为智能文件夹" title="把当前条件保存为智能文件夹">' + I('plus', 'bb-icon--12') + '</button></div>';
      S.smart.forEach(function (m, i) { s += H.row({ icon: 'folder-search', label: m.name, count: m.count, selected: S.loc.type === 'smart' && S.loc.id === i }).replace('<div class="bb-row"', '<div class="bb-row" data-loc="smart:' + i + '"'); });
      s += '<div class="bb-section-label">文件夹<button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" aria-label="新建文件夹" title="新建文件夹">' + I('plus', 'bb-icon--12') + '</button></div>';
      D.folders.forEach(function (f) {
        var open = !!S.open[f[0]], cur = S.loc.type === 'folder' ? S.loc.id : '', m = meta(f[0]);
        s += H.row({ icon: m.icon || (open ? 'folder-open' : 'folder'), label: f[0], sub: m.label, count: f[2], depth: 0, toggle: f[3].length > 0, expanded: open, selected: cur === f[0] }).replace('<div class="bb-row"', '<div class="bb-row" data-loc="folder:' + f[0] + '"' + (m.note ? ' title="' + attr(m.note) + '"' : ''));
        if (f[3].length && open) f[3].forEach(function (ch) { var id = f[0] + '/' + ch[0], cm = meta(id); s += H.row({ icon: cm.icon || 'folder', label: ch[0], sub: cm.label, count: ch[1], depth: 1, selected: cur === id }).replace('<div class="bb-row"', '<div class="bb-row" data-loc="folder:' + id + '"' + (cm.note ? ' title="' + attr(cm.note) + '"' : '')); });
      });
    }
    el.side.innerHTML = s + '</div>' + (App.dream && !S.emptyLib ? App.dream.side() : '');
  }
  /* the way to settings: a footer under the side bar (⌘,), and the library menu at its top */
  el.side.parentNode.insertAdjacentHTML('beforeend', '<div class="side-foot"><button class="bb-btn bb-btn--ghost side-foot__b" data-foot="settings" title="设置 ⌘,">' + I('settings') + '设置</button><button class="bb-btn bb-btn--ghost bb-btn--icon side-foot__b" data-foot="tags" aria-label="标签" title="标签">' + I('tags') + '</button><button class="bb-btn bb-btn--ghost bb-btn--icon side-foot__b" data-foot="tasks" aria-label="任务" title="任务">' + I('activity') + '</button></div>');
  el.side.parentNode.addEventListener('click', function (e) { var f = e.target.closest('[data-foot]'); if (!f) return; if (f.dataset.foot === 'tags') return App.openPage('tags'); App.openSettings(f.dataset.foot === 'tasks' ? 'tasks' : null); });
  el.side.addEventListener('click', function (e) {
    var lib = e.target.closest('[data-act="lib"]'); if (lib) return App.menu([{ header: App.libName() }, { icon: 'settings', label: '资产库设置…', act: function () { App.openSettings('library'); } }].concat(S.remote ? [] : [{ icon: 'folder-search', label: '在文件夹中显示', act: function () { App.toast('已在文件夹中显示 ' + App.lib().root); } }], ['sep', { icon: 'hard-drive', label: '切换资产库…', act: function () { App.libraryPanel(); } }]), lib);
    if (e.target.closest('[data-act="smart-new"]')) return App.saveSmart && App.saveSmart();
    var r = e.target.closest('[data-loc]'); if (!r) return;
    var p = r.dataset.loc.split(':'), id = p[0] === 'smart' ? +p[1] : p[1];
    if (p[0] === 'folder' && e.target.closest('.bb-row__chev') && r.hasAttribute('data-bb-toggle')) { S.open[id] = !S.open[id]; return renderSide(); }
    go({ type: p[0], id: id });
  });
  /* drag assets onto a folder = move */
  el.side.addEventListener('dragover', function (e) { var r = e.target.closest('[data-loc^="folder:"]'); $$('[data-drop]', el.side).forEach(function (x) { if (x !== r) x.removeAttribute('data-drop'); }); if (r && S.dragging) { e.preventDefault(); r.setAttribute('data-drop', ''); } });
  el.side.addEventListener('dragleave', function (e) { var r = e.target.closest('[data-drop]'); if (r && !r.contains(e.relatedTarget)) r.removeAttribute('data-drop'); });
  el.side.addEventListener('drop', function (e) {
    var r = e.target.closest('[data-loc^="folder:"]'); if (!r || !S.dragging) return; e.preventDefault(); r.removeAttribute('data-drop');
    App.moveAssets(S.sel.slice(), r.dataset.loc.slice(7));
  });

  /* ── tool bar (built once, then kept in sync) ── */
  el.bar.innerHTML =
    '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-act="side" aria-pressed="true" aria-label="左栏" title="左栏 ⌘\\">' + I('panel-left') + '</button>' +
    '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-act="back" aria-label="后退" title="后退">' + I('chevron-left') + '</button><button class="bb-btn bb-btn--ghost bb-btn--icon" data-act="fwd" aria-label="前进" title="前进">' + I('chevron-right') + '</button>' +
    '<div class="bb-crumbs" id="crumbs"></div><span class="bb-toolbar__grow"></span>' +
    '<input class="bb-slider" id="size" type="range" min="96" max="320" value="168" aria-label="缩略图大小" title="缩略图大小">' +
    '<div class="bb-seg" id="layout" role="radiogroup" aria-label="布局"><i class="bb-seg__thumb"></i>' + [['masonry', 'layout-dashboard', '瀑布流'], ['grid', 'layout-grid', '等高网格'], ['list', 'list', '列表']].map(function (it) { return '<button class="bb-seg__item" role="radio" aria-checked="' + (it[0] === 'grid') + '" data-value="' + it[0] + '" aria-label="' + it[2] + '" title="' + it[2] + '">' + I(it[1]) + '</button>'; }).join('') + '</div>' +
    '<button class="bb-select" data-act="sort" id="sort"></button>' +
    '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-act="filter" aria-pressed="false" aria-label="筛选" title="筛选">' + I('list-filter') + '</button>' +
    '<div class="bb-field" id="searchbox">' + I('search') + '<input class="bb-field__input" id="search" placeholder="搜索" aria-label="搜索" autocomplete="off" spellcheck="false">' + H.kbd('⌘ F') + '</div>' +
    '<span class="bb-toolbar__sep"></span>' +
    '<button class="bb-btn" data-act="review" id="reviewbtn" hidden>' + I('badge-check') + '开始校验</button>' +
    '<span id="slotbar"></span>' +
    '<button class="bb-btn bb-btn--primary" data-act="upload" id="newbtn">' + I('upload') + '上传</button>' +
    '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-act="scan" aria-label="重新扫描" title="重新扫描">' + I('refresh-cw') + '</button>' +
    '<button class="bb-btn bb-btn--ghost" data-act="jobs" id="jobs" title="后台处理"></button>' +
    '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-act="insp" aria-pressed="true" aria-label="检查器" title="检查器 ⌘I">' + I('panel-right') + '</button>';
  el.search = $('#search'); el.searchbox = $('#searchbox');
  var SORTS = { relevance: '相关度', name: '名称', modified: '修改时间', created: '创建时间', size: '大小', format: '格式' };
  function chips() {
    var c = S.cond, out = [], add = function (k, v, rm) { out.push({ k: k, v: v, rm: rm }); }, drop = function (arr, v) { return function () { arr.splice(arr.indexOf(v), 1); }; };
    c.stage.forEach(function (v) { add('stage', v, drop(c.stage, v)); }); c.format.forEach(function (v) { add('format', v, drop(c.format, v)); });
    c.tag.forEach(function (v) { add('tag', v, drop(c.tag, v)); }); c.ntag.forEach(function (v) { add('-tag', v, drop(c.ntag, v)); });
    c.review.forEach(function (v) { add('review', v, drop(c.review, v)); });
    if (c.issue) add('is', 'issue', function () { c.issue = false; });
    if (c.stale) add('is', 'stale', function () { c.stale = false; });
    if (c.missing) add('is', 'missing', function () { c.missing = false; });
    if (c.folder) add('folder', c.folder, function () { c.folder = ''; });
    if (c.belongs) add('belongs', c.belongs, function () { c.belongs = ''; });
    if (c.method) add('method', c.method, function () { c.method = ''; });
    [['tris', c.tris], ['dur', c.dur], ['width', c.width], ['height', c.height]].forEach(function (r) { if (r[1][0] != null) add(r[0], '>=' + r[1][0], function () { r[1][0] = null; }); if (r[1][1] != null) add(r[0], '<=' + r[1][1], function () { r[1][1] = null; }); });
    if (c.when !== 'all') add('when', c.when, function () { c.when = 'all'; });
    if (c.by) add('by', c.by, function () { c.by = ''; });
    return out;
  }
  App.chips = chips;
  function syncBar() {
    $('#crumbs').innerHTML = [App.libName()].concat(S.emptyLib ? [] : locTitle()).map(function (t, i, a) { return i === a.length - 1 ? '<b>' + t + '</b>' : '<span>' + t + '</span>' + I('chevron-right', 'bb-icon--12'); }).join('');
    $('[data-act="back"]').disabled = S.hi <= 0; $('[data-act="fwd"]').disabled = S.hi >= S.hist.length - 1;
    $('#sort').title = '排序'; $('#sort').innerHTML = (S.sort.key === 'relevance' && !S.q ? SORTS.modified : SORTS[S.sort.key]) + I(S.sort.dir > 0 ? 'chevron-up' : 'chevron-down', 'bb-icon--12');
    $('[data-act="filter"]').setAttribute('aria-pressed', S.filterOpen);
    $('#reviewbtn').hidden = !(S.loc.type === 'view' && S.loc.id === 'pending') || S.emptyLib;
    $$('.bb-cond', el.searchbox).forEach(function (x) { x.remove(); });
    chips().forEach(function (c, i) { el.search.insertAdjacentHTML('beforebegin', '<span class="bb-cond" data-i="' + i + '"><span class="bb-cond__key">' + c.k + ':</span>' + String(c.v).replace(/</g, '&lt;') + '<button class="bb-cond__x" aria-label="移除条件">' + I('x', 'bb-icon--12') + '</button></span>'); });
    el.search.placeholder = chips().length ? '' : '搜索';
    /* one number: things being processed now, plugin creation jobs included; nothing waits for a render switch (ADR-025) */
    var nJobs = S.jobs.busy + (App.dream ? App.dream.jobs().filter(function (j) { return j.state === 'running'; }).length : 0);
    $('#jobs').innerHTML = '<svg class="bb-icon" viewBox="0 0 16 16" style="transform:rotate(-90deg)"><circle cx="8" cy="8" r="6" stroke="var(--fill-press)" stroke-width="2.5"/>' + (nJobs ? '<circle cx="8" cy="8" r="6" stroke-width="2.5" stroke-dasharray="37.7" stroke-dashoffset="14"/>' : '') + '</svg>' + nJobs;
    $('#jobs').style.fontVariantNumeric = 'tabular-nums';
    var cre = !!(App.dream && App.dream.on()), nb = $('#newbtn');
    if (nb.dataset.mode !== String(cre)) { nb.dataset.mode = String(cre); nb.innerHTML = cre ? I('plus') + '新建' + I('chevron-down', 'bb-icon--12') : I('upload') + '上传'; nb.setAttribute('aria-haspopup', cre ? 'menu' : 'false'); }
    $('#slotbar').innerHTML = App.dream ? App.dream.toolbar() : '';
  }
  App.syncBar = syncBar;
  /* typed conditions: "stage:runtime " becomes a chip; free words stay as the query */
  function parseTyped(final) {
    var words = el.search.value.split(/\s+/), keep = [], c = S.cond, changed = false;
    words.forEach(function (w, i) {
      var m = /^(-?)(stage|format|tag|review|is|tris|dur|width|height|when|by|folder|belongs|method):(.+)$/i.exec(w), last = i === words.length - 1;
      if (!m || (last && !final)) return keep.push(w);
      var neg = m[1], k = m[2].toLowerCase(), v = m[3]; changed = true;
      if (k === 'tag') { var arr = neg ? c.ntag : c.tag; if (arr.indexOf(v) < 0) arr.push(v); }
      else if (k === 'stage' || k === 'format' || k === 'review') { if (c[k].indexOf(v) < 0) c[k].push(v); }
      else if (k === 'is') { if (v === 'stale') c.stale = true; else if (v === 'missing') c.missing = true; else c.issue = true; }
      else if (k === 'when' || k === 'by' || k === 'folder' || k === 'belongs' || k === 'method') c[k] = v;
      else { var n = /^(<=?|>=?)?(\d+(\.\d+)?)$/.exec(v); if (n) { if ((n[1] || '<')[0] === '<') c[k][1] = +n[2]; else c[k][0] = +n[2]; } }
    });
    if (changed) el.search.value = keep.join(' ');
    var had = !!S.q; S.q = el.search.value.trim();
    if (S.q && !had && !S.sortPicked) S.sort = { key: 'relevance', dir: -1 };
    if (!S.q && S.sort.key === 'relevance') { S.sort = { key: 'modified', dir: -1 }; S.sortPicked = false; }
    return changed;
  }
  el.search.addEventListener('input', function () { parseTyped(false); render(false, true); });
  el.search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { parseTyped(true); render(false, true); }
    if (e.key === 'Backspace' && !el.search.value) { var cs = chips(); if (cs.length) { cs[cs.length - 1].rm(); render(false, true); } }
    if (e.key === 'Escape') el.search.blur();
  });
  var SK = [['stage', '物料阶段'], ['format', '格式'], ['tag', '包含标签'], ['-tag', '排除标签'], ['folder', '文件夹'], ['review', '校验状态'], ['is', '问题'], ['tris', '面数'], ['width', '宽度'], ['height', '高度'], ['dur', '时长（秒）'], ['when', '修改时间'], ['by', '执行者'], ['belongs', '归属于设计对象'], ['method', '生产方式']];
  function skValues(k) {
    var L2 = H.labels, uniq = function (arr) { return arr.filter(function (x, i) { return x && arr.indexOf(x) === i; }); };
    if (k === 'stage') return [['reference', '参考'], ['production', '生产'], ['runtime', '运行时']];
    if (k === 'format') return Object.keys(KIND).map(function (x) { return [x, KIND[x]]; });
    if (k === 'review') return [['pending', '待审'], ['approved', '已通过'], ['rejected', '已打回'], ['exempt', '免审']];
    if (k === 'is') return [['issue', '有问题'], ['stale', '上游已更新'], ['missing', '文件缺失']];
    if (k === 'when') return [['today', '今天'], ['week', '本周'], ['month', '本月']];
    if (k === 'tag' || k === '-tag') return uniq([].concat.apply([], D.assets.map(function (a) { return a.tags; }))).sort().map(function (t) { return [t, '']; });
    if (k === 'folder') return [].concat.apply([], D.folders.map(function (f) { return [[f[0] + '/', f[1]]].concat(f[3].map(function (c) { return [f[0] + '/' + c[0] + '/', '']; })); }));
    if (k === 'by') return [['agent', '所有 Agent'], ['user', '所有人']].concat(uniq(D.assets.map(function (a) { return a.by; })).sort().map(function (b) { return [b, '']; }));
    if (k === 'belongs') return D.assets.filter(function (a) { return App.isDesignObject && App.isDesignObject(a); }).map(function (a) { return [a.name.replace(/\.[^.]+$/, ''), a.title || '']; });
    if (k === 'method') return [['ai-generate', 'AI 生成'], ['manual', '手工'], ['export', '导出'], ['render', '渲染'], ['copy', '复制'], ['slice', '切图']];
    if (k === 'tris') return [['<5000', '少于 5,000 面'], ['>=10000', '至少 10,000 面']];
    if (k === 'width' || k === 'height') return [['>=1024', '至少 1024 px'], ['<=256', '不超过 256 px']];
    if (k === 'dur') return [['<5', '短于 5 秒'], ['>=60', '至少 1 分钟']];
    return [];
  }
  var AC = { box: null, items: [], i: 0 };
  function acClose() { if (AC.box) AC.box.remove(); AC.box = null; AC.items = []; }
  function acWord() { var v = el.search.value, end = el.search.selectionEnd == null ? v.length : el.search.selectionEnd, start = v.lastIndexOf(' ', end - 1) + 1; return { w: v.slice(start, end), start: start, end: end }; }
  function acOpen() {
    var t = acWord(), w = t.w, m = /^(-?[a-z]+):(.*)$/i.exec(w), items;
    if (m) { var key = m[1].toLowerCase(), part = m[2].toLowerCase(); items = skValues(key).filter(function (x) { return !part || x[0].toLowerCase().indexOf(part) === 0 || (x[1] && x[1].indexOf(m[2]) >= 0); }).slice(0, 8).map(function (x) { return { ins: key + ':' + x[0], k: x[0], d: x[1], done: !/\/$/.test(x[0]) }; }); }
    else if (w) { var lw = w.toLowerCase(); items = SK.filter(function (x) { return x[0].indexOf(lw) === 0 || x[1].indexOf(w) >= 0; }).slice(0, 8).map(function (x) { return { ins: x[0] + ':', k: x[0] + ':', d: x[1] }; }); }
    else items = [];
    if (!items.length || (items.length === 1 && items[0].ins === w)) return acClose();
    AC.items = items; AC.i = 0;
    if (!AC.box) { AC.box = document.createElement('div'); AC.box.className = 'sac'; AC.box.setAttribute('role', 'listbox'); el.layer.appendChild(AC.box); }
    var r = el.searchbox.getBoundingClientRect(); AC.box.style.left = r.left + 'px'; AC.box.style.top = r.bottom + 4 + 'px'; AC.box.style.minWidth = r.width + 'px';
    acDraw();
  }
  function acDraw() { AC.box.innerHTML = AC.items.map(function (x, i) { return '<div class="sac__it" role="option" data-ac="' + i + '" aria-selected="' + (i === AC.i) + '"><span class="text-mono-sm">' + x.k.replace(/</g, '&lt;') + '</span><span>' + x.d + '</span></div>'; }).join('') + '<div class="sac__hint">↑↓ 选择 · Tab 或 ↵ 填入</div>'; }
  function acTake(i) {
    var x = AC.items[i], t = acWord(), v = el.search.value; if (!x) return;
    el.search.value = v.slice(0, t.start) + x.ins + (x.done ? ' ' : '') + v.slice(t.end);
    var at = t.start + x.ins.length + (x.done ? 1 : 0); el.search.setSelectionRange(at, at); el.search.focus();
    if (x.done) { acClose(); parseTyped(true); render(false, true); } else acOpen();
  }
  el.search.addEventListener('keydown', function (e) {
    if (!AC.box) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); AC.i = (AC.i + (e.key === 'ArrowDown' ? 1 : AC.items.length - 1)) % AC.items.length; return acDraw(); }
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); return acTake(AC.i); }
    if (e.key === 'Escape') { e.stopImmediatePropagation(); return acClose(); }
  }, true);
  el.search.addEventListener('input', acOpen);
  el.search.addEventListener('blur', function () { setTimeout(acClose, 120); });
  el.layer.addEventListener('mousedown', function (e) { var it = e.target.closest('[data-ac]'); if (!it) return; e.preventDefault(); acTake(+it.dataset.ac); });
  el.searchbox.addEventListener('click', function (e) { var x = e.target.closest('.bb-cond__x'); if (x) { chips()[+x.parentElement.dataset.i].rm(); render(false, true); } else el.search.focus(); });
  el.bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var act = b.dataset.act;
    if (act === 'side' || act === 'insp') return togglePanel(act);
    if (act === 'back' && S.hi > 0) return go(S.hist[--S.hi], true);
    if (act === 'fwd' && S.hi < S.hist.length - 1) return go(S.hist[++S.hi], true);
    if (act === 'filter') { S.filterOpen = !S.filterOpen; return render(false, true); }
    if (act === 'sort') return App.menu(Object.keys(SORTS).map(function (k) { return { label: SORTS[k], disabled: k === 'relevance' && !S.q, hint: k === 'relevance' && !S.q ? '有查询词时' : '', check: S.sort.key === k && (k !== 'relevance' || !!S.q), act: function () { S.sortPicked = true; S.sort = { key: k, dir: S.sort.key === k && k !== 'relevance' ? -S.sort.dir : (k === 'name' || k === 'format' ? 1 : -1) }; render(); } }; }), b);
    /* with a creation plugin the button becomes 新建: 上传文件… first, then the ways plugins register (ADR-016) */
    if (act === 'upload') return App.dream && App.dream.on() ? App.dream.newMenu(b) : App.upload();
    if (act === 'scan') { S.state = 'loading'; render(); return setTimeout(function () { S.state = 'ready'; render(true); App.toast('扫描完成，没有发现变化'); }, 900); }
    if (act === 'jobs') return App.jobsPop(b);
    if (act === 'review') return App.startReview();
  });
  function togglePanel(which) {
    var closed = el.app.getAttribute('data-' + which) === 'closed';
    if (closed) el.app.removeAttribute('data-' + which); else el.app.setAttribute('data-' + which, 'closed');
    $$('[data-act="' + which + '"], [data-d="' + which + '"]').forEach(function (b) { b.setAttribute('aria-pressed', closed); });
  }
  App.togglePanel = togglePanel;

  /* ── content: grid · masonry · list ── */
  function cellHtml(a, arrive) {
    var m = S.layout === 'masonry';
    if (S.q) { var h = H.cell(Object.assign({}, a, { fit: m ? 'slice' : 'meet' }), { selected: S.sel.indexOf(a.id) >= 0, arrive: arrive }), hit = hitOf(a, S.q); h = h.replace('>' + esc0(a.name) + '</div></div>', '>' + mark(a.name, S.q) + '</div>' + (hit ? '<div class="bb-cell__hit"><span>' + hit.where + '</span>' + hit.html + '</div>' : '') + '</div>'); return h.replace('<div class="bb-cell"', '<div class="bb-cell" draggable="true"' + (m ? ' style="--ar:' + (a.ar || 1) + '"' : '')); }
    return H.cell(Object.assign({}, a, { fit: m ? 'slice' : 'meet' }), { selected: S.sel.indexOf(a.id) >= 0, arrive: arrive }).replace('<div class="bb-cell"', '<div class="bb-cell" draggable="true"' + (a.bundle ? ' data-bundle' : '') + (m ? ' style="--ar:' + (a.ar || 1) + '"' : ''));
  }
  App.cellHtml = cellHtml;
  var COLS = [['name', '名称', ''], ['format', '格式', '64px'], ['stage', '阶段', '84px'], ['review', '校验', '96px'], ['', '标签', '18%'], ['size', '大小', '76px'], ['modified', '修改时间', '88px'], ['', '技术信息', '88px']];
  function rowHtml(a) {
    var thumb = a.state === 'unknown' || a.state === 'waiting' || a.state === 'failed' || a.state === 'processing' || !a.art ? I(H.labels.KIND_ICON[a.kind]) : D2.art(a.art, a);
    var tags = a.tags.slice(0, 2).map(function (t) { return H.tag(t); }).join(' ') + (a.tags.length > 2 ? '<span class="more">+' + (a.tags.length - 2) + '</span>' : '');
    return '<tr data-id="' + a.id + '" data-state="' + (a.state || 'ready') + '" draggable="true" aria-selected="' + (S.sel.indexOf(a.id) >= 0) + '"><td><div class="nm"><span class="bb-row__thumb' + (a.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + thumb + '</span><span>' + a.name + '</span></div></td><td>' + a.name.split('.').pop().toUpperCase() + '</td><td>' + H.stage(a.stage, 'short') + '</td><td><span class="st">' + H.review(a.review, true) + (a.issue ? H.issue(a.issue) : '') + '</span></td><td>' + tags + '</td><td>' + fmtSize(a.bytes) + '</td><td>' + fmtTime(a.modified) + '</td><td>' + (a.info || '') + '</td></tr>';
  }
  var D2 = B.demo;
  function renderContent(arrive) {
    var L = S._list = list(), c = el.content, E = App.empty;
    el.app.toggleAttribute('data-dim', S.state === 'offline');
    if (S.state === 'offline') return (c.innerHTML = E('offline'));
    if (S.state === 'loading') { var sk = ''; for (var i = 0; i < 18; i++) sk += '<div class="bb-cell sk"><div class="bb-cell__thumb"></div><div class="bb-cell__name"></div></div>'; return (c.innerHTML = '<div class="bb-grid" style="--bb-cell:' + S.size + 'px">' + sk + '</div>'); }
    if (S.emptyLib && !D.assets.length) return (c.innerHTML = E('library'));
    if (!L.length) return (c.innerHTML = E(condActive() || S.q ? 'search' : S.loc.id === 'trash' ? 'trash' : 'folder'));
    if (S.layout === 'list') {
      c.innerHTML = '<table class="lt" role="grid"><colgroup>' + COLS.map(function (x) { return '<col' + (x[2] ? ' style="width:' + x[2] + '"' : '') + '>'; }).join('') + '</colgroup><thead><tr>' + COLS.map(function (x) { return '<th' + (x[0] ? ' data-sort="' + x[0] + '"' : '') + '>' + x[1] + (S.sort.key === x[0] && x[0] ? I(S.sort.dir > 0 ? 'chevron-up' : 'chevron-down', 'bb-icon--12') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' + L.map(rowHtml).join('') + '</tbody></table>';
    } else {
      c.innerHTML = (S.incoming && S.incoming.length ? '<button class="newpill" data-incoming>' + I('arrow-up', 'bb-icon--12') + '有 ' + S.incoming.length + ' 个新资产 · 显示</button>' : '') + '<div class="' + (S.layout === 'masonry' ? 'masonry' : 'bb-grid') + '" role="listbox" aria-multiselectable="true" style="--bb-cell:' + S.size + 'px">' + L.map(function (a) { return cellHtml(a, arrive); }).join('') + '</div>';
      if (arrive) $$('.bb-arrive > *:first-child', c).forEach(function (x, n) { x.style.animationDelay = Math.min(n, 24) * 30 + 'ms'; });
      lazyRender(c);
    }
  }
  /* ADR-025: a model with no picture yet shows a placeholder; once its cell is on screen this browser renders it and the picture replaces it */
  var IO = null;
  function lazyRender(c) {
    if (!window.IntersectionObserver || !App.m3 || !App.m3.snap) return;
    if (IO) IO.disconnect();
    IO = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return; IO.unobserve(en.target);
        var a = App.byId(en.target.dataset.id); if (!a || a.state !== 'waiting' || a._rendering) return; a._rendering = true;
        var ph = en.target.querySelector('.bb-cell__ph span'); if (ph) ph.textContent = '正在生成缩略图';
        setTimeout(function () { var url = App.m3.snap(a); a._rendering = false; if (!url) return; a.snap = url; a.art = 'snap'; a.state = 'ready'; App.refresh(a, true); if (S.sel.indexOf(a.id) >= 0 && App.renderInsp) App.renderInsp(); }, 700);
      });
    }, { root: c, rootMargin: '0px 0px 120px 0px' });
    $$('.bb-cell[data-state="waiting"][data-kind="model"]', c).forEach(function (x) { IO.observe(x); });
  }
  App.lazyRender = function () { lazyRender(el.content); };
  /* ADR-022: rest on a model cell ~0.5 s and it turns live; leaving stops it */
  var spinT = 0, spinOn = null, spinWait = null;
  function spinStop() { clearTimeout(spinT); spinT = 0; spinWait = null; if (spinOn && App.m3) App.m3.stopSpin(); spinOn = null; }
  el.content.addEventListener('pointerover', function (e) {
    var cell = e.target.closest('.bb-cell[data-kind="model"]');
    if (!cell || (cell.dataset.state !== 'ready' && cell.dataset.state)) return;
    if (spinOn === cell || spinWait === cell) return; spinStop();
    var th = cell.querySelector('.bb-cell__thumb'); if (!th || !App.m3 || !App.m3.spin) return;
    spinT = setTimeout(function () { var a = App.byId(cell.dataset.id); if (!a || !document.contains(th)) return; spinOn = cell; App.m3.spin(a, th); }, 500); spinWait = cell;
  });
  el.content.addEventListener('pointerout', function (e) { var cell = e.target.closest('.bb-cell'); if (cell && !cell.contains(e.relatedTarget)) spinStop(); });
  el.content.addEventListener('scroll', spinStop, { passive: true });
  function render(arrive, keepFocus) {
    renderSide(); syncBar(); if (App.renderFilter) App.renderFilter(keepFocus); renderContent(arrive); if (App.renderInsp) App.renderInsp();
  }
  Object.assign(App, { render: render, renderContent: renderContent, renderSide: renderSide });
  function syncSel() {
    $$('[data-id]', el.content).forEach(function (x) { x.setAttribute('aria-selected', S.sel.indexOf(x.dataset.id) >= 0); });
    if (App.renderInsp) App.renderInsp();
  }
  App.syncSel = syncSel;
  /* replace one cell or row in place — used while files upload and thumbnails arrive */
  App.refresh = function (a, arrive) {
    var x = $('[data-id="' + a.id + '"]', el.content); if (!x) return;
    if (spinOn === x) spinStop();
    if (S.layout === 'list') x.outerHTML = rowHtml(a); else x.outerHTML = cellHtml(a, arrive);
    if (a.state === 'waiting') lazyRender(el.content);
  };

  /* ── selection ── */
  function ids() { return (S._list || []).map(function (a) { return a.id; }); }
  function select(id, mode) {
    var all = ids();
    if (mode === 'toggle') { var i = S.sel.indexOf(id); if (i >= 0) S.sel.splice(i, 1); else S.sel.push(id); S.anchor = id; }
    else if (mode === 'range' && S.anchor) { var a = all.indexOf(S.anchor), b = all.indexOf(id); S.sel = all.slice(Math.min(a, b), Math.max(a, b) + 1); }
    else { S.sel = [id]; S.anchor = id; }
    S.focus = id; syncSel();
  }
  App.select = select;
  el.content.addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]'); if (th) { var k = th.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; return render(); }
    var act = e.target.closest('[data-do]'); if (act) return App.act(act.dataset.do);
    var c = e.target.closest('[data-id]');
    if (!c) { if (!S._marq) { S.sel = []; syncSel(); } return; }
    select(c.dataset.id, e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'one');
  });
  el.content.addEventListener('dblclick', function (e) { var c = e.target.closest('[data-id]'); if (c) App.openDetail(c.dataset.id); });
  el.content.addEventListener('contextmenu', function (e) {
    var c = e.target.closest('[data-id]'); if (!c) return; e.preventDefault();
    if (S.sel.indexOf(c.dataset.id) < 0) select(c.dataset.id, 'one');
    App.assetMenu(e);
  });
  el.content.addEventListener('dragstart', function (e) {
    var c = e.target.closest('[data-id]'); if (!c) return;
    if (S.sel.indexOf(c.dataset.id) < 0) select(c.dataset.id, 'one');
    S.dragging = true; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', S.sel.join(','));
  });
  document.addEventListener('dragend', function () { S.dragging = false; $$('[data-drop]').forEach(function (x) { x.removeAttribute('data-drop'); }); });
  /* marquee: drag on empty space */
  el.main.addEventListener('pointerdown', function (e) {
    if (e.button || e.target.closest('[data-id], .fp, button, input, .bb-empty, th')) return;
    var r0 = el.main.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, box = null, base = e.metaKey || e.ctrlKey || e.shiftKey ? S.sel.slice() : [];
    function move(ev) {
      if (!box && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
      if (!box) { box = document.createElement('div'); box.className = 'marquee'; box.style.position = 'absolute'; el.main.appendChild(box); S._marq = true; }
      var l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY), w = Math.abs(ev.clientX - x0), h = Math.abs(ev.clientY - y0), z = S.zoom;
      box.style.cssText = 'position:absolute;left:' + (l - r0.left) / z + 'px;top:' + ((t - r0.top) / z + el.main.scrollTop) + 'px;width:' + w / z + 'px;height:' + h / z + 'px';
      S.sel = base.slice();
      $$('[data-id]', el.content).forEach(function (c) { var r = c.getBoundingClientRect(); if (r.left < l + w && r.right > l && r.top < t + h && r.bottom > t && S.sel.indexOf(c.dataset.id) < 0) S.sel.push(c.dataset.id); });
      $$('[data-id]', el.content).forEach(function (x) { x.setAttribute('aria-selected', S.sel.indexOf(x.dataset.id) >= 0); });
    }
    function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (box) { box.remove(); syncSel(); setTimeout(function () { S._marq = false; }, 0); } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });

  /* ── keyboard ── */
  function moveFocus(dir) {
    var items = $$('[data-id]', el.content); if (!items.length) return;
    var cur = $('[data-id="' + S.focus + '"]', el.content), next;
    if (!cur) next = items[0];
    else if (dir === 'left' || dir === 'right') next = items[items.indexOf(cur) + (dir === 'right' ? 1 : -1)];
    else {
      var r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, best = Infinity;
      items.forEach(function (it) { var q = it.getBoundingClientRect(), dy = dir === 'down' ? q.top - r.bottom : r.top - q.bottom; if (dy < -4) return; var sc = Math.abs(q.left + q.width / 2 - cx) * 2 + dy; if (it !== cur && sc < best) { best = sc; next = it; } });
    }
    if (next) { select(next.dataset.id, 'one'); next.scrollIntoView({ block: 'nearest' }); }
  }
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName), mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); return el.search.focus(); }
    if (mod && e.key === '\\') { e.preventDefault(); return togglePanel('side'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); return togglePanel('insp'); }
    if (e.key === 'Escape') { if (App.closeTop && App.closeTop()) return; if (!typing && S.sel.length) { S.sel = []; syncSel(); } return; }
    if (typing || App.modal) return;
    /* ⌘Z / Ctrl+Z: undo, this session only */
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); return App.undoLast(); }
    if (App.cmpOpen) { if (App.cmpKey) App.cmpKey(e); return; }
    if (mod && e.key === ',') { e.preventDefault(); return App.openSettings && App.openSettings(); }
    if (App.pageOn) { if (App.pageKey) App.pageKey(e); return; }
    if (App.detailOpen && App.detailKey(e)) return;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = ids(); return syncSel(); }
    /* ⌘D / Ctrl+D: copy the selected asset (the same action as 复制 in its menu) */
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'd' && S.sel.length === 1) { e.preventDefault(); return App.act('copy'); }
    /* local actions only make sense on the computer running Bowerbird (ADR-023) */
    if (mod && !e.altKey && e.key.toLowerCase() === 'o' && S.sel.length === 1 && !S.remote) { e.preventDefault(); return App.toast('已用默认程序打开 ' + byId(S.sel[0]).name); }
    if (mod && e.altKey && (e.key.toLowerCase() === 'r' || e.code === 'KeyR') && S.sel.length && !S.remote) { e.preventDefault(); return App.toast('已在文件夹中显示 ' + (S.sel.length > 1 ? S.sel.length + ' 个文件' : byId(S.sel[0]).name)); }
    var arrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (arrows[e.key]) { e.preventDefault(); if (App.qlOpen) return App.qlStep(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1); return moveFocus(arrows[e.key]); }
    if (e.key === ' ') { e.preventDefault(); if (App.qlOpen) return App.qlClose(); if (S.focus) App.quickLook(S.focus); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (App.qlOpen) return App.openDetail(App.qlOpen); if (S.sel.length) App.openDetail(S.focus || S.sel[0]); return; }
    if (!S.sel.length) return;
    /* single keys: only Space (quick look) and Delete (asks first); everything else needs ⌘ / Ctrl or the mouse */
    if (e.key === 'Delete' || e.key === 'Backspace') return App.act('trash');
  });

  /* ── tool bar controls, window fit, boot ── */
  B.slider($('#size'), function (v) { S.size = v; var g = el.content.firstElementChild; if (g) g.style.setProperty('--bb-cell', v + 'px'); });
  $('#layout').setAttribute('data-wired', '');
  B.segmented($('#layout'), function (v) { S.layout = v; renderContent(); });
  /* panels resize 1:1 with the pointer and rubber-band past their limits */
  var W = { side: 232, insp: 320 }, LIM = { side: [180, 360], insp: [280, 480] };
  $$('.bb-resizer').forEach(function (r) {
    var edge = r.dataset.edge, start = 0, base = 0, on = false;
    r.addEventListener('pointerdown', function (e) { r.setPointerCapture(e.pointerId); on = true; start = e.clientX; base = W[edge]; el.app.setAttribute('data-resizing', ''); r.setAttribute('data-active', ''); });
    r.addEventListener('pointermove', function (e) {
      if (!on) return; var w = base + (edge === 'side' ? 1 : -1) * (e.clientX - start) / S.zoom, lo = LIM[edge][0], hi = LIM[edge][1];
      if (w < lo) w = lo + B.rubberband(w - lo, 240); else if (w > hi) w = hi + B.rubberband(w - hi, 240);
      W[edge] = w; el.app.style.setProperty('--bb-' + edge + '-w', w + 'px');
    });
    function up() { if (!on) return; on = false; r.removeAttribute('data-active'); el.app.removeAttribute('data-resizing'); W[edge] = Math.round(Math.min(LIM[edge][1], Math.max(LIM[edge][0], W[edge]))); el.app.style.setProperty('--bb-' + edge + '-w', W[edge] + 'px'); }
    r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up);
  });
  function fit() { var z = Math.min(1, window.innerWidth / 1280); S.zoom = z; el.app.style.zoom = z; el.app.style.width = window.innerWidth / z + 'px'; el.app.style.height = window.innerHeight / z + 'px'; }
  window.addEventListener('resize', fit); fit();
  App.boot = function () { S.hist = [S.loc]; S.hi = 0; render(); setTimeout(function () { S.state = 'ready'; render(true); }, 450); };
})();
