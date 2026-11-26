/* Bowerbird prototype — relations: the lineage graph, the relation dialog, "upstream updated", the design-object overview.
 * The graph reads left to right in production order. The whole upstream chain is traced to its origin; downstream opens
 * two levels and grows on demand. A version timeline replays the graph as it was at any version of the asset. */
(function () {
  'use strict';
  var App = window.App, B = Bowerbird, I = B.icon, H = B.html, D = App.D, S = App.S, el = App.el, $ = App.$, $$ = App.$$, DEMO = B.demo, L = H.labels;
  var INF = 8.64e15, GAP = 84, VG = 18, MINI = 76, CARRY = null;
  var SZ = { asset: [144, 150], center: [188, 194], rec: [168, 60], group: [144, 150] };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function thumbOf(a) {
    if (a.kind === 'doc') return '<div class="bb-cell__doc"><b>' + esc(a.title || a.name) + '</b><p>' + esc(a.excerpt || '') + '</p></div>';
    return a.art && !/unknown|waiting|failed|processing/.test(a.state || '') ? DEMO.art(a.art, Object.assign({}, a, { fit: 'meet' })) : '<div class="bb-cell__ph">' + I(L.KIND_ICON[a.kind], 'bb-icon--20') + '</div>';
  }
  function live(id) { var a = D.byId(id); return a && D.assets.indexOf(a) >= 0 ? a : null; }

  /* ── build: which nodes and edges show for one centre, at time T ── */
  function build(center, T, opt) {
    var nodes = {}, order = [], edges = [], seenE = {};
    function vis(a) { return a && D.verAt(a, T); }
    function add(n) { if (nodes[n.key]) return nodes[n.key]; nodes[n.key] = n; order.push(n.key); return n; }
    function link(o) { var k = (o.e ? o.e.id : o.from + '>' + o.to) + (o.type || ''); if (seenE[k]) return; seenE[k] = 1; edges.push(o); }
    add({ key: center.id, a: center, col: 0, lane: 'main', center: true });
    /* upstream: every source, all the way to the origin; a node reached by several paths sits left of all of them */
    (function up(a, d, guard) {
      if (guard > 40) return;
      D.EDGES.forEach(function (e) {
        if (e.type !== 'source' || e.from !== a.id) return;
        var t = e.to ? live(e.to) : null;
        if (!t) { var mk = add({ key: 'miss:' + e.id, missing: true, name: e.toName, col: -(d + 1), lane: 'main' }); link({ from: mk.key, to: a.id, type: 'source', e: e, broken: true }); return; }
        if (!vis(t)) return;
        var n = add({ key: t.id, a: t, col: -(d + 1), lane: 'main' }); n.col = Math.min(n.col, -(d + 1)); n.sub = n.sub || D.noteOf(e);
        link({ from: t.id, to: a.id, type: 'source', e: e });
        up(t, d + 1, guard + 1);
      });
      if (a.origin && D.RECS[a.origin]) { var rk = add({ key: 'rec:' + a.origin, rec: D.RECS[a.origin], col: -(d + 1), lane: 'main' }); link({ from: rk.key, to: a.id, type: 'source', recNode: D.RECS[a.origin] }); }
    })(center, 0, 0);
    /* downstream: grows on demand; siblings made by one production record fold into a group */
    (function down(a, d) {
      var kids = D.EDGES.filter(function (e) { return e.type === 'source' && e.to === a.id; }).map(function (e) { return { e: e, a: live(e.from) }; }).filter(function (k) { return vis(k.a) && !nodes[k.a.id]; });
      if (!kids.length) return;
      if (d >= opt.down) { if (nodes[a.id]) nodes[a.id].more = kids.length; return; }
      var byRec = {}; kids.forEach(function (k) { var r = k.e.rec || '_' + k.e.id; (byRec[r] = byRec[r] || []).push(k); });
      Object.keys(byRec).forEach(function (r) {
        var ks = byRec[r], gk = 'g:' + a.id + ':' + r;
        if (ks.length > 4) {
          var exp = !!opt.open[gk], g = add({ key: gk, gkey: gk, items: ks.map(function (k) { return k.a; }), rec: D.RECS[r], col: d + 1, lane: 'main', frame: exp, group: !exp });
          link({ from: a.id, to: g.key, type: 'source', group: true, rec: D.RECS[r], items: g.items });
          return;
        }
        ks.forEach(function (k) { var n = add({ key: k.a.id, a: k.a, col: d + 1, lane: 'main', sub: D.noteOf(k.e) }); link({ from: a.id, to: n.key, type: 'source', e: k.e }); down(k.a, d + 1); });
      });
    })(center, 0);
    /* around the centre only: what it uses (left, below), what uses it (right, below), its design object (above) */
    D.EDGES.forEach(function (e) {
      if (e.from === center.id && e.type === 'uses') { var t = e.to ? live(e.to) : null; if (t && !vis(t)) return; var n = t ? (nodes[t.id] || add({ key: t.id, a: t, col: -1, lane: 'uses', sub: e.note })) : add({ key: 'miss:' + e.id, missing: true, name: e.toName, col: -1, lane: 'uses' }); link({ from: n.key, to: center.id, type: 'uses', e: e, broken: !t }); }
      if (e.to === center.id && e.type === 'uses') { var f = live(e.from); if (!vis(f)) return; var m = nodes[f.id] || add({ key: f.id, a: f, col: 1, lane: 'uses', sub: e.note }); link({ from: center.id, to: m.key, type: 'uses', e: e }); }
      if (e.from === center.id && e.type === 'belongs') { var o = live(e.to); if (!vis(o)) return; var b = nodes[o.id] || add({ key: o.id, a: o, col: 0, lane: 'top', sub: '设计对象' }); link({ from: center.id, to: b.key, type: 'belongs', e: e, vertical: true }); }
    });
    var members = D.EDGES.filter(function (e) { return e.type === 'belongs' && e.to === center.id; }).map(function (e) { return { e: e, a: live(e.from) }; }).filter(function (m) { return vis(m.a) && !nodes[m.a.id]; });
    if (members.length > 6) { var mk2 = 'm:' + center.id, ex = !!opt.open[mk2], mg = add({ key: mk2, gkey: mk2, items: members.map(function (m) { return m.a; }), members: true, col: 1, lane: 'uses', frame: ex, group: !ex }); link({ from: center.id, to: mg.key, type: 'belongs', group: true, items: mg.items }); }
    else members.forEach(function (m) { var n = add({ key: m.a.id, a: m.a, col: 1, lane: 'uses', sub: '归属' }); link({ from: center.id, to: n.key, type: 'belongs', e: m.e }); });
    return { nodes: nodes, order: order, edges: edges };
  }

  /* ── layout: columns left to right, the spine of the lineage on one line ── */
  function layout(G, center) {
    var N = G.nodes, spine = {}, cur = center.id;
    spine[cur] = 1;
    for (var i = 0; i < 40; i++) { var e = G.edges.filter(function (x) { return x.type === 'source' && x.to === cur && N[x.from] && N[x.from].lane === 'main'; })[0]; if (!e) break; cur = e.from; spine[cur] = 1; }
    cur = center.id;
    for (i = 0; i < 40; i++) { var e2 = G.edges.filter(function (x) { return x.type === 'source' && x.from === cur && N[x.to] && N[x.to].lane === 'main'; })[0]; if (!e2) break; cur = e2.to; spine[cur] = 1; }
    var cols = {};
    G.order.forEach(function (k) {
      var n = N[k], s = n.center ? SZ.center : n.rec ? SZ.rec : SZ.asset;
      if (n.frame) { var rows = Math.ceil(n.items.length / 3); s = [3 * MINI + 2 * 8 + 20, 40 + rows * (MINI * 0.74 + 24) - 6 + 10]; }
      n.w = s[0]; n.h = s[1]; n.spine = !!spine[k];
      (cols[n.col] = cols[n.col] || []).push(n);
    });
    var keys = Object.keys(cols).map(Number).sort(function (a, b) { return a - b; }), cw = {};
    keys.forEach(function (c) { cw[c] = Math.max.apply(null, cols[c].filter(function (n) { return n.lane !== 'top'; }).map(function (n) { return n.w; }).concat([0])); });
    var cx = { 0: 0 };
    for (var c = 1; c <= keys[keys.length - 1]; c++) cx[c] = cx[c - 1] + (cw[c - 1] || 0) / 2 + GAP + (cw[c] || SZ.asset[0]) / 2;
    for (c = -1; c >= keys[0]; c--) cx[c] = cx[c + 1] - (cw[c + 1] || 0) / 2 - GAP - (cw[c] || SZ.asset[0]) / 2;
    keys.forEach(function (c) {
      var list = cols[c].filter(function (n) { return n.lane !== 'top'; });
      list.sort(function (a, b) { return (b.spine - a.spine) || ((a.lane === 'uses') - (b.lane === 'uses')) || ((b.a && b.a.issue ? 1 : 0) - (a.a && a.a.issue ? 1 : 0)); });
      var y = null, lastLane = null;
      list.forEach(function (n) {
        if (y === null) { n.y = n.spine ? 0 : 0; y = n.y + n.h / 2; }
        else { y += VG + (lastLane !== n.lane ? 22 : 0); n.y = y + n.h / 2; y = n.y + n.h / 2; }
        n.x = cx[c]; lastLane = n.lane;
      });
      cols[c].filter(function (n) { return n.lane === 'top'; }).forEach(function (n) { n.x = cx[c]; n.y = -(N[center.id].h / 2 + 64 + n.h / 2); });
    });
    /* fan the ends of several edges on one side of a node, ordered by where they come from */
    var ins = {}, outs = {};
    G.edges.forEach(function (e) { if (e.vertical) return; (outs[e.from] = outs[e.from] || []).push(e); (ins[e.to] = ins[e.to] || []).push(e); });
    function fan(map, key, side) {
      Object.keys(map).forEach(function (k) {
        var n = N[k], list = map[k].sort(function (a, b) { return N[a[side]].y - N[b[side]].y; }), m = list.length, step = Math.min(14, n.h * 0.5 / Math.max(1, m - 1));
        list.forEach(function (e, i) { e[key] = n.y + (i - (m - 1) / 2) * step; });
      });
    }
    fan(outs, 'y1', 'to'); fan(ins, 'y2', 'from');
    G.edges.forEach(function (e) {
      var f = N[e.from], t = N[e.to];
      if (e.vertical) { e.d = 'M' + f.x + ' ' + (f.y - f.h / 2) + ' C' + f.x + ' ' + (f.y - f.h / 2 - 36) + ' ' + t.x + ' ' + (t.y + t.h / 2 + 36) + ' ' + t.x + ' ' + (t.y + t.h / 2); e.mx = (f.x + t.x) / 2; e.my = (f.y - f.h / 2 + t.y + t.h / 2) / 2; return; }
      var x1 = f.x + f.w / 2, x2 = t.x - t.w / 2, y1 = e.y1, y2 = e.y2, dx = Math.max(36, (x2 - x1) / 2);
      e.d = 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2;
      e.mx = (x1 + 3 * (x1 + dx) + 3 * (x2 - dx) + x2) / 8; e.my = (y1 + 3 * y1 + 3 * y2 + y2) / 8;
      e.spine = !!(f.spine && t.spine);
    });
    var minX = INF, minY = INF, maxX = -INF, maxY = -INF;
    G.order.forEach(function (k) { var n = N[k]; minX = Math.min(minX, n.x - n.w / 2); maxX = Math.max(maxX, n.x + n.w / 2); minY = Math.min(minY, n.y - n.h / 2); maxY = Math.max(maxY, n.y + n.h / 2); });
    G.bounds = { x0: minX, y0: minY, x1: maxX, y1: maxY };
  }

  /* ── markup ── */
  function marks(a) { return '<div class="bb-cell__tl">' + H.markStage(a.stage) + '</div><div class="bb-cell__tr">' + H.markReview(a.review) + '</div>'; }
  function nodeHtml(n, T, sel) {
    var pos = 'left:' + (n.x - n.w / 2) + 'px;top:' + (n.y - n.h / 2) + 'px;width:' + n.w + 'px;height:' + n.h + 'px';
    if (n.rec && !n.group && !n.frame) return '<div class="gn gn--rec" data-key="' + n.key + '" data-rec="' + n.rec.id + '" style="' + pos + '" title="生产记录">' + I(n.rec.method === 'AI 生成' ? 'sparkles' : 'activity') + '<div><b>' + esc(n.rec.method) + '</b><small>' + esc(n.rec.by) + '</small></div></div>';
    if (n.missing) return '<div class="gn gn--missing" data-key="' + n.key + '" style="' + pos + '"><div class="gn__thumb">' + I('file-question', 'bb-icon--24') + '<div class="bb-cell__bl">' + H.markIssue('broken') + '</div></div><div class="gn__name">' + esc(n.name) + '</div><div class="gn__sub">已不在资产库</div></div>';
    if (n.group || n.frame) {
      var pend = n.items.filter(function (x) { return x.review === 'pending'; }).length, iss = n.items.filter(function (x) { return x.issue; }).length;
      var title = (n.members ? '归属于它' : esc(n.rec ? n.rec.method : '来源')) + ' · ' + n.items.length;
      if (n.group) return '<div class="gn gn--group" data-key="' + n.key + '" data-group="' + n.gkey + '" style="' + pos + '" title="展开"><div class="gn__thumb gn__stack">' + n.items.slice(0, 4).map(function (x) { return '<span' + (x.alpha ? ' class="bb-cell__thumb--alpha"' : '') + '>' + thumbOf(x) + '</span>'; }).join('') + (iss ? '<div class="bb-cell__bl">' + H.markIssue(n.items.filter(function (x) { return x.issue; })[0].issue, iss) + '</div>' : '') + (pend ? '<div class="bb-cell__br"><span class="bb-mark bb-mark--info">' + I('clock', 'bb-icon--12') + pend + '</span></div>' : '') + '</div><div class="gn__name">' + title + '</div><div class="gn__sub">' + (n.rec ? esc(n.rec.by) : '设计对象') + '</div></div>';
      var items = n.items.slice().sort(function (x, y) { return (y.issue ? 1 : 0) - (x.issue ? 1 : 0) || (y.review === 'pending') - (x.review === 'pending'); });
      return '<div class="gn gn--frame" data-key="' + n.key + '" style="' + pos + '"><div class="gn__fhead">' + I(n.members ? 'layers' : 'activity', 'bb-icon--12') + '<b>' + title + '</b>' + (n.rec ? '<button class="gn__frec" data-rec="' + n.rec.id + '">' + esc(n.rec.by) + '</button>' : '') + '<button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-group="' + n.gkey + '" aria-label="收起" title="收起">' + I('minus', 'bb-icon--12') + '</button></div><div class="gn__grid">' + items.map(function (x) { return '<div class="gm" data-id="' + x.id + '" title="' + esc(x.name) + '"><div class="gm__t' + (x.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + thumbOf(x) + '<div class="bb-cell__tl">' + H.markStage(x.stage) + '</div>' + (x.review === 'pending' ? '<div class="bb-cell__tr">' + H.markReview('pending') + '</div>' : '') + (x.issue ? '<div class="bb-cell__bl">' + H.markIssue(x.issue) + '</div>' : '') + '</div><span>' + esc(x.name) + '</span></div>'; }).join('') + '</div></div>';
    }
    var a = n.a, vs = D.versions(a), now = vs[vs.length - 1], at = D.verAt(a, T) || now, old = at.v !== now.v;
    var sub = n.center ? 'v' + at.v + ' · ' + esc(at.note) + ' · ' + D.fmtAt(at.at).replace(/^\d+ 月 /, '') : esc(n.sub || '');
    return '<div class="gn' + (n.center ? ' gn--center' : '') + (old ? ' gn--old' : '') + (sel.indexOf(a.id) >= 0 ? ' gn--sel' : '') + '" data-key="' + n.key + '" data-id="' + a.id + '" style="' + pos + '">' +
      '<div class="gn__thumb' + (a.alpha && a.kind !== 'doc' ? ' bb-cell__thumb--alpha' : '') + '">' + thumbOf(a) + marks(a) + (a.issue && T === INF ? '<div class="bb-cell__bl">' + H.markIssue(a.issue) + '</div>' : '') + (vs.length > 1 ? '<div class="bb-cell__br"><span class="bb-mark bb-mark--info">v' + at.v + '</span></div>' : '') + '</div>' +
      '<div class="gn__name" title="' + esc(a.path) + '">' + esc(a.name) + '</div><div class="gn__sub">' + sub + '</div>' +
      '<button class="gn__sel" data-sel aria-label="选择" title="选择以对比">' + I('check', 'bb-icon--12') + '</button><i class="gn__port" data-port title="拖到另一个资产上建立关系"></i>' +
      (n.more ? '<button class="gn__more" data-more title="再展开一层">+' + n.more + '</button>' : '') + '</div>';
  }
  function edgesSvg(G, T) {
    return '<svg class="rg__edges" width="1" height="1"><defs>' + [['ga', 'var(--ink-2)'], ['gaw', 'var(--warning-ink)'], ['gad', 'var(--danger-ink)'], ['gac', 'var(--line-control)']].map(function (m) { return '<marker id="' + m[0] + '" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0.5L8 4L0 7.5z" style="fill:' + m[1] + '"/></marker>'; }).join('') + '</defs>' +
      G.edges.map(function (e, i) {
        var stale = e.e && D.staleAt(e.e, T), cls = 'ge ge--' + e.type + (stale ? ' ge--stale' : '') + (e.broken ? ' ge--broken' : '') + (e.spine ? ' ge--spine' : ''), mk = e.type === 'belongs' ? '' : ' marker-end="url(#' + (e.broken ? 'gad' : stale ? 'gaw' : e.type === 'uses' ? 'gac' : 'ga') + ')"';
        e.stale = stale;
        return '<g class="' + cls + '" data-edge="' + i + '" data-from="' + e.from + '" data-to="' + e.to + '"><path class="ge__hit" d="' + e.d + '"/><path class="ge__line" d="' + e.d + '"' + mk + '/></g>';
      }).join('') + '<path class="ge--temp" d="" hidden/></svg>';
  }
  function badges(G) { return G.edges.map(function (e, i) { return e.stale ? '<button class="ge__badge" data-edge="' + i + '" style="left:' + e.mx + 'px;top:' + e.my + 'px" aria-label="上游已更新" title="上游已更新">' + I('circle-arrow-up', 'bb-icon--12') + '</button>' : e.broken ? '<button class="ge__badge ge__badge--broken" data-edge="' + i + '" style="left:' + e.mx + 'px;top:' + e.my + 'px" aria-label="断链" title="断链">' + I('unlink', 'bb-icon--12') + '</button>' : ''; }).join(''); }

  /* ── the side panel: a production record, or one relation ── */
  function rowOf(a, sub) { return H.row({ thumb: thumbOf(a), label: a.name, sub: sub, trailing: (a.issue ? H.issue(a.issue) : '') + H.stage(a.stage) + H.review(a.review) }).replace('<div class="bb-row', '<div data-open="' + a.id + '" class="bb-row'); }
  function recBody(r) {
    var outs = D.EDGES.filter(function (e) { return e.rec === r.id; }), ins = [], outA = [];
    outs.forEach(function (e) { var f = live(e.from), t = e.to && live(e.to); if (f && outA.indexOf(f) < 0) outA.push(f); if (t && ins.indexOf(t) < 0) ins.push(t); });
    D.assets.forEach(function (a) { if (a.origin === r.id) outA.push(a); });
    return H.kv([['方式', esc(r.method)], ['工具', esc(r.tool || '—')]].concat(r.plugin ? [['插件', '<span class="text-mono-sm">' + esc(r.plugin) + '</span>']] : [], [['执行者', '<span class="text-mono-sm">' + esc(App.who(r.by)) + '</span>'], ['时间', esc(r.at || '—')]], r.params ? [['参数', esc(r.params)]] : [], (r.inputs || []).map(function (x) { return [x.role, '<span class="text-mono-sm">' + esc(x.name) + '</span>']; }))) + (r.prompt ? '<div class="rg-p__lab">提示词' + (r.from ? '<span class="rg-p__src" title="模板「' + esc(r.template) + '」，尺寸与造型要求取自设计对象">' + I('file-text', 'bb-icon--12') + esc(r.template) + ' · ' + esc(r.from) + '</span>' : '') + '</div><pre class="prompt">' + esc(r.prompt) + '</pre>' : '') +
      (ins.length ? '<div class="rg-p__lab">输入</div>' + ins.map(function (a) { return rowOf(a, a.folder); }).join('') : '') +
      '<div class="rg-p__lab">产出 · ' + outA.length + '</div>' + (outA.length > 4 ? '<div class="rg-p__mini">' + outA.map(function (a) { return '<span data-open="' + a.id + '" title="' + esc(a.name) + '"' + (a.alpha ? ' class="bb-cell__thumb--alpha"' : '') + '>' + thumbOf(a) + '</span>'; }).join('') + '</div>' : outA.map(function (a) { return rowOf(a, a.folder); }).join(''));
  }
  function edgeBody(ge, T) {
    var e = ge.e;
    if (ge.recNode) return '<h5>' + I(ge.recNode.method === 'AI 生成' ? 'sparkles' : 'activity') + '生产记录</h5>' + recBody(ge.recNode);
    if (ge.group && ge.rec) return '<h5>' + I('activity') + '生产记录</h5>' + recBody(ge.rec);
    if (ge.group) return '<h5>' + I('layers') + '归属于它 · ' + ge.items.length + '</h5>' + ge.items.map(function (a) { return rowOf(a, a.folder); }).join('');
    var f = live(e.from), t = e.to ? live(e.to) : null, sent = '<p class="rg-p__sent"><b>' + esc(f.name) + '</b>' + (e.type === 'source' ? ' 由 ' : e.type === 'uses' ? ' 引用 ' : ' 属于 ') + '<b>' + esc(t ? t.name : e.toName) + '</b>' + (e.type === 'source' ? ' 产出' : '') + '</p>';
    var head = '<h5>' + I(e.type === 'source' ? 'arrow-right' : e.type === 'uses' ? 'link' : 'layers') + (e.type === 'source' ? '来源' : e.type === 'uses' ? '引用' : '归属') + (e.note ? ' · ' + esc(e.note) : '') + '</h5>';
    /* a slot is the name the file itself writes (ADR-018); which asset fills it is recorded in the .bmeta and can be changed */
    if (e.slot) sent += H.kv([['位置', '<span class="text-mono-sm">' + esc(e.slot) + '</span>']]);
    var inTrash = !t && S.trash.some(function (x) { return x.name === e.toName; });
    if (!t) return head + sent + H.banner('danger', 'unlink', '指向的文件找不到了', esc(e.toName) + (inTrash ? ' 在回收站里' : ' 已不在资产库'), '<button class="bb-btn bb-btn--sm" data-p="swap">更换对方…</button>' + (inTrash ? '<button class="bb-btn bb-btn--sm" data-p="restore">从回收站恢复</button>' : '') + '<button class="bb-btn bb-btn--sm" data-p="del">删除这条关系</button>');
    var body = head + sent;
    if (e.type === 'source') {
      var was = D.toVerAt(e, T), now = D.verAt(t, T);
      if (ge.stale && T === INF) body += staleBanner(f, e);
      body += H.kv([['当时版本', 'v' + (was ? was.v : '—') + (was ? ' · ' + esc(was.note) : '')], ['现在版本', 'v' + (now ? now.v : '—') + (now ? ' · ' + esc(now.note) : '')]]);
      var r = D.RECS[e.rec]; if (r) body += '<div class="rg-p__lab rg-p__lab--sec">生产记录</div>' + recBody(r);
    }
    return body + '<div class="rg-p__foot"><button class="bb-btn bb-btn--sm" data-p="swap">' + I('arrow-up-down', 'bb-icon--12') + '更换对方…</button><button class="bb-btn bb-btn--sm bb-btn--ghost" data-p="del">' + I('trash-2', 'bb-icon--12') + '删除这条关系</button></div>';
  }

  /* ── upstream updated: the banner and its three actions, shared by the inspector and the detail page ── */
  function staleEdge(a) { return D.EDGES.filter(function (e) { return e.from === a.id && D.staleAt(e, INF); })[0]; }
  function staleBanner(a, e) {
    e = e || staleEdge(a); if (!e) return '';
    var up = live(e.to), now = D.verAt(up, INF), was = D.toVerAt(e, INF);
    return H.banner('warning', 'circle-arrow-up', '上游已更新，待复核', '<b>' + esc(up.name) + '</b> v' + was.v + ' → v' + now.v + ' · ' + esc(now.note) + ' · <span class="text-mono-sm">' + now.by + '</span> · ' + D.fmtAt(now.at),
      '<button class="bb-btn bb-btn--sm bb-btn--primary" data-stale="ok" data-for="' + a.id + '">确认已复核</button><button class="bb-btn bb-btn--sm" data-stale="replace" data-for="' + a.id + '">替换内容…</button>' +
      (App.verStored && App.verStored(up, was) ? '<button class="bb-btn bb-btn--sm" data-stale="cmp" data-for="' + a.id + '">对比上游的变化</button>' : '<button class="bb-btn bb-btn--sm" disabled title="需要先安装版本插件">对比上游的变化</button><span class="bb-banner__hint">需要版本插件</span>'));
  }
  App.staleBanner = function (a) { return staleBanner(a); };
  App.staleAct = function (a, act) {
    var e = staleEdge(a); if (!e) return; var up = live(e.to), now = D.verAt(up, INF);
    if (act === 'cmp') return App.compare({ id: up.id, v: D.toVerAt(e, INF).v }, { id: up.id, v: now.v });
    if (act === 'ok') {
      var prev = e.reviewedAt, issue = a.issue; e.reviewedAt = D.tick(); a.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); App.render();
      return App.toast('已复核，记下了 ' + up.name + ' v' + now.v, function () { e.reviewedAt = prev; a.issue = issue; D.counts.issues++; App.render(); });
    }
    if (act !== 'replace') return;
    var rec = D.RECS[e.rec], render = rec && rec.method === '渲染' && up.kind === 'model', next = D.versions(a).length + 1;
    var d = App.dialog({ title: '替换 ' + esc(a.name) + ' 的内容', text: '新内容会成为 v' + next + '，校验回到待审。', body: '<div class="rep">' + (render ? '<button class="rep__opt" data-rep="render">' + I('camera') + '<span><b>从 ' + esc(up.name) + ' v' + now.v + ' 重新渲染</b><small>沿用上次的相机与环境</small></span>' + I('chevron-right', 'bb-icon--12') + '</button>' : '') + '<button class="rep__opt" data-rep="file">' + I('upload') + '<span><b>选择文件…</b><small>从本机上传新内容</small></span>' + I('chevron-right', 'bb-icon--12') + '</button></div>', actions: [{ label: '取消' }] });
    d.addEventListener('click', function (ev) {
      var o = ev.target.closest('[data-rep]'); if (!o) return; d.cancel();
      if (o.dataset.rep === 'render') { App.pendingShot = { replace: a, from: up }; return App.openDetail(up.id, 'view'); }
      D.addVersion(a, App.me(), '替换内容'); e.reviewedAt = D.tick(); a.issue = null; a.review = 'pending'; D.counts.issues = Math.max(0, D.counts.issues - 1); App.render();
      App.toast('已替换 ' + a.name + '，回到待审');
    });
  };

  /* ── the relation dialog: type, the other asset, and for a source the production record ── */
  var TYPES = [['source', '来源', 'arrow-right', '它由对方产出，记下对方当时的版本'], ['uses', '引用', 'link', '它使用时需要对方，比如模型需要贴图'], ['belongs', '归属', 'layers', '它属于对方代表的设计对象']];
  var METHODS = ['AI 生成', '手工', '切图', '渲染', '导出', '转换', '其他'];
  function verb(t) { return t === 'source' ? ['由', '产出'] : t === 'uses' ? ['引用', ''] : ['属于', '']; }
  App.relationDialog = function (a, p) {
    p = p || {};
    var st = { type: p.type || 'source', to: p.to || null, q: '', method: '手工', tool: '', prompt: '', note: '', relink: p.relink || null };
    function problem() {
      if (!st.to) return null;
      if (st.to === a) return { text: '不能和自己建立关系' };
      if (D.hasEdge(a, st.type, st.to)) return { text: '已经有这条关系' };
      if (st.type === 'source') { var c = D.cyclePath(a, st.to); if (c) return { text: '会形成循环：' + st.to.name + ' 本来就来自 ' + a.name, chain: c }; }
      return null;
    }
    function cands() { var q = st.q.trim().toLowerCase(); return D.assets.filter(function (x) { return x !== a && (!q || (x.name + ' ' + x.folder + ' ' + x.tags.join(' ')).toLowerCase().indexOf(q) >= 0) && (st.type !== 'belongs' || x.kind === 'doc'); }).sort(function (x, y) { return (y.folder === a.folder) - (x.folder === a.folder); }).slice(0, 6); }
    function body() {
      var pr = problem(), v = verb(st.type);
      return '<div class="rtypes">' + TYPES.map(function (t) { return '<button class="rtype" data-rt="' + t[0] + '" aria-pressed="' + (st.type === t[0]) + '">' + I(t[2]) + '<b>' + t[1] + '</b><span>' + t[3] + '</span></button>'; }).join('') + '</div>' +
        '<div class="bb-label">对方</div>' + (st.to ? '<div class="rto">' + rowOf(st.to, st.to.folder).replace('data-open=', 'data-x=') + '<button class="bb-btn bb-btn--sm bb-btn--ghost" data-rclear>更换</button></div>' :
        '<div class="bb-field">' + I('search') + '<input class="bb-field__input" id="rq" placeholder="搜索资产" value="' + esc(st.q) + '" autocomplete="off" aria-label="搜索资产"></div><div class="rlist">' + cands().map(function (x) { return H.row({ thumb: thumbOf(x), label: x.name, sub: x.folder, trailing: H.stage(x.stage) }).replace('<div class="bb-row', '<div data-pick="' + x.id + '" class="bb-row'); }).join('') + '</div>') +
        (st.to ? '<p class="rsent"><b>' + esc(a.name) + '</b> ' + v[0] + ' <b>' + esc(st.to.name) + '</b> ' + v[1] + '</p>' : '') +
        (pr ? H.banner('danger', 'ban', pr.text, pr.chain ? pr.chain.map(function (x) { return esc(x.name); }).join(' → ') : '') : '') +
        (st.type === 'source' ? '<div class="up-opts"><span>方式</span><div class="ln">' + METHODS.map(function (m) { return '<button class="fchip" data-rm="' + m + '" aria-pressed="' + (st.method === m) + '">' + m + '</button>'; }).join('') + '</div><span>工具</span><div class="bb-field"><input class="bb-field__input" id="rtool" value="' + esc(st.tool) + '" placeholder="例如 Blender 4.2" aria-label="工具"></div>' + (st.method === 'AI 生成' ? '<span>提示词</span><div class="bb-field bb-field--area"><textarea class="bb-field__input" id="rprompt" rows="3" aria-label="提示词">' + esc(st.prompt) + '</textarea></div>' : '') + '<span>备注</span><div class="bb-field"><input class="bb-field__input" id="rnote" value="' + esc(st.note) + '" aria-label="备注"></div></div>' : '');
    }
    var d = App.dialog({ wide: true, title: (st.relink ? '重新指定 ' : '为 ') + esc(a.name) + (st.relink ? ' 的关系' : ' 建立关系'), body: body(), actions: [{ label: '取消' }, { label: st.relink ? '重新指定' : '建立关系', kind: 'primary', icon: 'link', keep: true, act: create }] });
    var bd = $('.bb-dialog__body', d), ok = $('[data-k="1"]', d);
    function redraw(focus) { bd.innerHTML = body(); ok.disabled = !st.to || !!problem(); if (focus) { var q = $('#' + focus, bd); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } } }
    bd.addEventListener('click', function (ev) {
      var t = ev.target, rt = t.closest('[data-rt]'), pk = t.closest('[data-pick]'), rm = t.closest('[data-rm]');
      if (rt) { st.type = rt.dataset.rt; if (st.type === 'belongs' && st.to && st.to.kind !== 'doc') st.to = null; return redraw(); }
      if (pk) { st.to = D.byId(pk.dataset.pick); return redraw(); }
      if (t.closest('[data-rclear]')) { st.to = null; return redraw('rq'); }
      if (rm) { st.method = rm.dataset.rm; return redraw(); }
    });
    bd.addEventListener('input', function (ev) { var id = ev.target.id; if (id === 'rq') { st.q = ev.target.value; redraw('rq'); } if (id === 'rtool') st.tool = ev.target.value; if (id === 'rprompt') st.prompt = ev.target.value; if (id === 'rnote') st.note = ev.target.value; });
    function create(h) {
      if (!st.to || problem()) return;
      h.cancel();
      var o = {}; if (st.type === 'source') o.rec = D.addRecord({ method: st.method, tool: st.tool || '—', by: App.me(), at: D.fmtAt(D.tick()), prompt: st.prompt || null, params: st.note || null });
      if (st.relink) { var idx = D.removeEdge(st.relink); o.note = st.relink.note; o.rec = st.relink.rec || o.rec; }
      var e = D.addEdge(a, st.type, st.to, o), v = verb(st.type);
      if (st.relink && a.issue === 'broken') { a.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); }
      App.render(); App.refreshGraph();
      App.toast('已建立：' + a.name + ' ' + v[0] + ' ' + st.to.name + (v[1] ? ' ' + v[1] : ''), function () { D.removeEdge(e); App.render(); App.refreshGraph(); });
    }
    ok.disabled = !st.to || !!problem(); setTimeout(function () { var q = $('#rq', bd); if (q) q.focus(); }, 0);
  };
  /* 更换对方 (ADR-018): the relation keeps its type and slot, only the asset on the other end changes. Only offered in the graph. */
  App.swapRelation = function (e) {
    var from = live(e.from), cur = e.to && live(e.to), kind = cur ? cur.kind : (/\.(png|jpe?g|webp)$/i.test(e.toName || '') ? 'image' : null), q = '', pick = null;
    var VB = { source: '来源', uses: '引用', belongs: '归属' };
    function cands() { var s = q.trim().toLowerCase(); return D.assets.filter(function (x) { return x !== from && (!s ? (!kind || x.kind === kind) : (x.name + ' ' + x.folder).toLowerCase().indexOf(s) >= 0); }).sort(function (x, y) { return (y.folder === from.folder) - (x.folder === from.folder); }).slice(0, 8); }
    var d = App.dialog({ title: '更换 ' + esc(from.name) + ' 的' + VB[e.type] + (e.note ? '「' + esc(e.note) + '」' : ''), form: true,
      body: (e.slot ? '<p class="sw__slot">位置 <span class="text-mono-sm">' + esc(e.slot) + '</span> · 现在是 <b>' + esc(cur ? cur.name : e.toName + '（找不到）') + '</b></p>' : '') + '<div class="bb-field">' + I('search') + '<input class="bb-field__input" id="swq" placeholder="搜索资产" aria-label="搜索资产" autocomplete="off"></div><div class="cpl sw__list" role="radiogroup"></div>',
      actions: [{ label: '取消' }, { label: '更换', kind: 'primary', keep: true, act: function (h) {
        if (!pick) return; h.cancel(); var was = { to: e.to, toName: e.toName, rev: e.reviewedAt }, issue = from.issue;
        e.to = pick.id; e.toName = pick.name; if (e.type === 'source') e.reviewedAt = D.tick();  /* the new upstream is taken as it is now */
        if (from.issue === 'broken') { from.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); }
        App.render(); App.refreshGraph(); if (App.detailRefresh && App.detailOpen) App.detailRefresh();
        App.toast((e.note || VB[e.type]) + ' 换成了 ' + pick.name, function () { e.to = was.to; e.toName = was.toName; e.reviewedAt = was.rev; if (issue && !from.issue) { from.issue = issue; D.counts.issues++; } App.render(); App.refreshGraph(); if (App.detailRefresh && App.detailOpen) App.detailRefresh(); });
      } }] });
    var list = $('.sw__list', d), ok = d.querySelector('[data-k="1"]'); ok.disabled = true;
    function draw() { list.innerHTML = cands().map(function (x) { return '<button class="cpl__it" role="radio" aria-checked="' + (pick === x) + '" data-id="' + x.id + '"' + (cur === x ? ' disabled' : '') + '><span class="cpk__t' + (x.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + thumbOf(x) + '</span><span><b>' + esc(x.name) + '</b><small>' + esc(x.folder) + (cur === x ? ' · 现在用的' : '') + '</small></span></button>'; }).join('') || '<p class="cpl__none">没有匹配的资产</p>'; }
    $('#swq', d).addEventListener('input', function (ev) { q = ev.target.value; draw(); });
    list.addEventListener('click', function (ev) { var it = ev.target.closest('[data-id]'); if (!it || it.disabled) return; pick = D.byId(it.dataset.id); ok.disabled = false; draw(); });
    draw(); setTimeout(function () { $('#swq', d).focus(); }, 0);
  };
  App.removeRelation = function (e) {
    var i = D.removeEdge(e); App.render(); App.refreshGraph();
    App.toast('已删除这条关系', function () { D.EDGES.splice(i, 0, e); App.render(); App.refreshGraph(); });
  };

  /* ── the graph view ── */
  var current = null;
  App.refreshGraph = function () { if (current) current.redraw(); };
  App.graphEsc = function () { return !!(current && current.esc()); };
  App.mountGraph = function (host, center) {
    var T = INF, opt = { down: 2, open: {} }, sel = [], z = 1, tx = 0, ty = 0, G = null, panelFor = null, first = true, prevPos = {};
    var vs = D.versions(center);
    host.innerHTML = '<div class="rg"><div class="rg__bar"><div class="rg__vers"></div><span class="bb-toolbar__grow"></span><button class="bb-btn bb-btn--sm" data-g="new">' + I('link', 'bb-icon--12') + '建立关系…</button></div>' +
      '<div class="rg__view"><div class="rg__world"></div>' +
      '<div class="rg__legend"><span><svg width="28" height="8"><path d="M0 4H24" class="lg lg--source"/></svg>来源</span><span><svg width="28" height="8"><path d="M0 4H24" class="lg lg--uses"/></svg>引用</span><span><svg width="28" height="8"><path d="M0 4H24" class="lg lg--belongs"/></svg>归属</span><span><svg width="28" height="8"><path d="M0 4H24" class="lg lg--stale"/></svg>上游已更新</span><span><svg width="28" height="8"><path d="M0 4H24" class="lg lg--broken"/></svg>断链</span></div>' +
      '<div class="rg__zoom"><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-g="out" aria-label="缩小">' + I('minus', 'bb-icon--12') + '</button><span class="vw__num" data-zl></span><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-g="in" aria-label="放大">' + I('plus', 'bb-icon--12') + '</button><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-g="fit" aria-label="适应" title="适应">' + I('focus', 'bb-icon--12') + '</button></div>' +
      '<div class="rg__selbar" hidden></div><div class="rg__hist" hidden></div><div class="rg__panel" data-closed></div></div></div>';
    var root = $('.rg', host), view = $('.rg__view', root), world = $('.rg__world', root), panel = $('.rg__panel', root), bar = $('.rg__vers', root), selbar = $('.rg__selbar', root), hist = $('.rg__hist', root);
    function lp(e) { var r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom }; }
    function toWorld(p) { return { x: (p.x - tx) / z, y: (p.y - ty) / z }; }
    function applyT(anim) { world.classList.toggle('anim', !!anim); world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')'; var zl = $('[data-zl]', root); if (zl) zl.textContent = Math.round(z * 100) + '%'; }
    function fit(anim) {
      var b = G.bounds, W = view.clientWidth - (panelFor ? 300 : 0), Hh = view.clientHeight, bw = b.x1 - b.x0 + 80, bh = b.y1 - b.y0 + 120;
      z = clamp(Math.min(W / bw, Hh / bh), 0.55, 1);
      tx = W / 2 - (b.x0 + b.x1) / 2 * z; ty = Hh / 2 - (b.y0 + b.y1) / 2 * z;
      var c = G.nodes[center.id]; if (bw * z > W) tx = Math.min(W * 0.62 - c.x * z, 40 - b.x0 * z);
      applyT(anim);
    }
    function versBar() {
      /* the relations of an old version are only kept by a version plugin (ADR-024) */
      if (!S.verPlugin) { T = INF; bar.innerHTML = ''; hist.hidden = true; return; }
      var curV = T === INF ? vs[vs.length - 1] : D.verAt(center, T);
      bar.innerHTML = I('history', 'bb-icon--12') + vs.map(function (v, i) { var on = v === curV; return (i ? '<i class="rg__vline"></i>' : '') + '<button class="rg__ver" data-ver="' + i + '" aria-pressed="' + on + '" title="' + esc(v.note) + ' · ' + v.by + '"><i></i><b>v' + v.v + '</b><span>' + D.fmtAt(v.at).replace(/ \d\d:\d\d$/, '') + '</span>' + (i === vs.length - 1 ? '<em>当前</em>' : '') + '</button>'; }).join('');
      hist.hidden = T === INF;
      if (T !== INF) hist.innerHTML = I('history', 'bb-icon--12') + '<span>v' + curV.v + ' · ' + esc(curV.note) + ' · ' + D.fmtAt(curV.at) + ' 时的关系</span><button class="bb-btn bb-btn--sm" data-g="now">回到当前</button>';
    }
    function draw(anim) {
      var old = {}; if (G) G.order.forEach(function (k) { var n = G.nodes[k]; old[k] = { x: n.x, y: n.y, w: n.w, h: n.h }; });
      G = build(center, T, opt); layout(G, center);
      world.innerHTML = edgesSvg(G, T) + G.order.map(function (k) { return nodeHtml(G.nodes[k], T, sel); }).join('') + badges(G);
      versBar(); syncSel();
      if (first) { fit(false); first = false; carryIn(); }
      else if (anim) {
        G.order.forEach(function (k) {
          var n = G.nodes[k], o = old[k], node = $('[data-key="' + CSS.escape(k) + '"]', world); if (!node) return;
          if (!o) { node.classList.add('gn--in'); return; }
          if (o.x === n.x && o.y === n.y) return;
          node.style.transition = 'none'; node.style.transform = 'translate(' + (o.x - o.w / 2 - (n.x - n.w / 2)) + 'px,' + (o.y - o.h / 2 - (n.y - n.h / 2)) + 'px)';
          void node.offsetWidth; node.style.transition = ''; node.style.transform = '';
        });
        $('.rg__edges', world).classList.add('ge--in');
      }
      if (panelFor) openPanel(panelFor, true);
    }
    /* coming from another centre: nodes that were on screen glide from where they were */
    function carryIn() {
      if (!CARRY) { world.classList.add('rg--in'); return; }
      var any = false;
      G.order.forEach(function (k) {
        var o = CARRY[k], node = $('[data-key="' + CSS.escape(k) + '"]', world); if (!node) return;
        if (!o) { node.classList.add('gn--in'); return; }
        var r = node.getBoundingClientRect(); any = true;
        node.style.transition = 'none'; node.style.transformOrigin = '0 0';
        node.style.transform = 'translate(' + (o.left - r.left) / S.zoom / z + 'px,' + (o.top - r.top) / S.zoom / z + 'px) scale(' + o.width / r.width + ',' + o.height / r.height + ')';
        void node.offsetWidth; node.style.transition = ''; node.style.transform = '';
        setTimeout(function () { node.style.transformOrigin = ''; }, 700);
      });
      $('.rg__edges', world).classList.add('ge--in'); CARRY = null;
      if (!any) world.classList.add('rg--in');
    }
    function syncSel() {
      selbar.hidden = !sel.length;
      if (sel.length) selbar.innerHTML = '<span>已选 ' + sel.length + ' 个</span><button class="bb-btn bb-btn--sm bb-btn--primary" data-g="cmp"' + (sel.length === 2 ? '' : ' disabled') + '>' + I('git-compare-arrows', 'bb-icon--12') + '对比</button><button class="bb-btn bb-btn--sm bb-btn--ghost" data-g="unsel">取消</button>';
    }
    function openPanel(what, keep) {
      panelFor = what; var html = '';
      if (what.edge != null) { var ge = G.edges[what.edge]; if (!ge) return closePanel(); html = edgeBody(ge, T); $$('.ge[data-on]', world).forEach(function (x) { x.removeAttribute('data-on'); }); var g = $('.ge[data-edge="' + what.edge + '"]', world); if (g) g.setAttribute('data-on', ''); }
      else if (what.rec) html = '<h5>' + I(what.rec.method === 'AI 生成' ? 'sparkles' : 'activity') + '生产记录</h5>' + recBody(what.rec);
      panel.innerHTML = '<button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm rg-p__x" data-g="close" aria-label="关闭">' + I('x', 'bb-icon--12') + '</button>' + html;
      var wasClosed = panel.hasAttribute('data-closed');
      panel.removeAttribute('data-closed'); if (!keep) panel.scrollTop = 0;
      /* make room: slide the graph left just enough that nothing sits under the panel */
      if (wasClosed && !keep) {
        var fe = what.edge != null && G.edges[what.edge], fn = fe ? G.nodes[fe.to] : null, fx = fn ? fn.x + fn.w / 2 : G.bounds.x1;
        var limit = view.clientWidth - 316, right = tx + fx * z; if (right > limit) { tx -= right - limit; applyT(true); }
      }
    }
    function closePanel() { panelFor = null; panel.setAttribute('data-closed', ''); $$('.ge[data-on]', world).forEach(function (x) { x.removeAttribute('data-on'); }); }

    /* pointer: pan the canvas, follow a node, drag from a port to create a relation */
    var drag = null;
    view.addEventListener('pointerdown', function (e) {
      if (e.button || e.target.closest('.rg__panel, .rg__zoom, .rg__legend, .rg__selbar, .rg__hist, button, .ge__hit')) return;
      var port = e.target.closest('[data-port]');
      if (port) { var n = G.nodes[port.closest('[data-key]').dataset.key]; drag = { kind: 'link', from: n, p0: lp(e) }; e.preventDefault(); return; }
      var node = e.target.closest('[data-key]');
      /* keep the real target: once the view captures the pointer, pointerup reports the view, not what was pressed */
      drag = { kind: node ? 'node' : 'pan', node: node, t: e.target, p0: lp(e), tx: tx, ty: ty, moved: false };
      try { view.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    });
    view.addEventListener('pointermove', function (e) {
      var p = lp(e);
      if (!drag) { var hn = e.target.closest && e.target.closest('.gn[data-key]'); focusOn(hn ? hn.dataset.key : null); return; }
      if (drag.kind === 'link') {
        var t = $('.ge--temp', world), a0 = drag.from, w = toWorld(p), x1 = a0.x + a0.w / 2, y1 = a0.y, dx = Math.max(30, (w.x - x1) / 2);
        t.hidden = false; t.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (w.x - dx) + ' ' + w.y + ' ' + w.x + ' ' + w.y);
        var over = document.elementFromPoint(e.clientX, e.clientY), on = over && over.closest('.gn[data-id]');
        $$('.gn--drop', world).forEach(function (x) { if (x !== on) x.classList.remove('gn--drop'); }); if (on && on.dataset.id !== (a0.a && a0.a.id)) on.classList.add('gn--drop');
        return;
      }
      if (Math.abs(p.x - drag.p0.x) + Math.abs(p.y - drag.p0.y) > 4) drag.moved = true;
      if (drag.moved) { tx = drag.tx + p.x - drag.p0.x; ty = drag.ty + p.y - drag.p0.y; applyT(); view.classList.add('panning'); }
    });
    view.addEventListener('pointerup', function (e) {
      var d = drag; drag = null; view.classList.remove('panning'); if (!d) return;
      if (d.kind === 'link') {
        var t = $('.ge--temp', world); if (t) t.hidden = true;
        var on = $('.gn--drop', world); if (on) on.classList.remove('gn--drop');
        if (on && d.from.a) linkMenu(d.from.a, D.byId(on.dataset.id), e);
        return;
      }
      if (d.kind === 'node' && !d.moved) nodeClick(d.node, { target: d.t, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
    });
    view.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { var p = lp(e), z2 = clamp(z * Math.exp(-e.deltaY * 0.01), 0.35, 1.6); tx = p.x - (p.x - tx) * z2 / z; ty = p.y - (p.y - ty) * z2 / z; z = z2; }
      else { tx -= e.deltaX; ty -= e.deltaY; }
      applyT();
    }, { passive: false });
    function focusOn(key) {
      if (focusOn.k === key) return; focusOn.k = key;
      world.classList.toggle('rg--focus', !!key);
      $$('.gn--hl, .ge--hl', world).forEach(function (x) { x.classList.remove('gn--hl'); x.classList.remove('ge--hl'); });
      if (!key) return;
      var k = $('[data-key="' + CSS.escape(key) + '"]', world); if (k) k.classList.add('gn--hl');
      $$('.ge', world).forEach(function (g) { if (g.dataset.from === key || g.dataset.to === key) { g.classList.add('ge--hl'); [g.dataset.from, g.dataset.to].forEach(function (o) { var n = $('[data-key="' + CSS.escape(o) + '"]', world); if (n) n.classList.add('gn--hl'); }); } });
    }
    function nodeClick(node, e) {
      var t = e.target;
      if (t.closest('[data-sel]')) { var id = node.dataset.id, i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else { sel.push(id); if (sel.length > 2) sel.shift(); } $$('.gn[data-id]', world).forEach(function (x) { x.classList.toggle('gn--sel', sel.indexOf(x.dataset.id) >= 0); }); return syncSel(); }
      if (t.closest('[data-more]')) { opt.down++; return draw(true); }
      var g = t.closest('[data-group]'); if (g) { opt.open[g.dataset.group] = !opt.open[g.dataset.group]; return draw(true); }
      var rc = t.closest('[data-rec]'); if (rc) return openPanel({ rec: D.RECS[rc.dataset.rec] });
      var mini = t.closest('.gm[data-id]'); if (mini) return go(mini.dataset.id);
      if (node.dataset.id && (e.metaKey || e.ctrlKey || e.shiftKey)) { t = node.querySelector('[data-sel]'); return nodeClick(node, { target: t }); }
      if (node.dataset.id && node.dataset.id !== center.id) go(node.dataset.id);
    }
    function go(id) { App.openDetail(id, 'rel'); }
    function linkMenu(a, b, e) {
      if (!b || a === b) return;
      function item(type, icon) {
        var v = verb(type), cyc = type === 'source' && D.cyclePath(a, b), dup = D.hasEdge(a, type, b), bad = type === 'belongs' && b.kind !== 'doc';
        return { icon: icon, html: '<span class="lm"><b>' + esc(a.name) + '</b> ' + v[0] + ' <b>' + esc(b.name) + '</b>' + (v[1] ? ' ' + v[1] : '') + (cyc ? '<small>会形成循环</small>' : dup ? '<small>已经有了</small>' : '') + '</span>', disabled: !!(cyc || dup || bad), act: function () { if (type === 'source') return App.relationDialog(a, { type: 'source', to: b }); var ed = D.addEdge(a, type, b); App.render(); redraw(); App.toast('已建立：' + a.name + ' ' + v[0] + ' ' + b.name, function () { D.removeEdge(ed); App.render(); redraw(); }); } };
      }
      App.menu([item('source', 'arrow-right'), item('uses', 'link'), item('belongs', 'layers'), 'sep', { icon: 'arrow-up-down', label: '对调方向', act: function () { linkMenu(b, a, e); } }], e);
    }
    root.addEventListener('click', function (e) {
      var t = e.target, g = t.closest('[data-g]');
      /* buttons on a node (select, +N, collapse, record) skip the pointer path, so they land here */
      var nb = t.closest('.gn button'); if (nb && !g) return nodeClick(nb.closest('[data-key]'), e);
      if (g) {
        var k = g.dataset.g;
        if (k === 'in' || k === 'out') { var W = view.clientWidth / 2, Hh = view.clientHeight / 2, z2 = clamp(z * (k === 'in' ? 1.2 : 1 / 1.2), 0.35, 1.6); tx = W - (W - tx) * z2 / z; ty = Hh - (Hh - ty) * z2 / z; z = z2; applyT(true); }
        if (k === 'fit') fit(true);
        if (k === 'close') closePanel();
        if (k === 'now') { T = INF; draw(true); }
        if (k === 'unsel') { sel = []; draw(false); }
        if (k === 'cmp' && sel.length === 2) { if (App.compare) App.compare(D.byId(sel[0]), D.byId(sel[1])); else App.toast('对比 ' + D.byId(sel[0]).name + ' 和 ' + D.byId(sel[1]).name); }
        if (k === 'new') App.relationDialog(center);
        return;
      }
      var v = t.closest('[data-ver]'); if (v) { var i = +v.dataset.ver; T = i === vs.length - 1 ? INF : vs[i + 1].at - 1; return draw(true); }
      var ed = t.closest('[data-edge]'); if (ed && !t.closest('.rg__panel')) return openPanel({ edge: +ed.dataset.edge });
      var op = t.closest('[data-open]'); if (op) return go(op.dataset.open);
      var pa = t.closest('[data-p]');
      if (pa && panelFor && panelFor.edge != null) {
        var ge = G.edges[panelFor.edge], E = ge && ge.e; if (!E) return;
        if (pa.dataset.p === 'del') { closePanel(); App.removeRelation(E); }
        if (pa.dataset.p === 'swap') App.swapRelation(E);
        if (pa.dataset.p === 'restore') { var tr = S.trash.filter(function (x) { return x.name === E.toName; })[0]; if (tr) App.restoreFromTrash(tr, function () { E.to = tr.id; var fa = App.byId(E.from); if (fa && fa.issue === 'broken') { fa.issue = null; D.counts.issues = Math.max(0, D.counts.issues - 1); } App.render(); redraw(); App.toast(tr.name + ' 已恢复，关系重新接上了'); }); }
      }
      var sa = t.closest('[data-stale]'); if (sa) App.staleAct(D.byId(sa.dataset.for), sa.dataset.stale);
    });
    function redraw() { if (!center || D.assets.indexOf(center) < 0) return; draw(true); }
    var ro = new ResizeObserver(function () { if (G && !first) { /* keep the view; the canvas just got a new size */ } }); ro.observe(view);
    draw(false);
    /* space: quick look whatever the pointer rests on (else the centre); arrows inside walk the graph left→right */
    var hoverId = null;
    view.addEventListener('pointerover', function (e) { var h = e.target.closest && e.target.closest('.gm[data-id], .gn[data-id]'); hoverId = h ? h.dataset.id : null; });
    /* leaving the canvas clears the hover: no node should look picked out once the pointer is elsewhere */
    view.addEventListener('pointerleave', function () { hoverId = null; if (!drag) focusOn(null); });
    function thumbEl(id) { var c = CSS.escape(id); return $('.gm[data-id="' + c + '"] .gm__t', world) || $('.gn[data-id="' + c + '"] .gn__thumb', world); }
    function peek(id) {
      var ids = $$('.gn[data-id], .gm[data-id]', world).map(function (n) { var r = n.getBoundingClientRect(); return { id: n.dataset.id, x: Math.round((r.left + r.width / 2) / r.width), y: r.top }; })
        .sort(function (p, q) { return p.x - q.x || p.y - q.y; }).map(function (p) { return p.id; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
      App.quickLook(id, { list: ids, from: thumbEl, onStep: function (nid) { var n = $('.gn[data-id="' + CSS.escape(nid) + '"]', world); focusOn(n ? n.dataset.key : null); } });
    }
    /* opened for one relation (e.g. 重新指定… on the integrity page): select it and show its panel */
    if (App.pendingEdge) { var pe = App.pendingEdge; App.pendingEdge = null; setTimeout(function () { var ix = G.edges.map(function (g) { return g.e; }).indexOf(pe); if (ix >= 0) openPanel({ edge: ix }); }, 120); }
    var api = {
      redraw: redraw,
      key: function (e) { if (e.key !== ' ' || e.metaKey || e.ctrlKey || App.qlOpen) return false; peek(hoverId && D.byId(hoverId) ? hoverId : center.id); return true; },
      esc: function () { if (panelFor) { closePanel(); return true; } if (sel.length) { sel = []; draw(false); return true; } return false; },
      destroy: function () {
        ro.disconnect(); CARRY = {};
        $$('.gn[data-key]', world).forEach(function (n) { var r = n.getBoundingClientRect(); CARRY[n.dataset.key] = { left: r.left, top: r.top, width: r.width, height: r.height }; });
        if (current === api) current = null;
      }
    };
    current = api;
    return api;
  };
  /* leaving the relation tab for anything else forgets where nodes were */
  App.forgetGraph = function () { CARRY = null; };

  /* ── a design object (a document others belong to): everything it gathers, by what it is ── */
  var GROUPS = ['原画与四视图', '模型', '贴图', 'Icon', '音效', '动画预览', '其他'];
  function groupOf(x) { var t = x.tags || []; if (x.kind === 'model' || /\.(blend|fbx|max|ma|mb)$/i.test(x.name)) return '模型'; if (t.indexOf('贴图') >= 0) return '贴图'; if (t.indexOf('Icon') >= 0 || /icon/i.test(x.name)) return 'Icon'; if (x.kind === 'image') return '原画与四视图'; if (x.kind === 'audio') return '音效'; if (x.kind === 'video') return '动画预览'; return '其他'; }
  App.isDesignObject = function (a) { return a.kind === 'doc' && D.rel(a).members.length > 0; };
  App.objectOverview = function (a) {
    var ms = D.rel(a).members.map(function (m) { return m.a; }), by = {}, n = { reference: 0, production: 0, runtime: 0 }, pend = 0, iss = 0;
    ms.forEach(function (x) { (by[groupOf(x)] = by[groupOf(x)] || []).push(x); n[x.stage]++; if (x.review === 'pending') pend++; if (x.issue) iss++; });
    return '<header class="ov-head"><h1>' + esc(a.title || a.name) + '</h1><p>' + esc(a.excerpt || '') + '</p><div class="ov-stats">' + (a.target ? '<span class="ov-size" title="目标尺寸：宽 × 高 × 深，写在这份文档的开头">' + I('box', 'bb-icon--12') + a.target.w + ' × ' + a.target.h + ' × ' + a.target.d + ' m</span>' : '') + '<span>' + ms.length + ' 个资产</span>' + ['reference', 'production', 'runtime'].filter(function (s) { return n[s]; }).map(function (s) { return '<span>' + H.stage(s, 'short') + ' ' + n[s] + '</span>'; }).join('') + (pend ? '<span>' + H.review('pending', true) + ' ' + pend + '</span>' : '') + (iss ? '<span>' + H.issue('stale', false) + ' 有问题 ' + iss + '</span>' : '') + '</div></header>' +
      GROUPS.filter(function (g) { return by[g]; }).map(function (g) { return '<section class="ov-g"><h4>' + g + '<span>' + by[g].length + '</span></h4><div class="bb-grid ov-grid">' + by[g].map(function (x) { return H.cell(Object.assign({}, x, { fit: 'meet' })); }).join('') + '</div></section>'; }).join('');
  };
})();
