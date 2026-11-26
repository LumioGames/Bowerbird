/**
 * Request-origin checks (api-and-agent.md「安全」, ADR-009, ADR-023, ADR-043).
 *
 * - Host header: `localhost`, loopback IPs, and — only when listening beyond loopback — IP literals, this machine's
 *   host names and the host names of allowed origins (blocks DNS rebinding: an attacker's name resolving to
 *   127.0.0.1 is refused).
 * - Origin header, when present: same origin as the Host, or listed in `allowedOrigins`. `Origin: null`
 *   (sandboxed HTML assets, ADR-043) is refused, except for a sandboxed bundle page loading its own files
 *   (see `sameBundleSubresource`).
 * - No CORS headers unless the origin is explicitly allowed.
 */
import net from 'node:net'
import os from 'node:os'
import { HttpError } from './errors.js'

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

/** Request comes from the server's own machine: loopback peer and not relayed by a proxy. */
export function isLocalRequest(remoteAddress: string | undefined, headers: Record<string, string | string[] | undefined>): boolean {
  if (!isLoopbackAddress(remoteAddress)) return false
  // A reverse proxy on this machine relays other people's requests: those are not local.
  return headers['x-forwarded-for'] === undefined && headers['forwarded'] === undefined && headers['x-real-ip'] === undefined
}

export interface HostPort { hostname: string; port: string | null }

/** Parse a Host header (`name`, `name:port`, `[v6]:port`). */
export function parseHostHeader(value: string | undefined): HostPort | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v.startsWith('[')) {
    const end = v.indexOf(']')
    if (end < 0) return null
    const rest = v.slice(end + 1)
    if (rest && !/^:\d+$/.test(rest)) return null
    return { hostname: v.slice(1, end), port: rest ? rest.slice(1) : null }
  }
  const parts = v.split(':')
  if (parts.length > 2) return { hostname: v, port: null } // bare IPv6 without brackets
  if (parts.length === 2 && !/^\d+$/.test(parts[1]!)) return null
  const hostname = parts[0]!.replace(/\.$/, '')
  if (!hostname) return null
  return { hostname, port: parts[1] ?? null }
}

let nicCache: { at: number; names: Set<string> } | null = null

/** This machine's interface addresses and host names (cached for a few seconds). */
export function machineHostNames(): Set<string> {
  const now = Date.now()
  if (nicCache && now - nicCache.at < 5000) return nicCache.names
  const names = new Set<string>()
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list ?? []) names.add(nic.address.toLowerCase().replace(/%.*$/, ''))
  }
  const hn = os.hostname().toLowerCase().replace(/\.$/, '')
  if (hn) {
    names.add(hn)
    const short = hn.split('.')[0]!
    names.add(short)
    names.add(`${short}.local`)
    names.add(`${short}.lan`)
  }
  nicCache = { at: now, names }
  return names
}

export interface OriginPolicy {
  /** The address the server listens on (decides whether interface names are accepted). */
  listenHost: string
  /** Allowed origins, e.g. `https://assets.example.com` (from options + machine config). */
  allowedOrigins: () => string[]
}

export function normalizeOrigin(origin: string): string | null {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.protocol}//${u.host}`.toLowerCase()
  } catch { return null }
}

function defaultPort(protocol: string): string { return protocol === 'https:' ? '443' : '80' }

/** Whether the Host header names this server. */
export function hostAllowed(host: HostPort, policy: OriginPolicy): boolean {
  const h = host.hostname
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (isLoopbackAddress(h)) return true
  for (const o of policy.allowedOrigins()) {
    const n = normalizeOrigin(o)
    if (n && new URL(n).hostname.replace(/^\[|\]$/g, '') === h) return true
  }
  if (isLoopbackHost(policy.listenHost)) return false
  // DNS rebinding needs a host *name*; an IP literal cannot be rebound. Accepting any IP also covers Docker, where
  // the container's own interfaces differ from the address people type (the NAS's LAN IP).
  if (net.isIP(h)) return true
  const listen = policy.listenHost.toLowerCase().replace(/^\[|\]$/g, '')
  if (listen === h) return true
  return machineHostNames().has(h)
}

export type OriginVerdict =
  | { ok: true; cors: string | null }
  | { ok: false; reason: 'host' | 'origin' }

/**
 * Check one request. `allowNullOrigin` is set only for reading bundle files (the sandboxed page loading its own
 * module scripts and fetches, ADR-043).
 */
