// Small deterministic helpers shared by the fixture generators.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const DAY = 86_400_000

export function sha256Hex(data) { return crypto.createHash('sha256').update(data).digest('hex') }
export function contentHash(data) { return 'sha256:' + sha256Hex(data) }
export function fileHash(abs) { return contentHash(fs.readFileSync(abs)) }

/** A fake but well-formed content hash for a version whose content is not kept (version records only). */
export function fakeHash(key) { return 'sha256:' + sha256Hex('bowerbird-fixture:' + key) }

/** Deterministic UUIDv7: 48-bit ms timestamp + version/variant bits + pseudo-random bits from `key`. */
export function uuidv7(ms, key) {
  const r = crypto.createHash('sha256').update('uuidv7:' + key).digest()
  const b = Buffer.alloc(16)
  b.writeUIntBE(Math.floor(ms), 0, 6)
  r.copy(b, 6, 0, 10)
  b[6] = 0x70 | (b[6] & 0x0f)
  b[8] = 0x80 | (b[8] & 0x3f)
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function iso(ms) { return new Date(ms).toISOString().replace('.000Z', 'Z') }

/** Park–Miller style PRNG in [0, 1), seeded; same sequence on every machine. */
export function rng(seed) {
  let s = (seed >>> 0) || 1
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }) }
export function writeFile(abs, data) { ensureDir(path.dirname(abs)); fs.writeFileSync(abs, data) }
export function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }) }

/** Walk a directory, yielding library-relative POSIX paths of files (dot-entries included). */
export function* walk(root, rel = '') {
  const dir = path.join(root, rel)
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) yield* walk(root, r)
    else yield r
  }
}

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
