// Local harness: wraps each preview the way the design-system page frames it
// (tokens.css + bundle.css + bundle.js preloaded, data-theme on <html>), for checking in a browser.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tokens = fs.readFileSync(path.join(root, '.preview/tokens.css'), 'utf8');
const css = fs.readFileSync(path.join(root, 'design-system/components/bundle.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'design-system/components/bundle.js'), 'utf8');
const dir = path.join(root, 'design-system/components');
const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'preview.html')));
const links = [];
for (const n of names) {
  let h = fs.readFileSync(path.join(dir, n, 'preview.html'), 'utf8');
  const marker = h.split('\n')[0];
  const inject = `<style>${tokens}</style><style>${css}</style><script>${js}</scr` + `ipt><script>document.documentElement.setAttribute('data-theme', location.hash === '#light' ? 'light' : 'dark');</scr` + `ipt>`;
  const mw = /width=(\d+)/.exec(marker);
  const fit = mw ? `<script>(function(){var W=${mw[1]};function f(){document.documentElement.style.zoom=Math.min(1,window.innerWidth/W)}f();window.addEventListener('resize',f)})()</scr` + `ipt>` : '';
  h = h.replace(/<head>/, '<head>' + inject + fit);
  fs.writeFileSync(path.join(root, '.preview', n + '.html'), h);
  links.push(`<li><a href="${n}.html">${n}</a> · <a href="${n}.html#light">light</a> <code>${marker.replace(/</g, '&lt;')}</code></li>`);
}
fs.writeFileSync(path.join(root, '.preview/index.html'), `<!doctype html><meta charset="utf-8"><title>local previews</title><ul>${links.join('')}</ul>`);
console.log(names.length + ' previews → ' + path.join(root, '.preview'));
