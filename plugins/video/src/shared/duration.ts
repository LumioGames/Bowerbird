/**
 * Duration text shared by the server part (the grid badge) and the web part (the inspector's 时长). Pure.
 */

/** `0:03`, `12:04`, `1:02:03` — the grid badge (builtin-plugins.md). */
export function formatDuration(seconds: number): string {
  let s = Math.round(seconds)
  if (seconds > 0 && s === 0) s = 1
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
