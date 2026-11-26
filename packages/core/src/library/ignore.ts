import fs from 'node:fs'
import path from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { BUILTIN_IGNORES, IGNORE_FILE } from '@bowerbird/schema'

/** Ignore rules of one library: built-in patterns + the root `.bbignore` (gitignore syntax). */
export class IgnoreRules {
  private ig: Ignore = ignore()
  private builtin: Ignore = ignore().add([...BUILTIN_IGNORES])
  /** Extra patterns from plugins (a version store's data folders). */
  private extra: string[] = []

  setExtra(patterns: string[]): void { this.extra = [...patterns]; this.reload() }

  constructor(private readonly root: string) { this.reload() }

  /** Re-read `.bbignore` (call after it changes). */
  reload(): void {
    const ig = ignore().add([...BUILTIN_IGNORES, ...this.extra])
    try {
      const text = fs.readFileSync(path.join(this.root, IGNORE_FILE), 'utf8')
      ig.add(text)
    } catch { /* no .bbignore */ }
    this.ig = ig
  }

  /** Whether a library-relative path is ignored (built-in + .bbignore). Root itself is never ignored. */
  ignored(rel: string, isDir: boolean): boolean {
    if (!rel) return false
    try { return this.ig.ignores(isDir ? rel + '/' : rel) } catch { return false }
  }

  /** Built-in rules only (inside bundles, where `.bbignore` paths do not apply). */
  builtinIgnored(rel: string, isDir: boolean): boolean {
    if (!rel) return false
    try { return this.builtin.ignores(isDir ? rel + '/' : rel) } catch { return false }
  }
}
