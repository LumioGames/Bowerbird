/**
 * Version store commits (versioning.md「内核与版本插件的配合」): changes within a short window are merged into one
 * commit; asset files are committed together with their sidecars. Without a version store plugin nothing happens.
 */
import { SIDECAR_SUFFIX } from '@bowerbird/schema'
import type { CoreLogger, LibraryPlugins } from '../contracts.js'

export class VersionCommitter {
  private paths = new Set<string>()
  private actors = new Set<string>()
  private messages = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly plugins: () => LibraryPlugins | null, private readonly log: CoreLogger, private readonly windowMs = 5000) {}

  add(paths: string[], actor: string, message: string): void {
    const vs = this.plugins()?.versionStore()
    if (!vs) return
    for (const p of paths) { this.paths.add(p); if (!p.endsWith(SIDECAR_SUFFIX)) this.paths.add(p + SIDECAR_SUFFIX) }
    this.actors.add(actor)
    this.messages.add(message)
    if (!this.timer) {
      this.timer = setTimeout(() => { void this.flush() }, this.windowMs)
      this.timer.unref?.()
    }
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.paths.size) return
    const plugins = this.plugins()
    const vs = plugins?.versionStore()
    const paths = [...this.paths]
    const actors = [...this.actors]
    const actor = actors[0] ?? 'system:scanner'
    // everyone who changed something in this window is named (P2-14)
    const message = `${[...this.messages].join('; ')}（执行者：${actors.join('、') || actor}）`
    this.paths.clear(); this.actors.clear(); this.messages.clear()
    if (!vs || !plugins) return
    try {
      await plugins.invoke(vs.pluginId, 'versionStore.commit', () => vs.store.commit({ paths }, { actor, message, at: new Date().toISOString() }))
    } catch (e) {
      this.log.warn('version commit failed', { error: String(e) })
    }
  }
}
