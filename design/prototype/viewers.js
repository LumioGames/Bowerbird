/* Bowerbird prototype — viewers. Each one is a self-contained module, as a format plugin would provide:
 * App.mountViewer(host, asset, { compact }) builds <div class="vw"> with the plugin's own tool bar and stage.
 * image · video · audio · doc, plus the states where no viewer can run. */
(function () {
  'use strict';
  var App = window.App, B = Bowerbird, I = B.icon, H = B.html, D = App.D, S = App.S, el = App.el, $ = App.$, $$ = App.$$, DEMO = B.demo, L = H.labels;
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function ext(a) { return a.name.split('.').pop().toLowerCase(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function seg(label, items, cur) { return '<div class="bb-seg" role="radiogroup" aria-label="' + label + '"><i class="bb-seg__thumb"></i>' + items.map(function (it) { return '<button class="bb-seg__item" role="radio" aria-checked="' + (it[0] === cur) + '" data-value="' + it[0] + '"' + (it[2] ? ' title="' + it[2] + '"' : '') + '>' + it[1] + '</button>'; }).join('') + '</div>'; }
  function tc(t) { var s = Math.floor(t), m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + ('0' + (s % 60)).slice(-2) + '.' + ('0' + Math.floor((t - s) * 100)).slice(-2); }
  document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + [['r', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 1 0'], ['g', '0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 1 0'], ['b', '0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 1 0'], ['a', '0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 1']].map(function (f) { return '<filter id="ch-' + f[0] + '" color-interpolation-filters="sRGB"><feColorMatrix values="' + f[1] + '"/></filter>'; }).join('') + '</svg>');

  /* ───────── image ───────── */
  function imageViewer(v, a) {
    var cells = App.cellsOf ? App.cellsOf(a) : null;
    var st = { z: 1, x: 0, y: 0, bg: a.alpha ? 'checker' : 'well', ch: 'rgb', tile: false }, base = { w: 1, h: 1 }, ar = a.w && a.h ? a.w / a.h : (a.ar || 1), ctx = null, url = null;
    var cw = Math.min(a.w || 1024, 1024), chh = Math.max(1, Math.round(cw / ar));
    /* animated images (GIF) get playback controls at the front of the bar */
    var gif = a.frames ? { n: a.frames, i: 0, play: false, raf: 0, acc: 0, last: 0 } : null;
    function frameArt(i) { return DEMO.art(a.art, gif ? Object.assign({}, a, { frame: i }) : a); }
    var art = frameArt(0);
    v.bar.innerHTML = (gif ? '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="gplay" aria-label="播放" title="播放 空格"></button><button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="gprev" aria-label="上一帧" title="上一帧">' + I('chevron-left') + '</button><button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="gnext" aria-label="下一帧" title="下一帧">' + I('chevron-right') + '</button><span class="vw__num" data-gf></span><i class="bb-toolbar__sep"></i>' : '') +
      (cells ? '<span data-views>' + seg('视图', [['all', '整图']].concat(['front', 'side', 'back', 'top'].filter(function (k) { return cells[k]; }).map(function (k) { return [k, App.VLAB[k]]; })), 'all') + '</span><i class="bb-toolbar__sep"></i>' : '') + '<button class="bb-btn bb-btn--ghost bb-btn--sm" data-v="fit" title="适应窗口">适应</button><button class="bb-btn bb-btn--ghost bb-btn--sm" data-v="one" title="原始大小">1:1</button><span class="vw__num" data-zoom></span><i class="bb-toolbar__sep"></i>' +
      [['checker', '棋盘格'], ['black', '黑'], ['white', '白']].map(function (b) { return '<button class="swb swb--' + b[0] + '" data-bg="' + b[0] + '" aria-pressed="' + (st.bg === b[0]) + '" aria-label="' + b[1] + '背景" title="' + b[1] + '"></button>'; }).join('') + '<label class="swb swb--pick" title="自定义颜色"><input type="color" value="#3b6ea8" aria-label="自定义背景颜色"></label><i class="bb-toolbar__sep"></i>' +
      seg('通道', [['rgb', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B'], ['a', 'A', '透明度']], 'rgb') + '<i class="bb-toolbar__sep"></i><button class="bb-btn bb-btn--ghost bb-btn--sm" data-v="tile" aria-pressed="false">' + I('layout-grid', 'bb-icon--12') + '平铺</button><span class="bb-toolbar__grow"></span><span class="pal"></span>';
    v.stage.innerHTML = '<div class="iv"><div class="iv__img"></div></div><div class="iv__read" hidden></div>';
    var wrap = $('.iv', v.stage), img = $('.iv__img', v.stage), read = $('.iv__read', v.stage);
    function pct() { return Math.round(st.z * base.w / (a.w || 1024) * 100); }
    function apply(anim) { wrap.classList.toggle('anim', !!anim); wrap.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.z + ')'; var zl = $('[data-zoom]', v.bar); if (zl) zl.textContent = pct() + '%'; img.classList.toggle('px', pct() > 200); }
    function draw() {
      var one = url && !(gif && gif.play) ? '<img src="' + url + '" alt="" draggable="false">' : art;
      img.innerHTML = st.tile ? new Array(10).join(one) : one; img.classList.toggle('tile', st.tile); img.style.filter = st.ch === 'rgb' ? '' : 'url(#ch-' + st.ch + ')';
      v.stage.className = 'vw__stage bg-' + (st.bg[0] === '#' ? 'custom' : st.bg); v.stage.style.background = st.bg[0] === '#' ? st.bg : '';
      $$('[data-bg]', v.bar).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.bg === st.bg); });
    }
    function layout() { var W = v.stage.clientWidth - 48, Hh = v.stage.clientHeight - 48; if (W < 10) return; base.w = Math.min(W, Hh * ar); base.h = base.w / ar; var k = st.tile ? 3 : 1; img.style.width = base.w * k + 'px'; img.style.height = base.h * k + 'px'; apply(); }
    function zoomAt(z2, mx, my, anim) { z2 = clamp(z2, 0.2, 40); st.x = mx - (mx - st.x) * (z2 / st.z); st.y = my - (my - st.y) * (z2 / st.z); st.z = z2; apply(anim); }
    v.stage.addEventListener('wheel', function (e) { e.preventDefault(); var r = v.stage.getBoundingClientRect(); zoomAt(st.z * Math.exp(-e.deltaY * 0.0018), (e.clientX - r.left - r.width / 2) / S.zoom, (e.clientY - r.top - r.height / 2) / S.zoom); }, { passive: false });
    var drag = null;
    v.stage.addEventListener('pointerdown', function (e) { if (e.button) return; v.stage.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y }; v.stage.classList.add('grabbing'); });
    v.stage.addEventListener('pointermove', function (e) {
      if (drag) { st.x = drag.sx + (e.clientX - drag.x) / S.zoom; st.y = drag.sy + (e.clientY - drag.y) / S.zoom; apply(); }
      if (!ctx) return; var r = img.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, w = (e.clientY - r.top) / r.height;
      if (st.tile) { u = (u * 3) % 1; w = (w * 3) % 1; }
      if (u < 0 || u >= 1 || w < 0 || w >= 1) return (read.hidden = true);
      try { var p = ctx.getImageData(Math.floor(u * cw), Math.floor(w * chh), 1, 1).data, hex = '#' + [p[0], p[1], p[2]].map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('').toUpperCase(); read.hidden = false; read.innerHTML = '<i style="background:' + hex + ';opacity:' + (p[3] / 255).toFixed(2) + '"></i>x ' + Math.floor(u * (a.w || 1024)) + '&nbsp; y ' + Math.floor(w * (a.h || 1024)) + '&nbsp; ' + hex + (p[3] < 255 ? '&nbsp; α ' + Math.round(p[3] / 2.55) + '%' : ''); } catch (err) { ctx = null; }
    });
    function up() { drag = null; v.stage.classList.remove('grabbing'); }
    v.stage.addEventListener('pointerup', up); v.stage.addEventListener('pointercancel', up); v.stage.addEventListener('pointerleave', function () { read.hidden = true; });
    v.stage.addEventListener('dblclick', function () { st.x = st.y = 0; st.z = st.z > 1.01 ? 1 : 2; apply(true); });
    v.bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'), g = e.target.closest('[data-bg]'), sw = e.target.closest('.pal button');
      if (g) { st.bg = g.dataset.bg; return draw(); }
      if (sw) { try { navigator.clipboard.writeText(sw.title).catch(function () {}); } catch (err) { /* clipboard may be refused */ } return App.toast('已复制 ' + sw.title); }
      if (!b) return;
      if (b.dataset.v === 'fit') { st.x = st.y = 0; st.z = 1; apply(true); }
      if (b.dataset.v === 'one') { st.x = st.y = 0; st.z = (a.w || 1024) / base.w; apply(true); }
      if (b.dataset.v === 'tile') { st.tile = !st.tile; b.setAttribute('aria-pressed', st.tile); st.x = st.y = 0; st.z = st.tile ? 1 / 3 * 1.6 : 1; draw(); layout(); }
      if (b.dataset.v === 'gplay') gifToggle();
      if (b.dataset.v === 'gprev' || b.dataset.v === 'gnext') gifStep(b.dataset.v === 'gnext' ? 1 : -1);
    });
    function gifUi() { if (!gif) return; var p = $('[data-v="gplay"]', v.bar), f = $('[data-gf]', v.bar); if (p) p.innerHTML = I(gif.play ? 'pause' : 'play'); if (f) f.textContent = '帧 ' + (gif.i + 1) + ' / ' + gif.n; }
    function gifTick(now) { gif.acc += now - gif.last; gif.last = now; var step = 1000 / (a.fps || 12); while (gif.acc >= step) { gif.acc -= step; gif.i = (gif.i + 1) % gif.n; } art = frameArt(gif.i); draw(); gifUi(); if (gif.play) gif.raf = requestAnimationFrame(gifTick); }
    function gifToggle() { gif.play = !gif.play; if (gif.play) { ctx = null; read.hidden = true; gif.last = performance.now(); gif.acc = 0; gif.raf = requestAnimationFrame(gifTick); } else { cancelAnimationFrame(gif.raf); rasterize(); } gifUi(); }
    function gifStep(d) { if (gif.play) { gif.play = false; cancelAnimationFrame(gif.raf); } gif.i = (gif.i + d + gif.n) % gif.n; art = frameArt(gif.i); url = null; ctx = null; draw(); gifUi(); rasterize(); }
    var pick = $('input[type=color]', v.bar); if (pick) pick.addEventListener('input', function () { st.bg = pick.value; draw(); });
    var sg = null; Array.prototype.forEach.call(v.bar.querySelectorAll('.bb-seg'), function (x) { if (!x.closest('[data-views]')) sg = x; }); if (sg) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (val) { st.ch = val; draw(); }); }
    /* a sheet with a grid (ADR-019): jump between the whole sheet and each view */
    var vsg = $('[data-views] .bb-seg', v.bar); if (vsg) { vsg.setAttribute('data-wired', ''); B.segmented(vsg, function (val) { if (val === 'all') { st.x = st.y = 0; st.z = 1; return apply(true); } var c = cells[val], z = Math.min(1 / c[2], 1 / c[3]) * 0.94; st.z = z; st.x = -((c[0] + c[2] / 2) - 0.5) * base.w * z; st.y = -((c[1] + c[3] / 2) - 0.5) * base.h * z; apply(true); }); }
    /* rasterise the shown frame: the hover read-out, the pixel view and the dominant colours all read from it */
    function rasterize() {
    var im = new Image(), src = art;
    im.onload = function () {
      if (src !== art || (gif && gif.play)) return;
      try {
        var c = document.createElement('canvas'); c.width = cw; c.height = chh; var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, cw, chh); var d = x.getImageData(0, 0, cw, chh).data, n = {}; ctx = x;
        for (var i = 0; i < d.length; i += 4 * 7) { if (d[i + 3] < 200) continue; var k = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4); n[k] = (n[k] || 0) + 1; }
        var top = Object.keys(n).sort(function (p, q) { return n[q] - n[p]; }), out = [];
        top.forEach(function (k) { if (out.length >= 5) return; var r = k >> 8, g = (k >> 4) & 15, b = k & 15; if (out.every(function (o) { return Math.abs(o[0] - r) + Math.abs(o[1] - g) + Math.abs(o[2] - b) > 5; })) out.push([r, g, b]); });
        var pal = $('.pal', v.bar); if (pal) pal.innerHTML = out.map(function (o) { var hex = '#' + o.map(function (n) { return (n * 17 < 16 ? '0' : '') + (n * 17).toString(16); }).join('').toUpperCase(); return '<button style="background:' + hex + '" title="' + hex + '" aria-label="复制 ' + hex + '"></button>'; }).join('');
        url = c.toDataURL(); draw();
      } catch (err) { ctx = null; }
    };
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="' + cw + '" height="' + chh + '" '));
    }
    rasterize(); draw(); layout(); gifUi(); if (gif && v.opts.compact) gifToggle();
    var ro = new ResizeObserver(layout); ro.observe(v.stage);
    return {
      destroy: function () { ro.disconnect(); if (gif) cancelAnimationFrame(gif.raf); },
      key: gif ? function (e) { if (e.key === ' ') { gifToggle(); return true; } } : null
    };
  }

  /* ───────── video ───────── */
  function frameSvg(t, dur) {
    var k = clamp((t / dur - 0.22) / 0.4, 0, 1); k = k * k * (3 - 2 * k);
    return '<svg class="bb-art" viewBox="0 0 240 135" preserveAspectRatio="xMidYMid meet"><rect width="240" height="135" fill="#1b2230"/><rect y="100" width="240" height="35" fill="#141a25"/><g transform="translate(40 -14)"><g opacity="' + (1 - k).toFixed(3) + '">' + DEMO.chest(null, false) + '</g><g opacity="' + k.toFixed(3) + '">' + DEMO.chest(null, true) + '</g></g></svg>';
  }
  App.videoFrame = frameSvg;
  function videoViewer(v, a) {
    var dur = a.dur || 3, fps = 30, st = { t: 0, play: false, loop: true, speed: 1, a: 0, b: dur }, raf = 0, last = 0;
    v.bar.innerHTML = '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="play" aria-label="播放" title="播放 空格"></button><button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="prev" aria-label="上一帧" title="上一帧">' + I('chevron-left') + '</button><button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="next" aria-label="下一帧" title="下一帧">' + I('chevron-right') + '</button><span class="vw__num" data-tc></span><i class="bb-toolbar__sep"></i>' +
      '<button class="bb-btn bb-btn--ghost bb-btn--sm" data-v="loop" aria-pressed="true">循环</button>' + seg('倍速', [['0.5', '0.5×'], ['1', '1×'], ['2', '2×']], '1') + I('volume-2') + '<input class="bb-slider" type="range" min="0" max="100" value="80" aria-label="音量" style="width:64px"><i class="bb-toolbar__sep"></i>' +
      '<button class="bb-btn bb-btn--ghost bb-btn--sm" data-v="in" title="把入点设在当前位置">入点</button><button class="bb-btn bb-btn--ghost bb-btn--sm" data-v="out" title="把出点设在当前位置">出点</button><span class="bb-toolbar__grow"></span>' +
      '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="more" aria-label="更多" title="更多">' + I('ellipsis') + '</button>';
    v.stage.innerHTML = '<div class="vv"></div>'; v.foot.hidden = false;
    v.foot.innerHTML = '<div class="tl"><div class="tl__range"></div><div class="tl__head"></div></div>';
    var scr = $('.vv', v.stage), tl = $('.tl', v.foot), rg = $('.tl__range', tl), hd = $('.tl__head', tl);
    function paint() {
      scr.innerHTML = frameSvg(st.t, dur); hd.style.left = st.t / dur * 100 + '%'; rg.style.left = st.a / dur * 100 + '%'; rg.style.width = (st.b - st.a) / dur * 100 + '%';
      var c = $('[data-tc]', v.bar); if (c) c.textContent = tc(st.t) + '  ·  帧 ' + Math.round(st.t * fps) + ' / ' + Math.round(dur * fps);
      var p = $('[data-v="play"]', v.bar); if (p) p.innerHTML = I(st.play ? 'pause' : 'play');
    }
    function tick(now) { var dt = (now - last) / 1000; last = now; st.t += dt * st.speed; if (st.t >= st.b) { if (st.loop) st.t = st.a; else { st.t = st.b; st.play = false; } } paint(); if (st.play) raf = requestAnimationFrame(tick); }
    function toggle() { st.play = !st.play; if (st.play) { if (st.t >= st.b - 0.01) st.t = st.a; last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); paint(); }
    function seek(e) { var r = tl.getBoundingClientRect(); st.t = clamp((e.clientX - r.left) / r.width, 0, 1) * dur; paint(); }
    var held = false;
    tl.addEventListener('pointerdown', function (e) { tl.setPointerCapture(e.pointerId); held = true; seek(e); });
    tl.addEventListener('pointermove', function (e) { if (held) seek(e); });
    tl.addEventListener('pointerup', function () { held = false; }); tl.addEventListener('pointercancel', function () { held = false; });
    v.stage.addEventListener('click', toggle);
    v.bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return; var k = b.dataset.v;
      if (k === 'play') toggle();
      if (k === 'prev' || k === 'next') { st.t = clamp(Math.round(st.t * fps + (k === 'next' ? 1 : -1)) / fps, 0, dur); paint(); }
      if (k === 'loop') { st.loop = !st.loop; b.setAttribute('aria-pressed', st.loop); }
      if (k === 'in') { st.a = Math.min(st.t, st.b - 0.1); paint(); } if (k === 'out') { st.b = Math.max(st.t, st.a + 0.1); paint(); }
      if (k === 'more') return App.menu([{ icon: 'image', label: '把当前帧设为缩略图', act: function () { App.toast('已把第 ' + Math.round(st.t * fps) + ' 帧设为缩略图'); } }, { icon: 'download', label: '把当前帧另存为图片资产', act: saveFrame }], b);
    });
    function saveFrame() {
      {
        var n = a.name.replace(/\.\w+$/, '') + '_f' + ('00' + Math.round(st.t * fps)).slice(-3) + '.png', img = D.mk(n, a.folder, 'image', { art: 'video', vb: [160, 160], stage: a.stage, review: 'pending', info: '1280×720', w: 1280, h: 720, tags: a.tags.slice(), by: App.me(), modified: D.tick() });
        D.assets.splice(D.assets.indexOf(a) + 1, 0, img);
        D.addEdge(img, 'source', a, { rec: D.addRecord({ method: '截帧', tool: 'Bowerbird 视频查看器', by: App.me(), at: D.fmtAt(img.modified), params: '第 ' + Math.round(st.t * fps) + ' 帧 · 1280×720' }) });
        D.rel(a).belongs.forEach(function (x) { if (x.a) D.addEdge(img, 'belongs', x.a); });
        App.toast('已另存为 ' + n + '，来源指向这个视频'); App.renderInsp();
      }
    }
    var sg = $('.bb-seg', v.bar); if (sg) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (val) { st.speed = +val; }); }
    var sl = $('.bb-slider', v.bar); if (sl) B.slider(sl);
    v.foot.firstChild.insertAdjacentHTML('afterbegin', '<div class="tl__strip">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return frameSvg((i + 0.5) / 10 * dur, dur); }).join('') + '</div>');
    paint(); if (v.opts.compact && !v.opts.still) toggle();
    return { destroy: function () { cancelAnimationFrame(raf); }, key: function (e) { if (e.key === ' ') { toggle(); return true; } } };
  }

  /* ───────── audio ───────── */
  var AC = null;
  function synth(a, from, vol) {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume();
      var dur = Math.min(a.dur || 1, 8) - from; if (dur <= 0.02) return null;
      var n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0), long = a.env === 'long';
      for (var i = 0; i < n; i++) { var t = from + i / AC.sampleRate; d[i] = long ? (Math.sin(6.283 * 220 * t) * 0.12 + Math.sin(6.283 * 330 * t) * 0.07) * (0.6 + 0.4 * Math.sin(t * 3)) : (Math.random() * 2 - 1) * Math.exp(-t * 10) * 0.4 + Math.sin(6.283 * (190 - 70 * t) * t) * Math.exp(-t * 5) * 0.35; }
      var src = AC.createBufferSource(), g = AC.createGain(); g.gain.value = vol; src.buffer = buf; src.connect(g); g.connect(AC.destination); src.start();
      return { stop: function () { try { src.stop(); } catch (e) { /* already stopped */ } }, gain: g };
    } catch (e) { return null; }
  }
  function peaks(a, n) { var out = [], r = a.seed || 11, hit = a.env !== 'long'; for (var i = 0; i < n; i++) { r = (r * 9301 + 49297) % 233280; var t = i / n, e = hit ? Math.exp(-t * 5) * (t < 0.03 ? t / 0.03 : 1) : 0.4 + 0.6 * Math.abs(Math.sin(t * 7 + r % 3)); out.push((0.35 + 0.65 * r / 233280) * e); } return out; }
  function audioViewer(v, a) {
    var dur = a.dur || 1, st = { t: 0, play: false, loop: false, a: null, b: null, vol: 0.8, view: 'wave' }, raf = 0, last = 0, snd = null, P = peaks(a, 220), clip = a.env === 'long' ? [0.31, 0.74] : [0.035];
    v.bar.innerHTML = '<button class="bb-btn bb-btn--ghost bb-btn--icon" data-v="play" aria-label="播放" title="播放 空格"></button><span class="vw__num" data-tc></span><i class="bb-toolbar__sep"></i><button class="bb-btn bb-btn--ghost bb-btn--sm" data-v="loop" aria-pressed="false">循环</button>' + I('volume-2') + '<input class="bb-slider" type="range" min="0" max="100" value="80" aria-label="音量" style="width:64px"><i class="bb-toolbar__sep"></i>' + seg('显示', [['wave', '波形'], ['spec', '频谱']], 'wave') +
      '<span class="bb-toolbar__grow"></span><span class="vw__num">−16.2 LUFS</span><span class="vw__num">峰值 −0.1 dB</span><span class="bb-issue" data-level="error">' + I('triangle-alert', 'bb-icon--12') + '<span>削波 ' + clip.length + ' 处</span></span>';
    var bars = P.map(function (h, i) { return '<rect x="' + (i * 1000 / 220).toFixed(1) + '" y="' + (100 - h * 92).toFixed(1) + '" width="2.6" height="' + (h * 184).toFixed(1) + '" rx="1"/>'; }).join('');
    v.stage.innerHTML = '<div class="av"><svg class="av__w" viewBox="0 0 1000 200" preserveAspectRatio="none">' + bars + '</svg><div class="av__p"><svg class="av__w" viewBox="0 0 1000 200" preserveAspectRatio="none">' + bars + '</svg></div><canvas class="av__s" width="440" height="96" hidden></canvas>' + clip.map(function (c) { return '<i class="av__clip" style="left:' + c * 100 + '%" title="削波"></i>'; }).join('') + '<div class="av__sel" hidden></div><div class="av__head"></div></div>';
    var box = $('.av', v.stage), played = $('.av__p', box), head = $('.av__head', box), selEl = $('.av__sel', box), spec = $('.av__s', box);
    function paint() {
      var p = st.t / dur * 100; head.style.left = p + '%'; played.style.width = p + '%'; played.firstChild.style.width = box.clientWidth + 'px';
      selEl.hidden = st.a == null; if (st.a != null) { selEl.style.left = st.a / dur * 100 + '%'; selEl.style.width = (st.b - st.a) / dur * 100 + '%'; }
      var c = $('[data-tc]', v.bar); if (c) c.textContent = tc(st.t) + ' / ' + tc(dur); var pb = $('[data-v="play"]', v.bar); if (pb) pb.innerHTML = I(st.play ? 'pause' : 'play');
    }
    function stop() { st.play = false; cancelAnimationFrame(raf); if (snd) snd.stop(); snd = null; paint(); }
    function start() { var end = st.a != null ? st.b : dur; if (st.t >= end - 0.01 || (st.a != null && st.t < st.a)) st.t = st.a != null ? st.a : 0; st.play = true; snd = synth(a, st.t, st.vol); last = performance.now(); raf = requestAnimationFrame(tick); paint(); }
    function tick(now) { st.t += (now - last) / 1000; last = now; var end = st.a != null ? st.b : dur; if (st.t >= end) { if (st.loop || st.a != null) { st.t = st.a != null ? st.a : 0; if (snd) snd.stop(); snd = synth(a, st.t, st.vol); } else { st.t = end; return stop(); } } paint(); if (st.play) raf = requestAnimationFrame(tick); }
    function drawSpec() { var x = spec.getContext('2d'), w = spec.width, h = spec.height, col = getComputedStyle(box).getPropertyValue('--accent-ink').trim() || '#7aa7ff', r = 7; x.clearRect(0, 0, w, h); x.fillStyle = col; for (var i = 0; i < w; i += 2) for (var j = 0; j < h; j += 2) { r = (r * 9301 + 49297) % 233280; var e = P[Math.floor(i / w * 220)], f = 1 - j / h; x.globalAlpha = clamp(e * (0.25 + 0.75 * Math.pow(1 - f, 1.6)) * (0.5 + r / 233280), 0, 1); x.fillRect(i, j, 2, 2); } }
    var d0 = null;
    box.addEventListener('pointerdown', function (e) { box.setPointerCapture(e.pointerId); var r = box.getBoundingClientRect(); d0 = clamp((e.clientX - r.left) / r.width, 0, 1) * dur; });
    box.addEventListener('pointermove', function (e) { if (d0 == null) return; var r = box.getBoundingClientRect(), t = clamp((e.clientX - r.left) / r.width, 0, 1) * dur; if (Math.abs(t - d0) / dur * r.width > 6) { st.a = Math.min(d0, t); st.b = Math.max(d0, t); paint(); } });
    box.addEventListener('pointerup', function (e) { if (d0 == null) return; var r = box.getBoundingClientRect(), t = clamp((e.clientX - r.left) / r.width, 0, 1) * dur; if (Math.abs(t - d0) / dur * r.width <= 6) { st.a = st.b = null; st.t = t; } else st.t = st.a; d0 = null; if (st.play) { stop(); start(); } else paint(); });
    v.bar.addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (!b) return; if (b.dataset.v === 'play') { if (st.play) stop(); else start(); } if (b.dataset.v === 'loop') { st.loop = !st.loop; b.setAttribute('aria-pressed', st.loop); } });
    var sg = $('.bb-seg', v.bar); if (sg) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (val) { st.view = val; spec.hidden = val !== 'spec'; box.classList.toggle('spec', val === 'spec'); if (val === 'spec') drawSpec(); }); }
    var sl = $('.bb-slider', v.bar); if (sl) B.slider(sl, function (val) { st.vol = val / 100; if (snd) snd.gain.gain.value = st.vol; });
    paint(); var ro = new ResizeObserver(paint); ro.observe(box); if (v.opts.compact && !v.opts.still) start();
    return { destroy: function () { stop(); ro.disconnect(); }, key: function (e) { if (e.key === ' ') { if (st.play) stop(); else start(); return true; } } };
  }

  /* ───────── documents ───────── */
  var DOCS = {
    'chest.md': '---\nsize: 1.26 × 0.95 × 0.87 m   # 宽 × 高 × 深\n---\n# 宝箱\n\n新手村第一个可以打开的容器。玩家在这里学会「靠近、交互、获得」。\n\n## 美术风格\n\n卡通、低多边形。木质箱体加黄铜包边，开箱时有一束暖光。\n\nbb://chest_concept.png\n\nbb://chest_turnaround.png\n\n## 规格\n\n| 项目 | 要求 |\n|---|---|\n| 三角面 | 不超过 5,000 |\n| 贴图 | 3 张 1024：basecolor、normal、orm |\n| 动画 | open，0.8 秒 |\n\n## 导出\n\n```\nblender chest_high.blend --export glb --out chest.glb\n```\n',
    'art_style_guide.md': '# 美术风格规范\n\n色彩明快、轮廓清晰，远看能认出是什么。\n\n## 模型\n\n| 类别 | 面数上限 |\n|---|---|\n| 道具 | 5,000 |\n| 角色 | 12,000 |\n\n## 贴图\n\n边长为 2 的幂，运行时不超过 2048。\n',
    'naming_rules.md': '# 命名规则\n\n全部小写，下划线分隔。\n\n```\n对象_用途_变体.后缀\nchest_basecolor.png\n```\n',
    'lantern.md': '# 提灯\n\n夜间探索用的手持光源。黄铜骨架、磨砂玻璃，点亮时有暖色光晕。\n',
    'changelog.txt': '2026-11-24  user:lin    chest.glb  修正包边比例\n2026-11-21  agent:modeler  chest.glb  初版\n2026-11-20  agent:slicer   ui/shop    从 shop_mockup.png 切出 12 张\n2026-11-18  agent:concept-artist  chest_concept.png  AI 生成\n',
    'export_presets.json': { version: 2, target: 'glb', scale: 1, textures: { maxSize: 1024, format: 'png', channels: ['basecolor', 'normal', 'orm'] }, animation: { bake: true, fps: 30 }, naming: '{object}_{usage}' }
  };
  /* front matter: structured fields of a design object (size: … → 目标尺寸); the plugin indexes them, the page shows them as a row */
  var FM = { size: ['box', '目标尺寸'] };
  function md(src) {
    var out = '', lines = src.split('\n'), i = 0, para = [];
    if (lines[0] === '---') {
      var j = lines.indexOf('---', 1);
      if (j > 0) { out += '<div class="md-fm">' + lines.slice(1, j).map(function (l) { var m = /^(\w+):\s*([^#]*?)\s*(#.*)?$/.exec(l); if (!m) return ''; var f = FM[m[1]] || ['hash', m[1]]; return '<span class="md-fm__f" title="' + esc((m[3] || '').replace(/^#\s*/, '')) + '">' + I(f[0], 'bb-icon--12') + '<small>' + f[1] + '</small><b>' + esc(m[2]) + '</b></span>'; }).join('') + '</div>'; i = j + 1; }
    }
    function flush() { if (para.length) { out += '<p>' + esc(para.join(' ')) + '</p>'; para = []; } }
    while (i < lines.length) {
      var l = lines[i];
      if (l.indexOf('```') === 0) { flush(); var code = []; i++; while (i < lines.length && lines[i].indexOf('```') !== 0) code.push(lines[i++]); out += '<pre class="prompt">' + esc(code.join('\n')) + '</pre>'; }
      else if (/^#+ /.test(l)) { flush(); var n = l.indexOf(' '); out += '<h' + n + '>' + esc(l.slice(n + 1)) + '</h' + n + '>'; }
      else if (l.indexOf('bb://') === 0) { flush(); var a = App.byName(l.slice(5)); if (a) out += '<button class="ref" data-open="' + a.id + '"><span class="bb-cell__thumb">' + DEMO.art(a.art, a) + '</span><span><b>' + esc(a.name) + '</b><small>' + H.stage(a.stage, 'short') + H.review(a.review, true) + '</small></span>' + I('arrow-up-right') + '</button>'; }
      else if (l[0] === '|') { flush(); var rows = []; while (i < lines.length && lines[i][0] === '|') rows.push(lines[i++].split('|').slice(1, -1).map(function (c) { return c.trim(); })); i--; out += '<table><thead><tr>' + rows[0].map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.slice(2).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>'; }
      else if (!l.trim()) flush(); else para.push(l);
      i++;
    }
    flush(); return out;
  }
  function tree(k, val, open) {
    if (val === null || typeof val !== 'object') return '<div class="jt__leaf">' + (k != null ? '<span class="jt__k">' + esc(k) + '</span><span class="jt__c">: </span>' : '') + '<span class="jt__' + typeof val + '">' + esc(JSON.stringify(val)) + '</span></div>';
    var keys = Object.keys(val), arr = Array.isArray(val);
    return '<details' + (open ? ' open' : '') + '><summary>' + I('chevron-right', 'bb-icon--12') + (k != null ? '<span class="jt__k">' + esc(k) + '</span><span class="jt__c">: </span>' : '') + '<span class="jt__n">' + (arr ? '[' + keys.length + ']' : '{' + keys.length + '}') + '</span></summary>' + keys.map(function (x) { return tree(arr ? null : x, val[x], true); }).join('') + '</details>';
  }
  var VP = { fit: [0, 0], phone: [390, 760], tablet: [820, 620], desktop: [1280, 720] };
  function shopHtml() {
    var items = [['#ffc24a', '金币袋', 120], ['#6fd3ff', '蓝宝石', 300], ['#ff8fb3', '药水', 80], ['#9be28a', '草药', 40], ['#c9a0ff', '卷轴', 160], ['#ffd65a', '钥匙', 90], ['#ff9f6b', '面包', 20], ['#8fd0c8', '地图', 60]];
    return '<div class="shop"><header><b>杂货铺</b><span>' + I('badge-check', 'bb-icon--12') + '<i data-coins>1,240</i></span></header><div class="shop__grid">' + items.map(function (it, i) { return '<button class="shop__it" data-it="' + i + '" aria-pressed="' + (i === 0) + '" data-price="' + it[2] + '" data-name="' + it[1] + '"><i style="background:' + it[0] + '"></i><span>' + it[2] + '</span></button>'; }).join('') + '</div><footer><span data-pick>金币袋</span><button class="shop__buy">购买</button></footer></div>';
  }
  function docViewer(v, a) {
    var e = a.bundle ? 'html' : ext(a), src = a.text != null ? a.text : DOCS[a.name], mode = 'a', vp = 'fit', modes = e === 'md' ? [['a', '排版'], ['b', '原文']] : e === 'json' ? [['a', '树形'], ['b', '原文']] : e === 'html' ? [['a', '运行'], ['b', '源码']] : null;
    if (src == null) src = e === 'html' ? '<!doctype html>\n<title>商店界面原型</title>\n<main class="shop">\n  <header>杂货铺 <span id="coins">1,240</span></header>\n  <section class="grid"><!-- 4 × 2 货架 --></section>\n  <footer><button id="buy">购买</button></footer>\n</main>\n<script src="shop.js"></scr' + 'ipt>' : '# ' + (a.title || a.name) + '\n\n' + (a.excerpt || '') + '\n';
    v.bar.innerHTML = (modes ? seg('显示方式', modes, 'a') : '') + (e === 'html' ? '<i class="bb-toolbar__sep"></i><span data-vp>' + seg('视口', [['fit', '适应'], ['phone', '手机'], ['tablet', '平板'], ['desktop', '桌面']], 'fit') + '</span><span class="vw__num" data-size></span>' : '') + '<span class="bb-toolbar__grow"></span>';
    v.stage.classList.add('doc');
    function draw() {
      var raw = typeof src === 'string' ? src : JSON.stringify(src, null, 2);
      if (mode === 'b' || e === 'txt') v.stage.innerHTML = '<div class="dv"><pre class="dv__raw">' + esc(raw) + '</pre></div>';
      else if (e === 'json') v.stage.innerHTML = '<div class="dv"><div class="jt">' + tree(null, src, true) + '</div></div>';
      else if (e === 'html') { var s = VP[vp], W = v.stage.clientWidth - 48, Hh = v.stage.clientHeight - 48, w = s[0] || W, h = s[1] || Hh, k = Math.min(1, W / w, Hh / h); v.stage.innerHTML = '<div class="frame" style="width:' + w + 'px;height:' + h + 'px;transform:translate(-50%,-50%) scale(' + k + ')">' + shopHtml() + '</div>'; var z = $('[data-size]', v.bar); if (z) z.textContent = Math.round(w) + ' × ' + Math.round(h) + (k < 1 ? '  ·  ' + Math.round(k * 100) + '%' : ''); }
      else v.stage.innerHTML = '<div class="dv"><article class="md">' + md(raw) + '</article></div>';
      var vs = $('[data-vp]', v.bar); if (vs) vs.style.visibility = mode === 'a' ? '' : 'hidden';
    }
    $$('.bb-seg', v.bar).forEach(function (sg, n) { sg.setAttribute('data-wired', ''); B.segmented(sg, function (val) { if (n === 0) mode = val; else vp = val; draw(); }); });
    v.stage.addEventListener('click', function (ev) {
      var r = ev.target.closest('[data-open]'); if (r) return App.openDetail(r.dataset.open);
      var it = ev.target.closest('.shop__it'), buy = ev.target.closest('.shop__buy'), shop = ev.target.closest('.shop'); if (!shop) return;
      if (it) { $$('.shop__it', shop).forEach(function (x) { x.setAttribute('aria-pressed', x === it); }); $('[data-pick]', shop).textContent = it.dataset.name; }
      if (buy) { var cur = $('.shop__it[aria-pressed="true"]', shop), c = $('[data-coins]', shop), n = +c.textContent.replace(/,/g, '') - +cur.dataset.price; if (n >= 0) c.textContent = n.toLocaleString('en-US'); }
    });
    /* copying the whole JSON tree gives the JSON itself, not the tree's labels */
    v.stage.addEventListener('copy', function (ev) {
      var t = $('.jt', v.stage), sel = window.getSelection(); if (!t || !sel.rangeCount || !ev.clipboardData) return;
      var r = sel.getRangeAt(0), all = document.createRange(); all.selectNodeContents(t);
      if (r.compareBoundaryPoints(Range.START_TO_START, all) <= 0 && r.compareBoundaryPoints(Range.END_TO_END, all) >= 0) { ev.clipboardData.setData('text/plain', typeof src === 'string' ? src : JSON.stringify(src, null, 2)); ev.preventDefault(); }
    });
    draw(); var ro = new ResizeObserver(function () { if (e === 'html' && mode === 'a') draw(); }); ro.observe(v.stage);
    return { destroy: function () { ro.disconnect(); } };
  }

  /* ───────── model: a still for now — the full viewer is its own step ───────── */
  function modelViewer(v, a) {
    v.bar.innerHTML = '<span class="bb-toolbar__grow"></span>';
    v.stage.innerHTML = a.art ? '<div class="mv">' + DEMO.art(a.art, Object.assign({}, a, { fit: 'meet' })) + '</div>' : '<div class="bb-cell__ph">' + I('box', 'bb-icon--24') + '</div>';
    return { destroy: function () {} };
  }

  /* ───────── when no viewer can run ───────── */
  var CASES = {
    unknown: function (a) { return ['file', '没有插件能显示 .' + ext(a) + ' 文件', App.fmtSize(a.bytes), [['download', '下载原文件', 1]]]; },
    plugin: function (a) { return ['puzzle', '需要 ' + a.needs[0] + ' 插件', a.needs[1], [['puzzle', '去安装', 1], ['download', '下载原文件']]]; },
    failed: function () { return ['triangle-alert', '当前浏览器无法解码这个视频', 'Apple ProRes 4444 · 3840 × 2160', [['refresh-cw', '重试', 1], ['download', '下载原文件']]]; },
    error: function (a) { return ['circle-alert', '查看器出错了', typeof a.viewerError === 'string' ? a.viewerError : 'bowerbird.' + a.kind, [['download', '下载原文件', 1], ['refresh-cw', '重试']]]; },
    missing: function (a) { return ['file-question', '磁盘上找不到这个文件', a.path, [['folder-search', '重新定位文件', 1]]]; }
  };
  function special(v, a, kind) {
    var c = CASES[kind](a); v.root.classList.add('vw--plain');
    v.bar.innerHTML = '<span class="bb-toolbar__grow"></span>';
    v.stage.innerHTML = (kind === 'missing' && a.art ? '<div class="mv ghost">' + DEMO.art(a.art, a) + '</div>' : '') + '<div class="bb-empty"><div class="bb-empty__icon">' + I(c[0], 'bb-icon--24') + '</div><h3 class="bb-empty__title">' + c[1] + '</h3><p class="bb-empty__text text-mono">' + esc(c[2]) + '</p><div class="bb-empty__actions">' + c[3].map(function (b) { return '<button class="bb-btn' + (b[2] ? ' bb-btn--primary' : '') + '" data-case="' + b[1] + '">' + I(b[0]) + b[1] + '</button>'; }).join('') + '</div></div>';
    v.stage.addEventListener('click', function (e) { var b = e.target.closest('[data-case]'); if (!b) return; App.toast(b.dataset.case === '重试' ? (kind === 'error' ? '重试后仍然无法显示' : '重试后仍然无法解码') :b.dataset.case === '下载原文件' ? '开始下载 ' + a.name : b.dataset.case); });
    return { destroy: function () {} };
  }

  /* shared with the format plugins' compare views (compare.js) */
  App.audioSynth = synth; App.audioPeaks = peaks;
  App.docText = function (a) { var s = a.text != null ? a.text : DOCS[a.name]; if (s == null) return '# ' + (a.title || a.name) + '\n\n' + (a.excerpt || '') + '\n'; return typeof s === 'string' ? s : JSON.stringify(s, null, 2); };
  var PLUGIN = { image: ['bowerbird.image', imageViewer], video: ['bowerbird.video', videoViewer], audio: ['bowerbird.audio', audioViewer], doc: ['bowerbird.doc', docViewer], model: ['bowerbird.model', modelViewer] };
  App.viewers = PLUGIN;
  App.mountViewer = function (host, a, o) {
    o = o || {}; if (host._viewer) host._viewer.destroy();
    host.innerHTML = '<div class="vw' + (o.compact ? ' vw--compact' : '') + '"><div class="vw__bar"></div><div class="vw__stage"></div><div class="vw__foot" hidden></div></div>';
    var v = { host: host, opts: o, root: host.firstChild, bar: $('.vw__bar', host), stage: $('.vw__stage', host), foot: $('.vw__foot', host) };
    var kind = a.state === 'failed' ? 'failed' : a.needs ? 'plugin' : a.viewerError ? 'error' : a.state === 'missing' ? 'missing' : a.kind === 'unknown' ? 'unknown' : null, p = PLUGIN[a.kind];
    host._viewer = kind || !p ? special(v, a, kind || 'unknown') : p[1](v, a);
    v.root.setAttribute('data-plugin', kind || !p ? 'shell' : p[0]);
    return host._viewer;
  };

  /* ───────── in the grid: videos scrub under the pointer, audio plays on hover ───────── */
  var hov = null;
  function unhover() { if (!hov) return; clearTimeout(hov.t); cancelAnimationFrame(hov.raf); if (hov.snd) hov.snd.stop(); var a = hov.a; hov = null; App.refresh(a); }
  el.content.addEventListener('pointermove', function (e) {
    var c = e.target.closest('.bb-cell[data-state="ready"]'), kind = c && c.dataset.kind;
    if (!c || kind !== 'video' || S.dragging) return unhover();
    if (hov && hov.id !== c.dataset.id) unhover();
    var th = $('.bb-cell__thumb', c), r = th.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1), a = App.byId(c.dataset.id);
    if (kind === 'video') {
      if (!hov) { hov = { id: a.id, a: a }; th.insertAdjacentHTML('beforeend', '<i class="scrub"></i>'); }
      var art = $('.bb-art', th); if (art) art.outerHTML = frameSvg(f * (a.dur || 3), a.dur || 3).replace('meet', S.layout === 'masonry' ? 'slice' : 'meet'); $('.scrub', th).style.width = f * 100 + '%';
    } else if (!hov) {
      hov = { id: a.id, a: a }; th.insertAdjacentHTML('beforeend', '<i class="scrub"></i>');
      hov.t = setTimeout(function () { if (!hov || hov.id !== a.id) return; hov.snd = synth(a, 0, 0.5); var t0 = performance.now(), bar = $('.scrub', th), d = Math.min(a.dur || 1, 8) * 1000; (function step(now) { if (!hov || hov.id !== a.id || !bar.isConnected) return; var p = clamp((now - t0) / d, 0, 1); bar.style.width = p * 100 + '%'; if (p < 1) hov.raf = requestAnimationFrame(step); })(t0); }, 160);
    }
  });
  el.content.addEventListener('pointerleave', unhover);
})();
