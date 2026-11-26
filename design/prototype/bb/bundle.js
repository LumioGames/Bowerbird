/* Bowerbird — components/bundle.js
 * One classic script. Assigns window.Bowerbird = { icon, spring, project, rubberband, tracker, init, html, demo }.
 * No framework: the prototype is plain HTML + bundle.css; this file adds icons, motion, small behaviours,
 * markup templates for the status marks and asset cells, and the shared sample library (demo.*).
 * Icons: Lucide 0.460.0, ISC License, (c) Lucide Contributors — paths copied unchanged. */
(function () {
  'use strict';

  /* ───────────────────────── 1. Icons (Lucide 0.460.0) ───────────────────────── */
  var ICONS = {
    'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    'folder-plus': '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'folder-search': '<path d="M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1"/><path d="m21 21-1.9-1.9"/><circle cx="17" cy="17" r="3"/>',
    'folder-input': '<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'list-filter': '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
    'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    'list': '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    'arrow-up-down': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    'film': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
    'audio-lines': '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    'box': '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    'file': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    'file-question': '<path d="M12 17h.01"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/>',
    'tag': '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    'tags': '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'minus': '<path d="M5 12h14"/>',
    'badge-check': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'unlink': '<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'circle-arrow-up': '<circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/>',
    'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    'layers': '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    'bot': '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    'puzzle': '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
    'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    'loader': '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
    'circle-dashed': '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
    'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    'git-fork': '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
    'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    'columns-2': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
    'square-split-horizontal': '<path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3"/><path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3"/><line x1="12" x2="12" y1="4" y2="20"/>',
    'blend': '<circle cx="9" cy="9" r="7"/><circle cx="15" cy="15" r="7"/>',
    'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
    'pause': '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    'volume-2': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    'maximize-2': '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
    'zoom-in': '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    'command': '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    'corner-down-left': '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
    'ellipsis': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'hash': '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    'grip-vertical': '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    'rotate-3d': '<path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2"/><path d="m15.194 13.707 3.814 1.86-1.86 3.814"/><path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4"/>',
    'hard-drive': '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
    'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'scan-search': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
    'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
    'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    'activity': '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    'keyboard': '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    'git-compare-arrows': '<circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/>',
    'waypoints': '<circle cx="12" cy="4.5" r="2.5"/><path d="m10.2 6.3-3.9 3.9"/><circle cx="4.5" cy="12" r="2.5"/><path d="M7 12h10"/><circle cx="19.5" cy="12" r="2.5"/><path d="m13.8 17.7 3.9-3.9"/><circle cx="12" cy="19.5" r="2.5"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'ban': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    'square': '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    'columns-3': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    'focus': '<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    'bone': '<path d="M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z"/>',
    'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    'repeat': '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    'grid-3x3': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    'lightbulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    'image-plus': '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/>',
    'crosshair': '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
    'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'
  };

  function mountSprite() {
    if (!document.body || document.getElementById('bb-sprite')) return;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" id="bb-sprite" width="0" height="0" style="position:absolute" aria-hidden="true">';
    for (var k in ICONS) s += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + ICONS[k] + '</symbol>';
    var box = document.createElement('div');
    box.innerHTML = s + '</svg>';
    document.body.insertBefore(box.firstChild, document.body.firstChild);
  }
  function icon(name, cls) {
    return '<svg class="bb-icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS['file']) + '</svg>';
  }

  /* ───────────────────────── 2. Motion ─────────────────────────
   * Springs use Apple's two designer parameters: damping ratio (1 = no overshoot) and response (seconds).
   * A spring always starts from its live value and keeps its velocity when re-targeted, so it can be
   * grabbed and reversed mid-flight. */
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function spring(opts) {
    opts = opts || {};
    var damping = opts.damping == null ? 1 : opts.damping;
    var w = (2 * Math.PI) / (opts.response || 0.4);
    var x = opts.value || 0, v = 0, target = x, raf = 0, last = 0;
    var cb = opts.onUpdate || function () {};
    function step(now) {
      var dt = Math.min(0.032, (now - last) / 1000 || 0.016); last = now;
      for (var i = 0; i < 4; i++) { var h = dt / 4; v += (-w * w * (x - target) - 2 * damping * w * v) * h; x += v * h; }
      if (Math.abs(x - target) < (opts.precision || 0.05) && Math.abs(v) < 1) { x = target; v = 0; raf = 0; cb(x, true); if (opts.onRest) opts.onRest(x); return; }
      cb(x, false); raf = requestAnimationFrame(step);
    }
    return {
      get value() { return x; }, get velocity() { return v; }, get target() { return target; },
      set: function (t, o) {
        target = t;
        if (o && o.velocity != null) v = o.velocity;
        if (o && o.damping != null) damping = o.damping;
        if (reduced()) { x = t; v = 0; cb(x, true); if (opts.onRest) opts.onRest(x); return; }
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
      },
      jump: function (t) { x = target = t; v = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; } cb(x, true); },
      stop: function () { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    };
  }
  /* Where a flick would come to rest (px), from release velocity in px/s. Same form as scroll deceleration. */
  function project(velocity, rate) { rate = rate || 0.998; return ((velocity / 1000) * rate) / (1 - rate); }
  /* Progressive resistance past a boundary: the further past, the less the element follows. */
  function rubberband(over, dimension, c) { c = c || 0.55; return (over * dimension * c) / (dimension + c * Math.abs(over)); }
  /* Keeps a short pointer history so release velocity is available at pointer-up. */
  function tracker() {
    var pts = [];
    return {
      add: function (e) { pts.push({ t: performance.now(), x: e.clientX, y: e.clientY }); if (pts.length > 6) pts.shift(); },
      reset: function () { pts = []; },
      velocity: function () {
        if (pts.length < 2) return { x: 0, y: 0 };
        var a = pts[0], b = pts[pts.length - 1], dt = (b.t - a.t) / 1000;
        if (dt <= 0 || performance.now() - b.t > 90) return { x: 0, y: 0 };
        return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
      }
    };
  }

  /* ───────────────────────── 3. Behaviours ───────────────────────── */
  function slide(root, itemSel, thumbSel, attr, onChange, underline) {
    var thumb = root.querySelector(thumbSel);
    var items = [].slice.call(root.querySelectorAll(itemSel));
    function place(animate) {
      var cur = items.filter(function (i) { return i.getAttribute(attr) === 'true'; })[0] || items[0];
      if (!cur || !thumb) return;
      if (!animate) thumb.style.transition = 'none';
      thumb.style.width = cur.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + cur.offsetLeft + 'px)';
      if (!animate) { void thumb.offsetWidth; thumb.style.transition = ''; }
    }
    function pick(item) {
      items.forEach(function (i) { i.setAttribute(attr, i === item ? 'true' : 'false'); i.tabIndex = i === item ? 0 : -1; });
      place(true);
      if (onChange) onChange(item.dataset.value || item.textContent.trim(), item);
    }
    items.forEach(function (i, n) {
      i.tabIndex = i.getAttribute(attr) === 'true' ? 0 : -1;
      i.addEventListener('click', function () { pick(i); });
      i.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        var nx = items[(n + d + items.length) % items.length]; nx.focus(); pick(nx); e.preventDefault();
      });
    });
    place(false);
    if (window.ResizeObserver) new ResizeObserver(function () { place(false); }).observe(root);
    return { place: place, pick: pick };
  }
  function segmented(root, onChange) { return slide(root, '.bb-seg__item', '.bb-seg__thumb', 'aria-checked', onChange); }
  function tabs(root, onChange) { return slide(root, '.bb-tab', '.bb-tabs__bar', 'aria-selected', onChange); }
  function slider(input, onInput) {
    function sync() {
      var min = +input.min || 0, max = +input.max || 100;
      input.style.setProperty('--v', ((input.value - min) / (max - min)) * 100 + '%');
      if (onInput) onInput(+input.value);
    }
    input.addEventListener('input', sync); sync();
  }
  function init(root) {
    root = root || document;
    mountSprite();
    [].forEach.call(root.querySelectorAll('.bb-seg:not([data-wired])'), function (el) { el.setAttribute('data-wired', ''); segmented(el); });
    [].forEach.call(root.querySelectorAll('.bb-tabs:not([data-wired])'), function (el) { el.setAttribute('data-wired', ''); tabs(el); });
    [].forEach.call(root.querySelectorAll('.bb-slider:not([data-wired])'), function (el) { el.setAttribute('data-wired', ''); slider(el); });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement;
    if (!t) return;
    var head = t.closest('.bb-sec__head');
    if (head) { var sec = head.parentElement; var c = sec.hasAttribute('data-collapsed'); if (c) sec.removeAttribute('data-collapsed'); else sec.setAttribute('data-collapsed', ''); head.setAttribute('aria-expanded', c ? 'true' : 'false'); return; }
    var tog = t.closest('[data-bb-toggle]');
    if (tog) { var open = tog.getAttribute('aria-expanded') !== 'true'; tog.setAttribute('aria-expanded', open ? 'true' : 'false'); var grp = tog.nextElementSibling; if (grp && grp.classList.contains('bb-tree__group')) grp.hidden = !open; return; }
    var cp = t.closest('[data-bb-copy]');
    if (cp) {
      var text = cp.getAttribute('data-bb-copy');
      try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {}); } catch (err) { /* clipboard may be unavailable in a preview frame */ }
      cp.setAttribute('data-copied', ''); setTimeout(function () { cp.removeAttribute('data-copied'); }, 1400);
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document); });
  else init(document);

  /* ───────────────────────── 4. Templates ─────────────────────────
   * The three groups of status marks. Each group has its own corner, its own shape and its own
   * vocabulary, so they cannot be mistaken for one another even without colour:
   *   stage  — top-left,  a disc whose FILL LEVEL says the stage (hollow / half / solid)
   *   review — top-right, a rounded square holding a line icon
   *   issue  — bottom-left, a solid flag flush with the edge; the only filled mark
   *   info   — bottom-right, plain text from the format plugin (duration, triangles, size) */
  var STAGE = { reference: ['参考素材', '参考'], production: ['生产物料', '生产'], runtime: ['运行时物料', '运行时'] };
  var REVIEW = { pending: ['待审', 'clock'], approved: ['通过', 'check'], rejected: ['打回', 'undo-2'], exempt: ['免审', 'minus'] };
  var ISSUE = {
    broken: ['断链引用', 'unlink', 'error'], missing: ['文件缺失', 'file-question', 'error'],
    identity: ['重复身份', 'copy', 'error'], conflict: ['元数据冲突', 'git-compare-arrows', 'error'],
    stale: ['上游已更新', 'circle-arrow-up', 'warning'], failed: ['处理失败', 'triangle-alert', 'warning'], plugin: ['缺少插件', 'puzzle', 'warning']
  };
  var KIND_ICON = { image: 'image', video: 'film', audio: 'audio-lines', model: 'box', doc: 'file-text', unknown: 'file' };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var html = {
    icon: icon,
    /* label: false | 'short' | 'full' */
    stage: function (stage, label) {
      return '<span class="bb-stage" data-stage="' + stage + '" title="' + STAGE[stage][0] + '"><i class="bb-stage__glyph"></i>' + (label ? '<span>' + STAGE[stage][label === 'short' ? 1 : 0] + '</span>' : '') + '</span>';
    },
    review: function (status, label) {
      return '<span class="bb-review" data-review="' + status + '" title="' + REVIEW[status][0] + '">' + icon(status === 'approved' && label ? 'badge-check' : REVIEW[status][1], label ? '' : 'bb-icon--12') + (label ? '<span>' + REVIEW[status][0] + '</span>' : '') + '</span>';
    },
    issue: function (type, label) {
      var d = ISSUE[type];
      return '<span class="bb-issue" data-level="' + d[2] + '" title="' + d[0] + '">' + icon(d[1], label ? '' : 'bb-icon--12') + (label ? '<span>' + d[0] + '</span>' : '') + '</span>';
    },
    /* Corner marks, as they sit on a thumbnail. */
    markStage: function (stage) { return '<span class="bb-mark bb-mark--stage" data-stage="' + stage + '" title="' + STAGE[stage][0] + '"><i class="bb-stage__glyph"></i></span>'; },
    markReview: function (status) { return status === 'exempt' ? '' : '<span class="bb-mark bb-mark--review" data-review="' + status + '" title="' + REVIEW[status][0] + '">' + icon(REVIEW[status][1], 'bb-icon--12') + '</span>'; },
    markIssue: function (type, count) { var d = ISSUE[type]; return '<span class="bb-mark bb-mark--issue" data-level="' + d[2] + '" title="' + d[0] + '">' + icon(d[1], 'bb-icon--12') + (count > 1 ? '<span>' + count + '</span>' : '') + '</span>'; },
    markInfo: function (text) { return '<span class="bb-mark bb-mark--info">' + esc(text) + '</span>'; },
    tag: function (text, o) {
      o = o || {};
      if (o.ai) return '<span class="bb-tag bb-tag--ai" title="AI 标签，尚未采纳">' + icon('sparkles', 'bb-icon--12') + '<span>' + esc(text) + '</span><button class="bb-tag__act" data-act="adopt" aria-label="采纳标签 ' + esc(text) + '">' + icon('check', 'bb-icon--12') + '</button><button class="bb-tag__act" data-act="remove" aria-label="移除标签 ' + esc(text) + '">' + icon('x', 'bb-icon--12') + '</button></span>';
      return '<span class="bb-tag">' + (o.color ? '<i class="bb-tag__dot" style="--tag-color:' + o.color + '"></i>' : '') + '<span>' + esc(text) + '</span>' + (o.removable ? '<button class="bb-tag__act" data-act="remove" aria-label="移除标签 ' + esc(text) + '">' + icon('x', 'bb-icon--12') + '</button>' : '') + '</span>';
    },
    /* A grid cell. asset: see demo.assets. o: { selected, arrive, hideName } */
    cell: function (a, o) {
      o = o || {};
      var st = a.state || 'ready', inner;
      if (st === 'processing') inner = '<div class="bb-cell__ph">' + icon(KIND_ICON[a.kind], 'bb-icon--20') + '<span>' + esc(a.stateText || '正在处理') + '</span><span class="bb-progress" style="--p:' + (a.progress || 40) + '%"><i></i></span></div><i class="bb-beam"></i>';
      else if (st === 'waiting') inner = '<div class="bb-cell__ph">' + icon('circle-dashed', 'bb-icon--20') + '<span>缩略图稍后生成</span></div>';
      else if (st === 'failed') inner = '<div class="bb-cell__ph">' + icon(KIND_ICON[a.kind], 'bb-icon--20') + '<span>处理失败</span></div>';
      else if (st === 'unknown') inner = '<div class="bb-cell__ph">' + icon('file', 'bb-icon--20') + '<span class="text-mono-sm">.' + esc(a.name.split('.').pop()) + '</span></div>';
      else if (a.kind === 'doc') inner = '<div class="bb-cell__doc"><b>' + esc(a.title) + '</b><p>' + esc(a.excerpt) + '</p></div>';
      else inner = demo.art(a.art, a);
      var cls = 'bb-cell__thumb' + (a.alpha && st !== 'missing' ? ' bb-cell__thumb--alpha' : '') + (o.arrive ? ' bb-arrive' : '');
      return '<div class="bb-cell" role="option" tabindex="0" data-id="' + a.id + '" data-kind="' + a.kind + '" data-state="' + st + '" aria-selected="' + (o.selected ? 'true' : 'false') + '">' +
        '<div class="' + cls + '">' + inner +
        '<div class="bb-cell__tl">' + html.markStage(a.stage) + '</div>' +
        '<div class="bb-cell__tr">' + html.markReview(a.review) + '</div>' +
        (a.issue ? '<div class="bb-cell__bl">' + html.markIssue(a.issue) + '</div>' : '') +
        (a.info && st !== 'unknown' && st !== 'waiting' && st !== 'processing' && st !== 'failed' ? '<div class="bb-cell__br">' + html.markInfo(a.info) + '</div>' : '') +
        '</div>' + (o.hideName ? '' : '<div class="bb-cell__name" title="' + esc(a.path) + '">' + esc(a.name) + '</div>') + '</div>';
    },
    /* A list row. o: { icon, label, count, depth, selected, toggle, expanded, sub, thumb, trailing } */
    row: function (o) {
      return '<div class="bb-row' + (o.thumb ? ' bb-row--media' : '') + '" role="treeitem" tabindex="-1"' + (o.depth ? ' style="--depth:' + o.depth + '"' : '') + (o.selected ? ' aria-selected="true"' : '') + (o.toggle ? ' data-bb-toggle aria-expanded="' + (o.expanded ? 'true' : 'false') + '"' : '') + '>' +
        (o.toggle ? icon('chevron-right', 'bb-row__chev bb-icon--12') : o.depth != null && o.indent !== false ? '<i class="bb-row__chev"></i>' : '') +
        (o.thumb ? '<span class="bb-row__thumb">' + o.thumb + '</span>' : o.icon ? icon(o.icon, 'bb-row__icon') : '') +
        '<span class="bb-row__label">' + esc(o.label) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span>' +
        (o.trailing || '') + (o.count != null ? '<span class="bb-row__count">' + o.count + '</span>' : '') + '</div>';
    },
    kbd: function (keys) { return keys.split(' ').map(function (k) { return '<kbd class="bb-kbd">' + k + '</kbd>'; }).join(''); },
    /* Inspector pieces. o: { collapsed, count, by } — `by` is the plugin id for plugin-provided sections. */
    sec: function (title, body, o) {
      o = o || {};
      return '<section class="bb-sec"' + (o.collapsed ? ' data-collapsed' : '') + '><div class="bb-sec__head" role="button" tabindex="0" aria-expanded="' + !o.collapsed + '">' + icon('chevron-right', 'bb-icon--12') + title + (o.count != null ? ' · ' + o.count : '') + (o.by ? '<span class="bb-sec__by">' + o.by + '</span>' : '') + '</div><div class="bb-sec__body">' + (body || '') + '</div></section>';
    },
    kv: function (rows) { return '<dl class="bb-kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; },
    copy: function (t) { return '<button class="bb-copy" data-bb-copy="' + esc(t) + '" title="点击复制"><span>' + esc(t) + '</span>' + icon('copy', 'bb-icon--12') + '</button>'; },
    banner: function (kind, ic, title, text, actions, line) {
      return '<div class="bb-banner' + (kind ? ' bb-banner--' + kind : '') + (line ? ' bb-banner--line' : '') + '" role="' + (kind === 'danger' ? 'alert' : 'status') + '">' + icon(ic) + '<div class="bb-banner__body"><div class="bb-banner__title">' + title + '</div>' + (text ? '<div class="bb-banner__text">' + text + '</div>' : '') + (actions ? '<div class="bb-banner__actions">' + actions + '</div>' : '') + '</div></div>';
    },
    /* The inspector for one selected asset, top to bottom, with sample values where the data has none. */
    inspector: function (a) {
      var tags = (a.tags || []).map(function (t) { return html.tag(t, { removable: true }); }).join('') + (a.aiTags || []).map(function (t) { return html.tag(t, { ai: true }); }).join('') + '<span class="bb-tag bb-tag--add">添加标签</span>';
      var thumb = a.state === 'unknown' || !a.art ? '<div class="bb-cell__ph">' + icon(KIND_ICON[a.kind], 'bb-icon--24') + '</div>' : demo.art(a.art, a);
      var issue = a.issue === 'stale' ? html.banner('warning', 'circle-arrow-up', '上游已更新，待复核', 'chest.glb 在 11 月 24 日被 user:lin 改过。', '<button class="bb-btn bb-btn--sm bb-btn--primary">确认已复核</button><button class="bb-btn bb-btn--sm">替换内容</button>') : a.issue ? html.banner(ISSUE[a.issue][2] === 'error' ? 'danger' : 'warning', ISSUE[a.issue][1], ISSUE[a.issue][0], '') : '';
      return '<div class="bb-insp__thumb' + (a.alpha ? ' bb-cell__thumb--alpha' : '') + '">' + thumb + '</div><div class="bb-insp__name">' + esc(a.name) + '</div>' +
        (issue ? '<div class="bb-insp__issue">' + issue + '</div>' : '') +
        html.sec('基本', html.kv([['路径', html.copy(a.path)], ['GUID', html.copy(a.id)], ['大小', a.size || '—'], ['执行者', a.by || 'user:mo']])) +
        html.sec('标签', '<div class="bb-tags">' + tags + '</div>') +
        html.sec('阶段与校验', html.kv([['物料阶段', '<button class="bb-select">' + html.stage(a.stage, 'full') + icon('chevron-down', 'bb-icon--12') + '</button>'], ['校验状态', html.review(a.review, true)]])) +
        (a.info ? html.sec('技术信息', html.kv([[a.kind === 'model' ? '三角面' : a.kind === 'image' ? '尺寸' : '时长', a.info.replace(' 面', '')], ['格式', a.name.split('.').pop().toUpperCase()]]), { by: 'bowerbird.' + a.kind }) : '') +
        html.sec('关系', '', { collapsed: true, count: a.name === 'chest.glb' ? 6 : 1 }) + html.sec('生产记录', '', { collapsed: true, count: 1 }) + html.sec('版本', '', { collapsed: true, count: a.name === 'chest.glb' ? 2 : 1 });
    },
    labels: { STAGE: STAGE, REVIEW: REVIEW, ISSUE: ISSUE, KIND_ICON: KIND_ICON }
  };

  /* ───────────────────────── 5. Sample library「星落镇」─────────────────────────
   * Demo fixtures only — not part of the system. Every page of the prototype reads the same data so a
   * review can be walked end to end. Thumbnails are drawn here as small flat SVGs standing in for real files. */
  var uid = 0;
  var WOOD = { top: '#cf9150', front: '#a5672f', side: '#74441b', brass: '#f0c35a', brassDk: '#b3861f', lock: '#ffe394', line: '#3a2410' };
  function chest(c, open) {
    c = c || WOOD;
    var s = '<ellipse cx="84" cy="141" rx="56" ry="9" fill="#000" opacity=".22"/>';
    if (open) s += '<polygon points="64,60 124,74 132,34 72,20" fill="' + c.side + '"/><polygon points="68,58 120,70 126,40 76,28" fill="#2b1a0b"/><polygon points="44,90 96,102 124,88 72,76" fill="#1d1208"/><polygon points="50,88 96,99 118,88 72,78 " fill="#ffd96b" opacity=".85"/><polygon points="50,88 118,88 150,6 14,6" fill="#ffe9a3" opacity=".16"/>';
    s += '<polygon points="36,92 96,106 96,140 36,126" fill="' + c.front + '"/><polygon points="96,106 128,90 128,124 96,140" fill="' + c.side + '"/>';
    if (!open) s += '<polygon points="36,74 96,88 96,106 36,92" fill="' + c.front + '"/><polygon points="96,88 128,72 128,90 96,106" fill="' + c.side + '"/><polygon points="36,74 96,88 128,72 68,58" fill="' + c.top + '"/>';
    s += '<g fill="' + c.brass + '"><polygon points="46,' + (open ? 94.3 : 76.3) + ' 54,' + (open ? 96.2 : 78.2) + ' 54,130.2 46,128.3"/><polygon points="78,' + (open ? 101.8 : 83.8) + ' 86,' + (open ? 103.7 : 85.7) + ' 86,137.7 78,135.8"/>';
    if (!open) s += '<polygon points="46,76.3 54,78.2 86,62.2 78,60.3"/><polygon points="78,83.8 86,85.7 118,69.7 110,67.8"/>';
    s += '</g><polygon points="96,' + (open ? 106 : 88) + ' 100,' + (open ? 104 : 86) + ' 100,138 96,140" fill="' + c.brassDk + '"/>';
    s += '<polyline points="36,92 96,106 128,90" fill="none" stroke="' + c.brassDk + '" stroke-width="3" stroke-linejoin="round"/>';
    if (!open) s += '<polygon points="60,90 72,92.8 72,108.8 60,106" fill="' + c.lock + '"/><circle cx="66" cy="98.6" r="2.4" fill="' + c.line + '"/>';
    return s;
  }
  function atlas(m) {
    var p = { base: ['#33241a', '#a9682f', '#7d4a1f', '#e3b648', '#b88a26'], normal: ['#8080ff', '#8787fb', '#5f66d8', '#9a94ff', '#b7b0ff'], orm: ['#d98a12', '#f1d21a', '#c9a70e', '#ee5ae8', '#c63fc4'] }[m];
    var isl = [[8, 8, 88, 56], [8, 70, 88, 42], [102, 8, 50, 104]], s = '<rect width="160" height="160" fill="' + p[0] + '"/>';
    isl.forEach(function (r) {
      s += '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" rx="2" fill="' + p[1] + '"/>';
      for (var y = r[1] + 14; y < r[1] + r[3] - 4; y += 14) s += '<rect x="' + r[0] + '" y="' + y + '" width="' + r[2] + '" height="2" fill="' + p[2] + '"/>';
    });
    s += '<rect x="8" y="118" width="144" height="12" rx="2" fill="' + p[3] + '"/><rect x="8" y="136" width="144" height="16" rx="2" fill="' + p[3] + '"/><rect x="8" y="142" width="144" height="3" fill="' + p[4] + '"/>';
    for (var x = 20; x < 150; x += 22) s += '<circle cx="' + x + '" cy="124" r="2" fill="' + p[4] + '"/>';
    return s;
  }
  function wave(n, seed, env) {
    var s = '', r = seed || 7;
    for (var i = 0; i < n; i++) {
      r = (r * 9301 + 49297) % 233280;
      var t = i / n, e = env === 'hit' ? Math.exp(-t * 5) * (t < 0.04 ? t / 0.04 : 1) : 0.35 + 0.65 * Math.abs(Math.sin(t * 9));
      var h = Math.max(3, (0.35 + 0.65 * (r / 233280)) * e * 96), x = 14 + i * (132 / n);
      s += '<rect x="' + x.toFixed(1) + '" y="' + (80 - h / 2).toFixed(1) + '" width="' + (132 / n - 1.4).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1"/>';
    }
    return s;
  }
  var ART = {
    concept: function () { return '<rect width="160" height="160" fill="#dfe7e2"/><circle cx="80" cy="84" r="58" fill="#cfdad3"/>' + chest() + '<path d="M40 80 96 93" stroke="#ffe7b8" stroke-width="2" opacity=".7" stroke-linecap="round"/><path d="M72 62 100 68" stroke="#fff3d6" stroke-width="2" opacity=".6" stroke-linecap="round"/>'; },
    turnaround: function () {
      var v = function (x, y, label, top) {
        var g = '<g transform="translate(' + x + ' ' + y + ')" fill="#e9dcc0" stroke="#40342a" stroke-width="1.6" stroke-linejoin="round">';
        g += top ? '<rect x="4" y="12" width="52" height="32" rx="3"/><path d="M16 12v32M44 12v32" fill="none"/>' : '<path d="M4 26V18Q4 6 16 6H44Q56 6 56 18V26Z"/><rect x="4" y="26" width="52" height="26" rx="2"/><path d="M16 6v46M44 6v46M4 26h52" fill="none"/>' + (label === '正' ? '<rect x="26" y="22" width="8" height="10" rx="1.5" fill="#f0c35a"/>' : '');
        return g + '</g><text x="' + (x + 30) + '" y="' + (y + 66) + '" font-size="9" text-anchor="middle" fill="#7b6f60" font-family="system-ui,sans-serif">' + label + '</text>';
      };
      return '<rect width="160" height="160" fill="#f3eee4"/>' + v(14, 10, '正') + v(86, 10, '侧') + v(14, 84, '背') + v(86, 84, '顶', true);
    },
    model: function () { var id = 'g' + (++uid); return '<defs><radialGradient id="' + id + '" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#5a5c62"/><stop offset="1" stop-color="#2c2d31"/></radialGradient></defs><rect width="160" height="160" fill="url(#' + id + ')"/><path d="M0 132h160M0 146h160M40 118l-28 42M120 118l28 42M80 118v42" stroke="#fff" stroke-opacity=".07"/>' + chest(); },
    basecolor: function () { return atlas('base'); },
    normal: function () { return atlas('normal'); },
    orm: function () { return atlas('orm'); },
    icon: function () { return '<g transform="translate(-14 -22) scale(1.18)">' + chest() + '</g><circle cx="132" cy="34" r="3" fill="#fff3c4"/><path d="M132 24v20M122 34h20" stroke="#fff3c4" stroke-width="1.6" stroke-linecap="round"/>'; },
    audio: function () { return '<g class="bb-art__ink">' + wave(34, 11, 'hit') + '</g>'; },
    video: function () { return '<rect width="160" height="160" fill="#1b2230"/><rect y="118" width="160" height="42" fill="#141a25"/>' + chest(WOOD, true); },
    hero: function () { return '<rect width="160" height="160" fill="#34353a"/><ellipse cx="80" cy="140" rx="34" ry="7" fill="#000" opacity=".25"/><polygon points="66,62 94,62 100,104 60,104" fill="#9a9ca3"/><polygon points="94,62 100,104 104,100 100,64" fill="#77797f"/><polygon points="68,30 92,30 96,50 80,60 64,50" fill="#b3b5bb"/><polygon points="60,104 78,104 76,138 62,138" fill="#84868c"/><polygon points="82,104 100,104 98,138 84,138" fill="#6c6e74"/><polygon points="66,64 56,70 50,100 58,102" fill="#84868c"/><polygon points="94,64 104,70 112,98 104,100" fill="#6c6e74"/>'; },
    potion: function () { return '<rect width="160" height="160" fill="#34353a"/><ellipse cx="80" cy="138" rx="30" ry="6" fill="#000" opacity=".25"/><polygon points="70,34 90,34 90,58 112,96 104,132 56,132 48,96 70,58" fill="#c9d6e2" opacity=".35"/><polygon points="52,98 108,98 102,130 58,130" fill="#e0559a"/><polygon points="52,98 108,98 100,88 60,88" fill="#f07bb4"/><rect x="68" y="24" width="24" height="12" rx="2" fill="#a5672f"/>'; },
    render: function (a) { var id = 'r' + (++uid), h = a.hue || 210; return '<defs><radialGradient id="' + id + '" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="hsl(' + h + ' 60% 82%)"/><stop offset=".6" stop-color="hsl(' + h + ' 45% 48%)"/><stop offset="1" stop-color="hsl(' + (h + 20) + ' 40% 20%)"/></radialGradient></defs><rect width="160" height="160" fill="hsl(' + h + ' 14% 12%)"/><circle cx="70" cy="84" r="44" fill="url(#' + id + ')"/><circle cx="118" cy="52" r="18" fill="url(#' + id + ')" opacity=".85"/><ellipse cx="80" cy="140" rx="60" ry="8" fill="#000" opacity=".3"/>'; }
  };
  var G = function (n) { return '0192f3a4-7c1e-7b52-9d06-4e8a51c0d2' + ('0' + n.toString(16)).slice(-2); };
  var P = 'props/chest/';
  var assets = [
    { id: G(1), name: 'chest.md', path: P + 'chest.md', kind: 'doc', stage: 'production', review: 'exempt', title: '宝箱', excerpt: '新手村第一个可以打开的容器。卡通、低多边形，木质箱体加黄铜包边，开箱时有一束暖光。', size: '2 KB', tags: ['宝箱', '设计对象'] },
    { id: G(2), name: 'chest_concept.png', path: P + 'chest_concept.png', kind: 'image', art: 'concept', stage: 'production', review: 'approved', info: '1536×1536', size: '2.1 MB', tags: ['宝箱', '原画'], aiTags: ['木质', '黄铜', '卡通'], by: 'agent:concept-artist' },
    { id: G(3), name: 'chest_turnaround.png', path: P + 'chest_turnaround.png', kind: 'image', art: 'turnaround', stage: 'production', review: 'approved', info: '2048×2048', size: '1.4 MB', tags: ['宝箱', '四视图'], by: 'user:lin' },
    { id: G(4), name: 'chest_high.blend', path: P + 'chest_high.blend', kind: 'unknown', state: 'unknown', stage: 'production', review: 'exempt', size: '18.6 MB', tags: ['宝箱'], by: 'agent:modeler' },
    { id: G(5), name: 'chest.glb', path: P + 'chest.glb', kind: 'model', art: 'model', stage: 'runtime', review: 'pending', info: '2,480 面', size: '1.2 MB', tags: ['宝箱', '道具'], aiTags: ['低多边形'], by: 'user:lin' },
    { id: G(6), name: 'chest_basecolor.png', path: P + 'chest_basecolor.png', kind: 'image', art: 'basecolor', stage: 'runtime', review: 'approved', info: '1024×1024', size: '612 KB', tags: ['宝箱', '贴图'] },
    { id: G(7), name: 'chest_normal.png', path: P + 'chest_normal.png', kind: 'image', art: 'normal', stage: 'runtime', review: 'approved', info: '1024×1024', size: '840 KB', tags: ['宝箱', '贴图'] },
    { id: G(8), name: 'chest_orm.png', path: P + 'chest_orm.png', kind: 'image', art: 'orm', stage: 'runtime', review: 'approved', info: '1024×1024', size: '388 KB', tags: ['宝箱', '贴图'] },
    { id: G(9), name: 'chest_icon.png', path: P + 'chest_icon.png', kind: 'image', art: 'icon', alpha: true, stage: 'runtime', review: 'approved', issue: 'stale', info: '256×256', size: '48 KB', tags: ['宝箱', 'Icon'] },
    { id: G(10), name: 'chest_open.wav', path: P + 'chest_open.wav', kind: 'audio', art: 'audio', stage: 'runtime', review: 'approved', info: '0.8 秒', size: '141 KB', tags: ['宝箱', '音效'] },
    { id: G(11), name: 'chest_open_preview.mp4', path: P + 'chest_open_preview.mp4', kind: 'video', art: 'video', stage: 'production', review: 'exempt', info: '0:03', size: '3.4 MB', tags: ['宝箱'] },
    { id: G(12), name: 'potion.glb', path: 'props/potion/potion.glb', kind: 'model', art: 'potion', stage: 'runtime', review: 'approved', issue: 'broken', info: '1,120 面', size: '640 KB', tags: ['药水', '道具'] },
    { id: G(13), name: 'hero_idle.fbx', path: 'characters/hero/hero_idle.fbx', kind: 'model', art: 'hero', state: 'missing', stage: 'production', review: 'pending', issue: 'missing', info: '8,912 面', size: '—', tags: ['主角'] },
    { id: G(14), name: 'intro_cutscene.mov', path: 'environments/intro_cutscene.mov', kind: 'video', state: 'failed', stage: 'production', review: 'exempt', issue: 'failed', size: '86 MB', tags: [] },
    { id: G(15), name: 'npc_guard.glb', path: 'characters/npc/npc_guard.glb', kind: 'model', state: 'waiting', stage: 'runtime', review: 'pending', size: '2.3 MB', tags: [] },
    { id: G(16), name: 'npc_merchant.glb', path: 'characters/npc/npc_merchant.glb', kind: 'model', state: 'waiting', stage: 'runtime', review: 'pending', size: '2.8 MB', tags: [] },
    { id: G(17), name: 'icon_gem.png', path: 'ui/shop/icon_gem.png', kind: 'image', state: 'processing', stateText: '生成缩略图', progress: 62, stage: 'runtime', review: 'pending', size: '22 KB', tags: [] },
    { id: G(18), name: 'ref_glass_orbs.png', path: 'references/3d-render/ref_glass_orbs.png', kind: 'image', art: 'render', hue: 205, stage: 'reference', review: 'exempt', info: '2400×2400', size: '5.2 MB', tags: ['参考', '材质'] },
    { id: G(19), name: 'ref_clay_forms.png', path: 'references/3d-render/ref_clay_forms.png', kind: 'image', art: 'render', hue: 28, stage: 'reference', review: 'exempt', info: '2400×2400', size: '4.7 MB', tags: ['参考'] }
  ];
  var demo = {
    library: {
      name: '星落镇',
      views: [['inbox', '全部', '1,284'], ['tag', '未打标签', '96'], ['clock', '待审', '42'], ['triangle-alert', '有问题', '7'], ['trash-2', '回收站', '12']],
      smart: [['本周新增', '86'], ['运行时模型', '73'], ['AI 生成待审', '19']],
      folders: [
        ['characters', '角色', 186, ['hero', 'npc']], ['props', '道具', 212, ['chest', 'potion', 'weapon']], ['environments', '场景', 158, []],
        ['ui', '界面', 241, ['shop', 'hud', 'icons']], ['audio', '音频', 97, ['sfx', 'music']], ['vfx', '特效', 64, []],
        ['references', '参考', 302, ['3d-render', 'photography', 'illustration']], ['docs', '规范文档', 24, []]
      ]
    },
    assets: assets,
    byName: function (n) { return assets.filter(function (a) { return a.name === n; })[0]; },
    /* Thumbnail stand-in for an asset: an inline SVG. */
    art: function (kind, a) {
      var f = ART[kind], vb = (a && a.vb) || [160, 160];
      return '<svg class="bb-art" viewBox="0 0 ' + vb[0] + ' ' + vb[1] + '" preserveAspectRatio="xMidYMid ' + ((a && a.fit) || 'slice') + '" role="img" aria-label="' + esc((a && a.name) || kind) + '">' + (f ? f(a || {}) : '') + '</svg>';
    },
    /* Add a thumbnail drawing: fn(asset) returns SVG inner markup. */
    registerArt: function (kind, fn) { ART[kind] = fn; },
    chest: chest,
    /* The sidebar of the sample library, as markup. */
    sidebar: function (current) {
      var L = demo.library, s = '<div class="bb-side__lib">' + icon('hard-drive') + '<b>' + L.name + '</b>' + icon('chevron-down', 'bb-icon--12') + '</div>';
      s += '<div role="tree">';
      L.views.forEach(function (v) { s += html.row({ icon: v[0], label: v[1], count: v[2], selected: current === v[1] }); });
      s += '<div class="bb-section-label">智能文件夹<button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" aria-label="新建智能文件夹">' + icon('plus', 'bb-icon--12') + '</button></div>';
      L.smart.forEach(function (v) { s += html.row({ icon: 'folder-search', label: v[0], count: v[1], selected: current === v[0] }); });
      s += '<div class="bb-section-label">文件夹<button class="bb-btn bb-btn--ghost bb-btn--icon bb-btn--sm" aria-label="新建文件夹">' + icon('plus', 'bb-icon--12') + '</button></div>';
      L.folders.forEach(function (f) {
        var open = f[0] === 'props';
        s += html.row({ icon: open ? 'folder-open' : 'folder', label: f[0], sub: f[1], count: f[2], depth: 0, toggle: f[3].length > 0, expanded: open, selected: current === f[0] });
        if (f[3].length) { s += '<div class="bb-tree__group"' + (open ? '' : ' hidden') + '>'; f[3].forEach(function (c) { s += html.row({ icon: 'folder', label: c, depth: 1, selected: current === c }); }); s += '</div>'; }
      });
      return s + '</div>';
    }
  };

  window.Bowerbird = { icon: icon, icons: Object.keys(ICONS), spring: spring, project: project, rubberband: rubberband, tracker: tracker, reducedMotion: reduced, segmented: segmented, tabs: tabs, slider: slider, init: init, html: html, demo: demo };
})();
