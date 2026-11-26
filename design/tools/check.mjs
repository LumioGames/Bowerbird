// Local helper: compile tokens.css the way the page does (approximation, for local preview only)
// and check contrast pairs in every theme.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const t = JSON.parse(fs.readFileSync(path.join(root, 'design-system/tokens.json'), 'utf8'));
const themes = t.color.themes.map((x) => x.id);
const val = (tok, th) => (typeof tok.value === 'string' ? tok.value : tok.value[th] ?? tok.value[themes[0]]);

// ---- compile
let css = `/* local compile of tokens.json */\n`;
themes.forEach((th, i) => {
  css += (i === 0 ? `:root, [data-theme="${th}"]` : `[data-theme="${th}"]`) + ' {\n';
  for (const tok of t.color.tokens) css += `  --${tok.name}: ${val(tok, th)};\n`;
  for (const tok of t.shadow?.tokens ?? []) css += `  --${tok.name}: ${val(tok, th)};\n`;
  css += '}\n';
});
css += ':root {\n';
for (const fam of Object.keys(t)) {
  if (['name', 'version', 'color', 'type', 'shadow'].includes(fam)) continue;
  for (const tok of t[fam].tokens) css += `  --${tok.name}: ${tok.value};\n`;
}
for (const [k, v] of Object.entries(t.type.families)) css += `  --font-${k}: ${v};\n`;
css += '}\n';
for (const g of t.type.groups) for (const s of g.styles) {
  css += `.${s.name} { font-family: var(--font-${s.family ?? g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight}; letter-spacing: ${s.letterSpacing ?? 0}; }\n`;
}
fs.mkdirSync(path.join(root, '.preview'), { recursive: true });
fs.writeFileSync(path.join(root, '.preview/tokens.css'), css);

// ---- contrast
const parse = (s) => {
  s = s.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const cr = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const tok = Object.fromEntries(t.color.tokens.map((x) => [x.name, x]));
const col = (n, th) => parse(val(tok[n], th));
// grounds: opaque surfaces, plus each translucent layer composited on each surface
const surfaces = ['surface-canvas', 'surface-panel', 'surface-raised', 'surface-well'];
const layered = ['fill-rest', 'fill-hover', 'fill-press', 'accent-soft', 'warning-soft', 'danger-soft'];
const WHITE = [255, 255, 255, 1], BLACK = [0, 0, 0, 1];
const checks = [];
const add = (fg, grounds, min, note) => checks.push({ fg, grounds, min, note });
const allGrounds = (th) => {
  const g = {};
  for (const s of surfaces) g[s] = col(s, th);
  for (const l of layered) for (const s of ['surface-canvas', 'surface-panel', 'surface-raised']) g[`${l} on ${s}`] = over(col(l, th), col(s, th));
  return g;
};
const marks = (th) => ({ 'material-mark/white': over(col('material-mark', th), WHITE), 'material-mark/black': over(col('material-mark', th), BLACK), 'material-mark/mid': over(col('material-mark', th), [128, 128, 128, 1]) });
const pops = (th) => ({ 'material-popover/canvas': over(col('material-popover', th), col('surface-canvas', th)), 'material-popover/raised': over(col('material-popover', th), col('surface-raised', th)), 'material-popover/white': over(col('material-popover', th), WHITE), 'material-popover/black': over(col('material-popover', th), BLACK), 'material-chrome/canvas': over(col('material-chrome', th), col('surface-canvas', th)), 'material-chrome/white': over(col('material-chrome', th), WHITE), 'material-chrome/black': over(col('material-chrome', th), BLACK) });
let fail = 0;
for (const th of themes) {
  const G = allGrounds(th), M = marks(th), P = pops(th);
  const run = (fgName, grounds, min) => {
    for (const [gn, g] of Object.entries(grounds)) {
      const fg = over(col(fgName, th), g);
      const r = cr(fg, g);
      if (r < min) { fail++; console.log(`FAIL [${th}] ${fgName} on ${gn}: ${r.toFixed(2)} < ${min}`); }
    }
  };
  for (const n of ['ink-1', 'ink-2']) { run(n, G, 4.5); run(n, P, 4.5); }
  { const P2 = {}; for (const [k, g] of Object.entries(P)) { P2['fill-rest on ' + k] = over(col('fill-rest', th), g); P2['fill-hover on ' + k] = over(col('fill-hover', th), g); } run('ink-1', P2, 4.5); run('ink-2', P2, 4.5); }
  run('ink-3', Object.fromEntries(Object.entries(G).filter(([k]) => !k.includes(' on ') || k.startsWith('fill-rest'))), 4.5);
  const surfOnly = Object.fromEntries(Object.entries(G).filter(([k]) => !k.includes('soft') || k.startsWith('accent-soft')));
  run('accent-ink', Object.fromEntries(surfaces.map((s) => [s, col(s, th)])), 4.5);
  run('accent-ink', { 'fill-rest/panel': G['fill-rest on surface-panel'], 'fill-hover/raised': G['fill-hover on surface-raised'] }, 4.5);
  run('warning-ink', Object.fromEntries(surfaces.map((s) => [s, col(s, th)])), 4.5);
  run('warning-ink', { 'warning-soft/panel': G['warning-soft on surface-panel'], 'warning-soft/raised': G['warning-soft on surface-raised'] }, 4.5);
  run('danger-ink', Object.fromEntries(surfaces.map((s) => [s, col(s, th)])), 4.5);
  run('danger-ink', { 'danger-soft/panel': G['danger-soft on surface-panel'], 'danger-soft/raised': G['danger-soft on surface-raised'], 'fill-hover/raised': G['fill-hover on surface-raised'] }, 4.5);
  run('accent-on', { 'accent-fill': col('accent-fill', th) }, 4.5);
  run('danger-on', { 'danger-fill': col('danger-fill', th) }, 4.5);
  run('warning-on', { 'warning-fill': col('warning-fill', th) }, 4.5);
  for (const n of ['line-control', 'accent-ring']) run(n, Object.fromEntries(surfaces.map((s) => [s, col(s, th)])), 3);
  run('accent-fill', Object.fromEntries(['surface-canvas', 'surface-panel', 'surface-raised'].map((s) => [s, col(s, th)])), 3);
  for (const n of ['stage-reference', 'stage-production', 'stage-runtime', 'accent-ink', 'danger-ink', 'warning-ink', 'ink-1']) run(n, M, 3);
  for (const n of ['stage-reference', 'stage-production', 'stage-runtime']) run(n, Object.fromEntries(['surface-panel', 'surface-raised', 'surface-canvas'].map((s) => [s, col(s, th)])), 3);
  run('danger-ink', Object.fromEntries(Object.entries(P).filter(([k]) => k.startsWith('material-popover'))), 4.5);
  const L = (n) => lum(col(n, th)).toFixed(3);
  console.log(`[${th}] stage luminance ref=${L('stage-reference')} prod=${L('stage-production')} run=${L('stage-runtime')}`);
}
console.log(fail ? `${fail} failing pairs` : 'all contrast pairs pass');
