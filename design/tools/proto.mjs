// Builds the prototype's shared files from the design system: tokens.css in the page-contract shape
// (dark first, light under prefers-color-scheme and data-theme), copies of bundle.css / bundle.js,
// and prototype/index.html — a plain page wrapper so the prototype opens straight from disk. Only writes and copies files.
// Run from anywhere: node design/tools/proto.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const t = JSON.parse(fs.readFileSync(path.join(root, 'design-system/tokens.json'), 'utf8'));
const themed = t.color.tokens.concat(t.shadow.tokens);
const block = (th) => themed.map((k) => `  --${k.name}: ${typeof k.value === 'string' ? k.value : k.value[th]};`).join('\n');
let css = `/* Bowerbird — generated from the design system's tokens.json */\n:root {\n${block('dark')}\n`;
for (const fam of Object.keys(t)) {
  if (['name', 'version', 'color', 'type', 'shadow'].includes(fam)) continue;
  for (const k of t[fam].tokens) css += `  --${k.name}: ${k.value};\n`;
}
for (const [k, v] of Object.entries(t.type.families)) css += `  --font-${k}: ${v};\n`;
css += `  color-scheme: dark;\n}\n@media (prefers-color-scheme: light) {\n:root:not([data-theme="dark"]) {\n${block('light')}\n  color-scheme: light;\n}\n}\n:root[data-theme="light"] {\n${block('light')}\n  color-scheme: light;\n}\n`;
for (const g of t.type.groups) for (const s of g.styles) css += `.${s.name} { font-family: var(--font-${s.family ?? g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight}; letter-spacing: ${s.letterSpacing ?? 0}; }\n`;
const out = path.join(root, 'prototype/bb');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'tokens.css'), css);
for (const f of ['bundle.css', 'bundle.js']) fs.copyFileSync(path.join(root, 'design-system/components', f), path.join(out, f));
// prototype/index.html: the page body wrapped the way the artifact host wraps it
const page = fs.readFileSync(path.join(root, 'prototype/bowerbird-prototype.html'), 'utf8');
fs.writeFileSync(path.join(root, 'prototype/index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`);
console.log('proto built');
