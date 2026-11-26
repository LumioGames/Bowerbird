/** The person's name lives in this browser (settings「你的名字」); unnamed → `user:unnamed` (ADR-023). */
const KEY = 'bowerbird.actorName'
const listeners = new Set<() => void>()
export function actorName(): string { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } }
export function setActorName(name: string): void {
  try { name.trim() ? localStorage.setItem(KEY, name.trim()) : localStorage.removeItem(KEY) } catch { /* private mode */ }
  listeners.forEach(l => l())
}
/**
 * The actor sent in `X-Bowerbird-Actor`. Browsers only allow Latin-1 in request headers, so the name is
 * percent-encoded (`user:%E6%9E%97`); the server decodes it. Use `displayActor()` for text on screen.
 */
export function currentActor(): string { const n = actorName(); return n ? `user:${encodeURIComponent(n)}` : 'user:unnamed' }
/** The actor as shown on screen (the name as typed). */
export function displayActor(): string { const n = actorName(); return n ? `user:${n}` : 'user:unnamed' }
/**
 * Whether an actor written by the server (events, records, `by` fields — always decoded: `user:林`) is this
 * browser's person. Compare with this, never with `currentActor()`, which is the header form (`user:%E6%9E%97`).
 */
export function isMe(by: string | null | undefined): boolean {
  if (!by) return false
  let decoded = by
  try { decoded = decodeURIComponent(by) } catch { /* not encoded */ }
  return decoded === displayActor()
}
export function onActorChange(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l) }
