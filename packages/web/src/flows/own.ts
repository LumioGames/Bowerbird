/**
 * Assets this page itself just made (uploads, copies, creations it started). Their `asset.created` events must not
 * show up as「有 N 个新资产」— that pill is for what others and Agents add (F-03).
 */
const own = new Set<string>()
export function markOwn(id: string): void { own.add(id); setTimeout(() => own.delete(id), 120_000) }
export function isOwn(id: string): boolean { return own.has(id) }
