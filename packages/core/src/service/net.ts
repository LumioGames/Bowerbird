/**
 * Loopback checks, the same rules as the server's (packages/server/src/security.ts): the whole 127.0.0.0/8,
 * ::1 in either spelling, and IPv4-mapped ::ffff:127.x. core cannot import the server, so the rule is restated here.
 */
export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '')
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true
  if (a.startsWith('::ffff:')) return isLoopbackAddress(a.slice(7))
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)
}

/** A listen host that only accepts connections from this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || isLoopbackAddress(h)
}
