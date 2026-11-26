/* Bowerbird prototype — a fictional third-party plugin「Forge」(community.forge), switched on from the review controls.
 * It shows what a creation plugin brings (ADR-016) and every slot a plugin can fill. None of this is the core:
 * the shell only draws the slots — 新建 menu, right-click items, a detail tab, a top-bar button, a side-bar section and a settings page —
 * shows the form each creation way declares, and lists the jobs the plugin reports next to the pipeline's own.
 * What a run hands back goes in through the one registration path; candidates nobody picked stay in a temporary folder on this computer. */
(function () {
  'use strict';
  var App = window.App, B = Bowerbird, I = B.icon, D = App.D, S = App.S, $ = App.$, $$ = App.$$, DEMO = B.demo;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  var PID = 'community.forge', VER = '0.4.0', NAME = 'Forge';
  var ON = false, TOOL = true, FAILS = 0, JOBS = [], jid = 0, USED = 312, QUOTA = 1000;
  var CFG = { endpoint: 'https://api.forge.example/v1', model: 'forge-xl 2.1', folder: '当前文件夹', key: true };

  /* the creation ways this plugin registers: id, name, params (shown as a form), inputs (role, kind, required) */
  var CREATORS = [
    { id: 'image', name: 'AI 生图', icon: 'image-plus',
      inputs: [{ role: '参考图', kind: 'image', required: false }],
      params: [{ k: 'prompt', label: '提示词', type: 'text', required: true, def: '' }, { k: 'negativePrompt', label: '不想要的', type: 'line', def: '' },
        { k: 'model', label: '模型', type: 'seg', opts: ['forge-xl 2.1', 'forge-lite 1.3'], def: 'forge-xl 2.1' }, { k: 'count', label: '数量', type: 'seg', opts: ['1', '2', '4'], def: '4' },
        { k: 'size', label: '尺寸', type: 'seg', opts: ['1024×1024', '1536×1536', '1920×1080'], def: '1536×1536' }, { k: 'seed', label: '种子', type: 'num', def: '', ph: '随机' }] },
    { id: 'model', name: '生成模型', icon: 'box',
      inputs: [{ role: '四视图', kind: 'image', grid: true, required: true }, { role: '设计对象', kind: 'doc', required: false }],
      params: [{ k: 'model', label: '模型', type: 'seg', opts: ['forge-3d 0.9'], def: 'forge-3d 0.9' }, { k: 'tris', label: '面数上限', type: 'num', def: '5000' },
        { k: 'tex', label: '贴图', type: 'seg', opts: ['1024', '2048'], def: '1024' }, { k: 'count', label: '数量', type: 'seg', opts: ['1', '2'], def: '2' }] }
  ];
  function creator(id) { return CREATORS.filter(function (c) { return c.id === id; })[0]; }
  function fits(inp, a) { return a && a.kind === inp.kind && (!inp.grid || !!a.grid) && a.state !== 'missing'; }

  /* ── the form the shell draws from a creation way's declaration ── */
  function form(cr, pre, again) {
    var vals = {}, ins = {};
    cr.params.forEach(function (p) { vals[p.k] = again && again.params[p.k] != null ? again.params[p.k] : p.def; });
    cr.inputs.forEach(function (inp) { var hit = (pre || []).filter(function (a) { return fits(inp, a); })[0]; if (hit) ins[inp.role] = hit; });
    if (cr.id === 'model' && ins['四视图'] && !ins['设计对象']) { var obj = D.rel(ins['四视图']).belongs.map(function (x) { return x.a; }).filter(Boolean)[0]; if (obj) ins['设计对象'] = obj; }
    if (again) Object.keys(again.ins).forEach(function (r) { ins[r] = App.byId(again.ins[r]) || ins[r]; });
    function inRow(inp) {
      var a = ins[inp.role];
      return '<div class="fg__in" data-role="' + inp.role + '"><span class="fg__role">' + inp.role + (inp.required ? '' : '<small>可选</small>') + '</span>' +
        (a ? '<span class="fg__asset"><span class="fg__th">' + (a.kind === 'doc' ? I('file-text') : DEMO.art(a.art, a)) + '</span><span class="text-mono-sm">' + esc(a.name) + '</span><button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" data-fg="clear" aria-label="移除">' + I('x', 'bb-icon--12') + '</button></span>'
          : '<button class="bb-btn bb-btn--sm" data-fg="pick">' + I('plus', 'bb-icon--12') + '选择…</button>') + '</div>';
    }
    function pRow(p) {
      var v = vals[p.k], f;
      if (p.type === 'text') f = '<div class="bb-field bb-field--area"><textarea class="bb-field__input" rows="3" data-p="' + p.k + '" aria-label="' + p.label + '" placeholder="' + (p.required ? '必填' : '') + '">' + esc(v) + '</textarea></div>';
      else if (p.type === 'seg') f = '<div class="bb-seg" role="radiogroup" aria-label="' + p.label + '" data-pseg="' + p.k + '"><i class="bb-seg__thumb"></i>' + p.opts.map(function (o) { return '<button class="bb-seg__item" role="radio" aria-checked="' + (o === v) + '" data-value="' + o + '">' + o + '</button>'; }).join('') + '</div>';
      else f = '<div class="bb-field' + (p.type === 'num' ? ' fg__num' : '') + '"><input class="bb-field__input" data-p="' + p.k + '" value="' + esc(v) + '" placeholder="' + (p.ph || '') + '" aria-label="' + p.label + '" autocomplete="off"></div>';
      return '<label class="fg__row"><span class="fg__k">' + p.label + '</span>' + f + '</label>';
    }
    function body() { return '<div class="fg"><div class="fg__ins">' + cr.inputs.map(inRow).join('') + '</div>' + cr.params.map(pRow).join('') + '<p class="fg__to">' + I('folder', 'bb-icon--12') + '放到 <span class="text-mono-sm">' + esc(target(ins)) + '</span></p></div>'; }
    var d = App.dialog({ wide: true, form: true, title: cr.name, foot: '<span class="fg__by">' + I('puzzle', 'bb-icon--12') + NAME + ' 提供</span>', body: body(),
      actions: [{ label: '取消' }, { label: '开始', kind: 'primary', icon: 'sparkles', keep: true, act: function (h) {
        var miss = cr.inputs.filter(function (inp) { return inp.required && !ins[inp.role]; })[0]; if (miss) return App.toast('先选一个' + miss.role);
        var need = cr.params.filter(function (p) { return p.required && !String(vals[p.k] || '').trim(); })[0]; if (need) { var t = $('[data-p="' + need.k + '"]', h); t.parentNode.setAttribute('data-invalid', ''); return t.focus(); }
        h.remove(); App.modal = !!$('.bb-scrim', App.el.layer); start(cr, vals, ins);
      } }] });
    function wire() {
      $$('[data-pseg]', d).forEach(function (sg) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (v) { vals[sg.dataset.pseg] = v; }); });
    }
    d.addEventListener('input', function (e) { var k = e.target.dataset.p; if (k) { vals[k] = e.target.value; e.target.parentNode.removeAttribute('data-invalid'); } });
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fg]'); if (!b) return; var role = b.closest('[data-role]').dataset.role, inp = cr.inputs.filter(function (x) { return x.role === role; })[0];
      if (b.dataset.fg === 'clear') { delete ins[role]; redraw(); return; }
      pickAsset(inp, function (a) { ins[role] = a; redraw(); });
    });
    function redraw() { var keep = {}; $$('[data-p]', d).forEach(function (x) { keep[x.dataset.p] = x.value; }); Object.assign(vals, keep); var f = $('.fg', d); f.outerHTML = body(); wire(); }
    wire(); setTimeout(function () { var t = $('[data-p="prompt"]', d); if (t) t.focus(); }, 0);
  }
  function target(ins) { var a = ins['四视图'] || ins['参考图']; return a ? a.folder : S.loc.type === 'folder' ? S.loc.id : 'ai-generated'; }
  function pickAsset(inp, done) {
    var q = '', list = D.assets.filter(function (a) { return fits(inp, a); });
    var d = App.dialog({ form: true, title: '选择' + inp.role, body: '<div class="bb-field">' + I('search') + '<input class="bb-field__input" id="fgq" placeholder="搜索" aria-label="搜索" autocomplete="off"></div><div class="cpl sw__list"></div>', actions: [{ label: '取消' }] });
    function draw() { $('.sw__list', d).innerHTML = list.filter(function (a) { return !q || a.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 40).map(function (a) { return '<button class="cpl__it" data-pick="' + a.id + '"><span class="cpk__t">' + (a.kind === 'doc' ? I('file-text') : DEMO.art(a.art, a)) + '</span><span class="text-mono-sm">' + esc(a.name) + '</span></button>'; }).join('') || '<p class="pop__none">没有可用的' + inp.role + '</p>'; }
    draw(); $('#fgq', d).addEventListener('input', function (e) { q = e.target.value.trim().toLowerCase(); draw(); }); setTimeout(function () { $('#fgq', d).focus(); }, 0);
    d.addEventListener('click', function (e) { var b = e.target.closest('[data-pick]'); if (!b) return; d.remove(); App.modal = !!$('.bb-scrim', App.el.layer); done(App.byId(b.dataset.pick)); });
  }

  /* ── jobs: queued next to the pipeline's tasks, reporting progress, cancellable ── */
  function start(cr, vals, ins) {
    var n = +vals.count || 1, j = { id: 'cj' + (++jid), cr: cr.id, icon: cr.icon, plugin: NAME, title: cr.name + ' · ' + n + (cr.id === 'model' ? ' 个' : ' 张'), state: 'running', p: 0, stateText: '排队中', params: Object.assign({}, vals), ins: {}, by: App.me(), folder: target(ins) };
    Object.keys(ins).forEach(function (r) { j.ins[r] = ins[r].id; });
    JOBS.unshift(j); App.syncBar(); refreshSide();
    if (!TOOL) return fail(j, '缺少外部工具 forge-cli');
    if (FAILS >= 5) return setTimeout(function () { fail(j, '服务没有响应（503）'); }, 900);
    App.toast('已开始' + cr.name, function () { App.openSettings('tasks'); }, '查看任务');
    j.timer = setInterval(function () {
      j.p = Math.min(100, j.p + (cr.id === 'model' ? 4 : 7)); j.stateText = j.p < 100 ? '生成中 ' + j.p + '%' : ''; App.syncBar();
      if (j.p < 100) return;
      clearInterval(j.timer); j.cands = cands(j, n);
      if (n === 1) return keep(j, [0]);
      j.state = 'pick'; j.stateText = '等你挑选 · ' + n + (cr.id === 'model' ? ' 个' : ' 张'); App.syncBar(); refreshSide();
      App.toast(cr.name + '完成，挑出要留下的', function () { pick(j.id); }, '挑选…');
    }, 260);
  }
  function fail(j, why) {
    j.state = 'failed'; j.stateText = why; FAILS++; App.syncBar(); refreshSide();
    App.toast(NAME + '：' + why, function () { App.openSettings('plugins', PID); }, '查看');
  }
  function cancel(id) { var j = JOBS.filter(function (x) { return x.id === id; })[0]; if (!j || j.state !== 'running') return; clearInterval(j.timer); j.state = 'cancelled'; j.stateText = '已取消'; App.syncBar(); refreshSide(); App.toast('已取消' + j.title); }
  /* candidates live in this computer's temporary folder until one is picked; they never enter the library */
  function cands(j, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(j.cr === 'model' ? { name: 'chest_forge.glb', kind: 'model', variant: i ? 'v1' : '', id: 'cand' + j.id + i } : { art: 'render', hue: (j.id.length * 53 + i * 71) % 360, ar: 1, kind: 'image', name: 'forge_' + (i + 1) + '.png' });
    return out;
  }
  function candArt(j, c) { if (j.cr === 'model') { if (!c.snap && App.m3 && App.m3.snap) c.snap = App.m3.snap(c, 256); return c.snap ? '<img src="' + c.snap + '" alt="">' : I('box'); } return DEMO.art('render', Object.assign({ fit: 'meet' }, c)); }
  function pick(id) {
    var j = JOBS.filter(function (x) { return x.id === id; })[0]; if (!j || j.state !== 'pick') return; var on = [0];
    function grid() { return '<div class="fgp">' + j.cands.map(function (c, i) { return '<button class="fgp__c" role="checkbox" aria-checked="' + (on.indexOf(i) >= 0) + '" data-c="' + i + '"><span class="fgp__t">' + candArt(j, c) + '</span><i class="fgp__k">' + I('check', 'bb-icon--12') + '</i><span class="fgp__n vw__num">' + (i + 1) + '</span></button>'; }).join('') + '</div>'; }
    var d = App.dialog({ wide: true, form: true, title: '挑选 · ' + esc(j.title), body: grid() + '<p class="fgp__note">没选中的不进资产库，只在这台电脑上临时保留。</p>',
      actions: [{ label: '稍后' }, { label: '留下 1 个', kind: 'primary', keep: true, act: function (h) { if (!on.length) return; h.remove(); App.modal = !!$('.bb-scrim', App.el.layer); keep(j, on.slice().sort()); } }] });
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]'); if (!b) return; var i = +b.dataset.c, k = on.indexOf(i); if (k >= 0) on.splice(k, 1); else on.push(i);
      $('.fgp', d).outerHTML = grid(); var ok = d.querySelector('[data-k="1"]'); ok.disabled = !on.length; ok.textContent = on.length ? '留下 ' + on.length + ' 个' : '至少选一个';
    });
  }
  /* what is kept goes through the one registration path: file, folder, stage, record with the plugin, the inputs and their roles */
  function keep(j, idx) {
    var cr = creator(j.cr), at = D.tick(), inputs = Object.keys(j.ins).map(function (r) { var a = App.byId(j.ins[r]); return { role: r, id: j.ins[r], name: a ? a.name : '' }; });
    var P = j.params, params = cr.id === 'image' ? 'model ' + P.model + ' · ' + P.size + (P.seed ? ' · seed ' + P.seed : ' · seed ' + (1000 + jid * 37)) + (P.negativePrompt ? ' · negativePrompt ' + P.negativePrompt : '') : 'model ' + P.model + ' · 面数上限 ' + P.tris + ' · 贴图 ' + P.tex;
    var rec = D.addRecord({ method: PID + '/' + cr.id, tool: NAME + ' ' + VER, plugin: PID + '@' + VER, by: j.by, at: D.fmtAt(at), prompt: cr.id === 'image' ? P.prompt : null, params: params, inputs: inputs });
    var made = idx.map(function (i, n) {
      var c = j.cands[i], stem = cr.id === 'model' ? 'chest_forge' : 'forge_' + String(at).slice(-4), ext = cr.id === 'model' ? '.glb' : '.png', k = 1, nm = stem + (idx.length > 1 || cr.id === 'image' ? '_' + (n + 1) : '') + ext;
      while (D.assets.some(function (x) { return x.folder === j.folder && x.name === nm; })) nm = stem + '_' + (++k) + ext;
      var a = { id: '0192f3a4-7c1e-7b52-9d06-' + (Date.now() + n).toString(16).slice(-12).padStart(12, '0'), name: nm, folder: j.folder, path: j.folder + '/' + nm, kind: cr.id === 'model' ? 'model' : 'image', stage: 'production', review: 'pending', tags: [], aiTags: [], by: j.by, modified: at, origin: rec, bytes: cr.id === 'model' ? 1.4e6 : 2.2e6 };
      if (cr.id === 'model') { a.state = 'waiting'; a.variant = c.variant; a.tris = Math.min(+P.tris || 5000, 2600); a.info = a.tris.toLocaleString('en-US') + ' 面'; }
      else { var wh = P.size.split('×'); a.art = 'render'; a.hue = c.hue; a.ar = (+wh[0]) / (+wh[1]); a.w = +wh[0]; a.h = +wh[1]; a.info = P.size; }
      D.assets.unshift(a); D.counts.all++; D.counts.pending++;
      inputs.forEach(function (x) { var src = App.byId(x.id); if (src) D.addEdge(a, 'source', src, { rec: rec, role: x.role }); });
      return a;
    });
    j.state = 'done'; j.stateText = '已登记 ' + made.length + ' 个'; j.made = made.map(function (a) { return a.id; }); App.syncBar();
    if (S.loc.type !== 'folder' || S.loc.id !== j.folder) App.go({ type: 'folder', id: j.folder });
    S.sel = made.map(function (a) { return a.id; }); S.focus = made[0].id; App.render(true); refreshSide();
    App.toast('已登记 ' + (made.length > 1 ? made.length + ' 个' : made[0].name));
  }

  /* ── slots ── */
  function newMenu(anchor) {
    App.menu([{ icon: 'upload', label: '上传文件…', act: function () { App.upload(); } }, 'sep', { header: NAME }].concat(CREATORS.map(function (c) { return { icon: c.icon, label: c.name + '…', act: function () { form(c, S.sel.map(App.byId).filter(Boolean)); } }; })), anchor);
  }
  /* right-click: a creation way shows up when the selection fits one of its required inputs (the turnaround → 生成模型) */
  function ctxItems(as) {
    var out = CREATORS.filter(function (c) { var req = c.inputs.filter(function (x) { return x.required; }); return req.length && as.length === 1 && req.every(function (x) { return fits(x, as[0]); }); })
      .map(function (c) { return { icon: c.icon, label: c.name + '…', hint: NAME, act: function () { form(c, as); } }; });
    return out.length ? out.concat(['sep']) : [];
  }
  /* a detail tab on what Forge made: the run's settings, and the same form again */
  function recOf(a) { var r = a && a.origin && D.RECS[a.origin]; return r && r.plugin && r.plugin.indexOf(PID) === 0 ? r : null; }
  function tabs(a) { return recOf(a) ? [['plug:forge', NAME]] : []; }
  function tabHtml(a) {
    var r = recOf(a); if (!r) return '';
    return '<section class="fgt"><h4>' + I('puzzle', 'bb-icon--12') + NAME + ' 的这次生成</h4>' + B.html.kv([['方式', '<span class="text-mono-sm">' + esc(r.method) + '</span>'], ['发起', '<span class="text-mono-sm">' + esc(App.who(r.by)) + '</span> · ' + esc(r.at)], ['参数', esc(r.params)]].concat(r.inputs.map(function (x) { return [x.role, '<span class="text-mono-sm">' + esc(x.name) + '</span>']; }))) +
      (r.prompt ? '<pre class="prompt">' + esc(r.prompt) + '</pre>' : '') + '<div class="fgt__act"><button class="bb-btn" data-forge-again="' + a.id + '">' + I('refresh-cw') + '用同样的设置再生成…</button></div></section>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-forge-again]'); if (!b) return; var a = App.byId(b.dataset.forgeAgain), r = recOf(a); if (!r) return;
    var cr = creator(r.method.split('/')[1]), p = {}, ins = {};
    cr.params.forEach(function (x) { p[x.k] = x.def; }); if (r.prompt) p.prompt = r.prompt; r.inputs.forEach(function (x) { ins[x.role] = x.id; });
    form(cr, [], { params: p, ins: ins });
  });
  /* a top-bar button: this month's usage of the service behind it */
  function toolbar() { return '<button class="bb-btn bb-btn--ghost fg__tb" data-forge-tb title="' + NAME + '">' + I('wand-sparkles') + '<span class="vw__num">' + (QUOTA - USED) + '</span></button>'; }
  function toolbarPop(anchor) {
    App.pop('<h5>' + NAME + ' 本月额度</h5><div class="fg__q"><span class="bb-progress" style="--p:' + Math.round(USED / QUOTA * 100) + '%"><i></i></span><span class="vw__num">' + USED + ' / ' + QUOTA + '</span></div><button class="bb-btn bb-btn--sm" data-pop="forge-set">' + NAME + ' 设置</button>', anchor);
  }
  App.el.layer.addEventListener('click', function (e) { if (e.target.closest('[data-pop="forge-set"]')) { App.closeTop(); App.openSettings('plugins', PID, true); } });
  App.el.bar.addEventListener('click', function (e) { var b = e.target.closest('[data-forge-tb]'); if (b) toolbarPop(b); });
  /* a side-bar section: recent runs */
  function side() {
    var js = JOBS.slice(0, 4);
    return '<div class="bb-section-label">' + NAME + '</div>' + (js.length ? js.map(function (j) { return '<div class="bb-row fg__sr" data-forge-job="' + j.id + '">' + I(j.state === 'failed' ? 'circle-alert' : j.state === 'pick' ? 'circle-dot' : j.state === 'running' ? 'loader' : j.icon, 'bb-icon--12' + (j.state === 'running' ? ' fg__spin' : '')) + '<span class="bb-row__label">' + esc(j.title) + '</span><span class="bb-row__count">' + (j.state === 'running' ? j.p + '%' : j.state === 'pick' ? '待挑选' : j.state === 'failed' ? '失败' : j.state === 'cancelled' ? '已取消' : '') + '</span></div>'; }).join('') : '<div class="fg__none">还没有生成过</div>');
  }
  function refreshSide() { if (App.renderSide) App.renderSide(); }
  App.el.side.addEventListener('click', function (e) {
    var r = e.target.closest('[data-forge-job]'); if (!r) return; var j = JOBS.filter(function (x) { return x.id === r.dataset.forgeJob; })[0]; if (!j) return;
    if (j.state === 'pick') return pick(j.id); if (j.state === 'done' && j.made) { var a = App.byId(j.made[0]); if (a) { App.go({ type: 'folder', id: a.folder }); S.sel = j.made.slice(); S.focus = j.made[0]; App.render(); } return; }
    App.openSettings('tasks');
  });
  /* a settings page: where each setting is kept is declared by the plugin (with the library, or on this computer only — credentials always local) */
  function setHtml() {
    function r(k, v, scope) { return '<div class="st__row"><span class="st__k">' + k + '</span><span class="st__v">' + v + '</span><small class="st__note">' + (scope === 'lib' ? '随资产库' : '只在本机') + '</small></div>'; }
    return '<section class="st__card">' + r('服务地址', '<span class="text-mono-sm">' + CFG.endpoint + '</span>', 'local') + r('访问密钥', CFG.key ? '<span class="text-mono-sm">fk_••••••••3a9c</span><button class="bb-btn bb-btn--ghost bb-btn--sm" data-forge-key>更换…</button>' : '<button class="bb-btn bb-btn--sm" data-forge-key>填写…</button>', 'local') +
      r('默认模型', CFG.model, 'lib') + r('产出放到', CFG.folder, 'lib') + r('外部工具', TOOL ? '<span class="text-mono-sm">forge-cli 2.3.0</span>' : '<span class="pl__why pl__why--warn">' + I('triangle-alert', 'bb-icon--12') + '没找到 forge-cli</span>', 'local') + '</section>';
  }
  function card() {
    return { id: PID, name: NAME, icon: 'wand-sparkles', ver: VER, caps: CREATORS.map(function (c) { return '创建：' + c.name; }).concat(['详情页签', '顶栏按钮', '左栏分区']), st: 'on', set: [['服务地址', CFG.endpoint]], setHtml: setHtml,
      warn: !TOOL ? '需要外部工具 forge-cli，这台电脑上没找到' : FAILS >= 5 ? '最近 ' + FAILS + ' 次创建都失败了：服务没有响应（503）' : null };
  }
  /* review controls: with or without a creation plugin, and its two trouble states */
  App.demoExtra = function () {
    return ['sep', { header: '创建插件' },
      { label: '有（' + NAME + '）', check: ON, act: function () { set(true); } }, { label: '无', check: !ON, act: function () { set(false); } }].concat(ON ? [
      { label: '缺少外部工具', check: !TOOL, act: function () { TOOL = !TOOL; App.render(); } },
      { label: '连续失败', check: FAILS >= 5, act: function () { FAILS = FAILS >= 5 ? 0 : 5; App.render(); } }] : []);
  };
  function set(on) { ON = on; if (!on) JOBS.forEach(function (j) { clearInterval(j.timer); }); App.render(); App.syncBar(); if (App.detailRefresh) App.detailRefresh(); }

  App.dream = { on: function () { return ON; }, card: card, jobs: function () { return ON ? JOBS : []; }, cancel: cancel, pick: pick, newMenu: newMenu, ctxItems: function (as) { return ON ? ctxItems(as) : []; },
    tabs: function (a) { return ON ? tabs(a) : []; }, tabHtml: tabHtml, toolbar: function () { return ON ? toolbar() : ''; }, toolbarPop: toolbarPop, side: function () { return ON ? side() : ''; } };
})();
