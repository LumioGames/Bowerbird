/**
 * bowerbird.audio — web part: viewer (waveform / spectrum, selection loop, loudness, clipping) and compare view
 * (two waveforms on one time axis). Grid cells keep the server waveform thumbnail and never play on hover.
 */
import type { Locale } from '@bowerbird/plugin-sdk/web'
import type { AssetDetail } from '@bowerbird/schema'
import { inLocale, t, type Key, type T } from './i18n.js'
import { defineWebPlugin } from '@bowerbird/plugin-sdk/web'
import { AudioViewer } from './Viewer.js'
import { AudioCompare } from './Compare.js'
import { audioCompareModes } from './lib/rules.js'
import { audioBadge, rateText, secondsOfBadge, signed } from '../shared/wave.js'

const TECH_KEYS = ['duration', 'channels', 'sampleRate', 'bitDepth', 'codec', 'loudness', 'peak'] as const

/** Compare-table labels of the tech keys, in the page language. */
export function techLabels(): Record<string, string> {
  return Object.fromEntries(TECH_KEYS.map(k => [k, t(`tech.${k}` as Key)]))
}

function badgeText(badge: string, tr: T): string {
  const s = secondsOfBadge(badge)
  return s ? tr('seconds', { s }) : badge
}

/** The server writes「0.8 秒」under ten seconds (shared/wave.ts audioBadge) and「2:14」above; the first in `locale`. */
export function formatBadge(badge: string, locale: Locale): string { return badgeText(badge, inLocale(locale)) }

/**
 * The inspector's「技术信息」as the prototype writes it (flows.js `techRows`): 时长 as the grid badge says it
 * (「0.8 秒」), 声道 单声道 / 立体声 /「6 声道」, 采样率「48 kHz」, and 响度「−16.2 LUFS」when it was measured.
 */
export function audioTechRows(asset: AssetDetail, tr: T): Array<[string, string]> | null {
  const num = (k: string) => { const v = asset.tech[k]; return typeof v === 'number' ? v : null }
  const duration = num('duration'), channels = num('channels'), rate = num('sampleRate'), loudness = num('loudness')
  if (duration === null && channels === null && rate === null) return null
  const rows: Array<[string, string]> = [
    [tr('tech.duration'), duration === null ? '—' : badgeText(audioBadge(duration), tr)],
    [tr('tech.channels'), channels === null ? '—' : channels === 1 ? tr('tech.row.mono') : channels === 2 ? tr('tech.row.stereo') : tr('tech.row.channelsN', { n: channels })],
    [tr('tech.sampleRate'), rate === null ? '—' : rateText(rate)]
  ]
  if (loudness !== null) rows.push([tr('tech.loudness'), `${signed(loudness)} LUFS`])
  return rows
}

export default defineWebPlugin({
  formats: {
    audio: {
      Viewer: AudioViewer,
      Compare: AudioCompare,
      compareModes: audioCompareModes,
      formatBadge,
      get techLabels() { return techLabels() },
      techRows: (asset, locale) => audioTechRows(asset, inLocale(locale)),
      intro: locale => inLocale(locale)('intro')
    }
  }
})
