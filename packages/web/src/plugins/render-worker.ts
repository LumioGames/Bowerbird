import * as React from 'react'
import type { AssetDetail, RenderTask } from '@bowerbird/schema'
import type { FileSource, FormatView, RenderedSet } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { onLibraryEvent } from '../lib/events'
import { setRendering, visibleWaiting } from '../lib/live'
import { t } from '../lib/i18n'
import { createFileSource, type PluginRegistry } from './registry'

/**
 * The browser render worker (pipeline-and-cache.md「浏览器渲染工作者」, ADR-025): the server never renders; while
 * someone has a page open, their browser takes the thumbnails / summaries that need rendering, the ones on screen
 * first, calls the format plugin's renderThumbnail / renderSummary (the viewer's own code), and hands the result
 * back. It only works when the page is idle and limits how many it does per minute. No switch.
 */
type Parts = Partial<Record<'thumb' | 'poster' | 'scrub' | 'turnaround' | 'preview', Blob>>
type Fields = { tech?: Record<string, number | string | boolean>; aspect?: number; error?: string; retryable?: boolean }

export interface RenderWorkerDeps {
  next: (visible: string[]) => Promise<RenderTask | null>
  submit: (job: string, parts: Parts, fields: Fields) => Promise<void>
  viewFor: (format: string) => FormatView | null
  fileSource: (asset: AssetDetail) => FileSource
  visible: () => string[]
  /** Resolves when the page is idle (no recent input, requestIdleCallback). */
  idle: () => Promise<void>
  sleep: (ms: number, wake: Promise<void>) => Promise<void>
  onRendering?: (assetId: string, on: boolean) => void
  /** Minimum time between two tasks, and at most this many per minute. */
  minGapMs?: number
  perMinute?: number
  /** Wait when there is nothing to do (a wake-up event ends it early). */
  emptyWaitMs?: number
  now?: () => number
}

export function partsOf(set: RenderedSet): Parts {
  const out: Parts = {}
  for (const k of ['thumb', 'poster', 'scrub', 'turnaround', 'preview'] as const) if (set[k]) out[k] = set[k]
  return out
}

/**
 * What a failed render reports back (RenderResultFields): the plugin's own words for people (`message`, e.g.
 * 「这台电脑的浏览器放不了这种视频（ProRes 4444）」) and whether a retry can help (`retryable: false` for a codec the
 * browser cannot decode). Plugins throw an Error subclass or a plain object carrying both; anything else is a
 * retryable failure with its text.
 */
export function renderFailure(e: unknown): { error: string; retryable: boolean } {
  const o = (e != null && typeof e === 'object' ? e : {}) as { message?: unknown; retryable?: unknown }
  const message = typeof o.message === 'string' && o.message.trim() ? o.message : typeof e === 'string' && e.trim() ? e : t('cell.failed')
  return { error: message, retryable: typeof o.retryable === 'boolean' ? o.retryable : true }
}

/** Do one task; returns false when there was none. Errors are reported back to the server with a reason. */
export async function runOneRender(d: RenderWorkerDeps): Promise<boolean> {
  const task = await d.next(d.visible())
  if (!task) return false
  const view = d.viewFor(task.format)
  const fn = task.kind === 'thumbnail' ? view?.renderThumbnail : view?.renderSummary
  if (!view || !fn) {
    await d.submit(task.job, {}, { error: t('render.noPlugin'), retryable: true })
    return true
  }
  d.onRendering?.(task.assetId, true)
  try {
    const source = d.fileSource(task.asset)
    // A thumbnail task brings the summary image along when the plugin has one: both parts go back in one submit.
    const parts: Parts = {}
    const fields: Fields = {}
    if (task.kind === 'thumbnail') {
      const set = await view.renderThumbnail!(task.asset, source)
      Object.assign(parts, partsOf(set))
      if (set.aspect != null) fields.aspect = set.aspect
      if (set.tech) fields.tech = set.tech
    }
    if (view.renderSummary && !parts.turnaround) {
      try { parts.turnaround = await view.renderSummary(task.asset, source) } catch (e) { if (task.kind === 'summary') throw e }
    }
    await d.submit(task.job, parts, fields)
  } catch (e) {
    await d.submit(task.job, {}, renderFailure(e)).catch(() => {})
  } finally {
    d.onRendering?.(task.assetId, false)
  }
  return true
}

