/**
 * bowerbird.video — server part (builtin-plugins.md「视频」): identify MP4 / MOV / WebM by their container,
 * read duration, size, frame rate, codec and sound from the container itself (no ffmpeg), the「0:03」badge and
 * the Agent summary text. Thumbnails are rendered in the browser (`thumbnail: browser`, ADR-025).
 * Uses only @bowerbird/plugin-sdk and @bowerbird/schema (engineering.md hard rule 2).
 */
import { defineServerPlugin, type FileRef, type FormatHandler, type ProbeResult } from '@bowerbird/plugin-sdk'
import { formatDuration, probeFile, sniff, type VideoInfo } from './container/index.js'

export const FORMAT_ID = 'video'

export function techOf(info: VideoInfo): ProbeResult['tech'] {
  const tech: ProbeResult['tech'] = { hasAudio: info.hasAudio, container: info.container }
  if (info.duration !== null) tech.duration = Math.round(info.duration * 1000) / 1000
  if (info.width) tech.width = info.width
  if (info.height) tech.height = info.height
  if (info.frameRate !== null) tech.frameRate = info.frameRate
  if (info.codec) tech.codec = info.codec
  return tech
}

function seconds(d: number): string {
  return d < 60 ? `${(Math.round(d * 10) / 10).toString()} 秒` : formatDuration(d)
}

export function summaryOf(info: VideoInfo): string {
  const parts: string[] = []
  parts.push(info.duration !== null ? `视频 ${formatDuration(info.duration)}（${seconds(info.duration)}）` : '视频，时长未知')
  if (info.width && info.height) parts.push(`${info.width}×${info.height}`)
  if (info.frameRate !== null) parts.push(`${info.frameRate} fps`)
  parts.push(info.codec ? `编码 ${info.codec}` : '编码未知')
  parts.push(info.hasAudio ? '有声音' : '无声音')
  return parts.join('，') + '。'
}

export const videoFormat: FormatHandler = {
  id: FORMAT_ID,

  async match(file: FileRef) {
    if (file.bundle) return null
    return sniff(file.head) ? { format: FORMAT_ID, confidence: 1 } : null
  },

  async probe(asset): Promise<ProbeResult> {
    const info = await probeFile(asset.absPath)
    if (!info.hasVideo) throw new Error(`${asset.name} has no video track`)
    const result: ProbeResult = { tech: techOf(info) }
    if (info.duration !== null) result.badge = formatDuration(info.duration)
    if (info.width && info.height) result.aspect = info.width / info.height
    return result
  },

  async summarize(asset) {
    return { text: summaryOf(await probeFile(asset.absPath)) }
  }
}

export default defineServerPlugin({
  activate(ctx) {
    ctx.register.format(videoFormat)
  }
})