export function checkRequestOrigin(
  headers: Record<string, string | string[] | undefined>,
  policy: OriginPolicy,
  opts: { allowNullOrigin?: boolean } = {}
): OriginVerdict & { nullOrigin?: boolean } {
  const hostRaw = first(headers['host'])
  const host = parseHostHeader(hostRaw)
  if (!host || !hostAllowed(host, policy)) return { ok: false, reason: 'host' }
  const originRaw = first(headers['origin'])
  if (originRaw === undefined) return { ok: true, cors: null }
  if (originRaw === 'null') {
    if (opts.allowNullOrigin) return { ok: true, cors: 'null', nullOrigin: true }
    return { ok: false, reason: 'origin' }
  }
  const origin = normalizeOrigin(originRaw)
  if (!origin) return { ok: false, reason: 'origin' }
  const u = new URL(origin)
  const oHost = u.hostname.replace(/^\[|\]$/g, '')
  const oPort = u.port || defaultPort(u.protocol)
  const hPort = host.port ?? defaultPort(u.protocol)
  if (oHost === host.hostname && oPort === hPort) return { ok: true, cors: null }
  const allowed = policy.allowedOrigins().map(normalizeOrigin).filter((x): x is string => !!x)
  if (allowed.includes(origin)) return { ok: true, cors: originRaw }
  return { ok: false, reason: 'origin' }
}

export function originError(reason: 'host' | 'origin'): HttpError {
  return reason === 'host'
    ? new HttpError(403, 'forbidden', '主机名不被允许：请用 localhost、本机地址或允许列表里的地址访问', { reason: 'host' })
    : new HttpError(403, 'forbidden', '请求来源不被允许', { reason: 'origin' })
}

/** Sub-resource destinations a sandboxed page may load from its own bundle (module scripts, styles, images, fetch). */
const SUBRESOURCE_DESTS = new Set(['script', 'style', 'image', 'font', 'audio', 'video', 'track', 'empty'])

/**
 * The ADR-043 exception: an `Origin: null` read of a bundle file is let through only when it is a sub-resource
 * (`Sec-Fetch-Dest`) of a page served from the SAME asset's `bundle/` path on this server (`Referer`; bundle pages
 * are sent with `Referrer-Policy: no-referrer-when-downgrade` so the path is there). Anything else is refused.
 */
export function sameBundleSubresource(
  headers: Record<string, string | string[] | undefined>,
  target: { apiBase: string; library: string; asset: string }
): boolean {
  const dest = first(headers['sec-fetch-dest'])
  if (!dest || !SUBRESOURCE_DESTS.has(dest.toLowerCase())) return false
  const ref = first(headers['referer'])
  const host = parseHostHeader(first(headers['host']))
  if (!ref || !host) return false
  let u: URL
  try { u = new URL(ref) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const rPort = u.port || defaultPort(u.protocol)
  const hPort = host.port ?? defaultPort(u.protocol)
  if (u.hostname.replace(/^\[|\]$/g, '').toLowerCase() !== host.hostname || rPort !== hPort) return false
  const segs = u.pathname.split('/').map(s => { try { return decodeURIComponent(s) } catch { return s } })
  const want = ['', ...target.apiBase.split('/').filter(Boolean), 'libraries', target.library, 'assets', target.asset, 'bundle']
  if (segs.length <= want.length) return false
  return want.every((w, i) => segs[i] === w)
}

const ACTOR_RE = /^(user|agent):[^\s\p{Cc}][^\p{Cc}]{0,126}$/u

/**
 * `X-Bowerbird-Actor` → actor. Missing = `user:unnamed`. Non-ASCII names may be percent-encoded
 * (`user:%E6%9E%97`) since browsers cannot send raw non-Latin-1 header values; raw UTF-8 bytes are accepted too.
 */
export function parseActor(raw: string | string[] | undefined): string {
  let v = first(raw)
  if (v === undefined || v.trim() === '') return 'user:unnamed'
  v = v.trim()
  if (/[\x80-\xff]/.test(v)) {
    const decoded = Buffer.from(v, 'latin1').toString('utf8')
    if (!decoded.includes('�')) v = decoded
  }
  if (/%[0-9a-fA-F]{2}/.test(v)) {
    try { v = decodeURIComponent(v) } catch { /* keep as is */ }
  }
  v = v.normalize('NFC')
  if (!ACTOR_RE.test(v)) throw new HttpError(400, 'validation_failed', '执行者格式不对：应为 user:<名称> 或 agent:<名称>', { header: 'X-Bowerbird-Actor' })
  return v
}

/** LAN warning printed at startup (copy.md「局域网常驻警告」, plugin-system.md「信任模型」). */
export function lanWarning(address: string): string {
  return [
    '警告：任何能访问这个地址的人，都能读写整个资产库，也能在这台电脑上安装插件、运行程序。',
    'Bowerbird 没有登录功能。只在可信的局域网里打开，不要直接暴露到公网。',
    `现在的地址：${address}`
  ].join('\n')
}

/** A reachable LAN address for a wildcard listen host (first non-internal IPv4). */
export function lanAddress(listenHost: string, port: number): string {
  const h = listenHost.replace(/^\[|\]$/g, '')
  if (h !== '0.0.0.0' && h !== '::' && h !== '') return `http://${h.includes(':') ? `[${h}]` : h}:${port}`
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list ?? []) if (nic.family === 'IPv4' && !nic.internal) return `http://${nic.address}:${port}`
  }
  return `http://${os.hostname()}:${port}`
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