/** The loop: idle → next → render → submit, rate-limited; sleeps when the queue is empty until woken. */
export function createRenderWorker(d: RenderWorkerDeps) {
  let running = false
  let wakeResolve: (() => void) | null = null
  let wakeP = new Promise<void>(r => { wakeResolve = r })
  const starts: number[] = []
  const now = d.now ?? (() => Date.now())
  const minGap = d.minGapMs ?? 600
  const perMinute = d.perMinute ?? 30
  const wake = () => { const r = wakeResolve; wakeP = new Promise<void>(res => { wakeResolve = res }); r?.() }
  async function loop() {
    while (running) {
      await d.idle()
      if (!running) break
      const tNow = now()
      while (starts.length && tNow - starts[0]! > 60_000) starts.shift()
      const last = starts[starts.length - 1]
      if (starts.length >= perMinute) { await d.sleep(60_000 - (tNow - starts[0]!), wakeP.then(() => new Promise(() => {}))); continue }
      if (last != null && tNow - last < minGap) { await d.sleep(minGap - (tNow - last), new Promise(() => {})); continue }
      starts.push(tNow)
      let did = false
      try { did = await runOneRender(d) } catch { did = false }
      if (!did) await d.sleep(d.emptyWaitMs ?? 20_000, wakeP)
    }
  }
  return {
    start() { if (running) return; running = true; void loop() },
    stop() { running = false; wake() },
    wake
  }
}

/** Mounted once by ShellLayout for the open library. */
export function useRenderWorker(lib: string, registry: PluginRegistry): void {
  const regRef = React.useRef(registry)
  regRef.current = registry
  React.useEffect(() => {
    if (!registry.ready) return
    let lastInput = 0
    const onInput = () => { lastInput = Date.now() }
    window.addEventListener('pointerdown', onInput, true)
    window.addEventListener('keydown', onInput, true)
    window.addEventListener('wheel', onInput, { capture: true, passive: true })
    const idle = () => new Promise<void>(resolve => {
      const check = () => {
        if (document.hidden || Date.now() - lastInput < 800) { setTimeout(check, 400); return }
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
        if (ric) ric(() => resolve(), { timeout: 2000 }); else setTimeout(resolve, 200)
      }
      check()
    })
    const sleep = (ms: number, wake: Promise<void>) => new Promise<void>(resolve => { const tm = setTimeout(resolve, ms); void wake.then(() => { clearTimeout(tm); resolve() }) })
    const worker = createRenderWorker({
      next: async visible => (await api.render.next(lib, visible)).task,
      submit: (job, parts, fields) => api.render.submit(lib, job, parts, fields),
      viewFor: format => regRef.current.formatView(format)?.view ?? null,
      fileSource: asset => createFileSource(lib, asset),
      visible: visibleWaiting,
      idle,
      sleep,
      onRendering: setRendering
    })
    worker.start()
    const off = onLibraryEvent((type, data) => {
      const d = data as { status?: string; kind?: string } | null
      if (type === 'asset.created' || (type === 'job.updated' && (d?.status === 'waiting-renderer' || d?.kind === 'render'))) worker.wake()
    })
    const tick = setInterval(() => { if (visibleWaiting().length) worker.wake() }, 3000)
    return () => {
      worker.stop(); off(); clearInterval(tick)
      window.removeEventListener('pointerdown', onInput, true)
      window.removeEventListener('keydown', onInput, true)
      window.removeEventListener('wheel', onInput, true)
    }
  }, [lib, registry.ready])
}
