/**
 * Styles of the per-frame overlays written as HTML strings (Tailwind only sees class names in source, and these
 * are drawn every frame). Values follow the prototype (app.css .mv-dim, .mv-scale, .mv-gizmo) on the
 * design-system variables.
 */
const CSS = `
.bbm-dimsvg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.bbm-dimsvg path { fill: none; stroke-width: 1.5; stroke-linecap: round; filter: drop-shadow(0 0 1px rgba(0,0,0,.45)); }
.bbm-dim { position: absolute; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 5px; padding: 1px 6px 1px 5px; border-radius: var(--radius-xs); background: var(--material-mark); color: var(--ink-1); font: 11px/16px var(--font-mono); white-space: nowrap; pointer-events: none; }
.bbm-dim > i { width: 6px; height: 6px; border-radius: 50%; }
/* lifted above the animation bar when a narrow stage would put the two on top of each other */
.bbm-lift-scale .bbm-scale { bottom: 56px; }
.bbm-scale { position: absolute; left: 12px; bottom: 12px; display: grid; grid-template-columns: auto auto; align-items: center; gap: 2px 8px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--material-mark); color: var(--ink-1); font-size: 11px; line-height: 14px; pointer-events: none; }
.bbm-scale__bar { height: 6px; border: 1.5px solid currentColor; border-top: 0; transition: width var(--duration-snappy) var(--ease-out); }
.bbm-scale small { grid-column: 1 / -1; color: var(--ink-2); font: 11px/14px var(--font-mono); }
.bbm-num { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.bbm-gizmo { overflow: visible; user-select: none; -webkit-user-select: none; }
.bbm-gizmo__bg { fill: transparent; transition: fill var(--duration-fade) var(--ease-out); }
.bbm-gizmo:hover .bbm-gizmo__bg { fill: var(--material-mark); }
.bbm-gizmo__end { cursor: pointer; }
.bbm-gizmo__end circle { transition: r var(--duration-press) var(--ease-out); }
.bbm-gizmo__end:hover circle { r: 10px; }
.bbm-gizmo text { fill: #ffffff; font: 700 9px/1 var(--font-sans); text-anchor: middle; pointer-events: none; }
.bbm-checker { background: conic-gradient(var(--checker-b) 25%, var(--checker-a) 0 50%, var(--checker-b) 0 75%, var(--checker-a) 0) 0 0 / 24px 24px; }
.bbm-arrive { animation: bbm-arrive var(--duration-arrive) var(--ease-out) both; }
@keyframes bbm-arrive { from { opacity: 0; filter: blur(var(--blur-arrive)); } to { opacity: 1; filter: none; } }
.bbm-spin { animation: bbm-spin 1s linear infinite; transform-origin: 50% 50%; }
@keyframes bbm-spin { to { transform: rotate(360deg); } }
.bbm-cell3d { animation: bbm-fade var(--duration-fade) var(--ease-out) both; }
@keyframes bbm-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .bbm-arrive, .bbm-cell3d { animation: none; } .bbm-scale__bar { transition: none; } }
`

export function ensureStyles(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-bb-model]')) return
  const s = document.createElement('style')
  s.dataset.bbModel = ''
  s.textContent = CSS
  document.head.appendChild(s)
}
