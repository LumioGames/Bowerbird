/**
 * bowerbird.audio — server part (builtin-plugins.md「音频」): identify WAV / MP3 / OGG / FLAC by their headers,
 * decode them without external tools, and derive duration, channels, sample rate, bit depth, codec, integrated
 * loudness, sample peak and clipping positions; the `peaks` JSON and the `thumb` waveform (WebP, drawn from SVG
 * with sharp); the「0.8 秒」/「2:14」badge and the Agent summary text.
 * Uses only @bowerbird/plugin-sdk and @bowerbird/schema (engineering.md hard rule 2).
 */
import sharp from 'sharp'
import { defineServerPlugin, type AssetFile, type FileRef, type FormatHandler, type ProbeResult, type ThumbnailSet } from '@bowerbird/plugin-sdk'
import { AudioAnalyzer, toPeaksJson, type AnalysisResult } from './shared/analysis.js'
import { audioBadge, channelsText, rateText, waveformSvg } from './shared/wave.js'
import { decodeFile, detectAudio, type StreamInfo } from './decode.js'

export const FORMAT_ID = 'audio'
export const PEAK_BUCKETS = 2000
export const THUMB_SIZE = 512

interface Analysed { info: StreamInfo; result: AnalysisResult }

/** probe, thumbnail and summary of one asset run back to back: decode once. */
const recent = new Map<string, Promise<Analysed>>()

export function analyseFile(absPath: string): Promise<Analysed> {
  let analyzer: AudioAnalyzer | null = null
  return decodeFile(absPath, (chs, rate) => {
    if (!analyzer) analyzer = new AudioAnalyzer(rate, chs.length)
    analyzer.push(chs)
  }).then(info => {
    const a = analyzer as AudioAnalyzer | null
    if (!a) throw new Error('no audio could be decoded')
    return { info, result: a.finish(PEAK_BUCKETS) }
  })
}

function analysed(asset: AssetFile): Promise<Analysed> {
  const key = `${asset.absPath}|${asset.hash}|${asset.size}`
  let p = recent.get(key)
  if (!p) {
    p = analyseFile(asset.absPath)
    p.catch(() => recent.delete(key))
    recent.set(key, p)
    while (recent.size > 4) recent.delete(recent.keys().next().value!)
  }
  return p
}

export function techOf({ info, result }: Analysed): ProbeResult['tech'] {
  const tech: ProbeResult['tech'] = {
    duration: Math.round(result.duration * 1000) / 1000,
    channels: info.channels,
    sampleRate: info.sampleRate,
    codec: info.codec
  }
  if (info.bitDepth) tech.bitDepth = info.bitDepth
  if (result.loudness !== null) tech.loudness = result.loudness
  if (result.peak !== null) tech.peak = result.peak
  tech.clips = result.clips.length
  return tech
}

export function summaryOf({ info, result }: Analysed): string {
  const parts = [`音频 ${audioBadge(result.duration)}`, channelsText(info.channels), rateText(info.sampleRate)]
  if (info.bitDepth) parts.push(`${info.bitDepth} 位`)
  parts.push(info.codec)
  parts.push(result.loudness !== null ? `响度 ${result.loudness} LUFS` : '响度低于门限')
  if (result.peak !== null) parts.push(`峰值 ${result.peak} dBFS`)
  let text = parts.join('，') + '。'
  if (result.clips.length) text += `有 ${result.clips.length} 处削波。`
  return text
}

export const audioFormat: FormatHandler = {
  id: FORMAT_ID,

  async match(file: FileRef) {
    if (file.bundle) return null
    return detectAudio(file.head) ? { format: FORMAT_ID, confidence: 1 } : null
  },

  async probe(asset): Promise<ProbeResult> {
    const a = await analysed(asset)
    return {
      tech: techOf(a),
      badge: audioBadge(a.result.duration),
      analysis: { clips: a.result.clips },
      aspect: 1
    }
  },

  async thumbnail(asset): Promise<ThumbnailSet> {
    const a = await analysed(asset)
    const json = toPeaksJson(a.result)
    const thumb = await sharp(Buffer.from(waveformSvg(json, THUMB_SIZE))).webp({ quality: 90, alphaQuality: 100 }).toBuffer()
    return {
      thumb: new Uint8Array(thumb),
      peaks: new TextEncoder().encode(JSON.stringify(json)),
      aspect: 1
    }
  },

  async summarize(asset) {
    return { text: summaryOf(await analysed(asset)) }
  }
}

export default defineServerPlugin({
  activate(ctx) {
    ctx.register.format(audioFormat)
  }
})
