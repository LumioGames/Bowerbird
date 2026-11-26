/**
 * Waveform data for the viewer and compare view: the server's `peaks` JSON when it exists for the content shown,
 * otherwise the file decoded in the browser and analysed with the same code as the server. The decoded buffer
 * is also what the spectrum view reads.
 */
import * as React from 'react'
import type { AssetDetail } from '@bowerbird/schema'
import { ShellContext, type FileSource } from '@bowerbird/plugin-sdk/web'
import { analyse, toPeaksJson, type PeaksJson } from '../shared/analysis.js'
import { barHeights } from '../shared/wave.js'

let ctx: AudioContext | null = null
function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

export interface AudioData {
  peaks: PeaksJson | null
  /** The decoded file (lazy; shared by peaks fallback and spectrum). */
  decode(): Promise<AudioBuffer>
  failed: boolean
}

export function useAudioData(asset: AssetDetail, source: FileSource): AudioData {
  const shell = React.useContext(ShellContext)
  const [peaks, setPeaks] = React.useState<PeaksJson | null>(null)
  const [failed, setFailed] = React.useState(false)
  const decoded = React.useRef<Promise<AudioBuffer> | null>(null)
  const decode = React.useCallback(() => {
    if (!decoded.current) decoded.current = source.fetch().then(buf => audioContext().decodeAudioData(buf))
    return decoded.current
  }, [source])
  React.useEffect(() => {
    let gone = false
    decoded.current = null
    setPeaks(null); setFailed(false)
    const fromBrowser = () => decode().then(b => {
      const chans = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))
      return toPeaksJson(analyse(chans, b.sampleRate))
    })
    const serverPeaks = !source.version && shell
      ? fetch(shell.api.assets.thumbnailUrl(shell.library.id, asset.id, 'peaks') + (asset.thumbnail ? `&k=${encodeURIComponent(asset.thumbnail)}` : ''))
          .then(r => (r.ok ? r.json() as Promise<PeaksJson> : Promise.reject(new Error(String(r.status)))))
          .then(j => (j && Array.isArray(j.max) ? j : Promise.reject(new Error('bad peaks'))))
      : Promise.reject(new Error('version'))
    serverPeaks.catch(fromBrowser).then(p => { if (!gone) setPeaks(p) }).catch(() => { if (!gone) setFailed(true) })
    return () => { gone = true }
  }, [asset.id, asset.thumbnail, source, shell, decode])
  return { peaks, decode, failed }
}

/** Waveform bars as one SVG path in a 1000 × 200 box, with the played part drawn over it. */
export function Wave({ peaks, bars, progress, className, playedClass = 'fill-ink-1', restClass = 'fill-ink-3' }: { peaks: PeaksJson | null; bars: number; progress: number; className?: string; playedClass?: string; restClass?: string }) {
  const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const d = React.useMemo(() => {
    if (!peaks) return ''
    const h = barHeights(peaks, bars), w = 1000 / bars, bw = Math.max(1, w * 0.62)
    return h.map((v, i) => { const bh = Math.max(2, v * 184); return `M${(i * w).toFixed(1)} ${(100 - bh / 2).toFixed(1)}h${bw.toFixed(1)}v${bh.toFixed(1)}h${(-bw).toFixed(1)}Z` }).join('')
  }, [peaks, bars])
  return (
    <svg className={className} viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden>
      <defs><clipPath id={`${id}-p`}><rect x="0" y="0" width={Math.max(0, Math.min(1, progress)) * 1000} height="200" /></clipPath></defs>
      <path d={d} className={restClass} />
      <path d={d} className={playedClass} clipPath={`url(#${id}-p)`} />
    </svg>
  )
}
